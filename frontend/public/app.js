const DRAFT_KEY = 'req_draft_items';
function saveDraftToStorage() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state.itemsDraft)); } catch(_) {}
}
function loadDraftFromStorage() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch(_) { return null; }
}
function clearDraftStorage() {
  try { localStorage.removeItem(DRAFT_KEY); } catch(_) {}
}

const state = {
  token: null, // token lives in httpOnly cookie; not exposed to JS
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  itemsDraft: [],
  pendingRoute: null
};

const navItems = [
  ['dashboard', 'Dashboard'],
  ['requisiciones', 'Requisiciones'],
  ['seguimiento', 'Seguimiento'],
  ['autorizaciones', 'Autorizaciones'],
  ['compras', 'Compras'],
  ['catalogos', 'Catálogos'],
  ['cotizaciones', 'Cotizaciones'],
  ['facturacion', 'Facturación'],
  ['pagos', 'Pagos'],
  ['inventarios', 'Inventarios'],
  ['auditoria', 'Auditoría'],
  ['admin', 'Admin']
];

const MENU_BY_ROLE = {
  cliente_requisicion: ['dashboard', 'requisiciones', 'seguimiento'],
  comprador: ['dashboard', 'requisiciones', 'compras', 'catalogos', 'seguimiento', 'cotizaciones', 'facturacion', 'pagos', 'auditoria'],
  autorizador: ['dashboard', 'autorizaciones', 'seguimiento'],
  proveedor: ['cotizaciones', 'facturacion'],
  pagos: ['dashboard', 'pagos', 'seguimiento', 'facturacion', 'autorizaciones'],
  inventarios: ['dashboard', 'inventarios'],
  admin: ['dashboard', 'requisiciones', 'seguimiento', 'autorizaciones', 'compras', 'catalogos', 'cotizaciones', 'facturacion', 'pagos', 'inventarios', 'auditoria', 'admin']
};

const app = document.getElementById('app');

// Auto-logout por inactividad (15 minutos)
const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
let inactivityTimer = null;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (state.user) {
    inactivityTimer = setTimeout(() => {
      logout();
      alert('Sesión cerrada por inactividad. Por favor, inicia sesión de nuevo.');
    }, INACTIVITY_TIMEOUT);
  }
}

function initInactivityWatcher() {
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, resetInactivityTimer, { passive: true })
  );
  resetInactivityTimer();
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers, credentials: 'include' });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401) {
    logout();
    return;
  }
  if (!res.ok) {
    const err = new Error(data?.error || data || 'Error');
    err.responseData = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function setAuth(token, user) {
  // token is stored in httpOnly cookie (set by server); we only keep user data locally
  state.user = user;
  localStorage.setItem('user', JSON.stringify(user));
}

function logout() {
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  localStorage.removeItem('user');
  state.user = null;
  location.hash = '#/login';
  render();
}

function statusPill(status) {
  const map = {
    'Borrador': 'gray', 'Enviada': 'gray', 'Por solicitar': 'gray', 'Solicitada': 'blue', 'Cotizado': '', 'Rechazado por proveedor': 'red', 'En cotización': 'orange', 'En autorización': 'gray', 'Autorizado': '', 'En proceso': 'orange', 'Entregado': 'orange', 'Facturado': 'orange', 'Facturada': 'orange', 'Facturación parcial': 'orange', 'Pago parcial': 'orange', 'Pagada': '', 'Completada': '', 'Cerrado': '', 'Cancelada': 'red', 'Cancelado': 'red', 'Rechazada': 'red', 'Rechazado': 'red'
  };
  return `<span class="pill ${map[status] || 'gray'}">${status || '-'}</span>`;
}

function shell(content, active = 'dashboard') {
  const allowed = MENU_BY_ROLE[state.user?.role] || [];
  return `<div class="layout"><div class="sidebar-overlay" id="sidebarOverlay" onclick="document.querySelector('.sidebar').classList.remove('open');this.classList.remove('open')"></div><aside class="sidebar"><div class="brand">🛒 Compras</div><nav class="nav">${navItems.filter(([k]) => allowed.includes(k)).map(([k,l]) => `<a href="#/${k}" class="${active === k ? 'active' : ''}">${l}</a>`).join('')}<a href="#" id="logoutBtn">Cerrar sesión</a></nav><div style="margin-top:auto;padding-top:18px;border-top:1px solid rgba(255,255,255,.1);margin-top:18px"><a href="/" style="display:flex;align-items:center;gap:8px;color:#94a3b8;text-decoration:none;font-size:13px;padding:8px 12px;border-radius:10px;transition:background .15s" onmouseover="this.style.background='rgba(255,255,255,.08)'" onmouseout="this.style.background='transparent'">← Portal principal</a></div></aside><main class="main"><div class="topbar"><div style="display:flex;align-items:center;gap:10px"><button class="mob-menu-btn" onclick="document.querySelector('.sidebar').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('open')">☰</button><div><h2>${active[0].toUpperCase() + active.slice(1)}</h2><div class="muted small">${state.user?.name || ''} · ${state.user?.role || ''}</div></div></div><div style="display:flex;align-items:center;gap:12px"><span class="badge">Flujo operativo</span><button id="notifBellBtn" style="background:none;border:none;cursor:pointer;position:relative;padding:4px 8px;font-size:20px" title="Notificaciones">🔔<span id="notifBadge" style="display:none;position:absolute;top:0;right:0;background:#dc2626;color:white;border-radius:50%;font-size:10px;font-weight:700;width:16px;height:16px;line-height:16px;text-align:center"></span></button></div></div><div id="notifPanel" style="display:none;position:fixed;top:60px;right:16px;width:340px;max-height:500px;overflow-y:auto;background:white;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;padding:0"><div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center">Notificaciones<button id="notifCloseBtn" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:18px">×</button></div><div id="notifList" style="padding:8px 0"></div></div>${content}</main></div>`;
}

// ── Sistema de notificaciones ──────────────────────────────────────────────
let _notifInterval = null;
let _notifClickBound = false;
const priorityColor = { urgent: '#dc2626', high: '#d97706', medium: '#3b82f6', low: '#6b7280' };
const priorityBg = { urgent: '#fef2f2', high: '#fffbeb', medium: '#eff6ff', low: '#f9fafb' };

async function loadNotifications() {
  if (!state.user) return;
  try {
    const notes = await api('/api/notifications');
    const badge = document.getElementById('notifBadge');
    const list = document.getElementById('notifList');
    if (!badge || !list) return;
    const important = notes.filter(n => n.priority !== 'low');
    badge.textContent = important.length || notes.length;
    badge.style.display = notes.length ? 'block' : 'none';
    list.innerHTML = notes.length
      ? notes.map(n => `
          <a href="${n.route}" id="notifItem_${n.id}" style="display:block;padding:10px 16px;border-bottom:1px solid #f1f5f9;text-decoration:none;background:${priorityBg[n.priority]||'white'};cursor:pointer">
            <div style="display:flex;align-items:flex-start;gap:8px">
              <span style="font-size:18px">${n.icon}</span>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:600;color:${priorityColor[n.priority]||'#111'}">${n.title}</div>
                ${n.body ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;line-height:1.5">${n.body}</div>` : ''}
              </div>
            </div>
          </a>`).join('')
      : '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:13px">Sin notificaciones pendientes ✅</div>';
    list.querySelectorAll('a[id^="notifItem_"]').forEach(el => {
      el.onclick = () => { document.getElementById('notifPanel').style.display = 'none'; };
    });
  } catch(e) { /* silencioso */ }
}

function initNotifications() {
  if (_notifInterval) clearInterval(_notifInterval);
  loadNotifications();
  _notifInterval = setInterval(loadNotifications, 60000); // refrescar cada 60s

  if (!_notifClickBound) {
    _notifClickBound = true;
    document.addEventListener('click', e => {
      const panel = document.getElementById('notifPanel');
      const bell = document.getElementById('notifBellBtn');
      if (!panel || !bell) return;
      if (bell.contains(e.target)) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') loadNotifications();
      } else if (!panel.contains(e.target)) {
        panel.style.display = 'none';
      }
    });
  }
  document.getElementById('notifCloseBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
  });
}

function bindCommon() {
  const out = document.getElementById('logoutBtn');
  if (out) out.onclick = (e) => { e.preventDefault(); logout(); };
}

async function downloadCsv(entity, filename, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/exports/${entity}.csv${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { credentials: 'include' });
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'No se pudo exportar');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename || `${entity}.csv`;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

function roleCan(...roles) { return roles.includes(state.user?.role); }
function canAccess(module) { return (MENU_BY_ROLE[state.user?.role] || []).includes(module); }
function getDefaultRouteByRole() {
  return ({ cliente_requisicion: 'dashboard', comprador: 'dashboard', autorizador: 'dashboard', proveedor: 'cotizaciones', pagos: 'dashboard', admin: 'dashboard' })[state.user?.role] || 'seguimiento';
}
function escapeHtml(s='') { return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function suggestedDateRange(urgency) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (urgency === 'Alto') end.setDate(now.getDate() + 1);
  else if (urgency === 'Medio') end.setDate(now.getDate() + 7);
  else if (urgency === 'Bajo') end.setDate(now.getDate() + 15);
  else end.setMonth(now.getMonth() + 1);
  const f = d => d.toISOString().slice(0,10);
  return { min: f(start), max: f(end), label: `${f(start)} a ${f(end)}` };
}
function openPrintPreview(title, html) {
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<html><head><title>${title}</title><style>body{font-family:Arial;padding:24px} table{width:100%;border-collapse:collapse;margin-top:16px} th,td{border:1px solid #ccc;padding:8px;text-align:left} .small{font-size:12px;color:#555}</style></head><body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function defaultCostCenterForUser(cc, scc) {
  const dept = String(state.user?.department || '').toUpperCase();
  let center = cc.find(x => dept.includes('MANT') && /mantenimiento/i.test(x.name)) || cc.find(x => dept.includes('CAL') && /calidad/i.test(x.name)) || cc[0] || null;
  let sub = scc.find(x => x.cost_center_id === center?.id) || null;
  return { centerId: center?.id || '', subId: sub?.id || '' };
}

async function loginView() {
  app.innerHTML = `<div class="login-wrap"><div class="card login-card"><h1>Iniciar sesión</h1><label>Correo electrónico</label><input id="email" placeholder="tu@correo.com" /><label>Contraseña</label><input id="password" type="password" placeholder="Contraseña" /><button class="btn-primary" id="loginBtn" style="margin-top:16px;width:100%">Iniciar sesión</button><div id="err" class="error"></div><div style="text-align:center;margin-top:12px"><button type="button" id="forgotPwBtn" class="btn-secondary" style="font-size:12px;padding:4px 12px;background:none;border:none;color:#3b82f6;cursor:pointer;text-decoration:underline">¿Olvidé mi contraseña?</button></div><div id="forgotPanel" style="display:none;margin-top:12px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px"><p class="small muted" style="margin:0 0 8px">Escribe tu correo y se enviará una notificación al administrador para autorizar el cambio.</p><input id="resetEmail" placeholder="tu@correo.com" style="width:100%;margin-bottom:8px"/><button class="btn-primary" id="sendResetBtn" style="width:100%">Enviar solicitud</button><div id="resetMsg" class="small muted" style="margin-top:6px"></div></div></div></div>`;
  loginBtn.onclick = async () => {
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
      setAuth(data.token, data.user);
      if (data.user?.role === 'sin_rol') {
        logout();
        err.textContent = 'Tu cuenta no tiene acceso al módulo de Compras. Usa el módulo correspondiente a tu rol.';
        return;
      }
      initInactivityWatcher();
      const dest = state.pendingRoute;
      state.pendingRoute = null;
      location.hash = `#/${dest || getDefaultRouteByRole()}`;
      render().then(() => initNotifications());
    } catch (e) { err.textContent = e.message; }
  };
  document.getElementById('forgotPwBtn').onclick = () => {
    const p = document.getElementById('forgotPanel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('sendResetBtn').onclick = async () => {
    const msgEl = document.getElementById('resetMsg');
    const emailVal = document.getElementById('resetEmail').value.trim();
    if (!emailVal) { msgEl.textContent = 'Escribe tu correo.'; msgEl.style.color = '#dc2626'; return; }
    try {
      msgEl.textContent = 'Enviando...';
      msgEl.style.color = '#6b7280';
      const out = await api('/api/auth/request-reset', { method: 'POST', body: JSON.stringify({ email: emailVal }) });
      if (out.mailto) window.open(out.mailto, '_blank');
      msgEl.textContent = '✅ Solicitud enviada. El administrador recibirá una notificación y te enviará un enlace de recuperación.';
      msgEl.style.color = '#16a34a';
      document.getElementById('resetEmail').value = '';
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  };
}

async function resetPasswordView(token) {
  app.innerHTML = `<div class="login-wrap"><div class="card login-card"><h1>Nueva contraseña</h1><p class="small muted">Crea tu nueva contraseña de acceso al sistema.</p><label>Nueva contraseña</label><input id="newPw" type="password" placeholder="Mínimo 6 caracteres"/><label style="margin-top:8px">Confirmar contraseña</label><input id="newPw2" type="password" placeholder="Repite la contraseña"/><button class="btn-primary" id="savePwBtn" style="margin-top:16px;width:100%">Guardar nueva contraseña</button><div id="pwMsg" class="small muted" style="margin-top:8px"></div></div></div>`;
  document.getElementById('savePwBtn').onclick = async () => {
    const pw = document.getElementById('newPw').value;
    const pw2 = document.getElementById('newPw2').value;
    const msgEl = document.getElementById('pwMsg');
    if (!pw || pw.length < 6) { msgEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; msgEl.style.color = '#dc2626'; return; }
    if (pw !== pw2) { msgEl.textContent = 'Las contraseñas no coinciden.'; msgEl.style.color = '#dc2626'; return; }
    try {
      msgEl.textContent = 'Guardando...';
      msgEl.style.color = '#6b7280';
      const out = await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password: pw }) });
      msgEl.textContent = `✅ ${out.message}`;
      msgEl.style.color = '#16a34a';
      setTimeout(() => { location.hash = '#/login'; render(); }, 2000);
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  };
}

let _dashCharts = {};
function destroyDashCharts() {
  Object.values(_dashCharts).forEach(c => { try { c.destroy(); } catch(_) {} });
  _dashCharts = {};
}

const CHART_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6'];

function makeChart(id, type, labels, datasets, opts = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (_dashCharts[id]) { try { _dashCharts[id].destroy(); } catch(_) {} }
  _dashCharts[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: type !== 'pie' && type !== 'doughnut' ? {
        x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => '$' + Number(v).toLocaleString('es-MX', { maximumFractionDigits: 0 }) } }
      } : {},
      ...opts
    }
  });
}

async function dashboardView() {
  const [d, charts] = await Promise.all([
    api('/api/dashboard'),
    api('/api/dashboard/charts?period=month').catch(() => null)
  ]);

  const canCharts = roleCan('comprador', 'pagos', 'admin');

  app.innerHTML = shell(`
    <!-- KPIs -->
    <div class="grid grid-4">
      <div class="card kpi"><div class="muted">Requisiciones</div><div class="n">${d.totalReq}</div></div>
      <div class="card kpi"><div class="muted">Ítems</div><div class="n">${d.totalItems}</div></div>
      <div class="card kpi"><div class="muted">Pendientes</div><div class="n" style="color:#f59e0b">${d.pending}</div></div>
      <div class="card kpi"><div class="muted">Cerrados</div><div class="n" style="color:#10b981">${d.completed}</div></div>
    </div>

    ${canCharts && charts ? `
    <!-- Filtros de período -->
    <div class="card section" style="margin-top:16px;padding:12px 16px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b style="font-size:13px">Período:</b>
        <button class="btn-secondary period-btn active-period" data-period="week" style="padding:4px 12px;font-size:12px">Semanas</button>
        <button class="btn-secondary period-btn" data-period="month" style="padding:4px 12px;font-size:12px">Meses</button>
        <button class="btn-secondary period-btn" data-period="year" style="padding:4px 12px;font-size:12px">Años</button>
        <span class="muted small" style="margin-left:8px">Desde:</span>
        <input type="date" id="chartFrom" style="font-size:12px;padding:3px 6px"/>
        <span class="muted small">Hasta:</span>
        <input type="date" id="chartTo" style="font-size:12px;padding:3px 6px" value="${new Date().toISOString().slice(0,10)}"/>
        <button class="btn-primary" id="applyChartFilter" style="padding:4px 12px;font-size:12px">Aplicar</button>
      </div>
    </div>

    <!-- Gráfica: Gasto por centro de costo -->
    <div class="grid grid-2" style="margin-top:12px">
      <div class="card section">
        <h3 style="margin-bottom:8px">Gasto por centro de costo</h3>
        <div style="height:240px"><canvas id="chartCC"></canvas></div>
      </div>
      <div class="card section">
        <h3 style="margin-bottom:8px">Gasto por proveedor</h3>
        <div style="height:240px"><canvas id="chartSupplier"></canvas></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:12px">
      <div class="card section">
        <h3 style="margin-bottom:8px">Top 10 ítems por gasto</h3>
        <div style="height:240px"><canvas id="chartItems"></canvas></div>
      </div>
      <div class="card section">
        <h3 style="margin-bottom:8px">Órdenes de compra por período</h3>
        <div style="height:240px"><canvas id="chartOrders"></canvas></div>
      </div>
    </div>

    <!-- Eficiencia por proveedor -->
    <div class="card section" style="margin-top:12px">
      <h3 style="margin-bottom:8px">Eficiencia por proveedor</h3>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <div class="card kpi" style="flex:1;padding:8px"><div class="muted" style="font-size:11px">% Enviadas</div><div class="n" style="font-size:20px">${charts.tracking.pct_sent}%</div></div>
        <div class="card kpi" style="flex:1;padding:8px"><div class="muted" style="font-size:11px">% Autorizadas</div><div class="n" style="font-size:20px">${charts.tracking.pct_authorized}%</div></div>
        <div class="card kpi" style="flex:1;padding:8px"><div class="muted" style="font-size:11px">% En PO</div><div class="n" style="font-size:20px">${charts.tracking.pct_in_po}%</div></div>
        <div class="card kpi" style="flex:1;padding:8px"><div class="muted" style="font-size:11px">% Cerradas</div><div class="n" style="font-size:20px;color:#10b981">${charts.tracking.pct_closed}%</div></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Proveedor</th><th>Órdenes</th><th>% Entregado</th><th>% Cerrado</th><th>Tiempo prom. entrega</th></tr></thead>
        <tbody>${charts.supplier_efficiency.length
          ? charts.supplier_efficiency.map(e => `<tr>
            <td><b>${e.supplier}</b></td>
            <td>${e.total_orders}</td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;background:#e5e7eb;border-radius:4px;height:8px">
                  <div style="width:${e.pct_delivery}%;background:#3b82f6;border-radius:4px;height:8px"></div>
                </div>
                <span style="font-size:12px">${e.pct_delivery}%</span>
              </div>
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;background:#e5e7eb;border-radius:4px;height:8px">
                  <div style="width:${e.pct_closed}%;background:#10b981;border-radius:4px;height:8px"></div>
                </div>
                <span style="font-size:12px">${e.pct_closed}%</span>
              </div>
            </td>
            <td>${e.avg_delivery_days !== null ? `${e.avg_delivery_days} días` : '<span class="muted small">—</span>'}</td>
          </tr>`).join('')
          : '<tr><td colspan="5" class="muted" style="text-align:center;padding:12px">Sin datos de órdenes aún</td></tr>'}
        </tbody>
      </table></div>
    </div>` : ''}

    <!-- Últimas requisiciones -->
    <div class="card section" style="margin-top:12px">
      <div class="module-title"><h3>Últimas requisiciones</h3><button class="btn-secondary" id="expReqBtn">Exportar CSV</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Folio</th><th>Solicitante</th><th>Estatus</th><th>Fecha</th><th>Ítems</th></tr></thead>
        <tbody>${d.recent.map(r => `<tr>
          <td><a href="#/seguimiento/${r.id}">${r.folio}</a></td>
          <td>${r.requester}</td>
          <td>${statusPill(r.status)}</td>
          <td>${String(r.created_at || r.request_date || '').slice(0,10)}</td>
          <td>${r.items}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  `, 'dashboard');

  expReqBtn.onclick = () => downloadCsv('requisitions', 'requisiciones.csv');
  bindCommon();

  if (!canCharts || !charts) return;

  // Renderizar gráficas
  const renderCharts = (c) => {
    destroyDashCharts();
    const bks = c.buckets || [];

    // CC
    const ccNames = Object.keys(c.cost_centers);
    makeChart('chartCC', 'bar', bks,
      ccNames.map((name, i) => ({
        label: name, backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
        data: bks.map(b => c.cost_centers[name][b] || 0)
      }))
    );

    // Proveedores
    const supNames = Object.keys(c.suppliers).slice(0, 6);
    makeChart('chartSupplier', 'bar', bks,
      supNames.map((name, i) => ({
        label: name, backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
        data: bks.map(b => c.suppliers[name][b] || 0)
      }))
    );

    // Top ítems (doughnut)
    makeChart('chartItems', 'doughnut',
      c.top_items.map(x => x.name),
      [{ data: c.top_items.map(x => x.total), backgroundColor: CHART_COLORS }]
    );

    // Órdenes por período
    makeChart('chartOrders', 'line', bks,
      [{ label: 'Órdenes', data: bks.map(b => c.orders_per_period[b] || 0), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.3 }],
      { scales: { y: { beginAtZero: true, ticks: { callback: v => v } } } }
    );
  };

  renderCharts(charts);

  // Cambio de período
  let currentPeriod = 'month';
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.onclick = async () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active-period'));
      btn.classList.add('active-period');
      currentPeriod = btn.dataset.period;
      const from = document.getElementById('chartFrom')?.value || '';
      const to = document.getElementById('chartTo')?.value || '';
      const qs = `period=${currentPeriod}${from?'&from='+from:''}${to?'&to='+to:''}`;
      const fresh = await api(`/api/dashboard/charts?${qs}`).catch(() => null);
      if (fresh) renderCharts(fresh);
    };
  });

  document.getElementById('applyChartFilter')?.addEventListener('click', async () => {
    const from = document.getElementById('chartFrom')?.value || '';
    const to = document.getElementById('chartTo')?.value || '';
    const qs = `period=${currentPeriod}${from?'&from='+from:''}${to?'&to='+to:''}`;
    const fresh = await api(`/api/dashboard/charts?${qs}`).catch(() => null);
    if (fresh) renderCharts(fresh);
  });
}

async function catalogsView() {
  const [summary, items, suppliers, cc, scc, invCats, invItems, rules, units] = await Promise.all([
    api('/api/catalogs/summary'), api('/api/catalogs/items'), api('/api/catalogs/suppliers'),
    api('/api/catalogs/cost-centers'), api('/api/catalogs/sub-cost-centers'),
    api('/api/catalogs/inventory-catalogs'), api('/api/catalogs/inventory-items'),
    api('/api/catalogs/approval-rules'), api('/api/catalogs/units')
  ]);

  // Estado de filtro de proveedor para catálogo
  let filterSupplierId = '';
  let editingItemId = null;
  let itemsPageSize = 30;
  let suppliersPageSize = 30;
  let ccPageSize = 50;
  let sccPageSize = 50;

  const getFilteredItems = () => filterSupplierId
    ? items.filter(x => Number(x.supplier_id) === Number(filterSupplierId))
    : items;

  app.innerHTML = shell(`
    <div class="grid grid-4"><div class="card kpi"><div class="muted">Ítems</div><div class="n">${summary.items}</div></div><div class="card kpi"><div class="muted">Proveedores</div><div class="n">${summary.suppliers}</div></div><div class="card kpi"><div class="muted">Inventarios</div><div class="n">${summary.inventory_items}</div></div><div class="card kpi"><div class="muted">Reglas</div><div class="n">${summary.approval_rules}</div></div></div>

    <div class="grid grid-2" style="margin-top:16px">
      <!-- CATÁLOGO DE ÍTEMS -->
      <div class="card section">
        <div class="module-title"><h3>Catálogo de ítems</h3><button class="btn-secondary" id="expItemsBtn">Exportar</button></div>
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
          <select id="filterSupplierCat" style="flex:1;min-width:140px">
            <option value="">Todos los proveedores</option>
            ${suppliers.map(s => `<option value="${s.id}">${s.business_name}</option>`).join('')}
          </select>
          <input id="filterItemName" placeholder="Buscar nombre..." style="flex:1;min-width:100px"/>
        </div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-bottom:6px">
  <label class="small muted">Mostrar:</label>
  <select id="itemsPageSizeSel" style="padding:2px 6px;font-size:12px">
    <option value="20">20</option><option value="30" selected>30</option><option value="50">50</option><option value="100">100</option><option value="0">Todos</option>
  </select>
</div>
        <div class="table-wrap" id="itemsTableWrap"></div>
        <h4 style="margin-top:16px" id="itemFormTitle">Nuevo ítem</h4>
        <div class="row-3">
          <div><label>Nombre *</label><input id="itemName" placeholder="Ej. Aceite hidráulico"/></div>
          <div><label>Código (auto)</label><input id="itemCode" placeholder="Se genera automático"/></div>
          <div><label>Unidad</label><select id="itemUnit">${units.map(u => `<option>${u}</option>`).join('')}</select></div>
        </div>
        <div class="row-3">
          <div><label>Proveedor</label><select id="itemSupplier"><option value="">Sin proveedor</option>${suppliers.map(s => `<option value="${s.id}">${s.business_name}</option>`).join('')}</select></div>
          <div><label>Tipo</label><input id="itemType" value="uso continuo"/></div>
          <div><label>Precio</label><input id="itemPrice" type="number" placeholder="0.00"/></div>
        </div>
        <div class="row-3">
          <div><label>Moneda</label><select id="itemCurrency"><option>MXN</option><option>USD</option></select></div>
          <div style="padding-top:20px"><label><input id="itemInventoried" type="checkbox"/> Inventariable</label></div>
          <div style="padding-top:16px"><button class="btn-primary" id="saveItemBtn">Guardar ítem</button></div>
        </div>
        <div id="itemMsg" class="small muted" style="margin-top:6px"></div>
        <div id="itemCodeHint" class="small" style="color:#2563eb;margin-top:4px"></div>
      </div>

      <!-- PROVEEDORES -->
      <div class="card section">
        <div class="module-title"><h3>Proveedores</h3><button class="btn-secondary" id="expSupBtn">Exportar</button></div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-bottom:6px">
  <label class="small muted">Mostrar:</label>
  <select id="suppliersPageSizeSel" style="padding:2px 6px;font-size:12px">
    <option value="20">20</option><option value="30" selected>30</option><option value="50">50</option><option value="100">100</option><option value="0">Todos</option>
  </select>
</div>
        <div class="table-wrap" id="supTableWrap"><table><thead><tr><th>Código</th><th>Proveedor</th><th>Contacto</th><th>Correo</th><th></th></tr></thead>
        <tbody>${suppliers.map(s => `<tr><td>${s.provider_code}</td><td>${s.business_name}</td><td>${s.contact_name||'-'}</td><td>${s.email||'-'}</td><td><button class="btn-secondary edit-sup-row" data-id="${s.id}" style="padding:2px 7px;font-size:11px">✏</button></td></tr>`).join('')}</tbody>
        </table></div>
        <h4>Alta / edición de proveedor</h4>
        <div class="row-3">
          <div><label>Seleccionar existente</label><select id="supEditId"><option value="">Nuevo</option>${suppliers.map(s => `<option value="${s.id}">${s.business_name}</option>`).join('')}</select></div>
          <div><label>Nombre *</label><input id="supName" placeholder="Proveedor"/></div>
          <div><label>Código (auto)</label><input id="supCode" placeholder="Se genera automático"/></div>
        </div>
        <div class="row-3">
          <div><label>Contacto</label><input id="supContact" placeholder="Contacto"/></div>
          <div><label>Correo</label><input id="supEmail" placeholder="Correo"/></div>
          <div><label>Teléfono</label><input id="supPhone" placeholder="Teléfono"/></div>
        </div>
        <div id="supCodeHint" class="small" style="color:#2563eb;margin-top:4px"></div>
        <div class="row-3" style="margin-top:8px">
          <button class="btn-primary" id="saveSupBtn">Guardar proveedor</button>
          <button class="btn-secondary" id="toggleImportBtn">Importar CSV</button>
          <span id="supMsg" class="small muted"></span>
        </div>
        <div id="importWrap" style="display:none;margin-top:8px"><textarea id="supCsv" rows="5" placeholder="business_name,contact_name,email,phone"></textarea><button class="btn-primary" id="importSupBtn">Cargar CSV</button></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card section">
  <h3>Centros de costo</h3>
  <div class="table-wrap" id="ccTableWrap"></div>
  <h4 id="ccFormTitle">Nuevo centro de costo</h4>
  <div class="row-3">
    <div><label>Código *</label><input id="ccCode" placeholder="Ej. CC-PRD"/></div>
    <div><label>Nombre *</label><input id="ccName" placeholder="Nombre del centro"/></div>
    <button class="btn-primary" id="saveCcBtn" style="margin-top:20px">Guardar</button>
  </div>
  <input type="hidden" id="ccEditId" value=""/>
  <div id="ccMsg" class="small muted" style="margin-top:4px"></div>

  <hr style="margin:16px 0;border:none;border-top:2px solid #e5e7eb"/>
  <h3>Subcentros de costo</h3>
  <div class="table-wrap" id="sccTableWrap"></div>
  <h4 id="sccFormTitle">Nuevo subcentro</h4>
  <div class="row-3">
    <div><label>Centro padre *</label><select id="sccParent"><option value="">— Selecciona —</option>${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></div>
    <div><label>Código *</label><input id="sccCode" placeholder="Ej. SCC-MNT"/></div>
    <div><label>Nombre *</label><input id="sccName" placeholder="Nombre subcentro"/></div>
  </div>
  <input type="hidden" id="sccEditId" value=""/>
  <div style="margin-top:8px"><button class="btn-primary" id="saveSccBtn">Guardar subcentro</button></div>
  <div id="sccMsg" class="small muted" style="margin-top:4px"></div>
</div>
      <div class="card section">
  <h3>Reglas de autorización</h3>
  <p class="small muted">Las reglas definen qué rango de montos requiere autorización y quién debe autorizar.</p>
  <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Monto mín</th><th>Monto máx</th><th>Quién autoriza</th><th>Estado</th><th></th></tr></thead>
  <tbody>${rules.map(r => `<tr>
    <td><b>${r.name}</b></td>
    <td>$${Number(r.min_amount).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
    <td>$${Number(r.max_amount).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
    <td>${r.auto_approve ? '<span style="color:#16a34a">✅ Automática</span>' : `👤 ${r.approver_role||'-'}`}</td>
    <td>${r.active ? '<span style="color:#16a34a">Activa</span>' : '<span style="color:#9ca3af">Inactiva</span>'}</td>
    <td style="white-space:nowrap">
      <button class="btn-secondary edit-rule-btn" data-id="${r.id}" data-name="${r.name}" data-min="${r.min_amount}" data-max="${r.max_amount}" data-role="${r.approver_role||''}" data-auto="${r.auto_approve}" data-active="${r.active}" style="padding:2px 7px;font-size:11px">✏</button>
      <button class="btn-danger del-rule-btn" data-id="${r.id}" style="padding:2px 7px;font-size:11px">✖</button>
    </td>
  </tr>`).join('')}</tbody></table></div>

  <h4 id="ruleFormTitle" style="margin-top:14px">Nueva regla</h4>
  <div class="row-3">
    <div><label>Nombre *</label><input id="ruleName" placeholder="Nombre regla"/></div>
    <div><label>Monto mínimo MXN</label><input id="ruleMin" type="number" placeholder="0"/></div>
    <div><label>Monto máximo MXN</label><input id="ruleMax" type="number" placeholder="999999"/></div>
  </div>
  <div class="row-3" style="margin-top:8px">
    <div><label>Quién autoriza</label><select id="ruleRole"><option value="">Sin rol (automática)</option><option value="comprador">comprador</option><option value="autorizador">autorizador</option><option value="pagos">pagos</option><option value="admin">admin</option></select></div>
    <div style="padding-top:18px"><label><input id="ruleAuto" type="checkbox"/> Aprobación automática</label></div>
    <div style="padding-top:18px"><label><input id="ruleActive" type="checkbox" checked/> Activa</label></div>
  </div>
  <div style="margin-top:12px;padding:10px 14px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px">
    <label style="font-size:13px;font-weight:600;color:#b45309">🔒 Confirmar con tu contraseña para guardar</label>
    <input id="rulePassword" type="password" placeholder="Tu contraseña actual" style="display:block;margin-top:6px;width:100%;max-width:280px"/>
  </div>
  <input type="hidden" id="ruleEditId" value=""/>
  <div style="margin-top:10px;display:flex;gap:10px;align-items:center">
    <button class="btn-primary" id="saveRuleBtn">Guardar regla</button>
    <button class="btn-secondary" id="cancelRuleBtn" style="display:none">Cancelar edición</button>
    <span id="ruleMsg" class="small muted"></span>
  </div>
</div>
    </div>

    <!-- Subcentros por usuario -->
    <div class="card section" style="margin-top:16px">
      <div class="module-title">
        <h3>🗂 Subcentros de costo por usuario</h3>
        <span class="small muted">Asigna qué subcentros puede usar cada persona al crear requisiciones</span>
      </div>
      <p class="small muted" style="margin-bottom:10px">
        Si un usuario tiene subcentros asignados, solo verá esos en el formulario de requisición.
        Si no tiene ninguno asignado, verá todos los subcentros disponibles del centro de costo seleccionado.
      </p>
      <div id="sccAssignWrap"><div class="small muted">Cargando...</div></div>
    </div>
  `, 'catalogos');

  // Render tabla de ítems
  const renderItemsTable = () => {
    const nameFilter = (document.getElementById('filterItemName')?.value || '').toLowerCase();
    const filtered = getFilteredItems().filter(i => !nameFilter || i.name.toLowerCase().includes(nameFilter));
    const pageSel = document.getElementById('itemsPageSizeSel');
    if (pageSel) itemsPageSize = Number(pageSel.value);
    const shown = itemsPageSize > 0 ? filtered.slice(0, itemsPageSize) : filtered;
    const hiddenCount = filtered.length - shown.length;
    itemsTableWrap.innerHTML = `
    <div id="itemsBulkBar" style="display:none;padding:8px 12px;background:#dbeafe;border-radius:6px;margin-bottom:8px;align-items:center;gap:10px;flex-wrap:wrap">
      <span id="itemsSelCount" style="font-size:13px;font-weight:600;color:#1d4ed8">0 seleccionados</span>
      <button class="btn-danger" id="deleteSelectedItemsBtn" style="font-size:12px;padding:4px 10px">🗑 Eliminar seleccionados</button>
    </div>
    <table><thead><tr>
      <th style="width:32px"><input type="checkbox" id="selectAllItems" title="Seleccionar todos"/></th>
      <th>Código</th><th>Nombre</th><th>Unidad</th><th>Proveedor</th><th>Precio</th><th>Acciones</th>
    </tr></thead>
    <tbody>${shown.map(i => `<tr>
      <td><input type="checkbox" class="item-check" value="${i.id}"/></td>
      <td style="font-size:12px"><b>${i.code}</b></td>
      <td>${i.name}</td>
      <td>${i.unit}</td>
      <td style="font-size:12px">${i.supplier_name||'-'}</td>
      <td>$${Number(i.unit_price||0).toFixed(2)} ${i.currency||'MXN'}</td>
      <td style="white-space:nowrap">
        <button class="btn-secondary edit-item-btn" data-id="${i.id}" style="padding:2px 8px;font-size:12px">✏️</button>
        <button class="btn-danger delete-item-btn" data-id="${i.id}" style="padding:2px 8px;font-size:12px">🗑</button>
      </td>
    </tr>`).join('')}
    ${filtered.length === 0 ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:12px">Sin ítems</td></tr>' : ''}
    ${hiddenCount > 0 ? `<tr><td colspan="7" style="text-align:center;font-size:12px;color:#6b7280;padding:8px">... y ${hiddenCount} más. Cambia el límite de visualización arriba.</td></tr>` : ''}
    </tbody></table>`;

    itemsTableWrap.querySelectorAll('.edit-item-btn').forEach(btn => btn.onclick = () => {
      const item = items.find(x => x.id === Number(btn.dataset.id));
      if (!item) return;
      editingItemId = item.id;
      itemFormTitle.textContent = `Editando: ${item.name}`;
      itemName.value = item.name;
      itemCode.value = item.code;
      itemUnit.value = item.unit;
      itemSupplier.value = item.supplier_id || '';
      itemType.value = item.item_type || 'uso continuo';
      itemPrice.value = item.unit_price || 0;
      itemCurrency.value = item.currency || 'MXN';
      itemInventoried.checked = !!item.inventoried;
      itemMsg.textContent = '';
      saveItemBtn.textContent = 'Actualizar ítem';
      itemName.focus();
    });

    itemsTableWrap.querySelectorAll('.delete-item-btn').forEach(btn => btn.onclick = async () => {
      const item = items.find(x => x.id === Number(btn.dataset.id));
      if (!confirm(`¿Eliminar el ítem "${item?.name}"? Esta acción no se puede deshacer.`)) return;
      try {
        await api(`/api/catalogs/items/${btn.dataset.id}`, { method: 'DELETE' });
        render();
      } catch (e) { itemMsg.textContent = e.message; }
    });

    // ── Bulk select / delete ─────────────────────────────────────────────
    const updateItemsBulkBar = () => {
      const checked = itemsTableWrap.querySelectorAll('.item-check:checked');
      const bar = itemsTableWrap.querySelector('#itemsBulkBar');
      const cnt = itemsTableWrap.querySelector('#itemsSelCount');
      if (bar) bar.style.display = checked.length ? 'flex' : 'none';
      if (cnt) cnt.textContent = `${checked.length} seleccionado(s)`;
    };
    itemsTableWrap.querySelector('#selectAllItems')?.addEventListener('change', e => {
      itemsTableWrap.querySelectorAll('.item-check').forEach(c => c.checked = e.target.checked);
      updateItemsBulkBar();
    });
    itemsTableWrap.querySelectorAll('.item-check').forEach(c => c.addEventListener('change', updateItemsBulkBar));
    itemsTableWrap.querySelector('#deleteSelectedItemsBtn')?.addEventListener('click', async () => {
      const ids = [...itemsTableWrap.querySelectorAll('.item-check:checked')].map(c => c.value);
      if (!ids.length) return;
      if (!confirm(`¿Eliminar ${ids.length} ítem(s) seleccionado(s)? Esta acción no se puede deshacer.`)) return;
      try {
        await Promise.all(ids.map(id => api(`/api/catalogs/items/${id}`, { method: 'DELETE' })));
        render();
      } catch(e) { itemMsg.textContent = e.message; }
    });
  };
  renderItemsTable();

  filterSupplierCat.onchange = () => { filterSupplierId = filterSupplierCat.value; renderItemsTable(); };
  document.getElementById('filterItemName').oninput = renderItemsTable;
  document.getElementById('itemsPageSizeSel')?.addEventListener('change', renderItemsTable);

  // Pagination for suppliers table
  const renderSuppliersTable = () => {
    const pageSel = document.getElementById('suppliersPageSizeSel');
    if (pageSel) suppliersPageSize = Number(pageSel.value);
    const shown = suppliersPageSize > 0 ? suppliers.slice(0, suppliersPageSize) : suppliers;
    const hiddenCount = suppliers.length - shown.length;
    const supTableWrap = document.getElementById('supTableWrap');
    if (supTableWrap) supTableWrap.innerHTML = `
    <div id="supBulkBar" style="display:none;padding:8px 12px;background:#dbeafe;border-radius:6px;margin-bottom:8px;align-items:center;gap:10px;flex-wrap:wrap">
      <span id="supSelCount" style="font-size:13px;font-weight:600;color:#1d4ed8">0 seleccionados</span>
      <button class="btn-danger" id="deleteSelectedSupBtn" style="font-size:12px;padding:4px 10px">🗑 Eliminar seleccionados</button>
    </div>
    <table><thead><tr>
      <th style="width:32px"><input type="checkbox" id="selectAllSup" title="Seleccionar todos"/></th>
      <th>Código</th><th>Proveedor</th><th>Contacto</th><th>Correo</th><th></th>
    </tr></thead>
    <tbody>${shown.map(s => `<tr>
      <td><input type="checkbox" class="sup-check" value="${s.id}"/></td>
      <td>${s.provider_code}</td><td>${s.business_name}</td><td>${s.contact_name||'-'}</td><td>${s.email||'-'}</td>
      <td><button class="btn-secondary edit-sup-row" data-id="${s.id}" style="padding:2px 7px;font-size:11px">✏</button></td>
    </tr>`).join('')}
    ${hiddenCount > 0 ? `<tr><td colspan="6" style="text-align:center;font-size:12px;color:#6b7280;padding:8px">... y ${hiddenCount} más.</td></tr>` : ''}
    </tbody></table>`;
    supTableWrap?.querySelectorAll('.edit-sup-row').forEach(btn => {
      btn.onclick = () => {
        const s = suppliers.find(x => x.id === Number(btn.dataset.id));
        if (!s) return;
        supEditId.value = s.id;
        supName.value = s.business_name || '';
        supCode.value = s.provider_code || '';
        supContact.value = s.contact_name || '';
        supEmail.value = s.email || '';
        supPhone.value = s.phone || '';
      };
    });

    // ── Bulk select / delete ─────────────────────────────────────────────
    const updateSupBulkBar = () => {
      const checked = supTableWrap.querySelectorAll('.sup-check:checked');
      const bar = supTableWrap.querySelector('#supBulkBar');
      const cnt = supTableWrap.querySelector('#supSelCount');
      if (bar) bar.style.display = checked.length ? 'flex' : 'none';
      if (cnt) cnt.textContent = `${checked.length} seleccionado(s)`;
    };
    supTableWrap?.querySelector('#selectAllSup')?.addEventListener('change', e => {
      supTableWrap.querySelectorAll('.sup-check').forEach(c => c.checked = e.target.checked);
      updateSupBulkBar();
    });
    supTableWrap?.querySelectorAll('.sup-check').forEach(c => c.addEventListener('change', updateSupBulkBar));
    supTableWrap?.querySelector('#deleteSelectedSupBtn')?.addEventListener('click', async () => {
      const ids = [...supTableWrap.querySelectorAll('.sup-check:checked')].map(c => c.value);
      if (!ids.length) return;
      if (!confirm(`¿Eliminar ${ids.length} proveedor(es) seleccionado(s)? Esta acción no se puede deshacer.`)) return;
      try {
        await Promise.all(ids.map(id => api(`/api/catalogs/suppliers/${id}`, { method: 'DELETE' })));
        catalogsView();
      } catch(e) { alert(e.message); }
    });
  };
  renderSuppliersTable();
  document.getElementById('suppliersPageSizeSel')?.addEventListener('change', renderSuppliersTable);

  // Render CC table
  const renderCcTable = () => {
    const shown = cc; // small list, show all
    document.getElementById('ccTableWrap').innerHTML = `<table><thead><tr><th>Código</th><th>Nombre</th><th>Activo</th><th></th></tr></thead>
    <tbody>${shown.map(c => `<tr>
      <td><b>${c.code}</b></td><td>${c.name}</td>
      <td>${c.active !== false ? '✅' : '❌'}</td>
      <td style="white-space:nowrap">
        <button class="btn-secondary edit-cc-btn" data-id="${c.id}" data-code="${c.code}" data-name="${c.name}" style="padding:2px 7px;font-size:11px">✏</button>
        <button class="btn-danger del-cc-btn" data-id="${c.id}" style="padding:2px 7px;font-size:11px">✖</button>
      </td>
    </tr>`).join('')}
    ${!shown.length ? '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:8px">Sin centros de costo</td></tr>' : ''}
    </tbody></table>`;
    document.querySelectorAll('.edit-cc-btn').forEach(btn => {
      btn.onclick = () => {
        document.getElementById('ccEditId').value = btn.dataset.id;
        document.getElementById('ccCode').value = btn.dataset.code;
        document.getElementById('ccName').value = btn.dataset.name;
        document.getElementById('ccFormTitle').textContent = 'Editar centro de costo';
        document.getElementById('saveCcBtn').textContent = 'Actualizar';
      };
    });
    document.querySelectorAll('.del-cc-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('¿Eliminar este centro de costo?')) return;
        try { await api(`/api/catalogs/cost-centers/${btn.dataset.id}`, { method: 'DELETE' }); catalogsView(); } catch(e) { alert(e.message); }
      };
    });
  };
  renderCcTable();

  // Render SCC table
  const renderSccTable = () => {
    document.getElementById('sccTableWrap').innerHTML = `<table><thead><tr><th>Centro padre</th><th>Código</th><th>Nombre</th><th>Activo</th><th></th></tr></thead>
    <tbody>${scc.map(s => {
      const parentCc = cc.find(c => c.id === Number(s.cost_center_id));
      return `<tr>
        <td style="font-size:12px">${parentCc?.code||'-'} · ${parentCc?.name||'-'}</td>
        <td><b>${s.code}</b></td><td>${s.name}</td>
        <td>${s.active !== false ? '✅' : '❌'}</td>
        <td style="white-space:nowrap">
          <button class="btn-secondary edit-scc-btn" data-id="${s.id}" data-parent="${s.cost_center_id}" data-code="${s.code}" data-name="${s.name}" style="padding:2px 7px;font-size:11px">✏</button>
          <button class="btn-danger del-scc-btn" data-id="${s.id}" style="padding:2px 7px;font-size:11px">✖</button>
        </td>
      </tr>`;
    }).join('')}
    ${!scc.length ? '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:8px">Sin subcentros</td></tr>' : ''}
    </tbody></table>`;
    document.querySelectorAll('.edit-scc-btn').forEach(btn => {
      btn.onclick = () => {
        document.getElementById('sccEditId').value = btn.dataset.id;
        document.getElementById('sccParent').value = btn.dataset.parent;
        document.getElementById('sccCode').value = btn.dataset.code;
        document.getElementById('sccName').value = btn.dataset.name;
        document.getElementById('sccFormTitle').textContent = 'Editar subcentro';
        document.getElementById('saveSccBtn').textContent = 'Actualizar subcentro';
      };
    });
    document.querySelectorAll('.del-scc-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('¿Eliminar este subcentro?')) return;
        try { await api(`/api/catalogs/sub-cost-centers/${btn.dataset.id}`, { method: 'DELETE' }); catalogsView(); } catch(e) { alert(e.message); }
      };
    });
  };
  renderSccTable();

  // Auto-sugerir código al escribir nombre
  let codeTimer = null;
  itemName.oninput = () => {
    clearTimeout(codeTimer);
    if (editingItemId) return; // en edición no tocar código
    codeTimer = setTimeout(async () => {
      if (!itemName.value.trim()) { itemCode.value = ''; itemCodeHint.textContent = ''; return; }
      try {
        const r = await api(`/api/catalogs/items/suggest-code?name=${encodeURIComponent(itemName.value)}`);
        if (!itemCode.value || itemCode.value === itemCode.dataset.last_auto) {
          itemCode.value = r.suggested;
          itemCode.dataset.last_auto = r.suggested;
        }
        itemCodeHint.textContent = r.exists ? `⚠ El código ${r.suggested} ya existe` : `✓ Código sugerido: ${r.suggested}`;
        itemCodeHint.style.color = r.exists ? '#dc2626' : '#16a34a';
      } catch(e) {}
    }, 400);
  };

  saveItemBtn.onclick = async () => {
    try {
      if (!itemName.value.trim()) throw new Error('Nombre requerido');
      if (editingItemId) {
        await api(`/api/catalogs/items/${editingItemId}`, { method: 'PATCH', body: JSON.stringify({ name: itemName.value, code: itemCode.value, unit: itemUnit.value, supplier_id: itemSupplier.value || null, item_type: itemType.value, unit_price: Number(itemPrice.value||0), currency: itemCurrency.value, inventoried: itemInventoried.checked }) });
        itemMsg.textContent = '✅ Ítem actualizado'; itemMsg.style.color = '#16a34a';
      } else {
        try {
          await api('/api/catalogs/items', { method: 'POST', body: JSON.stringify({ name: itemName.value, code: itemCode.value, unit: itemUnit.value, supplier_id: itemSupplier.value || null, item_type: itemType.value, unit_price: Number(itemPrice.value||0), currency: itemCurrency.value, inventoried: itemInventoried.checked }) });
          itemMsg.textContent = '✅ Ítem guardado'; itemMsg.style.color = '#16a34a';
        } catch (e) {
          if (e.message.includes('nombre similar') || e.message.includes('409') || (e.message && e.message.includes('force_duplicate'))) {
            if (confirm(`${e.message}\n\n¿Registrar de todas formas?`)) {
              await api('/api/catalogs/items', { method: 'POST', body: JSON.stringify({ name: itemName.value, code: itemCode.value, unit: itemUnit.value, supplier_id: itemSupplier.value || null, item_type: itemType.value, unit_price: Number(itemPrice.value||0), currency: itemCurrency.value, inventoried: itemInventoried.checked, force_duplicate: true }) });
              itemMsg.textContent = '✅ Ítem guardado (duplicado confirmado)'; itemMsg.style.color = '#16a34a';
            } else { return; }
          } else { throw e; }
        }
      }
      // Limpiar form
      editingItemId = null;
      itemName.value = ''; itemCode.value = ''; itemPrice.value = '';
      itemCodeHint.textContent = ''; itemFormTitle.textContent = 'Nuevo ítem';
      saveItemBtn.textContent = 'Guardar ítem';
      setTimeout(render, 800);
    } catch (e) { itemMsg.textContent = e.message; itemMsg.style.color = '#dc2626'; }
  };

  expItemsBtn.onclick = () => downloadCsv('items', 'catalogo_items.csv');
  expSupBtn.onclick = () => downloadCsv('suppliers', 'proveedores.csv');

  // Auto-sugerir código de proveedor
  supName.oninput = async () => {
    if (supEditId.value) return; // editando existente
    if (!supName.value.trim()) { supCode.value = ''; supCodeHint.textContent = ''; return; }
    try {
      const r = await api(`/api/catalogs/suppliers/suggest-code?name=${encodeURIComponent(supName.value)}`);
      if (!supCode.value || supCode.value === supCode.dataset.last_auto) {
        supCode.value = r.suggested;
        supCode.dataset.last_auto = r.suggested;
      }
      supCodeHint.textContent = `✓ Código sugerido: ${r.suggested}`;
      supCodeHint.style.color = '#16a34a';
    } catch(e) {}
  };

  supEditId.onchange = () => {
    const s = suppliers.find(x => x.id === Number(supEditId.value));
    if (!s) { supName.value=''; supCode.value=''; supContact.value=''; supEmail.value=''; supPhone.value=''; supCodeHint.textContent=''; return; }
    supName.value=s.business_name; supCode.value=s.provider_code; supContact.value=s.contact_name||''; supEmail.value=s.email||''; supPhone.value=s.phone||''; supCodeHint.textContent='';
  };

  saveSupBtn.onclick = async () => {
    try {
      const payload = { business_name: supName.value, provider_code: supCode.value, contact_name: supContact.value, email: supEmail.value, phone: supPhone.value };
      if (supEditId.value) await api(`/api/catalogs/suppliers/${supEditId.value}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/catalogs/suppliers', { method: 'POST', body: JSON.stringify(payload) });
      supMsg.textContent = '✅ Guardado'; supMsg.style.color = '#16a34a';
      supEditId.value = ''; supName.value = ''; supCode.value = ''; supContact.value = ''; supEmail.value = ''; supPhone.value = ''; supCodeHint.textContent = '';
      setTimeout(render, 800);
    } catch (e) { supMsg.textContent = e.message; supMsg.style.color = '#dc2626'; }
  };

  toggleImportBtn.onclick = () => importWrap.style.display = importWrap.style.display === 'none' ? 'block' : 'none';
  importSupBtn.onclick = async () => { try { const out = await api('/api/catalogs/suppliers/import', { method: 'POST', body: JSON.stringify({ csv: supCsv.value }) }); supMsg.textContent = `Importados: ${out.inserted}`; render(); } catch (e) { supMsg.textContent = e.message; } };
  document.getElementById('saveCcBtn').onclick = async () => {
    try {
      const payload = { code: document.getElementById('ccCode').value, name: document.getElementById('ccName').value };
      const editId = document.getElementById('ccEditId').value;
      if (editId) await api(`/api/catalogs/cost-centers/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/catalogs/cost-centers', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('ccMsg').textContent = '✅ Guardado';
      document.getElementById('ccMsg').style.color = '#16a34a';
      document.getElementById('ccEditId').value = '';
      document.getElementById('ccCode').value = '';
      document.getElementById('ccName').value = '';
      document.getElementById('ccFormTitle').textContent = 'Nuevo centro de costo';
      document.getElementById('saveCcBtn').textContent = 'Guardar';
      setTimeout(catalogsView, 700);
    } catch (e) { document.getElementById('ccMsg').textContent = e.message; document.getElementById('ccMsg').style.color = '#dc2626'; }
  };
  document.getElementById('saveSccBtn').onclick = async () => {
    try {
      const editId = document.getElementById('sccEditId').value;
      const payload = {
        cost_center_id: Number(document.getElementById('sccParent').value),
        code: document.getElementById('sccCode').value,
        name: document.getElementById('sccName').value
      };
      if (!payload.cost_center_id || !payload.code || !payload.name) throw new Error('Centro, código y nombre son requeridos');
      if (editId) await api(`/api/catalogs/sub-cost-centers/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/catalogs/sub-cost-centers', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('sccMsg').textContent = '✅ Guardado';
      document.getElementById('sccMsg').style.color = '#16a34a';
      document.getElementById('sccEditId').value = '';
      document.getElementById('sccCode').value = '';
      document.getElementById('sccName').value = '';
      document.getElementById('sccFormTitle').textContent = 'Nuevo subcentro';
      document.getElementById('saveSccBtn').textContent = 'Guardar subcentro';
      setTimeout(catalogsView, 700);
    } catch (e) { document.getElementById('sccMsg').textContent = e.message; document.getElementById('sccMsg').style.color = '#dc2626'; }
  };
  document.getElementById('saveRuleBtn').onclick = async () => {
    const msgEl = document.getElementById('ruleMsg');
    const pw = document.getElementById('rulePassword')?.value || '';
    if (!pw) { msgEl.textContent = 'Debes ingresar tu contraseña para guardar cambios en las reglas.'; msgEl.style.color = '#dc2626'; return; }
    try {
      msgEl.textContent = 'Verificando...'; msgEl.style.color = '#6b7280';
      await api('/api/auth/verify-password', { method: 'POST', body: JSON.stringify({ password: pw }) });
      const payload = {
        name: document.getElementById('ruleName').value,
        min_amount: Number(document.getElementById('ruleMin').value || 0),
        max_amount: Number(document.getElementById('ruleMax').value || 0),
        approver_role: document.getElementById('ruleRole').value || null,
        auto_approve: document.getElementById('ruleAuto').checked,
        active: document.getElementById('ruleActive').checked
      };
      const editId = document.getElementById('ruleEditId').value;
      if (editId) await api(`/api/catalogs/approval-rules/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/catalogs/approval-rules', { method: 'POST', body: JSON.stringify(payload) });
      msgEl.textContent = '✅ Regla guardada'; msgEl.style.color = '#16a34a';
      document.getElementById('rulePassword').value = '';
      document.getElementById('ruleEditId').value = '';
      document.getElementById('ruleName').value = '';
      document.getElementById('ruleMin').value = '';
      document.getElementById('ruleMax').value = '';
      document.getElementById('ruleFormTitle').textContent = 'Nueva regla';
      document.getElementById('saveRuleBtn').textContent = 'Guardar regla';
      document.getElementById('cancelRuleBtn').style.display = 'none';
      setTimeout(catalogsView, 700);
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  };
  document.getElementById('cancelRuleBtn')?.addEventListener('click', () => {
    document.getElementById('ruleEditId').value = '';
    document.getElementById('ruleName').value = '';
    document.getElementById('ruleMin').value = '';
    document.getElementById('ruleMax').value = '';
    document.getElementById('rulePassword').value = '';
    document.getElementById('ruleFormTitle').textContent = 'Nueva regla';
    document.getElementById('saveRuleBtn').textContent = 'Guardar regla';
    document.getElementById('cancelRuleBtn').style.display = 'none';
    document.getElementById('ruleMsg').textContent = '';
  });
  // Editar/eliminar reglas
  document.querySelectorAll('.edit-rule-btn').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('ruleEditId').value = btn.dataset.id;
      document.getElementById('ruleName').value = btn.dataset.name;
      document.getElementById('ruleMin').value = btn.dataset.min;
      document.getElementById('ruleMax').value = btn.dataset.max;
      document.getElementById('ruleRole').value = btn.dataset.role;
      document.getElementById('ruleAuto').checked = btn.dataset.auto === 'true';
      document.getElementById('ruleActive').checked = btn.dataset.active !== 'false';
      document.getElementById('ruleFormTitle').textContent = 'Editar regla';
      document.getElementById('saveRuleBtn').textContent = 'Actualizar regla';
      document.getElementById('cancelRuleBtn').style.display = 'inline-block';
      document.getElementById('rulePassword').focus();
    };
  });
  document.querySelectorAll('.del-rule-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('¿Eliminar esta regla de autorización?')) return;
      try { await api(`/api/catalogs/approval-rules/${btn.dataset.id}`, { method: 'DELETE' }); catalogsView(); } catch(e) { alert(e.message); }
    };
  });
  bindCommon();

  // ── Herramienta de asignación de subcentros por usuario ───────────────────
  const loadSccAssignments = async () => {
    const wrap = document.getElementById('sccAssignWrap');
    if (!wrap) return;
    try {
      const assignUsers = await api('/api/catalogs/user-scc-assignments');
      const roleLabel = { cliente_requisicion: 'Cliente', comprador: 'Comprador', autorizador: 'Autorizador', pagos: 'Pagos', admin: 'Admin' };

      wrap.innerHTML = `
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Depto.</th>
                <th>Subcentros asignados</th>
                <th>Predeterminado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${assignUsers.map(u => {
                const assignedScc = scc.filter(s => (u.allowed_scc_ids || []).includes(s.id));
                const assignedNames = assignedScc.map(s => `<span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 6px;font-size:11px;margin-right:3px">${s.code}</span>`).join('') || '<span class="small muted">Todos (sin restricción)</span>';
                const defScc = scc.find(s => s.id === u.default_sub_cost_center_id);
                return `<tr>
                  <td><b>${u.full_name}</b><div class="small muted">${u.email}</div></td>
                  <td style="font-size:12px">${roleLabel[u.role_code]||u.role_code}</td>
                  <td style="font-size:12px">${u.department||'-'}</td>
                  <td>${assignedNames}</td>
                  <td style="font-size:12px">${defScc ? `${defScc.code} · ${defScc.name}` : '-'}</td>
                  <td><button class="btn-secondary assign-scc-btn" data-id="${u.id}" data-name="${u.full_name}" style="padding:3px 10px;font-size:12px">✏ Asignar</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div id="sccAssignForm" style="display:none;margin-top:16px;padding:14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">
          <h4 id="sccAssignFormTitle" style="margin:0 0 10px">Asignar subcentros</h4>
          <input type="hidden" id="sccAssignUserId"/>
          <div class="row-2" style="align-items:flex-start;gap:16px">
            <div style="flex:1">
              <label class="small muted" style="display:block;margin-bottom:4px">Subcentros permitidos <span class="small muted">(vacío = todos)</span></label>
              <select id="sccAssignCcFilter" style="width:100%;margin-bottom:6px;font-size:13px">
                <option value="">— Filtrar por centro de costo —</option>
                ${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}
              </select>
              <div id="sccCheckboxList" style="max-height:200px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;padding:8px;background:white">
                ${scc.map(s => {
                  const parentCc = cc.find(c => c.id === Number(s.cost_center_id));
                  return `<label class="scc-assign-row" data-cc="${s.cost_center_id}" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;cursor:pointer">
                    <input type="checkbox" class="scc-allow-chk" value="${s.id}"/>
                    <span style="font-weight:600;color:#1d4ed8">${s.code}</span>
                    <span>${s.name}</span>
                    <span class="small muted">(${parentCc?.code||'?'})</span>
                  </label>`;
                }).join('')}
              </div>
            </div>
            <div style="flex:1">
              <label class="small muted" style="display:block;margin-bottom:6px">Subcentro predeterminado</label>
              <select id="sccDefaultSel" style="width:100%">
                <option value="">Sin predeterminado</option>
                ${scc.map(s => {
                  const parentCc = cc.find(c => c.id === Number(s.cost_center_id));
                  return `<option value="${s.id}">${s.code} · ${s.name} (${parentCc?.code||'?'})</option>`;
                }).join('')}
              </select>
              <p class="small muted" style="margin-top:6px">Se pre-selecciona automáticamente al crear una requisición.</p>
            </div>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
            <button class="btn-primary" id="saveSccAssignBtn">💾 Guardar asignación</button>
            <button class="btn-secondary" id="cancelSccAssignBtn">Cancelar</button>
            <span id="sccAssignMsg" class="small muted"></span>
          </div>
        </div>`;

      wrap.querySelectorAll('.assign-scc-btn').forEach(btn => {
        btn.onclick = () => {
          const userId = Number(btn.dataset.id);
          const u = assignUsers.find(x => x.id === userId);
          if (!u) return;
          document.getElementById('sccAssignUserId').value = userId;
          document.getElementById('sccAssignFormTitle').textContent = `Asignar subcentros a: ${u.full_name}`;
          document.getElementById('sccAssignMsg').textContent = '';
          // Marcar checkboxes
          document.querySelectorAll('.scc-allow-chk').forEach(chk => {
            chk.checked = (u.allowed_scc_ids || []).includes(Number(chk.value));
          });
          // Predeterminado
          document.getElementById('sccDefaultSel').value = u.default_sub_cost_center_id || '';
          document.getElementById('sccAssignForm').style.display = 'block';
          document.getElementById('sccAssignForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
      });

      document.getElementById('saveSccAssignBtn').onclick = async () => {
        const msgEl = document.getElementById('sccAssignMsg');
        const userId = document.getElementById('sccAssignUserId').value;
        const allowed = [...document.querySelectorAll('.scc-allow-chk:checked')].map(c => Number(c.value));
        const defScc = document.getElementById('sccDefaultSel').value;
        try {
          msgEl.textContent = 'Guardando...'; msgEl.style.color = '#6b7280';
          await api(`/api/catalogs/user-scc-assignments/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ allowed_scc_ids: allowed, default_sub_cost_center_id: defScc ? Number(defScc) : null })
          });
          msgEl.textContent = '✅ Asignación guardada'; msgEl.style.color = '#16a34a';
          document.getElementById('sccAssignForm').style.display = 'none';
          setTimeout(loadSccAssignments, 600);
        } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
      };

      document.getElementById('cancelSccAssignBtn').onclick = () => {
        document.getElementById('sccAssignForm').style.display = 'none';
      };

      document.getElementById('sccAssignCcFilter')?.addEventListener('change', function() {
        const ccId = this.value;
        document.querySelectorAll('.scc-assign-row').forEach(row => {
          row.style.display = (!ccId || row.dataset.cc === ccId) ? 'flex' : 'none';
        });
        const defSel = document.getElementById('sccDefaultSel');
        if (defSel) {
          [...defSel.options].forEach(opt => {
            if (!opt.value) return;
            const s = scc.find(x => x.id === Number(opt.value));
            opt.style.display = (!ccId || String(s?.cost_center_id) === ccId) ? '' : 'none';
          });
          if (defSel.selectedOptions[0]?.style.display === 'none') defSel.value = '';
        }
      });
    } catch(e) {
      document.getElementById('sccAssignWrap').innerHTML = `<div class="small muted">No disponible: ${e.message}</div>`;
    }
  };
  loadSccAssignments();
}
async function requisitionsView(editId = null) {
  const [items, suppliers, cc, scc, list, units] = await Promise.all([api('/api/catalogs/items'), api('/api/catalogs/suppliers'), api('/api/catalogs/cost-centers'), api('/api/catalogs/sub-cost-centers'), api('/api/requisitions'), api('/api/catalogs/units')]);
  let editing = null;
  if (editId) editing = await api(`/api/requisitions/${editId}`);
  if (editing) {
    state.itemsDraft = editing.items.map(x => ({ ...x, id: crypto.randomUUID() }));
  } else if (!state.itemsDraft.length) {
    // Restaurar borrador guardado si existe
    const saved = loadDraftFromStorage();
    state.itemsDraft = (saved && saved.length) ? saved : [];
  }
  const renderList = rows => rows.map(r => `<tr><td>${r.folio}</td><td>${statusPill(r.status)}</td><td>${Number(r.total_amount || 0).toFixed(2)} ${r.currency || ''}</td><td><a href="#/requisiciones/${r.id}">Validar</a></td></tr>`).join('');
  app.innerHTML = shell(`
    <div class="grid grid-2">
      <div class="card section"><h3>${editing ? 'Editar requisición' : 'Nueva requisición'}</h3><div class="row-3"><div><label>Urgencia</label><select id="urgency"><option ${editing?.requisition.urgency==='Alto'?'selected':''}>Alto</option><option ${editing?.requisition.urgency==='Medio'?'selected':''}>Medio</option><option ${editing?.requisition.urgency==='Bajo'?'selected':''}>Bajo</option><option ${editing?.requisition.urgency==='Entrega programada'?'selected':''}>Entrega programada</option></select><div id="urgencyRange" class="small muted"></div></div><div><label>Centro de costo</label><select id="costCenter"><option value="">Selecciona</option>${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></div><div><label>Subcentro</label><select id="subCostCenter"></select></div></div><div class="row-3"><div><label>Moneda</label><input id="currency" value="${editing?.requisition.currency || 'MXN'}" readonly/></div><div><label>Fecha programada</label><input id="programmedDate" type="date" value="${editing?.requisition.programmed_date || ''}"/></div><div><label>Comentarios</label><input id="comments" placeholder="Observaciones" value="${editing?.requisition.comments || ''}"/></div></div><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:12px"><h4 id="itemEntryTitle" style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">+ Nuevo ítem</h4><div class="row-3"><div><label style="font-size:12px">Ítem catálogo</label><select id="entry-catalog"><option value="">Manual / no catalogado</option>${items.map(i=>`<option value="${i.id}">${i.code} · ${i.name}</option>`).join('')}</select></div><div><label style="font-size:12px">Nombre manual</label><input id="entry-manual-name" placeholder="Descripción del ítem" list="entry-manual-list" autocomplete="off"/><datalist id="entry-manual-list">${items.map(i=>`<option value="${i.name}" data-id="${i.id}">`).join('')}</datalist></div><div><label style="font-size:12px">Proveedor</label><select id="entry-supplier"><option value="">Sin proveedor</option>${suppliers.map(s=>`<option value="${s.id}">${s.business_name}</option>`).join('')}</select></div></div><div class="row-4" style="margin-top:8px"><div><label style="font-size:12px">Cantidad</label><input id="entry-quantity" type="number" value="1" min="0.01"/></div><div><label style="font-size:12px">Unidad</label><select id="entry-unit">${units.map(u=>`<option>${u}</option>`).join('')}</select></div><div><label style="font-size:12px">Costo unit.</label><input id="entry-cost" type="number" value="0" min="0"/></div><div><label style="font-size:12px">Moneda</label><input id="entry-currency-item" value="MXN" readonly/></div></div><div class="row-3" style="margin-top:8px"><div><label style="font-size:12px">Centro de costo</label><select id="entry-item-cc"><option value="">Del encabezado</option>${cc.map(c=>`<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></div><div><label style="font-size:12px">Subcentro <span style="color:#dc2626">*</span></label><select id="entry-item-scc"><option value="">— Obligatorio —</option></select><input id="entry-item-scc-other" placeholder="Nombre/motivo del subcentro propuesto" style="display:none;margin-top:4px;width:100%;font-size:12px"/></div><div></div></div><div class="row-2" style="margin-top:8px"><input id="entry-weblink" placeholder="Liga web (opcional)"/><input id="entry-item-comments" placeholder="Comentarios del ítem"/></div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn-primary" id="addItemBtn">+ Agregar a lista</button><button class="btn-secondary" id="cancelEditItemBtn" style="display:none">✕ Cancelar edición</button></div></div><div id="itemsDraft" style="margin-top:12px"></div><div class="actions"><button class="btn-secondary" id="previewReqBtn">Vista PDF</button><button class="btn-secondary" id="saveDraftBtn">Guardar borrador</button><button class="btn-primary" id="sendReqBtn">Guardar y enviar</button></div><div id="reqMsg" class="error"></div></div>
      <div class="card section"><div class="module-title"><h3>Requisiciones</h3><button class="btn-secondary" id="expReqListBtn">Exportar</button></div><div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><input id="reqSearchFolio" placeholder="Buscar folio..." style="flex:1;min-width:100px"/><select id="reqFilterStatus" style="flex:1;min-width:110px"><option value="">Todos los estatus</option><option>Borrador</option><option>Enviada</option><option>En cotización</option><option>En autorización</option><option>Autorizado</option><option>En proceso</option><option>Completada</option><option>Rechazada</option></select></div><div class="table-wrap" id="reqListWrap"><table><thead><tr><th>Folio</th><th>Estatus</th><th>Total</th><th>Detalle</th></tr></thead><tbody>${renderList(list)}</tbody></table></div></div>
    </div>
  `, 'requisiciones');
  const setSubOptions = (centerId, selectedId='') => { const opts = scc.filter(x => Number(x.cost_center_id) === Number(centerId)); subCostCenter.innerHTML = `<option value="">Selecciona</option>${opts.map(x => `<option value="${x.id}" ${Number(selectedId)===x.id?'selected':''}>${x.code} · ${x.name}</option>`).join('')}`; };
  const userCenter = state.user?.default_cost_center_id || editing?.requisition.cost_center_id || '';
  costCenter.value = editing?.requisition.cost_center_id || userCenter || '';
  setSubOptions(costCenter.value, editing?.requisition.sub_cost_center_id || state.user?.default_sub_cost_center_id || '');
  costCenter.onchange = () => setSubOptions(costCenter.value);
  const updateUrgency = () => { const r = suggestedDateRange(urgency.value); urgencyRange.textContent = `Rango sugerido: ${r.label}`; programmedDate.min = r.min; programmedDate.max = r.max; if (!programmedDate.value) programmedDate.value = r.max; };
  urgency.onchange = updateUrgency; updateUrgency();
  const filterReqList = () => {
    const folio = (document.getElementById('reqSearchFolio')?.value || '').toLowerCase();
    const status = document.getElementById('reqFilterStatus')?.value || '';
    const filtered = list.filter(r =>
      (!folio || String(r.folio||'').toLowerCase().includes(folio)) &&
      (!status || r.status === status)
    );
    const wrap = document.getElementById('reqListWrap');
    if (wrap) wrap.innerHTML = `<table><thead><tr><th>Folio</th><th>Estatus</th><th>Total</th><th>Detalle</th></tr></thead><tbody>${renderList(filtered)}</tbody></table>`;
  };
  document.getElementById('reqSearchFolio')?.addEventListener('input', filterReqList);
  document.getElementById('reqFilterStatus')?.addEventListener('change', filterReqList);
  let currentEditItemId = null;
  const clearEntryPanel = () => {
    document.getElementById('entry-catalog').value = '';
    document.getElementById('entry-manual-name').value = '';
    document.getElementById('entry-supplier').value = '';
    document.getElementById('entry-quantity').value = '1';
    document.getElementById('entry-unit').value = units[0] || 'pza';
    document.getElementById('entry-cost').value = '0';
    document.getElementById('entry-weblink').value = '';
    document.getElementById('entry-item-comments').value = '';
    document.getElementById('entry-item-cc').value = '';
    document.getElementById('entry-item-scc').innerHTML = '<option value="">— Obligatorio —</option>';
    document.getElementById('entry-item-scc-other').value = '';
    document.getElementById('entry-item-scc-other').style.display = 'none';
    itemEntryTitle.textContent = '+ Nuevo ítem';
    addItemBtn.textContent = '+ Agregar a lista';
    cancelEditItemBtn.style.display = 'none';
    currentEditItemId = null;
  };
  document.getElementById('entry-catalog').onchange = () => {
    const catId = Number(document.getElementById('entry-catalog').value);
    const cat = items.find(i => i.id === catId);
    if (cat) {
      if (cat.supplier_id) document.getElementById('entry-supplier').value = cat.supplier_id;
      if (cat.unit) document.getElementById('entry-unit').value = cat.unit;
      document.getElementById('entry-cost').value = Number(cat.unit_price || 0);
      document.getElementById('entry-currency-item').value = cat.currency || currency.value || 'MXN';
      if (cat.cost_center_id) { costCenter.value = cat.cost_center_id; setSubOptions(cat.cost_center_id, cat.sub_cost_center_id || ''); if (cat.sub_cost_center_id) subCostCenter.value = cat.sub_cost_center_id; }
    }
  };
  document.getElementById('entry-supplier').onchange = () => {
    const suppId = Number(document.getElementById('entry-supplier').value);
    const catSel = document.getElementById('entry-catalog');
    if (suppId) {
      const filtered = items.filter(i => i.supplier_id === suppId);
      catSel.innerHTML = `<option value="">Manual / no catalogado</option>${filtered.map(i=>`<option value="${i.id}">${i.code} · ${i.name}</option>`).join('')}`;
    } else {
      catSel.innerHTML = `<option value="">Manual / no catalogado</option>${items.map(i=>`<option value="${i.id}">${i.code} · ${i.name}</option>`).join('')}`;
    }
    catSel.value = '';
  };
  document.getElementById('entry-manual-name').oninput = () => {
    const val = document.getElementById('entry-manual-name').value.trim();
    const cat = items.find(i => i.name.toLowerCase() === val.toLowerCase());
    if (cat) {
      document.getElementById('entry-catalog').value = cat.id;
      if (cat.supplier_id) document.getElementById('entry-supplier').value = cat.supplier_id;
      if (cat.unit) document.getElementById('entry-unit').value = cat.unit;
      document.getElementById('entry-cost').value = Number(cat.unit_price || 0);
      document.getElementById('entry-currency-item').value = cat.currency || currency.value || 'MXN';
      if (cat.cost_center_id) { costCenter.value = cat.cost_center_id; setSubOptions(cat.cost_center_id, cat.sub_cost_center_id || ''); if (cat.sub_cost_center_id) subCostCenter.value = cat.sub_cost_center_id; }
    }
  };
  document.getElementById('entry-item-cc').onchange = () => {
    const ccId = document.getElementById('entry-item-cc').value;
    const allowedIds = state.user?.allowed_scc_ids || [];
    let opts = scc.filter(x => Number(x.cost_center_id) === Number(ccId));
    // Si el usuario tiene subcentros asignados, filtrar solo los suyos
    if (allowedIds.length > 0) opts = opts.filter(x => allowedIds.includes(x.id));
    document.getElementById('entry-item-scc').innerHTML = `<option value="">— Obligatorio —</option>${opts.map(x=>`<option value="${x.id}">${x.code} · ${x.name}</option>`).join('')}<option value="__otro__">+ Otro (proponer nuevo)</option>`;
    document.getElementById('entry-item-scc-other').style.display = 'none';
    // Pre-seleccionar el subcentro predeterminado del usuario si aplica
    const defScc = state.user?.default_sub_cost_center_id;
    if (defScc && opts.find(x => x.id === defScc)) {
      document.getElementById('entry-item-scc').value = defScc;
    }
  };
  document.getElementById('entry-item-scc').onchange = () => {
    const isOtro = document.getElementById('entry-item-scc').value === '__otro__';
    document.getElementById('entry-item-scc-other').style.display = isOtro ? 'block' : 'none';
  };
  const renderDraft = () => {
    state.itemsDraft = state.itemsDraft.map(x => ({ ...x, id: x.id || crypto.randomUUID() }));
    // Persistir borrador en localStorage para sobrevivir recargas de página
    if (!editing) saveDraftToStorage();
    const total = state.itemsDraft.reduce((s, x) => s + (Number(x.quantity||0) * Number(x.unit_cost||0)), 0);
    itemsDraft.innerHTML = state.itemsDraft.length === 0
      ? '<p class="small muted" style="padding:12px 0;text-align:center;color:#9ca3af">Sin ítems. Completa el formulario de arriba y haz clic en "+ Agregar a lista".</p>'
      : `<div class="table-wrap"><table><thead><tr><th>Ítem</th><th>Proveedor</th><th>Cant.</th><th>Unidad</th><th>Costo</th><th>Total</th><th></th></tr></thead><tbody>${state.itemsDraft.map(row => {
          const itemName = (items.find(i => i.id === Number(row.catalog_item_id)) || {}).name || row.manual_item_name || '-';
          const supplierName = (suppliers.find(s => s.id === Number(row.supplier_id)) || {}).business_name || '-';
          const lineTotal = Number(row.quantity||0) * Number(row.unit_cost||0);
          const sccLabel = row.sub_cost_center_proposed ? `<span style="font-size:10px;color:#b45309;background:#fffbeb;padding:1px 5px;border-radius:3px">⚠ SCC propuesto: ${escapeHtml(row.sub_cost_center_proposed)}</span>` : '';
          return `<tr style="${currentEditItemId === row.id ? 'background:#eff6ff' : ''}"><td style="font-size:12px"><b>${escapeHtml(itemName)}</b>${row.web_link ? `<br><a href="${escapeHtml(row.web_link)}" target="_blank" style="font-size:10px;color:#3b82f6">🔗 Liga</a>` : ''}${sccLabel ? '<br>'+sccLabel : ''}</td><td style="font-size:12px">${escapeHtml(supplierName)}</td><td style="font-size:12px;text-align:right">${row.quantity}</td><td style="font-size:12px">${escapeHtml(row.unit||'-')}</td><td style="font-size:12px;text-align:right">$${Number(row.unit_cost||0).toFixed(2)}</td><td style="font-size:12px;text-align:right;font-weight:600">$${lineTotal.toFixed(2)}</td><td style="white-space:nowrap"><button class="btn-secondary edit-draft-item" data-id="${row.id}" style="padding:2px 7px;font-size:11px">✏</button> <button class="btn-danger remove-draft-item" data-id="${row.id}" style="padding:2px 7px;font-size:11px">✖</button></td></tr>`;
        }).join('')}</tbody><tfoot><tr><td colspan="5" style="text-align:right;font-size:12px;font-weight:600;padding:6px 4px">Total estimado:</td><td style="font-size:13px;font-weight:700;color:#1d4ed8;padding:6px 4px">$${total.toFixed(2)}</td><td></td></tr></tfoot></table></div>`;
    itemsDraft.querySelectorAll('.edit-draft-item').forEach(btn => {
      btn.onclick = () => {
        const row = state.itemsDraft.find(x => x.id === btn.dataset.id);
        if (!row) return;
        currentEditItemId = row.id;
        document.getElementById('entry-catalog').value = row.catalog_item_id || '';
        document.getElementById('entry-manual-name').value = row.manual_item_name || '';
        document.getElementById('entry-supplier').value = row.supplier_id || '';
        document.getElementById('entry-quantity').value = row.quantity || 1;
        document.getElementById('entry-unit').value = row.unit || units[0] || 'pza';
        document.getElementById('entry-cost').value = row.unit_cost || 0;
        document.getElementById('entry-currency-item').value = row.currency || currency.value || 'MXN';
        document.getElementById('entry-weblink').value = row.web_link || '';
        document.getElementById('entry-item-comments').value = row.comments || '';
        document.getElementById('entry-item-cc').value = row.cost_center_id || '';
        document.getElementById('entry-item-cc').dispatchEvent(new Event('change'));
        setTimeout(() => {
          if (row.sub_cost_center_proposed) {
            document.getElementById('entry-item-scc').value = '__otro__';
            document.getElementById('entry-item-scc-other').value = row.sub_cost_center_proposed;
            document.getElementById('entry-item-scc-other').style.display = 'block';
          } else {
            document.getElementById('entry-item-scc').value = row.sub_cost_center_id || '';
          }
        }, 50);
        itemEntryTitle.textContent = '✏ Editando ítem';
        addItemBtn.textContent = '✔ Actualizar ítem';
        cancelEditItemBtn.style.display = '';
        renderDraft();
        itemEntryTitle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
    });
    itemsDraft.querySelectorAll('.remove-draft-item').forEach(btn => {
      btn.onclick = () => { const rid = btn.dataset.id; if (currentEditItemId === rid) clearEntryPanel(); state.itemsDraft = state.itemsDraft.filter(x => String(x.id) !== String(rid)); renderDraft(); };
    });
  };
  renderDraft();
  addItemBtn.onclick = () => {
    const catalogId = document.getElementById('entry-catalog').value;
    const manualName = document.getElementById('entry-manual-name').value.trim();
    const supplierId = document.getElementById('entry-supplier').value;
    const qty = Number(document.getElementById('entry-quantity').value || 0);
    const unit = document.getElementById('entry-unit').value;
    const unitCost = Number(document.getElementById('entry-cost').value || 0);
    const entryCur = document.getElementById('entry-currency-item').value || currency.value || 'MXN';
    const webLink = document.getElementById('entry-weblink').value.trim();
    const itemComments = document.getElementById('entry-item-comments').value.trim();
    const itemCcId = Number(document.getElementById('entry-item-cc').value || 0) || null;
    const itemSccId = Number(document.getElementById('entry-item-scc').value || 0) || null;
    if (!catalogId && !manualName) { reqMsg.textContent = 'Selecciona un ítem del catálogo o escribe un nombre.'; return; }
    if (qty <= 0) { reqMsg.textContent = 'La cantidad debe ser mayor a cero.'; return; }
    const sccVal = document.getElementById('entry-item-scc').value;
    const sccOtherVal = document.getElementById('entry-item-scc-other').value.trim();
    if (!sccVal) { reqMsg.textContent = 'El subcentro de costo es obligatorio por ítem.'; document.getElementById('entry-item-scc').focus(); return; }
    if (sccVal === '__otro__' && !sccOtherVal) { reqMsg.textContent = 'Escribe el nombre o motivo del subcentro propuesto.'; document.getElementById('entry-item-scc-other').focus(); return; }
    reqMsg.textContent = '';
    const subCcProposed = sccVal === '__otro__' ? sccOtherVal : null;
    const resolvedSccId = sccVal !== '__otro__' ? (Number(sccVal) || null) : null;
    const itemData = { catalog_item_id: catalogId ? Number(catalogId) : null, manual_item_name: manualName || null, supplier_id: supplierId ? Number(supplierId) : null, quantity: qty, unit, unit_cost: unitCost, currency: entryCur, web_link: webLink || null, comments: itemComments || null, cost_center_id: itemCcId || Number(costCenter.value||0)||null, sub_cost_center_id: resolvedSccId, sub_cost_center_proposed: subCcProposed };
    if (currentEditItemId) { const idx = state.itemsDraft.findIndex(x => x.id === currentEditItemId); if (idx >= 0) state.itemsDraft[idx] = { ...state.itemsDraft[idx], ...itemData }; } else { state.itemsDraft.push({ id: crypto.randomUUID(), ...itemData }); }
    clearEntryPanel(); renderDraft();
  };
  cancelEditItemBtn.onclick = () => { clearEntryPanel(); renderDraft(); };
  const validateManuals = () => { const hasManualNoCC = state.itemsDraft.some(x => !x.catalog_item_id && !(Number(costCenter.value||0) || Number(x.cost_center_id||0))); if (hasManualNoCC) { reqMsg.textContent = 'Los ítems manuales requieren centro de costo.'; costCenter.focus(); return false; } return true; };
  const buildPayload = (status) => ({ urgency: urgency.value, cost_center_id: Number(costCenter.value || 0) || null, sub_cost_center_id: Number(subCostCenter.value || 0) || null, currency: currency.value, programmed_date: programmedDate.value || null, comments: comments.value, status, items: state.itemsDraft.map(({ id, ...rest }) => ({ ...rest, cost_center_id: rest.cost_center_id || Number(costCenter.value||0) || null, sub_cost_center_id: rest.sub_cost_center_id || Number(subCostCenter.value||0) || null, currency: rest.currency || currency.value })) });
  previewReqBtn.onclick = () => openPrintPreview('Vista requisición', `<h1>${editing?.requisition.folio || 'Vista previa de requisición'}</h1><div class="small">Solicitante: ${escapeHtml(state.user?.name || '')}<br>Departamento: ${escapeHtml(state.user?.department || '')}<br>Urgencia: ${escapeHtml(urgency.value)}<br>Fecha programada: ${escapeHtml(programmedDate.value || '-')}</div><table><thead><tr><th>Ítem</th><th>Proveedor</th><th>Cantidad</th><th>Unidad</th><th>Costo</th><th>Moneda</th></tr></thead><tbody>${state.itemsDraft.map(x => `<tr><td>${escapeHtml((items.find(i => i.id === Number(x.catalog_item_id)) || {}).name || x.manual_item_name || '')}</td><td>${escapeHtml((suppliers.find(s => s.id === Number(x.supplier_id)) || {}).business_name || '-')}</td><td>${x.quantity}</td><td>${escapeHtml(x.unit || '')}</td><td>${Number(x.unit_cost||0).toFixed(2)}</td><td>${escapeHtml(x.currency || currency.value || 'MXN')}</td></tr>`).join('')}</tbody></table>`);
  saveDraftBtn.onclick = async () => { try { if (!validateManuals()) return; if (editing) await api(`/api/requisitions/${editing.requisition.id}`, { method:'PATCH', body: JSON.stringify(buildPayload('Borrador'))}); else { const out = await api('/api/requisitions', { method:'POST', body: JSON.stringify(buildPayload('Borrador'))}); state.itemsDraft = []; clearDraftStorage(); location.hash = `#/requisiciones/${out.requisition.id}`; return; } state.itemsDraft = []; clearDraftStorage(); render(); } catch (e) { reqMsg.textContent = e.message; } };
  sendReqBtn.onclick = async () => { try { if (!validateManuals()) return; let id = editing?.requisition.id; if (editing) await api(`/api/requisitions/${id}`, { method:'PATCH', body: JSON.stringify(buildPayload('Borrador'))}); else { const out = await api('/api/requisitions', { method:'POST', body: JSON.stringify(buildPayload('Borrador'))}); id = out.requisition.id; }
      const out = await api(`/api/requisitions/${id}/send`, { method:'POST', body: JSON.stringify({}) });
      if (out.mailto_buyer) window.open(out.mailto_buyer, '_blank');
      if (out.mailto_requester) setTimeout(() => window.open(out.mailto_requester, '_blank'), 600);
      if (out.mailto_authorizer) setTimeout(() => window.open(out.mailto_authorizer, '_blank'), 1200);
      state.itemsDraft = []; clearDraftStorage();
      location.hash = `#/requisiciones/${id}`;
    } catch (e) { reqMsg.textContent = e.message; } };
  expReqListBtn.onclick = () => downloadCsv('requisitions', 'requisiciones.csv');
  bindCommon();
}

async function requisitionPreviewView(id) {
  const d = await api(`/api/requisitions/${id}`);
  const reqCurrency = d.requisition.currency || 'MXN';
  const totalReq = d.items.reduce((sum, i) => sum + (Number(i.quantity || 0) * Number(i.unit_cost || 0)), 0);
  app.innerHTML = shell(`<div class="card section"><div class="module-title"><h3>${d.requisition.folio}</h3><div><a href="#/requisiciones">Volver</a></div></div><div class="grid grid-4"><div class="small muted">Fecha solicitud<br><b>${String(d.requisition.request_date||'').slice(0,10)}</b></div><div class="small muted">Urgencia<br><b>${d.requisition.urgency || '-'}</b></div><div class="small muted">Estatus<br>${statusPill(d.requisition.status)}</div><div class="small muted">Total requisición<br><b>${Number(totalReq).toFixed(2)} ${reqCurrency}</b></div></div><div class="actions" style="margin-top:16px">${d.can_edit ? `<button class="btn-secondary" id="editReqBtn">Editar</button><button class="btn-danger" id="delReqBtn">Borrar</button><button class="btn-primary" id="sendReqBtn">Enviar</button>` : ''}<button class="btn-secondary" id="pdfReqBtn">Ver PDF</button></div></div><div class="card section" style="margin-top:16px"><h3>Ítems</h3><div class="table-wrap"><table><thead><tr><th>Línea</th><th>Ítem</th><th>Proveedor</th><th>Cantidad</th><th>Unidad</th><th>Precio unitario</th><th>Precio total</th><th>Estatus</th></tr></thead><tbody>${d.items.map(i => { const lineTotal = Number(i.quantity || 0) * Number(i.unit_cost || 0); return `<tr><td>${i.line_no}</td><td>${i.catalog_name || i.manual_item_name}</td><td>${i.supplier_name || '-'}</td><td>${Number(i.quantity || 0)}</td><td>${i.unit || '-'}</td><td>${Number(i.unit_cost || 0).toFixed(2)} ${i.currency || reqCurrency}</td><td>${Number(lineTotal).toFixed(2)} ${i.currency || reqCurrency}</td><td>${statusPill(i.status)}</td></tr>`; }).join('')}</tbody></table></div></div>`, 'requisiciones');
  if (d.can_edit) {
    editReqBtn.onclick = () => location.hash = `#/requisiciones/editar/${id}`;
    delReqBtn.onclick = async () => { if (!confirm('¿Eliminar requisición?')) return; await api(`/api/requisitions/${id}`, { method:'DELETE' }); location.hash = '#/requisiciones'; };
    sendReqBtn.onclick = async () => { const email_to = prompt('Correo destino', d.requisition.email_to || 'compras@demo.com') || 'compras@demo.com'; const out = await api(`/api/requisitions/${id}/send`, { method:'POST', body: JSON.stringify({ email_to })}); if (out.mailto_buyer) window.open(out.mailto_buyer,'_blank'); if (out.mailto_requester) setTimeout(() => window.open(out.mailto_requester, '_blank'), 600); render(); };
  }
  pdfReqBtn.onclick = () => openPrintPreview(`Requisición ${d.requisition.folio}`, `<h1>${d.requisition.folio}</h1><div class="small">Fecha: ${String(d.requisition.request_date||'').slice(0,10)}<br>Solicitante: ${escapeHtml(state.user?.name || '')}<br>Total: ${Number(totalReq).toFixed(2)} ${reqCurrency}</div><table><thead><tr><th>Línea</th><th>Ítem</th><th>Proveedor</th><th>Cantidad</th><th>Unidad</th><th>Precio unitario</th><th>Precio total</th></tr></thead><tbody>${d.items.map(i => { const lineTotal = Number(i.quantity || 0) * Number(i.unit_cost || 0); return `<tr><td>${i.line_no}</td><td>${escapeHtml(i.catalog_name || i.manual_item_name)}</td><td>${escapeHtml(i.supplier_name || '-')}</td><td>${Number(i.quantity||0)}</td><td>${escapeHtml(i.unit || '-')}</td><td>${Number(i.unit_cost||0).toFixed(2)} ${escapeHtml(i.currency || reqCurrency)}</td><td>${Number(lineTotal).toFixed(2)} ${escapeHtml(i.currency || reqCurrency)}</td></tr>`; }).join('')}</tbody></table>`);
  bindCommon();
}

async function trackingListView() {
  const [data, allPos] = await Promise.all([
    api('/api/requisitions'),
    api('/api/purchases/purchase-orders').catch(() => [])
  ]);

  let trackMode = 'req'; // 'req' | 'po' | 'item'

  const getFilters = () => ({
    folio: (document.getElementById('fFolio')?.value || '').toLowerCase(),
    status: document.getElementById('fStatus')?.value || '',
    dateFrom: document.getElementById('fIni')?.value || '',
    dateTo: document.getElementById('fFin')?.value || ''
  });

  const statusOptionsReq = ['Borrador','Enviada','En cotización','En autorización','En proceso','Completada','Rechazada'];
  const statusOptionsPos = ['Abierta','Enviada','Recibida','Facturación parcial','Facturada','Pago parcial','Cerrada','Cancelada'];
  const statusOptionsItem = ['Pendiente','En cotización','Autorizado','En proceso','Facturado','Pago parcial','Cerrado','Rechazado','Cancelado'];

  const renderView = () => {
    const { folio, status, dateFrom, dateTo } = getFilters();

    if (trackMode === 'req') {
      const filtered = data.filter(r =>
        (!folio || String(r.folio||'').toLowerCase().includes(folio)) &&
        (!status || r.status === status) &&
        (!dateFrom || String(r.request_date||'').slice(0,10) >= dateFrom) &&
        (!dateTo || String(r.request_date||'').slice(0,10) <= dateTo)
      );
      document.getElementById('trackTableWrap').innerHTML = `
        <table><thead><tr><th>Folio</th><th>Fecha</th><th>Solicitante</th><th>PO</th><th>Estatus</th><th>Total</th><th></th></tr></thead>
        <tbody>${filtered.map(r => `<tr>
          <td><b>${r.folio}</b></td>
          <td style="font-size:12px">${String(r.request_date||'').slice(0,10)}</td>
          <td style="font-size:12px">${r.requester||'-'}</td>
          <td style="font-size:12px">${r.po_folio||'-'}</td>
          <td>${statusPill(r.status)}</td>
          <td style="font-size:12px">${Number(r.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${r.currency||''}</td>
          <td><a href="#/seguimiento/${r.id}">Abrir</a></td>
        </tr>`).join('')}</tbody></table>`;

    } else if (trackMode === 'po') {
      const filtered = allPos.filter(p =>
        (!folio || String(p.folio||'').toLowerCase().includes(folio)) &&
        (!status || p.status === status) &&
        (!dateFrom || String(p.created_at||'').slice(0,10) >= dateFrom) &&
        (!dateTo || String(p.created_at||'').slice(0,10) <= dateTo)
      );
      document.getElementById('trackTableWrap').innerHTML = `
        <table><thead><tr><th>PO Folio</th><th>Fecha</th><th>Proveedor</th><th>Ítems</th><th>Total</th><th>Estatus</th><th>Anticipo</th></tr></thead>
        <tbody>${filtered.length ? filtered.map(p => `<tr>
          <td><b>${p.folio}</b></td>
          <td style="font-size:12px">${String(p.created_at||'').slice(0,10)}</td>
          <td style="font-size:12px">${p.supplier_name||'-'}</td>
          <td style="text-align:center">${p.items||0}</td>
          <td style="font-size:12px">$${Number(p.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${p.currency||'MXN'}</td>
          <td>${statusPill(p.status)}</td>
          <td style="font-size:12px">${p.advance_percentage ? `${p.advance_percentage}% · ${p.advance_status||'-'}` : '-'}</td>
        </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:#9ca3af">Sin órdenes de compra</td></tr>'}</tbody></table>`;

    } else { // item
      const allItems = allPos.flatMap(p =>
        (p.po_items||[]).map(it => ({
          ...it,
          po_folio: p.folio,
          supplier_name: p.supplier_name,
          po_created_at: p.created_at
        }))
      );
      const filtered = allItems.filter(it =>
        (!folio || String(it.po_folio||'').toLowerCase().includes(folio) || String(it.item_name||it.name||'').toLowerCase().includes(folio)) &&
        (!status || it.status === status) &&
        (!dateFrom || String(it.po_created_at||'').slice(0,10) >= dateFrom) &&
        (!dateTo || String(it.po_created_at||'').slice(0,10) <= dateTo)
      );
      document.getElementById('trackTableWrap').innerHTML = `
        <table><thead><tr><th>PO</th><th>Ítem</th><th>Cant.</th><th>Costo unit.</th><th>Subtotal</th><th>Proveedor</th><th>Estatus</th></tr></thead>
        <tbody>${filtered.length ? filtered.map(it => `<tr>
          <td style="font-size:12px"><b>${it.po_folio}</b></td>
          <td style="font-size:12px">${it.item_name||it.name||it.manual_item_name||'-'}</td>
          <td style="text-align:center;font-size:12px">${it.quantity||0} ${it.unit||''}</td>
          <td style="font-size:12px">$${Number(it.unit_cost||0).toFixed(2)}</td>
          <td style="font-size:12px">$${(Number(it.quantity||0)*Number(it.unit_cost||0)).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
          <td style="font-size:12px">${it.supplier_name||'-'}</td>
          <td>${statusPill(it.status)}</td>
        </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:#9ca3af">Sin ítems en órdenes de compra</td></tr>'}</tbody></table>`;
    }
  };

  const updateStatusOptions = () => {
    const sel = document.getElementById('fStatus');
    if (!sel) return;
    const opts = trackMode === 'req' ? statusOptionsReq : trackMode === 'po' ? statusOptionsPos : statusOptionsItem;
    sel.innerHTML = `<option value="">Todos</option>` + opts.map(o => `<option>${o}</option>`).join('');
  };

  const setMode = mode => {
    trackMode = mode;
    document.getElementById('fStatus').value = '';
    updateStatusOptions();
    ['btnModeReq','btnModePo','btnModeItem'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.className = 'btn-secondary';
    });
    const activeId = mode === 'req' ? 'btnModeReq' : mode === 'po' ? 'btnModePo' : 'btnModeItem';
    const activeEl = document.getElementById(activeId);
    if (activeEl) activeEl.className = 'btn-primary';
    renderView();
  };

  app.innerHTML = shell(`
    <div class="card section">
      <div class="module-title"><h3>Seguimiento</h3><button class="btn-secondary" id="expReqItemsBtn">Exportar</button></div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button id="btnModeReq" class="btn-primary" style="font-size:13px">📋 Por Requisición</button>
        <button id="btnModePo" class="btn-secondary" style="font-size:13px">🧾 Por PO</button>
        <button id="btnModeItem" class="btn-secondary" style="font-size:13px">📦 Por Ítem</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end">
        <div><label class="small muted">Buscar</label><input id="fFolio" placeholder="Folio / ítem..." style="display:block"/></div>
        <div><label class="small muted">Estatus</label><select id="fStatus" style="display:block"><option value="">Todos</option></select></div>
        <div><label class="small muted">Desde</label><input id="fIni" type="date" style="display:block"/></div>
        <div><label class="small muted">Hasta</label><input id="fFin" type="date" style="display:block"/></div>
        <button class="btn-secondary" id="clearFiltersBtn" style="align-self:flex-end">Limpiar</button>
      </div>
      <div class="table-wrap" id="trackTableWrap"></div>
    </div>
  `, 'seguimiento');

  updateStatusOptions();
  renderView();

  document.getElementById('btnModeReq').onclick = () => setMode('req');
  document.getElementById('btnModePo').onclick = () => setMode('po');
  document.getElementById('btnModeItem').onclick = () => setMode('item');

  document.getElementById('fFolio').oninput = renderView;
  document.getElementById('fStatus').onchange = renderView;
  document.getElementById('fIni').onchange = renderView;
  document.getElementById('fFin').onchange = renderView;
  document.getElementById('clearFiltersBtn').onclick = () => {
    document.getElementById('fFolio').value = '';
    document.getElementById('fStatus').value = '';
    document.getElementById('fIni').value = '';
    document.getElementById('fFin').value = '';
    renderView();
  };
  document.getElementById('expReqItemsBtn').onclick = () => downloadCsv('seguimiento', 'seguimiento.csv', {
    fecha_inicio: document.getElementById('fIni')?.value || '',
    fecha_fin: document.getElementById('fFin')?.value || ''
  });
  bindCommon();
}

async function trackingDetailView(id) {
  const [d, allPos, allInvoices, allPayments, allQuotations] = await Promise.all([
    api(`/api/requisitions/${id}`),
    api('/api/purchases/purchase-orders').catch(() => []),
    api('/api/invoices').catch(() => []),
    api('/api/payments').catch(() => []),
    api('/api/quotations').catch(() => [])
  ]);

  const poFolios = [...new Set(d.items.map(i => i.po_folio).filter(Boolean))];
  const linkedPOs = allPos.filter(p => poFolios.includes(p.folio));
  const linkedPOIds = new Set(linkedPOs.map(p => p.id));
  const linkedInvoices = allInvoices.filter(i => linkedPOIds.has(i.purchase_order_id));
  const linkedInvIds = new Set(linkedInvoices.map(i => i.id));
  const linkedPayments = allPayments.filter(p => linkedInvIds.has(p.invoice_id));

  const historyColors = { requisitions: '#3b82f6', quotations: '#f59e0b', purchases: '#10b981', approvals: '#8b5cf6', payments: '#ef4444', catalogs: '#06b6d4' };

  app.innerHTML = shell(`
    <!-- Cabecera -->
    <div class="card section">
      <div class="module-title"><h3>${d.requisition.folio}</h3><a href="#/seguimiento" class="btn-secondary" style="text-decoration:none;padding:6px 12px;font-size:13px">← Volver</a></div>
      <div class="grid grid-4">
        <div class="small muted">Fecha solicitud<br><b>${String(d.requisition.request_date||'').slice(0,10)}</b></div>
        <div class="small muted">Urgencia<br><b>${d.requisition.urgency||'-'}</b></div>
        <div class="small muted">POs<br><b>${poFolios.join(', ')||'-'}</b></div>
        <div class="small muted">Estatus<br>${statusPill(d.requisition.status)}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button id="viewByItemBtn" class="btn-primary" style="font-size:12px;padding:5px 14px">📦 Vista por ítem</button>
        <button id="viewByPoBtn" class="btn-secondary" style="font-size:12px;padding:5px 14px">🧾 Vista por PO</button>
        ${state.user?.role === 'cliente_requisicion' && !['Cancelada','Cerrada'].includes(d.requisition.status) && !d.items.some(i => i.po_folio)
          ? `<button id="cancelReqByRequesterBtn" class="btn-danger" style="font-size:12px;padding:5px 14px">✖ Cancelar requisición</button>`
          : ''}
      </div>
      <div id="cancelReqMsg" class="small muted" style="margin-top:6px"></div>
    </div>

    <!-- Cadena Req → PO → Factura → Pago -->
    <div class="card section" style="margin-top:12px">
      <h3>🔗 Cadena de documentos</h3>
      <div style="overflow-x:auto">
        <div style="display:flex;gap:0;align-items:flex-start;min-width:600px;padding:8px 0">

          <!-- Requisición -->
          <div style="flex:1;min-width:120px">
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;font-size:12px">
              <div style="color:#1d4ed8;font-weight:700;margin-bottom:4px">📋 Requisición</div>
              <div><b>${d.requisition.folio}</b></div>
              <div class="muted">${String(d.requisition.request_date||'').slice(0,10)}</div>
              <div style="margin-top:4px">${statusPill(d.requisition.status)}</div>
              <div class="muted" style="margin-top:4px">Total: $${Number(d.requisition.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
            </div>
          </div>

          <div style="display:flex;align-items:center;padding:0 6px;margin-top:20px;color:#9ca3af;font-size:18px">→</div>

          <!-- Cotizaciones -->
          <div style="flex:1;min-width:130px;display:flex;flex-direction:column;gap:6px">
            ${(() => {
              const itemIds = new Set(d.items.map(i => i.id));
              const winnerQuotes = allQuotations.filter(q => q.is_winner && itemIds.has(q.requisition_item_id));
              if (!winnerQuotes.length) {
                const anyQuotes = allQuotations.filter(q => itemIds.has(q.requisition_item_id));
                if (!anyQuotes.length) return '<div style="background:#f3f4f6;border:1px dashed #d1d5db;border-radius:8px;padding:10px;font-size:12px;color:#9ca3af;text-align:center">Sin cotizaciones</div>';
                return `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:12px"><div style="color:#b45309;font-weight:700;margin-bottom:4px">📩 Cotizaciones</div><div class="muted">${anyQuotes.length} recibida(s)</div><div class="muted">Sin ganadora aún</div></div>`;
              }
              return winnerQuotes.map(q => `
                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:12px">
                  <div style="color:#b45309;font-weight:700;margin-bottom:4px">📩 Cotización</div>
                  <div><b>${q.supplier_name||'-'}</b></div>
                  <div class="muted">$${Number(q.unit_cost||0).toFixed(2)} ${q.currency||'MXN'}</div>
                  <div class="muted">Entrega: ${q.delivery_days||0} días</div>
                  ${q.quote_number ? `<div class="muted">No. ${q.quote_number}</div>` : ''}
                  ${q.attachment_path ? `<a href="${q.attachment_path}" target="_blank" style="font-size:11px;display:block;margin-top:4px">📎 Cotización</a>` : ''}
                </div>`).join('');
            })()}
          </div>

          <div style="display:flex;align-items:center;padding:0 6px;margin-top:20px;color:#9ca3af;font-size:18px">→</div>

          <!-- POs -->
          <div style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:6px">
            ${linkedPOs.length ? linkedPOs.map(po => `
              <div style="background:#f0fff4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;font-size:12px">
                <div style="color:#15803d;font-weight:700;margin-bottom:4px">🧾 Orden de Compra</div>
                <div><b>${po.folio}</b></div>
                <div class="muted">${String(po.created_at||'').slice(0,10)}</div>
                <div style="margin-top:4px">${statusPill(po.status)}</div>
                <div class="muted" style="margin-top:4px">$${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}</div>
                <div class="muted" style="margin-top:2px">${po.supplier_name||'-'}</div>
              </div>`).join('')
            : '<div style="background:#f3f4f6;border:1px dashed #d1d5db;border-radius:8px;padding:10px;font-size:12px;color:#9ca3af;text-align:center">Sin PO generada</div>'}
          </div>

          <div style="display:flex;align-items:center;padding:0 6px;margin-top:20px;color:#9ca3af;font-size:18px">→</div>

          <!-- Facturas -->
          <div style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:6px">
            ${linkedInvoices.length ? linkedInvoices.map(inv => `
              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:12px">
                <div style="color:#b45309;font-weight:700;margin-bottom:4px">📄 Factura</div>
                <div><b>${inv.invoice_number}</b></div>
                <div class="muted">${String(inv.created_at||'').slice(0,10)}</div>
                <div style="margin-top:4px">${statusPill(inv.status)}</div>
                <div class="muted" style="margin-top:4px">$${Number(inv.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
                ${inv.pdf_path ? `<a href="${inv.pdf_path}" target="_blank" style="font-size:11px;display:block">📎 PDF</a>` : ''}
                ${inv.xml_path ? `<a href="${inv.xml_path}" target="_blank" style="font-size:11px;display:block">📋 XML</a>` : ''}
              </div>`).join('')
            : '<div style="background:#f3f4f6;border:1px dashed #d1d5db;border-radius:8px;padding:10px;font-size:12px;color:#9ca3af;text-align:center">Sin factura</div>'}
          </div>

          <div style="display:flex;align-items:center;padding:0 6px;margin-top:20px;color:#9ca3af;font-size:18px">→</div>

          <!-- Pagos -->
          <div style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:6px">
            ${linkedPayments.length ? linkedPayments.map(pay => `
              <div style="background:#f0fff4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;font-size:12px">
                <div style="color:#15803d;font-weight:700;margin-bottom:4px">💳 Pago</div>
                <div><b>$${Number(pay.amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</b></div>
                <div class="muted">${String(pay.created_at||'').slice(0,10)}</div>
                <div class="muted">${pay.payment_type||'-'} · ${pay.reference||'-'}</div>
                ${pay.proof_path ? `<a href="${pay.proof_path}" target="_blank" style="font-size:11px">📎 Comprobante</a>` : ''}
              </div>`).join('')
            : '<div style="background:#f3f4f6;border:1px dashed #d1d5db;border-radius:8px;padding:10px;font-size:12px;color:#9ca3af;text-align:center">Sin pagos</div>'}
          </div>
        </div>
      </div>
    </div>

    <!-- Ítems -->
    <div class="card section" style="margin-top:12px" id="viewByItemSection">
      <h3>Ítems de la requisición</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Ítem</th><th>Proveedor</th><th>PO</th><th>Cant.</th><th>Costo unit.</th><th>Total</th><th>Estatus</th></tr></thead>
        <tbody>${d.items.map(i => {
          const total = Number(i.quantity||0) * Number(i.unit_cost||0);
          const rejectInfo = i.status === 'Rechazado' && i.reject_reason ? `<div style="margin-top:4px;padding:4px 8px;background:#fee2e2;border-radius:4px;font-size:11px;color:#b91c1c">✖ Rechazado: ${escapeHtml(i.reject_reason)}</div>` : '';
          return `<tr style="${i.status==='Rechazado'?'opacity:0.75;background:#fff5f5':''}">
            <td>${i.line_no}</td>
            <td><b>${i.catalog_name || i.manual_item_name}</b>${rejectInfo}</td>
            <td style="font-size:12px">${i.supplier_name||'-'}</td>
            <td style="font-size:12px">${i.po_folio||'-'}</td>
            <td>${i.quantity} ${i.unit}</td>
            <td>$${Number(i.unit_cost||0).toFixed(2)}</td>
            <td><b>$${total.toFixed(2)}</b></td>
            <td>${statusPill(i.status)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>

    <!-- Vista por PO -->
    <div class="card section" style="margin-top:12px;display:none" id="viewByPoSection">
      <h3>🧾 Vista por Orden de Compra</h3>
      ${linkedPOs.length ? linkedPOs.map(po => {
        const poItems = d.items.filter(i => i.po_folio === po.folio);
        const poInvoices = linkedInvoices.filter(inv => inv.purchase_order_id === po.id);
        const poPayments = linkedPayments.filter(pay => poInvoices.some(inv => inv.id === pay.invoice_id));
        return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <div><b style="font-size:15px">${po.folio}</b> <span class="muted" style="margin-left:8px">${po.supplier_name||'-'}</span></div>
            <div style="display:flex;gap:8px;align-items:center">${statusPill(po.status)}<b>$${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}</b></div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#f9fafb"><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Ítem</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Cant.</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Precio unit.</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Total</th><th style="padding:4px 8px;border-bottom:1px solid #e5e7eb">Estatus</th></tr></thead>
            <tbody>${poItems.map(i => `<tr><td style="padding:4px 8px">${escapeHtml(i.catalog_name||i.manual_item_name||'-')}</td><td style="padding:4px 8px;text-align:right">${i.quantity} ${i.unit||''}</td><td style="padding:4px 8px;text-align:right">$${Number(i.unit_cost||0).toFixed(2)}</td><td style="padding:4px 8px;text-align:right;font-weight:600">$${(Number(i.quantity||0)*Number(i.unit_cost||0)).toFixed(2)}</td><td style="padding:4px 8px">${statusPill(i.status)}</td></tr>`).join('')}</tbody>
          </table>
          ${poInvoices.length ? `<div style="margin-top:8px;font-size:12px;color:#b45309"><b>Facturas:</b> ${poInvoices.map(inv => `${inv.invoice_number} · $${Number(inv.total||0).toFixed(2)} · ${statusPill(inv.status)}`).join(' | ')}</div>` : ''}
          ${poPayments.length ? `<div style="margin-top:4px;font-size:12px;color:#15803d"><b>Pagos:</b> ${poPayments.map(pay => `$${Number(pay.amount||0).toFixed(2)} (${pay.payment_type||'-'})`).join(' | ')}</div>` : ''}
        </div>`;
      }).join('') : '<div class="muted small">Sin POs generadas para esta requisición</div>'}
    </div>
    <!-- Historial (timeline) -->
    <div class="card section" style="margin-top:12px">
      <h3>Historial de cambios</h3>
      <div style="position:relative;padding-left:20px">
        <div style="position:absolute;left:6px;top:0;bottom:0;width:2px;background:#e5e7eb"></div>
        ${d.history.length ? d.history.map(h => {
          const color = historyColors[h.module] || '#6b7280';
          return `<div style="position:relative;margin-bottom:12px;padding-left:14px">
            <div style="position:absolute;left:-14px;top:4px;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px ${color}"></div>
            <div style="font-size:12px">
              <span style="color:${color};font-weight:600">${h.module}</span>
              <span class="muted" style="margin-left:6px">${String(h.changed_at||'').replace('T',' ').slice(0,16)}</span>
              ${h.old_status ? `<span class="muted"> · ${h.old_status} →</span> <b>${h.new_status}</b>` : `<b> · ${h.new_status}</b>`}
            </div>
            ${h.comment ? `<div class="small muted" style="margin-top:2px">${escapeHtml(h.comment)}</div>` : ''}
          </div>`;
        }).join('') : '<div class="muted small">Sin historial</div>'}
      </div>
    </div>
  `, 'seguimiento');

  document.getElementById('viewByItemBtn')?.addEventListener('click', () => {
    document.getElementById('viewByItemSection').style.display = 'block';
    document.getElementById('viewByPoSection').style.display = 'none';
    document.getElementById('viewByItemBtn').className = 'btn-primary';
    document.getElementById('viewByPoBtn').className = 'btn-secondary';
  });
  document.getElementById('viewByPoBtn')?.addEventListener('click', () => {
    document.getElementById('viewByItemSection').style.display = 'none';
    document.getElementById('viewByPoSection').style.display = 'block';
    document.getElementById('viewByPoBtn').className = 'btn-primary';
    document.getElementById('viewByItemBtn').className = 'btn-secondary';
  });

  document.getElementById('cancelReqByRequesterBtn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('cancelReqMsg');
    const reason = prompt('Motivo de cancelación (opcional):');
    if (reason === null) return; // usuario cerró el prompt
    if (!confirm('¿Cancelar la requisición? Esta acción no se puede deshacer.')) return;
    try {
      msgEl.textContent = 'Cancelando...'; msgEl.style.color = '#6b7280';
      await api(`/api/requisitions/${id}/cancel-by-requester`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() || 'Cancelada por el solicitante' }) });
      msgEl.textContent = '✅ Requisición cancelada.'; msgEl.style.color = '#16a34a';
      setTimeout(() => { location.hash = '#/seguimiento'; render(); }, 1200);
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  });

  bindCommon();
}

async function approvalsView() {
  const rows = await api('/api/approvals/pending');

  const fmtMXN = v => Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });

  // ── Agrupar ítems por requisición ─────────────────────────────────────────
  const groupMap = new Map();
  rows.forEach(r => {
    if (!groupMap.has(r.requisition_id)) {
      groupMap.set(r.requisition_id, {
        requisition_id: r.requisition_id,
        folio: r.requisition_folio,
        requester: r.requester_name,
        total: r.requisition_total,
        rule: r.approval_rule,
        items: []
      });
    }
    groupMap.get(r.requisition_id).items.push(r);
  });
  const groups = [...groupMap.values()];

  const itemRows = groups.map(g => `
    <tr class="req-group-header" style="background:#eff6ff;border-top:2px solid #bfdbfe">
      <td style="padding:6px 8px">
        <input type="checkbox" class="select-req-check" data-req-id="${g.requisition_id}" title="Seleccionar todos los ítems de esta requisición"/>
      </td>
      <td colspan="3" style="padding:6px 8px">
        <b style="font-size:13px">📋 ${escapeHtml(g.folio)}</b>
        <span class="muted" style="font-size:12px"> · ${escapeHtml(g.requester || '-')}</span>
        ${g.rule ? `<span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 6px;font-size:11px;margin-left:8px">${escapeHtml(g.rule)}</span>` : ''}
        <span style="font-size:11px;color:#9ca3af;margin-left:6px">${g.items.length} ítem(s)</span>
      </td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;font-size:13px">$${fmtMXN(g.total)}</td>
      <td style="padding:6px 8px;white-space:nowrap">
        <button class="btn-primary req-approve-all-btn" data-req-id="${g.requisition_id}" style="font-size:11px;padding:3px 8px">✅ Autorizar req.</button>
        <button class="btn-danger req-reject-all-btn" data-req-id="${g.requisition_id}" style="font-size:11px;padding:3px 8px">✖ Rechazar req.</button>
      </td>
    </tr>
    ${g.items.map(r => `
      <tr data-rowid="${r.id}" style="background:white">
        <td style="padding:5px 8px 5px 24px">
          <input type="checkbox" class="approve-check" value="${r.id}" data-req-id="${r.requisition_id}"/>
        </td>
        <td style="padding:5px 8px">
          <span style="display:inline-block;width:8px;border-left:2px solid #bfdbfe;height:14px;vertical-align:middle;margin-right:8px"></span>
          <b>${escapeHtml(r.item_name)}</b>
          ${r.quote_pdf ? `<br><a href="${r.quote_pdf}" target="_blank" style="font-size:11px;color:#2563eb;margin-left:16px">📄 Ver cotización PDF</a>` : ''}
        </td>
        <td style="font-size:12px;padding:5px 8px">${escapeHtml(r.supplier_name)}</td>
        <td style="font-size:11px;color:#6b7280;padding:5px 8px">${escapeHtml(r.cost_center_name)}${r.sub_cost_center_name ? `<br>${escapeHtml(r.sub_cost_center_name)}` : ''}</td>
        <td style="font-size:12px;text-align:right;padding:5px 8px">$${fmtMXN(Number(r.quantity||0)*Number(r.unit_cost||0))}</td>
        <td style="padding:5px 8px;white-space:nowrap;min-width:200px">
          <button class="btn-secondary detail-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px" title="Ver historial y gastos">🔍 Detalles</button>
          <button class="btn-primary approve-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px" title="Autorizar">✅</button>
          <button class="btn-danger reject-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px" title="Rechazar">✖</button>
          <button class="btn-secondary pause-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px" title="Pausar / programar">⏸</button>
        </td>
      </tr>
      <tr class="detail-row" id="detail-row-${r.id}" style="display:none">
        <td colspan="6" style="padding:0;background:#f8fafc;border-top:none">
          <div id="detail-content-${r.id}" style="padding:16px">
            <div class="muted small">Cargando detalles...</div>
          </div>
        </td>
      </tr>
      <tr class="action-row" id="action-row-${r.id}" style="display:none">
        <td colspan="6" style="padding:8px 16px;background:#fffbeb;border-top:1px solid #fde68a">
          <div id="action-content-${r.id}"></div>
        </td>
      </tr>
    `).join('')}
  `).join('');

  app.innerHTML = shell(`
    <div class="card section">
      <div class="module-title">
        <h3>Autorizaciones pendientes <span style="background:#f59e0b;color:white;border-radius:10px;padding:2px 8px;font-size:12px;margin-left:6px">${rows.length}</span></h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-primary" id="approveAllBtn" style="font-size:12px;padding:5px 12px" ${!rows.length?'disabled':''}>✅ Autorizar seleccionados</button>
          <button class="btn-danger" id="rejectAllBtn" style="font-size:12px;padding:5px 12px" ${!rows.length?'disabled':''}>✖ Rechazar seleccionados</button>
          <button class="btn-secondary" id="requestAuthBtn" style="font-size:12px;padding:5px 12px" ${!rows.length?'disabled':''} title="Envía correo de recordatorio a los autorizadores con los ítems pendientes">📧 Solicitar autorización</button>
          <button class="btn-secondary" id="expReqItemsBtn">Exportar</button>
        </div>
      </div>
      ${rows.length ? `
      <div class="table-wrap">
        <table id="approveTable">
          <thead><tr>
            <th style="width:32px"><input type="checkbox" id="selectAllApprove" title="Seleccionar todos"/></th>
            <th>Requisición / Ítem</th><th>Proveedor</th><th>C. Costo</th>
            <th style="text-align:right">Importe</th><th>Acciones</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>
      <div id="approveMsg" class="small muted" style="margin-top:6px"></div>` :
      '<div class="muted small" style="padding:24px;text-align:center">Sin ítems pendientes de autorización ✅</div>'}
    </div>
  `, 'autorizaciones');

  const approveMsg = document.getElementById('approveMsg');
  const getSelectedIds = () => [...document.querySelectorAll('.approve-check:checked')].map(c => c.value);

  // ── Utilidades de panel ───────────────────────────────────────────────────
  const closeActionRow = (id) => {
    const ar = document.getElementById(`action-row-${id}`);
    if (ar) ar.style.display = 'none';
  };

  const showActionRow = (id, html) => {
    const ar = document.getElementById(`action-row-${id}`);
    const ac = document.getElementById(`action-content-${id}`);
    if (ar && ac) { ac.innerHTML = html; ar.style.display = ''; }
  };

  const spendTable = (data, ccName, subName) => {
    const hasSub = data.some(d => d.sub_cost_center !== null);
    return `<table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:4px 8px;text-align:left">Período</th>
        <th style="padding:4px 8px;text-align:right">Total empresa</th>
        <th style="padding:4px 8px;text-align:right">${escapeHtml(ccName || 'C. Costo')}</th>
        ${hasSub ? `<th style="padding:4px 8px;text-align:right">${escapeHtml(subName || 'Sub CC')}</th>` : ''}
      </tr></thead>
      <tbody>${data.map((d, idx) => `
        <tr style="background:${idx%2?'#f8fafc':'white'};border-bottom:1px solid #e5e7eb">
          <td style="padding:3px 8px">${d.label}</td>
          <td style="padding:3px 8px;text-align:right">$${fmtMXN(d.total)}</td>
          <td style="padding:3px 8px;text-align:right">$${fmtMXN(d.cost_center)}</td>
          ${hasSub ? `<td style="padding:3px 8px;text-align:right">${d.sub_cost_center !== null ? '$'+fmtMXN(d.sub_cost_center) : '-'}</td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table>`;
  };

  // ── Detalles (panel expandible) ───────────────────────────────────────────
  document.querySelectorAll('.detail-btn').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.id;
    const detailRow = document.getElementById(`detail-row-${id}`);
    const detailContent = document.getElementById(`detail-content-${id}`);
    if (!detailRow) return;

    if (detailRow.style.display !== 'none') {
      detailRow.style.display = 'none';
      btn.textContent = '🔍 Detalles';
      return;
    }

    btn.textContent = '⏳';
    detailRow.style.display = '';
    detailContent.innerHTML = '<div class="muted small">Cargando...</div>';

    try {
      const ctx = await api(`/api/approvals/items/${id}/context`);
      const cc = ctx.cost_center?.name || '-';
      const sub = ctx.sub_cost_center?.name || null;
      const cat = ctx.catalog_item;
      const quote = ctx.winning_quote;

      detailContent.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
          <div>
            <div class="small muted" style="font-weight:600;margin-bottom:6px">📦 Información del ítem</div>
            <table style="font-size:12px;width:100%">
              ${cat ? `<tr><td class="muted">Código catálogo</td><td><b>${cat.code}</b></td></tr>
              <tr><td class="muted">Tipo</td><td>${cat.item_type || '-'}</td></tr>
              <tr><td class="muted">Precio catálogo</td><td>$${fmtMXN(cat.unit_price)} ${cat.currency || 'MXN'}</td></tr>` : ''}
              <tr><td class="muted">Cantidad solicitada</td><td><b>${ctx.item.quantity} ${ctx.item.unit || 'pza'}</b></td></tr>
              <tr><td class="muted">Costo unitario</td><td><b>$${fmtMXN(ctx.item.unit_cost)} ${ctx.item.currency || 'MXN'}</b></td></tr>
              <tr><td class="muted">Subtotal ítem</td><td><b>$${fmtMXN(Number(ctx.item.quantity||0)*Number(ctx.item.unit_cost||0))}</b></td></tr>
              <tr><td class="muted">Proveedor</td><td>${ctx.supplier?.business_name || '-'}</td></tr>
              <tr><td class="muted">C. Costo</td><td>${cc}${sub ? ` › ${sub}` : ''}</td></tr>
              <tr><td class="muted">Solicitante</td><td>${ctx.requester?.full_name || '-'}</td></tr>
              ${ctx.item.web_link ? `<tr><td class="muted">Liga web</td><td><a href="${escapeHtml(ctx.item.web_link)}" target="_blank" rel="noopener" style="color:#2563eb;word-break:break-all">${escapeHtml(ctx.item.web_link)}</a></td></tr>` : ''}
              ${ctx.item.comments ? `<tr><td class="muted">Comentarios</td><td style="font-style:italic">${escapeHtml(ctx.item.comments)}</td></tr>` : ''}
            </table>
          </div>
          <div>
            <div class="small muted" style="font-weight:600;margin-bottom:6px">📄 Cotizaciones</div>
            ${ctx.all_quotes.length ? ctx.all_quotes.map(q => `
              <div style="padding:6px 10px;margin-bottom:4px;background:${q.is_winner?'#f0fff4':'white'};border:1px solid ${q.is_winner?'#86efac':'#e5e7eb'};border-radius:6px;font-size:12px">
                ${q.is_winner ? '🏆 ' : ''}<b>${escapeHtml(q.supplier_name)}</b>
                · $${fmtMXN(q.unit_cost)} ${q.currency||'MXN'}
                · ${q.delivery_days || '?'} días
                ${q.attachment_path ? `· <a href="${q.attachment_path}" target="_blank" style="color:#2563eb">📄 PDF</a>` : ''}
                ${q.quote_number ? `<span class="muted"> · #${q.quote_number}</span>` : ''}
              </div>`).join('') : '<div class="muted small">Sin cotizaciones registradas</div>'}
          </div>
        </div>

        ${ctx.purchase_history.length ? `
        <div style="margin-bottom:12px">
          <div class="small muted" style="font-weight:600;margin-bottom:6px">🕓 Historial de compras del ítem (últimas ${ctx.purchase_history.length})</div>
          <div style="overflow-x:auto">
            <table style="width:100%;font-size:12px;border-collapse:collapse">
              <thead><tr style="background:#f1f5f9">
                <th style="padding:4px 8px;text-align:left">PO</th>
                <th style="padding:4px 8px;text-align:left">Req.</th>
                <th style="padding:4px 8px;text-align:left">Fecha</th>
                <th style="padding:4px 8px;text-align:left">Proveedor</th>
                <th style="padding:4px 8px;text-align:right">Cant.</th>
                <th style="padding:4px 8px;text-align:right">P. Unit.</th>
                <th style="padding:4px 8px;text-align:right">Subtotal</th>
                <th style="padding:4px 8px">Estatus</th>
              </tr></thead>
              <tbody>${ctx.purchase_history.map((h, idx) => `
                <tr style="background:${idx%2?'#f8fafc':'white'};border-bottom:1px solid #e5e7eb">
                  <td style="padding:3px 8px"><b>${h.po_folio}</b></td>
                  <td style="padding:3px 8px">${h.requisition_folio}</td>
                  <td style="padding:3px 8px">${String(h.po_date||'').slice(0,10)}</td>
                  <td style="padding:3px 8px">${escapeHtml(h.supplier_name)}</td>
                  <td style="padding:3px 8px;text-align:right">${h.quantity} ${h.unit}</td>
                  <td style="padding:3px 8px;text-align:right">$${fmtMXN(h.unit_cost)}</td>
                  <td style="padding:3px 8px;text-align:right">$${fmtMXN(h.subtotal)}</td>
                  <td style="padding:3px 8px">${h.status}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : `<div class="muted small" style="margin-bottom:12px">Sin historial de compras para este ítem.</div>`}

        <div>
          <div class="small muted" style="font-weight:600;margin-bottom:8px">📊 Gasto histórico (empresa / ${cc}${sub ? ' / '+sub : ''})</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div>
              <div class="small muted" style="margin-bottom:4px">Últimas 8 semanas</div>
              ${spendTable(ctx.spending.weekly, cc, sub)}
            </div>
            <div>
              <div class="small muted" style="margin-bottom:4px">Últimos 12 meses</div>
              ${spendTable(ctx.spending.monthly, cc, sub)}
            </div>
            <div>
              <div class="small muted" style="margin-bottom:4px">Por año</div>
              ${spendTable(ctx.spending.annual, cc, sub)}
            </div>
          </div>
        </div>
      `;
      btn.textContent = '🔍 Cerrar';
    } catch(e) {
      detailContent.innerHTML = `<div class="small" style="color:#dc2626">Error al cargar: ${e.message}</div>`;
      btn.textContent = '🔍 Detalles';
    }
  });

  // ── Autorizar individual ──────────────────────────────────────────────────
  document.querySelectorAll('.approve-btn').forEach(btn => btn.onclick = async () => {
    const orig = btn.textContent;
    try {
      btn.disabled = true; btn.textContent = '⏳';
      await api(`/api/approvals/items/${btn.dataset.id}/approve`, { method: 'POST', body: JSON.stringify({ comment: 'Autorizado' }) });
      await approvalsView();
    } catch(e) { alert(e.message || 'Error al autorizar'); btn.disabled = false; btn.textContent = orig; }
  });

  // ── Rechazar individual con formulario de motivo ──────────────────────────
  document.querySelectorAll('.reject-btn').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.id;
    // Cerrar otros paneles de acción abiertos
    document.querySelectorAll('.action-row').forEach(r => r.style.display = 'none');
    showActionRow(id, `
      <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <label class="small muted">Motivo del rechazo *</label>
          <select id="rejectReasonSel-${id}" style="width:100%;margin-bottom:6px;font-size:13px">
            <option value="">Seleccionar motivo...</option>
            <option>Presupuesto insuficiente este período</option>
            <option>Precio fuera de rango aceptable</option>
            <option>Cotización no válida o incompleta</option>
            <option>Ítem no prioritario</option>
            <option>Requiere mayor justificación</option>
            <option>Proveedor no aprobado</option>
            <option>Otro motivo</option>
          </select>
          <textarea id="rejectComment-${id}" placeholder="Comentario adicional (opcional)..." style="width:100%;height:56px;font-size:12px;resize:vertical"></textarea>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;padding-top:18px">
          <button class="btn-danger confirm-reject-btn" data-id="${id}" style="font-size:12px;padding:5px 14px">✖ Confirmar rechazo</button>
          <button class="btn-secondary" onclick="document.getElementById('action-row-${id}').style.display='none'" style="font-size:12px;padding:4px 10px">Cancelar</button>
        </div>
      </div>
    `);

    document.querySelector(`.confirm-reject-btn[data-id="${id}"]`).onclick = async (e) => {
      const sel = document.getElementById(`rejectReasonSel-${id}`).value;
      const comment = document.getElementById(`rejectComment-${id}`).value.trim();
      const reason = [sel, comment].filter(Boolean).join(' — ');
      if (!sel) { alert('Selecciona un motivo de rechazo.'); return; }
      try {
        e.target.disabled = true;
        const out = await api(`/api/approvals/items/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
        if (out.mailto) {
          const link = document.createElement('a');
          link.href = out.mailto; link.target = '_blank'; link.click();
        }
        approvalsView();
      } catch(err) { alert(err.message); e.target.disabled = false; }
    };
  });

  // ── Pausar individual ─────────────────────────────────────────────────────
  document.querySelectorAll('.pause-btn').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.id;
    document.querySelectorAll('.action-row').forEach(r => r.style.display = 'none');
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    const nextMonthStr = nextMonth.toISOString().slice(0, 10);
    showActionRow(id, `
      <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <label class="small muted">Programar para</label>
          <div style="display:flex;gap:8px;margin-bottom:6px;margin-top:2px">
            <label style="display:flex;align-items:center;gap:4px;font-size:13px">
              <input type="radio" name="pauseType-${id}" value="next_month" checked/> Siguiente mes (${nextMonthStr})
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:13px">
              <input type="radio" name="pauseType-${id}" value="custom"/> Fecha específica
            </label>
          </div>
          <input type="date" id="pauseDate-${id}" style="display:none;margin-bottom:6px;font-size:13px" min="${new Date().toISOString().slice(0,10)}"/>
          <textarea id="pauseReason-${id}" placeholder="Motivo de la pausa..." style="width:100%;height:48px;font-size:12px;resize:vertical">Pendiente de presupuesto para el siguiente mes</textarea>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;padding-top:18px">
          <button class="btn-secondary confirm-pause-btn" data-id="${id}" style="font-size:12px;padding:5px 14px">⏸ Pausar</button>
          <button class="btn-secondary" onclick="document.getElementById('action-row-${id}').style.display='none'" style="font-size:12px;padding:4px 10px">Cancelar</button>
        </div>
      </div>
    `);

    document.querySelectorAll(`input[name="pauseType-${id}"]`).forEach(radio => {
      radio.onchange = () => {
        const d = document.getElementById(`pauseDate-${id}`);
        d.style.display = radio.value === 'custom' ? '' : 'none';
      };
    });

    document.querySelector(`.confirm-pause-btn[data-id="${id}"]`).onclick = async (e) => {
      const type = document.querySelector(`input[name="pauseType-${id}"]:checked`).value;
      const reason = document.getElementById(`pauseReason-${id}`).value.trim() || 'Pausado';
      const payload = { reason };
      if (type === 'custom') {
        const d = document.getElementById(`pauseDate-${id}`).value;
        if (!d) { alert('Selecciona una fecha.'); return; }
        payload.paused_until = d;
      }
      try {
        e.target.disabled = true;
        const out = await api(`/api/approvals/items/${id}/pause`, { method: 'POST', body: JSON.stringify(payload) });
        const row = document.querySelector(`tr[data-rowid="${id}"]`);
        if (row) {
          const td = row.querySelector('td:nth-child(4)');
          if (td) td.innerHTML += `<br><small style="color:#f59e0b">⏸ Pausado hasta ${String(out.paused_until).slice(0,10)}</small>`;
          row.style.opacity = '0.5';
        }
        closeActionRow(id);
        approveMsg.textContent = `⏸ Ítem pausado hasta ${String(out.paused_until).slice(0,10)}`;
        setTimeout(() => { approveMsg.textContent = ''; }, 4000);
      } catch(err) { alert(err.message); e.target.disabled = false; }
    };
  });

  // ── Seleccionar ítems de una requisición ─────────────────────────────────
  document.querySelectorAll('.select-req-check').forEach(chk => {
    chk.onchange = () => {
      document.querySelectorAll(`.approve-check[data-req-id="${chk.dataset.reqId}"]`)
        .forEach(c => c.checked = chk.checked);
    };
  });

  // ── Autorizar requisición completa ────────────────────────────────────────
  document.querySelectorAll('.req-approve-all-btn').forEach(btn => btn.onclick = async () => {
    const reqId = btn.dataset.reqId;
    if (!confirm('¿Autorizar todos los ítems pendientes de esta requisición?')) return;
    const orig = btn.textContent;
    try {
      btn.disabled = true; btn.textContent = '⏳';
      const out = await api(`/api/approvals/requisitions/${reqId}/approve-all`, { method: 'POST', body: JSON.stringify({ comment: 'Autorizado (requisición completa)' }) });
      approveMsg.textContent = `✅ ${out.authorized} ítem(s) autorizado(s)`;
      setTimeout(approvalsView, 900);
    } catch(e) { alert(e.message || 'Error al autorizar'); btn.disabled = false; btn.textContent = orig; }
  });

  // ── Rechazar requisición completa ─────────────────────────────────────────
  document.querySelectorAll('.req-reject-all-btn').forEach(btn => btn.onclick = async () => {
    const reqId = btn.dataset.reqId;
    const reason = prompt('Motivo de rechazo para todos los ítems de esta requisición:');
    if (reason === null) return;
    const orig = btn.textContent;
    try {
      btn.disabled = true; btn.textContent = '⏳';
      const out = await api(`/api/approvals/requisitions/${reqId}/reject-all`, { method: 'POST', body: JSON.stringify({ reason: reason || 'Rechazado (requisición completa)' }) });
      if (out.mailto) { const a = document.createElement('a'); a.href = out.mailto; a.target = '_blank'; a.click(); }
      approveMsg.textContent = `✖ ${out.rejected} ítem(s) rechazado(s)`;
      setTimeout(approvalsView, 900);
    } catch(e) { alert(e.message || 'Error al rechazar'); btn.disabled = false; btn.textContent = orig; }
  });

  // ── Seleccionar todos ─────────────────────────────────────────────────────
  document.getElementById('selectAllApprove')?.addEventListener('change', e => {
    document.querySelectorAll('.approve-check').forEach(c => c.checked = e.target.checked);
    document.querySelectorAll('.select-req-check').forEach(c => c.checked = e.target.checked);
  });

  // ── Autorizar masivo ──────────────────────────────────────────────────────
  document.getElementById('approveAllBtn')?.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (!ids.length) { approveMsg.textContent = 'Selecciona al menos un ítem.'; return; }
    if (!confirm(`¿Autorizar ${ids.length} ítem(s) seleccionado(s)?`)) return;
    approveMsg.textContent = 'Autorizando...';
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await api(`/api/approvals/items/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment: 'Autorización masiva' }) }); ok++; }
      catch(_) { fail++; }
    }
    approveMsg.textContent = `✅ ${ok} autorizado(s)${fail ? `, ${fail} con error` : ''}`;
    setTimeout(approvalsView, 900);
  });

  // ── Rechazar masivo (pide motivo) ─────────────────────────────────────────
  document.getElementById('rejectAllBtn')?.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (!ids.length) { approveMsg.textContent = 'Selecciona al menos un ítem.'; return; }
    const reason = prompt(`Motivo de rechazo para ${ids.length} ítem(s):`);
    if (reason === null) return;
    approveMsg.textContent = 'Rechazando...';
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await api(`/api/approvals/items/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason || 'Rechazo masivo' }) }); ok++; }
      catch(_) { fail++; }
    }
    approveMsg.textContent = `✖ ${ok} rechazado(s)${fail ? `, ${fail} con error` : ''}`;
    setTimeout(approvalsView, 900);
  });

  // ── Solicitar autorización (correo a autorizadores) ───────────────────────
  document.getElementById('requestAuthBtn')?.addEventListener('click', async () => {
    try {
      const out = await api('/api/approvals/request-auth-mailto');
      if (!out.mailto) { alert('No hay ítems pendientes de autorización.'); return; }
      const a = document.createElement('a');
      a.href = out.mailto;
      a.click();
    } catch(e) { alert('Error al generar el correo.'); }
  });

  const expReqItemsBtn = document.getElementById('expReqItemsBtn');
  if (expReqItemsBtn) expReqItemsBtn.onclick = () => downloadCsv('requisition_items', 'items_autorizacion.csv');
  bindCommon();
}

async function purchasesView() {
  const CANCEL_REASONS = [
    'Presupuesto insuficiente',
    'Proveedor no disponible',
    'Solicitud duplicada',
    'Cambio de especificaciones',
    'Ya no se requiere',
    'Cancelado por el solicitante',
    'Orden de compra cancelada',
    'Otro motivo'
  ];

  let showCancelled = false;
  const loadItems = () => api(`/api/purchases/pending-items${showCancelled ? '?show_cancelled=true' : ''}`);
  const loadRejected = () => api('/api/purchases/pending-items?include_rejected=true&show_cancelled=true');

  const [allItems, allItemsWithRejected, pos, suppliers, sccList, costCenters] = await Promise.all([
    loadItems(),
    loadRejected(),
    api('/api/purchases/purchase-orders'),
    api('/api/catalogs/suppliers'),
    api('/api/catalogs/sub-cost-centers'),
    api('/api/catalogs/cost-centers')
  ]);

  const rejectedItems = allItemsWithRejected.filter(x => x.is_rejected);

  // Clasificar ítems por sección (cancelados excluidos salvo toggle)
  const itemsPendientePO = allItems.filter(x => x.supplier_id && x.unit_cost && !x.purchase_order_id && !['Cancelado','Rechazado','Cerrado','En cotización'].includes(x.status));
  const itemsEnCotizacion = allItems.filter(x => x.status === 'En cotización' && x.item_name && x.item_name.trim() && !x.purchase_order_id);
  const itemsSolicitados = allItems.filter(x => showCancelled ? true : !['Cancelado','Rechazado','Cerrado'].includes(x.status));
  const itemsPendingScc = allItems.filter(x => x.sub_cost_center_proposed && !x.sub_cost_center_id && !['Cancelado','Rechazado','Cerrado'].includes(x.status));
  const posConAnticipo = pos.filter(p => Number(p.advance_percentage || 0) > 0 && p.advance_status !== 'N/A' && p.advance_status !== 'Pagado');

  let activeTab = sessionStorage.getItem('compras_active_tab') || 'pendientes';

  app.innerHTML = shell(`
    <div class="card section">
      <div class="module-title">
        <h3>Compras</h3>
        <div style="display:flex;gap:8px">
          <select id="poCurrency"><option>MXN</option><option>USD</option></select>
          <button class="btn-secondary" id="expPoBtn">Exportar</button>
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e5e7eb;padding-bottom:0">
        <button class="tab-btn active" data-tab="pendientes" style="padding:8px 16px;border:none;background:none;cursor:pointer;font-weight:600;border-bottom:2px solid #3b82f6;margin-bottom:-2px">
          📋 Pendientes de PO <span style="background:#3b82f6;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${itemsPendientePO.length}</span>
        </button>
        <button class="tab-btn" data-tab="cotizacion" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:#6b7280">
          📩 En cotización <span style="background:#f59e0b;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${itemsEnCotizacion.length}</span>
        </button>
        <button class="tab-btn" data-tab="solicitados" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:#6b7280">
          📦 Todos los ítems <span style="background:#6b7280;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${itemsSolicitados.length}</span>
          ${rejectedItems.length ? `<span style="background:#dc2626;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px" title="${rejectedItems.length} rechazados">🚫${rejectedItems.length}</span>` : ''}
        </button>
        <button class="tab-btn" data-tab="pos" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:#6b7280">
          🧾 POs generadas <span style="background:#10b981;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${pos.length}</span>
        </button>
        <button class="tab-btn" data-tab="requisiciones" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:#6b7280">
          📄 Requisiciones
        </button>
        <button class="tab-btn" data-tab="scc_pending" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:${itemsPendingScc.length?'#b45309':'#6b7280'}">
          🗂 SCC Propuestos ${itemsPendingScc.length ? `<span style="background:#f59e0b;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${itemsPendingScc.length}</span>` : ''}
        </button>
        <button class="tab-btn" data-tab="anticipos" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:${posConAnticipo.length?'#1d4ed8':'#6b7280'}">
          💰 Anticipos ${posConAnticipo.length ? `<span style="background:#1d4ed8;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${posConAnticipo.length}</span>` : ''}
        </button>
        <button class="tab-btn" data-tab="kpi_costos" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:#6b7280">
          📊 KPI Costos
        </button>
      </div>

      <div id="tabContent"></div>
      <div class="actions" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px" id="poActions">
        <button class="btn-primary" id="genPoBtn">✅ PO de Selección</button>
        <button class="btn-secondary" id="genAllPendingBtn">📦 Generar POs Faltantes</button>
        <div id="poMsg" class="small muted"></div>
      </div>
    </div>

    <div id="poPreviewSection" class="card section" style="margin-top:16px;display:none">
      <div class="module-title"><h3>Vista previa — Agrupación por proveedor</h3><button class="btn-secondary" id="closePreviewBtn">Cerrar</button></div>
      <div id="poPreviewContent"></div>
      <div class="actions" style="margin-top:12px">
        <button class="btn-primary" id="confirmGenPoBtn">✅ Confirmar y generar</button>
        <div id="poConfirmMsg" class="small muted"></div>
      </div>
    </div>

    <div class="card section" style="margin-top:16px" id="purchaseActionCard" hidden>
      <h3 id="purchaseActionTitle">Acción</h3>
      <div id="purchaseActionBody"></div>
    </div>
  `, 'compras');

  let lastPreviewIds = [];

  const openActionCard = (title, html) => {
    purchaseActionTitle.textContent = title;
    purchaseActionBody.innerHTML = html;
    purchaseActionCard.hidden = false;
    purchaseActionCard.scrollIntoView({ behavior: 'smooth' });
  };
  const closeActionCard = () => { purchaseActionCard.hidden = true; purchaseActionBody.innerHTML = ''; };

  const doGeneratePO = async (itemIds, forceStale = false) => {
    const ids = itemIds.map(Number).filter(Boolean);
    if (!ids.length) throw new Error('Selecciona al menos un ítem');
    return await api('/api/purchases/generate-po', { method: 'POST', body: JSON.stringify({ item_ids: ids, currency: poCurrency.value, force_stale_confirm: forceStale || undefined }) });
  };

  const showStaleDialog = (staleItems, itemIds) => {
    openActionCard('⚠ Precios desactualizados — Confirmación requerida', `
      <p class="small muted">Los siguientes ítems no han sido pedidos en más de 30 días. Confirma o actualiza el precio antes de generar la PO.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Ítem</th><th>Último pedido</th><th>Precio actual</th><th>Actualizar precio</th></tr></thead>
        <tbody>${staleItems.map(s => `<tr>
          <td style="font-size:12px"><b>${escapeHtml(s.name)}</b><br><span class="muted">${s.reason||''}</span></td>
          <td style="font-size:12px">${s.last_ordered ? String(s.last_ordered).slice(0,10) : '—'}</td>
          <td style="font-size:12px;font-weight:600">$${Number(s.unit_cost||0).toFixed(2)}</td>
          <td><div style="display:flex;gap:4px"><input class="stale-cost-input" data-id="${s.id}" type="number" value="${Number(s.unit_cost||0)}" min="0" style="width:90px;font-size:12px"/><button class="btn-secondary stale-update-btn" data-id="${s.id}" style="padding:2px 8px;font-size:11px">Guardar</button><span class="stale-saved-msg" data-id="${s.id}" style="font-size:11px;color:#16a34a"></span></div></td>
        </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="actions" style="margin-top:12px">
        <button class="btn-primary" id="confirmStaleBtn">✅ Confirmar precios actuales y generar PO</button>
        <button class="btn-secondary" id="cancelStaleBtn">Cancelar</button>
        <span id="stalePoMsg" class="small muted" style="margin-left:8px"></span>
      </div>
    `);
    document.querySelectorAll('.stale-update-btn').forEach(btn => {
      btn.onclick = async () => {
        const newCost = Number(document.querySelector(`.stale-cost-input[data-id="${btn.dataset.id}"]`)?.value || 0);
        const savedMsg = document.querySelector(`.stale-saved-msg[data-id="${btn.dataset.id}"]`);
        try {
          await api(`/api/purchases/items/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ unit_cost: newCost }) });
          if (savedMsg) { savedMsg.textContent = '✅ Guardado'; }
          btn.disabled = true;
        } catch(e) { alert(e.message); }
      };
    });
    document.getElementById('cancelStaleBtn').onclick = closeActionCard;
    document.getElementById('confirmStaleBtn').onclick = async () => {
      const msgEl = document.getElementById('stalePoMsg');
      try {
        msgEl.textContent = 'Generando PO...';
        const out = await doGeneratePO(itemIds, true);
        msgEl.textContent = out.message;
        setTimeout(() => { closeActionCard(); render(); }, 1800);
      } catch(e) { msgEl.textContent = e.message; }
    };
  };

  const showZeroCostError = (zeroCostItems) => {
    openActionCard('❌ Ítems sin precio', `
      <p class="small muted">Los siguientes ítems tienen precio $0 y no pueden incluirse en una PO. Cotiza o actualiza el costo primero.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Ítem</th><th>Acción</th></tr></thead>
        <tbody>${zeroCostItems.map(i => `<tr>
          <td style="font-size:12px"><b>${escapeHtml(i.name)}</b></td>
          <td><div style="display:flex;gap:4px"><input class="zero-cost-input" data-id="${i.id}" type="number" value="0" min="0.01" step="0.01" style="width:100px;font-size:12px"/><button class="btn-secondary zero-update-btn" data-id="${i.id}" style="padding:2px 8px;font-size:11px">Actualizar</button><span class="zero-saved-msg" data-id="${i.id}" style="font-size:11px;color:#16a34a"></span></div></td>
        </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="actions"><button class="btn-secondary" id="closeZeroBtn">Cerrar</button></div>
    `);
    document.getElementById('closeZeroBtn').onclick = closeActionCard;
    document.querySelectorAll('.zero-update-btn').forEach(btn => {
      btn.onclick = async () => {
        const newCost = Number(document.querySelector(`.zero-cost-input[data-id="${btn.dataset.id}"]`)?.value || 0);
        const savedMsg = document.querySelector(`.zero-saved-msg[data-id="${btn.dataset.id}"]`);
        if (newCost <= 0) { alert('El precio debe ser mayor a $0'); return; }
        try {
          await api(`/api/purchases/items/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ unit_cost: newCost }) });
          if (savedMsg) savedMsg.textContent = '✅ Guardado';
          btn.disabled = true;
        } catch(e) { alert(e.message); }
      };
    });
  };

  const openCancelItem = (row) => {
    openActionCard(`Cancelar ítem · ${row.item_name}`, `
      <p class="small muted">Selecciona el motivo de cancelación:</p>
      <select id="cancelReason" style="width:100%;margin-bottom:12px">
        ${CANCEL_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
      </select>
      <div id="cancelOtherWrap" style="display:none;margin-bottom:12px">
        <input id="cancelOtherText" placeholder="Describe el motivo..." style="width:100%"/>
      </div>
      <div class="actions">
        <button class="btn-danger" id="confirmCancelBtn">Confirmar cancelación</button>
        <button class="btn-secondary" id="cancelCancelBtn">No cancelar</button>
      </div>
      <div id="cancelMsg" class="small muted"></div>
    `);
    cancelReason.onchange = () => {
      cancelOtherWrap.style.display = cancelReason.value === 'Otro motivo' ? 'block' : 'none';
    };
    cancelCancelBtn.onclick = closeActionCard;
    confirmCancelBtn.onclick = async () => {
      try {
        const reason = cancelReason.value === 'Otro motivo' ? (cancelOtherText.value || 'Otro motivo') : cancelReason.value;
        await api(`/api/purchases/items/${row.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
        cancelMsg.textContent = '✅ Ítem cancelado';
        setTimeout(() => { closeActionCard(); render(); }, 900);
      } catch (e) { cancelMsg.textContent = e.message; }
    };
  };

  const openRegisterCatalog = async (row) => {
    // Auto-sugerir código basado en ítems existentes
    let suggestedCode = 'ITM-001';
    try {
      const existingItems = await api('/api/catalogs/items');
      const codes = existingItems.map(i => i.code || '').filter(c => /^ITM-\d+$/i.test(c));
      const maxNum = codes.reduce((max, c) => {
        const n = parseInt(c.replace(/^ITM-/i, ''), 10);
        return n > max ? n : max;
      }, 0);
      suggestedCode = `ITM-${String(maxNum + 1).padStart(3, '0')}`;
    } catch (_) {}

    openActionCard(`Alta al catálogo · ${row.item_name}`, `
      <div class="row-3">
        <div><label>Código del ítem <span style="color:#3b82f6;font-size:11px">(sugerido)</span></label><input id="regCode" value="${suggestedCode}"/></div>
        <div><label>Nombre oficial</label><input id="regName" value="${escapeHtml(row.item_name || '')}"/></div>
        <div><label>Proveedor</label><select id="regSupplier"><option value="">Selecciona</option>${suppliers.map(s => `<option value="${s.id}" ${Number(row.supplier_id)===s.id?'selected':''}>${s.business_name}</option>`).join('')}</select></div>
      </div>
      <div class="row-3">
        <div><label>Precio unitario</label><input id="regPrice" type="number" value="${Number(row.unit_cost || 0)}"/></div>
        <div><label>Moneda</label><select id="regCurrency"><option ${String(row.currency||'MXN')==='MXN'?'selected':''}>MXN</option><option ${String(row.currency||'MXN')==='USD'?'selected':''}>USD</option></select></div>
        <div><label>Unidad</label><input id="regUnit" value="${escapeHtml(row.unit || 'pza')}"/></div>
      </div>
      <div class="actions"><button class="btn-primary" id="regSaveBtn">Guardar en catálogo</button><button class="btn-secondary" id="regCancelBtn">Cancelar</button></div>
      <div id="regMsg" class="small muted"></div>
    `);
    regCancelBtn.onclick = closeActionCard;
    regSaveBtn.onclick = async () => {
      try {
        if (!regCode.value) throw new Error('Código requerido');
        const result = await api(`/api/purchases/items/${row.id}/register-catalog-item`, {
          method: 'POST',
          body: JSON.stringify({ supplier_id: regSupplier.value, code: regCode.value, name: regName.value, unit_price: Number(regPrice.value || 0), currency: regCurrency.value, unit: regUnit.value })
        });
        const extra = result.matched_count > 0
          ? ` · ✅ ${result.matched_count} ítem(s) adicional(es) con el mismo nombre también fueron ligados.`
          : '';
        regMsg.textContent = `✅ Guardado como ${regCode.value}${extra}`;
        regMsg.style.color = '#16a34a';
        setTimeout(() => { closeActionCard(); render(); }, 1800);
      } catch (e) { regMsg.textContent = e.message; regMsg.style.color = '#dc2626'; }
    };
  };

  const openQuotationRequest = (row) => {
    openActionCard(`Solicitar cotización · ${row.item_name}`, `
      <p class="small muted">Selecciona proveedores (Ctrl+Click para varios):</p>
      <select id="quoteSuppliersMulti" multiple size="6" style="width:100%;margin-bottom:8px">${suppliers.map(s => `<option value="${s.id}" ${Number(row.supplier_id)===s.id?'selected':''}>${s.business_name} ${s.email?'· '+s.email:''}</option>`).join('')}</select>
      <div style="margin-bottom:12px">
        <button type="button" id="toggleNewSupplierBtn" class="btn-secondary" style="font-size:12px;padding:3px 10px">➕ Registrar nuevo proveedor</button>
        <div id="newSupplierForm" style="display:none;margin-top:8px;padding:10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px">
          <div class="row-2" style="margin-bottom:6px">
            <div><label style="font-size:12px">Nombre empresa *</label><input id="nsBizName" placeholder="Empresa S.A." style="font-size:12px"/></div>
            <div><label style="font-size:12px">Contacto</label><input id="nsContact" placeholder="Nombre contacto" style="font-size:12px"/></div>
          </div>
          <div class="row-2" style="margin-bottom:6px">
            <div><label style="font-size:12px">Email acceso (usuario) *</label><input id="nsEmail" type="email" placeholder="proveedor@empresa.com" style="font-size:12px"/></div>
            <div><label style="font-size:12px">Teléfono</label><input id="nsPhone" placeholder="555 000 0000" style="font-size:12px"/></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button type="button" id="saveNewSupplierBtn" class="btn-primary" style="font-size:12px;padding:4px 12px">Guardar y seleccionar</button>
            <span id="nsMsg" class="small muted"></span>
          </div>
        </div>
      </div>
      <div class="row-2">
        <select id="quoteReqCurrency"><option ${String(row.currency||'MXN')==='MXN'?'selected':''}>MXN</option><option ${String(row.currency||'MXN')==='USD'?'selected':''}>USD</option></select>
        <button class="btn-primary" id="sendQuoteReqBtn">Enviar solicitud</button>
      </div>
      <div class="actions"><button class="btn-secondary" id="quoteCancelBtn">Cancelar</button></div>
      <div id="quoteReqMsg" class="small muted"></div>
    `);
    quoteCancelBtn.onclick = closeActionCard;

    document.getElementById('toggleNewSupplierBtn').onclick = () => {
      const f = document.getElementById('newSupplierForm');
      f.style.display = f.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('saveNewSupplierBtn').onclick = async () => {
      const nsMsg = document.getElementById('nsMsg');
      const bizName = document.getElementById('nsBizName').value.trim();
      const email = document.getElementById('nsEmail').value.trim();
      if (!bizName) { nsMsg.textContent = 'El nombre de empresa es obligatorio.'; return; }
      if (!email) { nsMsg.textContent = 'El email es obligatorio para crear el acceso del proveedor.'; return; }
      try {
        nsMsg.textContent = 'Guardando...';
        const tempPwd = Math.random().toString(36).slice(2, 10) + 'A1!';
        const result = await api('/api/catalogs/suppliers', { method: 'POST', body: JSON.stringify({
          business_name: bizName,
          contact_name: document.getElementById('nsContact').value.trim(),
          email,
          phone: document.getElementById('nsPhone').value.trim(),
          user_email: email,
          user_full_name: document.getElementById('nsContact').value.trim() || bizName,
          user_password: tempPwd
        })});
        // Add to local suppliers list and select in multi-select
        suppliers.push(result.supplier);
        const opt = document.createElement('option');
        opt.value = result.supplier.id;
        opt.textContent = `${result.supplier.business_name} · ${result.supplier.email}`;
        opt.selected = true;
        document.getElementById('quoteSuppliersMulti').appendChild(opt);
        // Show credentials to copy/send
        const siteUrl = window.location.origin;
        nsMsg.innerHTML = `✅ Proveedor creado. <b>Usuario:</b> ${email} <b>Contraseña:</b> ${tempPwd} <a href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Acceso al portal de compras')}&body=${encodeURIComponent('Bienvenido al portal de compras.\n\nUsuario: '+email+'\nContraseña: '+tempPwd+'\nAcceso: '+siteUrl)}" style="font-size:11px;margin-left:6px">📧 Enviar acceso</a>`;
        nsMsg.style.color = '#16a34a';
        document.getElementById('newSupplierForm').style.display = 'none';
      } catch(e) { nsMsg.textContent = e.message; nsMsg.style.color = '#dc2626'; }
    };

    sendQuoteReqBtn.onclick = async () => {
      try {
        const supplier_ids = [...quoteSuppliersMulti.selectedOptions].map(o => Number(o.value)).filter(Boolean);
        if (!supplier_ids.length) throw new Error('Selecciona al menos un proveedor');
        const out = await api(`/api/purchases/items/${row.id}/request-quotation`, { method:'POST', body: JSON.stringify({ supplier_ids, currency: quoteReqCurrency.value }) });
        if (out.mailto) window.open(out.mailto, '_blank');
        quoteReqMsg.textContent = `✅ Solicitud enviada a ${supplier_ids.length} proveedor(es)`;
        setTimeout(() => { closeActionCard(); render(); }, 1200);
      } catch (e) { quoteReqMsg.textContent = e.message; }
    };
  };

  // Render de fila de ítem editable
  const itemRow = (i, canSelect = false) => {
    const total = Number(i.quantity || 0) * Number(i.unit_cost || 0);
    const rowBg = i.status === 'Autorizado' ? 'background:#f0fff4' : i.status === 'En proceso' ? 'background:#eff6ff' : i.status === 'Cancelado' ? 'opacity:.5' : '';
    // FASE 5: PO Aceptada o más avanzada = lectura solamente
    const poLocked = ['Aceptada','En proceso','Entregado','Facturada','Facturación parcial','Cerrada'].includes(i.status) && i.purchase_order_id;
    const isDisabled = ['Cancelado','En proceso','Cerrado'].includes(i.status) || poLocked;
    return `<tr style="${rowBg}" data-id="${i.id}">
      <td>${canSelect && !['Cancelado','En proceso','Cerrado','En autorización','En cotización'].includes(i.status) && !poLocked && i.supplier_id && Number(i.unit_cost) > 0 ? `<input type="checkbox" class="po-check" value="${i.id}"/>` : ''}</td>
      <td style="font-size:11px">${i.requisition_folio||'-'}</td>
      <td>
        <b>${i.item_name}</b>
        ${poLocked ? `<br><small style="color:#7c3aed;font-size:10px">🔒 PO ${i.po_folio||''} (${i.status})</small>` : ''}
        ${i.cancel_reason ? `<br><small style="color:#dc2626">Cancelado: ${i.cancel_reason}${i.cancelled_by_name ? ` · por ${i.cancelled_by_name}` : ''}</small>` : ''}
        ${i.web_link ? `<br><a href="${escapeHtml(i.web_link)}" target="_blank" rel="noopener" style="font-size:11px;color:#2563eb">🔗 Liga</a>` : ''}
        ${i.comments ? `<br><small style="color:#6b7280;font-style:italic" title="${escapeHtml(i.comments)}">💬 ${escapeHtml(i.comments.length > 60 ? i.comments.slice(0,60) + '…' : i.comments)}</small>` : ''}
      </td>
      <td>
        <select class="edit-supplier" data-id="${i.id}" style="max-width:150px" ${isDisabled||i.winning_quote_id?'disabled':''}>
          <option value="">Sin proveedor</option>
          ${suppliers.map(s => `<option value="${s.id}" ${Number(i.supplier_id)===s.id?'selected':''}>${s.business_name}</option>`).join('')}
        </select>
        ${i.winning_quote_id ? `<br><small style="color:#6b7280;font-size:10px" title="Asignado por cotización ganadora">🔒 cotización</small>` : ''}
      </td>
      <td><input type="number" class="edit-qty" data-id="${i.id}" value="${Number(i.quantity||0)}" style="width:60px" min="0.01" step="any" ${isDisabled?'disabled':''}/></td>
      <td><input type="text" class="edit-unit" data-id="${i.id}" value="${escapeHtml(i.unit||'')}" style="width:55px" ${isDisabled?'disabled':''}/></td>
      <td><input type="number" class="edit-cost" data-id="${i.id}" value="${Number(i.unit_cost||0)}" style="width:75px" ${isDisabled||i.winning_quote_id?'disabled':''}/></td>
      <td><b>$${Number(total).toFixed(2)}</b></td>
      <td><select class="edit-currency" data-id="${i.id}" style="width:65px" ${isDisabled||i.winning_quote_id?'disabled':''}><option ${String(i.currency||'MXN')==='MXN'?'selected':''}>MXN</option><option ${String(i.currency||'MXN')==='USD'?'selected':''}>USD</option></select></td>
      <td style="font-size:11px;white-space:nowrap">${escapeHtml(i.requester_name||'-')}</td>
      <td style="font-size:11px;white-space:nowrap">${escapeHtml(i.cost_center_name||'-')}</td>
      <td style="font-size:11px;white-space:nowrap">${i.request_date||'-'}</td>
      <td>${statusPill(i.status)}</td>
      <td style="font-size:11px">${i.po_folio||'-'}</td>
      <td style="white-space:nowrap">
        <button class="btn-secondary open-edit-modal" data-id="${i.id}" style="padding:2px 7px;font-size:11px" title="Editar ítem">✏️</button>
        ${!isDisabled ? `<button class="btn-secondary save-edit" data-id="${i.id}" style="padding:2px 7px;font-size:11px">💾</button>` : ''}
        ${!i.catalog_item_id && !isDisabled ? `<button class="btn-secondary register-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">📋</button>` : ''}
        ${!['Cancelado','En cotización','En proceso','Cerrado'].includes(i.status) && !poLocked ? `<button class="btn-secondary quote-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">📩</button>` : ''}
        ${i.status === 'Autorizado' && i.supplier_id && i.unit_cost && !i.purchase_order_id ? `<button class="btn-primary single-po" data-id="${i.id}" style="padding:2px 7px;font-size:11px">PO</button>` : ''}
        ${i.status === 'En autorización' && i.winning_quote_id && i.supplier_id && i.unit_cost ? `<button class="btn-secondary authorize-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px;color:#16a34a;border-color:#16a34a" title="Autorizar ítem con cotización ganadora">✔ Autorizar</button>` : ''}
        ${!isDisabled && !['Cerrado'].includes(i.status) ? `<button class="btn-danger cancel-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">✖</button>` : ''}
        ${i.status === 'Cancelado' ? `<button class="btn-secondary restore-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px;color:#2563eb" title="Restaurar ítem cancelado">↩</button>` : ''}
      </td>
    </tr>`;
  };

  const bindTableActions = (tableEl, sourceList) => {
    tableEl.querySelectorAll('.save-edit').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.id;
      const supplier_id = tableEl.querySelector(`.edit-supplier[data-id="${id}"]`).value || null;
      const unit_cost = Number(tableEl.querySelector(`.edit-cost[data-id="${id}"]`).value || 0);
      const currency = tableEl.querySelector(`.edit-currency[data-id="${id}"]`).value || 'MXN';
      const quantity = Number(tableEl.querySelector(`.edit-qty[data-id="${id}"]`)?.value || 0);
      const unit = tableEl.querySelector(`.edit-unit[data-id="${id}"]`)?.value || '';
      try {
        await api(`/api/purchases/items/${id}`, { method: 'PATCH', body: JSON.stringify({ supplier_id, unit_cost, currency, quantity, unit }) });
        btn.textContent = '✅'; setTimeout(() => { btn.textContent = '💾'; }, 1500);
        const local = allItems.find(x => Number(x.id) === Number(id));
        if (local) { local.supplier_id = supplier_id ? Number(supplier_id) : null; local.unit_cost = unit_cost; local.currency = currency; local.quantity = quantity; local.unit = unit; }
      } catch (e) { poMsg.textContent = e.message; }
    });
    tableEl.querySelectorAll('.register-item').forEach(btn => btn.onclick = () => {
      const row = sourceList.find(x => Number(x.id) === Number(btn.dataset.id));
      openRegisterCatalog(row);
    });
    tableEl.querySelectorAll('.quote-item').forEach(btn => btn.onclick = () => {
      const row = sourceList.find(x => Number(x.id) === Number(btn.dataset.id));
      openQuotationRequest(row);
    });
    tableEl.querySelectorAll('.single-po').forEach(btn => btn.onclick = async () => {
      try {
        poMsg.textContent = 'Generando PO...';
        const out = await doGeneratePO([btn.dataset.id]);
        poMsg.textContent = out.message;
        setTimeout(render, 1500);
      } catch (e) { poMsg.textContent = e.message; }
    });
    tableEl.querySelectorAll('.authorize-item').forEach(btn => btn.onclick = async () => {
      if (!confirm('¿Autorizar este ítem para generar su PO?')) return;
      try {
        await api(`/api/approvals/items/${btn.dataset.id}/approve`, { method: 'POST', body: JSON.stringify({ comment: 'Autorizado desde módulo Compras' }) });
        btn.textContent = '✅'; setTimeout(render, 800);
      } catch(e) { poMsg.textContent = e.message; }
    });
    tableEl.querySelectorAll('.cancel-item').forEach(btn => btn.onclick = () => {
      const row = sourceList.find(x => Number(x.id) === Number(btn.dataset.id));
      openCancelItem(row);
    });
    tableEl.querySelectorAll('.restore-item').forEach(btn => btn.onclick = async () => {
      if (!confirm('¿Restaurar este ítem cancelado? Regresará al flujo según sus datos actuales.')) return;
      try {
        await api(`/api/purchases/items/${btn.dataset.id}/restore`, { method: 'POST' });
        btn.textContent = '✅'; setTimeout(render, 800);
      } catch(e) { alert(e.message); }
    });
    // Botón lápiz → modal de edición completa
    tableEl.querySelectorAll('.open-edit-modal').forEach(btn => {
      btn.onclick = () => {
        const item = sourceList.find(x => Number(x.id) === Number(btn.dataset.id));
        if (item) openItemEditModal(item);
      };
    });
    // Select all
    const selAll = tableEl.querySelector('#selectAllCheck');
    if (selAll) selAll.onchange = () => tableEl.querySelectorAll('.po-check').forEach(c => c.checked = selAll.checked);
    const selAuth = tableEl.querySelector('#selectAllAuth');
    if (selAuth) selAuth.onclick = () => tableEl.querySelectorAll('.po-check').forEach(c => c.checked = true);
  };

  // Modal de edición completa de ítem (doble clic)
  const openItemEditModal = (item) => {
    // FASE 5: PO Aceptada o avanzada = campo solo lectura en modal también
    const poLocked = ['Aceptada','En proceso','Entregado','Facturada','Facturación parcial','Cerrada'].includes(item.status) && item.purchase_order_id;
    const isLocked = ['Cancelado','Cerrado'].includes(item.status) || poLocked;
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px;width:600px;max-width:96vw;max-height:92vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <h3 style="margin:0 0 4px">✏️ Editar ítem</h3>
        <p style="font-size:12px;color:#6b7280;margin:0 0 18px">Req: <b>${escapeHtml(item.requisition_folio||'-')}</b> · Estado: <b>${escapeHtml(item.status||'-')}</b></p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1/-1">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Descripción del ítem</label>
            <input id="eim-name" value="${escapeHtml(item.item_name||item.manual_item_name||'')}" style="width:100%" ${item.catalog_item_id && !isLocked ? '' : (isLocked ? 'disabled' : '')} placeholder="Nombre del ítem"/>
            ${item.catalog_item_id ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">Ítem de catálogo — solo editable si es manual</div>` : ''}
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Proveedor</label>
            <select id="eim-supplier" style="width:100%" ${isLocked ? 'disabled' : ''}>
              <option value="">Sin proveedor</option>
              ${suppliers.map(s => `<option value="${s.id}" ${Number(item.supplier_id)===s.id?'selected':''}>${escapeHtml(s.business_name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Cantidad</label>
            <input id="eim-qty" type="number" min="0.001" step="any" value="${Number(item.quantity||0)}" style="width:100%" ${isLocked ? 'disabled' : ''}/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Unidad</label>
            <input id="eim-unit" value="${escapeHtml(item.unit||'')}" style="width:100%" ${isLocked ? 'disabled' : ''}/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Precio unitario</label>
            <input id="eim-cost" type="number" min="0" step="any" value="${Number(item.unit_cost||0)}" style="width:100%" ${isLocked || item.winning_quote_id ? 'disabled' : ''}/>
            ${item.winning_quote_id ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">🔒 Asignado por cotización</div>` : ''}
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Moneda</label>
            <select id="eim-currency" style="width:100%" ${isLocked || item.winning_quote_id ? 'disabled' : ''}>
              <option ${(item.currency||'MXN')==='MXN'?'selected':''}>MXN</option>
              <option ${(item.currency||'MXN')==='USD'?'selected':''}>USD</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Centro de costo</label>
            <select id="eim-cc" style="width:100%" ${isLocked ? 'disabled' : ''}>
              <option value="">Sin centro de costo</option>
              ${costCenters.map(c => `<option value="${c.id}" ${Number(item.cost_center_id)===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Sub centro de costo</label>
            <select id="eim-scc" style="width:100%" ${isLocked ? 'disabled' : ''}>
              <option value="">Sin subcentro</option>
              ${sccList.map(s => `<option value="${s.id}" ${Number(item.sub_cost_center_id)===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <div style="grid-column:1/-1">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Comentarios</label>
            <textarea id="eim-comments" style="width:100%;height:60px;resize:vertical" ${isLocked ? 'disabled' : ''}>${escapeHtml(item.comments||'')}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;align-items:center">
          <span id="eim-msg" style="font-size:12px;flex:1"></span>
          <button id="eim-cancel" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:6px 16px;cursor:pointer">Cancelar</button>
          ${!isLocked ? `<button id="eim-save" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:7px 20px;cursor:pointer;font-weight:600">Guardar cambios</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#eim-cancel').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    const saveBtn = modal.querySelector('#eim-save');
    if (saveBtn) saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      const msg = modal.querySelector('#eim-msg');
      const nameVal = modal.querySelector('#eim-name').value.trim();
      try {
        const payload = {
          supplier_id:        modal.querySelector('#eim-supplier').value || null,
          quantity:           Number(modal.querySelector('#eim-qty').value),
          unit:               modal.querySelector('#eim-unit').value.trim(),
          unit_cost:          Number(modal.querySelector('#eim-cost').value),
          currency:           modal.querySelector('#eim-currency').value,
          cost_center_id:     modal.querySelector('#eim-cc').value || null,
          sub_cost_center_id: modal.querySelector('#eim-scc').value || null,
          comments:           modal.querySelector('#eim-comments').value.trim()
        };
        if (!item.catalog_item_id && nameVal) payload.manual_item_name = nameVal;
        await api(`/api/purchases/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        // Actualizar local
        Object.assign(item, payload, {
          item_name: item.catalog_item_id ? item.item_name : (nameVal || item.item_name),
          supplier_id: payload.supplier_id ? Number(payload.supplier_id) : null,
          cost_center_id: payload.cost_center_id ? Number(payload.cost_center_id) : null,
          sub_cost_center_id: payload.sub_cost_center_id ? Number(payload.sub_cost_center_id) : null,
          cost_center_name: (costCenters.find(c => Number(c.id) === Number(payload.cost_center_id))||{}).name || item.cost_center_name
        });
        msg.textContent = '✅ Guardado';
        msg.style.color = '#16a34a';
        setTimeout(() => modal.remove(), 700);
      } catch(e) { msg.textContent = e.message; msg.style.color = '#dc2626'; saveBtn.disabled = false; }
    };
  };

  const generarPOPdf = async (po, supplierName, poViewUrl) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const poData = await api(`/api/purchases/purchase-orders/${po.id}`).catch(() => ({ items: [] }));
    const items = poData.items || [];
    let subtotal = 0;
    items.forEach(l => { subtotal += Number(l.quantity||0) * Number(l.unit_cost||0); });
    const iva = subtotal * 0.16;
    const total = subtotal + iva;
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 18;
    let y = 18;

    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('Corporativo Cuesto', margin, y);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text('ORDEN DE COMPRA', pageW - margin, y, { align: 'right' });
    y += 7;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text(`No. ${po.folio}`, pageW - margin, y, { align: 'right' });
    doc.setDrawColor(180, 180, 180);
    y += 4; doc.line(margin, y, pageW - margin, y); y += 6;

    const fecha = String(po.created_at || '').slice(0, 10);
    const hora = String(po.created_at || '').slice(11, 16);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold'); doc.text('Proveedor:', margin, y);
    doc.setFont('helvetica', 'normal'); doc.text(supplierName || '—', margin + 28, y);
    doc.setFont('helvetica', 'bold'); doc.text('Fecha:', pageW - margin - 60, y);
    doc.setFont('helvetica', 'normal'); doc.text(`${fecha}  ${hora}`, pageW - margin - 40, y);
    y += 6;
    doc.setFont('helvetica', 'bold'); doc.text('Moneda:', margin, y);
    doc.setFont('helvetica', 'normal'); doc.text(po.currency || 'MXN', margin + 22, y);
    doc.setFont('helvetica', 'bold'); doc.text('Solicitó:', pageW - margin - 60, y);
    doc.setFont('helvetica', 'normal'); doc.text(state.user?.name || '—', pageW - margin - 38, y);
    y += 8;

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Código', 'Cant.', 'Unidad', 'Descripción', 'Costo Unit.', 'Total']],
      body: items.map(l => {
        const tot = Number(l.quantity||0) * Number(l.unit_cost||0);
        return [
          l.code || '—',
          String(Number(l.quantity||0)),
          l.unit || '—',
          l.name || l.description || '—',
          `$${Number(l.unit_cost||0).toLocaleString('es-MX',{minimumFractionDigits:2})}`,
          `$${tot.toLocaleString('es-MX',{minimumFractionDigits:2})}`
        ];
      }),
      foot: [
        ['','','','','Subtotal:', `$${subtotal.toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}`],
        ['','','','','IVA (16%):', `$${iva.toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}`],
        ['','','','','Total c/IVA:', `$${total.toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}`],
      ],
      headStyles: { fillColor: [219, 234, 254], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: [0, 0, 0] },
      footStyles: { fontStyle: 'bold', fontSize: 9, fillColor: [241, 245, 249], textColor: [0, 0, 0] },
      columnStyles: { 0:{cellWidth:20}, 1:{cellWidth:14,halign:'right'}, 2:{cellWidth:18}, 3:{cellWidth:'auto'}, 4:{cellWidth:30,halign:'right'}, 5:{cellWidth:30,halign:'right'} },
      showFoot: 'lastPage',
    });

    y = doc.lastAutoTable.finalY + 14;
    const col1 = margin + 8;
    const col2 = pageW - margin - 58;
    doc.setDrawColor(80, 80, 80);
    doc.line(col1, y, col1 + 50, y);
    doc.line(col2, y, col2 + 50, y);
    y += 4;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Autorizó', col1 + 25, y, { align: 'center' });
    doc.text(`Solicitó: ${state.user?.name || '—'}`, col2 + 25, y, { align: 'center' });

    if (poViewUrl) {
      y += 10;
      doc.setFontSize(8); doc.setTextColor(37, 99, 235);
      doc.text(`Seguimiento proveedor: ${poViewUrl}`, margin, y);
      doc.setTextColor(0, 0, 0);
    }

    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(160, 160, 160);
    doc.text(`Generado: ${new Date().toLocaleString('es-MX')} · Sistema de Compras Corporativo Cuesto`, pageW / 2, pageH - 8, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    doc.save(`PO-${po.folio}.pdf`);
  };

  const THEAD = `<thead><tr>
    <th style="width:32px"><input type="checkbox" id="selectAllCheck"/></th>
    <th>Req.</th><th>Ítem</th><th>Proveedor</th>
    <th>Cant.</th><th>Unidad</th><th>Costo U.</th><th>Total</th><th>Mon.</th>
    <th>Solicitado por</th><th>C. Costo</th><th>Fecha</th>
    <th>Estatus</th><th>PO</th><th>Acciones</th>
  </tr></thead>`;

  // Agrupa ítems por requisición e inserta fila de encabezado por grupo
  const renderGrouped = (items) => {
    const gMap = new Map();
    items.forEach(i => {
      const key = i.requisition_folio || 'Sin requisición';
      if (!gMap.has(key)) gMap.set(key, { folio: key, requester: i.requester_name, date: i.request_date, items: [] });
      gMap.get(key).items.push(i);
    });
    return [...gMap.values()].map(g => {
      const gTotal = g.items.reduce((s, i) => s + Number(i.quantity||0) * Number(i.unit_cost||0), 0);
      return `
        <tr style="background:#f1f5f9;border-top:2px solid #cbd5e1">
          <td colspan="15" style="padding:5px 10px">
            <b style="font-size:13px">📋 ${escapeHtml(g.folio)}</b>
            <span class="muted" style="font-size:12px"> · ${escapeHtml(g.requester || '-')}</span>
            <span style="font-size:11px;color:#9ca3af;margin-left:6px">${g.items.length} ítem(s)</span>
            <b style="float:right;font-size:12px">$${gTotal.toLocaleString('es-MX',{minimumFractionDigits:2})}</b>
          </td>
        </tr>
        ${g.items.map(i => itemRow(i, true)).join('')}
      `;
    }).join('');
  };

  const renderTab = async (tab) => {
    activeTab = tab;
    sessionStorage.setItem('compras_active_tab', tab);
    // Update tab styles
    document.querySelectorAll('.tab-btn').forEach(b => {
      const isActive = b.dataset.tab === tab;
      b.style.fontWeight = isActive ? '600' : '400';
      b.style.color = isActive ? '#1d4ed8' : '#6b7280';
      b.style.borderBottom = isActive ? '2px solid #3b82f6' : '2px solid transparent';
    });

    const showPOActions = tab === 'pendientes' || tab === 'solicitados';
    poActions.style.display = showPOActions ? 'flex' : 'none';

    if (tab === 'pendientes') {
      const authCount = itemsPendientePO.filter(x => x.status === 'Autorizado').length;
      const waitingAuthCount = itemsPendientePO.filter(x => x.status === 'En autorización').length;
      tabContent.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><input id="filterItemsTab" placeholder="Buscar ítem, proveedor..." style="flex:1;min-width:150px"/></div>
        <div style="margin-bottom:8px;font-size:13px">
          ${itemsPendientePO.length} ítem(s) con proveedor y costo · <b>${authCount}</b> autorizado(s)
          ${waitingAuthCount > 0 ? `<span style="margin-left:8px;color:#f59e0b">⏳ ${waitingAuthCount} esperando autorización — usa el botón <b>✔ Autorizar</b> en "Todos los ítems" o ve a <b>Autorizaciones</b></span>` : ''}
          ${authCount > 0 ? `<button class="btn-secondary" id="selectAllAuth" style="margin-left:10px;padding:2px 8px;font-size:12px">Seleccionar autorizados</button>` : ''}
        </div>
        <div id="pendientesTableWrap"><div class="table-wrap"><table>${THEAD}<tbody>
          ${itemsPendientePO.length ? itemsPendientePO.map(i => itemRow(i, true)).join('') : '<tr><td colspan="12" class="muted" style="text-align:center;padding:16px">Sin ítems listos para PO.<br><small>Los ítems deben tener proveedor y costo asignados.</small></td></tr>'}
        </tbody></table></div></div>
        ${waitingAuthCount > 0 ? `
        <div style="margin-top:12px;display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a">
          <span style="font-size:13px;color:#92400e">⏳ <b>${waitingAuthCount}</b> ítem(s) pendientes de autorización</span>
          <button class="btn-secondary" id="pendPORequestAuthBtn" style="font-size:12px;padding:5px 12px">📧 Solicitar autorización</button>
        </div>` : ''}`;
      bindTableActions(tabContent, itemsPendientePO);
      document.getElementById('pendPORequestAuthBtn')?.addEventListener('click', async () => {
        try {
          const out = await api('/api/approvals/request-auth-mailto');
          if (!out.mailto) { alert('No hay ítems pendientes de autorización.'); return; }
          const a = document.createElement('a'); a.href = out.mailto; a.click();
        } catch(e) { alert('Error al generar el correo.'); }
      });
      document.getElementById('filterItemsTab').oninput = e => {
        const val = e.target.value.toLowerCase();
        const filtered = itemsPendientePO.filter(x => !val ||
          (x.item_name||'').toLowerCase().includes(val) ||
          (x.supplier_name||'').toLowerCase().includes(val) ||
          (x.requisition_folio||'').toLowerCase().includes(val) ||
          (x.cost_center_name||'').toLowerCase().includes(val) ||
          (x.requester_name||'').toLowerCase().includes(val) ||
          (x.status||'').toLowerCase().includes(val));
        const wrap = document.getElementById('pendientesTableWrap');
        wrap.innerHTML = `<div class="table-wrap"><table>${THEAD}<tbody>${filtered.length ? filtered.map(i => itemRow(i, true)).join('') : '<tr><td colspan="12" class="muted" style="text-align:center;padding:16px">Sin resultados</td></tr>'}</tbody></table></div>`;
        bindTableActions(wrap, itemsPendientePO);
      };

    } else if (tab === 'cotizacion') {
      poActions.style.display = 'none';

      // Enriquecer con sub-status derivado de solicitudes/cotizaciones
      const subStatusLabel = (s) => ({
        por_solicitar: 'Por solicitar',
        solicitada: 'Solicitada',
        cotizado: 'Cotizado',
        rechazado_proveedor: 'Rechazado por proveedor'
      })[s] || 'Por solicitar';

      const subStatusColor = (s) => ({
        por_solicitar: '#6b7280',
        solicitada: '#2563eb',
        cotizado: '#16a34a',
        rechazado_proveedor: '#dc2626'
      })[s] || '#6b7280';

      let expandedCotizId = null;
      let cotizFilterText = '';

      const renderCotizTab = async () => {
        const rows = itemsEnCotizacion.filter(i => !cotizFilterText ||
          (i.item_name||'').toLowerCase().includes(cotizFilterText) ||
          (i.requisition_folio||'').toLowerCase().includes(cotizFilterText) ||
          (i.quote_sub_status||'').toLowerCase().includes(cotizFilterText));
        tabContent.innerHTML = `
          <div style="display:flex;gap:8px;margin-bottom:10px"><input id="filterCotizTab" placeholder="Buscar ítem, folio de req..." value="${cotizFilterText}" style="flex:1;min-width:150px"/></div>` +
          (rows.length ? `
          <div class="table-wrap"><table>
            <thead><tr>
              <th>Req.</th><th>Ítem</th><th>Cant.</th><th>Unidad</th><th>Estatus solicitud</th><th>Acciones</th>
            </tr></thead>
            <tbody id="cotizTbody">
              ${rows.map(i => {
                const ssl = subStatusLabel(i.quote_sub_status);
                const ssc = subStatusColor(i.quote_sub_status);
                return `<tr class="cotiz-row" data-id="${i.id}" style="cursor:pointer">
                  <td style="font-size:11px">${i.requisition_folio||'-'}</td>
                  <td><b>${escapeHtml(i.item_name)}</b></td>
                  <td>${Number(i.quantity||0)}</td>
                  <td>${i.unit||'-'}</td>
                  <td><span style="color:${ssc};font-weight:600;font-size:12px">● ${ssl}</span></td>
                  <td style="white-space:nowrap">
                    ${i.quote_sub_status === 'por_solicitar' || i.quote_sub_status === 'rechazado_proveedor'
                      ? `<button class="btn-secondary re-quote-item" data-id="${i.id}" style="padding:2px 8px;font-size:12px">📩 ${i.quote_sub_status === 'rechazado_proveedor' ? 'Nuevo proveedor' : 'Solicitar'}</button>`
                      : ''}
                    <button class="btn-primary register-quote-btn" data-id="${i.id}" style="padding:2px 8px;font-size:12px">📋 Registrar cotización</button>
                    <button class="btn-secondary view-quotes-btn" data-id="${i.id}" style="padding:2px 8px;font-size:12px">🔍 Ver cotizaciones</button>
                    <button class="btn-danger cancel-item" data-id="${i.id}" style="padding:2px 8px;font-size:12px">✖</button>
                  </td>
                </tr>
                <tr id="cotiz-detail-${i.id}" style="display:none"><td colspan="6" style="padding:0;background:#f8fafc;border-top:1px solid #e5e7eb"></td></tr>`;
              }).join('')}
            </tbody>
          </table></div>` :
          '<div class="muted small" style="padding:24px;text-align:center">Sin ítems en cotización ✅</div>');

        const filterCotizEl = document.getElementById('filterCotizTab');
        if (filterCotizEl) filterCotizEl.oninput = e => { cotizFilterText = e.target.value.toLowerCase(); renderCotizTab(); };

        tabContent.querySelectorAll('.re-quote-item').forEach(btn => {
          btn.onclick = () => openQuotationRequest(itemsEnCotizacion.find(x => Number(x.id) === Number(btn.dataset.id)));
        });
        tabContent.querySelectorAll('.cancel-item').forEach(btn => {
          btn.onclick = () => openCancelItem(itemsEnCotizacion.find(x => Number(x.id) === Number(btn.dataset.id)));
        });

        tabContent.querySelectorAll('.register-quote-btn').forEach(btn => {
          btn.onclick = async () => {
            const item = itemsEnCotizacion.find(x => Number(x.id) === Number(btn.dataset.id));
            if (!item) return;
            const suppliersData = await api('/api/catalogs/suppliers').catch(() => []);

            const overlay = document.createElement('div');
            overlay.id = 'registerQuoteOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;z-index:10000;overflow-y:auto;padding:32px 16px';
            overlay.innerHTML = `<div style="background:white;border-radius:12px;padding:24px;width:100%;max-width:540px;box-shadow:0 16px 48px rgba(0,0,0,.18)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;font-size:16px">📋 Registrar cotización</h3>
                <button id="closeRegisterModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">×</button>
              </div>
              <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px">
                <b>${escapeHtml(item.item_name)}</b><br>
                <span class="muted">${item.requisition_folio||'-'} · Cant: ${Number(item.quantity||0)} ${item.unit||''}</span>
              </div>
              <div style="margin-bottom:10px">
                <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Proveedor *</label>
                <select id="rqSupplier" style="width:100%">
                  <option value="">— Selecciona proveedor —</option>
                  <option value="__new__">➕ Crear proveedor nuevo…</option>
                  ${suppliersData.map(s => `<option value="${s.id}">${escapeHtml(s.business_name)}</option>`).join('')}
                </select>
                <div id="rqNewSupplierForm" style="display:none;margin-top:8px;background:#f8faff;border:1px solid #bae6fd;border-radius:8px;padding:12px">
                  <div style="font-weight:600;font-size:13px;margin-bottom:8px">➕ Nuevo proveedor</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
                    <div><label style="font-size:12px">Nombre / Razón social *</label><input id="rq-ns-name" placeholder="Razón social" style="width:100%"/></div>
                    <div><label style="font-size:12px">RFC</label><input id="rq-ns-rfc" placeholder="RFC" style="width:100%"/></div>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
                    <div><label style="font-size:12px">Contacto</label><input id="rq-ns-contact" placeholder="Nombre" style="width:100%"/></div>
                    <div><label style="font-size:12px">Email</label><input id="rq-ns-email" type="email" placeholder="correo@empresa.com" style="width:100%"/></div>
                    <div><label style="font-size:12px">Teléfono</label><input id="rq-ns-phone" placeholder="55 1234 5678" style="width:100%"/></div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center">
                    <button id="rqSaveNewSupplierBtn" class="btn-primary" style="font-size:12px">Guardar proveedor</button>
                    <button id="rqCancelNewSupplierBtn" class="btn-secondary" style="font-size:12px">Cancelar</button>
                    <span id="rqNsMsg" class="small muted"></span>
                  </div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
                <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">No. cotización</label><input id="rqNumber" placeholder="COT-001" style="width:100%"/></div>
                <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Días entrega</label><input id="rqDays" type="number" placeholder="0" style="width:100%"/></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
                <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Costo unitario *</label><input id="rqUnitCost" type="number" placeholder="0.00" style="width:100%"/></div>
                <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Moneda</label><select id="rqCurrency" style="width:100%"><option>MXN</option><option>USD</option></select></div>
                <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Cond. de pago</label><input id="rqPayTerms" placeholder="30 días" style="width:100%"/></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
                <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Código proveedor</label><input id="rqCode" placeholder="SKU" style="width:100%"/></div>
                <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Nombre oficial del ítem</label><input id="rqName" placeholder="Nombre oficial" value="${escapeHtml(item.item_name||'')}" style="width:100%"/></div>
              </div>
              <div style="margin-bottom:16px">
                <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">📎 Adjuntar cotización (PDF/imagen, máx 10 MB)</label>
                <input type="file" id="rqFile" accept=".pdf,.jpg,.jpeg,.png" style="font-size:12px;display:block"/>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button id="rqSaveAndApproveBtn" class="btn-primary">✅ Guardar y aprobar como ganadora</button>
                <button id="rqSaveBtn" class="btn-secondary">Guardar sin aprobar</button>
                <button id="rqCancelBtn" class="btn-secondary">Cancelar</button>
                <span id="rqMsg" class="small muted" style="flex:1"></span>
              </div>
            </div>`;
            document.body.appendChild(overlay);

            const closeModal = () => overlay.remove();
            document.getElementById('closeRegisterModal').onclick = closeModal;
            document.getElementById('rqCancelBtn').onclick = closeModal;
            overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

            // Mostrar / ocultar form nuevo proveedor
            const rqSupplier = document.getElementById('rqSupplier');
            rqSupplier.onchange = () => {
              const nf = document.getElementById('rqNewSupplierForm');
              if (rqSupplier.value === '__new__') {
                nf.style.display = '';
                document.getElementById('rq-ns-name').focus();
              } else {
                nf.style.display = 'none';
                const sup = suppliersData.find(s => s.id === Number(rqSupplier.value));
                if (sup?.provider_code) document.getElementById('rqCode').value = sup.provider_code;
              }
            };

            // Guardar nuevo proveedor
            document.getElementById('rqSaveNewSupplierBtn').onclick = async () => {
              const nsMsg = document.getElementById('rqNsMsg');
              const name = document.getElementById('rq-ns-name').value.trim();
              if (!name) { nsMsg.textContent = 'Nombre requerido'; nsMsg.style.color = '#dc2626'; return; }
              try {
                nsMsg.textContent = 'Guardando...'; nsMsg.style.color = '#6b7280';
                const ns = await api('/api/catalogs/suppliers', { method: 'POST', body: JSON.stringify({
                  business_name: name,
                  rfc: document.getElementById('rq-ns-rfc').value.trim(),
                  contact_name: document.getElementById('rq-ns-contact').value.trim(),
                  email: document.getElementById('rq-ns-email').value.trim(),
                  phone: document.getElementById('rq-ns-phone').value.trim()
                })});
                suppliersData.push(ns);
                const opt = document.createElement('option');
                opt.value = ns.id; opt.textContent = ns.business_name;
                rqSupplier.appendChild(opt);
                rqSupplier.value = ns.id;
                document.getElementById('rqNewSupplierForm').style.display = 'none';
                nsMsg.textContent = '';
              } catch(e) { nsMsg.textContent = e.message; nsMsg.style.color = '#dc2626'; }
            };
            document.getElementById('rqCancelNewSupplierBtn').onclick = () => {
              document.getElementById('rqNewSupplierForm').style.display = 'none';
              rqSupplier.value = '';
            };

            // Guardar cotización (con opción de aprobar como ganadora)
            const doSaveQuote = async (autoApprove) => {
              const msgEl = document.getElementById('rqMsg');
              const saveBtn = document.getElementById(autoApprove ? 'rqSaveAndApproveBtn' : 'rqSaveBtn');
              const unitCost = document.getElementById('rqUnitCost');
              if (!rqSupplier.value || rqSupplier.value === '__new__') { msgEl.textContent = 'Selecciona o guarda primero un proveedor'; msgEl.style.color = '#dc2626'; return; }
              if (!unitCost.value || Number(unitCost.value) <= 0) { msgEl.textContent = 'Ingresa costo mayor a cero'; msgEl.style.color = '#dc2626'; return; }
              msgEl.textContent = autoApprove ? 'Guardando y aprobando...' : 'Guardando...'; msgEl.style.color = '#6b7280';
              document.getElementById('rqSaveBtn').disabled = true;
              document.getElementById('rqSaveAndApproveBtn').disabled = true;
              try {
                const rqFile = document.getElementById('rqFile');
                if (rqFile && rqFile.files[0]) {
                  const fd = new FormData();
                  fd.append('requisition_item_id', item.id);
                  fd.append('supplier_id', rqSupplier.value);
                  fd.append('quote_number', document.getElementById('rqNumber').value);
                  fd.append('delivery_days', document.getElementById('rqDays').value || 0);
                  fd.append('unit_cost', unitCost.value);
                  fd.append('currency', document.getElementById('rqCurrency').value || 'MXN');
                  fd.append('payment_terms', document.getElementById('rqPayTerms').value);
                  fd.append('provider_code', document.getElementById('rqCode').value);
                  fd.append('official_item_name', document.getElementById('rqName').value);
                  fd.append('auto_select_winner', autoApprove ? 'true' : 'false');
                  fd.append('attachment', rqFile.files[0]);
                  const res = await fetch('/api/quotations', { method: 'POST', credentials: 'include', body: fd });
                  if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
                } else {
                  await api('/api/quotations', { method: 'POST', body: JSON.stringify({
                    requisition_item_id: Number(item.id),
                    supplier_id: Number(rqSupplier.value),
                    quote_number: document.getElementById('rqNumber').value,
                    delivery_days: Number(document.getElementById('rqDays').value || 0),
                    unit_cost: Number(unitCost.value),
                    currency: document.getElementById('rqCurrency').value || 'MXN',
                    payment_terms: document.getElementById('rqPayTerms').value,
                    provider_code: document.getElementById('rqCode').value,
                    official_item_name: document.getElementById('rqName').value,
                    auto_select_winner: autoApprove
                  })});
                }
                msgEl.textContent = autoApprove ? '✅ Cotización guardada y aprobada como ganadora' : '✅ Cotización guardada';
                msgEl.style.color = '#16a34a';
                setTimeout(() => { closeModal(); renderCotizTab(); }, 900);
              } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; document.getElementById('rqSaveBtn').disabled = false; document.getElementById('rqSaveAndApproveBtn').disabled = false; }
            };
            document.getElementById('rqSaveBtn').onclick = () => doSaveQuote(false);
            document.getElementById('rqSaveAndApproveBtn').onclick = () => doSaveQuote(true);
          };
        });

        tabContent.querySelectorAll('.view-quotes-btn').forEach(btn => {
          btn.onclick = async () => {
            const itemId = Number(btn.dataset.id);
            const detailRow = document.getElementById(`cotiz-detail-${itemId}`);
            if (detailRow.style.display !== 'none') { detailRow.style.display = 'none'; return; }
            // Hide other expanded rows
            tabContent.querySelectorAll('[id^="cotiz-detail-"]').forEach(r => r.style.display = 'none');
            detailRow.style.display = '';
            const td = detailRow.querySelector('td');
            td.innerHTML = '<div class="muted small" style="padding:12px">Cargando cotizaciones...</div>';

            try {
              const detail = await api(`/api/quotations/item-detail/${itemId}`);
              const item = itemsEnCotizacion.find(x => x.id === itemId);
              if (!detail.length) {
                td.innerHTML = `<div style="padding:12px">
                  <p class="small muted">Sin solicitudes enviadas aún.</p>
                  <button class="btn-primary do-request-btn" data-id="${itemId}" style="font-size:12px;padding:4px 12px">📩 Solicitar cotización</button>
                </div>`;
                td.querySelector('.do-request-btn').onclick = () => { detailRow.style.display='none'; openQuotationRequest(item); };
                return;
              }

              td.innerHTML = `<div style="padding:12px">
                <h4 style="margin:0 0 10px;font-size:13px">Cotizaciones de <b>${escapeHtml(item?.item_name||'')}</b></h4>
                <div style="display:flex;flex-direction:column;gap:8px">
                  ${detail.map(req => {
                    const q = req.quote;
                    const isRejected = req.status === 'Rechazada';
                    return `<div style="border:1px solid ${isRejected?'#fca5a5':q?'#bbf7d0':'#e5e7eb'};border-radius:8px;padding:10px;background:${isRejected?'#fff5f5':q?'#f0fff4':'#fafafa'}">
                      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px">
                        <div>
                          <b style="font-size:13px">${escapeHtml(req.supplier_name)}</b>
                          ${isRejected ? '<span style="color:#dc2626;font-size:12px;margin-left:8px">✖ Rechazado por el proveedor</span>' : ''}
                          ${!q && !isRejected ? '<span style="color:#f59e0b;font-size:12px;margin-left:8px">⏳ Esperando respuesta</span>' : ''}
                          ${q ? `<span style="color:#16a34a;font-size:12px;margin-left:8px">✅ Cotización recibida</span>` : ''}
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                          ${isRejected ? `<button class="btn-secondary re-quote-btn" data-id="${itemId}" style="font-size:12px;padding:3px 10px">📩 Nuevo proveedor</button>` : ''}
                          ${q && !q.is_winner ? `<button class="btn-primary approve-quote-btn" data-qid="${q.id}" data-iid="${itemId}" style="font-size:12px;padding:3px 10px">✅ Aprobar</button>` : ''}
                          ${q?.is_winner ? `<span style="color:#16a34a;font-size:12px;font-weight:700">⭐ Ganadora</span>` : ''}
                        </div>
                      </div>
                      ${q ? `<div style="margin-top:6px;font-size:12px;display:flex;gap:16px;flex-wrap:wrap">
                        <span>💰 <b>$${Number(q.unit_cost||0).toFixed(2)} ${q.currency||'MXN'}</b></span>
                        <span>🚚 ${q.delivery_days||0} días</span>
                        ${q.payment_terms ? `<span>💳 ${escapeHtml(q.payment_terms)}</span>` : ''}
                        ${q.quote_number ? `<span>No. ${escapeHtml(q.quote_number)}</span>` : ''}
                        ${q.attachment_path ? `<a href="${q.attachment_path}" target="_blank" style="font-size:12px">📎 Ver cotización</a>` : ''}
                      </div>` : ''}
                    </div>`;
                  }).join('')}
                </div>
                <div style="margin-top:10px;display:flex;gap:8px">
                  <button class="btn-secondary re-quote-btn" data-id="${itemId}" style="font-size:12px;padding:4px 12px">📩 Solicitar a nuevo proveedor</button>
                </div>
                <div id="cotiz-panel-msg-${itemId}" class="small muted" style="margin-top:6px"></div>
              </div>`;

              // Aprobar cotización (select-winner)
              td.querySelectorAll('.approve-quote-btn').forEach(ab => {
                ab.onclick = async () => {
                  if (!confirm('¿Aprobar esta cotización como ganadora? Las otras solicitudes pendientes se cancelarán automáticamente.')) return;
                  try {
                    ab.disabled = true;
                    await api(`/api/quotations/${ab.dataset.qid}/select-winner`, { method: 'POST' });
                    document.getElementById(`cotiz-panel-msg-${ab.dataset.iid}`).textContent = '✅ Cotización aprobada. Ítem pasó a Pendientes de PO.';
                    setTimeout(render, 1200);
                  } catch(e) {
                    document.getElementById(`cotiz-panel-msg-${ab.dataset.iid}`).textContent = e.message;
                    document.getElementById(`cotiz-panel-msg-${ab.dataset.iid}`).style.color = '#dc2626';
                    ab.disabled = false;
                  }
                };
              });

              // Re-cotizar con nuevo proveedor
              td.querySelectorAll('.re-quote-btn').forEach(rb => {
                rb.onclick = () => { detailRow.style.display='none'; openQuotationRequest(itemsEnCotizacion.find(x => x.id === Number(rb.dataset.id))); };
              });

            } catch(e) {
              td.innerHTML = `<div style="padding:12px;color:#dc2626">Error al cargar: ${e.message}</div>`;
            }
          };
        });
      };

      renderCotizTab();

    } else if (tab === 'solicitados') {
      const rejectedSection = rejectedItems.length ? `
  <div style="margin-top:20px;border-top:2px solid #fca5a5;padding-top:14px">
    <div style="font-weight:700;color:#dc2626;margin-bottom:8px">🚫 Ítems rechazados (${rejectedItems.length})</div>
    <table>
      <thead><tr><th>Folio Req.</th><th>Ítem</th><th>Motivo de rechazo</th><th>Proveedor</th><th>Costo</th></tr></thead>
      <tbody>
        ${rejectedItems.map(it => `<tr style="background:#fef2f2;color:#7f1d1d">
          <td style="font-size:12px">${it.requisition_folio||'-'}</td>
          <td style="font-size:12px"><s>${it.item_name||'-'}</s></td>
          <td style="font-size:12px">${it.reject_reason||'Sin motivo'}</td>
          <td style="font-size:12px">${it.supplier_name||'-'}</td>
          <td style="font-size:12px">$${Number(it.unit_cost||0).toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : '';
      tabContent.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
          <input id="filterTextItems" placeholder="🔍 Buscar ítem, proveedor, folio, C. costo..." style="flex:2;min-width:200px"/>
          <select id="filterSupplierItems"><option value="">Todos los proveedores</option>${suppliers.map(s=>`<option value="${s.id}">${s.business_name}</option>`).join('')}</select>
          <select id="filterStatusItems"><option value="">Todos los estatus</option><option>En cotización</option><option>En autorización</option><option>Autorizado</option><option>En proceso</option><option>Entregado</option><option>Facturado</option></select>
          <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="toggleCancelled" ${showCancelled?'checked':''}/>
            Mostrar cancelados
          </label>
        </div>
        <div id="allItemsTable">
          <div class="table-wrap"><table>${THEAD}<tbody>
            ${renderGrouped(itemsSolicitados)}
          </tbody></table></div>
        </div>
        ${rejectedSection}`;
      bindTableActions(tabContent, itemsSolicitados);

      const applyFilters = () => {
        const sid = Number(document.getElementById('filterSupplierItems')?.value || 0);
        const statusVal = document.getElementById('filterStatusItems')?.value || '';
        const textVal = (document.getElementById('filterTextItems')?.value || '').toLowerCase();
        const inclCanc = document.getElementById('toggleCancelled')?.checked;
        const src = inclCanc ? allItems : itemsSolicitados;
        const filtered = src.filter(x =>
          (!sid || Number(x.supplier_id) === sid) &&
          (!statusVal || x.status === statusVal) &&
          (!textVal || (x.item_name||'').toLowerCase().includes(textVal) || (x.supplier_name||'').toLowerCase().includes(textVal) || (x.requisition_folio||'').toLowerCase().includes(textVal) || (x.cost_center_name||'').toLowerCase().includes(textVal) || (x.requester_name||'').toLowerCase().includes(textVal))
        );
        allItemsTable.innerHTML = `<div class="table-wrap"><table>${THEAD}<tbody>${renderGrouped(filtered)}</tbody></table></div>`;
        bindTableActions(allItemsTable, src);
      };
      document.getElementById('filterTextItems').oninput = applyFilters;
      document.getElementById('filterSupplierItems').onchange = applyFilters;
      document.getElementById('filterStatusItems').onchange = applyFilters;
      document.getElementById('toggleCancelled').onchange = async (e) => {
        showCancelled = e.target.checked;
        // Recargar ítems con/sin cancelados
        const fresh = await api(`/api/purchases/pending-items${showCancelled ? '?show_cancelled=true' : ''}`);
        allItems.length = 0; fresh.forEach(x => allItems.push(x));
        applyFilters();
      };

    } else if (tab === 'pos') {
      poActions.style.display = 'none';
      const STATUS_ORDER = ['Enviada','Aceptada','En proceso','Entregado','Facturada','Cerrada','Rechazada por proveedor'];
      const STATUS_NEXT = { 'Enviada': 'En proceso', 'Aceptada': 'En proceso', 'En proceso': 'Entregado' };
      const STATUS_LABEL_BTN = { 'Enviada': '▶ Marcar En proceso', 'Aceptada': '▶ Marcar En proceso', 'En proceso': '✅ Marcar Entregado' };

      // Filtros y ordenamiento de POs
      tabContent.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
          <input id="poFiltTexto" placeholder="🔍 Folio, proveedor..." style="flex:2;min-width:150px"/>
          <input id="poFiltSolicitante" placeholder="🔍 Solicitante" style="flex:1;min-width:130px"/>
          <input id="poFiltCC" placeholder="🔍 Centro de costo" style="flex:1;min-width:130px"/>
          <input id="poFiltDesde" type="date" title="Desde" style="width:130px"/>
          <input id="poFiltHasta" type="date" title="Hasta" style="width:130px"/>
          <select id="poFiltOrden" style="min-width:140px">
            <option value="date_desc">Fecha más reciente</option>
            <option value="date_asc">Fecha más antigua</option>
            <option value="requester">Solicitante A-Z</option>
            <option value="cc">C. Costo A-Z</option>
          </select>
          <button class="btn-primary" id="poFiltBtn" style="font-size:12px;padding:5px 12px">Filtrar</button>
        </div>
        <div id="posContainer"></div>`;

      const renderPos = () => {
        let filtered = pos.filter(p => p.status !== 'Cancelada');
        const txt = document.getElementById('poFiltTexto')?.value.trim().toLowerCase();
        const sol = document.getElementById('poFiltSolicitante')?.value.trim().toLowerCase();
        const cc  = document.getElementById('poFiltCC')?.value.trim().toLowerCase();
        if (txt)   filtered = filtered.filter(p => (p.folio||'').toLowerCase().includes(txt) || (p.supplier_name||'').toLowerCase().includes(txt));
        const desde = document.getElementById('poFiltDesde')?.value;
        const hasta = document.getElementById('poFiltHasta')?.value;
        if (sol)   filtered = filtered.filter(p => (p.requester_name||'').toLowerCase().includes(sol));
        if (cc)    filtered = filtered.filter(p => (p.cost_center_name||'').toLowerCase().includes(cc));
        if (desde) filtered = filtered.filter(p => String(p.created_at||'').slice(0,10) >= desde);
        if (hasta) filtered = filtered.filter(p => String(p.created_at||'').slice(0,10) <= hasta);
        const orden = document.getElementById('poFiltOrden')?.value || 'date_desc';
        filtered.sort((a,b) => {
          if (orden === 'date_asc')  return String(a.created_at||'').localeCompare(String(b.created_at||''));
          if (orden === 'date_desc') return String(b.created_at||'').localeCompare(String(a.created_at||''));
          if (orden === 'requester') return (a.requester_name||'').localeCompare(b.requester_name||'');
          if (orden === 'cc')        return (a.cost_center_name||'').localeCompare(b.cost_center_name||'');
          return 0;
        });
        document.getElementById('posContainer').innerHTML = filtered.length ? filtered.map(p => {
        const nextS = STATUS_NEXT[p.status];
        const btnLabel = STATUS_LABEL_BTN[p.status];
        const canRequestInvoice = p.status === 'Entregado' && !p.invoice_requested;
        const invoiceRequested = p.invoice_requested;
        const canManualInvoice = p.status === 'Entregado';
        const canCancel = !['Facturada','Facturación parcial','Cerrada','Cancelada','Rechazada por proveedor'].includes(p.status);
        // FASE 3: Reabrir ítems a "En Autorización" para POs rechazadas o canceladas
        const canReopen = ['Cancelada','Rechazada por proveedor'].includes(p.status);
        const respTag = p.supplier_response ? `<span style="font-size:11px;color:#6b7280"> · Proveedor: ${p.supplier_response}</span>` : '';
        const commitTag = p.supplier_commitment_date ? `<span style="font-size:11px;margin-left:8px;padding:2px 8px;border-radius:10px;background:#d1fae5;color:#065f46">📅 Compromiso proveedor: ${p.supplier_commitment_date}</span>` : '';
        const reqTag = invoiceRequested ? `<span style="font-size:11px;color:#2563eb;margin-left:8px">📧 Factura solicitada al proveedor</span>` : '';
        // Anticipo
        const advancePct = Number(p.advance_percentage || 0);
        const advanceAmt = Number(p.advance_amount || 0);
        const advStatus = p.advance_status || 'N/A';
        const canRequestAdvance = advancePct > 0 && ['Pendiente','Solicitado'].includes(advStatus) && ['Enviada','Aceptada','En proceso'].includes(p.status);
        const advanceTag = advancePct > 0 ? `<span style="font-size:11px;margin-left:8px;padding:2px 8px;border-radius:10px;background:${advStatus==='Pagado'?'#dcfce7':advStatus==='Facturado'?'#fef9c3':advStatus==='Solicitado'?'#dbeafe':'#f3f4f6'};color:${advStatus==='Pagado'?'#15803d':advStatus==='Facturado'?'#854d0e':advStatus==='Solicitado'?'#1d4ed8':'#6b7280'}">💰 Anticipo ${advancePct}% ${advStatus==='Pagado'?'· Pagado $'+advanceAmt.toLocaleString('es-MX',{minimumFractionDigits:2}):advStatus==='Facturado'?'· Factura recibida':advStatus==='Solicitado'?'· Solicitado':'· Pendiente de solicitar'}</span>` : '';
        return `
        <div class="card section" style="margin-bottom:12px" id="po-card-${p.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <div>
              <b style="font-size:15px">${p.folio}</b>
              <span style="margin-left:10px;color:#6b7280">${p.supplier_name}</span>
              ${respTag}${commitTag}${reqTag}${advanceTag}
              <div style="font-size:11px;color:#6b7280;margin-top:3px">
                ${p.requester_name ? `👤 ${escapeHtml(p.requester_name)}` : ''}
                ${p.cost_center_name ? ` · 🏷 ${escapeHtml(p.cost_center_name)}` : ''}
                ${p.request_date ? ` · 📅 ${p.request_date}` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${statusPill(p.status)}
              <b>$${Number(p.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${p.currency||'MXN'}</b>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            ${nextS ? `<button class="btn-primary po-advance-btn" data-id="${p.id}" data-status="${nextS}" style="font-size:12px;padding:5px 12px">${btnLabel}</button>` : ''}
            ${canRequestAdvance ? `<button class="btn-secondary po-req-advance-btn" data-id="${p.id}" data-pct="${advancePct}" data-amt="${advanceAmt}" style="font-size:12px;padding:5px 12px">💰 Solicitar anticipo (${advancePct}%)</button>` : ''}
            ${canRequestInvoice ? `<button class="btn-secondary po-req-invoice-btn" data-id="${p.id}" style="font-size:12px;padding:5px 12px">📧 Solicitar factura al proveedor</button>` : ''}
            ${canManualInvoice ? `<button class="btn-secondary po-manual-invoice-btn" data-id="${p.id}" data-supplier="${p.supplier_id}" style="font-size:12px;padding:5px 12px;color:#6b7280">🧾 Registrar manualmente</button>` : ''}
            ${canCancel ? `<button class="btn-danger po-cancel-btn" data-id="${p.id}" data-folio="${p.folio}" style="font-size:12px;padding:5px 12px">✖ Cancelar PO</button>` : ''}
            ${canReopen ? `<button class="btn-secondary po-reopen-btn" data-id="${p.id}" data-folio="${p.folio}" style="font-size:12px;padding:5px 12px;color:#7c3aed;border-color:#7c3aed">↩ Reabrir ítems</button>` : ''}
            <button class="btn-secondary po-print-btn" data-id="${p.id}" style="font-size:12px;padding:5px 12px">🖨 Ver/Imprimir PO</button>
            <button class="btn-secondary po-items-btn" data-id="${p.id}" style="font-size:12px;padding:5px 12px">📦 Ver ítems</button>
            <button class="btn-secondary po-resend-mail-btn" data-id="${p.id}" data-folio="${p.folio}" style="font-size:12px;padding:5px 12px">📧 Reenviar correo</button>
          </div>
          <div id="po-items-detail-${p.id}" style="display:none;margin-top:10px;padding:10px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb"></div>
          <div id="req-msg-${p.id}" class="small" style="margin-top:6px"></div>
          <div id="invoice-form-${p.id}" style="display:none;margin-top:12px;padding:12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
            <h4 style="margin:0 0 4px">Registrar factura manualmente · ${p.folio}</h4>
            <p class="small muted" style="margin:0 0 10px">Usa esta opción solo si el proveedor no puede registrarla en el sistema.</p>
            <div id="inv-items-${p.id}"></div>
            <div class="row-3">
              <div><label style="font-size:12px">No. factura *</label><input id="inv-num-${p.id}" placeholder="FACT-001"/></div>
              <div><label style="font-size:12px">Subtotal *</label><input id="inv-sub-${p.id}" type="number" value="${Number(p.total_amount||0).toFixed(2)}" oninput="document.getElementById('inv-tax-${p.id}').value=(+this.value*0.16).toFixed(2)"/></div>
              <div><label style="font-size:12px">IVA (16%)</label><input id="inv-tax-${p.id}" type="number" value="${(Number(p.total_amount||0)*0.16).toFixed(2)}"/></div>
            </div>
            <div class="row-2" style="margin-top:8px">
              <div><label style="font-size:12px">PDF (factura)</label><input type="file" id="inv-pdf-${p.id}" accept=".pdf" style="font-size:12px"/></div>
              <div><label style="font-size:12px">XML (CFDI)</label><input type="file" id="inv-xml-${p.id}" accept=".xml" style="font-size:12px"/></div>
            </div>
            <div style="display:flex;gap:12px;margin-top:10px;align-items:center;flex-wrap:wrap">
              <button class="btn-primary inv-save-btn" data-id="${p.id}" data-supplier="${p.supplier_id}" style="font-size:12px;padding:5px 12px">Guardar factura</button>
              <span id="inv-msg-${p.id}" class="small muted"></span>
            </div>
          </div>
        </div>`;
      }).join('') : '<div class="muted small" style="padding:16px;text-align:center">Sin órdenes de compra activas</div>';

      // Avanzar status (actualización en sitio, sin recargar toda la vista)
      tabContent.querySelectorAll('.po-advance-btn').forEach(btn => {
        btn.onclick = async () => {
          try {
            btn.disabled = true;
            const updatedPO = await api(`/api/purchases/purchase-orders/${btn.dataset.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
            // Actualizar en sitio: cambiar pill de status y ocultar botón
            const card = document.getElementById(`po-card-${btn.dataset.id}`);
            if (card) {
              const nextS2 = STATUS_NEXT[updatedPO.status];
              // Refrescar pill
              card.querySelectorAll('.pill').forEach(p => {
                if (['Enviada','Aceptada','En proceso','Entregado','Facturada','Facturación parcial','Cerrada'].some(s => p.textContent.trim() === s)) {
                  p.outerHTML = statusPill(updatedPO.status);
                }
              });
              // Cambiar botón
              if (nextS2) { btn.textContent = STATUS_LABEL_BTN[nextS2] || nextS2; btn.dataset.status = nextS2; btn.disabled = false; }
              else { btn.remove(); }
              // Mostrar mensaje breve en tarjeta
              const msgEl = document.getElementById(`req-msg-${btn.dataset.id}`);
              if (msgEl) { msgEl.textContent = `✅ Estado actualizado a: ${updatedPO.status}`; msgEl.style.color='#16a34a'; setTimeout(()=>{ msgEl.textContent=''; }, 3000); }
              // Mostrar recordatorio de anticipo si aplica
              if (updatedPO.advance_reminder) { alert(updatedPO.advance_reminder); }
              // Correo de entrega con detalles + link de facturación
              if (updatedPO.status === 'Entregado' && updatedPO.delivery_mailto) {
                showMailtoPanel([{
                  po_id: updatedPO.id,
                  po_folio: updatedPO.folio,
                  supplier_name: updatedPO.supplier_name || '',
                  supplier_email: updatedPO.supplier_email || '',
                  mailto: updatedPO.delivery_mailto
                }]);
              }
            } else {
              render();
            }
          } catch(e) { alert(e.message); btn.disabled = false; }
        };
      });

      // Cancelar PO
      tabContent.querySelectorAll('.po-cancel-btn').forEach(btn => {
        btn.onclick = () => {
          const folio = btn.dataset.folio;
          openActionCard(`Cancelar PO · ${folio}`, `
            <p class="small muted">Esta acción cancela la orden de compra y regresa los ítems al estado <b>Autorizado</b> para que se puedan generar en una nueva PO.</p>
            <label style="font-size:12px">Motivo de cancelación *</label>
            <select id="poCancelReason" style="width:100%;margin-bottom:8px">
              <option value="Error en la PO">Error en la PO</option>
              <option value="Proveedor no disponible">Proveedor no disponible</option>
              <option value="Cambio de proveedor">Cambio de proveedor</option>
              <option value="Ítem ya no requerido">Ítem ya no requerido</option>
              <option value="Otro motivo">Otro motivo</option>
            </select>
            <div id="poCancelOtherWrap" style="display:none;margin-bottom:8px">
              <input id="poCancelOtherText" placeholder="Describe el motivo..." style="width:100%"/>
            </div>
            <div class="actions">
              <button class="btn-danger" id="confirmPoCancelBtn">Confirmar cancelación</button>
              <button class="btn-secondary" id="abortPoCancelBtn">No cancelar</button>
            </div>
            <div id="poCancelMsg" class="small muted"></div>
          `);
          document.getElementById('poCancelReason').onchange = () => {
            document.getElementById('poCancelOtherWrap').style.display =
              document.getElementById('poCancelReason').value === 'Otro motivo' ? 'block' : 'none';
          };
          document.getElementById('abortPoCancelBtn').onclick = closeActionCard;
          document.getElementById('confirmPoCancelBtn').onclick = async () => {
            try {
              const sel = document.getElementById('poCancelReason').value;
              const reason = sel === 'Otro motivo' ? (document.getElementById('poCancelOtherText').value || 'Otro motivo') : sel;
              await api(`/api/purchases/purchase-orders/${btn.dataset.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
              document.getElementById('poCancelMsg').textContent = '✅ PO cancelada. Los ítems regresaron a Autorizado.';
              document.getElementById('poCancelMsg').style.color = '#16a34a';
              setTimeout(() => { closeActionCard(); render(); }, 1200);
            } catch(e) {
              document.getElementById('poCancelMsg').textContent = e.message;
              document.getElementById('poCancelMsg').style.color = '#dc2626';
            }
          };
        };
      });

      // FASE 3: Reabrir ítems de PO cancelada/rechazada a "En Autorización"
      tabContent.querySelectorAll('.po-reopen-btn').forEach(btn => {
        btn.onclick = async () => {
          const folio = btn.dataset.folio;
          if (!confirm(`¿Reabrir los ítems de la PO ${folio} a "En Autorización"?\n\nLos ítems volverán al flujo de autorización para ser revisados antes de generar una nueva PO.`)) return;
          try {
            btn.disabled = true; btn.textContent = '⏳ Reabriendo...';
            const poId = btn.dataset.id;
            // Obtener ítems de esta PO y reabrir cada uno
            const detail = await api(`/api/purchases/purchase-orders/${poId}`);
            const poItems = detail.po_items || detail.items || [];
            let ok = 0; let errs = [];
            for (const pi of poItems) {
              const riId = pi.requisition_item_id;
              if (!riId) continue;
              try {
                await api(`/api/purchases/items/${riId}/reopen-to-auth`, { method: 'POST' });
                ok++;
              } catch(e2) { errs.push(e2.message); }
            }
            const msgEl = document.getElementById(`req-msg-${poId}`);
            if (msgEl) { msgEl.textContent = ok ? `✅ ${ok} ítem(s) reabiertos a "En Autorización"${errs.length?' · '+errs.length+' error(es)':''}` : `Sin ítems reabiertos. ${errs.join('; ')}`; msgEl.style.color = ok ? '#16a34a' : '#dc2626'; }
            setTimeout(render, 1500);
          } catch(e) { alert(e.message); btn.disabled = false; btn.textContent = '↩ Reabrir ítems'; }
        };
      });

      // Solicitar anticipo al proveedor
      tabContent.querySelectorAll('.po-req-advance-btn').forEach(btn => {
        btn.onclick = async () => {
          try {
            btn.disabled = true;
            const advPct = btn.dataset.pct;
            const data = await api(`/api/purchases/purchase-orders/${btn.dataset.id}/request-advance`, {
              method: 'POST', body: JSON.stringify({ advance_percentage: Number(advPct) })
            });
            if (data.mailto) window.open(data.mailto, '_blank');
            const msgEl = document.getElementById(`req-msg-${btn.dataset.id}`);
            msgEl.textContent = `✅ Anticipo solicitado: $${Number(data.advance_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} (${advPct}%). El proveedor debe subir su factura de anticipo.`;
            msgEl.style.color = '#16a34a';
            btn.textContent = `💰 Anticipo ${advPct}% solicitado`;
          } catch(e) {
            const msgEl = document.getElementById(`req-msg-${btn.dataset.id}`);
            msgEl.textContent = e.message; msgEl.style.color = '#dc2626';
            btn.disabled = false;
          }
        };
      });

      // Solicitar factura al proveedor
      tabContent.querySelectorAll('.po-req-invoice-btn').forEach(btn => {
        btn.onclick = async () => {
          try {
            btn.disabled = true;
            const data = await api(`/api/invoices/request/${btn.dataset.id}`, { method: 'POST' });
            if (data.mailto) window.open(data.mailto, '_blank');
            const msgEl = document.getElementById(`req-msg-${btn.dataset.id}`);
            msgEl.textContent = `✅ Solicitud enviada a ${data.supplier_email || 'proveedor'}`;
            msgEl.style.color = '#16a34a';
            btn.textContent = '📧 Solicitud enviada';
          } catch(e) {
            const msgEl = document.getElementById(`req-msg-${btn.dataset.id}`);
            msgEl.textContent = e.message; msgEl.style.color = '#dc2626';
            btn.disabled = false;
          }
        };
      });

      // Mostrar/ocultar formulario manual
      tabContent.querySelectorAll('.po-manual-invoice-btn').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const form = document.getElementById(`invoice-form-${id}`);
          if (form.style.display !== 'none') { form.style.display = 'none'; return; }
          // Load PO items
          const itemsDiv = document.getElementById(`inv-items-${id}`);
          itemsDiv.innerHTML = '<div class="small muted">Cargando ítems...</div>';
          form.style.display = 'block';
          try {
            const poData = await api(`/api/purchases/purchase-orders/${id}`);
            const poItems = poData.po_items || poData.items || [];
            if (poItems.length) {
              let subtotal = 0;
              poItems.forEach(i => { subtotal += Number(i.quantity||0) * Number(i.unit_cost||0); });
              const iva = subtotal * 0.16;
              itemsDiv.innerHTML = `
                <div style="overflow-x:auto;margin-bottom:12px">
                  <table style="width:100%;font-size:12px;border-collapse:collapse">
                    <thead><tr style="background:#f3f4f6">
                      <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Descripción</th>
                      <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Cant.</th>
                      <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Precio unit.</th>
                      <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Subtotal</th>
                      <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">IVA 16%</th>
                      <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Total</th>
                    </tr></thead>
                    <tbody>${poItems.map(i => {
                      const sub = Number(i.quantity||0) * Number(i.unit_cost||0);
                      const iv = sub * 0.16;
                      return `<tr style="border-bottom:1px solid #f3f4f6">
                        <td style="padding:4px 8px">${escapeHtml(i.description||i.name||i.manual_item_name||'-')}</td>
                        <td style="padding:4px 8px;text-align:right">${Number(i.quantity||0)}</td>
                        <td style="padding:4px 8px;text-align:right">$${Number(i.unit_cost||0).toFixed(2)}</td>
                        <td style="padding:4px 8px;text-align:right">$${sub.toFixed(2)}</td>
                        <td style="padding:4px 8px;text-align:right;color:#6b7280">$${iv.toFixed(2)}</td>
                        <td style="padding:4px 8px;text-align:right"><b>$${(sub+iv).toFixed(2)}</b></td>
                      </tr>`;
                    }).join('')}</tbody>
                    <tfoot><tr style="background:#f9fafb;font-weight:700">
                      <td colspan="3" style="padding:6px 8px;text-align:right;font-size:12px">Totales:</td>
                      <td style="padding:6px 8px;text-align:right;font-size:12px">$${subtotal.toFixed(2)}</td>
                      <td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280">$${iva.toFixed(2)}</td>
                      <td style="padding:6px 8px;text-align:right;font-size:12px">$${(subtotal+iva).toFixed(2)}</td>
                    </tr></tfoot>
                  </table>
                </div>`;
              // Pre-fill form fields
              const subEl = document.getElementById(`inv-sub-${id}`);
              const taxEl = document.getElementById(`inv-tax-${id}`);
              if (subEl) subEl.value = subtotal.toFixed(2);
              if (taxEl) taxEl.value = iva.toFixed(2);
            } else {
              itemsDiv.innerHTML = '<div class="small muted" style="margin-bottom:8px">Sin ítems registrados en esta PO.</div>';
            }
          } catch(e) {
            itemsDiv.innerHTML = `<div class="small" style="color:#dc2626;margin-bottom:8px">Error al cargar ítems: ${e.message}</div>`;
          }
        };
      });

      // Imprimir PO
      tabContent.querySelectorAll('.po-print-btn').forEach(btn => {
        btn.onclick = async () => {
          const poId = btn.dataset.id;
          const po = pos.find(p => String(p.id) === String(poId));
          if (!po) return;
          try {
            await generarPOPdf(po, po.supplier_name, null);
          } catch(e) { alert('Error al generar PDF: ' + e.message); }
        };
      });

      // Guardar factura manual con archivos
      tabContent.querySelectorAll('.inv-save-btn').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const numEl = document.getElementById(`inv-num-${id}`);
          const subEl = document.getElementById(`inv-sub-${id}`);
          const taxEl = document.getElementById(`inv-tax-${id}`);
          const pdfEl = document.getElementById(`inv-pdf-${id}`);
          const xmlEl = document.getElementById(`inv-xml-${id}`);
          const msgEl = document.getElementById(`inv-msg-${id}`);
          try {
            if (!numEl.value) throw new Error('Ingresa el número de factura');
            const sub = Number(subEl.value||0);
            if (!sub) throw new Error('Ingresa subtotal mayor a cero');
            const tax = Number(taxEl.value||0);
            const fd = new FormData();
            fd.append('purchase_order_id', id);
            fd.append('supplier_id', btn.dataset.supplier);
            fd.append('invoice_number', numEl.value);
            fd.append('subtotal', sub);
            fd.append('taxes', tax);
            fd.append('total', sub + tax);
            if (pdfEl.files[0]) fd.append('pdf', pdfEl.files[0]);
            if (xmlEl.files[0]) fd.append('xml', xmlEl.files[0]);
            const res = await fetch('/api/invoices', { method: 'POST', credentials: 'include', body: fd });
            if (!res.ok) throw new Error((await res.json()).error || 'Error');
            const out = await res.json();
            if (out.mailto_comprador) { const a = document.createElement('a'); a.href = out.mailto_comprador; a.click(); }
            msgEl.textContent = '✅ Factura guardada'; msgEl.style.color = '#16a34a';
            setTimeout(render, 900);
          } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
        };
      });
      // Ver ítems de la PO (toggle expandible)
      tabContent.querySelectorAll('.po-items-btn').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const detailDiv = document.getElementById(`po-items-detail-${id}`);
          if (detailDiv.style.display !== 'none') { detailDiv.style.display = 'none'; btn.textContent = '📦 Ver ítems'; return; }
          detailDiv.innerHTML = '<div class="small muted">Cargando ítems...</div>';
          detailDiv.style.display = 'block';
          btn.textContent = '▲ Ocultar ítems';
          try {
            const poData = await api(`/api/purchases/purchase-orders/${id}`);
            const items = poData.po_items || poData.items || [];
            if (!items.length) { detailDiv.innerHTML = '<div class="small muted">Sin ítems registrados.</div>'; return; }
            let subtotal = 0;
            items.forEach(i => { subtotal += Number(i.quantity||0) * Number(i.unit_cost||0); });
            const iva = subtotal * 0.16;
            detailDiv.innerHTML = `
              <div style="overflow-x:auto">
                <table style="width:100%;font-size:12px;border-collapse:collapse">
                  <thead><tr style="background:#f3f4f6">
                    <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Descripción</th>
                    <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Cant.</th>
                    <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Precio unit.</th>
                    <th style="padding:4px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Subtotal</th>
                  </tr></thead>
                  <tbody>${items.map(i => {
                    const sub = Number(i.quantity||0) * Number(i.unit_cost||0);
                    return `<tr style="border-bottom:1px solid #f3f4f6">
                      <td style="padding:4px 8px">${escapeHtml(i.description||i.name||i.manual_item_name||'-')}</td>
                      <td style="padding:4px 8px;text-align:right">${Number(i.quantity||0)} ${i.unit||''}</td>
                      <td style="padding:4px 8px;text-align:right">$${Number(i.unit_cost||0).toFixed(2)}</td>
                      <td style="padding:4px 8px;text-align:right">$${sub.toFixed(2)}</td>
                    </tr>`;
                  }).join('')}</tbody>
                  <tfoot>
                    <tr><td colspan="3" style="padding:4px 8px;text-align:right;font-size:11px;color:#6b7280">Subtotal:</td><td style="padding:4px 8px;text-align:right;font-size:11px;color:#6b7280">$${subtotal.toFixed(2)}</td></tr>
                    <tr><td colspan="3" style="padding:4px 8px;text-align:right;font-size:11px;color:#6b7280">IVA (16%):</td><td style="padding:4px 8px;text-align:right;font-size:11px;color:#6b7280">$${iva.toFixed(2)}</td></tr>
                    <tr style="font-weight:700"><td colspan="3" style="padding:6px 8px;text-align:right">Total c/IVA:</td><td style="padding:6px 8px;text-align:right">$${(subtotal+iva).toFixed(2)}</td></tr>
                  </tfoot>
                </table>
              </div>`;
          } catch(e) { detailDiv.innerHTML = `<div class="small" style="color:#dc2626">Error: ${e.message}</div>`; }
        };
      });

      // Reenviar correo
      tabContent.querySelectorAll('.po-resend-mail-btn').forEach(btn => {
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = '⏳ Generando...';
          try {
            const data = await api(`/api/purchases/purchase-orders/${btn.dataset.id}/mailto`);
            if (data.mailto) showMailtoPanel([{ po_folio: btn.dataset.folio, supplier_email: data.supplier_email, cc: data.cc, mailto: data.mailto }]);
            else alert('No se pudo generar el correo.');
          } catch(e) { alert(e.message); }
          finally { btn.disabled = false; btn.textContent = '📧 Reenviar correo'; }
        };
      });
      };  // close renderPos

      renderPos();
      document.getElementById('poFiltBtn').onclick = renderPos;
      document.getElementById('poFiltTexto').oninput = renderPos;

    } else if (tab === 'requisiciones') {
      poActions.style.display = 'none';
      const reqs = await api('/api/requisitions').catch(() => []);
      let reqSortCol = 'folio', reqSortDir = 1;
      let reqFilterText = '';
      let reqFilterStatus = '';
      let expandedReqIds = new Set();

      const renderReqsTab = () => {
        let filtered = reqs.filter(r =>
          (!reqFilterText || r.folio.toLowerCase().includes(reqFilterText.toLowerCase()) || (r.requester||'').toLowerCase().includes(reqFilterText.toLowerCase())) &&
          (!reqFilterStatus || r.status === reqFilterStatus)
        );
        filtered.sort((a,b) => {
          const va = a[reqSortCol] || ''; const vb = b[reqSortCol] || '';
          return reqSortDir * (String(va).localeCompare(String(vb)));
        });
        const statusOpts = ['','Borrador','Enviada','En cotización','En autorización','En proceso','Completada','Rechazada'];
        tabContent.innerHTML = `
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <input id="reqTabFilter" placeholder="Buscar folio o solicitante..." value="${reqFilterText}" style="flex:1;min-width:150px"/>
            <select id="reqTabStatus" style="min-width:130px">
              ${statusOpts.map(s=>`<option value="${s}" ${s===reqFilterStatus?'selected':''}>${s||'Todos los estatus'}</option>`).join('')}
            </select>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                ${['folio','status','department','requester','total_amount'].map(col => `<th style="cursor:pointer" data-sort="${col}">${{folio:'Folio',status:'Estatus',department:'Depto',requester:'Solicitante',total_amount:'Total'}[col]} ${reqSortCol===col?(reqSortDir===1?'▲':'▼'):''}</th>`).join('')}
                <th></th>
              </tr></thead>
              <tbody>
                ${filtered.map(r => {
                  const isExp = expandedReqIds.has(r.id);
                  return `<tr style="cursor:pointer" data-req-id="${r.id}">
                    <td><b>${r.folio}</b></td>
                    <td>${statusPill(r.status)}</td>
                    <td style="font-size:12px">${r.department||'-'}</td>
                    <td style="font-size:12px">${r.requester||'-'}</td>
                    <td style="font-size:12px;text-align:right">$${Number(r.total_amount||0).toFixed(2)}</td>
                    <td><button class="btn-secondary req-expand-btn" data-id="${r.id}" style="padding:2px 8px;font-size:11px">${isExp?'▲ Cerrar':'▼ Ver ítems'}</button></td>
                  </tr>
                  ${isExp ? `<tr><td colspan="6" style="padding:0">
                    <div style="padding:8px 16px;background:#f8fafc;border-top:1px solid #e5e7eb" id="req-expand-${r.id}">
                      <div class="small muted" style="text-align:center">Cargando...</div>
                    </div>
                  </td></tr>` : ''}`;
                }).join('')}
              </tbody>
            </table>
          </div>`;

        tabContent.querySelector('#reqTabFilter').oninput = e => { reqFilterText = e.target.value; renderReqsTab(); };
        tabContent.querySelector('#reqTabStatus').onchange = e => { reqFilterStatus = e.target.value; renderReqsTab(); };
        tabContent.querySelectorAll('th[data-sort]').forEach(th => {
          th.onclick = () => { if (reqSortCol===th.dataset.sort) reqSortDir*=-1; else { reqSortCol=th.dataset.sort; reqSortDir=1; } renderReqsTab(); };
        });
        tabContent.querySelectorAll('.req-expand-btn').forEach(btn => {
          btn.onclick = async () => {
            const id = Number(btn.dataset.id);
            if (expandedReqIds.has(id)) { expandedReqIds.delete(id); } else { expandedReqIds.add(id); }
            renderReqsTab();
            if (expandedReqIds.has(id)) {
              const detail = await api(`/api/requisitions/${id}`).catch(()=>null);
              const el = document.getElementById(`req-expand-${id}`);
              if (!el || !detail) return;
              el.innerHTML = `<table style="width:100%;font-size:12px"><thead><tr><th>#</th><th>Ítem</th><th>Proveedor</th><th>Cant.</th><th>Unidad</th><th>Costo</th><th>Total</th><th>Estatus</th></tr></thead><tbody>${detail.items.map(i=>`<tr><td>${i.line_no}</td><td>${escapeHtml(i.catalog_name||i.manual_item_name||'-')}</td><td style="font-size:11px">${escapeHtml(i.supplier_name||'-')}</td><td>${i.quantity}</td><td>${i.unit||'-'}</td><td>$${Number(i.unit_cost||0).toFixed(2)}</td><td>$${(Number(i.quantity||0)*Number(i.unit_cost||0)).toFixed(2)}</td><td>${statusPill(i.status)}</td></tr>`).join('')}</tbody></table>`;
            }
          };
        });
      };
      renderReqsTab();
    } else if (tab === 'scc_pending') {
    poActions.style.display = 'none';
    if (!itemsPendingScc.length) {
      tabContent.innerHTML = '<div class="muted small" style="padding:24px;text-align:center">Sin subcentros de costo propuestos pendientes ✅</div>';
    } else {
      let sccFilterText = '';
      const renderSccTab = () => {
        const rows = itemsPendingScc.filter(row => !sccFilterText ||
          (row.item_name||'').toLowerCase().includes(sccFilterText) ||
          (row.supplier_name||'').toLowerCase().includes(sccFilterText) ||
          (row.requisition_folio||'').toLowerCase().includes(sccFilterText) ||
          (row.sub_cost_center_proposed||'').toLowerCase().includes(sccFilterText));
        tabContent.innerHTML = `
          <div style="display:flex;gap:8px;margin-bottom:10px"><input id="filterSccTab" placeholder="🔍 Buscar ítem, proveedor, req, SCC..." value="${sccFilterText}" style="flex:1;min-width:150px"/></div>
          <p class="small muted" style="margin:0 0 8px">Los siguientes ítems tienen subcentro de costo propuesto por el solicitante. Asigna el subcentro oficial antes de poder generar la PO.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Requisición</th><th>Ítem</th><th>Proveedor</th><th>SCC Propuesto</th><th>Asignar SCC</th></tr></thead>
            <tbody>${rows.map(row => `<tr>
              <td style="font-size:12px">${row.requisition_folio||'-'}</td>
              <td style="font-size:12px"><b>${escapeHtml(row.item_name||'-')}</b></td>
              <td style="font-size:12px">${escapeHtml(row.supplier_name||'-')}</td>
              <td style="font-size:12px"><span style="background:#fffbeb;padding:2px 8px;border-radius:4px;color:#b45309;font-weight:600">${escapeHtml(row.sub_cost_center_proposed||'')}</span></td>
              <td>
                <select class="assign-scc-select" data-id="${row.id}" style="font-size:12px;margin-right:6px">
                  <option value="">— Selecciona SCC —</option>
                  ${sccList.map(s=>`<option value="${s.id}">${s.code} · ${s.name}</option>`).join('')}
                </select>
                <button class="btn-primary assign-scc-btn" data-id="${row.id}" style="padding:3px 10px;font-size:12px">Asignar</button>
              </td>
            </tr>`).join('')}
            </tbody>
          </table></div>
        `;
        const filterEl = document.getElementById('filterSccTab');
        if (filterEl) filterEl.oninput = e => { sccFilterText = e.target.value.toLowerCase(); renderSccTab(); };
        tabContent.querySelectorAll('.assign-scc-btn').forEach(btn => {
          btn.onclick = async () => {
            const itemId = btn.dataset.id;
            const sel = tabContent.querySelector(`.assign-scc-select[data-id="${itemId}"]`);
            if (!sel?.value) { alert('Selecciona un subcentro de costo'); return; }
            try {
              await api(`/api/purchases/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ sub_cost_center_id: Number(sel.value) }) });
              btn.textContent = '✅';
              btn.disabled = true;
              sel.disabled = true;
              setTimeout(render, 1000);
            } catch(e) { alert(e.message); }
          };
        });
      };
      renderSccTab();
    }
    } else if (tab === 'anticipos') {
      poActions.style.display = 'none';
      const advStatusBadge = (s) => {
        const cfg = {
          'Pendiente': { bg: '#fef9c3', color: '#854d0e' },
          'Solicitado': { bg: '#dbeafe', color: '#1d4ed8' },
          'Facturado': { bg: '#ffedd5', color: '#9a3412' },
          'Pagado': { bg: '#dcfce7', color: '#15803d' }
        }[s] || { bg: '#f3f4f6', color: '#6b7280' };
        return `<span style="background:${cfg.bg};color:${cfg.color};padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600">${s}</span>`;
      };
      if (!posConAnticipo.length) {
        tabContent.innerHTML = '<div class="muted small" style="padding:24px;text-align:center">Sin órdenes de compra con anticipo pendiente ✅</div>';
      } else {
        let anticipoFilterText = '';
        const renderAnticipos = () => {
          const rows = posConAnticipo.filter(p => !anticipoFilterText ||
            (p.folio||'').toLowerCase().includes(anticipoFilterText) ||
            (p.supplier_name||'').toLowerCase().includes(anticipoFilterText) ||
            (p.requester_name||'').toLowerCase().includes(anticipoFilterText));
          tabContent.innerHTML = `
            <div style="display:flex;gap:8px;margin-bottom:12px"><input id="filterAnticipoTab" placeholder="🔍 Buscar folio, proveedor, solicitante..." value="${anticipoFilterText}" style="flex:1;min-width:150px"/></div>
            <h4 style="margin:0 0 12px;font-size:14px;color:#1d4ed8">Órdenes de Compra con Anticipo Pendiente</h4>
            ${rows.map(p => {
              const advancePct = Number(p.advance_percentage || 0);
              const advanceAmt = Number(p.advance_amount || 0);
              const advStatus = p.advance_status || 'N/A';
              const canRequest = ['Pendiente','Solicitado'].includes(advStatus) && ['Enviada','Aceptada','En proceso'].includes(p.status);
              return `<div class="card section" style="margin-bottom:12px;border-left:4px solid #1d4ed8">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
                  <div>
                    <b style="font-size:15px">${p.folio}</b>
                    <span style="margin-left:10px;color:#6b7280">${p.supplier_name}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    ${statusPill(p.status)}
                    <b>$${Number(p.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${p.currency||'MXN'}</b>
                  </div>
                </div>
                <div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-size:13px">
                  <span>💰 Anticipo: <b>${advancePct}%</b> = <b>$${advanceAmt.toLocaleString('es-MX',{minimumFractionDigits:2})}</b></span>
                  <span>Estado: ${advStatusBadge(advStatus)}</span>
                </div>
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  ${canRequest ? `<button class="btn-secondary po-req-advance-btn" data-id="${p.id}" data-pct="${advancePct}" data-amt="${advanceAmt}" style="font-size:12px;padding:5px 12px">💰 Solicitar anticipo (${advancePct}%)</button>` : ''}
                </div>
                <div id="req-msg-${p.id}" class="small" style="margin-top:6px"></div>
              </div>`;
            }).join('')}`;

          const filterEl = document.getElementById('filterAnticipoTab');
          if (filterEl) filterEl.oninput = e => { anticipoFilterText = e.target.value.toLowerCase(); renderAnticipos(); };

        // Bind solicitar anticipo buttons
        tabContent.querySelectorAll('.po-req-advance-btn').forEach(btn => {
          btn.onclick = async () => {
            try {
              btn.disabled = true;
              const advPct = btn.dataset.pct;
              const data = await api(`/api/purchases/purchase-orders/${btn.dataset.id}/request-advance`, {
                method: 'POST', body: JSON.stringify({ advance_percentage: Number(advPct) })
              });
              if (data.mailto) window.open(data.mailto, '_blank');
              const msgEl = document.getElementById(`req-msg-${btn.dataset.id}`);
              if (msgEl) { msgEl.textContent = `✅ Anticipo solicitado: $${Number(data.advance_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} (${advPct}%). El proveedor debe subir su factura de anticipo.`; msgEl.style.color = '#16a34a'; }
              btn.textContent = `💰 Anticipo ${advPct}% solicitado`;
            } catch(e) {
              const msgEl = document.getElementById(`req-msg-${btn.dataset.id}`);
              if (msgEl) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
              btn.disabled = false;
            }
          };
        });
        }; // close renderAnticipos
        renderAnticipos();
      }
    } else if (tab === 'kpi_costos') {
      // FASE 4: Vista KPI de costos por Centro de Costo / Sub-Centro de Costo
      poActions.style.display = 'none';
      tabContent.innerHTML = '<div class="muted small" style="padding:24px;text-align:center">Cargando KPI de costos...</div>';
      try {
        const kpi = await api('/api/purchases/kpi-costs');
        const fmt = (n) => '$' + Number(n||0).toLocaleString('es-MX', {minimumFractionDigits:0, maximumFractionDigits:0});
        let expandedCC = null;
        let kpiPeriod = 'month'; // 'week' | 'month'

        const renderKpi = () => {
          const periods = kpiPeriod === 'week' ? (kpi.weeks_labels || []) : (kpi.months_labels || []);
          const byKey = kpiPeriod === 'week' ? 'by_week' : 'by_month';
          const cols = 2 + periods.length;
          tabContent.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
              <h4 style="margin:0;font-size:15px;color:#1d4ed8">📊 KPI de Costos por Centro de Costo</h4>
              <div style="display:flex;gap:4px">
                <button id="kpi-toggle-week" class="btn-${kpiPeriod==='week'?'primary':'secondary'}" style="padding:4px 14px;font-size:12px">Por semana</button>
                <button id="kpi-toggle-month" class="btn-${kpiPeriod==='month'?'primary':'secondary'}" style="padding:4px 14px;font-size:12px">Por mes</button>
              </div>
            </div>
            <p class="small muted" style="margin:0 0 12px">
              ${kpiPeriod==='week' ? 'Últimas 8 semanas' : 'Últimos 6 meses'} · ítems activos con costo · clic en CC para ver SCC
              ${kpi.usd_rate ? `· <span style="color:#059669;font-weight:600">USD→MXN @ $${Number(kpi.usd_rate).toFixed(2)}</span>` : ''}
            </p>
            <div class="table-wrap">
              <table style="font-size:12px">
                <thead><tr style="background:#f1f5f9">
                  <th style="text-align:left;padding:6px 10px">Centro de Costo</th>
                  <th style="text-align:right;padding:6px 8px">Total</th>
                  ${periods.map(p => `<th style="text-align:right;padding:6px 8px;white-space:nowrap">${escapeHtml(p)}</th>`).join('')}
                </tr></thead>
                <tbody>
                  ${kpi.cost_centers.length ? kpi.cost_centers.map(cc => {
                    const isExpanded = expandedCC === cc.id;
                    const hasSccs = cc.sub_cost_centers && cc.sub_cost_centers.length > 0;
                    const byPeriod = cc[byKey] || [];
                    return `
                      <tr class="kpi-cc-row" data-ccid="${cc.id}" style="cursor:${hasSccs?'pointer':'default'};background:${isExpanded?'#eff6ff':'#fff'};border-top:2px solid #e5e7eb" title="${hasSccs?'Clic para ver sub-centros':''}">
                        <td style="padding:7px 10px;font-weight:600">${hasSccs?(isExpanded?'▼ ':'▶ '):''}<b>${escapeHtml(cc.name)}</b> <span style="color:#9ca3af;font-weight:400">${cc.code||''}</span></td>
                        <td style="text-align:right;padding:7px 8px;font-weight:600;color:#1d4ed8">${fmt(cc.total)}</td>
                        ${byPeriod.map(p => `<td style="text-align:right;padding:7px 8px;color:${p.amount>0?'#374151':'#d1d5db'}">${p.amount>0?fmt(p.amount):'—'}</td>`).join('')}
                      </tr>
                      ${isExpanded && hasSccs ? cc.sub_cost_centers.map(scc => {
                        const sccByPeriod = scc[byKey] || [];
                        return `
                        <tr style="background:#f0f5ff">
                          <td style="padding:5px 10px 5px 28px;font-size:11px">↳ <b>${escapeHtml(scc.name)}</b> <span style="color:#9ca3af">${scc.code||''}</span>
                            ${scc.items && scc.items.length ? `<span style="color:#6b7280"> · ${scc.items.length} ítem(s)</span>` : ''}
                          </td>
                          <td style="text-align:right;padding:5px 8px;font-size:11px;color:#4b5563;font-weight:600">${fmt(scc.total)}</td>
                          ${sccByPeriod.map(p => `<td style="text-align:right;padding:5px 8px;font-size:11px;color:${p.amount>0?'#4b5563':'#d1d5db'}">${p.amount>0?fmt(p.amount):'—'}</td>`).join('')}
                        </tr>
                        ${scc.items && scc.items.length ? `
                        <tr style="background:#f0f5ff">
                          <td colspan="${cols}" style="padding:3px 10px 8px 40px">
                            <div style="display:flex;flex-wrap:wrap;gap:5px">
                              ${scc.items.slice(0, 10).map(it => `<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:10px;font-size:10px">${escapeHtml(it.name)} · ${fmt(it.total)} ${it.currency||'MXN'}</span>`).join('')}
                              ${scc.items.length > 10 ? `<span style="color:#6b7280;font-size:10px">+${scc.items.length-10} más...</span>` : ''}
                            </div>
                          </td>
                        </tr>` : ''}`;
                      }).join('') : ''}`;
                  }).join('') : `<tr><td colspan="${cols}" class="muted" style="padding:24px;text-align:center">Sin centros de costo activos o sin gasto registrado</td></tr>`}
                </tbody>
              </table>
            </div>`;

          document.getElementById('kpi-toggle-week').onclick = () => { kpiPeriod = 'week'; renderKpi(); };
          document.getElementById('kpi-toggle-month').onclick = () => { kpiPeriod = 'month'; renderKpi(); };
          tabContent.querySelectorAll('.kpi-cc-row').forEach(row => {
            row.onclick = () => {
              const ccid = Number(row.dataset.ccid);
              expandedCC = expandedCC === ccid ? null : ccid;
              renderKpi();
            };
          });
        };
        renderKpi();
      } catch(e) {
        tabContent.innerHTML = `<div style="color:#dc2626;padding:16px">Error al cargar KPI: ${e.message}</div>`;
      }
    }
  };

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = () => renderTab(btn.dataset.tab));

  // Vista previa PO
  // FASE 2: Render del preview con precios editables y detección de varianza
  const renderPoPreview = (preview) => {
    // Filtrar: solo mostrar ítems que coincidan con los seleccionados (lastPreviewIds)
    // Esto evita que ítems de la misma requisición no seleccionados aparezcan en el preview
    const selectedIds = new Set((lastPreviewIds || []).map(Number));
    if (selectedIds.size > 0) {
      const filteredGroups = preview.groups
        .map(g => ({
          ...g,
          items: g.items.filter(i => selectedIds.has(Number(i.id)))
        }))
        .filter(g => g.items.length > 0)
        .map(g => ({
          ...g,
          item_count: g.items.length,
          total: g.items.reduce((s, i) => s + Number(i.quantity||0) * Number(i.unit_cost||0), 0),
          warnings: g.warnings.filter(w => g.items.some(i => w.includes(i.name)))
        }));
      preview = { ...preview, groups: filteredGroups, total_pos: filteredGroups.length, total_items: filteredGroups.reduce((s,g) => s + g.items.length, 0) };
    }
    const VARIANCE_THRESHOLD = 0.05; // 5%
    poPreviewContent.innerHTML = `
      <p class="small muted" style="margin-bottom:10px">Se generarán <b>${preview.total_pos}</b> PO(s) para <b>${preview.total_items}</b> ítem(s). Puedes editar precios antes de confirmar:</p>
      ${preview.groups.map((g, gi) => `
        <div style="border:1px solid ${g.can_generate?'#22c55e':'#f87171'};border-radius:8px;padding:12px;margin-bottom:10px;background:${g.can_generate?'#f0fff4':'#fff5f5'}">
          <div style="display:flex;justify-content:space-between">
            <b>${g.supplier_name}</b>
            <span>${g.item_count} ítem(s) · <b id="prev-total-${gi}">$${Number(g.total).toFixed(2)} ${g.currency}</b></span>
          </div>
          ${g.supplier_email ? `<div class="small muted">📧 ${g.supplier_email}</div>` : ''}
          <div style="margin-top:8px">
            ${g.items.map((i, ii) => {
              const hasQuote = i.winning_quote_cost != null;
              const variance = hasQuote && i.winning_quote_cost > 0 ? (i.unit_cost - i.winning_quote_cost) / i.winning_quote_cost : 0;
              const highVariance = Math.abs(variance) > VARIANCE_THRESHOLD;
              return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #f0f0f0;flex-wrap:wrap" data-grp="${gi}" data-item="${i.id}">
                <span style="flex:1;min-width:140px;font-size:12px"><b>${escapeHtml(i.name)}</b><br><span class="muted">× ${i.quantity} ${i.unit||''}</span></span>
                <div style="display:flex;gap:4px;align-items:center">
                  <span style="font-size:11px;color:#6b7280">$</span>
                  <input type="number" class="prev-price-input" data-id="${i.id}" data-grp="${gi}" data-orig="${i.unit_cost}" data-quote="${i.winning_quote_cost ?? ''}" value="${Number(i.unit_cost||0).toFixed(2)}" min="0.01" step="any" style="width:80px;font-size:12px;padding:2px 4px"/>
                  <span style="font-size:11px;color:#6b7280">${i.currency||'MXN'}</span>
                  <button class="btn-secondary prev-save-price" data-id="${i.id}" data-grp="${gi}" style="padding:1px 8px;font-size:11px">💾</button>
                  <span class="prev-save-msg" data-id="${i.id}" style="font-size:11px;color:#16a34a"></span>
                </div>
                ${highVariance ? `<div style="color:#b45309;font-size:11px;background:#fffbeb;padding:2px 8px;border-radius:4px;width:100%">⚠ Varianza ${variance>0?'+':''}${(variance*100).toFixed(1)}% vs cotización ($${Number(i.winning_quote_cost).toFixed(2)}) — requiere re-autorización</div>` : ''}
              </div>`;
            }).join('')}
          </div>
          ${g.warnings.length ? `<div style="color:#dc2626;font-size:12px;margin-top:8px">${g.warnings.map(w=>`⚠ ${w}`).join('<br>')}</div>` : '<div style="color:#16a34a;font-size:12px;margin-top:6px">✅ Listo para generar</div>'}
        </div>`).join('')}`;

    // Bind: save price inline from preview
    poPreviewContent.querySelectorAll('.prev-save-price').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const input = poPreviewContent.querySelector(`.prev-price-input[data-id="${id}"]`);
        const msgEl = poPreviewContent.querySelector(`.prev-save-msg[data-id="${id}"]`);
        const newCost = Number(input?.value || 0);
        if (newCost <= 0) { alert('El precio debe ser > $0'); return; }
        const origCost = Number(input.dataset.orig || 0);
        const quoteCost = input.dataset.quote ? Number(input.dataset.quote) : null;
        const variance = quoteCost && quoteCost > 0 ? (newCost - quoteCost) / quoteCost : 0;
        try {
          btn.disabled = true;
          await api(`/api/purchases/items/${id}`, { method: 'PATCH', body: JSON.stringify({ unit_cost: newCost }) });
          input.dataset.orig = newCost;
          if (msgEl) { msgEl.textContent = '✅'; setTimeout(() => { msgEl.textContent = ''; }, 2000); }
          if (Math.abs(variance) > 0.05) {
            const varDiv = input.closest('[data-item]')?.querySelector('[style*="Varianza"]') || input.closest('[data-item]');
            if (varDiv) {
              const warn = input.closest('[data-item]').querySelector('[style*="color:#b45309"]');
              if (warn) warn.style.color = '#dc2626';
            }
            if (msgEl) msgEl.textContent = `⚠ ${(variance*100).toFixed(1)}% varianza vs cotización`;
          }
        } catch(e) { if (msgEl) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; } }
        finally { btn.disabled = false; }
      };
    });

    const readyGroups = preview.groups.filter(g => g.can_generate);
    const blockedGroups = preview.groups.filter(g => !g.can_generate);
    // Solo enviar a generate-po los IDs de grupos listos
    lastPreviewIds = readyGroups.flatMap(g => g.items.map(i => Number(i.id)));
    confirmGenPoBtn.disabled = readyGroups.length === 0;
    const partialMsg = document.getElementById('poPreviewPartialMsg');
    if (partialMsg) partialMsg.remove();
    if (blockedGroups.length > 0 && readyGroups.length > 0) {
      const msg = document.createElement('p');
      msg.id = 'poPreviewPartialMsg';
      msg.style.cssText = 'color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:0.85rem';
      msg.innerHTML = `⚠ <b>${blockedGroups.length} grupo(s) con advertencias serán omitidos</b> (${blockedGroups.map(g=>g.supplier_name).join(', ')}). Solo se generarán POs para los grupos marcados en verde.`;
      document.getElementById('poPreviewContent').after(msg);
    } else if (blockedGroups.length > 0 && readyGroups.length === 0) {
      const msg = document.createElement('p');
      msg.id = 'poPreviewPartialMsg';
      msg.style.cssText = 'color:#dc2626;background:#fff5f5;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:0.85rem';
      msg.innerHTML = `⛔ Ningún grupo está listo para generar. Resuelve las advertencias primero.`;
      document.getElementById('poPreviewContent').after(msg);
    }
  };

  closePreviewBtn.onclick = () => { poPreviewSection.style.display = 'none'; };

  // Panel de correos para abrir manualmente (evita bloqueo de popups del navegador)
  const showMailtoPanel = (poMailtos) => {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center';
    panel.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px;width:540px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <h3 style="margin:0 0 8px">📧 Correos generados</h3>
        <p style="font-size:13px;color:#6b7280;margin:0 0 18px">Haz clic en cada botón para abrir el correo en tu cliente de correo. El correo incluye ítems, precios, cotizaciones y el enlace al PDF.</p>
        ${poMailtos.map((pm, idx) => `
          <div id="pm-card-${idx}" style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:10px">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">${escapeHtml(pm.po_folio)} · <span style="font-weight:400;color:#6b7280">${escapeHtml(pm.supplier_name||'')}</span></div>
            ${pm.supplier_email
              ? `<div style="font-size:12px;color:#6b7280;margin-bottom:8px">Para: <b>${escapeHtml(pm.supplier_email)}</b>${pm.cc ? `  · CC: ${escapeHtml(pm.cc.split(',').slice(0,3).join(', '))}${pm.cc.split(',').length>3?'…':''}` : ''}</div>
                 <a href="${pm.mailto}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:13px;padding:6px 16px;border-radius:6px;font-weight:600">📧 Abrir correo al proveedor</a>`
              : `<div style="font-size:12px;color:#dc2626;margin-bottom:8px">⚠ Proveedor sin correo registrado — agrégalo aquí:</div>
                 <div style="display:flex;gap:6px;align-items:center">
                   <input id="pm-newemail-${idx}" type="email" placeholder="correo@proveedor.com" style="flex:1;font-size:13px;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px"/>
                   <button id="pm-saveemail-${idx}" data-supplier="${pm.supplier_id||''}" data-pm="${idx}" data-cc="${escapeHtml(pm.cc||'')}" data-folio="${escapeHtml(pm.po_folio||'')}" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap">💾 Guardar y enviar</button>
                 </div>
                 <div id="pm-emailmsg-${idx}" style="font-size:11px;margin-top:4px"></div>`}
          </div>`).join('')}
        <div style="text-align:right;margin-top:16px">
          <button id="closeMailtoPanel" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:6px 18px;cursor:pointer;font-size:13px">Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector('#closeMailtoPanel').onclick = () => panel.remove();
    panel.onclick = (e) => { if (e.target === panel) panel.remove(); };

    // Binding: guardar correo del proveedor y regenerar mailto
    poMailtos.forEach((pm, idx) => {
      if (pm.supplier_email) return; // ya tiene correo
      const saveBtn = panel.querySelector(`#pm-saveemail-${idx}`);
      if (!saveBtn || !pm.supplier_id) return;
      saveBtn.onclick = async () => {
        const emailInput = panel.querySelector(`#pm-newemail-${idx}`);
        const msgEl = panel.querySelector(`#pm-emailmsg-${idx}`);
        const newEmail = (emailInput?.value || '').trim();
        if (!newEmail || !newEmail.includes('@')) { if (msgEl) { msgEl.textContent = 'Correo inválido'; msgEl.style.color = '#dc2626'; } return; }
        saveBtn.disabled = true; saveBtn.textContent = '⏳ Guardando...';
        try {
          await api(`/api/catalogs/suppliers/${pm.supplier_id}`, { method: 'PATCH', body: JSON.stringify({ email: newEmail }) });
          // Actualizar local
          const localSupplier = suppliers.find(s => s.id === pm.supplier_id);
          if (localSupplier) localSupplier.email = newEmail;
          // Regenerar mailto
          const data = await api(`/api/purchases/purchase-orders/${pm.po_id}/mailto`).catch(() => null);
          const card = panel.querySelector(`#pm-card-${idx}`);
          if (card && data?.mailto) {
            card.innerHTML = `
              <div style="font-weight:700;font-size:14px;margin-bottom:4px">${escapeHtml(pm.po_folio)} · <span style="font-weight:400;color:#6b7280">${escapeHtml(pm.supplier_name||'')}</span></div>
              <div style="font-size:12px;color:#6b7280;margin-bottom:8px">Para: <b>${escapeHtml(newEmail)}</b></div>
              <a href="${data.mailto}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:13px;padding:6px 16px;border-radius:6px;font-weight:600">📧 Abrir correo al proveedor</a>
              <span style="font-size:12px;color:#16a34a;margin-left:8px">✅ Correo guardado</span>`;
          }
        } catch(e) {
          if (msgEl) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
          saveBtn.disabled = false; saveBtn.textContent = '💾 Guardar y enviar';
        }
      };
    });
  };

  const generarPDFsPorPO = async (out) => {
    const urlMap = new Map((out.po_mailtos || []).map(pm => [pm.po_id, pm.po_view_url]));
    for (const po of (out.purchase_orders || [])) {
      const sName = (suppliers.find(s => s.id === po.supplier_id) || {}).business_name || '—';
      await generarPOPdf(po, sName, urlMap.get(po.id) || null);
    }
  };

  confirmGenPoBtn.onclick = async () => {
    try {
      poConfirmMsg.textContent = 'Generando...';
      const out = await doGeneratePO(lastPreviewIds);
      poConfirmMsg.textContent = out.message;
      if (out.po_mailtos?.length) showMailtoPanel(out.po_mailtos);
      await generarPDFsPorPO(out);
      setTimeout(render, 1800);
    } catch (e) {
      poConfirmMsg.textContent = '';
      if (e.responseData?.error === 'stale_prices') { poPreviewSection.style.display = 'none'; showStaleDialog(e.responseData.stale_items, lastPreviewIds); }
      else if (e.responseData?.error === 'zero_cost') { poPreviewSection.style.display = 'none'; showZeroCostError(e.responseData.zero_cost_items); }
      else { poConfirmMsg.textContent = e.message; }
    }
  };

  // "Generar PO" siempre muestra vista previa primero — el usuario confirma exactamente qué ítems se incluirán
  genPoBtn.onclick = async () => {
    // FASE 1: Scoped al tabContent para evitar selección cruzada entre tabs
    const ids = [...new Set([...tabContent.querySelectorAll('.po-check:checked')].map(c => Number(c.value)))].filter(Boolean);
    if (!ids.length) { poMsg.textContent = 'Selecciona al menos un ítem para continuar'; return; }
    lastPreviewIds = ids;
    try {
      poMsg.textContent = 'Preparando vista previa...';
      const preview = await api('/api/purchases/preview-po', { method:'POST', body: JSON.stringify({ item_ids: ids }) });
      renderPoPreview(preview); // FASE 2: usa preview enriquecido con edición y varianza
      poPreviewSection.style.display = 'block';
      poMsg.textContent = '';
      poPreviewSection.scrollIntoView({ behavior: 'smooth' });
    } catch(e) {
      poMsg.textContent = '';
      if (e.responseData?.error === 'stale_prices') showStaleDialog(e.responseData.stale_items, ids);
      else if (e.responseData?.error === 'zero_cost') showZeroCostError(e.responseData.zero_cost_items);
      else poMsg.textContent = e.message;
    }
  };

  // "Generar POs Faltantes" — genera automáticamente POs para TODOS los ítems
  // Autorizados con proveedor y costo, sin necesidad de seleccionar checkboxes.
  document.getElementById('genAllPendingBtn').onclick = async () => {
    const btn = document.getElementById('genAllPendingBtn');
    const readyIds = allItems
      .filter(i => i.status === 'Autorizado' && i.supplier_id && Number(i.unit_cost) > 0 && !i.purchase_order_id)
      .map(i => i.id);
    if (!readyIds.length) { poMsg.textContent = '✅ No hay ítems pendientes listos para PO'; return; }
    if (!confirm(`Se generarán POs para ${readyIds.length} ítem(s) autorizado(s). ¿Continuar?`)) return;
    btn.disabled = true;
    poMsg.textContent = `Generando POs para ${readyIds.length} ítem(s)...`;
    try {
      lastPreviewIds = readyIds;
      const out = await doGeneratePO(readyIds);
      poMsg.textContent = out.message;
      if (out.po_mailtos?.length) showMailtoPanel(out.po_mailtos);
      await generarPDFsPorPO(out);
      setTimeout(render, 1800);
    } catch(e) {
      poMsg.textContent = '';
      if (e.responseData?.error === 'stale_prices') showStaleDialog(e.responseData.stale_items, readyIds);
      else if (e.responseData?.error === 'zero_cost') showZeroCostError(e.responseData.zero_cost_items);
      else poMsg.textContent = '❌ ' + e.message;
    } finally { btn.disabled = false; }
  };

  expPoBtn.onclick = () => downloadCsv('compras_db', 'compras_db.csv', {});
  bindCommon();
  renderTab('pendientes');
}
async function proveedorPOView() {
  const [pos, myInvoices, myPaymentInvs, myRequests] = await Promise.all([
    api('/api/purchases/purchase-orders'),
    api('/api/invoices'),
    api('/api/payments/my-invoices').catch(() => []),
    api('/api/quotations/my-requests').catch(() => [])
  ]);
  const pendingResponse = pos.filter(p => p.status === 'Enviada');
  const pendingInvoice = pos.filter(p => ['Aceptada','En proceso','Entregado'].includes(p.status));
  const invoicedPOs = new Set(myInvoices.map(i => i.purchase_order_id));
  const toInvoice = pendingInvoice.filter(p => !invoicedPOs.has(p.id));
  const done = pos.filter(p => ['Facturada','Facturación parcial','Cerrada','Rechazada por proveedor'].includes(p.status));

  // Solicitudes de cotización pendientes (sin cotización enviada)
  const pendingQuoteRequests = myRequests.filter(r => !r.has_quote);
  const sentQuoteRequests = myRequests.filter(r => r.has_quote);

  app.innerHTML = shell(`
    <!-- Paso 0: Cotizaciones solicitadas -->
    <div class="card section" style="margin-bottom:12px">
      <div class="module-title">
        <h3>📩 Cotizaciones solicitadas
          <span style="background:#f59e0b;color:white;border-radius:10px;padding:2px 8px;font-size:12px;margin-left:6px">${pendingQuoteRequests.length} pendiente(s)</span>
        </h3>
      </div>
      ${myRequests.length === 0
        ? '<div class="muted small" style="padding:12px">Sin solicitudes de cotización activas.</div>'
        : `
        ${pendingQuoteRequests.length > 0 ? `
        <div style="margin-bottom:12px">
          <b class="small" style="color:#d97706">Pendientes de cotizar:</b>
          ${pendingQuoteRequests.map(r => `
          <div style="border:1px solid #fed7aa;border-radius:8px;padding:12px;margin-top:8px;background:#fffbeb">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
              <div>
                <b>${r.item_name}</b>
                <span class="small muted" style="margin-left:8px">Req: ${r.requisition_folio}</span>
                <span class="small muted" style="margin-left:8px">${r.quantity} ${r.unit}</span>
              </div>
              <span class="pill" style="background:#f59e0b;color:white;font-size:11px">Pendiente</span>
            </div>
            <div class="row-3" style="margin-bottom:8px">
              <div><label style="font-size:12px">No. cotización</label><input id="qr-num-${r.id}" placeholder="COT-001" style="font-size:12px"/></div>
              <div><label style="font-size:12px">Costo unitario *</label><input id="qr-cost-${r.id}" type="number" placeholder="0.00" style="font-size:12px"/></div>
              <div><label style="font-size:12px">Moneda</label><select id="qr-cur-${r.id}" style="font-size:12px"><option ${r.currency==='MXN'?'selected':''}>MXN</option><option ${r.currency==='USD'?'selected':''}>USD</option></select></div>
            </div>
            <div class="row-3">
              <div><label style="font-size:12px">Días de entrega</label><input id="qr-days-${r.id}" type="number" placeholder="0" style="font-size:12px"/></div>
              <div><label style="font-size:12px">Condiciones de pago</label><input id="qr-terms-${r.id}" placeholder="Ej. 30 días crédito" style="font-size:12px"/></div>
              <div><label style="font-size:12px">Código del proveedor</label><input id="qr-code-${r.id}" placeholder="SKU interno" style="font-size:12px"/></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
              <button class="btn-primary submit-quote-btn" data-reqid="${r.requisition_item_id}" data-id="${r.id}" style="font-size:12px;padding:5px 14px">Enviar cotización</button>
              <span id="qr-msg-${r.id}" class="small muted"></span>
            </div>
          </div>`).join('')}
        </div>` : ''}
        ${sentQuoteRequests.length > 0 ? `
        <div>
          <b class="small" style="color:#16a34a">Cotizaciones ya enviadas:</b>
          <div class="table-wrap" style="margin-top:6px"><table>
            <thead><tr><th>Ítem</th><th>Requisición</th><th>Cant.</th><th>Estatus</th></tr></thead>
            <tbody>${sentQuoteRequests.map(r => `<tr>
              <td>${r.item_name}</td>
              <td style="font-size:12px">${r.requisition_folio}</td>
              <td>${r.quantity} ${r.unit}</td>
              <td><span style="color:#16a34a;font-size:12px">✅ Cotización enviada</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>` : ''}
        `}
    </div>

    <!-- Paso 1: Aceptar/Rechazar POs recibidas -->
    <div class="card section" style="margin-bottom:12px">
      <div class="module-title">
        <h3>📬 Paso 1 — Órdenes recibidas, pendientes de confirmación
          <span style="background:#f59e0b;color:white;border-radius:10px;padding:2px 8px;font-size:12px;margin-left:6px">${pendingResponse.length}</span>
        </h3>
      </div>
      ${pendingResponse.length === 0
        ? '<div class="muted small" style="padding:12px">Sin órdenes pendientes de confirmación.</div>'
        : pendingResponse.map(po => `
        <div style="padding:10px;border-bottom:1px solid #f3f4f6">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            <div>
              <b>${po.folio}</b>
              <span class="small muted" style="margin-left:8px">${String(po.created_at||'').slice(0,10)}</span>
              <span style="margin-left:12px;font-weight:600">$${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}</span>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn-primary" style="font-size:12px;padding:5px 12px" onclick="respondPO(${po.id},'aceptada')">✅ Aceptar</button>
              <button class="btn-secondary" style="font-size:12px;padding:5px 12px;color:#dc2626" onclick="respondPO(${po.id},'rechazada')">✖ Rechazar</button>
            </div>
          </div>
          ${po.po_items && po.po_items.length ? `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:4px">
            <thead><tr style="background:#f8fafc"><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Descripción</th><th style="padding:4px 8px;text-align:right">Cant.</th><th style="padding:4px 8px;text-align:right">Unidad</th><th style="padding:4px 8px;text-align:right">Precio unit.</th><th style="padding:4px 8px;text-align:right">Subtotal</th></tr></thead>
            <tbody>${po.po_items.map(i=>`<tr><td style="padding:4px 8px">${i.description||'-'}</td><td style="padding:4px 8px;text-align:right">${i.quantity}</td><td style="padding:4px 8px;text-align:right">${i.unit||'pza'}</td><td style="padding:4px 8px;text-align:right">$${Number(i.unit_cost||0).toFixed(2)}</td><td style="padding:4px 8px;text-align:right;font-weight:600">$${Number(i.subtotal||0).toFixed(2)}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}
        </div>`).join('')}
    </div>

    <!-- Paso 2: Subir factura -->
    <div class="card section" style="margin-bottom:12px">
      <div class="module-title">
        <h3>🧾 Paso 2 — Subir factura de POs aceptadas
          <span style="background:#3b82f6;color:white;border-radius:10px;padding:2px 8px;font-size:12px;margin-left:6px">${toInvoice.length}</span>
        </h3>
      </div>
      ${toInvoice.length === 0
        ? '<div class="muted small" style="padding:12px">Sin facturas pendientes de subir.</div>'
        : toInvoice.map(po => `
        <div style="padding:10px;border-bottom:1px solid #f3f4f6">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            <div>
              <b>${po.folio}</b>
              ${statusPill(po.status)}
              ${po.invoice_requested ? '<span style="font-size:11px;color:#2563eb;margin-left:6px">📧 El comprador solicitó esta factura</span>' : ''}
            </div>
            <b>$${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}</b>
          </div>
          ${po.po_items && po.po_items.length ? `
          <div style="overflow-x:auto;margin-bottom:10px">
            <table style="width:100%;font-size:12px;border-collapse:collapse">
              <thead><tr style="background:#f8fafc"><th style="padding:4px 8px;text-align:left">Descripción</th><th style="padding:4px 8px;text-align:right">Cant.</th><th style="padding:4px 8px;text-align:right">Precio</th><th style="padding:4px 8px;text-align:right">Subtotal</th><th style="padding:4px 8px;text-align:right">IVA 16%</th><th style="padding:4px 8px;text-align:right;font-weight:700">Total</th></tr></thead>
              <tbody>${po.po_items.map(i => { const sub=Number(i.quantity||0)*Number(i.unit_cost||0); const iva=sub*0.16; return `<tr><td style="padding:4px 8px">${i.description||'-'}</td><td style="padding:4px 8px;text-align:right">${i.quantity} ${i.unit||''}</td><td style="padding:4px 8px;text-align:right">$${Number(i.unit_cost||0).toFixed(2)}</td><td style="padding:4px 8px;text-align:right">$${sub.toFixed(2)}</td><td style="padding:4px 8px;text-align:right">$${iva.toFixed(2)}</td><td style="padding:4px 8px;text-align:right;font-weight:600">$${(sub+iva).toFixed(2)}</td></tr>`; }).join('')}</tbody>
              <tfoot><tr style="background:#f0fdf4;font-weight:700"><td colspan="3" style="padding:4px 8px;text-align:right">Totales:</td><td style="padding:4px 8px;text-align:right">$${po.po_items.reduce((s,i)=>s+Number(i.quantity||0)*Number(i.unit_cost||0),0).toFixed(2)}</td><td style="padding:4px 8px;text-align:right">$${(po.po_items.reduce((s,i)=>s+Number(i.quantity||0)*Number(i.unit_cost||0),0)*0.16).toFixed(2)}</td><td style="padding:4px 8px;text-align:right;color:#1d4ed8">$${(po.po_items.reduce((s,i)=>s+Number(i.quantity||0)*Number(i.unit_cost||0),0)*1.16).toFixed(2)}</td></tr></tfoot>
            </table>
          </div>` : ''}
          ${Number(po.advance_percentage||0) > 0 && po.advance_status !== 'N/A' ? `
          <div style="padding:8px 10px;margin-bottom:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:12px">
            💰 <b>Esta PO requiere anticipo del ${po.advance_percentage}%</b>
            (${Number(po.advance_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'})
            · Estado: <b>${po.advance_status}</b>
            ${po.advance_status === 'Solicitado' ? '<br><span style="color:#1d4ed8">→ El comprador solicitó el anticipo. Sube la factura de anticipo primero.</span>' : ''}
          </div>
          ${po.advance_status === 'Solicitado' ? `
          <div style="background:#f0f9ff;padding:10px;border-radius:6px;margin-bottom:10px;border:1px solid #bae6fd">
            <b style="font-size:13px">📄 Subir factura de ANTICIPO</b>
            <div class="row-3" style="margin-top:8px">
              <div><label style="font-size:12px">No. factura anticipo *</label><input id="sinv-ant-num-${po.id}" placeholder="ANT-001"/></div>
              <div><label style="font-size:12px">Subtotal anticipo</label><input id="sinv-ant-sub-${po.id}" type="number" value="${Number(po.advance_amount||0).toFixed(2)}" oninput="document.getElementById('sinv-ant-tax-${po.id}').value=(+this.value*0.16).toFixed(2)"/></div>
              <div><label style="font-size:12px">IVA (16%)</label><input id="sinv-ant-tax-${po.id}" type="number" value="${(Number(po.advance_amount||0)*0.16).toFixed(2)}"/></div>
            </div>
            <div class="row-2" style="margin-top:8px">
              <div><label style="font-size:12px">📄 PDF</label><input type="file" id="sinv-ant-pdf-${po.id}" accept=".pdf" style="font-size:12px"/></div>
              <div><label style="font-size:12px">📋 XML</label><input type="file" id="sinv-ant-xml-${po.id}" accept=".xml" style="font-size:12px"/></div>
            </div>
            <div style="margin-top:8px;display:flex;gap:10px;align-items:center">
              <button class="btn-primary sup-inv-save" data-id="${po.id}" data-supplier="${po.supplier_id}" data-type="anticipo" style="font-size:12px;padding:5px 14px;background:#1d4ed8">💰 Subir factura anticipo</button>
              <span id="sinv-ant-msg-${po.id}" class="small muted"></span>
            </div>
          </div>` : ''}` : ''}
          <div class="row-3">
            <div><label style="font-size:12px">No. factura ${Number(po.advance_percentage||0)>0?'final':''} *</label><input id="sinv-num-${po.id}" placeholder="FACT-001"/></div>
            <div><label style="font-size:12px">Subtotal *</label><input id="sinv-sub-${po.id}" type="number" value="${Number(po.total_amount||0).toFixed(2)}" oninput="document.getElementById('sinv-tax-${po.id}').value=(+this.value*0.16).toFixed(2)"/></div>
            <div><label style="font-size:12px">IVA (16%)</label><input id="sinv-tax-${po.id}" type="number" value="${(Number(po.total_amount||0)*0.16).toFixed(2)}"/></div>
          </div>
          <div class="row-2" style="margin-top:8px">
            <div><label style="font-size:12px">📄 PDF de la factura</label><input type="file" id="sinv-pdf-${po.id}" accept=".pdf" style="font-size:12px"/></div>
            <div><label style="font-size:12px">📋 XML (CFDI)</label><input type="file" id="sinv-xml-${po.id}" accept=".xml" style="font-size:12px"/></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap">
            <button class="btn-primary sup-inv-save" data-id="${po.id}" data-supplier="${po.supplier_id}" data-type="normal" style="font-size:12px;padding:5px 14px">Subir factura</button>
            <span id="sinv-msg-${po.id}" class="small muted"></span>
          </div>
        </div>`).join('')}
    </div>

    <!-- Seguimiento de pagos -->
    <div class="card section" style="margin-bottom:12px">
      <div class="module-title">
        <h3>💳 Paso 3 — Seguimiento de pagos</h3>
      </div>
      ${myPaymentInvs.length === 0
        ? '<div class="muted small" style="padding:12px">Sin facturas registradas aún.</div>'
        : myPaymentInvs.map(inv => {
          const overdue = Number(inv.days_overdue || 0);
          const overdueStr = inv.days_overdue !== null && inv.days_overdue !== undefined
            ? (overdue > 0 ? `<span style="color:#dc2626;font-weight:700"> ⚠ ${overdue} días VENCIDO</span>`
              : overdue === 0 ? `<span style="color:#f59e0b"> Vence hoy</span>`
              : `<span style="color:#16a34a"> ${Math.abs(overdue)} días restantes</span>`)
            : '';
          const payments = (inv.payments || []);
          const isPaid = inv.status === 'Pagada';
          return `
          <div style="padding:12px;border-bottom:1px solid #f3f4f6">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
              <div>
                <b>${inv.invoice_number}</b>
                ${inv.urgent ? '<span style="background:#dc2626;color:white;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:6px">URGENTE</span>' : ''}
                ${statusPill(inv.status)}
                <div class="small muted">Facturado: ${String(inv.created_at||'').slice(0,10)} ${inv.due_date ? '· Vence: '+inv.due_date : ''} ${overdueStr}</div>
              </div>
              <div style="text-align:right">
                <div><b>$${Number(inv.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</b></div>
                <div class="small muted">Saldo: $${Number(inv.balance||inv.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
              ${!isPaid && !inv.urgent
                ? `<button class="btn-secondary urgent-btn" data-id="${inv.id}" style="font-size:12px;padding:4px 10px;color:#dc2626;border-color:#dc2626">🔴 Marcar urgente</button>`
                : ''}
              ${!isPaid ? (() => {
                const lastReminder = inv.last_reminder_at ? new Date(inv.last_reminder_at) : null;
                const daysSince = lastReminder ? Math.floor((Date.now() - lastReminder.getTime()) / 86400000) : 999;
                const canRemind = daysSince >= 7;
                return canRemind
                  ? `<button class="btn-secondary reminder-btn" data-id="${inv.id}" style="font-size:12px;padding:4px 10px;color:#2563eb;border-color:#2563eb">📩 Enviar recordatorio</button>`
                  : `<span style="font-size:11px;color:#9ca3af">Recordatorio enviado hace ${daysSince} día(s)</span>`;
              })() : ''}
              ${isPaid
                ? `<span style="color:#16a34a;font-size:12px;font-weight:600">✅ Pagado</span>`
                : ''}
            </div>
            ${payments.length > 0 ? `<div style="margin-top:8px;overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
              <thead><tr style="background:#f0f9ff"><th style="padding:4px 8px;text-align:left">Fecha</th><th style="padding:4px 8px;text-align:right">Monto</th><th style="padding:4px 8px;text-align:left">Tipo</th><th style="padding:4px 8px;text-align:left">Referencia</th><th style="padding:4px 8px;text-align:center">Comprobante</th></tr></thead>
              <tbody>${payments.map(p=>`<tr>
                <td style="padding:4px 8px">${String(p.created_at||'').slice(0,10)}</td>
                <td style="padding:4px 8px;text-align:right;font-weight:600;color:#16a34a">$${Number(p.amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
                <td style="padding:4px 8px">${p.payment_type||'-'}</td>
                <td style="padding:4px 8px">${p.reference||'-'}</td>
                <td style="padding:4px 8px;text-align:center">${p.proof_path ? `<a href="${p.proof_path}" target="_blank" style="font-size:12px">📎 Ver</a>` : '-'}</td>
              </tr>`).join('')}</tbody>
            </table></div>` : ''}
            <div id="urgent-msg-${inv.id}" class="small muted" style="margin-top:4px"></div>
          </div>`;
        }).join('')}
    </div>

    <!-- Comprobantes de pago recibidos -->
    ${myPaymentInvs.some(i => i.status === 'Pagada') ? `
    <div class="card section" style="margin-bottom:12px">
      <h3>🧾 Comprobantes de pago recibidos</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Factura</th><th>Monto pagado</th><th>Fecha pago</th><th>Referencia</th><th>Comprobante</th></tr></thead>
        <tbody>${myPaymentInvs.filter(i => i.status === 'Pagada').map(inv => `<tr>
          <td><b>${inv.invoice_number}</b></td>
          <td>$${Number(inv.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
          <td>${String(inv.created_at||'').slice(0,10)}</td>
          <td>-</td>
          <td><span class="muted small">Ver en historial</span></td>
        </tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}

    <!-- Historial de POs -->
    <div class="card section">
      <h3>📁 Historial de POs</h3>
      ${done.length === 0 ? '<div class="muted small" style="padding:12px">Sin historial.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Folio PO</th><th>Fecha</th><th>Total</th><th>Estatus</th></tr></thead>
        <tbody>${done.map(po => `<tr>
          <td><b>${po.folio}</b></td>
          <td>${String(po.created_at||'').slice(0,10)}</td>
          <td>$${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}</td>
          <td>${statusPill(po.status)}</td>
        </tr>`).join('')}
        </tbody></table></div>`}
    </div>
  `, 'cotizaciones');

  // Subir factura desde proveedor
  document.querySelectorAll('.sup-inv-save').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const invType = btn.dataset.type || 'normal';
      const isAnticipo = invType === 'anticipo';
      // Usar inputs de anticipo si es anticipo, de lo contrario los normales
      const prefix = isAnticipo ? `sinv-ant-${id}` : `sinv-${id}`;
      const numEl = document.getElementById(isAnticipo ? `sinv-ant-num-${id}` : `sinv-num-${id}`);
      const subEl = document.getElementById(isAnticipo ? `sinv-ant-sub-${id}` : `sinv-sub-${id}`);
      const taxEl = document.getElementById(isAnticipo ? `sinv-ant-tax-${id}` : `sinv-tax-${id}`);
      const pdfEl = document.getElementById(isAnticipo ? `sinv-ant-pdf-${id}` : `sinv-pdf-${id}`);
      const xmlEl = document.getElementById(isAnticipo ? `sinv-ant-xml-${id}` : `sinv-xml-${id}`);
      const msgEl = document.getElementById(isAnticipo ? `sinv-ant-msg-${id}` : `sinv-msg-${id}`);
      try {
        if (!numEl || !numEl.value) throw new Error('Ingresa el número de factura');
        const sub = Number(subEl.value||0);
        if (!sub) throw new Error('Ingresa subtotal mayor a cero');
        const tax = Number(taxEl.value||0);
        const fd = new FormData();
        fd.append('purchase_order_id', id);
        fd.append('supplier_id', btn.dataset.supplier);
        fd.append('invoice_number', numEl.value);
        fd.append('invoice_type', invType);
        fd.append('subtotal', sub);
        fd.append('taxes', tax);
        fd.append('total', sub + tax);
        if (pdfEl && pdfEl.files[0]) fd.append('pdf', pdfEl.files[0]);
        if (xmlEl && xmlEl.files[0]) fd.append('xml', xmlEl.files[0]);
        const res = await fetch('/api/invoices', { method: 'POST', credentials: 'include', body: fd });
        if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
        const out2 = await res.json();
        if (out2.mailto_comprador) { const a = document.createElement('a'); a.href = out2.mailto_comprador; a.click(); }
        msgEl.textContent = isAnticipo ? '✅ Factura de anticipo subida. El área de pagos recibirá la solicitud.' : '✅ Factura subida correctamente';
        msgEl.style.color = '#16a34a';
        btn.disabled = true;
        setTimeout(render, 1200);
      } catch(e) { if (msgEl) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; } }
    };
  });

  // Enviar cotización desde solicitud
  document.querySelectorAll('.submit-quote-btn').forEach(btn => {
    btn.onclick = async () => {
      const rid = btn.dataset.id;
      const reqItemId = btn.dataset.reqid;
      const costEl = document.getElementById(`qr-cost-${rid}`);
      const numEl = document.getElementById(`qr-num-${rid}`);
      const daysEl = document.getElementById(`qr-days-${rid}`);
      const termsEl = document.getElementById(`qr-terms-${rid}`);
      const codeEl = document.getElementById(`qr-code-${rid}`);
      const curEl = document.getElementById(`qr-cur-${rid}`);
      const msgEl = document.getElementById(`qr-msg-${rid}`);
      try {
        if (!costEl.value || Number(costEl.value) <= 0) throw new Error('Ingresa un costo mayor a cero');
        btn.disabled = true;
        await api('/api/quotations', { method: 'POST', body: JSON.stringify({
          requisition_item_id: Number(reqItemId),
          unit_cost: Number(costEl.value),
          quote_number: numEl.value,
          delivery_days: Number(daysEl.value || 0),
          payment_terms: termsEl.value,
          provider_code: codeEl.value,
          currency: curEl.value || 'MXN'
        })});
        msgEl.textContent = '✅ Cotización enviada correctamente';
        msgEl.style.color = '#16a34a';
        setTimeout(render, 1000);
      } catch(e) {
        btn.disabled = false;
        msgEl.textContent = e.message;
        msgEl.style.color = '#dc2626';
      }
    };
  });

  // Marcar factura como urgente
  document.querySelectorAll('.urgent-btn').forEach(btn => {
    btn.onclick = async () => {
      const nota = prompt('Motivo urgente (opcional, ej: "Vence mañana"):') || '';
      try {
        btn.disabled = true;
        await api(`/api/payments/invoices/${btn.dataset.id}/urgent`, { method: 'PATCH', body: JSON.stringify({ note: nota }) });
        const msgEl = document.getElementById(`urgent-msg-${btn.dataset.id}`);
        if (msgEl) { msgEl.textContent = '🔴 Marcado como urgente — el equipo de pagos será notificado.'; msgEl.style.color = '#dc2626'; }
        btn.textContent = '🔴 Urgente marcado';
      } catch(e) {
        btn.disabled = false;
        alert(e.message);
      }
    };
  });

  document.querySelectorAll('.reminder-btn').forEach(btn => {
    btn.onclick = async () => {
      try {
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        const data = await api(`/api/invoices/${btn.dataset.id}/reminder`, { method: 'POST' });
        if (data.mailto) window.open(data.mailto, '_blank');
        const msgEl = document.getElementById(`urgent-msg-${btn.dataset.id}`);
        if (msgEl) { msgEl.textContent = `✅ ${data.message}`; msgEl.style.color = '#16a34a'; }
        btn.textContent = '✅ Recordatorio enviado';
      } catch(e) {
        btn.disabled = false;
        btn.textContent = '📩 Enviar recordatorio';
        const msgEl = document.getElementById(`urgent-msg-${btn.dataset.id}`);
        if (msgEl) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
      }
    };
  });

  bindCommon();
}

window.respondPO = async (poId, decision) => {
  const nota = decision === 'rechazada' ? (prompt('Motivo de rechazo (opcional):') || '') : '';
  try {
    await api(`/api/purchases/purchase-orders/${poId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision, supplier_note: nota })
    });
    render();
  } catch (e) { alert(e.message); }
};


async function quotationsView() {
  // El proveedor no puede acceder a pending-items → vista propia
  if (roleCan('proveedor')) return proveedorPOView();

  const [quotes, pending, suppliers] = await Promise.all([
    api('/api/quotations'),
    api('/api/purchases/pending-items'),
    api('/api/catalogs/suppliers')
  ]);

  // Ítems que aún necesitan cotización (sin ganadora)
  const itemsPendienteCotizacion = pending.filter(x => x.status === 'En cotización');

  // Ítems que ya tienen cotización ganadora
  const itemsConGanadora = new Set(quotes.filter(q => q.is_winner).map(q => q.requisition_item_id));

  // Cotizaciones activas = tienen ítems pendientes en cotización (sin ganadora aún)
  const cotizacionesPendientes = itemsPendienteCotizacion.filter(i => !itemsConGanadora.has(i.id));
  const cotizacionesActivas = quotes.filter(q => !q.is_winner);
  const cotizacionesGanadoras = quotes.filter(q => q.is_winner);

  app.innerHTML = shell(`
    <div class="grid grid-2">
      <!-- FORMULARIO: solo muestra ítems sin ganadora -->
      <div class="card section">
        <h3>Registrar cotización</h3>
        ${cotizacionesPendientes.length === 0 ? `
          <div style="padding:20px;text-align:center;color:#16a34a;border:1px solid #bbf7d0;border-radius:8px;background:#f0fff4">
            <div style="font-size:24px">✅</div>
            <b>Todas las cotizaciones tienen ganadora asignada</b>
            <p class="small muted">No hay ítems pendientes de cotización.</p>
          </div>
        ` : `
          <div><label>Ítem pendiente (${cotizacionesPendientes.length} sin ganadora)</label>
            <select id="quoteItem">
              <option value="">Selecciona ítem</option>
              ${cotizacionesPendientes.map(i => `<option value="${i.id}" data-supplier="${i.supplier_id||''}">${i.requisition_folio} · ${i.item_name}</option>`).join('')}
            </select>
            <div id="selectedItemIndicator" style="margin-top:4px;font-size:12px;color:#1d4ed8;font-weight:600;min-height:18px"></div>
          </div>
          <div style="margin-top:8px">
            <label>Proveedor</label>
            <div style="display:flex;gap:6px;align-items:center">
              <select id="quoteSupplier" style="flex:1"><option value="">— Selecciona proveedor —</option><option value="__new__">➕ Crear proveedor nuevo…</option>${suppliers.map(s => `<option value="${s.id}">${s.business_name}</option>`).join('')}</select>
            </div>
            <div id="newSupplierForm" style="display:none;margin-top:8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px">
              <div style="font-weight:600;font-size:13px;margin-bottom:8px">➕ Nuevo proveedor</div>
              <div class="row-2" style="margin-bottom:6px">
                <div><label style="font-size:12px">Nombre / Razón social *</label><input id="ns-name" placeholder="Ej. Quimicos del Norte SA"/></div>
                <div><label style="font-size:12px">RFC</label><input id="ns-rfc" placeholder="Ej. QDN850101XXX"/></div>
              </div>
              <div class="row-3" style="margin-bottom:6px">
                <div><label style="font-size:12px">Contacto</label><input id="ns-contact" placeholder="Nombre contacto"/></div>
                <div><label style="font-size:12px">Email</label><input id="ns-email" type="email" placeholder="contacto@empresa.com"/></div>
                <div><label style="font-size:12px">Teléfono</label><input id="ns-phone" placeholder="55 1234 5678"/></div>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn-primary" id="saveNewSupplierBtn" style="font-size:13px">Guardar proveedor</button>
                <button class="btn-secondary" id="cancelNewSupplierBtn" style="font-size:13px">Cancelar</button>
                <span id="nsMsg" class="small muted"></span>
              </div>
            </div>
          </div>
          <div class="row-2" style="margin-top:8px">
            <div><label>No. cotización</label><input id="quoteNumber" placeholder="COT-001"/></div>
            <div><label>Días entrega</label><input id="quoteDays" type="number" placeholder="0"/></div>
          </div>
          <div class="row-3" style="margin-top:8px">
            <div><label>Costo unitario</label><input id="quoteUnitCost" type="number" placeholder="0.00"/></div>
            <div><label>Moneda</label><select id="quoteCurrencyField"><option>MXN</option><option>USD</option></select></div>
            <div><label>Condiciones de pago</label><input id="quotePayTerms" placeholder="30 días"/></div>
          </div>
          <div class="row-2" style="margin-top:8px">
            <div><label>Código proveedor</label><input id="quoteCode" placeholder="SKU"/></div>
            <div><label>Nombre oficial del ítem</label><input id="quoteName" placeholder="Nombre oficial"/></div>
          </div>
          <div style="margin-top:8px"><label style="font-size:12px">📎 Adjuntar cotización (PDF/imagen)</label><input type="file" id="quoteFile" accept=".pdf,.jpg,.jpeg,.png" style="font-size:12px;margin-top:4px;display:block"/></div>
          <div class="actions" style="gap:8px">
            <button class="btn-primary" id="saveQuoteBtn">Guardar cotización</button>
            <button class="btn-secondary" id="declineQuoteBtn" style="color:#dc2626;border-color:#dc2626">✖ Declinar</button>
          </div>
          <div id="quoteMsg" class="small muted"></div>
        `}
      </div>

      <!-- COMPARADOR -->
      <div class="card section">
        <div class="module-title"><h3>Comparador y selección de ganadora</h3></div>
        <div style="margin-bottom:8px">
          <label>Comparar cotizaciones del ítem:</label>
          <select id="compareItemSel">
            <option value="">Selecciona ítem</option>
            ${[...new Map(quotes.map(q => [q.requisition_item_id, q])).values()].map(q => `<option value="${q.requisition_item_id}" ${q.is_winner?'style="color:#16a34a"':''}>${q.requisition_folio||''} · ${q.item_name} ${itemsConGanadora.has(q.requisition_item_id)?'✅':''}</option>`).join('')}
          </select>
        </div>
        <div id="compareTable"><div class="muted small">Selecciona un ítem para comparar y elegir ganadora</div></div>
      </div>
    </div>

    <!-- SECCIÓN: Cotizaciones pendientes -->
    ${cotizacionesPendientes.length > 0 ? `
    <div class="card section" style="margin-top:16px">
      <div class="module-title">
        <h3>📩 Cotizaciones pendientes <span style="background:#f59e0b;color:white;border-radius:10px;padding:2px 8px;font-size:12px;margin-left:6px">${cotizacionesPendientes.length}</span></h3>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Requisición</th><th>Ítem</th><th>Proveedor sugerido</th><th>Cotizaciones recibidas</th></tr></thead>
        <tbody>${cotizacionesPendientes.map(i => {
          const receivedCount = quotes.filter(q => q.requisition_item_id === i.id).length;
          return `<tr>
            <td style="font-size:12px">${i.requisition_folio||'-'}</td>
            <td><b>${i.item_name}</b></td>
            <td>${i.supplier_name||'-'}</td>
            <td>${receivedCount > 0 ? `<span style="color:#2563eb">${receivedCount} recibida(s)</span> · <a href="#" class="compare-link" data-id="${i.id}">Comparar</a>` : '<span class="muted">Sin respuesta</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
    </div>` : ''}

    <!-- SECCIÓN: Cotizaciones activas (recibidas sin ganadora) -->
    ${cotizacionesActivas.length > 0 ? `
    <div class="card section" style="margin-top:16px">
      <div class="module-title"><h3>📋 Cotizaciones recibidas (sin ganadora)</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Proveedor</th><th>Ítem</th><th>No. Cot.</th><th>Entrega</th><th>Costo</th><th>Moneda</th><th>Condiciones</th><th>Acción</th></tr></thead>
        <tbody>${cotizacionesActivas.map(q => `<tr>
          <td>${q.supplier_name}</td>
          <td>${q.item_name||q.official_item_name}</td>
          <td>${q.quote_number||'-'}</td>
          <td>${q.delivery_days||0} días</td>
          <td><b>$${Number(q.unit_cost||0).toFixed(2)}</b></td>
          <td>${q.currency||'MXN'}</td>
          <td>${q.payment_terms||'-'}</td>
          <td><a href="#" class="compare-link" data-id="${q.requisition_item_id}" style="font-size:12px">Ver comparador</a></td>
        </tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}

    <!-- SECCIÓN: Ganadoras seleccionadas -->
    <div class="card section" style="margin-top:16px">
      <div class="module-title">
        <h3>🏆 Cotizaciones ganadoras <span style="background:#10b981;color:white;border-radius:10px;padding:2px 8px;font-size:12px;margin-left:6px">${cotizacionesGanadoras.length}</span></h3>
        <button class="btn-secondary" id="expQuoteBtn">Exportar</button>
      </div>
      ${cotizacionesGanadoras.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>🏆</th><th>Proveedor</th><th>Ítem</th><th>Costo</th><th>Moneda</th><th>Entrega</th><th>No. Cot.</th></tr></thead>
        <tbody>${cotizacionesGanadoras.map(q => `<tr style="background:#f0fff4">
          <td>🏆</td>
          <td><b>${q.supplier_name}</b></td>
          <td>${q.item_name||q.official_item_name}</td>
          <td><b>$${Number(q.unit_cost||0).toFixed(2)}</b></td>
          <td>${q.currency||'MXN'}</td>
          <td>${q.delivery_days||0} días</td>
          <td>${q.quote_number||'-'}</td>
        </tr>`).join('')}
        </tbody></table></div>` : '<div class="muted small" style="padding:12px">Sin ganadoras seleccionadas aún</div>'}
    </div>
  `, 'cotizaciones');

  // Listeners del formulario
  const compareItemSel = document.getElementById('compareItemSel');
  const compareTable = document.getElementById('compareTable');
  const expQuoteBtn = document.getElementById('expQuoteBtn');

  if (document.getElementById('quoteItem')) {
    const quoteItem = document.getElementById('quoteItem');
    const quoteSupplier = document.getElementById('quoteSupplier');
    const quoteNumber = document.getElementById('quoteNumber');
    const quoteDays = document.getElementById('quoteDays');
    const quoteUnitCost = document.getElementById('quoteUnitCost');
    const quotePayTerms = document.getElementById('quotePayTerms');
    const quoteCode = document.getElementById('quoteCode');
    const quoteName = document.getElementById('quoteName');
    const quoteCurrencyField = document.getElementById('quoteCurrencyField');
    const saveQuoteBtn = document.getElementById('saveQuoteBtn');
    const quoteMsg = document.getElementById('quoteMsg');
    const declineQuoteBtn = document.getElementById('declineQuoteBtn');

    quoteItem.onchange = () => {
      // Limpiar todos los campos al cambiar de ítem
      quoteSupplier.value = '';
      quoteNumber.value = '';
      quoteDays.value = '';
      quoteUnitCost.value = '';
      quotePayTerms.value = '';
      quoteCode.value = '';
      quoteName.value = '';
      const qf = document.getElementById('quoteFile');
      if (qf) qf.value = '';
      const msgEl = document.getElementById('quoteMsg');
      if (msgEl) { msgEl.textContent = ''; }

      // Actualizar indicador del ítem seleccionado
      const selIndicator = document.getElementById('selectedItemIndicator');
      if (selIndicator) selIndicator.textContent = quoteItem.value ? `📌 Ítem: ${quoteItem.options[quoteItem.selectedIndex]?.text || ''}` : '';

      if (!quoteItem.value) {
        // Sin ítem: mostrar todos los proveedores
        quoteSupplier.innerHTML = `<option value="">— Selecciona proveedor —</option><option value="__new__">➕ Crear proveedor nuevo…</option>${suppliers.map(s=>`<option value="${s.id}">${s.business_name}</option>`).join('')}`;
        return;
      }

      // Filtrar proveedores: solo los que tienen solicitud de cotización para este ítem
      const item = cotizacionesPendientes.find(i => i.id === Number(quoteItem.value));
      const requestedIds = new Set(item?.quotation_request_supplier_ids || []);
      const requestedSuppliers = suppliers.filter(s => requestedIds.has(s.id));
      const otherSuppliers = suppliers.filter(s => !requestedIds.has(s.id));

      quoteSupplier.innerHTML = `
        <option value="">— Selecciona proveedor —</option>
        <option value="__new__">➕ Crear proveedor nuevo…</option>
        ${requestedSuppliers.length ? `<optgroup label="Proveedores solicitados">${requestedSuppliers.map(s=>`<option value="${s.id}">${s.business_name}</option>`).join('')}</optgroup>` : ''}
        <optgroup label="Otros proveedores">${otherSuppliers.map(s=>`<option value="${s.id}" data-extra="1">${s.business_name}</option>`).join('')}</optgroup>
      `;

      // Auto-proponer número de cotización
      const count = quotes.filter(q => q.requisition_item_id === Number(quoteItem.value)).length + 1;
      quoteNumber.value = `COT-${String(quoteItem.value).slice(-4).padStart(4,'0')}-${String(count).padStart(2,'0')}`;
      // Auto-llenar nombre
      if (item) quoteName.value = item.item_name || '';
    };
    // Mostrar/ocultar form de nuevo proveedor
    quoteSupplier.onchange = () => {
      const nf = document.getElementById('newSupplierForm');
      if (quoteSupplier.value === '__new__') {
        nf.style.display = '';
        document.getElementById('ns-name').focus();
      } else {
        nf.style.display = 'none';
        const sup = suppliers.find(s => s.id === Number(quoteSupplier.value));
        if (sup && sup.provider_code) quoteCode.value = sup.provider_code;
      }
    };

    // Guardar nuevo proveedor
    document.getElementById('saveNewSupplierBtn').onclick = async () => {
      const nsMsg = document.getElementById('nsMsg');
      const name = document.getElementById('ns-name').value.trim();
      if (!name) { nsMsg.textContent = 'Nombre requerido'; nsMsg.style.color = '#dc2626'; return; }
      try {
        const ns = await api('/api/catalogs/suppliers', { method: 'POST', body: JSON.stringify({
          business_name: name,
          rfc: document.getElementById('ns-rfc').value.trim(),
          contact_name: document.getElementById('ns-contact').value.trim(),
          email: document.getElementById('ns-email').value.trim(),
          phone: document.getElementById('ns-phone').value.trim()
        })});
        suppliers.push(ns);
        // Agregar opción al select y seleccionarla
        const opt = document.createElement('option');
        opt.value = ns.id; opt.textContent = ns.business_name;
        quoteSupplier.appendChild(opt);
        quoteSupplier.value = ns.id;
        document.getElementById('newSupplierForm').style.display = 'none';
        if (quoteCode && ns.provider_code) quoteCode.value = ns.provider_code;
        nsMsg.textContent = '';
      } catch(e) { nsMsg.textContent = e.message; nsMsg.style.color = '#dc2626'; }
    };
    document.getElementById('cancelNewSupplierBtn').onclick = () => {
      document.getElementById('newSupplierForm').style.display = 'none';
      quoteSupplier.value = '';
    };

    saveQuoteBtn.onclick = async () => {
      try {
        if (!quoteItem.value) throw new Error('Selecciona un ítem');
        if (!quoteSupplier.value || quoteSupplier.value === '__new__') throw new Error('Selecciona o guarda primero un proveedor');
        if (!quoteUnitCost.value || Number(quoteUnitCost.value) <= 0) throw new Error('Ingresa costo mayor a cero');
        const selectedItemText = quoteItem.options[quoteItem.selectedIndex]?.text || '';
        if (!confirm(`¿Guardar cotización para:\n"${selectedItemText}"?\n\nCosto: $${Number(quoteUnitCost.value).toFixed(2)} ${quoteCurrencyField.value||'MXN'}`)) return;
        const qFile = document.getElementById('quoteFile');
        let quoteResult;
        if (qFile && qFile.files[0]) {
          const fd = new FormData();
          fd.append('requisition_item_id', quoteItem.value);
          fd.append('supplier_id', quoteSupplier.value);
          fd.append('quote_number', quoteNumber.value);
          fd.append('delivery_days', quoteDays.value||0);
          fd.append('unit_cost', quoteUnitCost.value);
          fd.append('currency', quoteCurrencyField.value || 'MXN');
          fd.append('payment_terms', quotePayTerms.value);
          fd.append('provider_code', quoteCode.value);
          fd.append('official_item_name', quoteName.value);
          fd.append('attachment', qFile.files[0]);
          const res = await fetch('/api/quotations', { method: 'POST', credentials: 'include', body: fd });
          if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
          quoteResult = await res.json();
        } else {
          quoteResult = await api('/api/quotations', { method: 'POST', body: JSON.stringify({
            requisition_item_id: Number(quoteItem.value),
            supplier_id: Number(quoteSupplier.value),
            quote_number: quoteNumber.value,
            delivery_days: Number(quoteDays.value||0),
            unit_cost: Number(quoteUnitCost.value),
            currency: quoteCurrencyField.value || 'MXN',
            payment_terms: quotePayTerms.value,
            provider_code: quoteCode.value,
            official_item_name: quoteName.value
          })});
        }
        quoteMsg.textContent = '✅ Cotización guardada';
        quoteMsg.style.color = '#16a34a';
        quoteItem.value = ''; quoteSupplier.value = ''; quoteNumber.value = ''; quoteDays.value = '';
        quoteUnitCost.value = ''; quotePayTerms.value = ''; quoteCode.value = ''; quoteName.value = '';
        setTimeout(render, 900);
      } catch (e) { quoteMsg.textContent = e.message; quoteMsg.style.color = '#dc2626'; }
    };
    if (document.getElementById('declineQuoteBtn')) {
      declineQuoteBtn.onclick = async () => {
        const itemId = quoteItem?.value;
        if (!itemId) { quoteMsg.textContent = 'Selecciona un ítem.'; return; }
        if (!confirm('¿Declinar cotización para este ítem? El ítem volverá a estar disponible.')) return;
        try {
          await api(`/api/purchases/items/${itemId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cotización declinada por comprador' }) });
          quoteMsg.textContent = '✅ Ítem declinado';
          setTimeout(render, 800);
        } catch(e) { quoteMsg.textContent = e.message; }
      };
    }
  }

  // Comparador
  const loadComparator = async (itemId) => {
    if (!itemId) { compareTable.innerHTML = '<div class="muted small">Selecciona un ítem</div>'; return; }
    compareItemSel.value = itemId;
    const itemQuotes = await api(`/api/quotations/by-item/${itemId}`);
    if (!itemQuotes.length) { compareTable.innerHTML = '<div class="muted small">Sin cotizaciones para este ítem aún</div>'; return; }
    const minCost = Math.min(...itemQuotes.map(q => Number(q.unit_cost||0)));
    compareTable.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Proveedor</th><th>Costo</th><th>Entrega</th><th>Condiciones</th><th>No. Cot.</th><th>Acción</th></tr></thead>
        <tbody>${itemQuotes.map(q => {
          const isBest = Number(q.unit_cost||0) === minCost;
          return `<tr style="${q.is_winner?'background:#f0fff4;font-weight:600':(isBest&&!q.is_winner?'background:#fffbeb':'')}">
            <td>${q.is_winner?'🏆 ':''}<b>${q.supplier_name}</b></td>
            <td style="color:${isBest?'#16a34a':'inherit'}"><b>$${Number(q.unit_cost||0).toFixed(2)}</b>${isBest&&!q.is_winner?' <small style="color:#16a34a">mejor</small>':''}</td>
            <td>${q.delivery_days||0} días</td>
            <td>${q.payment_terms||'-'}</td>
            <td>${q.quote_number||'-'}</td>
            <td>${q.is_winner
              ? '<span style="color:#16a34a">✅ Ganadora</span>'
              : `<button class="btn-primary select-winner" data-id="${q.id}" style="padding:3px 10px;font-size:12px">Elegir ganadora</button>`
            }</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div id="winnerMsg" class="small muted" style="margin-top:6px"></div>`;

    compareTable.querySelectorAll('.select-winner').forEach(btn => btn.onclick = async () => {
      try {
        btn.textContent = '...'; btn.disabled = true;
        const out = await api(`/api/quotations/${btn.dataset.id}/select-winner`, { method: 'POST' });
        document.getElementById('winnerMsg').textContent = out.message || '✅ Ganadora seleccionada';
        document.getElementById('winnerMsg').style.color = '#16a34a';
        setTimeout(render, 1000);
      } catch (e) {
        document.getElementById('winnerMsg').textContent = e.message;
        document.getElementById('winnerMsg').style.color = '#dc2626';
        btn.textContent = 'Elegir ganadora'; btn.disabled = false;
      }
    });
  };

  compareItemSel.onchange = () => loadComparator(compareItemSel.value);

  // Links de "comparar" en tablas
  document.querySelectorAll('.compare-link').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    loadComparator(a.dataset.id);
    compareTable.scrollIntoView({ behavior: 'smooth' });
  });

  expQuoteBtn.onclick = () => downloadCsv('quotations', 'cotizaciones.csv');
  bindCommon();
}
async function invoicingView() {
  const [pos, invs] = await Promise.all([api('/api/purchases/purchase-orders'), api('/api/invoices')]);
  const invoicedPOIds = new Set(invs.map(i => i.purchase_order_id));
  // POs que pueden facturarse: entregadas o en proceso, aún sin factura
  const posPendientes = pos.filter(p => !invoicedPOIds.has(p.id) && ['Enviada','Aceptada','En proceso','Entregado'].includes(p.status));
  // POs parcialmente facturadas (para candado)
  const posConFactura = pos.filter(p => invoicedPOIds.has(p.id));

  app.innerHTML = shell(`
    <div class="grid grid-2">
      <!-- Panel izquierdo: registrar factura -->
      <div class="card section">
        <h3>🧾 Registrar factura <span class="small muted">(respaldo manual)</span></h3>
        <p class="small muted" style="margin-bottom:10px">El proveedor registra desde su sesión. Usa esto solo como respaldo.</p>

        <label>Selecciona PO a facturar</label>
        <select id="invPo" style="width:100%;margin-bottom:10px">
          <option value="">— Selecciona una PO —</option>
          ${posPendientes.map(p => `<option value="${p.id}" data-supplier="${p.supplier_id}" data-total="${p.total_amount||0}" data-folio="${p.folio}">${p.folio} · ${p.supplier_name} · $${Number(p.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</option>`).join('')}
        </select>

        <!-- Tabla de ítems (se llena al seleccionar PO) -->
        <div id="invItemsPreview" style="display:none;margin-bottom:12px">
          <h4 style="margin:0 0 6px;font-size:13px">Ítems de la PO</h4>
          <div class="table-wrap">
            <table id="invItemsTable">
              <thead><tr><th>Descripción</th><th style="text-align:right">Cant.</th><th style="text-align:right">Precio unit.</th><th style="text-align:right">Subtotal</th><th style="text-align:right">IVA 16%</th><th style="text-align:right">Total</th></tr></thead>
              <tbody id="invItemsBody"></tbody>
              <tfoot id="invItemsFoot"></tfoot>
            </table>
          </div>
        </div>

        <!-- Formulario de factura -->
        <div id="invFormBody" style="display:none">
          <div class="row-3" style="margin-top:8px">
            <div><label>No. factura *</label><input id="invNumber" placeholder="FACT-001"/></div>
            <div><label>Subtotal *</label><input id="invSubtotal" type="number" placeholder="0.00" oninput="invTaxes.value=(+this.value*0.16).toFixed(2)"/></div>
            <div><label>IVA (16%)</label><input id="invTaxes" type="number" placeholder="0.00"/></div>
          </div>
          <div class="row-2" style="margin-top:8px">
            <div><label style="font-size:12px">📄 PDF de la factura</label><input type="file" id="invPdf" accept=".pdf" style="font-size:12px"/></div>
            <div><label style="font-size:12px">📋 XML (CFDI)</label><input type="file" id="invXml" accept=".xml" style="font-size:12px"/></div>
          </div>
          <!-- Candado de cobertura -->
          <div id="invCoverageLock" style="margin-top:10px;padding:8px 12px;border-radius:6px;font-size:12px"></div>
          <div style="margin-top:10px">
            <button class="btn-primary" id="saveInvBtn">Guardar factura</button>
            <div id="invMsg" class="small muted" style="margin-top:6px"></div>
          </div>
        </div>
      </div>

      <!-- Panel derecho: facturas registradas -->
      <div class="card section">
        <div class="module-title"><h3>Facturas registradas</h3><button class="btn-secondary" id="expInvBtn">Exportar</button></div>

        <!-- Indicador de cobertura global -->
        <div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap">
          <div style="font-size:12px;color:#16a34a">✅ Con factura: <b>${posConFactura.length}</b> PO(s)</div>
          <div style="font-size:12px;color:${posPendientes.length>0?'#f59e0b':'#16a34a'}">${posPendientes.length>0?'⚠':'✅'} Sin factura: <b>${posPendientes.length}</b> PO(s)</div>
        </div>

        <div class="table-wrap"><table>
          <thead><tr><th>Factura</th><th>PO</th><th>Proveedor</th><th>Total</th><th>Estatus</th><th>Archivos</th><th></th></tr></thead>
          <tbody>${invs.length ? invs.map(i => `<tr style="cursor:pointer" class="inv-row" data-id="${i.id}">
            <td><b>${i.invoice_number}</b><div class="small muted">${String(i.created_at||'').slice(0,10)}</div></td>
            <td style="font-size:12px">${i.po_folio||'-'}</td>
            <td style="font-size:12px">${i.supplier_name||'-'}</td>
            <td style="font-size:12px;text-align:right;font-weight:600">$${Number(i.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
            <td>${statusPill(i.status)}</td>
            <td>
              ${i.pdf_path ? `<a href="${i.pdf_path}" target="_blank" onclick="event.stopPropagation()" style="font-size:13px;text-decoration:none" title="Ver PDF">📄</a>` : ''}
              ${i.xml_path ? `<a href="${i.xml_path}" target="_blank" onclick="event.stopPropagation()" style="font-size:13px;text-decoration:none;margin-left:4px" title="Ver XML">📋</a>` : ''}
              ${!i.pdf_path && !i.xml_path ? '<span class="muted small">—</span>' : ''}
            </td>
            <td><button class="btn-secondary" style="font-size:11px;padding:3px 8px" onclick="event.stopPropagation();showInvoiceDetail(${i.id})">Ver detalle</button></td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">Sin facturas registradas</td></tr>'}
          </tbody>
        </table></div>
      </div>
    </div>

    <!-- ── Factura mensual agrupada ─────────────────────────────────────── -->
    <div class="card section" style="margin-top:16px">
      <h3 style="margin:0 0 4px">🗓 Factura mensual <span class="small muted" style="font-weight:400">— agrupa múltiples POs del mismo proveedor</span></h3>
      <p class="small muted" style="margin:0 0 12px">Selecciona proveedor y periodo, elige las POs a incluir y registra una sola factura.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end">
        <div>
          <label style="font-size:12px;display:block;margin-bottom:3px">Proveedor</label>
          <select id="mInvSupp" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;min-width:200px">
            <option value="">— Selecciona —</option>
            ${[...new Set(pos.map(p => p.supplier_id))].map(sid => {
              const p0 = pos.find(p => p.supplier_id === sid);
              return `<option value="${sid}">${escapeHtml(p0?.supplier_name || sid)}</option>`;
            }).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:3px">Mes</label>
          <input type="month" id="mInvMonth" value="${new Date().toISOString().slice(0,7)}" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"/>
        </div>
        <button id="mInvLoadBtn" class="btn-secondary" style="font-size:12px;padding:6px 14px">Buscar POs</button>
      </div>

      <div id="mInvPOsSection" style="display:none">
        <div class="table-wrap" style="margin-bottom:12px">
          <table style="font-size:12px">
            <thead><tr style="background:#f1f5f9">
              <th style="padding:6px 8px"><input type="checkbox" id="mInvSelectAll" title="Seleccionar todas"/></th>
              <th style="padding:6px 8px">Folio PO</th>
              <th style="padding:6px 8px">Fecha</th>
              <th style="padding:6px 8px">Estatus</th>
              <th style="padding:6px 8px;text-align:right">Total</th>
              <th style="padding:6px 8px">Ítems</th>
            </tr></thead>
            <tbody id="mInvPOsBody"></tbody>
          </table>
        </div>

        <div id="mInvItemsSection" style="display:none;margin-bottom:14px">
          <h4 style="font-size:13px;margin:0 0 8px;color:#374151">Ítems de las POs seleccionadas</h4>
          <div class="table-wrap">
            <table style="font-size:12px">
              <thead><tr style="background:#f1f5f9">
                <th style="padding:5px 8px">PO</th><th style="padding:5px 8px">Ítem</th>
                <th style="padding:5px 8px;text-align:right">Cant.</th>
                <th style="padding:5px 8px;text-align:right">P.U.</th>
                <th style="padding:5px 8px;text-align:right">Subtotal</th>
              </tr></thead>
              <tbody id="mInvItemsBody"></tbody>
              <tfoot id="mInvItemsFoot"></tfoot>
            </table>
          </div>
        </div>

        <div id="mInvForm" style="display:none">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:10px">
            <div><label style="font-size:12px">No. de factura *</label><input id="mInvNumber" placeholder="FACT-001" style="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"/></div>
            <div><label style="font-size:12px">Subtotal *</label><input id="mInvSubtotal" type="number" placeholder="0.00" style="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px" oninput="document.getElementById('mInvTaxes').value=(+this.value*0.16).toFixed(2)"/></div>
            <div><label style="font-size:12px">IVA (16%)</label><input id="mInvTaxes" type="number" placeholder="0.00" style="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"/></div>
            <div><label style="font-size:12px">📄 PDF</label><input type="file" id="mInvPdf" accept=".pdf" style="font-size:12px"/></div>
            <div><label style="font-size:12px">📋 XML (CFDI)</label><input type="file" id="mInvXml" accept=".xml" style="font-size:12px"/></div>
          </div>
          <button id="mInvSaveBtn" class="btn-primary" style="font-size:12px;padding:6px 18px">💾 Guardar factura mensual</button>
          <span id="mInvMsg" style="font-size:12px;margin-left:12px"></span>
        </div>
      </div>
    </div>
  `, 'facturacion');

  // Al seleccionar PO → cargar ítems y pre-llenar montos
  invPo.onchange = async () => {
    const poId = invPo.value;
    if (!poId) {
      document.getElementById('invItemsPreview').style.display = 'none';
      document.getElementById('invFormBody').style.display = 'none';
      return;
    }
    // Buscar PO con sus ítems
    const po = posPendientes.find(p => p.id === Number(poId));
    const poData = pos.find(p => p.id === Number(poId));

    // Intentar cargar ítems de la PO desde el API
    try {
      const allPos = await api('/api/purchases/purchase-orders');
      const poFull = allPos.find(p => p.id === Number(poId));
      const items = poFull?.po_items || [];

      let subtotal = 0;
      const rows = items.map(item => {
        const itemSub = Number(item.quantity||0) * Number(item.unit_cost||0);
        const itemIva = itemSub * 0.16;
        subtotal += itemSub;
        return `<tr>
          <td style="font-size:12px">${escapeHtml(item.description||'-')}</td>
          <td style="font-size:12px;text-align:right">${item.quantity} ${item.unit||''}</td>
          <td style="font-size:12px;text-align:right">$${Number(item.unit_cost||0).toFixed(2)}</td>
          <td style="font-size:12px;text-align:right">$${itemSub.toFixed(2)}</td>
          <td style="font-size:12px;text-align:right">$${itemIva.toFixed(2)}</td>
          <td style="font-size:12px;text-align:right;font-weight:600">$${(itemSub+itemIva).toFixed(2)}</td>
        </tr>`;
      }).join('');

      const totalIva = subtotal * 0.16;
      const total = subtotal + totalIva;

      document.getElementById('invItemsBody').innerHTML = rows || '<tr><td colspan="6" class="muted small" style="text-align:center">Sin ítems detallados</td></tr>';
      document.getElementById('invItemsFoot').innerHTML = `
        <tr style="background:#f8fafc;font-weight:600">
          <td colspan="3" style="padding:6px 4px;text-align:right;font-size:13px">Totales:</td>
          <td style="padding:6px 4px;text-align:right;font-size:13px">$${subtotal.toFixed(2)}</td>
          <td style="padding:6px 4px;text-align:right;font-size:13px">$${totalIva.toFixed(2)}</td>
          <td style="padding:6px 4px;text-align:right;font-size:13px;color:#1d4ed8">$${total.toFixed(2)}</td>
        </tr>`;

      // Pre-llenar campos
      invSubtotal.value = subtotal.toFixed(2);
      invTaxes.value = totalIva.toFixed(2);

      // Candado de cobertura
      const lockEl = document.getElementById('invCoverageLock');
      if (items.length > 0) {
        lockEl.style.background = '#f0fff4';
        lockEl.style.border = '1px solid #bbf7d0';
        lockEl.innerHTML = `✅ <b>${items.length} ítem(s)</b> incluidos en esta factura · Subtotal $${subtotal.toFixed(2)} + IVA $${totalIva.toFixed(2)} = <b>$${total.toFixed(2)}</b>`;
      } else {
        lockEl.style.background = '#fffbeb';
        lockEl.style.border = '1px solid #fde68a';
        lockEl.innerHTML = `⚠ No se encontraron ítems detallados para esta PO. Verifica el subtotal manualmente.`;
      }
    } catch(e) {
      document.getElementById('invItemsBody').innerHTML = '<tr><td colspan="6" class="muted small">No se pudieron cargar los ítems</td></tr>';
    }

    document.getElementById('invItemsPreview').style.display = '';
    document.getElementById('invFormBody').style.display = '';
  };

  saveInvBtn.onclick = async () => {
    try {
      if (!invPo.value) throw new Error('Selecciona una PO');
      if (!invNumber.value) throw new Error('Ingresa el número de factura');
      const sub = Number(invSubtotal.value||0);
      if (!sub) throw new Error('Ingresa subtotal mayor a cero');
      const tax = Number(invTaxes.value||0);
      const supplier_id = Number(invPo.selectedOptions[0]?.dataset?.supplier||0);
      const fd = new FormData();
      fd.append('purchase_order_id', invPo.value);
      fd.append('supplier_id', supplier_id);
      fd.append('invoice_number', invNumber.value);
      fd.append('subtotal', sub);
      fd.append('taxes', tax);
      fd.append('total', sub + tax);
      if (invPdf.files[0]) fd.append('pdf', invPdf.files[0]);
      if (invXml.files[0]) fd.append('xml', invXml.files[0]);
      const res = await fetch('/api/invoices', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Error');
      invMsg.textContent = '✅ Factura guardada';
      invMsg.style.color = '#16a34a';
      setTimeout(invoicingView, 1000);
    } catch(e) { invMsg.textContent = e.message; invMsg.style.color = '#dc2626'; }
  };
  expInvBtn.onclick = () => downloadCsv('invoices', 'facturas.csv');

  // Clic en fila de factura → mostrar detalle
  document.querySelectorAll('.inv-row').forEach(row => {
    row.onmouseover = () => row.style.background = '#f0f9ff';
    row.onmouseout = () => row.style.background = '';
    row.onclick = () => showInvoiceDetail(Number(row.dataset.id));
  });

  // ── Factura mensual ──────────────────────────────────────────────────────────
  let mInvPOsData = [];

  const refreshMInvItems = () => {
    const checked = [...document.querySelectorAll('.mInvPoCheck:checked')].map(c => c.value);
    if (!checked.length) {
      document.getElementById('mInvItemsSection').style.display = 'none';
      document.getElementById('mInvForm').style.display = 'none';
      return;
    }
    const selectedPOs = mInvPOsData.filter(p => checked.includes(String(p.id)));
    let allItems = [], total = 0;
    selectedPOs.forEach(p => {
      (p.po_items || []).forEach(item => {
        const sub = Number(item.quantity || 0) * Number(item.unit_cost || 0);
        total += sub;
        allItems.push(`<tr>
          <td style="padding:4px 8px;color:#6b7280;font-size:11px">${escapeHtml(p.folio)}</td>
          <td style="padding:4px 8px">${escapeHtml(item.description || '-')}</td>
          <td style="padding:4px 8px;text-align:right">${item.quantity} ${escapeHtml(item.unit || '')}</td>
          <td style="padding:4px 8px;text-align:right">$${Number(item.unit_cost||0).toFixed(2)}</td>
          <td style="padding:4px 8px;text-align:right;font-weight:600">$${sub.toFixed(2)}</td>
        </tr>`);
      });
    });
    const iva = total * 0.16;
    document.getElementById('mInvItemsBody').innerHTML = allItems.join('') || '<tr><td colspan="5" class="muted small" style="text-align:center">Sin ítems</td></tr>';
    document.getElementById('mInvItemsFoot').innerHTML = `<tr style="background:#f1f5f9;font-weight:600">
      <td colspan="4" style="padding:5px 8px;text-align:right">Subtotal:</td><td style="padding:5px 8px;text-align:right">$${total.toFixed(2)}</td></tr>
      <tr style="background:#f1f5f9"><td colspan="4" style="padding:5px 8px;text-align:right">IVA (16%):</td><td style="padding:5px 8px;text-align:right">$${iva.toFixed(2)}</td></tr>
      <tr style="background:#eff6ff;font-weight:700"><td colspan="4" style="padding:5px 8px;text-align:right;color:#1d4ed8">Total:</td><td style="padding:5px 8px;text-align:right;color:#1d4ed8">$${(total+iva).toFixed(2)}</td></tr>`;
    document.getElementById('mInvSubtotal').value = total.toFixed(2);
    document.getElementById('mInvTaxes').value = iva.toFixed(2);
    document.getElementById('mInvItemsSection').style.display = '';
    document.getElementById('mInvForm').style.display = '';
  };

  document.getElementById('mInvLoadBtn')?.addEventListener('click', async () => {
    const suppId = document.getElementById('mInvSupp').value;
    const month = document.getElementById('mInvMonth').value;
    if (!suppId || !month) { alert('Selecciona proveedor y mes'); return; }
    try {
      const allPos = await api('/api/purchases/purchase-orders');
      const eligible = allPos.filter(p =>
        p.supplier_id === Number(suppId) &&
        ['Enviada','Aceptada','En proceso','Entregado'].includes(p.status) &&
        (p.created_at || '').slice(0, 7) === month
      );
      mInvPOsData = eligible;
      const tbody = document.getElementById('mInvPOsBody');
      tbody.innerHTML = eligible.length ? eligible.map(p => `
        <tr style="border-top:1px solid #f1f5f9">
          <td style="padding:5px 8px"><input type="checkbox" class="mInvPoCheck" value="${p.id}"/></td>
          <td style="padding:5px 8px;font-family:monospace;font-size:11px;color:#2563eb">${escapeHtml(p.folio)}</td>
          <td style="padding:5px 8px">${String(p.created_at||'').slice(0,10)}</td>
          <td style="padding:5px 8px">${statusPill(p.status)}</td>
          <td style="padding:5px 8px;text-align:right;font-weight:600">$${Number(p.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
          <td style="padding:5px 8px;color:#6b7280">${(p.po_items||[]).length} ítem(s)</td>
        </tr>`).join('')
        : '<tr><td colspan="6" style="text-align:center;padding:16px;color:#9ca3af">Sin POs en ese periodo para este proveedor</td></tr>';
      document.getElementById('mInvPOsSection').style.display = '';
      document.getElementById('mInvItemsSection').style.display = 'none';
      document.getElementById('mInvForm').style.display = 'none';

      document.getElementById('mInvSelectAll')?.addEventListener('change', e => {
        document.querySelectorAll('.mInvPoCheck').forEach(c => c.checked = e.target.checked);
        refreshMInvItems();
      });
      document.querySelectorAll('.mInvPoCheck').forEach(c => c.addEventListener('change', refreshMInvItems));
    } catch(e) { alert('Error al cargar POs: ' + e.message); }
  });

  document.getElementById('mInvSaveBtn')?.addEventListener('click', async () => {
    const poIds = [...document.querySelectorAll('.mInvPoCheck:checked')].map(c => Number(c.value));
    const num = document.getElementById('mInvNumber').value;
    const sub = Number(document.getElementById('mInvSubtotal').value || 0);
    const tax = Number(document.getElementById('mInvTaxes').value || 0);
    const msgEl = document.getElementById('mInvMsg');
    if (!poIds.length) { msgEl.textContent = 'Selecciona al menos una PO'; msgEl.style.color = '#dc2626'; return; }
    if (!num) { msgEl.textContent = 'Ingresa el número de factura'; msgEl.style.color = '#dc2626'; return; }
    if (!sub) { msgEl.textContent = 'Ingresa subtotal mayor a cero'; msgEl.style.color = '#dc2626'; return; }
    try {
      document.getElementById('mInvSaveBtn').disabled = true;
      const fd = new FormData();
      fd.append('po_ids', JSON.stringify(poIds));
      fd.append('supplier_id', document.getElementById('mInvSupp').value);
      fd.append('invoice_number', num);
      fd.append('subtotal', sub);
      fd.append('taxes', tax);
      fd.append('total', sub + tax);
      const pdfEl = document.getElementById('mInvPdf');
      const xmlEl = document.getElementById('mInvXml');
      if (pdfEl.files[0]) fd.append('pdf', pdfEl.files[0]);
      if (xmlEl.files[0]) fd.append('xml', xmlEl.files[0]);
      const res = await fetch('/api/invoices/monthly', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Error');
      const out = await res.json();
      if (out.mailto_comprador) { const a = document.createElement('a'); a.href = out.mailto_comprador; a.click(); }
      msgEl.textContent = `✅ Factura mensual guardada (${poIds.length} POs)`;
      msgEl.style.color = '#16a34a';
      setTimeout(invoicingView, 1200);
    } catch(e) {
      msgEl.textContent = e.message; msgEl.style.color = '#dc2626';
      document.getElementById('mInvSaveBtn').disabled = false;
    }
  });

  bindCommon();
}

// ── Modal de detalle de factura ───────────────────────────────────────────────
async function showInvoiceDetail(invId) {
  let inv;
  try {
    inv = await api(`/api/invoices/${invId}`);
  } catch(e) {
    alert('No se pudo cargar el detalle de la factura');
    return;
  }

  const paidTotal = (inv.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = Number(inv.total || 0) - paidTotal;

  // Validez / vigencia
  let vigenciaHtml = '';
  if (inv.credit_days > 0 && inv.due_date) {
    const dr = inv.days_remaining;
    if (dr === null || dr === undefined) {
      vigenciaHtml = `<span class="small muted">Sin fecha de vencimiento</span>`;
    } else if (dr < 0) {
      vigenciaHtml = `<span style="color:#dc2626;font-weight:700">⚠ Vencida hace ${Math.abs(dr)} día(s)</span>`;
    } else if (dr === 0) {
      vigenciaHtml = `<span style="color:#f59e0b;font-weight:700">⚠ Vence HOY</span>`;
    } else {
      vigenciaHtml = `<span style="color:#16a34a">✅ Vigente — ${dr} día(s) restantes (vence ${inv.due_date})</span>`;
    }
  } else if (inv.credit_days > 0) {
    vigenciaHtml = `<span class="small muted">${inv.credit_days} días de crédito · sin fecha de vencimiento registrada</span>`;
  } else {
    vigenciaHtml = `<span class="small muted">Sin días de crédito registrados</span>`;
  }

  // Tabla de ítems
  const itemsHtml = (inv.po_items || []).length > 0
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px">
        <thead><tr style="background:#f8fafc">
          <th style="text-align:left;padding:5px 8px;border-bottom:1px solid #e5e7eb">Descripción</th>
          <th style="text-align:right;padding:5px 8px;border-bottom:1px solid #e5e7eb">Cant.</th>
          <th style="text-align:right;padding:5px 8px;border-bottom:1px solid #e5e7eb">P.Unit</th>
          <th style="text-align:right;padding:5px 8px;border-bottom:1px solid #e5e7eb">Subtotal</th>
        </tr></thead>
        <tbody>
          ${(inv.po_items).map(it => `<tr>
            <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6">${escapeHtml(it.description)}</td>
            <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #f3f4f6">${it.quantity} ${escapeHtml(it.unit||'')}</td>
            <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #f3f4f6">$${Number(it.unit_cost||0).toFixed(2)}</td>
            <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #f3f4f6">$${Number(it.subtotal||0).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="small muted">Sin ítems detallados para esta PO</p>';

  // Pagos registrados
  const paymentsHtml = (inv.payments || []).length > 0
    ? `<div style="margin-top:10px"><b style="font-size:13px">Pagos registrados:</b>
        ${inv.payments.map(p => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between">
          <span>${String(p.created_at||'').slice(0,10)} · ${p.payment_type||'-'} · Ref: ${p.reference||'-'}</span>
          <span style="font-weight:700">$${Number(p.amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</span>
        </div>`).join('')}
      </div>`
    : '';

  const isFullyPaid = inv.status === 'Pagada';

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center';
  panel.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px;width:620px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div>
          <h3 style="margin:0 0 4px">🧾 Factura ${escapeHtml(inv.invoice_number)}</h3>
          <div class="small muted">PO: <b>${escapeHtml(inv.po_folio||'-')}</b> · Proveedor: <b>${escapeHtml(inv.supplier_name||'-')}</b></div>
          ${inv.supplier_email ? `<div class="small muted">📧 ${escapeHtml(inv.supplier_email)}</div>` : ''}
        </div>
        <div>${statusPill(inv.status)}</div>
      </div>

      <!-- Montos -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        <div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center">
          <div class="small muted">Subtotal</div>
          <div style="font-weight:700;font-size:15px">$${Number(inv.subtotal||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
        </div>
        <div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center">
          <div class="small muted">IVA</div>
          <div style="font-weight:700;font-size:15px">$${Number(inv.taxes||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
        </div>
        <div style="background:${isFullyPaid?'#f0fff4':'#fef2f2'};border-radius:8px;padding:10px;text-align:center">
          <div class="small muted">${isFullyPaid ? 'Total pagado' : 'Saldo pendiente'}</div>
          <div style="font-weight:700;font-size:15px;color:${isFullyPaid?'#16a34a':'#dc2626'}">$${(isFullyPaid ? Number(inv.total||0) : balance).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
        </div>
      </div>

      <!-- Vigencia -->
      <div style="background:#f8fafc;border-radius:8px;padding:10px;margin-bottom:16px;font-size:13px">
        <b>Vigencia: </b>${vigenciaHtml}
        <span class="small muted" style="margin-left:12px">Registrada: ${String(inv.created_at||'').slice(0,10)}</span>
      </div>

      <!-- Ítems -->
      <div style="margin-bottom:16px">
        <b style="font-size:13px">Ítems de la compra:</b>
        ${itemsHtml}
      </div>

      ${paymentsHtml}

      <!-- Archivos -->
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        ${inv.pdf_path
          ? `<a href="${inv.pdf_path}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;background:#dbeafe;color:#1d4ed8;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">📄 Ver PDF</a>`
          : `<span style="font-size:12px;color:#6b7280;background:#f3f4f6;padding:6px 14px;border-radius:6px">Sin PDF adjunto</span>`}
        ${inv.xml_path
          ? `<a href="${inv.xml_path}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;background:#dcfce7;color:#15803d;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">📋 Ver XML (CFDI)</a>`
          : `<span style="font-size:12px;color:#6b7280;background:#f3f4f6;padding:6px 14px;border-radius:6px">Sin XML adjunto</span>`}
      </div>

      <!-- Acciones -->
      <div style="margin-top:20px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        ${!isFullyPaid
          ? `<button id="invDetailPayBtn" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:13px;font-weight:700">💳 Ir a registrar pago</button>`
          : `<span style="color:#16a34a;font-weight:700;font-size:13px">✅ Factura completamente pagada</span>`}
        <button id="closeInvDetail" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:7px 20px;cursor:pointer;font-size:13px">Cerrar</button>
      </div>
    </div>`;

  document.body.appendChild(panel);
  panel.querySelector('#closeInvDetail').onclick = () => panel.remove();
  panel.onclick = (e) => { if (e.target === panel) panel.remove(); };

  const payBtn = panel.querySelector('#invDetailPayBtn');
  if (payBtn) {
    payBtn.onclick = () => {
      panel.remove();
      location.hash = '#/pagos';
    };
  }
}

function showPaymentNotifyPanel(mailtos, invoiceNumber) {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1001;display:flex;align-items:center;justify-content:center';
  panel.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px;width:480px;max-width:96vw;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <h3 style="margin:0 0 6px">✅ Pago registrado</h3>
      <p style="font-size:13px;color:#6b7280;margin:0 0 18px">Factura <b>${escapeHtml(invoiceNumber||'')}</b> · Haz clic para abrir cada correo:</p>
      ${mailtos.map((m, i) => `
        <div style="margin-bottom:10px">
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px">Para: <b>${escapeHtml(m.email)}</b></div>
          <a href="${m.mailto}" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:13px;padding:7px 18px;border-radius:6px;font-weight:600">${m.label}</a>
        </div>`).join('')}
      <div style="text-align:right;margin-top:16px">
        <button id="closePayNotify" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:6px 18px;cursor:pointer;font-size:13px">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(panel);
  panel.querySelector('#closePayNotify').onclick = () => panel.remove();
  panel.onclick = (e) => { if (e.target === panel) panel.remove(); };
}

async function paymentsView() {
  const [pending, payments] = await Promise.all([
    api('/api/payments/pending-invoices'),
    api('/api/payments')
  ]);

  const anticiposPendientes = pending.filter(inv => inv.invoice_type === 'anticipo');
  const facturasPendientes = pending.filter(inv => inv.invoice_type !== 'anticipo');

  function overdueTag(inv) {
    if (inv.days_overdue === null || inv.days_overdue === undefined) return '';
    if (inv.days_overdue > 0) return `<span style="color:#dc2626;font-weight:700;font-size:12px"> ⚠ ${inv.days_overdue} días vencido</span>`;
    if (inv.days_overdue === 0) return `<span style="color:#f59e0b;font-size:12px"> Vence hoy</span>`;
    return `<span style="color:#16a34a;font-size:12px"> ${Math.abs(inv.days_overdue)} días restantes</span>`;
  }

  app.innerHTML = shell(`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">

      <!-- Panel izquierdo: lista de facturas pendientes -->
      <div class="card section">
        <div class="module-title"><h3>Facturas pendientes de pago</h3></div>
        ${pending.length === 0
          ? '<div class="muted small" style="padding:16px;text-align:center">✅ Sin facturas pendientes</div>'
          : (() => {
            const renderInvRow = (inv) => {
              const overdue = Number(inv.days_overdue || 0);
              const rowBg = overdue > 0 ? '#fef2f2' : overdue === 0 ? '#fffbeb' : '';
              const urgentTag = inv.urgent ? `<span style="background:#dc2626;color:white;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:6px">🔴 URGENTE</span>` : '';
              const isAnticipo = inv.invoice_type === 'anticipo';
              const advancePaid = Number(inv.advance_paid_on_po || 0);
              const pendingBal = Number(inv.pending_balance ?? inv.balance ?? inv.total ?? 0);
              const anticipoTag = isAnticipo ? `<span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 7px;font-size:10px;margin-left:6px;font-weight:600">💰 ANTICIPO</span>` : '';
              const advanceInfo = !isAnticipo && advancePaid > 0
                ? `<span class="small" style="color:#16a34a">✔ Anticipo pagado: $${advancePaid.toLocaleString('es-MX',{minimumFractionDigits:2})} · Saldo: $${pendingBal.toLocaleString('es-MX',{minimumFractionDigits:2})}</span>`
                : '';
              return `
              <div class="pay-invoice-row" data-id="${inv.id}" data-supplier="${inv.supplier_id}" data-email="${inv.supplier_email||''}" data-number="${inv.invoice_number}" data-balance="${pendingBal}" data-total="${inv.total||0}" data-creditdays="${inv.credit_days||0}" data-delivery="${inv.delivery_date||''}" data-pofolio="${inv.po_folio||''}" data-type="${inv.invoice_type||'normal'}" data-advance-paid="${advancePaid}"
                style="padding:12px;border-bottom:1px solid #f3f4f6;cursor:pointer;background:${isAnticipo?'#eff6ff':rowBg};transition:background 0.15s"
                onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='${isAnticipo?'#eff6ff':rowBg}'">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                  <div>
                    <b>${inv.invoice_number}</b>${anticipoTag}${urgentTag}
                    <div class="small muted">${inv.supplier_name} · PO: ${inv.po_folio||'-'}</div>
                    ${advanceInfo}
                  </div>
                  <div style="text-align:right">
                    <div style="font-weight:700;color:${isAnticipo?'#1d4ed8':'inherit'}">$${pendingBal.toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
                    <div class="small muted">Total $${Number(inv.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
                  </div>
                </div>
                <div style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
                  <span class="small muted">Factura: ${String(inv.created_at||'').slice(0,10)}</span>
                  ${inv.due_date ? `<span class="small muted">Vence: ${inv.due_date}</span>` : ''}
                  ${overdueTag(inv)}
                  ${inv.urgent_note ? `<span class="small" style="color:#dc2626">Nota urgente: ${inv.urgent_note}</span>` : ''}
                </div>
              </div>`;
            };
            return (anticiposPendientes.length ? `<div style="padding:8px 12px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:700;border-bottom:1px solid #bfdbfe">💰 Anticipos pendientes (${anticiposPendientes.length})</div>` : '') +
              anticiposPendientes.map(renderInvRow).join('') +
              (facturasPendientes.length ? `<div style="padding:8px 12px;background:#f8fafc;color:#374151;font-size:12px;font-weight:700;border-bottom:1px solid #e5e7eb">🧾 Facturas normales pendientes (${facturasPendientes.length})</div>` : '') +
              facturasPendientes.map(renderInvRow).join('');
          })()}
      </div>

      <!-- Panel derecho: formulario de pago -->
      <div class="card section" id="payFormCard">
        <h3>Registrar pago</h3>
        <p class="small muted" id="payFormHint">← Selecciona una factura de la lista</p>
        <div id="payFormBody" style="display:none">
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px;margin-bottom:12px" id="payInvSummary"></div>
          <div class="row-2" style="margin-bottom:8px">
            <div><label>Monto a pagar *</label><input id="payAmount" type="number" placeholder="0.00"/></div>
            <div>
              <label>Tipo de pago</label>
              <select id="payType">
                <option>Transferencia</option><option>Cheque</option><option>Efectivo</option><option>SPEI</option><option>Caja chica</option><option>Otro</option>
              </select>
            </div>
          </div>
          <div id="cajachicaInfo" style="display:none;background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px">
            💵 <b>Caja chica</b> — Ingresa el No. de recibo y el concepto en los campos de abajo.
          </div>
          <div class="row-2" style="margin-bottom:8px">
            <div><label>Referencia / No. recibo</label><input id="payRef" placeholder="Ej. RCC-0045"/></div>
            <div><label>Fecha de entrega del material</label><input id="payDelivery" type="date"/></div>
          </div>
          <div class="row-2" style="margin-bottom:8px">
            <div><label>Días de crédito</label><input id="payCreditDays" type="number" placeholder="0" min="0"/></div>
            <div><label>Comentario</label><input id="payComment" placeholder="Opcional"/></div>
          </div>
          <div style="margin-bottom:12px">
            <label>📎 Comprobante de pago (PDF, imagen)</label>
            <input type="file" id="payProof" accept=".pdf,.jpg,.jpeg,.png,.webp" style="font-size:12px;margin-top:4px;display:block"/>
            <span class="small muted">Máx. 10 MB · PDF, JPG, PNG, WEBP</span>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn-primary" id="savePayBtn">Guardar pago y notificar</button>
            <span id="payMsg" class="small muted"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Historial de pagos -->
    <div class="card section" style="margin-top:16px">
      <div class="module-title">
        <h3>Historial de pagos</h3>
        <button class="btn-secondary" id="expPayBtn">Exportar CSV</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Factura</th><th>PO</th><th>Proveedor</th><th>Monto</th><th>Tipo</th><th>Referencia</th><th>Fecha</th><th>Comprobante</th></tr></thead>
        <tbody>${payments.length ? payments.map(p => `<tr>
          <td>${p.invoice_number}</td>
          <td>${p.po_folio||'-'}</td>
          <td>${p.supplier_name}</td>
          <td><b>$${Number(p.amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</b></td>
          <td>${p.payment_type||'-'}</td>
          <td>${p.reference||'-'}</td>
          <td>${String(p.created_at||'').slice(0,10)}</td>
          <td>${p.proof_path ? `<a href="${p.proof_path}" target="_blank" style="font-size:12px">📎 Ver</a>` : '<span class="muted small">—</span>'}</td>
        </tr>`).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Sin pagos registrados</td></tr>'}
        </tbody>
      </table></div>
    </div>
  `, 'pagos');

  // Seleccionar factura → poblar formulario
  let selectedInv = null;
  document.querySelectorAll('.pay-invoice-row').forEach(row => {
    row.onclick = () => {
      document.querySelectorAll('.pay-invoice-row').forEach(r => r.style.outline = '');
      row.style.outline = '2px solid #3b82f6';
      selectedInv = {
        id: Number(row.dataset.id),
        supplier_id: Number(row.dataset.supplier),
        email: row.dataset.email,
        number: row.dataset.number,
        balance: Number(row.dataset.balance),
        total: Number(row.dataset.total),
        creditDays: Number(row.dataset.creditdays || 0),
        delivery: row.dataset.delivery || '',
        poFolio: row.dataset.pofolio || '',
        invoiceType: row.dataset.type || 'normal',
        advancePaid: Number(row.dataset['advance-paid'] || 0)
      };
      payFormHint.style.display = 'none';
      payFormBody.style.display = 'block';
      payAmount.value = selectedInv.balance.toFixed(2);
      payCreditDays.value = selectedInv.creditDays || '';
      payDelivery.value = selectedInv.delivery || '';
      const isAnticipo = selectedInv.invoiceType === 'anticipo';
      payInvSummary.innerHTML = `
        ${isAnticipo ? `<div style="background:#dbeafe;padding:4px 10px;border-radius:4px;margin-bottom:8px;font-size:12px;color:#1d4ed8;font-weight:600">💰 FACTURA DE ANTICIPO — Pago adelantado antes de la entrega</div>` : ''}
        <b>Factura:</b> ${selectedInv.number} &nbsp;|&nbsp;
        <b>${isAnticipo ? 'Monto anticipo' : 'Saldo a pagar'}:</b> $${selectedInv.balance.toLocaleString('es-MX',{minimumFractionDigits:2})} &nbsp;|&nbsp;
        <b>Total factura:</b> $${selectedInv.total.toLocaleString('es-MX',{minimumFractionDigits:2})}
        ${!isAnticipo && selectedInv.advancePaid > 0 ? `<br><span style="color:#16a34a;font-size:12px">✔ Anticipo ya pagado: $${selectedInv.advancePaid.toLocaleString('es-MX',{minimumFractionDigits:2})} (descontado del saldo)</span>` : ''}
        <div id="payTraceInfo"></div>
      `;
      // Intentar cargar trazabilidad (best-effort)
      api(`/api/purchases/purchase-orders`).then(pos => {
        const inv = selectedInv;
        const poData = pos.find(p => p.folio === inv.poFolio);
        if (!poData) return;
        const traceEl = document.getElementById('payTraceInfo');
        if (!traceEl) return;
        traceEl.innerHTML = `
          <div style="font-size:11px;color:#6b7280;margin-top:6px;border-top:1px solid #e5e7eb;padding-top:6px">
            <b>Trazabilidad:</b>
            PO generada por: ${poData.buyer_name || '-'} ·
            Proveedor: ${poData.supplier_name || '-'}
          </div>`;
      }).catch(()=>{});
    };
  });

  // Mostrar aviso caja chica
  document.getElementById('payType').addEventListener('change', function() {
    const cc = document.getElementById('cajachicaInfo');
    if (cc) cc.style.display = this.value === 'Caja chica' ? '' : 'none';
    if (this.value === 'Caja chica') document.getElementById('payRef').placeholder = 'No. recibo caja chica';
    else document.getElementById('payRef').placeholder = 'Ej. SPEI-00123456';
  });

  // Guardar pago
  savePayBtn.onclick = async () => {
    if (!selectedInv) { payMsg.textContent = 'Selecciona una factura primero'; payMsg.style.color = '#dc2626'; return; }
    try {
      if (!payAmount.value || Number(payAmount.value) <= 0) throw new Error('Ingresa un monto mayor a cero');
      const payTypeVal = document.getElementById('payType').value;
      if (payTypeVal !== 'Caja chica' && !payRef.value) throw new Error('Ingresa la referencia de pago');
      if (payTypeVal === 'Caja chica' && !payRef.value) throw new Error('Ingresa el No. de recibo de caja chica');
      savePayBtn.disabled = true;
      const fd = new FormData();
      fd.append('invoice_id', selectedInv.id);
      fd.append('supplier_id', selectedInv.supplier_id);
      fd.append('amount', payAmount.value);
      fd.append('payment_type', payType.value);
      fd.append('reference', payRef.value);
      fd.append('comment', payComment.value);
      fd.append('delivery_date', payDelivery.value);
      fd.append('credit_days', payCreditDays.value || 0);
      if (payProof.files[0]) fd.append('proof', payProof.files[0]);
      const res = await fetch('/api/payments', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
      const data = await res.json();
      payMsg.textContent = '✅ Pago registrado'; payMsg.style.color = '#16a34a';
      // Notificar proveedor y equipo de compras
      const mailtos = [];
      if (data.mailto && data.supplier_email) mailtos.push({ label: '📧 Correo al proveedor', mailto: data.mailto, email: data.supplier_email });
      if (data.compras_mailto && data.compras_emails) mailtos.push({ label: '📧 Notificar a compras/pagos', mailto: data.compras_mailto, email: data.compras_emails });
      if (mailtos.length) showPaymentNotifyPanel(mailtos, selectedInv.number);
      setTimeout(render, 1200);
    } catch(e) { payMsg.textContent = e.message; payMsg.style.color = '#dc2626'; savePayBtn.disabled = false; }
  };

  expPayBtn.onclick = () => downloadCsv('payments', 'pagos.csv');
  bindCommon();
}

async function inventoryView() {
  const [invCats, invItems, items, valesItems] = await Promise.all([
    api('/api/catalogs/inventory-catalogs'),
    api('/api/catalogs/inventory-items'),
    api('/api/catalogs/items'),
    api('/api/catalogs/vales-items').catch(() => [])
  ]);

  const stockStatus = (item) => {
    if (item.current_stock <= 0) return { label: 'Sin stock', color: '#dc2626', bg: '#fef2f2' };
    if (item.current_stock <= item.min_stock) return { label: 'Crítico', color: '#dc2626', bg: '#fef2f2' };
    const rp = item.reorder_point || 0;
    if (rp > 0 && item.current_stock <= rp) return { label: 'Reordenar', color: '#d97706', bg: '#fffbeb' };
    if (item.current_stock <= item.min_stock * 1.3) return { label: 'Bajo', color: '#d97706', bg: '#fffbeb' };
    if (item.max_stock > 0 && item.current_stock > item.max_stock * 1.3) return { label: 'Exceso', color: '#7c3aed', bg: '#f5f3ff' };
    return { label: 'OK', color: '#16a34a', bg: '#f0fff4' };
  };

  const belowMin = invItems.filter(x => x.current_stock <= x.min_stock);
  const canManage = ['admin', 'comprador', 'inventarios'].includes(state.user?.role);

  app.innerHTML = shell(`
    <div class="grid grid-4">
      <div class="card kpi"><div class="muted">Total ítems</div><div class="n">${invItems.length}</div></div>
      <div class="card kpi"><div class="muted">Crítico/Bajo</div><div class="n" style="color:#dc2626">${belowMin.length}</div></div>
      <div class="card kpi"><div class="muted">Inventarios</div><div class="n">${invCats.length}</div></div>
      <div class="card kpi"><div class="muted">Inventariables</div><div class="n">${items.filter(x => x.inventoried && x.active !== false).length}</div></div>
    </div>

    ${belowMin.length > 0 ? `
    <div class="card section" style="margin-top:16px;border:1px solid #fca5a5;background:#fef2f2">
      <div class="module-title">
        <h3 style="color:#dc2626">⚠ ${belowMin.length} ítem(s) requieren reposición</h3>
        <button class="btn-primary" id="genReplenishBtn">Generar requisición de reposición</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Inventario</th><th>Ítem</th><th>Stock actual</th><th>Mínimo</th><th>Máximo</th><th>Cantidad a reponer</th></tr></thead>
        <tbody>${belowMin.map(x => `<tr style="background:#fef2f2">
          <td style="font-size:12px">${x.inventory_name}</td>
          <td><b>${x.item_name}</b></td>
          <td style="color:#dc2626;font-weight:600">${x.current_stock} ${x.unit||'pza'}</td>
          <td>${x.min_stock}</td>
          <td>${x.max_stock}</td>
          <td style="color:#dc2626">+${Math.max(1, x.max_stock - x.current_stock)} ${x.unit||'pza'}</td>
        </tr>`).join('')}
        </tbody></table></div>
    </div>` : `
    <div class="card section" style="margin-top:16px;border:1px solid #bbf7d0;background:#f0fff4;padding:16px;text-align:center">
      <span style="color:#16a34a;font-size:18px">✅</span> <b style="color:#16a34a"> Todos los inventarios están en niveles aceptables</b>
    </div>`}

    <div class="card section" style="margin-top:16px">
      <div style="display:flex;gap:4px;border-bottom:2px solid #e5e7eb;margin-bottom:16px">
        <button class="inv-tab-btn inv-tab-active" data-tab="actual">📋 Inventario Actual</button>
        <button class="inv-tab-btn" data-tab="semanal">📝 Captura Semanal</button>
        <button class="inv-tab-btn" data-tab="historial">📈 Historial</button>
        ${state.user?.role === 'admin' ? `<button class="inv-tab-btn" data-tab="gestionar">⚙ Gestionar listas</button>` : ''}
      </div>

      <!-- TAB: Inventario Actual -->
      <div id="inv-tab-actual">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <select id="filterInvCat"><option value="">Todos los inventarios</option>${invCats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
          <button class="btn-secondary" id="printInvBtn">🖨 Imprimir formato</button>
          <button class="btn-secondary" id="expInvBtn">Exportar CSV</button>
        </div>
        <div id="invTableWrap"></div>
        ${canManage ? `
        <div style="margin-top:20px;border-top:1px solid #e5e7eb;padding-top:16px">
          <h4 style="margin-bottom:12px">Agregar ítem al inventario</h4>
          <div class="row-3">
            <div><label>Inventario *</label><select id="iCat"><option value="">Selecciona</option>${invCats.map(x => `<option value="${x.id}">${x.name}</option>`).join('')}</select></div>
            <div><label>Ítem del catálogo *</label><select id="iItem"><option value="">Selecciona</option>${items.filter(x => x.active !== false).map(x => `<option value="${x.id}">${x.code} · ${x.name}</option>`).join('')}</select></div>
            <div><label>Unidad</label><input id="iUnit" value="pza" placeholder="pza"/></div>
          </div>
          <div class="row-3">
            <div><label>Stock mínimo</label><input id="iMin" type="number" value="0"/></div>
            <div><label>Stock máximo</label><input id="iMax" type="number" value="0"/></div>
            <div><label>Stock actual</label><input id="iStock" type="number" value="0"/></div>
          </div>
          <div class="row-3">
            <div><label>Ítem en Vales (nombre exacto)</label><input id="iValesItem" placeholder="Ej: Bonderite C-AK 2074"/></div>
            <div><label>Peso kg por unidad</label><input id="iPesoKg" type="number" step="0.001" value="0" placeholder="Ej: 25"/></div>
            <div></div>
          </div>
          <button class="btn-primary" id="saveInvItemBtn">Agregar al inventario</button>
          <div id="invItemMsg" class="small muted" style="margin-top:6px"></div>
        </div>` : ''}
      </div>

      <!-- TAB: Captura Semanal -->
      <div id="inv-tab-semanal" style="display:none">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
          <button class="btn-secondary" id="sem-prev">◀</button>
          <span id="sem-label" style="font-weight:700;font-size:14px;min-width:200px;text-align:center">—</span>
          <button class="btn-secondary" id="sem-next">▶</button>
          <select id="sem-cat" style="margin-left:8px">
            <option value="">Todos los inventarios</option>
            ${invCats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>
        <div id="sem-form"></div>
      </div>

      <!-- TAB: Historial -->
      <div id="inv-tab-historial" style="display:none">
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
          <select id="hist-item" style="min-width:250px">
            <option value="">Selecciona un ítem</option>
            ${invItems.map(x => `<option value="${x.id}">${x.item_name} (${x.inventory_name})</option>`).join('')}
          </select>
          <select id="hist-year">
            ${[2025,2026,2027].map(y => `<option value="${y}"${y===new Date().getFullYear()?' selected':''}>${y}</option>`).join('')}
          </select>
          <button class="btn-primary" id="hist-btn">Ver historial</button>
        </div>
        <div id="hist-result"></div>
      </div>

      <!-- TAB: Gestionar listas (solo admin) -->
      ${state.user?.role === 'admin' ? `
      <div id="inv-tab-gestionar" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
          <!-- Lista actual de inventarios -->
          <div>
            <h4 style="margin:0 0 12px">Listas de inventario</h4>
            <div id="invCatList">
              ${invCats.length ? invCats.map(c => `
                <div id="invcat-row-${c.id}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;background:white">
                  <div style="flex:1">
                    <div id="invcat-view-${c.id}" style="display:flex;align-items:center;gap:6px">
                      <b style="font-size:14px">${escapeHtml(c.name)}</b>
                      ${c.description ? `<span class="muted" style="font-size:12px">· ${escapeHtml(c.description)}</span>` : ''}
                      <span class="muted" style="font-size:11px">(${invItems.filter(x=>x.inventory_catalog_id===c.id).length} ítems)</span>
                    </div>
                    <div id="invcat-edit-${c.id}" style="display:none;gap:6px;align-items:center">
                      <input id="invcat-name-${c.id}" value="${escapeHtml(c.name)}" style="flex:1;padding:4px 8px;font-size:13px"/>
                      <input id="invcat-desc-${c.id}" value="${escapeHtml(c.description||'')}" placeholder="Descripción" style="flex:1;padding:4px 8px;font-size:13px"/>
                    </div>
                  </div>
                  <div id="invcat-actions-${c.id}" style="display:flex;gap:4px">
                    <button class="btn-secondary invcat-edit-btn" data-id="${c.id}" style="padding:2px 8px;font-size:12px">✏ Editar</button>
                    <button class="btn-danger invcat-del-btn" data-id="${c.id}" data-name="${escapeHtml(c.name)}" data-count="${invItems.filter(x=>x.inventory_catalog_id===c.id).length}" style="padding:2px 8px;font-size:12px">🗑</button>
                  </div>
                  <div id="invcat-save-${c.id}" style="display:none;gap:4px">
                    <button class="btn-primary invcat-save-btn" data-id="${c.id}" style="padding:2px 8px;font-size:12px">Guardar</button>
                    <button class="btn-secondary invcat-cancel-btn" data-id="${c.id}" style="padding:2px 8px;font-size:12px">Cancelar</button>
                  </div>
                </div>`).join('')
              : '<div class="muted small">No hay listas de inventario todavía.</div>'}
            </div>
            <div id="invCatListMsg" class="small muted" style="margin-top:6px"></div>
          </div>
          <!-- Formulario nueva lista -->
          <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:16px">
            <h4 style="margin:0 0 12px">Nueva lista de inventario</h4>
            <div style="margin-bottom:8px"><label style="font-size:13px;font-weight:600">Nombre *</label><input id="newInvCatName" placeholder="Ej: Almacén General"/></div>
            <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600">Descripción</label><input id="newInvCatDesc" placeholder="Opcional"/></div>
            <button class="btn-primary" id="saveNewInvCatBtn">Crear inventario</button>
            <div id="newInvCatMsg" class="small muted" style="margin-top:6px"></div>
          </div>
        </div>
      </div>` : ''}
    </div>
  `, 'inventarios');

  // ── Modal edición ítem inventario ──────────────────────────────────────────
  const showInvEditModal = (x) => {
    const catItem = items.find(i => i.id === x.catalog_item_id);
    const modalEl = document.createElement('div');
    modalEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center';
    modalEl.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px;width:560px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <h3 style="margin:0 0 18px">✏️ Editar ítem de inventario</h3>
        <div class="small muted" style="margin-bottom:14px">Inventario: <b>${escapeHtml(x.inventory_name)}</b></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1/-1">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Ítem del catálogo *</label>
            <select id="ei-catalog-item" style="width:100%">
              <option value="">— Sin vincular —</option>
              ${items.filter(i => i.active !== false).map(i => `<option value="${i.id}"${i.id === x.catalog_item_id ? ' selected':''}>${i.code ? i.code+' · ':'' }${escapeHtml(i.name)}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Unidad</label>
            <input id="ei-unit" value="${escapeHtml(x.unit||'pza')}" style="width:100%"/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Stock actual</label>
            <input id="ei-stock" type="number" step="0.001" value="${x.current_stock}" style="width:100%"/>
          </div>

          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Stock mínimo</label>
            <input id="ei-min" type="number" step="0.001" value="${x.min_stock}" style="width:100%"/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Stock máximo</label>
            <input id="ei-max" type="number" step="0.001" value="${x.max_stock}" style="width:100%"/>
          </div>

          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Punto de reorden</label>
            <input id="ei-reorder" type="number" step="0.001" value="${x.reorder_point||0}" style="width:100%"/>
            <div class="small muted">Stock al que se genera alerta de compra</div>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Peso kg / unidad</label>
            <input id="ei-peso" type="number" step="0.001" value="${x.peso_kg_por_unidad||1}" style="width:100%"/>
            <div class="small muted">Para convertir a kg en Vales</div>
          </div>

          <div style="grid-column:1/-1">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Ítem en Vales de Adición</label>
            <select id="ei-vales-item" style="width:100%">
              <option value="">— Sin vincular —</option>
              ${valesItems.map(v => `<option value="${escapeHtml(v.item)}"${v.item === x.vales_item ? ' selected':''}>${escapeHtml(v.item)} (${v.unidad_base})</option>`).join('')}
            </select>
            ${x.vales_item && !valesItems.find(v => v.item === x.vales_item)
              ? `<div class="small" style="color:#d97706;margin-top:4px">⚠ Vínculo actual "${escapeHtml(x.vales_item)}" no encontrado en la lista</div>`
              : ''}
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button class="btn-secondary" id="ei-cancel">Cancelar</button>
          <button class="btn-primary" id="ei-save">Guardar cambios</button>
        </div>
        <div id="ei-msg" class="small" style="margin-top:8px;text-align:right"></div>
      </div>`;
    document.body.appendChild(modalEl);

    modalEl.querySelector('#ei-cancel').onclick = () => modalEl.remove();
    modalEl.onclick = (e) => { if (e.target === modalEl) modalEl.remove(); };

    modalEl.querySelector('#ei-save').onclick = async () => {
      const btn = modalEl.querySelector('#ei-save');
      const msg = modalEl.querySelector('#ei-msg');
      btn.disabled = true;
      try {
        const updated = await api(`/api/catalogs/inventory-items/${x.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            catalog_item_id:    Number(modalEl.querySelector('#ei-catalog-item').value) || x.catalog_item_id,
            unit:               modalEl.querySelector('#ei-unit').value.trim() || 'pza',
            current_stock:      Number(modalEl.querySelector('#ei-stock').value),
            min_stock:          Number(modalEl.querySelector('#ei-min').value),
            max_stock:          Number(modalEl.querySelector('#ei-max').value),
            reorder_point:      Number(modalEl.querySelector('#ei-reorder').value),
            peso_kg_por_unidad: Number(modalEl.querySelector('#ei-peso').value),
            vales_item:         modalEl.querySelector('#ei-vales-item').value
          })
        });
        // Update local cache
        const local = invItems.find(i => i.id === x.id);
        if (local) Object.assign(local, updated, {
          item_name:      (items.find(i => i.id === updated.catalog_item_id)||{}).name || local.item_name,
          inventory_name: local.inventory_name
        });
        msg.textContent = '✅ Guardado';
        msg.style.color = '#16a34a';
        setTimeout(() => { modalEl.remove(); renderInvTable(document.getElementById('filterInvCat')?.value || ''); }, 600);
      } catch (e) {
        msg.textContent = e.message;
        msg.style.color = '#dc2626';
        btn.disabled = false;
      }
    };
  };

  const renderInvTable = (filterCatId = '') => {
    const filtered = filterCatId
      ? invItems.filter(x => Number(x.inventory_catalog_id) === Number(filterCatId))
      : invItems;

    invTableWrap.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Inventario</th><th>Ítem</th><th>Unidad</th><th>Stock actual</th><th>Mínimo</th><th>Máx</th><th>P.Reorden</th><th>Vales</th><th>Estado</th><th style="min-width:80px"></th></tr></thead>
      <tbody>${filtered.length ? filtered.map(x => {
        const st = stockStatus(x);
        const rp = x.reorder_point || 0;
        const atReorder = rp > 0 && x.current_stock <= rp && x.current_stock > x.min_stock;
        return `<tr style="background:${st.bg}">
          <td style="font-size:11px">${x.inventory_name}</td>
          <td><b>${x.item_name}</b></td>
          <td style="font-size:12px">${x.unit||'pza'}</td>
          <td><input type="number" class="stock-input" data-id="${x.id}" value="${x.current_stock}" style="width:72px;border:1px solid ${x.current_stock <= x.min_stock ? '#fca5a5':'#e5e7eb'};border-radius:4px;padding:3px 6px"/></td>
          <td style="font-size:12px">${x.min_stock}</td>
          <td style="font-size:12px">${x.max_stock}</td>
          <td style="font-size:12px">${rp > 0 ? `<span style="color:${atReorder?'#d97706':'inherit'}">${rp}</span>` : '<span class="muted">—</span>'}</td>
          <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(x.vales_item||'')}">
            ${x.vales_item ? `<span style="color:#d97706">↔</span> ${escapeHtml(x.vales_item)}` : '<span class="muted">—</span>'}
          </td>
          <td><span style="background:${st.color};color:white;border-radius:10px;padding:2px 8px;font-size:11px">${st.label}</span></td>
          <td style="white-space:nowrap">
            <button class="btn-secondary update-stock-btn" data-id="${x.id}" style="padding:2px 7px;font-size:12px" title="Guardar stock">💾</button>
            ${canManage ? `<button class="btn-secondary edit-inv-btn" data-id="${x.id}" style="padding:2px 7px;font-size:12px;margin-left:4px" title="Editar">✏️</button>` : ''}
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="10" class="muted" style="text-align:center;padding:16px">Sin ítems en este inventario</td></tr>'}
      </tbody></table></div>`;

    invTableWrap.querySelectorAll('.update-stock-btn').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.id;
      const input = invTableWrap.querySelector(`.stock-input[data-id="${id}"]`);
      try {
        await api(`/api/catalogs/inventory-items/${id}`, { method: 'PATCH', body: JSON.stringify({ current_stock: Number(input.value) }) });
        btn.textContent = '✅';
        input.style.background = '#f0fff4';
        const local = invItems.find(x => x.id === Number(id));
        if (local) local.current_stock = Number(input.value);
        setTimeout(() => { btn.textContent = '💾'; input.style.background = ''; }, 1500);
      } catch (e) { alert(e.message); }
    });

    if (canManage) {
      invTableWrap.querySelectorAll('.edit-inv-btn').forEach(btn => btn.onclick = () => {
        const x = invItems.find(i => i.id === Number(btn.dataset.id));
        if (x) showInvEditModal(x);
      });
    }
  };

  renderInvTable();
  filterInvCat.onchange = () => renderInvTable(filterInvCat.value);

  printInvBtn.onclick = () => {
    const fv = filterInvCat.value;
    const filtered = fv ? invItems.filter(x => Number(x.inventory_catalog_id) === Number(fv)) : invItems;
    const catName = fv ? (invCats.find(c => c.id === Number(fv))||{}).name : 'Todos los inventarios';
    openPrintPreview(`Conteo de inventario — ${catName}`,
      `<h1>Formato de Conteo de Inventario</h1>
       <div class="small">Inventario: <b>${escapeHtml(catName)}</b> &nbsp;&nbsp; Fecha: _________________ &nbsp;&nbsp; Realizado por: _________________</div>
       <table>
         <thead><tr><th>Ítem</th><th>Código</th><th>Unidad</th><th>Stock sistema</th><th>Stock físico</th><th>Diferencia</th><th>Observaciones</th></tr></thead>
         <tbody>${filtered.map(x => {
           const catItem = items.find(i => i.id === x.catalog_item_id);
           return `<tr><td>${escapeHtml(x.item_name)}</td><td>${escapeHtml(catItem?.code||'-')}</td><td>${escapeHtml(x.unit||'pza')}</td><td style="text-align:center">${x.current_stock}</td><td style="text-align:center">_____</td><td style="text-align:center">_____</td><td></td></tr>`;
         }).join('')}</tbody>
       </table>`
    );
  };

  expInvBtn.onclick = () => downloadCsv('inventory_items', 'inventario.csv');

  if (belowMin.length > 0 && document.getElementById('genReplenishBtn')) {
    genReplenishBtn.onclick = () => {
      if (!confirm(`Se abrirá el módulo de requisiciones con ${belowMin.length} ítem(s) precargados para reposición. ¿Continuar?`)) return;
      state.itemsDraft = belowMin.map(x => ({
        id: crypto.randomUUID(),
        catalog_item_id: x.catalog_item_id,
        manual_item_name: x.item_name,
        quantity: Math.max(1, x.max_stock - x.current_stock),
        unit: x.unit || 'pza',
        unit_cost: 0,
        currency: 'MXN',
        comments: `Reposición — ${x.inventory_name}`
      }));
      location.hash = '#/requisiciones';
    };
  }

  if (canManage && document.getElementById('saveInvItemBtn')) {
    saveInvItemBtn.onclick = async () => {
      try {
        if (!iCat.value) throw new Error('Selecciona un inventario');
        if (!iItem.value) throw new Error('Selecciona un ítem del catálogo');
        await api('/api/catalogs/inventory-items', { method: 'POST', body: JSON.stringify({
          inventory_catalog_id: Number(iCat.value),
          catalog_item_id: Number(iItem.value),
          min_stock: Number(iMin.value || 0),
          max_stock: Number(iMax.value || 0),
          current_stock: Number(iStock.value || 0),
          unit: iUnit.value || 'pza',
          vales_item: iValesItem.value || '',
          peso_kg_por_unidad: Number(iPesoKg.value || 0)
        })});
        invItemMsg.textContent = '✅ Ítem agregado al inventario';
        invItemMsg.style.color = '#16a34a';
        setTimeout(render, 800);
      } catch (e) { invItemMsg.textContent = e.message; invItemMsg.style.color = '#dc2626'; }
    };
  }

  // ── Tab switching ──
  document.querySelectorAll('.inv-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.inv-tab-btn').forEach(b => b.classList.remove('inv-tab-active'));
      btn.classList.add('inv-tab-active');
      ['actual','semanal','historial','gestionar'].forEach(t => {
        const el = document.getElementById('inv-tab-' + t);
        if (el) el.style.display = t === btn.dataset.tab ? '' : 'none';
      });
    };
  });

  // ── Gestionar listas de inventario (solo admin) ──
  if (state.user?.role === 'admin') {
    // Crear nueva lista
    document.getElementById('saveNewInvCatBtn')?.addEventListener('click', async () => {
      const msgEl = document.getElementById('newInvCatMsg');
      const name = document.getElementById('newInvCatName').value.trim();
      if (!name) { msgEl.textContent = 'El nombre es requerido'; msgEl.style.color = '#dc2626'; return; }
      try {
        msgEl.textContent = 'Guardando...'; msgEl.style.color = '#6b7280';
        await api('/api/catalogs/inventory-catalogs', { method: 'POST', body: JSON.stringify({ name, description: document.getElementById('newInvCatDesc').value.trim() }) });
        msgEl.textContent = '✅ Inventario creado';
        msgEl.style.color = '#16a34a';
        setTimeout(render, 700);
      } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
    });

    // Editar: mostrar inputs
    document.querySelectorAll('.invcat-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        document.getElementById(`invcat-view-${id}`).style.display = 'none';
        document.getElementById(`invcat-edit-${id}`).style.display = 'flex';
        document.getElementById(`invcat-actions-${id}`).style.display = 'none';
        document.getElementById(`invcat-save-${id}`).style.display = 'flex';
      });
    });

    // Cancelar edición
    document.querySelectorAll('.invcat-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        document.getElementById(`invcat-view-${id}`).style.display = 'flex';
        document.getElementById(`invcat-edit-${id}`).style.display = 'none';
        document.getElementById(`invcat-actions-${id}`).style.display = 'flex';
        document.getElementById(`invcat-save-${id}`).style.display = 'none';
      });
    });

    // Guardar edición
    document.querySelectorAll('.invcat-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const msgEl = document.getElementById('invCatListMsg');
        const name = document.getElementById(`invcat-name-${id}`).value.trim();
        const desc = document.getElementById(`invcat-desc-${id}`).value.trim();
        if (!name) { msgEl.textContent = 'El nombre no puede estar vacío'; msgEl.style.color = '#dc2626'; return; }
        try {
          btn.disabled = true;
          await api(`/api/catalogs/inventory-catalogs/${id}`, { method: 'PATCH', body: JSON.stringify({ name, description: desc }) });
          msgEl.textContent = '✅ Guardado'; msgEl.style.color = '#16a34a';
          setTimeout(render, 600);
        } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; btn.disabled = false; }
      });
    });

    // Eliminar lista
    document.querySelectorAll('.invcat-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        const count = Number(btn.dataset.count);
        const msgEl = document.getElementById('invCatListMsg');
        if (count > 0) {
          if (!confirm(`"${name}" tiene ${count} ítem(s) en inventario.\n¿Eliminar la lista y todos sus ítems?`)) return;
        } else {
          if (!confirm(`¿Eliminar la lista "${name}"?`)) return;
        }
        try {
          btn.disabled = true;
          await api(`/api/catalogs/inventory-catalogs/${id}${count > 0 ? '?force=1' : ''}`, { method: 'DELETE' });
          msgEl.textContent = '✅ Lista eliminada'; msgEl.style.color = '#16a34a';
          setTimeout(render, 600);
        } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; btn.disabled = false; }
      });
    });
  }

  // ── Semana ISO helpers ──
  function getISOWeek(date) {
    const d = new Date(date); d.setUTCHours(0,0,0,0);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function getWeekMonday(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    return mon;
  }
  function fmtWeekLabel(year, week) {
    const mon = getWeekMonday(year, week);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    const fmt = d => d.toLocaleDateString('es-MX', { day:'numeric', month:'short', timeZone:'UTC' });
    return `Semana ${week} · ${fmt(mon)} – ${fmt(sun)} ${year}`;
  }

  let semYear = new Date().getFullYear();
  let semWeek = getISOWeek(new Date());

  const renderSemForm = async () => {
    const semLabel = document.getElementById('sem-label');
    const semForm  = document.getElementById('sem-form');
    if (!semLabel || !semForm) return;
    semLabel.textContent = fmtWeekLabel(semYear, semWeek);
    const catFilter = document.getElementById('sem-cat').value;
    const filtered = catFilter ? invItems.filter(x => Number(x.inventory_catalog_id) === Number(catFilter)) : invItems;
    if (filtered.length === 0) { semForm.innerHTML = '<p class="muted" style="text-align:center;padding:20px">Sin ítems en este inventario</p>'; return; }
    // Load existing captures for this week
    let existing = [];
    try { existing = await api(`/api/catalogs/inventory-weekly?year=${semYear}&week=${semWeek}`); } catch(_) {}
    const prevWeek = semWeek > 1 ? semWeek - 1 : 52;
    const prevYear = semWeek > 1 ? semYear : semYear - 1;
    let prevData = [];
    try { prevData = await api(`/api/catalogs/inventory-weekly?year=${prevYear}&week=${prevWeek}`); } catch(_) {}
    semForm.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Inventario</th><th>Ítem</th><th>Unidad</th><th>Stock anterior</th><th>Stock actual *</th><th>Pedido recibido</th><th>Consumo calc.</th></tr></thead>
        <tbody>${filtered.map(x => {
          const cap = existing.find(e => Number(e.inventory_item_id) === x.id);
          const prev = prevData.find(e => Number(e.inventory_item_id) === x.id);
          const stockActual = cap ? cap.stock_actual : x.current_stock;
          const pedido = cap ? (cap.pedido_recibido || 0) : 0;
          const prevStock = prev ? prev.stock_actual : null;
          const consumo = prevStock !== null ? (prevStock - stockActual + Number(pedido)) : '—';
          return `<tr>
            <td style="font-size:11px">${x.inventory_name}</td>
            <td><b>${x.item_name}</b>${x.vales_item ? `<br><span style="font-size:10px;color:#d97706">↔ ${x.vales_item}</span>` : ''}</td>
            <td>${x.unit||'pza'}</td>
            <td style="text-align:right;color:#6b7280">${prevStock !== null ? prevStock : '—'}</td>
            <td><input type="number" class="sem-stock" data-id="${x.id}" value="${stockActual}" style="width:70px;border:1px solid #e5e7eb;border-radius:4px;padding:3px 6px" step="0.01"/></td>
            <td><input type="number" class="sem-pedido" data-id="${x.id}" value="${pedido}" style="width:70px;border:1px solid #e5e7eb;border-radius:4px;padding:3px 6px" step="0.01"/></td>
            <td class="sem-consumo-${x.id}" style="text-align:right;font-weight:600;color:${typeof consumo==='number'&&consumo<0?'#dc2626':'#374151'}">${typeof consumo==='number'?consumo.toFixed(2):consumo}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;gap:8px">
        <button class="btn-secondary" id="sem-print-btn">🖨 Imprimir formato</button>
        <button class="btn-primary" id="sem-save-btn">💾 Guardar semana ${semWeek}</button>
        <span id="sem-msg" class="small muted" style="align-self:center"></span>
      </div>`;
    // Update consumo on input change
    semForm.querySelectorAll('.sem-stock, .sem-pedido').forEach(inp => {
      inp.oninput = () => {
        const id = inp.dataset.id;
        const stockEl = semForm.querySelector(`.sem-stock[data-id="${id}"]`);
        const pedEl   = semForm.querySelector(`.sem-pedido[data-id="${id}"]`);
        const prev2 = prevData.find(e => Number(e.inventory_item_id) === Number(id));
        const prevS = prev2 ? prev2.stock_actual : null;
        const consEl = semForm.querySelector(`.sem-consumo-${id}`);
        if (consEl && prevS !== null) {
          const c = prevS - Number(stockEl.value||0) + Number(pedEl.value||0);
          consEl.textContent = c.toFixed(2);
          consEl.style.color = c < 0 ? '#dc2626' : '#374151';
        }
      };
    });
    document.getElementById('sem-save-btn').onclick = async () => {
      const entries = filtered.map(x => ({
        inventory_item_id: x.id,
        stock_actual: Number(semForm.querySelector(`.sem-stock[data-id="${x.id}"]`)?.value || 0),
        pedido_recibido: Number(semForm.querySelector(`.sem-pedido[data-id="${x.id}"]`)?.value || 0)
      }));
      try {
        await api('/api/catalogs/inventory-weekly', { method: 'POST', body: JSON.stringify({ year: semYear, week: semWeek, entries }) });
        document.getElementById('sem-msg').textContent = '✅ Guardado';
        document.getElementById('sem-msg').style.color = '#16a34a';
      } catch(e) { document.getElementById('sem-msg').textContent = e.message; document.getElementById('sem-msg').style.color = '#dc2626'; }
    };
    document.getElementById('sem-print-btn').onclick = () => {
      const catName = document.getElementById('sem-cat').options[document.getElementById('sem-cat').selectedIndex]?.text || 'Inventario';
      openPrintPreview(`Captura Inventario — ${fmtWeekLabel(semYear, semWeek)}`,
        `<h1>Formato de Captura Semanal</h1>
         <div class="small">Inventario: <b>${escapeHtml(catName)}</b> &nbsp;&nbsp; ${fmtWeekLabel(semYear, semWeek)} &nbsp;&nbsp; Realizado por: _________________</div>
         <table>
           <thead><tr><th>Ítem</th><th>Unidad</th><th>Stock anterior</th><th>Stock físico</th><th>Pedido recibido</th><th>Consumo</th><th>Firma</th></tr></thead>
           <tbody>${filtered.map(x => {
             const prev2 = prevData.find(e => Number(e.inventory_item_id) === x.id);
             return `<tr><td>${escapeHtml(x.item_name)}</td><td>${escapeHtml(x.unit||'pza')}</td><td style="text-align:center">${prev2 ? prev2.stock_actual : '—'}</td><td style="text-align:center">_____</td><td style="text-align:center">_____</td><td style="text-align:center">_____</td><td>_____</td></tr>`;
           }).join('')}</tbody>
         </table>`
      );
    };
  };

  document.getElementById('sem-prev').onclick = () => {
    if (semWeek > 1) { semWeek--; } else { semWeek = 52; semYear--; }
    renderSemForm();
  };
  document.getElementById('sem-next').onclick = () => {
    if (semWeek < 52) { semWeek++; } else { semWeek = 1; semYear++; }
    renderSemForm();
  };
  document.getElementById('sem-cat').onchange = renderSemForm;
  renderSemForm();

  // ── Historial ──
  document.getElementById('hist-btn').onclick = async () => {
    const itemId = document.getElementById('hist-item').value;
    const year   = document.getElementById('hist-year').value;
    if (!itemId) { alert('Selecciona un ítem'); return; }
    const histResult = document.getElementById('hist-result');
    histResult.innerHTML = '<p class="muted">Cargando...</p>';
    try {
      const rows = await api(`/api/catalogs/inventory-weekly?item_id=${itemId}&year=${year}`);
      const item = invItems.find(x => x.id === Number(itemId));
      if (rows.length === 0) { histResult.innerHTML = '<p class="muted" style="text-align:center;padding:20px">Sin capturas para este ítem/año</p>'; return; }
      // Build chart data
      const sorted = rows.sort((a,b) => a.week - b.week);
      const labels = sorted.map(r => `S${r.week}`);
      const stocks = sorted.map(r => r.stock_actual);
      const pedidos = sorted.map(r => r.pedido_recibido || 0);
      const consumos = sorted.map((r, i) => {
        if (i === 0) return null;
        return sorted[i-1].stock_actual - r.stock_actual + (r.pedido_recibido || 0);
      });
      histResult.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:16px">
          <h4 style="margin-bottom:12px">${item?.item_name} — ${year}</h4>
          <div style="height:220px"><canvas id="hist-chart"></canvas></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Semana</th><th style="text-align:right">Stock actual</th><th style="text-align:right">Pedido recibido</th><th style="text-align:right">Consumo real</th><th>Capturado por</th><th>Fecha</th></tr></thead>
          <tbody>${sorted.map((r,i) => {
            const c = i > 0 ? sorted[i-1].stock_actual - r.stock_actual + (r.pedido_recibido || 0) : null;
            return `<tr>
              <td>S${r.week}</td>
              <td style="text-align:right;font-weight:600">${r.stock_actual}</td>
              <td style="text-align:right;color:#16a34a">${r.pedido_recibido || 0}</td>
              <td style="text-align:right;font-weight:600;color:${c!==null&&c<0?'#dc2626':'#374151'}">${c !== null ? c.toFixed(2) : '—'}</td>
              <td style="font-size:11px">${r.capturado_por || '-'}</td>
              <td style="font-size:11px">${r.fecha_captura ? r.fecha_captura.slice(0,10) : '-'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
      if (typeof Chart !== 'undefined') {
        new Chart(document.getElementById('hist-chart'), {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Stock', data: stocks, backgroundColor: '#3b82f680', borderColor: '#3b82f6', borderWidth: 1.5, type: 'bar' },
              { label: 'Consumo real', data: consumos, backgroundColor: '#d9770680', borderColor: '#d97706', borderWidth: 1.5, type: 'bar' },
              { label: 'Pedido recibido', data: pedidos, backgroundColor: '#16a34a80', borderColor: '#16a34a', borderWidth: 1.5, type: 'bar' }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
        });
      }
    } catch(e) { histResult.innerHTML = `<div style="color:#dc2626">Error: ${e.message}</div>`; }
  };

  bindCommon();
}

async function adminView() {
  const [users, rules, suppliers, cc, scc, sysInfo] = await Promise.all([
    api('/api/admin/users'),
    api('/api/catalogs/approval-rules'),
    api('/api/catalogs/suppliers'),
    api('/api/catalogs/cost-centers'),
    api('/api/catalogs/sub-cost-centers'),
    api('/api/admin/system-info').catch(() => null)
  ]);
  app.innerHTML = shell(`
    <div class="grid grid-2">
      <div class="card section">
        <div class="module-title"><h3>Usuarios</h3><button class="btn-secondary" id="expUsersBtn">Exportar</button></div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Depto</th><th>Estado</th><th>Acción</th></tr></thead>
        <tbody>${users.map(u => `<tr><td><b>${u.full_name}</b></td><td style="font-size:12px">${u.email}</td><td style="font-size:12px">${u.role_code}</td><td style="font-size:12px">${u.department||'-'}</td><td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${u.active!==false?'#dcfce7':'#fee2e2'};color:${u.active!==false?'#15803d':'#dc2626'}">${u.active!==false?'Activo':'Inactivo'}</span></td><td><button class="btn-secondary toggle-user-btn" data-id="${u.id}" data-active="${u.active!==false}" style="padding:2px 8px;font-size:11px">${u.active!==false?'Deshabilitar':'Habilitar'}</button> <button class="btn-secondary edit-user-btn" data-id="${u.id}" style="padding:2px 8px;font-size:11px">✏</button></td></tr>`).join('')}</tbody>
        </table></div>
        <h4>Crear / Editar usuario</h4>
        <div style="margin-bottom:8px">
          <label>Seleccionar usuario existente para editar:</label>
          <select id="usrEditId" style="width:100%"><option value="">— Nuevo usuario —</option>${users.map(u => `<option value="${u.id}">${u.full_name} (${u.role_code}) · ${u.email}</option>`).join('')}</select>
        </div>
        <div class="row-3">
          <div><label>Nombre *</label><input id="usrName" placeholder="Nombre completo"/></div>
          <div><label>Correo *</label><input id="usrEmail" placeholder="correo@empresa.com"/></div>
          <div><label>Departamento</label><input id="usrDept" placeholder="MANT"/></div>
        </div>
        <div class="row-3">
          <div><label>Rol</label><select id="usrRole"><option>cliente_requisicion</option><option>comprador</option><option>autorizador</option><option>pagos</option><option>proveedor</option><option>admin</option></select></div>
          <div><label>Proveedor (si rol=proveedor)</label><select id="usrSupplier"><option value="">Ninguno</option>${suppliers.map(s => `<option value="${s.id}">${s.business_name}</option>`).join('')}</select></div>
          <div><label>Contraseña <span class="muted small">(dejar vacío para no cambiar)</span></label><input id="usrPass" placeholder="Nueva contraseña"/></div>
        </div>
        <div class="row-2">
          <div><label>Centro de costo predeterminado</label><select id="usrCostCenter"><option value="">Sin predeterminado</option>${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></div>
          <div><label>Subcentro predeterminado</label><select id="usrDefaultScc"><option value="">Sin predeterminado</option>${scc.map(s => { const p = cc.find(c=>c.id===Number(s.cost_center_id)); return `<option value="${s.id}">${s.code} · ${s.name} (${p?.code||'?'})</option>`; }).join('')}</select></div>
        </div>
        <div style="margin-bottom:8px">
          <label class="small muted" style="display:block;margin-bottom:4px">Subcentros permitidos <span class="small muted">(vacío = todos)</span></label>
          <select id="usrSccCcFilter" style="width:100%;margin-bottom:6px;font-size:13px">
            <option value="">— Filtrar por centro de costo —</option>
            ${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}
          </select>
          <div id="usrSccCheckboxes" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;border:1px solid #e2e8f0;border-radius:6px;max-height:120px;overflow-y:auto;background:white">
            ${scc.map(s => { const p = cc.find(c=>c.id===Number(s.cost_center_id)); return `<label class="usr-scc-row" data-cc="${s.cost_center_id}" style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;white-space:nowrap"><input type="checkbox" class="usr-scc-chk" value="${s.id}"/> <b style="color:#1d4ed8">${s.code}</b> ${s.name} <span class="muted">(${p?.code||'?'})</span></label>`; }).join('')}
          </div>
        </div>
        <div><small class="muted">Si el rol es "proveedor", el proveedor es obligatorio.</small></div>
        <div class="actions">
          <button class="btn-primary" id="saveUsrBtn">Guardar usuario</button>
          <button class="btn-secondary" id="clearUsrBtn">Limpiar</button>
        </div>
        <div id="usrMsg" class="small muted"></div>
      </div>
      <div class="card section">
        <h3>Alta de proveedor con usuario</h3>
        <p class="small muted">Al dar de alta un proveedor, se crea automáticamente su usuario de acceso (rol proveedor).</p>
        <div class="row-2">
          <div><label>Nombre del proveedor *</label><input id="newSupName" placeholder="Tlapalería García"/></div>
          <div><label>Código (opcional)</label><input id="newSupCode" placeholder="TGA-001"/></div>
        </div>
        <div class="row-2">
          <div><label>RFC</label><input id="newSupRfc" placeholder="RFC"/></div>
          <div><label>Teléfono</label><input id="newSupPhone" placeholder="55 0000 0000"/></div>
        </div>
        <div><label>Correo del proveedor</label><input id="newSupEmail" placeholder="contacto@tlapaleria.com"/></div>
        <hr style="margin:12px 0;border:none;border-top:1px solid #eee"/>
        <h4 style="margin:0 0 8px">Usuario de acceso del proveedor</h4>
        <div class="row-2">
          <div><label>Nombre del usuario *</label><input id="newSupUserName" placeholder="Juan García"/></div>
          <div><label>Correo de acceso *</label><input id="newSupUserEmail" placeholder="juan@tlapaleria.com"/></div>
        </div>
        <div><label>Contraseña inicial</label><input id="newSupUserPass" value="Demo123*" placeholder="Demo123*"/></div>
        <div class="actions"><button class="btn-primary" id="saveNewSupBtn">Crear proveedor + usuario</button></div>
        <div id="newSupMsg" class="small muted"></div>
      </div>
    </div>
    <div class="card section" style="margin-top:16px">
      <h3>Reglas de autorización</h3>
      ${rules.map(r => `<div class="list-line">${r.name}: $${r.min_amount} – $${r.max_amount} · ${r.auto_approve ? '✅ Auto' : '👤 '+r.approver_role}</div>`).join('') || '<div class="muted small">Sin reglas configuradas</div>'}
    </div>
    <div class="card section" style="margin-top:16px">
      <div class="module-title"><h3>Proveedores registrados</h3><div style="display:flex;gap:8px"><button class="btn-secondary" id="expSuppliersBtn" style="font-size:12px">⬇ Exportar CSV</button><label class="btn-secondary" style="font-size:12px;cursor:pointer;padding:6px 12px">⬆ Importar CSV<input type="file" id="impSuppliersFile" accept=".csv,.txt" style="display:none"/></label><span id="impSuppliersMsg" class="small muted"></span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Código</th><th>Proveedor</th><th>Contacto</th><th>Correo</th><th>Usuario asignado</th><th>Acción</th></tr></thead>
      <tbody>${suppliers.map(s => {
        const supUser = users.find(u => u.supplier_id === s.id && u.role_code === 'proveedor');
        return `<tr>
          <td>${s.provider_code||'-'}</td><td><b>${s.business_name}</b></td>
          <td>${s.contact_name||'-'}</td><td>${s.email||'-'}</td>
          <td>${supUser ? `✅ ${supUser.email}` : '<span style="color:#dc2626">⚠ Sin usuario</span>'}</td>
          <td><button class="btn-secondary edit-supplier-btn" data-id="${s.id}" style="padding:2px 8px;font-size:11px">✏ Editar</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <h4 style="margin-top:16px" id="editSupplierTitle">Editar proveedor</h4>
      <div id="editSupplierForm" style="display:none">
        <input type="hidden" id="supEditId"/>
        <div class="row-3">
          <div><label>Razón social *</label><input id="supBizName" placeholder="Nombre del proveedor"/></div>
          <div><label>Código</label><input id="supCode" placeholder="PRV-001"/></div>
          <div><label>RFC</label><input id="supRfc" placeholder="RFC"/></div>
        </div>
        <div class="row-3">
          <div><label>Nombre contacto</label><input id="supContact" placeholder="Nombre contacto"/></div>
          <div><label>Correo</label><input id="supEmail" type="email" placeholder="proveedor@empresa.com"/></div>
          <div><label>Teléfono</label><input id="supPhone" placeholder="55 0000 0000"/></div>
        </div>
        <div><label>Dirección</label><input id="supAddress" placeholder="Dirección completa" style="width:100%"/></div>
        <div class="actions">
          <button class="btn-primary" id="saveSupplierBtn">Guardar cambios</button>
          <button class="btn-secondary" id="cancelSupplierBtn">Cancelar</button>
        </div>
        <div id="supMsg" class="small muted"></div>
      </div>
    </div>
    <!-- 🔑 Solicitudes de cambio de contraseña -->
    <div class="card section" style="margin-top:16px">
      <h3>🔑 Solicitudes de cambio de contraseña</h3>
      <div id="pwRequestsWrap"><div class="small muted">Cargando...</div></div>
    </div>
    <!-- 📦 Exportar / Importar base de datos -->
    <div class="card section" style="margin-top:16px;border:2px solid #bfdbfe;background:#eff6ff">
      <h3 style="color:#1d4ed8">📦 Exportar / Importar base de datos</h3>
      <p class="small muted">Exporta la base de datos actual como JSON para hacer respaldo o migrarla al servidor en línea. Importa un archivo JSON para reemplazar los datos del servidor.</p>
      <div class="row-2" style="gap:24px;align-items:flex-start">
        <div>
          <b style="font-size:13px">⬇ Exportar</b>
          <p class="small muted" style="margin:4px 0 8px">Descarga todos los datos (catálogos, usuarios, proveedores, transacciones) como un archivo JSON.</p>
          <button class="btn-primary" id="exportDbBtn" style="padding:8px 20px">⬇ Descargar backup JSON</button>
          <span id="exportDbMsg" class="small muted" style="display:block;margin-top:6px"></span>
        </div>
        <div>
          <b style="font-size:13px">⬆ Importar (cargar en línea)</b>
          <p class="small muted" style="margin:4px 0 8px">Selecciona un archivo JSON exportado previamente para <b>reemplazar</b> toda la base de datos del servidor activo.</p>
          <input type="file" id="importDbFile" accept=".json" style="font-size:12px;margin-bottom:8px;display:block"/>
          <button class="btn-secondary" id="importDbBtn" style="padding:8px 20px">⬆ Importar y reemplazar</button>
          <span id="importDbMsg" class="small muted" style="display:block;margin-top:6px"></span>
        </div>
      </div>
    </div>
    <!-- 🖥 Estado del sistema -->
    <div class="card section" style="margin-top:16px;border:2px solid #d1fae5;background:#f0fdf4">
      <h3 style="color:#065f46">🖥 Estado del sistema</h3>
      ${sysInfo ? (() => {
        const fmt = b => b < 1024*1024 ? `${(b/1024).toFixed(1)} KB` : b < 1024*1024*1024 ? `${(b/1024/1024).toFixed(1)} MB` : `${(b/1024/1024/1024).toFixed(2)} GB`;
        const heapPct = Math.round(sysInfo.memory.heapUsed / sysInfo.memory.heapTotal * 100);
        const heapColor = heapPct > 80 ? '#dc2626' : heapPct > 60 ? '#d97706' : '#16a34a';
        const mo = sysInfo.timeline.monthsCovered;
        const alertMsg = mo >= 30 ? `⚠ Llevas ${mo} meses de datos. Se recomienda archivar los más antiguos.` : mo >= 20 ? `ℹ Llevas ${mo} meses de datos. Considera programar un respaldo pronto.` : `✅ ${mo} mes(es) de datos. Sin necesidad de archivo por ahora.`;
        const alertColor = mo >= 30 ? '#dc2626' : mo >= 20 ? '#d97706' : '#065f46';
        return `
        <div class="grid grid-4" style="gap:12px;margin-bottom:16px">
          <div style="background:white;border-radius:8px;padding:12px;border:1px solid #d1fae5">
            <div class="small muted">Memoria RAM usada</div>
            <div style="font-size:18px;font-weight:700;color:${heapColor}">${heapPct}%</div>
            <div class="small muted">${fmt(sysInfo.memory.heapUsed)} / ${fmt(sysInfo.memory.heapTotal)}</div>
            <div style="height:6px;background:#e5e7eb;border-radius:3px;margin-top:6px"><div style="height:6px;background:${heapColor};border-radius:3px;width:${heapPct}%"></div></div>
          </div>
          <div style="background:white;border-radius:8px;padding:12px;border:1px solid #d1fae5">
            <div class="small muted">Base de datos</div>
            <div style="font-size:18px;font-weight:700">${fmt(sysInfo.db.size)}</div>
            <div class="small muted">${sysInfo.db.requisitions} req · ${sysInfo.db.purchase_orders} POs · ${sysInfo.db.invoices} facturas · ${sysInfo.db.payments} pagos</div>
          </div>
          <div style="background:white;border-radius:8px;padding:12px;border:1px solid #d1fae5">
            <div class="small muted">Archivos (PDFs/XMLs)</div>
            <div style="font-size:18px;font-weight:700">${fmt(sysInfo.storage.size)}</div>
            <div class="small muted">${sysInfo.storage.invoiceFiles} fact. · ${sysInfo.storage.paymentFiles} comprobantes</div>
          </div>
          <div style="background:white;border-radius:8px;padding:12px;border:1px solid #d1fae5">
            <div class="small muted">Historial de datos</div>
            <div style="font-size:18px;font-weight:700">${mo} mes(es)</div>
            <div class="small muted">${sysInfo.timeline.oldest ? sysInfo.timeline.oldest.slice(0,10) : '-'} → hoy</div>
          </div>
        </div>
        <div style="padding:10px 14px;border-radius:8px;background:white;border:1px solid ${alertColor};color:${alertColor};font-size:13px;margin-bottom:14px">${alertMsg}</div>
        <div style="background:white;border-radius:8px;padding:14px;border:1px solid #d1fae5">
          <b style="font-size:13px">🗂 Archivar y eliminar datos anteriores a una fecha</b>
          <p class="small muted" style="margin:6px 0 10px">Se descargará un archivo JSON con los datos antiguos (respaldo) y se eliminarán de la base de datos activa. Los catálogos, usuarios y proveedores NO se tocan.</p>
          <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <div><label class="small muted">Archivar datos anteriores a</label><input id="archiveCutoff" type="date" style="display:block" value="${(() => { const d = new Date(); d.setMonth(d.getMonth() - 18); return d.toISOString().slice(0,10); })()}"/></div>
            <button class="btn-secondary" id="archiveBtn" style="background:#065f46;color:white;border-color:#065f46">📥 Archivar y descargar</button>
            <span id="archiveMsg" class="small muted"></span>
          </div>
        </div>`;
      })() : '<p class="small muted">No se pudo obtener información del sistema.</p>'}
    </div>
    <!-- 🔧 Reparar ítems atascados -->
    <div class="card section" style="margin-top:16px;border:2px solid #fde68a;background:#fffbeb">
      <h3 style="color:#92400e">🔧 Reparar ítems atascados en "En cotización"</h3>
      <p class="small muted">Busca ítems con cotización ganadora registrada pero cuyos campos (proveedor, costo, winning_quote_id) no fueron sincronizados. Los repara y los avanza a Autorizado → Pendientes de PO.</p>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="btn-primary" id="repairItemsBtn" style="background:#92400e;border-color:#92400e;padding:8px 20px">🔧 Ejecutar reparación</button>
        <span id="repairItemsMsg" class="small muted"></span>
      </div>
      <div id="repairItemsResult" style="margin-top:10px"></div>
    </div>

    <!-- ⚠ Reset de base de datos — SOLO PRUEBAS -->
    <div class="card section" style="margin-top:16px;border:2px solid #fca5a5;background:#fff8f8">
      <h3 style="color:#dc2626">⚠ Reset de base de datos (solo pruebas)</h3>
      <p class="small muted">Borra todas las transacciones (requisiciones, POs, cotizaciones, facturas, pagos) pero <b>conserva usuarios, proveedores, catálogo, centros de costo y reglas</b>.<br>
      Este botón debe eliminarse antes de ir a producción.</p>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="btn-danger" id="resetDbBtn" style="padding:8px 20px">🗑 Resetear base de datos de pruebas</button>
        <span id="resetDbMsg" class="small muted"></span>
      </div>
    </div>
  `, 'admin');

  usrEditId.onchange = () => {
    const u = users.find(x => x.id === Number(usrEditId.value));
    if (!u) {
      usrName.value = ''; usrEmail.value = ''; usrDept.value = '';
      usrRole.value = 'cliente_requisicion'; usrSupplier.value = ''; usrPass.value = '';
      usrCostCenter.value = '';
      document.getElementById('usrDefaultScc').value = '';
      document.querySelectorAll('.usr-scc-chk').forEach(chk => { chk.checked = false; });
      saveUsrBtn.textContent = 'Guardar usuario';
      return;
    }
    usrName.value = u.full_name;
    usrEmail.value = u.email;
    usrDept.value = u.department || '';
    usrRole.value = u.role_code;
    usrSupplier.value = u.supplier_id || '';
    usrCostCenter.value = u.default_cost_center_id || '';
    document.getElementById('usrDefaultScc').value = u.default_sub_cost_center_id || '';
    const allowedIds = u.allowed_scc_ids || [];
    document.querySelectorAll('.usr-scc-chk').forEach(chk => { chk.checked = allowedIds.includes(Number(chk.value)); });
    usrPass.value = '';
    saveUsrBtn.textContent = 'Actualizar usuario';
  };
  clearUsrBtn.onclick = () => { usrEditId.value = ''; usrEditId.dispatchEvent(new Event('change')); };

  document.getElementById('usrSccCcFilter')?.addEventListener('change', function() {
    const ccId = this.value;
    document.querySelectorAll('.usr-scc-row').forEach(row => {
      row.style.display = (!ccId || row.dataset.cc === ccId) ? 'flex' : 'none';
    });
    const defSel = document.getElementById('usrDefaultScc');
    if (defSel) {
      [...defSel.options].forEach(opt => {
        if (!opt.value) return;
        const s = scc.find(x => x.id === Number(opt.value));
        opt.style.display = (!ccId || String(s?.cost_center_id) === ccId) ? '' : 'none';
      });
      if (defSel.selectedOptions[0]?.style.display === 'none') defSel.value = '';
    }
  });

  saveUsrBtn.onclick = async () => {
    try {
      if (!usrName.value || !usrEmail.value) throw new Error('Nombre y correo requeridos');
      const editId = usrEditId.value ? Number(usrEditId.value) : null;
      const allowedSccIds = [...document.querySelectorAll('.usr-scc-chk:checked')].map(c => Number(c.value));
      const payload = { full_name: usrName.value, email: usrEmail.value, department: usrDept.value, role_code: usrRole.value, supplier_id: usrSupplier.value || null, default_cost_center_id: usrCostCenter.value ? Number(usrCostCenter.value) : null, default_sub_cost_center_id: document.getElementById('usrDefaultScc').value ? Number(document.getElementById('usrDefaultScc').value) : null, allowed_scc_ids: allowedSccIds };
      if (usrPass.value) payload.password = usrPass.value;
      if (editId) {
        await api(`/api/admin/users/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        usrMsg.textContent = '✅ Usuario actualizado';
      } else {
        if (!payload.password) payload.password = 'Demo123*';
        await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
        usrMsg.textContent = '✅ Usuario creado';
      }
      usrMsg.style.color = '#16a34a';
      usrEditId.value = ''; usrName.value = ''; usrEmail.value = ''; usrDept.value = '';
      usrRole.value = 'cliente_requisicion'; usrSupplier.value = ''; usrPass.value = '';
      saveUsrBtn.textContent = 'Guardar usuario';
      setTimeout(render, 1000);
    } catch (e) { usrMsg.textContent = e.message; usrMsg.style.color = '#dc2626'; }
  };

  saveNewSupBtn.onclick = async () => {
    try {
      if (!newSupName.value) throw new Error('Nombre de proveedor requerido');
      if (!newSupUserEmail.value || !newSupUserName.value) throw new Error('Nombre y correo del usuario son requeridos');
      const out = await api('/api/admin/suppliers-with-user', { method: 'POST', body: JSON.stringify({
        business_name: newSupName.value,
        provider_code: newSupCode.value || undefined,
        email: newSupEmail.value,
        phone: newSupPhone.value,
        rfc: newSupRfc.value,
        user_full_name: newSupUserName.value,
        user_email: newSupUserEmail.value,
        user_password: newSupUserPass.value || 'Demo123*'
      })});
      newSupMsg.textContent = out.message || '✅ Proveedor y usuario creados';
      newSupMsg.style.color = '#16a34a';
      newSupName.value = ''; newSupCode.value = ''; newSupRfc.value = ''; newSupPhone.value = '';
      newSupEmail.value = ''; newSupUserName.value = ''; newSupUserEmail.value = ''; newSupUserPass.value = 'Demo123*';
      setTimeout(render, 1200);
    } catch (e) { newSupMsg.textContent = e.message; newSupMsg.style.color = '#dc2626'; }
  };

  expUsersBtn.onclick = () => downloadCsv('users', 'usuarios.csv');

  document.querySelectorAll('.edit-supplier-btn').forEach(btn => {
    btn.onclick = () => {
      const s = suppliers.find(x => x.id === Number(btn.dataset.id));
      if (!s) return;
      supEditId.value = s.id;
      supBizName.value = s.business_name || '';
      supCode.value = s.provider_code || '';
      supRfc.value = s.rfc || '';
      supContact.value = s.contact_name || '';
      supEmail.value = s.email || '';
      supPhone.value = s.phone || '';
      supAddress.value = s.address || '';
      editSupplierForm.style.display = 'block';
      supMsg.textContent = '';
      editSupplierTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  cancelSupplierBtn?.addEventListener('click', () => {
    editSupplierForm.style.display = 'none';
    supEditId.value = '';
  });

  saveSupplierBtn?.addEventListener('click', async () => {
    try {
      if (!supBizName.value) throw new Error('Razón social requerida');
      await api(`/api/catalogs/suppliers/${supEditId.value}`, { method: 'PATCH', body: JSON.stringify({
        business_name: supBizName.value,
        provider_code: supCode.value || undefined,
        rfc: supRfc.value || undefined,
        contact_name: supContact.value || undefined,
        email: supEmail.value || undefined,
        phone: supPhone.value || undefined,
        address: supAddress.value || undefined
      })});
      supMsg.textContent = '✅ Proveedor actualizado';
      supMsg.style.color = '#16a34a';
      setTimeout(render, 1000);
    } catch(e) { supMsg.textContent = e.message; supMsg.style.color = '#dc2626'; }
  });

  document.querySelectorAll('.toggle-user-btn').forEach(btn => {
    btn.onclick = async () => {
      const active = btn.dataset.active === 'true';
      try {
        await api(`/api/admin/users/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ active: !active }) });
        adminView();
      } catch(e) { alert(e.message); }
    };
  });
  document.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.onclick = () => {
      usrEditId.value = btn.dataset.id;
      usrEditId.dispatchEvent(new Event('change'));
    };
  });

  // ── Cargar solicitudes de contraseña ────────────────────────────────────────
  (async () => {
    const wrap = document.getElementById('pwRequestsWrap');
    try {
      const reqs = await api('/api/admin/password-requests');
      if (!reqs.length) { wrap.innerHTML = '<div class="small muted">Sin solicitudes pendientes ✅</div>'; return; }
      wrap.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Correo</th><th>Solicitado</th><th>Acciones</th></tr></thead><tbody>
        ${reqs.map(r => `<tr>
          <td><b>${escapeHtml(r.user_name)}</b></td>
          <td style="font-size:12px">${escapeHtml(r.user_email)}</td>
          <td style="font-size:12px">${String(r.requested_at||'').slice(0,16).replace('T',' ')}</td>
          <td><button class="btn-primary approve-pw-req" data-id="${r.id}" style="padding:3px 10px;font-size:12px">✅ Aprobar y enviar enlace</button> <button class="btn-danger reject-pw-req" data-id="${r.id}" style="padding:3px 10px;font-size:12px">✖ Rechazar</button></td>
        </tr>`).join('')}
      </tbody></table></div>`;
      wrap.querySelectorAll('.approve-pw-req').forEach(btn => {
        btn.onclick = async () => {
          try {
            btn.disabled = true; btn.textContent = '...';
            const out = await api(`/api/admin/password-requests/${btn.dataset.id}/approve`, { method: 'POST' });
            if (out.mailto) window.open(out.mailto, '_blank');
            btn.closest('tr').innerHTML = `<td colspan="4" style="color:#16a34a;font-size:12px">✅ Enlace enviado a ${escapeHtml(out.message||'')}</td>`;
          } catch(e) { alert(e.message); btn.disabled = false; btn.textContent = '✅ Aprobar y enviar enlace'; }
        };
      });
      wrap.querySelectorAll('.reject-pw-req').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('¿Rechazar esta solicitud?')) return;
          try {
            await api(`/api/admin/password-requests/${btn.dataset.id}`, { method: 'DELETE' });
            btn.closest('tr').remove();
            if (!wrap.querySelectorAll('tbody tr').length) wrap.innerHTML = '<div class="small muted">Sin solicitudes pendientes ✅</div>';
          } catch(e) { alert(e.message); }
        };
      });
    } catch(e) { wrap.innerHTML = `<div class="small muted">${e.message}</div>`; }
  })();

  // ── Exportar proveedores CSV ─────────────────────────────────────────────────
  document.getElementById('expSuppliersBtn')?.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/catalogs/suppliers/export-csv', {
        credentials: 'include'
      });
      if (!resp.ok) throw new Error('Error al exportar');
      const blob = await resp.blob();
      const cd = resp.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `proveedores-${new Date().toISOString().slice(0,10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch(e) { alert(e.message); }
  });

  // ── Importar proveedores CSV ─────────────────────────────────────────────────
  document.getElementById('impSuppliersFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const msgEl = document.getElementById('impSuppliersMsg');
    if (!confirm(`¿Importar proveedores desde "${file.name}"? Los proveedores nuevos se agregarán (no reemplaza existentes).`)) { e.target.value = ''; return; }
    try {
      msgEl.textContent = 'Importando...';
      const csv = await file.text();
      const out = await api('/api/catalogs/suppliers/import', { method: 'POST', body: JSON.stringify({ csv }) });
      msgEl.textContent = `✅ ${out.inserted} proveedor(es) importado(s)`;
      msgEl.style.color = '#16a34a';
      e.target.value = '';
      setTimeout(render, 1200);
    } catch(err) { msgEl.textContent = err.message; msgEl.style.color = '#dc2626'; e.target.value = ''; }
  });

  document.getElementById('repairItemsBtn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('repairItemsMsg');
    const resultEl = document.getElementById('repairItemsResult');
    if (!confirm('¿Ejecutar reparación de ítems atascados? Se sincronizarán cotizaciones ganadoras a sus ítems y se avanzarán a Autorizado.')) return;
    msgEl.textContent = 'Reparando...'; msgEl.style.color = '#92400e';
    resultEl.innerHTML = '';
    try {
      const data = await api('/api/admin/repair-stuck-items', { method: 'POST' });
      msgEl.textContent = `✅ ${data.fixed} ítem(s) reparado(s)`;
      msgEl.style.color = '#16a34a';
      if (data.items?.length) {
        resultEl.innerHTML = `<div class="table-wrap"><table style="font-size:12px"><thead><tr><th>Requisición</th><th>Ítem</th><th>Proveedor</th><th>Costo</th><th>Nuevo estatus</th></tr></thead><tbody>
          ${data.items.map(r => `<tr>
            <td>${escapeHtml(r.requisition_folio)}</td>
            <td>${escapeHtml(r.item_name)}</td>
            <td>${escapeHtml(r.winner_supplier)}</td>
            <td>$${Number(r.after.unit_cost||0).toFixed(2)}</td>
            <td style="color:#16a34a;font-weight:600">${escapeHtml(r.after.status)}</td>
          </tr>`).join('')}
        </tbody></table></div>`;
      } else {
        resultEl.innerHTML = '<p class="small muted">No se encontraron ítems para reparar.</p>';
      }
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  });

  document.getElementById('resetDbBtn')?.addEventListener('click', async () => {
    const confirmMsg = '¿Estás seguro? Esto borrará TODAS las requisiciones, POs, cotizaciones, facturas y pagos.\n\nEscribe CONFIRMAR para continuar:';
    const input = prompt(confirmMsg);
    if (input !== 'CONFIRMAR') { alert('Operación cancelada.'); return; }
    const msgEl = document.getElementById('resetDbMsg');
    try {
      msgEl.textContent = 'Reseteando...';
      const out = await api('/api/admin/reset-db', { method: 'POST', body: JSON.stringify({ confirm: 'RESET_CONFIRMAR' }) });
      msgEl.textContent = `✅ ${out.message}`;
      msgEl.style.color = '#16a34a';
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  });

  // ── Exportar DB ───────────────────────────────────────────────────────────
  document.getElementById('exportDbBtn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('exportDbMsg');
    try {
      msgEl.textContent = 'Generando...';
      msgEl.style.color = '#6b7280';
      // Usamos fetch directo para obtener el blob del archivo
      const resp = await fetch('/api/admin/export-db', {
        credentials: 'include'
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || resp.statusText); }
      const blob = await resp.blob();
      const cd = resp.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `backup-db-${new Date().toISOString().slice(0,10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      msgEl.textContent = `✅ Archivo descargado: ${filename}`;
      msgEl.style.color = '#16a34a';
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  });

  // ── Importar DB ───────────────────────────────────────────────────────────
  document.getElementById('importDbBtn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('importDbMsg');
    const fileInput = document.getElementById('importDbFile');
    if (!fileInput.files?.length) { msgEl.textContent = 'Selecciona un archivo JSON primero.'; msgEl.style.color = '#dc2626'; return; }
    const confirmMsg = '⚠ Esto REEMPLAZARÁ toda la base de datos del servidor activo con el archivo seleccionado.\n\nEscribe IMPORTAR para confirmar:';
    if (prompt(confirmMsg) !== 'IMPORTAR') { alert('Operación cancelada.'); return; }
    try {
      msgEl.textContent = 'Leyendo archivo...';
      msgEl.style.color = '#6b7280';
      const text = await fileInput.files[0].text();
      const data = JSON.parse(text);
      msgEl.textContent = 'Importando...';
      const out = await api('/api/admin/import-db', { method: 'POST', body: JSON.stringify({ confirm: 'IMPORT_CONFIRMAR', data }) });
      msgEl.textContent = `✅ ${out.message}`;
      msgEl.style.color = '#16a34a';
      fileInput.value = '';
    } catch(e) { msgEl.textContent = e.message || 'Error al importar'; msgEl.style.color = '#dc2626'; }
  });

  // ── Archivar datos antiguos ────────────────────────────────────────────────
  document.getElementById('archiveBtn')?.addEventListener('click', async () => {
    const cutoff = document.getElementById('archiveCutoff')?.value;
    const msgEl = document.getElementById('archiveMsg');
    if (!cutoff) { msgEl.textContent = 'Selecciona una fecha de corte.'; msgEl.style.color = '#dc2626'; return; }
    if (!confirm(`¿Archivar y ELIMINAR todos los datos anteriores al ${cutoff}?\n\nSe descargará un respaldo JSON. Esta acción no se puede deshacer.`)) return;
    try {
      msgEl.textContent = 'Archivando...'; msgEl.style.color = '#6b7280';
      const resp = await fetch('/api/admin/archive-old-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: 'ARCHIVE_CONFIRMAR', cutoff_date: cutoff })
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || resp.statusText); }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `archivo-${cutoff}.json`; a.click();
      URL.revokeObjectURL(url);
      msgEl.textContent = '✅ Archivo descargado y datos eliminados.'; msgEl.style.color = '#16a34a';
    } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
  });

  bindCommon();
}

// ── AUDITORÍA ────────────────────────────────────────────────────────────────
async function auditView() {
  const fmtMXN = v => Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  const statusColors = { 'En autorización': '#f59e0b', 'Autorizado': '#10b981', 'En cotización': '#3b82f6', 'En proceso': '#6366f1', 'Entregado': '#059669', 'Cancelado': '#ef4444', 'Rechazado': '#dc2626', 'Facturado': '#7c3aed' };

  let sortCol = 'created_at', sortDir = 'desc';
  let searchVal = '', filterStatus = '', filterCc = '';
  let editingId = null;

  const [catalogs, costCenters, subCostCenters, suppliers] = await Promise.all([
    api('/api/catalogs/items').catch(() => []),
    api('/api/catalogs/cost-centers').catch(() => []),
    api('/api/catalogs/sub-cost-centers').catch(() => []),
    api('/api/catalogs/suppliers').catch(() => [])
  ]);

  const allStatuses = ['En cotización','En autorización','Autorizado','En proceso','Entregado','Facturado','Cancelado','Rechazado'];

  const load = () => {
    const qs = new URLSearchParams({ sort: sortCol, order: sortDir, search: searchVal, status: filterStatus, cc_id: filterCc }).toString();
    return api(`/api/audit/items?${qs}`);
  };

  const colHeader = (col, label) => {
    const active = sortCol === col;
    const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th data-col="${col}" style="padding:6px 10px;cursor:pointer;white-space:nowrap;user-select:none;background:${active?'#e0e7ff':'#f1f5f9'};border-bottom:2px solid ${active?'#6366f1':'#e5e7eb'}">${label}${arrow}</th>`;
  };

  const render = async () => {
    const rows = await load().catch(() => []);

    app.innerHTML = shell(`
      <div class="card section">
        <div class="module-title" style="margin-bottom:12px">
          <h3 style="margin:0">🔎 Auditoría de Compras <span style="background:#6366f1;color:white;border-radius:10px;padding:2px 10px;font-size:13px;margin-left:8px">${rows.length}</span></h3>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
          <input id="auditSearch" type="text" placeholder="Buscar ítem, folio, proveedor, CC..." value="${escapeHtml(searchVal)}"
            style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;min-width:260px;flex:1"/>
          <select id="auditStatus" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px">
            <option value="">Todos los estados</option>
            ${allStatuses.map(s => `<option value="${s}" ${filterStatus===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <select id="auditCc" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px">
            <option value="">Todos los CC</option>
            ${costCenters.map(c => `<option value="${c.id}" ${filterCc==c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
          <button id="auditClearBtn" class="btn-secondary" style="font-size:12px;padding:5px 12px">Limpiar</button>
        </div>

        <div class="table-wrap">
          <table id="auditTable" style="font-size:12px;width:100%">
            <thead><tr>
              ${colHeader('req_folio','Folio REQ')}
              ${colHeader('req_date','Fecha')}
              ${colHeader('requester_name','Solicitante')}
              ${colHeader('item_name','Ítem')}
              ${colHeader('supplier_name','Proveedor')}
              ${colHeader('cost_center_name','Centro de Costo')}
              <th style="padding:6px 10px;background:#f1f5f9">Sub CC</th>
              ${colHeader('quantity','Cant.')}
              ${colHeader('unit_cost','P.U.')}
              ${colHeader('total','Total')}
              <th style="padding:6px 10px;background:#f1f5f9">Moneda</th>
              ${colHeader('status','Estatus')}
              <th style="padding:6px 10px;background:#f1f5f9">PO</th>
            </tr></thead>
            <tbody>
              ${rows.length ? rows.map(r => {
                const isEditing = editingId === r.id;
                const sccFiltered = subCostCenters.filter(s => s.cost_center_id === r.cost_center_id);
                const statusColor = statusColors[r.status] || '#6b7280';
                return `
                  <tr class="audit-row" data-id="${r.id}" style="cursor:pointer;background:${isEditing?'#eff6ff':'white'};border-top:1px solid #f1f5f9"
                    title="Clic para editar">
                    <td style="padding:6px 10px;font-family:monospace;font-size:11px;color:#2563eb">${escapeHtml(r.req_folio)}</td>
                    <td style="padding:6px 10px;white-space:nowrap">${r.req_date || '-'}</td>
                    <td style="padding:6px 10px">${escapeHtml(r.requester_name)}</td>
                    <td style="padding:6px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.item_name)}"><b>${escapeHtml(r.item_name)}</b></td>
                    <td style="padding:6px 10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.supplier_name)}</td>
                    <td style="padding:6px 10px">${escapeHtml(r.cost_center_name)}</td>
                    <td style="padding:6px 10px;color:#6b7280">${escapeHtml(r.sub_cost_center_name)}</td>
                    <td style="padding:6px 10px;text-align:right">${r.quantity} ${escapeHtml(r.unit||'')}</td>
                    <td style="padding:6px 10px;text-align:right">$${fmtMXN(r.unit_cost)}</td>
                    <td style="padding:6px 10px;text-align:right;font-weight:600">$${fmtMXN(r.total)}</td>
                    <td style="padding:6px 10px;text-align:center">${escapeHtml(r.currency)}</td>
                    <td style="padding:6px 10px">
                      <span style="background:${statusColor}20;color:${statusColor};border-radius:4px;padding:2px 7px;font-size:11px;white-space:nowrap">${escapeHtml(r.status)}</span>
                    </td>
                    <td style="padding:6px 10px;font-family:monospace;font-size:11px">${r.po_folio ? `<span style="color:#059669">${escapeHtml(r.po_folio)}</span>` : '<span style="color:#d1d5db">—</span>'}</td>
                  </tr>
                  <tr class="audit-edit-row" id="edit-row-${r.id}" style="display:${isEditing?'':'none'};background:#f8fafc">
                    <td colspan="13" style="padding:0">
                      <div style="padding:16px 20px;border-top:2px solid #6366f1;border-bottom:2px solid #6366f1">
                        <div style="font-size:13px;font-weight:700;color:#4338ca;margin-bottom:12px">✏️ Editar ítem · ${escapeHtml(r.item_name)}</div>
                        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Nombre del ítem
                            <input id="ae_name_${r.id}" type="text" value="${escapeHtml(r.manual_item_name||r.item_name)}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"/>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Proveedor
                            <select id="ae_supp_${r.id}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                              <option value="">Sin proveedor</option>
                              ${suppliers.map(s => `<option value="${s.id}" ${r.supplier_id===s.id?'selected':''}>${escapeHtml(s.business_name)}</option>`).join('')}
                            </select>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Centro de Costo
                            <select id="ae_cc_${r.id}" data-item-id="${r.id}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                              <option value="">— Sin CC —</option>
                              ${costCenters.map(c => `<option value="${c.id}" ${r.cost_center_id===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
                            </select>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Sub Centro de Costo
                            <select id="ae_scc_${r.id}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                              <option value="">— Sin Sub CC —</option>
                              ${subCostCenters.filter(s => s.cost_center_id === (Number(document.getElementById(`ae_cc_${r.id}`)?.value) || r.cost_center_id)).map(s => `<option value="${s.id}" ${r.sub_cost_center_id===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
                            </select>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Cantidad
                            <input id="ae_qty_${r.id}" type="number" min="0" step="any" value="${r.quantity}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"/>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Unidad
                            <input id="ae_unit_${r.id}" type="text" value="${escapeHtml(r.unit||'')}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"/>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Precio Unitario
                            <input id="ae_cost_${r.id}" type="number" min="0" step="any" value="${r.unit_cost}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"/>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
                            Moneda
                            <select id="ae_cur_${r.id}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                              <option value="MXN" ${r.currency==='MXN'?'selected':''}>MXN</option>
                              <option value="USD" ${r.currency==='USD'?'selected':''}>USD</option>
                            </select>
                          </label>
                          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;grid-column:span 2">
                            Comentarios
                            <input id="ae_comments_${r.id}" type="text" value="${escapeHtml(r.comments||'')}" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"/>
                          </label>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:14px">
                          <button class="btn-primary audit-save-btn" data-id="${r.id}" style="font-size:12px;padding:5px 16px">💾 Guardar cambios</button>
                          <button class="btn-secondary audit-cancel-btn" data-id="${r.id}" style="font-size:12px;padding:5px 12px">Cancelar</button>
                          <span class="audit-save-msg" id="audit-msg-${r.id}" style="font-size:12px;color:#059669;align-self:center"></span>
                        </div>
                      </div>
                    </td>
                  </tr>`;
              }).join('') : '<tr><td colspan="13" style="text-align:center;padding:32px;color:#9ca3af">Sin ítems para los filtros seleccionados</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `, 'auditoria');

    // ── Ordenar por columna ───────────────────────────────────────────────────
    document.querySelectorAll('#auditTable th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortCol = col; sortDir = 'asc'; }
        render();
      });
    });

    // ── Filtros ───────────────────────────────────────────────────────────────
    const searchEl = document.getElementById('auditSearch');
    let _st;
    searchEl?.addEventListener('input', e => {
      clearTimeout(_st);
      _st = setTimeout(() => { searchVal = e.target.value; render(); }, 350);
    });
    document.getElementById('auditStatus')?.addEventListener('change', e => { filterStatus = e.target.value; render(); });
    document.getElementById('auditCc')?.addEventListener('change', e => { filterCc = e.target.value; render(); });
    document.getElementById('auditClearBtn')?.addEventListener('click', () => {
      searchVal = ''; filterStatus = ''; filterCc = ''; sortCol = 'created_at'; sortDir = 'desc';
      render();
    });

    // ── Click en fila → abrir/cerrar edición ─────────────────────────────────
    document.querySelectorAll('.audit-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = Number(row.dataset.id);
        editingId = editingId === id ? null : id;
        render();
      });
    });

    // ── CC cambia → actualizar Sub CC dinámicamente ───────────────────────────
    document.querySelectorAll('select[id^="ae_cc_"]').forEach(sel => {
      sel.addEventListener('change', () => {
        const id = sel.dataset.itemId;
        const ccId = Number(sel.value);
        const sccSel = document.getElementById(`ae_scc_${id}`);
        if (!sccSel) return;
        const opts = subCostCenters.filter(s => s.cost_center_id === ccId);
        sccSel.innerHTML = '<option value="">— Sin Sub CC —</option>' +
          opts.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
      });
    });

    // ── Cancelar edición ─────────────────────────────────────────────────────
    document.querySelectorAll('.audit-cancel-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); editingId = null; render(); });
    });

    // ── Guardar cambios ───────────────────────────────────────────────────────
    document.querySelectorAll('.audit-save-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const payload = {
          manual_item_name: document.getElementById(`ae_name_${id}`)?.value || '',
          supplier_id: document.getElementById(`ae_supp_${id}`)?.value || null,
          cost_center_id: document.getElementById(`ae_cc_${id}`)?.value || null,
          sub_cost_center_id: document.getElementById(`ae_scc_${id}`)?.value || null,
          quantity: document.getElementById(`ae_qty_${id}`)?.value,
          unit: document.getElementById(`ae_unit_${id}`)?.value || '',
          unit_cost: document.getElementById(`ae_cost_${id}`)?.value,
          currency: document.getElementById(`ae_cur_${id}`)?.value || 'MXN',
          comments: document.getElementById(`ae_comments_${id}`)?.value || ''
        };
        const msgEl = document.getElementById(`audit-msg-${id}`);
        btn.disabled = true;
        try {
          await api(`/api/audit/items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          if (msgEl) { msgEl.textContent = '✅ Guardado'; msgEl.style.color = '#059669'; }
          setTimeout(() => { editingId = null; render(); }, 800);
        } catch(err) {
          if (msgEl) { msgEl.textContent = `⚠ ${err.message || 'Error al guardar'}`; msgEl.style.color = '#dc2626'; }
          btn.disabled = false;
        }
      });
    });

    bindCommon();
  };

  await render();
}

async function render() {
  const route = (location.hash || '').replace('#/', '');
  const requestedModule = route.split('/')[0];
  // Ruta pública: recuperación de contraseña (no requiere sesión)
  if (route.startsWith('reset-password')) {
    const params = new URLSearchParams(route.replace('reset-password', '').replace('?', ''));
    const token = params.get('token');
    if (token) return resetPasswordView(token);
  }
  if (!state.user) {
    if (route && route !== 'login') state.pendingRoute = route;
    return loginView();
  }
  if (state.user?.role === 'sin_rol') {
    logout();
    return loginView();
  }
  const defaultRoute = getDefaultRouteByRole();
  if (!route || route === 'login') { location.hash = `#/${defaultRoute}`; return; }
  // Vista previa de requisición: accesible para todos los roles operativos aunque no tengan 'requisiciones' en menú
  if (route.startsWith('requisiciones/') && !route.startsWith('requisiciones/editar/')) {
    const canPreview = ['comprador', 'autorizador', 'pagos', 'inventarios', 'cliente_requisicion', 'admin'].includes(state.user?.role);
    if (canPreview) return requisitionPreviewView(route.split('/')[1]);
  }
  if (!canAccess(requestedModule)) { location.hash = `#/${defaultRoute}`; return; }
  if (route === 'dashboard') return dashboardView();
  if (route === 'catalogos') return catalogsView();
  if (route === 'requisiciones') return requisitionsView();
  if (route.startsWith('requisiciones/editar/')) return requisitionsView(route.split('/')[2]);
  if (route.startsWith('requisiciones/')) return requisitionPreviewView(route.split('/')[1]);
  if (route === 'seguimiento') return trackingListView();
  if (route.startsWith('seguimiento/')) return trackingDetailView(route.split('/')[1]);
  if (route === 'autorizaciones') return approvalsView();
  if (route === 'compras') return purchasesView();
  if (route === 'cotizaciones') return quotationsView();
  if (route === 'facturacion') return invoicingView();
  if (route === 'pagos') return paymentsView();
  if (route === 'inventarios') return inventoryView();
  if (route === 'auditoria') return auditView();
  if (route === 'admin') return adminView();
  location.hash = `#/${defaultRoute}`;
}

window.addEventListener('hashchange', () => { render().then(() => { if (state.user) initNotifications(); }); });
if (state.user) initInactivityWatcher();
render().then(() => { if (state.user) initNotifications(); });
