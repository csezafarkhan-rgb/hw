# Migration notes — browser storage to Supabase

Written by reading the application code. Where the code contradicted the brief,
the code is treated as the source of truth and the difference is called out.

**Nothing in the application has been changed.** IndexedDB, localStorage, the
dashboards, auth and the Vercel config are all untouched. This is the database
layer and its mapping, for validation before any code moves.

---

## Two corrections to the brief

### `att_fs` does not hold uploaded attendance files

It holds **one key, `dir`**, containing a `FileSystemDirectoryHandle` — the
folder chosen for auto-saving HD screenshots. From `attendance.html`:

> `// Directory handles can't live in localStorage, so keep the chosen folder handle in IndexedDB.`

A directory handle is a browser-local permission grant. It **cannot be migrated**
to Postgres or to Storage, and should not be. After migration each user
re-picks their folder once. No table is provided for it.

### `hw_bridge` is not "attendance configuration plus 28 shared settings"

It is **28 keys, all attendance**, and they are data rather than settings:
`overrides`, `halfDays`, `manualLeave`, `joinDates`, `salaries`, `lateExcuses`,
`earlyExcuses`, `leaveRequests`, `officialLeaves`, `payRules`, and so on. Three
are thresholds; the rest is the attendance record itself.

---

## Every store found, and where it lands

### IndexedDB

| Database | Store | Keys found in code | Lands in |
|---|---|---|---|
| `hw_bridge` | `kv` | 28 attendance keys (below) | `app_state`, scope `attendance_bridge` |
| `hw_workspace` | `st` | `users` | `app_users` + `auth.users` |
| `att_data` | `kv` | `customDataset` | `app_state`, scope `attendance_data` |
| `att_fs` | `kv` | `dir` | **not migrated** — see above |
| `hw_inventory` | `working` | `data`, `coll_alias`, `products_snapshot`, `portals`, `aliases`, edits, snaps | `app_state`, scope `inventory` |
| `hw_products` | `kv` | `channel_listings`, `collection_specs`, `spec_skus`, `hw_products_ui2_v5` | `app_state`, scope `products` |
| `hw_orders` | `kv` | `dataset`, `shipments`, `ship_hidden`, `nmdataset`, `shipstatus` | `app_state`, scope `orders` |
| `hw_containers` | `kv` | `list`, `settings`, plus one entry per slip blob | `app_state` scope `containers`; blobs to Storage + `files` |
| `hw_financial` | `kv` | `app`, `orders` | `app_state`, scope `financial` |
| `hw_console` | — | seen in a backup file, not in the source | **unresolved** — see assumptions |

The 28 `hw_bridge` keys: `customDataset`, `customShifts`, `dayShifts`,
`halfDays`, `manualLeave`, `empNames`, `joinDates`, `satPolicy`, `overrides`,
`shiftAssignments`, `visibleEmployees`, `employeeOrder`, `mispunchFlags`,
`manualRecords`, `lateExcuses`, `earlyExcuses`, `leaveRequests`,
`leaveDeductions`, `officialLeaves`, `showWeekStatus`, `earlyThresholdMin`,
`lateThresholdMin`, `weeklyLeverageMin`, `companyInfo`, `salaries`, `payRules`,
`authAccounts`, `viewRole`.

Note the collision: `customDataset` exists in **both** `hw_bridge` and
`att_data`. This is why `app_state` is keyed on `(scope, key)` and not on key
alone.

### localStorage

| Key | Dashboard | Lands in |
|---|---|---|
| `hw_users_v1` | shell | superseded by `app_users` — legacy migration path only |
| `hw_auth_v1` | shell | **never migrated** — a session, replaced by Supabase Auth |
| `attDashboard_*` | attendance | mirrors of the bridge keys; the bridge copy wins |
| `hw_att_snap_day` | attendance | device-local, not migrated |
| `hw_leave_hidden` | attendance | `app_state` / `workspace` |
| `hw_avail_v1`, `hw_avail_delta_v1`, `hw_products_snapshot_v1` | inventory | `app_state` / `inventory` |
| `hw_singles_only_v1`, `hw_hide_alias_v2`, `hw_hide_disc_v2`, `hw_prt_extfield`, `hw_prt_tol` | inventory | `app_state` / `workspace` (UI preferences) |
| `hw_trk_tpl`, `hw_nm_w`, `hw_nm_cols` | orders | `app_state` / `workspace` |
| `hw_slip_pin`, `hw_slip_pin_show` | containers | **decide** — see risks |
| `hw_ctr_imports` | containers | `import_log` |

### sessionStorage

Only `hw_auth_v1`, the sign-in session. Replaced by Supabase Auth; not migrated.

---

## What goes to Postgres, what goes to Storage

**Postgres** — everything except file bytes. Datasets stay as JSONB in
`app_state` with their existing shape untouched.

**Storage** (`files` bucket, private) — packing slip blobs from
`hw_containers`, and any future uploads. The `files` table records name, type,
size, owner and path.

Path layout, so the first segment can be checked by policy:

```
<workspace_id>/<scope>/<owner_key>/<uuid>-<filename>
```

---

## Fields needing transformation

| From | To | Note |
|---|---|---|
| `users[u].hash` | — | SHA-256, unsalted. **Not migrated.** Each user is recreated in Supabase Auth and sets a new password. |
| `users[u].tabs === '*'` | `tabs = '{*}'` | string sentinel becomes a one-element array; `tabsOf()` already expands it |
| `users[u].att` | `att_role`, `att_employee` | flattened out of the nested object |
| `users[u].sq` | — | security question and hashed answer; Supabase Auth has its own recovery. Not migrated. |
| `leaveRequests[]` | `leave_requests` rows | array to rows; `id` kept as `legacy_id`; `archived` (a timestamp string) becomes `archived_at` |
| `hw_att_audit[]` | `audit_log` rows | `at` is a JS epoch number → `to_timestamp(at/1000)` |
| slip `{key,name,type,size,at}` | `files` row + Storage object | `key` kept as `legacy_key` so container JSON can be rewritten after upload |
| `hw_ctr_imports[]` | `import_log` rows | `at` epoch → timestamptz |
| container `eta`, `exFactory`, `actualETD` | stay inside the JSONB list | ISO strings today; **not** promoted to columns, since the dashboard reads the whole list |

---

## Cannot be migrated automatically

1. **`att_fs` / `dir`** — a `FileSystemDirectoryHandle`. Browser-local by
   design. Each user re-picks their auto-backup folder.
2. **Passwords** — one-way hashes. Every user must be recreated in Supabase
   Auth with a new password.
3. **`hw_auth_v1`** — an active session. Everyone signs in again.
4. **Slip blobs, if taken from a JSON backup** — `JSON.stringify` turns a Blob
   into `{}`, so backups made before this was fixed contain slip *metadata*
   with no bytes. Those must come from a browser holding the live IndexedDB,
   not from an old backup file.
5. **`hw_console`** — appears in exported backups but no source writes it. Its
   contents are unknown; dump it before wiping anything.

---

## Recommended order

Each step leaves the workspace working.

| # | Step | Why here |
|---|---|---|
| 1 | Run `supabase_schema.sql`, create the bucket, create the first admin | nothing works without it |
| 2 | Dump every store to JSON from the browser holding the real data | the only copy; take it before anything else |
| 3 | Import `app_state` for **one** scope — `containers` is smallest | proves the mapping on 2 keys, not 4,000 |
| 4 | Move accounts to Supabase Auth | one login everywhere; unblocks per-user RLS testing |
| 5 | Upload slip blobs to Storage, populate `files`, rewrite the keys in the container JSON | must follow 3, since it edits that JSON |
| 6 | `attendance_bridge` + `attendance_data` | largest and most edited; do it when the pattern is proven |
| 7 | `inventory`, `products`, `orders` | bulk data, no behavioural surprises |
| 8 | `financial` | last; it has import/export already and is read-only in practice |
| 9 | `leave_requests` and `audit_log` out of JSONB into their tables | after the dashboards read from Supabase, not before |

Steps 1–3 are safe to do today without touching the application: write to
Supabase and keep reading from IndexedDB, then compare.

---

## Risks and compatibility concerns

**Financial is 9.6 MB in one value.** Loading it as a single `app_state` row on
every page view is slow and wasteful. Either split it by year into separate
keys, or leave that dashboard import-only. Postgres will accept the row; the
network is the problem.

**Two people editing the same dataset overwrite each other.** These are
whole-dataset writes: two admins on Attendance means the second save discards
the first, silently. Today this cannot happen because nobody shares data. It
becomes possible the moment this migration lands. Mitigation: compare
`updated_at` before writing, or move the hot keys to rows.

**The slip PIN is currently per-browser.** Moving `hw_slip_pin` to the database
makes it shared, which is probably intended — but it is displayed in the delete
dialog by default, so it protects against accident, not intent. Decide before
migrating, not after.

**`authAccounts` is a bridge key holding the old attendance-only accounts.** It
is dead once Supabase Auth is in place. Migrate it for reference or drop it;
do not let it become a second source of truth.

**The workspace works offline today.** That is a real property, not an
accident — attendance is marked on a factory floor. Keep a local cache and
write through it, or this migration makes the app worse on a bad connection.

**RLS must be on before real data lands.** The anon key is public. A table
added later without RLS is readable by anyone with that key.

---

## What I could not determine from the code available

The repository upload did not arrive; only `schema.proposed(2).sql` came
through. This analysis is based on the six dashboard sources and the shell from
the current build, which **is** the application code, but the following were
not visible:

1. **`server.js`, `config.js`, `package.json`** — the repo listing shows these
   exist. If `server.js` already proxies Supabase, or `config.js` holds a
   client already in use, parts of this schema may duplicate it.
2. **The existing `supabase_schema.sql`** — already run against the live
   project. This schema has **not** been reconciled with it. Do not run both.
3. **`SUPABASE_SETUP.md`** — may document decisions that contradict these.
4. **`hw_console`** — no source writes it; seen only in a backup listing.
5. **Whether the standalone dashboard files** in the repo root are live or
   superseded by the single-file build.

Send those five and I will reconcile rather than duplicate.
