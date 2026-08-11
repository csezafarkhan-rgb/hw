-- ============================================================================
-- Homeweavers Workspace — seed data
--
-- Only the defaults the application itself falls back to when a key is absent,
-- taken from the code. Everything here is what a fresh browser already assumes,
-- so seeding it changes no behaviour — it just makes the values visible and
-- editable in one place instead of implicit in six files.
--
-- Run AFTER supabase_schema.sql. Safe to re-run: every insert is idempotent.
-- No business data is seeded. No accounts are created here.
-- ============================================================================

-- The workspace row is created by the schema; this is a guard for a standalone run.
insert into workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Homeweavers')
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Attendance thresholds
-- Source: attendance.html — lateThresholdMin 10, earlyThresholdMin 10,
-- weeklyLeverageMin 30. Stored as separate keys because that is how the code
-- reads them.
-- ---------------------------------------------------------------------------
insert into app_state (workspace_id, scope, key, value) values
  ('00000000-0000-0000-0000-000000000001', 'attendance_bridge', 'lateThresholdMin',   '10'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'attendance_bridge', 'earlyThresholdMin',  '10'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'attendance_bridge', 'weeklyLeverageMin',  '30'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'attendance_bridge', 'showWeekStatus',     'true'::jsonb)
on conflict (workspace_id, scope, key) do nothing;


-- ---------------------------------------------------------------------------
-- Payroll rules
-- Source: attendance.html `payRules`. PF and ESI are off — this company does
-- not operate them; the rates are present so switching one on needs no code.
-- `allLeaveUnpaid:false` means only an overdrawn balance is charged to salary.
-- `ot:true, otMult:1` pays work on days off at the plain hourly rate.
-- ---------------------------------------------------------------------------
insert into app_state (workspace_id, scope, key, value) values
  ('00000000-0000-0000-0000-000000000001', 'attendance_bridge', 'payRules', $j$
   {
     "allLeaveUnpaid": false,
     "_ruleMigrated": true,
     "pf": false,      "pfPct": 12,
     "esi": false,     "esiPct": 0.75,  "esiCap": 21000,
     "other": 0,       "otherLabel": "Other",
     "ot": true,       "otMult": 1
   }$j$::jsonb)
on conflict (workspace_id, scope, key) do nothing;


-- ---------------------------------------------------------------------------
-- Container defaults
-- Source: containers.html DEFAULT_SETTINGS. alertDays 5 is the arrival window
-- the tab badge counts against. hiddenCols is empty on purpose: a column that
-- starts hidden is a column nobody knows exists.
-- ---------------------------------------------------------------------------
insert into app_state (workspace_id, scope, key, value) values
  ('00000000-0000-0000-0000-000000000001', 'containers', 'settings', $j$
   {
     "alertDays": 5,
     "columnOrder": null,
     "hiddenCols": [],
     "knownCols": [],
     "estimateDates": true
   }$j$::jsonb)
on conflict (workspace_id, scope, key) do nothing;


-- ---------------------------------------------------------------------------
-- Company details shown on the salary slip letterhead.
-- Placeholders — replace with the real name and address, or set them in the
-- application, which writes to this same key.
-- ---------------------------------------------------------------------------
insert into app_state (workspace_id, scope, key, value) values
  ('00000000-0000-0000-0000-000000000001', 'attendance_bridge', 'companyInfo', $j$
   {
     "name": "Homeweavers",
     "addr": "",
     "logo": ""
   }$j$::jsonb)
on conflict (workspace_id, scope, key) do nothing;


-- ============================================================================
-- Deliberately NOT seeded
--
--   officialLeaves   holidays are specific to a year and a country; seeding
--                    guesses would put wrong dates in front of people
--   employees        comes from the punch file import
--   salaries         real money; must be entered, never defaulted
--   joinDates        payroll depends on these being right
--   slip PIN         '0000' is the code's fallback and is shown in the delete
--                    dialog; putting it in the database implies it is a secret
--   accounts         created through Supabase Auth, not inserted here
-- ============================================================================
