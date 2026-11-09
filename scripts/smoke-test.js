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
        try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) {
          parsed = chunks;
        }
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

    // Material Inbounds (Material Datang ke Gudang)
    const inbRes = await req('POST', '/api/material-inbounds', {
      material_id: 'mat-seed-001',
      qty: 50,
      supplier: 'PT Pabrik Tiang Maju',
      received_date: '2026-11-04',
      notes: 'Surat Jalan #SJ-9981'
    }, PM_AUTH);
    check('POST /api/material-inbounds (pm) -> 201', inbRes.status === 201 && inbRes.body.success);
    const inbId = inbRes.body && inbRes.body.inbound ? inbRes.body.inbound.id : 'inb-none';

    const matsAfterInb = await req('GET', '/api/materials', null, AUTH);
    const mat001 = matsAfterInb.body.find(m => m.id === 'mat-seed-001');
    check('stok gudang bertambah otomatis (+50)', !!mat001 && mat001.stock_qty >= 50);

    const inbList = await req('GET', '/api/material-inbounds', null, AUTH);
    check('GET /api/material-inbounds -> 200 + array', inbList.status === 200 && inbList.body.length >= 1);

    // Bon Requests (Antrean Request Pending dari Telegram/Lapangan)
    const bonReqRes = await req('POST', '/api/bon-requests', {
      project_id: 'proj-test',
      items: [{
        material_id: 'mat-seed-001',
        name: 'Tiang Beton 7m',
        category: 'Tiang',
        variant: '7m',
        unit: 'btg',
        qty_planned: 15
      }],
      notes: 'Tambahan tiang untuk jalan sempit'
    }, AUTH);
    check('POST /api/bon-requests -> 201 (status Pending)', bonReqRes.status === 201 && bonReqRes.body.request.status === 'Pending');
    const reqId = bonReqRes.body && bonReqRes.body.request ? bonReqRes.body.request.id : 'req-none';

    const pendingList = await req('GET', '/api/bon-requests?status=Pending', null, AUTH);
    check('GET /api/bon-requests?status=Pending -> 1 request', pendingList.status === 200 && pendingList.body.some(r => r.id === reqId));

    // Approval PM atas Request Bon
    const approveRes = await req('POST', `/api/bon-requests/${reqId}/approve`, {}, PM_AUTH);
    check('POST /api/bon-requests/:id/approve (pm) -> 200', approveRes.status === 200 && approveRes.body.request.status === 'Disetujui');
    const activeBonId = approveRes.body && approveRes.body.bon ? approveRes.body.bon.id : ('bon-proj-test');

    // Cek bahwa item request otomatis masuk ke bon_material WO terkait
    const bonMerged = await req('GET', `/api/bon-material/${activeBonId}`, null, AUTH);
    const mergedItem = bonMerged.body && bonMerged.body.items ? bonMerged.body.items.find(it => it.material_id === 'mat-seed-001') : null;
    check('item request ter-merge ke bon_material (qty_planned=15)', !!mergedItem && mergedItem.qty_planned === 15);

    // Pengurangan stok gudang manual berdasarkan realisasi pemasangan lapangan (qty_used)
    const stockBeforeUsed = mat001.stock_qty;
    const bonInstallUpdate = await req('PUT', `/api/bon-material/${activeBonId}`, {
      items: [{
        material_id: 'mat-seed-001',
        name: 'Tiang Beton 7m',
        category: 'Tiang',
        variant: '7m',
        unit: 'btg',
        qty_planned: 15,
        qty_arrived: 15,
        qty_used: 10 // Pemasangan di lapangan 10 btg
      }]
    }, PM_AUTH);
    check('PUT /api/bon-material dengan qty_used -> 200', bonInstallUpdate.status === 200);

    const matsAfterUsed = await req('GET', '/api/materials', null, AUTH);
    const mat001AfterUsed = matsAfterUsed.body.find(m => m.id === 'mat-seed-001');
    check('stok gudang terpotong manual sesuai yang terpasang (-10)', !!mat001AfterUsed && mat001AfterUsed.stock_qty === (stockBeforeUsed - 10));

    // Telegram Users Management
    const addTgUser = await req('POST', '/api/telegram-users', {
      telegram_id: '123456789',
      name: 'Rudi Teknisi',
      role: 'teknisi'
    }, AUTH);
    check('POST /api/telegram-users (superadmin) -> 201', addTgUser.status === 201 && addTgUser.body.success);

    const tgUsersList = await req('GET', '/api/telegram-users', null, AUTH);
    check('GET /api/telegram-users -> array berisi user baru', tgUsersList.status === 200 && tgUsersList.body.some(u => u.telegram_id === '123456789'));

    const delTgUser = await req('DELETE', '/api/telegram-users/123456789', null, AUTH);
    check('DELETE /api/telegram-users/:id -> 200', delTgUser.status === 200 && delTgUser.body.success);

    // =============================================================
    // MASTER EKSEKUTOR CRUD & PROTEKSI WO AKTIF
    // =============================================================
    const newExecInternal = await req('POST', '/api/executors', {
      name: 'Tim Internal Charlie',
      type: 'Internal',
      phone: '0812-3344-5566',
      pic: 'Koordinator Dian',
      wilayah: 'Surabaya Timur',
      fleet_no: 'L-1234-AB / GranMax',
      standard_rates: 'Uang Jalan: Rp 450.000/hari + BBM',
      specialization: 'FTTH OSP & Splicing',
      status: 'Aktif'
    }, PM_AUTH);
    check('POST /api/executors (Internal, pm) -> 201', newExecInternal.status === 201 && newExecInternal.body.success);
    const intExecId = newExecInternal.body.executor.id;

    const newExecMandor = await req('POST', '/api/executors', {
      name: 'Mandor Joko Subkon',
      type: 'Mandor',
      phone: '0857-9988-7766',
      pic: 'Joko Susilo',
      wilayah: 'Sidoarjo',
      fleet_no: '-',
      standard_rates: 'Tiang: Rp 65.000/btg | Tarik KU: Rp 1.800/m',
      specialization: 'Tanam Tiang & Penarikan Kabel',
      status: 'Standby'
    }, PM_AUTH);
    check('POST /api/executors (Mandor, pm) -> 201', newExecMandor.status === 201 && newExecMandor.body.success);
    const mandorExecId = newExecMandor.body.executor.id;

    // Cek GET /api/executors bahwa data fleet_no & standard_rates tersimpan utuh
    const execList = await req('GET', '/api/executors', null, AUTH);
    const foundInt = execList.body.find(e => e.id === intExecId);
    check('GET /api/executors menyimpan fleet_no & standard_rates', !!foundInt && foundInt.fleet_no === 'L-1234-AB / GranMax' && foundInt.standard_rates.includes('450.000'));

    // PUT /api/executors/:id update fields (type, fleet_no, standard_rates, status)
    const updateExec = await req('PUT', `/api/executors/${intExecId}`, {
      fleet_no: 'L-9999-ZZ / Luxio Baru',
      status: 'Standby',
      standard_rates: 'Uang Jalan: Rp 500.000/hari + BBM'
    }, PM_AUTH);
    check('PUT /api/executors/:id (pm) -> 200', updateExec.status === 200 && updateExec.body.success);

    const execListAfterPut = await req('GET', '/api/executors', null, AUTH);
    const foundUpdatedInt = execListAfterPut.body.find(e => e.id === intExecId);
    check('PUT berhasil memperbarui fleet_no & status', !!foundUpdatedInt && foundUpdatedInt.fleet_no === 'L-9999-ZZ / Luxio Baru' && foundUpdatedInt.status === 'Standby');

    // Role check: PM DELETE -> 403 Forbidden
    const delPmForbidden = await req('DELETE', `/api/executors/${intExecId}`, null, PM_AUTH);
    check('DELETE /api/executors/:id (pm) -> 403 Forbidden', delPmForbidden.status === 403);

    // Proteksi WO aktif: Buat WO baru yang ditugaskan ke mandorExecId
    const projWithExec = await req('POST', '/api/projects', {
      wo_number: 'WO-ACTIVE-EXEC-001',
      client_name: 'Telkom Akses',
      cluster_name: 'Klaster Rungkut',
      executor_type: 'Mandor',
      executor_id: mandorExecId,
      contract_value: 100000000,
      mandor_cost: 60000000,
      target_date: '2026-12-01'
    }, PM_AUTH);
    check('POST /api/projects dengan executor_id -> 201', projWithExec.status === 201);

    // Coba hapus eksekutor yang punya active WO -> Ditolak 400 Bad Request
    const delBlocked = await req('DELETE', `/api/executors/${mandorExecId}`, null, AUTH);
    check('DELETE eksekutor yang punya WO aktif -> 400 Bad Request (terproteksi)', delBlocked.status === 400 && delBlocked.body.message.includes('WO aktif'));

    // Hapus eksekutor bebas WO (intExecId) oleh Superadmin -> Berhasil 200
    const delSuccess = await req('DELETE', `/api/executors/${intExecId}`, null, AUTH);
    check('DELETE eksekutor tanpa WO (superadmin) -> 200 OK', delSuccess.status === 200 && delSuccess.body.success);

    // =============================================================
    // INVOICE / CASHFLOW: JATUH TEMPO OTOMATIS 2 BULAN & WORK ORDER
    // =============================================================
    const newInvoice = await req('POST', '/api/invoices', {
      project_id: 'proj-test',
      wo_number: 'WO-TEST-001',
      client_name: 'Klien Uji',
      term_name: 'Klaster Uji (Nama Work Order)',
      amount: 50000000,
      invoice_date: '2026-11-01'
    }, FIN_AUTH);
    check('POST /api/invoices (finance) -> 201', newInvoice.status === 201);
    check('Jatuh tempo otomatis 2 bulan setelah invoice_date (2027-01-01)', newInvoice.body.due_date === '2027-01-01');
    check('Nama Work Order tersimpan di invoice term_name', newInvoice.body.term_name === 'Klaster Uji (Nama Work Order)');
    check('Nomor SP tersimpan di invoice sp_number', newInvoice.body.sp_number === 'WO-TEST-001');
    const testInvId = newInvoice.body.id;

    // CRUD INVOICE: PUT /api/invoices/:id & DELETE /api/invoices/:id
    const editInvRes = await req('PUT', `/api/invoices/${testInvId}`, {
      amount: 65000000,
      term_name: 'Klaster Uji Termin 1 Revisi',
      sp_number: 'SP-REVISI-001'
    }, FIN_AUTH);
    check('PUT /api/invoices/:id (finance) -> 200', editInvRes.status === 200 && editInvRes.body.success);
    check('Invoice amount berhasil diupdate menjadi 65.000.000', editInvRes.body.invoice.amount === 65000000);
    check('Invoice sp_number berhasil diupdate menjadi SP-REVISI-001', editInvRes.body.invoice.sp_number === 'SP-REVISI-001');

    const delInvRes = await req('DELETE', `/api/invoices/${testInvId}`, null, FIN_AUTH);
    check('DELETE /api/invoices/:id (finance) -> 200', delInvRes.status === 200 && delInvRes.body.success);

    // Test Manual ID INVOICE Input & Conflict Check
    const manualInv = await req('POST', '/api/invoices', {
      id: 'INV/2026/XI/0099',
      project_id: 'proj-test',
      wo_number: 'WO-TEST-MANUAL-ID',
      client_name: 'Telkom Akses',
      term_name: 'Pekerjaan Termin Manual ID',
      amount: 75000000,
      invoice_date: '2026-11-05'
    }, FIN_AUTH);
    check('POST /api/invoices dengan ID manual -> 201', manualInv.status === 201 && manualInv.body.id === 'INV/2026/XI/0099');
    check('Status default invoice baru adalah Belum Cashbank', manualInv.body.status === 'Belum Cashbank');

    // Test transisi status: menekan tombol Lunas -> berubah menjadi Sudah Cashbank
    const payCashbankRes = await req('PUT', `/api/invoices/${encodeURIComponent('INV/2026/XI/0099')}/status`, {
      status: 'Sudah Cashbank'
    }, FIN_AUTH);
    check('PUT status invoice menjadi Sudah Cashbank -> 200', payCashbankRes.status === 200 && payCashbankRes.body.status === 'Sudah Cashbank');
    check('Invoice Sudah Cashbank mencatat paid_date', !!payCashbankRes.body.paid_date);

    const duplicateIdInv = await req('POST', '/api/invoices', {
      id: 'INV/2026/XI/0099',
      project_id: 'proj-test',
      wo_number: 'WO-TEST-DUPLICATE',
      client_name: 'Telkom Akses',
      term_name: 'Pekerjaan Termin Duplicate ID',
      amount: 25000000,
      invoice_date: '2026-11-05'
    }, FIN_AUTH);
    check('POST /api/invoices dengan ID duplikat -> 409 Conflict', duplicateIdInv.status === 409);

    // Verifikasi dynamic monthlyRevenue di Executive Dashboard
    const statsRes = await req('GET', '/api/dashboard/stats', null, AUTH);
    check('GET /api/dashboard/stats -> 200', statsRes.status === 200);
    check('monthlyRevenue adalah array 6 bulan', Array.isArray(statsRes.body.monthlyRevenue) && statsRes.body.monthlyRevenue.length === 6);
    check('revenueTrends memuat periode 3m, 6m, 1y', !!statsRes.body.revenueTrends && statsRes.body.revenueTrends['3m'].length === 3 && statsRes.body.revenueTrends['6m'].length === 6 && statsRes.body.revenueTrends['1y'].length === 12);
    const stats3m = await req('GET', '/api/dashboard/stats?months=3', null, AUTH);
    check('GET /api/dashboard/stats?months=3 -> 3 bulan', stats3m.body.monthlyRevenue.length === 3);
    const stats1y = await req('GET', '/api/dashboard/stats?months=12', null, AUTH);
    check('GET /api/dashboard/stats?months=12 -> 12 bulan (1 tahun)', stats1y.body.monthlyRevenue.length === 12);
    const targetMonth = statsRes.body.monthlyRevenue.find(m => m.key === '2026-11');
    check('monthlyRevenue 2026-11 menghitung billed dinamis (>= 75 jt)', !!targetMonth && targetMonth.billed >= 75000000);
    check('monthlyRevenue 2026-11 menghitung received dinamis (>= 75 jt)', !!targetMonth && targetMonth.received >= 75000000);

    await req('DELETE', `/api/invoices/${encodeURIComponent('INV/2026/XI/0099')}`, null, FIN_AUTH);

    // =============================================================
    // MANDOR PAYOUTS / KAS KELUAR CRUD
    // =============================================================
    const newPayout = await req('POST', '/api/mandor-payouts', {
      project_id: 'proj-test',
      mandor_name: 'Mandor Bambang',
      milestone_stage: 'Penarikan Kabel (KU Fiber)',
      amount: 15000000,
      notes: 'Klaim penarikan kabel jalur utama'
    }, PM_AUTH);
    check('POST /api/mandor-payouts (pm) -> 201', newPayout.status === 201 && newPayout.body.success);
    const testPayoutId = newPayout.body.payout.id;

    const editPayoutRes = await req('PUT', `/api/mandor-payouts/${testPayoutId}`, {
      amount: 18000000,
      notes: 'Klaim revisi penarikan kabel jalur utama + drop core'
    }, FIN_AUTH);
    check('PUT /api/mandor-payouts/:id (finance) -> 200', editPayoutRes.status === 200 && editPayoutRes.body.success);
    check('Payout amount berhasil diupdate menjadi 18.000.000', editPayoutRes.body.payout.amount === 18000000);

    const delPayoutRes = await req('DELETE', `/api/mandor-payouts/${testPayoutId}`, null, PM_AUTH);
    check('DELETE /api/mandor-payouts/:id (pm) -> 200', delPayoutRes.status === 200 && delPayoutRes.body.success);

    // =============================================================
    // SP/PO MASTER & RELASI 1 SP TO N PEKERJAAN (WORK ORDERS)
    // =============================================================
    const spListRes = await req('GET', '/api/sp-orders', null, AUTH);
    check('GET /api/sp-orders -> 200 + array', spListRes.status === 200 && Array.isArray(spListRes.body));

    const postSpRes = await req('POST', '/api/sp-orders', {
      sp_number: 'SP-TEST-MULTI-999',
      client_name: 'Telkom Akses',
      notes: 'SP Uji Multi Pekerjaan'
    }, PM_AUTH);
    check('POST /api/sp-orders -> 201', postSpRes.status === 201 && postSpRes.body.success);
    const multiSpId = postSpRes.body.sp.id;

    // Tambah Pekerjaan 1 di bawah SP-TEST-MULTI-999
    const job1Res = await req('POST', '/api/projects', {
      sp_number: 'SP-TEST-MULTI-999',
      job_name: 'Pekerjaan Tarik Feeder Rungkut',
      client_name: 'Telkom Akses',
      executor_type: 'Mandor',
      contract_value: 120000000,
      mandor_cost: 65000000,
      target_date: '2026-12-15'
    }, PM_AUTH);
    check('POST /api/projects Job 1 -> 201', job1Res.status === 201);

    // Tambah Pekerjaan 2 di bawah SP-TEST-MULTI-999 yang sama
    const job2Res = await req('POST', '/api/projects', {
      sp_number: 'SP-TEST-MULTI-999',
      job_name: 'Pekerjaan Distribusi Klaster A',
      client_name: 'Telkom Akses',
      executor_type: 'Internal',
      contract_value: 180000000,
      mandor_cost: 85000000,
      target_date: '2026-12-30'
    }, PM_AUTH);
    check('POST /api/projects Job 2 -> 201', job2Res.status === 201);

    // Cek GET /api/sp-orders apakah mengakumulasi 2 pekerjaan dan total BOQ 300 juta
    const spCheckList = await req('GET', '/api/sp-orders', null, AUTH);
    const multiSp = spCheckList.body.find(s => s.sp_number === 'SP-TEST-MULTI-999');
    check('SP memiliki job_count = 2', !!multiSp && multiSp.job_count === 2);
    check('SP mengakumulasi total_boq = 300.000.000', !!multiSp && multiSp.total_boq === 300000000);
    check('SP mengakumulasi total_hpp = 150.000.000', !!multiSp && multiSp.total_hpp === 150000000);
    check('SP menghitung margin_percent = 50.0%', !!multiSp && multiSp.margin_percent === 50);

    // Proteksi: DELETE SP yang masih memiliki pekerjaan aktif -> 400 Bad Request
    const delSpBlocked = await req('DELETE', `/api/sp-orders/${multiSpId}`, null, AUTH);
    check('DELETE SP dengan pekerjaan aktif -> 400 Bad Request', delSpBlocked.status === 400);

    // =============================================================
    // FITUR EKSEKUTOR HYBRID / MIXING PER-MILESTONE
    // =============================================================
    const mixMandorRes = await req('POST', '/api/executors', {
      name: 'Mandor Mixing Tarik',
      type: 'Mandor',
      phone: '0812-9911-2233',
      pic: 'Mandor Tarik',
      wilayah: 'Gresik',
      status: 'Aktif'
    }, PM_AUTH);
    const mixMandorId = mixMandorRes.body.executor.id;

    const mixInternalRes = await req('POST', '/api/executors', {
      name: 'Tim Internal Splicing Delta',
      type: 'Internal',
      phone: '0813-8822-4455',
      pic: 'Koor Splicer',
      wilayah: 'Surabaya',
      status: 'Aktif'
    }, PM_AUTH);
    const mixInternalId = mixInternalRes.body.executor.id;

    const mixedProjRes = await req('POST', '/api/projects', {
      sp_number: 'SP-MIXING-FTTH-001',
      job_name: 'Pekerjaan FTTH Campuran Gresik',
      client_name: 'Telkom Akses',
      executor_type: 'Campuran',
      contract_value: 80000000,
      target_date: '2026-12-31',
      milestones_config: [
        {
          stage_name: 'Penanaman Tiang',
          executor_type: 'Mandor',
          executor_id: mixMandorId,
          stage_cost: 15000000
        },
        {
          stage_name: 'Penarikan KU Fiber',
          executor_type: 'Mandor',
          executor_id: mixMandorId,
          stage_cost: 25000000
        },
        {
          stage_name: 'Instalasi ODP & Splicing',
          executor_type: 'Internal',
          executor_id: mixInternalId,
          stage_cost: 0
        },
        {
          stage_name: 'Testing & ATP',
          executor_type: 'Internal',
          executor_id: mixInternalId,
          stage_cost: 0
        }
      ]
    }, PM_AUTH);
    check('POST /api/projects Campuran -> 201', mixedProjRes.status === 201);
    const mixedProj = mixedProjRes.body;
    check('Project Campuran auto-sum mandor_cost (40.000.000)', mixedProj.mandor_cost === 40000000);
    check('Project Campuran memiliki executor_type Campuran', mixedProj.executor_type === 'Campuran');

    const getMixedList = await req('GET', `/api/projects?client=Telkom Akses`, null, AUTH);
    const foundMixed = getMixedList.body.find(p => p.id === mixedProj.id);
    check('GET /api/projects memuat 4 milestone dengan executor masing-masing', !!foundMixed && foundMixed.milestones.length === 4);
    const m1 = foundMixed.milestones.find(m => m.stage_name === 'Penanaman Tiang');
    const m3 = foundMixed.milestones.find(m => m.stage_name === 'Instalasi ODP & Splicing');
    check('Milestone 1 disimpan dengan Mandor & stage_cost 15jt', !!m1 && m1.executor_type === 'Mandor' && m1.executor_name === 'Mandor Mixing Tarik' && m1.stage_cost === 15000000);
    check('Milestone 3 disimpan dengan Internal & stage_cost 0', !!m3 && m3.executor_type === 'Internal' && m3.executor_name === 'Tim Internal Splicing Delta' && m3.stage_cost === 0);

    // PUT /api/milestones/:id dapat mengupdate executor tahapan
    const putMilestoneRes = await req('PUT', `/api/milestones/${m1.id}`, {
      status: 'In-Progress',
      stage_cost: 16000000
    }, PM_AUTH);
    check('PUT /api/milestones/:id update stage_cost -> 200', putMilestoneRes.status === 200 && putMilestoneRes.body.stage_cost === 16000000);

    // Proteksi DELETE eksekutor yang aktif di milestone pengerjaan
    const delMixMandorBlocked = await req('DELETE', `/api/executors/${mixMandorId}`, null, AUTH);
    check('DELETE eksekutor aktif di milestone -> 400 Bad Request', delMixMandorBlocked.status === 400);

    // SOP Anti-Boncos: Ketika seluruh milestone Done, kas keluar hanya dibuat untuk Mandor (bukan internal)
    for (const ms of foundMixed.milestones) {
      await req('PUT', `/api/milestones/${ms.id}`, { status: 'Done', progress_percent: 100 }, PM_AUTH);
    }
    const payoutsListRes = await req('GET', '/api/mandor-payouts', null, FIN_AUTH);
    const autoPayouts = payoutsListRes.body.filter(p => p.project_id === mixedProj.id);
    check('Auto-payout SOP Anti-Boncos hanya terbit untuk Mandor', autoPayouts.length === 1 && autoPayouts[0].mandor_name === 'Mandor Mixing Tarik');
    check('Auto-payout nominal sesuai akumulasi upah mandor (41 jt)', autoPayouts[0].amount === 41000000);

    // Dashboard Stats menghitung mixedCount & mixedValue
    const statsMixedRes = await req('GET', '/api/dashboard/stats', null, AUTH);
    check('Dashboard stats menghitung mixedCount >= 1', statsMixedRes.body.executorBreakdown.mixedCount >= 1);
    check('Dashboard stats menghitung mixedValue >= 80jt', statsMixedRes.body.executorBreakdown.mixedValue >= 80000000);

    // =============================================================
    // FITUR MODE GELAP (DARK MODE) INTEGRITY TEST
    // =============================================================
    const dashHtmlRes = await req('GET', '/dashboard.html', null, null);
    check('GET /dashboard.html -> 200', dashHtmlRes.status === 200);
    const dashHtmlText = typeof dashHtmlRes.body === 'string' ? dashHtmlRes.body : JSON.stringify(dashHtmlRes.body);
    check('dashboard.html memuat konfigurasi darkMode: class', dashHtmlText.includes("darkMode: 'class'"));
    check('dashboard.html memuat tombol btnThemeToggle', dashHtmlText.includes('btnThemeToggle'));
    check('dashboard.html memuat icon themeIconSun dan themeIconMoon', dashHtmlText.includes('themeIconSun') && dashHtmlText.includes('themeIconMoon'));
    check('dashboard.html memuat header tabel tagihan kas masuk baru', dashHtmlText.includes('ID Invoice') && dashHtmlText.includes('Nomor SP/PO') && dashHtmlText.includes('Pekerjaan WO') && dashHtmlText.includes('Umur SP') && dashHtmlText.includes('Nominal Total (Rp)'));
    check('dashboard.html memuat label Estimasi Laba Bersih & Net Margin', dashHtmlText.includes('Estimasi Laba Bersih') && dashHtmlText.includes('Net Margin'));

    const appJsRes = await req('GET', '/app.js', null, null);
    check('GET /app.js -> 200', appJsRes.status === 200);
    const appJsText = typeof appJsRes.body === 'string' ? appJsRes.body : JSON.stringify(appJsRes.body);
    check('app.js memuat fungsi toggleTheme & isDarkMode', appJsText.includes('function toggleTheme') && appJsText.includes('function isDarkMode'));

    const indexHtmlRes = await req('GET', '/index.html', null, null);
    check('GET /index.html -> 200', indexHtmlRes.status === 200);
    const indexHtmlText = typeof indexHtmlRes.body === 'string' ? indexHtmlRes.body : JSON.stringify(indexHtmlRes.body);
    check('index.html memuat toggleIndexTheme', indexHtmlText.includes('toggleIndexTheme'));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  } finally {
    child.kill();
    try { fs.unlinkSync(TMP_DB); } catch (_) {}
  }
})();
