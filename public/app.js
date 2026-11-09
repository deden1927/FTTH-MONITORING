// Global State
let currentTab = 'dashboard';
let currentFinanceSubTab = 'inflow';
let projectsData = [];
let executorsData = [];
let revenueChartInstance = null;
let clientChartInstance = null;
let currentUser = null;
let materialsData = [];
let bonData = [];
let currentBonId = null;
let bonItemsDraft = [];
let canManageBon = false;
let materialStockChartInstance = null;
let bonRequestsData = [];
let materialInboundsData = [];
let telegramUsersData = [];

// Global Fetch Interceptor for JWT Authentication
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  options = options || {};
  options.headers = options.headers || {};
  const token = localStorage.getItem('ftth_token');
  if (token && typeof url === 'string' && url.startsWith('/api/') && url !== '/api/login') {
    if (options.headers instanceof Headers) {
      if (!options.headers.has('Authorization')) {
        options.headers.set('Authorization', 'Bearer ' + token);
      }
    } else {
      if (!options.headers['Authorization']) {
        options.headers['Authorization'] = 'Bearer ' + token;
      }
    }
  }
  const response = await originalFetch(url, options);
  if (response.status === 401 && typeof url === 'string' && url.startsWith('/api/') && url !== '/api/login') {
    localStorage.removeItem('ftth_user');
    localStorage.removeItem('ftth_token');
    currentUser = null;
    window.location.reload();
  }
  return response;
};

// -------------------------------------------------------------
// THEME MANAGEMENT (DARK MODE)
// -------------------------------------------------------------
function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
  updateThemeToggleIcons();

  // Re-render active charts to update axis & grid contrast
  if (typeof loadDashboardStats === 'function') {
    const dashTab = document.getElementById('content-dashboard');
    if (dashTab && !dashTab.classList.contains('hidden')) {
      loadDashboardStats();
    }
  }
  if (typeof renderWarehouseStockChart === 'function') {
    const matTab = document.getElementById('content-bon-material');
    if (matTab && !matTab.classList.contains('hidden')) {
      renderWarehouseStockChart();
    }
  }
}

function toggleTheme() {
  applyTheme(!isDarkMode());
}

function updateThemeToggleIcons() {
  const currentlyDark = isDarkMode();
  const iconSun = document.getElementById('themeIconSun');
  const iconMoon = document.getElementById('themeIconMoon');
  if (iconSun && iconMoon) {
    if (currentlyDark) {
      iconSun.classList.remove('hidden');
      iconMoon.classList.add('hidden');
    } else {
      iconSun.classList.add('hidden');
      iconMoon.classList.remove('hidden');
    }
  }
  if (window.lucide) lucide.createIcons();
}

// Currency Formatter
function formatIDR(num) {
  if (isNaN(num) || num === null || num === undefined) return 'Rp 0';
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  updateThemeToggleIcons();
  if (window.lucide) lucide.createIcons();
  checkAuth();
});

// Auth Flow
function checkAuth() {
  const savedUser = localStorage.getItem('ftth_user');
  const savedToken = localStorage.getItem('ftth_token');
  if (savedUser && savedToken) {
    currentUser = JSON.parse(savedUser);
    showAppBasedOnRole();
  } else {
    document.getElementById('login-container').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const u = document.getElementById('loginUsername').value;
  const p = document.getElementById('loginPassword').value;
  const errDiv = document.getElementById('loginError');
  errDiv.classList.add('hidden');
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error(`Server merespons error (Status ${res.status}).`);
    }
    if (data.success) {
      localStorage.setItem('ftth_user', JSON.stringify(data.user));
      localStorage.setItem('ftth_token', data.token);
      currentUser = data.user;
      showAppBasedOnRole();
    } else {
      errDiv.textContent = data.message || 'Login gagal.';
      errDiv.classList.remove('hidden');
    }
  } catch(err) {
    errDiv.textContent = err.message || 'Gagal terhubung ke server.';
    errDiv.classList.remove('hidden');
  }
}

function handleLogout() {
  localStorage.removeItem('ftth_user');
  localStorage.removeItem('ftth_token');
  currentUser = null;
  window.location.reload();
}

function showAppBasedOnRole() {
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';
  
  document.getElementById('userNameDisplay').textContent = currentUser.name;
  document.getElementById('userRoleDisplay').textContent = currentUser.role;

  // Role Based UI Logic
  const role = currentUser.role; // 'direktur', 'pm', 'finance'
  
  const tabDash = document.getElementById('tab-dashboard');
  const tabProj = document.getElementById('tab-projects');
  const tabFin = document.getElementById('tab-finance');
  const tabExec = document.getElementById('tab-executors');
  const tabUsers = document.getElementById('tab-users');
  const tabGalleryMgmt = document.getElementById('tab-gallery-mgmt');
  const tabBon = document.getElementById('tab-bon-material');
  const btnTambahWO = document.getElementById('btnTambahWO');
  const btnAddExecutor = document.getElementById('btnAddExecutor');
  const btnTambahInvoice = document.getElementById('btnTambahInvoice');
  const btnInvoicePdfGenerator = document.getElementById('btnInvoicePdfGenerator');

  // Hak akses invoice: Hanya Super Admin & Finance
  const canManageInvoice = currentUser && ['superadmin', 'finance'].includes(currentUser.role);
  if (btnTambahInvoice) btnTambahInvoice.style.display = canManageInvoice ? 'flex' : 'none';
  if (btnInvoicePdfGenerator) btnInvoicePdfGenerator.style.display = canManageInvoice ? 'flex' : 'none';

  // Hak akses bon material: Super Admin, Direktur, PM
  canManageBon = currentUser && ['superadmin', 'direktur', 'pm'].includes(currentUser.role);
  const btnCreateBon = document.getElementById('btnCreateBon');
  const btnManageMaterials = document.getElementById('btnManageMaterials');
  const btnInboundMaterial = document.getElementById('btnInboundMaterial');
  const btnHistoryInbound = document.getElementById('btnHistoryInbound');
  if (btnCreateBon) btnCreateBon.style.display = 'none';
  if (btnManageMaterials) btnManageMaterials.style.display = canManageBon ? 'flex' : 'none';
  if (btnInboundMaterial) btnInboundMaterial.style.display = canManageBon ? 'flex' : 'none';
  if (btnHistoryInbound) btnHistoryInbound.style.display = 'flex';

  // Reset default
  tabDash.style.display = 'flex';
  tabProj.style.display = 'flex';
  tabFin.style.display = 'flex';
  tabExec.style.display = 'flex';
  if(tabUsers) tabUsers.style.display = 'none';
  if(tabGalleryMgmt) tabGalleryMgmt.style.display = 'none';
  if(tabBon) tabBon.style.display = 'flex';
  if(btnTambahWO) btnTambahWO.style.display = 'flex';
  if(btnAddExecutor) btnAddExecutor.style.display = 'flex'; // Default show for allowed roles

  if (role === 'pm') {
    tabDash.style.display = 'none';
    tabFin.style.display = 'flex';
    const btnSubInflow = document.getElementById('btn-sub-inflow');
    if (btnSubInflow) btnSubInflow.style.display = 'none';
    switchFinanceSubTab('outflow');
    switchTab('projects');
  } else if (role === 'finance') {
    tabProj.style.display = 'none';
    tabExec.style.display = 'none';
    if(tabBon) tabBon.style.display = 'none';
    const btnSubInflow = document.getElementById('btn-sub-inflow');
    if (btnSubInflow) btnSubInflow.style.display = 'flex';
    if(btnTambahWO) btnTambahWO.style.display = 'none';
    if(btnAddExecutor) btnAddExecutor.style.display = 'none';
    switchFinanceSubTab('inflow');
    switchTab('dashboard');
  } else if (role === 'superadmin') {
    if(tabUsers) tabUsers.style.display = 'flex';
    if(tabGalleryMgmt) tabGalleryMgmt.style.display = 'flex';
    const btnSubInflow = document.getElementById('btn-sub-inflow');
    if (btnSubInflow) btnSubInflow.style.display = 'flex';
    switchTab('users');
  } else {
    // Direktur
    const btnSubInflow = document.getElementById('btn-sub-inflow');
    if (btnSubInflow) btnSubInflow.style.display = 'flex';
    switchTab('dashboard');
  }

  updateNavGroupVisibility();
  loadAllData();
}

// -------------------------------------------------------------
// SIDEBAR & NAVIGATION HELPERS
// -------------------------------------------------------------
function updateNavGroupVisibility() {
  const groups = ['overview', 'operasional', 'finansial', 'pengaturan'];
  groups.forEach(g => {
    const el = document.getElementById(`nav-group-${g}`);
    if (!el) return;
    const tabs = Array.from(el.querySelectorAll('.nav-tab'));
    const anyVisible = tabs.some(t => t.style.display !== 'none');
    el.style.display = anyVisible ? 'block' : 'none';
  });
}

function toggleSidebar(open) {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  const shouldOpen = open !== undefined ? open : sidebar.classList.contains('-translate-x-full');
  if (shouldOpen) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
    document.body.classList.add('overflow-hidden', 'lg:overflow-auto');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
    document.body.classList.remove('overflow-hidden', 'lg:overflow-auto');
  }
}

function handleNavClick(tabName) {
  switchTab(tabName);
  if (window.innerWidth < 1024) {
    toggleSidebar(false);
  }
}

// Close mobile sidebar on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
      toggleSidebar(false);
    }
  }
});

// Load All Data
async function loadAllData() {
  const promises = [
    loadExecutors(),
    loadDashboardStats(),
    loadProjects(),
    loadInvoices(),
    loadMandorPayouts(),
    loadMaterials()
  ];
  if (currentUser && currentUser.role === 'superadmin') {
    promises.push(loadUsers());
    promises.push(loadGalleryMgmt());
  }
  await Promise.all(promises);
  if (window.lucide) lucide.createIcons();
}

// -------------------------------------------------------------
// TAB SWITCHING
// -------------------------------------------------------------
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.remove('text-sky-400', 'bg-slate-800', 'border', 'border-slate-700/80', 'font-semibold');
    btn.classList.add('text-slate-400', 'hover:text-white', 'hover:bg-slate-800/60');
  });

  const activeContent = document.getElementById(`content-${tabName}`);
  const activeBtn = document.getElementById(`tab-${tabName}`);
  if (activeContent) activeContent.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-400', 'hover:text-white', 'hover:bg-slate-800/60');
    activeBtn.classList.add('text-sky-400', 'bg-slate-800', 'border', 'border-slate-700/80', 'font-semibold');
  }

  // Update Topbar Title & Subtitle Contextually
  const titles = {
    'dashboard': { title: 'Executive Dashboard', subtitle: 'Ringkasan performa pendapatan dan progres operasional FTTH' },
    'projects': { title: 'Manajemen WO & Lapangan', subtitle: 'Monitoring berkala progres fisik, penugasan mandor, dan kendala lapangan' },
    'bon-material': { title: 'Bon Material per Work Order', subtitle: 'Pengelolaan dan pemantauan material terencana, terpakai, dan sisa per WO' },
    'finance': { title: 'Cashflow 2 Arah (Klien & Mandor)', subtitle: 'Kelola tagihan invoice ke klien dan termin pembayaran eksekutor lapangan' },
    'executors': { title: 'Master Eksekutor', subtitle: 'Daftar mandor dan mitra rekanan, armada, beban kerja, dan performa' },
    'users': { title: 'Manajemen User (Admin)', subtitle: 'Pengelolaan akun pengguna, hak akses role sistem, dan kredensial' },
    'gallery-mgmt': { title: 'Kelola Galeri Index', subtitle: 'Manajemen dokumentasi foto aktivitas lapangan untuk halaman utama' }
  };
  const t = titles[tabName] || { title: 'Dashboard Monitoring', subtitle: 'PT Akses Kwalitas Unggul' };
  const pageTitleEl = document.getElementById('topbarPageTitle');
  const pageSubEl = document.getElementById('topbarPageSubtitle');
  if (pageTitleEl) pageTitleEl.textContent = t.title;
  if (pageSubEl) pageSubEl.textContent = t.subtitle;

  if (tabName === 'dashboard') {
    loadDashboardStats();
    renderMaterialStock();
  } else if (tabName === 'projects') {
    loadProjects();
  } else if (tabName === 'bon-material') {
    loadBonMaterialTab();
  } else if (tabName === 'finance') {
    loadInvoices();
    loadMandorPayouts();
  } else if (tabName === 'executors') {
    renderExecutors();
  } else if (tabName === 'gallery-mgmt') {
    loadGalleryMgmt();
  } else if (tabName === 'users') {
    loadUsers();
  }

  if (window.lucide) lucide.createIcons();
}

function switchFinanceSubTab(sub) {
  currentFinanceSubTab = sub;
  const btnInflow = document.getElementById('btn-sub-inflow');
  const btnOutflow = document.getElementById('btn-sub-outflow');
  const contentInflow = document.getElementById('sub-content-inflow');
  const contentOutflow = document.getElementById('sub-content-outflow');

  if (sub === 'inflow') {
    contentInflow.classList.remove('hidden');
    contentOutflow.classList.add('hidden');
    btnInflow.className = 'pb-3 text-sm font-bold border-b-2 border-sky-600 text-sky-600 flex items-center gap-2';
    btnOutflow.className = 'pb-3 text-sm font-medium text-slate-500 hover:text-slate-800 flex items-center gap-2';
  } else {
    contentInflow.classList.add('hidden');
    contentOutflow.classList.remove('hidden');
    btnOutflow.className = 'pb-3 text-sm font-bold border-b-2 border-sky-600 text-sky-600 flex items-center gap-2';
    btnInflow.className = 'pb-3 text-sm font-medium text-slate-500 hover:text-slate-800 flex items-center gap-2';
  }
  if (window.lucide) lucide.createIcons();
}

// -------------------------------------------------------------
// 1. DASHBOARD STATS & CHARTS
// -------------------------------------------------------------
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const stats = await res.json();

    document.getElementById('kpi-orderbook').innerText = formatIDR(stats.totalOrderBook);
    document.getElementById('kpi-kasmasuk').innerText = formatIDR(stats.totalKasDiterima);
    document.getElementById('kpi-piutang').innerText = formatIDR(stats.totalSisaPiutang);
    document.getElementById('kpi-margin').innerText = formatIDR(stats.totalGrossMargin);
    document.getElementById('kpi-margin-pct').innerText = `Margin: ${stats.grossMarginPercent}% dari Omset`;
    document.getElementById('kpi-project-count').innerText = `${stats.activeProjectsCount} Proyek Berjalan`;

    revenueTrendsData = stats.revenueTrends || {
      '3m': (stats.monthlyRevenue || []).slice(-3),
      '6m': stats.monthlyRevenue || [],
      '1y': stats.monthlyRevenue || []
    };
    renderRevenueForCurrentPeriod();
    updateRevenuePeriodButtons();

    renderClientChart(stats.clientPortfolio);
    renderAgingTable();
    renderExecutorSummary(stats.executorBreakdown);
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

let currentRevenuePeriod = '6m';
let revenueTrendsData = null;

function getRevenueDataForPeriod(period) {
  if (revenueTrendsData && Array.isArray(revenueTrendsData[period])) {
    return revenueTrendsData[period];
  }
  return [];
}

function renderRevenueForCurrentPeriod() {
  const data = getRevenueDataForPeriod(currentRevenuePeriod);
  if (data && data.length > 0) {
    renderRevenueChart(data);
  }
}

function setRevenuePeriod(period) {
  if (!['3m', '6m', '1y'].includes(period)) return;
  currentRevenuePeriod = period;
  updateRevenuePeriodButtons();
  renderRevenueForCurrentPeriod();
}

function updateRevenuePeriodButtons() {
  ['3m', '6m', '1y'].forEach(p => {
    const btn = document.getElementById(`btn-rev-${p}`);
    if (!btn) return;
    if (p === currentRevenuePeriod) {
      btn.className = 'px-2.5 py-1 text-xs font-semibold rounded-md transition cursor-pointer bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-2xs';
    } else {
      btn.className = 'px-2.5 py-1 text-xs font-semibold rounded-md transition cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100';
    }
  });
}

function renderRevenueChart(monthlyData) {
  const ctx = document.getElementById('revenueChart');
  if (!ctx || !Array.isArray(monthlyData)) return;

  const labels = monthlyData.map(d => d.month);
  const billedData = monthlyData.map(d => d.billed / 1000000); // in Millions
  const receivedData = monthlyData.map(d => d.received / 1000000);

  if (revenueChartInstance) {
    revenueChartInstance.destroy();
  }

  const isDark = isDarkMode();
  const textColor = isDark ? '#cbd5e1' : '#64748b';
  const gridColor = isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.8)';

  revenueChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Omset Tagihan (Juta Rp)',
          data: billedData,
          backgroundColor: '#38bdf8', // Sky 400
          borderRadius: 6
        },
        {
          label: 'Kas Riil Masuk (Juta Rp)',
          data: receivedData,
          backgroundColor: '#10b981', // Emerald 500
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, color: textColor } },
        tooltip: {
          backgroundColor: isDark ? '#0f172a' : '#ffffff',
          titleColor: isDark ? '#f8fafc' : '#0f172a',
          bodyColor: isDark ? '#cbd5e1' : '#334155',
          borderColor: isDark ? '#334155' : '#e2e8f0',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: Rp ${Number(ctx.parsed.y).toLocaleString('id-ID', { maximumFractionDigits: 2 })} Juta`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor },
          grid: { color: gridColor }
        },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, callback: (v) => 'Rp ' + v + ' Jt' },
          grid: { color: gridColor }
        }
      }
    }
  });
}

function renderClientChart(clientPortfolio) {
  const ctx = document.getElementById('clientChart');
  if (!ctx) return;

  const labels = Object.keys(clientPortfolio);
  const values = Object.values(clientPortfolio);
  const total = values.reduce((a, b) => a + b, 0);

  if (clientChartInstance) {
    clientChartInstance.destroy();
  }

  const colors = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6'];
  const isDark = isDarkMode();

  clientChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: isDark ? '#0f172a' : '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false }
      }
    }
  });

  // Populate custom legend
  const legendEl = document.getElementById('client-breakdown-legend');
  if (legendEl) {
    legendEl.innerHTML = labels.map((lbl, idx) => {
      const val = values[idx];
      const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
      return `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${colors[idx]}"></span>
            <span class="font-medium text-slate-700 dark:text-slate-200">${lbl}</span>
          </div>
          <span class="text-slate-500 dark:text-slate-400 font-semibold">${formatIDR(val)} (${pct}%)</span>
        </div>
      `;
    }).join('');
  }
}

function getInvoiceSpAndWoInfo(inv) {
  const allProjects = Array.isArray(projectsData) ? projectsData : [];

  const matchedProj = allProjects.find(p => {
    if (inv.project_id && p.id === inv.project_id) return true;
    const invWo = String(inv.wo_number || '').trim().toLowerCase();
    const pSp = String(p.sp_number || '').trim().toLowerCase();
    const pWo = String(p.wo_number || '').trim().toLowerCase();
    const pJob = String(p.job_name || p.cluster_name || '').trim().toLowerCase();
    return (invWo && (pSp === invWo || pWo === invWo || pJob === invWo));
  });

  const clientName = inv.client_name || (matchedProj ? matchedProj.client_name : 'Klien');
  const spName = inv.sp_number || (matchedProj ? matchedProj.sp_number : null) || inv.wo_number || '-';
  const woName = inv.job_name || (matchedProj ? (matchedProj.job_name || matchedProj.cluster_name) : null) || inv.term_name || inv.wo_number || '-';

  return { clientName, spName, woName };
}

function getSpAgeInfo(inv) {
  const invDateStr = inv.invoice_date || '';
  if (!invDateStr) {
    return { days: 0, text: '- Hari', badgeClass: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700' };
  }

  const parts = invDateStr.split('T')[0].split('-');
  const dInv = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const isPaid = inv.status === 'Sudah Cashbank' || inv.status === 'Lunas';

  let dEnd;
  if (isPaid && inv.paid_date) {
    const pParts = inv.paid_date.split('T')[0].split('-');
    dEnd = new Date(Number(pParts[0]), Number(pParts[1]) - 1, Number(pParts[2]));
  } else {
    const now = new Date();
    dEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const diffTime = dEnd.getTime() - dInv.getTime();
  const days = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  let badgeClass = 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800';
  if (days > 60) {
    badgeClass = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 font-bold border border-red-200 dark:border-red-800';
  } else if (days >= 31) {
    badgeClass = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800';
  }

  return {
    days,
    text: `${days} Hari`,
    badgeClass
  };
}

async function renderAgingTable() {
  const container = document.getElementById('aging-table-container');
  if (!container) return;

  try {
    const [invRes, projRes] = await Promise.all([
      fetch('/api/invoices'),
      (!projectsData || projectsData.length === 0) ? fetch('/api/projects') : Promise.resolve(null)
    ]);
    const invoices = await invRes.json();
    if (projRes) {
      try {
        projectsData = await projRes.json();
      } catch (e) {}
    }

    const activeInvoices = (Array.isArray(invoices) ? invoices : []).filter(i => i.status !== 'Draft');

    if (activeInvoices.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-500 italic py-4 text-center">Belum ada tagihan invoice.</p>`;
      return;
    }

    // Prioritaskan yang Belum Cashbank di bagian atas (umur terlama dulu)
    activeInvoices.sort((a, b) => {
      const aPaid = (a.status === 'Sudah Cashbank' || a.status === 'Lunas') ? 1 : 0;
      const bPaid = (b.status === 'Sudah Cashbank' || b.status === 'Lunas') ? 1 : 0;
      if (aPaid !== bPaid) return aPaid - bPaid;
      return new Date(b.invoice_date || 0) - new Date(a.invoice_date || 0);
    });

    container.innerHTML = `
      <table class="w-full text-left text-xs">
        <thead class="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
          <tr>
            <th class="py-2.5 px-3">Klien / SP</th>
            <th class="py-2.5 px-3 text-right">Nominal</th>
            <th class="py-2.5 px-3">Status</th>
            <th class="py-2.5 px-3">Umur SP</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          ${activeInvoices.map(inv => {
            const info = getInvoiceSpAndWoInfo(inv);
            const ageInfo = getSpAgeInfo(inv);

            const isLunas = inv.status === 'Sudah Cashbank' || inv.status === 'Lunas';
            const displayStatus = (inv.status === 'Invoice Terkirim' || !inv.status || inv.status === 'Belum Cashbank')
              ? 'Belum Cashbank'
              : (isLunas ? 'Sudah Cashbank' : inv.status);

            let statusBadge = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700';
            if (displayStatus === 'BAST Terbit') statusBadge = 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800';
            if (displayStatus === 'Belum Cashbank') statusBadge = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800';
            if (isLunas) statusBadge = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800';

            return `
              <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                <td class="py-2.5 px-3">
                  <div class="font-bold text-slate-900 dark:text-slate-100">${info.clientName}</div>
                  <div class="text-[11px] font-mono font-bold text-sky-700 dark:text-sky-400">SP/PO: ${info.spName}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">WO: ${info.woName}</div>
                </td>
                <td class="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100">${formatIDR(inv.amount)}</td>
                <td class="py-2.5 px-3">
                  <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${statusBadge}">${displayStatus}</span>
                </td>
                <td class="py-2.5 px-3">
                  <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${ageInfo.badgeClass}">${ageInfo.text}</span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error rendering aging table:', err);
  }
}

function renderExecutorSummary(exData) {
  const container = document.getElementById('executor-summary-content');
  if (!container || !exData) return;

  const totalVal = (Number(exData.internalValue) || 0) + (Number(exData.mandorValue) || 0) + (Number(exData.mixedValue) || 0);
  const intPct = totalVal > 0 ? Math.round(((Number(exData.internalValue) || 0) / totalVal) * 100) : 0;
  const manPct = totalVal > 0 ? Math.round(((Number(exData.mandorValue) || 0) / totalVal) * 100) : 0;
  const mixPct = totalVal > 0 ? Math.max(0, 100 - intPct - manPct) : 0;

  const mixedCard = (exData.mixedCount > 0 || exData.mixedValue > 0) ? `
    <!-- Tim Campuran (Mixing) Card -->
    <div class="p-3 bg-purple-50/60 rounded-xl border border-purple-100">
      <div class="flex justify-between items-center mb-1">
        <span class="font-bold text-xs text-purple-900 flex items-center gap-1.5">
          <i data-lucide="layers" class="w-4 h-4 text-purple-600"></i> Campuran / Mixing (${exData.mixedCount || 0} Proyek)
        </span>
        <span class="font-bold text-xs text-purple-700">${formatIDR(exData.mixedValue || 0)} (${mixPct}%)</span>
      </div>
      <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
        <div class="bg-purple-600 h-2 rounded-full" style="width: ${mixPct}%"></div>
      </div>
      <p class="text-[11px] text-purple-700 mt-1">Kolaborasi Fleksibel • Mandor pengerjaan sipil & Internal terminasi/ATP.</p>
    </div>
  ` : '';

  container.innerHTML = `
    <!-- Tim Internal Card -->
    <div class="p-3 bg-sky-50/60 rounded-xl border border-sky-100">
      <div class="flex justify-between items-center mb-1">
        <span class="font-bold text-xs text-sky-900 flex items-center gap-1.5">
          <i data-lucide="shield" class="w-4 h-4 text-sky-600"></i> Tim Internal Vendor (${exData.internalCount} Proyek)
        </span>
        <span class="font-bold text-xs text-sky-700">${formatIDR(exData.internalValue)} (${intPct}%)</span>
      </div>
      <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
        <div class="bg-sky-600 h-2 rounded-full" style="width: ${intPct}%"></div>
      </div>
      <p class="text-[11px] text-sky-700 mt-1">Margin Maksimal • Utilisasi teknisi tetap & armada operasional.</p>
    </div>

    <!-- Mandor Borongan Card -->
    <div class="p-3 bg-amber-50/60 rounded-xl border border-amber-100">
      <div class="flex justify-between items-center mb-1">
        <span class="font-bold text-xs text-amber-900 flex items-center gap-1.5">
          <i data-lucide="hard-hat" class="w-4 h-4 text-amber-600"></i> Mandor / Subkon Borongan (${exData.mandorCount} Proyek)
        </span>
        <span class="font-bold text-xs text-amber-700">${formatIDR(exData.mandorValue)} (${manPct}%)</span>
      </div>
      <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
        <div class="bg-amber-500 h-2 rounded-full" style="width: ${manPct}%"></div>
      </div>
      <p class="text-[11px] text-amber-700 mt-1">Skalabilitas Tinggi • Upah dikunci per meter/tiang/ODP tervalidasi.</p>
    </div>

    ${mixedCard}
  `;
  if (window.lucide) lucide.createIcons();
}

// -------------------------------------------------------------
// 2. PROJECTS & 4 MILESTONES (PM WORKSPACE)
// -------------------------------------------------------------
async function loadProjects() {
  const clientFilter = document.getElementById('filter-client')?.value || 'All';
  const execFilter = document.getElementById('filter-executor')?.value || 'All';
  const statusFilter = document.getElementById('filter-status')?.value || 'All';

  try {
    const url = `/api/projects?client=${encodeURIComponent(clientFilter)}&executor_type=${encodeURIComponent(execFilter)}&status=${encodeURIComponent(statusFilter)}`;
    const res = await fetch(url);
    projectsData = await res.json();
    renderProjectsList();
  } catch (err) {
    console.error('Error loading projects:', err);
  }
}

let openSpKeys = new Set();
let spAccordionInitialized = false;

function getGroupedProjects() {
  const spGroups = [];
  const spMap = new Map();

  (projectsData || []).forEach(proj => {
    const spKey = proj.sp_number || proj.wo_number || 'SP-UNKNOWN';
    if (!spMap.has(spKey)) {
      const g = {
        sp_number: spKey,
        client_name: proj.client_name,
        created_at: proj.created_at,
        jobs: []
      };
      spMap.set(spKey, g);
      spGroups.push(g);
    }
    spMap.get(spKey).jobs.push(proj);
  });
  return spGroups;
}

function populateSpFilter(spGroups) {
  const spSelect = document.getElementById('filter-sp');
  if (!spSelect) return;
  const currentVal = spSelect.value || 'All';

  let html = '<option value="All">Semua SP/PO Induk (Semua Proyek)</option>';
  spGroups.forEach(g => {
    html += `<option value="${escapeQuote(g.sp_number)}">SP: ${escapeQuote(g.sp_number)} (${g.jobs.length} WO - ${escapeQuote(g.client_name)})</option>`;
  });
  spSelect.innerHTML = html;
  if ([...spSelect.options].some(opt => opt.value === currentVal)) {
    spSelect.value = currentVal;
  }
}

function toggleSpAccordion(spKeySafe) {
  const content = document.getElementById(`sp-content-${spKeySafe}`);
  const chevron = document.getElementById(`sp-chevron-${spKeySafe}`);
  const label = document.getElementById(`sp-toggle-label-${spKeySafe}`);
  if (!content) return;

  const isHidden = content.classList.contains('hidden');
  if (isHidden) {
    content.classList.remove('hidden');
    openSpKeys.add(spKeySafe);
    if (chevron) chevron.classList.add('rotate-180');
    if (label) label.innerText = '(Klik untuk Ciutkan)';
  } else {
    content.classList.add('hidden');
    openSpKeys.delete(spKeySafe);
    if (chevron) chevron.classList.remove('rotate-180');
    if (label) label.innerText = '(Klik untuk Buka Daftar WO)';
  }
}

function expandAllSp(expand) {
  const spGroups = getGroupedProjects();
  spGroups.forEach(g => {
    const spKeySafe = g.sp_number.replace(/[^a-zA-Z0-9_-]/g, '_');
    const content = document.getElementById(`sp-content-${spKeySafe}`);
    const chevron = document.getElementById(`sp-chevron-${spKeySafe}`);
    const label = document.getElementById(`sp-toggle-label-${spKeySafe}`);
    if (expand) {
      openSpKeys.add(spKeySafe);
      if (content) content.classList.remove('hidden');
      if (chevron) chevron.classList.add('rotate-180');
      if (label) label.innerText = '(Klik untuk Ciutkan)';
    } else {
      openSpKeys.delete(spKeySafe);
      if (content) content.classList.add('hidden');
      if (chevron) chevron.classList.remove('rotate-180');
      if (label) label.innerText = '(Klik untuk Buka Daftar WO)';
    }
  });
}

function filterWoUnderSp(spKeySafe) {
  const select = document.getElementById(`select-wo-${spKeySafe}`);
  if (!select) return;
  const targetId = select.value;
  const container = document.getElementById(`sp-jobs-container-${spKeySafe}`);
  if (!container) return;

  const cards = container.querySelectorAll('.wo-job-item');
  cards.forEach(card => {
    if (targetId === 'all') {
      card.classList.remove('hidden');
    } else {
      if (card.dataset.projectId === targetId) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    }
  });
}

function renderProjectsList() {
  const container = document.getElementById('projects-container');
  if (!container) return;

  if (projectsData.length === 0) {
    container.innerHTML = `
      <div class="bg-white dark:bg-slate-900 p-12 text-center rounded-2xl border border-slate-200 dark:border-slate-800">
        <i data-lucide="folder-search" class="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3"></i>
        <h4 class="font-bold text-slate-700 dark:text-slate-200">Tidak ada proyek yang sesuai filter</h4>
        <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">Coba ubah filter atau tambah Work Order baru.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const allSpGroups = getGroupedProjects();
  populateSpFilter(allSpGroups);

  // Jika belum inisialisasi accordion, default buka semua jika <= 3 SP, atau buka 2 pertama
  if (!spAccordionInitialized) {
    allSpGroups.forEach((g, idx) => {
      const spKeySafe = g.sp_number.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (idx < 3) {
        openSpKeys.add(spKeySafe);
      }
    });
    spAccordionInitialized = true;
  }

  // Filter SP jika dipilih via dropdown Filter Bar
  const selectedSp = document.getElementById('filter-sp')?.value || 'All';
  let displayGroups = allSpGroups;
  if (selectedSp !== 'All') {
    displayGroups = allSpGroups.filter(g => g.sp_number === selectedSp);
    // Otomatis buka jika difilter
    displayGroups.forEach(g => {
      const spKeySafe = g.sp_number.replace(/[^a-zA-Z0-9_-]/g, '_');
      openSpKeys.add(spKeySafe);
    });
  }

  container.innerHTML = displayGroups.map(group => {
    const spKeySafe = group.sp_number.replace(/[^a-zA-Z0-9_-]/g, '_');
    const isOpen = openSpKeys.has(spKeySafe);

    // Client Color Badge
    let clientColor = 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800';
    if (group.client_name.includes('Icon')) clientColor = 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800';
    if (group.client_name.includes('ID Net')) clientColor = 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800';

    const totalBOQ = group.jobs.reduce((a, b) => a + (Number(b.contract_value) || 0), 0);
    const totalHPP = group.jobs.reduce((a, b) => a + (Number(b.mandor_cost) || 0), 0);
    const totalMargin = totalBOQ - totalHPP;
    const marginPct = totalBOQ > 0 ? Number(((totalMargin / totalBOQ) * 100).toFixed(1)) : 0;
    const avgProgress = Math.round(group.jobs.reduce((a, b) => a + (Number(b.progress_percent) || 0), 0) / group.jobs.length);
    const doneJobsCount = group.jobs.filter(j => (Number(j.progress_percent) || 0) >= 100).length;

    // Dropdown list WO di dalam SP jika pekerjaan > 1
    const woDropdownControl = group.jobs.length > 1 ? `
      <div class="bg-slate-50 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <i data-lucide="layers" class="w-4 h-4 text-sky-600 dark:text-sky-400"></i>
          <span class="text-xs font-bold text-slate-700 dark:text-slate-300">Daftar Pekerjaan WO dalam SP:</span>
        </div>
        <div class="flex items-center gap-2">
          <select id="select-wo-${spKeySafe}" onchange="filterWoUnderSp('${spKeySafe}')"
            class="text-xs font-semibold border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 cursor-pointer shadow-2xs">
            <option value="all">Semua Pekerjaan (${group.jobs.length} WO - Tampilkan Semua)</option>
            ${group.jobs.map((j, i) => `
              <option value="${j.id}">WO #${i + 1}: ${escapeQuote(j.job_name || j.cluster_name)} [${j.progress_percent || 0}%] - ${formatIDR(j.contract_value)}</option>
            `).join('')}
          </select>
        </div>
      </div>
    ` : '';

    return `
      <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs overflow-hidden transition space-y-0">
        <!-- SP/PO Induk Header (Dropdown / Accordion Trigger) -->
        <div onclick="toggleSpAccordion('${spKeySafe}')"
             class="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/80 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 cursor-pointer transition select-none">
          <div class="flex items-start gap-3">
            <div id="sp-chevron-${spKeySafe}" class="mt-0.5 p-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}">
              <i data-lucide="chevron-down" class="w-4 h-4"></i>
            </div>
            <div class="space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2.5 py-0.5 text-xs font-bold rounded-full border ${clientColor}">${group.client_name}</span>
                <span class="font-mono font-bold text-slate-900 dark:text-slate-100 text-base">SP/PO: ${group.sp_number}</span>
                <span class="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                  ${group.jobs.length} Pekerjaan (${doneJobsCount} Selesai)
                </span>
                <span id="sp-toggle-label-${spKeySafe}" class="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  ${isOpen ? '(Klik untuk Ciutkan)' : '(Klik untuk Buka Daftar WO)'}
                </span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Akumulasi progres fisik SP: <b class="text-slate-800 dark:text-slate-200">${avgProgress}%</b> • Terbit: <span class="text-slate-700 dark:text-slate-300 font-medium">${group.created_at || '-'}</span>
              </p>
            </div>
          </div>

          <!-- Total Finansial SP & Aksi Tambah Pekerjaan -->
          <div class="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-between lg:justify-end" onclick="event.stopPropagation()">
            <div class="text-right bg-white dark:bg-slate-800 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span class="text-[10px] text-slate-400 dark:text-slate-400 font-semibold block uppercase">Total Nilai BOQ SP</span>
              <span class="text-sm font-bold text-slate-900 dark:text-slate-100">${formatIDR(totalBOQ)}</span>
              <div class="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
                Laba Bersih: ${formatIDR(totalMargin)} (${marginPct}%)
              </div>
            </div>

            <button type="button" onclick="openAddJobForSp('${escapeQuote(group.sp_number)}', '${escapeQuote(group.client_name)}')" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3.5 py-2.5 rounded-lg flex items-center gap-1.5 shadow-xs transition cursor-pointer">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> + Tambah Pekerjaan
            </button>
          </div>
        </div>

        <!-- Dropdown Body: Daftar Pekerjaan / Work Orders di bawah SP ini -->
        <div id="sp-content-${spKeySafe}" class="${isOpen ? '' : 'hidden'} p-5 space-y-5 transition">
          ${woDropdownControl}
          <div id="sp-jobs-container-${spKeySafe}" class="space-y-5 divide-y divide-slate-100 dark:divide-slate-800">
            ${group.jobs.map((proj, idx) => {
              let execBadge = '';
              if (proj.executor_type === 'Campuran') {
                execBadge = `<span class="inline-flex items-center gap-1 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded text-[11px] font-semibold"><i data-lucide="layers" class="w-3 h-3"></i> Campuran: ${proj.executor_name}</span>`;
              } else if (proj.executor_type === 'Internal') {
                execBadge = `<span class="inline-flex items-center gap-1 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 px-2 py-0.5 rounded text-[11px] font-semibold"><i data-lucide="shield" class="w-3 h-3"></i> Internal: ${proj.executor_name}</span>`;
              } else {
                execBadge = `<span class="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded text-[11px] font-semibold"><i data-lucide="hard-hat" class="w-3 h-3"></i> Mandor: ${proj.executor_name}</span>`;
              }

              return `
                <div id="project-card-${proj.id}" data-project-id="${proj.id}" class="wo-job-item ${idx > 0 ? 'pt-5' : ''} space-y-3.5">
                  <!-- Header Pekerjaan -->
                  <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-white dark:bg-slate-800/90 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-700/80 shadow-2xs">
                    <div>
                      <div class="flex flex-wrap items-center gap-2 mb-1">
                        <span class="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-1.5">
                          <i data-lucide="map-pin" class="w-4 h-4 text-sky-600 dark:text-sky-400"></i>
                          <span>${proj.job_name || proj.cluster_name}</span>
                        </span>
                        ${execBadge}
                      </div>
                      <p class="text-xs text-slate-500 dark:text-slate-400">
                        Nilai BOQ: <b class="text-slate-800 dark:text-slate-200">${formatIDR(proj.contract_value)}</b> • HPP Mandor: <b class="text-slate-800 dark:text-slate-200">${formatIDR(proj.mandor_cost)}</b> • Target Selesai: <span class="font-semibold text-slate-700 dark:text-slate-300">${proj.target_date || '-'}</span>
                      </p>
                    </div>

                    <div class="flex items-center gap-3">
                      <div class="flex items-center gap-2 w-36">
                        <div class="w-full bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                          <div class="bg-emerald-500 h-2 rounded-full transition-all" style="width: ${proj.progress_percent || 0}%"></div>
                        </div>
                        <span class="text-xs font-bold text-slate-800 dark:text-slate-200 w-8 text-right">${proj.progress_percent || 0}%</span>
                      </div>

                      <button type="button" onclick="deleteProject('${proj.id}', '${escapeQuote(proj.job_name || proj.cluster_name)}')" title="Hapus Pekerjaan Ini" class="bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 text-xs font-semibold p-2 rounded-lg border border-red-200 dark:border-red-900 transition flex items-center cursor-pointer">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                      </button>
                    </div>
                  </div>

                  <!-- 4 Milestone Cards Grid -->
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    ${proj.milestones.map(m => renderMilestoneCard(m, proj)).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openAddJobForSp(spNumber, clientName) {
  openModal('modalAddProject');
  const spSelect = document.getElementById('modal-sp-select');
  const clientSelect = document.getElementById('modal-client');
  const containerCustom = document.getElementById('container-custom-sp');
  const inputWo = document.getElementById('modal-wo');

  if (spSelect) {
    spSelect.value = spNumber;
    handleSpSelectChange(spNumber);
  }
  if (clientSelect && clientName) {
    clientSelect.value = clientName;
  }
  if (containerCustom) containerCustom.classList.add('hidden');
  if (inputWo) {
    inputWo.value = spNumber;
    inputWo.required = false;
  }
  const clusterInput = document.getElementById('modal-cluster');
  if (clusterInput) {
    clusterInput.value = '';
    clusterInput.focus();
  }
}

async function deleteProject(projId, woNumber) {
  if (!confirm(`Apakah Anda yakin ingin menghapus Work Order ${woNumber}?\n\nPerhatian: Seluruh milestone pengerjaan, invoice termin, dan klaim mandor terkait proyek ini akan ikut dihapus secara permanen.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/projects/${projId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      await loadProjects();
      await loadDashboardStats();
      await loadInvoices();
      await loadMandorPayouts();
    } else {
      alert('Gagal menghapus Work Order.');
    }
  } catch (err) {
    console.error('Error deleting project:', err);
    alert('Terjadi kesalahan saat menghapus Work Order.');
  }
}

function renderMilestoneCard(m, proj) {
  let statusBadgeClass = 'status-badge-todo';
  let statusIcon = 'clock';
  if (m.status === 'In-Progress') { statusBadgeClass = 'status-badge-inprogress'; statusIcon = 'play-circle'; }
  if (m.status === 'Blocked') { statusBadgeClass = 'status-badge-blocked'; statusIcon = 'alert-octagon'; }
  if (m.status === 'Done') { statusBadgeClass = 'status-badge-done'; statusIcon = 'check-circle'; }

  // Special data for stage 4 (ATP)
  let extraContent = '';
  if (m.stage_name === 'Testing & ATP' && (m.otdr_loss || m.opm_power)) {
    extraContent = `
      <div class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 bg-slate-50 dark:bg-slate-900/60 p-1.5 rounded">
        <div><b>OTDR:</b> ${m.otdr_loss || '-'}</div>
        <div><b>OPM:</b> ${m.opm_power || '-'}</div>
      </div>
    `;
  }

  // Blocked reason alert
  let blockedAlert = '';
  if (m.status === 'Blocked' && m.blocked_reason) {
    blockedAlert = `
      <div class="mt-2 p-1.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[10px] rounded border border-red-200 dark:border-red-900 font-medium">
        ⚠️ <b>Kendala:</b> ${m.blocked_reason}
      </div>
    `;
  }

  const mExecName = m.executor_name || (m.executor_type === 'Internal' ? 'Tim Internal' : 'Mandor Lapangan');
  const mExecBadge = m.executor_type === 'Internal'
    ? `<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/70 border border-sky-200 dark:border-sky-800 px-1.5 py-0.5 rounded"><i data-lucide="shield" class="w-2.5 h-2.5"></i> ${mExecName}</span>`
    : `<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded"><i data-lucide="hard-hat" class="w-2.5 h-2.5"></i> ${mExecName}${m.stage_cost ? ' • ' + formatIDR(m.stage_cost) : ''}</span>`;

  const canManage = !currentUser || ['superadmin', 'direktur', 'pm'].includes(currentUser.role);
  const isDone = m.status === 'Done';

  return `
    <div class="bg-white dark:bg-slate-850 dark:bg-slate-800/90 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between hover:border-sky-300 dark:hover:border-sky-500 transition">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-100">${m.stage_name}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${statusBadgeClass}">
            <i data-lucide="${statusIcon}" class="w-3 h-3"></i> ${m.status}
          </span>
        </div>
        <div class="mb-2">
          ${mExecBadge}
        </div>

        <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">${m.notes || 'Belum ada catatan.'}</p>
        ${blockedAlert}
        ${extraContent}
      </div>

      <div class="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/80 flex items-center justify-between gap-1.5">
        <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">${m.progress_percent}%</span>
        <div class="flex items-center gap-1.5">
          ${canManage ? (
            !isDone ? `
              <button type="button" onclick="autoDoneMilestone('${m.id}', '${escapeQuote(m.stage_name)}')" class="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded-md flex items-center gap-1 transition cursor-pointer shadow-2xs" title="Langsung Tandai 100% Selesai (Auto Done)">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"></i> Auto Done
              </button>
            ` : `
              <button type="button" onclick="autoDoneMilestone('${m.id}', '${escapeQuote(m.stage_name)}')" class="text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 px-2 py-1 rounded-md flex items-center gap-1 transition cursor-pointer" title="Sudah Selesai 100% (Klik untuk refresh status)">
                <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"></i> Done ✓
              </button>
            `
          ) : ''}
          <button type="button" onclick="openUpdateMilestoneModal('${m.id}')" class="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 px-2 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1 transition cursor-pointer">
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Update
          </button>
        </div>
      </div>
    </div>
  `;
}

function escapeQuote(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// -------------------------------------------------------------
// 4. FINANCE (CASHFLOW 2 ARAH)
// -------------------------------------------------------------
let invoicesData = [];
let mandorPayoutsData = [];

async function loadInvoices() {
  const tbody = document.getElementById('invoices-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/invoices');
    const list = await res.json();
    invoicesData = Array.isArray(list) ? list : [];

    tbody.innerHTML = invoicesData.map(inv => {
      const isLunas = inv.status === 'Sudah Cashbank' || inv.status === 'Lunas';
      let statusBadge = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700';
      if (inv.status === 'BAST Terbit') statusBadge = 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800';
      if (inv.status === 'Belum Cashbank' || inv.status === 'Invoice Terkirim') statusBadge = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800';
      if (isLunas) statusBadge = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800';

      const canManage = currentUser && ['superadmin', 'finance', 'direktur'].includes(currentUser.role);
      const displayStatus = (inv.status === 'Invoice Terkirim' || !inv.status || inv.status === 'Belum Cashbank')
        ? 'Belum Cashbank'
        : (isLunas ? 'Sudah Cashbank' : inv.status);

      const info = getInvoiceSpAndWoInfo(inv);
      const ageInfo = getSpAgeInfo(inv);

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
          <td class="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">${inv.id}</td>
          <td class="p-3 font-semibold text-slate-800 dark:text-slate-200">${info.clientName}</td>
          <td class="p-3 text-sky-700 dark:text-sky-400 font-mono font-bold">${info.spName}</td>
          <td class="p-3 text-slate-700 dark:text-slate-300 font-medium">${info.woName}</td>
          <td class="p-3 text-right font-bold text-slate-900 dark:text-slate-100">${formatIDR(inv.amount)}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-semibold ${statusBadge}">${displayStatus}</span></td>
          <td class="p-3 text-slate-600 dark:text-slate-400">${inv.invoice_date}</td>
          <td class="p-3 text-slate-600 dark:text-slate-400">${inv.due_date}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-semibold ${ageInfo.badgeClass}">${ageInfo.text}</span></td>
          <td class="p-3 text-center">
            <div class="flex items-center justify-center gap-1.5">
              ${!isLunas && canManage ? `
                <button type="button" onclick="markInvoicePaid('${inv.id}')" title="Tandai Lunas (Sudah Cashbank)" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-[11px] font-semibold shadow-2xs transition cursor-pointer">
                  Lunas
                </button>
              ` : ''}
              ${isLunas ? `<span class="text-emerald-700 dark:text-emerald-400 font-bold text-[11px] bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">Sudah Cashbank</span>` : ''}
              ${canManage ? `
                <button type="button" onclick="openEditInvoiceModal('${inv.id}')" title="Edit Tagihan" class="p-1.5 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 transition cursor-pointer">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                </button>
                <button type="button" onclick="deleteInvoice('${inv.id}', '${escapeQuote(inv.wo_number)}', ${inv.amount})" title="Hapus Tagihan" class="p-1.5 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg border border-slate-200 dark:border-slate-700 transition cursor-pointer">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading invoices:', err);
  }
}

function openEditInvoiceModal(invId) {
  const inv = (invoicesData || []).find(i => i.id === invId);
  if (!inv) return;

  document.getElementById('edit-inv-id').value = inv.id;
  const displayIdEl = document.getElementById('edit-display-inv-id');
  if (displayIdEl) displayIdEl.value = inv.id;
  document.getElementById('edit-inv-wo').value = inv.wo_number || '';
  document.getElementById('edit-inv-client').value = inv.client_name || '';
  document.getElementById('edit-inv-term').value = inv.term_name || '';
  document.getElementById('edit-inv-amount').value = inv.amount || 0;
  document.getElementById('edit-inv-status').value = inv.status || 'Draft';
  document.getElementById('edit-inv-date').value = inv.invoice_date || '';
  document.getElementById('edit-inv-due').value = inv.due_date || '';
  document.getElementById('edit-inv-paid-date').value = inv.paid_date || '';

  toggleEditInvoicePaidDate();
  openModal('modalEditInvoice');
}

function updateEditInvoiceDueDate() {
  const invDate = document.getElementById('edit-inv-date').value;
  if (!invDate) return;
  const d = new Date(invDate);
  d.setMonth(d.getMonth() + 2);
  document.getElementById('edit-inv-due').value = d.toISOString().split('T')[0];
}

function toggleEditInvoicePaidDate() {
  const status = document.getElementById('edit-inv-status').value;
  const container = document.getElementById('container-edit-inv-paid');
  const paidInput = document.getElementById('edit-inv-paid-date');
  if (status === 'Sudah Cashbank' || status === 'Lunas') {
    container.classList.remove('hidden');
    if (!paidInput.value) paidInput.value = new Date().toISOString().split('T')[0];
  } else {
    container.classList.add('hidden');
  }
}

async function submitEditInvoice(e) {
  e.preventDefault();
  const id = document.getElementById('edit-inv-id').value;
  const wo_number = document.getElementById('edit-inv-wo').value.trim();
  const client_name = document.getElementById('edit-inv-client').value.trim();
  const term_name = document.getElementById('edit-inv-term').value.trim();
  const amount = Number(document.getElementById('edit-inv-amount').value) || 0;
  const status = document.getElementById('edit-inv-status').value;
  const invoice_date = document.getElementById('edit-inv-date').value;
  const due_date = document.getElementById('edit-inv-due').value;
  const isPaid = status === 'Sudah Cashbank' || status === 'Lunas';
  const paid_date = isPaid ? (document.getElementById('edit-inv-paid-date').value || new Date().toISOString().split('T')[0]) : '';

  try {
    const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wo_number,
        client_name,
        term_name,
        amount,
        status,
        invoice_date,
        due_date,
        paid_date
      })
    });
    if (res.ok) {
      closeModal('modalEditInvoice');
      loadInvoices();
      loadDashboardStats();
    } else {
      const err = await res.json();
      alert(err.message || 'Gagal menyimpan perubahan invoice.');
    }
  } catch (err) {
    console.error('Error updating invoice:', err);
    alert('Terjadi kesalahan saat memperbarui invoice.');
  }
}

async function deleteInvoice(invId, woNumber, amount) {
  if (!confirm(`Apakah Anda yakin ingin menghapus tagihan ${woNumber} senilai ${formatIDR(amount)}?\n\nData yang dihapus tidak dapat dipulihkan.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/invoices/${encodeURIComponent(invId)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      loadInvoices();
      loadDashboardStats();
    } else {
      const err = await res.json();
      alert(err.message || 'Gagal menghapus invoice.');
    }
  } catch (err) {
    console.error('Error deleting invoice:', err);
    alert('Terjadi kesalahan saat menghapus invoice.');
  }
}

async function markInvoicePaid(invId) {
  if (!confirm('Konfirmasi bahwa pembayaran invoice ini sudah masuk ke rekening perusahaan (Sudah Cashbank)?')) return;
  try {
    const res = await fetch(`/api/invoices/${encodeURIComponent(invId)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Sudah Cashbank' })
    });
    if (res.ok) {
      loadInvoices();
      loadDashboardStats();
    }
  } catch (err) {
    console.error('Error marking invoice paid:', err);
  }
}

async function loadMandorPayouts() {
  const tbody = document.getElementById('mandor-payouts-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/mandor-payouts');
    const payouts = await res.json();
    mandorPayoutsData = Array.isArray(payouts) ? payouts : [];

    tbody.innerHTML = mandorPayoutsData.map(p => {
      const isPaid = p.status === 'Lunas';
      const isApproved = p.verified_by_pm;
      const canManage = currentUser && ['superadmin', 'finance', 'pm', 'direktur'].includes(currentUser.role);

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
          <td class="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">${p.id}</td>
          <td class="p-3 font-bold text-slate-900 dark:text-slate-100">${p.mandor_name}</td>
          <td class="p-3 font-mono text-slate-600 dark:text-slate-400">${p.project_id}</td>
          <td class="p-3 text-slate-700 dark:text-slate-300">${p.milestone_stage}</td>
          <td class="p-3 text-right font-bold text-amber-900 dark:text-amber-300">${formatIDR(p.amount)}</td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isApproved ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}">
              ${isApproved ? '✔ Terverifikasi PM' : '✖ Belum Lolos PM'}
            </span>
          </td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPaid ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}">
              ${p.status}
            </span>
          </td>
          <td class="p-3 text-[11px] text-slate-500 dark:text-slate-400">${p.notes || '-'}</td>
          <td class="p-3 text-center">
            <div class="flex items-center justify-center gap-1.5">
              ${!isApproved && !isPaid && ['pm', 'superadmin', 'direktur'].includes(currentUser?.role) ? `
                <button type="button" onclick="verifyMandorPayout('${p.id}', true)" class="bg-sky-600 hover:bg-sky-500 text-white px-2 py-1 rounded text-[10px] font-semibold cursor-pointer">
                  Setujui PM
                </button>
              ` : ''}
              ${isApproved && !isPaid && ['finance', 'superadmin', 'direktur'].includes(currentUser?.role) ? `
                <button type="button" onclick="payMandorPayout('${p.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded text-[10px] font-bold shadow-2xs cursor-pointer">
                  Cairkan Kas
                </button>
              ` : ''}
              ${isPaid ? `<span class="text-slate-400 dark:text-slate-500 font-semibold text-[10px]">Tuntas</span>` : ''}
              ${canManage ? `
                <button type="button" onclick="openEditMandorPayoutModal('${p.id}')" title="Edit Kas Keluar" class="p-1.5 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 transition cursor-pointer">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                </button>
                <button type="button" onclick="deleteMandorPayout('${p.id}', '${escapeQuote(p.mandor_name)}', ${p.amount})" title="Hapus Kas Keluar" class="p-1.5 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg border border-slate-200 dark:border-slate-700 transition cursor-pointer">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading payouts:', err);
  }
}

function populateMandorPayoutProjectOptions() {
  const select = document.getElementById('add-pay-project');
  if (!select) return;

  let html = '<option value="Operasional Umum">-- Umum / Operasional Lapangan (Non-WO) --</option>';
  (projectsData || []).forEach(p => {
    const sp = p.sp_number || p.wo_number;
    const job = p.job_name || p.cluster_name;
    html += `<option value="${escapeQuote(sp)} - ${escapeQuote(job)}">${sp} - ${job} (${p.client_name})</option>`;
  });
  select.innerHTML = html;
}

function openEditMandorPayoutModal(payoutId) {
  const p = (mandorPayoutsData || []).find(item => item.id === payoutId);
  if (!p) return;

  document.getElementById('edit-pay-id').value = p.id;
  document.getElementById('edit-pay-mandor').value = p.mandor_name || '';
  document.getElementById('edit-pay-stage').value = p.milestone_stage || '';
  document.getElementById('edit-pay-amount').value = p.amount || 0;
  document.getElementById('edit-pay-status').value = p.status || 'Pending Verifikasi';
  document.getElementById('edit-pay-notes').value = p.notes || '';

  openModal('modalEditMandorPayout');
}

async function submitNewMandorPayout(e) {
  e.preventDefault();
  const project_id = document.getElementById('add-pay-project')?.value || 'manual';
  const mandor_name = document.getElementById('add-pay-mandor').value.trim();
  const milestone_stage = document.getElementById('add-pay-stage').value;
  const amount = Number(document.getElementById('add-pay-amount').value) || 0;
  const notes = document.getElementById('add-pay-notes').value.trim();

  try {
    const res = await fetch('/api/mandor-payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id,
        mandor_name,
        milestone_stage,
        amount,
        notes
      })
    });
    if (res.ok) {
      closeModal('modalAddMandorPayout');
      document.getElementById('formAddMandorPayout').reset();
      loadMandorPayouts();
      loadDashboardStats();
    } else {
      const err = await res.json();
      alert(err.message || 'Gagal mencatat kas keluar.');
    }
  } catch (err) {
    console.error('Error creating payout:', err);
    alert('Terjadi kesalahan saat mencatat kas keluar.');
  }
}

async function submitEditMandorPayout(e) {
  e.preventDefault();
  const id = document.getElementById('edit-pay-id').value;
  const mandor_name = document.getElementById('edit-pay-mandor').value.trim();
  const milestone_stage = document.getElementById('edit-pay-stage').value.trim();
  const amount = Number(document.getElementById('edit-pay-amount').value) || 0;
  const status = document.getElementById('edit-pay-status').value;
  const notes = document.getElementById('edit-pay-notes').value.trim();

  try {
    const res = await fetch(`/api/mandor-payouts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mandor_name,
        milestone_stage,
        amount,
        status,
        notes
      })
    });
    if (res.ok) {
      closeModal('modalEditMandorPayout');
      loadMandorPayouts();
      loadDashboardStats();
    } else {
      const err = await res.json();
      alert(err.message || 'Gagal menyimpan perubahan kas keluar.');
    }
  } catch (err) {
    console.error('Error updating payout:', err);
    alert('Terjadi kesalahan saat memperbarui kas keluar.');
  }
}

async function deleteMandorPayout(payoutId, mandorName, amount) {
  if (!confirm(`Apakah Anda yakin ingin menghapus catatan kas keluar untuk ${mandorName} senilai ${formatIDR(amount)}?\n\nData yang dihapus tidak dapat dipulihkan.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/mandor-payouts/${payoutId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      loadMandorPayouts();
      loadDashboardStats();
    } else {
      const err = await res.json();
      alert(err.message || 'Gagal menghapus kas keluar.');
    }
  } catch (err) {
    console.error('Error deleting payout:', err);
    alert('Terjadi kesalahan saat menghapus kas keluar.');
  }
}

async function verifyMandorPayout(id, approve) {
  try {
    const res = await fetch(`/api/mandor-payouts/${id}/verify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve })
    });
    if (res.ok) {
      loadMandorPayouts();
    }
  } catch (err) {
    console.error('Error verifying payout:', err);
  }
}

async function payMandorPayout(id) {
  if (!confirm('Cairkan pembayaran upah ini ke mandor?')) return;
  try {
    const res = await fetch(`/api/mandor-payouts/${id}/pay`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (res.ok) {
      alert('Kas berhasil dicairkan!');
      loadMandorPayouts();
      loadDashboardStats();
    } else {
      alert('Gagal mencairkan kas: ' + (data.error || data.message || 'Terjadi kesalahan'));
    }
  } catch (err) {
    console.error('Error paying mandor:', err);
    alert('Terjadi kesalahan koneksi.');
  }
}

// -------------------------------------------------------------
// 5. MASTER EXECUTORS
// -------------------------------------------------------------
let executorActiveFilter = 'All'; // 'All' | 'Internal' | 'Mandor'
let executorSearchQuery = '';

async function loadExecutors() {
  try {
    const res = await fetch('/api/executors');
    executorsData = await res.json();
    populateExecutorModalOptions();
  } catch (err) {
    console.error('Error loading executors:', err);
  }
}

function setExecutorFilter(type) {
  executorActiveFilter = type;
  ['all', 'internal', 'mandor'].forEach(t => {
    const btn = document.getElementById(`btn-filter-exec-${t}`);
    if (!btn) return;
    const isSelected = (t === 'all' && type === 'All') || (t.toLowerCase() === type.toLowerCase());
    if (isSelected) {
      btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer bg-slate-900 text-white shadow-xs';
    } else {
      btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer text-slate-600 hover:bg-slate-100';
    }
  });
  renderExecutors();
}

function handleExecutorSearch(query) {
  executorSearchQuery = (query || '').toLowerCase().trim();
  renderExecutors();
}

function renderExecutors() {
  const container = document.getElementById('executors-grid');
  if (!container) return;

  const canManage = currentUser && ['superadmin', 'direktur', 'pm'].includes(currentUser.role);
  const canDelete = currentUser && ['superadmin', 'direktur'].includes(currentUser.role);

  // Helper untuk mendapatkan list WO aktif per eksekutor dari projectsData
  const getActiveWOsForExecutor = (e) => {
    return (projectsData || []).filter(p => {
      const matchId = p.executor_id && p.executor_id === e.id;
      const matchName = p.executor_name && p.executor_name.trim().toLowerCase() === e.name.trim().toLowerCase();
      const hasActiveMilestone = (p.milestones || []).some(m => {
        const mIdMatch = m.executor_id && m.executor_id === e.id;
        const mNameMatch = m.executor_name && m.executor_name.trim().toLowerCase() === e.name.trim().toLowerCase();
        return (mIdMatch || mNameMatch) && m.status !== 'Done';
      });
      const isActive = p.status !== 'Selesai' && p.status !== 'Done';
      return (matchId || matchName || hasActiveMilestone) && isActive;
    });
  };

  // Update Summary KPI Cards
  const totalCount = executorsData.length;
  const internalCount = executorsData.filter(e => e.type === 'Internal').length;
  const mandorCount = executorsData.filter(e => e.type === 'Mandor').length;
  const totalActiveWOs = (projectsData || []).filter(p => p.status !== 'Selesai' && p.status !== 'Done').length;

  const elTotal = document.getElementById('kpi-exec-total');
  const elInternal = document.getElementById('kpi-exec-internal');
  const elMandor = document.getElementById('kpi-exec-mandor');
  const elActive = document.getElementById('kpi-exec-active-wos');
  const elCountAll = document.getElementById('count-exec-all');
  const elCountInt = document.getElementById('count-exec-internal');
  const elCountMan = document.getElementById('count-exec-mandor');

  if (elTotal) elTotal.textContent = totalCount;
  if (elInternal) elInternal.textContent = internalCount;
  if (elMandor) elMandor.textContent = mandorCount;
  if (elActive) elActive.textContent = totalActiveWOs;
  if (elCountAll) elCountAll.textContent = totalCount;
  if (elCountInt) elCountInt.textContent = internalCount;
  if (elCountMan) elCountMan.textContent = mandorCount;

  // Filter Data
  let list = [...executorsData];
  if (executorActiveFilter !== 'All') {
    list = list.filter(e => e.type === executorActiveFilter);
  }
  if (executorSearchQuery) {
    list = list.filter(e => {
      const combined = `${e.name || ''} ${e.pic || ''} ${e.phone || ''} ${e.wilayah || ''} ${e.specialization || ''} ${e.fleet_no || ''}`.toLowerCase();
      return combined.includes(executorSearchQuery);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="col-span-full bg-white p-12 text-center rounded-2xl border border-slate-200">
        <i data-lucide="users" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
        <h4 class="font-bold text-slate-700 text-sm">Tidak ada data eksekutor yang sesuai</h4>
        <p class="text-xs text-slate-400 mt-1">Coba sesuaikan filter kategori atau kata kunci pencarian Anda.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = list.map(e => {
    const isInt = e.type === 'Internal';
    const activeWOs = getActiveWOsForExecutor(e);
    const cleanPhone = (e.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '62');

    // Status Badge
    let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Aktif</span>';
    if (e.status === 'Standby') {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Standby</span>';
    } else if (e.status === 'Non-Aktif') {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">Non-Aktif</span>';
    }

    // Tipe Badge
    const typeBadge = isInt
      ? '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200"><i data-lucide="shield" class="w-3 h-3"></i> Tim Internal</span>'
      : '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200"><i data-lucide="hard-hat" class="w-3 h-3"></i> Mandor / Subkon</span>';

    // Rincian WO Aktif
    let woSectionHtml = '';
    if (activeWOs.length > 0) {
      woSectionHtml = `
        <div class="pt-3 border-t border-slate-200/80 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <i data-lucide="folder-git-2" class="w-3.5 h-3.5 text-sky-600"></i>
              <span>WO Aktif (${activeWOs.length} Proyek Berjalan)</span>
            </span>
            <span class="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
              Sedang Dikerjakan
            </span>
          </div>

          <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
            ${activeWOs.map(wo => {
              let clientBadge = 'bg-sky-100 text-sky-800 border-sky-300';
              if (wo.client_name.includes('Icon')) clientBadge = 'bg-emerald-100 text-emerald-800 border-emerald-300';
              if (wo.client_name.includes('ID Net')) clientBadge = 'bg-purple-100 text-purple-800 border-purple-300';

              const prog = Number(wo.progress_percent) || 0;
              const assignedStages = (wo.milestones || [])
                .filter(m => (m.executor_id === e.id || (m.executor_name && m.executor_name.trim().toLowerCase() === e.name.trim().toLowerCase())))
                .map(m => m.stage_name);
              const stageBadge = (assignedStages.length > 0 && (wo.executor_type === 'Campuran' || assignedStages.length < 4))
                ? `<div class="text-[10px] text-purple-700 dark:text-purple-300 font-semibold bg-purple-50 dark:bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">Bertugas: ${assignedStages.join(', ')}</div>`
                : '';

              return `
                <div class="p-2.5 bg-white rounded-xl border border-slate-200/90 shadow-2xs hover:border-sky-400 transition flex flex-col gap-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-mono font-bold text-xs text-slate-900">${wo.wo_number}</span>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${clientBadge}">${wo.client_name}</span>
                  </div>
                  <div class="text-[11px] text-slate-600 flex items-center justify-between gap-2">
                    <span class="truncate flex items-center gap-1" title="${wo.cluster_name}">
                      <i data-lucide="map-pin" class="w-3 h-3 text-slate-400 shrink-0"></i>
                      <span class="truncate font-medium">${wo.cluster_name || '-'}</span>
                    </span>
                    <span class="text-slate-400 text-[10px] shrink-0 font-medium">Target: ${wo.target_date || '-'}</span>
                  </div>
                  ${stageBadge}
                  <div class="flex items-center gap-2 pt-0.5">
                    <div class="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div class="bg-emerald-500 h-1.5 rounded-full" style="width: ${prog}%"></div>
                    </div>
                    <span class="text-[10px] font-bold text-slate-700 w-8 text-right">${prog}%</span>
                  </div>
                  <button type="button" onclick="jumpToProject('${wo.id}')" class="mt-1 w-full py-1 px-2.5 bg-slate-50 hover:bg-sky-50 text-slate-700 hover:text-sky-700 border border-slate-200 hover:border-sky-300 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer">
                    <i data-lucide="external-link" class="w-3 h-3 text-sky-600"></i>
                    <span>Buka di Manajemen WO</span>
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else {
      woSectionHtml = `
        <div class="pt-3 border-t border-slate-200/80">
          <div class="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-emerald-800 text-xs font-semibold">
              <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 shrink-0"></i>
              <span>0 WO Aktif (Standby / Siap Ditugaskan)</span>
            </div>
            ${canManage ? `
              <button type="button" onclick="quickAssignWO('${e.id}', '${e.type}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 shadow-2xs transition cursor-pointer shrink-0">
                <i data-lucide="plus" class="w-3 h-3"></i> Tugaskan WO
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="p-5 rounded-2xl border ${isInt ? 'border-sky-200 bg-sky-50/20' : 'border-amber-200 bg-amber-50/20'} flex flex-col justify-between shadow-2xs hover:shadow-xs transition">
        <div>
          <!-- Header Card -->
          <div class="flex justify-between items-start gap-2 mb-2.5">
            <div class="flex items-center gap-2 flex-wrap">
              ${typeBadge}
              ${statusBadge}
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-xs font-bold text-amber-600 flex items-center gap-0.5">
                ★ ${Number(e.rating || 5.0).toFixed(1)}
              </span>
              <div class="flex items-center gap-1">
                ${canManage ? `
                  <button type="button" onclick="editExecutor('${e.id}')" class="p-1 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-md transition cursor-pointer" title="Edit Data Eksekutor">
                    <i data-lucide="edit" class="w-3.5 h-3.5"></i>
                  </button>
                ` : ''}
                ${canDelete ? `
                  <button type="button" onclick="deleteExecutor('${e.id}', '${(e.name || '').replace(/'/g, "\\'")}')" class="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition cursor-pointer" title="Hapus Eksekutor">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                ` : ''}
              </div>
            </div>
          </div>

          <!-- Nama & Kontak -->
          <h3 class="font-bold text-slate-900 text-base leading-snug">${e.name}</h3>
          ${e.pic ? `<p class="text-xs text-slate-600 font-medium mt-0.5"><span class="text-slate-400">Koordinator/PIC:</span> ${e.pic}</p>` : ''}
          
          <div class="mt-1.5 flex items-center gap-3 flex-wrap text-xs">
            ${cleanPhone ? `
              <a href="https://wa.me/${cleanPhone}" target="_blank" rel="noopener" class="text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1 font-semibold" title="Hubungi via WhatsApp">
                <i data-lucide="message-circle" class="w-3.5 h-3.5 text-emerald-600"></i> ${e.phone}
              </a>
            ` : `<span class="text-slate-500 flex items-center gap-1"><i data-lucide="phone" class="w-3.5 h-3.5"></i> ${e.phone || '-'}</span>`}
          </div>

          <!-- Wilayah, Armada & Spesialisasi -->
          <div class="grid grid-cols-2 gap-2 my-2.5 text-xs text-slate-600 bg-white/70 p-2.5 rounded-xl border border-slate-200/70">
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Wilayah / Basecamp:</span>
              <span class="font-medium text-slate-800 truncate block">${e.wilayah || 'Surabaya & Sekitarnya'}</span>
            </div>
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Armada / Plat:</span>
              <span class="font-medium text-slate-800 truncate block">${e.fleet_no || '-'}</span>
            </div>
          </div>

          ${e.specialization ? `
            <div class="mb-2.5">
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 shadow-2xs">
                <i data-lucide="wrench" class="w-3 h-3 text-slate-500"></i> ${e.specialization}
              </span>
            </div>
          ` : ''}

          <!-- Tarif / Uang Jalan Box -->
          <div class="p-2.5 bg-white rounded-xl border border-slate-200/80 text-xs space-y-1 mb-3 shadow-2xs">
            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Standar Biaya / Upah:</span>
            <p class="text-slate-700 font-medium leading-relaxed">${e.standard_rates || 'Sesuai kesepakatan SPK'}</p>
          </div>
        </div>

        <!-- Section WO Aktif Terintegrasi -->
        ${woSectionHtml}
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function jumpToProject(projectId) {
  // 1. Switch to projects tab
  handleNavClick('projects');

  // 2. Reset filters so the target project is always visible
  const filterClient = document.getElementById('filter-client');
  const filterExec = document.getElementById('filter-executor');
  const filterStatus = document.getElementById('filter-status');
  if (filterClient) filterClient.value = 'All';
  if (filterExec) filterExec.value = 'All';
  if (filterStatus) filterStatus.value = 'All';

  // 3. Re-render/reload projects if needed
  await loadProjects();

  // 4. Smooth scroll to project card & pulse highlight
  setTimeout(() => {
    const el = document.getElementById(`project-card-${projectId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-4', 'ring-sky-400', 'ring-offset-2', 'bg-sky-50/60');
      setTimeout(() => {
        el.classList.remove('ring-4', 'ring-sky-400', 'ring-offset-2', 'bg-sky-50/60');
      }, 3000);
    }
  }, 200);
}

function quickAssignWO(executorId, executorType) {
  openModal('modalAddProject');
  const type = executorType === 'Internal' ? 'Internal' : 'Mandor';
  const radio = document.querySelector(`input[name="modal_executor_type"][value="${type}"]`);
  if (radio) {
    radio.checked = true;
    populateExecutorModalOptions();
  }
  const select = document.getElementById('modal-executor-id');
  if (select && executorId) {
    select.value = executorId;
  }
}

function openModalAddExecutor() {
  resetExecutorForm();
  openModal('modalEditExecutor');
}

function resetExecutorForm() {
  const form = document.getElementById('formEditExecutor');
  if (form) form.reset();
  document.getElementById('modal-exec-id').value = '';
  document.getElementById('executorModalTitle').textContent = 'Tambah Eksekutor Baru';
  const mandorRadio = document.querySelector('input[name="modal_form_exec_type"][value="Mandor"]');
  if (mandorRadio) mandorRadio.checked = true;
  document.getElementById('modal-exec-status').value = 'Aktif';
  document.getElementById('modal-exec-rating').value = 5.0;
  onModalExecTypeChange();
}

function onModalExecTypeChange() {
  const isInternal = document.querySelector('input[name="modal_form_exec_type"]:checked')?.value === 'Internal';
  const ratesEl = document.getElementById('modal-exec-rates');
  const fleetEl = document.getElementById('modal-exec-fleet');
  if (ratesEl && !ratesEl.value) {
    ratesEl.placeholder = isInternal
      ? 'Contoh: Uang Jalan: Rp 450.000/hari + Bahan Bakar Operasional'
      : 'Contoh: Tiang: Rp 65.000/btg | Tarik KU: Rp 1.800/m | ODP: Rp 150.000/titik';
  }
  if (fleetEl && !fleetEl.value) {
    fleetEl.placeholder = isInternal ? 'Contoh: L-9142-TA / GranMax' : 'Contoh: Armada Mandor / -';
  }
}

function editExecutor(id) {
  const exec = executorsData.find(e => e.id === id);
  if (!exec) return;

  document.getElementById('modal-exec-id').value = exec.id;
  document.getElementById('modal-exec-name').value = exec.name || '';
  
  const type = exec.type === 'Internal' ? 'Internal' : 'Mandor';
  const radio = document.querySelector(`input[name="modal_form_exec_type"][value="${type}"]`);
  if (radio) radio.checked = true;

  document.getElementById('modal-exec-pic').value = exec.pic || '';
  document.getElementById('modal-exec-phone').value = exec.phone || '';
  document.getElementById('modal-exec-fleet').value = exec.fleet_no || '';
  document.getElementById('modal-exec-wilayah').value = exec.wilayah || '';
  document.getElementById('modal-exec-specialization').value = exec.specialization || '';
  document.getElementById('modal-exec-rates').value = exec.standard_rates || '';
  document.getElementById('modal-exec-status').value = exec.status || 'Aktif';
  document.getElementById('modal-exec-rating').value = exec.rating !== undefined ? exec.rating : 5.0;

  document.getElementById('executorModalTitle').textContent = 'Edit Data Eksekutor';
  openModal('modalEditExecutor');
}

async function submitExecutor(e) {
  e.preventDefault();

  const id = document.getElementById('modal-exec-id').value;
  const type = document.querySelector('input[name="modal_form_exec_type"]:checked')?.value || 'Mandor';
  const payload = {
    name: document.getElementById('modal-exec-name').value.trim(),
    type,
    pic: document.getElementById('modal-exec-pic').value.trim(),
    phone: document.getElementById('modal-exec-phone').value.trim(),
    fleet_no: document.getElementById('modal-exec-fleet').value.trim(),
    wilayah: document.getElementById('modal-exec-wilayah').value.trim(),
    specialization: document.getElementById('modal-exec-specialization').value.trim(),
    standard_rates: document.getElementById('modal-exec-rates').value.trim(),
    status: document.getElementById('modal-exec-status').value,
    rating: parseFloat(document.getElementById('modal-exec-rating').value) || 5.0
  };

  if (!payload.name) {
    alert('Nama Tim / Mandor wajib diisi.');
    return;
  }
  if (!payload.phone) {
    alert('Nomor Telepon / WhatsApp wajib diisi.');
    return;
  }

  try {
    let res;
    if (id) {
      res = await fetch('/api/executors/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/executors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok) {
      closeModal('modalEditExecutor');
      resetExecutorForm();
      await Promise.all([loadExecutors(), loadProjects()]);
      renderExecutors();
    } else {
      alert(data.message || 'Gagal menyimpan data eksekutor');
    }
  } catch(err) {
    console.error('Error saving executor:', err);
    alert('Terjadi kesalahan koneksi saat menyimpan eksekutor.');
  }
}

async function deleteExecutor(id, name) {
  if (!confirm(`Hapus eksekutor "${name}" dari sistem?`)) return;

  try {
    const res = await fetch('/api/executors/' + id, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (res.ok) {
      await Promise.all([loadExecutors(), loadProjects()]);
      renderExecutors();
    } else {
      alert(data.message || 'Gagal menghapus eksekutor.');
    }
  } catch(err) {
    console.error('Error deleting executor:', err);
    alert('Terjadi kesalahan koneksi saat menghapus eksekutor.');
  }
}

function populateExecutorModalOptions() {
  const select = document.getElementById('modal-executor-id');
  if (!select) return;

  const type = document.querySelector('input[name="modal_executor_type"]:checked')?.value || 'Mandor';
  const filtered = executorsData.filter(e => e.type === type);

  select.innerHTML = filtered.map(e => `
    <option value="${e.id}">${e.name} ${e.pic ? '- PIC: ' + e.pic : ''} (${e.phone})</option>
  `).join('');
}

function toggleExecutorSelect() {
  const mode = document.querySelector('input[name="modal_executor_type"]:checked')?.value || 'Mandor';
  const singleContainer = document.getElementById('container-single-executor');
  const mixContainer = document.getElementById('container-mixing-milestones');
  const singleSelect = document.getElementById('modal-executor-id');

  if (mode === 'Campuran') {
    if (singleContainer) singleContainer.classList.add('hidden');
    if (mixContainer) mixContainer.classList.remove('hidden');
    if (singleSelect) singleSelect.required = false;
    populateMixingExecSelectors();
    calcTotalMixingCost();
  } else {
    if (singleContainer) singleContainer.classList.remove('hidden');
    if (mixContainer) mixContainer.classList.add('hidden');
    if (singleSelect) singleSelect.required = true;
    populateExecutorModalOptions();
  }
}

function onMixStageTypeChange(idx) {
  const type = document.querySelector(`input[name="mix_type_${idx}"]:checked`)?.value || 'Mandor';
  const select = document.getElementById(`mix-exec-${idx}`);
  const costInput = document.getElementById(`mix-cost-${idx}`);

  if (select) {
    const filtered = executorsData.filter(e => e.type === type);
    select.innerHTML = filtered.map(e => `
      <option value="${e.id}">${e.name} ${e.pic ? '- PIC: ' + e.pic : ''}</option>
    `).join('');
  }

  if (costInput) {
    if (type === 'Internal') {
      costInput.disabled = true;
      costInput.value = 0;
    } else {
      costInput.disabled = false;
    }
  }
  calcTotalMixingCost();
}

function calcTotalMixingCost() {
  const mode = document.querySelector('input[name="modal_executor_type"]:checked')?.value;
  if (mode !== 'Campuran') return;

  let total = 0;
  for (let i = 0; i < 4; i++) {
    const type = document.querySelector(`input[name="mix_type_${i}"]:checked`)?.value;
    if (type === 'Mandor') {
      const val = Number(document.getElementById(`mix-cost-${i}`)?.value) || 0;
      total += val;
    }
  }
  const mandorCostInput = document.getElementById('modal-mandor-cost');
  if (mandorCostInput) {
    mandorCostInput.value = total;
  }
}

function populateMixingExecSelectors() {
  for (let i = 0; i < 4; i++) {
    onMixStageTypeChange(i);
  }
}

// -------------------------------------------------------------
// MODALS LOGIC
// -------------------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');

  if (id === 'modalAddProject') {
    toggleExecutorSelect();
    populateSpDropdown();
  } else if (id === 'modalAddInvoice') {
    populateInvoiceSpOptions();
  } else if (id === 'modalAddMandorPayout') {
    populateMandorPayoutProjectOptions();
  }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

function openUpdateMilestoneModal(milestoneId) {
  let foundMilestone = null;
  let parentProject = null;

  for (const p of projectsData) {
    if (p.milestones) {
      const m = p.milestones.find(item => item.id === milestoneId);
      if (m) {
        foundMilestone = m;
        parentProject = p;
        break;
      }
    }
  }

  if (!foundMilestone) return;

  document.getElementById('modal-m-id').value = foundMilestone.id;
  document.getElementById('modal-m-stage').innerText = `Update: ${foundMilestone.stage_name}`;
  document.getElementById('modal-m-project').innerText = `Nomor WO: ${parentProject ? (parentProject.job_name || parentProject.wo_number) : '-'}`;
  document.getElementById('modal-m-status').value = foundMilestone.status || 'To-Do';
  document.getElementById('modal-m-progress').value = foundMilestone.progress_percent || 0;
  document.getElementById('modal-m-notes').value = foundMilestone.notes || '';
  document.getElementById('modal-m-blocked').value = foundMilestone.blocked_reason || '';
  document.getElementById('modal-m-otdr').value = foundMilestone.otdr_loss || '';
  document.getElementById('modal-m-opm').value = foundMilestone.opm_power || '';

  // Set milestone executor details
  const mExecType = foundMilestone.executor_type || (parentProject ? parentProject.executor_type : 'Mandor');
  const typeRadio = document.querySelector(`input[name="modal_m_exec_type"][value="${mExecType === 'Internal' ? 'Internal' : 'Mandor'}"]`);
  if (typeRadio) typeRadio.checked = true;

  populateModalMilestoneExecSelect(mExecType === 'Internal' ? 'Internal' : 'Mandor');
  const mExecSelect = document.getElementById('modal-m-exec-id');
  if (mExecSelect && foundMilestone.executor_id) {
    mExecSelect.value = foundMilestone.executor_id;
  }
  const stageCostInput = document.getElementById('modal-m-stage-cost');
  if (stageCostInput) {
    stageCostInput.value = foundMilestone.stage_cost || 0;
  }
  const costContainer = document.getElementById('container-m-stage-cost');
  if (costContainer) {
    if (mExecType === 'Internal') costContainer.classList.add('hidden');
    else costContainer.classList.remove('hidden');
  }

  toggleBlockedReasonField();

  // Show ATP fields if stage 4
  const atpField = document.getElementById('field-atp-test');
  if (foundMilestone.stage_name && foundMilestone.stage_name.includes('ATP')) {
    atpField.classList.remove('hidden');
  } else {
    atpField.classList.add('hidden');
  }

  openModal('modalUpdateMilestone');
}

function onModalMilestoneExecTypeChange() {
  const isInternal = document.querySelector('input[name="modal_m_exec_type"]:checked')?.value === 'Internal';
  populateModalMilestoneExecSelect(isInternal ? 'Internal' : 'Mandor');
  const costContainer = document.getElementById('container-m-stage-cost');
  const stageCostInput = document.getElementById('modal-m-stage-cost');
  if (costContainer) {
    if (isInternal) {
      costContainer.classList.add('hidden');
      if (stageCostInput) stageCostInput.value = 0;
    } else {
      costContainer.classList.remove('hidden');
    }
  }
}

function populateModalMilestoneExecSelect(type) {
  const select = document.getElementById('modal-m-exec-id');
  if (!select) return;
  const filtered = executorsData.filter(e => e.type === type);
  select.innerHTML = filtered.map(e => `
    <option value="${e.id}">${e.name} ${e.pic ? '- PIC: ' + e.pic : ''} (${e.phone})</option>
  `).join('');
}

function toggleBlockedReasonField() {
  const status = document.getElementById('modal-m-status').value;
  const field = document.getElementById('field-blocked-reason');
  if (status === 'Blocked') {
    field.classList.remove('hidden');
  } else {
    field.classList.add('hidden');
  }
}

async function submitUpdateMilestone(e) {
  e.preventDefault();
  const id = document.getElementById('modal-m-id').value;
  const status = document.getElementById('modal-m-status').value;
  const progress_percent = document.getElementById('modal-m-progress').value;
  const notes = document.getElementById('modal-m-notes').value;
  const blocked_reason = document.getElementById('modal-m-blocked').value;
  const otdr_loss = document.getElementById('modal-m-otdr').value;
  const opm_power = document.getElementById('modal-m-opm').value;
  const executor_type = document.querySelector('input[name="modal_m_exec_type"]:checked')?.value || 'Mandor';
  const executor_id = document.getElementById('modal-m-exec-id')?.value || '';
  const stage_cost = executor_type === 'Mandor' ? (Number(document.getElementById('modal-m-stage-cost')?.value) || 0) : 0;

  try {
    const res = await fetch(`/api/milestones/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        progress_percent,
        notes,
        blocked_reason,
        otdr_loss,
        opm_power,
        executor_type,
        executor_id,
        stage_cost
      })
    });
    if (res.ok) {
      closeModal('modalUpdateMilestone');
      loadProjects();
      loadDashboardStats();
      loadMandorPayouts();
    }
  } catch (err) {
    console.error('Error updating milestone:', err);
  }
}

async function autoDoneMilestone(milestoneId, stageName) {
  try {
    const payload = {
      status: 'Done',
      progress_percent: 100
    };
    if (stageName && stageName.includes('ATP')) {
      payload.otdr_loss = '0.21 dB/km (Pass)';
      payload.opm_power = '-18.5 dBm (Pass)';
    }

    const res = await fetch(`/api/milestones/${milestoneId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      await Promise.all([loadProjects(), loadDashboardStats(), loadMandorPayouts()]);
    } else {
      const err = await res.json();
      alert(err.error || err.message || 'Gagal menandai milestone selesai.');
    }
  } catch (err) {
    console.error('Error auto-marking milestone as done:', err);
    alert('Terjadi kesalahan koneksi saat mengupdate milestone.');
  }
}

function populateSpDropdown() {
  const select = document.getElementById('modal-sp-select');
  const inputWo = document.getElementById('modal-wo');
  const containerCustom = document.getElementById('container-custom-sp');
  const btnToggle = document.getElementById('btn-toggle-sp-input');
  if (!select || !inputWo) return;

  // Ambil list unik nomor SP/PO dari projectsData
  const existingSps = Array.from(new Set((projectsData || []).map(p => (p.wo_number || '').trim()).filter(Boolean)));

  if (existingSps.length === 0) {
    select.classList.add('hidden');
    if (containerCustom) containerCustom.classList.remove('hidden');
    inputWo.required = true;
    if (btnToggle) btnToggle.style.display = 'none';
    return;
  }

  select.classList.remove('hidden');
  if (btnToggle) {
    btnToggle.style.display = 'inline-block';
    btnToggle.textContent = '+ Input SP Baru';
  }

  let options = '<option value="">-- Pilih Nomor SP/PO Eksisting --</option>';
  existingSps.forEach(sp => {
    const relatedProj = (projectsData || []).find(p => p.wo_number === sp);
    const clientNote = relatedProj ? ` (${relatedProj.client_name})` : '';
    options += `<option value="${escapeQuote(sp)}">${sp}${clientNote}</option>`;
  });
  options += '<option value="__NEW__">+ Ketik Nomor SP/PO Baru...</option>';
  select.innerHTML = options;

  if (containerCustom) containerCustom.classList.add('hidden');
  inputWo.value = '';
  inputWo.required = false;
}

function handleSpSelectChange(val) {
  const inputWo = document.getElementById('modal-wo');
  const containerCustom = document.getElementById('container-custom-sp');
  const btnToggle = document.getElementById('btn-toggle-sp-input');
  const clientSelect = document.getElementById('modal-client');

  if (val === '__NEW__') {
    if (containerCustom) containerCustom.classList.remove('hidden');
    if (inputWo) {
      inputWo.value = '';
      inputWo.required = true;
      inputWo.focus();
    }
    if (btnToggle) btnToggle.textContent = 'Pilih SP Eksisting';
  } else if (val) {
    if (containerCustom) containerCustom.classList.add('hidden');
    if (inputWo) {
      inputWo.value = val;
      inputWo.required = false;
    }
    if (btnToggle) btnToggle.textContent = '+ Input SP Baru';

    // Otomatis sinkronkan Klien jika SP tersebut sudah terdaftar
    const matched = (projectsData || []).find(p => p.wo_number === val);
    if (matched && matched.client_name && clientSelect) {
      clientSelect.value = matched.client_name;
    }
  } else {
    if (containerCustom) containerCustom.classList.add('hidden');
    if (inputWo) {
      inputWo.value = '';
      inputWo.required = false;
    }
  }
}

function toggleSpInputMode() {
  const select = document.getElementById('modal-sp-select');
  const containerCustom = document.getElementById('container-custom-sp');
  const inputWo = document.getElementById('modal-wo');
  const btnToggle = document.getElementById('btn-toggle-sp-input');
  if (!containerCustom || !inputWo) return;

  const isCustomHidden = containerCustom.classList.contains('hidden');
  if (isCustomHidden) {
    containerCustom.classList.remove('hidden');
    if (select) select.value = '__NEW__';
    inputWo.required = true;
    inputWo.focus();
    if (btnToggle) btnToggle.textContent = 'Pilih SP Eksisting';
  } else {
    containerCustom.classList.add('hidden');
    if (select) select.value = '';
    inputWo.value = '';
    inputWo.required = false;
    if (btnToggle) btnToggle.textContent = '+ Input SP Baru';
  }
}

async function submitNewProject(e) {
  e.preventDefault();
  const client_name = document.getElementById('modal-client').value;
  
  const spSelect = document.getElementById('modal-sp-select');
  const inputWo = document.getElementById('modal-wo');
  let wo_number = '';
  if (inputWo && inputWo.value.trim()) {
    wo_number = inputWo.value.trim();
  } else if (spSelect && spSelect.value && spSelect.value !== '__NEW__') {
    wo_number = spSelect.value.trim();
  }

  if (!wo_number) {
    alert('Nomor SP/PO wajib diisi atau dipilih.');
    if (spSelect && !spSelect.classList.contains('hidden')) spSelect.focus();
    else if (inputWo) inputWo.focus();
    return;
  }

  const cluster_name = document.getElementById('modal-cluster').value.trim();
  const executor_type = document.querySelector('input[name="modal_executor_type"]:checked')?.value || 'Mandor';
  let executor_id = document.getElementById('modal-executor-id')?.value || '';
  const contract_value = document.getElementById('modal-contract-value').value;
  let mandor_cost = document.getElementById('modal-mandor-cost').value;
  const target_date = document.getElementById('modal-target-date').value;

  let milestones_config = null;
  if (executor_type === 'Campuran') {
    const stageNames = ['Penanaman Tiang', 'Penarikan KU Fiber', 'Instalasi ODP & Splicing', 'Testing & ATP'];
    milestones_config = stageNames.map((stName, idx) => {
      const type = document.querySelector(`input[name="mix_type_${idx}"]:checked`)?.value || 'Mandor';
      const execId = document.getElementById(`mix-exec-${idx}`)?.value || '';
      const cost = type === 'Mandor' ? (Number(document.getElementById(`mix-cost-${idx}`)?.value) || 0) : 0;
      return {
        stage_name: stName,
        executor_type: type,
        executor_id: execId,
        stage_cost: cost
      };
    });
    executor_id = 'MIXED';
    calcTotalMixingCost();
    mandor_cost = document.getElementById('modal-mandor-cost').value;
  }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name,
        wo_number,
        cluster_name,
        executor_type,
        executor_id,
        contract_value,
        mandor_cost,
        target_date,
        milestones_config
      })
    });
    if (res.ok) {
      closeModal('modalAddProject');
      document.getElementById('formAddProject').reset();
      await Promise.all([loadProjects(), loadDashboardStats()]);
      switchTab('projects');
    } else {
      const errData = await res.json();
      alert(errData.message || errData.error || 'Gagal menyimpan Work Order.');
    }
  } catch (err) {
    console.error('Error creating project:', err);
    alert('Terjadi kesalahan koneksi saat membuat Work Order.');
  }
}

function calculateDueDate2Months(invoiceDateStr) {
  if (!invoiceDateStr) return '';
  const d = new Date(invoiceDateStr);
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().split('T')[0];
}

function populateInvoiceSpOptions() {
  const select = document.getElementById('modal-inv-sp');
  const idInput = document.getElementById('modal-inv-id');
  const displayEl = document.getElementById('display-inv-wo-name');
  const containerJob = document.getElementById('container-inv-job-select');
  const selectJob = document.getElementById('modal-inv-job');
  const termInput = document.getElementById('modal-inv-term');
  const projIdInput = document.getElementById('modal-inv-project-id');
  const dateInput = document.getElementById('modal-inv-date');
  const amountInput = document.getElementById('modal-inv-amount');
  if (!select) return;

  if (idInput) idInput.value = '';

  const today = new Date().toISOString().split('T')[0];
  if (dateInput && !dateInput.value) dateInput.value = today;

  if (displayEl) {
    displayEl.textContent = '-- Pilih Nomor SP/PO terlebih dahulu --';
    displayEl.className = 'p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 font-medium text-xs';
  }
  if (containerJob) containerJob.classList.add('hidden');
  if (selectJob) selectJob.innerHTML = '';
  if (termInput) termInput.value = '';
  if (projIdInput) projIdInput.value = '';
  if (amountInput) amountInput.value = '';

  // Kumpulkan UNIQUE Nomor SP/PO dari projectsData (1 SP = 1 entri saja, tidak dobel)
  const spMap = new Map();
  (projectsData || []).forEach(p => {
    const spKey = (p.sp_number || p.wo_number || '').trim();
    if (!spKey) return;
    if (!spMap.has(spKey)) {
      spMap.set(spKey, {
        sp_number: spKey,
        client_name: p.client_name,
        jobs: []
      });
    }
    spMap.get(spKey).jobs.push(p);
  });

  let html = '<option value="" disabled selected>-- Pilih Nomor SP/PO --</option>';
  spMap.forEach(group => {
    html += `<option value="${escapeQuote(group.sp_number)}" data-client="${escapeQuote(group.client_name)}">${group.sp_number} (${group.client_name})</option>`;
  });
  select.innerHTML = html;
}

// Alias untuk backward compatibility
const populateInvoiceProjectOptions = populateInvoiceSpOptions;

function onInvoiceSpChange() {
  const select = document.getElementById('modal-inv-sp');
  const displayEl = document.getElementById('display-inv-wo-name');
  const containerJob = document.getElementById('container-inv-job-select');
  const selectJob = document.getElementById('modal-inv-job');
  const termInput = document.getElementById('modal-inv-term');
  const projIdInput = document.getElementById('modal-inv-project-id');
  const amountInput = document.getElementById('modal-inv-amount');

  if (!select || !select.value) return;
  const spKey = select.value.trim();

  // Dapatkan seluruh pekerjaan di bawah SP ini
  const jobs = (projectsData || []).filter(p => (p.sp_number || p.wo_number || '').trim().toLowerCase() === spKey.toLowerCase());

  if (jobs.length === 0) {
    if (displayEl) {
      displayEl.textContent = 'Tidak ada pekerjaan terdaftar di bawah SP ini.';
      displayEl.className = 'p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 font-medium text-xs';
    }
    if (containerJob) containerJob.classList.add('hidden');
    return;
  }

  if (jobs.length === 1) {
    // Tepat 1 pekerjaan di bawah SP ini
    if (containerJob) containerJob.classList.add('hidden');
    const j = jobs[0];
    const woName = j.job_name || j.cluster_name || j.wo_number;
    if (displayEl) {
      displayEl.textContent = woName;
      displayEl.className = 'p-2.5 bg-sky-50/70 border border-sky-200 rounded-lg text-slate-900 font-bold text-xs';
    }
    if (termInput) termInput.value = woName;
    if (projIdInput) projIdInput.value = j.id;
    if (amountInput) amountInput.value = Math.round((Number(j.contract_value) || 0) * 0.3);
  } else {
    // Banyak pekerjaan di bawah 1 SP (misal: 2 pekerjaan berbeda)
    if (containerJob) containerJob.classList.remove('hidden');

    const totalBOQ = jobs.reduce((sum, j) => sum + (Number(j.contract_value) || 0), 0);
    let jobOptions = '';
    jobs.forEach(j => {
      const jName = j.job_name || j.cluster_name || j.wo_number;
      jobOptions += `<option value="${j.id}" data-wo="${escapeQuote(jName)}" data-boq="${j.contract_value || 0}">${jName} (BOQ: ${formatIDR(j.contract_value)})</option>`;
    });
    const allNames = jobs.map(j => j.job_name || j.cluster_name).join(', ');
    jobOptions += `<option value="all" data-wo="${escapeQuote(allNames)}" data-boq="${totalBOQ}">Gabungan Seluruh Pekerjaan SP (Total BOQ: ${formatIDR(totalBOQ)})</option>`;

    if (selectJob) {
      selectJob.innerHTML = jobOptions;
      selectJob.selectedIndex = 0;
      onInvoiceJobChange();
    }
  }
}

function onInvoiceJobChange() {
  const selectJob = document.getElementById('modal-inv-job');
  const displayEl = document.getElementById('display-inv-wo-name');
  const termInput = document.getElementById('modal-inv-term');
  const projIdInput = document.getElementById('modal-inv-project-id');
  const amountInput = document.getElementById('modal-inv-amount');
  if (!selectJob || selectJob.selectedIndex < 0) return;

  const opt = selectJob.options[selectJob.selectedIndex];
  const jobId = opt.value;
  const woName = opt.getAttribute('data-wo') || opt.text;
  const boqVal = Number(opt.getAttribute('data-boq')) || 0;

  if (displayEl) {
    displayEl.textContent = woName;
    displayEl.className = 'p-2.5 bg-sky-50/70 border border-sky-200 rounded-lg text-slate-900 font-bold text-xs';
  }
  if (termInput) termInput.value = woName;
  if (projIdInput) {
    if (jobId === 'all') {
      const spVal = document.getElementById('modal-inv-sp')?.value;
      const matched = (projectsData || []).find(p => (p.sp_number || p.wo_number) === spVal);
      projIdInput.value = matched ? matched.id : 'all';
    } else {
      projIdInput.value = jobId;
    }
  }
  if (amountInput) amountInput.value = Math.round(boqVal * 0.3);
}

async function submitNewInvoice(e) {
  e.preventDefault();
  const id = document.getElementById('modal-inv-id')?.value.trim();
  if (!id) {
    alert('ID Invoice wajib diisi.');
    return;
  }

  const spSelect = document.getElementById('modal-inv-sp');
  if (!spSelect || !spSelect.value) {
    alert('Pilih Nomor SP/PO terlebih dahulu.');
    return;
  }
  const wo_number = spSelect.value.trim();
  const matchedProj = (projectsData || []).find(p => (p.sp_number || p.wo_number || '').trim().toLowerCase() === wo_number.toLowerCase());
  const client_name = matchedProj ? matchedProj.client_name : (spSelect.selectedOptions[0]?.getAttribute('data-client') || 'Telkom Akses');
  const project_id = document.getElementById('modal-inv-project-id')?.value || (matchedProj ? matchedProj.id : 'proj-none');
  const term_name = document.getElementById('modal-inv-term')?.value || wo_number;
  const amount = document.getElementById('modal-inv-amount')?.value;
  const invoice_date = document.getElementById('modal-inv-date')?.value || new Date().toISOString().split('T')[0];
  const due_date = calculateDueDate2Months(invoice_date);

  try {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        project_id,
        sp_number: wo_number,
        job_name: term_name,
        wo_number,
        client_name,
        term_name,
        amount,
        invoice_date,
        due_date,
        status: 'Belum Cashbank'
      })
    });
    if (res.ok) {
      closeModal('modalAddInvoice');
      document.getElementById('formAddInvoice').reset();
      populateInvoiceSpOptions();
      loadInvoices();
      loadDashboardStats();
    } else {
      const err = await res.json();
      alert(err.message || 'Gagal membuat tagihan.');
    }
  } catch (err) {
    console.error('Error creating invoice:', err);
    alert('Terjadi kesalahan saat membuat tagihan.');
  }
}

// -------------------------------------------------------------
// USER MANAGEMENT (SUPER ADMIN)
// -------------------------------------------------------------
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    users.forEach(u => {
      let roleBadge = '';
      if(u.role === 'direktur') roleBadge = '<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold">DIREKTUR</span>';
      else if(u.role === 'pm') roleBadge = '<span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">PM / OPS</span>';
      else if(u.role === 'finance') roleBadge = '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">FINANCE</span>';
      else roleBadge = `<span class="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase">${u.role}</span>`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="p-3 font-semibold text-slate-800">${u.name}</td>
        <td class="p-3 text-slate-600">${u.username}</td>
        <td class="p-3">${roleBadge}</td>
        <td class="p-3 text-center space-x-2">
          ${u.role !== 'superadmin' ? `<button onclick="openResetPassword(${u.id}, '${u.username}')" class="text-amber-600 hover:text-amber-700" title="Reset Password"><i data-lucide="key" class="w-4 h-4 inline"></i></button>
          <button onclick="deleteUser(${u.id})" class="text-red-600 hover:text-red-700" title="Hapus"><i data-lucide="trash-2" class="w-4 h-4 inline"></i></button>` : '<span class="text-[10px] text-slate-400">Restricted</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });
    if(window.lucide) lucide.createIcons();
    if (currentUser && currentUser.role === 'superadmin') {
      loadTelegramUsers();
    }
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

async function submitNewUser(e) {
  e.preventDefault();
  const name = document.getElementById('modal-user-name').value;
  const username = document.getElementById('modal-user-username').value;
  const password = document.getElementById('modal-user-password').value;
  const role = document.getElementById('modal-user-role').value;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, password, role })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('modalAddUser');
      document.getElementById('formAddUser').reset();
      loadUsers();
    } else {
      alert(data.message);
    }
  } catch(err) {
    console.error(err);
  }
}

function openResetPassword(id, username) {
  document.getElementById('modal-reset-user-id').value = id;
  document.getElementById('modal-reset-username').textContent = username;
  document.getElementById('modal-reset-new-password').value = '';
  openModal('modalResetPassword');
}

async function submitResetPassword(e) {
  e.preventDefault();
  const id = document.getElementById('modal-reset-user-id').value;
  const password = document.getElementById('modal-reset-new-password').value;

  try {
    const res = await fetch('/api/users/' + id + '/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      closeModal('modalResetPassword');
      alert('Password berhasil diubah!');
    } else {
      const data = await res.json();
      alert(data.message || 'Gagal mengubah password.');
    }
  } catch(err) {
    console.error(err);
  }
}

async function deleteUser(id) {
  if(!confirm('Apakah Anda yakin ingin menghapus user ini?')) return;
  try {
    const res = await fetch('/api/users/' + id, { method: 'DELETE' });
    if(res.ok) {
      loadUsers();
    } else {
      const data = await res.json();
      alert(data.message);
    }
  } catch(err) {
    console.error(err);
  }
}

// -------------------------------------------------------------
// TELEGRAM BOT USERS MANAGEMENT (SUPER ADMIN)
// -------------------------------------------------------------
async function loadTelegramUsers() {
  const tbody = document.getElementById('tg-users-table-body');
  if (!tbody) return;
  try {
    const res = await fetch('/api/telegram-users');
    telegramUsersData = await res.json();
    if (!res.ok) throw new Error(telegramUsersData.message || 'Gagal memuat user Telegram');
    
    if (telegramUsersData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-6 text-center text-slate-400 text-xs">
            Belum ada akun Telegram yang terdaftar. Tambahkan manual atau klaim via /claim_superadmin di bot.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = telegramUsersData.map(u => {
      let roleBadge = '';
      if (u.role === 'superadmin') {
        roleBadge = '<span class="bg-fuchsia-100 text-fuchsia-700 px-2 py-0.5 rounded text-[10px] font-bold">SUPERADMIN</span>';
      } else if (u.role === 'pm') {
        roleBadge = '<span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">PM / APPROVER</span>';
      } else if (u.role === 'admin') {
        roleBadge = '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold">ADMIN GUDANG</span>';
      } else {
        roleBadge = '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">TEKNISI</span>';
      }

      const regDate = u.registered_at ? new Date(u.registered_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

      return `
        <tr class="hover:bg-slate-50">
          <td class="p-3 font-mono font-semibold text-slate-800">${u.telegram_id}</td>
          <td class="p-3 font-semibold text-slate-800">${u.name}</td>
          <td class="p-3 text-slate-500">${u.username ? '@' + u.username : '-'}</td>
          <td class="p-3">${roleBadge}</td>
          <td class="p-3 text-slate-500 text-[11px]">${regDate}</td>
          <td class="p-3 text-center">
            <button onclick="deleteTelegramUser('${u.id}', '${u.name}')" class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer" title="Hapus User Bot">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading Telegram users:', err);
  }
}

async function submitNewTelegramUser(e) {
  e.preventDefault();
  const tgId = document.getElementById('modal-tg-id').value.trim();
  const name = document.getElementById('modal-tg-name').value.trim();
  const role = document.getElementById('modal-tg-role').value;

  if (!tgId || !name) {
    alert('ID Telegram dan Nama Pengguna wajib diisi.');
    return;
  }

  try {
    const res = await fetch('/api/telegram-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: tgId, name, role })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('modalAddTelegramUser');
      document.getElementById('formAddTelegramUser').reset();
      alert('Pengguna Telegram berhasil didaftarkan.');
      await loadTelegramUsers();
    } else {
      alert(data.message || 'Gagal mendaftarkan pengguna Telegram.');
    }
  } catch (err) {
    console.error('Error adding Telegram user:', err);
    alert('Terjadi kesalahan saat mendaftarkan user.');
  }
}

async function deleteTelegramUser(id, name) {
  if (!confirm(`Hapus hak akses bot Telegram untuk "${name}"?`)) return;
  try {
    const res = await fetch(`/api/telegram-users/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (res.ok) {
      await loadTelegramUsers();
    } else {
      alert(data.message || 'Gagal menghapus pengguna Telegram.');
    }
  } catch (err) {
    console.error('Error deleting Telegram user:', err);
  }
}

// (Catatan: Logika Executor Management terpusat di Section 5)

// -------------------------------------------------------------
// 8. GALLERY MANAGEMENT (SUPER ADMIN)
// -------------------------------------------------------------
let galleryData = [];


const categoryBadgeMap = {
  lapangan: { label: 'Konstruksi & OSP', badge: 'bg-sky-100 text-sky-800 border-sky-300' },
  splicing: { label: 'Splicing & ODC', badge: 'bg-purple-100 text-purple-800 border-purple-300' },
  qc: { label: 'Pengujian & QC', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  k3: { label: 'K3 & Safety', badge: 'bg-amber-100 text-amber-800 border-amber-300' },
  armada: { label: 'Armada & Gudang', badge: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
  manajemen: { label: 'Tim & Manajemen', badge: 'bg-pink-100 text-pink-800 border-pink-300' },
  refreshing: { label: 'Kegiatan Refreshing', badge: 'bg-orange-100 text-orange-800 border-orange-300' }
};

async function loadGalleryMgmt() {
  const container = document.getElementById('gallery-mgmt-grid');
  if (!container) return;

  try {
    const res = await fetch('/api/gallery');
    galleryData = await res.json();

    if (galleryData.length === 0) {
      container.innerHTML = `
        <div class="col-span-full bg-white p-12 text-center rounded-2xl border border-slate-200">
          <i data-lucide="image" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
          <h4 class="font-bold text-slate-700">Belum ada foto di galeri</h4>
          <p class="text-xs text-slate-400 mt-1">Klik tombol 'Upload Foto Baru' untuk menambahkan foto dokumentasi ke beranda.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    container.innerHTML = galleryData.map(item => {
      const catInfo = categoryBadgeMap[item.category] || { label: item.category, badge: 'bg-slate-100 text-slate-700' };

      return `
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition flex flex-col justify-between">
          <div>
            <div class="relative aspect-video bg-slate-100 overflow-hidden">
              <img src="${item.image_url}" alt="${escapeQuote(item.title)}" onerror="this.onerror=null; this.src='/images/gallery/foto1.jpg'" class="w-full h-full object-cover">
              <span class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full text-[10px] font-bold border backdrop-blur-xs ${catInfo.badge}">
                ${catInfo.label}
              </span>
            </div>
            <div class="p-4">
              <h4 class="font-bold text-slate-900 text-sm mb-1">${item.title}</h4>
              <p class="text-xs text-slate-500 line-clamp-2">${item.description || '-'}</p>
              <div class="mt-3 text-[10px] text-slate-400 font-medium">
                Diupload: ${item.created_at || '-'}
              </div>
            </div>
          </div>
          <div class="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <a href="${item.image_url}" target="_blank" class="text-sky-600 hover:text-sky-700 text-xs font-semibold flex items-center gap-1">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i> Lihat Asli
            </a>
            <div class="flex items-center gap-3">
              <button onclick="openEditGalleryModal('${item.id}')" class="text-amber-600 hover:text-amber-700 text-xs font-semibold flex items-center gap-1 transition">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Edit
              </button>
              <button onclick="deleteGalleryItem('${item.id}', '${escapeQuote(item.title)}')" class="text-red-600 hover:text-red-700 text-xs font-semibold flex items-center gap-1 transition">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Hapus
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading gallery management:', err);
  }
}

function previewGalleryImage(event) {
  const file = event.target.files && event.target.files[0];
  const container = document.getElementById('gal-preview-container');
  const img = document.getElementById('gal-preview-img');

  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
      container.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  } else {
    container.classList.add('hidden');
    img.src = '';
  }
}

async function submitNewGallery(e) {
  e.preventDefault();

  if (!currentUser || currentUser.role !== 'superadmin') {
    alert('Akses Ditolak: Hanya Super Admin yang memiliki hak akses untuk menambah foto galeri!');
    return;
  }

  const title = document.getElementById('modal-gal-title').value;
  const category = document.getElementById('modal-gal-category').value;
  const desc = document.getElementById('modal-gal-desc').value;
  const fileInput = document.getElementById('modal-gal-file');
  const submitBtn = document.getElementById('btnSubmitGallery');

  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Silakan pilih file foto terlebih dahulu!');
    return;
  }

  const file = fileInput.files[0];

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Mengunggah...';
  if (window.lucide) lucide.createIcons();

  const reader = new FileReader();
  reader.onload = async function(event) {
    const base64Data = event.target.result;

    try {
      const res = await fetch('/api/gallery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': currentUser.role
        },
        body: JSON.stringify({
          title: title,
          category: category,
          description: desc,
          image_base64: base64Data
        })
      });

      const data = await res.json();
      if (res.ok) {
        closeModal('modalAddGallery');
        document.getElementById('formAddGallery').reset();
        document.getElementById('gal-preview-container').classList.add('hidden');
        document.getElementById('gal-preview-img').src = '';
        await loadGalleryMgmt();
        alert('Foto berhasil diunggah dan langsung tampil di halaman depan!');
      } else {
        alert(data.message || 'Gagal mengunggah foto.');
      }
    } catch (err) {
      console.error('Error submitting gallery:', err);
      alert('Terjadi kesalahan koneksi saat mengunggah foto.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="upload" class="w-4 h-4"></i> Upload & Publikasikan';
      if (window.lucide) lucide.createIcons();
    }
  };

  reader.readAsDataURL(file);
}

// EDIT GALLERY MODAL (SUPER ADMIN ONLY)
function openEditGalleryModal(id) {
  if (!currentUser || currentUser.role !== 'superadmin') {
    alert('Akses Ditolak: Hanya Super Admin yang memiliki hak akses untuk mengedit foto galeri!');
    return;
  }

  const item = galleryData.find(g => g.id === id);
  if (!item) {
    alert('Foto tidak ditemukan!');
    return;
  }

  document.getElementById('modal-edit-gal-id').value = item.id;
  document.getElementById('modal-edit-gal-title').value = item.title || '';
  document.getElementById('modal-edit-gal-category').value = item.category || 'lapangan';
  document.getElementById('modal-edit-gal-desc').value = item.description || '';
  document.getElementById('modal-edit-gal-file').value = '';
  document.getElementById('gal-edit-preview-img').src = item.image_url;

  openModal('modalEditGallery');
}

function previewEditGalleryImage(event) {
  const file = event.target.files && event.target.files[0];
  const img = document.getElementById('gal-edit-preview-img');

  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
}

async function submitEditGallery(e) {
  e.preventDefault();

  if (!currentUser || currentUser.role !== 'superadmin') {
    alert('Akses Ditolak: Hanya Super Admin yang memiliki hak akses untuk mengedit foto galeri!');
    return;
  }

  const id = document.getElementById('modal-edit-gal-id').value;
  const title = document.getElementById('modal-edit-gal-title').value;
  const category = document.getElementById('modal-edit-gal-category').value;
  const desc = document.getElementById('modal-edit-gal-desc').value;
  const fileInput = document.getElementById('modal-edit-gal-file');
  const submitBtn = document.getElementById('btnSubmitEditGallery');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Menyimpan...';
  if (window.lucide) lucide.createIcons();

  const doUpdate = async (imageBase64 = null) => {
    try {
      const payload = {
        title: title,
        category: category,
        description: desc
      };
      if (imageBase64) payload.image_base64 = imageBase64;

      const res = await fetch(`/api/gallery/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': currentUser.role
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        closeModal('modalEditGallery');
        await loadGalleryMgmt();
        alert('Foto galeri berhasil diperbarui!');
      } else {
        alert(data.message || 'Gagal memperbarui foto galeri.');
      }
    } catch (err) {
      console.error('Error updating gallery item:', err);
      alert('Terjadi kesalahan saat menyimpan perubahan.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Simpan Perubahan';
      if (window.lucide) lucide.createIcons();
    }
  };

  if (fileInput.files && fileInput.files.length > 0) {
    const reader = new FileReader();
    reader.onload = function(event) {
      doUpdate(event.target.result);
    };
    reader.readAsDataURL(fileInput.files[0]);
  } else {
    doUpdate(null);
  }
}

async function deleteGalleryItem(id, title) {
  if (!currentUser || currentUser.role !== 'superadmin') {
    alert('Akses Ditolak: Hanya Super Admin yang memiliki hak akses untuk menghapus foto galeri!');
    return;
  }

  if (!confirm(`Hapus foto "${title}" dari galeri halaman beranda?`)) return;

  try {
    const res = await fetch(`/api/gallery/${id}`, {
      method: 'DELETE',
      headers: {
        'x-user-role': currentUser.role
      }
    });
    if (res.ok) {
      await loadGalleryMgmt();
    } else {
      const data = await res.json();
      alert(data.message || 'Gagal menghapus foto.');
    }
  } catch (err) {
    console.error('Error deleting gallery item:', err);
  }
}

// -------------------------------------------------------------
// 9. EXPORT HELPERS (AUTHENTICATED)
// -------------------------------------------------------------
function exportProjectsCSV() {
  const token = localStorage.getItem('ftth_token');
  if (!token) {
    alert('Silakan login terlebih dahulu.');
    return;
  }
  window.open(`/api/export/projects-csv?token=${encodeURIComponent(token)}`, '_blank');
}

function exportInvoicesCSV() {
  const token = localStorage.getItem('ftth_token');
  if (!token) {
    alert('Silakan login terlebih dahulu.');
    return;
  }
  window.open(`/api/export/invoices-csv?token=${encodeURIComponent(token)}`, '_blank');
}

// -------------------------------------------------------------
// 10. BON MATERIAL & STOK GUDANG
// -------------------------------------------------------------
async function loadMaterials() {
  try {
    const res = await fetch('/api/materials');
    materialsData = await res.json();
  } catch (err) {
    console.error('Error loading materials:', err);
  }
}

async function loadBonMaterials() {
  try {
    const res = await fetch('/api/bon-material');
    bonData = await res.json();
  } catch (err) {
    console.error('Error loading bon material:', err);
  }
}

async function loadBonMaterialTab() {
  await Promise.all([loadMaterials(), loadBonMaterials(), loadBonRequests()]);
  populateBonWOSelect();
  populateBonItemMaterialOptions();
  renderMaterialsList();
  renderBonPendingRequests();
  onBonWOChange();
}

function populateBonWOSelect() {
  const select = document.getElementById('bon-wo-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Pilih Work Order --</option>' + (projectsData || []).map(p => {
    const sp = p.sp_number || p.wo_number || '-';
    const wo = p.job_name || p.cluster_name || p.wo_number || '-';
    const client = p.client_name ? ` (${p.client_name})` : '';
    return `<option value="${p.id}">[SP: ${sp}] ${wo}${client}</option>`;
  }).join('');
}

function onBonWOChange() {
  const projId = document.getElementById('bon-wo-select').value;
  const detail = document.getElementById('bon-detail-container');
  const empty = document.getElementById('bon-empty-state');
  const btnCreate = document.getElementById('btnCreateBon');
  if (!projId) {
    detail.classList.add('hidden');
    empty.classList.remove('hidden');
    if (btnCreate) btnCreate.style.display = 'none';
    return;
  }
  empty.classList.add('hidden');
  const bon = bonData.find(b => b.project_id === projId);
  if (bon) {
    renderBonDetail(bon);
  } else {
    detail.classList.add('hidden');
    if (btnCreate) btnCreate.style.display = canManageBon ? 'flex' : 'none';
  }
}

function renderBonDetail(bon) {
  currentBonId = bon.id;
  bonItemsDraft = bon.items.map(it => ({ ...it }));
  const detail = document.getElementById('bon-detail-container');
  const btnCreate = document.getElementById('btnCreateBon');
  detail.classList.remove('hidden');
  if (btnCreate) btnCreate.style.display = 'none';

  // Ambil detail proyek untuk menyajikan data WO secara lengkap & jelas
  const proj = (projectsData || []).find(p => p.id === bon.project_id);
  const woFullName = proj ? (proj.job_name || proj.cluster_name || proj.wo_number) : (bon.job_name || bon.wo_number);
  const spNumber = proj ? (proj.sp_number || proj.wo_number) : (bon.sp_number || bon.wo_number || '-');
  const clientName = proj?.client_name || bon.client_name || 'Telkom Akses';
  const executorText = proj && proj.executor_name ? ` • ${proj.executor_type}: ${proj.executor_name}` : '';

  const woTitleEl = document.getElementById('bon-detail-wo');
  if (woTitleEl) {
    woTitleEl.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
          SP: ${spNumber}
        </span>
        <span class="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
          ${woFullName}
        </span>
        <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">
          (${clientName})
        </span>
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Bon Material
        </span>
      </div>
    `;
  }

  document.getElementById('bon-detail-meta').textContent =
    `Dibuat: ${bon.created_at} • Diupdate: ${bon.updated_at} • ${bon.items.length} jenis material${executorText}`;
  document.getElementById('bon-status-select').value = bon.status;
  renderBonItems();
  if (window.lucide) lucide.createIcons();
}

function renderBonItems() {
  const container = document.getElementById('bon-items-container');
  const addRow = document.getElementById('bon-add-item-row');
  const btnSave = document.getElementById('btnSaveBon');
  if (canManageBon) {
    addRow.style.display = 'flex';
    btnSave.style.display = 'flex';
  } else {
    addRow.style.display = 'none';
    btnSave.style.display = 'none';
  }

  if (bonItemsDraft.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400">
        <p class="text-xs">Belum ada material di bon ini.</p>
      </div>`;
    return;
  }

  const qtyCell = (item, field) => canManageBon
    ? `<input type="number" min="0" value="${item[field]}" onchange="onBonQtyChange('${item.id}', '${field}', this.value)" class="w-20 text-xs border border-slate-300 rounded-lg px-2 py-1 text-center">`
    : `<span class="font-semibold text-slate-800">${item[field]}</span>`;

  container.innerHTML = `
    <table class="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden">
      <thead class="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
        <tr>
          <th class="p-3">Material</th>
          <th class="p-3">Kategori</th>
          <th class="p-3 text-center">Satuan</th>
          <th class="p-3 text-center">Rencana</th>
          <th class="p-3 text-center">Datang</th>
          <th class="p-3 text-center" title="Pengurangan stok gudang otomatis dihitung saat disimpan">Terpasang (potong gudang)</th>
          <th class="p-3 text-center">Sisa</th>
          ${canManageBon ? '<th class="p-3"></th>' : ''}
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${bonItemsDraft.map(it => `
          <tr class="hover:bg-slate-50">
            <td class="p-3 font-semibold text-slate-800">${it.name}${it.variant ? ` <span class="text-slate-400">(${it.variant})</span>` : ''}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">${it.category}</span></td>
            <td class="p-3 text-center">${it.unit}</td>
            <td class="p-3 text-center">${qtyCell(it, 'qty_planned')}</td>
            <td class="p-3 text-center">${qtyCell(it, 'qty_arrived')}</td>
            <td class="p-3 text-center">${qtyCell(it, 'qty_used')}</td>
            <td class="p-3 text-center font-bold ${it.qty_remaining < 0 ? 'text-red-600' : 'text-emerald-600'}">${it.qty_remaining}</td>
            ${canManageBon ? `<td class="p-3 text-center"><button onclick="removeBonItem('${it.id}')" class="text-red-500 hover:text-red-700" title="Hapus item"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  if (window.lucide) lucide.createIcons();
}

function onBonQtyChange(itemId, field, value) {
  const item = bonItemsDraft.find(it => it.id === itemId);
  if (!item) return;
  item[field] = Number(value) || 0;
  if (field === 'qty_arrived' || field === 'qty_used') {
    item.qty_remaining = item.qty_arrived - item.qty_used;
  }
  renderBonItems();
}

function removeBonItem(itemId) {
  bonItemsDraft = bonItemsDraft.filter(it => it.id !== itemId);
  renderBonItems();
}

function populateBonItemMaterialOptions() {
  const select = document.getElementById('bon-item-material');
  if (!select) return;
  const grouped = {};
  materialsData.forEach(m => {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  });
  let html = '<option value="">-- Pilih material --</option>';
  Object.keys(grouped).forEach(cat => {
    html += `<optgroup label="${cat}">` + grouped[cat].map(m =>
      `<option value="${m.id}" data-name="${m.name}" data-category="${m.category}" data-variant="${m.variant}" data-unit="${m.unit}">${m.name}${m.variant ? ' - ' + m.variant : ''} (${m.unit}) - stok gudang: ${Number(m.stock_qty) || 0}</option>`
    ).join('') + '</optgroup>';
  });
  select.innerHTML = html;
}

function addBonItem() {
  const select = document.getElementById('bon-item-material');
  const opt = select.selectedOptions[0];
  const planned = Number(document.getElementById('bon-item-planned').value) || 0;
  if (!opt || !opt.value) { alert('Pilih material dulu.'); return; }
  bonItemsDraft.push({
    id: 'boni-' + Date.now(),
    material_id: opt.value,
    name: opt.dataset.name,
    category: opt.dataset.category,
    variant: opt.dataset.variant,
    unit: opt.dataset.unit,
    qty_planned: planned,
    qty_arrived: 0,
    qty_used: 0,
    qty_remaining: 0
  });
  select.value = '';
  document.getElementById('bon-item-planned').value = '';
  renderBonItems();
}

async function saveCurrentBon() {
  if (!currentBonId) return;
  const res = await fetch(`/api/bon-material/${currentBonId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: bonItemsDraft })
  });
  const data = await res.json();
  if (res.ok) {
    alert('Bon material berhasil disimpan.');
    await loadBonMaterials();
    await loadMaterials();
    renderMaterialsList();
    renderMaterialStock();
    renderBonDetail(data.bon);
  } else {
    alert(data.message || 'Gagal menyimpan bon material.');
  }
}

async function updateBonStatus() {
  if (!currentBonId) return;
  const status = document.getElementById('bon-status-select').value;
  const res = await fetch(`/api/bon-material/${currentBonId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (res.ok) {
    await loadBonMaterials();
  } else {
    alert('Gagal mengupdate status bon.');
  }
}

async function createBonForSelectedWO() {
  const projId = document.getElementById('bon-wo-select').value;
  if (!projId) { alert('Pilih Work Order dulu.'); return; }
  const res = await fetch('/api/bon-material', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projId })
  });
  const data = await res.json();
  if (res.ok || res.status === 409) {
    await loadBonMaterials();
    const bon = bonData.find(b => b.project_id === projId) || data.bon;
    if (bon) renderBonDetail(bon);
  } else {
    alert(data.message || 'Gagal membuat bon material.');
  }
}

function renderMaterialsList() {
  const container = document.getElementById('materials-list');
  if (!container) return;
  const canDelete = currentUser && ['superadmin', 'direktur'].includes(currentUser.role);
  container.innerHTML = materialsData.map(m => `
    <div class="flex justify-between items-center p-3 rounded-lg border border-slate-200 bg-slate-50/50">
      <div>
        <p class="text-xs font-semibold text-slate-800">${m.name}${m.variant ? ` <span class="text-slate-400">(${m.variant})</span>` : ''}</p>
        <p class="text-[10px] text-slate-500">${m.category} • satuan: ${m.unit} • stok: ${Number(m.stock_qty) || 0} ${m.is_custom ? '• custom' : '• standar'}</p>
      </div>
      <div class="flex items-center gap-2">
        ${canManageBon ? `<button onclick="editMaterial('${m.id}')" class="text-sky-600 hover:text-sky-800" title="Edit"><i data-lucide="edit" class="w-3.5 h-3.5"></i></button>` : ''}
        ${canDelete ? `<button onclick="deleteMaterial('${m.id}')" class="text-red-500 hover:text-red-700" title="Hapus"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : ''}
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function editMaterial(id) {
  const m = materialsData.find(x => x.id === id);
  if (!m) return;
  document.getElementById('edit-mat-id').value = m.id;
  document.getElementById('new-mat-name').value = m.name;
  document.getElementById('new-mat-category').value = m.category;
  document.getElementById('new-mat-variant').value = m.variant || '';
  document.getElementById('new-mat-unit').value = m.unit || '';
  document.getElementById('new-mat-stock').value = m.stock_qty || 0;
  document.getElementById('new-mat-min').value = m.min_stock || 5;
  document.getElementById('btn-submit-material').textContent = 'Simpan';
  document.getElementById('btn-cancel-edit-material').classList.remove('hidden');
}

function cancelEditMaterial() {
  document.getElementById('edit-mat-id').value = '';
  document.getElementById('new-mat-name').value = '';
  document.getElementById('new-mat-variant').value = '';
  document.getElementById('new-mat-unit').value = '';
  document.getElementById('new-mat-stock').value = '';
  document.getElementById('new-mat-min').value = '';
  document.getElementById('btn-submit-material').textContent = '+';
  document.getElementById('btn-cancel-edit-material').classList.add('hidden');
}

async function submitMaterialForm(event) {
  event.preventDefault();
  const editId = document.getElementById('edit-mat-id').value;
  const payload = {
    name: document.getElementById('new-mat-name').value,
    category: document.getElementById('new-mat-category').value,
    variant: document.getElementById('new-mat-variant').value,
    unit: document.getElementById('new-mat-unit').value,
    stock_qty: Number(document.getElementById('new-mat-stock').value) || 0,
    min_stock: Number(document.getElementById('new-mat-min').value) || 5
  };
  const res = await fetch(editId ? `/api/materials/${editId}` : '/api/materials', {
    method: editId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.ok) {
    cancelEditMaterial();
    await loadMaterials();
    renderMaterialsList();
    populateBonItemMaterialOptions();
  } else {
    alert(data.message || 'Gagal menyimpan material.');
  }
}

async function deleteMaterial(id) {
  if (!confirm('Hapus material ini dari master?')) return;
  const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await loadMaterials();
    renderMaterialsList();
    populateBonItemMaterialOptions();
  } else {
    alert('Gagal menghapus material.');
  }
}

// -------------------------------------------------------------
// 11. BON REQUESTS (TELEGRAM / WEB QUEUE & APPROVAL)
// -------------------------------------------------------------
async function loadBonRequests() {
  try {
    const res = await fetch('/api/bon-requests');
    bonRequestsData = await res.json();
    renderBonPendingRequests();
  } catch (err) {
    console.error('Error loading bon requests:', err);
  }
}

function renderBonPendingRequests() {
  const container = document.getElementById('bon-pending-list');
  const badge = document.getElementById('bon-pending-badge');
  if (!container || !badge) return;

  const pending = (bonRequestsData || []).filter(r => r.status === 'pending');
  badge.textContent = pending.length;

  if (pending.length === 0) {
    container.innerHTML = `
      <div class="p-4 rounded-lg bg-slate-50 border border-slate-200/80 text-center text-slate-400 text-xs">
        <i data-lucide="check-circle" class="w-4 h-4 inline-block text-emerald-500 mr-1"></i>
        Tidak ada request material yang menunggu persetujuan.
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const canApprove = currentUser && ['superadmin', 'pm'].includes(currentUser.role);

  container.innerHTML = pending.map(r => {
    const dateStr = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
    const requester = r.requested_by_name || (r.requested_by_telegram_id ? `Telegram ID: ${r.requested_by_telegram_id}` : 'Teknisi');
    const channelBadge = r.channel === 'telegram'
      ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-700">Bot Telegram</span>'
      : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">Web Dashboard</span>';

    const itemsSummary = (r.items || []).map(it => `
      <span class="inline-flex items-center gap-1 px-2 py-1 bg-white border border-slate-200 rounded text-[11px] text-slate-700 font-medium">
        <b>${it.name || it.material_id}</b>: ${it.qty} ${it.unit || 'unit'}
      </span>
    `).join(' ');

    const proj = (projectsData || []).find(p => p.id === r.project_id);
    const woDisplay = proj ? `[SP: ${proj.sp_number || proj.wo_number}] ${proj.job_name || proj.cluster_name}` : r.wo_number;

    return `
      <div class="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40 hover:bg-amber-50/70 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="space-y-1.5 flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">${woDisplay}</span>
            ${channelBadge}
            <span class="text-[11px] text-slate-500">• Pemohon: <b class="text-slate-700">${requester}</b></span>
            <span class="text-[11px] text-slate-400">• ${dateStr}</span>
          </div>
          <div class="flex flex-wrap gap-1.5 pt-1">
            ${itemsSummary}
          </div>
          ${r.notes ? `<p class="text-[11px] text-slate-600 italic">Catatan: "${r.notes}"</p>` : ''}
        </div>

        <div class="flex items-center gap-2 shrink-0 self-end md:self-center">
          ${canApprove ? `
            <button onclick="approveBonRequestWeb('${r.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow cursor-pointer">
              <i data-lucide="check" class="w-3.5 h-3.5"></i> Setujui
            </button>
            <button onclick="rejectBonRequestWeb('${r.id}')" class="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer">
              <i data-lucide="x" class="w-3.5 h-3.5"></i> Tolak
            </button>
          ` : `
            <span class="text-[11px] font-semibold text-amber-700 bg-amber-100/80 px-2.5 py-1 rounded-md">
              Menunggu Approval PM
            </span>
          `}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function approveBonRequestWeb(reqId) {
  if (!confirm('Setujui request material ini dan gabungkan item ke Bon Material WO?')) return;
  try {
    const res = await fetch(`/api/bon-requests/${reqId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved_by: currentUser ? currentUser.name : 'PM Web' })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Request material berhasil disetujui dan digabungkan ke Bon WO.');
      await Promise.all([loadBonRequests(), loadBonMaterials(), loadMaterials()]);
      renderMaterialsList();
      renderMaterialStock();
      const currentProjId = document.getElementById('bon-wo-select')?.value;
      if (currentProjId && data.bon && data.bon.project_id === currentProjId) {
        renderBonDetail(data.bon);
      }
    } else {
      alert(data.message || 'Gagal menyetujui request material.');
    }
  } catch (err) {
    console.error('Error approving request:', err);
    alert('Terjadi kesalahan saat menyetujui request.');
  }
}

async function rejectBonRequestWeb(reqId) {
  const reason = prompt('Masukkan alasan penolakan (opsional):', 'Stok tidak mencukupi atau salah spesifikasi');
  if (reason === null) return;

  try {
    const res = await fetch(`/api/bon-requests/${reqId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Request material telah ditolak.');
      await loadBonRequests();
    } else {
      alert(data.message || 'Gagal menolak request material.');
    }
  } catch (err) {
    console.error('Error rejecting request:', err);
    alert('Terjadi kesalahan saat menolak request.');
  }
}

// -------------------------------------------------------------
// 12. MATERIAL INBOUND (MATERIAL DATANG KE GUDANG)
// -------------------------------------------------------------
function populateInboundMaterialOptions() {
  const select = document.getElementById('inb-modal-material');
  if (!select) return;
  const grouped = {};
  materialsData.forEach(m => {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  });
  let html = '<option value="">-- Pilih Material Datang --</option>';
  Object.keys(grouped).forEach(cat => {
    html += `<optgroup label="${cat}">` + grouped[cat].map(m =>
      `<option value="${m.id}" data-name="${m.name}" data-unit="${m.unit}">${m.name}${m.variant ? ' - ' + m.variant : ''} (${m.unit}) - stok saat ini: ${Number(m.stock_qty) || 0}</option>`
    ).join('') + '</optgroup>';
  });
  select.innerHTML = html;

  const dateInput = document.getElementById('inb-modal-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

async function submitMaterialInbound(e) {
  e.preventDefault();
  const matSelect = document.getElementById('inb-modal-material');
  const opt = matSelect.selectedOptions[0];
  const qty = Number(document.getElementById('inb-modal-qty').value) || 0;
  const arrDate = document.getElementById('inb-modal-date').value;
  const supplier = document.getElementById('inb-modal-supplier').value.trim();
  const notes = document.getElementById('inb-modal-notes').value.trim();

  if (!opt || !opt.value) {
    alert('Pilih material terlebih dahulu.');
    return;
  }
  if (qty <= 0) {
    alert('Jumlah material datang harus lebih dari 0.');
    return;
  }

  const payload = {
    material_id: opt.value,
    qty_in: qty,
    arrival_date: arrDate,
    supplier_surat_jalan: supplier,
    notes: notes,
    recorded_by_name: currentUser ? currentUser.name : 'Web User'
  };

  try {
    const res = await fetch('/api/material-inbounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('modalMaterialInbound');
      document.getElementById('formMaterialInbound').reset();
      alert(`Stok masuk berhasil dicatat. Stok ${data.material.name} sekarang: ${data.material.stock_qty} ${data.material.unit}`);
      await loadMaterials();
      renderMaterialsList();
      populateBonItemMaterialOptions();
      renderMaterialStock();
    } else {
      alert(data.message || 'Gagal mencatat material masuk.');
    }
  } catch (err) {
    console.error('Error submitting material inbound:', err);
    alert('Terjadi kesalahan saat mencatat material masuk.');
  }
}

async function loadMaterialInbounds() {
  const tbody = document.getElementById('inbound-history-tbody');
  if (!tbody) return;
  try {
    const res = await fetch('/api/material-inbounds');
    materialInboundsData = await res.json();
    if (!res.ok) throw new Error(materialInboundsData.message || 'Gagal memuat riwayat');

    if (materialInboundsData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-6 text-center text-slate-400 text-xs">
            Belum ada riwayat material datang.
          </td>
        </tr>
      `;
      return;
    }

    const canDelete = currentUser && ['superadmin', 'direktur'].includes(currentUser.role);

    tbody.innerHTML = materialInboundsData.map(item => {
      const dateStr = item.arrival_date || (item.created_at ? item.created_at.split('T')[0] : '-');
      const recorder = item.recorded_by_name || (item.recorded_by_telegram_id ? `Telegram ID: ${item.recorded_by_telegram_id}` : '-');

      return `
        <tr class="hover:bg-slate-50">
          <td class="p-3 font-medium text-slate-600 whitespace-nowrap">${dateStr}</td>
          <td class="p-3 font-semibold text-slate-800">
            ${item.material_name || item.material_id}
            ${item.notes ? `<div class="text-[10px] text-slate-400 font-normal italic mt-0.5">${item.notes}</div>` : ''}
          </td>
          <td class="p-3 text-center whitespace-nowrap">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
              +${item.qty_in} ${item.unit || ''}
            </span>
          </td>
          <td class="p-3 text-slate-600">${item.supplier_surat_jalan || '-'}</td>
          <td class="p-3 text-slate-500 text-[11px]">${recorder}</td>
          <td class="p-3 text-center whitespace-nowrap">
            ${canDelete ? `
              <button onclick="deleteMaterialInbound('${item.id}', '${item.material_name}')" class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer" title="Hapus (revert stok)">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            ` : '-'}
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading inbounds:', err);
  }
}

async function deleteMaterialInbound(id, name) {
  if (!confirm(`Hapus pencatatan material masuk untuk "${name}"? Stok gudang akan otomatis dikurangi kembali.`)) return;
  try {
    const res = await fetch(`/api/material-inbounds/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (res.ok) {
      await Promise.all([loadMaterials(), loadMaterialInbounds()]);
      renderMaterialsList();
      populateBonItemMaterialOptions();
      renderMaterialStock();
    } else {
      alert(data.message || 'Gagal menghapus riwayat material masuk.');
    }
  } catch (err) {
    console.error('Error deleting inbound:', err);
  }
}

// --- Widget stok gudang di Executive Dashboard ---
function renderMaterialStock() {
  const summary = document.getElementById('material-stock-summary');
  const list = document.getElementById('material-stock-list');
  const ctx = document.getElementById('materialStockChart');
  if (!summary || !list || !ctx) return;

  const totalTypes = materialsData.length;
  const totalUnits = materialsData.reduce((sum, m) => sum + (Number(m.stock_qty) || 0), 0);
  const lowCount = materialsData.filter(m => (Number(m.stock_qty) || 0) < (Number(m.min_stock) || 5)).length;

  summary.innerHTML = `
    <span class="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded font-medium">${totalTypes} tipe material</span>
    <span class="text-xs bg-sky-100 text-sky-700 px-2.5 py-1 rounded font-medium">${totalUnits} unit di gudang</span>
    <span class="text-xs ${lowCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'} px-2.5 py-1 rounded font-medium">${lowCount} material perlu restock</span>
  `;

  // Diagram: total stok per kategori
  const cats = {};
  materialsData.forEach(m => {
    const c = m.category || 'Lainnya';
    cats[c] = (cats[c] || 0) + (Number(m.stock_qty) || 0);
  });
  if (materialStockChartInstance) materialStockChartInstance.destroy();
  const isDarkStock = isDarkMode();
  const stockTextColor = isDarkStock ? '#cbd5e1' : '#64748b';
  const stockGridColor = isDarkStock ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.8)';

  materialStockChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(cats),
      datasets: [{
        label: 'Stok Gudang',
        data: Object.values(cats),
        backgroundColor: ['#0ea5e9', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#64748b'],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: stockTextColor }, grid: { color: stockGridColor } },
        y: { beginAtZero: true, ticks: { color: stockTextColor }, grid: { color: stockGridColor } }
      }
    }
  });

  // List per-material: stok paling sedikit di atas
  const sorted = [...materialsData].sort((a, b) => (Number(a.stock_qty) || 0) - (Number(b.stock_qty) || 0));
  list.innerHTML = sorted.map(m => {
    const stock = Number(m.stock_qty) || 0;
    const min = Number(m.min_stock) || 5;
    const badge = stock === 0
      ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">Habis</span>'
      : stock < min
        ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Rendah</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Aman</span>';
    return `
      <div class="flex justify-between items-center p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60">
        <div class="min-w-0">
          <p class="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">${m.name}${m.variant ? ` <span class="text-slate-400">(${m.variant})</span>` : ''}</p>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">${m.category} • min ${min}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${badge}
          <span class="text-xs font-bold text-slate-900 dark:text-slate-100 w-20 text-right">${stock} ${m.unit}</span>
        </div>
      </div>
    `;
  }).join('');
}
