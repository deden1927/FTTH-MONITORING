const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'FTTH_SECURE_TOKEN_SECRET_KEY_AKU_2026';
const JWT_EXPIRES_IN = '12h';

// -------------------------------------------------------------
// 1. SECURITY HEADERS & CORS
// -------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: false, // Memungkinkan asset CDN Tailwind dan Lucide bekerja
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin);
};

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('Origin tidak diizinkan oleh kebijakan CORS'));
  },
  credentials: true
}));

// -------------------------------------------------------------
// 2. RATE LIMITING & BODY PARSING
// -------------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak permintaan. Silakan coba kembali sesaat lagi.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak percobaan login. Akun dikunci sementara selama 15 menit.' }
});

app.use('/api/', generalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// 3. DATABASE HELPER (SAFE ATOMIC I/O)
// -------------------------------------------------------------
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { projects: [], executors: [], milestones: [], boq_items: [], drums: [], invoices: [], mandor_payouts: [], gallery: [], users: [] };
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading database:', err.message);
    return { projects: [], executors: [], milestones: [], boq_items: [], drums: [], invoices: [], mandor_payouts: [], gallery: [], users: [] };
  }
}

function writeDB(data) {
  const tempFile = `${DB_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
    return true;
  } catch (err) {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }
    console.error('Error writing database:', err.message);
    return false;
  }
}

// -------------------------------------------------------------
// 4. SECURITY HELPERS (PASSWORD, SANITIZATION, AUTH)
// -------------------------------------------------------------
function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function comparePassword(plain, hashed) {
  if (!hashed) return false;
  if (hashed.startsWith('$2a$') || hashed.startsWith('$2b$')) {
    return bcrypt.compareSync(plain, hashed);
  }
  return plain === hashed;
}

function sanitizeCSV(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  if (/^[=\+\-\@\t\r]/.test(str)) {
    str = "'" + str; // Mitigasi Formula Injection (CWE-1236)
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Akses ditolak: Token autentikasi tidak ditemukan.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ success: false, message: 'Akses ditolak: Sesi kedaluwarsa atau token tidak valid.' });
    }
    req.user = decoded; // { id, username, role, name }
    next();
  });
}

function requireRoles(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Akses ditolak: Memerlukan hak akses [${allowedRoles.join(', ')}]`
      });
    }
    next();
  };
}

// -------------------------------------------------------------
// 5. AUTHENTICATION API
// -------------------------------------------------------------
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });
  }

  const db = readDB();
  const user = (db.users || []).find(u => u.username === username);

  if (user && comparePassword(password, user.password)) {
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({
      success: true,
      token,
      user: payload
    });
  } else {
    res.status(401).json({ success: false, message: 'Username atau password salah!' });
  }
});

// -------------------------------------------------------------
// 6. USER MANAGEMENT API (SUPER ADMIN ONLY)
// -------------------------------------------------------------
app.get('/api/users', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  const safeUsers = (db.users || []).map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role }));
  res.json(safeUsers);
});

app.post('/api/users', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  const { username, password, name, role } = req.body;

  if (!username || !password || !name || !role) {
    return res.status(400).json({ success: false, message: 'Data formulir pengguna belum lengkap!' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password minimal 6 karakter!' });
  }

  if ((db.users || []).find(u => u.username === username)) {
    return res.status(400).json({ success: false, message: 'Username sudah digunakan!' });
  }

  const newUser = {
    id: Date.now(),
    username: String(username).trim(),
    password: hashPassword(password),
    name: String(name).trim(),
    role: String(role).trim()
  };

  db.users.push(newUser);
  writeDB(db);
  res.json({ success: true, message: 'User berhasil ditambahkan.' });
});

app.put('/api/users/:id/password', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  const { password } = req.body;
  const userId = parseInt(req.params.id);

  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter!' });
  }

  const userIndex = (db.users || []).findIndex(u => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
  }

  db.users[userIndex].password = hashPassword(password);
  writeDB(db);
  res.json({ success: true, message: 'Password berhasil direset.' });
});

app.delete('/api/users/:id', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  const userId = parseInt(req.params.id);

  const user = (db.users || []).find(u => u.id === userId);
  if (user && user.role === 'superadmin') {
    return res.status(403).json({ success: false, message: 'Tidak dapat menghapus akun Super Admin!' });
  }

  const newUsers = (db.users || []).filter(u => u.id !== userId);
  if (newUsers.length === (db.users || []).length) {
    return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
  }

  db.users = newUsers;
  writeDB(db);
  res.json({ success: true, message: 'User berhasil dihapus.' });
});

// -------------------------------------------------------------
// 7. DASHBOARD EXECUTIVE METRICS API
// -------------------------------------------------------------
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  const db = readDB();

  // 1. Total Pekerjaan Berjalan (Order Book)
  const totalOrderBook = (db.projects || []).reduce((acc, p) => acc + (p.contract_value || 0), 0);

  // 2. Total Kas Diterima YTD (dari invoice berstatus 'Lunas')
  const totalKasDiterima = (db.invoices || [])
    .filter(inv => inv.status === 'Lunas')
    .reduce((acc, inv) => acc + (inv.amount || 0), 0);

  // 3. Total Sisa Piutang Klien (invoice yang belum 'Lunas')
  const totalSisaPiutang = (db.invoices || [])
    .filter(inv => inv.status !== 'Lunas')
    .reduce((acc, inv) => acc + (inv.amount || 0), 0);

  // 4. Estimasi Laba Kotor Perusahaan
  const totalRevenue = totalOrderBook;
  const totalHPP = (db.projects || []).reduce((acc, p) => acc + (p.mandor_cost || 0), 0);
  const totalGrossMargin = totalRevenue - totalHPP;
  const grossMarginPercent = totalRevenue > 0 ? ((totalGrossMargin / totalRevenue) * 100).toFixed(1) : 0;

  // Monthly Revenue Trend
  const monthlyRevenue = [
    { month: 'Mei', billed: 450000000, received: 400000000 },
    { month: 'Jun', billed: 620000000, received: 550000000 },
    { month: 'Jul', billed: 780000000, received: 710000000 },
    { month: 'Agt', billed: 950000000, received: 850000000 },
    { month: 'Sep', billed: 1250000000, received: 980000000 },
    { month: 'Okt (Proj)', billed: 1450000000, received: 1100000000 }
  ];

  // Portofolio Klien
  const clientPortfolio = {};
  (db.projects || []).forEach(p => {
    clientPortfolio[p.client_name] = (clientPortfolio[p.client_name] || 0) + p.contract_value;
  });

  // Executor Breakdown (Internal vs Mandor)
  const executorBreakdown = {
    internalValue: (db.projects || []).filter(p => p.executor_type === 'Internal').reduce((a, b) => a + b.contract_value, 0),
    mandorValue: (db.projects || []).filter(p => p.executor_type === 'Mandor').reduce((a, b) => a + b.contract_value, 0),
    internalCount: (db.projects || []).filter(p => p.executor_type === 'Internal').length,
    mandorCount: (db.projects || []).filter(p => p.executor_type === 'Mandor').length
  };

  // Status Milestones count
  const milestoneCounts = {
    todo: (db.milestones || []).filter(m => m.status === 'To-Do').length,
    inProgress: (db.milestones || []).filter(m => m.status === 'In-Progress').length,
    blocked: (db.milestones || []).filter(m => m.status === 'Blocked').length,
    done: (db.milestones || []).filter(m => m.status === 'Done').length
  };

  res.json({
    totalOrderBook,
    totalKasDiterima,
    totalSisaPiutang,
    totalGrossMargin,
    grossMarginPercent,
    activeProjectsCount: (db.projects || []).length,
    monthlyRevenue,
    clientPortfolio,
    executorBreakdown,
    milestoneCounts
  });
});

// -------------------------------------------------------------
// 8. PROJECTS (WORK ORDERS) API
// -------------------------------------------------------------
app.get('/api/projects', authenticateToken, (req, res) => {
  const db = readDB();
  const { client, executor_type, status } = req.query;

  let list = (db.projects || []).map(proj => {
    const projMilestones = (db.milestones || []).filter(m => m.project_id === proj.id);
    const completedM = projMilestones.filter(m => m.status === 'Done').length;
    const totalM = projMilestones.length || 4;
    const progress = Math.round((completedM / totalM) * 100);

    return {
      ...proj,
      milestones: projMilestones,
      progress_percent: progress
    };
  });

  if (client && client !== 'All') {
    list = list.filter(p => p.client_name === client);
  }
  if (executor_type && executor_type !== 'All') {
    list = list.filter(p => p.executor_type === executor_type);
  }
  if (status && status !== 'All') {
    list = list.filter(p => p.status === status);
  }

  res.json(list);
});

app.post('/api/projects', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  const {
    wo_number,
    client_name,
    cluster_name,
    executor_type,
    executor_id,
    contract_value,
    mandor_cost,
    target_date
  } = req.body;

  if (!wo_number || !client_name) {
    return res.status(400).json({ error: 'Nomor WO dan Klien wajib diisi!' });
  }

  const executor = (db.executors || []).find(e => e.id === executor_id) || { name: 'Belum Ditentukan' };
  const val = Number(contract_value) || 0;
  const cost = Number(mandor_cost) || 0;
  const margin = val - cost;
  const marginPct = val > 0 ? Number(((margin / val) * 100).toFixed(1)) : 0;

  const newProjId = 'proj-' + (Date.now());
  const newProject = {
    id: newProjId,
    wo_number: String(wo_number).trim(),
    client_name: String(client_name).trim(),
    cluster_name: String(cluster_name || '').trim(),
    executor_type: executor_type || 'Mandor',
    executor_id: executor_id || '',
    executor_name: executor.name,
    contract_value: val,
    mandor_cost: cost,
    gross_margin: margin,
    margin_percent: marginPct,
    status: 'To-Do',
    target_date: target_date || '',
    created_at: new Date().toISOString().split('T')[0]
  };

  const defaultMilestones = [
    {
      id: `m-${newProjId}-1`,
      project_id: newProjId,
      stage_name: 'Penanaman Tiang',
      status: 'To-Do',
      progress_percent: 0,
      notes: 'Penyiapan perizinan ROW & koordinasi mandor.',
      blocked_reason: '',
      otdr_loss: '',
      opm_power: ''
    },
    {
      id: `m-${newProjId}-2`,
      project_id: newProjId,
      stage_name: 'Penarikan KU Fiber',
      status: 'To-Do',
      progress_percent: 0,
      notes: 'Menunggu alokasi drum kabel fiber.',
      blocked_reason: '',
      otdr_loss: '',
      opm_power: ''
    },
    {
      id: `m-${newProjId}-3`,
      project_id: newProjId,
      stage_name: 'Instalasi ODP & Splicing',
      status: 'To-Do',
      progress_percent: 0,
      notes: 'Menunggu kabel KU selesai ditarik.',
      blocked_reason: '',
      otdr_loss: '',
      opm_power: ''
    },
    {
      id: `m-${newProjId}-4`,
      project_id: newProjId,
      stage_name: 'Testing & ATP',
      status: 'To-Do',
      progress_percent: 0,
      notes: 'Uji OTDR & OPM setelah seluruh ODP terpasang.',
      blocked_reason: '',
      otdr_loss: '-',
      opm_power: '-'
    }
  ];

  if (!db.projects) db.projects = [];
  if (!db.milestones) db.milestones = [];

  db.projects.push(newProject);
  db.milestones.push(...defaultMilestones);
  writeDB(db);

  res.status(201).json(newProject);
});

app.delete('/api/projects/:id', authenticateToken, requireRoles(['direktur', 'superadmin']), (req, res) => {
  const db = readDB();
  const pId = req.params.id;
  const pIndex = (db.projects || []).findIndex(p => p.id === pId);
  if (pIndex === -1) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const deletedProject = db.projects.splice(pIndex, 1)[0];
  db.milestones = (db.milestones || []).filter(m => m.project_id !== pId);
  db.boq_items = (db.boq_items || []).filter(b => b.project_id !== pId);
  db.invoices = (db.invoices || []).filter(inv => inv.project_id !== pId);
  db.mandor_payouts = (db.mandor_payouts || []).filter(mp => mp.project_id !== pId);

  writeDB(db);
  res.json({ message: 'Project deleted successfully', deletedProject });
});

// -------------------------------------------------------------
// 9. MILESTONES API
// -------------------------------------------------------------
app.put('/api/milestones/:id', authenticateToken, requireRoles(['pm', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const mIndex = (db.milestones || []).findIndex(m => m.id === req.params.id);
  if (mIndex === -1) {
    return res.status(404).json({ error: 'Milestone not found' });
  }

  const { status, progress_percent, notes, blocked_reason, otdr_loss, opm_power } = req.body;
  if (status) db.milestones[mIndex].status = status;
  if (progress_percent !== undefined) db.milestones[mIndex].progress_percent = Number(progress_percent);
  if (notes !== undefined) db.milestones[mIndex].notes = String(notes);
  if (blocked_reason !== undefined) db.milestones[mIndex].blocked_reason = String(blocked_reason);
  if (otdr_loss !== undefined) db.milestones[mIndex].otdr_loss = String(otdr_loss);
  if (opm_power !== undefined) db.milestones[mIndex].opm_power = String(opm_power);

  // Auto-update overall project status based on milestones
  const pId = db.milestones[mIndex].project_id;
  const pMilestones = (db.milestones || []).filter(m => m.project_id === pId);
  const pIndex = (db.projects || []).findIndex(p => p.id === pId);

  if (pIndex !== -1) {
    if (pMilestones.some(m => m.status === 'Blocked')) {
      db.projects[pIndex].status = 'Blocked';
    } else if (pMilestones.every(m => m.status === 'Done')) {
      db.projects[pIndex].status = 'Done';

      // SOP Penguncian Anti Boncos: Auto-create Kas Keluar
      if (!db.mandor_payouts) db.mandor_payouts = [];
      const existingPayout = db.mandor_payouts.find(p => p.project_id === pId);
      if (!existingPayout) {
        db.mandor_payouts.push({
          id: 'pay-' + Date.now(),
          project_id: pId,
          mandor_name: db.projects[pIndex].executor_name,
          milestone_stage: 'Pekerjaan Selesai (100%)',
          amount: db.projects[pIndex].mandor_cost,
          status: 'Menunggu Verifikasi PM',
          verified_by_pm: false,
          notes: 'Dibuat otomatis oleh sistem saat semua milestone Done (SOP Anti Boncos)'
        });
      }
    } else if (pMilestones.some(m => m.status === 'In-Progress' || m.status === 'Done')) {
      db.projects[pIndex].status = 'In-Progress';
    } else {
      db.projects[pIndex].status = 'To-Do';
    }
  }

  writeDB(db);
  res.json(db.milestones[mIndex]);
});

// -------------------------------------------------------------
// 10. BOQ & DRUMS API
// -------------------------------------------------------------
app.get('/api/boq/:projectId', authenticateToken, (req, res) => {
  const db = readDB();
  const items = (db.boq_items || []).filter(b => b.project_id === req.params.projectId);
  res.json(items);
});

app.post('/api/boq/:projectId', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  if (!db.boq_items) db.boq_items = [];

  const newItem = {
    id: 'boq-' + Date.now(),
    project_id: req.params.projectId,
    item_type: req.body.item_type || 'Jasa',
    name: String(req.body.name || '').trim(),
    unit: req.body.unit || 'Meter',
    planned_qty: Number(req.body.planned_qty) || 0,
    actual_qty: Number(req.body.actual_qty) || 0,
    client_rate: Number(req.body.client_rate) || 0,
    mandor_rate: Number(req.body.mandor_rate) || 0
  };

  db.boq_items.push(newItem);
  writeDB(db);
  res.status(201).json(newItem);
});

app.get('/api/drums', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.drums || []);
});

// -------------------------------------------------------------
// 11. INVOICES & AGING AR API
// -------------------------------------------------------------
app.get('/api/invoices', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.invoices || []);
});

app.post('/api/invoices', authenticateToken, requireRoles(['finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  if (!db.invoices) db.invoices = [];

  const newInv = {
    id: 'inv-' + Date.now(),
    project_id: req.body.project_id,
    wo_number: String(req.body.wo_number || '').trim(),
    client_name: String(req.body.client_name || '').trim(),
    term_name: String(req.body.term_name || '').trim(),
    amount: Number(req.body.amount) || 0,
    status: req.body.status || 'Draft',
    invoice_date: req.body.invoice_date || new Date().toISOString().split('T')[0],
    due_date: req.body.due_date || '',
    paid_date: '',
    aging_category: '0 - 30 Hari'
  };

  db.invoices.push(newInv);
  writeDB(db);
  res.status(201).json(newInv);
});

app.put('/api/invoices/:id/status', authenticateToken, requireRoles(['finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const idx = (db.invoices || []).findIndex(inv => inv.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Invoice not found' });

  const { status, paid_date } = req.body;
  db.invoices[idx].status = status;
  if (status === 'Lunas') {
    db.invoices[idx].paid_date = paid_date || new Date().toISOString().split('T')[0];
    db.invoices[idx].aging_category = 'Lunas';
  }
  writeDB(db);
  res.json(db.invoices[idx]);
});

// -------------------------------------------------------------
// 12. MANDOR PAYOUT CLAIMS API (SOP ANTI BONCOS)
// -------------------------------------------------------------
app.get('/api/mandor-payouts', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.mandor_payouts || []);
});

app.put('/api/mandor-payouts/:id/verify', authenticateToken, requireRoles(['pm', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const idx = (db.mandor_payouts || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Payout claim not found' });

  const { approve, notes } = req.body;
  if (approve) {
    db.mandor_payouts[idx].status = 'Disetujui PM';
    db.mandor_payouts[idx].verified_by_pm = true;
  } else {
    db.mandor_payouts[idx].status = 'Ditolak / Pending Verifikasi';
    db.mandor_payouts[idx].verified_by_pm = false;
  }
  if (notes) db.mandor_payouts[idx].notes = String(notes);

  writeDB(db);
  res.json(db.mandor_payouts[idx]);
});

app.put('/api/mandor-payouts/:id/pay', authenticateToken, requireRoles(['finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const idx = (db.mandor_payouts || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Payout claim not found' });

  if (!db.mandor_payouts[idx].verified_by_pm) {
    return res.status(400).json({ error: 'Klaim ini belum diverifikasi dan disetujui oleh PM lapangan!' });
  }

  db.mandor_payouts[idx].status = 'Lunas';
  db.mandor_payouts[idx].payout_date = new Date().toISOString().split('T')[0];
  writeDB(db);
  res.json(db.mandor_payouts[idx]);
});

// -------------------------------------------------------------
// 13. EXECUTORS MASTER DATA API
// -------------------------------------------------------------
app.get('/api/executors', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.executors || []);
});

app.put('/api/executors/:id', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  const id = req.params.id;
  const index = (db.executors || []).findIndex(e => e.id === id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Eksekutor tidak ditemukan.' });

  // Whitelisting field to prevent mass assignment
  const { name, phone, pic, wilayah, specialization, rating, active_wos } = req.body;
  if (name !== undefined) db.executors[index].name = String(name).trim();
  if (phone !== undefined) db.executors[index].phone = String(phone).trim();
  if (pic !== undefined) db.executors[index].pic = String(pic).trim();
  if (wilayah !== undefined) db.executors[index].wilayah = String(wilayah).trim();
  if (specialization !== undefined) db.executors[index].specialization = String(specialization).trim();
  if (rating !== undefined) db.executors[index].rating = Number(rating);
  if (active_wos !== undefined) db.executors[index].active_wos = Number(active_wos);

  writeDB(db);
  res.json({ success: true, message: 'Eksekutor berhasil diupdate.' });
});

app.post('/api/executors', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  if (!db.executors) db.executors = [];

  const { name, type, phone, pic, wilayah, specialization } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Nama eksekutor wajib diisi!' });

  const newExec = {
    id: 'exec-' + Date.now(),
    name: String(name).trim(),
    type: type || 'Mandor',
    phone: String(phone || '').trim(),
    pic: String(pic || '').trim(),
    wilayah: String(wilayah || '').trim(),
    specialization: String(specialization || 'FTTH OSP').trim(),
    rating: 5.0,
    active_wos: 0
  };

  db.executors.push(newExec);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Eksekutor berhasil ditambahkan.', executor: newExec });
});

// -------------------------------------------------------------
// 14. EXPORT CSV APIS (SECURED AGAINST FORMULA INJECTION)
// -------------------------------------------------------------
app.get('/api/export/projects-csv', authenticateToken, (req, res) => {
  const db = readDB();
  let csv = 'ID,Nomor WO/SP,Klien,Klaster/Area,Tipe Eksekutor,Nama Eksekutor,Nilai Kontrak (Rp),HPP Mandor (Rp),Gross Margin (Rp),Margin (%),Status,Target Selesai\n';
  (db.projects || []).forEach(p => {
    csv += [
      sanitizeCSV(p.id),
      sanitizeCSV(p.wo_number),
      sanitizeCSV(p.client_name),
      sanitizeCSV(p.cluster_name),
      sanitizeCSV(p.executor_type),
      sanitizeCSV(p.executor_name),
      Number(p.contract_value) || 0,
      Number(p.mandor_cost) || 0,
      Number(p.gross_margin) || 0,
      sanitizeCSV(`${p.margin_percent}%`),
      sanitizeCSV(p.status),
      sanitizeCSV(p.target_date)
    ].join(',') + '\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="Rekap_Proyek_FTTH.csv"');
  res.send(csv);
});

app.get('/api/export/invoices-csv', authenticateToken, requireRoles(['direktur', 'superadmin', 'finance']), (req, res) => {
  const db = readDB();
  let csv = 'ID Invoice,Nomor WO/SP,Klien,Termin,Nominal (Rp),Status,Tanggal Invoice,Jatuh Tempo,Aging\n';
  (db.invoices || []).forEach(inv => {
    csv += [
      sanitizeCSV(inv.id),
      sanitizeCSV(inv.wo_number),
      sanitizeCSV(inv.client_name),
      sanitizeCSV(inv.term_name),
      Number(inv.amount) || 0,
      sanitizeCSV(inv.status),
      sanitizeCSV(inv.invoice_date),
      sanitizeCSV(inv.due_date),
      sanitizeCSV(inv.aging_category)
    ].join(',') + '\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="Rekap_Invoice_Piutang_FTTH.csv"');
  res.send(csv);
});

// -------------------------------------------------------------
// 15. GALLERY MANAGEMENT API (LANDING PAGE INDEX)
// -------------------------------------------------------------
const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

// GET Gallery bersifat publik untuk tampilan landing page index.html
app.get('/api/gallery', (req, res) => {
  const db = readDB();
  res.json(db.gallery || []);
});

app.post('/api/gallery', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  if (!db.gallery) db.gallery = [];

  const { title, category, description, image_base64, image_url } = req.body;
  let finalImageUrl = image_url || '/images/gallery/foto1.jpg';

  if (image_base64) {
    try {
      const matches = image_base64.match(/^data:([A-Za-z0-9\/+-]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ success: false, message: 'Format base64 image tidak valid!' });
      }

      const mimeType = matches[1].toLowerCase();
      if (!ALLOWED_MIME[mimeType]) {
        return res.status(400).json({ success: false, message: 'Format gambar tidak didukung. Hanya JPG, PNG, dan WebP yang diizinkan!' });
      }

      const ext = ALLOWED_MIME[mimeType];
      const dataBuffer = Buffer.from(matches[2], 'base64');
      if (dataBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: 'Ukuran foto maksimal 5MB!' });
      }

      const fileName = `gal-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const destDir = path.join(__dirname, 'public', 'images', 'gallery');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, fileName), dataBuffer);
      finalImageUrl = `/images/gallery/${fileName}`;
    } catch (e) {
      console.error('Error saving image:', e.message);
      return res.status(500).json({ success: false, message: 'Gagal memproses file gambar.' });
    }
  }

  const newItem = {
    id: 'gal-' + Date.now(),
    title: String(title || 'Dokumentasi Proyek').slice(0, 100),
    category: String(category || 'lapangan').slice(0, 50),
    description: String(description || '').slice(0, 300),
    image_url: finalImageUrl,
    created_at: new Date().toISOString().split('T')[0]
  };

  db.gallery.unshift(newItem);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Foto berhasil ditambahkan ke galeri index.', item: newItem });
});

app.put('/api/gallery/:id', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  if (!db.gallery) db.gallery = [];

  const id = req.params.id;
  const index = db.gallery.findIndex(g => g.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Foto galeri tidak ditemukan.' });
  }

  const { title, category, description, image_base64 } = req.body;
  let currentItem = db.gallery[index];

  if (title !== undefined) currentItem.title = String(title).slice(0, 100);
  if (category !== undefined) currentItem.category = String(category).slice(0, 50);
  if (description !== undefined) currentItem.description = String(description).slice(0, 300);

  if (image_base64) {
    try {
      const matches = image_base64.match(/^data:([A-Za-z0-9\/+-]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ success: false, message: 'Format base64 image tidak valid!' });
      }

      const mimeType = matches[1].toLowerCase();
      if (!ALLOWED_MIME[mimeType]) {
        return res.status(400).json({ success: false, message: 'Format gambar tidak didukung. Hanya JPG, PNG, dan WebP yang diizinkan!' });
      }

      const ext = ALLOWED_MIME[mimeType];
      const dataBuffer = Buffer.from(matches[2], 'base64');
      if (dataBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: 'Ukuran foto maksimal 5MB!' });
      }

      const fileName = `gal-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const destDir = path.join(__dirname, 'public', 'images', 'gallery');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, fileName), dataBuffer);

      // Safe deletion of old gallery image preventing path traversal
      if (currentItem.image_url && currentItem.image_url.startsWith('/images/gallery/gal-')) {
        const safeOldName = path.basename(currentItem.image_url);
        const oldPath = path.join(destDir, safeOldName);
        if (oldPath.startsWith(destDir) && fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) {}
        }
      }

      currentItem.image_url = `/images/gallery/${fileName}`;
    } catch (e) {
      console.error('Error saving updated image:', e.message);
      return res.status(500).json({ success: false, message: 'Gagal memproses file gambar.' });
    }
  }

  db.gallery[index] = currentItem;
  writeDB(db);
  res.json({ success: true, message: 'Foto galeri berhasil diperbarui.', item: currentItem });
});

app.delete('/api/gallery/:id', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  if (!db.gallery) db.gallery = [];

  const id = req.params.id;
  const index = db.gallery.findIndex(g => g.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Foto galeri tidak ditemukan.' });
  }

  const deleted = db.gallery.splice(index, 1)[0];
  if (deleted.image_url && deleted.image_url.startsWith('/images/gallery/gal-')) {
    const safeBaseName = path.basename(deleted.image_url);
    const galleryDir = path.join(__dirname, 'public', 'images', 'gallery');
    const localPath = path.join(galleryDir, safeBaseName);
    if (localPath.startsWith(galleryDir) && fs.existsSync(localPath)) {
      try { fs.unlinkSync(localPath); } catch (e) {}
    }
  }

  writeDB(db);
  res.json({ success: true, message: 'Foto berhasil dihapus dari galeri index.', deleted });
});

// -------------------------------------------------------------
// 16. SERVER INITIALIZATION
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`PT Akses Kwalitas Unggul Server running at http://localhost:${PORT}`);
});
