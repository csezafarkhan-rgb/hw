/* ============================================================
   Homeweavers Workspace — Configuration
   ------------------------------------------------------------
   Paste your Supabase project URL and anon key here to enable
   the shared cloud database + real-time sync for the Containers
   tab. Leave blank and the tab falls back to browser-local
   IndexedDB (the original behaviour).

   HOW TO GET THESE VALUES
   -----------------------
   1. Create a free account at https://supabase.com
   2. Create a new project (pick any region close to you).
   3. Wait ~2 min for it to provision.
   4. In the project sidebar, open  Project Settings → API.
   5. Copy "Project URL"          → SUPABASE_URL below
   6. Copy the "anon public" key   → SUPABASE_ANON_KEY below
      (NOT the service_role key — that must stay secret.)
   7. Run the SQL in _build/supabase_schema.sql once
      (Supabase → SQL Editor → paste → Run).
   8. Rebuild:  node _build/build.js  (or python3 _build/build.py)
   9. Redeploy: push to GitHub, Vercel auto-deploys.

   Anyone opening your Vercel URL after step 9 will see the
   same live container data.
============================================================ */

window.HW_CONFIG = {
  /* --- Supabase (leave blank to disable cloud sync) --- */
  SUPABASE_URL: '',              // e.g. 'https://abcxyz.supabase.co'
  SUPABASE_ANON_KEY: '',         // e.g. 'eyJhbGciOi...'

  /* --- Which tabs use Supabase when configured --- */
  CLOUD_TABS: {
    containers: true,            // ← pilot: containers first
    /* Once containers is proven, flip these to true one by one
       as we migrate them. Until then they stay browser-local. */
    inventory:  false,
    products:   false,
    orders:     false,
    financial:  false,
    attendance: false,
    users:      false,           // auth stays browser-local for now
  },

  /* --- Real-time subscription settings --- */
  REALTIME: {
    enabled: true,               // set false to poll every 30s instead
    reconnectMs: 5000,           // delay before reconnect after network drop
  },
};
