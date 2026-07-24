
(function(){
  if(window.__selxInit) return; window.__selxInit=true;
  var openPop=null, openBtn=null, cleanup=null;
  function txt(o){ return (o.textContent||'').replace(/\s+/g,' ').trim(); }
  function labelOf(sel){ var o=sel.options[sel.selectedIndex]; return o?txt(o):''; }
  function closePop(){
    if(openPop){ openPop.remove(); openPop=null; openBtn=null; }
    if(cleanup){ document.removeEventListener('mousedown',cleanup,true); document.removeEventListener('keydown',onKey,true);
      window.removeEventListener('resize',closePop); window.removeEventListener('scroll',onScroll,true); cleanup=null; }
  }
  function onKey(e){ if(e.key==='Escape') closePop(); }
  function onScroll(ev){ if(openPop && !openPop.contains(ev.target)) closePop(); }
  function skip(sel){
    if(!sel || sel.tagName!=='SELECT') return true;
    if(sel.multiple) return true;
    if(sel.closest('td,tr,thead')) return true;   // per-row table selects stay native
    return false;
  }
  function enhance(sel){
    if(sel.dataset.selx) return;
    if(skip(sel)){ sel.dataset.selx='skip'; return; }
    sel.dataset.selx='1';
    var cs=getComputedStyle(sel);
    var wrap=document.createElement('span'); wrap.className='selx';
    wrap.style.display = (cs.display==='block') ? 'block' : 'inline-block';
    if(cs.flexGrow && cs.flexGrow!=='0'){ wrap.style.flex=cs.flexGrow+' '+cs.flexShrink+' '+(cs.flexBasis||'auto'); wrap.style.minWidth='0'; }
    if(sel.style.width==='100%'){ wrap.style.width='100%'; }
    try{ wrap.style.margin=cs.margin; }catch(e){}
    wrap.style.verticalAlign='middle';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('selx-native'); sel.style.margin='0';
    var btn=document.createElement('button'); btn.type='button'; btn.className='selx-btn';
    btn.innerHTML='<span class="selx-val"></span><span class="selx-caret">\u25BE</span>';
    wrap.appendChild(btn);
    sel.__selxBtn=btn;
    var valEl=btn.querySelector('.selx-val');
    function multiVals(el){
      try{ return JSON.parse(el.dataset.values||'[]'); }catch(e){ return []; }
    }
    function isMulti(el){ return el.dataset.multi==='1'; }
    function sync(){
      if(isMulti(sel)){
        const v=multiVals(sel);
        const first=sel.options[0]?txt(sel.options[0]):'All';
        valEl.textContent = v.length===0 ? first : (v.length===1 ? v[0] : (v.length+' selected'));
        valEl.style.color = v.length ? '' : '';
        return;
      }
      valEl.textContent=labelOf(sel)||sel.getAttribute('placeholder')||'Select\u2026';
      // mirror the chosen option's colour onto the closed button, so a
      // discontinued selection still reads as discontinued
      var o=sel.options[sel.selectedIndex];
      valEl.style.color = (o && o.style && o.style.color) ? o.style.color : '';
    }
    sync();
    sel.addEventListener('change', sync);
    try{ new MutationObserver(sync).observe(sel,{childList:true,subtree:true}); }catch(e){}
    btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggle(sel,btn); });
    btn.addEventListener('mousedown', function(e){ e.preventDefault(); });
  }
  function toggle(sel,btn){
    var same=(openBtn===btn); closePop(); if(same) return;
    var opts=Array.prototype.slice.call(sel.options);
    var pop=document.createElement('div'); pop.className='selx-pop';
    var multi=sel.dataset.multi==='1';
    var head=document.createElement('div'); head.className='selx-head';
    var clr=document.createElement('button'); clr.type='button'; clr.className='selx-clear'; clr.textContent='Clear';
    head.appendChild(clr);
    if(multi){
      var done=document.createElement('button'); done.type='button'; done.className='selx-done'; done.textContent='Done';
      done.onclick=function(){ closePop(); };
      head.appendChild(done);
    }
    pop.appendChild(head);
    var search=null;
    if(opts.length>8){ search=document.createElement('input'); search.className='selx-search'; search.type='text'; search.placeholder='Search\u2026'; pop.appendChild(search); }
    var list=document.createElement('div'); list.className='selx-list'; pop.appendChild(list);
    function fire(){ sel.dispatchEvent(new Event('input',{bubbles:true})); sel.dispatchEvent(new Event('change',{bubbles:true})); }
    function curVals(){ try{ return JSON.parse(sel.dataset.values||'[]'); }catch(e){ return []; } }
    function setVals(a){ sel.dataset.values=JSON.stringify(a); fire(); }
    function pick(o){
      if(multi){
        if(!o.value){ setVals([]); draw(search?search.value:''); return; }   // the "All …" row clears
        var a=curVals(), i=a.indexOf(o.value);
        if(i>=0) a.splice(i,1); else a.push(o.value);
        setVals(a); draw(search?search.value:'');                            // stays open
        return;
      }
      if(sel.value!==o.value){ sel.value=o.value; fire(); }
      closePop();
    }
    clr.onclick=function(){
      if(multi){ setVals([]); draw(search?search.value:''); }
      else { sel.value=''; fire(); closePop(); }
    };
    // Pages mark special options with an inline colour (e.g. discontinued items in
    // red) — carry that through so the meaning survives. Only inline styles are
    // read: deriving colours from computed styles once turned an option white on
    // a white popup, i.e. an invisible blank row.
    function safeColour(c){
      if(!c) return '';
      c = String(c).trim();
      if(/^(transparent|inherit|initial|unset|currentcolor)$/i.test(c)) return '';
      var m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i);
      var r,g,b,a=1;
      if(m){ r=+m[1]; g=+m[2]; b=+m[3]; if(m[4]!=null) a=parseFloat(m[4]); }
      else if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)){
        var hx=c.slice(1); if(hx.length===3) hx=hx[0]+hx[0]+hx[1]+hx[1]+hx[2]+hx[2];
        r=parseInt(hx.slice(0,2),16); g=parseInt(hx.slice(2,4),16); b=parseInt(hx.slice(4,6),16);
      } else return c;                                   // named colour — trust it
      if(a < 0.35) return '';                            // too faint to read
      if((0.299*r + 0.587*g + 0.114*b) > 218) return ''; // too pale on a white popup
      return c;
    }
    function draw(q){
      q=(q||'').toLowerCase().trim(); list.innerHTML=''; var any=false;
      var chosen=multi?curVals():null;
      opts.forEach(function(o){ var t=txt(o); if(q && t.toLowerCase().indexOf(q)<0) return; any=true;
        var on = multi ? (o.value ? chosen.indexOf(o.value)>=0 : chosen.length===0) : o.selected;
        var row=document.createElement('div'); row.className='selx-opt'+(on?' selx-on':'');
        if(multi){
          var bx=document.createElement('span'); bx.className='selx-box'+(on?' on':'');
          bx.textContent=on?'\u2713':'';
          row.appendChild(bx);
          var lb=document.createElement('span'); lb.textContent=t||'\u2014'; row.appendChild(lb);
        } else { row.textContent=t||'\u2014'; }
        if(!on){                                         // selected rows keep white-on-blue
          var col=safeColour(o.style && o.style.color);
          if(col){
            row.style.color=col;
            var wt=(o.style&&o.style.fontWeight)||'';
            if(wt && wt!=='400' && wt!=='normal') row.style.fontWeight=wt;
          }
        }
        row.addEventListener('click', function(){ pick(o); }); list.appendChild(row); });
      if(!any){ var em=document.createElement('div'); em.className='selx-empty'; em.textContent='No matches'; list.appendChild(em); }
    }
    draw('');
    document.body.appendChild(pop);
    var r=btn.getBoundingClientRect();
    pop.style.minWidth=Math.max(r.width,210)+'px';
    pop.style.left='0px'; pop.style.top='0px';
    var pr=pop.getBoundingClientRect(), vw=window.innerWidth, vh=window.innerHeight;
    var left=r.left; if(left+pr.width>vw-8) left=Math.max(8, vw-8-pr.width);
    var top=r.bottom+6; if(top+pr.height>vh-8){ var above=r.top-6-pr.height; top = above>8? above : Math.max(8, vh-8-pr.height); }
    pop.style.left=left+'px'; pop.style.top=top+'px';
    openPop=pop; openBtn=btn;
    if(search){ search.addEventListener('input',function(){ draw(search.value); }); setTimeout(function(){ try{search.focus();}catch(e){} },0); }
    else { var selRow=list.querySelector('.selx-opt.selx-on'); if(selRow) selRow.scrollIntoView({block:'nearest'}); }
    cleanup=function(ev){ if(!pop.contains(ev.target) && ev.target!==btn && !btn.contains(ev.target)) closePop(); };
    document.addEventListener('mousedown',cleanup,true);
    document.addEventListener('keydown',onKey,true);
    window.addEventListener('resize',closePop);
    window.addEventListener('scroll',onScroll,true);
  }
  var timer=null;
  function scan(){ try{ document.querySelectorAll('select:not([data-selx])').forEach(enhance); }catch(e){} }
  function schedule(){ if(timer) return; timer=setTimeout(function(){ timer=null; scan(); },100); }
  function boot(){
    scan();
    try{ new MutationObserver(function(muts){ for(var i=0;i<muts.length;i++){ var a=muts[i].addedNodes; if(!a) continue; for(var j=0;j<a.length;j++){ var n=a[j]; if(n.nodeType===1 && (n.tagName==='SELECT' || (n.querySelector && n.querySelector('select:not([data-selx])')))){ schedule(); return; } } } }).observe(document.body,{childList:true,subtree:true}); }catch(e){}
    setInterval(function(){ try{ document.querySelectorAll('select[data-selx="1"]').forEach(function(s){
      var b=s.__selxBtn; if(!b) return; var v=b.querySelector('.selx-val'); if(!v) return;
      if(s.dataset.multi==='1'){
        var a=[]; try{ a=JSON.parse(s.dataset.values||'[]'); }catch(e){}
        var first=s.options[0]?(s.options[0].textContent||'').trim():'All';
        var l=a.length===0?first:(a.length===1?a[0]:(a.length+' selected'));
        if(v.textContent!==l) v.textContent=l;
        return;
      }
      var l2=labelOf(s)||b.getAttribute('data-ph')||'Select\u2026';
      if(v.textContent!==l2){ v.textContent=l2; var o=s.options[s.selectedIndex]; v.style.color=(o&&o.style&&o.style.color)||''; }
    }); }catch(e){} }, 700);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();

