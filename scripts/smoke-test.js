#!/usr/bin/env node
/**
 * Smoke test kontrak API. Pakai DB sementara (terisolasi, TIDAK menyentuh data/db.json).
 * Jalankan: npm run smoke
 * Exit 0 = semua assertion lolos.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'FTTH_SECURE_TOKEN_SECRET_KEY_AKU_2026';
const TMP_DB = path.join(os.tmpdir(), `smoke-db-${Date.now()}.json`);

const jwt = require(path.join(ROOT, 'node_modules', 'jsonwebtoken'));
const token = (role) => jwt.sign({ id: 'smoke-' + role, role, name: 'Smoke ' + role }, JWT_SECRET, { expiresIn: '5m' });
const AUTH = { Authorization: `Bearer ${token('superadmin')}` };
const PM_AUTH = { Authorization: `Bearer ${token('pm')}` };
const FIN_AUTH = { Authorization: `Bearer ${token('finance')}` };

// Seed DB isolasi: satu proyek uji
fs.writeFileSync(TMP_DB, JSON.stringify({
  projects: [{ id: 'proj-test', wo_number: 'WO-TEST-001', client_name: 'Klien Uji', cluster_name: 'Klaster Uji', status: 'To-Do' }],
  executors: [], milestones: [], invoices: [], mandor_payouts: [], gallery: [], users: []
}, null, 2));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } };
    const r = http.request(`${BASE}${urlPath}`, opts, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await req('GET', '/api/gallery'); return true; } catch (_) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

(async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: TMP_DB },
    stdio: 'ignore',
  });
  try {
    const up = await waitForServer();
    check(`server boot di port ${PORT} (DB isolasi)`, up);
    if (!up) process.exit(1);

    // Endpoint hasil removal sebelumnya tetap 404
    check('GET /api/boq/:projectId -> 404', (await req('GET', '/api/boq/proj-1', null, AUTH)).status === 404);
    check('GET /api/drums -> 404', (await req('GET', '/api/drums', null, AUTH)).status === 404);

    // Material master
    const mats = await req('GET', '/api/materials', null, AUTH);
    check('GET /api/materials -> 200 + array', mats.status === 200 && Array.isArray(mats.body));
    check('material ter-seed >= 19', Array.isArray(mats.body) && mats.body.length >= 19);
    check('material punya field stok gudang', Array.isArray(mats.body) && mats.body.every(m => typeof m.stock_qty === 'number' && typeof m.min_stock === 'number'));

    const newMat = await req('POST', '/api/materials', { name: 'Konektor Uji', category: 'Lainnya', unit: 'pcs' }, PM_AUTH);
    check('POST /api/materials (pm) -> 201', newMat.status === 201 && !!newMat.body && newMat.body.material.id.startsWith('mat-'));
    const newMatId = (newMat.body && newMat.body.material && newMat.body.material.id) || 'mat-none';

    const matForbidden = await req('POST', '/api/materials', { name: 'X' }, FIN_AUTH);
    check('POST /api/materials (finance) -> 403', matForbidden.status === 403);

    const matUpdate = await req('PUT', `/api/materials/${newMatId}`, { name: 'Konektor Uji v2', stock_qty: 7 }, PM_AUTH);
    check('PUT /api/materials (pm) -> 200', matUpdate.status === 200);
    const matAfter = await req('GET', '/api/materials', null, AUTH);
    const updated = matAfter.body ? matAfter.body.find(m => m.name === 'Konektor Uji v2') : null;
    check('material ter-update', !!updated);
    check('stok material ter-update', !!updated && updated.stock_qty === 7);

    const matDelForbidden = await req('DELETE', `/api/materials/${newMatId}`, null, PM_AUTH);
    check('DELETE /api/materials (pm) -> 403', matDelForbidden.status === 403);

    const matDel = await req('DELETE', `/api/materials/${newMatId}`, null, AUTH);
    check('DELETE /api/materials (superadmin) -> 200', matDel.status === 200);

    // Bon material
    const bonList0 = await req('GET', '/api/bon-material', null, AUTH);
    check('GET /api/bon-material -> 200 + array', bonList0.status === 200 && Array.isArray(bonList0.body));

    const bonCreate = await req('POST', '/api/bon-material', { project_id: 'proj-test' }, PM_AUTH);
    check('POST /api/bon-material -> 201', bonCreate.status === 201 && !!bonCreate.body && bonCreate.body.bon.id.startsWith('bon-'));
    const bonId = (bonCreate.body && bonCreate.body.bon && bonCreate.body.bon.id) || 'bon-none';

    const bonDup = await req('POST', '/api/bon-material', { project_id: 'proj-test' }, PM_AUTH);
    check('POST /api/bon-material duplikat -> 409', bonDup.status === 409);

    const bonMissingWO = await req('POST', '/api/bon-material', { project_id: 'tidak-ada' }, PM_AUTH);
    check('POST /api/bon-material WO ngawur -> 404', bonMissingWO.status === 404);

    const bonNoAuth = await req('POST', '/api/bon-material', { project_id: 'proj-test' });
    check('POST /api/bon-material tanpa token -> 401', bonNoAuth.status === 401);

    const bonUpdate = await req('PUT', `/api/bon-material/${bonId}`, {
      items: [{
        material_id: 'mat-seed-001', name: 'Tiang Beton 7m', category: 'Tiang', variant: '7m', unit: 'btg',
        qty_planned: 10, qty_arrived: 10, qty_used: 4
      }]
    }, PM_AUTH);
    check('PUT /api/bon-material -> 200', bonUpdate.status === 200);
    check('sisa dihitung otomatis (10-4=6)', !!bonUpdate.body && bonUpdate.body.bon.items.length === 1 && bonUpdate.body.bon.items[0].qty_remaining === 6);

    const bonGet = await req('GET', `/api/bon-material/${bonId}`, null, AUTH);
    check('GET /api/bon-material/:id -> item tersimpan', bonGet.status === 200 && !!bonGet.body && bonGet.body.items.length === 1);

    const bonByWO = await req('GET', '/api/bon-material?project_id=proj-test', null, AUTH);
    check('GET /api/bon-material?project_id= -> 1 bon', bonByWO.status === 200 && !!bonByWO.body && bonByWO.body.length === 1);

    const bonStatus = await req('PUT', `/api/bon-material/${bonId}`, { status: 'Disetujui' }, PM_AUTH);
    check('PUT status bon -> Disetujui', bonStatus.status === 200 && !!bonStatus.body && bonStatus.body.bon.status === 'Disetujui');

    const bonDelForbidden = await req('DELETE', `/api/bon-material/${bonId}`, null, PM_AUTH);
    check('DELETE bon (pm) -> 403', bonDelForbidden.status === 403);

    const bonDel = await req('DELETE', `/api/bon-material/${bonId}`, null, AUTH);
    check('DELETE bon (superadmin) -> 200', bonDel.status === 200);

    // Regresi endpoint inti
    check('GET /api/gallery -> 200', (await req('GET', '/api/gallery')).status === 200);
    const proj = await req('GET', '/api/projects', null, AUTH);
    check('GET /api/projects -> 200 + array', proj.status === 200 && Array.isArray(proj.body));
    check('GET /api/projects tanpa token -> 401', (await req('GET', '/api/projects')).status === 401);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  } finally {
    child.kill();
    try { fs.unlinkSync(TMP_DB); } catch (_) {}
  }
})();
