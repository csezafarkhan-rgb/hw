#!/usr/bin/env node
/**
 * Homeweavers Workspace — Express server.
 * Serves the single-file workspace at http://localhost:3000/.
 *
 * Usage:  npm start
 *         PORT=8080 npm start   (override the port)
 *
 * All data (users, containers, products, etc.) lives in the visiting
 * browser's IndexedDB — the server just delivers the HTML. This means:
 *   • zero-config: no database to configure
 *   • per-browser data: each device / browser has its own state
 *   • fully offline once loaded
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT = __dirname;
const WORKSPACE_FILE = path.join(ROOT, 'Homeweavers_Workspace.html');

if (!fs.existsSync(WORKSPACE_FILE)) {
  console.error('');
  console.error('  ✗ ' + WORKSPACE_FILE);
  console.error('    is missing. Build it first with:');
  console.error('');
  console.error('    npm run build');
  console.error('');
  process.exit(1);
}

// Root: serve the workspace.
app.get('/', (_req, res) => {
  res.sendFile(WORKSPACE_FILE);
});

// Health / info endpoint.
app.get('/health', (_req, res) => {
  const stat = fs.statSync(WORKSPACE_FILE);
  res.json({
    status: 'ok',
    workspace: {
      exists: true,
      bytes: stat.size,
      mb: +(stat.size / 1048576).toFixed(2),
      lastBuild: stat.mtime.toISOString(),
    },
    node: process.version,
    uptime: Math.round(process.uptime()),
  });
});

// Optional: direct access to individual source dashboards for debugging.
app.use('/source', express.static(ROOT, {
  index: false,
  extensions: ['html'],
  setHeaders(res) { res.set('Cache-Control', 'no-store'); },
}));

// Sample data (Excel workbook the Container Tracker can import).
app.use('/sample-data', express.static(path.join(ROOT, 'sample-data')));

app.listen(PORT, () => {
  const stat = fs.statSync(WORKSPACE_FILE);
  console.log('');
  console.log('  Homeweavers Workspace');
  console.log('  ' + '─'.repeat(60));
  console.log('  Running at    http://localhost:' + PORT);
  console.log('  Workspace     ' + (stat.size / 1048576).toFixed(1) + ' MB · built '
              + stat.mtime.toISOString().slice(0, 19).replace('T', ' '));
  console.log('  Health check  http://localhost:' + PORT + '/health');
  console.log('');
  console.log('  Default login: admin / homeweavers123');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
