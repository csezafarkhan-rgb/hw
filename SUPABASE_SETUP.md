# Cloud sync setup — Supabase (pilot: Containers tab)

This guide turns on **shared real-time database** for the Containers tab.
Anyone opening your Vercel URL will see the same live container data, and
updates by one person appear in everyone else's browser within a second.

**Time required:** ~10 minutes, one time.

**What stays the same:** the workspace login gate, all other tabs, all
existing UI. Only the Containers tab's storage changes.

**Fallback:** if you skip this, or if Supabase is unreachable, Containers
falls back to browser-local IndexedDB automatically.

---

## Step 1 — Create a free Supabase project (3 min)

1. Go to <https://supabase.com> → **Sign up** (GitHub sign-in is easiest).
2. Click **New Project**.
3. Fill in:
   - **Name:** `homeweavers` (or anything).
   - **Database password:** click **Generate a password** — save it in a
     password manager (you won't need it for this setup but you may want
     it later).
   - **Region:** pick the closest to Delhi (Mumbai, Singapore, Frankfurt).
   - **Pricing plan:** Free.
4. Click **Create new project**. Wait ~2 minutes while it provisions.

## Step 2 — Run the schema SQL (1 min)

1. In your new project, open **SQL Editor** (sidebar → `<>` icon).
2. Click **+ New query**.
3. Open the file `_build/supabase_schema.sql` in this repo.
4. Copy the entire contents → paste into the SQL Editor.
5. Click **Run** (or `Ctrl/Cmd + Enter`).
6. You should see `Success. No rows returned` — the tables and policies
   are set up.

## Step 3 — Copy your project URL and anon key (1 min)

1. In the Supabase sidebar → **Project Settings** (gear icon) → **API**.
2. Copy two values:
   - **Project URL** (looks like `https://abcxyz.supabase.co`)
   - **anon public** key (a long string starting with `eyJ…`)

**Do not** copy the `service_role` key — it must stay secret.
The `anon` key is safe to embed in the client because Row Level Security
policies control what it can do.

## Step 4 — Paste them into config.js (1 min)

Open `_build/config.js` in your editor. Fill in the two blanks:

```js
window.HW_CONFIG = {
  SUPABASE_URL:      'https://abcxyz.supabase.co',       // ← paste your URL
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIs...',          // ← paste your anon key

  CLOUD_TABS: {
    containers: true,       // pilot enabled
    // ... others stay false
  },
  // ...
};
```

Save the file.

## Step 5 — Rebuild and deploy (2 min)

Locally:

```bash
node _build/build.js         # (or: python3 _build/build.py)
```

Commit and push:

```bash
git add _build/config.js Homeweavers_Workspace.html Homeweavers_Containers.html
git commit -m "enable Supabase cloud sync for Containers"
git push
```

Vercel auto-deploys within ~1 minute.

## Step 6 — Try it out (2 min)

1. Open your Vercel URL — <https://hw-lime-one.vercel.app> — in one browser.
   Sign in.
2. Look for a small badge next to the container count in the toolbar:
   - 🟢 `● live · N synced` = cloud sync working
   - 🟠 `● offline (local cache)` = Supabase couldn't be reached; check
     the URL/key
   - ⚪ `● browser-local` = config still blank, using IndexedDB
3. Open the **same URL in a different browser** (e.g. Firefox alongside
   Chrome, or a phone).
4. In one browser, add a container or edit one. **Watch the other browser
   update within ~1 second — no refresh needed.**

## Step 7 — Load your data

Your existing container data lives in your local browser's IndexedDB.
Move it into Supabase by importing your Excel again:

1. On the live Vercel site, sign in as admin.
2. Go to 🚢 Containers.
3. Click **📥 Import Excel** and select your `Container_Details_….xlsx`.
4. Confirm the preview → click **Apply changes**.
5. The 111 containers land in Supabase — everyone sees them.

Alternatively you can use the 💾 Backup export tool on your local browser
to grab all your data as JSON, then paste the container records into a
one-off SQL import — but re-importing the Excel is easier.

---

## Troubleshooting

**Badge shows "offline (local cache)"**
Check `_build/config.js` — URL and key correct? Rebuild + redeploy.
Open browser DevTools console — Supabase errors log there.

**"CHANNEL_ERROR" in console**
Make sure the two `alter publication supabase_realtime add table …` lines
at the end of the SQL ran. Re-run those two lines if not.

**"row-level security policy violated"**
Re-run the RLS `create policy` statements from the SQL file. All four
tables need the `_all` policy present.

**Data not syncing between browsers**
1. Verify badge shows 🟢 `live` in BOTH browsers.
2. Verify Supabase Table Editor shows the row (Supabase dashboard →
   Table Editor → containers).
3. In Supabase → Database → Replication, confirm both tables have
   real-time enabled.

**I want to turn it back off**
Set `CLOUD_TABS.containers: false` in `_build/config.js`, rebuild,
redeploy. Data stays in Supabase (in case you want it back), the tab
just reads from local IndexedDB again.

---

## Cost & scale

Free tier (Supabase):
- 500 MB database — enough for tens of thousands of containers
- 2 GB egress / month — enough for a small team using the app daily
- Unlimited API requests
- Real-time on all tables

You'll only start paying if the data or traffic grows past these limits,
and Supabase warns you well before that.

---

## Next steps (when you're ready)

Once Containers works well for a week or two, we can migrate the other
tabs one at a time using the same pattern:

- 🗓️ **Attendance** — good next candidate (simple schema, high shared value)
- 📦 **Live Inventory** — needs some thought about how snapshots merge
- 🏷️ **Products** — biggest schema, save for last
- 🛒 **Orders**, 📊 **Financial** — moderate complexity

Auth can also move to Supabase Auth so each user has a real account and
you can track who changed what.
