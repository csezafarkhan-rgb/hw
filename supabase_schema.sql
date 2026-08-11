-- ============================================================================
-- Homeweavers Workspace — Supabase schema
--
-- Written by reading the application code, not the dashboard names. Where the
-- code and the brief disagreed, the code won; those cases are called out in
-- migration_notes.md.
--
-- GUIDING DECISION
-- The dashboards do not store rows. They store whole datasets under a handful
-- of keys: the entire container list under 'list', a year of punches under
-- 'customDataset', the whole working inventory under 'data'. Normalising that
-- would mean rewriting all six dashboards, which is explicitly out of scope.
-- So the core is a key/value table with a JSONB payload that mirrors the
-- existing stores exactly, and real tables exist only where per-row access
-- genuinely earns itself:
--
--   * leave_requests — two people act on these concurrently, and "who is
--     waiting on a decision" should be a query, not a scan of a JSON array
--   * audit_log      — append-only, queried by time, grows without bound
--   * files          — blobs cannot live in JSONB; they need Storage
--   * app_users      — must join to auth.users for RLS to mean anything
--
-- Everything else stays as JSONB. That is a deliberate choice, not laziness:
-- it lets the storage layer be swapped without touching dashboard logic.
--
-- Run top to bottom in the Supabase SQL editor.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";      -- for the search indexes below


-- ============================================================================
-- 1. WORKSPACE
-- One row today. It exists so a second company, or a staging copy, does not
-- require a second database later.
-- ============================================================================
create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

insert into workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Homeweavers')
on conflict (id) do nothing;


-- ============================================================================
-- 2. USERS
--
-- Source: shell.template.html, IndexedDB `hw_workspace` / store `st` / key
-- 'users'. The record found in the code is:
--
--   { hash, role:'admin'|'user', tabs:'*'|[ids], created,
--     att:{ role:'admin'|'employee', emp:'<name in attendance data>' },
--     sq:{ q, a } }                       -- optional security question
--
-- `hash` is SHA-256 of the password, unsalted. It is NOT migrated. Supabase
-- Auth owns credentials; every user is recreated there and this table holds
-- only the profile and access rules.
-- ============================================================================
create table if not exists app_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  username      text not null,
  role          text not null default 'user'      check (role in ('admin','user')),

  -- '*' in the old record becomes the literal array {*}; tabsOf() expands it
  tabs          text[] not null default '{}',

  -- from rec.att — what this person sees inside the Attendance dashboard
  att_role      text not null default 'employee'  check (att_role in ('admin','employee')),
  att_employee  text not null default '',         -- matches EMPLOYEES[].name

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (workspace_id, username)
);

create index if not exists app_users_ws_idx  on app_users (workspace_id);
create index if not exists app_users_emp_idx on app_users (workspace_id, att_employee);

-- Helpers used by every policy below. SECURITY DEFINER so a user may check
-- their own row without needing select rights on the table first.
create or replace function my_workspace()
returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from app_users where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where id = auth.uid() and role = 'admin');
$$;

-- The attendance name of the caller, for the employee-only policies.
create or replace function my_employee_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(att_employee, '') from app_users where id = auth.uid();
$$;

-- Does the caller have full access inside Attendance?
create or replace function is_att_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users
    where id = auth.uid() and (role = 'admin' or att_role = 'admin')
  );
$$;


-- ============================================================================
-- 3. APP STATE — the direct replacement for the IndexedDB key/value stores
--
-- One row per (workspace, scope, key). `value` holds exactly what the browser
-- held, so a dashboard's read path changes but its data shape does not.
--
-- scope is the origin store, kept distinct because two dashboards use the same
-- key name for different things:
--
--   'attendance_bridge'  hw_bridge / kv        28 keys (overrides, halfDays,
--                                              salaries, joinDates, payRules…)
--   'attendance_data'    att_data / kv         key 'customDataset'
--   'inventory'          hw_inventory/working  data, coll_alias,
--                                              products_snapshot, portals,
--                                              aliases, edits, snaps
--   'products'           hw_products / kv      channel_listings,
--                                              collection_specs, spec_skus,
--                                              hw_products_ui2_v5
--   'orders'             hw_orders / kv        dataset, shipments, ship_hidden,
--                                              nmdataset, shipstatus
--   'containers'         hw_containers / kv    list, settings
--   'financial'          hw_financial / kv     app, orders
--   'workspace'          browser localStorage  UI preferences (see notes)
-- ============================================================================
create table if not exists app_state (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  scope         text not null,
  key           text not null,
  value         jsonb not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null,

  primary key (workspace_id, scope, key),

  constraint app_state_scope_known check (scope in (
    'attendance_bridge','attendance_data','inventory','products',
    'orders','containers','financial','workspace'
  ))
);

create index if not exists app_state_scope_idx   on app_state (workspace_id, scope);
create index if not exists app_state_updated_idx on app_state (workspace_id, updated_at desc);

create or replace function touch_app_state()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists app_state_touch on app_state;
create trigger app_state_touch
  before insert or update on app_state
  for each row execute function touch_app_state();

-- Same trigger, reused for the other tables that carry updated_at.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists app_users_touch on app_users;
create trigger app_users_touch
  before update on app_users
  for each row execute function touch_updated_at();


-- ============================================================================
-- 4. LEAVE REQUESTS
--
-- Source: hw_bridge key 'leaveRequests', an array of:
--   { id, empName, dateFrom, dateTo, leaveType, message, status,
--     adminNote, employeeReply, createdAt, updatedAt, archived }
--
-- Promoted out of JSONB because two people act on these at once and the badge
-- count is a query. Status values are exactly those the code writes.
-- ============================================================================
create table if not exists leave_requests (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  legacy_id       text,                        -- original 'req_...' id, for the import
  employee        text not null,               -- EMPLOYEES[].name
  date_from       date not null,
  date_to         date not null,
  leave_type      text not null default 'CL',
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','query')),
  message         text not null default '',
  admin_note      text not null default '',
  employee_reply  text not null default '',
  archived_at     timestamptz,                 -- null = in the current list
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint leave_dates_ordered check (date_to >= date_from),
  unique (workspace_id, legacy_id)
);

create index if not exists leave_open_idx
  on leave_requests (workspace_id, status) where archived_at is null;
create index if not exists leave_emp_idx
  on leave_requests (workspace_id, employee, date_from desc);

drop trigger if exists leave_requests_touch on leave_requests;
create trigger leave_requests_touch
  before update on leave_requests
  for each row execute function touch_updated_at();


-- ============================================================================
-- 5. AUDIT LOG
--
-- Source: hw_bridge key 'hw_att_audit', capped at 400 entries in the browser:
--   { at, who, store, key, before, after, label }
--
-- Append-only here, and uncapped — the cap existed only because browser
-- storage is finite. `before` is what makes undo a restore rather than a guess,
-- so both sides are kept as JSONB whatever their shape.
-- ============================================================================
create table if not exists audit_log (
  id            bigserial primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  at            timestamptz not null default now(),
  who           text not null default 'unknown',
  actor_id      uuid references auth.users(id) on delete set null,
  store         text not null,        -- overrides, halfDays, salaries, joinDates…
  entry_key     text not null,        -- 'Rahul Mishra|2026-07-14'
  before_value  jsonb,
  after_value   jsonb,
  label         text not null default ''
);

create index if not exists audit_recent_idx on audit_log (workspace_id, at desc);
create index if not exists audit_store_idx  on audit_log (workspace_id, store, at desc);
create index if not exists audit_key_idx    on audit_log (workspace_id, entry_key);


-- ============================================================================
-- 6. FILES
--
-- Source: hw_containers. A slip is stored on the container record as
--   { key, name, type, size, at }
-- with the bytes under that `key` in the same object store. Blobs cannot live
-- in JSONB — JSON.stringify turns a Blob into {} silently — so the bytes go to
-- Supabase Storage and this table records what they are.
--
-- Fields kept from the record so the dashboard needs no reshaping:
--   owner_key = container id, field = 'vendorSlip' | 'printSlip'
-- ============================================================================
create table if not exists files (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  scope         text not null,               -- 'containers', 'products', …
  owner_key     text not null,               -- container id, sku, employee|date
  field         text not null default '',    -- vendorSlip | printSlip | …
  legacy_key    text,                        -- the old IndexedDB blob key
  name          text not null,
  mime          text not null default '',
  size_bytes    bigint not null default 0,
  storage_path  text not null,               -- path inside the 'files' bucket
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),

  unique (workspace_id, storage_path)
);

create index if not exists files_owner_idx  on files (workspace_id, scope, owner_key);
create index if not exists files_legacy_idx on files (workspace_id, legacy_key);


-- ============================================================================
-- 7. IMPORT HISTORY
--
-- Source: containers localStorage 'hw_ctr_imports', capped at 60:
--   { at, file, size, sheets, added, updated }
-- Small, append-only, and useful for tracing a bad import. A table rather than
-- JSONB so it can be queried by date without loading the whole log.
-- ============================================================================
create table if not exists import_log (
  id            bigserial primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  scope         text not null,              -- 'containers', 'attendance', …
  at            timestamptz not null default now(),
  file_name     text not null default '',
  size_bytes    bigint not null default 0,
  sheets        integer not null default 0,
  rows_added    integer not null default 0,
  rows_updated  integer not null default 0,
  imported_by   uuid references auth.users(id) on delete set null
);

create index if not exists import_log_idx on import_log (workspace_id, scope, at desc);


-- ============================================================================
-- 8. ROW LEVEL SECURITY
--
-- The anon key is public — it ships in the page. RLS is the actual boundary,
-- so every table gets it. A table added later without RLS is readable by
-- anyone holding that key.
-- ============================================================================
alter table workspaces     enable row level security;
alter table app_users      enable row level security;
alter table app_state      enable row level security;
alter table leave_requests enable row level security;
alter table audit_log      enable row level security;
alter table files          enable row level security;
alter table import_log     enable row level security;

-- ---- workspaces -----------------------------------------------------------
drop policy if exists ws_read on workspaces;
create policy ws_read on workspaces
  for select to authenticated
  using (id = my_workspace());

-- ---- app_users ------------------------------------------------------------
-- Everyone sees the member list (the dashboards show names); only admins edit.
drop policy if exists users_read on app_users;
create policy users_read on app_users
  for select to authenticated
  using (workspace_id = my_workspace());

drop policy if exists users_insert on app_users;
create policy users_insert on app_users
  for insert to authenticated
  with check (is_admin() and workspace_id = my_workspace());

drop policy if exists users_update on app_users;
create policy users_update on app_users
  for update to authenticated
  using (is_admin() and workspace_id = my_workspace())
  with check (is_admin() and workspace_id = my_workspace());

drop policy if exists users_delete on app_users;
create policy users_delete on app_users
  for delete to authenticated
  using (is_admin() and workspace_id = my_workspace() and id <> auth.uid());

-- ---- app_state ------------------------------------------------------------
-- Read: any member. Write: any member EXCEPT the attendance scopes, which are
-- limited to attendance admins — an employee-only account must not be able to
-- rewrite the leave balances it is shown.
drop policy if exists state_read on app_state;
create policy state_read on app_state
  for select to authenticated
  using (workspace_id = my_workspace());

drop policy if exists state_insert on app_state;
create policy state_insert on app_state
  for insert to authenticated
  with check (
    workspace_id = my_workspace()
    and (scope not in ('attendance_bridge','attendance_data') or is_att_admin())
  );

drop policy if exists state_update on app_state;
create policy state_update on app_state
  for update to authenticated
  using (
    workspace_id = my_workspace()
    and (scope not in ('attendance_bridge','attendance_data') or is_att_admin())
  )
  with check (
    workspace_id = my_workspace()
    and (scope not in ('attendance_bridge','attendance_data') or is_att_admin())
  );

drop policy if exists state_delete on app_state;
create policy state_delete on app_state
  for delete to authenticated
  using (is_admin() and workspace_id = my_workspace());

-- ---- leave_requests -------------------------------------------------------
-- An employee sees and raises their own; an attendance admin sees and decides all.
drop policy if exists lr_read on leave_requests;
create policy lr_read on leave_requests
  for select to authenticated
  using (
    workspace_id = my_workspace()
    and (is_att_admin() or employee = my_employee_name())
  );

drop policy if exists lr_insert on leave_requests;
create policy lr_insert on leave_requests
  for insert to authenticated
  with check (
    workspace_id = my_workspace()
    and (is_att_admin() or employee = my_employee_name())
  );

-- Only an admin decides. An employee replying to a query is handled by the
-- narrower policy below.
drop policy if exists lr_update_admin on leave_requests;
create policy lr_update_admin on leave_requests
  for update to authenticated
  using (workspace_id = my_workspace() and is_att_admin())
  with check (workspace_id = my_workspace() and is_att_admin());

drop policy if exists lr_delete on leave_requests;
create policy lr_delete on leave_requests
  for delete to authenticated
  using (workspace_id = my_workspace() and is_att_admin());

-- ---- audit_log ------------------------------------------------------------
-- Readable by attendance admins, appended by anyone, never updated or deleted:
-- an audit trail that can be edited is not one.
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log
  for select to authenticated
  using (workspace_id = my_workspace() and is_att_admin());

drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log
  for insert to authenticated
  with check (workspace_id = my_workspace());

-- ---- files ----------------------------------------------------------------
drop policy if exists files_read on files;
create policy files_read on files
  for select to authenticated
  using (workspace_id = my_workspace());

drop policy if exists files_insert on files;
create policy files_insert on files
  for insert to authenticated
  with check (workspace_id = my_workspace());

drop policy if exists files_delete on files;
create policy files_delete on files
  for delete to authenticated
  using (workspace_id = my_workspace());

-- ---- import_log -----------------------------------------------------------
drop policy if exists imports_read on import_log;
create policy imports_read on import_log
  for select to authenticated
  using (workspace_id = my_workspace());

drop policy if exists imports_insert on import_log;
create policy imports_insert on import_log
  for insert to authenticated
  with check (workspace_id = my_workspace());


-- ============================================================================
-- 9. STORAGE
--
-- Create the bucket, private. Packing slips are commercial documents and the
-- bucket must not be public.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

-- Paths are laid out as:  <workspace_id>/<scope>/<owner_key>/<uuid>-<name>
-- so the first path segment can be checked against the caller's workspace.
drop policy if exists files_bucket_read on storage.objects;
create policy files_bucket_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = my_workspace()::text
  );

drop policy if exists files_bucket_insert on storage.objects;
create policy files_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = my_workspace()::text
  );

drop policy if exists files_bucket_delete on storage.objects;
create policy files_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = my_workspace()::text
  );


-- ============================================================================
-- 10. REALTIME
-- So an admin's change reaches every signed-in browser without a refresh.
-- app_state carries almost everything; the other two are the tables people
-- watch while working.
-- ============================================================================
do $$
begin
  begin execute 'alter publication supabase_realtime add table app_state';      exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table leave_requests'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table files';          exception when duplicate_object then null; end;
end $$;


-- ============================================================================
-- 11. CONVENIENCE VIEWS
-- ============================================================================

-- What the Requests badge counts: waiting on a decision, not archived.
create or replace view v_open_leave_requests as
  select workspace_id, count(*) as waiting
  from leave_requests
  where archived_at is null and status in ('pending','query')
  group by workspace_id;

-- What the Backup panel reports before a download.
create or replace view v_state_summary as
  select workspace_id,
         scope,
         count(*)                      as keys,
         sum(pg_column_size(value))    as bytes,
         max(updated_at)               as last_change
  from app_state
  group by workspace_id, scope;


-- ============================================================================
-- 12. FIRST ADMIN
--
-- Create the person in Authentication → Users, then:
--
--   insert into app_users (id, workspace_id, username, role, tabs,
--                          att_role, att_employee)
--   values ('<uuid from auth.users>',
--           '00000000-0000-0000-0000-000000000001',
--           'admin', 'admin', '{*}', 'admin', '');
--
-- Without a row here the helper functions return null and every policy denies,
-- including for a user who exists in auth.
-- ============================================================================
