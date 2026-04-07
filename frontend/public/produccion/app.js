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
  // Línea activa actualmente en vista
  lineaActiva: null,
  // Polling pizarrón
  _pizarronTimer: null,
  // Polling monitor admin
  _monitorTimer: null,
  // Polling línea (ciclos)
  _lineaTimer: null,
  // Inactividad
  _actTimer: null,
  // Watcher de fin de turno
  _shiftTimer: null,
  _shiftWarnShown: false,
  // Guard para no mostrar el form de paro automático dos veces seguidas
  _autoParoShown: { L3: false, L4: false }
};

// ── Menú por rol ──────────────────────────────────────────────────────────────
const MENU = {
  admin: [
    ['dashboard',      '📊', 'Dashboard'],
    ['linea-3',        '🏭', 'Línea 3'],
    ['linea-4',        '🏭', 'Línea 4'],
    ['linea-baker',    '🔧', 'Baker'],
    ['reportes',       '📈', 'Reportes'],
    ['paros',          '⏸', 'Paros'],
    ['pizarron',       '📋', 'Pizarrón KPI'],
    ['kpi-historico',  '📊', 'KPI Histórico'],
    ['monitor',        '📡', 'Monitor en vivo'],
    ['---', '', 'Catálogos'],
    ['catalogos-l3',   '📦', 'Catálogos L3'],
    ['catalogos-l4',   '📦', 'Catálogos L4'],
    ['catalogos-baker','📦', 'Catálogos Baker'],
    ['operadores',     '👤', 'Operadores'],
    ['configuracion',  '⚙️', 'Configuración']
  ],
  produccion: [
    ['dashboard',    '📊', 'Dashboard'],
    ['linea-3',      '🏭', 'Línea 3'],
    ['linea-4',      '🏭', 'Línea 4'],
    ['linea-baker',  '🔧', 'Baker'],
    ['pizarron',     '📋', 'Pizarrón KPI']
  ],
  pizarron: [
    ['pizarron',   '📋', 'Pizarrón KPI']
  ]
};

const SECTION_TITLES = {
  'dashboard':       'Dashboard de Producción',
  'linea-3':         'Línea 3 — Tarjetero Activo',
  'linea-4':         'Línea 4 — Tarjetero Activo',
  'linea-op':        'Mi Línea — Tarjetero Activo',
  'linea-baker':     'Baker — Tarjetero Activo',
  'reportes':        'Reportes de Producción',
  'paros':           'Registro de Paros',
  'pizarron':        'Pizarrón KPI',
  'kpi-historico':   'KPI Histórico',
  'monitor':         'Monitor en vivo — L3, L4 y Baker',
  'catalogos-l3':    'Catálogos Línea 3',
  'catalogos-l4':    'Catálogos Línea 4',
  'catalogos-baker': 'Catálogos Baker',
  'operadores':      'Gestión de Operadores',
  'configuracion':   'Configuración'
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

// ── Watcher de fin de turno ───────────────────────────────────────────────────
// Turnos: T1 06:30-14:29, T2 14:30-21:29, T3 21:30-06:29
// Fin de turno (inicio del siguiente): 14:30 (870 min), 21:30 (1290 min), 06:30 (390 min)
const SHIFT_ENDS_MINS = [390, 870, 1290]; // 06:30, 14:30, 21:30
const SHIFT_WARN_BEFORE = 10; // minutos de anticipación para la alerta

function minsToNextShiftEnd() {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  // Buscar el próximo fin de turno dentro de los próximos 60 minutos
  for (const end of SHIFT_ENDS_MINS) {
    const diff = end - cur;
    if (diff >= -1 && diff <= 60) return diff;
  }
  return null;
}

function showShiftWarningBanner(minsLeft) {
  let banner = document.getElementById('shift-warn-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'shift-warn-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#fff;font-weight:600;text-align:center;padding:10px 16px;font-size:15px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.2)';
    document.body.prepend(banner);
  }
  const mins = Math.max(0, minsLeft);
  banner.innerHTML = `⏰ El turno termina en <strong>${mins} minuto${mins !== 1 ? 's' : ''}</strong>. La sesión se cerrará automáticamente al cambio de turno.`;
}

function hideShiftWarningBanner() {
  const b = document.getElementById('shift-warn-banner');
  if (b) b.remove();
}

function initShiftWatcher() {
  clearInterval(state._shiftTimer);
  state._shiftWarnShown = false;
  state._shiftTimer = setInterval(async () => {
    if (!state.token) { clearInterval(state._shiftTimer); return; }
    const mins = minsToNextShiftEnd();
    if (mins === null) {
      // No cerca de un cambio de turno — ocultar banner si estaba visible
      if (state._shiftWarnShown) { hideShiftWarningBanner(); state._shiftWarnShown = false; }
      return;
    }
    if (mins <= 0) {
      // ¡Fin de turno! Cerrar sesión y registrar paro
      hideShiftWarningBanner();
      clearInterval(state._shiftTimer);
      state._shiftTimer = null;
      state._shiftWarnShown = false;
      await logoutShiftEnd();
      return;
    }
    if (mins <= SHIFT_WARN_BEFORE) {
      showShiftWarningBanner(mins);
      state._shiftWarnShown = true;
    }
  }, 30_000); // checar cada 30 segundos
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function tryRestore() {
  const t = localStorage.getItem('prod_token');
  const u = localStorage.getItem('prod_user');
  if (t && u) {
    try {
      const user = JSON.parse(u);
      const validRoles = ['admin', 'produccion', 'pizarron'];
      if (!validRoles.includes(user.role)) {
        localStorage.removeItem('prod_token');
        localStorage.removeItem('prod_user');
        return false;
      }
      state.token = t; state.user = user;
      initShiftWatcher();
      return true;
    } catch { return false; }
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
  clearInterval(state._monitorTimer);
  clearInterval(state._lineaTimer);
  clearInterval(state._shiftTimer);
  state._shiftTimer = null;
  state._shiftWarnShown = false;
  state.token = null; state.user = null; state.lineaActiva = null;
  localStorage.removeItem('prod_token');
  localStorage.removeItem('prod_user');
  render();
}

async function logoutShiftEnd() {
  // Si hay línea activa y usuario con rol produccion/admin, registrar paro cambio de turno
  if (state.lineaActiva && state.token && ['produccion', 'admin'].includes(state.user?.role)) {
    try {
      await fetch(`/api/produccion/paros/${state.lineaActiva}/cambio-turno`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` }
      });
    } catch (_) { /* silencioso — cerrar sesión de todas formas */ }
  }
  logout();
}

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(section) {
  clearInterval(state._pizarronTimer);
  state._pizarronTimer = null;
  clearInterval(state._monitorTimer);
  state._monitorTimer = null;
  clearInterval(state._lineaTimer);
  state._lineaTimer = null;
  // Limpiar línea activa si se navega fuera de una línea
  if (!section.startsWith('linea-')) state.lineaActiva = null;
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

function getCurrentTurno() {
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= 6 * 60 + 30 && mins <= 14 * 60 + 29) return 'T1';
  if (mins >= 14 * 60 + 30 && mins <= 21 * 60 + 29) return 'T2';
  return 'T3';
}

// Retorna { turno, fecha } del turno inmediatamente anterior al actual
function getPrevTurnoInfo() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = now.toISOString().slice(0, 10);
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  const yesterday = yest.toISOString().slice(0, 10);
  if (mins >= 6 * 60 + 30 && mins < 14 * 60 + 30) return { turno: 'T3', fecha: yesterday };
  if (mins >= 14 * 60 + 30 && mins < 21 * 60 + 30) return { turno: 'T1', fecha: today };
  // T3 (21:30-06:29)
  if (mins >= 21 * 60 + 30) return { turno: 'T2', fecha: today };
  return { turno: 'T2', fecha: yesterday }; // 00:00-06:29
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
  // Ajustar sección inicial según rol
  const role = state.user.role;
  if (role === 'pizarron') state.section = 'pizarron';
  else if (role === 'produccion' && state.section === 'pizarron') state.section = 'dashboard';
  app.innerHTML = renderLayout();
  bindNav();
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
      <label>Usuario</label>
      <select id="l-email-sel" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;background:#fff;color:#1e293b;margin-bottom:2px">
        <option value="">— Cargando usuarios... —</option>
      </select>
      <label>Contraseña</label>
      <input type="password" id="l-pass" placeholder="••••••••" autocomplete="current-password" />
      <button class="btn-login" id="btn-login">Ingresar</button>
      <p class="login-error" id="login-err"></p>
    </div>
  </div>`;
}

function bindLogin() {
  const btn = document.getElementById('btn-login');
  const sel = document.getElementById('l-email-sel');

  // Cargar lista de usuarios
  fetch('/api/produccion/auth/usuarios')
    .then(r => r.json())
    .then(usuarios => {
      if (!Array.isArray(usuarios) || usuarios.length === 0) {
        sel.innerHTML = '<option value="">— Sin usuarios registrados —</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Seleccionar usuario —</option>' +
        usuarios.map(u => `<option value="${escHtml(u.email)}">${escHtml(u.nombre)} · ${escHtml(u.email)}</option>`).join('');
    })
    .catch(() => {
      sel.innerHTML = '<option value="">— Error al cargar usuarios —</option>';
    });

  const doLogin = async () => {
    const email = sel.value.trim();
    const pass  = document.getElementById('l-pass').value;
    const err   = document.getElementById('login-err');
    if (!email) { err.textContent = 'Selecciona un usuario'; return; }
    if (!pass)  { err.textContent = 'Ingresa la contraseña'; return; }
    btn.disabled = true; btn.textContent = 'Verificando...';
    try {
      const res = await fetch('/api/produccion/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password: pass })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = data.error || 'Error al iniciar sesión';
        btn.disabled = false; btn.textContent = 'Ingresar';
        return;
      }
      saveSession(data.token, data.user);
      initShiftWatcher();
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
const ROLE_LABELS_PROD = { admin: 'Admin', produccion: 'Producción', pizarron: 'Pizarrón' };

function renderLayout() {
  const role = state.user.role || 'pizarron';
  const rawMenu = MENU[role] || MENU.pizarron;
  const menuHtml = rawMenu.map(([id, icon, label]) => {
    if (id === '---') return `<div class="p-nav-group">${label}</div>`;
    const active = state.section === id;
    return `<div class="p-nav-item${active ? ' active' : ''}" data-nav="${id}">${icon} ${label}</div>`;
  }).join('');

  const roleBadge = role === 'admin' ? 'badge-admin' : 'badge-operador';
  const linea = '';

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
          <span class="badge-role ${roleBadge}">${ROLE_LABELS_PROD[role] || role}</span>
        </div>
        <button class="btn-logout" id="btn-change-pwd" style="margin-bottom:6px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;">🔑 Cambiar contraseña</button>
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
  document.getElementById('btn-change-pwd')?.addEventListener('click', openChangePwdModal);
}

function openChangePwdModal() {
  showModal(`
    <h3>🔑 Cambiar contraseña</h3>
    <div class="form-grid">
      <div class="form-group full">
        <label>Contraseña actual</label>
        <input type="password" id="cp-actual" placeholder="••••••••" autocomplete="current-password" />
      </div>
      <div class="form-group full">
        <label>Nueva contraseña</label>
        <input type="password" id="cp-nueva" placeholder="Mínimo 4 caracteres" autocomplete="new-password" />
      </div>
      <div class="form-group full">
        <label>Confirmar nueva contraseña</label>
        <input type="password" id="cp-confirma" placeholder="Repite la nueva contraseña" autocomplete="new-password" />
      </div>
      <p id="cp-error" style="color:#dc2626;font-size:13px;margin:0;display:none"></p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="cp-save">Guardar contraseña</button>
    </div>`, { size: 'sm' });

  document.getElementById('cp-save').addEventListener('click', async () => {
    const actual   = document.getElementById('cp-actual').value;
    const nueva    = document.getElementById('cp-nueva').value;
    const confirma = document.getElementById('cp-confirma').value;
    const errEl    = document.getElementById('cp-error');
    const showErr  = msg => { errEl.textContent = msg; errEl.style.display = ''; };

    if (!actual || !nueva || !confirma) return showErr('Completa todos los campos');
    if (nueva.length < 4) return showErr('La nueva contraseña debe tener al menos 4 caracteres');
    if (nueva !== confirma) return showErr('Las contraseñas nuevas no coinciden');

    const btn = document.getElementById('cp-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await PATCH('/auth/change-password', { current_password: actual, new_password: nueva });
      closeModal();
      alert('Contraseña actualizada correctamente');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Guardar contraseña';
      showErr(e.message);
    }
  });
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
      case 'linea-4':        await viewLinea(el, 'L4');      break;
      case 'linea-op':       await viewLinea(el, lineaFromSection('linea-op')); break;
      case 'linea-baker':    await viewBaker(el);             break;
      case 'reportes':       await viewReportes(el);          break;
      case 'paros':          await viewParos(el);             break;
      case 'pizarron':       await viewPizarron(el);          break;
      case 'kpi-historico':  await viewKpiHistorico(el);      break;
      case 'monitor':        await viewMonitor(el);           break;
      case 'catalogos-l3':   await viewCatalogos(el, 'L3');   break;
      case 'catalogos-l4':   await viewCatalogos(el, 'L4');   break;
      case 'catalogos-baker':await viewCatalogos(el, 'baker');break;
      case 'operadores':     await viewOperadores(el);        break;
      case 'configuracion':  await viewConfiguracion(el);     break;
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
  state.lineaActiva = linea; // Trackear línea activa para el watcher de turno

  // Auto-refresh cada 20 segundos para mantener ciclos actualizados
  clearInterval(state._lineaTimer);
  state._lineaTimer = setInterval(() => {
    const elActual = document.getElementById('p-content');
    if (elActual) viewLinea(elActual, linea);
  }, 20000);

  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando tarjetas...</p></div>';
  try {
    const today = new Date().toISOString().slice(0, 10);
    const turnoActual = getCurrentTurno();

    const [cargasData, catalogData, parosData, todasHoyData] = await Promise.all([
      GET(`/cargas/${linea}/activas`),
      GET(`/catalogos/${linea}`),
      GET(`/paros/${linea}/activo`).catch(() => null),
      GET(`/cargas/${linea}?fecha_ini=${today}&fecha_fin=${today}`).catch(() => [])
    ]);

    // Contar ciclos del turno vigente
    const todasHoy = Array.isArray(todasHoyData) ? todasHoyData : [];
    const ciclosTurno = todasHoy.filter(c => c.turno === turnoActual).length;
    const cargas    = Array.isArray(cargasData) ? cargasData : (cargasData?.cargas || []);
    const catalogo  = catalogData || {};
    let paroActivo  = parosData?.paro || null;

    // Auto-cerrar paro de cambio de turno al entrar a la línea (nuevo usuario)
    if (paroActivo && paroActivo.tipo === 'cambio_turno') {
      try {
        await PATCH(`/paros/${linea}/${paroActivo.id}/cerrar`, {});
        paroActivo = null;
      } catch (_) { /* si falla, mostrar el paro normalmente */ }
    }

    state.paroActivo[linea] = paroActivo;

    // ── Check A: turno anterior sin actividad → paro automático cerrado ───────
    try {
      const prev = getPrevTurnoInfo();
      await POST(`/paros/${linea}/auto-sin-actividad`, { fecha: prev.fecha, turno: prev.turno });
    } catch (_) { /* silencioso — no bloquear la vista */ }

    // ── Check B: 15 min sin actividad en turno actual → abrir form de paro ───
    if (!paroActivo) {
      const cargasTurno = todasHoy.filter(c => c.turno === turnoActual);
      if (cargasTurno.length > 0) {
        const lastTs = cargasTurno.reduce((max, c) => {
          const ts = c.updated_at || c.created_at || '';
          return ts > max ? ts : max;
        }, '');
        if (lastTs) {
          const minsInactive = (Date.now() - new Date(lastTs).getTime()) / 60000;
          if (minsInactive > 15 && !state._autoParoShown[linea]) {
            state._autoParoShown[linea] = true;
            const lastDate = new Date(lastTs);
            const horaIni = lastDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
            const fechaIni = lastDate.toLocaleDateString('en-CA');
            setTimeout(() => openModalParoAuto(linea, catalogo, horaIni, fechaIni, () => {
              state._autoParoShown[linea] = false;
              const elActual = document.getElementById('p-content');
              if (elActual) viewLinea(elActual, linea);
            }), 500);
          }
        }
      }
    }

    // Mini-tarjeta de paro activo (inline en el header, junto al contador)
    const paroMiniCard = paroActivo
      ? paroActivo.tipo === 'cambio_turno'
        ? `<div style="display:flex;align-items:center;gap:8px;background:#ede9fe;border:1.5px solid #7c3aed;border-radius:8px;padding:6px 12px">
             <span style="color:#7c3aed;font-weight:700">🔄 CAMBIO DE TURNO</span>
             <span style="font-size:12px;color:#6b7280">desde ${escHtml(paroActivo.hora_inicio)}</span>
             <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none" id="btn-cerrar-paro" data-id="${paroActivo.id}">✅ Iniciar turno</button>
           </div>`
        : `<div style="display:flex;align-items:center;gap:8px;background:#fef2f2;border:1.5px solid #dc2626;border-radius:8px;padding:6px 12px;flex-wrap:wrap">
             <span style="color:#dc2626;font-weight:700;font-size:13px">🔴 PARO ACTIVO</span>
             <span style="font-size:13px;font-weight:600">${escHtml(paroActivo.motivo)}${paroActivo.sub_motivo ? ' › ' + escHtml(paroActivo.sub_motivo) : ''}</span>
             <span style="font-size:11px;color:#6b7280">desde ${escHtml(paroActivo.fecha_inicio)} ${escHtml(paroActivo.hora_inicio)}</span>
             <button class="btn btn-sm btn-primary" id="btn-cerrar-paro" data-id="${paroActivo.id}" style="white-space:nowrap">✅ Cerrar Paro</button>
           </div>`
      : '';

    const tarjetasHtml = cargas.length === 0
      ? '<div class="empty-state"><div class="icon">📭</div><p>No hay cargas activas en esta línea.</p></div>'
      : `<div class="tarjetero-grid">${cargas.map(c => renderTarjeta(c)).join('')}</div>`;

    el.innerHTML = `
      <div class="tarjetero-header">
        <h3>Línea ${linea.replace('L','')} — Tarjetero Activo <span class="badge badge-activo">${cargas.length} activas</span></h3>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;letter-spacing:.5px">
            🔄 Ciclos ${turnoActual}: <span style="color:#38bdf8;font-size:16px">${ciclosTurno}</span>
          </div>
          ${paroMiniCard}
          <div class="tarjetero-actions">
            ${!paroActivo ? '<button class="btn btn-danger btn-sm" id="btn-nueva-paro">⏸ Registrar Paro</button>' : ''}
            <button class="btn btn-primary" id="btn-nueva-carga">+ Registrar Carga</button>
          </div>
        </div>
      </div>
      ${tarjetasHtml}`;

    // Bind events
    el.querySelector('#btn-nueva-carga')?.addEventListener('click', () => {
      const pa = state.paroActivo[linea];
      if (pa && pa.tipo !== 'cambio_turno') {
        showCierreParoModal(linea, pa, el, () => openModalCarga(linea, catalogo));
        return;
      }
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
        const pa = state.paroActivo[linea];
        if (pa && pa.tipo !== 'cambio_turno') {
          showCierreParoModal(linea, pa, el, () => {
            const carga = cargas.find(c => String(c.id) === String(btn.dataset.descargar));
            openModalDescargar(linea, carga, catalogo, () => viewLinea(el, linea));
          });
          return;
        }
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

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: BAKER (tarjetero activo)
// ══════════════════════════════════════════════════════════════════════════════

async function viewBaker(el) {
  clearInterval(state._lineaTimer);
  state._lineaTimer = setInterval(() => {
    const elActual = document.getElementById('p-content');
    if (elActual && state.section === 'linea-baker') viewBaker(elActual);
  }, 20000);

  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando Baker...</p></div>';
  try {
    const today = new Date().toISOString().slice(0, 10);
    const turnoActual = getCurrentTurno();

    const [cargasData, catalogData, paroData, todasHoyData, cfgData] = await Promise.all([
      GET('/baker/cargas/activas'),
      GET('/catalogos/baker'),
      GET('/baker/paros/activo').catch(() => null),
      GET(`/baker/cargas?fecha_ini=${today}&fecha_fin=${today}`).catch(() => []),
      GET('/config').catch(() => ({}))
    ]);

    const cargas   = Array.isArray(cargasData) ? cargasData : [];
    const catalogo = catalogData || {};
    let paroActivo = paroData?.paro || null;
    const todasHoy = Array.isArray(todasHoyData) ? todasHoyData : [];
    const planesUrl = (cfgData?.config || cfgData)?.planes_control_baker_url || '';
    const ciclosTurno = todasHoy.filter(c => c.turno === turnoActual).length;

    // Check turno anterior sin actividad (idempotente)
    try {
      const prev = getPrevTurnoInfo();
      await POST('/baker/paros/auto-sin-actividad', { fecha: prev.fecha, turno: prev.turno });
    } catch (_) {}

    const capacidadBar = `
      <div style="display:flex;align-items:center;gap:8px;background:#f1f5f9;border-radius:8px;padding:6px 14px">
        <span style="font-size:13px;color:#64748b;font-weight:600">Herramentales:</span>
        <span style="font-size:18px;font-weight:800;color:${cargas.length >= 7 ? '#dc2626' : cargas.length >= 5 ? '#f59e0b' : '#16a34a'}">${cargas.length}/7</span>
        <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;max-width:80px">
          <div style="width:${(cargas.length/7*100).toFixed(0)}%;background:${cargas.length >= 7 ? '#dc2626' : '#3b82f6'};height:8px;border-radius:4px"></div>
        </div>
      </div>`;

    const paroMiniCard = paroActivo
      ? `<div style="display:flex;align-items:center;gap:8px;background:#fef2f2;border:1.5px solid #dc2626;border-radius:8px;padding:6px 12px">
           <span style="color:#dc2626;font-weight:700;font-size:13px">🔴 PARO ACTIVO</span>
           <span style="font-size:13px;font-weight:600">${escHtml(paroActivo.motivo || '—')}</span>
           <span style="font-size:11px;color:#6b7280">desde ${escHtml(paroActivo.hora_inicio || '')}</span>
           <button class="btn btn-sm btn-primary" id="btn-baker-cerrar-paro" data-id="${paroActivo.id}">✅ Cerrar Paro</button>
         </div>`
      : '';

    const tarjetasHtml = cargas.length === 0
      ? '<div class="empty-state"><div class="icon">📭</div><p>No hay herramentales activos en Baker.</p></div>'
      : `<div class="tarjetero-grid">${cargas.map(c => renderTarjetaBaker(c)).join('')}</div>`;

    el.innerHTML = `
      <div class="tarjetero-header">
        <h3>Baker — Tarjetero Activo <span class="badge badge-activo">${cargas.length} activos</span></h3>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;letter-spacing:.5px">
            🔄 Ciclos ${turnoActual}: <span style="color:#38bdf8;font-size:16px">${ciclosTurno}</span>
          </div>
          ${capacidadBar}
          ${paroMiniCard}
          <div class="tarjetero-actions">
            ${!paroActivo ? '<button class="btn btn-danger btn-sm" id="btn-baker-paro">⏸ Registrar Paro</button>' : ''}
            ${planesUrl ? `<a href="${escHtml(planesUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">📋 Consulta Planes de Control</a>` : ''}
            <button class="btn btn-primary" id="btn-baker-carga"${cargas.length >= 7 ? ' disabled title="Máx. 7 herramentales activos"' : ''}>+ Registrar Herramental</button>
          </div>
        </div>
      </div>
      ${tarjetasHtml}`;

    el.querySelector('#btn-baker-carga')?.addEventListener('click', () => {
      if (paroActivo) { alert('Cierra el paro activo antes de registrar un herramental.'); return; }
      openModalCargaBaker(catalogo, () => viewBaker(el));
    });
    el.querySelector('#btn-baker-paro')?.addEventListener('click', () => {
      openModalParoBaker(catalogo, () => viewBaker(el));
    });
    el.querySelector('#btn-baker-cerrar-paro')?.addEventListener('click', async (ev) => {
      const id = ev.currentTarget.dataset.id;
      try {
        await PATCH(`/baker/paros/${id}/cerrar`, {});
        viewBaker(el);
      } catch (e) { alert('Error al cerrar paro: ' + e.message); }
    });
    el.querySelectorAll('[data-baker-descargar]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (paroActivo) { alert('Cierra el paro activo antes de descargar.'); return; }
        const carga = cargas.find(c => String(c.id) === String(btn.dataset.bakerDescargar));
        openModalDescargaBaker(carga, catalogo, () => viewBaker(el));
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="alert alert-warn">⚠️ Error: ${escHtml(e.message)}</div>`;
  }
}

function renderTarjetaBaker(c) {
  const esBarril = c.herramental_tipo === 'barril';
  const cavInfo  = esBarril
    ? `<div class="tarjeta-meta-item"><span class="meta-label">Cavidades</span><span class="meta-val">${c.cavidades_cargadas ?? '—'}/${c.herramental_cavidades ?? '—'}</span></div>`
    : `<div class="tarjeta-meta-item"><span class="meta-label">Varillas</span><span class="meta-val">${c.varillas ?? '—'}</span></div>
       <div class="tarjeta-meta-item"><span class="meta-label">Cantidad</span><span class="meta-val">${c.cantidad ?? '—'}</span></div>`;

  // Para barril: el componente se guarda por cavidad; derivar del primer slot no vacío
  let noComponente = c.componente || '';
  if (!noComponente && esBarril && Array.isArray(c.cavidades)) {
    const compsCav = [...new Set(c.cavidades.filter(cv => !cv.es_vacia && cv.componente).map(cv => cv.componente))];
    noComponente = compsCav.length === 1 ? compsCav[0] : compsCav.length > 1 ? 'Múltiples' : '';
  }
  noComponente = escHtml(noComponente || '— sin comp —');

  return `
  <div class="tarjeta-card">
    <div class="tarjeta-header">
      <div class="tarjeta-header-info">
        <div class="tarjeta-header-row">
          <span class="meta-label">No. Herramental</span>
          <span class="herramental-no">${escHtml(c.herramental_no || '—')}</span>
        </div>
        <div class="tarjeta-header-row">
          <span class="meta-label">No. Componente</span>
          <span class="tarjeta-comp-no">${noComponente}</span>
        </div>
      </div>
      <span class="folio">#${escHtml(c.folio || c.id)}</span>
    </div>
    <div class="tarjeta-body">
      <div class="tarjeta-cliente">${escHtml(c.cliente || '')}</div>
      <div class="tarjeta-meta">
        ${cavInfo}
        <div class="tarjeta-meta-item">
          <span class="meta-label">Proceso</span>
          <span class="meta-val">${escHtml(c.proceso || '—')}${c.sub_proceso ? ' › ' + escHtml(c.sub_proceso) : ''}</span>
        </div>
        <div class="tarjeta-meta-item">
          <span class="meta-label">Cargado</span>
          <span class="meta-val">${c.fecha_carga || ''} ${fmtTime(c.created_at)}</span>
        </div>
        <div class="tarjeta-meta-item">
          <span class="meta-label">Operador</span>
          <span class="meta-val">${escHtml(c.operador || '—')}</span>
        </div>
      </div>
    </div>
    <div class="tarjeta-footer">
      <span class="badge badge-activo">activo</span>
      <button class="btn-descargar" data-baker-descargar="${c.id}">⬇ Descargar</button>
    </div>
  </div>`;
}

// ── Modal: Registrar Herramental Baker ────────────────────────────────────────
function openModalCargaBaker(catalogo, onDone) {
  const herramentales = (catalogo.herramentales || []).filter(h => h.activo !== false);
  const procesos      = (catalogo.procesos      || []).filter(p => p.activo !== false);
  const subProcesos   = (catalogo.sub_procesos  || []).filter(s => s.activo !== false);
  const componentes   = (catalogo.componentes   || []).filter(c => c.activo !== false);
  const clientes      = (catalogo.clientes      || []).filter(c => c.activo !== false);
  const operadores    = (catalogo.operadores    || []).filter(o => o.activo !== false);

  const myOp = operadores.find(o =>
    (o.rhh_employee_id && o.rhh_employee_id === state.user?.rhh_employee_id) ||
    (o.compras_user_id && o.compras_user_id === state.user?.id)
  );

  const htmlHerr = herramentales.map(h => `<option value="${h.id}" data-tipo="${h.tipo||'rack'}" data-cav="${h.cavidades||0}" data-vtot="${h.varillas_totales||0}">${escHtml(h.numero)}${h.tipo==='barril' ? ' (Barril '+(h.cavidades||'?')+'cav)' : ' (Rack '+(h.varillas_totales||'?')+' var)'}</option>`).join('');
  const htmlProc = procesos.map(p => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('');
  const htmlOper = operadores.map(o => `<option value="${o.id}"${o.id===myOp?.id?' selected':''}>${escHtml(o.nombre)}</option>`).join('');
  const htmlComp = componentes.map(c => `<option value="${c.id}" data-cliente="${escHtml(c.cliente||'')}" data-skf="${escHtml(c.no_skf||'')}" data-var="${c.carga_optima_varillas||''}" data-ppv="${c.piezas_por_varilla||c.piezas_objetivo||''}">${escHtml(c.nombre)}</option>`).join('');
  const htmlCli  = clientes.map(c   => `<option value="${escHtml(c.nombre)}">${escHtml(c.nombre)}</option>`).join('');

  showModal(`
    <h3>Registrar Herramental — Baker</h3>
    <div class="form-grid">
      <div class="form-group full" style="display:flex;gap:8px;align-items:center">
        <label style="white-space:nowrap">Modo registro:</label>
        <button type="button" id="bk-mode-qr" class="btn btn-sm btn-primary">📷 Escanear QR (SKF)</button>
        <button type="button" id="bk-mode-manual" class="btn btn-sm btn-outline">✏️ Manual</button>
      </div>
      <!-- QR zone -->
      <div id="bk-qr-zone" class="form-group full" style="display:none">
        <label>Pega o escribe el código QR SKF:</label>
        <input type="text" id="bk-qr-input" placeholder='56832934"0815045"…' style="font-family:monospace;font-size:12px" />
        <button type="button" id="bk-qr-parse" class="btn btn-sm btn-outline" style="margin-top:6px">🔍 Leer QR</button>
        <div id="bk-qr-result" style="font-size:12px;color:#16a34a;margin-top:4px"></div>
      </div>

      <div class="form-group">
        <label>Herramental</label>
        <select id="bk-herramental"><option value="">— Seleccionar —</option>${htmlHerr}</select>
      </div>
      <div class="form-group">
        <label>Proceso</label>
        <select id="bk-proceso"><option value="">— Seleccionar —</option>${htmlProc}</select>
      </div>
      <div class="form-group">
        <label>Sub-proceso</label>
        <select id="bk-subproceso"><option value="">— Seleccionar —</option></select>
      </div>
      <div class="form-group">
        <label>Operador</label>
        <select id="bk-operador"><option value="">— Seleccionar —</option>${htmlOper}</select>
      </div>

      <!-- Campos rack (se muestran/ocultan según tipo herramental) -->
      <div id="bk-rack-fields" style="display:contents">
        <div class="form-group">
          <label>Cliente</label>
          <select id="bk-cliente-sel" style="width:100%"><option value="">— Seleccionar —</option>${htmlCli}<option value="__otro__">Otro (escribir)</option></select>
          <input type="text" id="bk-cliente-txt" placeholder="Nombre del cliente" style="margin-top:6px;display:none" />
        </div>
        <div class="form-group">
          <label style="display:flex;justify-content:space-between;align-items:center">
            <span>Componente</span>
            <button type="button" id="bk-comp-toggle" class="btn btn-xs btn-outline" style="font-size:11px;padding:2px 8px">✏️ Escribir</button>
          </label>
          <select id="bk-componente"><option value="">— Seleccionar del catálogo —</option>${htmlComp}</select>
          <input type="text" id="bk-componente-txt" placeholder="Escribe el nombre del componente" style="display:none;margin-top:4px" />
        </div>
        <div class="form-group">
          <label>No. SKF</label>
          <input type="text" id="bk-no-skf" placeholder="Auto de catálogo o QR" />
        </div>
        <div class="form-group">
          <label>No. Orden</label>
          <input type="text" id="bk-no-orden" />
        </div>
        <div class="form-group">
          <label>Lote</label>
          <input type="text" id="bk-lote" />
        </div>
        <div class="form-group">
          <label>Varillas</label>
          <input type="number" id="bk-varillas" min="1" />
        </div>
      </div>

      <!-- Cavidades barril (hidden by default) -->
      <div id="bk-barril-fields" style="display:none" class="form-group full">
        <label style="font-weight:700;font-size:14px">Cavidades del barril</label>
        <div id="bk-cavidades-container"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="bk-save">✅ Registrar</button>
    </div>`, { size: 'lg' });

  // Poblar sub-procesos al cambiar proceso
  const subProcesoSel = document.getElementById('bk-subproceso');
  function updateSubProcesos(procesoId) {
    const subs = subProcesos.filter(s => String(s.proceso_id) === String(procesoId));
    subProcesoSel.innerHTML = '<option value="">— Ninguno —</option>' + subs.map(s => `<option value="${s.id}">${escHtml(s.nombre)}</option>`).join('');
  }
  document.getElementById('bk-proceso').addEventListener('change', e => updateSubProcesos(e.target.value));

  // Auto-fill from componente catalog
  document.getElementById('bk-componente').addEventListener('change', e => {
    const opt    = e.target.selectedOptions[0];
    const herrEl = document.getElementById('bk-herramental');
    const herrOpt= herrEl.selectedOptions[0];
    const vtot   = herrOpt?.dataset.vtot || '';

    if (!opt?.value) {
      // Sin componente → varillas = varillas_totales del herramental
      if (vtot) document.getElementById('bk-varillas').value = vtot;
      return;
    }
    const cliente = opt.dataset.cliente || '';
    const skf     = opt.dataset.skf     || '';
    const varComp = opt.dataset.var     || '';  // carga_optima_varillas del componente
    if (cliente) {
      const sel = document.getElementById('bk-cliente-sel');
      const match = [...sel.options].find(o => o.value === cliente);
      if (match) sel.value = cliente;
      document.getElementById('bk-cliente-txt').value = cliente;
    }
    if (skf) document.getElementById('bk-no-skf').value = skf;
    // Si el componente tiene varillas_por_ciclo configuradas, úsalas; si no, usa varillas_totales
    document.getElementById('bk-varillas').value = varComp || vtot || '';
  });

  // Toggle componente: catálogo ↔ texto libre
  function setCompModoLibre(libre) {
    const sel  = document.getElementById('bk-componente');
    const txt  = document.getElementById('bk-componente-txt');
    const btn  = document.getElementById('bk-comp-toggle');
    if (libre) {
      sel.style.display = 'none';
      txt.style.display = '';
      btn.textContent   = '📋 Catálogo';
    } else {
      sel.style.display = '';
      txt.style.display = 'none';
      btn.textContent   = '✏️ Escribir';
    }
  }
  document.getElementById('bk-comp-toggle').addEventListener('click', () => {
    const sel = document.getElementById('bk-componente');
    setCompModoLibre(sel.style.display !== 'none'); // toggle
  });

  // Cliente custom + auto-modo-libre para SKF
  document.getElementById('bk-cliente-sel').addEventListener('change', e => {
    const txt = document.getElementById('bk-cliente-txt');
    const val = e.target.value;
    txt.style.display = val === '__otro__' ? '' : 'none';
    // SKF → activar texto libre en componente automáticamente
    const esSkf = val.toLowerCase().includes('skf');
    setCompModoLibre(esSkf);
  });

  // Herramental tipo toggle + auto-fill varillas con varillas_totales
  document.getElementById('bk-herramental').addEventListener('change', e => {
    const opt  = e.target.selectedOptions[0];
    const tipo = opt?.dataset.tipo || 'rack';
    const cav  = parseInt(opt?.dataset.cav  || '0');
    const vtot = opt?.dataset.vtot || '';
    document.getElementById('bk-rack-fields').style.display   = tipo === 'rack'   ? 'contents' : 'none';
    document.getElementById('bk-barril-fields').style.display = tipo === 'barril' ? '' : 'none';
    if (tipo === 'rack' && vtot) {
      // Default: varillas = varillas_totales si no hay componente seleccionado
      const compSel = document.getElementById('bk-componente');
      if (!compSel.value) document.getElementById('bk-varillas').value = vtot;
    }
    if (tipo === 'barril' && cav > 0) buildCavidadesForm(cav, componentes, clientes);
  });

  // QR mode
  document.getElementById('bk-mode-qr').addEventListener('click', () => {
    document.getElementById('bk-qr-zone').style.display = '';
    document.getElementById('bk-qr-input').focus();
  });
  document.getElementById('bk-mode-manual').addEventListener('click', () => {
    document.getElementById('bk-qr-zone').style.display = 'none';
  });
  document.getElementById('bk-qr-parse').addEventListener('click', () => {
    const raw = document.getElementById('bk-qr-input').value;
    const parts = raw.split('"');
    // SKF: [0]=no_skf, [1]=dispatch(ignore), [2]=no_orden, [3]=componente, [4]=cantidad, [5]=lote
    const no_skf   = parts[0]?.trim() || '';
    const no_orden = parts[2]?.trim() || '';
    const compName = parts[3]?.trim() || '';
    const lote     = parts[5]?.trim() || '';
    document.getElementById('bk-no-skf').value   = no_skf;
    document.getElementById('bk-no-orden').value  = no_orden;
    document.getElementById('bk-lote').value       = lote;
    // Detectar tipo de herramental seleccionado
    const herrEl  = document.getElementById('bk-herramental');
    const herrOpt = herrEl?.selectedOptions[0];
    const tipoHerr = herrOpt?.dataset.tipo || 'rack';

    // Auto-select cliente SKF
    const sklSel = document.getElementById('bk-cliente-sel');
    const skfOpt = [...sklSel.options].find(o => o.value.toLowerCase().includes('skf'));
    if (skfOpt) { sklSel.value = skfOpt.value; sklSel.dispatchEvent(new Event('change')); }
    const clienteSkf = skfOpt?.value || 'SKF';

    if (tipoHerr === 'barril') {
      // Para barril: cada cavidad tiene su propio botón QR — no llenar aquí
      document.getElementById('bk-qr-result').textContent = `ℹ️ Herramental barril: usa el botón 📷 QR de cada cavidad`;
    } else {
      // Rack: llenar campos individuales
      const compTxt = document.getElementById('bk-componente-txt');
      if (compTxt && compTxt.style.display !== 'none') {
        compTxt.value = compName;
      } else {
        const compSel = document.getElementById('bk-componente');
        const compOpt = [...compSel.options].find(o =>
          o.text.toLowerCase().includes(compName.toLowerCase()) || o.dataset.skf === no_skf
        );
        if (compOpt) { compSel.value = compOpt.value; compSel.dispatchEvent(new Event('change')); }
      }
      document.getElementById('bk-qr-result').textContent = `✅ SKF:${no_skf} Orden:${no_orden} Comp:${compName} Lote:${lote}`;
    }
  });

  document.getElementById('bk-save').addEventListener('click', async () => {
    const herrEl = document.getElementById('bk-herramental');
    const herrId = herrEl.value;
    const herrOpt = herrEl.selectedOptions[0];
    const tipo = herrOpt?.dataset.tipo || 'rack';
    if (!herrId) { alert('Selecciona un herramental'); return; }

    const procesoId    = document.getElementById('bk-proceso').value || null;
    const subProcesoId = document.getElementById('bk-subproceso').value || null;
    const operadorId   = document.getElementById('bk-operador').value || null;

    const payload = { herramental_id: herrId, proceso_id: procesoId, sub_proceso_id: subProcesoId, operador_id: operadorId };

    if (tipo === 'rack') {
      const clienteSel = document.getElementById('bk-cliente-sel').value;
      payload.cliente      = clienteSel === '__otro__' ? document.getElementById('bk-cliente-txt').value : clienteSel;
      const compSel = document.getElementById('bk-componente');
      const compTxt = document.getElementById('bk-componente-txt');
      const compLibre = compTxt && compTxt.style.display !== 'none';
      payload.componente_id = compLibre ? null : (compSel.value || null);
      payload.componente    = compLibre ? (compTxt.value.trim() || null) : null;
      payload.no_skf       = document.getElementById('bk-no-skf').value || null;
      payload.no_orden     = document.getElementById('bk-no-orden').value || null;
      payload.lote         = document.getElementById('bk-lote').value || null;
      payload.varillas     = document.getElementById('bk-varillas').value || null;
    } else {
      // barril
      const cavInputs = document.querySelectorAll('#bk-cavidades-container .bk-cav-row');
      payload.cavidades = [...cavInputs].map((row) => {
        const vacia = row.querySelector('.bk-cav-vacia')?.checked || false;
        const clienteSel = row.querySelector('.bk-cav-cliente');
        const clienteTxt = row.querySelector('.bk-cav-cliente-txt');
        const cliente = clienteSel?.value === '__libre__'
          ? (clienteTxt?.value?.trim() || null)
          : (clienteSel?.value || null);
        return {
          es_vacia:        vacia,
          motivo_vacia_id: null,
          motivo_vacia:    null,
          cliente,
          componente_id:   null, // libre: no ID de catálogo
          componente:      row.querySelector('.bk-cav-comp')?.value?.trim() || null,
          no_skf:          row.querySelector('.bk-cav-skf')?.value?.trim()  || null,
          no_orden:        row.querySelector('.bk-cav-orden')?.value?.trim() || null,
          lote:            row.querySelector('.bk-cav-lote')?.value?.trim()  || null,
          cantidad:        row.querySelector('.bk-cav-cantidad')?.value ? Number(row.querySelector('.bk-cav-cantidad').value) : null
        };
      });
    }

    const btn = document.getElementById('bk-save');
    btn.disabled = true; btn.textContent = 'Registrando...';
    try {
      await POST('/baker/cargas', payload);
      closeModal();
      if (onDone) onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = '✅ Registrar';
      alert('Error: ' + e.message);
    }
  });
}

function buildCavidadesForm(n, componentes, clientes) {
  // datalist para autocompletar componente desde catálogo
  const datalistId = 'bk-cav-comp-list';
  const datalistHtml = `<datalist id="${datalistId}">
    ${componentes.map(c => `<option value="${escHtml(c.nombre)}" data-skf="${escHtml(c.no_skf||'')}">`).join('')}
  </datalist>`;
  const htmlCli = clientes.map(c => `<option value="${escHtml(c.nombre)}">${escHtml(c.nombre)}</option>`).join('');

  let html = datalistHtml;
  for (let i = 1; i <= n; i++) {
    html += `<div class="bk-cav-row" data-cav-idx="${i}" style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:700;font-size:13px">Cavidad ${i}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button type="button" class="bk-cav-qr-btn btn btn-xs btn-primary" style="font-size:11px">📷 QR</button>
          <label style="font-size:11px;display:flex;align-items:center;gap:5px;cursor:pointer;color:#dc2626">
            <input type="checkbox" class="bk-cav-vacia" /> Vacía
          </label>
        </div>
      </div>
      <!-- QR inline por cavidad -->
      <div class="bk-cav-qr-zone" style="display:none;background:#f0f9ff;border-radius:6px;padding:8px;margin-bottom:8px">
        <div style="display:flex;gap:6px;align-items:center">
          <input class="bk-cav-qr-input" type="text" placeholder='56832934"0815045"…' style="flex:1;font-family:monospace;font-size:12px" />
          <button type="button" class="bk-cav-qr-parse btn btn-xs btn-outline">🔍 Leer</button>
          <button type="button" class="bk-cav-qr-close btn btn-xs btn-outline" style="color:#dc2626">✕</button>
        </div>
        <div class="bk-cav-qr-result" style="font-size:11px;color:#16a34a;margin-top:3px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div>
          <label style="font-size:12px">Cliente</label>
          <select class="bk-cav-cliente" style="width:100%">
            <option value="">— —</option>${htmlCli}
            <option value="__libre__">✏️ Escribir…</option>
          </select>
          <input class="bk-cav-cliente-txt" type="text" placeholder="Nombre cliente" style="width:100%;display:none;margin-top:3px" />
        </div>
        <div>
          <label style="font-size:12px">Componente</label>
          <input class="bk-cav-comp" type="text" list="${datalistId}" placeholder="Escribir o seleccionar" style="width:100%" />
        </div>
        <div>
          <label style="font-size:12px">No. SKF</label>
          <input class="bk-cav-skf" type="text" style="width:100%" />
        </div>
        <div>
          <label style="font-size:12px">No. Orden</label>
          <input class="bk-cav-orden" type="text" style="width:100%" />
        </div>
        <div>
          <label style="font-size:12px">Lote</label>
          <input class="bk-cav-lote" type="text" style="width:100%" />
        </div>
        <div>
          <label style="font-size:12px">Cantidad piezas</label>
          <input class="bk-cav-cantidad" type="number" min="0" style="width:100%" placeholder="Automático" />
        </div>
        <div style="display:flex;align-items:flex-end">
          <button type="button" class="bk-cav-aplicar-resto btn btn-xs btn-outline" style="font-size:11px;width:100%">↓ Aplicar a todas</button>
        </div>
      </div>
    </div>`;
  }

  const container = document.getElementById('bk-cavidades-container');
  container.innerHTML = html;

  // Bind: cliente libre en cada cavidad
  container.querySelectorAll('.bk-cav-cliente').forEach(sel => {
    sel.addEventListener('change', () => {
      const txt = sel.nextElementSibling;
      txt.style.display = sel.value === '__libre__' ? '' : 'none';
    });
  });

  // Bind: "Aplicar a todas" — copia los datos de la cavidad actual al resto
  container.querySelectorAll('.bk-cav-aplicar-resto').forEach(btn => {
    btn.addEventListener('click', () => {
      const row      = btn.closest('.bk-cav-row');
      const cliente  = row.querySelector('.bk-cav-cliente').value;
      const cliTxt   = row.querySelector('.bk-cav-cliente-txt').value;
      const comp     = row.querySelector('.bk-cav-comp').value;
      const skf      = row.querySelector('.bk-cav-skf').value;
      const orden    = row.querySelector('.bk-cav-orden').value;
      const lote     = row.querySelector('.bk-cav-lote').value;
      const cantidad = row.querySelector('.bk-cav-cantidad').value;
      container.querySelectorAll('.bk-cav-row').forEach(r => {
        if (r === row) return;
        r.querySelector('.bk-cav-cliente').value = cliente;
        const txt = r.querySelector('.bk-cav-cliente-txt');
        txt.style.display = cliente === '__libre__' ? '' : 'none';
        if (cliente === '__libre__') txt.value = cliTxt;
        r.querySelector('.bk-cav-comp').value     = comp;
        r.querySelector('.bk-cav-skf').value      = skf;
        r.querySelector('.bk-cav-orden').value    = orden;
        r.querySelector('.bk-cav-lote').value     = lote;
        r.querySelector('.bk-cav-cantidad').value = cantidad;
      });
    });
  });

  // Bind: QR por cavidad
  container.querySelectorAll('.bk-cav-qr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const zone = btn.closest('.bk-cav-row').querySelector('.bk-cav-qr-zone');
      zone.style.display = '';
      zone.querySelector('.bk-cav-qr-input').focus();
    });
  });
  container.querySelectorAll('.bk-cav-qr-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.bk-cav-qr-zone').style.display = 'none';
    });
  });
  container.querySelectorAll('.bk-cav-qr-parse').forEach(btn => {
    btn.addEventListener('click', () => {
      const zone = btn.closest('.bk-cav-qr-zone');
      const row  = zone.closest('.bk-cav-row');
      const raw  = zone.querySelector('.bk-cav-qr-input').value;
      const parts = raw.split('"');
      const no_skf   = parts[0]?.trim() || '';
      const no_orden = parts[2]?.trim() || '';
      const compName = parts[3]?.trim() || '';
      const cantidad = parts[4]?.trim() || '';
      const lote     = parts[5]?.trim() || '';
      // Detectar cliente SKF en select
      const clienteSel = row.querySelector('.bk-cav-cliente');
      const clienteTxt = row.querySelector('.bk-cav-cliente-txt');
      const skfOpt = [...clienteSel.options].find(o => o.value.toLowerCase().includes('skf'));
      if (skfOpt) {
        clienteSel.value = skfOpt.value;
        clienteTxt.style.display = 'none';
      } else {
        clienteSel.value = '__libre__';
        clienteTxt.style.display = '';
        clienteTxt.value = 'SKF';
      }
      row.querySelector('.bk-cav-comp').value     = compName;
      row.querySelector('.bk-cav-skf').value      = no_skf;
      row.querySelector('.bk-cav-orden').value    = no_orden;
      row.querySelector('.bk-cav-lote').value     = lote;
      if (cantidad) row.querySelector('.bk-cav-cantidad').value = cantidad;
      zone.querySelector('.bk-cav-qr-result').textContent = `✅ ${compName} · SKF:${no_skf} · Cant:${cantidad} · Lote:${lote}`;
      zone.querySelector('.bk-cav-qr-input').value = '';
    });
  });
}


// ── Modal: Descargar Herramental Baker ────────────────────────────────────────
function openModalDescargaBaker(carga, catalogo, onDone) {
  if (!carga) return;
  const defectos = (catalogo.defectos || []).filter(d => d.activo !== false);
  const esBarril = carga.herramental_tipo === 'barril';

  let bodyHtml = '';
  if (esBarril) {
    const defOpts = defectos.map(d => `<option value="${d.id}" data-nombre="${escHtml(d.nombre)}">${escHtml(d.nombre)}</option>`).join('');
    const cavidades = carga.cavidades || [];
    bodyHtml = `<div style="max-height:420px;overflow-y:auto">` +
      cavidades.map((cv, i) => {
        const compLabel = cv.componente || (cv.es_vacia ? '— vacía —' : '—');
        return `<div class="bk-desc-cav" data-num="${cv.num || i+1}" style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-weight:700;font-size:13px">Cavidad ${cv.num || i+1}: ${escHtml(compLabel)}</div>
          ${cv.es_vacia ? '<div style="color:#9ca3af;font-size:12px">Cavidad vacía</div>' : `
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button type="button" class="bk-estado-btn btn btn-sm" data-est="buena" style="background:#dcfce7;color:#166534;border:2px solid transparent">✅ Buena</button>
            <button type="button" class="bk-estado-btn btn btn-sm" data-est="defecto" style="background:#fef2f2;color:#dc2626;border:2px solid transparent">❌ Defecto</button>
            <button type="button" class="bk-estado-btn btn btn-sm" data-est="reproceso" style="background:#fef9c3;color:#854d0e;border:2px solid transparent">🔄 Reproceso</button>
          </div>
          <div class="bk-defecto-sel" style="display:none;margin-top:8px">
            <label style="font-size:12px">Defecto</label>
            <select class="bk-cav-defecto-sel" style="width:100%"><option value="">— Seleccionar —</option>${defOpts}</select>
          </div>`}
        </div>`;
      }).join('') + `</div>`;
  } else {
    // rack
    const defOpts = defectos.map(d => `<option value="${d.id}" data-nombre="${escHtml(d.nombre)}">${escHtml(d.nombre)}</option>`).join('');
    bodyHtml = `
      <div style="background:#f1f5f9;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
        <div><strong>Herramental:</strong> ${escHtml(carga.herramental_no || '—')}</div>
        <div><strong>Componente:</strong> ${escHtml(carga.componente || '—')}</div>
        <div><strong>Varillas:</strong> ${carga.varillas ?? '—'} · <strong>Cantidad:</strong> ${carga.cantidad ?? '—'}</div>
      </div>
      <div class="form-group">
        <label>Resultado</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button type="button" class="bk-rack-est btn btn-sm" data-est="buena" style="background:#dcfce7;color:#166534">✅ Buena</button>
          <button type="button" class="bk-rack-est btn btn-sm" data-est="defecto" style="background:#fef2f2;color:#dc2626">❌ Defecto</button>
          <button type="button" class="bk-rack-est btn btn-sm" data-est="reproceso" style="background:#fef9c3;color:#854d0e">🔄 Reproceso</button>
        </div>
      </div>
      <div id="bk-rack-defecto-wrap" style="display:none;margin-top:8px" class="form-group">
        <label>Tipo de defecto</label>
        <select id="bk-rack-defecto"><option value="">— Seleccionar —</option>${defOpts}</select>
      </div>`;
  }

  showModal(`
    <h3>Descargar Herramental Baker — ${escHtml(carga.herramental_no || carga.folio)}</h3>
    ${bodyHtml}
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="bk-desc-save">⬇ Confirmar Descarga</button>
    </div>`, { size: esBarril ? 'lg' : 'md' });

  let rackEstado = null;
  let rackDefectoId = null;

  if (esBarril) {
    // Bind estado buttons per cavity
    document.querySelectorAll('.bk-desc-cav').forEach(cavEl => {
      cavEl.querySelectorAll('.bk-estado-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          cavEl.querySelectorAll('.bk-estado-btn').forEach(b => b.style.border = '2px solid transparent');
          btn.style.border = '2px solid #1d4ed8';
          cavEl.dataset.estado = btn.dataset.est;
          const defSel = cavEl.querySelector('.bk-defecto-sel');
          if (defSel) defSel.style.display = btn.dataset.est === 'defecto' ? '' : 'none';
        });
      });
    });
  } else {
    document.querySelectorAll('.bk-rack-est').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.bk-rack-est').forEach(b => b.style.outline = 'none');
        btn.style.outline = '2px solid #1d4ed8';
        rackEstado = btn.dataset.est;
        document.getElementById('bk-rack-defecto-wrap').style.display = btn.dataset.est === 'defecto' ? '' : 'none';
      });
    });
  }

  document.getElementById('bk-desc-save').addEventListener('click', async () => {
    const btn = document.getElementById('bk-desc-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      if (esBarril) {
        // Validar que todas las cavidades no-vacías tengan estado seleccionado
        const cavEls = [...document.querySelectorAll('.bk-desc-cav')];
        const sinEstado = cavEls.filter(cavEl => {
          const esVacia = cavEl.querySelector('.bk-estado-btn') === null; // cavidad vacía no tiene botones
          return !esVacia && !cavEl.dataset.estado;
        });
        if (sinEstado.length > 0) {
          const nums = sinEstado.map(c => c.dataset.num).join(', ');
          btn.disabled = false; btn.textContent = '⬇ Confirmar Descarga';
          alert(`Selecciona el resultado de la cavidad ${nums} antes de confirmar.`);
          return;
        }
        const cavResultados = [];
        cavEls.forEach(cavEl => {
          const num = parseInt(cavEl.dataset.num);
          const estado = cavEl.dataset.estado;
          if (!estado) return; // cavidades vacías sin botones
          const defSel = cavEl.querySelector('.bk-cav-defecto-sel');
          const defecto_id = defSel?.value || null;
          const defecto = defSel?.selectedOptions[0]?.dataset?.nombre || null;
          if (estado === 'reproceso') {
            cavResultados.push({ num, estado: 'defecto', defecto_id, defecto, es_reproceso: true });
          } else {
            cavResultados.push({ num, estado, defecto_id, defecto });
          }
        });
        await POST(`/baker/cargas/${carga.id}/descargar`, { cavidades: cavResultados });
      } else {
        if (!rackEstado) { alert('Selecciona el resultado antes de confirmar.'); btn.disabled = false; btn.textContent = '⬇ Confirmar Descarga'; return; }
        if (rackEstado === 'reproceso') {
          // Crear reproceso directo
          await POST(`/baker/cargas/${carga.id}/reprocesar`, {});
          closeModal();
          if (onDone) onDone();
          return;
        }
        const defectoId = rackEstado === 'defecto' ? document.getElementById('bk-rack-defecto').value : null;
        if (rackEstado === 'defecto' && !defectoId) { alert('Selecciona el tipo de defecto.'); btn.disabled = false; btn.textContent = '⬇ Confirmar Descarga'; return; }
        await POST(`/baker/cargas/${carga.id}/descargar`, { defecto_id: defectoId || null });
      }
      closeModal();
      if (onDone) onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = '⬇ Confirmar Descarga';
      alert('Error: ' + e.message);
    }
  });
}

// ── Modal: Registrar Paro Baker ───────────────────────────────────────────────
function openModalParoBaker(catalogo, onDone) {
  const motivos    = (catalogo.motivos_paro || []).filter(m => m.activo !== false);
  const subMotivos = (catalogo.sub_motivos  || []).filter(s => s.activo !== false);
  const htmlMotivos = motivos.map(m => `<option value="${m.id}">${escHtml(m.nombre)}</option>`).join('');

  showModal(`
    <h3>⏸ Registrar Paro — Baker</h3>
    <div class="form-grid">
      <div class="form-group full">
        <label>Motivo de paro</label>
        <select id="bkp-motivo"><option value="">— Seleccionar —</option>${htmlMotivos}</select>
      </div>
      <div class="form-group full">
        <label>Sub-motivo</label>
        <select id="bkp-submotivo"><option value="">— Ninguno —</option></select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" id="bkp-save">⏸ Iniciar Paro</button>
    </div>`, { size: 'sm' });

  document.getElementById('bkp-motivo').addEventListener('change', e => {
    const id = e.target.value;
    const subs = subMotivos.filter(s => String(s.motivo_id) === String(id));
    const subSel = document.getElementById('bkp-submotivo');
    subSel.innerHTML = '<option value="">— Ninguno —</option>' + subs.map(s => `<option value="${s.id}">${escHtml(s.nombre)}</option>`).join('');
  });

  document.getElementById('bkp-save').addEventListener('click', async () => {
    const motivoSel = document.getElementById('bkp-motivo');
    const motivoId  = motivoSel.value;
    const motivoNom = motivoSel.selectedOptions[0]?.text || '';
    if (!motivoId) { alert('Selecciona un motivo'); return; }
    const subSel    = document.getElementById('bkp-submotivo');
    const subId     = subSel.value || null;
    const subNom    = subId ? (subSel.selectedOptions[0]?.text || null) : null;
    const btn = document.getElementById('bkp-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await POST('/baker/paros', { motivo_id: motivoId, motivo: motivoNom, sub_motivo_id: subId, sub_motivo: subNom });
      closeModal();
      if (onDone) onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = '⏸ Iniciar Paro';
      alert('Error: ' + e.message);
    }
  });
}

// ── Modal: cierre obligatorio de paro antes de continuar ──────────────────────
function showCierreParoModal(linea, paro, elContainer, onClosed) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal" style="max-width:460px">
      <div class="modal-header">
        <h3 class="modal-title">🔴 Paro activo — acción requerida</h3>
      </div>
      <div class="modal-body">
        <p style="margin:0 0 12px">Hay un paro activo. Debes cerrarlo antes de registrar una carga o descarga.</p>
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;font-size:13px">
          <div><strong>Motivo:</strong> ${escHtml(paro.motivo || '—')}${paro.sub_motivo ? ' › ' + escHtml(paro.sub_motivo) : ''}</div>
          <div style="margin-top:4px"><strong>Inicio:</strong> ${escHtml(paro.fecha_inicio || '')} ${escHtml(paro.hora_inicio || '')}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="cpm-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="cpm-cerrar">✅ Cerrar Paro y continuar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#cpm-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cpm-cerrar').addEventListener('click', async () => {
    try {
      await PATCH(`/paros/${linea}/${paro.id}/cerrar`, {});
      state.paroActivo[linea] = null;
      overlay.remove();
      // Refresh linea view then run callback
      const elActual = document.getElementById('p-content');
      if (elActual) await viewLinea(elActual, linea);
      if (onClosed) onClosed();
    } catch (e) {
      alert('Error al cerrar paro: ' + e.message);
    }
  });
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
          <span class="meta-val">${c.fecha_carga || ''} ${fmtTime(c.created_at)}</span>
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

  const htmlHerr = herramentales.map(h => `<option value="${h.id}">${escHtml(h.numero)}</option>`).join('');
  const htmlComp = componentes.map(c   => `<option value="${c.id}" data-cliente="${escHtml(c.cliente||'')}" data-optima="${c.carga_optima_varillas||''}" data-pzobj="${c.piezas_objetivo||''}">${escHtml(c.nombre)}</option>`).join('');
  const htmlProc = procesos.map(p      => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('');
  const htmlAcab = acabados.map(a      => `<option value="${a.id}">${escHtml(a.nombre)}</option>`).join('');
  // Auto-detect si el usuario logueado tiene un operador vinculado en esta línea (por RH o compras)
  const myOperador = operadores.find(o =>
    (o.rhh_employee_id && o.rhh_employee_id === state.user?.rhh_employee_id) ||
    (o.compras_user_id && o.compras_user_id === state.user?.id)
  );
  const htmlOper = operadores.map(o    => `<option value="${o.id}"${o.id === myOperador?.id ? ' selected' : ''}>${escHtml(o.nombre)}</option>`).join('');

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
        <select id="mc-varillas"><option value="">— Cantidad —</option>${[...Array(14)].map((_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select>
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
        ${!myOperador && state.user?.role === 'produccion' ? '<span style="font-size:11px;color:#dc2626">Tu usuario no está vinculado como operador en esta línea. Contacta al administrador.</span>' : ''}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="mc-submit">⬆ Cargar Material</button>
    </div>`, { size: 'lg' });

  // Carga vacía siempre disponible
  document.getElementById('mc-vacia-wrap').style.display = '';

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
      herramental_id:    document.getElementById('mc-herramental').value,
      componente_id:     vacia ? null : document.getElementById('mc-componente').value || null,
      es_vacia:          vacia,
      cliente:           document.getElementById('mc-cliente').value.trim(),
      proceso_id:        document.getElementById('mc-proceso').value || null,
      acabado_id:        document.getElementById('mc-acabado').value || null,
      varillas:          parseInt(document.getElementById('mc-varillas').value) || null,
      piezas_por_varilla: parseInt(document.getElementById('mc-pzs-varilla').value) || null,
      cantidad:          parseInt(document.getElementById('mc-cantidad').textContent) || null,
      operador_id:       document.getElementById('mc-operador').value || null
    };
    if (!payload.herramental_id) { alert('Selecciona un herramental'); return; }
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

// ── Modal: Paro detectado automáticamente (15 min sin actividad) ───────────────
function openModalParoAuto(linea, catalogo, horaInicio, fechaInicio, onDone) {
  const motivosParo = catalogo.motivos_paro || [];
  const subMotivos  = catalogo.sub_motivos  || [];
  const htmlMotivos = motivosParo.map(m =>
    `<option value="${m.id}" data-nombre="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`
  ).join('');

  showModal(`
    <h3>⚠️ Paro detectado — Línea ${linea.replace('L', '')}</h3>
    <div class="alert alert-warn" style="margin-bottom:16px">
      Se detectó inactividad desde las <b>${escHtml(horaInicio)}</b>.<br>
      Por favor indica el motivo del paro para continuar.
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label>Motivo de paro</label>
        <select id="mpa-motivo">
          <option value="">— Seleccionar motivo —</option>
          ${htmlMotivos}
        </select>
      </div>
      <div class="form-group full">
        <label>Sub-motivo</label>
        <select id="mpa-submotivo" disabled>
          <option value="">— Primero selecciona motivo —</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="mpa-submit">⏸ Registrar Paro</button>
    </div>`, { size: 'sm' });

  document.getElementById('mpa-motivo').addEventListener('change', function() {
    const subSel = document.getElementById('mpa-submotivo');
    const filtrados = subMotivos.filter(s => String(s.motivo_id) === String(this.value));
    subSel.innerHTML = filtrados.length > 0
      ? '<option value="">— Seleccionar —</option>' + filtrados.map(s => `<option value="${s.id}">${escHtml(s.nombre)}</option>`).join('')
      : '<option value="">— Sin sub-motivos —</option>';
    subSel.disabled = filtrados.length === 0;
  });

  document.getElementById('mpa-submit').addEventListener('click', async () => {
    const motivoSel = document.getElementById('mpa-motivo');
    const subSel    = document.getElementById('mpa-submotivo');
    const motivo_id = motivoSel.value;
    const motivo    = motivoSel.options[motivoSel.selectedIndex]?.dataset?.nombre || '';
    const sub_motivo_id = subSel.value || null;
    const sub_motivo    = sub_motivo_id ? (subSel.options[subSel.selectedIndex]?.text || '') : '';
    if (!motivo_id) { alert('Selecciona el motivo de paro'); return; }
    const btn = document.getElementById('mpa-submit');
    btn.disabled = true; btn.textContent = 'Registrando...';
    try {
      await POST(`/paros/${linea}`, { motivo_id, motivo, sub_motivo_id, sub_motivo, fecha_inicio: fechaInicio, hora_inicio: horaInicio });
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
          <option value="">Todas</option>
          <option value="L3">Línea 3</option>
          <option value="L4">Línea 4</option>
          <option value="Baker">Baker</option>
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
      <button class="btn btn-outline btn-sm" id="pz-vista-ind" onclick="window.open('/pizarron/vista','_blank')">📺 Vista independiente</button>
      ${state.user?.role === 'admin' ? `
        <button class="btn btn-primary btn-sm" id="pz-guardar-kpi">💾 Guardar KPI</button>
        <button class="btn btn-dark btn-sm" id="pz-export">📥 Exportar Excel</button>` : ''}
    </div>
    <div id="pz-resultado">
      <div class="empty-state"><div class="icon">📋</div><p>Selecciona filtros y presiona Consultar.</p></div>
    </div>`;

  async function cargarPizarron() {
    const lineaSel = document.getElementById('pz-linea').value;
    const fecha    = document.getElementById('pz-fecha').value;
    const turno    = document.getElementById('pz-turno').value;
    const res      = document.getElementById('pz-resultado');
    if (!res) return;
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando KPI...</p></div>';
    try {
      const params = new URLSearchParams();
      // Cuando no se selecciona línea específica, pedir ambas
      params.set('linea', lineaSel || 'ambas');
      if (fecha) params.set('fecha', fecha);
      params.set('turno', turno || 'all');
      const data = await GET(`/pizarron?${params}`);

      // El backend devuelve { fecha, linea, turno, data: { L3: { T1: { slots, totals }, totales_dia }, L4: {...} } }
      const backendData = data?.data || {};
      const rows        = [];
      // turnoTotals keyed by 'L3-T1', dayTotals keyed by 'L3'
      const turnoTotals = {};
      const dayTotals   = {};

      const pct = v => v != null ? v * 100 : null;

      for (const [l, lineaData] of Object.entries(backendData)) {
        const turnos = turno ? [turno] : ['T1', 'T2', 'T3'];
        for (const t of turnos) {
          const turnoData = lineaData[t];
          if (!turnoData) continue;
          for (const slot of turnoData.slots || []) {
            // Solo incluir slots con al menos 1 ciclo o con paros
            if (slot.ciclos_totales === 0 && slot.paros_min === 0) continue;
            rows.push({
              turno: t,
              hora:  slot.hora_inicio,
              linea: l,
              eficiencia:     pct(slot.eficiencia),
              capacidad:      pct(slot.capacidad),
              calidad:        pct(slot.calidad),
              disponibilidad: pct(slot.disponibilidad),
              ciclos:         slot.ciclos_totales,
              ciclos_buenos:  slot.ciclos_buenos
            });
          }
          // Guardar totales de turno del backend
          if (turnoData.totals) {
            const tot = turnoData.totals;
            turnoTotals[`${l}-${t}`] = {
              ciclos:         tot.ciclos_totales,
              eficiencia:     pct(tot.eficiencia),
              capacidad:      pct(tot.capacidad),
              calidad:        pct(tot.calidad),
              disponibilidad: pct(tot.disponibilidad)
            };
          }
        }
        // Totales del día
        if (lineaData.totales_dia) {
          const td = lineaData.totales_dia;
          dayTotals[l] = {
            ciclos:         td.ciclos_totales,
            eficiencia:     pct(td.eficiencia),
            capacidad:      pct(td.capacidad),
            calidad:        pct(td.calidad),
            disponibilidad: pct(td.disponibilidad)
          };
        }
      }

      if (rows.length === 0 && Object.keys(turnoTotals).length === 0) {
        res.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Sin registros para los filtros seleccionados.</p></div>';
        return;
      }
      res.innerHTML = renderPizarronTable(rows, turnoTotals, dayTotals);
    } catch (e) {
      res.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  document.getElementById('pz-buscar').addEventListener('click', cargarPizarron);

  if (state.user?.role === 'admin') {
    document.getElementById('pz-guardar-kpi')?.addEventListener('click', async () => {
      const fecha = document.getElementById('pz-fecha').value;
      const linea = document.getElementById('pz-linea').value || 'ambas';
      const turno = document.getElementById('pz-turno').value || 'all';
      const btn   = document.getElementById('pz-guardar-kpi');
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        const r = await POST('/kpis/guardar', { fecha, linea, turno });
        alert(`✅ KPI guardado: ${r.guardados} snapshot(s) para ${fecha}`);
      } catch (e) { alert('Error: ' + e.message); }
      finally { btn.disabled = false; btn.textContent = '💾 Guardar KPI'; }
    });

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

function renderPizarronTable(rows, turnoTotals, dayTotals) {
  turnoTotals = turnoTotals || {};
  dayTotals   = dayTotals   || {};
  const ORDER = ['T1', 'T2', 'T3'];

  // Determinar líneas presentes
  const lineas = Object.keys(dayTotals).length
    ? Object.keys(dayTotals)
    : [...new Set(rows.map(r => r.linea))].filter(Boolean);

  // Si solo hay una línea → tabla simple; si hay varias → una sección por línea
  function renderLineaSection(linea) {
    const lineaRows = rows.filter(r => r.linea === linea);
    const byTurno   = {};
    for (const r of lineaRows) {
      const t = r.turno || '';
      if (!byTurno[t]) byTurno[t] = [];
      byTurno[t].push(r);
    }
    const turnosConDatos = ORDER.filter(t =>
      byTurno[t]?.length || turnoTotals[`${linea}-${t}`]
    );

    let bodyHtml = '';
    for (const turno of turnosConDatos) {
      const grupo  = byTurno[turno] || [];
      const tLabel = `Turno ${turno}`;
      bodyHtml += `<tr class="turno-row"><td colspan="6">${tLabel}</td></tr>`;
      for (const r of grupo) {
        bodyHtml += `<tr>
          <td>${escHtml(r.hora || '—')}</td>
          <td style="text-align:center;font-weight:700">${r.ciclos != null ? r.ciclos : '—'}</td>
          <td class="${kpiColor(r.eficiencia)}">${fmtPct(r.eficiencia)}</td>
          <td class="${kpiColor(r.capacidad)}">${fmtPct(r.capacidad)}</td>
          <td class="${kpiColor(r.calidad)}">${fmtPct(r.calidad)}</td>
          <td class="${kpiColor(r.disponibilidad)}">${fmtPct(r.disponibilidad)}</td>
        </tr>`;
      }
      const tt = turnoTotals[`${linea}-${turno}`];
      if (tt) {
        bodyHtml += `<tr class="totals-row">
          <td>Total ${tLabel}</td>
          <td style="text-align:center;font-weight:700">${tt.ciclos ?? '—'}</td>
          <td class="${kpiColor(tt.eficiencia)}">${fmtPct(tt.eficiencia)}</td>
          <td class="${kpiColor(tt.capacidad)}">${fmtPct(tt.capacidad)}</td>
          <td class="${kpiColor(tt.calidad)}">${fmtPct(tt.calidad)}</td>
          <td class="${kpiColor(tt.disponibilidad)}">${fmtPct(tt.disponibilidad)}</td>
        </tr>`;
      }
    }
    const dt = dayTotals[linea];
    if (dt) {
      bodyHtml += `<tr class="day-total-row">
        <td>TOTAL DÍA</td>
        <td style="text-align:center;font-weight:700">${dt.ciclos ?? '—'}</td>
        <td class="${kpiColor(dt.eficiencia)}">${fmtPct(dt.eficiencia)}</td>
        <td class="${kpiColor(dt.capacidad)}">${fmtPct(dt.capacidad)}</td>
        <td class="${kpiColor(dt.calidad)}">${fmtPct(dt.calidad)}</td>
        <td class="${kpiColor(dt.disponibilidad)}">${fmtPct(dt.disponibilidad)}</td>
      </tr>`;
    }

    return `
      <div class="table-card" style="margin-bottom:18px">
        <div class="table-header">
          <h3>📊 KPI — ${escHtml(linea)}</h3>
        </div>
        <div class="pizarron-scroll">
          <table class="pizarron-table">
            <thead><tr>
              <th>Hora</th><th>Ciclos</th><th>Eficiencia</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th>
            </tr></thead>
            <tbody>${bodyHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  const sectionsHtml = lineas.map(renderLineaSection).join('');

  return `
  <div class="pizarron-wrap">
    <div class="pizarron-header">
      <h3>Pizarrón KPI</h3>
      <small style="color:var(--p-muted);font-size:11px">Auto-actualiza cada 30 seg</small>
    </div>
    ${sectionsHtml}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: MONITOR EN VIVO (solo admin)
// ══════════════════════════════════════════════════════════════════════════════

async function viewMonitor(el) {
  if (state.user?.role !== 'admin') {
    el.innerHTML = '<div class="alert alert-warn">Acceso restringido a administradores.</div>';
    return;
  }

  function renderMonitorContent(cargasL3, cargasL4, cargasBaker, paroL3, paroL4, paroBaker) {
    const turno    = getCurrentTurno();
    const today    = new Date().toISOString().slice(0, 10);
    const now      = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const cBakerNorm = cargasBaker.map(c => ({ ...c, linea: 'Baker' }));
    const todas    = [...cargasL3, ...cargasL4, ...cBakerNorm].sort((a, b) => {
      const ta = `${a.fecha_carga}T${a.hora_carga || '00:00'}`;
      const tb = `${b.fecha_carga}T${b.hora_carga || '00:00'}`;
      return ta > tb ? -1 : ta < tb ? 1 : 0;
    });

    const ciclosL3    = cargasL3.filter(c => c.turno === turno).length;
    const ciclosL4    = cargasL4.filter(c => c.turno === turno).length;
    const ciclosBaker = cargasBaker.filter(c => c.turno === turno).length;

    const paroHtml = (paro, label) => paro
      ? `<div style="background:#dc2626;color:#fff;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700">
           ⛔ ${label} PARADA: ${escHtml(paro.motivo)} desde ${escHtml(paro.hora_inicio)}
         </div>`
      : `<div style="background:#16a34a;color:#fff;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700">✅ ${label} en operación</div>`;

    const filas = todas.map(c => {
      const badgeClass = c.estado === 'procesado' ? 'badge-procesado' : c.estado === 'defecto' ? 'badge-defecto' : 'badge-activo';
      const lineaBadge = c.linea === 'L3' ? 'badge-t1' : c.linea === 'Baker' ? 'badge-t3' : 'badge-t2';
      // Para Baker barril mostrar cavidades_cargadas; para rack mostrar varillas × ppv = cantidad
      const piezasHtml = c.herramental_tipo === 'barril'
        ? `${c.cavidades_cargadas ?? '—'} cav. (${c.cavidades_buenas ?? '—'} buenas)`
        : `${c.varillas ?? '—'} × ${c.piezas_por_varilla ?? '—'} = <strong>${c.cantidad ?? '—'}</strong>`;
      return `<tr>
        <td class="mono" style="font-size:11px">${escHtml(c.hora_carga || '—')}</td>
        <td><span class="badge ${lineaBadge}">${escHtml(c.linea)}</span></td>
        <td><span class="badge ${getTurnoColor(c.turno)}">${escHtml(c.turno || '—')}</span></td>
        <td class="mono">${escHtml(c.herramental_no || '—')}</td>
        <td>${escHtml(c.componente || (c.herramental_tipo === 'barril' ? '(barril)' : '—'))}</td>
        <td>${piezasHtml}</td>
        <td>${escHtml(c.operador || '—')}</td>
        <td><span class="badge ${badgeClass}">${escHtml(c.estado)}</span></td>
      </tr>`;
    }).join('');

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${paroHtml(paroL3, 'L3')}
          ${paroHtml(paroL4, 'L4')}
          ${paroHtml(paroBaker, 'Baker')}
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700">
            L3 — Ciclos ${turno}: <span style="color:#38bdf8">${ciclosL3}</span>
          </div>
          <div style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700">
            L4 — Ciclos ${turno}: <span style="color:#38bdf8">${ciclosL4}</span>
          </div>
          <div style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700">
            Baker — Ciclos ${turno}: <span style="color:#38bdf8">${ciclosBaker}</span>
          </div>
          <span style="font-size:11px;color:var(--p-muted)">Actualizado: ${now}</span>
        </div>
      </div>
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Hora carga</th><th>Línea</th><th>Turno</th><th>Herramental</th>
                <th>Componente</th><th>Piezas</th><th>Operador</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${filas || '<tr><td colspan="8" style="text-align:center;color:var(--p-muted)">Sin registros hoy</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function cargarMonitor() {
    const today = new Date().toISOString().slice(0, 10);
    const contenedor = document.getElementById('monitor-contenido');
    if (!contenedor) return;
    try {
      const [dL3, dL4, dBaker, paroL3Res, paroL4Res, paroBakerRes] = await Promise.all([
        GET(`/cargas/L3?fecha_ini=${today}&fecha_fin=${today}`),
        GET(`/cargas/L4?fecha_ini=${today}&fecha_fin=${today}`),
        GET(`/baker/cargas?fecha_ini=${today}&fecha_fin=${today}`),
        GET('/paros/L3/activo').catch(() => null),
        GET('/paros/L4/activo').catch(() => null),
        GET('/baker/paros/activo').catch(() => null)
      ]);
      const cL3    = Array.isArray(dL3)    ? dL3    : [];
      const cL4    = Array.isArray(dL4)    ? dL4    : [];
      const cBaker = Array.isArray(dBaker) ? dBaker : [];
      contenedor.innerHTML = renderMonitorContent(cL3, cL4, cBaker, paroL3Res?.paro || null, paroL4Res?.paro || null, paroBakerRes?.paro || null);
    } catch (e) {
      contenedor.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  el.innerHTML = `
    <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px">
      <span style="font-size:12px;color:var(--p-muted)">📡 Auto-actualiza cada 15 seg — Cargas del día de hoy (L3 + L4 + Baker)</span>
      <button class="btn btn-outline btn-sm" id="mon-refresh">↻ Actualizar</button>
    </div>
    <div id="monitor-contenido"><div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div></div>`;

  document.getElementById('mon-refresh')?.addEventListener('click', cargarMonitor);

  clearInterval(state._monitorTimer);
  state._monitorTimer = setInterval(cargarMonitor, 15000);
  cargarMonitor();
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: REPORTES
// ══════════════════════════════════════════════════════════════════════════════

async function viewReportes(el) {
  const today = new Date().toISOString().slice(0, 10);
  let activeRptTab = 'L3';

  el.innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn tab-active" data-tab="L3">Línea 3</button>
      <button class="tab-btn" data-tab="L4">Línea 4</button>
      <button class="tab-btn" data-tab="Baker">Baker</button>
    </div>
    <div class="filters-bar">
      <div><span class="flabel">Desde</span><input type="date" id="rpt-desde" value="${today}"/></div>
      <div><span class="flabel">Hasta</span><input type="date" id="rpt-hasta" value="${today}"/></div>
      <button class="btn btn-outline btn-sm" id="rpt-buscar">🔍 Consultar</button>
      <button class="btn btn-dark btn-sm" id="rpt-export">📥 Excel</button>
    </div>
    <div id="rpt-resultado">
      <div class="empty-state"><div class="icon">📈</div><p>Selecciona el rango de fechas y consulta.</p></div>
    </div>`;

  el.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      activeRptTab = btn.dataset.tab;
    });
  });

  function rptResultBadge(c) {
    const est = c.resultado || c.estado || '';
    if (est === 'buena')      return `<span class="badge badge-activo">Buena</span>`;
    if (est === 'defecto')    return `<span class="badge badge-defecto">Defecto${c.defecto ? ': ' + escHtml(c.defecto) : ''}</span>`;
    if (est === 'reproceso')  return `<span class="badge badge-warn">Reproceso</span>`;
    if (est === 'descargado') return `<span class="badge badge-procesado">Descargado</span>`;
    if (est === 'vacia')      return `<span class="badge" style="background:#e2e8f0;color:#64748b">Vacía</span>`;
    return `<span class="badge badge-activo">${escHtml(est || 'activo')}</span>`;
  }

  function rptTipoLabel(c) {
    return c.es_reproceso ? '<span class="badge badge-warn" style="font-size:10px">Reproceso</span>'
                          : '<span class="badge badge-procesado" style="font-size:10px">Proceso</span>';
  }

  function renderTablaLinea(cargas, linea) {
    if (!cargas.length) return '<div class="empty-state"><div class="icon">📋</div><p>Sin registros para este período.</p></div>';
    return `
      <div class="table-card">
        <div class="table-header">
          <h3>Reporte — ${escHtml(linea)}</h3>
          <span class="badge badge-activo">${cargas.length} registros</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Folio</th><th>F. Carga</th><th>Hr Carga</th><th>F. Descarga</th><th>Hr Descarga</th>
              <th>Herramental</th><th>Componente</th><th>Cantidad</th>
              <th>Proceso</th><th>Sub-proceso</th><th>Operador</th>
              <th>Resultado</th><th>Tipo</th>
            </tr></thead>
            <tbody>
              ${cargas.map(c => `<tr>
                <td class="mono">${escHtml(c.folio || c.id)}</td>
                <td>${escHtml(c.fecha_carga || '—')}</td>
                <td class="mono">${escHtml(c.hora_carga || '—')}</td>
                <td>${escHtml(c.fecha_descarga || '—')}</td>
                <td class="mono">${escHtml(c.hora_descarga || '—')}</td>
                <td>${escHtml(c.herramental_no || c.herramental || '—')}</td>
                <td>${escHtml(c.componente || '—')}</td>
                <td style="text-align:right;font-weight:700">${c.cantidad ?? '—'}</td>
                <td>${escHtml(c.proceso || '—')}</td>
                <td>${escHtml(c.sub_proceso || '—')}</td>
                <td>${escHtml(c.operador || '—')}</td>
                <td>${rptResultBadge(c)}</td>
                <td>${rptTipoLabel(c)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderTablaCavidades(cavs) {
    if (!cavs.length) return '';
    return `
      <div class="table-card" style="margin-top:18px">
        <div class="table-header">
          <h3>Baker — Barriles por cavidad</h3>
          <span class="badge badge-activo">${cavs.length} cavidades</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Folio Barril</th><th>Cav.</th><th>F. Carga</th><th>Hr Carga</th><th>F. Descarga</th><th>Hr Descarga</th>
              <th>Herramental</th><th>Componente</th><th>No. SKF</th><th>Cantidad</th>
              <th>Proceso</th><th>Sub-proceso</th><th>Operador</th>
              <th>Resultado</th><th>Tipo</th>
            </tr></thead>
            <tbody>
              ${cavs.map(c => `<tr>
                <td class="mono">${escHtml(c.folio_barril || '—')}</td>
                <td style="text-align:center;font-weight:700">${c.cavidad_num ?? '—'}</td>
                <td>${escHtml(c.fecha_carga || '—')}</td>
                <td class="mono">${escHtml(c.hora_carga || '—')}</td>
                <td>${escHtml(c.fecha_descarga || '—')}</td>
                <td class="mono">${escHtml(c.hora_descarga || '—')}</td>
                <td>${escHtml(c.herramental_no || '—')}</td>
                <td>${escHtml(c.componente || '—')}</td>
                <td class="mono">${escHtml(c.no_skf || '—')}</td>
                <td style="text-align:right;font-weight:700">${c.cantidad ?? '—'}</td>
                <td>${escHtml(c.proceso || '—')}</td>
                <td>${escHtml(c.sub_proceso || '—')}</td>
                <td>${escHtml(c.operador || '—')}</td>
                <td>${rptResultBadge(c)}</td>
                <td>${rptTipoLabel(c)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function ejecutarConsulta() {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const res   = document.getElementById('rpt-resultado');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
    try {
      const params = new URLSearchParams({ linea: activeRptTab });
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);

      if (activeRptTab === 'Baker') {
        const [cargasData, cavsData] = await Promise.all([
          GET(`/reportes?${params}`),
          GET(`/baker/cavidades?fecha_ini=${desde}&fecha_fin=${hasta}`)
        ]);
        const allCargas = cargasData?.cargas || cargasData || [];
        const racks = allCargas.filter(c => c.herramental_tipo !== 'barril');
        const cavs  = Array.isArray(cavsData) ? cavsData : [];
        res.innerHTML = renderTablaLinea(racks, 'Baker — Racks') + renderTablaCavidades(cavs);
      } else {
        const data   = await GET(`/reportes?${params}`);
        const cargas = data?.cargas || data || [];
        res.innerHTML = renderTablaLinea(cargas, activeRptTab === 'L3' ? 'Línea 3' : 'Línea 4');
      }
    } catch (e) {
      res.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  document.getElementById('rpt-buscar').addEventListener('click', ejecutarConsulta);

  document.getElementById('rpt-export').addEventListener('click', async () => {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    try {
      const params = new URLSearchParams({ linea: activeRptTab });
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      const wb = XLSX.utils.book_new();

      if (activeRptTab === 'Baker') {
        const [cargasData, cavsData] = await Promise.all([
          GET(`/reportes?${params}`),
          GET(`/baker/cavidades?fecha_ini=${desde}&fecha_fin=${hasta}`)
        ]);
        const allCargas = cargasData?.cargas || cargasData || [];
        const racks = allCargas.filter(c => c.herramental_tipo !== 'barril');
        const cavs  = Array.isArray(cavsData) ? cavsData : [];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(racks), 'Baker Racks');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cavs),  'Baker Barriles');
      } else {
        const data   = await GET(`/reportes?${params}`);
        const cargas = data?.cargas || data || [];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cargas), activeRptTab);
      }
      XLSX.writeFile(wb, `reporte_${activeRptTab}_${desde}_${hasta}.xlsx`);
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

const BAKER_CATALOG_TABS = [
  { key: 'clientes',              label: 'Clientes' },
  { key: 'componentes',           label: 'Componentes' },
  { key: 'herramentales',         label: 'Herramentales' },
  { key: 'procesos',              label: 'Procesos' },
  { key: 'sub_procesos',          label: 'Sub-procesos' },
  { key: 'defectos',              label: 'Defectos' },
  { key: 'motivos_cavidad_vacia', label: 'Motivos Cav. Vacía' },
  { key: 'motivos_paro',          label: 'Motivos Paro' },
  { key: 'sub_motivos',           label: 'Sub-motivos' }
];

// Mapea claves de frontend al nombre de tipo que usa la API
function apiTipo(key) {
  const map = {
    motivos_paro: 'motivos-paro',
    sub_motivos: 'sub-motivos-paro',
    sub_procesos: 'sub-procesos',
    motivos_cavidad_vacia: 'motivos-cavidad-vacia'
  };
  return map[key] || key;
}

async function viewCatalogos(el, linea) {
  const isBaker = linea === 'baker';
  const tabs = isBaker ? BAKER_CATALOG_TABS : CATALOG_TABS;
  let activeTab = isBaker ? 'clientes' : 'componentes';
  let catalogo  = {};

  async function loadAndRender() {
    try {
      const data = await GET(`/catalogos/${linea}`);
      catalogo   = data || {};
    } catch { catalogo = {}; }
    renderCatalogoSection();
  }

  let clienteFilter = '';

  function renderCatalogoSection() {
    const tabsHtml = tabs.map(t =>
      `<button class="tab-btn${activeTab === t.key ? ' tab-active' : ''}" data-tab="${t.key}">${t.label}</button>`
    ).join('');

    let items = Array.isArray(catalogo[activeTab]) ? catalogo[activeTab] : [];

    // Filtro por cliente (solo Baker componentes)
    const showClienteFilter = isBaker && activeTab === 'componentes';
    const clientes = showClienteFilter
      ? [...new Set(items.map(i => i.cliente).filter(Boolean))].sort()
      : [];
    if (showClienteFilter && clienteFilter) {
      items = items.filter(i => i.cliente === clienteFilter);
    }
    const filterHtml = showClienteFilter ? `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:13px;color:var(--p-muted);font-weight:600">Cliente:</span>
        <select id="cat-cliente-filter" style="min-width:160px">
          <option value="">Todos</option>
          ${clientes.map(c => `<option value="${escHtml(c)}" ${c === clienteFilter ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>
      </div>` : '';

    const bodyHtml = renderCatalogoTable(activeTab, items, linea, catalogo);

    el.innerHTML = `
      <div class="table-card">
        <div class="table-header">
          <div class="tab-bar" id="cat-tabs">${tabsHtml}</div>
          <button class="btn btn-primary btn-sm" id="cat-nuevo">+ Nuevo</button>
        </div>
        <div style="padding:18px">
          ${filterHtml}
          ${bodyHtml}
        </div>
      </div>`;

    document.querySelectorAll('#cat-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; clienteFilter = ''; renderCatalogoSection(); });
    });

    document.getElementById('cat-cliente-filter')?.addEventListener('change', e => {
      clienteFilter = e.target.value;
      renderCatalogoSection();
    });

    document.getElementById('cat-nuevo').addEventListener('click', () => {
      openCatalogoModal(activeTab, linea, null, () => loadAndRender(), catalogo);
    });

    el.querySelectorAll('[data-edit-cat]').forEach(btn => {
      const id   = btn.dataset.editCat;
      const item = items.find(i => String(i.id) === String(id));
      btn.addEventListener('click', () => openCatalogoModal(activeTab, linea, item, () => loadAndRender(), catalogo));
    });

    el.querySelectorAll('[data-del-cat]').forEach(btn => {
      const id = btn.dataset.delCat;
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este registro?')) return;
        try {
          await DEL(`/catalogos/${linea}/${apiTipo(activeTab)}/${id}`);
          loadAndRender();
        } catch (e) { alert('Error: ' + e.message); }
      });
    });
  }

  await loadAndRender();
}

function renderCatalogoTable(tipo, items, linea, catalogo) {
  if (items.length === 0) {
    return '<div class="empty-state"><div class="icon">📦</div><p>Sin registros. Crea el primero.</p></div>';
  }

  const colsMap = {
    componentes:   ['nombre', 'cliente', 'carga_optima_varillas', 'piezas_objetivo'],
    procesos:      ['nombre', 'descripcion'],
    acabados:      ['nombre', 'descripcion'],
    herramentales: ['numero', 'nombre', 'descripcion'],
    defectos:      ['nombre', 'descripcion'],
    motivos_paro:  ['nombre', 'descripcion'],
    sub_motivos:   ['nombre', 'motivo_nombre', 'descripcion'],
    // Baker-specific
    clientes:              ['nombre'],
    sub_procesos:          ['nombre', 'proceso_nombre'],
    motivos_cavidad_vacia: ['nombre']
  };

  // Baker herramentales: different columns
  if (tipo === 'herramentales' && catalogo?.clientes !== undefined) {
    colsMap.herramentales = ['numero', 'tipo', 'varillas_totales', 'cavidades', 'descripcion'];
  }
  // Baker componentes: add no_skf
  if (tipo === 'componentes' && items.some(i => i.no_skf !== undefined)) {
    colsMap.componentes = ['nombre', 'cliente', 'no_skf', 'carga_optima_varillas', 'piezas_objetivo'];
  }

  const cols = colsMap[tipo] || ['nombre'];

  // Para sub_motivos: enriquecer cada item con el nombre del motivo padre
  let displayItems = items;
  if (tipo === 'sub_motivos') {
    const motivosParo = catalogo?.motivos_paro || [];
    displayItems = items.map(item => ({
      ...item,
      motivo_nombre: motivosParo.find(m => String(m.id) === String(item.motivo_id))?.nombre || `ID: ${item.motivo_id ?? '—'}`
    }));
  }
  if (tipo === 'sub_procesos') {
    const procesos = catalogo?.procesos || [];
    displayItems = items.map(item => ({
      ...item,
      proceso_nombre: procesos.find(p => String(p.id) === String(item.proceso_id))?.nombre || `ID: ${item.proceso_id ?? '—'}`
    }));
  }

  const colHeaders = {
    motivo_nombre:        'Motivo padre',
    proceso_nombre:       'Proceso padre',
    carga_optima_varillas:'Varillas/ciclo',
    piezas_objetivo:      'Pzas/varilla',
    no_skf:               'No. SKF',
    tipo:                 'Tipo',
    cavidades:            'Cavidades',
    varillas_totales:     'Varillas totales'
  };

  return `
  <table>
    <thead>
      <tr>
        <th>#</th>
        ${cols.map(c => `<th>${colHeaders[c] || c.replace(/_/g,' ')}</th>`).join('')}
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${displayItems.map(item => `
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

function openCatalogoModal(tipo, linea, item, onDone, catalogo) {
  const isNew    = item == null;
  const title    = isNew ? `Nuevo registro — ${tipo.replace(/_/g,' ')}` : `Editar — ${tipo.replace(/_/g,' ')}`;

  const fields = buildCatalogoFields(tipo, item, catalogo);

  showModal(`
    <h3>${title}</h3>
    <div class="form-grid">
      ${fields}
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="cat-save">💾 Guardar</button>
    </div>`);

  // Baker componentes: toggle campo libre de cliente
  const clienteSelEl = document.getElementById('cf-cliente-sel');
  if (clienteSelEl) {
    clienteSelEl.addEventListener('change', () => {
      const txt = document.getElementById('cf-cliente');
      if (clienteSelEl.value === '__libre__') {
        txt.style.display = '';
        txt.value = '';
        txt.focus();
      } else {
        txt.style.display = 'none';
        txt.value = clienteSelEl.value;
      }
    });
  }

  document.getElementById('cat-save').addEventListener('click', async () => {
    const payload = collectCatalogoFields(tipo);
    const btn     = document.getElementById('cat-save');
    btn.disabled  = true; btn.textContent = 'Guardando...';
    try {
      if (isNew) {
        await POST(`/catalogos/${linea}/${apiTipo(tipo)}`, payload);
      } else {
        await PATCH(`/catalogos/${linea}/${apiTipo(tipo)}/${item.id}`, payload);
      }
      closeModal();
      onDone();
    } catch (e) {
      btn.disabled  = false; btn.textContent = '💾 Guardar';
      alert('Error: ' + e.message);
    }
  });
}

function buildCatalogoFields(tipo, item, catalogo) {
  const v   = (key) => escHtml(item?.[key] ?? '');
  const inp = (key, label, type = 'text', extra = '') =>
    `<div class="form-group">
      <label>${label}</label>
      <input type="${type}" id="cf-${key}" value="${v(key)}" ${extra} />
    </div>`;

  // Baker herramentales detect by presence of 'clientes' key in catalogo
  const isBakerLinea = catalogo?.clientes !== undefined;

  switch (tipo) {
    case 'componentes': {
      const clienteField = isBakerLinea ? (() => {
        const clientes = (catalogo?.clientes || []).filter(c => c.activo !== false);
        const currentCliente = item?.cliente || '';
        const enLista = clientes.some(c => c.nombre === currentCliente);
        const opts = clientes.map(c =>
          `<option value="${escHtml(c.nombre)}" ${c.nombre === currentCliente ? 'selected' : ''}>${escHtml(c.nombre)}</option>`
        ).join('');
        return `<div class="form-group">
          <label>Cliente</label>
          <select id="cf-cliente-sel" style="width:100%">
            <option value="">— Seleccionar —</option>
            ${opts}
            <option value="__libre__" ${!enLista && currentCliente ? 'selected' : ''}>✏️ Escribir manualmente…</option>
          </select>
          <input type="text" id="cf-cliente" value="${escHtml(currentCliente)}"
            placeholder="Escribe el nombre del cliente"
            style="margin-top:6px;display:${!enLista && currentCliente ? '' : 'none'}" />
        </div>`;
      })() : inp('cliente', 'Cliente');
      return inp('nombre', 'Nombre del componente') +
             clienteField +
             (isBakerLinea ? inp('no_skf', 'No. SKF (para QR)') : '') +
             inp('carga_optima_varillas', isBakerLinea ? 'Varillas por ciclo' : 'Carga óptima varillas', 'number') +
             inp('piezas_objetivo', isBakerLinea ? 'Piezas por varilla' : 'Piezas objetivo/varilla', 'number');
    }
    case 'herramentales':
      if (isBakerLinea) {
        const tipoVal = item?.tipo || 'rack';
        return inp('numero', 'No. Herramental') +
               inp('descripcion', 'Descripción') +
               `<div class="form-group">
                 <label>Tipo</label>
                 <select id="cf-tipo" style="width:100%">
                   <option value="rack" ${tipoVal==='rack'?'selected':''}>Rack</option>
                   <option value="barril" ${tipoVal==='barril'?'selected':''}>Barril</option>
                 </select>
               </div>` +
               inp('varillas_totales', 'Varillas totales del rack (si rack)', 'number') +
               inp('cavidades', 'Cavidades totales (si barril)', 'number');
      }
      return inp('numero', 'No. Herramental') +
             inp('nombre', 'Nombre') +
             inp('descripcion', 'Descripción');
    case 'procesos':
    case 'acabados':
    case 'defectos':
    case 'motivos_paro':
    case 'clientes':
    case 'motivos_cavidad_vacia':
      return inp('nombre', 'Nombre') +
             inp('descripcion', 'Descripción');
    case 'sub_motivos': {
      const motivosParo = (catalogo?.motivos_paro || []).filter(m => m.activo !== false);
      const currentMotivoId = String(item?.motivo_id ?? '');
      const motivoOpts = motivosParo.length > 0
        ? motivosParo.map(m =>
            `<option value="${m.id}" ${String(m.id) === currentMotivoId ? 'selected' : ''}>${escHtml(m.nombre)}</option>`
          ).join('')
        : '<option value="">— Sin motivos de paro —</option>';
      return inp('nombre', 'Nombre') +
             `<div class="form-group">
               <label>Motivo de paro (padre)</label>
               <select id="cf-motivo_id" style="width:100%">
                 <option value="">— Seleccionar motivo —</option>
                 ${motivoOpts}
               </select>
             </div>` +
             inp('descripcion', 'Descripción');
    }
    case 'sub_procesos': {
      const procesos = (catalogo?.procesos || []).filter(p => p.activo !== false);
      const currentProcesoId = String(item?.proceso_id ?? '');
      const procesoOpts = procesos.length > 0
        ? procesos.map(p =>
            `<option value="${p.id}" ${String(p.id) === currentProcesoId ? 'selected' : ''}>${escHtml(p.nombre)}</option>`
          ).join('')
        : '<option value="">— Sin procesos —</option>';
      return inp('nombre', 'Nombre') +
             `<div class="form-group">
               <label>Proceso (padre)</label>
               <select id="cf-proceso_id" style="width:100%">
                 <option value="">— Seleccionar proceso —</option>
                 ${procesoOpts}
               </select>
             </div>`;
    }
    default:
      return inp('nombre', 'Nombre');
  }
}

function collectCatalogoFields(tipo) {
  const g = (id) => document.getElementById(`cf-${id}`)?.value?.trim() || '';
  switch (tipo) {
    case 'componentes': {
      // Cliente: puede venir del select (cf-cliente-sel) o del texto libre (cf-cliente)
      const clienteSel = document.getElementById('cf-cliente-sel');
      const clienteTxt = document.getElementById('cf-cliente');
      let cliente = g('cliente'); // fallback para L3/L4
      if (clienteSel) {
        cliente = clienteSel.value === '__libre__' || clienteSel.value === ''
          ? (clienteTxt?.value?.trim() || '')
          : clienteSel.value;
      }
      return { nombre: g('nombre'), cliente, no_skf: g('no_skf') || null, carga_optima_varillas: g('carga_optima_varillas') || null, piezas_objetivo: g('piezas_objetivo') || null };
    }
    case 'herramentales':
      return { numero: g('numero'), nombre: g('nombre'), descripcion: g('descripcion'), tipo: g('tipo') || undefined, cavidades: g('cavidades') || null, varillas_totales: g('varillas_totales') || null };
    case 'sub_motivos':
      return { nombre: g('nombre'), motivo_id: g('motivo_id') || null, descripcion: g('descripcion') };
    case 'sub_procesos':
      return { nombre: g('nombre'), proceso_id: g('proceso_id') || null };
    default:
      return { nombre: g('nombre'), descripcion: g('descripcion') };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: OPERADORES
// ══════════════════════════════════════════════════════════════════════════════

async function viewOperadores(el) {
  async function loadAndRender() {
    let operadoresL3 = [], operadoresL4 = [], operadoresBaker = [], usuariosSistema = [];
    try {
      const [dL3, dL4, dBaker, dUsers] = await Promise.all([
        GET('/operadores/L3'),
        GET('/operadores/L4'),
        GET('/operadores/baker'),
        GET('/usuarios-sistema')
      ]);
      operadoresL3    = Array.isArray(dL3)    ? dL3    : (dL3?.operadores    || []);
      operadoresL4    = Array.isArray(dL4)    ? dL4    : (dL4?.operadores    || []);
      operadoresBaker = Array.isArray(dBaker) ? dBaker : (dBaker?.operadores || []);
      usuariosSistema = Array.isArray(dUsers) ? dUsers : [];
    } catch (e) {
      el.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
      return;
    }

    const tableHtml = (ops, linea) => ops.length === 0
      ? '<div class="empty-state"><div class="icon">👤</div><p>Sin operadores asignados.</p></div>'
      : `<table>
          <thead><tr><th>#</th><th>Nombre</th><th>Correo</th><th>Activo</th><th></th></tr></thead>
          <tbody>
            ${ops.map(op => `<tr>
              <td class="mono">${op.id}</td>
              <td>${escHtml(op.nombre)}</td>
              <td style="font-size:11px;color:var(--p-muted)">${escHtml(op.email || '—')}</td>
              <td>
                <div class="toggle-wrap" data-toggle-op="${op.id}" data-linea="${linea}" data-activo="${op.activo ? '1' : '0'}">
                  <div class="toggle-switch${op.activo ? ' on' : ''}"></div>
                  <span style="font-size:12px;color:var(--p-muted)">${op.activo ? 'Activo' : 'Inactivo'}</span>
                </div>
              </td>
              <td>
                <button class="btn btn-outline btn-xs" data-edit-op="${op.id}" data-linea="${linea}">✏️</button>
                <button class="btn btn-xs" style="background:#fee2e2;color:#dc2626;border:0;" data-del-op="${op.id}" data-linea="${linea}">🗑️</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
        <div class="table-card">
          <div class="table-header">
            <h3>Línea 3</h3>
            <button class="btn btn-primary btn-sm" data-nuevo-op="L3">+ Agregar</button>
          </div>
          <div class="table-scroll">${tableHtml(operadoresL3, 'L3')}</div>
        </div>
        <div class="table-card">
          <div class="table-header">
            <h3>Línea 4</h3>
            <button class="btn btn-primary btn-sm" data-nuevo-op="L4">+ Agregar</button>
          </div>
          <div class="table-scroll">${tableHtml(operadoresL4, 'L4')}</div>
        </div>
        <div class="table-card">
          <div class="table-header">
            <h3>Baker</h3>
            <button class="btn btn-primary btn-sm" data-nuevo-op="baker">+ Agregar</button>
          </div>
          <div class="table-scroll">${tableHtml(operadoresBaker, 'baker')}</div>
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
        const id    = btn.dataset.editOp;
        const linea = btn.dataset.linea;
        const lista = linea === 'L3' ? operadoresL3 : linea === 'baker' ? operadoresBaker : operadoresL4;
        const op    = lista.find(o => String(o.id) === String(id));
        openOperadorModal(linea, op, usuariosSistema, loadAndRender);
      });
    });

    // Eliminar
    el.querySelectorAll('[data-del-op]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id    = btn.dataset.delOp;
        const linea = btn.dataset.linea;
        if (!confirm('¿Quitar este operador de la línea?')) return;
        try {
          await PATCH(`/operadores/${linea}/${id}`, { activo: false });
          loadAndRender();
        } catch (e) { alert('Error: ' + e.message); }
      });
    });

    // Nuevo
    el.querySelectorAll('[data-nuevo-op]').forEach(btn => {
      btn.addEventListener('click', () => {
        const linea = btn.dataset.nuevoOp;
        const yaAsignados = linea === 'L3'
          ? operadoresL3.map(o => o.rhh_employee_id).filter(Boolean)
          : operadoresL4.map(o => o.rhh_employee_id).filter(Boolean);
        const disponibles = usuariosSistema.filter(u => !yaAsignados.includes(u.id));
        openOperadorModal(linea, null, disponibles, loadAndRender);
      });
    });
  }

  await loadAndRender();
}

function openOperadorModal(linea, op, usuariosDisponibles, onDone) {
  const isNew = op == null;
  const optsHtml = usuariosDisponibles.map(u =>
    `<option value="${u.id}" data-nombre="${escHtml(u.full_name)}" data-email="${escHtml(u.email || '')}">${escHtml(u.full_name)}${u.employee_number ? ' [' + escHtml(u.employee_number) + ']' : ''} — ${escHtml(u.email || '')}</option>`
  ).join('');

  showModal(`
    <h3>${isNew ? 'Agregar Operador' : 'Editar Operador'} — Línea ${linea.replace('L','')}</h3>
    <div class="form-grid">
      ${isNew ? `
      <div class="form-group full">
        <label>Seleccionar usuario del sistema</label>
        <select id="op-usuario-sel" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;">
          <option value="">— Seleccionar —</option>
          ${optsHtml}
        </select>
        <span class="form-hint">Empleados activos del sistema RH</span>
      </div>` : ''}
      <div class="form-group full">
        <label>Nombre (para el tarjetero)</label>
        <input type="text" id="op-nombre" value="${escHtml(op?.nombre || '')}" placeholder="Nombre del operador" />
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="op-save">💾 Guardar</button>
    </div>`, { size: 'sm' });

  // Auto-fill nombre when user is selected
  if (isNew) {
    document.getElementById('op-usuario-sel')?.addEventListener('change', function() {
      const opt = this.options[this.selectedIndex];
      if (opt.value) {
        document.getElementById('op-nombre').value = opt.dataset.nombre || '';
      }
    });
  }

  document.getElementById('op-save').addEventListener('click', async () => {
    const nombre   = document.getElementById('op-nombre').value.trim();
    const selEl    = document.getElementById('op-usuario-sel');
    const userId   = selEl ? selEl.value : null;
    if (!nombre) { alert('Ingresa el nombre del operador'); return; }
    if (isNew && !userId) { alert('Selecciona un usuario del sistema'); return; }
    const payload = { nombre };
    if (userId) payload.rhh_employee_id = Number(userId);
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
// VISTA: PAROS
// ══════════════════════════════════════════════════════════════════════════════

async function viewParos(el) {
  const today  = new Date().toLocaleDateString('en-CA');
  const hace30 = new Date(Date.now() - 30*24*3600*1000).toLocaleDateString('en-CA');

  el.innerHTML = `
    <div class="filters-bar">
      <div>
        <span class="flabel">Línea</span>
        <select id="pr-linea">
          <option value="">Todas</option>
          <option value="L3">Línea 3</option>
          <option value="L4">Línea 4</option>
          <option value="Baker">Baker</option>
        </select>
      </div>
      <div>
        <span class="flabel">Turno</span>
        <select id="pr-turno">
          <option value="">Todos</option>
          <option value="T1">T1</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
        </select>
      </div>
      <div>
        <span class="flabel">Desde</span>
        <input type="date" id="pr-desde" value="${hace30}"/>
      </div>
      <div>
        <span class="flabel">Hasta</span>
        <input type="date" id="pr-hasta" value="${today}"/>
      </div>
      <button class="btn btn-outline btn-sm" id="pr-buscar">🔍 Buscar</button>
      <button class="btn btn-dark btn-sm" id="pr-export">📥 Excel</button>
    </div>
    <div id="pr-resultado">
      <div class="empty-state"><div class="icon">⏸</div><p>Presiona Buscar para cargar los paros.</p></div>
    </div>`;

  const isAdmin = state.user?.role === 'admin';
  let lastParos = [];

  async function buscar() {
    const params = new URLSearchParams();
    const linea = document.getElementById('pr-linea').value;
    const turno = document.getElementById('pr-turno').value;
    const desde = document.getElementById('pr-desde').value;
    const hasta = document.getElementById('pr-hasta').value;
    if (linea) params.set('linea', linea);
    if (turno) params.set('turno', turno);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const res = document.getElementById('pr-resultado');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
    try {
      const data = await GET(`/paros/reporte?${params}`);
      lastParos = data?.paros || [];
      if (!lastParos.length) {
        res.innerHTML = '<div class="empty-state"><div class="icon">⏸</div><p>Sin paros para estos filtros.</p></div>';
        return;
      }
      renderTablaParos(res);
    } catch (e) {
      res.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  function renderTablaParos(res) {
    res.innerHTML = `
      <div class="table-card">
        <div class="table-header">
          <h3>Paros registrados</h3>
          <span class="badge badge-activo">${lastParos.length} registros</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Folio</th><th>Línea</th><th>Turno</th>
                <th>Fecha inicio</th><th>Hr inicio</th>
                <th>Fecha fin</th><th>Hr fin</th>
                <th>Duración (min)</th><th>Motivo</th><th>Sub-motivo</th><th>Registrado por</th><th>Estado</th>
                ${isAdmin ? '<th>Acciones</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${lastParos.map((p, idx) => {
                const abierto = !p.fecha_fin;
                let estadoBadge = abierto
                  ? '<span class="badge badge-activo">Activo</span>'
                  : '<span class="badge badge-procesado">Cerrado</span>';
                if (p.corregido) estadoBadge += ` <span class="badge" style="background:#f59e0b;color:#fff" title="Editado por ${escHtml(p.corregido_por||'')}">✏️ Corregido</span>`;
                const dur = p.duracion_min != null ? p.duracion_min + ' min' : (abierto ? '<em>en curso</em>' : '—');
                const accionesTd = isAdmin ? `<td style="white-space:nowrap">
                  ${abierto ? `<button class="btn btn-outline btn-sm" data-pa-cerrar="${idx}">✅ Cerrar</button> ` : ''}
                  <button class="btn btn-outline btn-sm" data-pa-editar="${idx}">✏️ Editar</button>
                  <button class="btn btn-danger btn-sm" data-pa-borrar="${idx}" style="margin-left:4px">🗑 Borrar</button>
                </td>` : '';
                return `<tr>
                  <td class="mono" style="font-size:11px">${escHtml(p.folio || p.id)}</td>
                  <td><span class="badge ${p.linea==='L3'?'badge-t1':p.linea==='Baker'?'badge-t3':'badge-t2'}">${escHtml(p.linea)}</span></td>
                  <td><span class="badge ${getTurnoColor(p.turno)}">${escHtml(p.turno||'—')}</span></td>
                  <td>${escHtml(p.fecha_inicio||'—')}</td>
                  <td class="mono">${escHtml(p.hora_inicio||'—')}</td>
                  <td>${escHtml(p.fecha_fin||'—')}</td>
                  <td class="mono">${escHtml(p.hora_fin||'—')}</td>
                  <td style="text-align:center;font-weight:700">${dur}</td>
                  <td>${escHtml(p.motivo||'—')}</td>
                  <td>${escHtml(p.sub_motivo||'—')}</td>
                  <td style="font-size:11px;color:var(--p-muted)">${escHtml(p.registrado_por||'—')}</td>
                  <td>${estadoBadge}</td>
                  ${accionesTd}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    if (isAdmin) {
      // Cerrar paro
      res.querySelectorAll('[data-pa-cerrar]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const p = lastParos[Number(btn.dataset.paCerrar)];
          if (!p) return;
          if (!confirm(`¿Cerrar el paro de ${p.linea} (${p.motivo})?`)) return;
          try {
            await PATCH(`/paros/${p.id}/admin-cerrar`, {});
            await buscar();
          } catch (e) { alert('Error: ' + e.message); }
        });
      });

      // Editar paro
      res.querySelectorAll('[data-pa-editar]').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = lastParos[Number(btn.dataset.paEditar)];
          if (p) openModalEditarParo(p, buscar);
        });
      });

      // Borrar paro
      res.querySelectorAll('[data-pa-borrar]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const p = lastParos[Number(btn.dataset.paBorrar)];
          if (!p) return;
          if (!confirm(`¿Borrar el paro ${escHtml(p.folio || p.id)} de ${p.linea}? Esta acción es irreversible.`)) return;
          try {
            await DEL(`/paros/${p.id}`);
            await buscar();
          } catch (e) { alert('Error: ' + e.message); }
        });
      });
    }
  }

  document.getElementById('pr-buscar').addEventListener('click', buscar);

  document.getElementById('pr-export').addEventListener('click', () => {
    if (!lastParos.length) { alert('Primero ejecuta una búsqueda.'); return; }
    const rows = lastParos.map(p => ({
      Folio:           p.folio || p.id,
      Línea:           p.linea,
      Turno:           p.turno,
      Fecha_Inicio:    p.fecha_inicio,
      Hora_Inicio:     p.hora_inicio,
      Fecha_Fin:       p.fecha_fin || '',
      Hora_Fin:        p.hora_fin || '',
      Duración_min:    p.duracion_min ?? '',
      Motivo:          p.motivo || '',
      Sub_Motivo:      p.sub_motivo || '',
      Registrado_por:  p.registrado_por || '',
      Estado:          p.fecha_fin ? 'Cerrado' : 'Activo',
      Corregido:       p.corregido ? 'Sí' : 'No',
      Corregido_por:   p.corregido_por || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Paros');
    XLSX.writeFile(wb, `paros_${new Date().toLocaleDateString('en-CA')}.xlsx`);
  });

  // Carga inicial automática
  buscar();
}

// ── Modal: editar paro (admin) ─────────────────────────────────────────────────
function openModalEditarParo(paro, onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal" style="max-width:500px">
      <div class="modal-header">
        <h3 class="modal-title">✏️ Editar Paro</h3>
        <button class="modal-close" id="epm-close">✕</button>
      </div>
      <div class="modal-body" style="display:grid;gap:12px">
        <div class="form-group">
          <label>Motivo</label>
          <input type="text" id="epm-motivo" class="form-control" value="${escHtml(paro.motivo||'')}"/>
        </div>
        <div class="form-group">
          <label>Sub-motivo</label>
          <input type="text" id="epm-submotivo" class="form-control" value="${escHtml(paro.sub_motivo||'')}"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-group">
            <label>Fecha inicio</label>
            <input type="date" id="epm-fecha-ini" class="form-control" value="${paro.fecha_inicio||''}"/>
          </div>
          <div class="form-group">
            <label>Hora inicio</label>
            <input type="time" id="epm-hora-ini" class="form-control" value="${paro.hora_inicio||''}"/>
          </div>
          <div class="form-group">
            <label>Fecha fin</label>
            <input type="date" id="epm-fecha-fin" class="form-control" value="${paro.fecha_fin||''}"/>
          </div>
          <div class="form-group">
            <label>Hora fin</label>
            <input type="time" id="epm-hora-fin" class="form-control" value="${paro.hora_fin||''}"/>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="epm-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="epm-guardar">💾 Guardar cambios</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#epm-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#epm-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#epm-guardar').addEventListener('click', async () => {
    const body = {
      motivo:       document.getElementById('epm-motivo').value.trim(),
      sub_motivo:   document.getElementById('epm-submotivo').value.trim(),
      fecha_inicio: document.getElementById('epm-fecha-ini').value,
      hora_inicio:  document.getElementById('epm-hora-ini').value,
      fecha_fin:    document.getElementById('epm-fecha-fin').value || null,
      hora_fin:     document.getElementById('epm-hora-fin').value || null
    };
    if (!body.motivo) { alert('El motivo es requerido.'); return; }
    try {
      await PATCH(`/paros/${paro.id}/admin-editar`, body);
      overlay.remove();
      if (onSaved) onSaved();
    } catch (e) {
      alert('Error al guardar: ' + e.message);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════════════════════

async function viewConfiguracion(el) {
  let cfg = {};
  try { const d = await GET('/config'); cfg = d?.config || d || {}; } catch {}

  const n = (k, def = 0) => cfg[k] ?? def;
  const row = (id, label, val, unit = '') => `
    <div class="config-item">
      <label>${label}</label>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" id="${id}" value="${val}" min="0" style="width:90px"/>
        ${unit ? `<span style="font-size:12px;color:var(--p-muted)">${unit}</span>` : ''}
      </div>
    </div>`;

  el.innerHTML = `
    <div class="form-card config-section">
      <h3>Configuración General</h3>

      <h4 style="margin-top:20px">Ciclos objetivo por hora</h4>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        ${row('cfg-ciclos-l3','Línea 3', n('ciclos_objetivo_l3',2), 'ciclos/hr')}
        ${row('cfg-ciclos-l4','Línea 4', n('ciclos_objetivo_l4',2), 'ciclos/hr')}
        ${row('cfg-ciclos-baker','Baker',  n('ciclos_objetivo_baker',2), 'ciclos/hr')}
      </div>

      <h4 style="margin-top:24px">Objetivos KPI (%)</h4>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="text-align:left;color:var(--p-muted)">
            <th style="padding:6px 10px">KPI</th>
            <th style="padding:6px 10px">Línea 3 (%)</th>
            <th style="padding:6px 10px">Línea 4 (%)</th>
            <th style="padding:6px 10px">Baker (%)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:6px 10px">Eficiencia</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-ef-l3" value="${n('eficiencia_obj_l3',85)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-ef-l4" value="${n('eficiencia_obj_l4',85)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-ef-baker" value="${n('eficiencia_obj_baker',85)}" min="0" max="100" style="width:80px"/></td>
          </tr>
          <tr>
            <td style="padding:6px 10px">Capacidad</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cap-l3" value="${n('capacidad_obj_l3',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cap-l4" value="${n('capacidad_obj_l4',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cap-baker" value="${n('capacidad_obj_baker',90)}" min="0" max="100" style="width:80px"/></td>
          </tr>
          <tr>
            <td style="padding:6px 10px">Calidad</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cal-l3" value="${n('calidad_obj_l3',95)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cal-l4" value="${n('calidad_obj_l4',95)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cal-baker" value="${n('calidad_obj_baker',95)}" min="0" max="100" style="width:80px"/></td>
          </tr>
          <tr>
            <td style="padding:6px 10px">Disponibilidad</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-dis-l3" value="${n('disponibilidad_obj_l3',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-dis-l4" value="${n('disponibilidad_obj_l4',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-dis-baker" value="${n('disponibilidad_obj_baker',90)}" min="0" max="100" style="width:80px"/></td>
          </tr>
        </tbody>
      </table>

      <h4 style="margin-top:24px">Baker — Botones de acceso rápido</h4>
      <div class="config-item">
        <label>URL Planes de Control Baker</label>
        <input type="url" id="cfg-planes-url" value="${escHtml(cfg.planes_control_baker_url || '')}" placeholder="https://..." style="width:100%;max-width:480px"/>
        <span style="font-size:11px;color:var(--p-muted)">Se muestra como botón "📋 Consulta Planes de Control" en el tarjetero Baker. Dejar vacío para ocultar.</span>
      </div>

      <div style="margin-top:24px">
        <button class="btn btn-primary" id="cfg-save">💾 Guardar cambios</button>
        <span id="cfg-msg" style="margin-left:12px;font-size:13px;color:var(--p-success)"></span>
      </div>
    </div>`;

  document.getElementById('cfg-save').addEventListener('click', async () => {
    const g = id => parseFloat(document.getElementById(id).value) || 0;
    const btn = document.getElementById('cfg-save');
    const msg = document.getElementById('cfg-msg');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await PATCH('/config', {
        ciclos_objetivo_l3:    g('cfg-ciclos-l3'),
        ciclos_objetivo_l4:    g('cfg-ciclos-l4'),
        ciclos_objetivo_baker: g('cfg-ciclos-baker'),
        eficiencia_obj_l3:     g('cfg-ef-l3'),
        eficiencia_obj_l4:     g('cfg-ef-l4'),
        eficiencia_obj_baker:  g('cfg-ef-baker'),
        capacidad_obj_l3:      g('cfg-cap-l3'),
        capacidad_obj_l4:      g('cfg-cap-l4'),
        capacidad_obj_baker:   g('cfg-cap-baker'),
        calidad_obj_l3:        g('cfg-cal-l3'),
        calidad_obj_l4:        g('cfg-cal-l4'),
        calidad_obj_baker:     g('cfg-cal-baker'),
        disponibilidad_obj_l3: g('cfg-dis-l3'),
        disponibilidad_obj_l4: g('cfg-dis-l4'),
        disponibilidad_obj_baker: g('cfg-dis-baker'),
        planes_control_baker_url: document.getElementById('cfg-planes-url')?.value?.trim() || ''
      });
      msg.style.color = 'var(--p-success)';
      msg.textContent = '✅ Guardado correctamente';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch (e) {
      msg.style.color = 'var(--p-danger)';
      msg.textContent = '⚠️ Error: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = '💾 Guardar cambios';
    }
  });

  // ─── Slideshow config section ─────────────────────────────────────────────
  const ssCfgCard = document.createElement('div');
  ssCfgCard.className = 'form-card config-section';
  ssCfgCard.style.marginTop = '24px';
  ssCfgCard.id = 'ss-cfg-card';
  ssCfgCard.innerHTML = `
    <h3>📺 Pizarrón Digital — Configuración</h3>
    <p style="color:var(--p-muted);font-size:13px;margin:4px 0 20px">
      Configura las diapositivas y duración del pizarrón digital.
      <a href="/pizarron/vista" target="_blank" style="color:var(--p-primary);text-decoration:none;margin-left:12px">🔗 Abrir Pizarrón</a>
    </p>

    <div class="config-item">
      <label>Duración por defecto</label>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" id="ss-default-dur" value="120" min="5" style="width:90px"/>
        <span style="font-size:12px;color:var(--p-muted)">segundos por diapositiva</span>
      </div>
    </div>

    <h4 style="margin:20px 0 12px">Diapositivas KPI</h4>
    <div id="ss-kpi-slides-list"></div>

    <h4 style="margin:20px 0 12px">Imágenes / Avisos</h4>
    <div id="ss-img-slides-list"></div>
    <div style="margin-top:12px">
      <label style="display:inline-block;padding:8px 16px;background:var(--p-surface2);border:1px dashed var(--p-border);border-radius:8px;cursor:pointer;font-size:13px">
        + Cargar imagen
        <input type="file" id="ss-img-upload" accept="image/*" style="display:none"/>
      </label>
      <span style="font-size:12px;color:var(--p-muted);margin-left:12px">JPG, PNG, GIF · máx. 2MB</span>
    </div>

    <div style="margin-top:24px">
      <button class="btn btn-primary" id="ss-cfg-save">💾 Guardar configuración pizarrón</button>
      <span id="ss-cfg-msg" style="margin-left:12px;font-size:13px;color:var(--p-success)"></span>
    </div>`;
  el.appendChild(ssCfgCard);

  function escHtmlCfg(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderImgSlides(imgSlides) {
    const el2 = document.getElementById('ss-img-slides-list');
    if (!imgSlides.length) {
      el2.innerHTML = '<p style="font-size:13px;color:var(--p-muted)">Sin imágenes cargadas.</p>';
      return;
    }
    el2.innerHTML = imgSlides.map(s => `
      <div class="ss-img-row" data-img-id="${s.id}" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--p-border)">
        <img src="${escHtmlCfg(s.imagen_b64)}" style="width:64px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--p-border)"/>
        <input type="text" class="form-control ss-img-titulo" data-img-id="${s.id}" value="${escHtmlCfg(s.titulo||'')}" placeholder="Título (opcional)" style="flex:1;font-size:13px"/>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" class="ss-img-dur" data-img-id="${s.id}" value="${s.duracion_seg || ''}" placeholder="Default" min="5" style="width:72px"/>
          <span style="font-size:11px;color:var(--p-muted)">seg</span>
        </div>
        <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer">
          <input type="checkbox" class="ss-img-active" data-img-id="${s.id}" ${s.activo !== false ? 'checked' : ''}/>
          Activa
        </label>
        <button class="btn btn-danger btn-sm ss-img-del" data-img-id="${s.id}">🗑</button>
      </div>`).join('');

    el2.querySelectorAll('.ss-img-del').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.ss-img-row').remove();
      });
    });
  }

  async function loadSsConfig() {
    let ssCfg = { default_duracion_seg: 120, slides: [] };
    try {
      const d = await GET('/slideshow-config');
      ssCfg = d?.slideshow || ssCfg;
    } catch {}

    document.getElementById('ss-default-dur').value = ssCfg.default_duracion_seg || 120;

    const KPI_LABELS = {
      1: 'Turno actual · Línea 3',
      2: 'Turno actual · Línea 4',
      3: 'Turno actual · Todas las líneas',
      4: 'Día acumulado · Línea 3',
      5: 'Día acumulado · Línea 4',
      6: 'Día acumulado · Todas las líneas',
      7: 'Turno actual · Baker',
      8: 'Día acumulado · Baker'
    };

    // KPI slides
    const kpiListEl = document.getElementById('ss-kpi-slides-list');
    kpiListEl.innerHTML = [1,2,3,4,5,6,7,8].map(id => {
      const slide = ssCfg.slides.find(s => s.id === id && s.type === 'kpi') || {id, type:'kpi', activo:true, duracion_seg:null};
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--p-border)">
          <label style="cursor:pointer;display:flex;align-items:center;gap:6px">
            <input type="checkbox" class="ss-kpi-active" data-id="${id}" ${slide.activo !== false ? 'checked' : ''} style="cursor:pointer"/>
            <span style="font-size:13px">${KPI_LABELS[id]}</span>
          </label>
          <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;color:var(--p-muted)">Duración:</span>
            <input type="number" class="ss-kpi-dur" data-id="${id}" value="${slide.duracion_seg || ''}" placeholder="Default" min="5" style="width:80px"/>
            <span style="font-size:11px;color:var(--p-muted)">seg</span>
          </div>
        </div>`;
    }).join('');

    // Image slides
    renderImgSlides(ssCfg.slides.filter(s => s.type === 'imagen'));

    // Store current config for save
    el._ssCfg = ssCfg;
  }

  await loadSsConfig();

  // Image upload
  document.getElementById('ss-img-upload').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('La imagen no puede superar 2MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const ssCfg = el._ssCfg || { slides: [] };
      const maxId = Math.max(0, ...ssCfg.slides.map(s => s.id || 0));
      const newSlide = { id: maxId + 1, type: 'imagen', imagen_b64: reader.result, titulo: '', duracion_seg: null, activo: true };
      ssCfg.slides = [...ssCfg.slides, newSlide];
      el._ssCfg = ssCfg;
      renderImgSlides(ssCfg.slides.filter(s => s.type === 'imagen'));
      ev.target.value = '';
    };
    reader.readAsDataURL(file);
  });

  // Save slideshow config
  document.getElementById('ss-cfg-save').addEventListener('click', async () => {
    const btn = document.getElementById('ss-cfg-save');
    const msg = document.getElementById('ss-cfg-msg');
    btn.disabled = true; btn.textContent = 'Guardando...';

    const defaultDur = Number(document.getElementById('ss-default-dur').value) || 120;

    const SCOPES = {1:'turno',2:'turno',3:'turno',4:'dia',5:'dia',6:'dia'};
    const LINEAS  = {1:'L3',2:'L4',3:'ambas',4:'L3',5:'L4',6:'ambas'};

    // Collect KPI slides
    const kpiSlides = [1,2,3,4,5,6].map(id => {
      const activeEl  = document.querySelector(`.ss-kpi-active[data-id="${id}"]`);
      const durEl     = document.querySelector(`.ss-kpi-dur[data-id="${id}"]`);
      const ssCfg = el._ssCfg || {};
      const orig  = (ssCfg.slides || []).find(s => s.id === id && s.type === 'kpi') || {};
      return {
        id,
        type: 'kpi',
        scope: orig.scope || SCOPES[id],
        linea: orig.linea || LINEAS[id],
        activo: activeEl ? activeEl.checked : true,
        duracion_seg: durEl && durEl.value ? Number(durEl.value) : null
      };
    });

    // Collect image slides from DOM
    const imgSlides = [];
    document.querySelectorAll('.ss-img-row').forEach(row => {
      const imgId   = row.dataset.imgId;
      const ssCfg   = el._ssCfg || {};
      const orig    = (ssCfg.slides || []).find(s => String(s.id) === String(imgId) && s.type === 'imagen');
      if (!orig) return;
      const titulo   = row.querySelector('.ss-img-titulo')?.value || '';
      const durVal   = row.querySelector('.ss-img-dur')?.value;
      const activo   = row.querySelector('.ss-img-active')?.checked !== false;
      imgSlides.push({
        id:          orig.id,
        type:        'imagen',
        imagen_b64:  orig.imagen_b64,
        titulo,
        duracion_seg: durVal ? Number(durVal) : null,
        activo
      });
    });

    try {
      await PATCH('/slideshow-config', {
        default_duracion_seg: defaultDur,
        slides: [...kpiSlides, ...imgSlides]
      });
      msg.style.color = 'var(--p-success)';
      msg.textContent = '✅ Guardado correctamente';
      setTimeout(() => { msg.textContent = ''; }, 3000);
      await loadSsConfig();
    } catch (e) {
      msg.style.color = 'var(--p-danger)';
      msg.textContent = '⚠️ Error: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = '💾 Guardar configuración pizarrón';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: KPI HISTÓRICO
// ══════════════════════════════════════════════════════════════════════════════

async function viewKpiHistorico(el) {
  const today = new Date().toLocaleDateString('en-CA');
  const lunes = (() => {
    const d = new Date(); const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toLocaleDateString('en-CA');
  })();

  let activeKhTab = 'L3';
  let lastSnaps   = [];

  el.innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn tab-active" data-tab="L3">Línea 3</button>
      <button class="tab-btn" data-tab="L4">Línea 4</button>
      <button class="tab-btn" data-tab="Baker">Baker</button>
    </div>
    <div class="filters-bar">
      <div>
        <span class="flabel">Turno</span>
        <select id="kh-turno">
          <option value="">Todos</option>
          <option value="T1">T1</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
        </select>
      </div>
      <div><span class="flabel">Desde</span><input type="date" id="kh-desde" value="${lunes}"/></div>
      <div><span class="flabel">Hasta</span><input type="date" id="kh-hasta" value="${today}"/></div>
      <button class="btn btn-outline btn-sm" id="kh-buscar">🔍 Buscar</button>
      <button class="btn btn-dark btn-sm" id="kh-export">📥 Excel</button>
    </div>
    <div id="kh-resultado">
      <div class="empty-state"><div class="icon">⏳</div><p>Cargando KPI de la semana...</p></div>
    </div>`;

  el.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      activeKhTab = btn.dataset.tab;
      buscar();
    });
  });

  async function buscar() {
    const params = new URLSearchParams();
    params.set('linea', activeKhTab);
    const turno = document.getElementById('kh-turno').value;
    const desde = document.getElementById('kh-desde').value;
    const hasta = document.getElementById('kh-hasta').value;
    if (turno) params.set('turno', turno);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const res = document.getElementById('kh-resultado');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
    try {
      const data = await GET(`/kpis?${params}`);
      lastSnaps = data?.snapshots || [];
      if (!lastSnaps.length) {
        res.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Sin KPIs guardados para estos filtros.</p></div>';
        return;
      }
      res.innerHTML = renderKpiHistTable(lastSnaps);
    } catch (e) {
      res.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  document.getElementById('kh-buscar').addEventListener('click', buscar);
  buscar();

  document.getElementById('kh-export').addEventListener('click', () => {
    if (!lastSnaps.length) { alert('Primero ejecuta una búsqueda.'); return; }
    const rows = [];
    for (const snap of lastSnaps) {
      for (const s of (snap.slots || [])) {
        rows.push({
          Línea:          snap.linea,
          Fecha:          snap.fecha,
          Semana:         snap.semana,
          Turno:          snap.turno,
          Slot:           s.slot,
          Hora_Inicio:    s.hora_inicio,
          Hora_Fin:       s.hora_fin,
          Ciclos_Totales: s.ciclos_totales,
          Ciclos_Buenos:  s.ciclos_buenos,
          Eficiencia_pct: +(s.eficiencia  * 100).toFixed(1),
          Capacidad_pct:  +(s.capacidad   * 100).toFixed(1),
          Calidad_pct:    +(s.calidad     * 100).toFixed(1),
          Disponibilidad_pct: +(s.disponibilidad * 100).toFixed(1),
          Tiempo_Paro_min: s.paros_min
        });
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `KPI_${activeKhTab}`);
    XLSX.writeFile(wb, `kpi_${activeKhTab}_${today}.xlsx`);
  });
}

function renderKpiHistTable(snaps) {
  const fmtPctR = v => v != null ? (v*100).toFixed(1)+'%' : '—';
  let html = '';
  for (const snap of snaps) {
    html += `
      <div class="table-card" style="margin-bottom:18px">
        <div class="table-header">
          <h3>${snap.linea} · Turno ${snap.turno} · ${snap.fecha} <span style="font-weight:400;font-size:12px;color:var(--p-muted)">Sem ${snap.semana}</span></h3>
          <div style="display:flex;gap:16px;font-size:13px">
            <span>Ciclos: <strong>${snap.ciclos_totales}</strong></span>
            <span>Buenos: <strong>${snap.ciclos_buenos}</strong></span>
            <span>Paros: <strong>${snap.paros_min_total}min</strong></span>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Slot</th><th>Hora</th>
                <th>Ciclos</th><th>Buenos</th>
                <th>Eficiencia</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th><th>T.Paro(min)</th>
              </tr>
            </thead>
            <tbody>
              ${(snap.slots||[]).map(s => `<tr>
                <td style="text-align:center">${s.slot}</td>
                <td class="mono">${s.hora_inicio}–${s.hora_fin}</td>
                <td style="text-align:center;font-weight:700">${s.ciclos_totales}</td>
                <td style="text-align:center">${s.ciclos_buenos}</td>
                <td class="${kpiColor(s.eficiencia*100)}">${fmtPctR(s.eficiencia)}</td>
                <td class="${kpiColor(s.capacidad*100)}">${fmtPctR(s.capacidad)}</td>
                <td class="${kpiColor(s.calidad*100)}">${fmtPctR(s.calidad)}</td>
                <td class="${kpiColor(s.disponibilidad*100)}">${fmtPctR(s.disponibilidad)}</td>
                <td style="text-align:center">${s.paros_min}</td>
              </tr>`).join('')}
              <tr class="totals-row">
                <td colspan="2">TOTAL TURNO</td>
                <td style="text-align:center;font-weight:700">${snap.ciclos_totales}</td>
                <td style="text-align:center">${snap.ciclos_buenos}</td>
                <td class="${kpiColor(snap.eficiencia*100)}">${fmtPctR(snap.eficiencia)}</td>
                <td class="${kpiColor(snap.capacidad*100)}">${fmtPctR(snap.capacidad)}</td>
                <td class="${kpiColor(snap.calidad*100)}">${fmtPctR(snap.calidad)}</td>
                <td class="${kpiColor(snap.disponibilidad*100)}">${fmtPctR(snap.disponibilidad)}</td>
                <td style="text-align:center">${snap.paros_min_total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;
  }
  return html;
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
