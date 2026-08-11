# Homeweavers Workspace

Operations workspace: attendance and payroll, live inventory, e-commerce
orders, container tracking, product catalogue and financial reporting, behind
one login.

**Live:** https://hw-lime-one.vercel.app · pushes to `main` redeploy on Vercel

---

## A note on the existing repository

This folder is a **clean rebuild**. If you are merging it into the repository
that already exists, two things there need deciding first:

**Duplicate dashboard files.** The existing repo has
`Financial_Performance_Dashboard.html`, `Homeweavers_Containers.html`,
`Homeweavers_Orders.html`, `Homeweavers_Products.html`,
`Inventory_Live_Dashboard.html` and `attendance-dashboard.html` in the root,
alongside the built workspace. If they are older standalone copies, editing one
changes nothing on the live site and the fault is invisible. Delete them, or
move them to `legacy/` with a note.

**Two schemas.** `supabase_schema.sql` in the existing repo has been run.
`schema.proposed.sql` here is a design written from the app's storage layout
*before that repo was seen*. **Do not run it against a database that already
has tables.** Compare the two and keep one.

Also present there and not described here, because they have not been
reviewed: `config.js`, `server.js`, `package.json`, `SUPABASE_SETUP.md`. The
presence of `server.js` means the live site is not purely static, so anything
below assuming "no backend" should be checked against it.

---

## How the workspace is built

Source is split so one dashboard can change without touching the others:

```
shell.template.html        frame: login, navigation, storage bridge, backup
dashboards/
  attendance.html          attendance, leave, payroll
  inventory.html           live inventory + Data Manager
  orders.html              e-commerce orders
  containers.html          container tracking
  products.html            catalogue, photography, pricing
  financial.html           sales reporting
mobile_block.py            responsive layer, injected into every dashboard
build.py                   assembles the single file
```

Build:

```bash
python3 build.py          # → index.html
```

Each dashboard is base64-encoded into the shell and runs in its own frame.
The responsive layer is injected at build time, so it exists once rather than
six times.

**After any change, check every dashboard still parses:**

```bash
node -e "
const fs=require('fs');
const all=fs.readFileSync('index.html','utf8');
['inventory','products','orders','financial','attendance','containers'].forEach(n=>{
  const h=Buffer.from(new RegExp('id=\"src-'+n+'\">\\\\n([\\\\s\\\\S]*?)\\\\n</script>').exec(all)[1],'base64').toString('utf8');
  let e=0;[...h.matchAll(/<script(?![^>]*type=\"(text\/plain|application\/json)\")[^>]*>([\s\S]*?)<\/script>/g)]
    .forEach(x=>{try{new Function(x[2]);}catch(err){e++;}});
  console.log(n, e ? 'SYNTAX ERROR' : 'clean');
});
"
```

Passing this is necessary, not sufficient — a valid file can still throw on
load and leave a blank page. Open each dashboard you touched.

---

## Deploying

```bash
git add index.html
git commit -m "what changed"
git push
```

**Hard-refresh afterwards** (`Ctrl/Cmd + Shift + R`). The file is large and
aggressively cached; without it you are looking at the previous build.

Deploying does not touch anyone's data.

---

## The dashboards

### Attendance
Seven tabs: Attendance Record, Dashboard, Leave Record, Requests, Payroll,
Changes, Official Leaves.

- Imports the biometric punch file; marks lateness, early departures, mispunches
- Per-person shifts, Saturday arrangements, per-date overrides
- Part-day leave: **HD** half · **TD** three-quarter · **SD** short
- Excused lateness and early departures — recorded, not counted against the person
- Leave accrues from each employee's **joining date**, pro-rated by days
- Payroll: per-day rate over calendar days, unpaid leave, overtime for work on
  days off, optional PF/ESI, printable salary slips
- **Changes** logs every mark with who made it and what it replaced, and undoes any
- Employees see their own calendar, balance, weekly hours and the holiday list

### Live Inventory + Data Manager
Stock levels, availability, product mapping. Volume and area come from the
Specs sheet in Products.

### Ecom Orders
Order and shipment files, backorders, editable tracking URLs.

### Containers
Arrival tracking with a packing-slip check. The tab badge reads `2/3-10` —
slips ready, of containers arriving, within the alert window. Deleting a slip
needs a PIN.

### Products
Catalogue, photography, pricing, and the Specs sheet feeding Inventory.

### Financial
Sales and order reporting. Has **Export data** and **Import data**; its figures
are still embedded in the build (9.6 MB) pending the database move.

---

## Accounts and access

One login for the project — Attendance no longer asks separately.

Per account an admin sets which dashboards may be opened, what is visible
inside Attendance (full access or own record only), and the person's name in
the attendance data.

Default admin is `admin` / `homeweavers123`. **Change it.**

> Whether this login or Supabase Auth is authoritative depends on what
> `config.js` and `server.js` do — see the tidying note above.

---

## Backups

**Project backup** — 💾 in the navigation, admins only. One file with every
dashboard's data, the accounts and the workspace settings. The panel states
what it holds before download; the restore reads the data back to verify it
landed. **Clear all data** lives here too and refuses to run until a backup has
been downloaded in the same session.

**Attendance** — Export all data (JSON), Export to Excel (16 sheets), and an
automatic daily snapshot on the first HD screenshot or Excel export each day.
Restore accepts JSON, `.xlsx` or `.csv`, identified by file contents rather
than extension.

**Keep backup files out of the repository** — staff names, salaries and
passwords in plain text. Add to `.gitignore`:

```
*_Backup_*.json
*.xlsx
```

---

## Where data lives

In the browser: eight IndexedDB databases plus a set of localStorage keys.

| Database | Holds |
|---|---|
| `hw_bridge` | attendance (28 keys), shared settings |
| `hw_workspace` | user accounts |
| `hw_inventory` | inventory and Data Manager |
| `hw_products` | catalogue, specs, pricing |
| `hw_orders` | orders and shipments |
| `hw_containers` | containers and packing slips |
| `hw_financial` | sales data |
| `att_data`, `att_fs` | attendance records and uploaded files |

**This is why a second browser shows an empty workspace.** Hosting does not
change it; a database does.

Containers already syncs through Supabase — that is the pattern the rest should
follow.

---

## Known limits

- **Data does not travel between browsers or devices.** Backup and restore is the only bridge.
- **Financial ships 9.6 MB inside the build.**
- **Concurrent edits**: last write wins, silently.
- **Passwords are SHA-256, unsalted.** Enough to keep colleagues out of each
  other's views; not real security. Do not reuse an important password.
- **The workspace runs offline** — a genuine strength worth keeping when the
  database arrives. Keep a local cache.

---

## What is next

Move storage to Supabase so an admin's change reaches every login.

**First:** reconcile `supabase_schema.sql` with `schema.proposed.sql`, and
establish what `server.js` and `config.js` already do. Everything else depends
on that answer.

Then, each stage leaving the workspace usable:

1. **Accounts** → one sign-in everywhere
2. **Storage layer** → read/write against the database, with a local cache
3. **Attendance** → most edited, most people
4. **Containers** → already speaks Supabase; mostly re-pointing it
5. **Orders**, then **Inventory + Products**
6. **Financial** → last; strip the embedded data once import is proven

**Before starting: take a project backup and keep it somewhere safe.** It is
the only copy of the data, and step 3 is where it gets loaded into the database.
