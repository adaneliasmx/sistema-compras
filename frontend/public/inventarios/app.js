/* ── Inventarios SPA ──────────────────────────────────────────────────────── */
'use strict';

const API = '/api/inv';
let TOKEN = localStorage.getItem('inv_token') || null;
let ME    = JSON.parse(localStorage.getItem('inv_me') || 'null');

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (r.status === 401) { logout(); return null; }
  return r;
}
async function apiGet(path)        { return api('GET',    path); }
async function apiPost(path, body) { return api('POST',   path, body); }
async function apiPut(path, body)  { return api('PUT',    path, body); }
async function apiDel(path)        { return api('DELETE', path); }

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt(n, dec=2) { if (n == null) return '—'; return Number(n).toLocaleString('es-MX', { maximumFractionDigits: dec }); }
function today() { return new Date().toISOString().slice(0,10); }

const INV_TYPES = [
  { key:'quimicos_proceso',   label:'Quimicos Proceso',         icon:'⚗️' },
  { key:'epp',                label:'EPP',                      icon:'🦺' },
  { key:'insumos_consumibles',label:'Insumos y Consumibles',    icon:'🔧' },
  { key:'quimicos_titulacion',label:'Quimicos Titulacion',      icon:'🧪' }
];

// ── Modal ─────────────────────────────────────────────────────────────────────
const modalOverlay = document.getElementById('modal-overlay');
const modalBox     = document.getElementById('modal-box');
const modalTitle   = document.getElementById('modal-title');
const modalBody    = document.getElementById('modal-body');
document.getElementById('modal-close').onclick = closeModal;
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function openModal(title, html, { large = false } = {}) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalBox.classList.toggle('modal-lg', large);
  modalOverlay.style.display = 'flex';
}
function closeModal() { modalOverlay.style.display = 'none'; }

// ── Auth ──────────────────────────────────────────────────────────────────────
function logout() {
  TOKEN = null; ME = null;
  localStorage.removeItem('inv_token');
  localStorage.removeItem('inv_me');
  showLogin();
}

document.getElementById('login-btn').onclick = async () => {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!email || !pass) { errEl.textContent = 'Ingresa tu correo y contraseña.'; errEl.style.display = ''; return; }
  const r = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass })
  });
  const data = await r.json();
  if (!r.ok) { errEl.textContent = data.error || 'Error al iniciar sesión'; errEl.style.display = ''; return; }
  TOKEN = data.token; ME = data.user;
  localStorage.setItem('inv_token', TOKEN);
  localStorage.setItem('inv_me', JSON.stringify(ME));
  showApp();
};

document.getElementById('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });
document.getElementById('login-pass').addEventListener('keydown',  e => { if (e.key === 'Enter') document.getElementById('login-btn').click(); });

// ── Cambiar contraseña ────────────────────────────────────────────────────────
document.getElementById('btn-change-pass').onclick = () => {
  openModal('Cambiar contraseña', `
    <div class="form-group" style="margin-bottom:12px"><label>Contraseña actual</label><input class="form-input" type="password" id="cp-cur"/></div>
    <div class="form-group" style="margin-bottom:12px"><label>Nueva contraseña</label><input class="form-input" type="password" id="cp-new"/></div>
    <div class="form-group" style="margin-bottom:16px"><label>Confirmar nueva</label><input class="form-input" type="password" id="cp-conf"/></div>
    <div id="cp-err" style="display:none" class="alert alert-error"></div>
    <button class="btn btn-primary btn-block" id="cp-btn">Cambiar contraseña</button>
  `);
  document.getElementById('cp-btn').onclick = async () => {
    const cur  = document.getElementById('cp-cur').value;
    const nw   = document.getElementById('cp-new').value;
    const conf = document.getElementById('cp-conf').value;
    const errEl = document.getElementById('cp-err');
    errEl.style.display = 'none';
    if (!cur || !nw) { errEl.textContent = 'Completa todos los campos'; errEl.style.display = ''; return; }
    if (nw !== conf) { errEl.textContent = 'Las contraseñas no coinciden'; errEl.style.display = ''; return; }
    const r = await apiPost('/auth/change-password', { current_password: cur, new_password: nw });
    if (!r) return;
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
    closeModal(); alert('Contraseña cambiada exitosamente.');
  };
};

document.getElementById('btn-logout').onclick = logout;

// ── Sidebar nav builder ───────────────────────────────────────────────────────
function buildNav() {
  const nav  = document.getElementById('sidebar-nav');
  const role = ME.role;
  const perms = ME.permisos_inv || [];
  nav.innerHTML = '';

  const addGroup = label => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="sidebar-group-label">${esc(label)}</div>`;
    nav.appendChild(li);
  };
  const addLink = (icon, label, view, params={}) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'sidebar-link';
    btn.innerHTML = `${icon} ${esc(label)}`;
    btn.dataset.view = view;
    btn.dataset.params = JSON.stringify(params);
    btn.onclick = () => navigate(view, params);
    nav.appendChild(li);
    li.appendChild(btn);
    return btn;
  };

  // Recepcion: admin + recepcion
  if (role === 'admin' || role === 'recepcion') {
    addGroup('Recepcion');
    addLink('📥', 'Registrar Recepcion', 'recepcion');
    addLink('📋', 'Historial Recepciones', 'recepcion-hist');
  }

  // Conteos: admin + inventarios (por permisos)
  if (role === 'admin' || role === 'inventarios') {
    addGroup('Conteo Semanal');
    const types = role === 'admin' ? INV_TYPES : INV_TYPES.filter(t => perms.includes(t.key));
    for (const t of types) {
      addLink(t.icon, t.label, 'conteo', { inv_type: t.key });
    }
  }

  // Vista Comprador: admin + comprador
  if (role === 'admin' || role === 'comprador') {
    addGroup('Vista Comprador');
    for (const t of INV_TYPES) {
      addLink(t.icon, t.label, 'comprador', { inv_type: t.key });
    }
    addLink('📄', 'Nueva Requisicion', 'requisicion');
  }

  // Vales EPP: admin + inventarios
  if (role === 'admin' || role === 'inventarios') {
    addGroup('EPP');
    addLink('📝', 'Nuevo Vale EPP', 'vale-epp-nuevo');
    addLink('📋', 'Historial Vales EPP', 'vale-epp-hist');
  }

  // Admin
  if (role === 'admin') {
    addGroup('Administracion');
    addLink('👥', 'Usuarios', 'admin-users');
    addLink('📋', 'Items por Inventario', 'admin-items');
    addLink('⚙️', 'Config. Formularios', 'admin-config');
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
let currentView = null;
let currentParams = {};

function navigate(view, params={}) {
  currentView = view; currentParams = params;
  // Update active link
  document.querySelectorAll('.sidebar-link[data-view]').forEach(b => {
    b.classList.toggle('active',
      b.dataset.view === view && JSON.stringify(JSON.parse(b.dataset.params || '{}')) === JSON.stringify(params)
    );
  });
  renderView(view, params);
}

async function renderView(view, params) {
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="page-loading">Cargando...</div>';
  try {
    switch (view) {
      case 'recepcion':       await renderRecepcion(main); break;
      case 'recepcion-hist':  await renderRecepcionHist(main); break;
      case 'conteo':          await renderConteo(main, params.inv_type); break;
      case 'comprador':       await renderComprador(main, params.inv_type); break;
      case 'requisicion':     await renderRequisicion(main); break;
      case 'vale-epp-nuevo':  await renderValeEppNuevo(main); break;
      case 'vale-epp-hist':   await renderValeEppHist(main); break;
      case 'admin-users':     await renderAdminUsers(main); break;
      case 'admin-items':     await renderAdminItems(main); break;
      case 'admin-config':    await renderAdminConfig(main); break;
      default: main.innerHTML = '<div class="empty-msg">Vista no encontrada</div>';
    }
  } catch (err) {
    main.innerHTML = `<div class="alert alert-error">Error al cargar: ${esc(err.message)}</div>`;
  }
}

// ── Show/hide views ───────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('view-login').style.display = '';
  document.getElementById('view-main').style.display = 'none';
}
function showApp() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-main').style.display = '';
  document.getElementById('sidebar-user').textContent = ME.nombre;
  buildNav();
  // Default view
  const role = ME.role;
  if (role === 'admin' || role === 'inventarios') {
    const perms = ME.permisos_inv || [];
    const first = role === 'admin' ? INV_TYPES[0].key : (perms[0] || null);
    if (first) navigate('conteo', { inv_type: first });
    else navigate('vale-epp-nuevo');
  } else if (role === 'recepcion') {
    navigate('recepcion');
  } else if (role === 'comprador') {
    navigate('comprador', { inv_type: 'quimicos_proceso' });
  } else {
    navigate('conteo', { inv_type: 'quimicos_proceso' });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// VIEWS
// ════════════════════════════════════════════════════════════════════════════════

// ── RECEPCION ─────────────────────────────────────────────────────────────────
async function renderRecepcion(main) {
  // Load items config + catalog
  const [rCfg, rVales, rCompras] = await Promise.all([
    apiGet('/items-config'),
    apiGet('/catalog/vales-items'),
    apiGet('/catalog/compras-items')
  ]);
  const itemsCfg   = rCfg.ok    ? await rCfg.json()    : [];
  const valesItems = rVales.ok  ? await rVales.json()  : [];
  const comprasItems = rCompras.ok ? await rCompras.json() : [];

  main.innerHTML = `
    <div class="page-title">📥 Registrar Recepcion</div>
    <div class="card">
      <div class="form-row cols-2" style="margin-bottom:12px">
        <div class="form-group">
          <label>Inventario</label>
          <select class="form-input" id="rec-type">
            ${INV_TYPES.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Fecha</label>
          <input type="date" class="form-input" id="rec-fecha" value="${today()}"/>
        </div>
      </div>
      <div class="form-row cols-2" style="margin-bottom:12px">
        <div class="form-group">
          <label>Item</label>
          <select class="form-input" id="rec-item"></select>
        </div>
        <div class="form-group">
          <label>No. Factura / Remision</label>
          <input type="text" class="form-input" id="rec-factura" placeholder="Opcional"/>
        </div>
      </div>
      <div class="form-row cols-2" style="margin-bottom:16px">
        <div class="form-group">
          <label id="rec-qty-label">Cantidad (Tambos)</label>
          <input type="number" class="form-input" id="rec-qty" min="0" step="0.01" placeholder="0"/>
        </div>
        <div class="form-group">
          <label>Kg (calculado)</label>
          <input type="number" class="form-input" id="rec-kg" min="0" step="0.01" placeholder="0" readonly style="background:#f0f2f5"/>
        </div>
      </div>
      <div id="rec-err" class="alert alert-error" style="display:none"></div>
      <button class="btn btn-primary" id="rec-save">Guardar Recepcion</button>
    </div>
  `;

  function buildItemSelect() {
    const inv_type = document.getElementById('rec-type').value;
    const sel = document.getElementById('rec-item');
    let opts = itemsCfg.filter(i => i.inv_type === inv_type && i.activo !== false);
    if (!opts.length) {
      // fallback: use catalog if no items_config
      if (inv_type === 'quimicos_proceso') {
        opts = valesItems.map(i => ({ item_key: String(i.id), item_label: i.nombre, peso_kg: i.peso_kg }));
      } else {
        opts = comprasItems.map(i => ({ item_key: String(i.id), item_label: i.name, unidad: i.unit }));
      }
    }
    sel.innerHTML = opts.map(i =>
      `<option value="${esc(i.item_key)}" data-peso="${i.peso_kg||''}" data-label="${esc(i.item_label)}">${esc(i.item_label)}</option>`
    ).join('');
    updateKg();
  }

  function updateKg() {
    const inv_type = document.getElementById('rec-type').value;
    const selOpt = document.getElementById('rec-item').selectedOptions[0];
    const pesoKg = selOpt ? Number(selOpt.dataset.peso) : 0;
    const qty  = Number(document.getElementById('rec-qty').value) || 0;
    const kgEl = document.getElementById('rec-kg');
    const lbl  = document.getElementById('rec-qty-label');
    if (inv_type === 'quimicos_proceso' && pesoKg > 0) {
      lbl.textContent = 'Cantidad (Tambos)';
      kgEl.value = qty > 0 ? (qty * pesoKg).toFixed(2) : '';
    } else {
      lbl.textContent = 'Cantidad';
      kgEl.value = '';
    }
  }

  document.getElementById('rec-type').onchange = buildItemSelect;
  document.getElementById('rec-item').onchange = updateKg;
  document.getElementById('rec-qty').oninput   = updateKg;
  buildItemSelect();

  document.getElementById('rec-save').onclick = async () => {
    const inv_type = document.getElementById('rec-type').value;
    const selOpt   = document.getElementById('rec-item').selectedOptions[0];
    const item_key = selOpt?.value;
    const item_label = selOpt?.dataset.label || item_key;
    const cantidad = Number(document.getElementById('rec-qty').value) || null;
    const kg       = Number(document.getElementById('rec-kg').value) || null;
    const fecha    = document.getElementById('rec-fecha').value;
    const factura  = document.getElementById('rec-factura').value.trim() || null;
    const errEl    = document.getElementById('rec-err');
    errEl.style.display = 'none';
    if (!inv_type || !item_key || !fecha) { errEl.textContent = 'Completa los campos requeridos'; errEl.style.display = ''; return; }
    const r = await apiPost('/recepciones', { inv_type, item_key, item_label, cantidad, kg, fecha, factura });
    if (!r) return;
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
    alert('Recepcion guardada exitosamente.');
    document.getElementById('rec-qty').value = '';
    document.getElementById('rec-kg').value  = '';
    document.getElementById('rec-factura').value = '';
  };
}

// ── HISTORIAL RECEPCIONES ─────────────────────────────────────────────────────
async function renderRecepcionHist(main) {
  main.innerHTML = `
    <div class="page-title">📋 Historial de Recepciones</div>
    <div class="card">
      <div class="toolbar">
        <select class="form-input" id="rh-type" style="width:220px">
          <option value="">Todos los inventarios</option>
          ${INV_TYPES.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}
        </select>
        <input type="date" class="form-input" id="rh-desde" style="width:150px" placeholder="Desde"/>
        <input type="date" class="form-input" id="rh-hasta" style="width:150px" placeholder="Hasta"/>
        <button class="btn btn-secondary" id="rh-search">Buscar</button>
      </div>
      <div id="rh-table"><div class="empty-msg">Selecciona filtros y presiona Buscar</div></div>
    </div>
  `;
  document.getElementById('rh-search').onclick = async () => {
    const inv_type = document.getElementById('rh-type').value;
    const desde    = document.getElementById('rh-desde').value;
    const hasta    = document.getElementById('rh-hasta').value;
    let qs = '';
    if (inv_type) qs += `&inv_type=${inv_type}`;
    if (desde)    qs += `&desde=${desde}`;
    if (hasta)    qs += `&hasta=${hasta}`;
    const r = await apiGet('/recepciones?' + qs.slice(1));
    const rows = r.ok ? await r.json() : [];
    const tbody = rows.map(row => `<tr>
      <td>${esc(row.fecha)}</td>
      <td>${esc(INV_TYPES.find(t=>t.key===row.inv_type)?.label || row.inv_type)}</td>
      <td>${esc(row.item_label)}</td>
      <td class="text-right">${fmt(row.cantidad)}</td>
      <td class="text-right">${fmt(row.kg)} kg</td>
      <td>${esc(row.factura || '—')}</td>
      <td>${esc(row.usuario_nombre)}</td>
      ${ME.role === 'admin' ? `<td><button class="btn btn-danger btn-sm" onclick="delRecepcion(${row.id})">Eliminar</button></td>` : '<td></td>'}
    </tr>`).join('');
    document.getElementById('rh-table').innerHTML = rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Inventario</th><th>Item</th><th>Cantidad</th><th>Kg</th><th>Factura</th><th>Usuario</th><th></th></tr></thead>
        <tbody>${tbody}</tbody>
      </table></div>
    ` : '<div class="empty-msg">Sin registros</div>';
  };
}
window.delRecepcion = async (id) => {
  if (!confirm('¿Eliminar esta recepcion?')) return;
  const r = await apiDel('/recepciones/' + id);
  if (r?.ok) navigate('recepcion-hist');
};

// ── CONTEO SEMANAL ────────────────────────────────────────────────────────────
async function renderConteo(main, inv_type) {
  const tipoInfo = INV_TYPES.find(t => t.key === inv_type) || { label: inv_type, icon: '📦' };
  const now = new Date();
  // Get current week conteo, items config, and form config in parallel
  const [rConteos, rItems, rCfg] = await Promise.all([
    apiGet(`/conteos?inv_type=${inv_type}`),
    apiGet(`/items-config?inv_type=${inv_type}`),
    apiGet('/config')
  ]);
  const conteos  = rConteos?.ok ? await rConteos.json() : [];
  const itemsCfg = rItems?.ok  ? await rItems.json()   : [];
  const allCfgs  = rCfg?.ok   ? await rCfg.json()     : [];
  const formCfg  = allCfgs.find(c => c.inv_type === inv_type) || {};
  const activeItems = itemsCfg.filter(i => i.activo !== false);

  // Current ISO week
  function isoWeek(d) {
    const dt = new Date(d); dt.setHours(12,0,0,0);
    dt.setDate(dt.getDate() + 3 - ((dt.getDay()+6)%7));
    const w1 = new Date(dt.getFullYear(),0,4);
    return 1 + Math.round(((dt-w1)/86400000 - 3 + ((w1.getDay()+6)%7))/7);
  }
  function isoYear(d) {
    const dt = new Date(d); dt.setDate(dt.getDate()+3-((dt.getDay()+6)%7)); return dt.getFullYear();
  }
  const curYear = isoYear(now);
  const curWeek = isoWeek(now);
  const existing = conteos.find(c => c.year === curYear && c.week === curWeek);

  const isQuimicos = inv_type === 'quimicos_proceso';
  // colCount: quimicos = Item+Tambos+Porrones+Kg+Unidad=5, others = Item+Cantidad+Unidad=3
  const conteoColCount = isQuimicos ? 5 : 3;

  // Build input rows grouped by proveedor
  const conteoGrouped = {};
  activeItems.forEach(item => {
    const prov = item.proveedor || '(Sin proveedor)';
    if (!conteoGrouped[prov]) conteoGrouped[prov] = [];
    conteoGrouped[prov].push(item);
  });
  const conteoProveedores = Object.keys(conteoGrouped).sort((a, b) =>
    a === '(Sin proveedor)' ? 1 : b === '(Sin proveedor)' ? -1 : a.localeCompare(b)
  );
  const rowsHtml = conteoProveedores.flatMap(prov => {
    const provItems = conteoGrouped[prov];
    const headerRow = `<tr><td colspan="${conteoColCount}" style="background:#dbeafe;color:#1e40af;font-weight:700;padding:6px 12px;font-size:.8rem;letter-spacing:.5px">${esc(prov)} <span style="font-weight:400;opacity:.7">(${provItems.length})</span></td></tr>`;
    const itemRows = provItems.map(item => {
      const ex = existing?.items.find(i => i.item_key === item.item_key);
      const pesoKg   = item.peso_kg   || 0;
      const densidad = item.densidad  || 0;
      if (isQuimicos) {
        const tambosVal   = ex?.tambos   ?? '';
        const porronesVal = ex?.porrones ?? '';
        const kgCalc = (Number(tambosVal) * pesoKg + Number(porronesVal) * 15 * densidad).toFixed(2);
        const kgShow = (tambosVal !== '' || porronesVal !== '') ? kgCalc : (ex?.kg ?? '');
        return `<tr data-key="${esc(item.item_key)}">
          <td>${esc(item.item_label)}</td>
          <td><input type="number" class="form-input conteo-tambos" data-key="${esc(item.item_key)}" data-peso="${pesoKg}" data-densidad="${densidad}" value="${tambosVal}" min="0" step="0.01" style="width:80px"/></td>
          <td><input type="number" class="form-input conteo-porrones" data-key="${esc(item.item_key)}" value="${porronesVal}" min="0" step="0.01" style="width:80px"/></td>
          <td><input type="number" class="form-input conteo-kg" data-key="${esc(item.item_key)}" value="${kgShow}" min="0" step="0.01" style="width:90px;background:#f8fafc" readonly/></td>
          <td><span class="text-muted" style="font-size:.8rem">kg</span></td>
        </tr>`;
      } else {
        return `<tr data-key="${esc(item.item_key)}">
          <td>${esc(item.item_label)}</td>
          <td><input type="number" class="form-input conteo-qty" data-key="${esc(item.item_key)}" value="${ex?.cantidad ?? ''}" min="0" step="0.01" style="width:110px"/></td>
          <td><span class="text-muted" style="font-size:.8rem">${esc(item.unidad || '—')}</span></td>
        </tr>`;
      }
    });
    return [headerRow, ...itemRows];
  }).join('');

  const printCode = formCfg.form_code ? `${esc(formCfg.form_code)} ${esc(formCfg.form_rev||'')}` : '';
  const printTitle = esc(formCfg.form_title || tipoInfo.label);

  main.innerHTML = `
    <div class="print-header" style="display:none">
      <div style="font-size:11px;color:#64748b">${printCode}</div>
      <div style="font-size:15px;font-weight:800">${printTitle}</div>
      <div style="font-size:12px">Semana ${curWeek} / ${curYear}</div>
    </div>
    <div class="page-title">${tipoInfo.icon} Conteo Semanal — ${esc(tipoInfo.label)}</div>
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Semana ${curWeek} / ${curYear}</div>
          ${existing ? `<div class="page-subtitle">Ultimo conteo: ${esc(existing.fecha)} por ${esc(existing.usuario_nombre)}</div>` : '<div class="page-subtitle text-muted">Sin conteo esta semana</div>'}
        </div>
        <div class="form-group" style="flex-direction:row;align-items:center;gap:8px">
          <label style="white-space:nowrap;font-weight:600">Fecha conteo:</label>
          <input type="date" class="form-input" id="conteo-fecha" value="${existing?.fecha || today()}" style="width:160px;margin:0"/>
        </div>
      </div>
      ${!activeItems.length ? '<div class="empty-msg">No hay items configurados para este inventario.<br>Ve a Administracion → Items por Inventario.</div>' : `
      <div class="table-wrap">
        <table id="conteo-table">
          <thead><tr>
            <th>Item</th>
            ${isQuimicos ? '<th>Tambos</th><th>Porrones 15L</th><th>Kg (calculado)</th><th>Unidad</th>' : '<th>Cantidad</th><th>Unidad</th>'}
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div id="conteo-err" class="alert alert-error" style="display:none;margin-top:12px"></div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="conteo-save">Guardar Conteo</button>
        <button class="btn btn-secondary" id="conteo-comportamientos">Ver Comportamientos</button>
        <button class="btn btn-outline" onclick="window.print()">Imprimir</button>
      </div>
      `}
    </div>
  `;

  if (!activeItems.length) return;

  // Auto-calc kg for quimicos_proceso
  if (isQuimicos) {
    document.getElementById('conteo-table').addEventListener('input', e => {
      const inp = e.target;
      if (!inp.classList.contains('conteo-tambos') && !inp.classList.contains('conteo-porrones')) return;
      const key = inp.dataset.key;
      const tambosEl   = document.querySelector(`.conteo-tambos[data-key="${key}"]`);
      const porronesEl = document.querySelector(`.conteo-porrones[data-key="${key}"]`);
      const kgEl       = document.querySelector(`.conteo-kg[data-key="${key}"]`);
      const pesoKg   = Number(tambosEl.dataset.peso)    || 0;
      const densidad = Number(tambosEl.dataset.densidad) || 0;
      const kg = (Number(tambosEl.value) || 0) * pesoKg + (Number(porronesEl.value) || 0) * 15 * densidad;
      kgEl.value = kg > 0 ? kg.toFixed(2) : '';
    });
  }

  document.getElementById('conteo-save').onclick = async () => {
    const fecha = document.getElementById('conteo-fecha').value;
    const errEl = document.getElementById('conteo-err');
    errEl.style.display = 'none';
    if (!fecha) { errEl.textContent = 'Indica la fecha del conteo'; errEl.style.display = ''; return; }
    const items = activeItems.map(item => {
      const key = item.item_key;
      if (isQuimicos) {
        const tambos   = Number(document.querySelector(`.conteo-tambos[data-key="${key}"]`)?.value) || null;
        const porrones = Number(document.querySelector(`.conteo-porrones[data-key="${key}"]`)?.value) || null;
        const kg       = Number(document.querySelector(`.conteo-kg[data-key="${key}"]`)?.value) || null;
        return { item_key: key, tambos, porrones, cantidad: tambos, kg, unidad: 'kg' };
      } else {
        const cantidad = Number(document.querySelector(`.conteo-qty[data-key="${key}"]`)?.value) || null;
        return { item_key: key, tambos: null, porrones: null, cantidad, kg: null, unidad: item.unidad };
      }
    });
    const r = await apiPost('/conteos', { inv_type, fecha, items });
    if (!r) return;
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
    alert('Conteo guardado.');
    navigate('conteo', { inv_type });
  };

  document.getElementById('conteo-comportamientos').onclick = () => {
    renderComportamientosModal(inv_type, tipoInfo.label);
  };
}

// ── COMPORTAMIENTOS (modal) ───────────────────────────────────────────────────
async function renderComportamientosModal(inv_type, label) {
  const year = new Date().getFullYear();
  openModal(`Comportamientos — ${label}`, `<div class="page-loading">Cargando...</div>`, { large: true });
  const r = await apiGet(`/comportamientos/${inv_type}?year=${year}`);
  if (!r || !r.ok) { document.getElementById('modal-body').innerHTML = '<div class="alert alert-error">Error al cargar</div>'; return; }
  const { conteos, items_config } = await r.json();

  const months = [...new Set(conteos.map(c => c.week_start.slice(0,7)))].sort();
  let filtered = conteos;

  function renderTable(rows) {
    if (!rows.length) return '<div class="empty-msg">Sin datos</div>';
    const cols = items_config.map(i => `<th>${esc(i.item_label)}</th>`).join('');
    const trs  = rows.map(c => {
      const cells = items_config.map(i => {
        const it = (c.items || []).find(x => x.item_key === i.item_key);
        return `<td class="text-right">${it?.kg != null ? fmt(it.kg)+' kg' : '—'}</td>`;
      }).join('');
      return `<tr><td>Sem ${c.week}</td><td>${esc(c.week_start)}</td>${cells}<td>${esc(c.usuario_nombre)}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>Semana</th><th>Inicio</th>${cols}<th>Registrado por</th></tr></thead>
      <tbody>${trs}</tbody>
    </table></div>`;
  }

  document.getElementById('modal-body').innerHTML = `
    <div class="toolbar" style="margin-bottom:12px">
      <select class="form-input" id="comp-month" style="width:160px">
        <option value="">Todos los meses</option>
        ${months.map(m => `<option value="${m}">${m}</option>`).join('')}
      </select>
      <button class="btn btn-outline btn-sm" onclick="window.print()">Imprimir</button>
    </div>
    <div id="comp-content">${renderTable(filtered)}</div>
  `;
  document.getElementById('comp-month').onchange = function() {
    const m = this.value;
    filtered = m ? conteos.filter(c => c.week_start.slice(0,7) === m) : conteos;
    document.getElementById('comp-content').innerHTML = renderTable(filtered);
  };
}

// ── VISTA COMPRADOR ───────────────────────────────────────────────────────────
async function renderComprador(main, inv_type) {
  const tipoInfo = INV_TYPES.find(t => t.key === inv_type) || { label: inv_type, icon: '📦' };
  main.innerHTML = `
    <div class="page-title">${tipoInfo.icon} ${esc(tipoInfo.label)} — Vista Comprador</div>
    <div class="tabs" id="comprador-tabs">
      <button class="tab-btn active" data-tab="semana">Semana Actual</button>
      <button class="tab-btn" data-tab="comportamientos">Comportamientos</button>
      <button class="tab-btn" data-tab="oc">OC Pendientes</button>
    </div>
    <div id="comprador-tab-content"></div>
  `;
  document.querySelectorAll('#comprador-tabs .tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#comprador-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadCompradorTab(btn.dataset.tab, inv_type);
    };
  });
  loadCompradorTab('semana', inv_type);
}

async function loadCompradorTab(tab, inv_type) {
  const el = document.getElementById('comprador-tab-content');
  el.innerHTML = '<div class="page-loading">Cargando...</div>';

  if (tab === 'semana') {
    const r = await apiGet(`/consumo-semanal/${inv_type}`);
    if (!r?.ok) { el.innerHTML = '<div class="alert alert-error">Error al cargar</div>'; return; }
    const data = await r.json();

    const showTambos = inv_type === 'quimicos_proceso';
    let unit = 'kg'; // default display

    function renderSemana(u) {
      const isTambos = u === 'tambos';
      const isQ = inv_type === 'quimicos_proceso';
      // columns: Item | Stock actual | Consumo (vales) | Recibido | Pendiente | Min | Max | Estado
      const semColCount = isQ ? (isTambos ? 8 : 8) : 7;

      function rowHtml(row) {
        const curVal     = isTambos ? (row.cur_tambos ?? row.cur_tambos_raw) : row.cur_kg;
        const consumoVal = row.consumo_kg != null
          ? (isTambos && row.peso_kg ? Math.round((row.consumo_kg / row.peso_kg) * 100) / 100 : row.consumo_kg)
          : null;
        const minVal = row.min_val;
        const unit   = isTambos ? 'T' : 'kg';

        let statusClass = '', statusDot = 'ok', stockLabel = 'OK';
        if (curVal === null || curVal === undefined) { statusClass = ''; statusDot = 'gray'; stockLabel = 'S/D'; }
        else if (minVal !== null && curVal <= 0)     { statusClass = 'stock-empty'; statusDot = 'empty'; stockLabel = 'AGOTADO'; }
        else if (minVal !== null && curVal < minVal) { statusClass = 'stock-low';   statusDot = 'low';   stockLabel = 'BAJO'; }

        const recibidoStr  = row.recibido_kg != null  ? `${fmt(row.recibido_kg)} kg`  : '—';
        const pendienteStr = row.pendiente_qty != null ? `${fmt(row.pendiente_qty)} ${row.pendiente_unit || ''}` : '—';

        return `<tr class="${statusClass}">
          <td><span class="stock-dot ${statusDot}"></span> ${esc(row.item_label)}</td>
          <td class="text-right">${curVal != null ? fmt(curVal)+' '+unit : '—'}</td>
          <td class="text-right">${consumoVal != null ? fmt(consumoVal)+' '+unit : '—'}</td>
          <td class="text-right">${recibidoStr}</td>
          <td class="text-right">${pendienteStr}</td>
          <td class="text-right">${row.min_val != null ? fmt(row.min_val, 0) : '—'}</td>
          <td class="text-right">${row.max_val != null ? fmt(row.max_val, 0) : '—'}</td>
          <td><span class="badge ${statusDot==='ok'?'badge-green':statusDot==='low'?'badge-yellow':statusDot==='empty'?'badge-red':'badge-gray'}">${stockLabel}</span></td>
        </tr>`;
      }

      const semGrouped = {};
      data.rows.forEach(row => {
        const prov = row.proveedor || '(Sin proveedor)';
        if (!semGrouped[prov]) semGrouped[prov] = [];
        semGrouped[prov].push(row);
      });
      const semProveedores = Object.keys(semGrouped).sort((a, b) =>
        a === '(Sin proveedor)' ? 1 : b === '(Sin proveedor)' ? -1 : a.localeCompare(b)
      );
      const rows = semProveedores.flatMap(prov => {
        const provRows = semGrouped[prov];
        const hdr = `<tr><td colspan="${semColCount}" style="background:#dbeafe;color:#1e40af;font-weight:700;padding:6px 12px;font-size:.8rem;letter-spacing:.5px">${esc(prov)} <span style="font-weight:400;opacity:.7">(${provRows.length})</span></td></tr>`;
        return [hdr, ...provRows.map(rowHtml)];
      }).join('');

      const unitLabel = isTambos ? 'Tambos' : 'Kg';
      return `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Semana ${data.cur_week} / ${data.cur_year}</div>
              <div class="page-subtitle">Conteo actual: ${data.cur_fecha || 'Sin conteo'}</div>
            </div>
            ${showTambos ? `<div class="toggle-unit" id="unit-toggle">
              <button data-u="kg" class="${u==='kg'?'active':''}">Kg</button>
              <button data-u="tambos" class="${u==='tambos'?'active':''}">Tambos</button>
            </div>` : ''}
          </div>
          ${data.rows.length ? `<div class="table-wrap"><table>
            <thead><tr>
              <th>Item</th>
              <th>Stock actual (${unitLabel})</th>
              <th>Consumo sem. ant. (vales)</th>
              <th>Recibido sem.</th>
              <th>Pendiente recibir</th>
              <th>Min</th><th>Max</th><th>Estado</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>` : '<div class="empty-msg">Sin datos de conteo</div>'}
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-outline btn-sm" onclick="window.print()">Imprimir</button>
          </div>
        </div>
      `;
    }

    el.innerHTML = renderSemana(unit);
    if (showTambos) {
      document.getElementById('unit-toggle')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-u]');
        if (!btn) return;
        unit = btn.dataset.u;
        el.innerHTML = renderSemana(unit);
        if (showTambos) {
          document.getElementById('unit-toggle')?.addEventListener('click', arguments.callee);
        }
      });
    }

  } else if (tab === 'comportamientos') {
    const year = new Date().getFullYear();
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <select class="form-input" id="comp-year" style="width:120px">
            <option value="${year}">${year}</option>
            <option value="${year-1}">${year-1}</option>
          </select>
          <select class="form-input" id="comp-month2" style="width:160px">
            <option value="">Todos los meses</option>
            ${months.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('')}
          </select>
          <button class="btn btn-secondary" id="comp-load">Cargar</button>
          <button class="btn btn-outline btn-sm" onclick="window.print()">Imprimir</button>
        </div>
        <div id="comp-result"></div>
      </div>
    `;
    async function loadComp() {
      const yr = document.getElementById('comp-year').value;
      const mo = document.getElementById('comp-month2').value;
      let qs = `?year=${yr}`; if (mo) qs += `&month=${mo}`;
      const r2 = await apiGet(`/comportamientos/${inv_type}${qs}`);
      if (!r2?.ok) { document.getElementById('comp-result').innerHTML = '<div class="alert alert-error">Error</div>'; return; }
      const { conteos, items_config } = await r2.json();
      if (!conteos.length) { document.getElementById('comp-result').innerHTML = '<div class="empty-msg">Sin datos</div>'; return; }
      const cols = items_config.map(i => `<th>${esc(i.item_label)}</th>`).join('');
      const trs  = conteos.map(c => {
        const cells = items_config.map(i => {
          const it = (c.items||[]).find(x=>x.item_key===i.item_key);
          return `<td class="text-right">${it?.kg!=null?fmt(it.kg)+' kg':'—'}</td>`;
        }).join('');
        return `<tr><td>Sem ${c.week}</td><td>${esc(c.week_start)}</td>${cells}</tr>`;
      }).join('');
      document.getElementById('comp-result').innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Semana</th><th>Inicio</th>${cols}</tr></thead>
        <tbody>${trs}</tbody>
      </table></div>`;
    }
    document.getElementById('comp-load').onclick = loadComp;
    loadComp();

  } else if (tab === 'oc') {
    const r = await apiGet('/pending-po');
    const pos = r?.ok ? await r.json() : [];
    if (!pos.length) { el.innerHTML = '<div class="card"><div class="empty-msg">Sin ordenes de compra pendientes</div></div>'; return; }
    const rows = pos.map(po => `<tr>
      <td>${esc(po.folio)}</td>
      <td>${esc(po.supplier)}</td>
      <td>${esc(po.fecha)}</td>
      <td><span class="badge badge-yellow">${esc(po.status)}</span></td>
      <td>${(po.items||[]).map(i=>`${esc(i.description)} x${i.quantity}`).join(', ')}</td>
    </tr>`).join('');
    el.innerHTML = `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Folio</th><th>Proveedor</th><th>Fecha</th><th>Estado</th><th>Items</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
  }
}

// ── REQUISICION ───────────────────────────────────────────────────────────────
async function renderRequisicion(main) {
  const r = await apiGet('/catalog/compras-items');
  const catalog = r?.ok ? await r.json() : [];

  main.innerHTML = `
    <div class="page-title">📄 Nueva Requisicion</div>
    <div class="card">
      <div class="form-row cols-2" style="margin-bottom:12px">
        <div class="form-group">
          <label>Area / Departamento</label>
          <input type="text" class="form-input" id="req-area" value="Inventarios"/>
        </div>
        <div class="form-group">
          <label>Notas</label>
          <input type="text" class="form-input" id="req-notas" placeholder="Opcional"/>
        </div>
      </div>
      <div class="card-title" style="margin-bottom:10px">Items</div>
      <div id="req-items"></div>
      <button class="btn btn-secondary btn-sm" id="req-add-item" style="margin-bottom:16px">+ Agregar item</button>
      <div id="req-err" class="alert alert-error" style="display:none"></div>
      <button class="btn btn-primary" id="req-send">Enviar Requisicion</button>
    </div>
  `;

  let reqItems = [];
  function renderItems() {
    document.getElementById('req-items').innerHTML = reqItems.map((it, idx) => `
      <div class="form-row cols-3" style="margin-bottom:8px;align-items:end">
        <div class="form-group">
          <label>Item del catalogo</label>
          <select class="form-input req-cat" data-idx="${idx}">
            <option value="">— Seleccionar —</option>
            ${catalog.map(c=>`<option value="${c.id}" data-name="${esc(c.name)}" data-unit="${esc(c.unit)}" ${it.catalog_item_id==c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Descripcion / Notas</label>
          <input type="text" class="form-input req-desc" data-idx="${idx}" value="${esc(it.description||'')}" placeholder="Descripcion libre"/>
        </div>
        <div class="form-group" style="flex-direction:row;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label>Cantidad</label>
            <input type="number" class="form-input req-qty" data-idx="${idx}" value="${it.quantity||1}" min="0.01" step="0.01"/>
          </div>
          <button class="btn btn-danger btn-sm" onclick="removeReqItem(${idx})">✕</button>
        </div>
      </div>
    `).join('');
    document.querySelectorAll('.req-cat').forEach(sel => {
      sel.onchange = e => {
        const idx = Number(e.target.dataset.idx);
        const opt = e.target.selectedOptions[0];
        reqItems[idx].catalog_item_id = Number(opt.value)||null;
        reqItems[idx].description = opt.dataset.name || '';
        reqItems[idx].unit = opt.dataset.unit || 'pieza';
        renderItems();
      };
    });
    document.querySelectorAll('.req-desc').forEach(inp => inp.onchange = e => { reqItems[Number(e.target.dataset.idx)].description = e.target.value; });
    document.querySelectorAll('.req-qty').forEach(inp => inp.onchange = e => { reqItems[Number(e.target.dataset.idx)].quantity = Number(e.target.value); });
  }
  window.removeReqItem = idx => { reqItems.splice(idx, 1); renderItems(); };

  document.getElementById('req-add-item').onclick = () => { reqItems.push({ catalog_item_id: null, description: '', quantity: 1, unit: 'pieza' }); renderItems(); };
  reqItems.push({ catalog_item_id: null, description: '', quantity: 1, unit: 'pieza' });
  renderItems();

  document.getElementById('req-send').onclick = async () => {
    const area  = document.getElementById('req-area').value.trim();
    const notas = document.getElementById('req-notas').value.trim();
    const errEl = document.getElementById('req-err');
    errEl.style.display = 'none';
    const filled = reqItems.filter(i => i.description || i.catalog_item_id);
    if (!filled.length) { errEl.textContent = 'Agrega al menos un item'; errEl.style.display = ''; return; }
    const r = await apiPost('/requisicion', { items: filled, notas, area });
    if (!r) return;
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
    alert(`Requisicion ${d.folio} creada en el modulo de Compras.`);
    navigate('requisicion');
  };
}

// ── VALE EPP NUEVO ────────────────────────────────────────────────────────────
async function renderValeEppNuevo(main) {
  const [rEmps, rItems] = await Promise.all([
    apiGet('/catalog/employees'),
    apiGet('/items-config?inv_type=epp')
  ]);
  const employees = rEmps?.ok  ? await rEmps.json()  : [];
  const eppItems  = rItems?.ok ? await rItems.json() : [];
  const activeEpp = eppItems.filter(i => i.activo !== false);

  main.innerHTML = `
    <div class="page-title">📝 Nuevo Vale de Salida EPP</div>
    <div class="card">
      <div class="form-row cols-2" style="margin-bottom:12px">
        <div class="form-group">
          <label>Empleado</label>
          <select class="form-input" id="vale-emp">
            <option value="">— Seleccionar empleado —</option>
            ${employees.map(e => `<option value="${e.id}" data-nombre="${esc(e.nombre)}">${esc(e.nombre)}${e.puesto?' — '+esc(e.puesto):''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Nombre empleado (manual si no esta en lista)</label>
          <input type="text" class="form-input" id="vale-emp-nombre" placeholder="Nombre completo"/>
        </div>
      </div>
      <div class="form-row cols-2" style="margin-bottom:12px">
        <div class="form-group">
          <label>Autorizador</label>
          <input type="text" class="form-input" id="vale-auth" placeholder="Nombre del autorizador"/>
        </div>
        <div class="form-group">
          <label>Fecha</label>
          <input type="date" class="form-input" id="vale-fecha" value="${today()}"/>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label>Notas</label>
        <input type="text" class="form-input" id="vale-notas" placeholder="Opcional"/>
      </div>
      <div class="card-title" style="margin-bottom:10px">Articulos EPP</div>
      ${!activeEpp.length ? '<div class="alert alert-warn">No hay items EPP configurados. Configura items en Administracion → Items por Inventario.</div>' : `
      <div class="table-wrap" style="margin-bottom:16px"><table>
        <thead><tr><th>Articulo</th><th>Unidad</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${activeEpp.map(item => `<tr>
            <td>${esc(item.item_label)}</td>
            <td>${esc(item.unidad||'pza')}</td>
            <td><input type="number" class="form-input epp-qty" data-key="${esc(item.item_key)}" data-label="${esc(item.item_label)}" data-unit="${esc(item.unidad||'pza')}" value="0" min="0" step="1" style="width:80px"/></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      `}
      <div id="vale-err" class="alert alert-error" style="display:none"></div>
      <button class="btn btn-primary" id="vale-save">Generar Vale</button>
    </div>
  `;

  document.getElementById('vale-emp').onchange = function() {
    const opt = this.selectedOptions[0];
    if (opt?.dataset.nombre) document.getElementById('vale-emp-nombre').value = opt.dataset.nombre;
  };

  document.getElementById('vale-save').onclick = async () => {
    const empSel   = document.getElementById('vale-emp');
    const empleado_id     = Number(empSel.value) || null;
    const empleado_nombre = document.getElementById('vale-emp-nombre').value.trim();
    const autorizador_nombre = document.getElementById('vale-auth').value.trim();
    const fecha   = document.getElementById('vale-fecha').value;
    const notas   = document.getElementById('vale-notas').value.trim();
    const errEl   = document.getElementById('vale-err');
    errEl.style.display = 'none';
    if (!empleado_nombre) { errEl.textContent = 'Indica el nombre del empleado'; errEl.style.display = ''; return; }
    if (!autorizador_nombre) { errEl.textContent = 'Indica el autorizador'; errEl.style.display = ''; return; }
    if (!fecha) { errEl.textContent = 'Indica la fecha'; errEl.style.display = ''; return; }
    const items = [];
    document.querySelectorAll('.epp-qty').forEach(inp => {
      const qty = Number(inp.value) || 0;
      if (qty > 0) items.push({ item_key: inp.dataset.key, item_label: inp.dataset.label, cantidad: qty, unidad: inp.dataset.unit });
    });
    if (!items.length) { errEl.textContent = 'Agrega al menos un articulo con cantidad > 0'; errEl.style.display = ''; return; }
    const r = await apiPost('/vales-epp', { empleado_id, empleado_nombre, autorizador_nombre, fecha, notas, items });
    if (!r) return;
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
    // Show print modal
    openModal(`Vale EPP ${d.folio}`, buildValePrintHtml(d), { large: true });
  };
}

function buildValePrintHtml(vale) {
  const rows = (vale.items || []).map(i =>
    `<tr><td>${esc(i.item_label)}</td><td class="text-right">${fmt(i.cantidad,0)}</td><td>${esc(i.unidad)}</td></tr>`
  ).join('');
  return `
    <div id="vale-print-area">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:1.3rem;font-weight:700">Vale de Salida EPP</div>
        <div style="font-size:.9rem;color:#666">Folio: ${esc(vale.folio)} | Fecha: ${esc(vale.fecha)}</div>
      </div>
      <div class="form-row cols-2" style="margin-bottom:12px">
        <div><strong>Empleado:</strong> ${esc(vale.empleado_nombre)}</div>
        <div><strong>Autorizador:</strong> ${esc(vale.autorizador_nombre)}</div>
      </div>
      ${vale.notas ? `<div style="margin-bottom:12px"><strong>Notas:</strong> ${esc(vale.notas)}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead><tr style="background:#f0f2f5"><th style="padding:8px;text-align:left">Articulo</th><th style="padding:8px;text-align:right">Cantidad</th><th style="padding:8px">Unidad</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="form-row cols-2" style="margin-top:40px;gap:40px">
        <div style="text-align:center;border-top:1px solid #333;padding-top:8px">Firma Empleado</div>
        <div style="text-align:center;border-top:1px solid #333;padding-top:8px">Firma Autorizador</div>
      </div>
    </div>
    <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-outline" onclick="window.print()">Imprimir</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
    </div>
  `;
}

// ── HISTORIAL VALES EPP ───────────────────────────────────────────────────────
async function renderValeEppHist(main) {
  main.innerHTML = `
    <div class="page-title">📋 Historial Vales EPP</div>
    <div class="card">
      <div class="toolbar">
        <input type="date" class="form-input" id="vh-desde" style="width:150px"/>
        <input type="date" class="form-input" id="vh-hasta" style="width:150px"/>
        <button class="btn btn-secondary" id="vh-load">Buscar</button>
      </div>
      <div id="vh-content"><div class="page-loading">Cargando...</div></div>
    </div>
  `;
  async function load() {
    const desde = document.getElementById('vh-desde').value;
    const hasta = document.getElementById('vh-hasta').value;
    let qs = ''; if (desde) qs += `&desde=${desde}`; if (hasta) qs += `&hasta=${hasta}`;
    const r = await apiGet('/vales-epp?' + qs.slice(1));
    const vales = r?.ok ? await r.json() : [];
    const tbody = vales.map(v => `<tr>
      <td>${esc(v.folio)}</td>
      <td>${esc(v.fecha)}</td>
      <td>${esc(v.empleado_nombre)}</td>
      <td>${esc(v.autorizador_nombre)}</td>
      <td>${(v.items||[]).map(i=>`${i.cantidad} ${esc(i.item_label)}`).join(', ')}</td>
      <td><button class="btn btn-outline btn-sm" onclick="showValeEpp(${v.id})">Ver</button>
      ${ME.role==='admin'?`<button class="btn btn-danger btn-sm" onclick="delValeEpp(${v.id})">Eliminar</button>`:''}</td>
    </tr>`).join('');
    document.getElementById('vh-content').innerHTML = vales.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Folio</th><th>Fecha</th><th>Empleado</th><th>Autorizador</th><th>Articulos</th><th></th></tr></thead>
      <tbody>${tbody}</tbody>
    </table></div>` : '<div class="empty-msg">Sin vales</div>';
  }
  document.getElementById('vh-load').onclick = load;
  load();
}

window.showValeEpp = async (id) => {
  const r = await apiGet('/vales-epp');
  if (!r?.ok) return;
  const vales = await r.json();
  const vale = vales.find(v => v.id === id);
  if (vale) openModal(`Vale ${vale.folio}`, buildValePrintHtml(vale), { large: true });
};
window.delValeEpp = async (id) => {
  if (!confirm('¿Eliminar este vale?')) return;
  const r = await apiDel('/vales-epp/' + id);
  if (r?.ok) navigate('vale-epp-hist');
};
window.closeModal = closeModal;

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN VIEWS
// ════════════════════════════════════════════════════════════════════════════════

// ── ADMIN USUARIOS ────────────────────────────────────────────────────────────
async function renderAdminUsers(main) {
  async function load() {
    const r = await apiGet('/users');
    return r?.ok ? r.json() : [];
  }
  const ROLES = ['admin','inventarios','recepcion','comprador'];
  const INV_KEYS = INV_TYPES.map(t => t.key);

  function renderPage(users) {
    const tbody = users.map(u => `<tr>
      <td>${esc(u.nombre)}</td>
      <td>${esc(u.email)}</td>
      <td><span class="badge badge-blue">${esc(u.role)}</span></td>
      <td>${u.role==='inventarios' ? (u.permisos_inv||[]).map(p=>INV_TYPES.find(t=>t.key===p)?.label||p).join(', ') || 'Ninguno' : '—'}</td>
      <td><span class="badge ${u.activo?'badge-green':'badge-gray'}">${u.activo?'Activo':'Inactivo'}</span></td>
      <td class="td-actions">
        <button class="btn btn-outline btn-sm" onclick="editUser(${u.id})">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">Eliminar</button>
      </td>
    </tr>`).join('');
    main.innerHTML = `
      <div class="page-title">👥 Usuarios</div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">Lista de usuarios</div>
          <button class="btn btn-primary btn-sm" id="add-user-btn">+ Nuevo usuario</button>
        </div>
        ${users.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Permisos Inv.</th><th>Estado</th><th></th></tr></thead>
          <tbody>${tbody}</tbody>
        </table></div>` : '<div class="empty-msg">Sin usuarios</div>'}
      </div>
    `;
    document.getElementById('add-user-btn').onclick = () => openUserModal(null);
  }

  function openUserModal(user) {
    const isNew = !user;
    openModal(isNew ? 'Nuevo usuario' : 'Editar usuario', `
      <div class="form-group" style="margin-bottom:10px"><label>Nombre</label><input class="form-input" id="um-nombre" value="${esc(user?.nombre||'')}"/></div>
      <div class="form-group" style="margin-bottom:10px"><label>Email</label><input class="form-input" type="email" id="um-email" value="${esc(user?.email||'')}"/></div>
      <div class="form-group" style="margin-bottom:10px"><label>${isNew?'Contraseña':'Nueva contraseña (dejar vacio para no cambiar)'}</label><input class="form-input" type="password" id="um-pass"/></div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Rol</label>
        <select class="form-input" id="um-role">
          ${ROLES.map(r=>`<option value="${r}" ${user?.role===r?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>
      <div id="um-perms-wrap" style="margin-bottom:10px;display:${user?.role==='inventarios'?'':'none'}">
        <label style="font-weight:600;font-size:.8rem;display:block;margin-bottom:6px">Permisos por inventario</label>
        ${INV_KEYS.map(k=>`<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <input type="checkbox" class="um-perm" value="${k}" ${(user?.permisos_inv||[]).includes(k)?'checked':''}/>
          ${esc(INV_TYPES.find(t=>t.key===k)?.label||k)}
        </label>`).join('')}
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="um-activo" ${user?.activo!==false?'checked':''}/> Activo
        </label>
      </div>
      <div id="um-err" class="alert alert-error" style="display:none"></div>
      <button class="btn btn-primary btn-block" id="um-save">Guardar</button>
    `);
    document.getElementById('um-role').onchange = function() {
      document.getElementById('um-perms-wrap').style.display = this.value === 'inventarios' ? '' : 'none';
    };
    document.getElementById('um-save').onclick = async () => {
      const nombre = document.getElementById('um-nombre').value.trim();
      const email  = document.getElementById('um-email').value.trim();
      const pass   = document.getElementById('um-pass').value;
      const role   = document.getElementById('um-role').value;
      const activo = document.getElementById('um-activo').checked;
      const permisos_inv = role === 'inventarios'
        ? [...document.querySelectorAll('.um-perm:checked')].map(c => c.value)
        : [];
      const errEl = document.getElementById('um-err');
      errEl.style.display = 'none';
      if (!nombre || !email) { errEl.textContent = 'Nombre y email son requeridos'; errEl.style.display = ''; return; }
      if (isNew && !pass) { errEl.textContent = 'La contraseña es requerida'; errEl.style.display = ''; return; }
      const body = { nombre, email, role, permisos_inv, activo };
      if (pass) body.password = pass;
      const r = isNew ? await apiPost('/users', body) : await apiPut('/users/'+user.id, body);
      if (!r) return;
      const d = await r.json();
      if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
      closeModal();
      const users = await load();
      renderPage(users);
    };
  }

  window.editUser = async (id) => {
    const users = await load();
    const user = users.find(u => u.id === id);
    if (user) openUserModal(user);
  };
  window.deleteUser = async (id) => {
    if (!confirm('¿Eliminar usuario?')) return;
    const r = await apiDel('/users/'+id);
    if (r?.ok) { const users = await load(); renderPage(users); }
  };

  const users = await load();
  renderPage(users);
}

// ── ADMIN ITEMS ───────────────────────────────────────────────────────────────
// ── Buscador de catálogo de compras (compartido) ──────────────────────────────
function buildComprasSearchWidget(catalogCompras, addedKeys, onSelect) {
  // Returns HTML string + a function to wire events after insertion
  const html = `
    <div class="form-group" style="margin-bottom:6px">
      <label>Ligar a catálogo de Compras <span style="color:#999;font-weight:400">(para requisiciones)</span></label>
      <input class="form-input" id="im-search" placeholder="Buscar por nombre o código..." autocomplete="off"/>
    </div>
    <div id="im-search-list" style="max-height:180px;overflow-y:auto;border:1px solid #e0e4ec;border-radius:8px;margin-bottom:10px;display:none"></div>
    <div id="im-selected-compras" style="display:none;margin-bottom:10px" class="alert alert-info"></div>
    <input type="hidden" id="im-cat-id"/>
    <input type="hidden" id="im-cat-label"/>
    <input type="hidden" id="im-cat-unit"/>
    <input type="hidden" id="im-cat-supplier"/>
  `;
  function wire() {
    const searchInput = document.getElementById('im-search');
    const listEl      = document.getElementById('im-search-list');
    const selInfo     = document.getElementById('im-selected-compras');

    function renderResults(q) {
      const term = q.toLowerCase().trim();
      if (!term) { listEl.style.display = 'none'; return; }
      const matches = catalogCompras
        .filter(c => !addedKeys.has(`c_${c.id}`) &&
          (c.name.toLowerCase().includes(term) || (c.sku||'').toLowerCase().includes(term)))
        .slice(0, 40);
      if (!matches.length) {
        listEl.innerHTML = '<div style="padding:10px 14px;color:#999;font-size:.85rem">Sin resultados</div>';
        listEl.style.display = ''; return;
      }
      listEl.innerHTML = matches.map(c =>
        `<div class="csr-item" data-id="${c.id}" style="padding:9px 14px;cursor:pointer;border-bottom:1px solid #f0f2f5;font-size:.88rem">
          <strong>${esc(c.name)}</strong>
          ${c.sku ? `<span style="color:#999;margin-left:8px;font-size:.8rem">${esc(c.sku)}</span>` : ''}
          ${c.supplier_name ? `<span style="float:right;color:#059669;font-size:.8rem">${esc(c.supplier_name)}</span>` : ''}
        </div>`
      ).join('');
      listEl.style.display = '';
      listEl.querySelectorAll('.csr-item').forEach(el => {
        el.onmouseover = () => el.style.background = '#f0f7ff';
        el.onmouseout  = () => el.style.background = '';
        el.onclick = () => {
          const c = matches.find(x => x.id === Number(el.dataset.id));
          if (!c) return;
          document.getElementById('im-cat-id').value       = c.id;
          document.getElementById('im-cat-label').value    = c.name;
          document.getElementById('im-cat-unit').value     = c.unit || '';
          document.getElementById('im-cat-supplier').value = c.supplier_name || '';
          selInfo.textContent = `✓ ${c.name}${c.supplier_name ? ' — '+c.supplier_name : ''}`;
          selInfo.style.display = '';
          listEl.style.display  = 'none';
          searchInput.value = c.name;
          if (onSelect) onSelect(c);
        };
      });
    }

    searchInput.oninput = () => renderResults(searchInput.value);
    document.addEventListener('click', function hide(e) {
      if (!listEl.contains(e.target) && e.target !== searchInput) {
        listEl.style.display = 'none';
        document.removeEventListener('click', hide);
      }
    });
  }
  return { html, wire };
}

async function renderAdminItems(main) {
  let selType = INV_TYPES[0].key;
  let catalogVales   = [];
  let catalogCompras = [];

  // Pre-cargar catálogos externos
  const [rv, rc] = await Promise.all([apiGet('/catalog/vales-items'), apiGet('/catalog/compras-items')]);
  if (rv?.ok)  catalogVales   = await rv.json();
  if (rc?.ok)  catalogCompras = await rc.json();

  async function loadItems() {
    const r = await apiGet('/items-config?inv_type=' + selType);
    return r?.ok ? r.json() : [];
  }

  function renderPage(items) {
    const isVales = selType === 'quimicos_proceso';

    // Agrupar por proveedor
    const groups = [];
    const seen   = new Map();
    for (const i of items) {
      const prov = i.proveedor || '(Sin proveedor)';
      if (!seen.has(prov)) { seen.set(prov, []); groups.push(prov); }
      seen.get(prov).push(i);
    }

    let tbody = '';
    for (const prov of groups) {
      const provItems = seen.get(prov);
      tbody += `<tr style="background:#f0f7ff">
        <td colspan="${isVales ? 8 : 7}" style="font-weight:700;font-size:.8rem;color:#1d4ed8;padding:6px 12px;letter-spacing:.04em">
          🏢 ${esc(prov)} <span style="font-weight:400;color:#666">(${provItems.length})</span>
        </td>
      </tr>`;
      tbody += provItems.map(i => `<tr>
        <td>${esc(i.item_label)}</td>
        <td>${esc(i.proveedor||'—')}</td>
        ${isVales ? `<td>${i.densidad != null ? fmt(i.densidad,4) : '—'}</td>` : ''}
        <td class="text-right">${i.min_val ?? '—'}</td>
        <td class="text-right">${i.max_val ?? '—'}</td>
        <td>${esc(i.unidad||'—')}</td>
        ${isVales ? `<td>${i.peso_kg ? fmt(i.peso_kg)+' kg' : '—'}</td>` : ''}
        <td><span class="badge ${i.activo!==false?'badge-green':'badge-gray'}">${i.activo!==false?'Activo':'Inactivo'}</span></td>
        <td class="td-actions">
          <button class="btn btn-outline btn-sm" onclick="editItem(${i.id})">Editar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteItem(${i.id})">Eliminar</button>
        </td>
      </tr>`).join('');
    }

    main.innerHTML = `
      <div class="page-title">📋 Items por Inventario</div>
      <div class="card">
        <div class="toolbar">
          <select class="form-input" id="ai-type" style="width:220px">
            ${INV_TYPES.map(t=>`<option value="${t.key}" ${t.key===selType?'selected':''}>${esc(t.label)}</option>`).join('')}
          </select>
          ${isVales
            ? `<button class="btn btn-success btn-sm" id="sync-vales-btn">↻ Sincronizar desde Vales</button>
               <button class="btn btn-primary btn-sm" id="add-item-btn">+ Agregar item</button>`
            : `<button class="btn btn-primary btn-sm" id="add-item-btn">+ Agregar item del catálogo</button>`
          }
        </div>
        ${items.length ? `<div class="table-wrap"><table>
          <thead><tr>
            <th>Nombre</th><th>Proveedor</th>
            ${isVales ? '<th>Densidad</th>' : ''}
            <th>Min</th><th>Max</th><th>Unidad</th>
            ${isVales ? '<th>Peso/tambo</th>' : ''}
            <th>Estado</th><th></th>
          </tr></thead>
          <tbody>${tbody}</tbody>
        </table></div>` : `<div class="empty-msg">${isVales ? 'Sin items. Usa "Sincronizar desde Vales" para importar todos.' : 'Sin items para este inventario'}</div>`}
      </div>
    `;

    document.getElementById('ai-type').onchange = async function() {
      selType = this.value;
      const its = await loadItems();
      renderPage(its);
    };
    document.getElementById('add-item-btn').onclick = () => openItemModal(null);

    if (isVales) {
      document.getElementById('sync-vales-btn').onclick = async () => {
        if (!confirm('¿Importar todos los productos activos del catálogo de Vales a Quimicos Proceso? Solo se agregan los que no existen aún.')) return;
        const r = await apiPost('/items-config/sync-vales', {});
        if (!r) return;
        const d = await r.json();
        if (!r.ok) { alert('Error: ' + d.error); return; }
        alert(`✓ Sincronización completa.\n${d.created} items nuevos agregados (${d.total} en catálogo).`);
        const its = await loadItems();
        renderPage(its);
      };
    }
  }

  // ── Modal agregar item ───────────────────────────────────────────────────────
  function openItemModal(item) {
    const isNew    = !item;
    const isVales  = selType === 'quimicos_proceso';

    if (isNew && isVales) {
      // ── Quimicos Proceso: dropdown de items_vales + opcional link a compras ──
      loadItems().then(existing => {
        const addedKeys  = new Set(existing.map(i => i.item_key));
        const available  = catalogVales.filter(v => !addedKeys.has(`v_${v.id}`));
        // Map id → catalog object para acceso sin data-attributes
        const valesMap   = Object.fromEntries(catalogVales.map(v => [v.id, v]));

        const comprasWidget = buildComprasSearchWidget(catalogCompras, new Set(), null);

        openModal('Agregar item — Quimicos Proceso', `
          <div class="form-group" style="margin-bottom:12px">
            <label>Producto del catálogo de Vales</label>
            <select class="form-input" id="im-vales-sel">
              <option value="">— Seleccionar producto —</option>
              ${available.map(v =>
                `<option value="${v.id}">${esc(v.nombre)}${v.proveedor ? ' ['+esc(v.proveedor)+']' : ''}${v.peso_kg ? ' — '+v.peso_kg+' kg/tambo' : ''}</option>`
              ).join('')}
            </select>
          </div>
          <div id="im-vales-detail" style="display:none">
            <div class="alert alert-info" id="im-vales-info" style="margin-bottom:10px"></div>
            <div class="form-row cols-2" style="margin-bottom:10px">
              <div class="form-group"><label>Min (kg)</label><input type="number" class="form-input" id="im-min" step="0.01"/></div>
              <div class="form-group"><label>Max (kg)</label><input type="number" class="form-input" id="im-max" step="0.01"/></div>
            </div>
            <div class="form-row cols-2" style="margin-bottom:10px">
              <div class="form-group"><label>Peso por tambo (kg)</label><input type="number" class="form-input" id="im-peso" step="0.01"/></div>
              <div class="form-group"><label>Densidad</label><input type="number" class="form-input" id="im-densidad" step="0.0001"/></div>
            </div>
            <div class="form-row cols-2" style="margin-bottom:12px">
              <div class="form-group"><label>Unidad</label><input class="form-input" id="im-unidad" value="KG"/></div>
              <div class="form-group"><label>Proveedor</label><input class="form-input" id="im-proveedor" placeholder="Auto-llenado"/></div>
            </div>
            <hr class="divider"/>
            ${comprasWidget.html}
          </div>
          <div id="im-err" class="alert alert-error" style="display:none"></div>
          <button class="btn btn-primary btn-block" id="im-save" disabled>Agregar item</button>
        `);

        comprasWidget.wire();

        document.getElementById('im-vales-sel').onchange = function() {
          const detail  = document.getElementById('im-vales-detail');
          const saveBtn = document.getElementById('im-save');
          if (!this.value) { detail.style.display = 'none'; saveBtn.disabled = true; return; }
          const v = valesMap[Number(this.value)];
          if (!v) return;
          detail.style.display = '';
          saveBtn.disabled = false;
          document.getElementById('im-peso').value      = v.peso_kg    ?? '';
          document.getElementById('im-densidad').value  = v.densidad   ?? '';
          document.getElementById('im-proveedor').value = v.proveedor  ?? '';
          document.getElementById('im-vales-info').textContent =
            `${v.nombre}${v.proveedor ? ' · '+v.proveedor : ''}${v.peso_kg ? ' · '+v.peso_kg+' kg/tambo' : ''}`;
        };

        document.getElementById('im-save').onclick = async () => {
          const selEl    = document.getElementById('im-vales-sel');
          if (!selEl.value) return;
          const v        = valesMap[Number(selEl.value)];
          if (!v) return;
          const item_key  = `v_${v.id}`;
          const peso_kg   = document.getElementById('im-peso').value      ? Number(document.getElementById('im-peso').value)     : null;
          const densidad  = document.getElementById('im-densidad').value  ? Number(document.getElementById('im-densidad').value) : null;
          const proveedor = document.getElementById('im-proveedor').value.trim() || null;
          const min_val   = document.getElementById('im-min').value !== '' ? Number(document.getElementById('im-min').value) : null;
          const max_val   = document.getElementById('im-max').value !== '' ? Number(document.getElementById('im-max').value) : null;
          const unidad    = document.getElementById('im-unidad').value.trim() || 'KG';
          const catId     = document.getElementById('im-cat-id').value;
          const errEl     = document.getElementById('im-err');
          errEl.style.display = 'none';
          const r = await apiPost('/items-config', {
            inv_type: selType, item_key, item_label: v.nombre,
            min_val, max_val, unidad, peso_kg, densidad, proveedor,
            vales_item_id: v.id,
            compras_item_id: catId ? Number(catId) : null,
            activo: true
          });
          if (!r) return;
          const d = await r.json();
          if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
          closeModal();
          const its = await loadItems();
          renderPage(its);
        };
      });
      return;

    } else if (isNew && !isVales) {
      // ── EPP / Insumos / Titulacion: buscador de catalog_items ──
      loadItems().then(existing => {
        const addedKeys    = new Set(existing.map(i => i.item_key));
        const comprasWidget = buildComprasSearchWidget(catalogCompras, addedKeys, (c) => {
          // Auto-fill cuando se selecciona del catálogo
          document.getElementById('im-unidad').value    = c.unit || '';
          document.getElementById('im-proveedor').value = c.supplier_name || '';
          document.getElementById('im-detail-fields').style.display = '';
          document.getElementById('im-save').disabled = false;
        });

        openModal(`Agregar item — ${INV_TYPES.find(t=>t.key===selType)?.label}`, `
          ${comprasWidget.html}
          <div id="im-detail-fields" style="display:none">
            <div class="form-row cols-2" style="margin-bottom:10px">
              <div class="form-group"><label>Minimo (alerta)</label><input type="number" class="form-input" id="im-min" step="0.01"/></div>
              <div class="form-group"><label>Maximo</label><input type="number" class="form-input" id="im-max" step="0.01"/></div>
            </div>
            <div class="form-row cols-2" style="margin-bottom:14px">
              <div class="form-group"><label>Unidad</label><input class="form-input" id="im-unidad" placeholder="pza, kg, lt..."/></div>
              <div class="form-group"><label>Proveedor</label><input class="form-input" id="im-proveedor" placeholder="Auto-llenado"/></div>
            </div>
          </div>
          <div id="im-err" class="alert alert-error" style="display:none"></div>
          <button class="btn btn-primary btn-block" id="im-save" disabled>Agregar item</button>
        `);

        comprasWidget.wire();

        document.getElementById('im-save').onclick = async () => {
          const catId      = document.getElementById('im-cat-id').value;
          const catLabel   = document.getElementById('im-cat-label').value;
          if (!catId || !catLabel) { document.getElementById('im-err').textContent = 'Selecciona un item del catálogo'; document.getElementById('im-err').style.display = ''; return; }
          const min_val    = document.getElementById('im-min').value !== '' ? Number(document.getElementById('im-min').value) : null;
          const max_val    = document.getElementById('im-max').value !== '' ? Number(document.getElementById('im-max').value) : null;
          const unidad     = document.getElementById('im-unidad').value.trim() || null;
          const proveedor  = document.getElementById('im-proveedor').value.trim() || null;
          const errEl      = document.getElementById('im-err');
          errEl.style.display = 'none';
          const r = await apiPost('/items-config', {
            inv_type: selType, item_key: `c_${catId}`, item_label: catLabel,
            min_val, max_val, unidad, proveedor,
            compras_item_id: Number(catId), activo: true
          });
          if (!r) return;
          const d = await r.json();
          if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
          closeModal();
          const its = await loadItems();
          renderPage(its);
        };
      });
      return;

    } else {
      // ── Editar item existente ──
      const showPeso = selType === 'quimicos_proceso';
      openModal('Editar item', `
        <div class="alert alert-info" style="margin-bottom:14px">${esc(item.item_label)}</div>
        <div class="form-row cols-2" style="margin-bottom:10px">
          <div class="form-group"><label>Minimo (alerta)</label><input type="number" class="form-input" id="im-min" value="${item.min_val??''}" step="0.01"/></div>
          <div class="form-group"><label>Maximo</label><input type="number" class="form-input" id="im-max" value="${item.max_val??''}" step="0.01"/></div>
        </div>
        <div class="form-row cols-2" style="margin-bottom:10px">
          <div class="form-group"><label>Unidad</label><input class="form-input" id="im-unidad" value="${esc(item.unidad||'')}"/></div>
          <div class="form-group"><label>Proveedor</label><input class="form-input" id="im-proveedor" value="${esc(item.proveedor||'')}"/></div>
        </div>
        ${showPeso ? `<div class="form-row cols-2" style="margin-bottom:10px">
          <div class="form-group"><label>Peso por tambo (kg)</label><input type="number" class="form-input" id="im-peso" value="${item.peso_kg??''}" step="0.01"/></div>
          <div class="form-group"><label>Densidad</label><input type="number" class="form-input" id="im-densidad" value="${item.densidad??''}" step="0.0001"/></div>
        </div>` : ''}
        <div class="form-group" style="margin-bottom:16px">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="im-activo" ${item.activo!==false?'checked':''}/> Activo
          </label>
        </div>
        <div id="im-err" class="alert alert-error" style="display:none"></div>
        <button class="btn btn-primary btn-block" id="im-save">Guardar</button>
      `);
      document.getElementById('im-save').onclick = async () => {
        const min_val   = document.getElementById('im-min').value !== '' ? Number(document.getElementById('im-min').value) : null;
        const max_val   = document.getElementById('im-max').value !== '' ? Number(document.getElementById('im-max').value) : null;
        const unidad    = document.getElementById('im-unidad').value.trim() || null;
        const proveedor = document.getElementById('im-proveedor').value.trim() || null;
        const peso_kg   = showPeso && document.getElementById('im-peso')?.value   ? Number(document.getElementById('im-peso').value)    : null;
        const densidad  = showPeso && document.getElementById('im-densidad')?.value ? Number(document.getElementById('im-densidad').value) : null;
        const activo    = document.getElementById('im-activo').checked;
        const errEl     = document.getElementById('im-err');
        errEl.style.display = 'none';
        const r = await apiPut('/items-config/'+item.id, { min_val, max_val, unidad, proveedor, peso_kg, densidad, activo });
        if (!r) return;
        const d = await r.json();
        if (!r.ok) { errEl.textContent = d.error; errEl.style.display = ''; return; }
        closeModal();
        const its = await loadItems();
        renderPage(its);
      };
    }
  }

  window.editItem = async (id) => {
    const its = await loadItems();
    const it = its.find(i => i.id === id);
    if (it) openItemModal(it);
  };
  window.deleteItem = async (id) => {
    if (!confirm('¿Eliminar este item?')) return;
    const r = await apiDel('/items-config/'+id);
    if (r?.ok) { const its = await loadItems(); renderPage(its); }
  };

  const items = await loadItems();
  renderPage(items);
}

// ── ADMIN CONFIG (form names) ──────────────────────────────────────────────────
async function renderAdminConfig(main) {
  const r = await apiGet('/config');
  const cfgs = r?.ok ? await r.json() : [];

  function renderPage(cfgs) {
    const rows = cfgs.map(c => `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title" style="margin-bottom:12px">${esc(INV_TYPES.find(t=>t.key===c.inv_type)?.label||c.inv_type)}</div>
        <div class="form-row cols-3">
          <div class="form-group">
            <label>Codigo de Formulario</label>
            <input class="form-input cfg-code" data-type="${c.inv_type}" value="${esc(c.form_code||'')}"/>
          </div>
          <div class="form-group">
            <label>Revision</label>
            <input class="form-input cfg-rev" data-type="${c.inv_type}" value="${esc(c.form_rev||'')}"/>
          </div>
          <div class="form-group">
            <label>Titulo del Formulario</label>
            <input class="form-input cfg-title" data-type="${c.inv_type}" value="${esc(c.form_title||'')}"/>
          </div>
        </div>
        <div style="margin-top:10px">
          <button class="btn btn-primary btn-sm" onclick="saveConfig('${c.inv_type}')">Guardar</button>
        </div>
      </div>
    `).join('');
    main.innerHTML = `<div class="page-title">⚙️ Configuracion de Formularios</div>${rows}`;
  }

  window.saveConfig = async (inv_type) => {
    const form_code  = document.querySelector(`.cfg-code[data-type="${inv_type}"]`).value.trim();
    const form_rev   = document.querySelector(`.cfg-rev[data-type="${inv_type}"]`).value.trim();
    const form_title = document.querySelector(`.cfg-title[data-type="${inv_type}"]`).value.trim();
    const r = await apiPut(`/config/${inv_type}`, { form_code, form_rev, form_title });
    if (r?.ok) alert('Guardado exitosamente.');
    else alert('Error al guardar');
  };

  renderPage(cfgs);
}

// ── Init ──────────────────────────────────────────────────────────────────────
if (TOKEN && ME) {
  showApp();
} else {
  showLogin();
}
