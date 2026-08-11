/* Homeweavers Supabase client/bridge.
 * Loaded by the top-level workspace. Dashboard iframes communicate with this
 * object through the existing postMessage IndexedDB bridge, so their UI/data
 * shapes do not need to be rewritten.
 */
(function () {
  'use strict';
  var C = window.HW_SUPABASE_CONFIG || {};
  var client = null;
  var configured = !!(C.url && C.anonKey &&
    C.url.indexOf('YOUR-PROJECT') < 0 &&
    C.anonKey.indexOf('YOUR_') < 0);

  function init() {
    if (!configured || client) return Promise.resolve(client);
    if (!window.supabase || !window.supabase.createClient) {
      return Promise.reject(new Error('Supabase client library is unavailable.'));
    }
    client = window.supabase.createClient(C.url, C.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return Promise.resolve(client);
  }

  function dbScope(db) {
    return ({
      hw_bridge: 'attendance_bridge',
      att_data: 'attendance_data',
      hw_inventory: 'inventory',
      hw_products: 'products',
      hw_orders: 'orders',
      hw_containers: 'containers',
      hw_financial: 'financial'
    })[db] || null;
  }

  async function requireClient() {
    await init();
    if (!client) throw new Error('Supabase is not configured.');
    var s = await client.auth.getSession();
    if (!s.data || !s.data.session) throw new Error('No Supabase session. Sign in to Supabase first.');
    return client;
  }

  async function readDb(db) {
    var scope = dbScope(db);
    if (!scope) return null;
    var c = await requireClient();
    var r = await c.from('app_state')
      .select('scope,key,value,updated_at')
      .eq('workspace_id', C.workspaceId)
      .eq('scope', scope);
    if (r.error) throw r.error;
    var out = { kv: {} };
    (r.data || []).forEach(function (row) { out.kv[row.key] = row.value; });
    return out;
  }

  async function put(db, store, key, value) {
    var scope = dbScope(db);
    if (!scope) return false;
    var c = await requireClient();
    var r = await c.from('app_state').upsert({
      workspace_id: C.workspaceId,
      scope: scope,
      key: String(key),
      value: value
    }, { onConflict: 'workspace_id,scope,key' });
    if (r.error) throw r.error;
    return true;
  }

  async function del(db, store, key) {
    var scope = dbScope(db);
    if (!scope) return false;
    var c = await requireClient();
    var r = await c.from('app_state').delete()
      .eq('workspace_id', C.workspaceId)
      .eq('scope', scope)
      .eq('key', String(key));
    if (r.error) throw r.error;
    return true;
  }

  async function clear(db, store) {
    var scope = dbScope(db);
    if (!scope) return false;
    var c = await requireClient();
    var r = await c.from('app_state').delete()
      .eq('workspace_id', C.workspaceId)
      .eq('scope', scope);
    if (r.error) throw r.error;
    return true;
  }

  async function session() {
    if (!configured) return null;
    await init();
    if (!client) return null;
    var r = await client.auth.getSession();
    return r.data && r.data.session ? r.data.session : null;
  }

  async function signIn(email, password) {
    await init();
    if (!client) throw new Error('Supabase is not configured.');
    var r = await client.auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw r.error;
    return r.data;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  async function profile() {
    var s = await session();
    if (!s || !s.user) return null;
    var c = await requireClient();
    var r = await c.from('app_users')
      .select('id,workspace_id,username,role,tabs,att_role,att_employee')
      .eq('id', s.user.id).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  async function status() {
    var s = await session();
    return { configured: configured, authenticated: !!s, email: s && s.user ? s.user.email : null };
  }

  async function migrateLocalDb(db, localData) {
    var scope = dbScope(db);
    if (!scope) throw new Error('No cloud mapping for ' + db);
    await requireClient();
    var rows = [];
    var storeNames = Object.keys(localData || {});
    storeNames.forEach(function (store) {
      Object.keys(localData[store] || {}).forEach(function (key) {
        rows.push({
          workspace_id: C.workspaceId,
          scope: scope,
          key: String(key),
          value: localData[store][key]
        });
      });
    });
    if (!rows.length) return { rows: 0 };
    var c = client;
    for (var i = 0; i < rows.length; i += 200) {
      var batch = rows.slice(i, i + 200);
      var r = await c.from('app_state').upsert(batch, { onConflict: 'workspace_id,scope,key' });
      if (r.error) throw r.error;
    }
    return { rows: rows.length };
  }

  window.HWCloud = {
    configured: configured,
    dbScope: dbScope,
    init: init,
    session: session,
    status: status,
    profile: profile,
    signIn: signIn,
    signOut: signOut,
    readDb: readDb,
    put: put,
    del: del,
    clear: clear,
    migrateLocalDb: migrateLocalDb,
    get client() { return client; }
  };
})();
