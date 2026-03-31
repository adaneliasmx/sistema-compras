/* ══════════════════════════════════════════════════════════════════════════════
   MÓDULO REGISTROS DE PRODUCCIÓN — SPA vanilla JS
   API base: /api/produccion
   ══════════════════════════════════════════════════════════════════════════════ */

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  user:    null,
  token:   null,
  section: 'dashboard',
  // Cachés
  items:   [],
  tanques: [],
  lineas:  [],
  // Catálogos
  catalogL3: {},
  catalogL4: {},
  // Paros activos por línea
  paroActivo: { L3: null, L4: null },
  // Polling pizarrón
  _pizarronTimer: null,
  // Inactividad
  _actTimer: null
};

// ── Menú por rol ──────────────────────────────────────────────────────────────
const MENU = {
  admin: [
    ['dashboard',      '📊', 'Dashboard'],
    ['linea-3',        '🏭', 'Línea 3'],
    ['linea-4',        '🏭', 'Línea 4'],
    ['reportes',       '📈', 'Reportes'],
    ['pizarron',       '📋', 'Pizarrón KPI'],
    ['---', '', 'Catálogos'],
    ['catalogos-l3',   '📦', 'Catálogos L3'],
    ['catalogos-l4',   '📦', 'Catálogos L4'],
    ['operadores',     '👤', 'Operadores'],
    ['configuracion',  '⚙️', 'Configuración']
  ],
  operador: [
    ['dashboard',  '📊', 'Mi Pizarrón'],
    ['linea-op',   '🏭', 'Mi Línea'],
    ['pizarron',   '📋', 'Pizarrón']
  ]
};

const SECTION_TITLES = {
  'dashboard':      'Dashboard de Producción',
  'linea-3':        'Línea 3 — Tarjetero Activo',
  'linea-4':        'Línea 4 — Tarjetero Activo',
  'linea-op':       'Mi Línea — Tarjetero Activo',
  'reportes':       'Reportes de Producción',
  'pizarron':       'Pizarrón KPI',
  'catalogos-l3':   'Catálogos Línea 3',
  'catalogos-l4':   'Catálogos Línea 4',
  'operadores':     'Gestión de Operadores',
  'configuracion':  'Configuración'
};

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
    }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch('/api/produccion' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); return; }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const GET   = (p)     => api('GET',   p);
const POST  = (p, b)  => api('POST',  p, b);
const PUT   = (p, b)  => api('PUT',   p, b);
const PATCH = (p, b)  => api('PATCH', p, b);
const DEL   = (p)     => api('DELETE', p);

// ── Inactividad (30 min) ──────────────────────────────────────────────────────
function resetTimer() {
  clearTimeout(state._actTimer);
  state._actTimer = setTimeout(() => { logout(); }, 30 * 60 * 1000);
}
document.addEventListener('mousemove', resetTimer);
document.addEventListener('keydown',   resetTimer);

// ── Auth ──────────────────────────────────────────────────────────────────────
function tryRestore() {
  const t = localStorage.getItem('prod_token');
  const u = localStorage.getItem('prod_user');
  if (t && u) {
    try { state.token = t; state.user = JSON.parse(u); return true; }
    catch { return false; }
  }
  return false;
}
function saveSession(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('prod_token', token);
  localStorage.setItem('prod_user', JSON.stringify(user));
}
function logout() {
  clearInterval(state._pizarronTimer);
  state.token = null; state.user = null;
  localStorage.removeItem('prod_token');
  localStorage.removeItem('prod_user');
  render();
}

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(section) {
  clearInterval(state._pizarronTimer);
  state._pizarronTimer = null;
  state.section = section;
  renderMain();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getTurnoColor(turno) {
  if (!turno) return '';
  const t = String(turno).toUpperCase();
  if (t === 'T1' || t === '1') return 'badge-t1';
  if (t === 'T2' || t === '2') return 'badge-t2';
  if (t === 'T3' || t === '3') return 'badge-t3';
  return '';
}

function kpiColor(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return 'kpi-na';
  const n = parseFloat(pct);
  if (n >= 90) return 'kpi-green';
  if (n >= 70) return 'kpi-amber';
  return 'kpi-red';
}

function fmtPct(val) {
  if (val === null || val === undefined || val === '') return '<span class="kpi-na">—</span>';
  return parseFloat(val).toFixed(1) + '%';
}

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(str) {
  if (!str) return '—';
  return fmtDate(str) + ' ' + fmtTime(str);
}

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function lineaFromSection(section) {
  if (section === 'linea-3') return 'L3';
  if (section === 'linea-4') return 'L4';
  if (section === 'linea-op') return state.user?.linea || 'L3';
  return 'L3';
}

// ── Render raíz ───────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!state.user) { app.innerHTML = renderLogin(); bindLogin(); return; }
  app.innerHTML = renderLayout();
  bindNav();
  // Si el operador entra, ajustar la sección de línea
  if (state.user.prod_role === 'operador') {
    const linea = state.user.linea || 'L3';
    // actualizar la etiqueta del menú de línea dinámicamente
    const navEl = document.querySelector('[data-nav="linea-op"]');
    if (navEl) navEl.textContent = '🏭 Línea ' + linea.replace('L', '');
  }
  renderMain();
  resetTimer();
}

// ── Login ─────────────────────────────────────────────────────────────────────
function renderLogin() {
  return `
  <div class="prod-login">
    <div class="login-card">
      <div class="login-logo">
        <div class="icon">🏭</div>
        <h1>Registros de Producción</h1>
        <p>Control de cargas · Pizarrón KPI</p>
      </div>
      <label>Nombre o correo</label>
      <input type="text" id="l-user" placeholder="Nombre de operador o correo" autocomplete="username" />
      <label>PIN / Contraseña</label>
      <input type="password" id="l-pass" placeholder="••••" autocomplete="current-password" />
      <label>Línea</label>
      <select id="l-linea">
        <option value="">— Seleccionar línea —</option>
        <option value="L3">Línea 3</option>
        <option value="L4">Línea 4</option>
        <option value="admin">Administrador</option>
      </select>
      <button class="btn-login" id="btn-login">Ingresar</button>
      <p class="login-error" id="login-err"></p>
    </div>
  </div>`;
}

function bindLogin() {
  const btn = document.getElementById('btn-login');
  const doLogin = async () => {
    const usuario = document.getElementById('l-user').value.trim();
    const pass    = document.getElementById('l-pass').value;
    const linea   = document.getElementById('l-linea').value;
    const err     = document.getElementById('login-err');
    if (!usuario || !pass) { err.textContent = 'Ingresa usuario y contraseña'; return; }
    btn.disabled = true; btn.textContent = 'Verificando...';
    try {
      const res = await fetch('/api/produccion/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ usuario, password: pass, linea: linea || undefined })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = data.error || 'Error al iniciar sesión';
        btn.disabled = false; btn.textContent = 'Ingresar';
        return;
      }
      saveSession(data.token, data.user);
      render();
    } catch (e) {
      err.textContent = 'Error de red: ' + e.message;
      btn.disabled = false; btn.textContent = 'Ingresar';
    }
  };
  btn.addEventListener('click', doLogin);
  document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

// ── Layout (sidebar + main) ───────────────────────────────────────────────────
function renderLayout() {
  const role = state.user.prod_role || 'operador';
  const rawMenu = MENU[role] || MENU.operador;
  const menuHtml = rawMenu.map(([id, icon, label]) => {
    if (id === '---') return `<div class="p-nav-group">${label}</div>`;
    const active = state.section === id;
    return `<div class="p-nav-item${active ? ' active' : ''}" data-nav="${id}">${icon} ${label}</div>`;
  }).join('');

  const roleBadge = role === 'admin' ? 'badge-admin' : 'badge-operador';
  const linea = state.user.linea ? ` · ${state.user.linea}` : '';

  return `
  <div class="prod-layout">
    <nav class="p-sidebar">
      <div class="p-sidebar-brand">
        <div class="s-icon">🏭</div>
        <div>
          <div class="s-title">Producción</div>
          <div class="s-sub">Registros de Cargas</div>
        </div>
      </div>
      <div class="p-nav">${menuHtml}</div>
      <div class="p-sidebar-footer">
        <div class="p-user-info">
          <strong>${escHtml(state.user.nombre || state.user.full_name || state.user.email)}</strong>
          <span class="badge-role ${roleBadge}">${role}${linea}</span>
        </div>
        <button class="btn-logout" id="btn-logout">Cerrar sesión</button>
      </div>
    </nav>
    <div class="p-main">
      <div class="p-topbar">
        <h2 id="topbar-title">${SECTION_TITLES[state.section] || ''}</h2>
      </div>
      <div class="p-content" id="p-content"></div>
    </div>
  </div>`;
}

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
  document.getElementById('btn-logout')?.addEventListener('click', logout);
}

// ── Render sección actual ─────────────────────────────────────────────────────
async function renderMain() {
  const el    = document.getElementById('p-content');
  const title = document.getElementById('topbar-title');
  if (!el) return;
  if (title) title.textContent = SECTION_TITLES[state.section] || '';
  document.querySelectorAll('[data-nav]').forEach(n => {
    n.classList.toggle('active', n.dataset.nav === state.section);
  });
  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
  try {
    switch (state.section) {
      case 'dashboard':     await viewDashboard(el);     break;
      case 'linea-3':       await viewLinea(el, 'L3');   break;
      case 'linea-4':       await viewLinea(el, 'L4');   break;
      case 'linea-op':      await viewLinea(el, lineaFromSection('linea-op')); break;
      case 'reportes':      await viewReportes(el);      break;
      case 'pizarron':      await viewPizarron(el);      break;
      case 'catalogos-l3':  await viewCatalogos(el, 'L3'); break;
      case 'catalogos-l4':  await viewCatalogos(el, 'L4'); break;
      case 'operadores':    await viewOperadores(el);    break;
      case 'configuracion': await viewConfiguracion(el); break;
      default:
        el.innerHTML = '<p class="empty-state">Sección no encontrada.</p>';
    }
  } catch (e) {
    el.innerHTML = `<div class="alert alert-warn">⚠️ Error al cargar: ${escHtml(e.message)}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function showModal(html, opts = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className  = 'modal-overlay';
  overlay.id         = 'prod-modal-overlay';
  const sizeClass    = opts.size ? `modal-${opts.size}` : '';
  overlay.innerHTML  = `<div class="modal-box ${sizeClass}">${html}</div>`;
  document.body.appendChild(overlay);
  // Close on backdrop click
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  return overlay;
}

function closeModal() {
  const m = document.getElementById('prod-modal-overlay');
  if (m) m.remove();
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

async function viewDashboard(el) {
  let stats = { activas_l3: 0, activas_l4: 0, cargas_hoy: 0, eficiencia_hoy: null };
  let miniPizarron = [];
  try {
    const data = await GET('/dashboard');
    if (data) {
      stats       = { ...stats, ...data };
      miniPizarron = data.mini_pizarron || [];
    }
  } catch {}

  const kpiHtml = miniPizarron.length > 0 ? `
    <div class="table-card">
      <div class="table-header"><h3>Últimas 3 horas — KPI</h3></div>
      <div class="table-scroll">
        <table class="pizarron-table">
          <thead>
            <tr>
              <th>Hr</th><th>Línea</th><th>Eficiencia</th><th>Calidad</th><th>Disponibilidad</th>
            </tr>
          </thead>
          <tbody>
            ${miniPizarron.map(r => `
              <tr>
                <td>${escHtml(r.hora)}</td>
                <td>${escHtml(r.linea)}</td>
                <td class="${kpiColor(r.eficiencia)}">${fmtPct(r.eficiencia)}</td>
                <td class="${kpiColor(r.calidad)}">${fmtPct(r.calidad)}</td>
                <td class="${kpiColor(r.disponibilidad)}">${fmtPct(r.disponibilidad)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '<div class="empty-state"><div class="icon">📋</div><p>Sin datos en las últimas 3 horas.</p></div>';

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:#fef3c7">🏭</div>
        <div>
          <div class="stat-value">${stats.activas_l3 ?? 0}</div>
          <div class="stat-label">Cargas activas hoy L3</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#dbeafe">🏭</div>
        <div>
          <div class="stat-value">${stats.activas_l4 ?? 0}</div>
          <div class="stat-label">Cargas activas hoy L4</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#dcfce7">✅</div>
        <div>
          <div class="stat-value">${stats.cargas_hoy ?? 0}</div>
          <div class="stat-label">Cargas completadas hoy</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#f3e8ff">📊</div>
        <div>
          <div class="stat-value">${stats.eficiencia_hoy != null ? parseFloat(stats.eficiencia_hoy).toFixed(1) + '%' : '—'}</div>
          <div class="stat-label">Eficiencia promedio hoy</div>
        </div>
      </div>
    </div>
    <h3 style="font-size:15px;font-weight:800;margin-bottom:12px">Mini Pizarrón KPI</h3>
    ${kpiHtml}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: LÍNEA (tarjetero activo)
// ══════════════════════════════════════════════════════════════════════════════

async function viewLinea(el, linea) {
  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando tarjetas...</p></div>';
  try {
    const [cargasData, catalogData, parosData] = await Promise.all([
      GET(`/cargas/${linea}/activas`),
      GET(`/catalogos/${linea}`),
      GET(`/paros/${linea}/activo`).catch(() => null)
    ]);
    const cargas    = Array.isArray(cargasData) ? cargasData : (cargasData?.cargas || []);
    const catalogo  = catalogData || {};
    const paroActivo = parosData?.paro || null;
    state.paroActivo[linea] = paroActivo;

    // Banner de paro activo
    const paroBanner = paroActivo ? `
      <div class="paro-banner">
        <div class="paro-info">
          <span>🔴</span>
          <span><strong>PARO ACTIVO:</strong> ${escHtml(paroActivo.motivo)} — ${escHtml(paroActivo.sub_motivo || '')}
          &nbsp;<small>desde ${fmtTime(paroActivo.inicio)}</small></span>
        </div>
        <button class="btn btn-outline btn-sm" id="btn-cerrar-paro" data-id="${paroActivo.id}">
          ✅ Cerrar Paro
        </button>
      </div>` : '';

    const tarjetasHtml = cargas.length === 0
      ? '<div class="empty-state"><div class="icon">📭</div><p>No hay cargas activas en esta línea.</p></div>'
      : `<div class="tarjetero-grid">${cargas.map(c => renderTarjeta(c)).join('')}</div>`;

    el.innerHTML = `
      ${paroBanner}
      <div class="tarjetero-header">
        <h3>Línea ${linea.replace('L','')} — Tarjetero Activo <span class="badge badge-activo">${cargas.length} activas</span></h3>
        <div class="tarjetero-actions">
          <button class="btn btn-danger btn-sm btn-paro" id="btn-nueva-paro">⏸ Registrar Paro</button>
          <button class="btn btn-primary" id="btn-nueva-carga">+ Registrar Carga</button>
        </div>
      </div>
      ${tarjetasHtml}`;

    // Bind events
    el.querySelector('#btn-nueva-carga')?.addEventListener('click', () => {
      openModalCarga(linea, catalogo);
    });
    el.querySelector('#btn-nueva-paro')?.addEventListener('click', () => {
      openModalParo(linea, catalogo, () => viewLinea(el, linea));
    });
    el.querySelector('#btn-cerrar-paro')?.addEventListener('click', async (ev) => {
      const id = ev.currentTarget.dataset.id;
      try {
        await PATCH(`/paros/${linea}/${id}/cerrar`, {});
        state.paroActivo[linea] = null;
        viewLinea(el, linea);
      } catch (e) {
        alert('Error al cerrar paro: ' + e.message);
      }
    });

    // Bind tarjeta buttons
    el.querySelectorAll('[data-descargar]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.descargar;
        const carga = cargas.find(c => String(c.id) === String(id));
        openModalDescargar(linea, carga, catalogo, () => viewLinea(el, linea));
      });
    });
    el.querySelectorAll('[data-paro-carga]').forEach(btn => {
      btn.addEventListener('click', () => {
        openModalParo(linea, catalogo, () => viewLinea(el, linea));
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="alert alert-warn">⚠️ Error: ${escHtml(e.message)}</div>`;
  }
}

function renderTarjeta(c) {
  const estado = c.estado || 'activo';
  const badgeClass = {
    activo:      'badge-activo',
    procesado:   'badge-procesado',
    defecto:     'badge-defecto',
    reprocesado: 'badge-reprocesado'
  }[estado] || 'badge-activo';

  return `
  <div class="tarjeta-card">
    <div class="tarjeta-header">
      <span class="herramental-no">${escHtml(c.herramental_no || c.herramental || '—')}</span>
      <span class="folio">#${escHtml(c.folio || c.id)}</span>
    </div>
    <div class="tarjeta-body">
      <div class="tarjeta-componente">${escHtml(c.componente || '— vacía —')}</div>
      <div class="tarjeta-cliente">${escHtml(c.cliente || '')}</div>
      <div class="tarjeta-meta">
        <div class="tarjeta-meta-item">
          <span class="meta-label">Varillas</span>
          <span class="meta-val">${c.varillas ?? '—'}</span>
        </div>
        <div class="tarjeta-meta-item">
          <span class="meta-label">Cantidad</span>
          <span class="meta-val">${c.cantidad ?? '—'}</span>
        </div>
        <div class="tarjeta-meta-item">
          <span class="meta-label">Proceso</span>
          <span class="meta-val">${escHtml(c.proceso || '—')}</span>
        </div>
        <div class="tarjeta-meta-item">
          <span class="meta-label">Acabado</span>
          <span class="meta-val">${escHtml(c.acabado || '—')}</span>
        </div>
        <div class="tarjeta-meta-item">
          <span class="meta-label">Cargado</span>
          <span class="meta-val">${fmtTime(c.fecha_carga || c.created_at)}</span>
        </div>
        <div class="tarjeta-meta-item">
          <span class="meta-label">Operador</span>
          <span class="meta-val">${escHtml(c.operador || '—')}</span>
        </div>
      </div>
    </div>
    <div class="tarjeta-footer">
      <span class="badge ${badgeClass}">${estado}</span>
      <div style="display:flex;gap:6px">
        <button class="btn-paro" data-paro-carga="${c.id}">⏸ Paro</button>
        <button class="btn-descargar" data-descargar="${c.id}">⬇ Descargar</button>
      </div>
    </div>
  </div>`;
}

// ── Modal: Registrar Carga ─────────────────────────────────────────────────────
async function openModalCarga(linea, catalogo) {
  // Datos del catálogo
  const herramentales = catalogo.herramentales || [];
  const componentes   = catalogo.componentes   || [];
  const procesos      = catalogo.procesos      || [];
  const acabados      = catalogo.acabados      || [];
  const operadores    = catalogo.operadores    || [];

  const htmlHerr = herramentales.map(h => `<option value="${escHtml(h.no || h.id)}">${escHtml(h.no || h.nombre)}</option>`).join('');
  const htmlComp = componentes.map(c   => `<option value="${c.id}" data-cliente="${escHtml(c.cliente||'')}" data-optima="${c.carga_optima_varillas||''}" data-pzobj="${c.piezas_objetivo||''}">${escHtml(c.nombre)}</option>`).join('');
  const htmlProc = procesos.map(p      => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('');
  const htmlAcab = acabados.map(a      => `<option value="${a.id}">${escHtml(a.nombre)}</option>`).join('');
  const htmlOper = operadores.map(o    => `<option value="${o.id}">${escHtml(o.nombre)}</option>`).join('');

  showModal(`
    <h3>Registrar Carga — Línea ${linea.replace('L','')}</h3>
    <div class="form-grid">
      <div class="form-group">
        <label>Herramental</label>
        <select id="mc-herramental"><option value="">— Seleccionar —</option>${htmlHerr}</select>
      </div>
      <div class="form-group">
        <label>Componente</label>
        <select id="mc-componente"><option value="">— Seleccionar —</option>${htmlComp}</select>
      </div>
      <div class="form-group full" id="mc-vacia-wrap" style="display:none">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="mc-carga-vacia" /> Carga vacía (sin componente)
        </label>
      </div>
      <div class="form-group">
        <label>Cliente</label>
        <input type="text" id="mc-cliente" placeholder="Auto-llena del componente" readonly />
      </div>
      <div class="form-group">
        <label>Proceso</label>
        <select id="mc-proceso"><option value="">— Seleccionar —</option>${htmlProc}</select>
      </div>
      <div class="form-group">
        <label>Acabado</label>
        <select id="mc-acabado"><option value="">— Seleccionar —</option>${htmlAcab}</select>
      </div>
      <div class="form-group">
        <label>Varillas <span id="mc-optima-hint" style="color:var(--p-accent);font-weight:700"></span></label>
        <input type="number" id="mc-varillas" min="1" max="14" placeholder="1–14" />
      </div>
      <div class="form-group">
        <label>Piezas por varilla <span id="mc-pzobj-hint" style="color:var(--p-muted)"></span></label>
        <input type="number" id="mc-pzs-varilla" min="1" placeholder="Número de piezas" />
      </div>
      <div class="form-group">
        <label>Cantidad total</label>
        <div class="cantidad-display" id="mc-cantidad">—</div>
      </div>
      <div class="form-group">
        <label>Operador</label>
        <select id="mc-operador"><option value="">— Seleccionar —</option>${htmlOper}</select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="mc-submit">⬆ Cargar Material</button>
    </div>`, { size: 'lg' });

  // Mostrar checkbox carga vacía cuando no hay componentes
  if (componentes.length === 0) {
    document.getElementById('mc-vacia-wrap').style.display = '';
  }

  // Auto-fill cliente y hints desde componente
  document.getElementById('mc-componente').addEventListener('change', function() {
    const opt = this.options[this.selectedIndex];
    document.getElementById('mc-cliente').value = opt.dataset.cliente || '';
    const optima = opt.dataset.optima;
    const pzobj  = opt.dataset.pzobj;
    document.getElementById('mc-optima-hint').textContent = optima ? `(óptimo: ${optima})` : '';
    document.getElementById('mc-pzobj-hint').textContent  = pzobj  ? `(obj: ${pzobj}/var)` : '';
    if (pzobj) document.getElementById('mc-pzs-varilla').value = pzobj;
    calcCantidad();
  });

  // Calcular cantidad
  function calcCantidad() {
    const varillas  = parseInt(document.getElementById('mc-varillas').value)    || 0;
    const pzs       = parseInt(document.getElementById('mc-pzs-varilla').value) || 0;
    const total     = varillas > 0 && pzs > 0 ? varillas * pzs : null;
    document.getElementById('mc-cantidad').textContent = total != null ? total : '—';
  }
  document.getElementById('mc-varillas').addEventListener('input', calcCantidad);
  document.getElementById('mc-pzs-varilla').addEventListener('input', calcCantidad);

  document.getElementById('mc-submit').addEventListener('click', async () => {
    const vacia    = document.getElementById('mc-carga-vacia')?.checked || false;
    const payload  = {
      herramental:    document.getElementById('mc-herramental').value,
      componente_id:  vacia ? null : document.getElementById('mc-componente').value || null,
      carga_vacia:    vacia,
      cliente:        document.getElementById('mc-cliente').value.trim(),
      proceso_id:     document.getElementById('mc-proceso').value || null,
      acabado_id:     document.getElementById('mc-acabado').value || null,
      varillas:       parseInt(document.getElementById('mc-varillas').value) || null,
      pzs_varilla:    parseInt(document.getElementById('mc-pzs-varilla').value) || null,
      cantidad:       parseInt(document.getElementById('mc-cantidad').textContent) || null,
      operador_id:    document.getElementById('mc-operador').value || null
    };
    if (!payload.herramental) { alert('Selecciona un herramental'); return; }
    const btn = document.getElementById('mc-submit');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await POST(`/cargas/${linea}`, payload);
      closeModal();
      // Refrescar la vista activa
      const elContent = document.getElementById('p-content');
      if (elContent) viewLinea(elContent, linea);
    } catch (e) {
      btn.disabled = false; btn.textContent = '⬆ Cargar Material';
      alert('Error: ' + e.message);
    }
  });
}

// ── Modal: Descargar carga ─────────────────────────────────────────────────────
function openModalDescargar(linea, carga, catalogo, onDone) {
  const defectos = catalogo.defectos || [];
  const htmlDef  = defectos.map(d => `<option value="${d.id}" data-nombre="${escHtml(d.nombre)}">${escHtml(d.nombre)}</option>`).join('');

  showModal(`
    <h3>Descargar — Herramental ${escHtml(carga?.herramental_no || carga?.herramental || carga?.id)}</h3>
    <p class="modal-question">¿El material salió bien?</p>
    <div class="modal-question-btns" id="md-pregunta-btns">
      <button class="btn btn-success" id="md-si">✅ Sí, salió bien</button>
      <button class="btn btn-danger"  id="md-no">❌ No, hubo defecto</button>
    </div>
    <div id="md-defecto-section" style="display:none;margin-top:20px">
      <div class="form-group" style="margin-bottom:14px">
        <label>Defecto encontrado</label>
        <select id="md-defecto-sel">
          <option value="">— Seleccionar defecto —</option>
          ${htmlDef}
        </select>
      </div>
      <p class="modal-question" style="font-size:14px">¿Se reprocesa?</p>
      <div class="modal-question-btns">
        <button class="btn btn-info"    id="md-reprocesar">🔄 Sí, reprocesar</button>
        <button class="btn btn-danger"  id="md-rechazar">🗑 No, rechazar</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
    </div>`, { size: 'sm' });

  document.getElementById('md-si').addEventListener('click', async () => {
    try {
      await POST(`/cargas/${linea}/${carga.id}/descargar`, { salio_bien: true });
      closeModal();
      onDone();
    } catch (e) { alert('Error: ' + e.message); }
  });

  document.getElementById('md-no').addEventListener('click', () => {
    document.getElementById('md-pregunta-btns').style.display = 'none';
    document.getElementById('md-defecto-section').style.display = '';
  });

  document.getElementById('md-reprocesar').addEventListener('click', async () => {
    const defectoSel = document.getElementById('md-defecto-sel');
    const defecto_id = defectoSel.value;
    const defecto    = defectoSel.options[defectoSel.selectedIndex]?.dataset?.nombre || '';
    try {
      await POST(`/cargas/${linea}/${carga.id}/reprocesar`, { defecto_id: defecto_id || null, defecto });
      closeModal();
      onDone();
    } catch (e) { alert('Error: ' + e.message); }
  });

  document.getElementById('md-rechazar').addEventListener('click', async () => {
    const defectoSel = document.getElementById('md-defecto-sel');
    const defecto_id = defectoSel.value;
    const defecto    = defectoSel.options[defectoSel.selectedIndex]?.dataset?.nombre || '';
    if (!defecto_id) { alert('Selecciona el defecto encontrado'); return; }
    try {
      await POST(`/cargas/${linea}/${carga.id}/descargar`, { salio_bien: false, defecto_id, defecto });
      closeModal();
      onDone();
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// ── Modal: Registrar Paro ─────────────────────────────────────────────────────
function openModalParo(linea, catalogo, onDone) {
  const motivosParo  = catalogo.motivos_paro  || [];
  const subMotivos   = catalogo.sub_motivos   || [];

  const htmlMotivos = motivosParo.map(m =>
    `<option value="${m.id}" data-nombre="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`
  ).join('');

  showModal(`
    <h3>Registrar Paro — Línea ${linea.replace('L','')}</h3>
    <div class="form-grid">
      <div class="form-group full">
        <label>Motivo de paro</label>
        <select id="mp-motivo">
          <option value="">— Seleccionar motivo —</option>
          ${htmlMotivos}
        </select>
      </div>
      <div class="form-group full">
        <label>Sub-motivo</label>
        <select id="mp-submotivo" disabled>
          <option value="">— Primero selecciona motivo —</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger"  id="mp-submit">⏸ Registrar Paro</button>
    </div>`, { size: 'sm' });

  document.getElementById('mp-motivo').addEventListener('change', function() {
    const motivoId = this.value;
    const subSel   = document.getElementById('mp-submotivo');
    const filtrados = subMotivos.filter(s => String(s.motivo_id) === String(motivoId));
    subSel.innerHTML = filtrados.length > 0
      ? '<option value="">— Seleccionar —</option>' + filtrados.map(s => `<option value="${s.id}">${escHtml(s.nombre)}</option>`).join('')
      : '<option value="">— Sin sub-motivos —</option>';
    subSel.disabled = filtrados.length === 0;
  });

  document.getElementById('mp-submit').addEventListener('click', async () => {
    const motivoSel   = document.getElementById('mp-motivo');
    const subSel      = document.getElementById('mp-submotivo');
    const motivo_id   = motivoSel.value;
    const motivo      = motivoSel.options[motivoSel.selectedIndex]?.dataset?.nombre || '';
    const sub_motivo_id = subSel.value || null;
    const sub_motivo  = subSel.options[subSel.selectedIndex]?.text || '';
    if (!motivo_id) { alert('Selecciona el motivo de paro'); return; }
    const btn = document.getElementById('mp-submit');
    btn.disabled = true; btn.textContent = 'Registrando...';
    try {
      await POST(`/paros/${linea}`, { motivo_id, motivo, sub_motivo_id, sub_motivo });
      closeModal();
      onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = '⏸ Registrar Paro';
      alert('Error: ' + e.message);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: PIZARRÓN KPI
// ══════════════════════════════════════════════════════════════════════════════

async function viewPizarron(el) {
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="filters-bar">
      <div>
        <span class="flabel">Línea</span>
        <select id="pz-linea">
          <option value="">Ambas</option>
          <option value="L3">Línea 3</option>
          <option value="L4">Línea 4</option>
        </select>
      </div>
      <div>
        <span class="flabel">Fecha</span>
        <input type="date" id="pz-fecha" value="${today}" />
      </div>
      <div>
        <span class="flabel">Turno</span>
        <select id="pz-turno">
          <option value="">Todos</option>
          <option value="T1">T1</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
        </select>
      </div>
      <button class="btn btn-outline btn-sm" id="pz-buscar">🔍 Consultar</button>
      ${state.user?.prod_role === 'admin' ? '<button class="btn btn-dark btn-sm" id="pz-export">📥 Exportar Excel</button>' : ''}
    </div>
    <div id="pz-resultado">
      <div class="empty-state"><div class="icon">📋</div><p>Selecciona filtros y presiona Consultar.</p></div>
    </div>`;

  async function cargarPizarron() {
    const linea  = document.getElementById('pz-linea').value;
    const fecha  = document.getElementById('pz-fecha').value;
    const turno  = document.getElementById('pz-turno').value;
    const res    = document.getElementById('pz-resultado');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando KPI...</p></div>';
    try {
      const params = new URLSearchParams();
      if (linea) params.set('linea', linea);
      if (fecha) params.set('fecha', fecha);
      if (turno) params.set('turno', turno);
      const data = await GET(`/pizarron?${params}`);
      const rows = data?.rows || [];
      if (rows.length === 0) {
        res.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Sin registros para los filtros seleccionados.</p></div>';
        return;
      }
      res.innerHTML = renderPizarronTable(rows);
    } catch (e) {
      res.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  document.getElementById('pz-buscar').addEventListener('click', cargarPizarron);

  if (state.user?.prod_role === 'admin') {
    document.getElementById('pz-export')?.addEventListener('click', async () => {
      try {
        const linea = document.getElementById('pz-linea').value || 'ambas';
        const data  = await GET(`/export/${linea}`);
        const rows  = data?.rows || data || [];
        const ws    = XLSX.utils.json_to_sheet(rows);
        const wb    = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Pizarron');
        XLSX.writeFile(wb, `pizarron_${linea}_${new Date().toISOString().slice(0,10)}.xlsx`);
      } catch (e) { alert('Error al exportar: ' + e.message); }
    });
  }

  // Auto-refresh cada 30 segundos
  clearInterval(state._pizarronTimer);
  state._pizarronTimer = setInterval(cargarPizarron, 30000);

  // Carga inicial
  cargarPizarron();
}

function renderPizarronTable(rows) {
  // Agrupar por turno
  const byTurno = {};
  const ORDER   = ['T1', 'T2', 'T3', ''];
  for (const r of rows) {
    const t = r.turno || '';
    if (!byTurno[t]) byTurno[t] = [];
    byTurno[t].push(r);
  }

  let bodyHtml = '';
  const dayTotals = { eficiencia: [], calidad: [], disponibilidad: [], capacidad: [] };

  for (const turno of ORDER) {
    const grupo = byTurno[turno];
    if (!grupo || grupo.length === 0) continue;

    const tLabel = turno ? `Turno ${turno}` : 'Sin turno';
    bodyHtml += `<tr class="turno-row"><td colspan="6">${tLabel}</td></tr>`;

    const tTotals = { eficiencia: [], calidad: [], disponibilidad: [], capacidad: [] };

    for (const r of grupo) {
      bodyHtml += `<tr>
        <td>${escHtml(r.hora || r.hr || '—')}</td>
        <td>${escHtml(r.linea || '—')}</td>
        <td class="${kpiColor(r.eficiencia)}">${fmtPct(r.eficiencia)}</td>
        <td class="${kpiColor(r.capacidad)}">${fmtPct(r.capacidad)}</td>
        <td class="${kpiColor(r.calidad)}">${fmtPct(r.calidad)}</td>
        <td class="${kpiColor(r.disponibilidad)}">${fmtPct(r.disponibilidad)}</td>
      </tr>`;
      if (r.eficiencia    != null) { tTotals.eficiencia.push(parseFloat(r.eficiencia));    dayTotals.eficiencia.push(parseFloat(r.eficiencia)); }
      if (r.calidad       != null) { tTotals.calidad.push(parseFloat(r.calidad));          dayTotals.calidad.push(parseFloat(r.calidad)); }
      if (r.disponibilidad!= null) { tTotals.disponibilidad.push(parseFloat(r.disponibilidad)); dayTotals.disponibilidad.push(parseFloat(r.disponibilidad)); }
      if (r.capacidad     != null) { tTotals.capacidad.push(parseFloat(r.capacidad));      dayTotals.capacidad.push(parseFloat(r.capacidad)); }
    }

    const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
    const ef  = avg(tTotals.eficiencia);
    const ca  = avg(tTotals.capacidad);
    const cal = avg(tTotals.calidad);
    const dis = avg(tTotals.disponibilidad);
    bodyHtml += `<tr class="totals-row">
      <td colspan="2">Total ${tLabel}</td>
      <td class="${kpiColor(ef)}">${ef != null ? ef.toFixed(1)+'%' : '—'}</td>
      <td class="${kpiColor(ca)}">${ca != null ? ca.toFixed(1)+'%' : '—'}</td>
      <td class="${kpiColor(cal)}">${cal != null ? cal.toFixed(1)+'%' : '—'}</td>
      <td class="${kpiColor(dis)}">${dis != null ? dis.toFixed(1)+'%' : '—'}</td>
    </tr>`;
  }

  // Total día
  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
  const def = avg(dayTotals.eficiencia);
  const dcap= avg(dayTotals.capacidad);
  const dcal= avg(dayTotals.calidad);
  const ddis= avg(dayTotals.disponibilidad);
  bodyHtml += `<tr class="day-total-row">
    <td colspan="2">TOTAL DÍA</td>
    <td>${def  != null ? def.toFixed(1)+'%' : '—'}</td>
    <td>${dcap != null ? dcap.toFixed(1)+'%' : '—'}</td>
    <td>${dcal != null ? dcal.toFixed(1)+'%' : '—'}</td>
    <td>${ddis != null ? ddis.toFixed(1)+'%' : '—'}</td>
  </tr>`;

  return `
  <div class="pizarron-wrap">
    <div class="pizarron-header">
      <h3>Pizarrón KPI</h3>
      <small style="color:var(--p-muted);font-size:11px">Auto-actualiza cada 30 seg</small>
    </div>
    <div class="pizarron-scroll">
      <table class="pizarron-table">
        <thead>
          <tr>
            <th>Hr</th><th>Línea</th><th>Eficiencia</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th>
          </tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: REPORTES
// ══════════════════════════════════════════════════════════════════════════════

async function viewReportes(el) {
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="filters-bar">
      <div>
        <span class="flabel">Línea</span>
        <select id="rpt-linea">
          <option value="">Ambas</option>
          <option value="L3">Línea 3</option>
          <option value="L4">Línea 4</option>
        </select>
      </div>
      <div>
        <span class="flabel">Desde</span>
        <input type="date" id="rpt-desde" value="${today}" />
      </div>
      <div>
        <span class="flabel">Hasta</span>
        <input type="date" id="rpt-hasta" value="${today}" />
      </div>
      <button class="btn btn-outline btn-sm" id="rpt-buscar">🔍 Consultar</button>
      <button class="btn btn-dark btn-sm" id="rpt-export">📥 Excel</button>
    </div>
    <div id="rpt-resultado">
      <div class="empty-state"><div class="icon">📈</div><p>Selecciona el rango de fechas y consulta.</p></div>
    </div>`;

  document.getElementById('rpt-buscar').addEventListener('click', async () => {
    const linea = document.getElementById('rpt-linea').value;
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const res   = document.getElementById('rpt-resultado');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
    try {
      const params = new URLSearchParams();
      if (linea) params.set('linea', linea);
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      const data = await GET(`/reportes?${params}`);
      const cargas = data?.cargas || data || [];
      if (cargas.length === 0) {
        res.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Sin registros.</p></div>';
        return;
      }
      res.innerHTML = `
        <div class="table-card">
          <div class="table-header">
            <h3>Cargas del período</h3>
            <span class="badge badge-activo">${cargas.length} registros</span>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Folio</th><th>Línea</th><th>Fecha</th><th>Herramental</th>
                  <th>Componente</th><th>Proceso</th><th>Cantidad</th>
                  <th>Operador</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                ${cargas.map(c => `<tr>
                  <td class="mono">${escHtml(c.folio || c.id)}</td>
                  <td>${escHtml(c.linea || '—')}</td>
                  <td>${fmtDate(c.fecha_carga || c.created_at)}</td>
                  <td>${escHtml(c.herramental_no || c.herramental || '—')}</td>
                  <td>${escHtml(c.componente || '—')}</td>
                  <td>${escHtml(c.proceso || '—')}</td>
                  <td style="text-align:right;font-weight:700">${c.cantidad ?? '—'}</td>
                  <td>${escHtml(c.operador || '—')}</td>
                  <td><span class="badge ${c.estado === 'procesado' ? 'badge-procesado' : c.estado === 'defecto' ? 'badge-defecto' : 'badge-activo'}">${escHtml(c.estado || 'activo')}</span></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (e) {
      res.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  });

  document.getElementById('rpt-export').addEventListener('click', async () => {
    const linea = document.getElementById('rpt-linea').value || 'ambas';
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    try {
      const params = new URLSearchParams();
      if (linea !== 'ambas') params.set('linea', linea);
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      const data  = await GET(`/reportes?${params}`);
      const cargas = data?.cargas || data || [];
      const ws = XLSX.utils.json_to_sheet(cargas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Cargas');
      XLSX.writeFile(wb, `reporte_produccion_${desde}_${hasta}.xlsx`);
    } catch (e) { alert('Error al exportar: ' + e.message); }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: CATÁLOGOS
// ══════════════════════════════════════════════════════════════════════════════

const CATALOG_TABS = [
  { key: 'componentes',  label: 'Componentes' },
  { key: 'procesos',     label: 'Procesos' },
  { key: 'acabados',     label: 'Acabados' },
  { key: 'herramentales',label: 'Herramentales' },
  { key: 'defectos',     label: 'Defectos' },
  { key: 'motivos_paro', label: 'Motivos Paro' },
  { key: 'sub_motivos',  label: 'Sub-motivos' }
];

async function viewCatalogos(el, linea) {
  let activeTab = 'componentes';
  let catalogo  = {};

  async function loadAndRender() {
    try {
      const data = await GET(`/catalogos/${linea}`);
      catalogo   = data || {};
    } catch { catalogo = {}; }
    renderCatalogoSection();
  }

  function renderCatalogoSection() {
    const tabsHtml = CATALOG_TABS.map(t =>
      `<button class="tab-btn${activeTab === t.key ? ' tab-active' : ''}" data-tab="${t.key}">${t.label}</button>`
    ).join('');

    const items    = Array.isArray(catalogo[activeTab]) ? catalogo[activeTab] : [];
    const tabEl    = CATALOG_TABS.find(t => t.key === activeTab);
    const bodyHtml = renderCatalogoTable(activeTab, items, linea);

    el.innerHTML = `
      <div class="table-card">
        <div class="table-header">
          <div class="tab-bar" id="cat-tabs">${tabsHtml}</div>
          <button class="btn btn-primary btn-sm" id="cat-nuevo">+ Nuevo</button>
        </div>
        <div style="padding:18px">
          ${bodyHtml}
        </div>
      </div>`;

    document.querySelectorAll('#cat-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; renderCatalogoSection(); });
    });

    document.getElementById('cat-nuevo').addEventListener('click', () => {
      openCatalogoModal(activeTab, linea, null, () => loadAndRender());
    });

    el.querySelectorAll('[data-edit-cat]').forEach(btn => {
      const id   = btn.dataset.editCat;
      const item = items.find(i => String(i.id) === String(id));
      btn.addEventListener('click', () => openCatalogoModal(activeTab, linea, item, () => loadAndRender()));
    });

    el.querySelectorAll('[data-del-cat]').forEach(btn => {
      const id = btn.dataset.delCat;
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este registro?')) return;
        try {
          await DEL(`/catalogos/${linea}/${activeTab}/${id}`);
          loadAndRender();
        } catch (e) { alert('Error: ' + e.message); }
      });
    });
  }

  await loadAndRender();
}

function renderCatalogoTable(tipo, items, linea) {
  if (items.length === 0) {
    return '<div class="empty-state"><div class="icon">📦</div><p>Sin registros. Crea el primero.</p></div>';
  }

  const colsMap = {
    componentes:   ['nombre', 'cliente', 'carga_optima_varillas', 'piezas_objetivo'],
    procesos:      ['nombre', 'descripcion'],
    acabados:      ['nombre', 'descripcion'],
    herramentales: ['no', 'nombre', 'descripcion'],
    defectos:      ['nombre', 'descripcion'],
    motivos_paro:  ['nombre', 'descripcion'],
    sub_motivos:   ['nombre', 'motivo_id', 'descripcion']
  };

  const cols = colsMap[tipo] || ['nombre'];

  return `
  <table>
    <thead>
      <tr>
        <th>#</th>
        ${cols.map(c => `<th>${c.replace(/_/g,' ')}</th>`).join('')}
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td class="mono">${item.id}</td>
          ${cols.map(c => `<td>${escHtml(item[c] ?? '')}</td>`).join('')}
          <td style="white-space:nowrap">
            <button class="btn btn-outline btn-xs" data-edit-cat="${item.id}">✏️ Editar</button>
            <button class="btn btn-danger btn-xs" data-del-cat="${item.id}" style="margin-left:4px">🗑</button>
          </td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}

function openCatalogoModal(tipo, linea, item, onDone) {
  const isNew    = item == null;
  const title    = isNew ? `Nuevo registro — ${tipo.replace(/_/g,' ')}` : `Editar — ${tipo.replace(/_/g,' ')}`;

  const fields = buildCatalogoFields(tipo, item);

  showModal(`
    <h3>${title}</h3>
    <div class="form-grid">
      ${fields}
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="cat-save">💾 Guardar</button>
    </div>`);

  document.getElementById('cat-save').addEventListener('click', async () => {
    const payload = collectCatalogoFields(tipo);
    const btn     = document.getElementById('cat-save');
    btn.disabled  = true; btn.textContent = 'Guardando...';
    try {
      if (isNew) {
        await POST(`/catalogos/${linea}/${tipo}`, payload);
      } else {
        await PUT(`/catalogos/${linea}/${tipo}/${item.id}`, payload);
      }
      closeModal();
      onDone();
    } catch (e) {
      btn.disabled  = false; btn.textContent = '💾 Guardar';
      alert('Error: ' + e.message);
    }
  });
}

function buildCatalogoFields(tipo, item) {
  const v   = (key) => escHtml(item?.[key] ?? '');
  const inp = (key, label, type = 'text', extra = '') =>
    `<div class="form-group">
      <label>${label}</label>
      <input type="${type}" id="cf-${key}" value="${v(key)}" ${extra} />
    </div>`;

  switch (tipo) {
    case 'componentes':
      return inp('nombre', 'Nombre del componente') +
             inp('cliente', 'Cliente') +
             inp('carga_optima_varillas', 'Carga óptima varillas', 'number') +
             inp('piezas_objetivo', 'Piezas objetivo/varilla', 'number');
    case 'herramentales':
      return inp('no', 'No. Herramental') +
             inp('nombre', 'Nombre') +
             inp('descripcion', 'Descripción');
    case 'procesos':
    case 'acabados':
    case 'defectos':
    case 'motivos_paro':
      return inp('nombre', 'Nombre') +
             inp('descripcion', 'Descripción');
    case 'sub_motivos':
      return inp('nombre', 'Nombre') +
             `<div class="form-group">
               <label>Motivo ID (padre)</label>
               <input type="number" id="cf-motivo_id" value="${v('motivo_id')}" />
             </div>` +
             inp('descripcion', 'Descripción');
    default:
      return inp('nombre', 'Nombre');
  }
}

function collectCatalogoFields(tipo) {
  const g = (id) => document.getElementById(`cf-${id}`)?.value?.trim() || '';
  switch (tipo) {
    case 'componentes':
      return { nombre: g('nombre'), cliente: g('cliente'), carga_optima_varillas: g('carga_optima_varillas') || null, piezas_objetivo: g('piezas_objetivo') || null };
    case 'herramentales':
      return { no: g('no'), nombre: g('nombre'), descripcion: g('descripcion') };
    case 'sub_motivos':
      return { nombre: g('nombre'), motivo_id: g('motivo_id') || null, descripcion: g('descripcion') };
    default:
      return { nombre: g('nombre'), descripcion: g('descripcion') };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: OPERADORES
// ══════════════════════════════════════════════════════════════════════════════

async function viewOperadores(el) {
  async function loadAndRender() {
    let operadoresL3 = [], operadoresL4 = [];
    try {
      const [dL3, dL4] = await Promise.all([
        GET('/operadores/L3'),
        GET('/operadores/L4')
      ]);
      operadoresL3 = Array.isArray(dL3) ? dL3 : (dL3?.operadores || []);
      operadoresL4 = Array.isArray(dL4) ? dL4 : (dL4?.operadores || []);
    } catch (e) {
      el.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
      return;
    }

    const tableHtml = (ops, linea) => ops.length === 0
      ? '<div class="empty-state"><div class="icon">👤</div><p>Sin operadores registrados.</p></div>'
      : `<table>
          <thead><tr><th>#</th><th>Nombre</th><th>Activo</th><th></th></tr></thead>
          <tbody>
            ${ops.map(op => `<tr>
              <td class="mono">${op.id}</td>
              <td>${escHtml(op.nombre)}</td>
              <td>
                <div class="toggle-wrap" data-toggle-op="${op.id}" data-linea="${linea}" data-activo="${op.activo ? '1' : '0'}">
                  <div class="toggle-switch${op.activo ? ' on' : ''}"></div>
                  <span style="font-size:12px;color:var(--p-muted)">${op.activo ? 'Activo' : 'Inactivo'}</span>
                </div>
              </td>
              <td>
                <button class="btn btn-outline btn-xs" data-edit-op="${op.id}" data-linea="${linea}">✏️ Editar</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="table-card">
          <div class="table-header">
            <h3>Línea 3</h3>
            <button class="btn btn-primary btn-sm" data-nuevo-op="L3">+ Nuevo</button>
          </div>
          <div class="table-scroll">${tableHtml(operadoresL3, 'L3')}</div>
        </div>
        <div class="table-card">
          <div class="table-header">
            <h3>Línea 4</h3>
            <button class="btn btn-primary btn-sm" data-nuevo-op="L4">+ Nuevo</button>
          </div>
          <div class="table-scroll">${tableHtml(operadoresL4, 'L4')}</div>
        </div>
      </div>`;

    // Toggles
    el.querySelectorAll('[data-toggle-op]').forEach(wrap => {
      wrap.addEventListener('click', async () => {
        const id     = wrap.dataset.toggleOp;
        const linea  = wrap.dataset.linea;
        const activo = wrap.dataset.activo === '1';
        try {
          await PATCH(`/operadores/${linea}/${id}`, { activo: !activo });
          loadAndRender();
        } catch (e) { alert('Error: ' + e.message); }
      });
    });

    // Editar
    el.querySelectorAll('[data-edit-op]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id     = btn.dataset.editOp;
        const linea  = btn.dataset.linea;
        const lista  = linea === 'L3' ? operadoresL3 : operadoresL4;
        const op     = lista.find(o => String(o.id) === String(id));
        openOperadorModal(linea, op, loadAndRender);
      });
    });

    // Nuevo
    el.querySelectorAll('[data-nuevo-op]').forEach(btn => {
      btn.addEventListener('click', () => {
        openOperadorModal(btn.dataset.nuevoOp, null, loadAndRender);
      });
    });
  }

  await loadAndRender();
}

function openOperadorModal(linea, op, onDone) {
  const isNew = op == null;
  showModal(`
    <h3>${isNew ? 'Nuevo Operador' : 'Editar Operador'} — Línea ${linea.replace('L','')}</h3>
    <div class="form-grid">
      <div class="form-group full">
        <label>Nombre completo</label>
        <input type="text" id="op-nombre" value="${escHtml(op?.nombre || '')}" placeholder="Nombre del operador" />
      </div>
      <div class="form-group full">
        <label>PIN (4 dígitos)</label>
        <input type="password" id="op-pin" maxlength="4" placeholder="${isNew ? '1234' : 'Dejar vacío para no cambiar'}" />
        <span class="form-hint">Mínimo 4 dígitos numéricos</span>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="op-save">💾 Guardar</button>
    </div>`, { size: 'sm' });

  document.getElementById('op-save').addEventListener('click', async () => {
    const nombre = document.getElementById('op-nombre').value.trim();
    const pin    = document.getElementById('op-pin').value.trim();
    if (!nombre) { alert('Ingresa el nombre del operador'); return; }
    if (isNew && !pin) { alert('Ingresa un PIN para el nuevo operador'); return; }
    const payload = { nombre };
    if (pin) payload.pin = pin;
    const btn = document.getElementById('op-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      if (isNew) {
        await POST(`/operadores/${linea}`, payload);
      } else {
        await PATCH(`/operadores/${linea}/${op.id}`, payload);
      }
      closeModal();
      onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = '💾 Guardar';
      alert('Error: ' + e.message);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════════════════════

async function viewConfiguracion(el) {
  let config = { ciclos_obj_l3: 0, ciclos_obj_l4: 0 };
  try {
    const data = await GET('/config');
    config = { ...config, ...(data?.config || data || {}) };
  } catch {}

  el.innerHTML = `
    <div class="form-card config-section">
      <h3>Configuración General</h3>
      <h4>Ciclos objetivo por hora</h4>
      <div class="config-item">
        <label>Línea 3</label>
        <input type="number" id="cfg-l3" value="${config.ciclos_obj_l3 || 0}" min="0" />
      </div>
      <div class="config-item">
        <label>Línea 4</label>
        <input type="number" id="cfg-l4" value="${config.ciclos_obj_l4 || 0}" min="0" />
      </div>
      <div style="margin-top:20px">
        <button class="btn btn-primary" id="cfg-save">💾 Guardar cambios</button>
        <span id="cfg-msg" style="margin-left:12px;font-size:13px;color:var(--p-success)"></span>
      </div>
    </div>`;

  document.getElementById('cfg-save').addEventListener('click', async () => {
    const l3  = parseInt(document.getElementById('cfg-l3').value) || 0;
    const l4  = parseInt(document.getElementById('cfg-l4').value) || 0;
    const btn = document.getElementById('cfg-save');
    const msg = document.getElementById('cfg-msg');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await PATCH('/config', { ciclos_obj_l3: l3, ciclos_obj_l4: l4 });
      msg.textContent = '✅ Guardado correctamente';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch (e) {
      msg.style.color = 'var(--p-danger)';
      msg.textContent = '⚠️ Error: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = '💾 Guardar cambios';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════

(function init() {
  if (tryRestore()) {
    // Si el usuario es operador ajustar la sección por defecto
    if (state.user?.prod_role === 'operador') {
      state.section = 'linea-op';
    }
    render();
  } else {
    render();
  }
})();
