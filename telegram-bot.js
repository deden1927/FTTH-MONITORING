/**
 * PT Akses Kwalitas Unggul - Telegram Bot Service
 * Integrasi Bon Material, Antrean Request (Pending), Approval PM, & Notifikasi Real-time
 * Zero-external-dependency (menggunakan native fetch Node.js v18+)
 */

const fs = require('fs');
const path = require('path');

class TelegramBotService {
  constructor(options = {}) {
    this.token = options.token || process.env.TELEGRAM_BOT_TOKEN || '';
    this.readDB = options.readDB;
    this.writeDB = options.writeDB;
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
    this.isRunning = false;
    this.offset = 0;
    this.userSessions = new Map(); // chatId -> { step, data }
    this.pollingTimeout = null;
  }

  // -------------------------------------------------------------
  // 1. API WRAPPER METHODS
  // -------------------------------------------------------------
  async apiCall(method, body = {}) {
    if (!this.token) return null;
    try {
      const res = await fetch(`${this.apiBase}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`[Telegram Bot] Error calling ${method}:`, data.description);
      }
      return data;
    } catch (err) {
      console.error(`[Telegram Bot] Network error on ${method}:`, err.message);
      return null;
    }
  }

  async sendMessage(chatId, text, options = {}) {
    return this.apiCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode || 'HTML',
      reply_markup: options.reply_markup || undefined,
      disable_web_page_preview: true
    });
  }

  async editMessageText(chatId, messageId, text, options = {}) {
    return this.apiCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parse_mode || 'HTML',
      reply_markup: options.reply_markup || undefined,
      disable_web_page_preview: true
    });
  }

  async answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    return this.apiCall('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert
    });
  }

  // -------------------------------------------------------------
  // 2. LIFECYCLE, MULTI-PROCESS LOCK & POLLING
  // -------------------------------------------------------------
  isPidAlive(pid) {
    if (!pid || isNaN(pid)) return false;
    try {
      process.kill(Number(pid), 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM'; // Proses hidup tapi milik user lain
    }
  }

  acquireLock() {
    const lockDir = path.join(__dirname, 'data');
    if (!fs.existsSync(lockDir)) {
      try { fs.mkdirSync(lockDir, { recursive: true }); } catch (_) {}
    }
    const lockFile = path.join(lockDir, 'telegram-bot.lock');

    if (fs.existsSync(lockFile)) {
      try {
        const raw = fs.readFileSync(lockFile, 'utf8');
        const lock = JSON.parse(raw);
        if (lock && lock.pid && lock.pid !== process.pid && this.isPidAlive(lock.pid)) {
          console.log(`[Telegram Bot] Bot sudah aktif di proses lain (PID: ${lock.pid}). Polling dinonaktifkan pada worker PID ${process.pid} ini untuk mencegah respon ganda.`);
          return false;
        }
      } catch (_) {
        // Lock file rusak/kosong, timpa
      }
    }

    try {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, started_at: Date.now() }), 'utf8');
      this.lockFile = lockFile;
      return true;
    } catch (err) {
      console.error('[Telegram Bot] Gagal menulis lock file:', err.message);
      return true;
    }
  }

  releaseLock() {
    if (this.lockFile && fs.existsSync(this.lockFile)) {
      try {
        const raw = fs.readFileSync(this.lockFile, 'utf8');
        const lock = JSON.parse(raw);
        if (lock && lock.pid === process.pid) {
          fs.unlinkSync(this.lockFile);
        }
      } catch (_) {}
    }
  }

  async start() {
    if (!this.token) {
      console.log('[Telegram Bot] TELEGRAM_BOT_TOKEN belum diset di .env. Bot dinonaktifkan.');
      return;
    }
    if (this.isRunning) return;

    if (!this.acquireLock()) {
      return;
    }

    this.isRunning = true;
    const cleanup = () => {
      this.stop();
      this.releaseLock();
    };
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    try {
      const me = await this.apiCall('getMe');
      if (me && me.ok) {
        console.log(`[Telegram Bot] Aktif sebagai @${me.result.username} (ID: ${me.result.id}, PID: ${process.pid})`);
        this.poll();
      } else {
        console.error('[Telegram Bot] Gagal terhubung ke Telegram. Periksa token.');
        this.releaseLock();
      }
    } catch (err) {
      console.error('[Telegram Bot] Gagal inisialisasi bot:', err.message);
      this.releaseLock();
    }
  }

  stop() {
    this.isRunning = false;
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
    this.releaseLock();
  }

  async poll() {
    if (!this.isRunning) return;
    try {
      const res = await this.apiCall('getUpdates', {
        offset: this.offset,
        timeout: 20
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      }
    } catch (err) {
      console.error('[Telegram Bot] Error pada loop polling:', err.message);
    }

    if (this.isRunning) {
      this.pollingTimeout = setTimeout(() => this.poll(), 1000);
    }
  }

  // -------------------------------------------------------------
  // 3. DATABASE & USER ROLE HELPERS
  // -------------------------------------------------------------
  getDB() {
    return typeof this.readDB === 'function' ? this.readDB() : { telegram_users: [], bon_requests: [], bon_material: [], projects: [], materials: [] };
  }

  saveDB(db) {
    if (typeof this.writeDB === 'function') {
      return this.writeDB(db);
    }
    return false;
  }

  findUser(tgId) {
    const db = this.getDB();
    const strId = String(tgId);
    return (db.telegram_users || []).find(u => String(u.telegram_id) === strId);
  }

  hasRole(tgId, allowedRoles = []) {
    const user = this.findUser(tgId);
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return allowedRoles.includes(user.role);
  }

  // -------------------------------------------------------------
  // 4. UPDATE DISPATCHER
  // -------------------------------------------------------------
  async handleUpdate(update) {
    if (!update) return;

    // Deduplikasi update_id agar update yang sama tidak pernah dieksekusi 2 kali
    if (update.update_id) {
      if (!this.processedUpdates) this.processedUpdates = new Set();
      if (this.processedUpdates.has(update.update_id)) {
        return;
      }
      this.processedUpdates.add(update.update_id);
      if (this.processedUpdates.size > 2000) {
        const arr = Array.from(this.processedUpdates);
        this.processedUpdates = new Set(arr.slice(-1000));
      }
    }

    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (err) {
      console.error('[Telegram Bot] Gagal memproses update:', err);
    }
  }

  // -------------------------------------------------------------
  // 5. MESSAGE HANDLERS
  // -------------------------------------------------------------
  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const sender = msg.from || {};
    const tgId = String(sender.id);

    // Command claim Superadmin pertama kali jika DB belum memiliki superadmin
    if (text === '/claim_superadmin') {
      const db = this.getDB();
      if (!Array.isArray(db.telegram_users)) db.telegram_users = [];
      const hasSuperadmin = db.telegram_users.some(u => u.role === 'superadmin');
      if (!hasSuperadmin) {
        const newUser = {
          id: 'tg-user-' + Date.now(),
          telegram_id: tgId,
          username: sender.username || '',
          name: [sender.first_name, sender.last_name].filter(Boolean).join(' ') || 'Superadmin',
          role: 'superadmin',
          created_at: new Date().toISOString().split('T')[0]
        };
        db.telegram_users.push(newUser);
        this.saveDB(db);
        await this.sendMessage(chatId, `🎉 <b>Selamat!</b> Anda berhasil dikukuhkan sebagai <b>Superadmin Pertama</b> sistem FTTH PT AKU.`);
        return this.sendMainMenu(chatId, newUser);
      } else {
        await this.sendMessage(chatId, `⚠️ Superadmin sudah terdaftar di sistem. Silakan hubungi Superadmin yang ada untuk pemberian akses.`);
        return;
      }
    }

    const user = this.findUser(tgId);

    // Jika user belum terdaftar
    if (!user) {
      return this.sendUnregisteredMenu(chatId, sender);
    }

    // Command /start atau /menu
    if (text === '/start' || text === '/menu' || text === '🔙 Menu Utama') {
      this.userSessions.delete(chatId);
      return this.sendMainMenu(chatId, user);
    }

    // Command /myid
    if (text === '/myid') {
      return this.sendMessage(chatId, `🆔 <b>ID Telegram Anda:</b> <code>${tgId}</code>\nRole: <b>${user.role.toUpperCase()}</b>\nNama: ${user.name}`);
    }

    // Cek apakah user sedang berada di session wizard aktif
    const session = this.userSessions.get(chatId);
    if (session) {
      return this.handleSessionInput(chatId, text, session, user);
    }

    // Handle tombol keyboard menu utama
    if (text === '⚡ Pilihan WO Aktif' || text.includes('WO Aktif') || text === '/wo' || text === '/wo_aktif') {
      return this.showActiveProjects(chatId, user);
    } else if (text === '📦 Request Material WO') {
      return this.startBonRequestFlow(chatId, user);
    } else if (text === '📋 Cek Status Bon & Request') {
      return this.showBonStatusList(chatId, user);
    } else if (text === '✅ Antrean Approval Bon') {
      return this.showPendingApprovals(chatId, user);
    } else if (text === '🏭 Cek Stok Gudang') {
      return this.showWarehouseStock(chatId, user);
    } else if (text === '📥 Input Material Datang') {
      return this.startInboundFlow(chatId, user);
    } else if (text === '👑 Dashboard Superadmin') {
      return this.showSuperadminDashboard(chatId, user);
    }

    // Default jika text tidak dikenali
    await this.sendMessage(chatId, `Perintah tidak dikenali. Ketik /menu untuk membuka menu navigasi.`);
  }

  // -------------------------------------------------------------
  // 6. UI & MENU BUILDERS
  // -------------------------------------------------------------
  async sendUnregisteredMenu(chatId, sender) {
    const tgId = String(sender.id);
    const fullName = [sender.first_name, sender.last_name].filter(Boolean).join(' ') || 'Pengguna';
    const text = `Halo <b>${fullName}</b>! 👋\n\n` +
      `Sistem mendeteksi ID Telegram Anda: <code>${tgId}</code>\n` +
      `Akun Anda saat ini <b>belum terdaftar</b> di sistem FTTH Monitoring PT Akses Kwalitas Unggul.\n\n` +
      `Silakan ajukan akses agar Superadmin dapat menentukan role Anda (Teknisi, Admin, PM, atau Superadmin).`;

    const inline_keyboard = [
      [{ text: '📩 Ajukan Akses ke Superadmin', callback_data: `apply_access:${tgId}` }]
    ];

    await this.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard }
    });
  }

  async sendMainMenu(chatId, user) {
    const role = user.role;
    let buttons = [];

    if (role === 'teknisi') {
      buttons = [
        [{ text: '⚡ Pilihan WO Aktif' }, { text: '📦 Request Material WO' }],
        [{ text: '📥 Input Material Datang' }, { text: '📋 Cek Status Bon & Request' }]
      ];
    } else if (role === 'admin') {
      buttons = [
        [{ text: '⚡ Pilihan WO Aktif' }, { text: '📦 Request Material WO' }],
        [{ text: '📥 Input Material Datang' }, { text: '🏭 Cek Stok Gudang' }],
        [{ text: '📋 Cek Status Bon & Request' }]
      ];
    } else if (role === 'pm') {
      buttons = [
        [{ text: '⚡ Pilihan WO Aktif' }, { text: '✅ Antrean Approval Bon' }],
        [{ text: '📋 Cek Status Bon & Request' }, { text: '🏭 Cek Stok Gudang' }],
        [{ text: '📥 Input Material Datang' }]
      ];
    } else if (role === 'superadmin') {
      buttons = [
        [{ text: '⚡ Pilihan WO Aktif' }, { text: '✅ Antrean Approval Bon' }],
        [{ text: '📦 Request Material WO' }, { text: '📥 Input Material Datang' }],
        [{ text: '🏭 Cek Stok Gudang' }, { text: '📋 Cek Status Bon & Request' }],
        [{ text: '👑 Dashboard Superadmin' }]
      ];
    }

    const text = `🏢 <b>PT Akses Kwalitas Unggul</b>\n` +
      `Sistem Monitoring & Bon Material FTTH\n\n` +
      `👤 <b>Pengguna:</b> ${user.name}\n` +
      `🎖️ <b>Role:</b> <code>${role.toUpperCase()}</code>\n\n` +
      `Pilih menu operasional di bawah:`;

    await this.sendMessage(chatId, text, {
      reply_markup: {
        keyboard: buttons,
        resize_keyboard: true
      }
    });
  }

  // -------------------------------------------------------------
  // 6b. HELPER & FLOW: PILIHAN WO AKTIF (MANAJEMEN WO & LAPANGAN)
  // -------------------------------------------------------------
  getActiveProjects() {
    const db = this.getDB();
    return (db.projects || []).filter(p => {
      if (p.status === 'Done' || p.status === 'Selesai') return false;
      const pMilestones = (db.milestones || []).filter(m => m.project_id === p.id);
      if (pMilestones.length > 0 && pMilestones.every(m => m.status === 'Done')) {
        return false;
      }
      return true;
    }).map(p => {
      const pMilestones = (db.milestones || []).filter(m => m.project_id === p.id);
      const doneCount = pMilestones.filter(m => m.status === 'Done').length;
      const totalCount = pMilestones.length || 4;
      const progress = Math.round((doneCount / totalCount) * 100);
      return {
        ...p,
        milestones: pMilestones,
        progress_percent: progress
      };
    });
  }

  async showActiveProjects(chatId, user) {
    const activeProjects = this.getActiveProjects();
    if (activeProjects.length === 0) {
      return this.sendMessage(chatId,
        `ℹ️ <b>Tidak ada Work Order (WO) Aktif</b> saat ini.\n\n` +
        `Semua pekerjaan di lapangan telah selesai (100%) atau belum ada WO baru di Manajemen WO & Lapangan.`
      );
    }

    let msg = `⚡ <b>Daftar Pilihan Work Order (WO) Aktif</b>\n` +
      `<i>Total: <b>${activeProjects.length} Pekerjaan</b> sedang berjalan di lapangan</i>\n` +
      `──────────────────────────\n\n`;

    const inline_keyboard = [];

    activeProjects.slice(0, 10).forEach((p, idx) => {
      const spNum = p.sp_number || p.wo_number || '-';
      const jobName = p.job_name || p.cluster_name || p.wo_number || '-';
      const client = p.client_name || '-';
      const progress = p.progress_percent || 0;
      const exec = p.executor_name || (p.executor_type === 'Internal' ? 'Tim Internal' : 'Mandor');

      const mSummaries = (p.milestones || []).map((m, mIdx) => {
        const mNames = ['Tiang', 'KU Fiber', 'ODP', 'ATP'];
        const name = mNames[mIdx] || (m.stage_name ? m.stage_name.slice(0, 8) : `M${mIdx + 1}`);
        const icon = m.status === 'Done' ? '✅' : (m.status === 'Blocked' ? '⛔' : (m.status === 'In-Progress' ? '🔄' : '⏳'));
        return `${icon} ${name}`;
      }).join(' • ');

      msg += `<b>${idx + 1}. [SP: ${spNum}]</b>\n` +
        `📍 Pekerjaan: <b>${jobName}</b>\n` +
        `🏢 Klien: <b>${client}</b>\n` +
        `📊 Progres Fisik: <b>${progress}%</b> [${p.status || 'In-Progress'}]\n` +
        `👷 Tim Lapangan: <i>${p.executor_type || 'Mandor'} (${exec})</i>\n` +
        (mSummaries ? `📌 Milestone: ${mSummaries}\n` : '') +
        `\n`;

      inline_keyboard.push([
        {
          text: `📦 Request Bon: ${jobName.slice(0, 26)}`,
          callback_data: `req_wo:${p.id}`
        }
      ]);
    });

    if (activeProjects.length > 10) {
      msg += `<i>... dan ${activeProjects.length - 10} pekerjaan aktif lainnya.</i>\n\n`;
    }

    msg += `<i>Pilih tombol di bawah untuk langsung mengajukan request material ke WO terkait:</i>`;

    await this.sendMessage(chatId, msg, {
      reply_markup: { inline_keyboard }
    });
  }

  // -------------------------------------------------------------
  // 7. FLOW: REQUEST BON MATERIAL PER WO (TEKNISI / ADMIN)
  // -------------------------------------------------------------
  async startBonRequestFlow(chatId, user) {
    const activeProjects = this.getActiveProjects();

    if (activeProjects.length === 0) {
      return this.sendMessage(chatId, `⚠️ <b>Tidak ada Work Order aktif</b> saat ini untuk diajukan bon material.`);
    }

    const inline_keyboard = activeProjects.slice(0, 15).map(p => ([
      {
        text: `[${p.sp_number || p.wo_number}] ${p.job_name || p.cluster_name || p.wo_number} (${p.client_name}) [${p.progress_percent}%]`,
        callback_data: `req_wo:${p.id}`
      }
    ]));
    inline_keyboard.push([{ text: '❌ Batal', callback_data: 'req_cancel' }]);

    await this.sendMessage(chatId, `📦 <b>Pilih Work Order (WO) Aktif</b> yang akan diajukan bon material:`, {
      reply_markup: { inline_keyboard }
    });
  }

  async promptSelectCategory(chatId, projectId) {
    const categories = ['Tiang', 'Kabel', 'ODP', 'Aksesoris Tiang', 'Slack Support', 'Lainnya'];
    const inline_keyboard = categories.map(c => ([
      { text: `📁 Kategori: ${c}`, callback_data: `req_cat:${projectId}:${c}` }
    ]));
    inline_keyboard.push([{ text: '❌ Batal Request', callback_data: 'req_cancel' }]);

    await this.sendMessage(chatId, `Pilih <b>Kategori Material</b>:`, {
      reply_markup: { inline_keyboard }
    });
  }

  async promptSelectMaterial(chatId, projectId, category) {
    const db = this.getDB();
    const mats = (db.materials || []).filter(m => (m.category || 'Lainnya') === category);

    if (mats.length === 0) {
      return this.sendMessage(chatId, `Tidak ditemukan material pada kategori ${category}.`);
    }

    const inline_keyboard = mats.slice(0, 20).map(m => ([
      {
        text: `${m.name}${m.variant ? ' ' + m.variant : ''} (${m.unit})`,
        callback_data: `req_mat:${projectId}:${m.id}`
      }
    ]));
    inline_keyboard.push([{ text: '🔙 Kembali ke Kategori', callback_data: `req_wo:${projectId}` }]);

    await this.sendMessage(chatId, `Pilih <b>Material</b>:`, {
      reply_markup: { inline_keyboard }
    });
  }

  // -------------------------------------------------------------
  // 8. FLOW: INBOUND MATERIAL DATANG (WO AKTIF & LAPANGAN)
  // -------------------------------------------------------------
  async startInboundFlow(chatId, user) {
    const activeProjects = this.getActiveProjects();

    const inline_keyboard = [];
    if (activeProjects.length > 0) {
      activeProjects.slice(0, 15).forEach(p => {
        const spNum = p.sp_number || p.wo_number || '-';
        const jobName = p.job_name || p.cluster_name || p.wo_number || '-';
        const client = p.client_name ? ` (${p.client_name})` : '';
        inline_keyboard.push([{
          text: `📍 [SP: ${spNum}] ${jobName.slice(0, 30)}${client}`,
          callback_data: `inb_wo:${p.id}`
        }]);
      });
    }

    inline_keyboard.push([{ text: '🏭 Stok Umum Gudang (Tanpa WO)', callback_data: 'inb_wo:general' }]);
    inline_keyboard.push([{ text: '❌ Batal', callback_data: 'inb_cancel' }]);

    const text = `📥 <b>Input Material Datang ke Lapangan / Teknisi</b>\n\n` +
      `Pilih <b>Work Order (WO) Aktif</b> tujuan penyerahan material:`;

    await this.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard }
    });
  }

  async promptInboundMaterialSelection(chatId, projId) {
    const db = this.getDB();
    const isGeneral = projId === 'general';
    const project = isGeneral ? null : (db.projects || []).find(p => p.id === projId);

    const inline_keyboard = [];

    // Jika terkait WO, tampilkan material yang sudah terdaftar di Bon WO untuk shortcut cepat
    if (project) {
      const bon = (db.bon_material || []).find(b => b.project_id === project.id);
      if (bon && Array.isArray(bon.items) && bon.items.length > 0) {
        bon.items.forEach(it => {
          const planned = it.qty_planned || 0;
          const arrived = it.qty_arrived || 0;
          inline_keyboard.push([{
            text: `📦 ${it.name} (Rencana: ${planned}, Datang: ${arrived} ${it.unit})`,
            callback_data: `inb_mat:${projId}:${it.material_id}`
          }]);
        });
      }
    }

    inline_keyboard.push([{ text: '📁 Pilih dari Kategori Lain / Baru', callback_data: `inb_cat_menu:${projId}` }]);
    inline_keyboard.push([{ text: '🔙 Ganti WO', callback_data: 'inb_back_wo' }]);
    inline_keyboard.push([{ text: '❌ Batal', callback_data: 'inb_cancel' }]);

    const title = project
      ? `WO: <b>[SP: ${project.sp_number || project.wo_number}] ${project.job_name || project.cluster_name}</b> (${project.client_name || '-'})`
      : `<b>Stok Umum Gudang (Tanpa WO)</b>`;

    const text = `📥 <b>Pilih Material yang Datang</b>\n${title}\n\n` +
      `Pilih barang yang diserahkan/tiba untuk dicatat:`;

    await this.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard }
    });
  }

  // -------------------------------------------------------------
  // 9. FLOW: DASHBOARD SUPERADMIN DI BOT
  // -------------------------------------------------------------
  async showSuperadminDashboard(chatId, user) {
    if (user.role !== 'superadmin') {
      return this.sendMessage(chatId, `Akses ditolak: Menu ini khusus Superadmin.`);
    }

    const db = this.getDB();
    const count = (db.telegram_users || []).length;

    const inline_keyboard = [
      [{ text: '➕ Tambah User Baru', callback_data: 'sa_add_user' }],
      [{ text: '📋 Kelola & Daftar User Bot', callback_data: 'sa_list_users:0' }],
      [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'sa_close' }]
    ];

    const text = `👑 <b>DASHBOARD SUPERADMIN BOT</b>\n\n` +
      `Total User Bot Terdaftar: <b>${count} orang</b>\n` +
      `Anda dapat menambahkan teknisi, admin, PM, atau superadmin baru, serta mengatur hak akses mereka langsung dari Telegram.`;

    await this.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard }
    });
  }

  async showUsersList(chatId, page = 0) {
    const db = this.getDB();
    const users = db.telegram_users || [];
    const pageSize = 5;
    const start = page * pageSize;
    const slice = users.slice(start, start + pageSize);

    if (slice.length === 0) {
      return this.sendMessage(chatId, `Belum ada user terdaftar selain Anda.`);
    }

    const inline_keyboard = [];
    slice.forEach(u => {
      inline_keyboard.push([
        { text: `👤 ${u.name} [${u.role.toUpperCase()}]`, callback_data: `sa_detail_user:${u.telegram_id}` }
      ]);
    });

    const navRow = [];
    if (page > 0) {
      navRow.push({ text: '⬅️ Prev', callback_data: `sa_list_users:${page - 1}` });
    }
    if (start + pageSize < users.length) {
      navRow.push({ text: 'Next ➡️', callback_data: `sa_list_users:${page + 1}` });
    }
    if (navRow.length > 0) inline_keyboard.push(navRow);

    inline_keyboard.push([{ text: '🔙 Dashboard Superadmin', callback_data: 'sa_menu' }]);

    const text = `📋 <b>Daftar User Bot Telegram (${users.length} terdaftar):</b>\n` +
      `Pilih salah satu user untuk melihat detail, mengganti role, atau menghapus akses:`;

    await this.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard }
    });
  }

  // -------------------------------------------------------------
  // 10. SESSION HANDLER (TEXT INPUT)
  // -------------------------------------------------------------
  async handleSessionInput(chatId, text, session, user) {
    // 1. Input Qty Request Material
    if (session.step === 'req_input_qty') {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty <= 0) {
        return this.sendMessage(chatId, `⚠️ Mohon masukkan angka jumlah yang valid (lebih dari 0):`);
      }

      session.data.items.push({
        material_id: session.data.tempMat.id,
        name: session.data.tempMat.name,
        category: session.data.tempMat.category,
        variant: session.data.tempMat.variant || '',
        unit: session.data.tempMat.unit || 'pcs',
        qty_planned: qty
      });

      delete session.data.tempMat;
      session.step = 'req_review';

      let itemsList = session.data.items.map((it, idx) =>
        `${idx + 1}. <b>${it.name}${it.variant ? ' ' + it.variant : ''}</b>: ${it.qty_planned} ${it.unit}`
      ).join('\n');

      const inline_keyboard = [
        [{ text: '➕ Tambah Material Lain', callback_data: `req_more:${session.data.projectId}` }],
        [{ text: '🚀 Kirim Pengajuan ke PM', callback_data: `req_submit:${session.data.projectId}` }],
        [{ text: '❌ Batalkan Request', callback_data: 'req_cancel' }]
      ];

      await this.sendMessage(chatId,
        `📝 <b>Daftar Request Material Sementara:</b>\n\n${itemsList}\n\n` +
        `Apakah ingin menambahkan material lain atau langsung kirim ke PM?`, {
          reply_markup: { inline_keyboard }
        }
      );
      return;
    }

    // 2. Input Qty Inbound Material Datang
    if (session.step === 'inb_input_qty') {
      const cleanText = text.trim().replace(/,/g, '.');
      const qty = parseFloat(cleanText);
      if (isNaN(qty) || qty <= 0) {
        return this.sendMessage(chatId, `⚠️ Masukkan angka jumlah yang valid (lebih dari 0, contoh: 50 atau 12.5):`);
      }
      session.data.qty = qty;
      session.step = 'inb_input_supplier';
      return this.sendMessage(chatId, `Masukkan <b>Asal Barang / Supplier / Nomor Surat Jalan / Catatan</b>:\n(Ketik "-" jika tidak ada)`);
    }

    // 3. Input Supplier & Simpan Inbound Material Datang
    if (session.step === 'inb_input_supplier') {
      const rawNotes = text.trim();
      session.data.supplier = rawNotes === '-' ? '' : rawNotes;
      const mat = session.data.mat;
      const project = session.data.project;
      const db = this.getDB();
      const numQty = Number(session.data.qty) || 0;
      const resolvedSupplier = session.data.supplier || '';
      const today = new Date().toISOString().split('T')[0];

      const newInbound = {
        id: 'inb-' + Date.now(),
        project_id: project ? project.id : null,
        wo_number: project ? (project.job_name || project.cluster_name || project.wo_number) : '',
        sp_number: project ? (project.sp_number || project.wo_number) : '',
        client_name: project ? project.client_name : '',
        material_id: mat.id,
        material_name: mat.name,
        category: mat.category,
        variant: mat.variant || '',
        unit: mat.unit || 'pcs',
        qty: numQty,
        qty_in: numQty,
        supplier: resolvedSupplier,
        supplier_surat_jalan: resolvedSupplier,
        notes: resolvedSupplier ? resolvedSupplier : ('Input via Bot Telegram oleh ' + user.name + ' (' + user.role + ')'),
        received_date: today,
        arrival_date: today,
        created_by: user.name,
        recorded_by_name: user.name,
        recorded_by_telegram_id: user.telegram_id,
        recorded_by_role: user.role,
        created_at: new Date().toISOString()
      };

      if (!Array.isArray(db.material_inbounds)) db.material_inbounds = [];
      db.material_inbounds.push(newInbound);

      // Tambahkan stock_qty ke master material
      const mIdx = (db.materials || []).findIndex(m => m.id === mat.id);
      let newStock = numQty;
      if (mIdx !== -1) {
        db.materials[mIdx].stock_qty = (Number(db.materials[mIdx].stock_qty) || 0) + numQty;
        newStock = db.materials[mIdx].stock_qty;
      }

      // Jika dialokasikan untuk WO, otomatis perbarui Bon Material WO tersebut (qty_arrived & qty_remaining)
      let bonItemRef = null;
      if (project) {
        if (!Array.isArray(db.bon_material)) db.bon_material = [];
        let bon = db.bon_material.find(b => b.project_id === project.id);
        if (!bon) {
          bon = {
            id: 'bon-' + project.id,
            project_id: project.id,
            wo_number: project.job_name || project.cluster_name || project.wo_number,
            sp_number: project.sp_number || project.wo_number,
            status: 'Disetujui',
            notes: 'Dibuat otomatis saat pelaporan material datang via Telegram',
            items: [],
            created_by: user.name,
            created_at: today,
            updated_at: today
          };
          db.bon_material.push(bon);
        }

        if (!Array.isArray(bon.items)) bon.items = [];
        let bonItem = bon.items.find(it => it.material_id === mat.id);
        if (bonItem) {
          bonItem.qty_arrived = (Number(bonItem.qty_arrived) || 0) + numQty;
          bonItem.qty_remaining = bonItem.qty_arrived - (Number(bonItem.qty_used) || 0);
        } else {
          bonItem = {
            id: 'boni-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            material_id: mat.id,
            name: mat.name,
            category: mat.category || 'Lainnya',
            variant: mat.variant || '',
            unit: mat.unit || 'pcs',
            qty_planned: 0,
            qty_arrived: numQty,
            qty_used: 0,
            qty_remaining: numQty
          };
          bon.items.push(bonItem);
        }
        bon.updated_at = today;
        bonItemRef = bonItem;
      }

      this.saveDB(db);
      this.userSessions.delete(chatId);

      const targetTitle = project
        ? `📍 WO: <b>[SP: ${project.sp_number || project.wo_number}] ${project.job_name || project.cluster_name}</b>\n🏢 Klien: <b>${project.client_name}</b>\n`
        : `🏭 Lokasi: <b>Stok Umum Gudang</b>\n`;

      const bonStatus = bonItemRef
        ? `📊 Status Bon WO: <b>${bonItemRef.qty_arrived} ${mat.unit} Datang</b> (Sisa di Lapangan: <b>${bonItemRef.qty_remaining} ${mat.unit}</b>)\n`
        : `🏭 Total Stok Gudang: <b>${newStock} ${mat.unit}</b>\n`;

      await this.sendMessage(chatId,
        `✅ <b>Laporan Material Datang Berhasil Dicatat!</b>\n\n` +
        targetTitle +
        `📦 Barang: <b>${mat.name}${mat.variant ? ' ' + mat.variant : ''}</b>\n` +
        `📥 Jumlah Masuk: <b>+${numQty} ${mat.unit}</b>\n` +
        bonStatus +
        `📄 Surat Jalan / Catatan: ${resolvedSupplier || '-'}\n` +
        `👤 Dicatat oleh: <b>${user.name} (${user.role.toUpperCase()})</b>\n\n` +
        `<i>Data otomatis tersinkron ke website & Bon Material WO terkait. Admin tidak perlu mendata ulang.</i>`
      );
      return;
    }

    // 4. Superadmin Wizard: Input ID Telegram User Baru
    if (session.step === 'sa_input_tgid') {
      const cleanId = text.trim();
      if (!/^\d+$/.test(cleanId)) {
        return this.sendMessage(chatId, `⚠️ ID Telegram harus berupa angka digit (contoh: 123456789). Masukkan kembali:`);
      }
      session.data.targetTgId = cleanId;
      session.step = 'sa_input_name';
      return this.sendMessage(chatId, `Masukkan <b>Nama Lengkap Pengguna</b>:`);
    }

    // 5. Superadmin Wizard: Input Nama Lengkap
    if (session.step === 'sa_input_name') {
      session.data.targetName = text.trim();
      session.step = 'sa_select_role';

      const inline_keyboard = [
        [
          { text: '🔧 Teknisi', callback_data: `sa_role:teknisi` },
          { text: '💼 Admin', callback_data: `sa_role:admin` }
        ],
        [
          { text: '📊 PM', callback_data: `sa_role:pm` },
          { text: '👑 Superadmin', callback_data: `sa_role:superadmin` }
        ],
        [{ text: '❌ Batal', callback_data: 'sa_menu' }]
      ];

      return this.sendMessage(chatId,
        `👤 User: <b>${session.data.targetName}</b>\n` +
        `🆔 ID: <code>${session.data.targetTgId}</code>\n\n` +
        `Pilih <b>Role</b> untuk pengguna ini:`, {
          reply_markup: { inline_keyboard }
        }
      );
    }
  }

  // -------------------------------------------------------------
  // 11. CALLBACK QUERY DISPATCHER (INLINE BUTTONS)
  // -------------------------------------------------------------
  async handleCallbackQuery(cb) {
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    const data = cb.data || '';
    const sender = cb.from || {};
    const tgId = String(sender.id);
    const user = this.findUser(tgId);

    // 1. Pengajuan akses dari user belum terdaftar
    if (data.startsWith('apply_access:')) {
      await this.answerCallbackQuery(cb.id, 'Permohonan dikirim ke Superadmin!');
      const reqTgId = data.split(':')[1];
      await this.editMessageText(chatId, msgId, `✅ <b>Permohonan Akses Terkirim</b>\nMohon tunggu Superadmin memberikan izin akses ke akun Anda.`);
      return this.notifySuperadminsNewApplicant(sender, reqTgId);
    }

    // 2. Tombol Quick Bind User oleh Superadmin
    if (data.startsWith('bind_user:')) {
      if (!user || user.role !== 'superadmin') {
        return this.answerCallbackQuery(cb.id, 'Akses ditolak: Hanya Superadmin yang dapat bind user!', true);
      }
      const parts = data.split(':');
      const targetTgId = parts[1];
      const targetRole = parts[2];
      const targetName = decodeURIComponent(parts[3] || 'User');

      const db = this.getDB();
      if (!Array.isArray(db.telegram_users)) db.telegram_users = [];
      const existing = db.telegram_users.find(u => String(u.telegram_id) === String(targetTgId));
      if (existing) {
        existing.role = targetRole;
        existing.name = targetName;
      } else {
        db.telegram_users.push({
          id: 'tg-user-' + Date.now(),
          telegram_id: String(targetTgId),
          username: '',
          name: targetName,
          role: targetRole,
          created_at: new Date().toISOString().split('T')[0]
        });
      }
      this.saveDB(db);

      await this.answerCallbackQuery(cb.id, `User berhasil disetujui sebagai ${targetRole.toUpperCase()}!`);
      await this.editMessageText(chatId, msgId, `✅ User <b>${targetName}</b> (<code>${targetTgId}</code>) telah disetujui dengan Role: <b>${targetRole.toUpperCase()}</b>.`);

      // Beritahu user yang bersangkutan
      await this.sendMessage(targetTgId,
        `🎉 <b>Akses Disetujui!</b>\n` +
        `Akun Telegram Anda telah diaktifkan oleh Superadmin dengan Role: <b>${targetRole.toUpperCase()}</b>.\n` +
        `Ketik /menu untuk mulai menggunakan bot.`
      );
      return;
    }

    // Handler lanjutan membutuhkan user terdaftar
    if (!user) {
      return this.answerCallbackQuery(cb.id, 'Anda belum terdaftar.', true);
    }

    // 3. Request Bon: Pilih WO
    if (data.startsWith('req_wo:')) {
      const projId = data.split(':')[1];
      this.userSessions.set(chatId, {
        step: 'req_building',
        data: { projectId: projId, items: [] }
      });
      await this.answerCallbackQuery(cb.id);
      return this.promptSelectCategory(chatId, projId);
    }

    // 4. Request Bon: Pilih Kategori
    if (data.startsWith('req_cat:')) {
      const parts = data.split(':');
      const projId = parts[1];
      const cat = parts[2];
      await this.answerCallbackQuery(cb.id);
      return this.promptSelectMaterial(chatId, projId, cat);
    }

    // 5. Request Bon: Pilih Material
    if (data.startsWith('req_mat:')) {
      const parts = data.split(':');
      const projId = parts[1];
      const matId = parts[2];
      const db = this.getDB();
      const mat = (db.materials || []).find(m => m.id === matId);
      if (!mat) {
        return this.answerCallbackQuery(cb.id, 'Material tidak ditemukan', true);
      }

      const session = this.userSessions.get(chatId) || { step: 'req_building', data: { projectId: projId, items: [] } };
      session.step = 'req_input_qty';
      session.data.tempMat = mat;
      this.userSessions.set(chatId, session);

      await this.answerCallbackQuery(cb.id);
      return this.sendMessage(chatId,
        `Berapa jumlah <b>${mat.name}${mat.variant ? ' ' + mat.variant : ''}</b> (${mat.unit}) yang diajukan?\n` +
        `Ketik angka saja:`
      );
    }

    // 6. Request Bon: Tambah Material Lagi
    if (data.startsWith('req_more:')) {
      const projId = data.split(':')[1];
      await this.answerCallbackQuery(cb.id);
      return this.promptSelectCategory(chatId, projId);
    }

    // 7. Request Bon: Submit Pengajuan ke PM
    if (data.startsWith('req_submit:')) {
      const projId = data.split(':')[1];
      const session = this.userSessions.get(chatId);
      if (!session || !session.data.items || session.data.items.length === 0) {
        return this.answerCallbackQuery(cb.id, 'Belum ada item diajukan!', true);
      }

      const db = this.getDB();
      const project = (db.projects || []).find(p => p.id === projId);
      if (!project) {
        return this.answerCallbackQuery(cb.id, 'WO tidak ditemukan!', true);
      }

      const newRequest = {
        id: 'req-' + Date.now(),
        project_id: project.id,
        wo_number: project.wo_number,
        client_name: project.client_name,
        cluster_name: project.cluster_name,
        items: session.data.items,
        notes: 'Diajukan via Telegram Bot oleh ' + user.name,
        status: 'Pending',
        requested_by_tg_id: tgId,
        requested_by_name: user.name,
        requested_by_role: user.role,
        created_at: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString()
      };

      if (!Array.isArray(db.bon_requests)) db.bon_requests = [];
      db.bon_requests.push(newRequest);
      this.saveDB(db);

      this.userSessions.delete(chatId);
      await this.answerCallbackQuery(cb.id, 'Pengajuan berhasil dikirim!');
      await this.sendMessage(chatId,
        `✅ <b>Request Bon Material Berhasil Diajukan!</b>\n\n` +
        `WO: <b>${project.wo_number}</b>\n` +
        `Total Item: <b>${newRequest.items.length} macam</b>\n` +
        `Status: <b>PENDING (Menunggu Persetujuan PM)</b>\n\n` +
        `Notifikasi telah dikirimkan ke PM. Anda akan menerima pemberitahuan otomatis begitu disetujui.`
      );

      // Broadcast ke PM dan Superadmin
      return this.notifyPMNewBonRequest(newRequest);
    }

    // 8. Batal Request
    if (data === 'req_cancel') {
      this.userSessions.delete(chatId);
      await this.answerCallbackQuery(cb.id, 'Pengajuan dibatalkan.');
      return this.editMessageText(chatId, msgId, `❌ Pengajuan bon material telah dibatalkan.`);
    }

    // 9. Approval Bon oleh PM / Superadmin via Telegram
    if (data.startsWith('approve_bon:')) {
      if (!['pm', 'superadmin'].includes(user.role)) {
        return this.answerCallbackQuery(cb.id, 'Akses ditolak: Hanya PM atau Superadmin yang boleh approve!', true);
      }
      const reqId = data.split(':')[1];
      const result = await this.approveBonRequest(reqId, user.name);
      if (result.success) {
        await this.answerCallbackQuery(cb.id, 'Bon Material Disetujui!');
        await this.editMessageText(chatId, msgId,
          `✅ <b>Bon Material DISETUJUI</b> oleh ${user.name} pada ${new Date().toLocaleTimeString('id-ID')}.\n` +
          `WO: <b>${result.request.wo_number}</b>\n` +
          `Item otomatis digabungkan ke Bon Material WO.`
        );
      } else {
        await this.answerCallbackQuery(cb.id, result.message, true);
      }
      return;
    }

    // 10. Reject Bon oleh PM / Superadmin via Telegram
    if (data.startsWith('reject_bon:')) {
      if (!['pm', 'superadmin'].includes(user.role)) {
        return this.answerCallbackQuery(cb.id, 'Akses ditolak!', true);
      }
      const reqId = data.split(':')[1];
      const result = await this.rejectBonRequest(reqId, user.name, 'Ditolak oleh PM via Telegram');
      if (result.success) {
        await this.answerCallbackQuery(cb.id, 'Bon Material Ditolak.');
        await this.editMessageText(chatId, msgId,
          `❌ <b>Bon Material DITOLAK</b> oleh ${user.name}.\n` +
          `WO: <b>${result.request.wo_number}</b>`
        );
      } else {
        await this.answerCallbackQuery(cb.id, result.message, true);
      }
      return;
    }

    // 11. Material Datang Inbound (WO Aktif & Lapangan)
    if (data.startsWith('inb_wo:')) {
      const projId = data.split(':')[1];
      await this.answerCallbackQuery(cb.id);
      return this.promptInboundMaterialSelection(chatId, projId);
    }

    if (data.startsWith('inb_cat_menu:')) {
      const projId = data.split(':')[1];
      const categories = ['Tiang', 'Kabel', 'ODP', 'Aksesoris Tiang', 'Slack Support', 'Lainnya'];
      const inline_keyboard = categories.map(c => ([
        { text: `📁 Kategori: ${c}`, callback_data: `inb_cat:${projId}:${c}` }
      ]));
      inline_keyboard.push([{ text: '🔙 Kembali', callback_data: `inb_wo:${projId}` }]);
      inline_keyboard.push([{ text: '❌ Batal', callback_data: 'inb_cancel' }]);

      await this.answerCallbackQuery(cb.id);
      return this.sendMessage(chatId, `Pilih <b>Kategori Material yang Datang</b>:`, {
        reply_markup: { inline_keyboard }
      });
    }

    if (data.startsWith('inb_cat:')) {
      const parts = data.split(':');
      const projId = parts.length > 2 ? parts[1] : 'general';
      const cat = parts.length > 2 ? parts[2] : parts[1];
      const db = this.getDB();
      const mats = (db.materials || []).filter(m => (m.category || 'Lainnya') === cat);
      if (mats.length === 0) {
        return this.answerCallbackQuery(cb.id, `Belum ada material di kategori ${cat}`, true);
      }

      const inline_keyboard = mats.slice(0, 20).map(m => ([
        { text: `${m.name}${m.variant ? ' ' + m.variant : ''} (${m.unit})`, callback_data: `inb_mat:${projId}:${m.id}` }
      ]));
      inline_keyboard.push([{ text: '🔙 Kembali ke Kategori', callback_data: `inb_cat_menu:${projId}` }]);
      inline_keyboard.push([{ text: '❌ Batal', callback_data: 'inb_cancel' }]);

      await this.answerCallbackQuery(cb.id);
      return this.sendMessage(chatId, `Pilih <b>Material (${cat}) yang Tiba</b>:`, {
        reply_markup: { inline_keyboard }
      });
    }

    if (data.startsWith('inb_mat:')) {
      const parts = data.split(':');
      const projId = parts.length > 2 ? parts[1] : 'general';
      const matId = parts.length > 2 ? parts[2] : parts[1];
      const db = this.getDB();
      const mat = (db.materials || []).find(m => m.id === matId);
      if (!mat) return this.answerCallbackQuery(cb.id, 'Material tidak ditemukan', true);

      const project = projId === 'general' ? null : (db.projects || []).find(p => p.id === projId);

      this.userSessions.set(chatId, {
        step: 'inb_input_qty',
        data: { projectId: projId, project, mat }
      });
      await this.answerCallbackQuery(cb.id);

      const targetLabel = project
        ? `untuk WO <b>[SP: ${project.sp_number || project.wo_number}] ${project.job_name || project.cluster_name}</b>`
        : `ke <b>Stok Umum Gudang</b>`;

      return this.sendMessage(chatId,
        `Berapa banyak <b>${mat.name}${mat.variant ? ' ' + mat.variant : ''}</b> (${mat.unit}) yang diserahkan/datang ${targetLabel}?\n\n` +
        `Ketik angka saja (contoh: 25 atau 50):`
      );
    }

    if (data === 'inb_back_wo') {
      await this.answerCallbackQuery(cb.id);
      return this.startInboundFlow(chatId, user);
    }

    if (data === 'inb_cancel') {
      this.userSessions.delete(chatId);
      await this.answerCallbackQuery(cb.id, 'Dibatalkan.');
      return this.editMessageText(chatId, msgId, `❌ Input material datang dibatalkan.`);
    }

    // 12. Superadmin Wizard Callbacks
    if (data === 'sa_menu') {
      this.userSessions.delete(chatId);
      await this.answerCallbackQuery(cb.id);
      return this.showSuperadminDashboard(chatId, user);
    }

    if (data === 'sa_add_user') {
      if (user.role !== 'superadmin') return this.answerCallbackQuery(cb.id, 'Khusus Superadmin', true);
      this.userSessions.set(chatId, { step: 'sa_input_tgid', data: {} });
      await this.answerCallbackQuery(cb.id);
      return this.sendMessage(chatId,
        `➕ <b>Tambah User Bot Baru</b>\n\n` +
        `Silakan masukkan <b>ID Telegram</b> user yang ingin didaftarkan (angka digit):\n` +
        `(Tips: User bisa dapat ID mereka dengan kirim /myid ke bot ini).`
      );
    }

    if (data.startsWith('sa_list_users:')) {
      const page = parseInt(data.split(':')[1], 10) || 0;
      await this.answerCallbackQuery(cb.id);
      return this.showUsersList(chatId, page);
    }

    if (data.startsWith('sa_detail_user:')) {
      const targetTgId = data.split(':')[1];
      const targetUser = this.findUser(targetTgId);
      if (!targetUser) return this.answerCallbackQuery(cb.id, 'User tidak ditemukan', true);

      const inline_keyboard = [
        [
          { text: 'Set Teknisi', callback_data: `sa_set_role:${targetTgId}:teknisi` },
          { text: 'Set Admin', callback_data: `sa_set_role:${targetTgId}:admin` }
        ],
        [
          { text: 'Set PM', callback_data: `sa_set_role:${targetTgId}:pm` },
          { text: 'Set Superadmin', callback_data: `sa_set_role:${targetTgId}:superadmin` }
        ],
        [{ text: '🗑️ Hapus User Ini', callback_data: `sa_del_user:${targetTgId}` }],
        [{ text: '🔙 Kembali ke Daftar', callback_data: 'sa_list_users:0' }]
      ];

      await this.answerCallbackQuery(cb.id);
      const text = `👤 <b>Detail Pengguna Bot:</b>\n\n` +
        `Nama: <b>${targetUser.name}</b>\n` +
        `ID Telegram: <code>${targetUser.telegram_id}</code>\n` +
        `Username: @${targetUser.username || '-'}\n` +
        `Role Saat Ini: <b>${targetUser.role.toUpperCase()}</b>\n` +
        `Terdaftar: ${targetUser.created_at}\n\n` +
        `Pilih aksi di bawah untuk mengubah role atau menghapus akun:`;

      return this.sendMessage(chatId, text, {
        reply_markup: { inline_keyboard }
      });
    }

    if (data.startsWith('sa_set_role:')) {
      const parts = data.split(':');
      const targetTgId = parts[1];
      const newRole = parts[2];

      const db = this.getDB();
      const target = (db.telegram_users || []).find(u => String(u.telegram_id) === String(targetTgId));
      if (!target) return this.answerCallbackQuery(cb.id, 'User tidak ditemukan', true);

      target.role = newRole;
      this.saveDB(db);

      await this.answerCallbackQuery(cb.id, `Role berhasil diubah menjadi ${newRole.toUpperCase()}`);
      await this.sendMessage(chatId, `✅ Role untuk <b>${target.name}</b> berhasil diperbarui menjadi <b>${newRole.toUpperCase()}</b>.`);
      await this.sendMessage(targetTgId, `ℹ️ Role akun Anda telah diperbarui menjadi <b>${newRole.toUpperCase()}</b> oleh Superadmin.`);
      return;
    }

    if (data.startsWith('sa_del_user:')) {
      const targetTgId = data.split(':')[1];
      const db = this.getDB();
      const idx = (db.telegram_users || []).findIndex(u => String(u.telegram_id) === String(targetTgId));
      if (idx === -1) return this.answerCallbackQuery(cb.id, 'User tidak ditemukan', true);

      const deleted = db.telegram_users.splice(idx, 1)[0];
      this.saveDB(db);

      await this.answerCallbackQuery(cb.id, 'User berhasil dihapus');
      await this.sendMessage(chatId, `🗑️ User <b>${deleted.name}</b> (<code>${deleted.telegram_id}</code>) telah dihapus dari sistem bot.`);
      await this.sendMessage(targetTgId, `⚠️ Akses Anda ke bot sistem FTTH PT AKU telah dicabut oleh Superadmin.`);
      return;
    }

    if (data.startsWith('sa_role:')) {
      const chosenRole = data.split(':')[1];
      const session = this.userSessions.get(chatId);
      if (!session || !session.data.targetTgId) {
        return this.answerCallbackQuery(cb.id, 'Session telah kedaluwarsa.', true);
      }

      const db = this.getDB();
      if (!Array.isArray(db.telegram_users)) db.telegram_users = [];
      const existing = db.telegram_users.find(u => String(u.telegram_id) === String(session.data.targetTgId));
      if (existing) {
        existing.name = session.data.targetName;
        existing.role = chosenRole;
      } else {
        db.telegram_users.push({
          id: 'tg-user-' + Date.now(),
          telegram_id: String(session.data.targetTgId),
          username: '',
          name: session.data.targetName,
          role: chosenRole,
          created_at: new Date().toISOString().split('T')[0]
        });
      }
      this.saveDB(db);

      const targetId = session.data.targetTgId;
      const targetName = session.data.targetName;
      this.userSessions.delete(chatId);

      await this.answerCallbackQuery(cb.id, `User ${chosenRole.toUpperCase()} berhasil dibuat!`);
      await this.sendMessage(chatId,
        `✅ <b>User Berhasil Ditambahkan!</b>\n\n` +
        `Nama: <b>${targetName}</b>\n` +
        `ID Telegram: <code>${targetId}</code>\n` +
        `Role: <b>${chosenRole.toUpperCase()}</b>`
      );

      // Beritahu user yang didaftarkan
      await this.sendMessage(targetId,
        `🎉 <b>Selamat datang di Bot FTTH PT AKU!</b>\n` +
        `Anda telah didaftarkan oleh Superadmin dengan Role: <b>${chosenRole.toUpperCase()}</b>.\n` +
        `Ketik /menu untuk memulai.`
      );
      return;
    }

    if (data === 'sa_close') {
      await this.answerCallbackQuery(cb.id);
      return this.sendMainMenu(chatId, user);
    }
  }

  // -------------------------------------------------------------
  // 12. NOTIFICATION DISPATCHERS
  // -------------------------------------------------------------
  async notifySuperadminsNewApplicant(sender, tgId) {
    const db = this.getDB();
    const superadmins = (db.telegram_users || []).filter(u => u.role === 'superadmin');
    const name = [sender.first_name, sender.last_name].filter(Boolean).join(' ') || 'User Baru';
    const encName = encodeURIComponent(name);

    const inline_keyboard = [
      [
        { text: '🔧 Teknisi', callback_data: `bind_user:${tgId}:teknisi:${encName}` },
        { text: '💼 Admin', callback_data: `bind_user:${tgId}:admin:${encName}` }
      ],
      [
        { text: '📊 PM', callback_data: `bind_user:${tgId}:pm:${encName}` },
        { text: '👑 Superadmin', callback_data: `bind_user:${tgId}:superadmin:${encName}` }
      ]
    ];

    const text = `🔔 <b>Permohonan Akses User Baru</b>\n\n` +
      `Nama: <b>${name}</b>\n` +
      `Username: @${sender.username || '-'}\n` +
      `ID Telegram: <code>${tgId}</code>\n\n` +
      `Pilih role untuk langsung menyetujui:`;

    for (const sa of superadmins) {
      await this.sendMessage(sa.telegram_id, text, {
        reply_markup: { inline_keyboard }
      });
    }
  }

  async notifyPMNewBonRequest(request) {
    const db = this.getDB();
    const recipients = (db.telegram_users || []).filter(u => ['pm', 'superadmin'].includes(u.role));

    let itemsStr = request.items.map((it, idx) =>
      `${idx + 1}. <b>${it.name}${it.variant ? ' ' + it.variant : ''}</b>: ${it.qty_planned} ${it.unit}`
    ).join('\n');

    const inline_keyboard = [
      [
        { text: '✅ Setujui Bon', callback_data: `approve_bon:${request.id}` },
        { text: '❌ Tolak Bon', callback_data: `reject_bon:${request.id}` }
      ]
    ];

    const text = `📦 <b>REQUEST BON MATERIAL BARU (PENDING)</b>\n\n` +
      `WO: <b>${request.wo_number}</b>\n` +
      `Klaster: ${request.cluster_name || '-'}\n` +
      `Pemohon: <b>${request.requested_by_name}</b> (${request.requested_by_role.toUpperCase()})\n` +
      `Catatan: ${request.notes || '-'}\n\n` +
      `<b>Rincian Item yang Diminta:</b>\n${itemsStr}\n\n` +
      `Konfirmasi persetujuan di bawah ini:`;

    for (const r of recipients) {
      await this.sendMessage(r.telegram_id, text, {
        reply_markup: { inline_keyboard }
      });
    }
  }

  // -------------------------------------------------------------
  // 13. BUSINESS LOGIC: APPROVAL & MERGE 2 ARAH
  // -------------------------------------------------------------
  async approveBonRequest(reqId, approverName = 'Project Manager') {
    const db = this.getDB();
    const req = (db.bon_requests || []).find(r => r.id === reqId);
    if (!req) {
      return { success: false, message: 'Request tidak ditemukan.' };
    }
    if (req.status === 'Disetujui') {
      return { success: false, message: 'Request ini sudah disetujui sebelumnya.' };
    }

    req.status = 'Disetujui';
    req.approved_by_name = approverName;
    req.approved_at = new Date().toISOString().split('T')[0];
    req.updated_at = new Date().toISOString();

    // Merge item ke Bon Material utama WO tersebut
    if (!Array.isArray(db.bon_material)) db.bon_material = [];
    let bon = db.bon_material.find(b => b.project_id === req.project_id);

    if (!bon) {
      // Jika belum ada bon untuk WO ini, buatkan baru
      bon = {
        id: 'bon-' + req.project_id,
        project_id: req.project_id,
        wo_number: req.wo_number,
        status: 'Disetujui',
        notes: `Dibuat dari Request #${req.id}`,
        items: [],
        created_by: approverName,
        created_at: req.created_at,
        updated_at: req.approved_at
      };
      db.bon_material.push(bon);
    } else {
      bon.status = 'Disetujui';
      bon.updated_at = req.approved_at;
    }

    // Gabungkan item: jika material_id sama, tambahkan qty_planned
    for (const newItem of req.items) {
      const existing = bon.items.find(it => it.material_id === newItem.material_id);
      if (existing) {
        existing.qty_planned = (Number(existing.qty_planned) || 0) + Number(newItem.qty_planned);
      } else {
        bon.items.push({
          id: 'boni-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          material_id: newItem.material_id,
          name: newItem.name,
          category: newItem.category || 'Lainnya',
          variant: newItem.variant || '',
          unit: newItem.unit || 'pcs',
          qty_planned: Number(newItem.qty_planned) || 0,
          qty_arrived: 0,
          qty_used: 0,
          qty_remaining: 0
        });
      }
    }

    this.saveDB(db);

    // Broadcast Notifikasi ke Teknisi, Admin, dan PM
    await this.broadcastApprovalNotification(req, approverName);

    return { success: true, request: req, bon };
  }

  async rejectBonRequest(reqId, rejectorName = 'Project Manager', reason = 'Tidak disetujui') {
    const db = this.getDB();
    const req = (db.bon_requests || []).find(r => r.id === reqId);
    if (!req) return { success: false, message: 'Request tidak ditemukan.' };
    if (req.status !== 'Pending') {
      return { success: false, message: `Request sudah berstatus ${req.status}.` };
    }

    req.status = 'Ditolak';
    req.approved_by_name = rejectorName;
    req.rejection_reason = reason;
    req.updated_at = new Date().toISOString();
    this.saveDB(db);

    // Kirim notifikasi ke pemohon
    if (req.requested_by_tg_id) {
      await this.sendMessage(req.requested_by_tg_id,
        `❌ <b>Pengajuan Bon Material Ditolak</b>\n\n` +
        `WO: <b>${req.wo_number}</b>\n` +
        `Oleh: ${rejectorName}\n` +
        `Alasan: ${reason}`
      );
    }

    return { success: true, request: req };
  }

  async broadcastApprovalNotification(request, approverName) {
    const db = this.getDB();
    // Kirim ke: Teknisi pemohon, semua Admin, dan semua PM
    const targetRoles = ['admin', 'pm', 'superadmin'];
    const usersToNotify = (db.telegram_users || []).filter(u =>
      targetRoles.includes(u.role) || String(u.telegram_id) === String(request.requested_by_tg_id)
    );

    let itemsStr = request.items.map((it, idx) =>
      `${idx + 1}. <b>${it.name}${it.variant ? ' ' + it.variant : ''}</b>: ${it.qty_planned} ${it.unit}`
    ).join('\n');

    const text = `🎉 <b>BON MATERIAL DISETUJUI!</b>\n\n` +
      `WO: <b>${request.wo_number}</b>\n` +
      `Disetujui oleh: <b>${approverName}</b>\n` +
      `Pemohon: ${request.requested_by_name}\n\n` +
      `<b>Daftar Item Disetujui:</b>\n${itemsStr}\n\n` +
      `Status: Material siap dipersiapkan oleh tim logistik/gudang untuk distribusi ke lapangan.`;

    const sentMap = new Set();
    for (const u of usersToNotify) {
      if (!sentMap.has(u.telegram_id)) {
        sentMap.add(u.telegram_id);
        await this.sendMessage(u.telegram_id, text);
      }
    }
  }

  // -------------------------------------------------------------
  // 14. INFORMATIONAL VIEWS (STATUS & WAREHOUSE)
  // -------------------------------------------------------------
  async showBonStatusList(chatId, user) {
    const db = this.getDB();
    const requests = (db.bon_requests || []).slice(-10).reverse();

    if (requests.length === 0) {
      return this.sendMessage(chatId, `Belum ada riwayat pengajuan bon material.`);
    }

    let text = `📋 <b>Status 10 Pengajuan Bon Material Terakhir:</b>\n\n`;
    requests.forEach((r, idx) => {
      const icon = r.status === 'Disetujui' ? '✅' : (r.status === 'Ditolak' ? '❌' : '⏳');
      text += `${idx + 1}. ${icon} <b>${r.wo_number}</b> [${r.status.toUpperCase()}]\n` +
        `   Pemohon: ${r.requested_by_name} (${r.created_at})\n` +
        `   Item: ${r.items.length} macam • Approver: ${r.approved_by_name || '-'}\n\n`;
    });

    await this.sendMessage(chatId, text);
  }

  async showWarehouseStock(chatId, user) {
    const db = this.getDB();
    const mats = db.materials || [];

    if (mats.length === 0) {
      return this.sendMessage(chatId, `Data master material masih kosong.`);
    }

    let text = `🏭 <b>Ringkasan Stok Gudang PT AKU:</b>\n\n`;
    const sorted = [...mats].sort((a, b) => (Number(a.stock_qty) || 0) - (Number(b.stock_qty) || 0));

    sorted.slice(0, 15).forEach((m, idx) => {
      const stock = Number(m.stock_qty) || 0;
      const min = Number(m.min_stock) || 5;
      const badge = stock === 0 ? '🔴 Habis' : (stock < min ? '🟡 Rendah' : '🟢 Aman');
      text += `${idx + 1}. <b>${m.name}${m.variant ? ' ' + m.variant : ''}</b>: <b>${stock} ${m.unit}</b> (${badge})\n`;
    });

    if (mats.length > 15) {
      text += `\n...dan ${mats.length - 15} material lainnya. Cek detail di website dashboard.`;
    }

    await this.sendMessage(chatId, text);
  }
}

module.exports = TelegramBotService;
