# Taking Homeweavers Workspace live

GitHub → Vercel → Supabase, and the change from browser storage to a real
database.

---

## What is actually changing

Today the workspace is one HTML file with no server. Everything lives in the
browser: eight IndexedDB databases plus a set of localStorage keys. That is
why opening the project in a second browser shows an empty workspace — the
data was never anywhere else.

Hosting alone does not fix this. Putting the file on Vercel gives everyone the
same *app*; Supabase is what gives them the same *data*.

The Containers dashboard already reads from Supabase, so the pattern exists in
the project. This extends it to the rest.

---

## 1. Supabase

**Create the project** at supabase.com. Region closest to Delhi is
`ap-south-1` (Mumbai) — worth choosing, since every read pays the round trip.

**Run the schema.** Open SQL Editor, paste `schema.sql`, run it top to bottom.

**Create the storage bucket.** Storage → New bucket → name it `files`, leave it
**private**. Packing slips and photos go here; the database only records what
they are.

**Create the first admin.** Authentication → Users → Add user. Then copy that
user's UUID and run:

```sql
insert into app_users (id, workspace_id, username, role, tabs, att_role)
values ('PASTE-UUID-HERE',
        '00000000-0000-0000-0000-000000000001',
        'admin', 'admin', '{*}', 'admin');
```

**Collect two values** from Settings → API:

| Value | Where it goes |
|---|---|
| Project URL | into the app |
| `anon` public key | into the app |

The anon key is meant to be public — it ends up in the page source either way.
Row Level Security is what actually protects the data, which is why the schema
turns it on for every table. **Never put the `service_role` key in the app.**

---

## 2. GitHub

```bash
cd your-project-folder
git init
git add .
git commit -m "Homeweavers Workspace"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/homeweavers.git
git push -u origin main
```

Suggested layout — keeping the build split you already have:

```
├── Homeweavers_Workspace.html   ← the built file Vercel serves
├── build.py                     ← assembles it
├── shell.template.html
├── dashboards/
│   ├── attendance.html
│   ├── inventory.html
│   ├── orders.html
│   ├── containers.html
│   ├── products.html
│   └── financial.html
├── mobile_block.py
├── schema.sql
└── DEPLOYMENT.md
```

Add a `.gitignore`:

```
.DS_Store
*.xlsx
*_Backup_*.json
node_modules/
```

Backups are excluded on purpose. They contain staff names, salaries and
passwords in plain text, and a public repository is not the place for them.

---

## 3. Vercel

1. vercel.com → **Add New → Project** → import the GitHub repo
2. Framework preset: **Other**
3. Build command: `python3 build.py` — or leave empty and commit the built file
4. Output directory: leave empty (repository root)

Add `vercel.json` so the root serves the workspace:

```json
{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/", "destination": "/Homeweavers_Workspace.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

Every push to `main` redeploys. A pull request gets its own preview URL, which
is a good way to try a dashboard change before it reaches anyone.

---

## 4. Connecting the app to Supabase

Add this near the top of `shell.template.html`, before the dashboard frames are
built:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  window.HW_SUPABASE = supabase.createClient(
    'https://YOUR-PROJECT.supabase.co',
    'YOUR-ANON-KEY'
  );
</script>
```

Then replace the storage layer rather than the dashboards. Each dashboard reads
and writes through a small number of functions; point those at Supabase and the
dashboards themselves need no changes:

```js
// read one key
async function stateGet(dashboard, key){
  const { data, error } = await window.HW_SUPABASE
    .from('app_state').select('value')
    .eq('workspace_id', WS).eq('dashboard', dashboard).eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

// write one key
async function stateSet(dashboard, key, value){
  const { error } = await window.HW_SUPABASE
    .from('app_state')
    .upsert({ workspace_id: WS, dashboard, key, value },
            { onConflict: 'workspace_id,dashboard,key' });
  if (error) throw error;
}
```

**Keep a local cache.** Write to IndexedDB as well as Supabase and read from it
first. Otherwise the workspace stops working the moment the network does, and
a 2 MB inventory blob is a slow thing to fetch on every page load.

---

## 5. Order of work

Do this one dashboard at a time. Each is independent, and a half-migrated
workspace still works.

| Order | Dashboard | Why here |
|---|---|---|
| 1 | **Accounts** | one login across browsers is the whole point; nothing else matters until this is shared |
| 2 | **Attendance** | most edited, most people, most valuable to share |
| 3 | **Containers** | already speaks Supabase — mostly moving it to these tables |
| 4 | **Orders** | small dataset, quick |
| 5 | **Inventory + Products** | largest payloads; needs the local cache to be right first |
| 6 | **Financial** | now has import/export, so it can wait |

---

## 6. Moving the existing data across

Nothing is lost in the switch, but the order matters.

1. In the browser that holds the real data, open **💾 Backup → Download backup**
2. Check the record count it reports before trusting the file
3. Deploy the Supabase-connected build
4. Sign in as the admin created above
5. Restore the backup — it writes through the new storage layer into Supabase

Take the backup **before** deploying the new build. It is the only copy.

---

## 7. Things that will bite

**The anon key is public.** That is by design. RLS is the boundary — if you add
a table later, enable RLS on it or it is readable by anyone with the key.

**Files are not rows.** Packing slips are Blobs. They go to Storage, not into a
JSONB column. There is a `files` table for their metadata.

**Blobs do not survive JSON.** `JSON.stringify` turns a Blob into `{}` without
complaint. Anything that serialises files must encode them first — the backup
in the app now does; new code will need to as well.

**Two tabs still conflict.** Supabase removes the *storage* conflict but not
the logical one: two people editing the same day of attendance, last write
wins. If that matters, add an `updated_at` check on write.

**Financial is 9.6 MB.** Do not put it in `app_state` as one row and fetch it
on every load. Either split it by year, or leave it as an import-only
dashboard.

---

## 8. Costs

| | Free tier | When it stops being enough |
|---|---|---|
| Vercel | Hobby: plenty for one workspace | commercial use technically needs Pro |
| Supabase | 500 MB database, 1 GB storage | the Financial dataset alone is 9.6 MB — fine, but packing slips add up |
| GitHub | unlimited private repos | — |

A workspace this size runs comfortably on free tiers. Storage is the first
thing to grow, since every uploaded slip stays.
