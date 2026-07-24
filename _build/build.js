#!/usr/bin/env node
/**
 * Homeweavers Workspace build pipeline (Node.js port of build.py).
 *
 * Reads the 6 source dashboards from the project root, re-injects the
 * shared assets from _build/ (glass.css into <style id="__hwGlass">,
 * selx.js into the __selxInit script, imgseed.js into Products,
 * att_compact.css into Attendance), base64-encodes each source, and
 * writes them into parent_template.html to produce
 * Homeweavers_Workspace.html.
 *
 * Run after editing any source file:  node _build/build.js
 * Validate JS first:                  node --check <file>.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const OUT = path.dirname(HERE);

const SOURCES = {
  INVENTORY:  'Inventory_Live_Dashboard.html',
  PRODUCTS:   'Homeweavers_Products.html',
  ORDERS:     'Homeweavers_Orders.html',
  FINANCIAL:  'Financial_Performance_Dashboard.html',
  ATTENDANCE: 'attendance-dashboard.html',
  CONTAINERS: 'Homeweavers_Containers.html',
};

const read  = p => fs.readFileSync(p, 'utf-8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf-8');
const die   = m => { console.error(m); process.exit(1); };

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function injectStyle(html, styleId, css, srcName) {
  const pat = new RegExp('(<style id="' + escRe(styleId) + '">)([\\s\\S]*?)(</style>)');
  let count = 0;
  const out = html.replace(pat, (_, open, _mid, close) => { count++; return open + css + close; });
  if (count !== 1) die(`build.js: expected exactly one <style id="${styleId}"> in ${srcName} (found ${count})`);
  return out;
}

function injectSelx(html, selx, srcName) {
  // Match every non-text/plain script tag; keep only those whose body mentions __selxInit.
  const scriptPat = /<script(?![^>]*text\/plain)[^>]*>([\s\S]*?)<\/script>/g;
  const hits = [];
  let m;
  while ((m = scriptPat.exec(html)) !== null) {
    if (m[1].indexOf('__selxInit') >= 0) hits.push({ index: m.index, full: m[0], inner: m[1] });
  }
  if (hits.length !== 1) die(`build.js: expected exactly one __selxInit script in ${srcName} (found ${hits.length})`);
  const hit = hits[0];
  const innerStartInFull = hit.full.indexOf(hit.inner);
  const openTag  = hit.full.slice(0, innerStartInFull);
  const closeTag = hit.full.slice(innerStartInFull + hit.inner.length);
  return html.slice(0, hit.index) + openTag + selx + closeTag + html.slice(hit.index + hit.full.length);
}

function injectScriptById(html, scriptId, js, srcName) {
  const pat = new RegExp('(<script id="' + escRe(scriptId) + '">)([\\s\\S]*?)(</script>)');
  let count = 0;
  const out = html.replace(pat, (_, open, _mid, close) => { count++; return open + js + close; });
  if (count !== 1) die(`build.js: expected exactly one <script id="${scriptId}"> in ${srcName} (found ${count})`);
  return out;
}

function main() {
  const glass       = read(path.join(HERE, 'glass.css'));
  const selx        = read(path.join(HERE, 'selx.js'));
  const imgseed     = read(path.join(HERE, 'imgseed.js'));
  const attCompact  = read(path.join(HERE, 'att_compact.css'));
  const childShim   = read(path.join(HERE, 'child_shim.js'));
  const loginGate   = read(path.join(HERE, 'login_gate.js'));
  const config      = read(path.join(HERE, 'config.js'));
  const template    = read(path.join(HERE, 'parent_template.html'));

  let out = template;
  for (const key of Object.keys(SOURCES)) {
    const fname = SOURCES[key];
    const fpath = path.join(OUT, fname);
    let html = read(fpath);

    html = injectStyle(html, '__hwGlass', glass, fname);
    html = injectSelx(html, selx, fname);
    if (key === 'PRODUCTS')   html = injectScriptById(html, '__hwImgSeed', imgseed, fname);
    if (key === 'ATTENDANCE') html = injectStyle(html, '__hwAttCompact', attCompact, fname);

    // Persist the re-injected source so what's on disk == what ships.
    write(fpath, html);

    const b64 = Buffer.from(html, 'utf-8').toString('base64');
    const token = `{{SRC_${key}}}`;
    if (out.indexOf(token) < 0) die(`build.js: token ${token} missing from parent_template.html`);
    out = out.replace(token, b64);
    console.log('  ' + fname.padEnd(38) + ' ' + String(html.length).padStart(9) + ' bytes -> b64 ' + String(b64.length).padStart(9));
  }

  if (out.indexOf('{{CHILD_SHIM}}') < 0) die('build.js: token {{CHILD_SHIM}} missing from parent_template.html');
  out = out.replace('{{CHILD_SHIM}}', childShim);

  if (out.indexOf('{{LOGIN_GATE}}') < 0) die('build.js: token {{LOGIN_GATE}} missing from parent_template.html');
  out = out.replace('{{LOGIN_GATE}}', loginGate);

  if (out.indexOf('{{CONFIG}}') < 0) die('build.js: token {{CONFIG}} missing from parent_template.html');
  out = out.replace('{{CONFIG}}', config);

  const target = path.join(OUT, 'Homeweavers_Workspace.html');
  write(target, out);
  console.log('OK  ' + target + '  (' + (out.length / 1048576).toFixed(1) + ' MB)');
}

main();
