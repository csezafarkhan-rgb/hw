(function(){
  // Only shim when embedded inside the workspace. Standalone use keeps real storage.
  try { if (window.top === window.self) return; } catch(e){ return; }
  var post = function(m){ try{ parent.postMessage(m, '*'); }catch(e){} };

  /* ---------------- localStorage bridge (synchronous, pre-seeded) ---------------- */
  try {
    var mem = window.__HW_SEED_LS || {};
    var lsShim = {
      getItem: function(k){ k=''+k; return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null; },
      setItem: function(k,v){ k=''+k; v=''+v; mem[k]=v; post({__hwb:1,op:'ls-set',key:k,value:v}); },
      removeItem: function(k){ k=''+k; delete mem[k]; post({__hwb:1,op:'ls-remove',key:k}); },
      clear: function(){ mem={}; post({__hwb:1,op:'ls-clear'}); },
      key: function(i){ var ks=Object.keys(mem); return (i>=0&&i<ks.length)?ks[i]:null; }
    };
    Object.defineProperty(lsShim,'length',{ get:function(){ return Object.keys(mem).length; } });
    try { Object.defineProperty(window,'localStorage',{ configurable:true, get:function(){ return lsShim; } }); }
    catch(e){ try{ window.localStorage = lsShim; }catch(_){} }
  } catch(e){}

  /* ---------------- IndexedDB bridge (simple KV subset) ---------------- */
  try {
    var rid=0, waiting={}, cache={}, loading={};
    window.addEventListener('message', function(e){
      var m=e.data; if(!m||!m.__hwb) return;
      if(m.rid && waiting[m.rid]){ waiting[m.rid](m); delete waiting[m.rid]; }
      else if(m.op==='idb-ext' && cache[m.db]){ var d=cache[m.db]._d; if(!d[m.store]) d[m.store]={}; if(m.del) delete d[m.store][m.key]; else if(m.clr) d[m.store]={}; else d[m.store][m.key]=m.value; }
      else if(m.op==='ls-ext'){ try{ if(m.del) delete mem[m.key]; else mem[m.key]=m.value; }catch(_){}
        // Let the page react — two tabs can be views of the same document, and a
        // stale in-memory copy would otherwise overwrite the other's edits.
        try{ window.dispatchEvent(new CustomEvent('hw-ls-ext',{detail:{key:m.key}})); }catch(_){} }
    });
    function rpc(msg){ return new Promise(function(res){ var id=++rid; var done=false; waiting[id]=function(m){ if(!done){ done=true; res(m); } }; msg.__hwb=1; msg.rid=id; post(msg); setTimeout(function(){ if(!done){ done=true; delete waiting[id]; res({data:{}}); } }, 2500); }); }

    function Req(){ this.onsuccess=null; this.onerror=null; this.onupgradeneeded=null; this.result=undefined; }
    function succeed(req,val){ req.result=val; Promise.resolve().then(function(){ if(req.onsuccess){ try{ req.onsuccess({target:req}); }catch(e){} } }); }

    function Store(db,name){ this._db=db; this._n=name; if(!db._d[name]) db._d[name]={}; }
    Store.prototype.get=function(k){ var r=new Req(); var m=this._db._d[this._n]; succeed(r, Object.prototype.hasOwnProperty.call(m,k)?m[k]:undefined); return r; };
    Store.prototype.getAll=function(){ var r=new Req(); var m=this._db._d[this._n]; succeed(r, Object.keys(m).map(function(k){ return m[k]; })); return r; };
    Store.prototype.getAllKeys=function(){ var r=new Req(); succeed(r, Object.keys(this._db._d[this._n])); return r; };
    Store.prototype.count=function(){ var r=new Req(); succeed(r, Object.keys(this._db._d[this._n]).length); return r; };
    Store.prototype.put=function(v,k){ var r=new Req(); this._db._d[this._n][k]=v; post({__hwb:1,op:'idb-put',db:this._db._n,store:this._n,key:k,value:v}); succeed(r,k); return r; };
    Store.prototype.add=Store.prototype.put;
    Store.prototype['delete']=function(k){ var r=new Req(); delete this._db._d[this._n][k]; post({__hwb:1,op:'idb-del',db:this._db._n,store:this._n,key:k}); succeed(r,undefined); return r; };
    Store.prototype.clear=function(){ var r=new Req(); this._db._d[this._n]={}; post({__hwb:1,op:'idb-clr',db:this._db._n,store:this._n}); succeed(r,undefined); return r; };

    function Tx(db,mode){ this._db=db; this.mode=mode; this.db=db; this.oncomplete=null; this.onerror=null; this.onabort=null; var self=this; setTimeout(function(){ if(self.oncomplete){ try{ self.oncomplete({target:self}); }catch(e){} } },0); }
    Tx.prototype.objectStore=function(n){ return new Store(this._db,n); };
    Tx.prototype.abort=function(){};

    function DB(name,data){ this._n=name; this._d=data||{}; this.name=name; this.version=1; var self=this; this.objectStoreNames={ contains:function(s){ return !!self._d[s]; }, length:0, item:function(i){ return Object.keys(self._d)[i]; } }; }
    DB.prototype.createObjectStore=function(n){ if(!this._d[n]) this._d[n]={}; return new Store(this,n); };
    DB.prototype.deleteObjectStore=function(n){ delete this._d[n]; };
    DB.prototype.transaction=function(stores,mode){ return new Tx(this, mode||'readonly'); };
    DB.prototype.close=function(){};

    function idbOpen(name){
      var req=new Req();
      function finish(db,isNew){ req.result=db; if(isNew && req.onupgradeneeded){ try{ req.onupgradeneeded({target:req}); }catch(e){} } Promise.resolve().then(function(){ if(req.onsuccess){ try{ req.onsuccess({target:req}); }catch(e){} } }); }
      if(cache[name]){ setTimeout(function(){ finish(cache[name],false); },0); return req; }
      if(!loading[name]) loading[name]=rpc({op:'idb-open',db:name});
      loading[name].then(function(resp){ var data=(resp&&resp.data)||{}; var isNew=Object.keys(data).length===0; if(!cache[name]) cache[name]=new DB(name,data); finish(cache[name],isNew); });
      return req;
    }
    var idbShim={ open:function(name,ver){ return idbOpen(name); }, deleteDatabase:function(name){ var r=new Req(); delete cache[name]; delete loading[name]; post({__hwb:1,op:'idb-deldb',db:name}); succeed(r,undefined); return r; }, cmp:function(a,b){ return a<b?-1:a>b?1:0; } };
    try { Object.defineProperty(window,'indexedDB',{ configurable:true, get:function(){ return idbShim; } }); }
    catch(e){ try{ window.indexedDB=idbShim; }catch(_){} }
  } catch(e){}

  /* ---------------- download bridge ----------------
     Chrome drops downloads (and blocks file pickers) inside an opaque-origin
     srcdoc frame, so an <a download> click here can silently do nothing. The
     parent workspace IS a real top-level document, so hand the bytes over and
     let it save the file. Applies to every dashboard's export button. */
  try {
    window.__hwCrossFrame = true;
    document.addEventListener('click', function(ev){
      var a = null;
      try { a = ev.target && ev.target.closest ? ev.target.closest('a[download]') : null; } catch(e){}
      if(!a || !a.href || a.getAttribute('data-hwb-skip')) return;
      var name = a.getAttribute('download') || 'download';
      ev.preventDefault(); ev.stopPropagation();
      fetch(a.href).then(function(r){ return r.blob(); }).then(function(b){
        post({__hwb:1, op:'download', name:name, blob:b});
      }).catch(function(){
        // last resort: let the browser try it the normal way
        try{ a.setAttribute('data-hwb-skip','1'); a.click(); }catch(_){}
      });
    }, true);
  } catch(e){}

  try { window.__HW_BRIDGE = true; } catch(e){}
})();