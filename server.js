const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Load .env lightweight
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  });
}

const TelegramBotService = require('./telegram-bot');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
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
  return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|([a-z0-9-]+\.)*akseskwalitasunggul\.com)(:\d+)?$/i.test(origin);
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
  const emptyDB = {
    sp_orders: [],
    projects: [],
    executors: [],
    milestones: [],
    invoices: [],
    mandor_payouts: [],
    gallery: [],
    users: [],
    materials: [],
    bon_material: [],
    telegram_users: [],
    bon_requests: [],
    material_inbounds: []
  };
  try {
    if (!fs.existsSync(DB_FILE)) {
      return emptyDB;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.sp_orders)) parsed.sp_orders = [];
    if (!Array.isArray(parsed.projects)) parsed.projects = [];
    if (!Array.isArray(parsed.telegram_users)) parsed.telegram_users = [];
    if (!Array.isArray(parsed.bon_requests)) parsed.bon_requests = [];
    if (!Array.isArray(parsed.material_inbounds)) parsed.material_inbounds = [];
    if (!Array.isArray(parsed.materials)) parsed.materials = [];
    if (!Array.isArray(parsed.bon_material)) parsed.bon_material = [];
    if (!Array.isArray(parsed.milestones)) parsed.milestones = [];
    if (!Array.isArray(parsed.executors)) parsed.executors = [];

    // Auto-normalisasi data projects ke dalam relasi SP/PO (1 SP to N Pekerjaan)
    let needSync = false;
    parsed.projects.forEach(p => {
      const spNum = p.sp_number || p.wo_number || 'SP-UNKNOWN';
      const jobName = p.job_name || p.cluster_name || p.wo_number || 'Pekerjaan Lapangan';
      if (!p.sp_number) { p.sp_number = spNum; needSync = true; }
      if (!p.job_name) { p.job_name = jobName; needSync = true; }
      if (!p.cluster_name) { p.cluster_name = jobName; needSync = true; }
      if (!p.wo_number) { p.wo_number = spNum; needSync = true; }

      let existingSp = parsed.sp_orders.find(s => (s.sp_number || '').trim().toLowerCase() === spNum.trim().toLowerCase());
      if (!existingSp) {
        existingSp = {
          id: 'sp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          sp_number: spNum,
          client_name: p.client_name || 'Telkom Akses',
          created_at: p.created_at || new Date().toISOString().split('T')[0],
          notes: ''
        };
        parsed.sp_orders.push(existingSp);
        needSync = true;
      }
      if (!p.sp_id) {
        p.sp_id = existingSp.id;
        needSync = true;
      }
    });

    // Auto-normalisasi data milestones (dukungan executor hybrid / mixing per milestone)
    parsed.milestones.forEach(m => {
      const parentProj = parsed.projects.find(p => p.id === m.project_id);
      if (parentProj) {
        if (!m.executor_type) { m.executor_type = parentProj.executor_type || 'Mandor'; needSync = true; }
        if (m.executor_id === undefined) { m.executor_id = parentProj.executor_id || ''; needSync = true; }
        if (!m.executor_name) { m.executor_name = parentProj.executor_name || 'Belum Ditentukan'; needSync = true; }
        if (m.stage_cost === undefined || m.stage_cost === null) {
          m.stage_cost = parentProj.executor_type === 'Mandor' ? Math.round((Number(parentProj.mandor_cost) || 0) / 4) : 0;
          needSync = true;
        }
      }
    });

    if (needSync && fs.existsSync(DB_FILE)) {
      writeDB(parsed);
    }

    return parsed;
  } catch (err) {
    console.error('Error reading database:', err.message);
    return emptyDB;
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

// Telegram Bot Service Instance
const telegramBot = new TelegramBotService({
  token: process.env.TELEGRAM_BOT_TOKEN,
  readDB,
  writeDB
});

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

  // 2. Total Kas Diterima YTD (dari invoice berstatus 'Lunas' atau 'Sudah Cashbank')
  const totalKasDiterima = (db.invoices || [])
    .filter(inv => inv.status === 'Lunas' || inv.status === 'Sudah Cashbank')
    .reduce((acc, inv) => acc + (inv.amount || 0), 0);

  // 3. Total Sisa Piutang Klien (invoice yang belum cashbank)
  const totalSisaPiutang = (db.invoices || [])
    .filter(inv => inv.status !== 'Lunas' && inv.status !== 'Sudah Cashbank')
    .reduce((acc, inv) => acc + (inv.amount || 0), 0);

  // 4. Estimasi Laba Bersih Perusahaan
  const totalRevenue = totalOrderBook;
  const totalHPP = (db.projects || []).reduce((acc, p) => acc + (p.mandor_cost || 0), 0);
  const totalGrossMargin = totalRevenue - totalHPP;
  const grossMarginPercent = totalRevenue > 0 ? ((totalGrossMargin / totalRevenue) * 100).toFixed(1) : 0;

  // Monthly Revenue Trend (Dynamic kalkulasi dari db.invoices)
  const now = new Date();
  let maxYear = now.getFullYear();
  let maxMonth = now.getMonth();

  (db.invoices || []).forEach(inv => {
    [inv.invoice_date, inv.paid_date].forEach(dStr => {
      if (dStr && /^\d{4}-\d{2}/.test(dStr)) {
        const parts = dStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        if (y > maxYear || (y === maxYear && m > maxMonth)) {
          maxYear = y;
          maxMonth = m;
        }
      }
    });
  });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

  function buildMonthlyRevenue(count) {
    const list = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(maxYear, maxMonth - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${yyyy}-${mm}`;
      const monthLabel = count > 6 ? `${monthNames[d.getMonth()]} '${String(yyyy).slice(-2)}` : monthNames[d.getMonth()];

      // Omset Tagihan (Billed): invoice yang diterbitkan pada bulan tersebut (kecuali Draft)
      const billed = (db.invoices || [])
        .filter(inv => {
          if (inv.status === 'Draft') return false;
          const dt = inv.invoice_date || '';
          return dt.startsWith(key);
        })
        .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

      // Kas Riil Masuk (Received): invoice lunas/cashbank pada bulan uang masuk (paid_date)
      const received = (db.invoices || [])
        .filter(inv => {
          const isPaid = inv.status === 'Sudah Cashbank' || inv.status === 'Lunas';
          if (!isPaid) return false;
          const dt = inv.paid_date || inv.invoice_date || '';
          return dt.startsWith(key);
        })
        .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

      list.push({
        month: monthLabel,
        key,
        billed,
        received
      });
    }
    return list;
  }

  const requestedMonths = [3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6;
  const monthlyRevenue = buildMonthlyRevenue(requestedMonths);
  const revenueTrends = {
    '3m': buildMonthlyRevenue(3),
    '6m': buildMonthlyRevenue(6),
    '1y': buildMonthlyRevenue(12)
  };

  // Portofolio Klien
  const clientPortfolio = {};
  (db.projects || []).forEach(p => {
    clientPortfolio[p.client_name] = (clientPortfolio[p.client_name] || 0) + p.contract_value;
  });

  // Executor Breakdown (Internal vs Mandor vs Campuran)
  const executorBreakdown = {
    internalValue: (db.projects || []).filter(p => p.executor_type === 'Internal').reduce((a, b) => a + (Number(b.contract_value) || 0), 0),
    mandorValue: (db.projects || []).filter(p => p.executor_type === 'Mandor').reduce((a, b) => a + (Number(b.contract_value) || 0), 0),
    mixedValue: (db.projects || []).filter(p => p.executor_type === 'Campuran').reduce((a, b) => a + (Number(b.contract_value) || 0), 0),
    internalCount: (db.projects || []).filter(p => p.executor_type === 'Internal').length,
    mandorCount: (db.projects || []).filter(p => p.executor_type === 'Mandor').length,
    mixedCount: (db.projects || []).filter(p => p.executor_type === 'Campuran').length
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
    revenueTrends,
    clientPortfolio,
    executorBreakdown,
    milestoneCounts
  });
});

// -------------------------------------------------------------
// 8. SP & PURCHASE ORDERS API
// -------------------------------------------------------------
app.get('/api/sp-orders', authenticateToken, (req, res) => {
  const db = readDB();
  const list = (db.sp_orders || []).map(sp => {
    const jobs = (db.projects || []).filter(p => p.sp_id === sp.id || (p.sp_number && p.sp_number.toLowerCase() === sp.sp_number.toLowerCase()) || p.wo_number === sp.sp_number);
    const totalBOQ = jobs.reduce((sum, j) => sum + (Number(j.contract_value) || 0), 0);
    const totalHPP = jobs.reduce((sum, j) => sum + (Number(j.mandor_cost) || 0), 0);
    const totalMargin = totalBOQ - totalHPP;
    const marginPct = totalBOQ > 0 ? Number(((totalMargin / totalBOQ) * 100).toFixed(1)) : 0;

    return {
      ...sp,
      total_boq: totalBOQ,
      total_hpp: totalHPP,
      gross_margin: totalMargin,
      margin_percent: marginPct,
      job_count: jobs.length,
      jobs
    };
  });
  res.json(list);
});

app.post('/api/sp-orders', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  const { sp_number, client_name, notes } = req.body;
  const trimmedSp = String(sp_number || '').trim();
  const trimmedClient = String(client_name || '').trim();
  if (!trimmedSp || !trimmedClient) {
    return res.status(400).json({ success: false, message: 'Nomor SP/PO dan Klien wajib diisi!' });
  }

  if (!Array.isArray(db.sp_orders)) db.sp_orders = [];
  const existing = db.sp_orders.find(s => s.sp_number.toLowerCase() === trimmedSp.toLowerCase());
  if (existing) {
    return res.status(409).json({ success: false, message: 'Nomor SP/PO sudah terdaftar!' });
  }

  const newSp = {
    id: 'sp-' + Date.now(),
    sp_number: trimmedSp,
    client_name: trimmedClient,
    created_at: new Date().toISOString().split('T')[0],
    notes: String(notes || '').trim()
  };
  db.sp_orders.push(newSp);
  writeDB(db);
  res.status(201).json({ success: true, message: 'SP/PO berhasil didaftarkan.', sp: newSp });
});

app.delete('/api/sp-orders/:id', authenticateToken, requireRoles(['direktur', 'superadmin']), (req, res) => {
  const db = readDB();
  const spIndex = (db.sp_orders || []).findIndex(s => s.id === req.params.id);
  if (spIndex === -1) return res.status(404).json({ success: false, message: 'SP/PO tidak ditemukan.' });

  const sp = db.sp_orders[spIndex];
  const relatedJobs = (db.projects || []).filter(p => p.sp_id === sp.id || (p.sp_number && p.sp_number.toLowerCase() === sp.sp_number.toLowerCase()) || p.wo_number === sp.sp_number);
  const activeJobs = relatedJobs.filter(p => p.status !== 'Selesai' && p.status !== 'Done');

  if (activeJobs.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Tidak dapat menghapus SP/PO "${sp.sp_number}" karena masih memiliki ${activeJobs.length} pekerjaan yang belum selesai.`
    });
  }

  const [removedSp] = db.sp_orders.splice(spIndex, 1);
  writeDB(db);
  res.json({ success: true, message: 'SP/PO berhasil dihapus.', sp: removedSp });
});

// -------------------------------------------------------------
// 8B. PROJECTS (PEKERJAAN / WORK ORDERS) API
// -------------------------------------------------------------
app.get('/api/projects', authenticateToken, (req, res) => {
  const db = readDB();
  const { client, executor_type, status } = req.query;

  let list = (db.projects || []).map(proj => {
    let projMilestones = (db.milestones || []).filter(m => m.project_id === proj.id);
    projMilestones = projMilestones.map(m => ({
      ...m,
      executor_type: m.executor_type || proj.executor_type || 'Mandor',
      executor_id: m.executor_id || proj.executor_id || '',
      executor_name: m.executor_name || proj.executor_name || 'Belum Ditentukan',
      stage_cost: m.stage_cost !== undefined ? Number(m.stage_cost) : (proj.executor_type === 'Mandor' ? Math.round((Number(proj.mandor_cost) || 0) / 4) : 0)
    }));
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
    sp_number,
    client_name,
    cluster_name,
    job_name,
    executor_type,
    executor_id,
    contract_value,
    mandor_cost,
    target_date,
    milestones_config
  } = req.body;

  const rawSp = String(sp_number || wo_number || '').trim();
  const rawJob = String(job_name || cluster_name || rawSp).trim();
  const rawClient = String(client_name || '').trim();

  if (!rawSp || !rawClient) {
    return res.status(400).json({ error: 'Nomor SP/PO dan Klien wajib diisi!' });
  }

  // Cari atau buat SP di sp_orders
  if (!Array.isArray(db.sp_orders)) db.sp_orders = [];
  let spOrder = db.sp_orders.find(s => (s.sp_number || '').trim().toLowerCase() === rawSp.toLowerCase());
  if (!spOrder) {
    spOrder = {
      id: 'sp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      sp_number: rawSp,
      client_name: rawClient,
      created_at: new Date().toISOString().split('T')[0],
      notes: ''
    };
    db.sp_orders.push(spOrder);
  }

  const executor = (db.executors || []).find(e => e.id === executor_id) || { name: 'Belum Ditentukan' };
  const val = Number(contract_value) || 0;
  let cost = Number(mandor_cost) || 0;

  const newProjId = 'proj-' + (Date.now());

  // Setup default 4 milestone templates
  const standardStages = [
    { stage_name: 'Penanaman Tiang', notes: 'Penyiapan perizinan ROW & koordinasi mandor.' },
    { stage_name: 'Penarikan KU Fiber', notes: 'Menunggu alokasi drum kabel fiber.' },
    { stage_name: 'Instalasi ODP & Splicing', notes: 'Menunggu kabel KU selesai ditarik.' },
    { stage_name: 'Testing & ATP', notes: 'Uji OTDR & OPM setelah seluruh ODP terpasang.', otdr_loss: '-', opm_power: '-' }
  ];

  let calculatedMilestones = [];
  let finalExecType = executor_type || 'Mandor';
  let finalExecId = executor_id || '';
  let finalExecName = executor.name;

  if (finalExecType === 'Campuran' || Array.isArray(milestones_config)) {
    finalExecType = 'Campuran';
    finalExecId = 'MIXED';
    let sumMandorCost = 0;
    const execNames = [];

    calculatedMilestones = standardStages.map((st, idx) => {
      const cfg = (Array.isArray(milestones_config) ? (milestones_config.find(c => c.stage_name === st.stage_name) || milestones_config[idx]) : null) || {};
      const mExecId = cfg.executor_id || '';
      const mExec = (db.executors || []).find(e => e.id === mExecId);
      const mType = cfg.executor_type || (mExec ? mExec.type : 'Mandor');
      const mName = mExec ? mExec.name : (cfg.executor_name || (mType === 'Internal' ? 'Tim Internal PT AKU' : 'Mandor Borongan'));
      const mCost = mType === 'Mandor' ? (Number(cfg.stage_cost) || 0) : 0;
      if (mType === 'Mandor') {
        sumMandorCost += mCost;
      }
      if (mName && !execNames.includes(mName)) execNames.push(mName);

      return {
        id: `m-${newProjId}-${idx + 1}`,
        project_id: newProjId,
        stage_name: st.stage_name,
        status: 'To-Do',
        progress_percent: 0,
        notes: cfg.notes || st.notes,
        blocked_reason: '',
        otdr_loss: st.otdr_loss || '',
        opm_power: st.opm_power || '',
        executor_type: mType,
        executor_id: mExecId,
        executor_name: mName,
        stage_cost: mCost
      };
    });

    cost = sumMandorCost;
    finalExecName = execNames.length > 0 ? execNames.join(' & ') : 'Campuran (Internal & Mandor)';
  } else {
    const perStageCost = finalExecType === 'Mandor' ? Math.round(cost / 4) : 0;
    calculatedMilestones = standardStages.map((st, idx) => ({
      id: `m-${newProjId}-${idx + 1}`,
      project_id: newProjId,
      stage_name: st.stage_name,
      status: 'To-Do',
      progress_percent: 0,
      notes: st.notes,
      blocked_reason: '',
      otdr_loss: st.otdr_loss || '',
      opm_power: st.opm_power || '',
      executor_type: finalExecType,
      executor_id: finalExecId,
      executor_name: finalExecName,
      stage_cost: perStageCost
    }));
  }

  const margin = val - cost;
  const marginPct = val > 0 ? Number(((margin / val) * 100).toFixed(1)) : 0;

  const newProject = {
    id: newProjId,
    sp_id: spOrder.id,
    sp_number: spOrder.sp_number,
    job_name: rawJob,
    wo_number: spOrder.sp_number, // Backward compatibility
    cluster_name: rawJob,         // Backward compatibility
    client_name: spOrder.client_name,
    executor_type: finalExecType,
    executor_id: finalExecId,
    executor_name: finalExecName,
    contract_value: val,
    mandor_cost: cost,
    gross_margin: margin,
    margin_percent: marginPct,
    status: 'To-Do',
    target_date: target_date || '',
    created_at: new Date().toISOString().split('T')[0]
  };

  if (!db.projects) db.projects = [];
  if (!db.milestones) db.milestones = [];

  db.projects.push(newProject);
  db.milestones.push(...calculatedMilestones);
  if (!db.bon_material) db.bon_material = [];
  db.bon_material.push({
    id: 'bon-' + newProjId,
    project_id: newProjId,
    wo_number: newProject.wo_number,
    status: 'Draft',
    notes: '',
    items: [],
    created_by: req.user ? req.user.id : '',
    created_at: newProject.created_at,
    updated_at: newProject.created_at
  });
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
  db.invoices = (db.invoices || []).filter(inv => inv.project_id !== pId);
  db.mandor_payouts = (db.mandor_payouts || []).filter(mp => mp.project_id !== pId);
  db.bon_material = (db.bon_material || []).filter(b => b.project_id !== pId);

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

  const {
    status,
    progress_percent,
    notes,
    blocked_reason,
    otdr_loss,
    opm_power,
    executor_type,
    executor_id,
    executor_name,
    stage_cost
  } = req.body;

  if (status) db.milestones[mIndex].status = status;
  if (progress_percent !== undefined) db.milestones[mIndex].progress_percent = Number(progress_percent);
  if (notes !== undefined) db.milestones[mIndex].notes = String(notes);
  if (blocked_reason !== undefined) db.milestones[mIndex].blocked_reason = String(blocked_reason);
  if (otdr_loss !== undefined) db.milestones[mIndex].otdr_loss = String(otdr_loss);
  if (opm_power !== undefined) db.milestones[mIndex].opm_power = String(opm_power);
  if (executor_type !== undefined) db.milestones[mIndex].executor_type = executor_type;
  if (executor_id !== undefined) {
    db.milestones[mIndex].executor_id = executor_id;
    const foundExec = (db.executors || []).find(e => e.id === executor_id);
    if (foundExec) {
      db.milestones[mIndex].executor_name = foundExec.name;
      if (!executor_type) db.milestones[mIndex].executor_type = foundExec.type;
    }
  }
  if (executor_name !== undefined) db.milestones[mIndex].executor_name = String(executor_name);
  if (stage_cost !== undefined) db.milestones[mIndex].stage_cost = Number(stage_cost) || 0;

  // Auto-update overall project status based on milestones
  const pId = db.milestones[mIndex].project_id;
  const pMilestones = (db.milestones || []).filter(m => m.project_id === pId);
  const pIndex = (db.projects || []).findIndex(p => p.id === pId);

  if (pIndex !== -1) {
    // Sinkronkan kembali mandor_cost dan executor_type pada level project
    const mandorStages = pMilestones.filter(m => m.executor_type === 'Mandor');
    const internalStages = pMilestones.filter(m => m.executor_type === 'Internal');
    if (mandorStages.length > 0 && internalStages.length > 0) {
      db.projects[pIndex].executor_type = 'Campuran';
      db.projects[pIndex].mandor_cost = mandorStages.reduce((sum, m) => sum + (Number(m.stage_cost) || 0), 0);
    } else if (mandorStages.length > 0) {
      db.projects[pIndex].executor_type = 'Mandor';
      db.projects[pIndex].mandor_cost = mandorStages.reduce((sum, m) => sum + (Number(m.stage_cost) || 0), 0);
    } else if (internalStages.length > 0) {
      db.projects[pIndex].executor_type = 'Internal';
      db.projects[pIndex].mandor_cost = 0;
    }
    const val = Number(db.projects[pIndex].contract_value) || 0;
    const cost = Number(db.projects[pIndex].mandor_cost) || 0;
    db.projects[pIndex].gross_margin = val - cost;
    db.projects[pIndex].margin_percent = val > 0 ? Number((((val - cost) / val) * 100).toFixed(1)) : 0;

    if (pMilestones.some(m => m.status === 'Blocked')) {
      db.projects[pIndex].status = 'Blocked';
    } else if (pMilestones.every(m => m.status === 'Done')) {
      db.projects[pIndex].status = 'Done';

      // SOP Penguncian Anti Boncos: Auto-create Kas Keluar HANYA untuk Mandor
      if (!db.mandor_payouts) db.mandor_payouts = [];
      if (mandorStages.length > 0) {
        // Kelompokkan per mandor
        const mandorGroups = {};
        mandorStages.forEach(st => {
          const mKey = st.executor_id || st.executor_name || db.projects[pIndex].executor_name || 'Mandor Lapangan';
          if (!mandorGroups[mKey]) {
            mandorGroups[mKey] = {
              mandor_name: st.executor_name || db.projects[pIndex].executor_name || 'Mandor Lapangan',
              total_cost: 0
            };
          }
          mandorGroups[mKey].total_cost += (Number(st.stage_cost) || 0);
        });

        Object.values(mandorGroups).forEach(grp => {
          if (grp.total_cost > 0) {
            const existingPayout = db.mandor_payouts.find(p => p.project_id === pId && p.mandor_name === grp.mandor_name);
            if (!existingPayout) {
              db.mandor_payouts.push({
                id: 'pay-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                project_id: pId,
                mandor_name: grp.mandor_name,
                milestone_stage: 'Pekerjaan Selesai (100%)',
                amount: grp.total_cost,
                status: 'Menunggu Verifikasi PM',
                verified_by_pm: false,
                notes: 'Dibuat otomatis oleh sistem saat semua milestone Done (SOP Anti Boncos)'
              });
            }
          }
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
// 11. INVOICES & AGING AR API
// -------------------------------------------------------------
app.get('/api/invoices', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.invoices || []);
});

app.post('/api/invoices', authenticateToken, requireRoles(['finance', 'superadmin']), (req, res) => {
  const db = readDB();
  if (!db.invoices) db.invoices = [];

  const invoiceDate = req.body.invoice_date || new Date().toISOString().split('T')[0];
  let dueDate = req.body.due_date;
  if (!dueDate && invoiceDate) {
    const d = new Date(invoiceDate);
    d.setMonth(d.getMonth() + 2);
    dueDate = d.toISOString().split('T')[0];
  }

  const rawId = req.body.id ? String(req.body.id).trim() : '';
  const invId = rawId || ('inv-' + Date.now());

  if (rawId && (db.invoices || []).some(inv => inv.id.toLowerCase() === rawId.toLowerCase())) {
    return res.status(409).json({ success: false, message: `ID Invoice "${rawId}" sudah terdaftar!` });
  }

  const newInv = {
    id: invId,
    project_id: req.body.project_id,
    wo_number: String(req.body.wo_number || '').trim(),
    client_name: String(req.body.client_name || '').trim(),
    term_name: String(req.body.term_name || '').trim(),
    amount: Number(req.body.amount) || 0,
    status: req.body.status || 'Belum Cashbank',
    invoice_date: invoiceDate,
    due_date: dueDate,
    paid_date: '',
    aging_category: '0 - 30 Hari'
  };

  db.invoices.push(newInv);
  writeDB(db);
  res.status(201).json(newInv);
});

app.put(/^\/api\/invoices\/(.+)\/status$/, authenticateToken, requireRoles(['finance', 'superadmin']), (req, res) => {
  const db = readDB();
  const targetId = req.params[0] ? decodeURIComponent(req.params[0]) : req.params.id;
  const idx = (db.invoices || []).findIndex(inv => inv.id === targetId || inv.id === decodeURIComponent(targetId));
  if (idx === -1) return res.status(404).json({ error: 'Invoice not found' });

  const { status, paid_date } = req.body;
  db.invoices[idx].status = status;
  if (status === 'Lunas' || status === 'Sudah Cashbank') {
    db.invoices[idx].paid_date = paid_date || new Date().toISOString().split('T')[0];
    db.invoices[idx].aging_category = 'Lunas';
  }
  writeDB(db);
  res.json(db.invoices[idx]);
});

app.put(/^\/api\/invoices\/(?!.*\/status$)(.+)$/, authenticateToken, requireRoles(['finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const targetId = req.params[0] ? decodeURIComponent(req.params[0]) : req.params.id;
  const idx = (db.invoices || []).findIndex(inv => inv.id === targetId || inv.id === decodeURIComponent(targetId));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan.' });

  const { wo_number, client_name, term_name, amount, status, invoice_date, due_date, paid_date } = req.body;
  if (wo_number !== undefined) db.invoices[idx].wo_number = String(wo_number).trim();
  if (client_name !== undefined) db.invoices[idx].client_name = String(client_name).trim();
  if (term_name !== undefined) db.invoices[idx].term_name = String(term_name).trim();
  if (amount !== undefined) db.invoices[idx].amount = Number(amount) || 0;
  if (invoice_date !== undefined) db.invoices[idx].invoice_date = invoice_date;
  if (due_date !== undefined) db.invoices[idx].due_date = due_date;
  if (status !== undefined) {
    db.invoices[idx].status = status;
    if (status === 'Lunas' || status === 'Sudah Cashbank') {
      db.invoices[idx].paid_date = paid_date || new Date().toISOString().split('T')[0];
      db.invoices[idx].aging_category = 'Lunas';
    } else {
      db.invoices[idx].aging_category = '0 - 30 Hari';
    }
  }

  writeDB(db);
  res.json({ success: true, message: 'Invoice berhasil diperbarui.', invoice: db.invoices[idx] });
});

app.delete(/^\/api\/invoices\/(.+)$/, authenticateToken, requireRoles(['finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const targetId = req.params[0] ? decodeURIComponent(req.params[0]) : req.params.id;
  const idx = (db.invoices || []).findIndex(inv => inv.id === targetId || inv.id === decodeURIComponent(targetId));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan.' });

  const [removed] = db.invoices.splice(idx, 1);
  writeDB(db);
  res.json({ success: true, message: 'Invoice berhasil dihapus.', invoice: removed });
});

// -------------------------------------------------------------
// 12. MANDOR PAYOUT CLAIMS API (SOP ANTI BONCOS)
// -------------------------------------------------------------
app.get('/api/mandor-payouts', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.mandor_payouts || []);
});

app.post('/api/mandor-payouts', authenticateToken, requireRoles(['pm', 'finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  if (!db.mandor_payouts) db.mandor_payouts = [];

  const { project_id, mandor_name, milestone_stage, amount, notes, verified_by_pm } = req.body;
  const trimmedMandor = String(mandor_name || '').trim();
  const trimmedStage = String(milestone_stage || 'Operasional Lapangan').trim();
  const numAmount = Number(amount) || 0;

  if (!trimmedMandor || numAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Nama Mandor dan Nominal Upah valid wajib diisi!' });
  }

  const isVerified = verified_by_pm === true || ['pm', 'superadmin', 'direktur'].includes(req.user.role);
  const newPayout = {
    id: 'pay-' + Date.now(),
    project_id: String(project_id || 'manual').trim(),
    mandor_name: trimmedMandor,
    milestone_stage: trimmedStage,
    amount: numAmount,
    status: isVerified ? 'Disetujui PM' : 'Pending Verifikasi',
    verified_by_pm: isVerified,
    payout_date: '',
    notes: String(notes || '').trim(),
    created_at: new Date().toISOString().split('T')[0]
  };

  db.mandor_payouts.push(newPayout);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Klaim kas keluar berhasil dicatat.', payout: newPayout });
});

app.put('/api/mandor-payouts/:id', authenticateToken, requireRoles(['pm', 'finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const idx = (db.mandor_payouts || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Klaim kas keluar tidak ditemukan.' });

  const { mandor_name, milestone_stage, amount, notes, status } = req.body;
  if (mandor_name !== undefined) db.mandor_payouts[idx].mandor_name = String(mandor_name).trim();
  if (milestone_stage !== undefined) db.mandor_payouts[idx].milestone_stage = String(milestone_stage).trim();
  if (amount !== undefined) db.mandor_payouts[idx].amount = Number(amount) || 0;
  if (notes !== undefined) db.mandor_payouts[idx].notes = String(notes).trim();
  if (status !== undefined) db.mandor_payouts[idx].status = String(status).trim();

  writeDB(db);
  res.json({ success: true, message: 'Data kas keluar berhasil diperbarui.', payout: db.mandor_payouts[idx] });
});

app.delete('/api/mandor-payouts/:id', authenticateToken, requireRoles(['pm', 'finance', 'superadmin', 'direktur']), (req, res) => {
  const db = readDB();
  const idx = (db.mandor_payouts || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Klaim kas keluar tidak ditemukan.' });

  const [removed] = db.mandor_payouts.splice(idx, 1);
  writeDB(db);
  res.json({ success: true, message: 'Data kas keluar berhasil dihapus.', payout: removed });
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
  const { name, type, phone, pic, wilayah, specialization, fleet_no, standard_rates, status, rating, active_wos } = req.body;
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed) {
      db.executors[index].name = trimmed;
      (db.projects || []).forEach(p => {
        if (p.executor_id === id) {
          p.executor_name = trimmed;
        }
      });
    }
  }
  if (type !== undefined && ['Internal', 'Mandor'].includes(type)) db.executors[index].type = type;
  if (phone !== undefined) db.executors[index].phone = String(phone).trim();
  if (pic !== undefined) db.executors[index].pic = String(pic).trim();
  if (wilayah !== undefined) db.executors[index].wilayah = String(wilayah).trim();
  if (specialization !== undefined) db.executors[index].specialization = String(specialization).trim();
  if (fleet_no !== undefined) db.executors[index].fleet_no = String(fleet_no).trim();
  if (standard_rates !== undefined) db.executors[index].standard_rates = String(standard_rates).trim();
  if (status !== undefined) db.executors[index].status = String(status).trim();
  if (rating !== undefined) db.executors[index].rating = Number(rating) || 5.0;
  if (active_wos !== undefined) db.executors[index].active_wos = Number(active_wos) || 0;

  writeDB(db);
  res.json({ success: true, message: 'Eksekutor berhasil diupdate.', executor: db.executors[index] });
});

app.post('/api/executors', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  if (!db.executors) db.executors = [];

  const { name, type, phone, pic, wilayah, specialization, fleet_no, standard_rates, status, rating } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Nama eksekutor wajib diisi!' });

  const newExec = {
    id: 'exec-' + Date.now(),
    name: String(name).trim(),
    type: ['Internal', 'Mandor'].includes(type) ? type : 'Mandor',
    phone: String(phone || '').trim(),
    pic: String(pic || '').trim(),
    wilayah: String(wilayah || '').trim(),
    specialization: String(specialization || 'FTTH OSP').trim(),
    fleet_no: String(fleet_no || '').trim(),
    standard_rates: String(standard_rates || '').trim(),
    status: status || 'Aktif',
    rating: Number(rating) || 5.0,
    active_wos: 0
  };

  db.executors.push(newExec);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Eksekutor berhasil ditambahkan.', executor: newExec });
});

app.delete('/api/executors/:id', authenticateToken, requireRoles(['direktur', 'superadmin']), (req, res) => {
  const db = readDB();
  const id = req.params.id;
  const index = (db.executors || []).findIndex(e => e.id === id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Eksekutor tidak ditemukan.' });

  const executor = db.executors[index];
  const activeProjects = (db.projects || []).filter(p => {
    const isDirectMatch = (p.executor_id === id || p.executor_name === executor.name);
    const hasActiveMilestone = (db.milestones || []).some(m =>
      m.project_id === p.id &&
      (m.executor_id === id || m.executor_name === executor.name) &&
      m.status !== 'Done'
    );
    return (isDirectMatch || hasActiveMilestone) && p.status !== 'Selesai' && p.status !== 'Done';
  });

  if (activeProjects.length > 0) {
    const activeWoList = activeProjects.map(p => p.wo_number || p.sp_number).join(', ');
    return res.status(400).json({
      success: false,
      message: `Tidak dapat menghapus eksekutor "${executor.name}" karena masih memiliki ${activeProjects.length} WO aktif (${activeWoList}). Alihkan atau selesaikan WO tersebut terlebih dahulu.`
    });
  }

  const [removed] = db.executors.splice(index, 1);
  writeDB(db);
  res.json({ success: true, message: 'Eksekutor berhasil dihapus.', executor: removed });
});

// -------------------------------------------------------------
// 14. EXPORT CSV APIS (SECURED AGAINST FORMULA INJECTION)
// -------------------------------------------------------------
app.get('/api/export/projects-csv', authenticateToken, (req, res) => {
  const db = readDB();
  let csv = 'ID,Nomor WO/SP,Klien,Klaster/Area,Tipe Eksekutor,Nama Eksekutor,Nilai Kontrak (Rp),HPP Mandor (Rp),Net Margin (Rp),Margin (%),Status,Target Selesai\n';
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
// 16. BON MATERIAL & MATERIAL MASTER API
// -------------------------------------------------------------
const DEFAULT_MATERIALS = [
  { name: 'Tiang Beton 7m', category: 'Tiang', variant: '7m', unit: 'btg' },
  { name: 'Tiang Beton 9m', category: 'Tiang', variant: '9m', unit: 'btg' },
  { name: 'Kabel ADSS 12 Core', category: 'Kabel', variant: 'ADSS 12c', unit: 'm' },
  { name: 'Kabel ADSS 24 Core', category: 'Kabel', variant: 'ADSS 24c', unit: 'm' },
  { name: 'Kabel ADSS 48 Core', category: 'Kabel', variant: 'ADSS 48c', unit: 'm' },
  { name: 'Kabel ADSS 96 Core', category: 'Kabel', variant: 'ADSS 96c', unit: 'm' },
  { name: 'Kabel SCPT 12 Core', category: 'Kabel', variant: 'SCPT 12c', unit: 'm' },
  { name: 'Kabel SCPT 24 Core', category: 'Kabel', variant: 'SCPT 24c', unit: 'm' },
  { name: 'Kabel SCPT 48 Core', category: 'Kabel', variant: 'SCPT 48c', unit: 'm' },
  { name: 'Kabel SCPT 96 Core', category: 'Kabel', variant: 'SCPT 96c', unit: 'm' },
  { name: 'ODP Splitter 1:8', category: 'ODP', variant: '1:8', unit: 'titik' },
  { name: 'ODP Splitter 1:16', category: 'ODP', variant: '1:16', unit: 'titik' },
  { name: 'Bracket A', category: 'Aksesoris Tiang', variant: 'ADSS', unit: 'pcs' },
  { name: 'Tambat Mati Dead End', category: 'Aksesoris Tiang', variant: 'ADSS', unit: 'pcs' },
  { name: 'Tambat Mati Helical', category: 'Aksesoris Tiang', variant: 'ADSS', unit: 'pcs' },
  { name: 'Bracket A', category: 'Aksesoris Tiang', variant: 'SCPT', unit: 'pcs' },
  { name: 'Span Wartel', category: 'Aksesoris Tiang', variant: 'SCPT', unit: 'pcs' },
  { name: 'Strangclamp', category: 'Aksesoris Tiang', variant: 'SCPT', unit: 'pcs' },
  { name: 'Slack Support', category: 'Slack Support', variant: '', unit: 'pcs' }
];

const MATERIAL_CATEGORIES = ['Tiang', 'Kabel', 'ODP', 'Aksesoris Tiang', 'Slack Support', 'Lainnya'];

function ensureMaterialSeeds() {
  const db = readDB();
  if (Array.isArray(db.materials) && db.materials.length > 0) return;
  db.materials = DEFAULT_MATERIALS.map((m, i) => ({
    id: 'mat-seed-' + String(i + 1).padStart(3, '0'),
    name: m.name,
    category: m.category,
    variant: m.variant,
    unit: m.unit,
    stock_qty: 0,
    min_stock: 5,
    is_custom: false,
    created_at: new Date().toISOString().split('T')[0]
  }));
  if (!Array.isArray(db.bon_material)) db.bon_material = [];
  writeDB(db);
}

// --- Material Master (bisa di-extend user) ---
app.get('/api/materials', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.materials || []);
});

app.post('/api/materials', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  if (!db.materials) db.materials = [];
  const { name, category, variant, unit, stock_qty, min_stock } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, message: 'Nama material wajib diisi!' });
  }
  const newMat = {
    id: 'mat-' + Date.now(),
    name: String(name).trim(),
    category: MATERIAL_CATEGORIES.includes(category) ? category : 'Lainnya',
    variant: String(variant || '').trim(),
    unit: String(unit || 'pcs').trim(),
    stock_qty: Number(stock_qty) || 0,
    min_stock: Number(min_stock) || 5,
    is_custom: true,
    created_at: new Date().toISOString().split('T')[0]
  };
  db.materials.push(newMat);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Material berhasil ditambahkan.', material: newMat });
});

app.put('/api/materials/:id', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  const index = (db.materials || []).findIndex(m => m.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Material tidak ditemukan.' });

  // Whitelisting field to prevent mass assignment
  const { name, category, variant, unit, stock_qty, min_stock } = req.body;
  if (name !== undefined) db.materials[index].name = String(name).trim();
  if (category !== undefined && MATERIAL_CATEGORIES.includes(category)) db.materials[index].category = category;
  if (variant !== undefined) db.materials[index].variant = String(variant).trim();
  if (unit !== undefined) db.materials[index].unit = String(unit).trim();
  if (stock_qty !== undefined) db.materials[index].stock_qty = Number(stock_qty) || 0;
  if (min_stock !== undefined) db.materials[index].min_stock = Number(min_stock) || 0;

  writeDB(db);
  res.json({ success: true, message: 'Material berhasil diupdate.' });
});

app.delete('/api/materials/:id', authenticateToken, requireRoles(['direktur', 'superadmin']), (req, res) => {
  const db = readDB();
  const index = (db.materials || []).findIndex(m => m.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Material tidak ditemukan.' });
  const [removed] = db.materials.splice(index, 1);
  writeDB(db);
  res.json({ success: true, message: 'Material dihapus.', material: removed });
});

// --- Bon Material (1 bon per WO) ---
function sanitizeBonItem(raw) {
  const arrived = Number(raw.qty_arrived) || 0;
  const used = Number(raw.qty_used) || 0;
  const remaining = (raw.qty_remaining !== undefined && raw.qty_remaining !== null && raw.qty_remaining !== '')
    ? Number(raw.qty_remaining)
    : arrived - used;
  return {
    id: String(raw.id || ('boni-' + Date.now() + '-' + Math.floor(Math.random() * 1000))),
    material_id: String(raw.material_id || ''),
    name: String(raw.name || '').trim(),
    category: String(raw.category || 'Lainnya'),
    variant: String(raw.variant || ''),
    unit: String(raw.unit || 'pcs'),
    qty_planned: Number(raw.qty_planned) || 0,
    qty_arrived: arrived,
    qty_used: used,
    qty_remaining: Number.isFinite(remaining) ? remaining : 0
  };
}

app.get('/api/bon-material', authenticateToken, (req, res) => {
  const db = readDB();
  let list = db.bon_material || [];
  if (req.query.project_id) {
    list = list.filter(b => b.project_id === req.query.project_id);
  }
  const enriched = list.map(b => {
    const p = (db.projects || []).find(proj => proj.id === b.project_id);
    const fullWo = p ? (p.job_name || p.cluster_name || p.wo_number) : b.wo_number;
    const spNum = p ? (p.sp_number || p.wo_number) : (b.sp_number || b.wo_number);
    return {
      ...b,
      wo_number: fullWo,
      sp_number: spNum,
      job_name: fullWo,
      cluster_name: p ? p.cluster_name : '',
      client_name: p ? p.client_name : '',
      executor_name: p ? p.executor_name : '',
      executor_type: p ? p.executor_type : ''
    };
  });
  res.json(enriched);
});

app.get('/api/bon-material/:id', authenticateToken, (req, res) => {
  const db = readDB();
  const bon = (db.bon_material || []).find(b => b.id === req.params.id);
  if (!bon) return res.status(404).json({ success: false, message: 'Bon material tidak ditemukan.' });
  const p = (db.projects || []).find(proj => proj.id === bon.project_id);
  const fullWo = p ? (p.job_name || p.cluster_name || p.wo_number) : bon.wo_number;
  const spNum = p ? (p.sp_number || p.wo_number) : (bon.sp_number || bon.wo_number);
  res.json({
    ...bon,
    wo_number: fullWo,
    sp_number: spNum,
    job_name: fullWo,
    cluster_name: p ? p.cluster_name : '',
    client_name: p ? p.client_name : '',
    executor_name: p ? p.executor_name : '',
    executor_type: p ? p.executor_type : ''
  });
});

app.post('/api/bon-material', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  const { project_id, notes } = req.body;
  const project = (db.projects || []).find(p => p.id === project_id);
  if (!project) {
    return res.status(404).json({ success: false, message: 'WO/proyek tidak ditemukan.' });
  }
  const existing = (db.bon_material || []).find(b => b.project_id === project_id);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Bon material untuk WO ini sudah ada.', bon: existing });
  }
  const today = new Date().toISOString().split('T')[0];
  const fullWo = project.job_name || project.cluster_name || project.wo_number;
  const newBon = {
    id: 'bon-' + Date.now(),
    project_id: project.id,
    wo_number: fullWo,
    sp_number: project.sp_number || project.wo_number,
    job_name: fullWo,
    client_name: project.client_name || '',
    status: 'Draft',
    notes: String(notes || '').trim(),
    items: [],
    created_by: req.user ? req.user.id : '',
    created_at: today,
    updated_at: today
  };
  if (!db.bon_material) db.bon_material = [];
  db.bon_material.push(newBon);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Bon material dibuat.', bon: newBon });
});

app.put('/api/bon-material/:id', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), (req, res) => {
  const db = readDB();
  const bon = (db.bon_material || []).find(b => b.id === req.params.id);
  if (!bon) return res.status(404).json({ success: false, message: 'Bon material tidak ditemukan.' });

  const { status, notes, items } = req.body;
  if (status !== undefined && ['Draft', 'Disetujui', 'Selesai'].includes(status)) bon.status = status;
  if (notes !== undefined) bon.notes = String(notes).trim();
  if (Array.isArray(items)) {
    // Pengurangan stok gudang manual berdasarkan realisasi terpasang di lapangan (qty_used)
    const oldItemsMap = new Map();
    (bon.items || []).forEach(it => {
      const key = it.material_id || it.id;
      oldItemsMap.set(key, Number(it.qty_used) || 0);
    });

    const sanitized = items.map(sanitizeBonItem);

    if (!Array.isArray(db.materials)) db.materials = [];
    sanitized.forEach(newItem => {
      const key = newItem.material_id || newItem.id;
      const oldUsed = oldItemsMap.get(key) || 0;
      const newUsed = Number(newItem.qty_used) || 0;
      const deltaUsed = newUsed - oldUsed;

      if (deltaUsed !== 0 && newItem.material_id) {
        const matIdx = db.materials.findIndex(m => m.id === newItem.material_id);
        if (matIdx !== -1) {
          db.materials[matIdx].stock_qty = Math.max(0, (Number(db.materials[matIdx].stock_qty) || 0) - deltaUsed);
        }
      }
    });

    bon.items = sanitized;
  }
  bon.updated_at = new Date().toISOString().split('T')[0];
  writeDB(db);
  res.json({ success: true, message: 'Bon material diupdate.', bon });
});

app.delete('/api/bon-material/:id', authenticateToken, requireRoles(['direktur', 'superadmin']), (req, res) => {
  const db = readDB();
  const index = (db.bon_material || []).findIndex(b => b.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Bon material tidak ditemukan.' });
  const [removed] = db.bon_material.splice(index, 1);
  writeDB(db);
  res.json({ success: true, message: 'Bon material dihapus.', bon: removed });
});

// -------------------------------------------------------------
// 17. MATERIAL INBOUNDS (MATERIAL DATANG KE GUDANG)
// -------------------------------------------------------------
app.get('/api/material-inbounds', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.material_inbounds || []);
});

app.post('/api/material-inbounds', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm', 'admin']), (req, res) => {
  const db = readDB();
  const { material_id, qty, supplier, received_date, notes } = req.body;
  const numQty = parseInt(qty, 10);
  if (!material_id || isNaN(numQty) || numQty <= 0) {
    return res.status(400).json({ success: false, message: 'Material dan jumlah valid (>0) wajib diisi!' });
  }

  const mat = (db.materials || []).find(m => m.id === material_id);
  if (!mat) {
    return res.status(404).json({ success: false, message: 'Material tidak ditemukan di master data.' });
  }

  const newInbound = {
    id: 'inb-' + Date.now(),
    material_id: mat.id,
    material_name: mat.name,
    category: mat.category,
    variant: mat.variant || '',
    unit: mat.unit || 'pcs',
    qty: numQty,
    supplier: String(supplier || '').trim(),
    notes: String(notes || '').trim(),
    received_date: received_date || new Date().toISOString().split('T')[0],
    created_by: req.user ? req.user.name : 'User',
    created_at: new Date().toISOString()
  };

  if (!Array.isArray(db.material_inbounds)) db.material_inbounds = [];
  db.material_inbounds.push(newInbound);

  // Otomatis menambah stok gudang
  mat.stock_qty = (Number(mat.stock_qty) || 0) + numQty;

  writeDB(db);
  res.status(201).json({ success: true, message: 'Material datang berhasil dicatat, stok gudang bertambah.', inbound: newInbound });
});

app.delete('/api/material-inbounds/:id', authenticateToken, requireRoles(['direktur', 'superadmin']), (req, res) => {
  const db = readDB();
  const idx = (db.material_inbounds || []).findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Catatan material datang tidak ditemukan.' });

  const [removed] = db.material_inbounds.splice(idx, 1);
  // Revert stok gudang
  const mat = (db.materials || []).find(m => m.id === removed.material_id);
  if (mat) {
    mat.stock_qty = Math.max(0, (Number(mat.stock_qty) || 0) - Number(removed.qty || 0));
  }

  writeDB(db);
  res.json({ success: true, message: 'Catatan material datang dihapus dan stok dikoreksi.', removed });
});

// -------------------------------------------------------------
// 18. BON REQUESTS & APPROVAL (INTEGRASI BOT TELEGRAM)
// -------------------------------------------------------------
app.get('/api/bon-requests', authenticateToken, (req, res) => {
  const db = readDB();
  let list = db.bon_requests || [];
  if (req.query.project_id) {
    list = list.filter(r => r.project_id === req.query.project_id);
  }
  if (req.query.status) {
    list = list.filter(r => r.status === req.query.status);
  }
  res.json(list);
});

app.post('/api/bon-requests', authenticateToken, (req, res) => {
  const db = readDB();
  const { project_id, items, notes } = req.body;
  const project = (db.projects || []).find(p => p.id === project_id);
  if (!project) return res.status(404).json({ success: false, message: 'Work Order tidak ditemukan.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Minimal sertakan 1 item material!' });
  }

  const newRequest = {
    id: 'req-' + Date.now(),
    project_id: project.id,
    wo_number: project.wo_number,
    client_name: project.client_name,
    cluster_name: project.cluster_name,
    items: items.map(it => ({
      material_id: it.material_id || '',
      name: String(it.name || '').trim(),
      category: String(it.category || 'Lainnya'),
      variant: String(it.variant || ''),
      unit: String(it.unit || 'pcs'),
      qty_planned: Number(it.qty_planned) || 0
    })),
    notes: String(notes || '').trim(),
    status: 'Pending',
    requested_by_tg_id: req.user && req.user.telegram_id ? String(req.user.telegram_id) : '',
    requested_by_name: req.user ? req.user.name : 'User Web',
    requested_by_role: req.user ? req.user.role : 'teknisi',
    created_at: new Date().toISOString().split('T')[0],
    updated_at: new Date().toISOString()
  };

  if (!Array.isArray(db.bon_requests)) db.bon_requests = [];
  db.bon_requests.push(newRequest);
  writeDB(db);

  if (telegramBot) {
    telegramBot.notifyPMNewBonRequest(newRequest).catch(() => {});
  }

  res.status(201).json({ success: true, message: 'Request bon material berhasil diajukan (status Pending).', request: newRequest });
});

app.post('/api/bon-requests/:id/approve', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), async (req, res) => {
  const approverName = req.user ? req.user.name : 'Project Manager';
  const result = await telegramBot.approveBonRequest(req.params.id, approverName);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json({ success: true, message: 'Request bon material berhasil disetujui.', request: result.request, bon: result.bon });
});

app.post('/api/bon-requests/:id/reject', authenticateToken, requireRoles(['direktur', 'superadmin', 'pm']), async (req, res) => {
  const rejectorName = req.user ? req.user.name : 'Project Manager';
  const reason = req.body && req.body.reason ? String(req.body.reason).trim() : 'Tidak disetujui oleh PM';
  const result = await telegramBot.rejectBonRequest(req.params.id, rejectorName, reason);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json({ success: true, message: 'Request bon material telah ditolak.', request: result.request });
});

// -------------------------------------------------------------
// 19. TELEGRAM USERS MANAGEMENT API (SUPERADMIN)
// -------------------------------------------------------------
app.get('/api/telegram-users', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  res.json(db.telegram_users || []);
});

app.post('/api/telegram-users', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  const { telegram_id, name, role } = req.body;
  if (!telegram_id || !name || !role) {
    return res.status(400).json({ success: false, message: 'ID Telegram, Nama, dan Role wajib diisi!' });
  }

  const allowedRoles = ['teknisi', 'admin', 'pm', 'superadmin'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Role harus salah satu dari: teknisi, admin, pm, superadmin' });
  }

  if (!Array.isArray(db.telegram_users)) db.telegram_users = [];
  const existing = db.telegram_users.find(u => String(u.telegram_id) === String(telegram_id));
  if (existing) {
    existing.name = String(name).trim();
    existing.role = role;
    writeDB(db);
    return res.json({ success: true, message: 'User Telegram diperbarui.', user: existing });
  }

  const newUser = {
    id: 'tg-user-' + Date.now(),
    telegram_id: String(telegram_id).trim(),
    name: String(name).trim(),
    role,
    created_at: new Date().toISOString().split('T')[0]
  };

  db.telegram_users.push(newUser);
  writeDB(db);
  res.status(201).json({ success: true, message: 'User Telegram berhasil didaftarkan.', user: newUser });
});

app.delete('/api/telegram-users/:id', authenticateToken, requireRoles(['superadmin']), (req, res) => {
  const db = readDB();
  const idx = (db.telegram_users || []).findIndex(u => u.id === req.params.id || String(u.telegram_id) === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'User Telegram tidak ditemukan.' });

  const [removed] = db.telegram_users.splice(idx, 1);
  writeDB(db);
  res.json({ success: true, message: 'User Telegram dihapus.', removed });
});

// -------------------------------------------------------------
// 20. GLOBAL ERROR HANDLER
// -------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes('CORS')) {
    return res.status(403).json({ success: false, message: err.message });
  }
  console.error(err.stack || err);
  res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
});

// -------------------------------------------------------------
// 21. SERVER INITIALIZATION
// -------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  ensureMaterialSeeds();
  if (process.env.NODE_ENV !== 'test' && !process.env.SMOKE_PORT) {
    telegramBot.start();
  }
  console.log(`PT Akses Kwalitas Unggul Server running at http://localhost:${PORT}`);
});
