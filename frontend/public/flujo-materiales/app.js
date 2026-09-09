/* ═══════════════════════════════════════════════════════════════════════════════
   Flujo de Materiales — SPA
   ═══════════════════════════════════════════════════════════════════════════════ */
'use strict';

// ── STATE ────────────────────────────────────────────────────────────────────
const S = {
  user: null, token: null, section: 'tenneco-ingreso',
  // caches
  partes: [], specs: [], defectos: [], asmPartes: [], asmDefectos: [],
  lotes: [], muestras: [], remisiones: [], lotesListos: [], pos: [],
  appStatus: [],
  // sort
  sortCol: null, sortDir: 'asc'
};

// ── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (S.token) opts.headers.Authorization = 'Bearer ' + S.token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api/flujo' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); return; }
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}
const GET   = p       => api('GET', p);
const POST  = (p, b)  => api('POST', p, b);
const PATCH = (p, b)  => api('PATCH', p, b);
const DEL   = p       => api('DELETE', p);

async function apiUpload(path, formData) {
  const opts = { method: 'POST', headers: {}, body: formData };
  if (S.token) opts.headers.Authorization = 'Bearer ' + S.token;
  const res = await fetch('/api/flujo' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); return; }
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

// ── SESSION ──────────────────────────────────────────────────────────────────
function tryRestore() {
  const t = localStorage.getItem('flujo_token');
  const u = localStorage.getItem('flujo_user');
  if (t && u) { S.token = t; S.user = JSON.parse(u); return true; }
  return false;
}
function saveSession(token, user) {
  S.token = token; S.user = user;
  localStorage.setItem('flujo_token', token);
  localStorage.setItem('flujo_user', JSON.stringify(user));
}
function logout() {
  S.token = null; S.user = null;
  localStorage.removeItem('flujo_token');
  localStorage.removeItem('flujo_user');
  render();
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtNum(n) { return n != null ? Number(n).toLocaleString('es-MX') : ''; }
function fmtPct(n) { return n != null ? (n * 100).toFixed(1) + '%' : '0%'; }
function isoWeekNow() {
  const d = new Date(); d.setHours(12,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

// ── PERMISOS ─────────────────────────────────────────────────────────────────
function can(action) {
  const r = S.user?.role;
  if (r === 'admin') return true;
  switch (action) {
    case 'edit-inventarios': return r === 'supervisor';
    case 'edit-empaque':     return r === 'calidad';
    case 'edit-catalogos':   return r === 'calidad';
    default: return false;
  }
}

// ── MENU ─────────────────────────────────────────────────────────────────────
const MENU = [
  { group: 'Inventarios', items: [
    { id: 'tenneco-pos',      icon: '📋', label: 'Control PO Tenneco' },
    { id: 'tenneco-ingreso',  icon: '📥', label: 'Ingreso Tenneco' },
    { id: 'tenneco-salida',   icon: '📤', label: 'Salida Tenneco' },
    { id: 'tenneco-kpi',      icon: '📊', label: 'KPI Tenneco' },
    { id: 'asm-ingreso',      icon: '📥', label: 'Ingreso ASM', disabled: true },
    { id: 'asm-salida',       icon: '📤', label: 'Salida ASM', disabled: true },
    { id: 'asm-kpi',          icon: '📊', label: 'KPI ASM', disabled: true },
  ]},
  { group: 'Empaque e Inspeccion', items: [
    { id: 'empaque-tenneco',  icon: '🔍', label: 'Empaque Tenneco' },
    { id: 'empaque-asm',      icon: '🔍', label: 'Empaque Amsted', disabled: true },
  ]},
  { group: 'Catalogos', items: [
    { id: 'cat-tenneco-proyectos', icon: '📁', label: 'Proyectos Tenneco' },
    { id: 'cat-tenneco-partes',   icon: '⚙', label: 'N/P Tenneco' },
    { id: 'cat-tenneco-specs',    icon: '📏', label: 'Especificaciones' },
    { id: 'cat-tenneco-defectos', icon: '⚠', label: 'Defectos Tenneco' },
    { id: 'cat-asm-partes',       icon: '⚙', label: 'N/P Amsted' },
    { id: 'cat-asm-defectos',     icon: '⚠', label: 'Defectos Amsted' },
  ]},
];

// ── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!S.user) { app.innerHTML = renderLogin(); bindLogin(); return; }
  app.innerHTML = renderLayout();
  bindNav();
  renderMain();
}

function renderLogin() {
  return `<div class="login-wrap"><div class="login-card">
    <span class="icon">📦</span>
    <h2>Flujo de Materiales</h2>
    <p>Ingresa con tus credenciales asignadas</p>
    <div class="login-error" id="login-err"></div>
    <input class="fm-input" id="login-email" placeholder="Email" autocomplete="username"/>
    <input class="fm-input" id="login-pass" type="password" placeholder="Contrasena" autocomplete="current-password"/>
    <button class="fm-btn fm-btn-primary" id="btn-login">Ingresar</button>
  </div></div>`;
}

function bindLogin() {
  const btn = $('#btn-login');
  const doLogin = async () => {
    const email = $('#login-email').value.trim();
    const pass  = $('#login-pass').value;
    if (!email || !pass) return;
    btn.disabled = true; btn.textContent = 'Ingresando...';
    try {
      const d = await POST('/auth/login', { email, password: pass });
      saveSession(d.token, d.user);
      render();
    } catch (e) {
      const el = $('#login-err');
      el.textContent = e.message; el.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Ingresar';
    }
  };
  btn.addEventListener('click', doLogin);
  $('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

function renderLayout() {
  const menuHtml = MENU.map(g => `
    <div class="fm-nav-group">
      <div class="fm-nav-group-title">${esc(g.group)}</div>
      ${g.items.map(it => `
        <div class="fm-nav-item${it.id === S.section ? ' active' : ''}${it.disabled ? ' disabled' : ''}" data-nav="${it.id}">
          <span class="icon">${it.icon}</span>${esc(it.label)}
        </div>
      `).join('')}
    </div>
  `).join('');

  return `<div class="fm-layout">
    <aside class="fm-sidebar">
      <div class="fm-sidebar-brand"><h1>Flujo de Materiales</h1><p>Tenneco / Amsted</p></div>
      <nav class="fm-nav">${menuHtml}</nav>
      <div class="fm-sidebar-footer">
        <div class="user-name">${esc(S.user.nombre)}</div>
        <div style="color:#64748b;font-size:11px;margin-top:2px">${esc(S.user.role)}</div>
        <button class="btn-logout" id="btn-logout">Cerrar sesion</button>
      </div>
    </aside>
    <div class="fm-main">
      <div class="fm-topbar"><h2 id="topbar-title">Cargando...</h2></div>
      <div class="fm-content" id="fm-content"><div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div></div>
    </div>
  </div>`;
}

function bindNav() {
  $$('[data-nav]').forEach(el => {
    el.addEventListener('click', () => { S.section = el.dataset.nav; S.sortCol = null; renderNavActive(); renderMain(); });
  });
  $('#btn-logout').addEventListener('click', logout);
}
function renderNavActive() {
  $$('.fm-nav-item').forEach(el => el.classList.toggle('active', el.dataset.nav === S.section));
}

const SECTION_TITLES = {
  'tenneco-pos': 'Control PO Tenneco', 'tenneco-ingreso': 'Ingreso Tenneco', 'tenneco-salida': 'Salida Tenneco', 'tenneco-kpi': 'KPI Tenneco',
  'empaque-tenneco': 'Empaque Tenneco', 'empaque-asm': 'Empaque Amsted',
  'cat-tenneco-proyectos': 'Proyectos Tenneco', 'cat-tenneco-partes': 'Catalogo N/P Tenneco', 'cat-tenneco-specs': 'Especificaciones Tenneco',
  'cat-tenneco-defectos': 'Catalogo Defectos Tenneco',
  'cat-asm-partes': 'Catalogo N/P Amsted', 'cat-asm-defectos': 'Catalogo Defectos Amsted'
};

async function renderMain() {
  const el = $('#fm-content');
  const tb = $('#topbar-title');
  tb.textContent = SECTION_TITLES[S.section] || S.section;
  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
  try {
    switch (S.section) {
      case 'tenneco-pos':          await viewControlPOs(el); break;
      case 'tenneco-ingreso':      await viewIngresoTenneco(el); break;
      case 'tenneco-salida':       await viewSalidaTenneco(el); break;
      case 'tenneco-kpi':          await viewKpiTenneco(el); break;
      case 'empaque-tenneco':      await viewEmpaqueTenneco(el); break;
      case 'cat-tenneco-proyectos': await viewCatProyectos(el); break;
      case 'cat-tenneco-partes':   await viewCatPartes(el, 'tenneco'); break;
      case 'cat-tenneco-specs':    await viewCatSpecs(el); break;
      case 'cat-tenneco-defectos': await viewCatDefectos(el, 'tenneco'); break;
      case 'cat-asm-partes':       await viewCatPartesAsm(el); break;
      case 'cat-asm-defectos':     await viewCatDefectos(el, 'asm'); break;
      default: el.innerHTML = '<div class="empty-state"><div class="icon">🚧</div><p>Proximamente</p></div>';
    }
  } catch (e) {
    el.innerHTML = `<div class="fm-alert fm-alert-danger">Error: ${esc(e.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGRESO TENNECO
// ═══════════════════════════════════════════════════════════════════════════════
async function viewIngresoTenneco(el) {
  S.lotes = await GET('/tenneco/lotes');
  S.partes = await GET('/cat/tenneco/partes');

  // Default: ultimo mes + pendientes
  const hoy = new Date();
  const mesAtras = new Date(hoy); mesAtras.setMonth(mesAtras.getMonth() - 1);
  const desdeDefault = mesAtras.toISOString().slice(0, 10);

  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar">
        <label>Desde <input class="fm-input" type="date" id="f-desde" value="${desdeDefault}"/></label>
        <label>Hasta <input class="fm-input" type="date" id="f-hasta"/></label>
        <label>Estado <select class="fm-input" id="f-estado"><option value="">Todos</option><option value="abierto">Abierto</option><option value="cerrado">Cerrado</option><option value="enviado">Enviado</option></select></label>
        <input class="fm-input" id="f-buscar" placeholder="Buscar..." style="min-width:160px"/>
        <div style="flex:1"></div>
        ${can('edit-inventarios') ? '<button class="fm-btn fm-btn-primary fm-btn-sm" id="btn-nueva-recep">+ Registrar recepcion</button>' : ''}
        <button class="fm-btn fm-btn-outline fm-btn-sm" id="btn-exportar">Exportar Excel</button>
      </div>
      <div class="fm-table-wrap"><table class="fm-table" id="tbl-lotes">
        <thead><tr>
          <th data-col="fecha_recepcion">Fecha</th><th data-col="semana">Sem</th>
          <th data-col="folio_salida_tenneco">Folio</th><th data-col="enviado_por">Enviado por</th>
          <th data-col="numero_parte">N/P</th><th data-col="diametro">Diam.</th>
          <th data-col="cliente_int">Cliente</th><th data-col="lote">Lote</th>
          <th data-col="cantidad_recibida" class="text-right">Recepcion</th>
          <th data-col="material_por_procesar" class="text-right">x Proc.</th>
          <th data-col="material_procesando" class="text-right">Proc.</th>
          <th data-col="material_terminado" class="text-right">Termin.</th>
          <th data-col="scrap_total" class="text-right">Scrap</th>
          <th data-col="enviado" class="text-right">Enviado</th>
          <th data-col="progreso">Progreso</th>
          <th data-col="pct_scrap" class="text-right">% Scrap</th>
          ${S.user?.role === 'admin' ? '<th></th>' : ''}
        </tr></thead>
        <tbody id="tbody-lotes"></tbody>
      </table></div>
    </div>`;

  const renderRows = () => {
    let data = [...S.lotes];
    const desde = $('#f-desde').value;
    const hasta = $('#f-hasta').value;
    const estado = $('#f-estado').value;
    const buscar = $('#f-buscar').value.toLowerCase();
    if (desde) data = data.filter(l => l.fecha_recepcion >= desde);
    if (hasta) data = data.filter(l => l.fecha_recepcion <= hasta);
    if (estado) data = data.filter(l => l.estado === estado);
    if (buscar) data = data.filter(l =>
      (l.numero_parte || '').toLowerCase().includes(buscar) ||
      (l.lote || '').toLowerCase().includes(buscar) ||
      (l.cliente_int || '').toLowerCase().includes(buscar) ||
      (l.enviado_por || '').toLowerCase().includes(buscar) ||
      (l.folio_salida_tenneco || '').toLowerCase().includes(buscar)
    );
    // Sort
    if (S.sortCol) {
      data.sort((a, b) => {
        let va = a[S.sortCol] ?? '', vb = b[S.sortCol] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return S.sortDir === 'asc' ? va - vb : vb - va;
        return S.sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    } else {
      data.sort((a, b) => (a.fecha_recepcion || '').localeCompare(b.fecha_recepcion || ''));
    }

    const tbody = $('#tbody-lotes');
    const isAdm = S.user?.role === 'admin';
    const cols = isAdm ? 17 : 16;
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center" style="color:var(--fm-muted);padding:30px">Sin registros</td></tr>`; return; }
    tbody.innerHTML = data.map(l => `<tr>
      <td>${esc(l.fecha_recepcion || '')}</td><td class="text-center">${l.semana || ''}</td>
      <td class="mono">${esc(l.folio_salida_tenneco || '')}</td><td>${esc(l.enviado_por || '')}</td>
      <td class="mono">${esc(l.numero_parte || '')}</td><td>${esc(l.diametro || '')}</td>
      <td>${esc(l.cliente_int || '')}</td><td class="mono">${esc(l.lote || '')}</td>
      <td class="text-right">${fmtNum(l.cantidad_recibida)}</td>
      <td class="text-right">${fmtNum(l.material_por_procesar)}</td>
      <td class="text-right">${fmtNum(l.material_procesando)}</td>
      <td class="text-right">${fmtNum(l.material_terminado)}</td>
      <td class="text-right">${fmtNum(l.scrap_total)}</td>
      <td class="text-right">${fmtNum(l.enviado)}</td>
      <td><div class="progress-bar"><div class="bar"><div class="bar-fill" style="width:${(l.progreso || 0) * 100}%"></div></div>${fmtPct(l.progreso)}</div></td>
      <td class="text-right">${l.pct_scrap != null ? l.pct_scrap.toFixed(2) + '%' : '0%'}</td>
      ${isAdm ? `<td><button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-lote" data-id="${l.id}" title="Editar">E</button> <button class="fm-btn fm-btn-danger fm-btn-sm btn-del-lote" data-id="${l.id}" title="Eliminar">X</button></td>` : ''}
    </tr>`).join('');
    if (isAdm) {
      $$('.btn-edit-lote').forEach(b => b.addEventListener('click', () => {
        const lote = S.lotes.find(x => x.id === Number(b.dataset.id));
        if (lote) showModalEditLote(lote, renderRows);
      }));
      $$('.btn-del-lote').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Eliminar lote y sus muestras asociadas?')) return;
        try { await DEL('/tenneco/lotes/' + b.dataset.id); S.lotes = await GET('/tenneco/lotes'); renderRows(); } catch(e) { alert('Error: ' + e.message); }
      }));
    }
  };

  renderRows();

  // Filters
  ['f-desde', 'f-hasta', 'f-estado', 'f-buscar'].forEach(id => {
    $('#' + id).addEventListener('input', renderRows);
  });

  // Sort
  $$('#tbl-lotes th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (S.sortCol === col) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
      else { S.sortCol = col; S.sortDir = 'asc'; }
      $$('#tbl-lotes th').forEach(t => t.classList.remove('sorted-asc', 'sorted-desc'));
      th.classList.add(S.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      renderRows();
    });
  });

  // Exportar
  $('#btn-exportar').addEventListener('click', async () => {
    try {
      const desde = $('#f-desde').value;
      const hasta = $('#f-hasta').value;
      let url = '/tenneco/lotes/export?';
      if (desde) url += 'desde=' + desde + '&';
      if (hasta) url += 'hasta=' + hasta;
      const rows = await GET(url);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventario Tenneco');
      XLSX.writeFile(wb, `Inventario_Tenneco_${desde || 'all'}_${hasta || 'all'}.xlsx`);
    } catch (e) { alert('Error al exportar: ' + e.message); }
  });

  // Nueva recepcion
  if (can('edit-inventarios')) {
    $('#btn-nueva-recep').addEventListener('click', () => showModalRecepcion(renderRows));
  }
}

function showModalRecepcion(onSave) {
  const partes = S.partes;
  const optsD = partes.map(p => `<option value="${esc(p.diametro_mm)}">${esc(p.diametro_mm)} mm</option>`).join('');
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal">
    <h3>Registrar Recepcion</h3>
    <div class="fm-form-group"><label>Diametro (mm)</label><select class="fm-input" id="m-diam"><option value="">Seleccionar...</option>${optsD}</select></div>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Numero de parte</label><input class="fm-input fm-auto-filled" id="m-np" readonly/></div>
      <div class="fm-form-group"><label>Proyecto / Cliente</label><input class="fm-input fm-auto-filled" id="m-proy" readonly/></div>
    </div>
    <hr style="border:0;border-top:1px solid var(--fm-line);margin:14px 0"/>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Folio Salida Tenneco</label><input class="fm-input" id="m-folio" placeholder="Ej: 5201" maxlength="5"/></div>
      <div class="fm-form-group"><label>Enviado por</label><input class="fm-input" id="m-enviado" placeholder="Nombre"/></div>
    </div>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Lote (8 digitos)</label><input class="fm-input" id="m-lote" placeholder="Ej: 87601977" maxlength="8"/></div>
      <div class="fm-form-group"><label>Cantidad recibida</label><input class="fm-input" id="m-cant" type="number" min="1" placeholder="Piezas"/></div>
    </div>
    <div id="m-confirm" style="display:none" class="fm-confirm-box">
      <p id="m-confirm-text"></p>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="m-confirm-yes">Confirmar</button>
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="m-confirm-no" style="margin-left:8px">Corregir</button>
    </div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="m-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="m-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  // Auto-fill
  $('#m-diam').addEventListener('change', () => {
    const d = $('#m-diam').value;
    const p = partes.find(x => x.diametro_mm === d);
    $('#m-np').value = p ? p.numero_parte : '';
    $('#m-proy').value = p ? p.proyecto : '';
  });

  $('#m-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let confirmed = false;
  $('#m-save').addEventListener('click', () => {
    const cant = parseInt($('#m-cant').value) || 0;
    if (!$('#m-diam').value || !$('#m-lote').value || cant <= 0) {
      alert('Completa diametro, lote y cantidad'); return;
    }
    if (!confirmed) {
      $('#m-confirm').style.display = 'block';
      $('#m-confirm-text').textContent = `Confirmar ${fmtNum(cant)} piezas recibidas?`;
      return;
    }
    doSave();
  });

  $('#m-confirm-yes').addEventListener('click', () => { confirmed = true; doSave(); });
  $('#m-confirm-no').addEventListener('click', () => { $('#m-confirm').style.display = 'none'; confirmed = false; });

  async function doSave() {
    try {
      const body = {
        diametro: $('#m-diam').value,
        folio_salida_tenneco: $('#m-folio').value,
        enviado_por: $('#m-enviado').value,
        lote: $('#m-lote').value,
        cantidad_recibida: parseInt($('#m-cant').value)
      };
      await POST('/tenneco/lotes', body);
      overlay.remove();
      S.lotes = await GET('/tenneco/lotes');
      onSave();
    } catch (e) { alert('Error: ' + e.message); }
  }
}

function showModalEditLote(lote, onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal">
    <h3>Editar Lote</h3>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Folio Salida Tenneco</label><input class="fm-input" id="el-folio" value="${esc(lote.folio_salida_tenneco || '')}" maxlength="5"/></div>
      <div class="fm-form-group"><label>Enviado por</label><input class="fm-input" id="el-enviado" value="${esc(lote.enviado_por || '')}"/></div>
    </div>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Lote</label><input class="fm-input" id="el-lote" value="${esc(lote.lote || '')}" maxlength="8"/></div>
      <div class="fm-form-group"><label>Cantidad recibida</label><input class="fm-input" id="el-cant" type="number" min="1" value="${lote.cantidad_recibida || 0}"/></div>
    </div>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Diametro</label><input class="fm-input fm-auto-filled" id="el-diam" value="${esc(lote.diametro || '')}" readonly/></div>
      <div class="fm-form-group"><label>N/P</label><input class="fm-input fm-auto-filled" id="el-np" value="${esc(lote.numero_parte || '')}" readonly/></div>
    </div>
    <div class="fm-form-group"><label>Cliente</label><input class="fm-input fm-auto-filled" id="el-cli" value="${esc(lote.cliente_int || '')}" readonly/></div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="el-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="el-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  $('#el-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#el-save').addEventListener('click', async () => {
    try {
      await PATCH('/tenneco/lotes/' + lote.id, {
        folio_salida_tenneco: $('#el-folio').value,
        enviado_por: $('#el-enviado').value,
        lote: $('#el-lote').value,
        cantidad_recibida: parseInt($('#el-cant').value) || 0
      });
      overlay.remove();
      S.lotes = await GET('/tenneco/lotes');
      onSave();
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROL PO TENNECO
// ═══════════════════════════════════════════════════════════════════════════════
async function viewControlPOs(el) {
  S.pos = await GET('/tenneco/pos');
  const canEdit = can('edit-inventarios');

  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar">
        ${canEdit ? '<button class="fm-btn fm-btn-primary fm-btn-sm" id="btn-add-po">+ Registrar PO</button>' : ''}
        <input class="fm-input" id="po-buscar" placeholder="Buscar No. PO..." style="min-width:150px"/>
      </div>
      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr>
          <th>No. PO</th><th class="text-right">Cantidad PO</th><th>Tipo</th><th>Diametros</th>
          <th class="text-right">En proceso</th><th class="text-right">Enviada</th>
          <th class="text-right">% Disponible</th><th>Fecha</th><th>PDF</th><th></th>
        </tr></thead>
        <tbody id="tbody-pos"></tbody>
      </table></div>
      ${S.pos.length === 0 ? '<p style="color:var(--fm-muted);font-size:13px;margin-top:10px">Sin POs registradas</p>' : ''}
    </div>`;

  const renderPOs = () => {
    const q = ($('#po-buscar')?.value || '').toLowerCase();
    const filtered = q ? S.pos.filter(p => p.no_po.toLowerCase().includes(q)) : S.pos;
    const tbody = $('#tbody-pos');
    tbody.innerHTML = filtered.map(p => {
      const diams = (p.partes || []).map(pt => pt.diametro).join(', ');
      const pctClass = p.pct_disponible > 50 ? 'color:var(--fm-success)' : p.pct_disponible > 10 ? 'color:var(--fm-warn)' : 'color:var(--fm-danger)';
      return `<tr>
        <td class="mono" style="font-weight:700">${esc(p.no_po)}</td>
        <td class="text-right">${fmtNum(p.cantidad_po)}</td>
        <td><span class="badge-status ${p.tipo === 'cerrada' ? 'badge-cerrado' : 'badge-abierto'}">${p.tipo}</span></td>
        <td style="font-size:12px">${esc(diams)}</td>
        <td class="text-right">${fmtNum(p.cantidad_en_proceso)}</td>
        <td class="text-right">${fmtNum(p.cantidad_enviada)}</td>
        <td class="text-right" style="${pctClass};font-weight:700">${p.pct_disponible}%</td>
        <td>${esc(p.fecha_po || '')}</td>
        <td>${p.pdf_filename ? '<a href="/storage/flujo-pos/' + encodeURIComponent(p.pdf_filename) + '" target="_blank" style="color:var(--fm-primary)">Ver PDF</a>' : '-'}</td>
        <td>
          <button class="fm-btn fm-btn-outline fm-btn-sm btn-ver-po" data-id="${p.id}">Detalles</button>
          ${canEdit ? `<button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-po" data-id="${p.id}">Editar</button>` : ''}
          ${S.user?.role === 'admin' ? `<button class="fm-btn fm-btn-danger fm-btn-sm btn-del-po" data-id="${p.id}" title="Eliminar">X</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    if (filtered.length === 0 && S.pos.length > 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="color:var(--fm-muted);padding:20px">Sin resultados</td></tr>';
    }
    $$('.btn-ver-po').forEach(b => b.addEventListener('click', () => showPODetail(Number(b.dataset.id))));
    if (canEdit) {
      $$('.btn-edit-po').forEach(b => {
        const po = S.pos.find(x => x.id === Number(b.dataset.id));
        b.addEventListener('click', () => showModalPO(po, el));
      });
    }
    if (S.user?.role === 'admin') {
      $$('.btn-del-po').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Eliminar esta PO?')) return;
        try { await DEL('/tenneco/pos/' + b.dataset.id); viewControlPOs(el); } catch(e) { alert('Error: ' + e.message); }
      }));
    }
  };
  renderPOs();
  if ($('#po-buscar')) $('#po-buscar').addEventListener('input', renderPOs);
  if (canEdit && $('#btn-add-po')) $('#btn-add-po').addEventListener('click', () => showModalPO(null, el));
}

async function showModalPO(existing, parentEl) {
  const partes = await GET('/cat/tenneco/partes');
  const proyectos = await GET('/cat/tenneco/proyectos');

  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal" style="width:620px">
    <h3>${existing ? 'Editar' : 'Registrar'} PO</h3>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>No. PO</label><input class="fm-input" type="text" id="po-no" value="${existing ? esc(existing.no_po) : ''}" placeholder="Ej: 12345"/></div>
      <div class="fm-form-group"><label>Cantidad PO</label><input class="fm-input" type="number" id="po-cant" value="${existing ? existing.cantidad_po : ''}" min="1"/></div>
    </div>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Tipo</label><select class="fm-input" id="po-tipo">
        <option value="abierta"${existing && existing.tipo === 'abierta' ? ' selected' : ''}>Abierta</option>
        <option value="cerrada"${existing && existing.tipo === 'cerrada' ? ' selected' : ''}>Cerrada</option>
      </select></div>
      <div class="fm-form-group"><label>Fecha PO</label><input class="fm-input" type="date" id="po-fecha" value="${existing ? existing.fecha_po : new Date().toISOString().slice(0, 10)}"/></div>
    </div>
    <div style="margin:14px 0 8px;font-weight:700;font-size:13px">Numeros de Parte</div>
    <div id="po-partes-list"></div>
    <button class="fm-btn fm-btn-outline fm-btn-sm" id="po-add-parte" style="margin-top:8px">+ Agregar numero de parte</button>
    ${!existing ? '<div class="fm-form-group" style="margin-top:14px"><label>PDF de PO (opcional)</label><input type="file" accept=".pdf" id="po-pdf" class="fm-input"/></div>' : ''}
    <div id="po-tipo-help" class="fm-alert fm-alert-warn" style="margin-top:10px;display:none"></div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="po-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="po-save">${existing ? 'Actualizar' : 'Guardar'}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  let parteIdx = 0;
  const addParteRow = (data) => {
    const idx = parteIdx++;
    const div = document.createElement('div');
    div.className = 'fm-form-row';
    div.style.cssText = 'margin-bottom:8px;align-items:end;gap:8px';
    div.dataset.parteIdx = idx;

    const diamOpts = partes.map(p => `<option value="${esc(p.diametro_mm)}"${data && data.diametro === p.diametro_mm ? ' selected' : ''}>${esc(p.diametro_mm)} mm</option>`).join('');

    div.innerHTML = `
      <div class="fm-form-group" style="flex:1"><label>Diametro</label>
        <select class="fm-input po-diam" data-idx="${idx}"><option value="">— Seleccionar —</option>${diamOpts}</select></div>
      <div class="fm-form-group" style="flex:1"><label>N/P</label>
        <input class="fm-input fm-auto-filled po-np" data-idx="${idx}" value="${data ? esc(data.numero_parte) : ''}" readonly/></div>
      <div class="fm-form-group" style="flex:1"><label>Proyecto</label>
        <input class="fm-input fm-auto-filled po-proy" data-idx="${idx}" value="${data ? esc(data.proyecto) : ''}" readonly/></div>
      <div class="fm-form-group" style="width:100px"><label>Cantidad</label>
        <input class="fm-input po-pcant" data-idx="${idx}" type="number" min="0" value="${data && data.cantidad ? data.cantidad : ''}" placeholder="—"/></div>
      ${idx > 0 ? `<button class="fm-btn fm-btn-danger fm-btn-sm po-remove-parte" data-idx="${idx}" style="margin-bottom:1px" title="Quitar">X</button>` : '<div style="width:32px"></div>'}`;

    $('#po-partes-list').appendChild(div);

    div.querySelector('.po-diam').addEventListener('change', (e) => {
      const val = e.target.value;
      const parte = partes.find(p => p.diametro_mm === val);
      div.querySelector('.po-np').value = parte ? parte.numero_parte : '';
      div.querySelector('.po-proy').value = parte ? parte.proyecto : '';
    });

    if (idx > 0) {
      div.querySelector('.po-remove-parte').addEventListener('click', () => div.remove());
    }
  };

  // Initial partes
  if (existing && existing.partes && existing.partes.length > 0) {
    existing.partes.forEach(p => addParteRow(p));
  } else {
    addParteRow(null);
  }

  $('#po-add-parte').addEventListener('click', () => addParteRow(null));

  // Tipo help text
  const updateTipoHelp = () => {
    const h = $('#po-tipo-help');
    const tipo = $('#po-tipo').value;
    if (tipo === 'cerrada') {
      h.textContent = 'PO Cerrada: la suma de cantidades de cada parte debe ser igual a la cantidad total de la PO.';
      h.style.display = 'block';
    } else {
      h.textContent = 'PO Abierta: las cantidades por parte son opcionales, el total no puede exceder la PO.';
      h.style.display = 'block';
    }
  };
  $('#po-tipo').addEventListener('change', updateTipoHelp);
  updateTipoHelp();

  $('#po-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  $('#po-save').addEventListener('click', async () => {
    const partesRows = [...$$('#po-partes-list > div')];
    const partesArr = partesRows.map(row => ({
      diametro: row.querySelector('.po-diam').value,
      numero_parte: row.querySelector('.po-np').value,
      proyecto: row.querySelector('.po-proy').value,
      cantidad: parseInt(row.querySelector('.po-pcant').value) || null
    })).filter(p => p.diametro);

    if (partesArr.length === 0) { alert('Selecciona al menos un diametro'); return; }

    try {
      if (existing) {
        await PATCH('/tenneco/pos/' + existing.id, {
          no_po: $('#po-no').value,
          cantidad_po: parseInt($('#po-cant').value),
          tipo: $('#po-tipo').value,
          fecha_po: $('#po-fecha').value,
          partes: partesArr
        });
      } else {
        const fd = new FormData();
        fd.append('no_po', $('#po-no').value);
        fd.append('cantidad_po', $('#po-cant').value);
        fd.append('tipo', $('#po-tipo').value);
        fd.append('fecha_po', $('#po-fecha').value);
        fd.append('partes', JSON.stringify(partesArr));
        const pdfInput = $('#po-pdf');
        if (pdfInput && pdfInput.files[0]) fd.append('pdf', pdfInput.files[0]);
        await apiUpload('/tenneco/pos', fd);
      }
      overlay.remove();
      viewControlPOs(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

async function showPODetail(poId) {
  const data = await GET('/tenneco/pos/' + poId);
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';

  const diamsHtml = (data.resumen_diametros || []).map(d =>
    `<tr><td>${esc(d.diametro)} mm</td><td class="text-right">${fmtNum(d.enviada)}</td></tr>`
  ).join('');

  const remsHtml = (data.remisiones_detalle || []).map(r =>
    `<tr>
      <td class="text-right">${fmtNum(r.cantidad_po_rem)}</td>
      <td>${esc(r.fecha)}</td>
      <td class="mono">${esc(r.folio)}</td>
      <td>${r.facturado ? '<span class="badge-status badge-cerrado">' + esc(r.factura_numero) + '</span>' : '<span style="color:var(--fm-muted)">—</span>'}</td>
      <td>${r.factura_fecha ? esc(r.factura_fecha) : '—'}</td>
      <td><button class="fm-btn fm-btn-outline fm-btn-sm btn-ver-rem-po" data-id="${r.id}">Ver</button></td>
    </tr>`
  ).join('');

  const partesHtml = (data.partes || []).map(p =>
    `<span style="display:inline-block;background:var(--fm-primary-light);color:var(--fm-primary-dark);padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;margin:2px">${esc(p.diametro)} mm — ${esc(p.numero_parte)}${p.cantidad ? ' (' + fmtNum(p.cantidad) + ' pzas)' : ''}</span>`
  ).join('');

  overlay.innerHTML = `<div class="fm-modal" style="width:720px">
    <h3>PO #${esc(data.no_po)}</h3>
    <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px;margin-bottom:14px">
      <div><strong>Cantidad:</strong> ${fmtNum(data.cantidad_po)}</div>
      <div><strong>Tipo:</strong> ${data.tipo}</div>
      <div><strong>Fecha:</strong> ${esc(data.fecha_po)}</div>
      <div><strong>Enviada:</strong> ${fmtNum(data.cantidad_enviada)}</div>
      <div><strong>Disponible:</strong> <span style="font-weight:700;color:${data.pct_disponible > 50 ? 'var(--fm-success)' : data.pct_disponible > 10 ? 'var(--fm-warn)' : 'var(--fm-danger)'}">${data.pct_disponible}%</span></div>
    </div>
    <div style="margin-bottom:12px">${partesHtml}</div>
    ${data.pdf_filename ? `<p style="margin-bottom:12px"><a href="/storage/flujo-pos/${encodeURIComponent(data.pdf_filename)}" target="_blank" style="color:var(--fm-primary);font-weight:600">Descargar PDF de PO</a></p>` : ''}

    ${(data.resumen_diametros || []).length > 0 ? `<h4 style="font-size:14px;margin:14px 0 8px">Resumen por Diametro</h4>
    <div class="fm-table-wrap"><table class="fm-table fm-table-sm">
      <thead><tr><th>Diametro</th><th class="text-right">Enviada</th></tr></thead>
      <tbody>${diamsHtml}</tbody>
    </table></div>` : ''}

    <h4 style="font-size:14px;margin:14px 0 8px">Remisiones</h4>
    ${(data.remisiones_detalle || []).length === 0
      ? '<p style="color:var(--fm-muted);font-size:13px">Sin remisiones vinculadas</p>'
      : `<div class="fm-table-wrap"><table class="fm-table fm-table-sm">
        <thead><tr><th class="text-right">Cant. Enviada</th><th>Fecha envio</th><th>No. Remision</th><th>Factura</th><th>Fecha factura</th><th></th></tr></thead>
        <tbody>${remsHtml}</tbody>
      </table></div>`}

    ${(data.historial || []).length > 0 ? `<details style="margin-top:14px"><summary style="font-size:12px;font-weight:600;cursor:pointer;color:var(--fm-muted)">Historial de cambios (${data.historial.length})</summary>
      <div style="margin-top:8px;font-size:12px;color:var(--fm-muted)">${data.historial.map(h => `<div style="margin-bottom:4px">${esc(h.fecha)} ${esc(h.hora || '')} — ${esc(h.usuario)}: ${esc(h.accion)}</div>`).join('')}</div>
    </details>` : ''}

    <div class="fm-modal-footer"><button class="fm-btn fm-btn-outline fm-btn-sm" id="pod-close">Cerrar</button></div>
  </div>`;
  document.body.appendChild(overlay);

  $('#pod-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  $$('.btn-ver-rem-po').forEach(b => {
    b.addEventListener('click', () => { overlay.remove(); showRemisionDetail(Number(b.dataset.id)); });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SALIDA TENNECO
// ═══════════════════════════════════════════════════════════════════════════════
async function viewSalidaTenneco(el) {
  const [lotesListos, remisiones, pos] = await Promise.all([
    GET('/tenneco/lotes-listos'),
    GET('/tenneco/remisiones'),
    GET('/tenneco/pos')
  ]);
  S.lotesListos = lotesListos;
  S.remisiones = remisiones;
  S.pos = pos;

  // Agrupar lotes por diametro
  const lotesByDiam = {};
  S.lotesListos.forEach(l => {
    const d = l.diametro || 'Sin diametro';
    if (!lotesByDiam[d]) lotesByDiam[d] = [];
    lotesByDiam[d].push(l);
  });
  const diamKeys = Object.keys(lotesByDiam).sort();

  let lotesHtml = '';
  if (S.lotesListos.length > 0) {
    lotesHtml = `<div class="fm-table-wrap"><table class="fm-table">
      <thead><tr><th><input type="checkbox" id="chk-all"/></th><th>Lote</th><th>N/P</th><th>Diam.</th><th>Cliente</th><th>Cantidad</th><th>Fecha ingreso</th></tr></thead>
      <tbody>${diamKeys.map(d => {
        const groupHeader = `<tr style="background:#e2e8f0"><td colspan="7" style="font-weight:700;font-size:12px;padding:6px 10px">Diametro: ${esc(d)} mm — N/P: ${esc(lotesByDiam[d][0].numero_parte)} (${lotesByDiam[d].length} lote${lotesByDiam[d].length > 1 ? 's' : ''})</td></tr>`;
        const rows = lotesByDiam[d].map(l => `<tr>
          <td><input type="checkbox" class="chk-lote" value="${l.id}" data-diam="${esc(l.diametro)}"/></td>
          <td class="mono">${esc(l.lote)}</td><td class="mono">${esc(l.numero_parte)}</td>
          <td>${esc(l.diametro)}</td><td>${esc(l.cliente_int)}</td>
          <td class="text-right">${fmtNum(l.material_terminado)}</td>
          <td>${esc(l.fecha_recepcion)}</td>
        </tr>`).join('');
        return groupHeader + rows;
      }).join('')}</tbody>
    </table></div>
    <div style="margin-top:14px;display:flex;gap:10px">
      ${can('edit-inventarios') ? '<button class="fm-btn fm-btn-primary fm-btn-sm" id="btn-gen-rem">Generar remision</button>' : ''}
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="btn-print-etiq">Imprimir etiquetas</button>
    </div>`;
  }

  el.innerHTML = `
    <div class="fm-card">
      <h3>Lotes listos para enviar</h3>
      ${S.lotesListos.length === 0
        ? '<div class="empty-state"><div class="icon">📭</div><p>No hay lotes listos para enviar</p></div>'
        : lotesHtml
      }
    </div>
    <div class="fm-card">
      <h3>Remisiones generadas</h3>
      ${S.remisiones.length === 0
        ? '<p style="color:var(--fm-muted);font-size:13px">Sin remisiones</p>'
        : `<div class="fm-table-wrap"><table class="fm-table">
          <thead><tr><th>Folio</th><th>Fecha</th><th>Lotes</th><th>Total pzas</th><th>PO</th><th>Factura</th><th>Creado por</th><th></th></tr></thead>
          <tbody>${S.remisiones.map(r => {
            const _poId = (r.lotes || []).find(l => l.po_id)?.po_id;
            const _po = _poId && S.pos ? S.pos.find(p => p.id === _poId) : null;
            return `<tr>
            <td class="mono">${esc(r.folio)}</td><td>${esc(r.fecha)}</td>
            <td>${r.lotes.length}</td>
            <td class="text-right">${fmtNum(r.lotes.reduce((s, l) => s + (l.cantidad || 0), 0))}</td>
            <td class="mono" style="font-size:11px">${_po ? esc(_po.no_po) : '<span style="color:var(--fm-muted)">—</span>'}</td>
            <td>${r.facturado
              ? '<span class="badge-status badge-cerrado">' + esc(r.factura_numero) + '</span>'
              : (can('edit-inventarios') ? '<button class="fm-btn fm-btn-outline fm-btn-sm btn-facturar" data-id="' + r.id + '">Confirmar factura</button>' : '<span style="color:var(--fm-muted)">Pendiente</span>')}</td>
            <td>${esc(r.created_by || '')}</td>
            <td><button class="fm-btn fm-btn-outline fm-btn-sm btn-ver-rem" data-id="${r.id}">Ver</button>
                <button class="fm-btn fm-btn-outline fm-btn-sm btn-pdf-rem" data-id="${r.id}">PDF</button>
                ${S.user?.role === 'admin' ? `<button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-rem" data-id="${r.id}" title="Editar">E</button> <button class="fm-btn fm-btn-danger fm-btn-sm btn-del-rem" data-id="${r.id}" title="Eliminar">X</button>` : ''}</td>
          </tr>`;}).join('')}</tbody>
        </table></div>`
      }
    </div>`;

  // Checkbox all
  if ($('#chk-all')) {
    $('#chk-all').addEventListener('change', e => {
      $$('.chk-lote').forEach(c => c.checked = e.target.checked);
    });
  }

  // Generar remision (con asignacion PO)
  if ($('#btn-gen-rem')) {
    $('#btn-gen-rem').addEventListener('click', async () => {
      const checked = [...$$('.chk-lote:checked')];
      if (!checked.length) { alert('Selecciona al menos un lote'); return; }

      // Validar que todos sean del mismo diametro
      const diams = new Set(checked.map(c => c.dataset.diam));
      if (diams.size > 1) {
        alert('Solo puedes generar una remision por numero de parte (diametro).\nSelecciona lotes del mismo diametro.');
        return;
      }

      const ids = checked.map(c => Number(c.value));

      // Generar folio sugerido: TEN YYYYMMDD.CC
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const dateStr = `${y}${m}${d}`;
      // Contar remisiones del mismo dia para consecutivo
      const todayPrefix = `TEN ${dateStr}.`;
      const todayCount = S.remisiones.filter(r => (r.folio || '').startsWith(todayPrefix)).length;
      const consec = String(todayCount + 1).padStart(2, '0');
      const folioSugerido = `${todayPrefix}${consec}`;

      // Mostrar modal de confirmacion de folio
      showFolioConfirmModal(ids, folioSugerido, el);
    });
  }

  // Imprimir etiquetas
  if ($('#btn-print-etiq')) {
    $('#btn-print-etiq').addEventListener('click', async () => {
      const ids = [...$$('.chk-lote:checked')].map(c => Number(c.value));
      if (!ids.length) { alert('Selecciona al menos un lote'); return; }
      for (const id of ids) {
        await generarEtiquetaPDF(id);
      }
    });
  }

  // Facturar remision
  $$('.btn-facturar').forEach(b => {
    b.addEventListener('click', () => showFacturaModal(Number(b.dataset.id), el));
  });

  // Ver / PDF remision
  $$('.btn-ver-rem').forEach(b => b.addEventListener('click', () => showRemisionDetail(Number(b.dataset.id))));
  $$('.btn-pdf-rem').forEach(b => b.addEventListener('click', () => generarRemisionPDF(Number(b.dataset.id))));
  if (S.user?.role === 'admin') {
    $$('.btn-edit-rem').forEach(b => b.addEventListener('click', () => {
      const rem = S.remisiones.find(x => x.id === Number(b.dataset.id));
      if (rem) showModalEditRemision(rem, el);
    }));
    $$('.btn-del-rem').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Eliminar remision? Los lotes volveran a estado previo.')) return;
      try { await DEL('/tenneco/remisiones/' + b.dataset.id); await viewSalidaTenneco(el); } catch(e) { alert('Error: ' + e.message); }
    }));
  }
}

function showPOAssignModal(loteIds, activePOs, parentEl, folio) {
  const lotes = loteIds.map(id => S.lotesListos.find(l => l.id === id)).filter(Boolean);
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';

  const rows = lotes.map(l => {
    // Find applicable POs (matching diametro/NP)
    const applicable = activePOs.filter(po =>
      (po.partes || []).some(p => p.diametro === l.diametro || p.numero_parte === l.numero_parte)
    );
    const opts = applicable.map(po => {
      const disp = po.cantidad_po - po.cantidad_enviada;
      return `<option value="${po.id}">PO ${esc(po.no_po)} — ${fmtNum(disp)}/${fmtNum(po.cantidad_po)} disp. (${po.pct_disponible}%)</option>`;
    }).join('');
    return `<tr>
      <td class="mono">${esc(l.lote)}</td>
      <td class="mono">${esc(l.numero_parte)}</td>
      <td>${esc(l.diametro)}</td>
      <td class="text-right">${fmtNum(l.material_terminado)}</td>
      <td><select class="fm-input po-assign-sel" data-lote="${l.id}" style="font-size:12px">
        <option value="">— Sin PO —</option>${opts}
      </select></td>
    </tr>`;
  }).join('');

  overlay.innerHTML = `<div class="fm-modal" style="width:700px">
    <h3>Asignar PO a lotes</h3>
    <p style="font-size:13px;color:var(--fm-muted);margin-bottom:14px">Selecciona la PO para cada lote. Solo se muestran POs con disponibilidad.</p>
    <div class="fm-table-wrap"><table class="fm-table fm-table-sm">
      <thead><tr><th>Lote</th><th>N/P</th><th>Diam.</th><th class="text-right">Cantidad</th><th>PO</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="poa-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="poa-confirm">Confirmar y generar remision</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  $('#poa-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  $('#poa-confirm').addEventListener('click', async () => {
    const poAssignments = {};
    $$('.po-assign-sel').forEach(sel => {
      if (sel.value) poAssignments[sel.dataset.lote] = Number(sel.value);
    });

    if (!confirm(`Generar remision "${folio || ''}" con ${loteIds.length} lote(s)?`)) return;

    try {
      const payload = { lote_ids: loteIds, po_assignments: poAssignments };
      if (folio) payload.folio = folio;
      await POST('/tenneco/remisiones', payload);
      overlay.remove();
      await viewSalidaTenneco(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

function showFolioConfirmModal(loteIds, folioSugerido, parentEl) {
  const lotes = loteIds.map(id => S.lotesListos.find(l => l.id === id)).filter(Boolean);
  const totalPzas = lotes.reduce((s, l) => s + (l.material_terminado || 0), 0);
  const diam = lotes[0]?.diametro || '';
  const np = lotes[0]?.numero_parte || '';

  // POs activas con partes que coincidan
  const activePOs = S.pos.filter(p => p.estado === 'activa' && p.pct_disponible > 0);
  const applicablePOs = activePOs.filter(po =>
    (po.partes || []).some(p => p.diametro === diam || p.numero_parte === np)
  );
  const poOpts = applicablePOs.map(po => {
    const disp = po.cantidad_po - po.cantidad_enviada;
    return `<option value="${po.id}">PO ${esc(po.no_po)} — ${fmtNum(disp)}/${fmtNum(po.cantidad_po)} disp.</option>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal" style="width:550px">
    <h3>Confirmar Remision</h3>
    <div style="background:#f1f5f9;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px">
      <div><strong>Diametro:</strong> ${esc(diam)} mm — <strong>N/P:</strong> ${esc(np)}</div>
      <div><strong>Lotes:</strong> ${lotes.map(l => esc(l.lote)).join(', ')}</div>
      <div><strong>Total piezas:</strong> ${fmtNum(totalPzas)}</div>
    </div>
    <div class="fm-form-group">
      <label style="font-weight:700">Numero de Remision</label>
      <input class="fm-input" id="fc-folio" value="${esc(folioSugerido)}" style="font-size:16px;font-weight:700;letter-spacing:1px"/>
      <div style="font-size:11px;color:var(--fm-muted);margin-top:4px">Formato: TEN YYYYMMDD.CC — Puedes editar el consecutivo</div>
    </div>
    <div class="fm-form-group">
      <label style="font-weight:700">PO asignada (una por remision)</label>
      <select class="fm-input" id="fc-po" style="font-size:13px">
        <option value="">— Sin PO —</option>${poOpts}
      </select>
    </div>
    <div id="fc-error" style="display:none;color:var(--fm-danger);font-size:13px;font-weight:600;margin-top:8px"></div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="fc-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="fc-confirm">Generar remision</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  $('#fc-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  $('#fc-confirm').addEventListener('click', async () => {
    const folio = $('#fc-folio').value.trim();
    if (!folio) { $('#fc-error').style.display = 'block'; $('#fc-error').textContent = 'Ingresa un numero de remision'; return; }

    // Validar duplicado
    const dup = S.remisiones.find(r => r.folio === folio);
    if (dup) {
      $('#fc-error').style.display = 'block';
      $('#fc-error').textContent = `El folio "${folio}" ya existe. Cambia el consecutivo.`;
      return;
    }

    const poId = $('#fc-po').value ? Number($('#fc-po').value) : null;

    // Armar po_assignments: misma PO para todos los lotes
    const poAssignments = {};
    if (poId) {
      for (const id of loteIds) poAssignments[String(id)] = poId;
    }

    try {
      await POST('/tenneco/remisiones', {
        lote_ids: loteIds,
        folio,
        po_assignments: poAssignments
      });
      overlay.remove();
      await viewSalidaTenneco(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

function showFacturaModal(remId, parentEl) {
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal" style="width:400px">
    <h3>Confirmar Facturacion</h3>
    <div class="fm-form-group"><label>Numero de Factura</label><input class="fm-input" id="fac-num" placeholder="Ej: FAC-001"/></div>
    <div class="fm-form-group"><label>Fecha de Factura</label><input class="fm-input" type="date" id="fac-fecha" value="${new Date().toISOString().slice(0, 10)}"/></div>
    <div class="fm-confirm-box">
      <p>Al confirmar, la remision se marcara como facturada y cerrada.</p>
    </div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="fac-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="fac-save">Confirmar factura</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  $('#fac-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  $('#fac-save').addEventListener('click', async () => {
    const num = $('#fac-num').value.trim();
    if (!num) { alert('Ingresa el numero de factura'); return; }
    try {
      await PATCH('/tenneco/remisiones/' + remId + '/factura', {
        factura_numero: num,
        factura_fecha: $('#fac-fecha').value
      });
      overlay.remove();
      await viewSalidaTenneco(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

async function showRemisionDetail(remId) {
  const rem = await GET('/tenneco/remisiones/' + remId);
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';

  // Find PO (una por remision)
  const poId = (rem.lotes || []).find(l => l.po_id)?.po_id;
  const po = poId && S.pos ? S.pos.find(p => p.id === poId) : null;
  const poLabel = po ? `PO ${po.no_po}` : '';

  overlay.innerHTML = `<div class="fm-modal" style="width:600px">
    <h3>Remision ${esc(rem.folio)}</h3>
    <p style="font-size:13px"><strong>Fecha:</strong> ${esc(rem.fecha)} | <strong>Creado por:</strong> ${esc(rem.created_by || '')}${poLabel ? ` | <strong>PO:</strong> ${esc(poLabel)}` : ''}</p>
    ${rem.facturado
      ? `<div class="fm-alert fm-alert-success" style="margin-top:10px"><strong>Facturado:</strong> ${esc(rem.factura_numero)} — ${esc(rem.factura_fecha || '')}</div>`
      : '<div class="fm-alert fm-alert-warn" style="margin-top:10px">Pendiente de facturacion</div>'}
    <div class="fm-table-wrap" style="margin-top:14px"><table class="fm-table">
      <thead><tr><th>Caja</th><th>Componente</th><th>Medida</th><th class="text-right">Cantidad</th></tr></thead>
      <tbody>${rem.lotes.map(l => `<tr>
        <td class="mono">${esc(l.caja_id || '')}</td><td class="mono">${esc(l.numero_parte)}</td>
        <td>${esc(l.diametro)} mm</td><td class="text-right">${fmtNum(l.cantidad)}</td>
      </tr>`).join('')}
      <tr class="kpi-total"><td colspan="2"></td><td class="text-right"><strong>TOTAL</strong></td>
        <td class="text-right"><strong>${fmtNum(rem.lotes.reduce((s, l) => s + (l.cantidad || 0), 0))} Piezas</strong></td></tr>
      </tbody>
    </table></div>
    ${rem.observaciones ? '<p style="margin-top:12px;font-size:13px;color:var(--fm-muted)"><strong>Obs:</strong> ' + esc(rem.observaciones) + '</p>' : ''}
    ${(rem.historial || []).length > 0 ? `<details style="margin-top:12px"><summary style="font-size:12px;font-weight:600;cursor:pointer;color:var(--fm-muted)">Historial (${rem.historial.length})</summary>
      <div style="margin-top:6px;font-size:12px;color:var(--fm-muted)">${rem.historial.map(h => `<div style="margin-bottom:3px">${esc(h.fecha)} ${esc(h.hora || '')} — ${esc(h.usuario)}: ${esc(h.accion)}</div>`).join('')}</div>
    </details>` : ''}
    <div class="fm-modal-footer"><button class="fm-btn fm-btn-outline fm-btn-sm" id="m-close">Cerrar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="m-pdf-rem">Descargar PDF</button></div>
  </div>`;
  document.body.appendChild(overlay);
  $('#m-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#m-pdf-rem').addEventListener('click', () => generarRemisionPDF(remId));
}

function showModalEditRemision(rem, parentEl) {
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal" style="width:450px">
    <h3>Editar Remision</h3>
    <div class="fm-form-group"><label>Folio</label><input class="fm-input" id="er-folio" value="${esc(rem.folio || '')}"/></div>
    <div class="fm-form-group"><label>Observaciones</label><textarea class="fm-input" id="er-obs" rows="3" style="resize:vertical">${esc(rem.observaciones || '')}</textarea></div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="er-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="er-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  $('#er-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#er-save').addEventListener('click', async () => {
    try {
      await PATCH('/tenneco/remisiones/' + rem.id, {
        folio: $('#er-folio').value,
        observaciones: $('#er-obs').value
      });
      overlay.remove();
      await viewSalidaTenneco(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF — REMISION (formato Cuesto — referencia Excel)
// ═══════════════════════════════════════════════════════════════════════════════
async function generarRemisionPDF(remId) {
  const rem = S.remisiones.find(r => r.id === remId) || await GET('/tenneco/remisiones/' + remId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'letter');

  const W = 216, H = 279, ML = 22, MR = 22;
  const cw = W - ML - MR;
  const colLeft = cw * 0.48; // ancho col izq header
  const colRight = cw * 0.52;
  const C_LINK = [41, 128, 185]; // azul links

  // ── Logo Cuesto (top-left) ──
  try {
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      logoImg.onload = resolve;
      logoImg.onerror = reject;
      logoImg.src = '/img/logo.png';
    });
    doc.addImage(logoImg, 'PNG', ML, 10, 36, 13);
  } catch(e) { /* logo no disponible, continuar sin el */ }

  // ── Fecha (top-left, debajo del logo) ──
  const fechaParts = (rem.fecha || '').split('-');
  const fechaDD = fechaParts.length === 3 ? `${fechaParts[2]}/${fechaParts[1]}/${fechaParts[0]}` : rem.fecha;
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(fechaDD, ML, 34);

  // ── Titulo: REMISION FOLIO (alineado izquierda) ──
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text(`REMISI\u00D3N ${rem.folio}`, ML, 44);

  // ── Header table (ENVIA | Cliente) ──
  const hdrY = 50;
  const hdrH = 60;
  const xL = ML, xR = ML + colLeft, xEnd = ML + cw;

  // Bordes exteriores + linea central
  doc.setDrawColor(0); doc.setLineWidth(0.3);
  doc.rect(xL, hdrY, cw, hdrH);
  doc.line(xR, hdrY, xR, hdrY + hdrH);

  // --- Columna izquierda: ENVIA ---
  let ly = hdrY + 6;
  doc.setFontSize(10); doc.setFont(undefined, 'bold');
  doc.text('ENVIA', xL + 3, ly); ly += 6;
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  doc.text('Corporativo Cuesto, S de RL de CV', xL + 3, ly); ly += 4.5;
  doc.text('Calle 28 No2565', xL + 3, ly); ly += 4.5;
  doc.text('Zona Industrial 44940', xL + 3, ly); ly += 4.5;
  doc.text('Guadalajara, Jal. M\u00E9xico', xL + 3, ly); ly += 4.5;
  doc.text('RFC: CCU090911RCA', xL + 3, ly); ly += 6;
  doc.text('33 3145-3426', xL + 3, ly); ly += 4.5;
  doc.setTextColor(...C_LINK);
  doc.text('Info@cuesto.mx', xL + 3, ly);
  doc.setTextColor(0);

  // --- Columna derecha: Cliente ---
  let ry = hdrY + 6;
  doc.setFontSize(9); doc.setFont(undefined, 'bold');
  doc.text('Cliente:', xR + 3, ry);
  doc.setFont(undefined, 'normal');
  doc.text(' Federal Mogul, S. de R.L de C.V', xR + 3 + doc.getTextWidth('Cliente:'), ry); ry += 8;

  doc.setFont(undefined, 'bold');
  doc.text('NO. FACTURA:', xR + 3, ry);
  doc.setFont(undefined, 'normal');
  const facTxt = rem.facturado ? (rem.factura_numero || '') : 'PENDIENTE';
  doc.text(` ${facTxt}`, xR + 3 + doc.getTextWidth('NO. FACTURA:'), ry); ry += 5;

  doc.setFont(undefined, 'bold');
  doc.text('TIPO DE PAGO:', xR + 3, ry);
  doc.setFont(undefined, 'normal');
  doc.text(' POR DEFINIR', xR + 3 + doc.getTextWidth('TIPO DE PAGO:'), ry); ry += 8;

  doc.setFont(undefined, 'bold');
  doc.text('ENTREGA', xR + 3, ry); ry += 5;
  doc.setFont(undefined, 'normal');
  doc.text(' En domicilio', xR + 3, ry);

  // ── Tabla de items ──
  const tblY = hdrY + hdrH + 8;
  const total = rem.lotes.reduce((s, l) => s + (l.cantidad || 0), 0);
  const nCajas = rem.lotes.length;

  // Filas de datos
  const tblBody = rem.lotes.map(l => [
    l.caja_id || '', l.numero_parte || '',
    { content: l.diametro || '', styles: { fontStyle: 'bold' } },
    { content: fmtNum(l.cantidad), styles: { halign: 'right' } }
  ]);

  // Filas vacias para dar espacio (como el original)
  const emptyRows = Math.max(0, 6 - rem.lotes.length);
  for (let i = 0; i < emptyRows; i++) tblBody.push(['', '', '', '']);

  // Fila Total
  tblBody.push([
    '', '',
    { content: 'Total', styles: { fontStyle: 'bold', halign: 'right' } },
    { content: `${fmtNum(total)} Piezas`, styles: { fontStyle: 'bold', halign: 'right' } }
  ]);

  doc.autoTable({
    startY: tblY,
    margin: { left: ML, right: MR },
    head: [['Caja', 'Componente', 'Medida (mm)', 'Cantidad']],
    body: tblBody,
    styles: { fontSize: 8, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineWidth: 0 },
    columnStyles: {
      0: { cellWidth: colLeft * 0.55 },
      1: { cellWidth: colLeft * 0.55 },
      2: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 28, halign: 'right' }
    },
    theme: 'plain',
    didDrawPage: (data) => {
      const tbl = data.table;
      const tblW = cw;
      // Borde exterior de toda la tabla (enmarcado)
      doc.setDrawColor(0); doc.setLineWidth(0.3);
      doc.rect(ML, tblY, tblW, tbl.finalY - tblY);
      // Linea bajo el header
      const hdrBot = tbl.head[0].cells[0].y + tbl.head[0].cells[0].height;
      doc.setLineWidth(0.2);
      doc.line(ML, hdrBot, ML + tblW, hdrBot);
    }
  });

  let y = doc.lastAutoTable.finalY + 8;

  // ── Comentarios box ──
  const poId = (rem.lotes || []).find(l => l.po_id)?.po_id;
  const po = poId && S.pos ? S.pos.find(p => p.id === poId) : null;
  const poNum = po ? po.no_po : '';
  const proyecto = (rem.lotes[0]?.cliente_int) || '';

  const boxW = cw * 0.55;
  const boxH = 14;
  doc.setDrawColor(180); doc.setLineWidth(0.25);
  doc.setFillColor(248, 248, 248);
  doc.rect(ML, y, boxW, boxH, 'FD');
  doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(80);
  doc.text('Comentarios', ML + 3, y + 4.5);
  doc.setFont(undefined, 'normal'); doc.setTextColor(0); doc.setFontSize(8);
  const comments = [poNum ? `PO: ${poNum}` : '', proyecto].filter(Boolean).join('  |  ');
  if (comments) doc.text(comments, ML + 3, y + 10);

  y += boxH + 6;

  // ── Email ──
  doc.setTextColor(...C_LINK);
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  doc.text('produccion@cuesto.mx', ML, y);
  doc.setTextColor(0);

  // ── Footer ──
  // Bottom-left: control de revision
  doc.setFontSize(8); doc.setFont(undefined, 'normal');
  doc.text('4-CA-125 Rev. 1  09-septiembre-2026', ML, H - 16);

  // Bottom-right
  doc.text('Tra: En activo', W - MR, H - 24, { align: 'right' });
  doc.text('Tram: NA', W - MR, H - 19, { align: 'right' });
  doc.text(`P\u00E1gina 1 de 1`, W - MR, H - 12, { align: 'right' });

  doc.save(`Remision_${rem.folio.replace(/\s/g, '_')}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF — ETIQUETA 3x4 in
// ═══════════════════════════════════════════════════════════════════════════════
async function generarEtiquetaPDF(loteId) {
  const data = await GET('/tenneco/etiqueta/' + loteId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'in', format: [3, 4] });

  const cx = 1.5;

  // Header
  doc.setFontSize(10); doc.setFont(undefined, 'bold');
  doc.text('CORPORATIVO CUESTO', cx, 0.35, { align: 'center' });
  doc.setLineWidth(0.02); doc.line(0.3, 0.45, 2.7, 0.45);

  // Data fields
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  const fields = [
    ['N/P:', data.numero_parte],
    ['Diametro:', data.diametro + ' mm'],
    ['Cliente:', data.cliente_int],
    ['Lote:', data.lote],
    ['Cantidad:', fmtNum(data.cantidad)],
    ['Fecha:', data.fecha_empaque]
  ];
  let y = 0.7;
  for (const [lbl, val] of fields) {
    doc.setFont(undefined, 'bold'); doc.text(lbl, 0.3, y);
    doc.setFont(undefined, 'normal'); doc.text(String(val || ''), 1.2, y);
    y += 0.22;
  }

  // QR
  try {
    const qrUrl = window.location.origin + '/api/flujo/tenneco/certificado/' + loteId;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 1 });
    doc.addImage(qrDataUrl, 'PNG', 0.75, 2.2, 1.5, 1.5);
  } catch (_) {}

  // Code at bottom
  doc.setFontSize(7); doc.setFont(undefined, 'normal');
  doc.text(data.qr_code || '', cx, 3.85, { align: 'center' });

  doc.save(`Etiqueta_${data.lote}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF — CERTIFICADO DE CALIDAD (basado en cert SKF)
// ═══════════════════════════════════════════════════════════════════════════════
async function generarCertificadoPDF(loteId) {
  const data = await GET('/tenneco/certificado/' + loteId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'letter');
  const W = 216, M = 18;

  // Header
  let y = 16;
  doc.setFontSize(10); doc.setFont(undefined, 'bold');
  doc.text('Corporativo Cuesto S. de R.L de C.V', M, y);
  doc.setFontSize(16);
  doc.text('Quality Certificate', W / 2, y, { align: 'center' });

  // Code box
  doc.setFontSize(8); doc.setFont(undefined, 'normal');
  const bx = W - M - 50;
  doc.rect(bx, 10, 50, 18);
  doc.text('Codigo: 4-CA-TEN', bx + 2, 15);
  doc.text('Nivel de Rev.: 0', bx + 2, 19);
  doc.text('Hoja: 1 de 1', bx + 2, 23);

  y = 40;
  // Certificate number
  const certNum = `TENC${data.lote.fecha_recepcion ? data.lote.fecha_recepcion.slice(0, 4) : '2026'}LOT${data.lote.lote}`;
  doc.setFontSize(14); doc.setFont(undefined, 'bold');
  doc.text(certNum, M, y); y += 8;

  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`Date: ${data.lote.fecha_envio || data.lote.fecha_recepcion || ''}`, M, y); y += 6;
  doc.text(`Client: ${data.lote.cliente_int || ''}`, M, y); y += 6;
  doc.text(`Part Number: ${data.lote.numero_parte || ''}`, M, y);
  doc.text(`Diameter: ${data.lote.diametro || ''} mm`, W / 2 + 10, y); y += 6;
  doc.text(`Lot: ${data.lote.lote || ''}`, M, y);
  doc.text(`Qty: ${fmtNum(data.lote.cantidad_recibida)}`, W / 2 + 10, y); y += 10;

  // Results table
  const specs = data.specs || {};
  const tblBody = [];
  if (data.altura_axial.n > 0) {
    tblBody.push([
      'Altura Axial', '2-PR-TEN',
      `${specs.altura_axial_min || '?'} - ${specs.altura_axial_max || '?'} mm`,
      `${data.altura_axial.avg} +/- ${data.altura_axial.std} mm`
    ]);
  }
  if (data.rugosidad.n > 0) {
    tblBody.push([
      'Rugosidad', '2-PR-TEN',
      `${specs.rugosidad_min || '?'} - ${specs.rugosidad_max || '?'} Ra`,
      `${data.rugosidad.avg} +/- ${data.rugosidad.std} Ra`
    ]);
  }
  if (tblBody.length === 0) {
    tblBody.push(['Sin datos de inspeccion', '', '', '']);
  }

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M },
    head: [['Request', 'Testing Method', 'Allowable Range', 'Test Result']],
    body: tblBody,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    theme: 'grid'
  });

  y = doc.lastAutoTable.finalY + 15;

  // Observations
  doc.setFontSize(8); doc.setFont(undefined, 'bold');
  doc.text('Observations:', M, y); y += 5;
  doc.setFont(undefined, 'normal');
  doc.text(`Certificate ${certNum} covers the lot ${data.lote.lote} processed at Corporativo Cuesto.`, M, y, { maxWidth: W - M * 2 });
  y += 12;

  // Signatures
  doc.setFontSize(9);
  doc.line(M, y + 20, M + 60, y + 20);
  doc.line(W - M - 60, y + 20, W - M, y + 20);
  doc.text('Quality Engineer', M + 10, y + 26);
  doc.text('Process Engineer', W - M - 50, y + 26);

  // Footer
  doc.setFontSize(7);
  doc.text('ISO 9001:2015', W / 2, 270, { align: 'center' });

  doc.save(`Certificado_${data.lote.lote}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// KPI TENNECO
// ═══════════════════════════════════════════════════════════════════════════════
async function viewKpiTenneco(el) {
  const anio = new Date().getFullYear();
  const kpi = await GET(`/tenneco/kpi?agrupacion=semana&anio=${anio}`);

  // Collect all period keys
  const allKeys = new Set();
  for (const comp of Object.keys(kpi.data || {})) {
    for (const k of Object.keys(kpi.data[comp])) allKeys.add(k);
  }
  const periods = [...allKeys].sort();
  const comps = Object.keys(kpi.data || {}).sort();

  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar">
        <label>Anio <input class="fm-input" type="number" id="kpi-anio" value="${anio}" style="width:100px"/></label>
        <label>Agrupacion <select class="fm-input" id="kpi-agrup"><option value="semana">Semana</option><option value="mes">Mes</option></select></label>
        <button class="fm-btn fm-btn-primary fm-btn-sm" id="kpi-refresh">Actualizar</button>
      </div>
      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr><th>Componente</th>${periods.map(p => `<th class="text-right">${esc(p)}</th>`).join('')}<th class="text-right">Total</th></tr></thead>
        <tbody>
          ${comps.map(c => {
            const row = kpi.data[c];
            const total = periods.reduce((s, p) => s + (row[p] || 0), 0);
            return `<tr><td class="mono">${esc(c)}</td>${periods.map(p => `<td class="text-right">${fmtNum(row[p] || 0)}</td>`).join('')}<td class="text-right"><strong>${fmtNum(total)}</strong></td></tr>`;
          }).join('')}
          <tr class="kpi-total"><td><strong>TOTAL</strong></td>${periods.map(p => {
            const colTotal = comps.reduce((s, c) => s + (kpi.data[c][p] || 0), 0);
            return `<td class="text-right"><strong>${fmtNum(colTotal)}</strong></td>`;
          }).join('')}<td class="text-right"><strong>${fmtNum(comps.reduce((s, c) => s + periods.reduce((s2, p) => s2 + (kpi.data[c][p] || 0), 0), 0))}</strong></td></tr>
        </tbody>
      </table></div>
      ${periods.length === 0 ? '<p style="color:var(--fm-muted);margin-top:14px;font-size:13px">Sin datos para este periodo</p>' : ''}
    </div>`;

  $('#kpi-refresh').addEventListener('click', async () => {
    const a = parseInt($('#kpi-anio').value) || anio;
    const ag = $('#kpi-agrup').value;
    const d = await GET(`/tenneco/kpi?agrupacion=${ag}&anio=${a}`);
    // Re-render quick
    Object.assign(kpi, d);
    await viewKpiTenneco(el);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPAQUE TENNECO
// ═══════════════════════════════════════════════════════════════════════════════
async function viewEmpaqueTenneco(el) {
  const [muestras, status, proyectos, lotes] = await Promise.all([
    GET('/tenneco/muestras'),
    GET('/app-status'),
    GET('/cat/tenneco/proyectos'),
    GET('/tenneco/lotes')
  ]);
  S.muestras = muestras;
  S.appStatus = status;

  const tenStatus = (status || []).find(s => s.side === 'tenneco');
  const online = tenStatus && (Date.now() - new Date(tenStatus.last_seen).getTime()) < 120000;

  // Collect unique defect names for column headers
  const allDefectos = new Set();
  muestras.forEach(m => (m.rechazos || []).forEach(r => { if (r.defecto) allDefectos.add(r.defecto); }));
  const defectoNames = [...allDefectos].sort();

  // Unique values for filters
  const proyNames = proyectos.map(p => p.nombre);
  const diams = [...new Set(muestras.map(m => m.diametro).filter(Boolean))].sort();

  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar" style="flex-wrap:wrap;gap:8px">
        <span class="app-status-dot ${online ? 'online' : 'offline'}"></span>
        <span style="font-size:13px;font-weight:600">${online ? 'App conectada' : 'App desconectada'}</span>
        ${tenStatus ? `<span style="font-size:11px;color:var(--fm-muted)">Op: ${esc(tenStatus.operador || '?')} | v${esc(tenStatus.version || '?')}</span>` : ''}
        <div style="flex:1"></div>
        <select class="fm-input" id="emp-proy" style="width:140px"><option value="">Proyecto</option>${proyNames.map(n => `<option>${esc(n)}</option>`).join('')}</select>
        <select class="fm-input" id="emp-diam" style="width:110px"><option value="">Diametro</option>${diams.map(d => `<option>${esc(d)}</option>`).join('')}</select>
        <input class="fm-input" id="emp-lote" placeholder="Buscar lote..." style="width:130px"/>
      </div>
      <div class="fm-table-wrap"><table class="fm-table fm-table-sm">
        <thead><tr>
          <th>Diametro</th><th>N/P</th><th>Lote</th><th class="text-center">#</th>
          <th class="text-center">Muestra</th>
          <th class="text-right">Rug. Prom</th><th class="text-right">Alt. Ax. Prom</th>
          <th class="text-right">Acept.</th>
          ${defectoNames.map(d => `<th class="text-right" title="${esc(d)}" style="font-size:10px;max-width:70px;overflow:hidden;text-overflow:ellipsis">${esc(d.length > 10 ? d.slice(0, 10) + '..' : d)}</th>`).join('')}
          <th class="text-right">Scrap</th><th class="text-center">QC</th>
          <th>Fecha</th><th>Hora</th><th>Analista</th>
          ${S.user?.role === 'admin' ? '<th></th>' : ''}
        </tr></thead>
        <tbody id="tbody-muestras"></tbody>
      </table></div>
    </div>`;

  const renderMuestras = () => {
    const fProy = ($('#emp-proy')?.value || '');
    const fDiam = ($('#emp-diam')?.value || '');
    const fLote = ($('#emp-lote')?.value || '').toLowerCase();
    let data = [...S.muestras];
    if (fProy) data = data.filter(m => m.proyecto === fProy);
    if (fDiam) data = data.filter(m => m.diametro === fDiam);
    if (fLote) data = data.filter(m => String(m.lote || '').toLowerCase().includes(fLote));

    // Sort by lote, then num_muestra
    data.sort((a, b) => {
      const cmp = String(a.lote || '').localeCompare(String(b.lote || ''));
      return cmp !== 0 ? cmp : (a.num_muestra || 0) - (b.num_muestra || 0);
    });

    const tbody = $('#tbody-muestras');
    const colSpan = 9 + defectoNames.length + 4 + (S.user?.role === 'admin' ? 1 : 0);
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center" style="color:var(--fm-muted);padding:30px">Sin registros de empaque</td></tr>`; return; }

    // Group by lote for accumulated count
    const loteAccum = {};
    data.forEach(m => {
      const key = m.lote_id;
      if (!loteAccum[key]) loteAccum[key] = { count: 0, total: m.cantidad_lote || 0, tamano: m.tamano_muestra || 100 };
      loteAccum[key].count++;
    });
    const loteCounters = {};

    let prevLote = null;
    tbody.innerHTML = data.map(m => {
      const loteKey = m.lote_id;
      if (!loteCounters[loteKey]) loteCounters[loteKey] = 0;
      loteCounters[loteKey]++;
      const acum = loteCounters[loteKey] * (m.tamano_muestra || 100);
      const total = loteAccum[loteKey].total;

      // Lote group header
      let groupRow = '';
      if (m.lote !== prevLote) {
        prevLote = m.lote;
        groupRow = `<tr style="background:#e2e8f0"><td colspan="${colSpan}" style="font-weight:700;font-size:12px;padding:6px 10px">Lote: ${esc(m.lote)} — N/P: ${esc(m.numero_parte)} — Diametro: ${esc(m.diametro)} — Proyecto: ${esc(m.proyecto || '')}</td></tr>`;
      }

      const rechByDef = {};
      (m.rechazos || []).forEach(r => { rechByDef[r.defecto] = (rechByDef[r.defecto] || 0) + (r.cantidad || 0); });

      const rugStyle = m.rugosidad_ok === false ? 'color:var(--fm-danger);font-weight:700' : '';
      const altStyle = m.altura_axial_ok === false ? 'color:var(--fm-danger);font-weight:700' : '';
      const statusBadge = m.qc_liberado ? 'badge-cerrado' : 'badge-abierto';
      const statusText = (m.status || (m.qc_liberado ? 'aceptada' : 'retenida')).toUpperCase();
      const qcLabel = statusText === 'ACEPTADA' ? 'OK' : statusText === 'RETENIDA' ? 'HOLD' : statusText;

      return groupRow + `<tr${m.status === 'retenida' ? ' style="background:#fff8e1"' : ''}>
        <td>${esc(m.diametro)}</td>
        <td class="mono">${esc(m.numero_parte)}</td>
        <td class="mono">${esc(m.lote)}</td>
        <td class="text-center">${m.num_muestra}</td>
        <td class="text-center" style="font-size:11px">${fmtNum(acum)}/${fmtNum(total)}</td>
        <td class="text-right" style="${rugStyle}">${m.rugosidad_prom != null ? m.rugosidad_prom : '-'}</td>
        <td class="text-right" style="${altStyle}">${m.altura_axial_prom != null ? m.altura_axial_prom : '-'}</td>
        <td class="text-right">${fmtNum(m.piezas_aceptadas)}</td>
        ${defectoNames.map(d => `<td class="text-right">${rechByDef[d] ? fmtNum(rechByDef[d]) : ''}</td>`).join('')}
        <td class="text-right">${fmtNum(m.scrap)}</td>
        <td class="text-center"><span class="badge-status ${statusBadge}">${qcLabel}</span></td>
        <td>${(m.fecha || m.synced_at || '').slice(0, 10)}</td>
        <td>${esc(m.hora || '')}</td>
        <td style="font-size:11px">${esc(m.analista || '')}</td>
        ${S.user?.role === 'admin' ? `<td><button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-muestra" data-id="${m.id}" title="Editar">E</button> <button class="fm-btn fm-btn-danger fm-btn-sm btn-del-muestra" data-id="${m.id}" title="Eliminar">X</button></td>` : ''}
      </tr>`;
    }).join('');
    if (S.user?.role === 'admin') {
      $$('.btn-edit-muestra').forEach(b => b.addEventListener('click', () => {
        const mu = S.muestras.find(x => x.id === Number(b.dataset.id));
        if (mu) showModalEditMuestra(mu, renderMuestras);
      }));
      $$('.btn-del-muestra').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Eliminar esta muestra?')) return;
        try {
          await DEL('/tenneco/muestras/' + b.dataset.id);
          S.muestras = await GET('/tenneco/muestras');
          renderMuestras();
        } catch(e) { alert('Error: ' + e.message); }
      }));
    }
  };
  renderMuestras();
  ['emp-proy', 'emp-diam'].forEach(id => { if ($('#' + id)) $('#' + id).addEventListener('change', renderMuestras); });
  if ($('#emp-lote')) $('#emp-lote').addEventListener('input', renderMuestras);
}

async function showModalEditMuestra(mu, onSave) {
  const defectos = await GET('/cat/tenneco/defectos');
  const rug = mu.rugosidad || [null, null, null];
  const alt = mu.altura_axial || [null, null, null];
  const rechMap = {};
  (mu.rechazos || []).forEach(r => { if (r.defecto && r.defecto !== 'Fuera de especificacion') rechMap[r.defecto] = r.cantidad || 0; });

  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal" style="width:550px">
    <h3>Editar Muestra #${mu.num_muestra}</h3>
    <p style="font-size:12px;color:var(--fm-muted);margin-bottom:12px">Lote: ${esc(mu.lote)} — N/P: ${esc(mu.numero_parte)} — Diam: ${esc(mu.diametro)}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div>
        <label style="font-weight:700;font-size:13px">Rugosidad (3 tomas)</label>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input class="fm-input" id="em-r1" type="number" step="0.01" value="${rug[0] != null ? rug[0] : ''}" placeholder="R1" style="width:70px"/>
          <input class="fm-input" id="em-r2" type="number" step="0.01" value="${rug[1] != null ? rug[1] : ''}" placeholder="R2" style="width:70px"/>
          <input class="fm-input" id="em-r3" type="number" step="0.01" value="${rug[2] != null ? rug[2] : ''}" placeholder="R3" style="width:70px"/>
        </div>
        <div id="em-rug-prom" style="font-size:12px;color:var(--fm-muted);margin-top:4px">Prom: ${mu.rugosidad_prom ?? '-'}</div>
      </div>
      <div>
        <label style="font-weight:700;font-size:13px">Altura Axial (3 tomas)</label>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input class="fm-input" id="em-a1" type="number" step="0.01" value="${alt[0] != null ? alt[0] : ''}" placeholder="A1" style="width:70px"/>
          <input class="fm-input" id="em-a2" type="number" step="0.01" value="${alt[1] != null ? alt[1] : ''}" placeholder="A2" style="width:70px"/>
          <input class="fm-input" id="em-a3" type="number" step="0.01" value="${alt[2] != null ? alt[2] : ''}" placeholder="A3" style="width:70px"/>
        </div>
        <div id="em-alt-prom" style="font-size:12px;color:var(--fm-muted);margin-top:4px">Prom: ${mu.altura_axial_prom ?? '-'}</div>
      </div>
    </div>
    <hr style="border:0;border-top:1px solid var(--fm-line);margin:14px 0"/>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Piezas aceptadas</label><input class="fm-input" id="em-acept" type="number" min="0" value="${mu.piezas_aceptadas || 0}"/></div>
      <div class="fm-form-group"><label>Scrap</label><input class="fm-input" id="em-scrap" type="number" min="0" value="${mu.scrap || 0}"/></div>
    </div>
    <div style="margin-top:10px">
      <label style="font-weight:700;font-size:13px">Rechazos por defecto</label>
      <div id="em-rechazos" style="margin-top:6px">
        ${defectos.map(d => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:12px;flex:1">${esc(d.defecto)}</span>
          <input class="fm-input em-rech-qty" data-defecto="${esc(d.defecto)}" type="number" min="0" value="${rechMap[d.defecto] || 0}" style="width:70px"/>
        </div>`).join('')}
      </div>
    </div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="em-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="em-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  // Live prom calc
  const calcProm = () => {
    const r = [parseFloat($('#em-r1').value), parseFloat($('#em-r2').value), parseFloat($('#em-r3').value)];
    const a = [parseFloat($('#em-a1').value), parseFloat($('#em-a2').value), parseFloat($('#em-a3').value)];
    const rValid = r.filter(v => !isNaN(v));
    const aValid = a.filter(v => !isNaN(v));
    $('#em-rug-prom').textContent = 'Prom: ' + (rValid.length === 3 ? (rValid.reduce((s, v) => s + v, 0) / 3).toFixed(2) : '-');
    $('#em-alt-prom').textContent = 'Prom: ' + (aValid.length === 3 ? (aValid.reduce((s, v) => s + v, 0) / 3).toFixed(2) : '-');
  };
  ['em-r1', 'em-r2', 'em-r3', 'em-a1', 'em-a2', 'em-a3'].forEach(id => $('#' + id).addEventListener('input', calcProm));

  $('#em-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#em-save').addEventListener('click', async () => {
    const r1 = parseFloat($('#em-r1').value), r2 = parseFloat($('#em-r2').value), r3 = parseFloat($('#em-r3').value);
    const a1 = parseFloat($('#em-a1').value), a2 = parseFloat($('#em-a2').value), a3 = parseFloat($('#em-a3').value);
    const rugArr = [r1, r2, r3].some(isNaN) ? (mu.rugosidad || []) : [r1, r2, r3];
    const altArr = [a1, a2, a3].some(isNaN) ? (mu.altura_axial || []) : [a1, a2, a3];
    const rechazos = [...$$('.em-rech-qty')].map(inp => ({
      defecto: inp.dataset.defecto,
      cantidad: parseInt(inp.value) || 0
    })).filter(r => r.cantidad > 0);
    try {
      await PATCH('/tenneco/muestras/' + mu.id, {
        rugosidad: rugArr,
        altura_axial: altArr,
        piezas_aceptadas: parseInt($('#em-acept').value) || 0,
        scrap: parseInt($('#em-scrap').value) || 0,
        rechazos
      });
      overlay.remove();
      S.muestras = await GET('/tenneco/muestras');
      onSave();
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGO — PROYECTOS TENNECO
// ═══════════════════════════════════════════════════════════════════════════════
async function viewCatProyectos(el) {
  const data = await GET('/cat/tenneco/proyectos');
  const canEdit = can('edit-catalogos');
  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar">${canEdit ? '<button class="fm-btn fm-btn-primary fm-btn-sm" id="btn-add-proy">+ Agregar Proyecto</button>' : ''}</div>
      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr><th>Proyecto</th><th>Fecha</th>${canEdit ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.map(p => `<tr>
          <td style="font-weight:600">${esc(p.nombre)}</td>
          <td>${esc(p.created_at || '')}</td>
          ${canEdit ? `<td><button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-proy" data-id="${p.id}">Editar</button> <button class="fm-btn fm-btn-danger fm-btn-sm btn-del-proy" data-id="${p.id}">X</button></td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>
      ${data.length === 0 ? '<p style="color:var(--fm-muted);font-size:13px;margin-top:10px">Sin proyectos registrados</p>' : ''}
    </div>`;
  if (canEdit) {
    if ($('#btn-add-proy')) $('#btn-add-proy').addEventListener('click', () => showModalProyecto(null, el));
    $$('.btn-edit-proy').forEach(b => {
      const p = data.find(x => x.id === Number(b.dataset.id));
      b.addEventListener('click', () => showModalProyecto(p, el));
    });
    $$('.btn-del-proy').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Eliminar proyecto?')) return;
        await DEL('/cat/tenneco/proyectos/' + b.dataset.id);
        viewCatProyectos(el);
      });
    });
  }
}

function showModalProyecto(existing, parentEl) {
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal">
    <h3>${existing ? 'Editar' : 'Agregar'} Proyecto</h3>
    <div class="fm-form-group"><label>Nombre del Proyecto</label><input class="fm-input" id="mpr-nombre" value="${existing ? esc(existing.nombre) : ''}"/></div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="mpr-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="mpr-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  $('#mpr-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#mpr-nombre').focus();
  $('#mpr-save').addEventListener('click', async () => {
    try {
      const body = { nombre: $('#mpr-nombre').value };
      if (existing) await PATCH('/cat/tenneco/proyectos/' + existing.id, body);
      else await POST('/cat/tenneco/proyectos', body);
      overlay.remove();
      viewCatProyectos(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGO — PARTES TENNECO
// ═══════════════════════════════════════════════════════════════════════════════
async function viewCatPartes(el, tipo) {
  const endpoint = tipo === 'tenneco' ? '/cat/tenneco/partes' : '/cat/asm/partes';
  const data = await GET(endpoint);
  const isTenneco = tipo === 'tenneco';
  const canEdit = can('edit-catalogos');

  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar">
        ${canEdit ? `<button class="fm-btn fm-btn-primary fm-btn-sm" id="btn-add-parte">+ Agregar</button>` : ''}
      </div>
      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr>
          ${isTenneco ? '<th>Diametro (mm)</th>' : ''}
          <th>Numero de Parte</th>
          ${isTenneco ? '<th>Proyecto</th><th class="text-right">Tam. Muestra</th>' : '<th class="text-right">Pzas/Caja</th><th class="text-right">Pzas/Cama</th>'}
          ${canEdit ? '<th></th>' : ''}
        </tr></thead>
        <tbody>${data.map(p => `<tr>
          ${isTenneco ? `<td>${esc(p.diametro_mm)}</td>` : ''}
          <td class="mono">${esc(p.numero_parte)}</td>
          ${isTenneco
            ? `<td>${esc(p.proyecto || '')}</td><td class="text-right">${p.tamano_muestra || 100}</td>`
            : `<td class="text-right">${p.piezas_por_caja || 0}</td><td class="text-right">${p.piezas_por_cama || 0}</td>`
          }
          ${canEdit ? `<td><button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-parte" data-id="${p.id}">Editar</button> <button class="fm-btn fm-btn-danger fm-btn-sm btn-del-parte" data-id="${p.id}">X</button></td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>
      ${data.length === 0 ? '<p style="color:var(--fm-muted);font-size:13px;margin-top:10px">Sin registros en catalogo</p>' : ''}
    </div>`;

  if (canEdit) {
    if ($('#btn-add-parte')) $('#btn-add-parte').addEventListener('click', () => showModalParte(null, tipo, el));
    $$('.btn-edit-parte').forEach(b => {
      const p = data.find(x => x.id === Number(b.dataset.id));
      b.addEventListener('click', () => showModalParte(p, tipo, el));
    });
    $$('.btn-del-parte').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Eliminar este registro?')) return;
        await DEL(endpoint + '/' + b.dataset.id);
        viewCatPartes(el, tipo);
      });
    });
  }
}

async function showModalParte(existing, tipo, parentEl) {
  const isTenneco = tipo === 'tenneco';
  const endpoint = isTenneco ? '/cat/tenneco/partes' : '/cat/asm/partes';
  let proyOpts = '';
  if (isTenneco) {
    const proyectos = await GET('/cat/tenneco/proyectos');
    proyOpts = proyectos.map(p => `<option value="${esc(p.nombre)}"${existing && existing.proyecto === p.nombre ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('');
  }
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal">
    <h3>${existing ? 'Editar' : 'Agregar'} Parte ${tipo.toUpperCase()}</h3>
    ${isTenneco ? `<div class="fm-form-group"><label>Diametro (mm)</label><input class="fm-input" id="mp-diam" value="${existing ? esc(existing.diametro_mm) : ''}"/></div>` : ''}
    <div class="fm-form-group"><label>Numero de Parte</label><input class="fm-input" id="mp-np" value="${existing ? esc(existing.numero_parte) : ''}"/></div>
    ${isTenneco
      ? `<div class="fm-form-row">
           <div class="fm-form-group"><label>Proyecto</label><select class="fm-input" id="mp-proy"><option value="">— Seleccionar —</option>${proyOpts}</select></div>
           <div class="fm-form-group"><label>Tamano Muestra</label><input class="fm-input" type="number" id="mp-tam" value="${existing ? existing.tamano_muestra : 100}"/></div>
         </div>`
      : `<div class="fm-form-row">
           <div class="fm-form-group"><label>Piezas por Caja</label><input class="fm-input" type="number" id="mp-pcaja" value="${existing ? existing.piezas_por_caja : 0}"/></div>
           <div class="fm-form-group"><label>Piezas por Cama</label><input class="fm-input" type="number" id="mp-pcama" value="${existing ? existing.piezas_por_cama : 0}"/></div>
         </div>`
    }
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="mp-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="mp-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  $('#mp-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#mp-save').addEventListener('click', async () => {
    try {
      const body = isTenneco
        ? { diametro_mm: $('#mp-diam').value, numero_parte: $('#mp-np').value, proyecto: $('#mp-proy').value, tamano_muestra: parseInt($('#mp-tam').value) }
        : { numero_parte: $('#mp-np').value, piezas_por_caja: parseInt($('#mp-pcaja').value), piezas_por_cama: parseInt($('#mp-pcama').value) };
      if (existing) await PATCH(endpoint + '/' + existing.id, body);
      else await POST(endpoint, body);
      overlay.remove();
      if (tipo === 'tenneco') await viewCatPartes(parentEl, tipo);
      else await viewCatPartesAsm(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

async function viewCatPartesAsm(el) {
  return viewCatPartes(el, 'asm');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGO — ESPECIFICACIONES
// ═══════════════════════════════════════════════════════════════════════════════
async function viewCatSpecs(el) {
  const [data, proyectos] = await Promise.all([
    GET('/cat/tenneco/specs'),
    GET('/cat/tenneco/proyectos')
  ]);
  const canEdit = can('edit-catalogos');
  const proyNames = proyectos.map(p => p.nombre);

  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar">
        <label style="font-size:13px;font-weight:600;margin-right:6px">Proyecto:</label>
        <select class="fm-input" id="spec-proy-filter" style="width:200px;display:inline-block">
          <option value="">— Todos —</option>
          ${proyNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
        </select>
        <div style="flex:1"></div>
        ${canEdit ? '<button class="fm-btn fm-btn-primary fm-btn-sm" id="btn-add-spec">+ Agregar</button>' : ''}
      </div>
      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr><th>N/P</th><th>Proyecto</th><th class="text-right">Rug. Min</th><th class="text-right">Rug. Max</th><th class="text-right">Alt. Ax. Min</th><th class="text-right">Alt. Ax. Max</th>${canEdit ? '<th></th>' : ''}</tr></thead>
        <tbody id="tbody-specs"></tbody>
      </table></div>
      <p id="specs-empty" style="color:var(--fm-muted);font-size:13px;margin-top:10px;display:none">Sin especificaciones registradas</p>
    </div>`;

  const renderSpecs = () => {
    const filtro = ($('#spec-proy-filter')?.value || '');
    const filtered = filtro ? data.filter(s => s.proyecto === filtro) : data;
    const tbody = $('#tbody-specs');
    tbody.innerHTML = filtered.map(s => `<tr>
      <td class="mono">${esc(s.numero_parte)}</td><td>${esc(s.proyecto || '')}</td>
      <td class="text-right">${s.rugosidad_min}</td><td class="text-right">${s.rugosidad_max}</td>
      <td class="text-right">${s.altura_axial_min}</td><td class="text-right">${s.altura_axial_max}</td>
      ${canEdit ? `<td><button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-spec" data-id="${s.id}">Editar</button> <button class="fm-btn fm-btn-danger fm-btn-sm btn-del-spec" data-id="${s.id}">X</button></td>` : ''}
    </tr>`).join('');
    $('#specs-empty').style.display = filtered.length === 0 ? 'block' : 'none';
    if (canEdit) {
      $$('.btn-edit-spec').forEach(b => {
        const s = data.find(x => x.id === Number(b.dataset.id));
        b.addEventListener('click', () => showModalSpec(s, el, proyNames));
      });
      $$('.btn-del-spec').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('Eliminar especificacion?')) return;
          await DEL('/cat/tenneco/specs/' + b.dataset.id);
          viewCatSpecs(el);
        });
      });
    }
  };
  renderSpecs();
  if ($('#spec-proy-filter')) $('#spec-proy-filter').addEventListener('change', renderSpecs);
  if (canEdit && $('#btn-add-spec')) $('#btn-add-spec').addEventListener('click', () => showModalSpec(null, el, proyNames));
}

async function showModalSpec(existing, parentEl, proyNames) {
  if (!proyNames) {
    const proyectos = await GET('/cat/tenneco/proyectos');
    proyNames = proyectos.map(p => p.nombre);
  }
  const proyOpts = proyNames.map(n => `<option value="${esc(n)}"${existing && existing.proyecto === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const partes = await GET('/cat/tenneco/partes');

  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal">
    <h3>${existing ? 'Editar' : 'Agregar'} Especificacion</h3>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Proyecto</label><select class="fm-input" id="ms-proy"><option value="">— Seleccionar —</option>${proyOpts}</select></div>
      <div class="fm-form-group"><label>Numero de Parte</label><select class="fm-input" id="ms-np"><option value="">— Seleccionar —</option></select></div>
    </div>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Rugosidad Min</label><input class="fm-input" type="number" step="0.01" id="ms-rmin" value="${existing ? existing.rugosidad_min : ''}"/></div>
      <div class="fm-form-group"><label>Rugosidad Max</label><input class="fm-input" type="number" step="0.01" id="ms-rmax" value="${existing ? existing.rugosidad_max : ''}"/></div>
    </div>
    <div class="fm-form-row">
      <div class="fm-form-group"><label>Altura Axial Min</label><input class="fm-input" type="number" step="0.01" id="ms-amin" value="${existing ? existing.altura_axial_min : ''}"/></div>
      <div class="fm-form-group"><label>Altura Axial Max</label><input class="fm-input" type="number" step="0.01" id="ms-amax" value="${existing ? existing.altura_axial_max : ''}"/></div>
    </div>
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="ms-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="ms-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const fillNP = (proy) => {
    const npSel = $('#ms-np');
    const filtered = proy ? partes.filter(p => p.proyecto === proy) : partes;
    npSel.innerHTML = '<option value="">— Seleccionar —</option>' + filtered.map(p =>
      `<option value="${esc(p.numero_parte)}"${existing && existing.numero_parte === p.numero_parte ? ' selected' : ''}>${esc(p.numero_parte)} (${esc(p.diametro_mm)} mm)</option>`
    ).join('');
  };
  fillNP(existing ? existing.proyecto : '');
  $('#ms-proy').addEventListener('change', () => fillNP($('#ms-proy').value));

  $('#ms-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#ms-save').addEventListener('click', async () => {
    try {
      const body = {
        numero_parte: $('#ms-np').value,
        proyecto: $('#ms-proy').value,
        rugosidad_min: parseFloat($('#ms-rmin').value),
        rugosidad_max: parseFloat($('#ms-rmax').value),
        altura_axial_min: parseFloat($('#ms-amin').value),
        altura_axial_max: parseFloat($('#ms-amax').value)
      };
      if (existing) await PATCH('/cat/tenneco/specs/' + existing.id, body);
      else await POST('/cat/tenneco/specs', body);
      overlay.remove();
      viewCatSpecs(parentEl);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGO — DEFECTOS (Tenneco / ASM)
// ═══════════════════════════════════════════════════════════════════════════════
async function viewCatDefectos(el, tipo) {
  const endpoint = tipo === 'tenneco' ? '/cat/tenneco/defectos' : '/cat/asm/defectos';
  const data = await GET(endpoint);
  const canEdit = can('edit-catalogos');

  el.innerHTML = `
    <div class="fm-card">
      <div class="fm-toolbar">${canEdit ? `<button class="fm-btn fm-btn-primary fm-btn-sm" id="btn-add-def">+ Agregar</button>` : ''}</div>
      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr><th>#</th><th>Defecto</th><th>Descripcion</th><th>Imagen</th>${canEdit ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.map((d, i) => `<tr>
          <td>${i + 1}</td><td><strong>${esc(d.defecto)}</strong></td><td>${esc(d.descripcion || '')}</td>
          <td>${d.imagen_b64 ? `<img class="defecto-img" src="${d.imagen_b64}" alt="${esc(d.defecto)}" onclick="showImageFull(this.src)"/>` : '<span style="color:var(--fm-muted)">-</span>'}</td>
          ${canEdit ? `<td><button class="fm-btn fm-btn-outline fm-btn-sm btn-edit-def" data-id="${d.id}">Editar</button> <button class="fm-btn fm-btn-danger fm-btn-sm btn-del-def" data-id="${d.id}">X</button></td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>
      ${data.length === 0 ? '<p style="color:var(--fm-muted);font-size:13px;margin-top:10px">Sin defectos registrados</p>' : ''}
    </div>`;

  if (canEdit) {
    if ($('#btn-add-def')) $('#btn-add-def').addEventListener('click', () => showModalDefecto(null, tipo, el));
    $$('.btn-edit-def').forEach(b => {
      const d = data.find(x => x.id === Number(b.dataset.id));
      b.addEventListener('click', () => showModalDefecto(d, tipo, el));
    });
    $$('.btn-del-def').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Eliminar defecto?')) return;
        await DEL(endpoint + '/' + b.dataset.id);
        viewCatDefectos(el, tipo);
      });
    });
  }
}

function showModalDefecto(existing, tipo, parentEl) {
  const endpoint = tipo === 'tenneco' ? '/cat/tenneco/defectos' : '/cat/asm/defectos';
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal">
    <h3>${existing ? 'Editar' : 'Agregar'} Defecto</h3>
    <div class="fm-form-group"><label>Defecto</label><input class="fm-input" id="md-def" value="${existing ? esc(existing.defecto) : ''}"/></div>
    <div class="fm-form-group"><label>Descripcion</label><input class="fm-input" id="md-desc" value="${existing ? esc(existing.descripcion || '') : ''}"/></div>
    <div class="fm-form-group"><label>Imagen (opcional)</label><input type="file" accept="image/*" id="md-img" class="fm-input"/></div>
    ${existing && existing.imagen_b64 ? `<img src="${existing.imagen_b64}" style="max-width:200px;border-radius:8px;margin-bottom:10px"/>` : ''}
    <div class="fm-modal-footer">
      <button class="fm-btn fm-btn-outline fm-btn-sm" id="md-cancel">Cancelar</button>
      <button class="fm-btn fm-btn-primary fm-btn-sm" id="md-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  $('#md-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let imgB64 = existing ? existing.imagen_b64 : null;
  $('#md-img').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { imgB64 = ev.target.result; };
    reader.readAsDataURL(file);
  });

  $('#md-save').addEventListener('click', async () => {
    try {
      const body = { defecto: $('#md-def').value, descripcion: $('#md-desc').value, imagen_b64: imgB64 };
      if (existing) await PATCH(endpoint + '/' + existing.id, body);
      else await POST(endpoint, body);
      overlay.remove();
      viewCatDefectos(parentEl, tipo);
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// Show full image
window.showImageFull = function(src) {
  const overlay = document.createElement('div');
  overlay.className = 'fm-modal-overlay';
  overlay.innerHTML = `<div class="fm-modal" style="text-align:center"><img class="defecto-img-full" src="${src}"/><div class="fm-modal-footer"><button class="fm-btn fm-btn-outline fm-btn-sm" id="img-close">Cerrar</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#img-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};

// ── INIT ─────────────────────────────────────────────────────────────────────
tryRestore();
render();
