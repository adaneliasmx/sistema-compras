const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  itemsDraft: [{ id: crypto.randomUUID(), quantity: 1, unit: 'pza', unit_cost: 0 }]
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
  pagos: ['dashboard', 'pagos', 'seguimiento', 'facturacion'],
  admin: ['dashboard', 'requisiciones', 'seguimiento', 'autorizaciones', 'compras', 'catalogos', 'cotizaciones', 'facturacion', 'pagos', 'inventarios', 'admin']
};

const app = document.getElementById('app');

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
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
    'Borrador': 'gray', 'Enviada': 'gray', 'En cotización': 'orange', 'En autorización': 'gray', 'Autorizado': '', 'En proceso': 'orange', 'Entregado': 'orange', 'Facturado': 'orange', 'Pago parcial': 'orange', 'Pagada': '', 'Completada': '', 'Cerrado': '', 'Rechazada': 'red', 'Rechazado': 'red'
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
        <div class="table-wrap"><table><thead><tr><th>Código</th><th>Proveedor</th><th>Contacto</th><th>Correo</th></tr></thead>
        <tbody>${suppliers.map(s => `<tr><td>${s.provider_code}</td><td>${s.business_name}</td><td>${s.contact_name||'-'}</td><td>${s.email||'-'}</td></tr>`).join('')}</tbody>
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
      <div class="card section"><h3>Centros / subcentros</h3><div class="table-wrap"><table><thead><tr><th>Centro</th><th>Subcentro</th></tr></thead><tbody>${cc.map(c => `<tr><td>${c.code} · ${c.name}</td><td>${scc.filter(x => x.cost_center_id === c.id).map(x => `${x.code} · ${x.name}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div><h4>Editar centro</h4><div class="row-3"><select id="ccEditId"><option value="">Nuevo</option>${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select><input id="ccCode" placeholder="Código"/><input id="ccName" placeholder="Nombre"/></div><div class="row-3"><button class="btn-primary" id="saveCcBtn">Guardar centro</button><select id="sccEditId"><option value="">Nuevo subcentro</option>${scc.map(x => `<option value="${x.id}">${x.code} · ${x.name}</option>`).join('')}</select><select id="sccParent"><option value="">Centro</option>${cc.map(c => `<option value="${c.id}">${c.code}</option>`).join('')}</select></div><div class="row-3"><input id="sccCode" placeholder="Código subcentro"/><input id="sccName" placeholder="Nombre subcentro"/><button class="btn-primary" id="saveSccBtn">Guardar subcentro</button></div><div id="ccMsg" class="small muted"></div></div>
      <div class="card section"><h3>Reglas de autorización</h3>${rules.map(r => `<div class="list-line">${r.name}: ${Number(r.min_amount).toFixed(2)} a ${Number(r.max_amount).toFixed(2)} · ${r.auto_approve ? 'Automática' : `Rol ${r.approver_role}`}</div>`).join('')}<h4>Editar regla</h4><div class="row-3"><select id="ruleEditId"><option value="">Nueva</option>${rules.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select><input id="ruleName" placeholder="Nombre"/><input id="ruleMin" type="number" placeholder="Monto min"/></div><div class="row-3"><input id="ruleMax" type="number" placeholder="Monto max"/><select id="ruleRole"><option value="">Sin rol</option><option value="comprador">comprador</option><option value="pagos">pagos</option><option value="admin">admin</option></select><label><input id="ruleAuto" type="checkbox"/> Automática</label></div><button class="btn-primary" id="saveRuleBtn">Guardar regla</button><div id="ruleMsg" class="small muted"></div></div>
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
  ccEditId.onchange = () => { const x = cc.find(v => v.id === Number(ccEditId.value)); if (!x) return; ccCode.value = x.code; ccName.value = x.name; };
  sccEditId.onchange = () => { const x = scc.find(v => v.id === Number(sccEditId.value)); if (!x) return; sccCode.value = x.code; sccName.value = x.name; sccParent.value = x.cost_center_id; };
  ruleEditId.onchange = () => { const x = rules.find(v => v.id === Number(ruleEditId.value)); if (!x) return; ruleName.value = x.name; ruleMin.value=x.min_amount; ruleMax.value=x.max_amount; ruleRole.value = x.approver_role || ''; ruleAuto.checked = !!x.auto_approve; };
  saveCcBtn.onclick = async () => { try { const payload = { code: ccCode.value, name: ccName.value }; if (ccEditId.value) await api(`/api/catalogs/cost-centers/${ccEditId.value}`, { method: 'PATCH', body: JSON.stringify(payload) }); else await api('/api/catalogs/cost-centers', { method:'POST', body: JSON.stringify(payload)}); render(); } catch (e) { ccMsg.textContent = e.message; } };
  saveSccBtn.onclick = async () => { try { const payload = { cost_center_id: Number(sccParent.value), code: sccCode.value, name: sccName.value }; if (sccEditId.value) await api(`/api/catalogs/sub-cost-centers/${sccEditId.value}`, { method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/catalogs/sub-cost-centers', { method:'POST', body: JSON.stringify(payload)}); render(); } catch (e) { ccMsg.textContent = e.message; } };
  saveRuleBtn.onclick = async () => { try { const payload = { name: ruleName.value, min_amount: Number(ruleMin.value||0), max_amount: Number(ruleMax.value||0), approver_role: ruleRole.value || null, auto_approve: ruleAuto.checked }; if (ruleEditId.value) await api(`/api/catalogs/approval-rules/${ruleEditId.value}`, { method:'PATCH', body: JSON.stringify(payload)}); else await api('/api/catalogs/approval-rules', { method:'POST', body: JSON.stringify(payload)}); render(); } catch (e) { ruleMsg.textContent = e.message; } };
  bindCommon();
}
async function requisitionsView(editId = null) {
  const [items, suppliers, cc, scc, list, units] = await Promise.all([api('/api/catalogs/items'), api('/api/catalogs/suppliers'), api('/api/catalogs/cost-centers'), api('/api/catalogs/sub-cost-centers'), api('/api/requisitions'), api('/api/catalogs/units')]);
  let editing = null;
  if (editId) editing = await api(`/api/requisitions/${editId}`);
  if (!editing && !state.itemsDraft.length) state.itemsDraft = [{ id: crypto.randomUUID(), quantity: 1, unit: units[0] || 'pza', unit_cost: 0, currency: 'MXN' }];
  if (editing) state.itemsDraft = editing.items.map(x => ({ ...x, id: crypto.randomUUID() }));
  const renderList = rows => rows.map(r => `<tr><td>${r.folio}</td><td>${statusPill(r.status)}</td><td>${Number(r.total_amount || 0).toFixed(2)} ${r.currency || ''}</td><td><a href="#/requisiciones/${r.id}">Validar</a></td></tr>`).join('');
  app.innerHTML = shell(`
    <div class="grid grid-2">
      <div class="card section"><h3>${editing ? 'Editar requisición' : 'Nueva requisición'}</h3><div class="row-3"><div><label>Urgencia</label><select id="urgency"><option ${editing?.requisition.urgency==='Alto'?'selected':''}>Alto</option><option ${editing?.requisition.urgency==='Medio'?'selected':''}>Medio</option><option ${editing?.requisition.urgency==='Bajo'?'selected':''}>Bajo</option><option ${editing?.requisition.urgency==='Entrega programada'?'selected':''}>Entrega programada</option></select><div id="urgencyRange" class="small muted"></div></div><div><label>Centro de costo</label><select id="costCenter"><option value="">Selecciona</option>${cc.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></div><div><label>Subcentro</label><select id="subCostCenter"></select></div></div><div class="row-3"><div><label>Moneda</label><input id="currency" value="${editing?.requisition.currency || 'MXN'}" readonly/></div><div><label>Fecha programada</label><input id="programmedDate" type="date" value="${editing?.requisition.programmed_date || ''}"/></div><div><label>Comentarios</label><input id="comments" placeholder="Observaciones" value="${editing?.requisition.comments || ''}"/></div></div><div id="itemsDraft"></div><div class="actions"><button class="btn-secondary" id="addItemBtn">Agregar ítem</button><button class="btn-secondary" id="previewReqBtn">Vista PDF</button><button class="btn-secondary" id="saveDraftBtn">Guardar borrador</button><button class="btn-primary" id="sendReqBtn">Guardar y enviar</button></div><div id="reqMsg" class="error"></div></div>
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
  const renderDraft = () => {
    itemsDraft.innerHTML = state.itemsDraft.map(row => `<div class="item-box"><div class="row-3"><div><label>Ítem catálogo</label><select data-k="catalog_item_id" data-id="${row.id}"><option value="">Manual / no catalogado</option>${items.map(i => `<option value="${i.id}" ${Number(row.catalog_item_id)===i.id?'selected':''}>${i.code} · ${i.name}</option>`).join('')}</select></div><div><label>Nombre manual</label><input data-k="manual_item_name" data-id="${row.id}" value="${row.manual_item_name || ''}"/></div><div><label>Proveedor</label><select data-k="supplier_id" data-id="${row.id}"><option value="">Sin proveedor</option>${suppliers.map(s => `<option value="${s.id}" ${Number(row.supplier_id)===s.id?'selected':''}>${s.business_name}</option>`).join('')}</select></div></div><div class="row-4"><div><label>Cantidad</label><input data-k="quantity" data-id="${row.id}" type="number" value="${row.quantity || 1}"/></div><div><label>Unidad</label><select data-k="unit" data-id="${row.id}">${units.map(u => `<option ${row.unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div><label>Costo</label><input data-k="unit_cost" data-id="${row.id}" type="number" value="${row.unit_cost || 0}"/></div><div><label>Moneda</label><input data-k="currency" data-id="${row.id}" value="${row.currency || currency.value || 'MXN'}" readonly/></div></div><div class="row-2"><input data-k="web_link" data-id="${row.id}" placeholder="Liga web" value="${row.web_link || ''}"/><input data-k="comments" data-id="${row.id}" placeholder="Comentarios" value="${row.comments || ''}"/></div><div class="row-2"><div class="small muted">Centro: ${cc.find(x => x.id === Number(row.cost_center_id || costCenter.value))?.name || '-'} · Subcentro: ${scc.find(x => x.id === Number(row.sub_cost_center_id || subCostCenter.value))?.name || '-'}</div><button class="btn-danger" data-remove="${row.id}">Eliminar</button></div></div>`).join('');
    itemsDraft.querySelectorAll('[data-k]').forEach(el => el.oninput = el.onchange = e => {
      const id = e.target.dataset.id; const row = state.itemsDraft.find(x => x.id === id); const k = e.target.dataset.k;
      row[k] = e.target.type === 'number' ? Number(e.target.value || 0) : e.target.value;
      if (k === 'catalog_item_id') {
        const cat = items.find(i => i.id === Number(row.catalog_item_id));
        if (cat) {
          row.supplier_id = cat.supplier_id || row.supplier_id;
          row.unit = cat.unit || row.unit;
          row.unit_cost = Number(cat.unit_price || 0);
          row.currency = cat.currency || currency.value || 'MXN';
          if (cat.cost_center_id) { costCenter.value = cat.cost_center_id; setSubOptions(cat.cost_center_id, cat.sub_cost_center_id || ''); if (cat.sub_cost_center_id) subCostCenter.value = cat.sub_cost_center_id; }
          renderDraft();
        } else if (!costCenter.value) {
          alert('Este ítem no está en catálogo. Debes seleccionar un centro de costo para continuar.');
          costCenter.focus();
        }
      }
    });
    itemsDraft.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = () => { state.itemsDraft = state.itemsDraft.filter(x => x.id !== btn.dataset.remove); renderDraft(); });
  };
  renderDraft();
  addItemBtn.onclick = () => { state.itemsDraft.push({ id: crypto.randomUUID(), quantity: 1, unit: units[0] || 'pza', unit_cost: 0, currency: currency.value || 'MXN', cost_center_id: Number(costCenter.value||0)||null, sub_cost_center_id: Number(subCostCenter.value||0)||null }); renderDraft(); };
  const validateManuals = () => { const hasManualNoCC = state.itemsDraft.some(x => !x.catalog_item_id && !(Number(costCenter.value||0) || Number(x.cost_center_id||0))); if (hasManualNoCC) { reqMsg.textContent = 'Los ítems manuales requieren centro de costo.'; costCenter.focus(); return false; } return true; };
  const buildPayload = (status) => ({ urgency: urgency.value, cost_center_id: Number(costCenter.value || 0) || null, sub_cost_center_id: Number(subCostCenter.value || 0) || null, currency: currency.value, programmed_date: programmedDate.value || null, comments: comments.value, status, items: state.itemsDraft.map(({ id, ...rest }) => ({ ...rest, cost_center_id: rest.cost_center_id || Number(costCenter.value||0) || null, sub_cost_center_id: rest.sub_cost_center_id || Number(subCostCenter.value||0) || null, currency: rest.currency || currency.value })) });
  previewReqBtn.onclick = () => openPrintPreview('Vista requisición', `<h1>${editing?.requisition.folio || 'Vista previa de requisición'}</h1><div class="small">Solicitante: ${escapeHtml(state.user?.name || '')}<br>Departamento: ${escapeHtml(state.user?.department || '')}<br>Urgencia: ${escapeHtml(urgency.value)}<br>Fecha programada: ${escapeHtml(programmedDate.value || '-')}</div><table><thead><tr><th>Ítem</th><th>Proveedor</th><th>Cantidad</th><th>Unidad</th><th>Costo</th><th>Moneda</th></tr></thead><tbody>${state.itemsDraft.map(x => `<tr><td>${escapeHtml((items.find(i => i.id === Number(x.catalog_item_id)) || {}).name || x.manual_item_name || '')}</td><td>${escapeHtml((suppliers.find(s => s.id === Number(x.supplier_id)) || {}).business_name || '-')}</td><td>${x.quantity}</td><td>${escapeHtml(x.unit || '')}</td><td>${Number(x.unit_cost||0).toFixed(2)}</td><td>${escapeHtml(x.currency || currency.value || 'MXN')}</td></tr>`).join('')}</tbody></table>`);
  saveDraftBtn.onclick = async () => { try { if (!validateManuals()) return; if (editing) await api(`/api/requisitions/${editing.requisition.id}`, { method:'PATCH', body: JSON.stringify(buildPayload('Borrador'))}); else { const out = await api('/api/requisitions', { method:'POST', body: JSON.stringify(buildPayload('Borrador'))}); location.hash = `#/requisiciones/${out.requisition.id}`; return; } render(); } catch (e) { reqMsg.textContent = e.message; } };
  sendReqBtn.onclick = async () => { try { if (!validateManuals()) return; let id = editing?.requisition.id; if (editing) await api(`/api/requisitions/${id}`, { method:'PATCH', body: JSON.stringify(buildPayload('Borrador'))}); else { const out = await api('/api/requisitions', { method:'POST', body: JSON.stringify(buildPayload('Borrador'))}); id = out.requisition.id; }
      const out = await api(`/api/requisitions/${id}/send`, { method:'POST', body: JSON.stringify({}) });
      if (out.mailto_buyer) window.open(out.mailto_buyer, '_blank');
      if (out.mailto_requester) setTimeout(() => window.open(out.mailto_requester, '_blank'), 600);
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
  app.innerHTML = shell(`<div class="card section"><div class="module-title"><h3>Seguimiento de requisiciones</h3><button class="btn-secondary" id="expReqItemsBtn">Exportar base seguimiento</button></div><div class="row-4"><input id="fIni" type="date" placeholder="Fecha inicio"/><input id="fFin" type="date" placeholder="Fecha fin"/><input id="fUser" placeholder="Usuario"/><input id="fProv" placeholder="Proveedor"/></div><div class="table-wrap"><table><thead><tr><th>Folio</th><th>Fecha solicitud</th><th>PO</th><th>Estatus</th><th>Total</th><th></th></tr></thead><tbody>${data.map(r => `<tr><td>${r.folio}</td><td>${String(r.request_date || '').slice(0,10)}</td><td>${r.po_folio || '-'}</td><td>${statusPill(r.status)}</td><td>${Number(r.total_amount || 0).toFixed(2)} ${r.currency || ''}</td><td><a href="#/seguimiento/${r.id}">Abrir</a></td></tr>`).join('')}</tbody></table></div></div>`, 'seguimiento');
  expReqItemsBtn.onclick = () => downloadCsv('seguimiento', 'seguimiento.csv', { fecha_inicio: fIni.value, fecha_fin: fFin.value, usuario: fUser.value, proveedor: fProv.value });
  bindCommon();
}

async function trackingDetailView(id) {
  const d = await api(`/api/requisitions/${id}`);
  const poSet = [...new Set(d.items.map(i => i.po_folio).filter(Boolean))].join(', ') || '-';
  app.innerHTML = shell(`<div class="card section"><div class="module-title"><h3>${d.requisition.folio}</h3><a href="#/seguimiento">Volver</a></div><div class="grid grid-4"><div class="small muted">Fecha solicitud<br><b>${String(d.requisition.request_date || '').slice(0,10)}</b></div><div class="small muted">Urgencia<br><b>${d.requisition.urgency || '-'}</b></div><div class="small muted">PO<br><b>${poSet}</b></div><div class="small muted">Estatus<br>${statusPill(d.requisition.status)}</div></div></div><div class="card section" style="margin-top:16px"><h3>Ítems</h3><div class="table-wrap"><table><thead><tr><th>Línea</th><th>Ítem</th><th>Proveedor</th><th>PO</th><th>Cantidad</th><th>Costo</th><th>Estatus</th></tr></thead><tbody>${d.items.map(i => `<tr><td>${i.line_no}</td><td>${i.catalog_name || i.manual_item_name}</td><td>${i.supplier_name || '-'}</td><td>${i.po_folio || '-'}</td><td>${i.quantity} ${i.unit}</td><td>${Number(i.unit_cost || 0).toFixed(2)}</td><td>${statusPill(i.status)}</td></tr>`).join('')}</tbody></table></div></div><div class="card section" style="margin-top:16px"><h3>Historial</h3>${d.history.map(h => `<div class="list-line">${String(h.changed_at).replace('T', ' ').slice(0,16)} · ${h.module} · ${h.old_status || '-'} → ${h.new_status} · ${h.comment || ''}</div>`).join('')}</div>`, 'seguimiento');
  bindCommon();
}

async function approvalsView() {
  const rows = await api('/api/approvals/pending');
  app.innerHTML = shell(`<div class="card section"><div class="module-title"><h3>Autorizaciones pendientes</h3><button class="btn-secondary" id="expReqItemsBtn">Exportar items</button></div><div class="table-wrap"><table><thead><tr><th>Req</th><th>Solicitante</th><th>Ítem</th><th>Proveedor</th><th>Total req</th><th>Regla</th><th>Acciones</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.requisition_folio}</td><td>${r.requester_name || '-'}</td><td>${r.item_name}</td><td>${r.supplier_name}</td><td>${Number(r.requisition_total || 0).toFixed(2)}</td><td>${r.approval_rule || '-'}</td><td><button class="btn-secondary approve-btn" data-id="${r.id}">Autorizar</button> <button class="btn-danger reject-btn" data-id="${r.id}">Rechazar</button></td></tr>`).join('')}</tbody></table></div></div>`, 'autorizaciones');
  document.querySelectorAll('.approve-btn').forEach(btn => btn.onclick = async () => { await api(`/api/approvals/items/${btn.dataset.id}/approve`, { method: 'POST', body: JSON.stringify({ comment: 'Autorizado desde módulo de autorizaciones' }) }); render(); });
  document.querySelectorAll('.reject-btn').forEach(btn => btn.onclick = async () => { await api(`/api/approvals/items/${btn.dataset.id}/reject`, { method: 'POST', body: JSON.stringify({ comment: 'Rechazado desde módulo de autorizaciones' }) }); render(); });
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
  const itemsEnCotizacion = allItems.filter(x => x.status === 'En cotización');
  const itemsSolicitados = allItems.filter(x => showCancelled ? true : !['Cancelado','Rechazado','Cerrado'].includes(x.status));

  let activeTab = 'pendientes';

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
      <select id="quoteSuppliersMulti" multiple size="7" style="width:100%;margin-bottom:12px">${suppliers.map(s => `<option value="${s.id}" ${Number(row.supplier_id)===s.id?'selected':''}>${s.business_name} ${s.email?'· '+s.email:''}</option>`).join('')}</select>
      <div class="row-2">
        <select id="quoteReqCurrency"><option ${String(row.currency||'MXN')==='MXN'?'selected':''}>MXN</option><option ${String(row.currency||'MXN')==='USD'?'selected':''}>USD</option></select>
        <button class="btn-primary" id="sendQuoteReqBtn">Enviar solicitud</button>
      </div>
      <div class="actions"><button class="btn-secondary" id="quoteCancelBtn">Cancelar</button></div>
      <div id="quoteReqMsg" class="small muted"></div>
    `);
    quoteCancelBtn.onclick = closeActionCard;
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
      <td><b>${i.item_name}</b>${i.cancel_reason ? `<br><small style="color:#dc2626">Cancelado: ${i.cancel_reason}</small>` : ''}</td>
      <td>
        <select class="edit-supplier" data-id="${i.id}" style="max-width:150px" ${['Cancelado','En proceso','Cerrado'].includes(i.status)?'disabled':''}>
          <option value="">Sin proveedor</option>
          ${suppliers.map(s => `<option value="${s.id}" ${Number(i.supplier_id)===s.id?'selected':''}>${s.business_name}</option>`).join('')}
        </select>
      </td>
      <td>${Number(i.quantity||0)}</td>
      <td>${i.unit||'-'}</td>
      <td><input type="number" class="edit-cost" data-id="${i.id}" value="${Number(i.unit_cost||0)}" style="width:75px" ${['Cancelado','En proceso','Cerrado'].includes(i.status)?'disabled':''}/></td>
      <td><b>$${Number(total).toFixed(2)}</b></td>
      <td><select class="edit-currency" data-id="${i.id}" style="width:65px" ${['Cancelado','En proceso','Cerrado'].includes(i.status)?'disabled':''}><option ${String(i.currency||'MXN')==='MXN'?'selected':''}>MXN</option><option ${String(i.currency||'MXN')==='USD'?'selected':''}>USD</option></select></td>
      <td>${statusPill(i.status)}</td>
      <td style="font-size:11px">${i.po_folio||'-'}</td>
      <td style="white-space:nowrap">
        ${!['Cancelado','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-secondary save-edit" data-id="${i.id}" style="padding:2px 7px;font-size:11px">💾</button>` : ''}
        ${!i.catalog_item_id && !['Cancelado','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-secondary register-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">📋</button>` : ''}
        ${!['Cancelado','En cotización','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-secondary quote-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">📩</button>` : ''}
        ${i.status === 'Autorizado' && i.supplier_id && i.unit_cost && !i.purchase_order_id ? `<button class="btn-primary single-po" data-id="${i.id}" style="padding:2px 7px;font-size:11px">PO</button>` : ''}
        ${!['Cancelado','En proceso','Cerrado'].includes(i.status) ? `<button class="btn-danger cancel-item" data-id="${i.id}" style="padding:2px 7px;font-size:11px">✖</button>` : ''}
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

  const renderTab = (tab) => {
    activeTab = tab;
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
        <div style="margin-bottom:8px;font-size:13px">
          ${itemsPendientePO.length} ítem(s) con proveedor y costo · <b>${authCount}</b> autorizado(s)
          ${waitingAuthCount > 0 ? `<span style="margin-left:8px;color:#f59e0b">⏳ ${waitingAuthCount} esperando autorización</span>` : ''}
          ${authCount > 0 ? `<button class="btn-secondary" id="selectAllAuth" style="margin-left:10px;padding:2px 8px;font-size:12px">Seleccionar autorizados</button>` : ''}
        </div>
        <div class="table-wrap"><table>${THEAD}<tbody>
          ${itemsPendientePO.length ? itemsPendientePO.map(i => itemRow(i, true)).join('') : '<tr><td colspan="12" class="muted" style="text-align:center;padding:16px">Sin ítems listos para PO.<br><small>Los ítems deben tener proveedor y costo asignados.</small></td></tr>'}
        </tbody></table></div>`;
      bindTableActions(tabContent, itemsPendientePO);

    } else if (tab === 'cotizacion') {
      poActions.style.display = 'none';
      tabContent.innerHTML = `
        <p class="small muted" style="margin-bottom:8px">Ítems en proceso de cotización. Ve a <a href="#/cotizaciones">Cotizaciones</a> para registrar y elegir ganadoras.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Req.</th><th>Ítem</th><th>Proveedor actual</th><th>Cant.</th><th>Unidad</th><th>Estatus</th><th>Acción</th></tr></thead>
          <tbody>${itemsEnCotizacion.length ? itemsEnCotizacion.map(i => `<tr>
            <td style="font-size:11px">${i.requisition_folio||'-'}</td>
            <td><b>${i.item_name}</b></td>
            <td>${i.supplier_name||'<span style="color:#f59e0b">Sin asignar</span>'}</td>
            <td>${Number(i.quantity||0)}</td>
            <td>${i.unit||'-'}</td>
            <td>${statusPill(i.status)}</td>
            <td><button class="btn-secondary quote-item" data-id="${i.id}" style="padding:2px 8px;font-size:12px">📩 Cotizar</button>
                <button class="btn-danger cancel-item" data-id="${i.id}" style="padding:2px 8px;font-size:12px">✖</button></td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">Sin ítems en cotización</td></tr>'}
          </tbody></table></div>`;
      tabContent.querySelectorAll('.quote-item').forEach(btn => btn.onclick = () => openQuotationRequest(itemsEnCotizacion.find(x => Number(x.id) === Number(btn.dataset.id))));
      tabContent.querySelectorAll('.cancel-item').forEach(btn => btn.onclick = () => openCancelItem(itemsEnCotizacion.find(x => Number(x.id) === Number(btn.dataset.id))));

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

      tabContent.innerHTML = pos.length ? pos.map(p => {
        const nextS = STATUS_NEXT[p.status];
        const btnLabel = STATUS_LABEL_BTN[p.status];
        const canRequestInvoice = p.status === 'Entregado' && !p.invoice_requested;
        const invoiceRequested = p.invoice_requested;
        const canManualInvoice = p.status === 'Entregado';
        const respTag = p.supplier_response ? `<span style="font-size:11px;color:#6b7280"> · Proveedor: ${p.supplier_response}</span>` : '';
        const reqTag = invoiceRequested ? `<span style="font-size:11px;color:#2563eb;margin-left:8px">📧 Factura solicitada al proveedor</span>` : '';
        return `
        <div class="card section" style="margin-bottom:12px" id="po-card-${p.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <div>
              <b style="font-size:15px">${p.folio}</b>
              <span style="margin-left:10px;color:#6b7280">${p.supplier_name}</span>
              ${respTag}${reqTag}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${statusPill(p.status)}
              <b>$${Number(p.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${p.currency||'MXN'}</b>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            ${nextS ? `<button class="btn-primary po-advance-btn" data-id="${p.id}" data-status="${nextS}" style="font-size:12px;padding:5px 12px">${btnLabel}</button>` : ''}
            ${canRequestInvoice ? `<button class="btn-secondary po-req-invoice-btn" data-id="${p.id}" style="font-size:12px;padding:5px 12px">📧 Solicitar factura al proveedor</button>` : ''}
            ${canManualInvoice ? `<button class="btn-secondary po-manual-invoice-btn" data-id="${p.id}" data-supplier="${p.supplier_id}" style="font-size:12px;padding:5px 12px;color:#6b7280">🧾 Registrar manualmente</button>` : ''}
          </div>
          <div id="req-msg-${p.id}" class="small" style="margin-top:6px"></div>
          <div id="invoice-form-${p.id}" style="display:none;margin-top:12px;padding:12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
            <h4 style="margin:0 0 4px">Registrar factura manualmente · ${p.folio}</h4>
            <p class="small muted" style="margin:0 0 10px">Usa esta opción solo si el proveedor no puede registrarla en el sistema.</p>
            <div class="row-3">
              <div><label style="font-size:12px">No. factura *</label><input id="inv-num-${p.id}" placeholder="FACT-001"/></div>
              <div><label style="font-size:12px">Subtotal *</label><input id="inv-sub-${p.id}" type="number" placeholder="0.00"/></div>
              <div><label style="font-size:12px">IVA</label><input id="inv-tax-${p.id}" type="number" placeholder="0.00"/></div>
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
      }).join('') : '<div class="muted small" style="padding:16px;text-align:center">Sin órdenes de compra generadas aún</div>';

      // Avanzar status
      tabContent.querySelectorAll('.po-advance-btn').forEach(btn => {
        btn.onclick = async () => {
          try {
            btn.disabled = true;
            await api(`/api/purchases/purchase-orders/${btn.dataset.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
            render();
          } catch(e) { alert(e.message); btn.disabled = false; }
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
        btn.onclick = () => {
          const form = document.getElementById(`invoice-form-${btn.dataset.id}`);
          form.style.display = form.style.display === 'none' ? 'block' : 'none';
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
  const done = pos.filter(p => ['Facturada','Cerrada','Rechazada por proveedor'].includes(p.status));

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
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:10px;border-bottom:1px solid #f3f4f6">
          <div>
            <b>${po.folio}</b>
            <span class="small muted" style="margin-left:8px">${String(po.created_at||'').slice(0,10)}</span>
            <span style="margin-left:12px;font-weight:600">$${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}</span>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-primary" style="font-size:12px;padding:5px 12px" onclick="respondPO(${po.id},'aceptada')">✅ Aceptar</button>
            <button class="btn-secondary" style="font-size:12px;padding:5px 12px;color:#dc2626" onclick="respondPO(${po.id},'rechazada')">✖ Rechazar</button>
          </div>
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
          <div class="row-3">
            <div><label style="font-size:12px">No. factura *</label><input id="sinv-num-${po.id}" placeholder="FACT-001"/></div>
            <div><label style="font-size:12px">Subtotal *</label><input id="sinv-sub-${po.id}" type="number" placeholder="0.00"/></div>
            <div><label style="font-size:12px">IVA</label><input id="sinv-tax-${po.id}" type="number" placeholder="0.00"/></div>
          </div>
          <div class="row-2" style="margin-top:8px">
            <div><label style="font-size:12px">📄 PDF de la factura</label><input type="file" id="sinv-pdf-${po.id}" accept=".pdf" style="font-size:12px"/></div>
            <div><label style="font-size:12px">📋 XML (CFDI)</label><input type="file" id="sinv-xml-${po.id}" accept=".xml" style="font-size:12px"/></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap">
            <button class="btn-primary sup-inv-save" data-id="${po.id}" data-supplier="${po.supplier_id}" style="font-size:12px;padding:5px 14px">Subir factura</button>
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
              ${isPaid
                ? `<span style="color:#16a34a;font-size:12px;font-weight:600">✅ Pagado</span>`
                : ''}
            </div>
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
      const numEl = document.getElementById(`sinv-num-${id}`);
      const subEl = document.getElementById(`sinv-sub-${id}`);
      const taxEl = document.getElementById(`sinv-tax-${id}`);
      const pdfEl = document.getElementById(`sinv-pdf-${id}`);
      const xmlEl = document.getElementById(`sinv-xml-${id}`);
      const msgEl = document.getElementById(`sinv-msg-${id}`);
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
        if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
        msgEl.textContent = '✅ Factura subida correctamente'; msgEl.style.color = '#16a34a';
        btn.disabled = true;
        setTimeout(render, 1200);
      } catch(e) { msgEl.textContent = e.message; msgEl.style.color = '#dc2626'; }
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
          <div class="actions"><button class="btn-primary" id="saveQuoteBtn">Guardar cotización</button></div>
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
      const opt = quoteItem.selectedOptions[0];
      if (opt?.dataset?.supplier) quoteSupplier.value = opt.dataset.supplier;
    };

    saveQuoteBtn.onclick = async () => {
      try {
        if (!quoteItem.value) throw new Error('Selecciona un ítem');
        if (!quoteSupplier.value) throw new Error('Selecciona un proveedor');
        if (!quoteUnitCost.value || Number(quoteUnitCost.value) <= 0) throw new Error('Ingresa costo mayor a cero');
        await api('/api/quotations', { method: 'POST', body: JSON.stringify({
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
        quoteMsg.textContent = '✅ Cotización guardada';
        quoteMsg.style.color = '#16a34a';
        quoteItem.value = ''; quoteSupplier.value = ''; quoteNumber.value = ''; quoteDays.value = '';
        quoteUnitCost.value = ''; quotePayTerms.value = ''; quoteCode.value = ''; quoteName.value = '';
        setTimeout(render, 900);
      } catch (e) { quoteMsg.textContent = e.message; quoteMsg.style.color = '#dc2626'; }
    };
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
  const posPendientes = pos.filter(p => !invoicedPOIds.has(p.id) && ['Enviada','Aceptada','En proceso','Entregado'].includes(p.status));

  app.innerHTML = shell(`
    <div class="grid grid-2">
      <div class="card section">
        <h3>Registrar factura <span class="small muted">(respaldo manual)</span></h3>
        <p class="small muted" style="margin-bottom:10px">El proveedor registra su propia factura desde su sesión. Usa este formulario solo si es necesario.</p>
        <label>PO (entregadas sin factura)</label>
        <select id="invPo">
          <option value="">Selecciona PO</option>
          ${posPendientes.map(p => `<option value="${p.id}" data-supplier="${p.supplier_id}">${p.folio} · ${p.supplier_name}</option>`).join('')}
        </select>
        <div class="row-3" style="margin-top:8px">
          <div><label>No. factura *</label><input id="invNumber" placeholder="FACT-001"/></div>
          <div><label>Subtotal *</label><input id="invSubtotal" type="number" placeholder="0.00"/></div>
          <div><label>IVA</label><input id="invTaxes" type="number" placeholder="0.00"/></div>
        </div>
        <div class="row-2" style="margin-top:8px">
          <div><label style="font-size:12px">📄 PDF</label><input type="file" id="invPdf" accept=".pdf" style="font-size:12px"/></div>
          <div><label style="font-size:12px">📋 XML (CFDI)</label><input type="file" id="invXml" accept=".xml" style="font-size:12px"/></div>
        </div>
        <div style="margin-top:10px">
          <button class="btn-primary" id="saveInvBtn">Guardar factura</button>
          <div id="invMsg" class="small muted" style="margin-top:6px"></div>
        </div>
      </div>

      <div class="card section">
        <div class="module-title"><h3>Facturas registradas</h3><button class="btn-secondary" id="expInvBtn">Exportar</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Factura</th><th>PO</th><th>Proveedor</th><th>Total</th><th>Estatus</th><th>Archivos</th></tr></thead>
          <tbody>${invs.length ? invs.map(i => `<tr>
            <td><b>${i.invoice_number}</b></td>
            <td>${i.po_folio}</td>
            <td>${i.supplier_name}</td>
            <td>$${Number(i.total||0).toFixed(2)}</td>
            <td>${statusPill(i.status)}</td>
            <td>
              ${i.pdf_path ? `<a href="${i.pdf_path}" target="_blank" style="font-size:12px">📄 PDF</a>` : ''}
              ${i.xml_path ? `<a href="${i.xml_path}" target="_blank" style="font-size:12px;margin-left:6px">📋 XML</a>` : ''}
              ${!i.pdf_path && !i.xml_path ? '<span class="muted small">—</span>' : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">Sin facturas registradas</td></tr>'}
          </tbody>
        </table></div>
      </div>
    </div>
  `, 'facturacion');

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
      invMsg.textContent = '✅ Factura guardada'; invMsg.style.color = '#16a34a';
      invPo.value = ''; invNumber.value = ''; invSubtotal.value = ''; invTaxes.value = '';
      setTimeout(render, 900);
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
            return `
            <div class="pay-invoice-row" data-id="${inv.id}" data-supplier="${inv.supplier_id}" data-email="${inv.supplier_email||''}" data-number="${inv.invoice_number}" data-balance="${inv.balance||inv.total||0}" data-total="${inv.total||0}" data-creditdays="${inv.credit_days||0}" data-delivery="${inv.delivery_date||''}"
              style="padding:12px;border-bottom:1px solid #f3f4f6;cursor:pointer;background:${rowBg};transition:background 0.15s"
              onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='${rowBg}'">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div>
                  <b>${inv.invoice_number}</b>${urgentTag}
                  <div class="small muted">${inv.supplier_name} · PO: ${inv.po_folio||'-'}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-weight:700">$${Number(inv.balance||inv.total||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
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
        delivery: row.dataset.delivery || ''
      };
      payFormHint.style.display = 'none';
      payFormBody.style.display = 'block';
      payAmount.value = selectedInv.balance.toFixed(2);
      payCreditDays.value = selectedInv.creditDays || '';
      payDelivery.value = selectedInv.delivery || '';
      payInvSummary.innerHTML = `
        <b>Factura:</b> ${selectedInv.number} &nbsp;|&nbsp;
        <b>Saldo:</b> $${selectedInv.balance.toLocaleString('es-MX',{minimumFractionDigits:2})} &nbsp;|&nbsp;
        <b>Total factura:</b> $${selectedInv.total.toLocaleString('es-MX',{minimumFractionDigits:2})}
      `;
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
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Depto</th><th>CC</th><th>Proveedor</th></tr></thead>
        <tbody>${users.map(u => `<tr><td>${u.full_name}</td><td style="font-size:12px">${u.email}</td><td style="font-size:12px">${u.role_code}</td><td style="font-size:12px">${u.department}</td><td style="font-size:12px">${u.default_cost_center_id ? (cc.find(c=>c.id===u.default_cost_center_id)||{}).name||'-' : '-'}</td><td style="font-size:12px">${u.supplier_id ? (suppliers.find(s=>s.id===u.supplier_id)||{}).business_name||u.supplier_id : '-'}</td></tr>`).join('')}</tbody>
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
render();
