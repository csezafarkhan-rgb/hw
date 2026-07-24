/* ============ Homeweavers Workspace — login & user management ============
   Users live INSIDE the app (localStorage key hw_users_v1) — create users,
   assign dashboards, and change passwords from the UI. No rebuild needed.
   First run seeds a default admin:  admin / homeweavers123  (change it!)
   Console helper: hwHash('password') prints a SHA-256 hash.
========================================================================== */
var TABS = [
  { id:'inventory',  label:'\uD83D\uDCE6 Live Inventory' },
  { id:'products',   label:'\uD83C\uDFF7\uFE0F Products' },
  { id:'orders',     label:'\uD83D\uDED2 Orders' },
  { id:'financial',  label:'\uD83D\uDCCA Financial' },
  { id:'attendance', label:'\uD83D\uDDD3\uFE0F Attendance' },
  { id:'datamgr',    label:'\uD83D\uDDC4\uFE0F Data Manager' },
  { id:'containers', label:'\uD83D\uDEA2 Containers' }
];
var USERS_KEY = 'hw_users_v1';
var AUTH_KEY = 'hw_auth_v1';
var REMEMBER_DAYS = 30;
var DEFAULT_ADMIN_HASH = 'be5a5b2ea8b4b54ba04422858e0a6dfcb7b2379b1f6e0107ff273499c8aaaa90'; /* homeweavers123 */

/* --- compact SHA-256 (pure JS, no secure-context requirement) --- */
function sha256(ascii){
  function rr(v, c){ return (v >>> c) | (v << (32 - c)); }
  var mathPow = Math.pow, maxWord = mathPow(2, 32), result = '';
  var words = [], asciiBitLength = ascii.length * 8;
  var hash = sha256.h = sha256.h || [];
  var k = sha256.k = sha256.k || [];
  var primeCounter = k.length;
  var isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++){
    if (!isComposite[candidate]){
      for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++){
    var j = ascii.charCodeAt(i);
    if (j >> 8) return ''; // ASCII only — utf8-encode first
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = (asciiBitLength);
  for (j = 0; j < words.length;){
    var w = words.slice(j, j += 16);
    var oldHash = hash.slice(0, 8);
    for (i = 0; i < 64; i++){
      var w15 = w[i - 15], w2 = w[i - 2];
      var a = hash[0], e = hash[4];
      var temp1 = hash[7]
        + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))
          ) | 0);
      var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++){
    for (j = 3; j + 1; j--){
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
}
function utf8(s){ try { return unescape(encodeURIComponent(s)); } catch(e){ return s; } }
function hwHash(pw){ var h = sha256(utf8(String(pw))); console.log('SHA-256:', h); return h; }
window.hwHash = hwHash;


/* ---------------- user store ---------------- */
/* ---- Storage: IndexedDB (large quota) + in-memory cache for sync reads ---- */
var IDB_NAME = 'hw_workspace', IDB_STORE = 'kv', IDB_KEY = 'users';
var _idb = null, _usersCache = null;
var STORAGE_ERR = 'Could not save. Your browser is refusing writes \u2014 try clearing site data or use a different browser.';

function openIDB(){
  if (_idb) return Promise.resolve(_idb);
  return new Promise(function(res, rej){
    var req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = function(){ _idb = req.result; res(_idb); };
    req.onerror   = function(){ rej(req.error); };
  });
}
function idbGet(key){
  return openIDB().then(function(db){
    return new Promise(function(res, rej){
      var tx = db.transaction(IDB_STORE, 'readonly');
      var rq = tx.objectStore(IDB_STORE).get(key);
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror   = function(){ rej(rq.error); };
    });
  });
}
function idbPut(key, val){
  return openIDB().then(function(db){
    return new Promise(function(res, rej){
      var tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = function(){ res(true); };
      tx.onerror    = function(){ rej(tx.error); };
      tx.onabort    = function(){ rej(tx.error); };
    });
  });
}

function seedUsers(){
  return { v:1, users: { 'admin': { hash: DEFAULT_ADMIN_HASH, role:'admin', tabs:'*', created: Date.now() } } };
}
function loadUsers(){ return _usersCache; }
/* Return a deep clone so callers can mutate freely without affecting the cached state
   until saveUsers commits. */
function getDB(){
  if (!_usersCache) _usersCache = seedUsers();
  return JSON.parse(JSON.stringify(_usersCache));
}

/* Persist to IDB. Only commit to the in-memory cache on success — on failure the
   caller's mutated object is discarded, so the app sees the pre-save state. */
function saveUsers(db){
  return idbPut(IDB_KEY, db).then(function(){
    _usersCache = db;
    return true;
  }, function(e){
    try { console.error('hw saveUsers failed:', e); } catch(_){}
    return false;
  });
}

function hydrateUsers(){
  return idbGet(IDB_KEY).then(function(fromIdb){
    if (fromIdb && fromIdb.users && Object.keys(fromIdb.users).length){
      _usersCache = fromIdb; return _usersCache;
    }
    /* migrate legacy localStorage users, then free that quota */
    try {
      var raw = localStorage.getItem(USERS_KEY);
      if (raw){
        var o = JSON.parse(raw);
        if (o && o.users && Object.keys(o.users).length){
          _usersCache = o;
          return idbPut(IDB_KEY, o).then(function(){
            try { localStorage.removeItem(USERS_KEY); } catch(_){}
            return _usersCache;
          }, function(){ return _usersCache; });
        }
      }
    } catch(_){}
    _usersCache = seedUsers();
    return idbPut(IDB_KEY, _usersCache).then(function(){ return _usersCache; }, function(){ return _usersCache; });
  }, function(){ _usersCache = seedUsers(); return _usersCache; });
}
function allTabIds(){ return TABS.map(function(t){ return t.id; }); }
function tabsOf(rec){
  if (!rec) return [];
  if (rec.role === 'admin' || rec.tabs === '*') return allTabIds();
  return (rec.tabs || []).filter(function(id){ return allTabIds().indexOf(id) >= 0; });
}
function adminCount(db){
  var n = 0;
  for (var u in db.users) if (db.users[u].role === 'admin') n++;
  return n;
}
function verifyPw(rec, pw){
  if (!rec || !rec.hash) return false;
  return sha256(utf8(pw)) === rec.hash || sha256(utf8(String(pw).trim())) === rec.hash;
}
function validUname(u){ return /^[a-z0-9._-]{2,24}$/.test(u); }
function normAns(s){ return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function genKey(){
  var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', out = [], i, buf = null;
  try { buf = new Uint32Array(12); crypto.getRandomValues(buf); } catch(e){}
  for (i = 0; i < 12; i++) out.push(A.charAt(buf ? buf[i] % A.length : Math.floor(Math.random() * A.length)));
  return out.slice(0,4).join('') + '-' + out.slice(4,8).join('') + '-' + out.slice(8,12).join('');
}
function genPassword(){
  /* memorable strong password: adjective-noun-#### */
  var adj  = ['brave','shiny','sunny','calm','quick','bright','lucky','silver','happy','swift','bold','clever','cosmic','mystic','crimson','golden'];
  var noun = ['tiger','falcon','river','mango','panda','comet','forest','summit','harbor','sparrow','lotus','harvest','arrow','oasis','dragon','planet'];
  function pick(a){
    var buf = null; try { buf = new Uint32Array(1); crypto.getRandomValues(buf); } catch(e){}
    var n = buf ? buf[0] : Math.floor(Math.random() * 0xffffffff);
    return a[n % a.length];
  }
  var n = null; try { var b = new Uint16Array(1); crypto.getRandomValues(b); n = b[0] % 10000; } catch(e){ n = Math.floor(Math.random()*10000); }
  var num = String(n); while (num.length < 4) num = '0' + num;
  return pick(adj) + '-' + pick(noun) + '-' + num;
}
function pwWrap(input, hint){
  /* Wrap an input in an um-pwwrap with EYE (show/hide) + DICE (generate) buttons. */
  var wrap = document.createElement('div');
  wrap.className = 'um-pwwrap' + (hint === 'add' ? ' um-pwwrap-add' : '');
  wrap.appendChild(input);
  var eye = document.createElement('button');
  eye.type = 'button'; eye.className = 'um-eye'; eye.tabIndex = -1;
  eye.setAttribute('aria-label', 'Show password'); eye.textContent = '👁';
  eye.addEventListener('click', function(){
    var showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    eye.classList.toggle('on', !showing);
    eye.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    try { input.focus(); } catch(e){}
  });
  var dice = document.createElement('button');
  dice.type = 'button'; dice.className = 'um-dice'; dice.tabIndex = -1;
  dice.setAttribute('aria-label', 'Generate strong password');
  dice.title = 'Generate a strong password';
  dice.textContent = '🎲';
  dice.addEventListener('click', function(){
    input.type = 'text';
    input.value = genPassword();
    eye.classList.add('on');
    eye.setAttribute('aria-label', 'Hide password');
    try { input.focus(); input.select && input.select(); } catch(e){}
  });
  wrap.appendChild(eye); wrap.appendChild(dice);
  return wrap;
}

/* ---------------- auth session ---------------- */
function readAuth(){
  var raw = null;
  try { raw = sessionStorage.getItem(AUTH_KEY); } catch(e){}
  if (!raw){ try { raw = localStorage.getItem(AUTH_KEY); } catch(e){} }
  if (!raw) return null;
  try {
    var o = JSON.parse(raw);
    if (!o || !o.u) return null;
    if (o.exp && Date.now() > o.exp) return null;
    if (!getDB().users[o.u]) return null;                 // user deleted → invalid
    return o;
  } catch(e){ return null; }
}
function saveAuth(user, remember){
  var o = { u: user, t: Date.now() };
  try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(o)); } catch(e){}
  if (remember){
    o.exp = Date.now() + REMEMBER_DAYS * 864e5;
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(o)); } catch(e){}
  }
}
function clearAuth(){
  try { sessionStorage.removeItem(AUTH_KEY); } catch(e){}
  try { localStorage.removeItem(AUTH_KEY); } catch(e){}
}

/* ---------------- tiny DOM helper ---------------- */
function h(tag, attrs, kids){
  var el = document.createElement(tag);
  if (attrs) for (var k in attrs){
    if (k === 'text') el.textContent = attrs[k];
    else if (k === 'html') el.innerHTML = attrs[k];
    else if (k.slice(0,2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'checked' || k === 'disabled' || k === 'selected') { if (attrs[k]) el.setAttribute(k, k); el[k] = !!attrs[k]; }
    else el.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(function(c){ if (c) el.appendChild(c); });
  return el;
}

/* ================= main ================= */
function initLoginGate(startWorkspace){
  hydrateUsers().then(function(){ _initLoginGateReal(startWorkspace); }, function(){ _initLoginGateReal(startWorkspace); });
}
function _initLoginGateReal(startWorkspace){
  var gate = document.getElementById('loginGate');
  var form = document.getElementById('lgForm');
  var uEl = document.getElementById('lgUser');
  var pEl = document.getElementById('lgPass');
  var rEl = document.getElementById('lgRemember');
  var errEl = document.getElementById('lgErr');
  var okEl = document.getElementById('lgOk');
  var btn = document.getElementById('lgBtn');
  var who = document.getElementById('whoami');
  var outBtn = document.getElementById('logoutBtn');
  var usersBtn = document.getElementById('usersBtn');
  var backupBtn = document.getElementById('backupBtn');
  var eye = document.getElementById('lgEye');
  var cpLink = document.getElementById('lgCpLink');
  var cpBack = document.getElementById('cpBack');
  var cpForm = document.getElementById('cpForm');
  var fpLink = document.getElementById('lgFpLink');
  var fpForm = document.getElementById('fpForm');
  var fpU = null;
  var authedUser = null;

  /* ---- permission guard around show() ---- */
  var __rawShow = show;
  show = function(id){
    if (!authedUser) return;
    var rec = getDB().users[authedUser];
    if (tabsOf(rec).indexOf(id) < 0) return;
    __rawShow(id);
  };

  function msg(el2, text){
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (text){ el2.textContent = text; el2.style.display = 'block'; }
  }
  function shake(){
    var card = gate.querySelector('.lg-card');
    card.classList.remove('lg-shake'); void card.offsetWidth; card.classList.add('lg-shake');
  }
  function fail(text){ msg(errEl, text); shake(); pEl.value = ''; btn.disabled = false; btn.textContent = 'Sign in'; }

  function applyAccess(user){
    var rec = getDB().users[user];
    var allowed = tabsOf(rec);
    Array.prototype.forEach.call(document.querySelectorAll('#topbar .navbtn[data-id]'), function(b){
      b.style.display = allowed.indexOf(b.getAttribute('data-id')) >= 0 ? '' : 'none';
    });
    if (who) who.textContent = '\uD83D\uDC64 ' + user + (rec.role === 'admin' ? ' \u00B7 Admin' : '');
    if (outBtn) outBtn.style.display = '';
    if (usersBtn) usersBtn.style.display = rec.role === 'admin' ? '' : 'none';
    if (backupBtn) backupBtn.style.display = rec.role === 'admin' ? '' : 'none';
    return allowed;
  }

  function openWorkspace(user){
    authedUser = user;
    var allowed = applyAccess(user);
    if (!allowed.length){ authedUser = null; return fail('No dashboards assigned to this user. Ask an admin.'); }
    gate.classList.add('lg-out');
    setTimeout(function(){ gate.style.display = 'none'; }, 380);
    startWorkspace(allowed[0]);
    /* If admin AND weekly reminder is on AND it's been >7 days, nudge. */
    var rec = getDB().users[user];
    if (rec && rec.role === 'admin') bkMaybeRemind();
  }

  /* ---- sign in ---- */
  function attempt(){
    var u = (uEl.value || '').trim().toLowerCase();
    var p = pEl.value || '';
    if (!u || !p) return fail('Enter username and password.');
    btn.disabled = true; btn.textContent = 'Checking\u2026';
    setTimeout(function(){
      try {
        var rec = getDB().users[u];
        if (!rec || !verifyPw(rec, p)) return fail('Wrong username or password.');
        saveAuth(u, !!(rEl && rEl.checked));
        openWorkspace(u);
      } catch(e){ fail('Login error: ' + (e && e.message ? e.message : e)); }
    }, 30);
  }

  /* ---- change password (login page) ---- */
  function showPanel(which){
    form.style.display = which === 'login' ? '' : 'none';
    cpForm.style.display = which === 'cp' ? '' : 'none';
    if (fpForm) fpForm.style.display = which === 'fp' ? '' : 'none';
    msg(errEl, '');
    var subs = { login:'Sign in to open your dashboards', cp:'Change your password', fp:'Recover your password' };
    document.getElementById('lgTitleSub').textContent = subs[which] || subs.login;
  }
  function cpShow(on){ showPanel(on ? 'cp' : 'login'); }
  function cpAttempt(){
    var u = (document.getElementById('cpUser').value || '').trim().toLowerCase();
    var oldP = document.getElementById('cpOld').value || '';
    var n1 = document.getElementById('cpNew1').value || '';
    var n2 = document.getElementById('cpNew2').value || '';
    var db = getDB();
    var rec = db.users[u];
    if (!u || !oldP) return msg(errEl, 'Enter username and current password.');
    if (!rec || !verifyPw(rec, oldP)){ shake(); return msg(errEl, 'Wrong username or current password.'); }
    if (n1.length < 4) return msg(errEl, 'New password must be at least 4 characters.');
    if (n1 !== n2) return msg(errEl, 'New passwords do not match.');
    var q = (document.getElementById('cpQ').value || '').trim();
    var a = document.getElementById('cpA').value || '';
    if (q && normAns(a).length < 2) return msg(errEl, 'Enter an answer for your security question.');
    if (!q && normAns(a)) return msg(errEl, 'Enter the security question text too.');
    rec.hash = sha256(utf8(n1));
    rec.changed = Date.now();
    if (q) rec.sq = { q: q, a: sha256(utf8(normAns(a))) };
    saveUsers(db).then(function(ok){
      if (!ok) return msg(errEl, STORAGE_ERR);
      ['cpUser','cpOld','cpNew1','cpNew2','cpQ','cpA'].forEach(function(id){ document.getElementById(id).value = ''; });
      cpShow(false);
      msg(okEl, 'Password updated. Sign in with your new password.');
    });
  }

  /* ---- forgot password (recovery) ---- */
  function fpResetUI(){
    fpU = null;
    ['fpUser','fpAns','fpKey','fpNew1','fpNew2'].forEach(function(id){ var e2 = document.getElementById(id); if (e2) e2.value = ''; });
    document.getElementById('fpStep1').style.display = '';
    document.getElementById('fpStep2').style.display = 'none';
    document.getElementById('fpNone').style.display = 'none';
  }
  function fpStart(){
    var u = (document.getElementById('fpUser').value || '').trim().toLowerCase();
    if (!u) return msg(errEl, 'Enter your username.');
    var rec = getDB().users[u];
    if (!rec){ shake(); return msg(errEl, 'Unknown username.'); }
    fpU = u;
    msg(errEl, '');
    var hasQ = !!(rec.sq && rec.sq.q), hasK = !!rec.rk;
    document.getElementById('fpQWrap').style.display = hasQ ? '' : 'none';
    if (hasQ) document.getElementById('fpQText').textContent = rec.sq.q;
    document.getElementById('fpKWrap').style.display = hasK ? '' : 'none';
    document.getElementById('fpStep1').style.display = 'none';
    document.getElementById(hasQ || hasK ? 'fpStep2' : 'fpNone').style.display = '';
  }
  function fpDoReset(){
    var db = getDB();
    var rec = db.users[fpU];
    if (!rec) return msg(errEl, 'User not found.');
    var usedKey = false, ok = false;
    if (rec.sq && rec.sq.q){
      var a = normAns(document.getElementById('fpAns').value || '');
      if (a && sha256(utf8(a)) === rec.sq.a) ok = true;
    }
    if (!ok && rec.rk){
      var k = (document.getElementById('fpKey').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (k && sha256(utf8(k)) === rec.rk){ ok = true; usedKey = true; }
    }
    if (!ok){ shake(); return msg(errEl, 'Recovery answer / key is incorrect.'); }
    var n1 = document.getElementById('fpNew1').value || '';
    var n2 = document.getElementById('fpNew2').value || '';
    if (n1.length < 4) return msg(errEl, 'New password must be at least 4 characters.');
    if (n1 !== n2) return msg(errEl, 'New passwords do not match.');
    rec.hash = sha256(utf8(n1));
    rec.changed = Date.now();
    if (usedKey) delete rec.rk;                            // recovery keys are one-time
    saveUsers(db).then(function(ok){
      if (!ok) return msg(errEl, STORAGE_ERR);
      fpResetUI();
      showPanel('login');
      msg(okEl, 'Password reset. Sign in with your new password.' + (usedKey ? ' Your recovery key is used up — ask an admin for a new one.' : ''));
    });
  }

  /* ---- admin: users panel ---- */
  function renderUsers(highlightUser){
    var db = getDB();
    var list = document.getElementById('umList');
    list.innerHTML = '';
    var keys = Object.keys(db.users).sort();
    list.appendChild(h('div', { 'class':'um-count', text: keys.length + ' user' + (keys.length === 1 ? '' : 's') + ' total' }));
    keys.forEach(function(u){
      var rec = db.users[u];
      var isSelf = u === authedUser;
      var lastAdmin = rec.role === 'admin' && adminCount(db) === 1;

      var roleSel = h('select', { 'class':'um-role', onchange: function(){
        var db2 = getDB(); var r2 = db2.users[u]; if (!r2) return renderUsers();
        if (r2.role === 'admin' && roleSel.value !== 'admin' && adminCount(db2) === 1){
          alert('At least one admin is required.'); renderUsers(); return;
        }
        r2.role = roleSel.value;
        if (r2.role === 'admin') r2.tabs = '*';
        else if (r2.tabs === '*') r2.tabs = allTabIds();
        saveUsers(db2).then(function(ok){ if (!ok) alert(STORAGE_ERR); renderUsers(); });
        if (isSelf) applyAccess(authedUser);
      }}, [
        h('option', { value:'user', text:'User', selected: rec.role !== 'admin' }),
        h('option', { value:'admin', text:'Admin', selected: rec.role === 'admin' })
      ]);

      var tabsWrap = h('div', { 'class':'um-tabs' }, TABS.map(function(t){
        var on = tabsOf(rec).indexOf(t.id) >= 0;
        var cb = h('input', { type:'checkbox', checked: on, disabled: rec.role === 'admin', onchange: function(){
          var db2 = getDB(); var r2 = db2.users[u]; if (!r2 || r2.role === 'admin') return;
          var cur = tabsOf(r2);
          if (cb.checked){ if (cur.indexOf(t.id) < 0) cur.push(t.id); }
          else cur = cur.filter(function(x){ return x !== t.id; });
          r2.tabs = allTabIds().filter(function(x){ return cur.indexOf(x) >= 0; });
          saveUsers(db2).then(function(ok){ if (!ok){ cb.checked = !cb.checked; alert(STORAGE_ERR); } });
          if (u === authedUser) applyAccess(authedUser);
        }});
        return h('label', { 'class':'um-tab' }, [cb, h('span', { text:' ' + t.label })]);
      }));

      var pwIn = h('input', { type:'password', placeholder:'new password', 'class':'um-pwin' });
      var pwShow = h('div', { 'class':'um-pwshow', style:'display:none' }, []);
      var pwWrapEl = pwWrap(pwIn, 'row');
      var pwBtn = h('button', { 'class':'um-btn', text:'Set password', onclick: function(){
        var v = pwIn.value || '';
        if (v.length < 4){ alert('Password must be at least 4 characters.'); return; }
        var db2 = getDB(); var r2 = db2.users[u]; if (!r2) return renderUsers();
        r2.hash = sha256(utf8(v)); r2.changed = Date.now();
        pwBtn.textContent = 'Saving\u2026';
        saveUsers(db2).then(function(ok){
          if (!ok){ pwBtn.textContent = 'Set password'; return alert(STORAGE_ERR); }
          pwBtn.textContent = 'Saved \u2713';
          pwShow.innerHTML = '';
          var lbl = document.createElement('span'); lbl.className = 'um-pwshow-lbl'; lbl.textContent = 'New password: ';
          var val = document.createElement('code'); val.className = 'um-pwshow-val'; val.textContent = v;
          var copy = document.createElement('button'); copy.type = 'button'; copy.className = 'um-btn um-copy'; copy.textContent = '📋 Copy';
          copy.addEventListener('click', function(){
            var ok2 = false;
            try {
              navigator.clipboard.writeText(v).then(function(){
                copy.textContent = '\u2713 Copied';
                setTimeout(function(){ copy.textContent = '📋 Copy'; }, 1500);
              });
              ok2 = true;
            } catch(e){}
            if (!ok2){
              try {
                var r = document.createRange(); r.selectNode(val);
                getSelection().removeAllRanges(); getSelection().addRange(r);
                document.execCommand('copy');
                copy.textContent = '\u2713 Copied';
                setTimeout(function(){ copy.textContent = '📋 Copy'; }, 1500);
              } catch(_){}
            }
          });
          pwShow.appendChild(lbl); pwShow.appendChild(val); pwShow.appendChild(copy);
          pwShow.style.display = 'flex';
          pwIn.value = '';
          setTimeout(function(){ pwBtn.textContent = 'Set password'; }, 1400);
          setTimeout(function(){ if (pwShow){ pwShow.innerHTML = ''; pwShow.style.display = 'none'; } }, 20000);
        });
      }}, []);

      var recBits = (rec.sq && rec.sq.q ? 'question \u2713 ' : '') + (rec.rk ? 'key \u2713' : '');
      var recStat = h('span', { 'class':'um-rec', text: 'recovery: ' + (recBits || 'none') });
      var keyOut = h('div', { 'class':'um-key', style:'display:none' }, []);
      var rkBtn = h('button', { 'class':'um-btn', text: rec.rk ? 'New recovery key' : 'Recovery key', onclick: function(){
        var code = genKey();
        var db2 = getDB(); var r2 = db2.users[u]; if (!r2) return renderUsers();
        r2.rk = sha256(utf8(code.replace(/-/g, '')));
        saveUsers(db2).then(function(ok){
          if (!ok) return alert(STORAGE_ERR);
          keyOut.textContent = 'Save this key now \u2014 it is shown only once:  ' + code;
          keyOut.style.display = 'block';
          rkBtn.textContent = 'New recovery key';
          recStat.textContent = 'recovery: ' + ((r2.sq && r2.sq.q ? 'question \u2713 ' : '') + 'key \u2713');
        });
      }}, []);
      var delBtn = h('button', { 'class':'um-btn um-del', text:'Delete', disabled: isSelf || lastAdmin, onclick: function(){
        if (!confirm('Delete user "' + u + '"?')) return;
        var db2 = getDB();
        if (db2.users[u] && db2.users[u].role === 'admin' && adminCount(db2) === 1) return;
        delete db2.users[u]; saveUsers(db2).then(function(ok){ if (!ok) alert(STORAGE_ERR); renderUsers(); });
      }}, []);

      var row = h('div', { 'class':'um-row' + (u === highlightUser ? ' um-hi' : '') }, [
        h('div', { 'class':'um-head' }, [
          h('b', { text: u }),
          isSelf ? h('span', { 'class':'um-you', text:'you' }) : null,
          recStat,
          roleSel, delBtn
        ]),
        rec.role === 'admin' ? h('div', { 'class':'um-alltabs', text:'Admin \u2014 all dashboards + user management' }) : tabsWrap,
        h('div', { 'class':'um-pw' }, [pwWrapEl, pwBtn, rkBtn]),
        pwShow,
        sqPanel(u, rec),
        keyOut
      ]);
      list.appendChild(row);
      if (u === highlightUser) setTimeout(function(){ try { row.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(e){} }, 20);
    });
  }
  function umFlash(text, kind){
    var errB = document.getElementById('umErr');
    errB.textContent = text; errB.style.display = 'block';
    errB.className = kind === 'ok' ? 'um-flash-ok' : '';
  }
  function sqPanel(uname, rec){
    var hasQ = !!(rec.sq && rec.sq.q);
    var wrap = document.createElement('div');
    wrap.className = 'um-sq';

    var label = document.createElement('div');
    label.className = 'um-sq-label';
    label.innerHTML = '<b>Security question</b> \u00B7 <span class="um-sq-status">' +
      (hasQ ? 'set: \u201C' + rec.sq.q.replace(/[<>&]/g, '') + '\u201D' : 'not set \u2014 user can only recover via key or admin')
      + '</span>';
    wrap.appendChild(label);

    var row = document.createElement('div');
    row.className = 'um-sq-row';
    var qIn = document.createElement('input');
    qIn.type = 'text'; qIn.className = 'um-sq-q';
    qIn.placeholder = 'question, e.g. Name of your first school?';
    if (hasQ) qIn.value = rec.sq.q;

    var aIn = document.createElement('input');
    aIn.type = 'text'; aIn.className = 'um-sq-a';
    aIn.placeholder = 'answer (case-insensitive)';
    aIn.setAttribute('autocomplete', 'off');
    aIn.setAttribute('autocapitalize', 'none');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'um-btn';
    btn.textContent = hasQ ? 'Update question' : 'Set question';
    btn.addEventListener('click', function(){
      var q = (qIn.value || '').trim();
      var a = normAns(aIn.value || '');
      if (!q) return alert('Enter a security question.');
      if (a.length < 2) return alert('Enter an answer of at least 2 characters.');
      var db2 = getDB(); var r2 = db2.users[uname]; if (!r2) return renderUsers();
      r2.sq = { q: q, a: sha256(utf8(a)) };
      btn.textContent = 'Saving\u2026';
      saveUsers(db2).then(function(ok){
        if (!ok){ btn.textContent = hasQ ? 'Update question' : 'Set question'; return alert(STORAGE_ERR); }
        aIn.value = '';
        btn.textContent = 'Saved ✓';
        setTimeout(function(){ renderUsers(uname); }, 900);
      });
    });

    row.appendChild(qIn); row.appendChild(aIn); row.appendChild(btn);
    wrap.appendChild(row);

    if (hasQ){
      var clr = document.createElement('button');
      clr.type = 'button'; clr.className = 'um-btn um-sq-clear';
      clr.textContent = 'Remove question';
      clr.addEventListener('click', function(){
        if (!confirm('Remove the security question for "' + uname + '"?')) return;
        var db2 = getDB(); var r2 = db2.users[uname]; if (!r2) return renderUsers();
        delete r2.sq;
        saveUsers(db2).then(function(ok){
          if (!ok) return alert(STORAGE_ERR);
          renderUsers(uname);
        });
      });
      wrap.appendChild(clr);
    }
    return wrap;
  }
  function addUser(){
    var uIn = document.getElementById('umNewUser');
    var pIn = document.getElementById('umNewPass');
    var rSel = document.getElementById('umNewRole');
    var raw = uIn.value || '';
    var u = raw.trim().toLowerCase();
    var p = pIn.value || '';
    document.getElementById('umErr').style.display = 'none';
    if (!raw.trim()) return umFlash('Enter a username.', 'err');
    if (!validUname(u)) return umFlash('Username: 2\u201324 chars, lowercase letters, numbers, . _ - only. (Got "' + raw + '")', 'err');
    if (p.length < 4) return umFlash('Password must be at least 4 characters.', 'err');
    var db = getDB();
    if (db.users[u]) return umFlash('User "' + u + '" already exists.', 'err');
    var tabs = [];
    Array.prototype.forEach.call(document.querySelectorAll('#umNewTabs input:checked'), function(cb){ tabs.push(cb.getAttribute('data-tab')); });
    var role = rSel.value === 'admin' ? 'admin' : 'user';
    if (role !== 'admin' && !tabs.length) return umFlash('Tick at least one dashboard for this user.', 'err');
    /* optional security question on create */
    var newQ = ''; var newA = '';
    var qEl = document.getElementById('umNewSqQ'); var aEl = document.getElementById('umNewSqA');
    if (qEl) newQ = (qEl.value || '').trim();
    if (aEl) newA = normAns(aEl.value || '');
    if (newQ && newA.length < 2) return umFlash('Security question needs an answer of at least 2 characters, or leave both blank.', 'err');
    if (!newQ && newA) return umFlash('Enter the security question text, or clear the answer.', 'err');
    var rec = { hash: sha256(utf8(p)), role: role, tabs: role === 'admin' ? '*' : tabs, created: Date.now() };
    if (newQ && newA) rec.sq = { q: newQ, a: sha256(utf8(newA)) };
    db.users[u] = rec;
    umFlash('Saving\u2026', 'ok');
    saveUsers(db).then(function(ok){
      if (!ok) return umFlash(STORAGE_ERR, 'err');
      uIn.value = ''; pIn.value = '';
      if (qEl) qEl.value = ''; if (aEl) aEl.value = '';
      Array.prototype.forEach.call(document.querySelectorAll('#umNewTabs input'), function(cb){ cb.checked = true; });
      renderUsers(u);
      umFlash('\u2713 User "' + u + '" created \u2014 shown below.', 'ok');
      setTimeout(function(){
        var errB = document.getElementById('umErr');
        if (errB && errB.className === 'um-flash-ok') errB.style.display = 'none';
      }, 3500);
    });
  }
  function openUsers(){
    var rec = getDB().users[authedUser];
    if (!rec || rec.role !== 'admin') return;
    var tw = document.getElementById('umNewTabs');
    if (!tw.childNodes.length){
      TABS.forEach(function(t){
        tw.appendChild(h('label', { 'class':'um-tab' }, [
          h('input', { type:'checkbox', 'data-tab': t.id, checked: true }),
          h('span', { text:' ' + t.label })
        ]));
      });
    }
    /* one-time: wrap the umNewPass input with eye + dice controls */
    var pinEl = document.getElementById('umNewPass');
    if (pinEl && pinEl.parentNode && !pinEl.parentNode.classList.contains('um-pwwrap')){
      var parent = pinEl.parentNode;
      var wrapEl = pwWrap(pinEl, 'add');
      parent.insertBefore(wrapEl, parent.firstChild);
      /* rebalance layout: the wrap replaces the input in the .um-addrow flex flow */
    }
    renderUsers();
    document.getElementById('usersModal').style.display = 'flex';
  }
  function closeUsers(){ document.getElementById('usersModal').style.display = 'none'; }

  /* ================================================================
     BACKUP / RESTORE — admin-only
     Reads every hw_* IndexedDB database in this browser plus any hw_*
     localStorage keys, and downloads them as a single JSON blob. Restore
     reads that JSON and overwrites the current browser's databases with
     the same version + object stores.
     Because IndexedDB is per-origin, this is what lets an admin move data
     from one browser (local dev) to another (live site), share with a
     colleague, or keep periodic backups.
  ================================================================= */
  var BACKUP_KNOWN_DBS = ['hw_workspace','hw_products','hw_inventory','hw_containers','hw_orders','hw_financial','hw_attendance'];
  var _bkPendingFile = null;

  function bkLog(msg, cls){
    var el = document.getElementById('bkLog');
    if (!el) return;
    el.classList.add('show');
    var line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  function bkClearLog(){
    var el = document.getElementById('bkLog');
    if (el){ el.innerHTML = ''; el.classList.remove('show'); }
    ['bkExportSummary','bkImportSummary'].forEach(function(id){
      var s = document.getElementById(id);
      if (s){ s.classList.remove('show','err'); s.innerHTML = ''; }
    });
  }
  function bkSetSummary(id, html, isErr){
    var s = document.getElementById(id);
    if (!s) return;
    s.innerHTML = html;
    s.classList.add('show');
    s.classList.toggle('err', !!isErr);
  }

  function bkListDatabases(){
    /* Modern browsers expose indexedDB.databases(); older ones don't, so
       we probe the known workspace database names as a fallback. */
    if (typeof indexedDB.databases === 'function'){
      return indexedDB.databases().then(function(list){
        return list.filter(function(d){ return d.name && d.name.indexOf('hw_') === 0; }).map(function(d){ return d.name; });
      }).catch(function(){ return BACKUP_KNOWN_DBS.slice(); });
    }
    return Promise.resolve(BACKUP_KNOWN_DBS.slice());
  }
  function bkOpenRO(name){
    return new Promise(function(res, rej){
      var rq = indexedDB.open(name);
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error); };
      rq.onblocked = function(){ rej(new Error('db blocked: ' + name)); };
    });
  }
  function bkDumpStore(db, storeName){
    return new Promise(function(res, rej){
      var tx = db.transaction(storeName, 'readonly');
      var store = tx.objectStore(storeName);
      var rq = store.openCursor();
      var items = [];
      rq.onsuccess = function(e){
        var cursor = e.target.result;
        if (cursor){ items.push({ key: cursor.key, value: cursor.value }); cursor.continue(); }
        else res(items);
      };
      rq.onerror = function(){ rej(rq.error); };
    });
  }
  function bkDumpDB(name){
    return bkOpenRO(name).then(function(db){
      var stores = Array.prototype.slice.call(db.objectStoreNames);
      var version = db.version;
      var dump = { version: version, stores: {} };
      /* Serialise store dumps so the transaction on each finishes before the next starts. */
      return stores.reduce(function(p, s){
        return p.then(function(){ return bkDumpStore(db, s); }).then(function(items){ dump.stores[s] = items; });
      }, Promise.resolve()).then(function(){ db.close(); return dump; });
    });
  }

  function bkDoExport(){
    bkClearLog();
    var btn = document.getElementById('bkExport');
    if (btn) btn.disabled = true;
    bkLog('▶ Scanning hw_* databases in this browser…', 'head');
    var result = {
      exportedAt: new Date().toISOString(),
      exportedBy: authedUser || 'unknown',
      origin: location.origin || 'file://',
      userAgent: navigator.userAgent,
      workspaceVersion: '1.0',
      databases: {},
      localStorage: {}
    };
    var totalKeys = 0;
    return bkListDatabases().then(function(dbs){
      if (!dbs.length){ bkLog('  (no hw_* databases found in this browser)', 'err'); }
      return dbs.reduce(function(p, name){
        return p.then(function(){
          bkLog('  reading ' + name + '…');
          return bkDumpDB(name).then(function(d){
            result.databases[name] = d;
            var keys = Object.keys(d.stores).reduce(function(s, k){ return s + d.stores[k].length; }, 0);
            totalKeys += keys;
            bkLog('    v' + d.version + ', stores=[' + Object.keys(d.stores).join(',') + '], ' + keys + ' key' + (keys === 1 ? '' : 's'), 'ok');
          }).catch(function(e){ bkLog('    ✗ ' + (e && e.message ? e.message : e), 'err'); });
        });
      }, Promise.resolve());
    }).then(function(){
      /* localStorage hw_* */
      for (var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if (k && k.indexOf('hw_') === 0){ result.localStorage[k] = localStorage.getItem(k); }
      }
      var lsCount = Object.keys(result.localStorage).length;
      bkLog('  localStorage: ' + lsCount + ' hw_* key' + (lsCount === 1 ? '' : 's'), lsCount ? 'ok' : '');
      /* download */
      var json = JSON.stringify(result, null, 2);
      var bytes = json.length;
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hw_backup_' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '_' + Date.now() + '.json';
      /* Route through the child-shim download bridge if available (works in
         sandboxed iframes and blob previews). Otherwise plain click(). */
      try { a.click(); } catch(e){ /* fall back below */ }
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
      bkLog('✓ downloaded ' + a.download + ' (' + (bytes / 1024).toFixed(1) + ' KB)', 'ok');
      /* remember last-export timestamp for the weekly reminder */
      try { localStorage.setItem('hw_last_backup', String(Date.now())); } catch(e){}
      bkSetSummary('bkExportSummary',
        '✅ Backed up <b>' + Object.keys(result.databases).length + '</b> database(s), <b>' + totalKeys + '</b> records, <b>' + Object.keys(result.localStorage).length + '</b> localStorage key(s). Keep this JSON file safe — you can restore or share it later.'
      );
    }).catch(function(e){
      bkLog('✗ export failed: ' + (e && e.message ? e.message : e), 'err');
      bkSetSummary('bkExportSummary', '❌ Export failed: ' + (e && e.message ? e.message : e), true);
    }).then(function(){ if (btn) btn.disabled = false; });
  }

  function bkOpenForRestore(name, version, allStores){
    return new Promise(function(res, rej){
      var rq = indexedDB.open(name, version);
      rq.onupgradeneeded = function(e){
        var db = e.target.result;
        allStores.forEach(function(s){ if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
      };
      rq.onsuccess = function(){
        var db = rq.result;
        var missing = allStores.filter(function(s){ return !db.objectStoreNames.contains(s); });
        if (missing.length){
          var v2 = db.version + 1; db.close();
          bkOpenForRestore(name, v2, allStores).then(res, rej);
        } else { res(db); }
      };
      rq.onerror = function(){ rej(rq.error); };
      rq.onblocked = function(){ rej(new Error('db blocked: ' + name)); };
    });
  }
  function bkWriteStore(db, storeName, items){
    return new Promise(function(res, rej){
      var tx = db.transaction(storeName, 'readwrite');
      var store = tx.objectStore(storeName);
      /* Clear first — this is a restore, not a merge. */
      store.clear();
      items.forEach(function(it){ try { store.put(it.value, it.key); } catch(e){} });
      tx.oncomplete = function(){ res(); };
      tx.onerror = function(){ rej(tx.error); };
      tx.onabort = function(){ rej(tx.error); };
    });
  }

  function bkDoImport(){
    if (!_bkPendingFile){ return; }
    if (!confirm('This will OVERWRITE all workspace data in this browser (' + (location.origin || 'file://') + '). You should export first as a rollback point. Continue?')){ return; }
    bkClearLog();
    var btn = document.getElementById('bkImport');
    if (btn) btn.disabled = true;
    bkLog('▶ Reading backup file…', 'head');
    var totalKeys = 0;
    return _bkPendingFile.text().then(function(text){
      var data;
      try { data = JSON.parse(text); }
      catch(e){ throw new Error('Not valid JSON — is this a Homeweavers backup file?'); }
      if (!data || !data.databases){ throw new Error('Missing "databases" — not a Homeweavers backup.'); }
      bkLog('  exported at: ' + (data.exportedAt || 'unknown') + ' from ' + (data.origin || 'unknown'));
      if (data.exportedBy){ bkLog('  exported by: ' + data.exportedBy); }
      var names = Object.keys(data.databases);
      return names.reduce(function(p, name){
        return p.then(function(){
          var d = data.databases[name];
          var storeNames = Object.keys(d.stores);
          bkLog('  restoring ' + name + ' (v' + d.version + ', stores=[' + storeNames.join(',') + '])…');
          return bkOpenForRestore(name, d.version, storeNames).then(function(db){
            return storeNames.reduce(function(pp, s){
              return pp.then(function(){
                return bkWriteStore(db, s, d.stores[s]).then(function(){ totalKeys += d.stores[s].length; });
              });
            }, Promise.resolve()).then(function(){ db.close(); });
          }).then(function(){
            var keys = storeNames.reduce(function(n, s){ return n + d.stores[s].length; }, 0);
            bkLog('    ✓ ' + storeNames.length + ' store(s), ' + keys + ' key' + (keys === 1 ? '' : 's') + ' restored', 'ok');
          }).catch(function(e){
            bkLog('    ✗ ' + (e && e.message ? e.message : e), 'err');
          });
        });
      }, Promise.resolve()).then(function(){ return data; });
    }).then(function(data){
      /* localStorage — clear hw_* first then restore */
      if (data.localStorage){
        var remove = [];
        for (var i = 0; i < localStorage.length; i++){
          var k = localStorage.key(i);
          if (k && k.indexOf('hw_') === 0) remove.push(k);
        }
        remove.forEach(function(k){ localStorage.removeItem(k); });
        var lsCount = 0;
        for (var kk in data.localStorage){
          try { localStorage.setItem(kk, data.localStorage[kk]); lsCount++; } catch(e){}
        }
        bkLog('  localStorage: ' + lsCount + ' key(s) restored', lsCount ? 'ok' : '');
      }
      bkLog('✓ restore complete — reloading the page in 3 seconds so all dashboards see the new data…', 'ok');
      bkSetSummary('bkImportSummary',
        '✅ Restored <b>' + Object.keys(data.databases).length + '</b> database(s), <b>' + totalKeys + '</b> record(s). Reloading now…'
      );
      /* Auth records were restored — sign out cleanly so the user re-signs
         in against the restored user database. */
      try { clearAuth(); } catch(e){}
      setTimeout(function(){ location.reload(); }, 3000);
    }).catch(function(e){
      bkLog('✗ restore failed: ' + (e && e.message ? e.message : e), 'err');
      bkSetSummary('bkImportSummary', '❌ Restore failed: ' + (e && e.message ? e.message : e), true);
    }).then(function(){ if (btn) btn.disabled = _bkPendingFile ? false : true; });
  }

  function openBackup(){
    var rec = getDB().users[authedUser];
    if (!rec || rec.role !== 'admin') return;
    bkClearLog();
    _bkPendingFile = null;
    var f = document.getElementById('bkFile'); if (f) f.value = '';
    var fn = document.getElementById('bkFileName'); if (fn) fn.textContent = '';
    var imp = document.getElementById('bkImport'); if (imp) imp.disabled = true;
    var reminder = document.getElementById('bkAutoWeek');
    if (reminder){
      try { reminder.checked = localStorage.getItem('hw_backup_reminder') === '1'; } catch(e){}
    }
    document.getElementById('backupModal').style.display = 'flex';
  }
  function closeBackup(){ document.getElementById('backupModal').style.display = 'none'; }

  /* Weekly reminder: on first workspace load per day, if it's been ≥7 days
     since the last export and the reminder toggle is on, prompt the admin. */
  function bkMaybeRemind(){
    try {
      if (localStorage.getItem('hw_backup_reminder') !== '1') return;
      var lastCheck = +localStorage.getItem('hw_backup_reminder_shown') || 0;
      var today = new Date().toISOString().slice(0,10);
      if (localStorage.getItem('hw_backup_reminder_shown_date') === today) return;
      var last = +localStorage.getItem('hw_last_backup') || 0;
      if (Date.now() - last < 7 * 86400000) return;
      localStorage.setItem('hw_backup_reminder_shown_date', today);
      setTimeout(function(){
        if (confirm("It's been more than a week since your last workspace backup. Open the backup tool now?")){ openBackup(); }
      }, 2500);
    } catch(e){}
  }

  /* ---- wiring ---- */
  if (eye) eye.addEventListener('click', function(){
    var showing = pEl.type === 'text';
    pEl.type = showing ? 'password' : 'text';
    eye.classList.toggle('on', !showing);
    eye.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    try { pEl.focus(); } catch(e){}
  });
  btn.addEventListener('click', function(ev){ if (ev && ev.preventDefault) ev.preventDefault(); attempt(); });
  function onEnter(ev){ if (ev.key === 'Enter' || ev.keyCode === 13){ ev.preventDefault(); attempt(); } }
  uEl.addEventListener('keydown', onEnter);
  pEl.addEventListener('keydown', onEnter);
  if (form && form.addEventListener) form.addEventListener('submit', function(ev){ ev.preventDefault(); attempt(); });
  if (cpLink) cpLink.addEventListener('click', function(ev){ ev.preventDefault(); cpShow(true); });
  if (cpBack) cpBack.addEventListener('click', function(ev){ ev.preventDefault(); cpShow(false); });
  var cpBtn = document.getElementById('cpBtn');
  if (cpBtn) cpBtn.addEventListener('click', function(ev){ ev.preventDefault(); cpAttempt(); });
  if (fpLink) fpLink.addEventListener('click', function(ev){ ev.preventDefault(); fpResetUI(); showPanel('fp'); });
  var fpBack = document.getElementById('fpBack');
  if (fpBack) fpBack.addEventListener('click', function(ev){ ev.preventDefault(); showPanel('login'); });
  var fpNext = document.getElementById('fpNext');
  if (fpNext) fpNext.addEventListener('click', function(ev){ ev.preventDefault(); fpStart(); });
  var fpBtn = document.getElementById('fpBtn');
  if (fpBtn) fpBtn.addEventListener('click', function(ev){ ev.preventDefault(); fpDoReset(); });
  if (outBtn) outBtn.addEventListener('click', function(){ clearAuth(); location.reload(); });
  if (usersBtn) usersBtn.addEventListener('click', openUsers);
  var umClose = document.getElementById('umClose');
  if (umClose) umClose.addEventListener('click', closeUsers);

  /* Backup / restore wiring */
  if (backupBtn) backupBtn.addEventListener('click', openBackup);
  var bkClose = document.getElementById('bkClose');
  if (bkClose) bkClose.addEventListener('click', closeBackup);
  var bkExportBtn = document.getElementById('bkExport');
  if (bkExportBtn) bkExportBtn.addEventListener('click', function(){ bkDoExport(); });
  var bkImportBtn = document.getElementById('bkImport');
  if (bkImportBtn) bkImportBtn.addEventListener('click', function(){ bkDoImport(); });
  var bkFile = document.getElementById('bkFile');
  if (bkFile) bkFile.addEventListener('change', function(e){
    var f = e.target.files && e.target.files[0];
    if (!f){ _bkPendingFile = null; if (bkImportBtn) bkImportBtn.disabled = true; return; }
    _bkPendingFile = f;
    var fn = document.getElementById('bkFileName');
    if (fn) fn.textContent = f.name + ' (' + (f.size / 1024).toFixed(1) + ' KB)';
    if (bkImportBtn) bkImportBtn.disabled = false;
  });
  var bkReminder = document.getElementById('bkAutoWeek');
  if (bkReminder) bkReminder.addEventListener('change', function(){
    try { localStorage.setItem('hw_backup_reminder', bkReminder.checked ? '1' : '0'); } catch(e){}
  });
  var backupModal = document.getElementById('backupModal');
  if (backupModal) backupModal.addEventListener('click', function(ev){ if (ev.target === backupModal) closeBackup(); });
  var umAdd = document.getElementById('umAdd');
  if (umAdd) umAdd.addEventListener('click', addUser);
  function umEnter(ev){ if (ev.key === 'Enter' || ev.keyCode === 13){ ev.preventDefault(); addUser(); } }
  var umNewUserEl = document.getElementById('umNewUser'); if (umNewUserEl) umNewUserEl.addEventListener('keydown', umEnter);
  var umNewPassEl = document.getElementById('umNewPass'); if (umNewPassEl) umNewPassEl.addEventListener('keydown', umEnter);
  var modal = document.getElementById('usersModal');
  if (modal) modal.addEventListener('click', function(ev){ if (ev.target === modal) closeUsers(); });

  /* users hydrated before this runs */
  var existing = readAuth();
  if (existing){
    authedUser = existing.u;
    var allowed = applyAccess(existing.u);
    if (allowed.length){
      gate.style.display = 'none';
      startWorkspace(allowed[0]);
      var _rec = getDB().users[existing.u];
      if (_rec && _rec.role === 'admin') bkMaybeRemind();
      return;
    }
    authedUser = null; clearAuth();
  }
  if (outBtn) outBtn.style.display = 'none';
  if (usersBtn) usersBtn.style.display = 'none';
  if (backupBtn) backupBtn.style.display = 'none';
  setTimeout(function(){ try { uEl.focus(); } catch(e){} }, 60);
}

  