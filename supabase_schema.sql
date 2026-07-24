-- ============================================================
-- Homeweavers Workspace — Supabase schema (pilot: containers)
-- ------------------------------------------------------------
-- Run this ONCE in your Supabase project (SQL Editor → New query
-- → paste → Run).  Safe to re-run — every statement uses
-- IF NOT EXISTS / OR REPLACE.
-- ============================================================

-- ---- containers table -----------------------------------------------------
create table if not exists public.containers (
  id                text primary key,           -- normalized container # (4 letters + 6-7 digits)
  container         text not null,
  vendor            text,
  invoice           text,
  commodity         text,
  customer          text,
  shipping_line     text,
  ex_factory        date,
  vessel_plan       date,
  actual_etd        date,
  eta               date,
  amt_usd           numeric,
  freight_cost      numeric,
  comments          text,
  terminal          text,
  isf               text,
  bill_number       text,
  hbl               text,
  master_bl         text,
  source            text,
  delivered_manual  boolean default false,
  imported          bigint,                     -- ms epoch, from client
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- keep updated_at fresh on every UPDATE
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists containers_touch on public.containers;
create trigger containers_touch
before update on public.containers
for each row execute function public.touch_updated_at();

-- ---- global container settings (alert threshold + column order) ----------
-- Only one row, always id='global'.  Shared by everyone.
create table if not exists public.container_settings (
  id            text primary key default 'global',
  alert_days    int  not null default 5,
  column_order  text[],
  updated_at    timestamptz default now()
);

drop trigger if exists container_settings_touch on public.container_settings;
create trigger container_settings_touch
before update on public.container_settings
for each row execute function public.touch_updated_at();

-- seed a global row if not there yet
insert into public.container_settings (id, alert_days)
values ('global', 5)
on conflict (id) do nothing;

-- ============================================================
-- Row Level Security
-- ============================================================
-- We're not using Supabase Auth (yet) — the workspace has its own
-- login gate. So the anon key needs full read/write. This is fine
-- for an internal tool where the URL isn't publicly guessable.
-- If you later want proper per-user auth, switch these policies
-- to require auth.uid() and enable Supabase Auth.

alter table public.containers          enable row level security;
alter table public.container_settings  enable row level security;

drop policy if exists "containers_all"          on public.containers;
drop policy if exists "container_settings_all"  on public.container_settings;

create policy "containers_all"
  on public.containers for all
  using (true) with check (true);

create policy "container_settings_all"
  on public.container_settings for all
  using (true) with check (true);

-- ============================================================
-- Real-time: publish both tables so subscribed clients get
-- INSERT / UPDATE / DELETE events via WebSocket.
-- ============================================================
alter publication supabase_realtime add table public.containers;
alter publication supabase_realtime add table public.container_settings;

-- (If either ADD fails with "already in publication", that's fine.)
