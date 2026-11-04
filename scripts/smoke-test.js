#!/usr/bin/env node
/**
 * Smoke test kontrak API. Read-only terhadap data/db.json (GET saja).
 * Jalankan: npm run smoke   (atau: node scripts/smoke-test.js)
 * Exit 0 = semua assertion lolos.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'FTTH_SECURE_TOKEN_SECRET_KEY_AKU_2026';

const jwt = require(path.join(ROOT, 'node_modules', 'jsonwebtoken'));
const token = jwt.sign({ id: 'smoke-test', role: 'superadmin', name: 'Smoke' }, JWT_SECRET, { expiresIn: '5m' });

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}

function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${urlPath}`, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await get('/api/gallery'); return true; } catch (_) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

(async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  try {
    const up = await waitForServer();
    check(`server boot di port ${PORT}`, up);
    if (!up) process.exit(1);

    const boq = await get('/api/boq/proj-1', { Authorization: `Bearer ${token}` });
    check('GET /api/boq/:projectId -> 404 (fitur dihapus)', boq.status === 404);
    const drums = await get('/api/drums', { Authorization: `Bearer ${token}` });
    check('GET /api/drums -> 404 (fitur dihapus)', drums.status === 404);

    const gallery = await get('/api/gallery');
    check('GET /api/gallery -> 200 (publik, tetap ada)', gallery.status === 200);
    const projects = await get('/api/projects', { Authorization: `Bearer ${token}` });
    check('GET /api/projects -> 200 + array dengan token',
      projects.status === 200 && Array.isArray(JSON.parse(projects.body || '[]')));
    const noAuth = await get('/api/projects');
    check('GET /api/projects tanpa token -> 401', noAuth.status === 401);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  } finally {
    child.kill();
  }
})();
