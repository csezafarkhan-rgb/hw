-- ============================================================================
-- Homeweavers Workspace - PROPOSED Supabase schema (NOT the live one)
--
-- This was written from the app's storage layout before the existing repo was
-- seen. The live schema is supabase_schema.sql. Compare the two before running
-- anything here - do NOT execute this against a database that already has
-- tables and data.
--
-- The app currently keeps everything in the browser: eight IndexedDB databases
-- and a set of localStorage keys. That is why a second browser shows nothing.
-- This schema moves the same data server-side without rewriting how the
-- dashboards think about it.
--
-- Design note. Most dashboards store a whole dataset under one key - the
-- inventory list, the container list, a year of attendance - rather than one
-- row per record. Fighting that would mean rewriting all six. So the core is a
-- key/value table with a JSONB payload, which is a faithful home for what
-- exists today, plus real tables where per-row access genuinely pays: users,
-- audit, leave requests and files.
--
-- Run this in the Supabase SQL editor, top to bottom.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Workspaces
--    One row is enough today. It exists so a second company, or a staging
--    copy, does not need a second database later.
-- ---------------------------------------------------------------------------
create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

insert into workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Homeweavers')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. People and access
--    Mirrors the shell's user records: role, which dashboards they may open,
--    and what they see inside Attendance.
--    Passwords are NOT stored here - Supabase Auth owns those. The row is
--    linked to auth.users by id.
-- ---------------------------------------------------------------------------
create table if not exists app_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  username      text not null,
  role          text not null default 'user'      check (role in ('admin','user')),
  tabs          text[] not null default '{}',     -- dashboard ids, or {*} for all
  att_role      text not null default 'employee'  check (att_role in ('admin','employee')),
  att_employee  text default '',                  -- their name in the attendance data
  created_at    timestamptz not null default now(),
  unique (workspace_id, username)
);

-- Every policy below asks "is the caller an admin?". Kept as a function so the
-- rule lives in one place.
create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from app_users u
    where u.id = auth.uid() and u.role = 'admin'
  );
$$;

create or replace function my_workspace()
returns uuid language sql stable security definer as $$
  select workspace_id from app_users where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 3. Dashboard state
--    The direct replacement for the IndexedDB stores. One row per
--    (workspace, dashboard, key); the value is whatever that dashboard saved.
--
--    dashboard: 'attendance' | 'inventory' | 'products' | 'orders'
--               | 'containers' | 'financial' | 'workspace'
--    key:       the same key the app uses today - 'overrides', 'halfDays',
--               'list', 'settings', 'app', 'orders', and so on.
-- ---------------------------------------------------------------------------
create table if not exists app_state (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  dashboard     text not null,
  key           text not null,
  value         jsonb not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  primary key (workspace_id, dashboard, key)
);

create index if not exists app_state_dash_idx on app_state (workspace_id, dashboard);

-- Keep updated_at honest without asking the client to remember.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists app_state_touch on app_state;
create trigger app_state_touch before insert or update on app_state
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Leave requests
--    A real table rather than a blob: two people act on these at once, and
--    "who is waiting on a decision" is a query, not a scan of a JSON array.
-- ---------------------------------------------------------------------------
create table if not exists leave_requests (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  employee      text not null,
  date_from     date not null,
  date_to       date not null,
  leave_type    text not null default 'CL',
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','query')),
  message       text default '',
  admin_note    text default '',
  employee_reply text default '',
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists leave_requests_open_idx
  on leave_requests (workspace_id, status) where archived_at is null;

-- ---------------------------------------------------------------------------
-- 5. Audit trail
--    Backs the Changes tab. Every mark that moves a figure, with what it
--    replaced - which is what makes undo a restore rather than a guess.
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id            bigserial primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  at            timestamptz not null default now(),
  who           text not null,
  store         text not null,          -- overrides, halfDays, salaries, ...
  entry_key     text not null,          -- 'Rahul Mishra|2026-07-14'
  before_value  jsonb,
  after_value   jsonb,
  label         text default ''
);

create index if not exists audit_recent_idx on audit_log (workspace_id, at desc);

-- ---------------------------------------------------------------------------
-- 6. Files
--    Packing slips and photos. The bytes live in Supabase Storage; this table
--    records what they are and what they belong to.
--
--    Create the bucket first:  Storage -> New bucket -> name "files", private.
-- ---------------------------------------------------------------------------
create table if not exists files (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  dashboard     text not null,
  owner_key     text not null,          -- container id, employee|date, ...
  field         text default '',        -- printSlip, packingList, ...
  name          text not null,
  mime          text default '',
  size_bytes    bigint default 0,
  storage_path  text not null,          -- path inside the "files" bucket
  created_at    timestamptz not null default now()
);

create index if not exists files_owner_idx on files (workspace_id, dashboard, owner_key);

-- ---------------------------------------------------------------------------
-- 7. Row level security
--    Without this every table is readable by anyone holding the anon key,
--    which is a public value shipped in the page. RLS is the actual boundary.
-- ---------------------------------------------------------------------------
alter table workspaces     enable row level security;
alter table app_users      enable row level security;
alter table app_state      enable row level security;
alter table leave_requests enable row level security;
alter table audit_log      enable row level security;
alter table files          enable row level security;

-- Signed-in members can read their own workspace.
create policy ws_read on workspaces
  for select using (id = my_workspace());

-- Everyone sees the user list; only admins change it.
create policy users_read  on app_users for select
  using (workspace_id = my_workspace());
create policy users_write on app_users for all
  using (is_admin() and workspace_id = my_workspace())
  with check (is_admin() and workspace_id = my_workspace());

-- Dashboard data: any member reads, any member writes within their workspace.
-- Tighten later if you want per-dashboard write rules.
create policy state_read  on app_state for select
  using (workspace_id = my_workspace());
create policy state_write on app_state for all
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- Leave requests: an employee sees and raises their own; admins see all.
create policy lr_read on leave_requests for select
  using (
    workspace_id = my_workspace()
    and (is_admin() or employee = (select att_employee from app_users where id = auth.uid()))
  );
create policy lr_insert on leave_requests for insert
  with check (workspace_id = my_workspace());
create policy lr_update on leave_requests for update
  using (workspace_id = my_workspace() and is_admin());

-- Audit: readable by admins, appended by anyone, never edited or deleted.
create policy audit_read   on audit_log for select using (is_admin() and workspace_id = my_workspace());
create policy audit_insert on audit_log for insert with check (workspace_id = my_workspace());

create policy files_read  on files for select using (workspace_id = my_workspace());
create policy files_write on files for all
  using (workspace_id = my_workspace()) with check (workspace_id = my_workspace());

-- ---------------------------------------------------------------------------
-- 8. Live updates
--    Lets one browser see another's changes without a refresh - the thing the
--    Containers dashboard already does through Supabase today.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table app_state;
alter publication supabase_realtime add table leave_requests;

-- ---------------------------------------------------------------------------
-- 9. First admin
--    Create the person in Authentication -> Users, copy their UUID, then run:
--
--    insert into app_users (id, workspace_id, username, role, tabs, att_role)
--    values ('<uuid-from-auth>', '00000000-0000-0000-0000-000000000001',
--            'admin', 'admin', '{*}', 'admin');
-- ---------------------------------------------------------------------------
