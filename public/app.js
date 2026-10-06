// Global State
let currentTab = 'dashboard';
let currentFinanceSubTab = 'inflow';
let projectsData = [];
let executorsData = [];
let drumsData = [];
let revenueChartInstance = null;
let clientChartInstance = null;
let currentUser = null;

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

// Currency Formatter
function formatIDR(num) {
  if (isNaN(num) || num === null || num === undefined) return 'Rp 0';
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
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
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('ftth_user', JSON.stringify(data.user));
      localStorage.setItem('ftth_token', data.token);
      currentUser = data.user;
      showAppBasedOnRole();
    } else {
      errDiv.textContent = data.message;
      errDiv.classList.remove('hidden');
    }
  } catch(err) {
    errDiv.textContent = 'Gagal terhubung ke server.';
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
  const tabBoq = document.getElementById('tab-boq');
  const tabFin = document.getElementById('tab-finance');
  const tabExec = document.getElementById('tab-executors');
  const tabUsers = document.getElementById('tab-users');
  const tabGalleryMgmt = document.getElementById('tab-gallery-mgmt');
  const btnTambahWO = document.getElementById('btnTambahWO');
  const btnAddExecutor = document.getElementById('btnAddExecutor');

  // Reset default
  tabDash.style.display = 'flex';
  tabProj.style.display = 'flex';
  tabBoq.style.display = 'flex';
  tabFin.style.display = 'flex';
  tabExec.style.display = 'flex';
  if(tabUsers) tabUsers.style.display = 'none';
  if(tabGalleryMgmt) tabGalleryMgmt.style.display = 'none';
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
    tabBoq.style.display = 'none';
    tabExec.style.display = 'none';
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

  loadAllData();
}

// Load All Data
async function loadAllData() {
  const promises = [
    loadExecutors(),
    loadDashboardStats(),
    loadProjects(),
    loadDrums(),
    loadInvoices(),
    loadMandorPayouts()
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
    btn.classList.remove('text-sky-400', 'bg-slate-900', 'border', 'border-slate-700');
    btn.classList.add('text-slate-400');
  });

  const activeContent = document.getElementById(`content-${tabName}`);
  const activeBtn = document.getElementById(`tab-${tabName}`);
  if (activeContent) activeContent.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-400');
    activeBtn.classList.add('text-sky-400', 'bg-slate-900', 'border', 'border-slate-700');
  }

  if (tabName === 'dashboard') {
    loadDashboardStats();
  } else if (tabName === 'projects') {
    loadProjects();
  } else if (tabName === 'boq') {
    populateBOQProjectSelect();
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

    renderRevenueChart(stats.monthlyRevenue);
    renderClientChart(stats.clientPortfolio);
    renderAgingTable();
    renderExecutorSummary(stats.executorBreakdown);
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

function renderRevenueChart(monthlyData) {
  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;

  const labels = monthlyData.map(d => d.month);
  const billedData = monthlyData.map(d => d.billed / 1000000); // in Millions
  const receivedData = monthlyData.map(d => d.received / 1000000);

  if (revenueChartInstance) {
    revenueChartInstance.destroy();
  }

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
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: Rp ${ctx.parsed.y.toLocaleString('id-ID')} Juta`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => 'Rp ' + v + 'M' }
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

  clientChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff'
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
            <span class="font-medium text-slate-700">${lbl}</span>
          </div>
          <span class="text-slate-500 font-semibold">${formatIDR(val)} (${pct}%)</span>
        </div>
      `;
    }).join('');
  }
}

async function renderAgingTable() {
  const container = document.getElementById('aging-table-container');
  if (!container) return;

  try {
    const res = await fetch('/api/invoices');
    const invoices = await res.json();
    const unpaid = invoices.filter(i => i.status !== 'Lunas');

    if (unpaid.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-500 italic py-4 text-center">Semua invoice klien dalam status lunas.</p>`;
      return;
    }

    container.innerHTML = `
      <table class="w-full text-left text-xs">
        <thead class="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
          <tr>
            <th class="py-2 px-2.5">Klien / SP</th>
            <th class="py-2 px-2.5 text-right">Nominal</th>
            <th class="py-2 px-2.5">Jatuh Tempo</th>
            <th class="py-2 px-2.5">Status Aging</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${unpaid.map(inv => {
            let badgeClass = 'bg-slate-100 text-slate-700';
            if (inv.aging_category.includes('> 60')) badgeClass = 'bg-red-100 text-red-700 font-bold';
            else if (inv.aging_category.includes('31')) badgeClass = 'bg-amber-100 text-amber-800 font-semibold';
            else badgeClass = 'bg-sky-100 text-sky-800';

            return `
              <tr class="hover:bg-slate-50">
                <td class="py-2.5 px-2.5">
                  <div class="font-bold text-slate-800">${inv.client_name}</div>
                  <div class="text-[11px] text-slate-400">${inv.wo_number} • ${inv.term_name}</div>
                </td>
                <td class="py-2.5 px-2.5 text-right font-bold text-slate-900">${formatIDR(inv.amount)}</td>
                <td class="py-2.5 px-2.5 text-slate-600">${inv.due_date}</td>
                <td class="py-2.5 px-2.5">
                  <span class="px-2 py-0.5 rounded text-[10px] ${badgeClass}">${inv.aging_category}</span>
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

  const totalVal = (exData.internalValue || 0) + (exData.mandorValue || 0);
  const intPct = totalVal > 0 ? Math.round((exData.internalValue / totalVal) * 100) : 0;
  const manPct = totalVal > 0 ? (100 - intPct) : 0;

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
    populateBOQProjectSelect();
  } catch (err) {
    console.error('Error loading projects:', err);
  }
}

function renderProjectsList() {
  const container = document.getElementById('projects-container');
  if (!container) return;

  if (projectsData.length === 0) {
    container.innerHTML = `
      <div class="bg-white p-12 text-center rounded-2xl border border-slate-200">
        <i data-lucide="folder-search" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
        <h4 class="font-bold text-slate-700">Tidak ada proyek yang sesuai filter</h4>
        <p class="text-xs text-slate-400 mt-1">Coba ubah filter atau tambah Work Order baru.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = projectsData.map(proj => {
    // Client Color Badge
    let clientColor = 'bg-sky-100 text-sky-800 border-sky-300';
    if (proj.client_name.includes('Icon')) clientColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (proj.client_name.includes('ID Net')) clientColor = 'bg-purple-100 text-purple-800 border-purple-300';

    // Executor Badge
    const isInternal = proj.executor_type === 'Internal';
    const execBadge = isInternal
      ? `<span class="inline-flex items-center gap-1 bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded text-[11px] font-semibold"><i data-lucide="shield" class="w-3 h-3"></i> Internal: ${proj.executor_name}</span>`
      : `<span class="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-semibold"><i data-lucide="hard-hat" class="w-3 h-3"></i> Mandor: ${proj.executor_name}</span>`;

    return `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition hover:shadow-md">
        <!-- Project Header -->
        <div class="p-5 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50/50">
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-1.5">
              <span class="px-2.5 py-0.5 text-xs font-bold rounded-full border ${clientColor}">${proj.client_name}</span>
              <span class="font-mono font-bold text-slate-900 text-sm">${proj.wo_number}</span>
              ${execBadge}
            </div>
            <h3 class="font-bold text-slate-900 text-base flex items-center gap-1.5">
              <i data-lucide="map-pin" class="w-4 h-4 text-slate-400"></i> ${proj.cluster_name}
            </h3>
            <p class="text-xs text-slate-500 mt-0.5">Target Selesai: <span class="font-semibold text-slate-700">${proj.target_date}</span></p>
          </div>

          <!-- Financial Snapshot per WO -->
          <div class="flex items-center gap-3">
            <div class="text-right bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
              <span class="text-[10px] text-slate-400 font-semibold block uppercase">Nilai Kontrak SPK</span>
              <span class="text-sm font-bold text-slate-900">${formatIDR(proj.contract_value)}</span>
              <div class="text-[11px] text-indigo-600 font-semibold mt-0.5">
                Laba Kotor: ${formatIDR(proj.gross_margin)} (${proj.margin_percent}%)
              </div>
            </div>
            <button onclick="openBOQForProject('${proj.id}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2.5 rounded-lg border border-slate-300 transition flex items-center gap-1">
              <i data-lucide="calculator" class="w-3.5 h-3.5"></i> BOQ
            </button>
            <button onclick="deleteProject('${proj.id}', '${proj.wo_number}')" title="Hapus Work Order" class="bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 text-xs font-semibold px-2.5 py-2.5 rounded-lg border border-red-200 transition flex items-center gap-1">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        <!-- Progress Bar Summary -->
        <div class="px-5 py-2.5 bg-slate-100/60 border-b border-slate-100 flex items-center justify-between text-xs">
          <span class="font-semibold text-slate-600">Progres Fisik Keseluruhan:</span>
          <div class="flex items-center gap-3 w-1/2">
            <div class="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
              <div class="bg-emerald-500 h-2.5 rounded-full transition-all" style="width: ${proj.progress_percent || 0}%"></div>
            </div>
            <span class="font-bold text-slate-800 w-10 text-right">${proj.progress_percent || 0}%</span>
          </div>
        </div>

        <!-- 4 Milestone Cards Grid (Tiang, KU Fiber, ODP, ATP) -->
        <div class="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          ${proj.milestones.map(m => renderMilestoneCard(m, proj)).join('')}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function deleteProject(projId, woNumber) {
  if (!confirm(`Apakah Anda yakin ingin menghapus Work Order ${woNumber}?\n\nPerhatian: Seluruh milestone pengerjaan, data BOQ, invoice termin, dan klaim mandor terkait proyek ini akan ikut dihapus secara permanen.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/projects/${projId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      await loadProjects();
      await loadDashboardStats();
      await loadDrums();
      await loadInvoices();
      await loadMandorPayouts();
      populateBOQProjectSelect();
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
      <div class="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600 space-y-0.5 bg-slate-50 p-1.5 rounded">
        <div><b>OTDR:</b> ${m.otdr_loss || '-'}</div>
        <div><b>OPM:</b> ${m.opm_power || '-'}</div>
      </div>
    `;
  }

  // Blocked reason alert
  let blockedAlert = '';
  if (m.status === 'Blocked' && m.blocked_reason) {
    blockedAlert = `
      <div class="mt-2 p-1.5 bg-red-50 text-red-700 text-[10px] rounded border border-red-200 font-medium">
        ⚠️ <b>Kendala:</b> ${m.blocked_reason}
      </div>
    `;
  }

  return `
    <div class="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-col justify-between hover:border-sky-300 transition">
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold text-slate-800">${m.stage_name}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${statusBadgeClass}">
            <i data-lucide="${statusIcon}" class="w-3 h-3"></i> ${m.status}
          </span>
        </div>

        <p class="text-[11px] text-slate-500 line-clamp-2">${m.notes || 'Belum ada catatan.'}</p>
        ${blockedAlert}
        ${extraContent}
      </div>

      <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
        <span class="text-[11px] font-semibold text-slate-500">${m.progress_percent}%</span>
        <button onclick="openUpdateMilestoneModal('${m.id}')" class="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1">
          <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Update
        </button>
      </div>
    </div>
  `;
}

function escapeQuote(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// -------------------------------------------------------------
// 3. BOQ & DRUMS
// -------------------------------------------------------------
async function loadDrums() {
  try {
    const res = await fetch('/api/drums');
    drumsData = await res.json();
    renderDrumsList();
  } catch (err) {
    console.error('Error loading drums:', err);
  }
}

function renderDrumsList() {
  const container = document.getElementById('drums-container');
  if (!container) return;

  container.innerHTML = drumsData.map(d => {
    const usedPct = Math.round((d.used_meters / d.initial_meters) * 100);
    const isWarning = d.remaining_meters < 300 && d.remaining_meters > 0;
    
    return `
      <div class="p-4 rounded-xl border ${isWarning ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-slate-50/50'}">
        <div class="flex justify-between items-start mb-2">
          <div>
            <span class="font-mono font-bold text-sm text-slate-900">${d.id}</span>
            <p class="text-xs text-slate-500">${d.cable_type}</p>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded font-bold ${d.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}">${d.status}</span>
        </div>

        <div class="space-y-1 my-2">
          <div class="flex justify-between text-xs font-semibold">
            <span class="text-slate-600">Terpakai: ${d.used_meters} m</span>
            <span class="text-slate-900">Sisa: ${d.remaining_meters} m</span>
          </div>
          <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
            <div class="${isWarning ? 'bg-amber-500' : 'bg-sky-600'} h-2 rounded-full" style="width: ${usedPct}%"></div>
          </div>
        </div>

        <p class="text-[11px] text-slate-500 mt-1">Alokasi SP: <span class="font-semibold text-slate-700">${d.allocated_to}</span></p>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function populateBOQProjectSelect() {
  const select = document.getElementById('boq-project-select');
  if (!select) return;

  if (projectsData.length === 0) {
    select.innerHTML = '<option value="">Belum ada proyek</option>';
    return;
  }

  select.innerHTML = projectsData.map(p => `
    <option value="${p.id}">${p.wo_number} - ${p.cluster_name} (${p.client_name})</option>
  `).join('');

  loadBOQForSelectedProject();
}

function openBOQForProject(projId) {
  switchTab('boq');
  const select = document.getElementById('boq-project-select');
  if (select) {
    select.value = projId;
    loadBOQForSelectedProject();
  }
}

async function loadBOQForSelectedProject() {
  const projId = document.getElementById('boq-project-select')?.value;
  const container = document.getElementById('boq-detail-container');
  if (!projId || !container) return;

  const project = projectsData.find(p => p.id === projId);
  try {
    const res = await fetch(`/api/boq/${projId}`);
    const items = await res.json();

    if (items.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-slate-400">
          <p class="text-xs">Belum ada rincian BOQ tersimpan untuk proyek ini.</p>
        </div>
      `;
      return;
    }

    let totalClientRevenue = 0;
    let totalMandorCost = 0;

    const rows = items.map(it => {
      const subClient = it.actual_qty * it.client_rate;
      const subMandor = it.actual_qty * it.mandor_rate;
      const margin = subClient - subMandor;
      totalClientRevenue += subClient;
      totalMandorCost += subMandor;

      return `
        <tr class="hover:bg-slate-50 text-xs">
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${it.item_type === 'Material' ? 'bg-sky-100 text-sky-800' : 'bg-indigo-100 text-indigo-800'}">${it.item_type}</span>
          </td>
          <td class="p-3 font-semibold text-slate-800">${it.name}</td>
          <td class="p-3 text-center">${it.planned_qty} ${it.unit}</td>
          <td class="p-3 text-center font-bold text-slate-900">${it.actual_qty} ${it.unit}</td>
          <td class="p-3 text-right">${formatIDR(it.client_rate)}</td>
          <td class="p-3 text-right text-amber-700">${it.mandor_rate > 0 ? formatIDR(it.mandor_rate) : '-'}</td>
          <td class="p-3 text-right font-bold text-slate-900">${formatIDR(subClient)}</td>
          <td class="p-3 text-right font-bold text-emerald-600">${formatIDR(margin)}</td>
        </tr>
      `;
    }).join('');

    const totalMargin = totalClientRevenue - totalMandorCost;

    container.innerHTML = `
      <table class="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden">
        <thead class="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
          <tr>
            <th class="p-3">Kategori</th>
            <th class="p-3">Deskripsi Item</th>
            <th class="p-3 text-center">Vol SPK</th>
            <th class="p-3 text-center">Realisasi</th>
            <th class="p-3 text-right">Tarif Klien</th>
            <th class="p-3 text-right">Upah Mandor</th>
            <th class="p-3 text-right">Subtotal Klien</th>
            <th class="p-3 text-right">Gross Margin</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows}
        </tbody>
        <tfoot class="bg-slate-50 font-bold border-t-2 border-slate-300 text-xs">
          <tr>
            <td colspan="6" class="p-3 text-right">TOTAL REALISASI:</td>
            <td class="p-3 text-right text-slate-900">${formatIDR(totalClientRevenue)}</td>
            <td class="p-3 text-right text-emerald-600">${formatIDR(totalMargin)}</td>
          </tr>
        </tfoot>
      </table>
    `;
  } catch (err) {
    console.error('Error loading BOQ:', err);
  }
}

// -------------------------------------------------------------
// 4. FINANCE (CASHFLOW 2 ARAH)
// -------------------------------------------------------------
async function loadInvoices() {
  const tbody = document.getElementById('invoices-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/invoices');
    const list = await res.json();

    tbody.innerHTML = list.map(inv => {
      const isLunas = inv.status === 'Lunas';
      let statusBadge = 'bg-slate-100 text-slate-700';
      if (inv.status === 'BAST Terbit') statusBadge = 'bg-sky-100 text-sky-800';
      if (inv.status === 'Invoice Terkirim') statusBadge = 'bg-amber-100 text-amber-800';
      if (isLunas) statusBadge = 'bg-emerald-100 text-emerald-800 font-bold';

      return `
        <tr class="hover:bg-slate-50">
          <td class="p-3 font-mono font-bold text-slate-900">${inv.id}</td>
          <td class="p-3 font-semibold">${inv.client_name}</td>
          <td class="p-3 text-slate-600 font-mono">${inv.wo_number}</td>
          <td class="p-3">${inv.term_name}</td>
          <td class="p-3 text-right font-bold text-slate-900">${formatIDR(inv.amount)}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${statusBadge}">${inv.status}</span></td>
          <td class="p-3 text-slate-600">${inv.invoice_date}</td>
          <td class="p-3 text-slate-600">${inv.due_date}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600 font-medium">${inv.aging_category}</span></td>
          <td class="p-3 text-center">
            ${!isLunas ? `
              <button onclick="markInvoicePaid('${inv.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded text-[11px] font-semibold shadow-xs">
                Tandai Lunas
              </button>
            ` : `<span class="text-emerald-600 font-bold text-[11px] flex items-center justify-center gap-1"><i data-lucide="check" class="w-3.5 h-3.5"></i> Masuk Kas</span>`}
          </td>
        </tr>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading invoices:', err);
  }
}

async function markInvoicePaid(invId) {
  if (!confirm('Konfirmasi bahwa pembayaran invoice ini sudah masuk ke rekening perusahaan?')) return;
  try {
    const res = await fetch(`/api/invoices/${invId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Lunas' })
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

    tbody.innerHTML = payouts.map(p => {
      const isPaid = p.status === 'Lunas';
      const isApproved = p.verified_by_pm;

      return `
        <tr class="hover:bg-slate-50">
          <td class="p-3 font-mono font-bold">${p.id}</td>
          <td class="p-3 font-bold text-slate-900">${p.mandor_name}</td>
          <td class="p-3 font-mono text-slate-600">${p.project_id}</td>
          <td class="p-3">${p.milestone_stage}</td>
          <td class="p-3 text-right font-bold text-amber-900">${formatIDR(p.amount)}</td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
              ${isApproved ? '✔ Terverifikasi PM' : '✖ Belum Lolos PM'}
            </span>
          </td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
              ${p.status}
            </span>
          </td>
          <td class="p-3 text-[11px] text-slate-500">${p.notes || '-'}</td>
          <td class="p-3 text-center space-x-1">
            ${!isApproved && !isPaid ? `
              <button onclick="verifyMandorPayout('${p.id}', true)" class="bg-sky-600 hover:bg-sky-500 text-white px-2 py-1 rounded text-[10px] font-semibold">
                Setujui PM
              </button>
            ` : ''}
            ${isApproved && !isPaid ? `
              <button onclick="payMandorPayout('${p.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded text-[10px] font-bold shadow-xs">
                Cairkan Kas
              </button>
            ` : ''}
            ${isPaid ? `<span class="text-slate-400 font-semibold text-[10px]">Tuntas</span>` : ''}
          </td>
        </tr>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading payouts:', err);
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
async function loadExecutors() {
  try {
    const res = await fetch('/api/executors');
    executorsData = await res.json();
    populateExecutorModalOptions();
  } catch (err) {
    console.error('Error loading executors:', err);
  }
}

function renderExecutors() {
  const container = document.getElementById('executors-grid');
  if (!container) return;

  const canEdit = currentUser && ['superadmin', 'direktur', 'pm'].includes(currentUser.role);

  container.innerHTML = executorsData.map(e => {
    const isInt = e.type === 'Internal';
    const editBtn = canEdit ? `
      <button onclick="editExecutor('${e.id}')" class="text-sky-600 hover:text-sky-800" title="Edit">
        <i data-lucide="edit" class="w-4 h-4"></i>
      </button>
    ` : '';

    return `
      <div class="p-5 rounded-2xl border ${isInt ? 'border-sky-200 bg-sky-50/30' : 'border-amber-200 bg-amber-50/30'} flex flex-col justify-between">
        <div>
          <div class="flex justify-between items-start mb-2">
            <span class="px-2.5 py-0.5 rounded text-[11px] font-bold ${isInt ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}">
              ${isInt ? 'Tim Internal' : 'Mandor / Subkon'}
            </span>
            <span class="text-xs font-bold text-amber-600 flex items-center gap-1">
              ★ ${e.rating || '5.0'}
            </span>
          </div>

          <div class="flex justify-between items-start">
            <h3 class="font-bold text-slate-900 text-base mb-1">${e.name}</h3>
            ${editBtn}
          </div>
          <p class="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
            <i data-lucide="phone" class="w-3.5 h-3.5"></i> ${e.phone}
          </p>

          <div class="p-2.5 bg-white rounded-xl border border-slate-100 text-xs space-y-1 my-3">
            <span class="text-[10px] text-slate-400 font-bold uppercase block">Standar Biaya / Upah:</span>
            <p class="text-slate-700 font-medium">${e.standard_rates}</p>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>WO Aktif: <b class="text-slate-800">${e.active_wos || 0} Proyek</b></span>
          <span class="text-sky-600 font-semibold">Tersedia</span>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function populateExecutorModalOptions() {
  const select = document.getElementById('modal-executor-id');
  if (!select) return;

  const type = document.querySelector('input[name="modal_executor_type"]:checked')?.value || 'Mandor';
  const filtered = executorsData.filter(e => e.type === type);

  select.innerHTML = filtered.map(e => `
    <option value="${e.id}">${e.name} (${e.phone})</option>
  `).join('');
}

function toggleExecutorSelect() {
  populateExecutorModalOptions();
}

// -------------------------------------------------------------
// MODALS LOGIC
// -------------------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');

  if (id === 'modalAddProject') {
    populateExecutorModalOptions();
  } else if (id === 'modalAddInvoice') {
    populateInvoiceProjectOptions();
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
  document.getElementById('modal-m-project').innerText = `Nomor WO: ${parentProject ? parentProject.wo_number : '-'}`;
  document.getElementById('modal-m-status').value = foundMilestone.status || 'To-Do';
  document.getElementById('modal-m-progress').value = foundMilestone.progress_percent || 0;
  document.getElementById('modal-m-notes').value = foundMilestone.notes || '';
  document.getElementById('modal-m-blocked').value = foundMilestone.blocked_reason || '';
  document.getElementById('modal-m-otdr').value = foundMilestone.otdr_loss || '';
  document.getElementById('modal-m-opm').value = foundMilestone.opm_power || '';

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

  try {
    const res = await fetch(`/api/milestones/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, progress_percent, notes, blocked_reason, otdr_loss, opm_power })
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

async function submitNewProject(e) {
  e.preventDefault();
  const client_name = document.getElementById('modal-client').value;
  const wo_number = document.getElementById('modal-wo').value;
  const cluster_name = document.getElementById('modal-cluster').value;
  const executor_type = document.querySelector('input[name="modal_executor_type"]:checked').value;
  const executor_id = document.getElementById('modal-executor-id').value;
  const contract_value = document.getElementById('modal-contract-value').value;
  const mandor_cost = document.getElementById('modal-mandor-cost').value;
  const target_date = document.getElementById('modal-target-date').value;

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
        target_date
      })
    });
    if (res.ok) {
      closeModal('modalAddProject');
      document.getElementById('formAddProject').reset();
      loadProjects();
      loadDashboardStats();
      switchTab('projects');
    }
  } catch (err) {
    console.error('Error creating project:', err);
  }
}

function populateInvoiceProjectOptions() {
  const select = document.getElementById('modal-inv-project');
  if (!select) return;
  select.innerHTML = '<option value="" disabled selected>-- Pilih Work Order --</option>' + projectsData.map(p => `
    <option value="${p.id}" data-wo="${p.wo_number}" data-client="${p.client_name}">${p.wo_number} - ${p.cluster_name} (${p.client_name})</option>
  `).join('');
}

function autoFillInvoiceProjectInfo() {
  const select = document.getElementById('modal-inv-project');
  if (!select || select.selectedIndex < 0) return;
  const opt = select.options[select.selectedIndex];
  if (!opt || !opt.value) return;

  const projId = opt.value;
  const proj = projectsData.find(p => p.id === projId);

  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('modal-inv-date');
  if (dateInput && !dateInput.value) dateInput.value = today;

  const dueDateInput = document.getElementById('modal-inv-due');
  if (dueDateInput && !dueDateInput.value) {
    const due = new Date();
    due.setDate(due.getDate() + 30);
    dueDateInput.value = due.toISOString().split('T')[0];
  }

  const termInput = document.getElementById('modal-inv-term');
  const amountInput = document.getElementById('modal-inv-amount');
  if (proj && (!amountInput.value || Number(amountInput.value) === 0)) {
    amountInput.value = Math.round(proj.contract_value * 0.3);
    if (termInput && !termInput.value) {
      termInput.value = `Termin 1 (30%) - ${proj.wo_number}`;
    }
  }
}

async function submitNewInvoice(e) {
  e.preventDefault();
  const select = document.getElementById('modal-inv-project');
  const opt = select.options[select.selectedIndex];
  const project_id = opt.value;
  const wo_number = opt.getAttribute('data-wo');
  const client_name = opt.getAttribute('data-client');
  const term_name = document.getElementById('modal-inv-term').value;
  const amount = document.getElementById('modal-inv-amount').value;
  const invoice_date = document.getElementById('modal-inv-date').value;
  const due_date = document.getElementById('modal-inv-due').value;

  try {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id,
        wo_number,
        client_name,
        term_name,
        amount,
        invoice_date,
        due_date,
        status: 'Invoice Terkirim'
      })
    });
    if (res.ok) {
      closeModal('modalAddInvoice');
      document.getElementById('formAddInvoice').reset();
      loadInvoices();
      loadDashboardStats();
    }
  } catch (err) {
    console.error('Error creating invoice:', err);
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
// EXECUTOR MANAGEMENT
// -------------------------------------------------------------
function resetExecutorForm() {
  document.getElementById('formEditExecutor').reset();
  document.getElementById('modal-exec-id').value = '';
  document.getElementById('executorModalTitle').textContent = 'Tambah Eksekutor Baru';
}

function editExecutor(id) {
  const exec = executorsData.find(e => e.id === id);
  if (!exec) return;
  
  document.getElementById('modal-exec-id').value = exec.id;
  document.getElementById('modal-exec-name').value = exec.name;
  document.getElementById('modal-exec-type').value = exec.type;
  document.getElementById('modal-exec-phone').value = exec.phone;
  document.getElementById('modal-exec-fleet').value = exec.fleet_no || '';
  document.getElementById('modal-exec-rates').value = exec.standard_rates || '';
  
  document.getElementById('executorModalTitle').textContent = 'Edit Data Eksekutor';
  openModal('modalEditExecutor');
}

async function submitExecutor(e) {
  e.preventDefault();
  
  const id = document.getElementById('modal-exec-id').value;
  const payload = {
    name: document.getElementById('modal-exec-name').value,
    type: document.getElementById('modal-exec-type').value,
    phone: document.getElementById('modal-exec-phone').value,
    fleet_no: document.getElementById('modal-exec-fleet').value,
    standard_rates: document.getElementById('modal-exec-rates').value
  };

  try {
    let res;
    if (id) {
      // Edit
      res = await fetch('/api/executors/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      // Add
      res = await fetch('/api/executors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    
    if (res.ok) {
      closeModal('modalEditExecutor');
      resetExecutorForm();
      await loadExecutors();
      renderExecutors();
    } else {
      const data = await res.json();
      alert(data.message || 'Gagal menyimpan data eksekutor');
    }
  } catch(err) {
    console.error('Error saving executor:', err);
  }
}

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
