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
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  itemsDraft: []
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
  ['admin', 'Admin']
];

const MENU_BY_ROLE = {
  cliente_requisicion: ['dashboard', 'requisiciones', 'seguimiento'],
  comprador: ['dashboard', 'compras', 'catalogos', 'seguimiento', 'cotizaciones', 'facturacion', 'pagos'],
  autorizador: ['dashboard', 'autorizaciones', 'seguimiento'],
  proveedor: ['cotizaciones', 'facturacion'],
  pagos: ['dashboard', 'pagos', 'seguimiento', 'facturacion', 'autorizaciones'],
  admin: ['dashboard', 'requisiciones', 'seguimiento', 'autorizaciones', 'compras', 'catalogos', 'cotizaciones', 'facturacion', 'pagos', 'inventarios', 'admin']
};

const app = document.getElementById('app');

// Auto-logout por inactividad (15 minutos)
const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
let inactivityTimer = null;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (state.token) {
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
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401) {
    logout();
    return;
  }
  if (!res.ok) throw new Error(data.error || data || 'Error');
  return data;
}

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function logout() {
  localStorage.clear();
  state.token = null;
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
  return `<div class="layout"><aside class="sidebar"><div class="brand">Sistema de Compras</div><nav class="nav">${navItems.filter(([k]) => allowed.includes(k)).map(([k,l]) => `<a href="#/${k}" class="${active === k ? 'active' : ''}">${l}</a>`).join('')}<a href="#" id="logoutBtn">Cerrar sesión</a></nav></aside><main class="main"><div class="topbar"><div><h2>${active[0].toUpperCase() + active.slice(1)}</h2><div class="muted small">${state.user?.name || ''} · ${state.user?.role || ''}</div></div><span class="badge">Flujo operativo</span></div>${content}</main></div>`;
}

function bindCommon() {
  const out = document.getElementById('logoutBtn');
  if (out) out.onclick = (e) => { e.preventDefault(); logout(); };
}

async function downloadCsv(entity, filename, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/exports/${entity}.csv${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
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
  app.innerHTML = `<div class="login-wrap"><div class="card login-card"><h1>Entrar</h1><p>Usuarios demo:<br><b>cliente@demo.com</b><br><b>comprador@demo.com</b><br><b>admin@demo.com</b><br><b>pagos@demo.com</b><br><b>autorizador@demo.com</b><br><b>proveedor@demo.com</b><br>Contraseña: <b>Demo123*</b></p><label>Correo</label><input id="email" value="cliente@demo.com" /><label>Contraseña</label><input id="password" type="password" value="Demo123*" /><button class="btn-primary" id="loginBtn" style="margin-top:16px;width:100%">Iniciar sesión</button><div id="err" class="error"></div></div></div>`;
  loginBtn.onclick = async () => {
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
      setAuth(data.token, data.user);
      initInactivityWatcher();
      location.hash = `#/${getDefaultRouteByRole()}`;
      render();
    } catch (e) { err.textContent = e.message; }
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
        <div class="table-wrap"><table><thead><tr><th>Código</th><th>Proveedor</th><th>Contacto</th><th>Correo</th><th></th></tr></thead>
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
      <div class="card section"><h3>Centros / subcentros</h3><div class="table-wrap"><table><thead><tr><th>Código</th><th>Nombre</th><th>Subcentros</th><th></th></tr></thead><tbody>${cc.map(c => `<tr><td><b>${c.code}</b></td><td>${c.name}</td><td style="font-size:12px">${scc.filter(x => x.cost_center_id === c.id).map(x => `${x.code} · ${x.name}`).join(', ')||'-'}</td><td style="white-space:nowrap"><button class="btn-secondary edit-cc-btn" data-id="${c.id}" data-code="${c.code}" data-name="${c.name}" style="padding:2px 7px;font-size:11px">✏</button> <button class="btn-danger del-cc-btn" data-id="${c.id}" style="padding:2px 7px;font-size:11px">✖</button></td></tr>`).join('')}</tbody></table></div><h4 id="ccFormTitle">Nuevo centro de costo</h4><div class="row-3"><input id="ccCode" placeholder="Código (ej. CC-PRD)"/><input id="ccName" placeholder="Nombre"/><button class="btn-primary" id="saveCcBtn">Guardar</button></div><input type="hidden" id="ccEditId" value=""/><div id="ccMsg" class="small muted" style="margin-top:4px"></div><hr style="margin:12px 0;border:none;border-top:1px solid #eee"/><h4>Subcentros</h4><div class="row-3"><select id="sccParent"><option value="">Centro padre</option>${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select><input id="sccCode" placeholder="Código subcentro"/><input id="sccName" placeholder="Nombre subcentro"/></div><div style="margin-top:6px"><button class="btn-primary" id="saveSccBtn">Guardar subcentro</button></div></div>
      <div class="card section"><h3>Reglas de autorización</h3><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Monto mín MXN</th><th>Monto máx MXN</th><th>Quién autoriza</th><th></th></tr></thead><tbody>${rules.map(r => `<tr><td><b>${r.name}</b></td><td>$${Number(r.min_amount).toLocaleString('es-MX',{minimumFractionDigits:2})}</td><td>$${Number(r.max_amount).toLocaleString('es-MX',{minimumFractionDigits:2})}</td><td>${r.auto_approve ? '<span style="color:#16a34a">✅ Automática</span>' : `👤 ${r.approver_role||'-'}`}</td><td style="white-space:nowrap"><button class="btn-secondary edit-rule-btn" data-id="${r.id}" data-name="${r.name}" data-min="${r.min_amount}" data-max="${r.max_amount}" data-role="${r.approver_role||''}" data-auto="${r.auto_approve}" style="padding:2px 7px;font-size:11px">✏</button> <button class="btn-danger del-rule-btn" data-id="${r.id}" style="padding:2px 7px;font-size:11px">✖</button></td></tr>`).join('')}</tbody></table></div><h4 id="ruleFormTitle">Nueva regla</h4><div class="row-3"><input id="ruleName" placeholder="Nombre regla"/><input id="ruleMin" type="number" placeholder="Monto mín"/><input id="ruleMax" type="number" placeholder="Monto máx"/></div><div class="row-3"><select id="ruleRole"><option value="">Sin rol (automática)</option><option value="comprador">comprador</option><option value="autorizador">autorizador</option><option value="pagos">pagos</option><option value="admin">admin</option></select><label style="display:flex;align-items:center;gap:6px;padding-top:20px"><input id="ruleAuto" type="checkbox"/> Aprobación automática</label><button class="btn-primary" id="saveRuleBtn" style="margin-top:16px">Guardar regla</button></div><input type="hidden" id="ruleEditId" value=""/><div id="ruleMsg" class="small muted" style="margin-top:4px"></div></div>
    </div>
  `, 'catalogos');

  // Render tabla de ítems
  const renderItemsTable = () => {
    const nameFilter = (document.getElementById('filterItemName')?.value || '').toLowerCase();
    const filtered = getFilteredItems().filter(i => !nameFilter || i.name.toLowerCase().includes(nameFilter));
    itemsTableWrap.innerHTML = `<table><thead><tr><th>Código</th><th>Nombre</th><th>Unidad</th><th>Proveedor</th><th>Precio</th><th>Acciones</th></tr></thead>
    <tbody>${filtered.map(i => `<tr>
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
    ${filtered.length === 0 ? '<tr><td colspan="6" class="muted" style="text-align:center;padding:12px">Sin ítems</td></tr>' : ''}
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
  };
  renderItemsTable();

  filterSupplierCat.onchange = () => { filterSupplierId = filterSupplierCat.value; renderItemsTable(); };
  document.getElementById('filterItemName').oninput = renderItemsTable;

  document.querySelectorAll('.edit-sup-row').forEach(btn => {
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
  saveCcBtn.onclick = async () => { try { const payload = { code: document.getElementById('ccCode').value, name: document.getElementById('ccName').value }; const editId = document.getElementById('ccEditId').value; if (editId) await api(`/api/catalogs/cost-centers/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) }); else await api('/api/catalogs/cost-centers', { method:'POST', body: JSON.stringify(payload)}); catalogsView(); } catch (e) { document.getElementById('ccMsg').textContent = e.message; } };
  saveSccBtn.onclick = async () => { try { const payload = { cost_center_id: Number(sccParent.value), code: sccCode.value, name: sccName.value }; await api('/api/catalogs/sub-cost-centers', { method:'POST', body: JSON.stringify(payload)}); catalogsView(); } catch (e) { document.getElementById('ccMsg').textContent = e.message; } };
  saveRuleBtn.onclick = async () => { try { const payload = { name: document.getElementById('ruleName').value, min_amount: Number(document.getElementById('ruleMin').value||0), max_amount: Number(document.getElementById('ruleMax').value||0), approver_role: document.getElementById('ruleRole').value || null, auto_approve: document.getElementById('ruleAuto').checked }; const editId = document.getElementById('ruleEditId').value; if (editId) await api(`/api/catalogs/approval-rules/${editId}`, { method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/catalogs/approval-rules', { method:'POST', body: JSON.stringify(payload)}); catalogsView(); } catch (e) { document.getElementById('ruleMsg').textContent = e.message; } };
  // Editar/eliminar centros de costo
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
  // Editar/eliminar reglas
  document.querySelectorAll('.edit-rule-btn').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('ruleEditId').value = btn.dataset.id;
      document.getElementById('ruleName').value = btn.dataset.name;
      document.getElementById('ruleMin').value = btn.dataset.min;
      document.getElementById('ruleMax').value = btn.dataset.max;
      document.getElementById('ruleRole').value = btn.dataset.role;
      document.getElementById('ruleAuto').checked = btn.dataset.auto === 'true';
      document.getElementById('ruleFormTitle').textContent = 'Editar regla';
      document.getElementById('saveRuleBtn').textContent = 'Actualizar';
    };
  });
  document.querySelectorAll('.del-rule-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('¿Eliminar esta regla de autorización?')) return;
      try { await api(`/api/catalogs/approval-rules/${btn.dataset.id}`, { method: 'DELETE' }); catalogsView(); } catch(e) { alert(e.message); }
    };
  });
  bindCommon();
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
      <div class="card section"><h3>${editing ? 'Editar requisición' : 'Nueva requisición'}</h3><div class="row-3"><div><label>Urgencia</label><select id="urgency"><option ${editing?.requisition.urgency==='Alto'?'selected':''}>Alto</option><option ${editing?.requisition.urgency==='Medio'?'selected':''}>Medio</option><option ${editing?.requisition.urgency==='Bajo'?'selected':''}>Bajo</option><option ${editing?.requisition.urgency==='Entrega programada'?'selected':''}>Entrega programada</option></select><div id="urgencyRange" class="small muted"></div></div><div><label>Centro de costo</label><select id="costCenter"><option value="">Selecciona</option>${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></div><div><label>Subcentro</label><select id="subCostCenter"></select></div></div><div class="row-3"><div><label>Moneda</label><input id="currency" value="${editing?.requisition.currency || 'MXN'}" readonly/></div><div><label>Fecha programada</label><input id="programmedDate" type="date" value="${editing?.requisition.programmed_date || ''}"/></div><div><label>Comentarios</label><input id="comments" placeholder="Observaciones" value="${editing?.requisition.comments || ''}"/></div></div><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:12px"><h4 id="itemEntryTitle" style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">+ Nuevo ítem</h4><div class="row-3"><div><label style="font-size:12px">Ítem catálogo</label><select id="entry-catalog"><option value="">Manual / no catalogado</option>${items.map(i=>`<option value="${i.id}">${i.code} · ${i.name}</option>`).join('')}</select></div><div><label style="font-size:12px">Nombre manual</label><input id="entry-manual-name" placeholder="Descripción del ítem" list="entry-manual-list" autocomplete="off"/><datalist id="entry-manual-list">${items.map(i=>`<option value="${i.name}" data-id="${i.id}">`).join('')}</datalist></div><div><label style="font-size:12px">Proveedor</label><select id="entry-supplier"><option value="">Sin proveedor</option>${suppliers.map(s=>`<option value="${s.id}">${s.business_name}</option>`).join('')}</select></div></div><div class="row-4" style="margin-top:8px"><div><label style="font-size:12px">Cantidad</label><input id="entry-quantity" type="number" value="1" min="0.01"/></div><div><label style="font-size:12px">Unidad</label><select id="entry-unit">${units.map(u=>`<option>${u}</option>`).join('')}</select></div><div><label style="font-size:12px">Costo unit.</label><input id="entry-cost" type="number" value="0" min="0"/></div><div><label style="font-size:12px">Moneda</label><input id="entry-currency-item" value="MXN" readonly/></div></div><div class="row-3" style="margin-top:8px"><div><label style="font-size:12px">Centro de costo</label><select id="entry-item-cc"><option value="">Del encabezado</option>${cc.map(c=>`<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></div><div><label style="font-size:12px">Subcentro</label><select id="entry-item-scc"><option value="">Selecciona</option></select></div><div></div></div><div class="row-2" style="margin-top:8px"><input id="entry-weblink" placeholder="Liga web (opcional)"/><input id="entry-item-comments" placeholder="Comentarios del ítem"/></div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn-primary" id="addItemBtn">+ Agregar a lista</button><button class="btn-secondary" id="cancelEditItemBtn" style="display:none">✕ Cancelar edición</button></div></div><div id="itemsDraft" style="margin-top:12px"></div><div class="actions"><button class="btn-secondary" id="previewReqBtn">Vista PDF</button><button class="btn-secondary" id="saveDraftBtn">Guardar borrador</button><button class="btn-primary" id="sendReqBtn">Guardar y enviar</button></div><div id="reqMsg" class="error"></div></div>
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
    document.getElementById('entry-item-scc').innerHTML = '<option value="">Selecciona</option>';
    itemEntryTitle.textContent = '+ Nuevo ítem';
    addItemBtn.textContent = '+ Agregar a lista';
    cancelEditItemBtn.style.display = 'none';
    currentEditItemId = null;
  };
  document.getElementById('entry-catalog').onchange = () => {
    const cat = items.find(i => i.id === Number(document.getElementById('entry-catalog').value));
    if (cat) {
      if (cat.supplier_id) document.getElementById('entry-supplier').value = cat.supplier_id;
      if (cat.unit) document.getElementById('entry-unit').value = cat.unit;
      document.getElementById('entry-cost').value = Number(cat.unit_price || 0);
      document.getElementById('entry-currency-item').value = cat.currency || currency.value || 'MXN';
      if (cat.cost_center_id) { costCenter.value = cat.cost_center_id; setSubOptions(cat.cost_center_id, cat.sub_cost_center_id || ''); if (cat.sub_cost_center_id) subCostCenter.value = cat.sub_cost_center_id; }
    }
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
    const opts = scc.filter(x => Number(x.cost_center_id) === Number(ccId));
    document.getElementById('entry-item-scc').innerHTML = `<option value="">Selecciona</option>${opts.map(x=>`<option value="${x.id}">${x.code} · ${x.name}</option>`).join('')}`;
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
          return `<tr style="${currentEditItemId === row.id ? 'background:#eff6ff' : ''}"><td style="font-size:12px"><b>${escapeHtml(itemName)}</b>${row.web_link ? `<br><a href="${escapeHtml(row.web_link)}" target="_blank" style="font-size:10px;color:#3b82f6">🔗 Liga</a>` : ''}</td><td style="font-size:12px">${escapeHtml(supplierName)}</td><td style="font-size:12px;text-align:right">${row.quantity}</td><td style="font-size:12px">${escapeHtml(row.unit||'-')}</td><td style="font-size:12px;text-align:right">$${Number(row.unit_cost||0).toFixed(2)}</td><td style="font-size:12px;text-align:right;font-weight:600">$${lineTotal.toFixed(2)}</td><td style="white-space:nowrap"><button class="btn-secondary edit-draft-item" data-id="${row.id}" style="padding:2px 7px;font-size:11px">✏</button> <button class="btn-danger remove-draft-item" data-id="${row.id}" style="padding:2px 7px;font-size:11px">✖</button></td></tr>`;
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
        setTimeout(() => { document.getElementById('entry-item-scc').value = row.sub_cost_center_id || ''; }, 50);
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
    reqMsg.textContent = '';
    const itemData = { catalog_item_id: catalogId ? Number(catalogId) : null, manual_item_name: manualName || null, supplier_id: supplierId ? Number(supplierId) : null, quantity: qty, unit, unit_cost: unitCost, currency: entryCur, web_link: webLink || null, comments: itemComments || null, cost_center_id: itemCcId || Number(costCenter.value||0)||null, sub_cost_center_id: itemSccId || Number(subCostCenter.value||0)||null };
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
  const data = await api('/api/requisitions');

  const renderTrackingTable = () => {
    const folio = (document.getElementById('fFolio')?.value || '').toLowerCase();
    const status = document.getElementById('fStatus')?.value || '';
    const dateFrom = document.getElementById('fIni')?.value || '';
    const dateTo = document.getElementById('fFin')?.value || '';
    const filtered = data.filter(r =>
      (!folio || String(r.folio||'').toLowerCase().includes(folio)) &&
      (!status || r.status === status) &&
      (!dateFrom || String(r.request_date||'').slice(0,10) >= dateFrom) &&
      (!dateTo || String(r.request_date||'').slice(0,10) <= dateTo)
    );
    const wrap = document.getElementById('trackTableWrap');
    if (wrap) wrap.innerHTML = `<table><thead><tr><th>Folio</th><th>Fecha</th><th>Solicitante</th><th>PO</th><th>Estatus</th><th>Total</th><th></th></tr></thead><tbody>${filtered.map(r => `<tr><td><b>${r.folio}</b></td><td style="font-size:12px">${String(r.request_date||'').slice(0,10)}</td><td style="font-size:12px">${r.requester||'-'}</td><td style="font-size:12px">${r.po_folio||'-'}</td><td>${statusPill(r.status)}</td><td style="font-size:12px">${Number(r.total_amount||0).toFixed(2)} ${r.currency||''}</td><td><a href="#/seguimiento/${r.id}">Abrir</a></td></tr>`).join('')}</tbody></table>`;
  };

  app.innerHTML = shell(`
    <div class="card section">
      <div class="module-title"><h3>Seguimiento de requisiciones</h3><button class="btn-secondary" id="expReqItemsBtn">Exportar</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end">
        <div><label class="small muted">Folio</label><input id="fFolio" placeholder="Buscar folio..." style="display:block"/></div>
        <div><label class="small muted">Estatus</label><select id="fStatus" style="display:block"><option value="">Todos</option><option>Borrador</option><option>Enviada</option><option>En cotización</option><option>En autorización</option><option>En proceso</option><option>Completada</option><option>Rechazada</option></select></div>
        <div><label class="small muted">Desde</label><input id="fIni" type="date" style="display:block"/></div>
        <div><label class="small muted">Hasta</label><input id="fFin" type="date" style="display:block"/></div>
        <button class="btn-secondary" id="clearFiltersBtn" style="align-self:flex-end">Limpiar</button>
      </div>
      <div class="table-wrap" id="trackTableWrap"></div>
    </div>
  `, 'seguimiento');

  renderTrackingTable();
  document.getElementById('fFolio').oninput = renderTrackingTable;
  document.getElementById('fStatus').onchange = renderTrackingTable;
  document.getElementById('fIni').onchange = renderTrackingTable;
  document.getElementById('fFin').onchange = renderTrackingTable;
  document.getElementById('clearFiltersBtn').onclick = () => {
    document.getElementById('fFolio').value = '';
    document.getElementById('fStatus').value = '';
    document.getElementById('fIni').value = '';
    document.getElementById('fFin').value = '';
    renderTrackingTable();
  };
  expReqItemsBtn.onclick = () => downloadCsv('seguimiento', 'seguimiento.csv', {
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
    <div class="card section" style="margin-top:12px">
      <h3>Ítems de la requisición</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Ítem</th><th>Proveedor</th><th>PO</th><th>Cant.</th><th>Costo unit.</th><th>Total</th><th>Estatus</th></tr></thead>
        <tbody>${d.items.map(i => {
          const total = Number(i.quantity||0) * Number(i.unit_cost||0);
          return `<tr>
            <td>${i.line_no}</td>
            <td><b>${i.catalog_name || i.manual_item_name}</b></td>
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
  bindCommon();
}

async function approvalsView() {
  const rows = await api('/api/approvals/pending');

  const fmtMXN = v => Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });

  app.innerHTML = shell(`
    <div class="card section">
      <div class="module-title">
        <h3>Autorizaciones pendientes <span style="background:#f59e0b;color:white;border-radius:10px;padding:2px 8px;font-size:12px;margin-left:6px">${rows.length}</span></h3>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" id="approveAllBtn" style="font-size:12px;padding:5px 12px" ${!rows.length?'disabled':''}>✅ Autorizar seleccionados</button>
          <button class="btn-danger" id="rejectAllBtn" style="font-size:12px;padding:5px 12px" ${!rows.length?'disabled':''}>✖ Rechazar seleccionados</button>
          <button class="btn-secondary" id="expReqItemsBtn">Exportar</button>
        </div>
      </div>
      ${rows.length ? `
      <div class="table-wrap">
        <table id="approveTable">
          <thead><tr>
            <th style="width:32px"><input type="checkbox" id="selectAllApprove" title="Seleccionar todos"/></th>
            <th>Req.</th><th>Solicitante</th><th>Ítem</th><th>Proveedor</th><th>C. Costo</th>
            <th style="text-align:right">Total req.</th><th>Regla</th><th>Acciones</th>
          </tr></thead>
          <tbody>
          ${rows.map(r => `
            <tr data-rowid="${r.id}">
              <td><input type="checkbox" class="approve-check" value="${r.id}"/></td>
              <td style="font-size:12px"><b>${r.requisition_folio}</b></td>
              <td style="font-size:12px">${escapeHtml(r.requester_name || '-')}</td>
              <td>
                <b>${escapeHtml(r.item_name)}</b>
                ${r.quote_pdf ? `<br><a href="${r.quote_pdf}" target="_blank" style="font-size:11px;color:#2563eb">📄 Ver cotización PDF</a>` : ''}
              </td>
              <td style="font-size:12px">${escapeHtml(r.supplier_name)}</td>
              <td style="font-size:11px;color:#6b7280">${escapeHtml(r.cost_center_name)}${r.sub_cost_center_name ? `<br>${escapeHtml(r.sub_cost_center_name)}` : ''}</td>
              <td style="font-size:12px;text-align:right">$${fmtMXN(r.requisition_total)}</td>
              <td style="font-size:12px">${r.approval_rule || '-'}</td>
              <td style="white-space:nowrap;min-width:260px">
                <button class="btn-secondary detail-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px" title="Ver historial y gastos">🔍 Detalles</button>
                <button class="btn-primary approve-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px">✅</button>
                <button class="btn-danger reject-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px">✖</button>
                <button class="btn-secondary pause-btn" data-id="${r.id}" style="font-size:12px;padding:3px 8px" title="Pausar / programar">⏸</button>
              </td>
            </tr>
            <tr class="detail-row" id="detail-row-${r.id}" style="display:none">
              <td colspan="9" style="padding:0;background:#f8fafc;border-top:none">
                <div id="detail-content-${r.id}" style="padding:16px">
                  <div class="muted small">Cargando detalles...</div>
                </div>
              </td>
            </tr>
            <tr class="action-row" id="action-row-${r.id}" style="display:none">
              <td colspan="9" style="padding:8px 16px;background:#fffbeb;border-top:1px solid #fde68a">
                <div id="action-content-${r.id}"></div>
              </td>
            </tr>
          `).join('')}
          </tbody>
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
    try {
      btn.disabled = true;
      await api(`/api/approvals/items/${btn.dataset.id}/approve`, { method: 'POST', body: JSON.stringify({ comment: 'Autorizado' }) });
      render();
    } catch(e) { alert(e.message); btn.disabled = false; }
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
        render();
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

  // ── Seleccionar todos ─────────────────────────────────────────────────────
  document.getElementById('selectAllApprove')?.addEventListener('change', e => {
    document.querySelectorAll('.approve-check').forEach(c => c.checked = e.target.checked);
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
    setTimeout(render, 900);
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
    setTimeout(render, 900);
  });

  expReqItemsBtn.onclick = () => downloadCsv('requisition_items', 'items_autorizacion.csv');
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

  const [allItems, pos, suppliers] = await Promise.all([
    loadItems(),
    api('/api/purchases/purchase-orders'),
    api('/api/catalogs/suppliers')
  ]);

  // Clasificar ítems por sección (cancelados excluidos salvo toggle)
  const itemsPendientePO = allItems.filter(x => x.supplier_id && x.unit_cost && !x.purchase_order_id && !['Cancelado','Rechazado','Cerrado','En cotización'].includes(x.status));
  const itemsEnCotizacion = allItems.filter(x => x.status === 'En cotización' && x.item_name && x.item_name.trim() && !x.purchase_order_id);
  const itemsSolicitados = allItems.filter(x => showCancelled ? true : !['Cancelado','Rechazado','Cerrado'].includes(x.status));

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
        </button>
        <button class="tab-btn" data-tab="pos" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:#6b7280">
          🧾 POs generadas <span style="background:#10b981;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${pos.length}</span>
        </button>
        <button class="tab-btn" data-tab="requisiciones" style="padding:8px 16px;border:none;background:none;cursor:pointer;color:#6b7280">
          📄 Requisiciones
        </button>
      </div>

      <div id="tabContent"></div>
      <div class="actions" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px" id="poActions">
        <button class="btn-secondary" id="previewPoBtn">👁 Vista previa PO</button>
        <button class="btn-primary" id="genPoBtn">⚡ Generar PO</button>
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

  const doGeneratePO = async (itemIds) => {
    const ids = itemIds.map(Number).filter(Boolean);
    if (!ids.length) throw new Error('Selecciona al menos un ítem');
    return await api('/api/purchases/generate-po', { method: 'POST', body: JSON.stringify({ item_ids: ids, currency: poCurrency.value }) });
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
    return `<tr style="${rowBg}" data-id="${i.id}">
      <td>${canSelect && !['Cancelado','En proceso','Cerrado','En autorización'].includes(i.status) && i.supplier_id && i.unit_cost ? `<input type="checkbox" class="po-check" value="${i.id}"/>` : ''}</td>
      <td style="font-size:11px">${i.requisition_folio||'-'}</td>
      <td><b>${i.item_name}</b>${i.cancel_reason ? `<br><small style="color:#dc2626">Cancelado: ${i.cancel_reason}${i.cancelled_by_name ? ` · por ${i.cancelled_by_name}` : ''}</small>` : ''}</td>
      <td>
        <select class="edit-supplier" data-id="${i.id}" style="max-width:150px" ${['Cancelado','En proceso','Cerrado'].includes(i.status)||i.winning_quote_id?'disabled':''}>
          <option value="">Sin proveedor</option>
          ${suppliers.map(s => `<option value="${s.id}" ${Number(i.supplier_id)===s.id?'selected':''}>${s.business_name}</option>`).join('')}
        </select>
        ${i.winning_quote_id ? `<br><small style="color:#6b7280;font-size:10px" title="Asignado por cotización ganadora">🔒 cotización</small>` : ''}
      </td>
      <td>${Number(i.quantity||0)}</td>
      <td>${i.unit||'-'}</td>
      <td><input type="number" class="edit-cost" data-id="${i.id}" value="${Number(i.unit_cost||0)}" style="width:75px" ${['Cancelado','En proceso','Cerrado'].includes(i.status)||i.winning_quote_id?'disabled':''}/></td>
      <td><b>$${Number(total).toFixed(2)}</b></td>
      <td><select class="edit-currency" data-id="${i.id}" style="width:65px" ${['Cancelado','En proceso','Cerrado'].includes(i.status)||i.winning_quote_id?'disabled':''}><option ${String(i.currency||'MXN')==='MXN'?'selected':''}>MXN</option><option ${String(i.currency||'MXN')==='USD'?'selected':''}>USD</option></select></td>
      <td>${statusPill(i.status)}</td>
      <td style="font-size:11px">${i.po_folio||'-'}</td>
      <td style="white-space:nowrap">
        ${!['Cancelado','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-secondary save-edit" data-id="${i.id}" style="padding:2px 7px;font-size:11px">💾</button>` : ''}
        ${!i.catalog_item_id && !['Cancelado','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-secondary register-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">📋</button>` : ''}
        ${!['Cancelado','En cotización','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-secondary quote-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">📩</button>` : ''}
        ${i.status === 'Autorizado' && i.supplier_id && i.unit_cost && !i.purchase_order_id ? `<button class="btn-primary single-po" data-id="${i.id}" style="padding:2px 7px;font-size:11px">PO</button>` : ''}
        ${!['Cancelado','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-danger cancel-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">✖</button>` : ''}
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
      try {
        await api(`/api/purchases/items/${id}`, { method: 'PATCH', body: JSON.stringify({ supplier_id, unit_cost, currency }) });
        btn.textContent = '✅'; setTimeout(() => { btn.textContent = '💾'; }, 1500);
        const local = allItems.find(x => Number(x.id) === Number(id));
        if (local) { local.supplier_id = supplier_id ? Number(supplier_id) : null; local.unit_cost = unit_cost; local.currency = currency; }
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
    // Select all
    const selAll = tableEl.querySelector('#selectAllCheck');
    if (selAll) selAll.onchange = () => tableEl.querySelectorAll('.po-check').forEach(c => c.checked = selAll.checked);
    const selAuth = tableEl.querySelector('#selectAllAuth');
    if (selAuth) selAuth.onclick = () => tableEl.querySelectorAll('.po-check').forEach(c => c.checked = true);
  };

  const THEAD = `<thead><tr>
    <th style="width:32px"><input type="checkbox" id="selectAllCheck"/></th>
    <th>Req.</th><th>Ítem</th><th>Proveedor</th>
    <th>Cant.</th><th>Unidad</th><th>Costo U.</th><th>Total</th><th>Mon.</th>
    <th>Estatus</th><th>PO</th><th>Acciones</th>
  </tr></thead>`;

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
          ${waitingAuthCount > 0 ? `<span style="margin-left:8px;color:#f59e0b">⏳ ${waitingAuthCount} esperando autorización</span>` : ''}
          ${authCount > 0 ? `<button class="btn-secondary" id="selectAllAuth" style="margin-left:10px;padding:2px 8px;font-size:12px">Seleccionar autorizados</button>` : ''}
        </div>
        <div id="pendientesTableWrap"><div class="table-wrap"><table>${THEAD}<tbody>
          ${itemsPendientePO.length ? itemsPendientePO.map(i => itemRow(i, true)).join('') : '<tr><td colspan="12" class="muted" style="text-align:center;padding:16px">Sin ítems listos para PO.<br><small>Los ítems deben tener proveedor y costo asignados.</small></td></tr>'}
        </tbody></table></div></div>`;
      bindTableActions(tabContent, itemsPendientePO);
      document.getElementById('filterItemsTab').oninput = e => {
        const val = e.target.value.toLowerCase();
        const filtered = itemsPendientePO.filter(x => !val || (x.item_name||'').toLowerCase().includes(val) || (x.supplier_name||'').toLowerCase().includes(val));
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

      const renderCotizTab = async () => {
        const rows = itemsEnCotizacion;
        tabContent.innerHTML = rows.length ? `
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
                    <button class="btn-secondary view-quotes-btn" data-id="${i.id}" style="padding:2px 8px;font-size:12px">🔍 Ver cotizaciones</button>
                    <button class="btn-danger cancel-item" data-id="${i.id}" style="padding:2px 8px;font-size:12px">✖</button>
                  </td>
                </tr>
                <tr id="cotiz-detail-${i.id}" style="display:none"><td colspan="6" style="padding:0;background:#f8fafc;border-top:1px solid #e5e7eb"></td></tr>`;
              }).join('')}
            </tbody>
          </table></div>` :
          '<div class="muted small" style="padding:24px;text-align:center">Sin ítems en cotización ✅</div>';

        tabContent.querySelectorAll('.re-quote-item').forEach(btn => {
          btn.onclick = () => openQuotationRequest(itemsEnCotizacion.find(x => Number(x.id) === Number(btn.dataset.id)));
        });
        tabContent.querySelectorAll('.cancel-item').forEach(btn => {
          btn.onclick = () => openCancelItem(itemsEnCotizacion.find(x => Number(x.id) === Number(btn.dataset.id)));
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
      tabContent.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
          <select id="filterSupplierItems"><option value="">Todos los proveedores</option>${suppliers.map(s=>`<option value="${s.id}">${s.business_name}</option>`).join('')}</select>
          <select id="filterStatusItems"><option value="">Todos los estatus</option><option>En cotización</option><option>En autorización</option><option>Autorizado</option><option>En proceso</option><option>Entregado</option><option>Facturado</option></select>
          <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="toggleCancelled" ${showCancelled?'checked':''}/>
            Mostrar cancelados
          </label>
        </div>
        <div id="allItemsTable">
          <div class="table-wrap"><table>${THEAD}<tbody>
            ${itemsSolicitados.map(i => itemRow(i, true)).join('')}
          </tbody></table></div>
        </div>`;
      bindTableActions(tabContent, itemsSolicitados);

      const applyFilters = () => {
        const sid = Number(document.getElementById('filterSupplierItems')?.value || 0);
        const statusVal = document.getElementById('filterStatusItems')?.value || '';
        const inclCanc = document.getElementById('toggleCancelled')?.checked;
        const src = inclCanc ? allItems : itemsSolicitados;
        const filtered = src.filter(x => (!sid || Number(x.supplier_id) === sid) && (!statusVal || x.status === statusVal));
        allItemsTable.innerHTML = `<div class="table-wrap"><table>${THEAD}<tbody>${filtered.map(i => itemRow(i, true)).join('')}</tbody></table></div>`;
        bindTableActions(allItemsTable, src);
      };
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

      const visiblePos = pos.filter(p => p.status !== 'Cancelada'); tabContent.innerHTML = visiblePos.length ? visiblePos.map(p => {
        const nextS = STATUS_NEXT[p.status];
        const btnLabel = STATUS_LABEL_BTN[p.status];
        const canRequestInvoice = p.status === 'Entregado' && !p.invoice_requested;
        const invoiceRequested = p.invoice_requested;
        const canManualInvoice = p.status === 'Entregado';
        const canCancel = !['Facturada','Facturación parcial','Cerrada','Cancelada','Rechazada por proveedor'].includes(p.status);
        const respTag = p.supplier_response ? `<span style="font-size:11px;color:#6b7280"> · Proveedor: ${p.supplier_response}</span>` : '';
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
              ${respTag}${reqTag}${advanceTag}
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
          </div>
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
              const btnLabel2 = STATUS_LABEL_BTN[updatedPO.status];
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
            const res = await fetch('/api/invoices', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
            if (!res.ok) throw new Error((await res.json()).error || 'Error');
            msgEl.textContent = '✅ Factura guardada'; msgEl.style.color = '#16a34a';
            setTimeout(render, 900);
          } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
        };
      });

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
    }
  };

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = () => renderTab(btn.dataset.tab));

  // Vista previa PO
  previewPoBtn.onclick = async () => {
    const ids = [...document.querySelectorAll('.po-check:checked')].map(c => Number(c.value));
    if (!ids.length) { poMsg.textContent = 'Selecciona al menos un ítem'; return; }
    lastPreviewIds = ids;
    try {
      const preview = await api('/api/purchases/preview-po', { method:'POST', body: JSON.stringify({ item_ids: ids }) });
      const allOk = preview.groups.every(g => g.can_generate);
      poPreviewContent.innerHTML = `
        <p class="small muted" style="margin-bottom:10px">Se generarán <b>${preview.total_pos}</b> PO(s) para <b>${preview.total_items}</b> ítem(s):</p>
        ${preview.groups.map(g => `
          <div style="border:1px solid ${g.can_generate?'#22c55e':'#f87171'};border-radius:8px;padding:12px;margin-bottom:10px;background:${g.can_generate?'#f0fff4':'#fff5f5'}">
            <div style="display:flex;justify-content:space-between">
              <b>${g.supplier_name}</b>
              <span>${g.item_count} ítem(s) · <b>$${Number(g.total).toFixed(2)} ${g.currency}</b></span>
            </div>
            ${g.supplier_email ? `<div class="small muted">📧 ${g.supplier_email}</div>` : ''}
            <div style="margin-top:6px;font-size:12px">${g.items.map(i=>`<div>· ${i.name} × ${i.quantity} ${i.unit||''} @ $${Number(i.unit_cost||0).toFixed(2)}</div>`).join('')}</div>
            ${g.warnings.length ? `<div style="color:#dc2626;font-size:12px;margin-top:4px">${g.warnings.map(w=>`⚠ ${w}`).join('<br>')}</div>` : '<div style="color:#16a34a;font-size:12px;margin-top:4px">✅ Listo</div>'}
          </div>`).join('')}`;
      confirmGenPoBtn.disabled = !allOk;
      poPreviewSection.style.display = 'block';
      poPreviewSection.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { poMsg.textContent = e.message; }
  };

  closePreviewBtn.onclick = () => { poPreviewSection.style.display = 'none'; };
  confirmGenPoBtn.onclick = async () => {
    try {
      poConfirmMsg.textContent = 'Generando...';
      const out = await doGeneratePO(lastPreviewIds);
      poConfirmMsg.textContent = out.message;
      setTimeout(render, 1800);
    } catch (e) { poConfirmMsg.textContent = e.message; }
  };

  genPoBtn.onclick = async () => {
    const ids = [...document.querySelectorAll('.po-check:checked')].map(c => Number(c.value));
    if (!ids.length) { poMsg.textContent = 'Selecciona al menos un ítem'; return; }
    try {
      poMsg.textContent = 'Generando POs...';
      const out = await doGeneratePO(ids);
      poMsg.textContent = out.message;
      setTimeout(render, 1800);
    } catch (e) { poMsg.textContent = e.message; }
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
        const res = await fetch('/api/invoices', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
        if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
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
          </div>
          <div class="row-3" style="margin-top:8px">
            <div><label>Proveedor</label><select id="quoteSupplier"><option value="">Proveedor</option>${suppliers.map(s => `<option value="${s.id}">${s.business_name}</option>`).join('')}</select></div>
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
  if (document.getElementById('quoteItem')) {
    quoteItem.onchange = () => {
      const sel = quoteItem.options[quoteItem.selectedIndex];
      const suppId = sel?.dataset?.supplier;
      // Solo auto-rellenar proveedor si el campo está vacío para no sobreescribir selección manual
      if (suppId && !quoteSupplier.value) quoteSupplier.value = suppId;
      // Auto-proponer número de cotización
      const count = quotes.filter(q => q.requisition_item_id === Number(quoteItem.value)).length + 1;
      quoteNumber.value = `COT-${String(quoteItem.value).slice(-4).padStart(4,'0')}-${String(count).padStart(2,'0')}`;
      // Auto-llenar nombre si hay ítem seleccionado
      const item = cotizacionesPendientes.find(i => i.id === Number(quoteItem.value));
      if (item && !quoteName.value) quoteName.value = item.item_name || '';
    };
    // Auto-llenar código proveedor al seleccionar proveedor
    quoteSupplier.onchange = () => {
      const sup = suppliers.find(s => s.id === Number(quoteSupplier.value));
      if (sup && sup.provider_code) quoteCode.value = sup.provider_code;
    };

    saveQuoteBtn.onclick = async () => {
      try {
        if (!quoteItem.value) throw new Error('Selecciona un ítem');
        if (!quoteSupplier.value) throw new Error('Selecciona un proveedor');
        if (!quoteUnitCost.value || Number(quoteUnitCost.value) <= 0) throw new Error('Ingresa costo mayor a cero');
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
          const res = await fetch('/api/quotations', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
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
          <thead><tr><th>Factura</th><th>PO</th><th>Proveedor</th><th>Subtotal</th><th>IVA</th><th>Total</th><th>Estatus</th><th>Archivos</th></tr></thead>
          <tbody>${invs.length ? invs.map(i => `<tr>
            <td><b>${i.invoice_number}</b></td>
            <td style="font-size:12px">${i.po_folio||'-'}</td>
            <td style="font-size:12px">${i.supplier_name||'-'}</td>
            <td style="font-size:12px;text-align:right">$${Number(i.subtotal||0).toFixed(2)}</td>
            <td style="font-size:12px;text-align:right">$${Number(i.taxes||0).toFixed(2)}</td>
            <td style="font-size:12px;text-align:right;font-weight:600">$${Number(i.total||0).toFixed(2)}</td>
            <td>${statusPill(i.status)}</td>
            <td>
              ${i.pdf_path ? `<a href="${i.pdf_path}" target="_blank" style="font-size:12px">📄</a>` : ''}
              ${i.xml_path ? `<a href="${i.xml_path}" target="_blank" style="font-size:12px;margin-left:4px">📋</a>` : ''}
              ${!i.pdf_path && !i.xml_path ? '<span class="muted small">—</span>' : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Sin facturas registradas</td></tr>'}
          </tbody>
        </table></div>
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
      const res = await fetch('/api/invoices', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Error');
      invMsg.textContent = '✅ Factura guardada';
      invMsg.style.color = '#16a34a';
      setTimeout(invoicingView, 1000);
    } catch(e) { invMsg.textContent = e.message; invMsg.style.color = '#dc2626'; }
  };
  expInvBtn.onclick = () => downloadCsv('invoices', 'facturas.csv');
  bindCommon();
}

async function paymentsView() {
  const [pending, payments] = await Promise.all([
    api('/api/payments/pending-invoices'),
    api('/api/payments')
  ]);

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
          : pending.map(inv => {
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
          }).join('')}
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
                <option>Transferencia</option><option>Cheque</option><option>Efectivo</option><option>SPEI</option><option>Otro</option>
              </select>
            </div>
          </div>
          <div class="row-2" style="margin-bottom:8px">
            <div><label>Referencia / No. operación</label><input id="payRef" placeholder="Ej. SPEI-00123456"/></div>
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

  // Guardar pago
  savePayBtn.onclick = async () => {
    if (!selectedInv) { payMsg.textContent = 'Selecciona una factura primero'; payMsg.style.color = '#dc2626'; return; }
    try {
      if (!payAmount.value || Number(payAmount.value) <= 0) throw new Error('Ingresa un monto mayor a cero');
      if (!payRef.value) throw new Error('Ingresa la referencia de pago');
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
      const res = await fetch('/api/payments', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
      const data = await res.json();
      payMsg.textContent = '✅ Pago registrado'; payMsg.style.color = '#16a34a';
      if (data.mailto && data.supplier_email) window.open(data.mailto, '_blank');
      setTimeout(render, 1000);
    } catch(e) { payMsg.textContent = e.message; payMsg.style.color = '#dc2626'; savePayBtn.disabled = false; }
  };

  expPayBtn.onclick = () => downloadCsv('payments', 'pagos.csv');
  bindCommon();
}

async function inventoryView() {
  const [invCats, invItems, items] = await Promise.all([
    api('/api/catalogs/inventory-catalogs'),
    api('/api/catalogs/inventory-items'),
    api('/api/catalogs/items')
  ]);

  const stockStatus = (item) => {
    if (item.current_stock <= 0) return { label: 'Sin stock', color: '#dc2626', bg: '#fef2f2' };
    if (item.current_stock <= item.min_stock) return { label: 'Crítico', color: '#dc2626', bg: '#fef2f2' };
    if (item.current_stock <= item.min_stock * 1.3) return { label: 'Bajo', color: '#d97706', bg: '#fffbeb' };
    if (item.max_stock > 0 && item.current_stock > item.max_stock * 1.3) return { label: 'Exceso', color: '#7c3aed', bg: '#f5f3ff' };
    return { label: 'OK', color: '#16a34a', bg: '#f0fff4' };
  };

  const belowMin = invItems.filter(x => x.current_stock <= x.min_stock);

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
      <div class="module-title">
        <h3>Inventario completo</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="filterInvCat"><option value="">Todos los inventarios</option>${invCats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
          <button class="btn-secondary" id="printInvBtn">🖨 Imprimir formato</button>
          <button class="btn-secondary" id="expInvBtn">Exportar CSV</button>
        </div>
      </div>
      <div id="invTableWrap"></div>
    </div>

    <div class="card section" style="margin-top:16px">
      <h3>Agregar ítem al inventario</h3>
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
      <button class="btn-primary" id="saveInvItemBtn">Agregar al inventario</button>
      <div id="invItemMsg" class="small muted" style="margin-top:6px"></div>
    </div>
  `, 'inventarios');

  const renderInvTable = (filterCatId = '') => {
    const filtered = filterCatId
      ? invItems.filter(x => Number(x.inventory_catalog_id) === Number(filterCatId))
      : invItems;

    invTableWrap.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Inventario</th><th>Código</th><th>Ítem</th><th>Unidad</th><th>Stock actual</th><th>Mínimo</th><th>Máximo</th><th>Estado</th><th>Guardar</th></tr></thead>
      <tbody>${filtered.length ? filtered.map(x => {
        const st = stockStatus(x);
        const catItem = items.find(i => i.id === x.catalog_item_id);
        return `<tr style="background:${st.bg}">
          <td style="font-size:12px">${x.inventory_name}</td>
          <td style="font-size:11px">${catItem?.code || '-'}</td>
          <td><b>${x.item_name}</b></td>
          <td>${x.unit||'pza'}</td>
          <td><input type="number" class="stock-input" data-id="${x.id}" value="${x.current_stock}" style="width:70px;border:1px solid ${x.current_stock <= x.min_stock ? '#fca5a5':'#e5e7eb'};border-radius:4px;padding:3px 6px"/></td>
          <td>${x.min_stock}</td>
          <td>${x.max_stock}</td>
          <td><span style="background:${st.color};color:white;border-radius:10px;padding:2px 8px;font-size:11px">${st.label}</span></td>
          <td><button class="btn-secondary update-stock-btn" data-id="${x.id}" style="padding:2px 8px;font-size:12px">💾</button></td>
        </tr>`;
      }).join('') : '<tr><td colspan="9" class="muted" style="text-align:center;padding:16px">Sin ítems en este inventario</td></tr>'}
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
        setTimeout(() => { btn.textContent = '💾'; }, 1500);
      } catch (e) { alert(e.message); }
    });
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
        unit: iUnit.value || 'pza'
      })});
      invItemMsg.textContent = '✅ Ítem agregado al inventario';
      invItemMsg.style.color = '#16a34a';
      setTimeout(render, 800);
    } catch (e) { invItemMsg.textContent = e.message; invItemMsg.style.color = '#dc2626'; }
  };

  bindCommon();
}

async function adminView() {
  const [users, rules, suppliers, cc] = await Promise.all([
    api('/api/admin/users'),
    api('/api/catalogs/approval-rules'),
    api('/api/catalogs/suppliers'),
    api('/api/catalogs/cost-centers')
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
          <div><label style="font-size:11px" class="muted">Define el centro que se pre-selecciona al crear requisiciones</label></div>
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
      <h3>Proveedores registrados</h3>
      <div class="table-wrap"><table><thead><tr><th>Código</th><th>Proveedor</th><th>Contacto</th><th>Correo</th><th>Usuario asignado</th></tr></thead>
      <tbody>${suppliers.map(s => {
        const supUser = users.find(u => u.supplier_id === s.id && u.role_code === 'proveedor');
        return `<tr>
          <td>${s.provider_code||'-'}</td><td><b>${s.business_name}</b></td>
          <td>${s.contact_name||'-'}</td><td>${s.email||'-'}</td>
          <td>${supUser ? `✅ ${supUser.email}` : '<span style="color:#dc2626">⚠ Sin usuario</span>'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
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
      saveUsrBtn.textContent = 'Guardar usuario';
      return;
    }
    usrName.value = u.full_name;
    usrEmail.value = u.email;
    usrDept.value = u.department || '';
    usrRole.value = u.role_code;
    usrSupplier.value = u.supplier_id || '';
    usrCostCenter.value = u.default_cost_center_id || '';
    usrPass.value = '';
    saveUsrBtn.textContent = 'Actualizar usuario';
  };
  clearUsrBtn.onclick = () => { usrEditId.value = ''; usrEditId.dispatchEvent(new Event('change')); };
  saveUsrBtn.onclick = async () => {
    try {
      if (!usrName.value || !usrEmail.value) throw new Error('Nombre y correo requeridos');
      const editId = usrEditId.value ? Number(usrEditId.value) : null;
      const payload = { full_name: usrName.value, email: usrEmail.value, department: usrDept.value, role_code: usrRole.value, supplier_id: usrSupplier.value || null, default_cost_center_id: usrCostCenter.value ? Number(usrCostCenter.value) : null };
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

  bindCommon();
}

async function render() {
  const route = (location.hash || '').replace('#/', '');
  const requestedModule = route.split('/')[0];
  if (!state.token || !state.user) return loginView();
  const defaultRoute = getDefaultRouteByRole();
  if (!route || route === 'login') { location.hash = `#/${defaultRoute}`; return; }
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
  if (route === 'admin') return adminView();
  location.hash = `#/${defaultRoute}`;
}

window.addEventListener('hashchange', render);
if (state.token) initInactivityWatcher();
render();
