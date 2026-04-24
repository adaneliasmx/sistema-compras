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
  _autoParoShown:  { L3: false, L4: false },
  _autoParoLastTs: {},  // { [linea]: lastTs } — timestamp que disparó el último auto-paro
  _autoParoInfo:   {}   // { [linea]: { horaInicio, fechaInicio } } — para "Paro antes de tiempo"
};

// ── Menú por rol ──────────────────────────────────────────────────────────────
const MENU = {
  admin: [
    ['dashboard',      '📊', 'Dashboard'],
    ['linea-3',        '🏭', 'Línea 3'],
    ['linea-4',        '🏭', 'Línea 4'],
    ['linea-baker',    '🔧', 'Baker'],
    ['linea-l1',       '🏭', 'Línea 1'],
    ['reportes',       '📈', 'Reportes'],
    ['paros',          '⏸', 'Paros'],
    ['pizarron',       '📋', 'Pizarrón KPI'],
    ['kpi-historico',  '📊', 'KPI Histórico'],
    ['resumen-turno',  '📑', 'Resumen de Turno'],
    ['monitor',        '📡', 'Monitor en vivo'],
    ['monitor-grafico','📊', 'Monitoreo Gráfico'],
    ['---', '', 'Catálogos'],
    ['catalogos-l3',   '📦', 'Catálogos L3'],
    ['catalogos-l4',   '📦', 'Catálogos L4'],
    ['catalogos-baker','📦', 'Catálogos Baker'],
    ['catalogos-l1',   '📦', 'Catálogos L1'],
    ['operadores',     '👤', 'Operadores'],
    ['configuracion',  '⚙️', 'Configuración']
  ],
  produccion: [
    ['dashboard',      '📊', 'Dashboard'],
    ['linea-3',        '🏭', 'Línea 3'],
    ['linea-4',        '🏭', 'Línea 4'],
    ['linea-baker',    '🔧', 'Baker'],
    ['linea-l1',       '🏭', 'Línea 1'],
    ['pizarron',       '📋', 'Pizarrón KPI'],
    ['resumen-turno',  '📑', 'Resumen de Turno'],
    ['monitor-grafico','📊', 'Monitoreo Gráfico']
  ],
  pizarron: [
    ['pizarron',       '📋', 'Pizarrón KPI'],
    ['resumen-turno',  '📑', 'Resumen de Turno']
  ]
};

const SECTION_TITLES = {
  'dashboard':       'Dashboard de Producción',
  'linea-3':         'Línea 3 — Tarjetero Activo',
  'linea-4':         'Línea 4 — Tarjetero Activo',
  'linea-op':        'Mi Línea — Tarjetero Activo',
  'linea-baker':     'Baker — Tarjetero Activo',
  'linea-l1':        'Línea 1 — Tarjetero Activo',
  'reportes':        'Reportes de Producción',
  'paros':           'Registro de Paros',
  'pizarron':        'Pizarrón KPI',
  'kpi-historico':   'KPI Histórico',
  'resumen-turno':   'Resumen de Turno',
  'monitor':         'Monitor en vivo — L3, L4 y Baker',
  'monitor-grafico': 'Monitoreo Gráfico — Diagrama de Gantt',
  'catalogos-l3':    'Catálogos Línea 3',
  'catalogos-l4':    'Catálogos Línea 4',
  'catalogos-baker': 'Catálogos Baker',
  'catalogos-l1':    'Catálogos Línea 1',
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
  if (state.lineaActiva && state.token && ['produccion', 'admin'].includes(state.user?.role)) {
    // Si el modal de paro automático estaba abierto sin justificar → "Paro antes de tiempo"
    const autoInfo = state._autoParoInfo?.[state.lineaActiva];
    if (autoInfo) {
      try {
        // Hora de fin = el cambio de turno que acaba de ocurrir
        const now = new Date();
        const curMins = now.getHours() * 60 + now.getMinutes();
        // Buscar el fin de turno más cercano (dentro de ±2 min)
        const shiftEnd = SHIFT_ENDS_MINS.find(e => Math.abs(e - curMins) <= 2) ?? curMins;
        const hora_fin = `${String(Math.floor(shiftEnd/60)).padStart(2,'0')}:${String(shiftEnd%60).padStart(2,'0')}`;
        const isBakerLike = state.lineaActiva === 'Baker' || state.lineaActiva === 'L1';
        const bakerLikePath = state.lineaActiva === 'Baker' ? '/baker/paros/antes-de-tiempo' : '/l1/paros/antes-de-tiempo';
        const path     = isBakerLike ? bakerLikePath : `/paros/${state.lineaActiva}/antes-de-tiempo`;
        await fetch('/api/produccion' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
          body: JSON.stringify({ hora_inicio: autoInfo.horaInicio, fecha_inicio: autoInfo.fechaInicio, hora_fin })
        });
      } catch (_) {}
      delete state._autoParoInfo[state.lineaActiva];
    }
    // Registrar paro de cambio de turno
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

// Horas por turno (para calcular objetivo = ciclos/h × horas_turno)
const HORAS_TURNO = { T1: 8, T2: 7, T3: 9 };

// Devuelve el turno correspondiente a una hora tipo "HH:MM"
function getTurnoDeHora(hora) {
  if (!hora) return null;
  const parts = String(hora).split(':');
  const mins  = Number(parts[0]) * 60 + Number(parts[1] || 0);
  if (mins >= 6 * 60 + 30 && mins < 14 * 60 + 30) return 'T1';
  if (mins >= 14 * 60 + 30 && mins < 21 * 60 + 30) return 'T2';
  return 'T3';
}

// Rango de fechas correcto para el turno actual.
// T3 (21:30–06:30+1): antes de las 06:30 el turno inició ayer → fecha_ini = ayer
function getShiftDates() {
  const now   = new Date();
  const mxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const mins  = mxNow.getHours() * 60 + mxNow.getMinutes();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  if (mins < 6 * 60 + 30) {
    // Aún en T3 que arrancó ayer
    const yesterday = new Date(now.getTime() - 86400000);
    return { fecha_ini: yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }), fecha_fin: today };
  }
  return { fecha_ini: today, fecha_fin: today };
}

// Retorna { turno, fecha } del turno inmediatamente anterior al actual
function getPrevTurnoInfo() {
  const now = new Date();
  // Use Mexico City timezone consistently for both time-of-day comparisons and date strings
  const mxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const mins = mxNow.getHours() * 60 + mxNow.getMinutes();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = yest.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
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
    <div class="p-sidebar-overlay" id="pSidebarOverlay" onclick="document.querySelector('.p-sidebar').classList.remove('open');this.classList.remove('open')"></div>
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
        <button class="p-mob-menu-btn" onclick="document.querySelector('.p-sidebar').classList.toggle('open');document.getElementById('pSidebarOverlay').classList.toggle('open')">☰</button>
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
      case 'linea-l1':       await viewL1(el);                break;
      case 'reportes':       await viewReportes(el);          break;
      case 'paros':          await viewParos(el);             break;
      case 'pizarron':       await viewPizarron(el);          break;
      case 'kpi-historico':  await viewKpiHistorico(el);      break;
      case 'resumen-turno':  await viewResumenTurno(el);      break;
      case 'monitor':        await viewMonitor(el);           break;
      case 'monitor-grafico': await viewMonitorGrafico(el);  break;
      case 'catalogos-l3':   await viewCatalogos(el, 'L3');   break;
      case 'catalogos-l4':   await viewCatalogos(el, 'L4');   break;
      case 'catalogos-baker':await viewCatalogos(el, 'baker');break;
      case 'catalogos-l1':   await viewCatalogos(el, 'l1');   break;
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
  // Close on backdrop click (disabled when noClose: true)
  if (!opts.noClose) {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  }
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
          <div class="stat-label">Activas L3</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#dbeafe">🏭</div>
        <div>
          <div class="stat-value">${stats.activas_l4 ?? 0}</div>
          <div class="stat-label">Activas L4</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#fce7f3">🔧</div>
        <div>
          <div class="stat-value">${stats.activas_baker ?? 0}</div>
          <div class="stat-label">Activas Baker</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#dcfce7">✅</div>
        <div>
          <div class="stat-value">${stats.cargas_hoy ?? 0}</div>
          <div class="stat-label">Canastas descargadas hoy</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#e0f2fe">🔄</div>
        <div>
          <div class="stat-value">${stats.cargas_turno ?? 0}</div>
          <div class="stat-label">Descargadas turno ${stats.turno_actual ?? ''}</div>
        </div>
      </div>
    </div>
    <h3 style="font-size:15px;font-weight:800;margin-bottom:12px">Mini Pizarrón KPI</h3>
    ${kpiHtml}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL: Ciclos hora×hora del turno (desde tarjetero)
// ══════════════════════════════════════════════════════════════════════════════

function openModalCiclosHora(lineaLabel, turno, slots, totals) {
  const fmtPctR = v => v != null ? (v * 100).toFixed(1) + '%' : '—';
  const slotsArr = (slots || []).filter(s => s.ciclos_totales > 0 || s.ciclos_obj > 0);

  const rows = slotsArr.map(s => {
    const ef = s.eficiencia != null ? s.eficiencia * 100 : null;
    return `<tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:7px 12px;font-family:monospace;font-size:12px">${s.hora_inicio}–${s.hora_fin}</td>
      <td style="padding:7px 8px;text-align:center;font-weight:700;color:${s.ciclos_totales > 0 ? '#0f172a' : '#94a3b8'}">${s.ciclos_totales}</td>
      <td style="padding:7px 8px;text-align:center;color:#64748b">${s.ciclos_obj ?? '—'}</td>
      <td style="padding:7px 8px;text-align:center" class="${kpiColor(ef)}">${fmtPctR(s.eficiencia)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" style="padding:16px;text-align:center;color:#94a3b8">Sin ciclos registrados en este turno</td></tr>`;

  const ciclosTotal = totals?.ciclos_totales ?? slotsArr.reduce((a, s) => a + (s.ciclos_totales || 0), 0);
  const objTotal    = slotsArr.reduce((a, s) => a + (s.ciclos_obj || 0), 0);
  const efTotal     = totals?.eficiencia;
  const efTotalPct  = efTotal != null ? efTotal * 100 : null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <h3 class="modal-title">📊 ${escHtml(lineaLabel)} — ${escHtml(turno)} · Ciclos por hora</h3>
        <button class="modal-close" id="ciclos-modal-close">✕</button>
      </div>
      <div class="modal-body" style="padding:0;overflow:auto;max-height:60vh">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
              <th style="padding:8px 12px;text-align:left;font-weight:600">Hora</th>
              <th style="padding:8px 8px;text-align:center;font-weight:600">Ciclos</th>
              <th style="padding:8px 8px;text-align:center;font-weight:600">Objetivo</th>
              <th style="padding:8px 8px;text-align:center;font-weight:600">Eficiencia</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:#1e293b;color:#f8fafc;font-weight:700">
              <td style="padding:9px 12px">TOTAL TURNO</td>
              <td style="padding:9px 8px;text-align:center;font-size:15px">${ciclosTotal}</td>
              <td style="padding:9px 8px;text-align:center">${objTotal}</td>
              <td style="padding:9px 8px;text-align:center" class="${kpiColor(efTotalPct)}">${fmtPctR(efTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#ciclos-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
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
    const { fecha_ini: shiftFechaIni, fecha_fin: shiftFechaFin } = getShiftDates();
    const turnoActual = getCurrentTurno();

    // Para el conteo de ciclos necesitamos incluir el día anterior:
    // cargas cargadas en T3 (ayer) pueden descargarse en T1 (hoy).
    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

    const [cargasData, catalogData, parosData, todasHoyData, cfgData, pizarronData] = await Promise.all([
      GET(`/cargas/${linea}/activas`),
      GET(`/catalogos/${linea}`),
      GET(`/paros/${linea}/activo`).catch(() => null),
      GET(`/cargas/${linea}?fecha_ini=${ayer}&fecha_fin=${shiftFechaFin}`).catch(() => []),
      GET('/config').catch(() => ({})),
      GET(`/pizarron?linea=${linea}&turno=${turnoActual}`).catch(() => null)
    ]);

    // Ciclos del turno desde el pizarron (fuente de verdad, igual que KPI pizarrón).
    const todasHoy = Array.isArray(todasHoyData) ? todasHoyData : [];
    const ciclosTurno = pizarronData?.data?.[linea]?.[turnoActual]?.totals?.ciclos_totales ?? 0;
    const cfg = (cfgData?.config || cfgData) ?? {};
    const ciclosObjHora = cfg[`ciclos_objetivo_${linea.toLowerCase()}`] ?? 2;
    const objetivoTurno = Math.round(ciclosObjHora * (HORAS_TURNO[turnoActual] ?? 8));
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
          // Si hay nueva actividad posterior al último auto-paro, resetear el flag
          if (state._autoParoLastTs[linea] && lastTs > state._autoParoLastTs[linea]) {
            state._autoParoShown[linea] = false;
            delete state._autoParoLastTs[linea];
          }
          const minsInactive = (Date.now() - new Date(lastTs).getTime()) / 60000;
          if (minsInactive > 15 && !state._autoParoShown[linea]) {
            state._autoParoShown[linea] = true;
            state._autoParoLastTs[linea] = lastTs; // recordar qué timestamp disparó el paro
            const lastDate = new Date(lastTs);
            const horaIni = lastDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
            const fechaIni = lastDate.toLocaleDateString('en-CA');
            setTimeout(() => openModalParoAuto(linea, catalogo, horaIni, fechaIni, () => {
              // NO resetear _autoParoShown aquí — se resetea solo cuando haya nueva carga
              delete state._autoParoInfo[linea];
              const elActual = document.getElementById('p-content');
              if (elActual) viewLinea(elActual, linea);
            }), 500);
    // Guardar hora de inicio para "Paro antes de tiempo" si no se justifica antes del cambio de turno
    state._autoParoInfo[linea] = { horaInicio: horaIni, fechaInicio: fechaIni };
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
          <div id="btn-ciclos-turno" style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;letter-spacing:.5px;cursor:pointer" title="Ver ciclos hora×hora">
            🔄 ${turnoActual}: <span style="color:${ciclosTurno >= objetivoTurno ? '#4ade80' : '#38bdf8'};font-size:16px">${ciclosTurno}</span><span style="color:#94a3b8;font-size:12px;font-weight:400;margin-left:5px">/ ${objetivoTurno} ciclos</span>
          </div>
          ${paroMiniCard}
          <div class="tarjetero-actions">
            ${!paroActivo ? '<button class="btn btn-danger btn-sm" id="btn-nueva-paro">⏸ Registrar Paro</button>' : ''}
            <button class="btn btn-outline btn-sm" id="btn-carga-vacia">📭 Carga Vacía</button>
            <button class="btn btn-primary" id="btn-nueva-carga">+ Registrar Carga</button>
          </div>
        </div>
      </div>
      ${tarjetasHtml}`;

    // Bind events
    el.querySelector('#btn-ciclos-turno')?.addEventListener('click', () => {
      const slots  = pizarronData?.data?.[linea]?.[turnoActual]?.slots  || [];
      const totals = pizarronData?.data?.[linea]?.[turnoActual]?.totals || {};
      openModalCiclosHora(`Línea ${linea.replace('L', '')}`, turnoActual, slots, totals);
    });

    el.querySelector('#btn-nueva-carga')?.addEventListener('click', () => {
      const pa = state.paroActivo[linea];
      if (pa && pa.tipo !== 'cambio_turno') {
        showCierreParoModal(linea, pa, el, () => openModalCarga(linea, catalogo));
        return;
      }
      openModalCarga(linea, catalogo);
    });

    el.querySelector('#btn-carga-vacia')?.addEventListener('click', () => {
      const pa = state.paroActivo[linea];
      if (pa && pa.tipo !== 'cambio_turno') {
        showCierreParoModal(linea, pa, el, () => openModalCargaVacia(linea, catalogo, () => viewLinea(el, linea)));
        return;
      }
      openModalCargaVacia(linea, catalogo, () => viewLinea(el, linea));
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
    const { fecha_ini: shiftFechaIni, fecha_fin: shiftFechaFin } = getShiftDates();
    const turnoActual = getCurrentTurno();

    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

    const [cargasData, catalogData, paroData, pizarronData, cfgData] = await Promise.all([
      GET('/baker/cargas/activas'),
      GET('/catalogos/baker'),
      GET('/baker/paros/activo').catch(() => null),
      GET(`/pizarron?linea=baker&turno=${turnoActual}`).catch(() => null),
      GET('/config').catch(() => ({}))
    ]);

    const cargas   = Array.isArray(cargasData) ? cargasData : [];
    const catalogo = catalogData || {};
    let paroActivo = paroData?.paro || null;
    const cfg = (cfgData?.config || cfgData) ?? {};
    const planesUrl = cfg.planes_control_baker_url || '';
    // Ciclos del turno desde el pizarron (fuente de verdad, igual que KPI pizarrón).
    const ciclosTurno = pizarronData?.data?.['Baker']?.[turnoActual]?.totals?.ciclos_totales ?? 0;
    const ciclosObjBaker = cfg.ciclos_objetivo_baker ?? 2;
    const objetivoTurno = Math.round(ciclosObjBaker * (HORAS_TURNO[turnoActual] ?? 8));

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
          <div id="btn-ciclos-turno-baker" style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;letter-spacing:.5px;cursor:pointer" title="Ver ciclos hora×hora">
            🔄 ${turnoActual}: <span style="color:${ciclosTurno >= objetivoTurno ? '#4ade80' : '#38bdf8'};font-size:16px">${ciclosTurno}</span><span style="color:#94a3b8;font-size:12px;font-weight:400;margin-left:5px">/ ${objetivoTurno} ciclos</span>
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

    el.querySelector('#btn-ciclos-turno-baker')?.addEventListener('click', () => {
      const slots  = pizarronData?.data?.['Baker']?.[turnoActual]?.slots  || [];
      const totals = pizarronData?.data?.['Baker']?.[turnoActual]?.totals || {};
      openModalCiclosHora('Baker', turnoActual, slots, totals);
    });

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

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: LÍNEA 1 (tarjetero activo) — idéntica a Baker pero con max 8 herramentales
// ══════════════════════════════════════════════════════════════════════════════

async function viewL1(el) {
  clearInterval(state._lineaTimer);
  state._lineaTimer = setInterval(() => {
    const elActual = document.getElementById('p-content');
    if (elActual && state.section === 'linea-l1') viewL1(elActual);
  }, 20000);

  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando Línea 1...</p></div>';
  try {
    const { fecha_ini: shiftFechaIni, fecha_fin: shiftFechaFin } = getShiftDates();
    const turnoActual = getCurrentTurno();

    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

    const [cargasData, catalogData, paroData, pizarronData, cfgData] = await Promise.all([
      GET('/l1/cargas/activas'),
      GET('/catalogos/l1'),
      GET('/l1/paros/activo').catch(() => null),
      GET(`/pizarron?linea=L1&turno=${turnoActual}`).catch(() => null),
      GET('/config').catch(() => ({}))
    ]);

    const cargas   = Array.isArray(cargasData) ? cargasData : [];
    const catalogo = catalogData || {};
    let paroActivo = paroData?.paro || null;
    const cfg = (cfgData?.config || cfgData) ?? {};

    // Ciclos del turno desde el pizarron (fuente de verdad, igual que KPI pizarrón).
    const ciclosTurno = pizarronData?.data?.['L1']?.[turnoActual]?.totals?.ciclos_totales ?? 0;
    const ciclosObjL1 = cfg.ciclos_objetivo_l1 ?? 2;
    const objetivoTurno = Math.round(ciclosObjL1 * (HORAS_TURNO[turnoActual] ?? 8));

    try {
      const prev = getPrevTurnoInfo();
      await POST('/l1/paros/auto-sin-actividad', { fecha: prev.fecha, turno: prev.turno });
    } catch (_) {}

    const MAX_L1 = 8;
    const capacidadBar = `
      <div style="display:flex;align-items:center;gap:8px;background:#f1f5f9;border-radius:8px;padding:6px 14px">
        <span style="font-size:13px;color:#64748b;font-weight:600">Herramentales:</span>
        <span style="font-size:18px;font-weight:800;color:${cargas.length >= MAX_L1 ? '#dc2626' : cargas.length >= 6 ? '#f59e0b' : '#16a34a'}">${cargas.length}/${MAX_L1}</span>
        <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;max-width:80px">
          <div style="width:${(cargas.length/MAX_L1*100).toFixed(0)}%;background:${cargas.length >= MAX_L1 ? '#dc2626' : '#3b82f6'};height:8px;border-radius:4px"></div>
        </div>
      </div>`;

    const paroMiniCard = paroActivo
      ? `<div style="display:flex;align-items:center;gap:8px;background:#fef2f2;border:1.5px solid #dc2626;border-radius:8px;padding:6px 12px">
           <span style="color:#dc2626;font-weight:700;font-size:13px">🔴 PARO ACTIVO</span>
           <span style="font-size:13px;font-weight:600">${escHtml(paroActivo.motivo || '—')}</span>
           <span style="font-size:11px;color:#6b7280">desde ${escHtml(paroActivo.hora_inicio || '')}</span>
           <button class="btn btn-sm btn-primary" id="btn-l1-cerrar-paro" data-id="${paroActivo.id}">✅ Cerrar Paro</button>
         </div>`
      : '';

    const tarjetasHtml = cargas.length === 0
      ? '<div class="empty-state"><div class="icon">📭</div><p>No hay herramentales activos en Línea 1.</p></div>'
      : `<div class="tarjetero-grid">${cargas.map(c => renderTarjetaL1(c)).join('')}</div>`;

    el.innerHTML = `
      <div class="tarjetero-header">
        <h3>Línea 1 — Tarjetero Activo <span class="badge badge-activo">${cargas.length} activos</span></h3>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div id="btn-ciclos-turno-l1" style="background:#1e293b;color:#f8fafc;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;letter-spacing:.5px;cursor:pointer" title="Ver ciclos hora×hora">
            🔄 ${turnoActual}: <span style="color:${ciclosTurno >= objetivoTurno ? '#4ade80' : '#38bdf8'};font-size:16px">${ciclosTurno}</span><span style="color:#94a3b8;font-size:12px;font-weight:400;margin-left:5px">/ ${objetivoTurno} ciclos</span>
          </div>
          ${capacidadBar}
          ${paroMiniCard}
          <div class="tarjetero-actions">
            ${!paroActivo ? '<button class="btn btn-danger btn-sm" id="btn-l1-paro">⏸ Registrar Paro</button>' : ''}
            <button class="btn btn-primary" id="btn-l1-carga"${cargas.length >= MAX_L1 ? ` disabled title="Máx. ${MAX_L1} herramentales activos"` : ''}>+ Registrar Herramental</button>
          </div>
        </div>
      </div>
      ${tarjetasHtml}`;

    el.querySelector('#btn-ciclos-turno-l1')?.addEventListener('click', () => {
      const slots  = pizarronData?.data?.['L1']?.[turnoActual]?.slots  || [];
      const totals = pizarronData?.data?.['L1']?.[turnoActual]?.totals || {};
      openModalCiclosHora('Línea 1', turnoActual, slots, totals);
    });

    el.querySelector('#btn-l1-carga')?.addEventListener('click', () => {
      if (paroActivo) { alert('Cierra el paro activo antes de registrar un herramental.'); return; }
      openModalCargaL1(catalogo, () => viewL1(el));
    });
    el.querySelector('#btn-l1-paro')?.addEventListener('click', () => {
      openModalParoL1(catalogo, () => viewL1(el));
    });
    el.querySelector('#btn-l1-cerrar-paro')?.addEventListener('click', async (ev) => {
      const id = ev.currentTarget.dataset.id;
      try {
        await PATCH(`/l1/paros/${id}/cerrar`, {});
        viewL1(el);
      } catch (e) { alert('Error al cerrar paro: ' + e.message); }
    });
    el.querySelectorAll('[data-l1-descargar]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (paroActivo) { alert('Cierra el paro activo antes de descargar.'); return; }
        const carga = cargas.find(c => String(c.id) === String(btn.dataset.l1Descargar));
        openModalDescargaL1(carga, catalogo, () => viewL1(el));
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="alert alert-warn">⚠️ Error: ${escHtml(e.message)}</div>`;
  }
}

function renderTarjetaL1(c) {
  const esBarril = c.herramental_tipo === 'barril';
  const cavInfo  = esBarril
    ? `<div class="tarjeta-meta-item"><span class="meta-label">Cavidades</span><span class="meta-val">${c.cavidades_cargadas ?? '—'}/${c.herramental_cavidades ?? '—'}</span></div>`
    : `<div class="tarjeta-meta-item"><span class="meta-label">Varillas</span><span class="meta-val">${c.varillas ?? '—'}</span></div>
       <div class="tarjeta-meta-item"><span class="meta-label">Cantidad</span><span class="meta-val">${c.cantidad ?? '—'}</span></div>`;

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
      <button class="btn-descargar" data-l1-descargar="${c.id}">⬇ Descargar</button>
    </div>
  </div>`;
}

// ── Modal: Registrar Herramental Baker / L1 ───────────────────────────────────
function openModalCargaL1(catalogo, onDone) { openModalCargaBaker(catalogo, onDone, 'l1'); }
function openModalDescargaL1(carga, catalogo, onDone) { openModalDescargaBaker(carga, catalogo, onDone, 'l1'); }
function openModalParoL1(catalogo, onDone) { openModalParoBaker(catalogo, onDone, 'l1'); }

function openModalCargaBaker(catalogo, onDone, linea = 'baker') {
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
    <h3>Registrar Herramental — ${linea === 'l1' ? 'Línea 1' : 'Baker'}</h3>
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
        <div class="form-group full" id="bk-vacio-wrap">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;font-weight:600;color:#dc2626">
            <input type="checkbox" id="bk-vacio" style="width:18px;height:18px;accent-color:#dc2626;cursor:pointer" />
            Herramental vacío — sin material (omite datos de componente)
          </label>
        </div>
        <div id="bk-rack-datos" style="display:contents">
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
  // Vacío: mostrar/ocultar campos de datos del rack
  document.getElementById('bk-vacio').addEventListener('change', e => {
    document.getElementById('bk-rack-datos').style.display = e.target.checked ? 'none' : 'contents';
  });

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
    // Resetear vacío al cambiar tipo
    const vacioChk = document.getElementById('bk-vacio');
    if (vacioChk) { vacioChk.checked = false; document.getElementById('bk-rack-datos').style.display = 'contents'; }
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

    const esVacio = tipo === 'rack' && (document.getElementById('bk-vacio')?.checked || false);
    const payload = { herramental_id: herrId, proceso_id: procesoId, sub_proceso_id: subProcesoId, operador_id: operadorId };

    if (tipo === 'rack') {
      payload.es_vacia = esVacio;
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

    // Validar campos requeridos
    const erroresBk = [];
    if (!herrId)        erroresBk.push('Herramental');
    if (!procesoId)     erroresBk.push('Proceso');
    if (!subProcesoId)  erroresBk.push('Sub-proceso');
    if (!operadorId)    erroresBk.push('Operador');

    if (tipo === 'rack' && !esVacio) {
      if (!payload.cliente)                               erroresBk.push('Cliente');
      const compVal = payload.componente_id || payload.componente;
      if (!compVal)                                       erroresBk.push('Componente');
      if (!payload.no_skf)                               erroresBk.push('No. SKF');
      if (!payload.no_orden)                             erroresBk.push('No. Orden');
      if (!payload.varillas)                             erroresBk.push('Varillas (cantidad)');
    }
    if (tipo === 'barril' && Array.isArray(payload.cavidades)) {
      payload.cavidades.forEach((cv, i) => {
        if (!cv.es_vacia) {
          if (!cv.cliente)    erroresBk.push(`Cavidad ${i+1}: Cliente`);
          if (!cv.componente) erroresBk.push(`Cavidad ${i+1}: Componente`);
          if (!cv.no_skf)    erroresBk.push(`Cavidad ${i+1}: No. SKF`);
          if (!cv.no_orden)  erroresBk.push(`Cavidad ${i+1}: No. Orden`);
          if (!cv.cantidad)  erroresBk.push(`Cavidad ${i+1}: Cantidad`);
        }
      });
    }
    if (erroresBk.length) { alert('Campos requeridos:\n• ' + erroresBk.join('\n• ')); return; }

    const btn = document.getElementById('bk-save');
    btn.disabled = true; btn.textContent = 'Registrando...';
    try {
      await POST(`/${linea}/cargas`, payload);
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
function openModalDescargaBaker(carga, catalogo, onDone, linea = 'baker') {
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
    <h3>Descargar Herramental ${linea === 'l1' ? 'L1' : 'Baker'} — ${escHtml(carga.herramental_no || carga.folio)}</h3>
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
        // Validar que cavidades defectuosas tengan motivo de defecto
        const cavsSinMotivo = cavEls.filter(cavEl => {
          const est = cavEl.dataset.estado;
          if (est !== 'defecto' && est !== 'reproceso') return false;
          const defSel = cavEl.querySelector('.bk-cav-defecto-sel');
          return !defSel?.value;
        });
        if (cavsSinMotivo.length > 0) {
          const nums = cavsSinMotivo.map(c => c.dataset.num).join(', ');
          btn.disabled = false; btn.textContent = '⬇ Confirmar Descarga';
          alert(`Selecciona el tipo de defecto para la cavidad ${nums}.`);
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
        await POST(`/${linea}/cargas/${carga.id}/descargar`, { cavidades: cavResultados });
      } else {
        if (!rackEstado) { alert('Selecciona el resultado antes de confirmar.'); btn.disabled = false; btn.textContent = '⬇ Confirmar Descarga'; return; }
        if (rackEstado === 'reproceso') {
          // Crear reproceso directo
          await POST(`/${linea}/cargas/${carga.id}/reprocesar`, {});
          closeModal();
          if (onDone) onDone();
          return;
        }
        const defectoId = rackEstado === 'defecto' ? document.getElementById('bk-rack-defecto').value : null;
        if (rackEstado === 'defecto' && !defectoId) { alert('Selecciona el tipo de defecto.'); btn.disabled = false; btn.textContent = '⬇ Confirmar Descarga'; return; }
        await POST(`/${linea}/cargas/${carga.id}/descargar`, { defecto_id: defectoId || null });
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
function openModalParoBaker(catalogo, onDone, linea = 'baker') {
  const motivos    = (catalogo.motivos_paro || []).filter(m => m.activo !== false);
  const subMotivos = (catalogo.sub_motivos  || []).filter(s => s.activo !== false);
  const htmlMotivos = motivos.map(m => `<option value="${m.id}">${escHtml(m.nombre)}</option>`).join('');

  showModal(`
    <h3>⏸ Registrar Paro — ${linea === 'l1' ? 'Línea 1' : 'Baker'}</h3>
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
      await POST(`/${linea}/paros`, { motivo_id: motivoId, motivo: motivoNom, sub_motivo_id: subId, sub_motivo: subNom });
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
    const payload  = {
      herramental_id:    document.getElementById('mc-herramental').value,
      componente_id:     document.getElementById('mc-componente').value || null,
      es_vacia:          false,
      cliente:           document.getElementById('mc-cliente').value.trim(),
      proceso_id:        document.getElementById('mc-proceso').value || null,
      acabado_id:        document.getElementById('mc-acabado').value || null,
      varillas:          parseInt(document.getElementById('mc-varillas').value) || null,
      piezas_por_varilla: parseInt(document.getElementById('mc-pzs-varilla').value) || null,
      cantidad:          parseInt(document.getElementById('mc-cantidad').textContent) || null,
      operador_id:       document.getElementById('mc-operador').value || null
    };
    // Validar todos los campos requeridos
    const errores = [];
    if (!payload.herramental_id)    errores.push('Herramental');
    if (!payload.componente_id)     errores.push('Componente');
    if (!payload.proceso_id)        errores.push('Proceso');
    if (!payload.acabado_id)        errores.push('Acabado');
    if (!payload.varillas)          errores.push('Varillas');
    if (!payload.piezas_por_varilla) errores.push('Piezas por varilla');
    if (!payload.operador_id)       errores.push('Operador');
    if (errores.length) { alert('Campos requeridos:\n• ' + errores.join('\n• ')); return; }
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

// ── Modal: Carga vacía (sin material) ─────────────────────────────────────────
async function openModalCargaVacia(linea, catalogo, onDone) {
  const herramentales = catalogo.herramentales || [];
  const operadores    = catalogo.operadores    || [];
  const myOp = operadores.find(o =>
    (o.rhh_employee_id && o.rhh_employee_id === state.user?.rhh_employee_id) ||
    (o.compras_user_id && o.compras_user_id === state.user?.id)
  );
  const htmlHerr = herramentales.map(h => `<option value="${h.id}">${escHtml(h.numero)}</option>`).join('');
  const htmlOper = operadores.map(o => `<option value="${o.id}"${o.id===myOp?.id?' selected':''}>${escHtml(o.nombre)}</option>`).join('');

  showModal(`
    <h3>📭 Registrar Carga Vacía — Línea ${linea.replace('L','')}</h3>
    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px">
      La carga vacía suma al conteo de ciclos (eficiencia) pero reduce la capacidad.
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label>Herramental <span style="color:#dc2626">*</span></label>
        <select id="cv-herramental"><option value="">— Seleccionar —</option>${htmlHerr}</select>
      </div>
      <div class="form-group">
        <label>Operador <span style="color:#dc2626">*</span></label>
        <select id="cv-operador"><option value="">— Seleccionar —</option>${htmlOper}</select>
      </div>
      <div class="form-group">
        <label>Varillas <span style="color:#dc2626">*</span></label>
        <select id="cv-varillas"><option value="">— Cantidad —</option>${[...Array(14)].map((_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <label>Piezas por varilla <span style="color:#dc2626">*</span></label>
        <input type="number" id="cv-pzs-varilla" min="1" placeholder="Para cálculo de capacidad" />
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="cv-submit">📭 Registrar Carga Vacía</button>
    </div>`, { size: 'md' });

  // Pre-llenar varillas/pzs desde la última carga con el mismo herramental
  document.getElementById('cv-herramental').addEventListener('change', async function() {
    const herrId = this.value;
    if (!herrId) return;
    try {
      const { fecha_ini, fecha_fin } = getShiftDates();
      const cargas = await GET(`/cargas/${linea}?fecha_ini=${fecha_ini}&fecha_fin=${fecha_fin}`);
      const ultima = [...(Array.isArray(cargas) ? cargas : [])].reverse()
        .find(c => String(c.herramental_id) === String(herrId) && !c.es_vacia);
      if (ultima) {
        if (ultima.varillas) document.getElementById('cv-varillas').value = ultima.varillas;
        if (ultima.piezas_por_varilla) document.getElementById('cv-pzs-varilla').value = ultima.piezas_por_varilla;
      }
    } catch (_) {}
  });

  document.getElementById('cv-submit').addEventListener('click', async () => {
    const herramental_id    = document.getElementById('cv-herramental').value;
    const operador_id       = document.getElementById('cv-operador').value;
    const varillas          = parseInt(document.getElementById('cv-varillas').value) || null;
    const piezas_por_varilla = parseInt(document.getElementById('cv-pzs-varilla').value) || null;
    const errores = [];
    if (!herramental_id)    errores.push('Herramental');
    if (!operador_id)       errores.push('Operador');
    if (!varillas)          errores.push('Varillas');
    if (!piezas_por_varilla) errores.push('Piezas por varilla');
    if (errores.length) { alert('Campos requeridos:\n• ' + errores.join('\n• ')); return; }
    const btn = document.getElementById('cv-submit');
    btn.disabled = true; btn.textContent = 'Registrando...';
    try {
      await POST(`/cargas/${linea}`, {
        herramental_id, operador_id, varillas, piezas_por_varilla,
        es_vacia: true, componente_id: null, componente: null,
        proceso_id: null, acabado_id: null, cantidad: 0, cliente: ''
      });
      closeModal();
      if (onDone) onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = '📭 Registrar Carga Vacía';
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
    if (!defecto_id) { alert('Selecciona el defecto encontrado antes de reprocesar.'); return; }
    try {
      await POST(`/cargas/${linea}/${carga.id}/reprocesar`, { defecto_id, defecto });
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
      <strong>Debes registrar el motivo del paro para continuar.</strong>
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label>Motivo de paro <span style="color:#dc2626">*</span></label>
        <select id="mpa-motivo">
          <option value="">— Seleccionar motivo —</option>
          ${htmlMotivos}
        </select>
      </div>
      <div class="form-group full">
        <label>Sub-motivo <span style="color:#9ca3af;font-size:11px">(opcional)</span></label>
        <select id="mpa-submotivo" disabled>
          <option value="">— Primero selecciona motivo —</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="mpa-submit">⏸ Registrar Paro</button>
    </div>`, { size: 'sm', noClose: true });

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
      const nuevo = await POST(`/paros/${linea}`, { motivo_id, motivo, sub_motivo_id, sub_motivo, fecha_inicio: fechaInicio, hora_inicio: horaInicio });
      await PATCH(`/paros/${linea}/${nuevo.id}/cerrar`, {});
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
  const { fecha_ini: shiftDate } = getShiftDates();
  el.innerHTML = `
    <div class="filters-bar">
      <div>
        <span class="flabel">Línea</span>
        <select id="pz-linea">
          <option value="">Todas</option>
          <option value="L3">Línea 3</option>
          <option value="L4">Línea 4</option>
          <option value="Baker">Baker</option>
          <option value="L1">Línea 1</option>
        </select>
      </div>
      <div>
        <span class="flabel">Fecha</span>
        <input type="date" id="pz-fecha" value="${shiftDate}" />
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
        <button class="btn btn-dark btn-sm" id="pz-export">📥 Exportar Excel</button>
        <button class="btn btn-outline btn-sm" id="pz-migrate-t3" title="Corregir fecha_carga de ciclos T3 cargados entre 00:00-06:29">🔧 Corregir fechas T3</button>` : ''}
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

    document.getElementById('pz-migrate-t3')?.addEventListener('click', async () => {
      const btn = document.getElementById('pz-migrate-t3');
      // Primero hacer dry run para ver cuántos registros se afectarán
      btn.disabled = true; btn.textContent = 'Analizando...';
      try {
        const preview = await POST('/admin/migrate-t3-dates?dry=true', {});
        const n = preview.total_cambios;
        if (n === 0) { alert('✅ No hay registros que corregir. Los datos ya están al día.'); return; }
        const ok = confirm(
          `Se encontraron ${n} carga(s) con fecha_carga incorrecta para T3.\n\n` +
          `Ejemplos:\n${preview.changes.slice(0,5).map(c =>
            `• ${c.tabla} [${c.folio}] ${c.hora_carga} | ${c.fecha_antes} → ${c.fecha_despues}`
          ).join('\n')}\n\n¿Aplicar corrección?`
        );
        if (!ok) return;
        btn.textContent = 'Aplicando...';
        const result = await POST('/admin/migrate-t3-dates?dry=false', {});
        alert(`✅ Corrección aplicada: ${result.total_cambios} registro(s) actualizados.`);
      } catch (e) { alert('Error: ' + e.message); }
      finally { btn.disabled = false; btn.textContent = '🔧 Corregir fechas T3'; }
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
    const now      = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const cBakerNorm = cargasBaker.map(c => ({ ...c, linea: 'Baker' }));
    const todas    = [...cargasL3, ...cargasL4, ...cBakerNorm].sort((a, b) => {
      const ta = `${a.fecha_carga}T${a.hora_carga || '00:00'}`;
      const tb = `${b.fecha_carga}T${b.hora_carga || '00:00'}`;
      return ta > tb ? -1 : ta < tb ? 1 : 0;
    });

    const ciclosL3    = cargasL3.filter(c => c.fecha_descarga && getTurnoDeHora(c.hora_descarga) === turno).length;
    const ciclosL4    = cargasL4.filter(c => c.fecha_descarga && getTurnoDeHora(c.hora_descarga) === turno).length;
    const ciclosBaker = cargasBaker.filter(c => c.fecha_descarga && getTurnoDeHora(c.hora_descarga) === turno).length;

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
    const { fecha_ini, fecha_fin } = getShiftDates();
    const contenedor = document.getElementById('monitor-contenido');
    if (!contenedor) return;
    try {
      const [dL3, dL4, dBaker, paroL3Res, paroL4Res, paroBakerRes] = await Promise.all([
        GET(`/cargas/L3?fecha_ini=${fecha_ini}&fecha_fin=${fecha_fin}`),
        GET(`/cargas/L4?fecha_ini=${fecha_ini}&fecha_fin=${fecha_fin}`),
        GET(`/baker/cargas?fecha_ini=${fecha_ini}&fecha_fin=${fecha_fin}`),
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
      <span style="font-size:12px;color:var(--p-muted)">📡 Auto-actualiza cada 15 seg — Cargas del turno actual (L3 + L4 + Baker)</span>
      <button class="btn btn-outline btn-sm" id="mon-refresh">↻ Actualizar</button>
    </div>
    <div id="monitor-contenido"><div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div></div>`;

  document.getElementById('mon-refresh')?.addEventListener('click', cargarMonitor);

  clearInterval(state._monitorTimer);
  state._monitorTimer = setInterval(cargarMonitor, 15000);
  cargarMonitor();
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: MONITOREO GRÁFICO (Gantt de producción)
// ══════════════════════════════════════════════════════════════════════════════

async function viewMonitorGrafico(el) {
  // ── estado ─────────────────────────────────────────────────────────────────
  let activeTab      = 'L3';
  let allCargas      = [];
  let allParos       = [];
  let ganttData      = [];   // [{type:'carga'|'paro', data}] — índice referenciado por data-gi en SVG
  let semanas        = [];   // [{sem, minFecha, maxFecha, fechas:[]}]
  let selSemana      = '';
  let selFecha       = '';
  let selTurno       = '';
  let showHerr       = true;
  let showParosFlag  = true;
  let zoomLevel      = 1.0;

  // ── shell ──────────────────────────────────────────────────────────────────
  el.innerHTML = `
    <div class="tab-bar" id="mg-tabs">
      <button class="tab-btn tab-active" data-tab="L3">Línea 3</button>
      <button class="tab-btn" data-tab="L4">Línea 4</button>
      <button class="tab-btn" data-tab="Baker">Baker</button>
      <button class="tab-btn" data-tab="L1">Línea 1</button>
    </div>
    <div class="filters-bar" id="mg-filters">
      <div><span class="flabel">Semana</span><select id="mg-semana"><option>Cargando…</option></select></div>
      <div><span class="flabel">Día</span><select id="mg-fecha"><option value="">Todos</option></select></div>
      <div><span class="flabel">Turno</span>
        <select id="mg-turno">
          <option value="">Todos</option><option>T1</option><option>T2</option><option>T3</option>
        </select>
      </div>
      <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;white-space:nowrap">
        <input type="checkbox" id="mg-herr" checked> Herramentales
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;white-space:nowrap">
        <input type="checkbox" id="mg-paros" checked> Paros
      </label>
      <button class="btn btn-outline btn-sm" id="mg-refresh">↻ Actualizar</button>
      <div style="display:flex;align-items:center;gap:4px;margin-left:8px">
        <span style="font-size:11px;color:#64748b;white-space:nowrap">Zoom:</span>
        <button class="btn btn-outline btn-sm" id="mg-zoom-out" style="padding:2px 8px;font-size:15px;font-weight:700">−</button>
        <span id="mg-zoom-lbl" style="font-size:11px;min-width:34px;text-align:center;color:#334155">100%</span>
        <button class="btn btn-outline btn-sm" id="mg-zoom-in"  style="padding:2px 8px;font-size:15px;font-weight:700">+</button>
      </div>
    </div>
    <div id="mg-wrap" style="overflow-x:auto;background:#fff;border:1px solid var(--p-border);border-radius:8px 8px 0 0;min-height:300px">
      <div class="empty-state"><div class="icon">⏳</div><p>Cargando datos…</p></div>
    </div>
    <div id="mg-legend" style="display:flex;gap:14px;padding:7px 12px;font-size:11px;align-items:center;flex-wrap:wrap;border:1px solid var(--p-border);border-top:none;border-radius:0 0 8px 8px;background:#f8fafc">
      <span style="font-weight:600;color:#475569">Leyenda:</span>
      <span style="display:flex;align-items:center;gap:3px"><svg width="18" height="11"><rect width="18" height="9" y="1" fill="#3b82f6" rx="2"/></svg>T1 06:30–14:30</span>
      <span style="display:flex;align-items:center;gap:3px"><svg width="18" height="11"><rect width="18" height="9" y="1" fill="#10b981" rx="2"/></svg>T2 14:30–21:30</span>
      <span style="display:flex;align-items:center;gap:3px"><svg width="18" height="11"><rect width="18" height="9" y="1" fill="#f59e0b" rx="2"/></svg>T3 21:30–06:30</span>
      <span style="display:flex;align-items:center;gap:3px"><svg width="18" height="11"><rect width="18" height="9" y="1" fill="#6366f1" rx="2" opacity=".7"/></svg>Activo</span>
      <span style="display:flex;align-items:center;gap:3px"><svg width="18" height="11"><rect width="18" height="9" y="1" fill="#dc2626" rx="2"/></svg>Paro</span>
      <span style="display:flex;align-items:center;gap:3px"><svg width="18" height="11"><rect width="18" height="9" y="1" fill="#3b82f6" rx="2" stroke="#ef4444" stroke-width="1.5"/><circle cx="15" cy="4" r="2.5" fill="#ef4444"/></svg>Con defecto</span>
      <span style="color:#94a3b8;margin-left:auto;font-size:10px">Clic en barra = detalles completos</span>
    </div>
    <div id="mg-tooltip" style="position:fixed;display:none;z-index:9999;background:#1e293b;color:#f1f5f9;padding:10px 14px;border-radius:8px;font-size:12px;max-width:300px;pointer-events:none;box-shadow:0 4px 24px rgba(0,0,0,.5);line-height:1.7"></div>
  `;

  // ── helpers ────────────────────────────────────────────────────────────────
  const parseTS = (fecha, hora) => {
    if (!fecha) return null;
    try { return new Date(`${fecha}T${hora || '00:00'}:00`).getTime(); } catch { return null; }
  };
  const calcDurMin = (fc, hc, fd, hd) => {
    const s = parseTS(fc, hc), e = parseTS(fd, hd);
    return (s && e) ? Math.round((e - s) / 60000) : null;
  };
  const hasDefecto = c => {
    if (activeTab === 'Baker' || activeTab === 'L1') {
      if (c.herramental_tipo === 'barril')
        return (c.cavidades || []).some(cv => cv.estado === 'defecto' || cv.estado === 'reproceso');
      return c.estado === 'defecto' || !!c.defecto_id;
    }
    return c.estado === 'defecto' || c.estado === 'reproceso' || !!c.defecto_id;
  };
  const T_COLORS = { T1:'#3b82f6', T2:'#10b981', T3:'#f59e0b' };

  // ── carga de datos ─────────────────────────────────────────────────────────
  async function loadData() {
    const wrap = document.getElementById('mg-wrap');
    if (wrap) wrap.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando datos…</p></div>';

    const hasta  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const d60    = new Date(); d60.setDate(d60.getDate() - 60);
    const desde  = d60.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

    try {
      let cP, acP, paP;
      if (activeTab === 'Baker') {
        cP  = GET(`/baker/cargas?fecha_ini=${desde}&fecha_fin=${hasta}`);
        acP = GET('/baker/cargas/activas').catch(() => []);
        paP = GET(`/resumen/paros?linea=Baker&desde=${desde}&hasta=${hasta}`);
      } else if (activeTab === 'L1') {
        cP  = GET(`/l1/cargas?fecha_ini=${desde}&fecha_fin=${hasta}`);
        acP = GET('/l1/cargas/activas').catch(() => []);
        paP = GET(`/resumen/paros?linea=L1&desde=${desde}&hasta=${hasta}`);
      } else {
        cP  = GET(`/cargas/${activeTab}?fecha_ini=${desde}&fecha_fin=${hasta}`);
        acP = GET(`/cargas/${activeTab}/activas`).catch(() => []);
        paP = GET(`/resumen/paros?linea=${activeTab}&desde=${desde}&hasta=${hasta}`);
      }

      const [cargasRaw, activasRaw, parosRes] = await Promise.all([cP, acP, paP]);
      const cargas  = Array.isArray(cargasRaw)  ? cargasRaw  : [];
      const activas = Array.isArray(activasRaw) ? activasRaw : [];

      // Agregar activas sin duplicar
      const seenIds = new Set(cargas.map(c => c.id));
      for (const a of activas) { if (!seenIds.has(a.id)) cargas.push(a); }
      allCargas = cargas;
      allParos  = parosRes?.paros || [];

      // Construir mapa de semanas desde los datos
      const semMap = new Map();
      for (const c of allCargas) {
        const sem = c.semana || ''; if (!sem) continue;
        if (!semMap.has(sem)) semMap.set(sem, { sem, fechas: new Set(), min: c.fecha_carga||'', max: c.fecha_carga||'' });
        const e = semMap.get(sem);
        const fc = c.fecha_carga || '', fd = c.fecha_descarga || '';
        e.fechas.add(fc); if (fd) e.fechas.add(fd);
        if (fc && fc < e.min) e.min = fc;
        if (fc && fc > e.max) e.max = fc;
        if (fd && fd > e.max) e.max = fd;
      }
      semanas = [...semMap.entries()]
        .sort((a, b) => String(b[0]).localeCompare(String(a[0]), undefined, { numeric: true }))
        .map(([, v]) => ({ sem: v.sem, minFecha: v.min, maxFecha: v.max, fechas: [...v.fechas].filter(Boolean).sort() }));

      const semSel = document.getElementById('mg-semana');
      if (semSel) {
        semSel.innerHTML = semanas.length
          ? semanas.map(s => `<option value="${s.sem}">${s.sem}</option>`).join('')
          : '<option value="">Sin datos</option>';
        if (!selSemana || !semanas.find(s => s.sem === selSemana))
          selSemana = semanas[0]?.sem || '';
        semSel.value = selSemana;
      }
      updateFechaDropdown();
      renderGantt();
    } catch (err) {
      const wrap2 = document.getElementById('mg-wrap');
      if (wrap2) wrap2.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(err.message)}</div>`;
    }
  }

  function updateFechaDropdown() {
    const info = semanas.find(s => s.sem === selSemana);
    const sel  = document.getElementById('mg-fecha'); if (!sel) return;
    const opts = info ? info.fechas : [];
    sel.innerHTML = `<option value="">Todos los días</option>` +
      opts.map(f => `<option value="${f}" ${f === selFecha ? 'selected' : ''}>${f}</option>`).join('');
    if (!opts.includes(selFecha)) { selFecha = ''; sel.value = ''; }
  }

  // ── renderizar gantt ───────────────────────────────────────────────────────
  function renderGantt() {
    const wrap = document.getElementById('mg-wrap'); if (!wrap) return;
    ganttData = [];

    // Filtrar cargas
    let cargas = allCargas.filter(c => !selSemana || String(c.semana) === String(selSemana));
    if (selFecha) cargas = cargas.filter(c =>
      c.fecha_carga === selFecha || c.fecha_descarga === selFecha);
    if (selTurno) cargas = cargas.filter(c => {
      if (!c.fecha_descarga) return true;  // activas siempre visibles
      return getTurnoDeHora(c.hora_descarga || c.hora_carga || '06:30') === selTurno;
    });

    // Filtrar paros
    let paros = allParos.filter(p => {
      const info = semanas.find(s => String(s.sem) === String(selSemana));
      if (info && (p.fecha_inicio < info.minFecha || p.fecha_inicio > info.maxFecha)) return false;
      if (selFecha && p.fecha_inicio !== selFecha) return false;
      if (selTurno && p.turno !== selTurno) return false;
      return true;
    });

    // ── rango de tiempo FIJO basado en filtros (no en datos) ─────────────────
    const nowTs = Date.now();
    const HR = 3600000;
    let tMin, tMax;

    if (selFecha && selTurno) {
      // Día + turno específico → solo esas horas
      const base = new Date(selFecha + 'T00:00:00').getTime();
      const turnoBounds = { T1: [6*60+30, 14*60+30], T2: [14*60+30, 21*60+30], T3: [21*60+30, 30*60+30] };
      const [sm, em] = turnoBounds[selTurno] || [0, 24*60];
      tMin = base + sm * 60000;
      tMax = base + em * 60000;
    } else if (selFecha) {
      // Día completo 00:00–24:00
      tMin = new Date(selFecha + 'T00:00:00').getTime();
      tMax = tMin + 24 * HR;
    } else if (selSemana) {
      // Toda la semana: desde el primer al último día registrado
      const info = semanas.find(s => String(s.sem) === String(selSemana));
      if (info && info.minFecha && info.maxFecha) {
        tMin = new Date(info.minFecha + 'T00:00:00').getTime();
        tMax = new Date(info.maxFecha  + 'T00:00:00').getTime() + 24 * HR;
      } else {
        wrap.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Sin datos para la semana seleccionada.</p></div>';
        return;
      }
    } else {
      // Sin filtro → últimos 7 días
      const hoy = new Date(new Date().toLocaleDateString('en-CA', { timeZone:'America/Mexico_City' }) + 'T00:00:00').getTime();
      tMin = hoy - 6 * 24 * HR;
      tMax = hoy + 24 * HR;
    }

    const totalMs = tMax - tMin, totalHours = totalMs / HR;

    // ── dimensiones ──────────────────────────────────────────────────────────
    const LW = 140, RH = 44, HH = 52, BP = 6, BH = RH - BP * 2;
    const cW0  = Math.max((wrap.clientWidth || window.innerWidth - 80) - LW - 16, 300);
    const pxHr = Math.max((cW0 / totalHours) * zoomLevel, 4);
    const CW   = Math.ceil(totalHours * pxHr);
    const SW   = LW + CW + 2;
    const tsX  = ts => LW + ((ts - tMin) / totalMs) * CW;

    // ── agrupar herramentales ─────────────────────────────────────────────────
    const herrMap = new Map();
    for (const c of cargas) {
      const tipo = c.herramental_tipo ? (c.herramental_tipo.charAt(0).toUpperCase() + c.herramental_tipo.slice(1) + ' ') : '';
      const key  = `${tipo}${c.herramental_no || '#' + (c.herramental_id || c.id)}`;
      if (!herrMap.has(key)) herrMap.set(key, []);
      herrMap.get(key).push(c);
    }
    const herrRows = [...herrMap.entries()].sort((a, b) => {
      const ta = Math.min(...a[1].map(c => parseTS(c.fecha_carga, c.hora_carga) || Infinity));
      const tb = Math.min(...b[1].map(c => parseTS(c.fecha_carga, c.hora_carga) || Infinity));
      return ta - tb;
    });

    const paroRow  = showParosFlag && paros.length > 0;
    const herrCnt  = showHerr ? herrRows.length : 0;
    const totRows  = (paroRow ? 1 : 0) + herrCnt;
    // Si no hay filas de datos pero sí hay rango de tiempo, mostrar eje vacío con 1 fila placeholder
    const emptyMsg = (!cargas.length && !paros.length)
      ? 'Sin cargas ni paros en este período'
      : (!showHerr && !showParosFlag) ? 'Activa al menos una capa' : null;
    const drawRows = totRows > 0 ? totRows : 1;

    const SH = HH + drawRows * RH + 4;
    const px = [];  // SVG parts

    // ── fondos de filas ───────────────────────────────────────────────────────
    for (let i = 0; i < drawRows; i++) {
      const fy = HH + i * RH;
      const isP = i === 0 && paroRow;
      px.push(`<rect x="${LW}" y="${fy}" width="${CW}" height="${RH}" fill="${isP ? '#fff5f5' : i % 2 ? '#fff' : '#f8fafc'}"/>`);
    }

    // ── eje de tiempo: días ───────────────────────────────────────────────────
    { let d = new Date(tMin); d.setHours(0, 0, 0, 0);
      while (d.getTime() <= tMax) {
        const x = tsX(d.getTime()), lbl = d.toLocaleDateString('es-MX', { weekday:'short', month:'short', day:'numeric', timeZone:'America/Mexico_City' });
        px.push(`<line x1="${x}" y1="${HH}" x2="${x}" y2="${SH}" stroke="#94a3b8" stroke-width="1" opacity=".4"/>`);
        px.push(`<text x="${x+4}" y="16" font-size="10" fill="#e2e8f0" font-family="sans-serif" font-weight="bold">${escHtml(lbl)}</text>`);
        d.setDate(d.getDate() + 1);
      }
    }

    // ── eje de tiempo: límites de turno ───────────────────────────────────────
    { const shifts = [[6*60+30,'T1','#3b82f6'],[14*60+30,'T2','#10b981'],[21*60+30,'T3','#f59e0b']];
      let d = new Date(tMin); d.setHours(0, 0, 0, 0);
      while (d.getTime() <= tMax) {
        for (const [mins, lbl, col] of shifts) {
          const t = d.getTime() + mins * 60000;
          if (t >= tMin && t <= tMax) {
            const x = tsX(t);
            px.push(`<line x1="${x}" y1="0" x2="${x}" y2="${SH}" stroke="${col}" stroke-width=".8" opacity=".35" stroke-dasharray="4,3"/>`);
            px.push(`<text x="${x+2}" y="30" font-size="9" fill="${col}" font-family="sans-serif">${lbl}</text>`);
            px.push(`<text x="${x+2}" y="42" font-size="8" fill="${col}" font-family="sans-serif" opacity=".8">${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}</text>`);
          }
        }
        d.setDate(d.getDate() + 1);
      }
    }

    // ── ticks de hora ─────────────────────────────────────────────────────────
    { const tInt = totalHours <= 12 ? 1 : totalHours <= 48 ? 2 : totalHours <= 96 ? 4 : 6;
      for (let t = tMin; t <= tMax; t += HR) {
        const d = new Date(t), h = d.getHours(), m = d.getMinutes();
        if (m === 0 && h % tInt === 0) {
          const x = tsX(t);
          px.push(`<line x1="${x}" y1="${HH-6}" x2="${x}" y2="${HH}" stroke="#475569" stroke-width=".8"/>`);
          px.push(`<text x="${x}" y="${HH-8}" text-anchor="middle" font-size="8" fill="#94a3b8" font-family="monospace">${String(h).padStart(2,'0')}h</text>`);
        }
      }
    }

    // ── cabecera oscura (sobre las etiquetas de tiempo) ───────────────────────
    px.push(`<rect x="0" y="0" width="${SW}" height="${HH}" fill="#0f172a"/>`);
    px.push(`<rect x="0" y="0" width="${LW-1}" height="${SH}" fill="#f8fafc"/>`);

    // Redibujar etiquetas de día/turno sobre cabecera
    { let d = new Date(tMin); d.setHours(0, 0, 0, 0);
      while (d.getTime() <= tMax) {
        const x = tsX(d.getTime()), lbl = d.toLocaleDateString('es-MX', { weekday:'short', month:'short', day:'numeric', timeZone:'America/Mexico_City' });
        px.push(`<text x="${x+4}" y="16" font-size="10" fill="#e2e8f0" font-family="sans-serif" font-weight="bold">${escHtml(lbl)}</text>`);
        d.setDate(d.getDate() + 1);
      }
      const shifts = [[6*60+30,'T1','#3b82f6'],[14*60+30,'T2','#10b981'],[21*60+30,'T3','#f59e0b']];
      let d2 = new Date(tMin); d2.setHours(0, 0, 0, 0);
      while (d2.getTime() <= tMax) {
        for (const [mins, lbl, col] of shifts) {
          const t = d2.getTime() + mins * 60000;
          if (t >= tMin && t <= tMax) {
            const x = tsX(t);
            px.push(`<text x="${x+2}" y="30" font-size="9" fill="${col}" font-family="sans-serif">${lbl}</text>`);
            px.push(`<text x="${x+2}" y="42" font-size="8" fill="${col}" font-family="sans-serif" opacity=".8">${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}</text>`);
            px.push(`<line x1="${x}" y1="${HH-6}" x2="${x}" y2="${HH}" stroke="${col}" stroke-width=".6"/>`);
          }
        }
        d2.setDate(d2.getDate() + 1);
      }
      // ticks sobre cabecera
      const tInt = totalHours <= 12 ? 1 : totalHours <= 48 ? 2 : totalHours <= 96 ? 4 : 6;
      for (let t = tMin; t <= tMax; t += HR) {
        const d3 = new Date(t), h = d3.getHours(), m = d3.getMinutes();
        if (m === 0 && h % tInt === 0) {
          const x = tsX(t);
          px.push(`<line x1="${x}" y1="${HH-6}" x2="${x}" y2="${HH}" stroke="#475569" stroke-width=".8"/>`);
          px.push(`<text x="${x}" y="${HH-8}" text-anchor="middle" font-size="8" fill="#94a3b8" font-family="monospace">${String(h).padStart(2,'0')}h</text>`);
        }
      }
    }

    // ── línea "ahora" ─────────────────────────────────────────────────────────
    if (nowTs >= tMin && nowTs <= tMax) {
      const nx = tsX(nowTs);
      px.push(`<line x1="${nx}" y1="0" x2="${nx}" y2="${SH}" stroke="#f97316" stroke-width="1.5" opacity=".9"/>`);
      px.push(`<text x="${nx+3}" y="12" font-size="9" fill="#f97316" font-family="sans-serif">ahora</text>`);
    }

    // ── barras de PAROS ───────────────────────────────────────────────────────
    if (paroRow) {
      const by = HH + BP;
      for (const p of paros) {
        const s = parseTS(p.fecha_inicio, p.hora_inicio);
        const e = p.fecha_fin ? parseTS(p.fecha_fin, p.hora_fin) : nowTs;
        if (!s || e < tMin || s > tMax) continue;
        const x1 = Math.max(tsX(s), LW), x2 = Math.min(tsX(e), LW + CW), bw = Math.max(x2 - x1, 4);
        const gi = ganttData.length; ganttData.push({ type:'paro', data: p });
        const isOpen = !p.fecha_fin;
        px.push(`<rect x="${x1}" y="${by}" width="${bw}" height="${BH}" fill="#dc2626" rx="3" opacity="${isOpen ? '.6' : '.85'}" ${isOpen ? 'stroke="#dc2626" stroke-dasharray="4,2"' : ''} class="mg-bar" data-gi="${gi}" style="cursor:pointer"/>`);
        if (bw > 38) px.push(`<text x="${x1+4}" y="${by+BH/2+4}" font-size="9" fill="white" font-family="sans-serif" pointer-events="none">${escHtml((p.motivo||'').substring(0,20))}</text>`);
      }
    }

    // ── barras de HERRAMENTALES ───────────────────────────────────────────────
    if (showHerr) {
      let ri = paroRow ? 1 : 0;
      for (const [herrName, cargasH] of herrRows) {
        const by = HH + ri * RH + BP;
        for (const c of cargasH) {
          const s = parseTS(c.fecha_carga, c.hora_carga); if (!s) continue;
          const isAct = !c.fecha_descarga;
          const e = isAct ? nowTs : parseTS(c.fecha_descarga, c.hora_descarga);
          if (!e || e < tMin || s > tMax) continue;
          const x1 = Math.max(tsX(s), LW), x2 = Math.min(tsX(e), LW + CW), bw = Math.max(x2 - x1, 4);
          const hRef  = isAct ? (c.hora_carga||'06:30') : (c.hora_descarga||c.hora_carga||'06:30');
          const color = isAct ? '#6366f1' : (T_COLORS[getTurnoDeHora(hRef)] || '#6b7280');
          const def   = hasDefecto(c);
          const gi    = ganttData.length; ganttData.push({ type:'carga', data: { ...c, _herrName: herrName } });
          px.push(`<rect x="${x1}" y="${by}" width="${bw}" height="${BH}" fill="${color}" rx="3" opacity="${isAct ? '.7' : '.88'}" ${isAct ? 'stroke="'+color+'" stroke-dasharray="4,2"' : ''} class="mg-bar" data-gi="${gi}" style="cursor:pointer"/>`);
          if (def) {
            px.push(`<rect x="${x1}" y="${by}" width="${bw}" height="${BH}" fill="none" rx="3" stroke="#ef4444" stroke-width="2" pointer-events="none"/>`);
            if (bw > 8) px.push(`<circle cx="${Math.min(x1+bw-5, LW+CW-5)}" cy="${by+4}" r="3.5" fill="#ef4444" pointer-events="none"/>`);
          }
          if (bw > 55) px.push(`<text x="${x1+4}" y="${by+BH/2+4}" font-size="9" fill="white" font-family="monospace" pointer-events="none">${escHtml(c.folio||'')}</text>`);
        }
        ri++;
      }
    }

    // ── etiquetas eje Y ───────────────────────────────────────────────────────
    { let ri = 0;
      if (paroRow) {
        px.push(`<text x="${LW-8}" y="${HH+ri*RH+RH/2+4}" text-anchor="end" font-size="11" font-weight="bold" fill="#dc2626" font-family="sans-serif">⛔ Paros</text>`);
        ri++;
      }
      if (showHerr) {
        for (const [herrName] of herrRows) {
          px.push(`<text x="${LW-8}" y="${HH+ri*RH+RH/2+4}" text-anchor="end" font-size="11" fill="#1e293b" font-family="monospace">${escHtml(herrName)}</text>`);
          ri++;
        }
      }
    }

    // ── mensaje vacío centrado si no hay datos ────────────────────────────────
    if (emptyMsg) {
      const mx = LW + CW / 2, my = HH + drawRows * RH / 2;
      px.push(`<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="#94a3b8" font-family="sans-serif">${escHtml(emptyMsg)}</text>`);
    }

    // separador Y + líneas de fila
    px.push(`<line x1="${LW}" y1="0" x2="${LW}" y2="${SH}" stroke="#334155" stroke-width="1.5"/>`);
    for (let i = 0; i <= drawRows; i++)
      px.push(`<line x1="0" y1="${HH+i*RH}" x2="${SW}" y2="${HH+i*RH}" stroke="#e2e8f0" stroke-width=".5"/>`);

    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" id="mg-svg" width="${SW}" height="${SH}" style="display:block">${px.join('')}</svg>`;

    // ── tooltip + clic ────────────────────────────────────────────────────────
    const tooltip = document.getElementById('mg-tooltip');
    const svg     = wrap.querySelector('#mg-svg');

    const getBar = e => { let t = e.target; while (t && t !== svg) { if (t.dataset?.gi !== undefined) return t; t = t.parentElement; } return null; };

    svg.addEventListener('mousemove', e => {
      const bar = getBar(e); if (!bar) { tooltip.style.display = 'none'; return; }
      const item = ganttData[Number(bar.dataset.gi)]; if (!item) return;
      tooltip.innerHTML = tooltipHtml(item);
      tooltip.style.display = 'block';
      tooltip.style.left = Math.min(e.clientX + 16, window.innerWidth - 310) + 'px';
      tooltip.style.top  = Math.min(e.clientY - 8,  window.innerHeight - 220) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    svg.addEventListener('click', e => { const bar = getBar(e); if (bar) { tooltip.style.display = 'none'; showModal(ganttData[Number(bar.dataset.gi)]); } });
  }

  // ── tooltip html ───────────────────────────────────────────────────────────
  function tooltipHtml(item) {
    if (item.type === 'paro') {
      const p = item.data;
      return `<div style="font-weight:700;color:#fca5a5;margin-bottom:4px">⛔ Paro de línea</div>
        <div>Motivo: <b>${escHtml(p.motivo||'-')}</b></div>
        ${p.sub_motivo ? `<div>Sub-motivo: ${escHtml(p.sub_motivo)}</div>` : ''}
        <div>Inicio: ${escHtml(p.fecha_inicio)} ${escHtml(p.hora_inicio)}</div>
        <div>Fin: ${escHtml(p.fecha_fin||'—')} ${escHtml(p.hora_fin||'')}</div>
        <div>Duración: <b>${p.duracion_min||'?'} min</b></div>
        <div>Turno: ${escHtml(p.turno||'-')}</div>
        ${!p.fecha_fin ? '<div style="color:#fca5a5">⚠ Paro abierto</div>' : ''}
        <div style="color:#64748b;font-size:10px;margin-top:3px">Clic = detalle</div>`;
    }
    const c = item.data, isAct = !c.fecha_descarga;
    const dur = isAct ? 'en proceso…' : (calcDurMin(c.fecha_carga, c.hora_carga, c.fecha_descarga, c.hora_descarga) + ' min');
    return `<div style="font-weight:700;color:#93c5fd;margin-bottom:4px">🏭 ${escHtml(c._herrName||c.herramental_no||'-')}</div>
      <div>Folio: <b>${escHtml(c.folio||'-')}</b></div>
      ${c.componente ? `<div>Componente: ${escHtml(c.componente)}</div>` : ''}
      <div>Operador: ${escHtml(c.operador||'-')}</div>
      <div>Carga: ${escHtml(c.fecha_carga)} ${escHtml(c.hora_carga)}</div>
      <div>Descarga: ${escHtml(c.fecha_descarga||'—')} ${escHtml(c.hora_descarga||'')}</div>
      <div>Duración: <b>${dur}</b></div>
      <div>Turno: ${escHtml(c.turno||'-')}</div>
      ${hasDefecto(c) ? '<div style="color:#fca5a5">⚠ Con defecto</div>' : ''}
      ${isAct ? '<div style="color:#a5b4fc">🔵 Activo en línea</div>' : ''}
      <div style="color:#64748b;font-size:10px;margin-top:3px">Clic = detalle</div>`;
  }

  // ── modal de detalle ───────────────────────────────────────────────────────
  function showModal(item) {
    if (!item) return;
    let body;
    if (item.type === 'paro') {
      const p = item.data;
      body = `<div style="padding:20px 24px;max-width:460px;width:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;font-size:16px;color:#dc2626">⛔ Detalle de Paro</h3>
          <button id="mgmc" style="background:none;border:none;font-size:22px;cursor:pointer;line-height:1;color:#6b7280">×</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
          <div><span style="color:#6b7280;font-size:11px">Folio</span><br><b>${escHtml(p.folio||'-')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Turno</span><br><b>${escHtml(p.turno||'-')}</b></div>
          <div style="grid-column:1/-1"><span style="color:#6b7280;font-size:11px">Motivo</span><br><b>${escHtml(p.motivo||'-')}</b></div>
          ${p.sub_motivo?`<div style="grid-column:1/-1"><span style="color:#6b7280;font-size:11px">Sub-motivo</span><br><b>${escHtml(p.sub_motivo)}</b></div>`:''}
          <div><span style="color:#6b7280;font-size:11px">Inicio</span><br><b>${escHtml(p.fecha_inicio||'')} ${escHtml(p.hora_inicio||'')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Fin</span><br><b>${escHtml(p.fecha_fin||'—')} ${escHtml(p.hora_fin||'')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Duración</span><br><b>${p.duracion_min||'?'} min</b></div>
          <div><span style="color:#6b7280;font-size:11px">Estado</span><br><b style="color:${!p.fecha_fin?'#dc2626':'#16a34a'}">${!p.fecha_fin?'Abierto':'Cerrado'}</b></div>
        </div>
      </div>`;
    } else {
      const c = item.data;
      const dur = c.fecha_descarga ? calcDurMin(c.fecha_carga, c.hora_carga, c.fecha_descarga, c.hora_descarga) : null;
      let cavsHtml = '';
      if ((activeTab === 'Baker' || activeTab === 'L1') && c.herramental_tipo === 'barril' && Array.isArray(c.cavidades) && c.cavidades.length) {
        const SC = { buena:'#16a34a', defecto:'#dc2626', vacia:'#9ca3af', reproceso:'#f59e0b' };
        const SB = { buena:'#f0fff4', defecto:'#fef2f2', vacia:'#f9fafb', reproceso:'#fffbeb' };
        cavsHtml = `<div style="margin-top:14px;border-top:1px solid #e5e7eb;padding-top:12px">
          <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px">Cavidades del barril</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px">
            ${c.cavidades.map(cv=>`<div style="padding:5px 8px;border-radius:6px;font-size:11px;border:1px solid ${cv.estado==='defecto'?'#fca5a5':cv.estado==='reproceso'?'#fde68a':cv.estado==='vacia'?'#e5e7eb':'#bbf7d0'};background:${SB[cv.estado]||'#f8fafc'}">
              <b style="color:${SC[cv.estado]||'#6b7280'}">Cav. ${cv.num}</b> — ${cv.estado||'—'}
              ${cv.defecto?`<br><span style="color:#dc2626;font-size:10px">${escHtml(cv.defecto)}</span>`:''}
            </div>`).join('')}
          </div>
        </div>`;
      }
      body = `<div style="padding:20px 24px;max-width:500px;width:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;font-size:16px">🏭 Detalle de Carga</h3>
          <button id="mgmc" style="background:none;border:none;font-size:22px;cursor:pointer;line-height:1;color:#6b7280">×</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
          <div><span style="color:#6b7280;font-size:11px">Folio</span><br><b>${escHtml(c.folio||'-')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Herramental</span><br><b>${escHtml(c._herrName||c.herramental_no||'-')}</b></div>
          ${c.componente?`<div><span style="color:#6b7280;font-size:11px">Componente</span><br><b>${escHtml(c.componente)}</b></div>`:''}
          ${c.cliente?`<div><span style="color:#6b7280;font-size:11px">Cliente</span><br><b>${escHtml(c.cliente)}</b></div>`:''}
          <div><span style="color:#6b7280;font-size:11px">Operador</span><br><b>${escHtml(c.operador||'-')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Turno</span><br><b>${escHtml(c.turno||'-')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Carga</span><br><b>${escHtml(c.fecha_carga||'')} ${escHtml(c.hora_carga||'')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Descarga</span><br><b>${escHtml(c.fecha_descarga||'—')} ${escHtml(c.hora_descarga||'')}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Duración</span><br><b>${dur != null ? dur+' min' : '🔵 En proceso'}</b></div>
          <div><span style="color:#6b7280;font-size:11px">Estado</span><br><b style="color:${c.estado==='defecto'?'#dc2626':!c.fecha_descarga?'#6366f1':'#16a34a'}">${escHtml(c.estado||'-')}</b></div>
          ${c.proceso?`<div><span style="color:#6b7280;font-size:11px">Proceso</span><br><b>${escHtml(c.proceso)}</b></div>`:''}
          ${c.acabado?`<div><span style="color:#6b7280;font-size:11px">Acabado</span><br><b>${escHtml(c.acabado)}</b></div>`:''}
          ${c.semana?`<div><span style="color:#6b7280;font-size:11px">Semana</span><br><b>${escHtml(c.semana)}</b></div>`:''}
          ${c.defecto?`<div style="grid-column:1/-1"><span style="color:#6b7280;font-size:11px">Defecto</span><br><b style="color:#dc2626">${escHtml(c.defecto)}</b></div>`:''}
          ${c.cantidad!=null?`<div><span style="color:#6b7280;font-size:11px">Cantidad</span><br><b>${c.cantidad}</b></div>`:''}
        </div>
        ${cavsHtml}
      </div>`;
    }
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `<div style="background:#fff;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.3);overflow-y:auto;max-height:90vh">${body}</div>`;
    document.body.appendChild(ov);
    ov.querySelector('#mgmc').onclick = () => ov.remove();
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
  }

  // ── bindings ───────────────────────────────────────────────────────────────
  el.querySelectorAll('#mg-tabs .tab-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      el.querySelectorAll('#mg-tabs .tab-btn').forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      activeTab = btn.dataset.tab;
      allCargas = []; allParos = []; selSemana = ''; selFecha = '';
      loadData();
    })
  );
  el.querySelector('#mg-semana')?.addEventListener('change', e => { selSemana = e.target.value; selFecha = ''; updateFechaDropdown(); renderGantt(); });
  el.querySelector('#mg-fecha')?.addEventListener('change',  e => { selFecha  = e.target.value; renderGantt(); });
  el.querySelector('#mg-turno')?.addEventListener('change',  e => { selTurno  = e.target.value; renderGantt(); });
  el.querySelector('#mg-herr')?.addEventListener('change',   e => { showHerr      = e.target.checked; renderGantt(); });
  el.querySelector('#mg-paros')?.addEventListener('change',  e => { showParosFlag = e.target.checked; renderGantt(); });
  el.querySelector('#mg-refresh')?.addEventListener('click', () => loadData());

  const updateZoomLbl = () => {
    const lbl = el.querySelector('#mg-zoom-lbl');
    if (lbl) lbl.textContent = Math.round(zoomLevel * 100) + '%';
  };
  el.querySelector('#mg-zoom-in')?.addEventListener('click', () => {
    zoomLevel = Math.min(zoomLevel * 1.5, 20);
    updateZoomLbl(); renderGantt();
  });
  el.querySelector('#mg-zoom-out')?.addEventListener('click', () => {
    zoomLevel = Math.max(zoomLevel / 1.5, 0.1);
    updateZoomLbl(); renderGantt();
  });

  loadData();
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: REPORTES
// ══════════════════════════════════════════════════════════════════════════════

async function viewReportes(el) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  let activeRptTab = 'L3';
  let allCargas    = [];   // raw fetched cargas / racks
  let allCavidades = [];   // raw fetched cavidades_baker

  el.innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn tab-active" data-tab="L3">Línea 3</button>
      <button class="tab-btn" data-tab="L4">Línea 4</button>
      <button class="tab-btn" data-tab="Baker">Baker</button>
      <button class="tab-btn" data-tab="L1">Línea 1</button>
    </div>
    <div class="filters-bar">
      <div><span class="flabel">Desde</span><input type="date" id="rpt-desde" value="${today}"/></div>
      <div><span class="flabel">Hasta</span><input type="date" id="rpt-hasta" value="${today}"/></div>
      <button class="btn btn-outline btn-sm" id="rpt-buscar">🔍 Consultar</button>
      <button class="btn btn-dark btn-sm" id="rpt-export">📥 Excel</button>
    </div>
    <div id="rpt-filtros-extra" style="display:none;padding:0 0 12px">
      <div class="filters-bar" style="background:var(--p-bg-card);border:1px solid var(--p-border);border-radius:8px;padding:10px 16px;gap:12px;flex-wrap:wrap;margin:0">
        <div><span class="flabel">Turno</span>
          <select id="rf-turno"><option value="">Todos</option><option value="T1">T1</option><option value="T2">T2</option><option value="T3">T3</option></select>
        </div>
        <div><span class="flabel">Operador</span><select id="rf-operador"><option value="">Todos</option></select></div>
        <div><span class="flabel">Herramental</span><select id="rf-herramental"><option value="">Todos</option></select></div>
        <div><span class="flabel">Proceso</span><select id="rf-proceso"><option value="">Todos</option></select></div>
        <div><span class="flabel">Defecto</span>
          <select id="rf-defecto">
            <option value="">Todos</option>
            <option value="con">Solo con defecto</option>
            <option value="sin">Solo sin defecto</option>
          </select>
        </div>
      </div>
    </div>
    <div id="rpt-resultado">
      <div class="empty-state"><div class="icon">📈</div><p>Selecciona el rango de fechas y consulta.</p></div>
    </div>`;

  el.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      activeRptTab = btn.dataset.tab;
      allCargas = []; allCavidades = [];
      document.getElementById('rpt-filtros-extra').style.display = 'none';
      document.getElementById('rpt-resultado').innerHTML =
        '<div class="empty-state"><div class="icon">📈</div><p>Consulta los datos de la línea seleccionada.</p></div>';
    });
  });

  // ── Filter helpers ────────────────────────────────────────────────────────
  function uniqVals(arr, field) {
    return [...new Set(arr.map(x => x[field]).filter(Boolean))].sort();
  }

  function populateSelect(id, values) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todos</option>' +
      values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }

  function populateFilters(cargas, cavs) {
    const pool = [...cargas, ...cavs];
    populateSelect('rf-operador',    uniqVals(pool, 'operador'));
    populateSelect('rf-herramental', uniqVals(pool, 'herramental_no'));
    populateSelect('rf-proceso',     uniqVals(pool, 'proceso'));
    document.getElementById('rpt-filtros-extra').style.display = 'block';
  }

  function getF() {
    return {
      turno:       document.getElementById('rf-turno')?.value       || '',
      operador:    document.getElementById('rf-operador')?.value    || '',
      herramental: document.getElementById('rf-herramental')?.value || '',
      proceso:     document.getElementById('rf-proceso')?.value     || '',
      defecto:     document.getElementById('rf-defecto')?.value     || ''
    };
  }

  function hasDefecto(c) {
    return !!(c.defecto_id || c.defecto || c.estado === 'defecto' || c.resultado === 'defecto');
  }

  function fltItem(c, f) {
    if (f.turno       && c.turno       !== f.turno)       return false;
    if (f.operador    && c.operador    !== f.operador)     return false;
    if (f.herramental && c.herramental_no !== f.herramental) return false;
    if (f.proceso     && c.proceso     !== f.proceso)     return false;
    if (f.defecto === 'con' && !hasDefecto(c)) return false;
    if (f.defecto === 'sin' &&  hasDefecto(c)) return false;
    return true;
  }

  function applyFilters() {
    const f = getF();
    renderResult(allCargas.filter(c => fltItem(c, f)), allCavidades.filter(c => fltItem(c, f)));
  }

  // React to filter dropdowns
  el.addEventListener('change', e => {
    if (['rf-turno','rf-operador','rf-herramental','rf-proceso','rf-defecto'].includes(e.target.id)) {
      applyFilters();
    }
  });

  // ── Badge helpers ─────────────────────────────────────────────────────────
  function rptResultBadge(c) {
    const est = c.resultado || c.estado || '';
    if (est === 'buena' || est === 'descargado') return `<span class="badge badge-activo">Buena</span>`;
    if (est === 'defecto')   return `<span class="badge badge-defecto">Defecto${c.defecto ? ': ' + escHtml(c.defecto) : ''}</span>`;
    if (est === 'reproceso') return `<span class="badge badge-warn">Reproceso</span>`;
    if (est === 'vacia')     return `<span class="badge" style="background:#e2e8f0;color:#64748b">Vacía</span>`;
    return `<span class="badge badge-activo">${escHtml(est || 'activo')}</span>`;
  }

  function rptTipoLabel(c) {
    return c.es_reproceso ? '<span class="badge badge-warn" style="font-size:10px">Reproceso</span>'
                          : '<span class="badge badge-procesado" style="font-size:10px">Proceso</span>';
  }

  function rowStyle(c) {
    return hasDefecto(c) ? ' style="background:rgba(239,68,68,.07)"' : '';
  }

  // ── Summary bar ───────────────────────────────────────────────────────────
  function renderSummaryBar(items) {
    const total  = items.length;
    const conDef = items.filter(hasDefecto).length;
    const pct    = total > 0 ? ((conDef / total) * 100).toFixed(1) : '0.0';
    const color  = conDef > 0 ? '#ef4444' : 'inherit';
    return `<div style="display:flex;gap:20px;margin-bottom:12px;padding:10px 16px;background:var(--p-bg-card);border-radius:8px;border:1px solid var(--p-border);font-size:13px;flex-wrap:wrap">
      <span>Total: <strong>${total}</strong></span>
      <span>Con defecto: <strong style="color:${color}">${conDef}</strong></span>
      <span>% Defecto: <strong style="color:${color}">${pct}%</strong></span>
    </div>`;
  }

  // ── Tabla principal L3/L4 ─────────────────────────────────────────────────
  function renderTablaLinea(cargas, linea, isAdmin) {
    if (!cargas.length) return '<div class="empty-state"><div class="icon">📋</div><p>Sin registros para este período / filtros.</p></div>';
    return `
      ${renderSummaryBar(cargas)}
      <div class="table-card">
        <div class="table-header">
          <h3>Reporte — ${escHtml(linea)}</h3>
          <span class="badge badge-activo">${cargas.length} registros</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Folio</th><th>Turno</th><th>F. Carga</th><th>Hr Carga</th><th>F. Descarga</th><th>Hr Descarga</th>
              <th>Herramental</th><th>Componente</th><th>Cantidad</th>
              <th>Proceso</th><th>Sub-proceso</th><th>Operador</th>
              <th>Resultado / Defecto</th><th>Tipo</th>
              ${isAdmin ? '<th>Acciones</th>' : ''}
            </tr></thead>
            <tbody>
              ${cargas.map(c => `<tr data-carga-id="${c.id}" style="${hasDefecto(c)?'background:rgba(239,68,68,.07);':''}cursor:${isAdmin?'pointer':'default'}">
                <td class="mono">${escHtml(c.folio || c.id)}</td>
                <td style="text-align:center">${escHtml(c.turno || '—')}</td>
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
                ${isAdmin ? `<td style="white-space:nowrap"><button class="btn btn-sm" style="padding:2px 8px;font-size:11px;background:#ef4444;color:#fff;border:none" data-del-carga="${c.id}" title="Eliminar registro">🗑</button></td>` : ''}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${isAdmin ? '<p style="font-size:11px;color:var(--p-muted);padding:8px 16px;margin:0">Doble clic en una fila para editar</p>' : ''}
      </div>`;
  }

  // ── Tabla cavidades Baker ─────────────────────────────────────────────────
  function renderTablaCavidades(cavs, isAdmin) {
    if (!cavs.length) return '';
    const label = activeRptTab === 'L1' ? 'L1' : 'Baker';
    return `
      <div class="table-card" style="margin-top:18px">
        <div class="table-header">
          <h3>${label} — Barriles por cavidad</h3>
          <span class="badge badge-activo">${cavs.length} cavidades</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Folio Barril</th><th>Cav.</th><th>Turno</th><th>F. Carga</th><th>Hr Carga</th><th>F. Descarga</th><th>Hr Descarga</th>
              <th>Herramental</th><th>Componente</th><th>No. SKF</th><th>Cantidad</th>
              <th>Proceso</th><th>Operador</th>
              <th>Resultado / Defecto</th>
              ${isAdmin ? '<th>Acciones</th>' : ''}
            </tr></thead>
            <tbody>
              ${cavs.map(c => `<tr data-cav-id="${c.id}" style="${hasDefecto(c)?'background:rgba(239,68,68,.07);':''}cursor:${isAdmin?'pointer':'default'}">
                <td class="mono">${escHtml(c.folio_barril || '—')}</td>
                <td style="text-align:center;font-weight:700">${c.cavidad_num ?? '—'}</td>
                <td style="text-align:center">${escHtml(c.turno || '—')}</td>
                <td>${escHtml(c.fecha_carga || '—')}</td>
                <td class="mono">${escHtml(c.hora_carga || '—')}</td>
                <td>${escHtml(c.fecha_descarga || '—')}</td>
                <td class="mono">${escHtml(c.hora_descarga || '—')}</td>
                <td>${escHtml(c.herramental_no || '—')}</td>
                <td>${escHtml(c.componente || '—')}</td>
                <td class="mono">${escHtml(c.no_skf || '—')}</td>
                <td style="text-align:right;font-weight:700">${c.cantidad ?? '—'}</td>
                <td>${escHtml(c.proceso || '—')}</td>
                <td>${escHtml(c.operador || '—')}</td>
                <td>${rptResultBadge(c)}</td>
                ${isAdmin ? `<td style="white-space:nowrap"><button class="btn btn-sm" style="padding:2px 8px;font-size:11px;background:#ef4444;color:#fff;border:none" data-del-cav="${c.id}" title="Eliminar cavidad">🗑</button></td>` : ''}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${isAdmin ? '<p style="font-size:11px;color:var(--p-muted);padding:8px 16px;margin:0">Doble clic en una fila para editar</p>' : ''}
      </div>`;
  }

  // ── Análisis de defectos (genérico: L3/L4 usa cargas, Baker usa cavidades) ──
  function renderAnalisisDefectos(items, titulo) {
    const conDatos = items.filter(c => hasDefecto(c) || c.estado === 'buena' || c.resultado === 'buena');
    if (!conDatos.length) return '';

    const total  = items.length;
    const buenas  = items.filter(c => c.estado === 'buena' || c.resultado === 'buena').length;
    const defecto = items.filter(hasDefecto).length;
    const vacias  = items.filter(c => c.es_vacia || c.estado === 'vacia').length;
    const activas = total - vacias;
    const calidad = activas > 0 ? ((buenas / activas) * 100).toFixed(1) : null;

    // Por tipo de defecto
    const byDef = {};
    for (const c of items.filter(hasDefecto)) {
      const k = c.defecto || 'Sin especificar';
      byDef[k] = (byDef[k] || 0) + 1;
    }

    // Por componente
    const byComp = {};
    for (const c of items.filter(x => !x.es_vacia && x.estado !== 'vacia')) {
      const k = c.componente || 'Sin componente';
      if (!byComp[k]) byComp[k] = { buenas: 0, defecto: 0 };
      if (c.estado === 'buena' || c.resultado === 'buena') byComp[k].buenas++;
      if (hasDefecto(c)) byComp[k].defecto++;
    }

    // Por operador
    const byOp = {};
    for (const c of items) {
      const k = c.operador || 'Sin operador';
      if (!byOp[k]) byOp[k] = { total: 0, buenas: 0, defecto: 0 };
      byOp[k].total++;
      if (c.estado === 'buena' || c.resultado === 'buena') byOp[k].buenas++;
      if (hasDefecto(c)) byOp[k].defecto++;
    }

    // Por herramental
    const byHerr = {};
    for (const c of items) {
      const k = c.herramental_no || 'Desconocido';
      if (!byHerr[k]) byHerr[k] = { total: 0, buenas: 0, defecto: 0 };
      byHerr[k].total++;
      if (c.estado === 'buena' || c.resultado === 'buena') byHerr[k].buenas++;
      if (hasDefecto(c)) byHerr[k].defecto++;
    }

    function calRow(b, d) {
      const t = b + d; const p = t > 0 ? ((b / t) * 100).toFixed(1) : null;
      return `<td class="${kpiColor(p ? Number(p) : null)}">${p !== null ? p+'%' : '—'}</td>`;
    }
    function defCell(n) {
      return `<td style="text-align:center;${n>0?'color:#ef4444;font-weight:700':''}">${n}</td>`;
    }

    const defRows  = Object.entries(byDef).sort((a,b)=>b[1]-a[1])
      .map(([k,v])=>`<tr><td>${escHtml(k)}</td><td style="text-align:center;font-weight:700;color:#ef4444">${v}</td><td style="text-align:center">${total>0?((v/total)*100).toFixed(1):0}%</td></tr>`).join('');
    const compRows = Object.entries(byComp).sort((a,b)=>(b[1].defecto-a[1].defecto))
      .map(([k,v])=>`<tr><td>${escHtml(k)}</td><td style="text-align:center">${v.buenas}</td>${defCell(v.defecto)}${calRow(v.buenas,v.defecto)}</tr>`).join('');
    const opRows   = Object.entries(byOp).sort((a,b)=>(b[1].defecto-a[1].defecto))
      .map(([k,v])=>`<tr><td>${escHtml(k)}</td><td style="text-align:center">${v.total}</td><td style="text-align:center">${v.buenas}</td>${defCell(v.defecto)}${calRow(v.buenas,v.defecto)}</tr>`).join('');
    const herrRows = Object.entries(byHerr).sort((a,b)=>(b[1].defecto-a[1].defecto))
      .map(([k,v])=>`<tr><td>${escHtml(k)}</td><td style="text-align:center">${v.total}</td><td style="text-align:center">${v.buenas}</td>${defCell(v.defecto)}${calRow(v.buenas,v.defecto)}</tr>`).join('');

    if (!defecto) return '';   // sin defectos, no mostrar panel

    return `
      <div class="table-card" style="margin-top:18px;border:2px solid rgba(239,68,68,.25)">
        <div class="table-header" style="background:rgba(239,68,68,.06)">
          <h3>🔍 Análisis de Defectos — ${escHtml(titulo)}</h3>
          <div style="display:flex;gap:20px;font-size:13px;flex-wrap:wrap">
            <span>Total: <strong>${total}</strong></span>
            <span>Buenas: <strong style="color:#22c55e">${buenas}</strong></span>
            <span>Con defecto: <strong style="color:#ef4444">${defecto}</strong></span>
            ${vacias ? `<span>Vacías: <strong>${vacias}</strong></span>` : ''}
            <span>Calidad: <strong class="${kpiColor(calidad ? Number(calidad) : null)}">${calidad !== null ? calidad+'%' : '—'}</strong></span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px">
          <div>
            <h4 style="margin:0 0 8px;font-size:12px;color:var(--p-muted);text-transform:uppercase;letter-spacing:.05em">Por tipo de defecto</h4>
            <div class="table-scroll"><table>
              <thead><tr><th>Defecto</th><th>Cant.</th><th>% Total</th></tr></thead>
              <tbody>${defRows || '<tr><td colspan="3" style="text-align:center;color:var(--p-muted)">Sin defectos</td></tr>'}</tbody>
            </table></div>
          </div>
          <div>
            <h4 style="margin:0 0 8px;font-size:12px;color:var(--p-muted);text-transform:uppercase;letter-spacing:.05em">Por componente</h4>
            <div class="table-scroll"><table>
              <thead><tr><th>Componente</th><th>Buenas</th><th>Defecto</th><th>Calidad</th></tr></thead>
              <tbody>${compRows || '<tr><td colspan="4" style="text-align:center;color:var(--p-muted)">Sin datos</td></tr>'}</tbody>
            </table></div>
          </div>
          <div>
            <h4 style="margin:0 0 8px;font-size:12px;color:var(--p-muted);text-transform:uppercase;letter-spacing:.05em">Por operador</h4>
            <div class="table-scroll"><table>
              <thead><tr><th>Operador</th><th>Total</th><th>Buenas</th><th>Defecto</th><th>Calidad</th></tr></thead>
              <tbody>${opRows || '<tr><td colspan="5" style="text-align:center;color:var(--p-muted)">Sin datos</td></tr>'}</tbody>
            </table></div>
          </div>
          <div>
            <h4 style="margin:0 0 8px;font-size:12px;color:var(--p-muted);text-transform:uppercase;letter-spacing:.05em">Por herramental</h4>
            <div class="table-scroll"><table>
              <thead><tr><th>Herramental</th><th>Total</th><th>Buenas</th><th>Defecto</th><th>Calidad</th></tr></thead>
              <tbody>${herrRows || '<tr><td colspan="5" style="text-align:center;color:var(--p-muted)">Sin datos</td></tr>'}</tbody>
            </table></div>
          </div>
        </div>
      </div>`;
  }

  // ── Render result (orquesta las secciones) ────────────────────────────────
  function renderResult(cargas, cavs) {
    const isAdmin = state.user?.role === 'admin';
    const res = document.getElementById('rpt-resultado');
    if (activeRptTab === 'Baker' || activeRptTab === 'L1') {
      const racks = cargas.filter(c => c.herramental_tipo !== 'barril');
      const lineaLabel = activeRptTab === 'L1' ? 'L1' : 'Baker';
      res.innerHTML = renderTablaLinea(racks, `${lineaLabel} — Racks`, isAdmin)
                    + renderTablaCavidades(cavs, isAdmin)
                    + renderAnalisisDefectos(cavs, `${lineaLabel} Barriles`);
    } else {
      const label = activeRptTab === 'L3' ? 'Línea 3' : 'Línea 4';
      res.innerHTML = renderTablaLinea(cargas, label, isAdmin)
                    + renderAnalisisDefectos(cargas, label);
    }

    if (!isAdmin) return;

    // ── Dblclick en fila de carga → abrir modal de edición ────────────────
    res.querySelectorAll('tr[data-carga-id]').forEach(tr => {
      tr.addEventListener('dblclick', () => {
        const id = tr.dataset.cargaId;
        const carga = [...allCargas].find(c => String(c.id) === String(id));
        if (carga) openRptCargaModal(carga, ejecutarConsulta);
      });
    });

    // ── Dblclick en fila de cavidad → abrir modal de edición ─────────────
    res.querySelectorAll('tr[data-cav-id]').forEach(tr => {
      tr.addEventListener('dblclick', () => {
        const id = tr.dataset.cavId;
        const cav = [...allCavidades].find(c => String(c.id) === String(id));
        if (cav) openRptCavidadModal(cav, ejecutarConsulta);
      });
    });

    // ── Botón eliminar carga ──────────────────────────────────────────────
    res.querySelectorAll('[data-del-carga]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('¿Eliminar este registro de carga? Esta acción no se puede deshacer.')) return;
        const id = btn.dataset.delCarga;
        try {
          await DEL(`/cargas/${id}`);
          await ejecutarConsulta();
        } catch (err) { alert('Error al eliminar: ' + err.message); }
      });
    });

    // ── Botón eliminar cavidad ────────────────────────────────────────────
    res.querySelectorAll('[data-del-cav]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('¿Eliminar este registro de cavidad? Esta acción no se puede deshacer.')) return;
        const id = btn.dataset.delCav;
        try {
          await DEL(`/cavidades/${id}`);
          await ejecutarConsulta();
        } catch (err) { alert('Error al eliminar: ' + err.message); }
      });
    });
  }

  // ── Modal edición carga (admin) ───────────────────────────────────────────
  function openRptCargaModal(carga, onSaved) {
    const estados = ['activo','buena','defecto','reproceso','vacia','cancelado'];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal" style="max-width:540px">
        <div class="modal-header">
          <h3 class="modal-title">✏️ Editar Carga — ${escHtml(carga.folio || carga.id)}</h3>
          <button class="modal-close" id="rpt-modal-close">✕</button>
        </div>
        <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label>Turno</label>
            <select id="rm-turno" class="form-control">
              <option value="">—</option>
              ${['T1','T2','T3'].map(t=>`<option value="${t}" ${carga.turno===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Estado / Resultado</label>
            <select id="rm-estado" class="form-control">
              ${estados.map(s=>`<option value="${s}" ${(carga.estado||carga.resultado)===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Fecha Carga</label>
            <input type="date" id="rm-fecha-carga" class="form-control" value="${carga.fecha_carga||''}"/>
          </div>
          <div class="form-group"><label>Hora Carga</label>
            <input type="time" id="rm-hora-carga" class="form-control" value="${carga.hora_carga||''}"/>
          </div>
          <div class="form-group"><label>Fecha Descarga</label>
            <input type="date" id="rm-fecha-descarga" class="form-control" value="${carga.fecha_descarga||''}"/>
          </div>
          <div class="form-group"><label>Hora Descarga</label>
            <input type="time" id="rm-hora-descarga" class="form-control" value="${carga.hora_descarga||''}"/>
          </div>
          <div class="form-group"><label>Herramental No.</label>
            <input type="text" id="rm-herramental" class="form-control" value="${escHtml(carga.herramental_no||carga.herramental||'')}"/>
          </div>
          <div class="form-group"><label>Componente</label>
            <input type="text" id="rm-componente" class="form-control" value="${escHtml(carga.componente||'')}"/>
          </div>
          <div class="form-group"><label>Proceso</label>
            <input type="text" id="rm-proceso" class="form-control" value="${escHtml(carga.proceso||'')}"/>
          </div>
          <div class="form-group"><label>Operador</label>
            <input type="text" id="rm-operador" class="form-control" value="${escHtml(carga.operador||'')}"/>
          </div>
          <div class="form-group"><label>Cantidad</label>
            <input type="number" id="rm-cantidad" class="form-control" value="${carga.cantidad??''}"/>
          </div>
          <div class="form-group"><label>Defecto</label>
            <input type="text" id="rm-defecto" class="form-control" value="${escHtml(carga.defecto||'')}"/>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="rpt-modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="rpt-modal-save">💾 Guardar cambios</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#rpt-modal-close').addEventListener('click', close);
    overlay.querySelector('#rpt-modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#rpt-modal-save').addEventListener('click', async () => {
      const estadoVal = overlay.querySelector('#rm-estado').value;
      const body = {
        turno:          overlay.querySelector('#rm-turno').value,
        estado:         estadoVal,
        resultado:      estadoVal,
        fecha_carga:    overlay.querySelector('#rm-fecha-carga').value,
        hora_carga:     overlay.querySelector('#rm-hora-carga').value,
        fecha_descarga: overlay.querySelector('#rm-fecha-descarga').value || null,
        hora_descarga:  overlay.querySelector('#rm-hora-descarga').value || null,
        herramental_no: overlay.querySelector('#rm-herramental').value,
        componente:     overlay.querySelector('#rm-componente').value || null,
        proceso:        overlay.querySelector('#rm-proceso').value || null,
        operador:       overlay.querySelector('#rm-operador').value || null,
        cantidad:       overlay.querySelector('#rm-cantidad').value !== '' ? Number(overlay.querySelector('#rm-cantidad').value) : null,
        defecto:        overlay.querySelector('#rm-defecto').value || null,
      };
      try {
        await PATCH(`/cargas/${carga.id}/admin-editar`, body);
        close();
        await onSaved();
      } catch (err) { alert('Error al guardar: ' + err.message); }
    });
  }

  // ── Modal edición cavidad Baker/L1 (admin) ────────────────────────────────
  function openRptCavidadModal(cav, onSaved) {
    const estados = ['buena','defecto','vacia'];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3 class="modal-title">✏️ Editar Cavidad — ${escHtml(cav.folio_barril||'')} Cav.${cav.cavidad_num??''}</h3>
          <button class="modal-close" id="rpt-cav-close">✕</button>
        </div>
        <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label>Estado / Resultado</label>
            <select id="rc-estado" class="form-control">
              ${estados.map(s=>`<option value="${s}" ${(cav.estado||cav.resultado)===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Cantidad</label>
            <input type="number" id="rc-cantidad" class="form-control" value="${cav.cantidad??''}"/>
          </div>
          <div class="form-group"><label>Operador</label>
            <input type="text" id="rc-operador" class="form-control" value="${escHtml(cav.operador||'')}"/>
          </div>
          <div class="form-group"><label>Defecto</label>
            <input type="text" id="rc-defecto" class="form-control" value="${escHtml(cav.defecto||'')}"/>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="rpt-cav-cancel">Cancelar</button>
          <button class="btn btn-primary" id="rpt-cav-save">💾 Guardar cambios</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#rpt-cav-close').addEventListener('click', close);
    overlay.querySelector('#rpt-cav-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#rpt-cav-save').addEventListener('click', async () => {
      const estadoVal = overlay.querySelector('#rc-estado').value;
      const body = {
        estado:    estadoVal,
        resultado: estadoVal,
        defecto:   overlay.querySelector('#rc-defecto').value || null,
        cantidad:  overlay.querySelector('#rc-cantidad').value !== '' ? Number(overlay.querySelector('#rc-cantidad').value) : null,
        operador:  overlay.querySelector('#rc-operador').value || null,
      };
      try {
        await PATCH(`/cavidades/${cav.id}/admin-editar`, body);
        close();
        await onSaved();
      } catch (err) { alert('Error al guardar: ' + err.message); }
    });
  }

  // ── Consulta al servidor ──────────────────────────────────────────────────
  async function ejecutarConsulta() {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const res   = document.getElementById('rpt-resultado');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
    try {
      const params = new URLSearchParams({ linea: activeRptTab });
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);

      if (activeRptTab === 'Baker' || activeRptTab === 'L1') {
        const cavsEndpoint = activeRptTab === 'L1' ? '/l1/cavidades' : '/baker/cavidades';
        const [cargasData, cavsData] = await Promise.all([
          GET(`/reportes?${params}`),
          GET(`${cavsEndpoint}?fecha_ini=${desde}&fecha_fin=${hasta}`)
        ]);
        allCargas    = cargasData?.cargas || cargasData || [];
        allCavidades = Array.isArray(cavsData) ? cavsData : [];
      } else {
        const data   = await GET(`/reportes?${params}`);
        allCargas    = data?.cargas || data || [];
        allCavidades = [];
      }
      populateFilters(allCargas, allCavidades);
      applyFilters();
    } catch (e) {
      res.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  document.getElementById('rpt-buscar').addEventListener('click', ejecutarConsulta);

  document.getElementById('rpt-export').addEventListener('click', () => {
    if (!allCargas.length && !allCavidades.length) { alert('Primero consulta los datos.'); return; }
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const f   = getF();
    const flt = c => fltItem(c, f);
    const wb  = XLSX.utils.book_new();
    if (activeRptTab === 'Baker' || activeRptTab === 'L1') {
      const lineaLabel = activeRptTab === 'L1' ? 'L1' : 'Baker';
      const racks = allCargas.filter(c => c.herramental_tipo !== 'barril').filter(flt);
      const cavs  = allCavidades.filter(flt);
      if (racks.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(racks), `${lineaLabel} Racks`);
      if (cavs.length)  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cavs),  `${lineaLabel} Barriles`);
    } else {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allCargas.filter(flt)), activeRptTab);
    }
    XLSX.writeFile(wb, `reporte_${activeRptTab}_${desde}_${hasta}.xlsx`);
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
  const isBakerLike = linea === 'baker' || linea === 'l1';
  const tabs = isBakerLike ? BAKER_CATALOG_TABS : CATALOG_TABS;
  let activeTab = isBakerLike ? 'clientes' : 'componentes';
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
    const showClienteFilter = isBakerLike && activeTab === 'componentes';
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

    el.querySelectorAll('[data-toggle-excluir]').forEach(btn => {
      const id = btn.dataset.toggleExcluir;
      btn.addEventListener('click', async () => {
        const item = items.find(i => String(i.id) === String(id));
        const newVal = !(item?.excluir_calidad);
        try {
          await PATCH(`/catalogos/${linea}/herramentales/${id}`, { excluir_calidad: newVal });
          loadAndRender();
        } catch (e) { alert('Error: ' + e.message); }
      });
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
    herramentales: ['numero', 'nombre', 'descripcion', 'excluir_calidad'],
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
    colsMap.herramentales = ['numero', 'tipo', 'varillas_totales', 'cavidades', 'descripcion', 'excluir_calidad'];
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
    varillas_totales:     'Varillas totales',
    excluir_calidad:      'KPI Calidad'
  };

  // Render especial para excluir_calidad: mostrar badge
  const colRenderers = {
    excluir_calidad: (val) => val
      ? '<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600">⚠ Excluido</span>'
      : '<span style="color:var(--p-muted);font-size:11px">—</span>'
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
          ${cols.map(c => `<td>${colRenderers[c] ? colRenderers[c](item[c]) : escHtml(item[c] ?? '')}</td>`).join('')}
          <td style="white-space:nowrap">
            <button class="btn btn-outline btn-xs" data-edit-cat="${item.id}">✏️ Editar</button>
            ${tipo === 'herramentales' ? `<button class="btn btn-xs" data-toggle-excluir="${item.id}" style="margin-left:4px;${item.excluir_calidad ? 'background:#fef3c7;color:#92400e;border:1px solid #f59e0b' : 'background:#f0fdf4;color:#166534;border:1px solid #86efac'}">${item.excluir_calidad ? '⚠ Excluido KPI' : '✓ KPI Calidad'}</button>` : ''}
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
               inp('cavidades', 'Cavidades totales (si barril)', 'number') +
               `<div class="form-group" style="display:flex;align-items:center;gap:8px;margin-top:4px">
                 <input type="checkbox" id="cf-excluir_calidad" ${item?.excluir_calidad ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer"/>
                 <label for="cf-excluir_calidad" style="margin:0;cursor:pointer;font-size:13px">Excluir del KPI de calidad <span style="color:var(--p-muted);font-size:12px">(defecto contemplado)</span></label>
               </div>`;
      }
      return inp('numero', 'No. Herramental') +
             inp('nombre', 'Nombre') +
             inp('descripcion', 'Descripción') +
             `<div class="form-group" style="display:flex;align-items:center;gap:8px;margin-top:4px">
               <input type="checkbox" id="cf-excluir_calidad" ${item?.excluir_calidad ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer"/>
               <label for="cf-excluir_calidad" style="margin:0;cursor:pointer;font-size:13px">Excluir del KPI de calidad <span style="color:var(--p-muted);font-size:12px">(defecto contemplado)</span></label>
             </div>`;
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
    case 'herramentales': {
      const excluirCalidad = document.getElementById('cf-excluir_calidad')?.checked === true;
      return { numero: g('numero'), nombre: g('nombre'), descripcion: g('descripcion'), tipo: g('tipo') || undefined, cavidades: g('cavidades') || null, varillas_totales: g('varillas_totales') || null, excluir_calidad: excluirCalidad };
    }
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
    let operadoresL3 = [], operadoresL4 = [], operadoresBaker = [], operadoresL1 = [], usuariosSistema = [];
    try {
      const [dL3, dL4, dBaker, dL1, dUsers] = await Promise.all([
        GET('/operadores/L3'),
        GET('/operadores/L4'),
        GET('/operadores/baker'),
        GET('/operadores/l1'),
        GET('/usuarios-sistema')
      ]);
      operadoresL3    = Array.isArray(dL3)    ? dL3    : (dL3?.operadores    || []);
      operadoresL4    = Array.isArray(dL4)    ? dL4    : (dL4?.operadores    || []);
      operadoresBaker = Array.isArray(dBaker) ? dBaker : (dBaker?.operadores || []);
      operadoresL1    = Array.isArray(dL1)    ? dL1    : (dL1?.operadores    || []);
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
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
        <div class="table-card">
          <div class="table-header">
            <h3>Línea 1</h3>
            <button class="btn btn-primary btn-sm" data-nuevo-op="l1">+ Agregar</button>
          </div>
          <div class="table-scroll">${tableHtml(operadoresL1, 'l1')}</div>
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
          <option value="L1">Línea 1</option>
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
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        ${row('cfg-ciclos-l3','Línea 3', n('ciclos_objetivo_l3',2), 'ciclos/hr')}
        ${row('cfg-ciclos-l4','Línea 4', n('ciclos_objetivo_l4',2), 'ciclos/hr')}
        ${row('cfg-ciclos-baker','Baker',  n('ciclos_objetivo_baker',2), 'ciclos/hr')}
        ${row('cfg-ciclos-l1','Línea 1', n('ciclos_objetivo_l1',2), 'ciclos/hr')}
      </div>

      <h4 style="margin-top:24px">Objetivos KPI (%)</h4>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="text-align:left;color:var(--p-muted)">
            <th style="padding:6px 10px">KPI</th>
            <th style="padding:6px 10px">Línea 3 (%)</th>
            <th style="padding:6px 10px">Línea 4 (%)</th>
            <th style="padding:6px 10px">Baker (%)</th>
            <th style="padding:6px 10px">L1 (%)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:6px 10px">Eficiencia</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-ef-l3" value="${n('eficiencia_obj_l3',85)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-ef-l4" value="${n('eficiencia_obj_l4',85)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-ef-baker" value="${n('eficiencia_obj_baker',85)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-ef-l1" value="${n('eficiencia_obj_l1',85)}" min="0" max="100" style="width:80px"/></td>
          </tr>
          <tr>
            <td style="padding:6px 10px">Capacidad</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cap-l3" value="${n('capacidad_obj_l3',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cap-l4" value="${n('capacidad_obj_l4',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cap-baker" value="${n('capacidad_obj_baker',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cap-l1" value="${n('capacidad_obj_l1',90)}" min="0" max="100" style="width:80px"/></td>
          </tr>
          <tr>
            <td style="padding:6px 10px">Calidad</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cal-l3" value="${n('calidad_obj_l3',95)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cal-l4" value="${n('calidad_obj_l4',95)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cal-baker" value="${n('calidad_obj_baker',95)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-cal-l1" value="${n('calidad_obj_l1',95)}" min="0" max="100" style="width:80px"/></td>
          </tr>
          <tr>
            <td style="padding:6px 10px">Disponibilidad</td>
            <td style="padding:6px 10px"><input type="number" id="cfg-dis-l3" value="${n('disponibilidad_obj_l3',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-dis-l4" value="${n('disponibilidad_obj_l4',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-dis-baker" value="${n('disponibilidad_obj_baker',90)}" min="0" max="100" style="width:80px"/></td>
            <td style="padding:6px 10px"><input type="number" id="cfg-dis-l1" value="${n('disponibilidad_obj_l1',90)}" min="0" max="100" style="width:80px"/></td>
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
    </div>

    <div class="form-card config-section" style="margin-top:24px">
      <h3>Base de Datos</h3>
      <p style="font-size:13px;color:var(--p-muted);margin:0 0 16px">Descarga una copia completa de todos los registros de producción (cargas, paros, catálogos, configuración).</p>
      <button class="btn btn-outline" id="cfg-backup-btn">📥 Descargar Backup de BD</button>
      <span id="cfg-backup-msg" style="margin-left:12px;font-size:13px"></span>
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
        ciclos_objetivo_l1:    g('cfg-ciclos-l1'),
        eficiencia_obj_l3:     g('cfg-ef-l3'),
        eficiencia_obj_l4:     g('cfg-ef-l4'),
        eficiencia_obj_baker:  g('cfg-ef-baker'),
        eficiencia_obj_l1:     g('cfg-ef-l1'),
        capacidad_obj_l3:      g('cfg-cap-l3'),
        capacidad_obj_l4:      g('cfg-cap-l4'),
        capacidad_obj_baker:   g('cfg-cap-baker'),
        capacidad_obj_l1:      g('cfg-cap-l1'),
        calidad_obj_l3:        g('cfg-cal-l3'),
        calidad_obj_l4:        g('cfg-cal-l4'),
        calidad_obj_baker:     g('cfg-cal-baker'),
        calidad_obj_l1:        g('cfg-cal-l1'),
        disponibilidad_obj_l3: g('cfg-dis-l3'),
        disponibilidad_obj_l4: g('cfg-dis-l4'),
        disponibilidad_obj_baker: g('cfg-dis-baker'),
        disponibilidad_obj_l1: g('cfg-dis-l1'),
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

  document.getElementById('cfg-backup-btn').addEventListener('click', async () => {
    const btn = document.getElementById('cfg-backup-btn');
    const msg = document.getElementById('cfg-backup-msg');
    btn.disabled = true; btn.textContent = 'Descargando...';
    try {
      const res = await fetch('/api/produccion/backup', {
        headers: { Authorization: `Bearer ${state.token}` }
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const cd   = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="(.+?)"/);
      a.href     = url;
      a.download = match ? match[1] : 'produccion-backup.json';
      a.click();
      URL.revokeObjectURL(url);
      msg.style.color = 'var(--p-success)';
      msg.textContent = '✅ Descarga iniciada';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch (e) {
      msg.style.color = 'var(--p-danger)';
      msg.textContent = '⚠️ Error: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = '📥 Descargar Backup de BD';
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
      <button class="tab-btn" data-tab="L1">Línea 1</button>
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
    const bkLike = snap.linea === 'Baker' || snap.linea === 'L1';
    html += `
      <div class="table-card" style="margin-bottom:18px">
        <div class="table-header">
          <h3>${snap.linea} · Turno ${snap.turno} · ${snap.fecha} <span style="font-weight:400;font-size:12px;color:var(--p-muted)">Sem ${snap.semana}</span></h3>
          <div style="display:flex;gap:16px;font-size:13px">
            <span>Ciclos: <strong>${snap.ciclos_totales}</strong></span>
            ${bkLike ? `<span>Cav. Tot.: <strong>${snap.ciclos_no_vacios}</strong></span>` : ''}
            <span>${bkLike ? 'Cav. Buenas' : 'Buenos'}: <strong>${snap.ciclos_buenos}</strong></span>
            <span>Paros: <strong>${snap.paros_min_total}min</strong></span>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Slot</th><th>Hora</th>
                <th>Ciclos</th>${bkLike ? '<th>Cav. Tot.</th>' : ''}<th>${bkLike ? 'Cav. Buenas' : 'Buenos'}</th>
                <th>Eficiencia</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th><th>T.Paro(min)</th>
              </tr>
            </thead>
            <tbody>
              ${(snap.slots||[]).map(s => `<tr>
                <td style="text-align:center">${s.slot}</td>
                <td class="mono">${s.hora_inicio}–${s.hora_fin}</td>
                <td style="text-align:center;font-weight:700">${s.ciclos_totales}</td>
                ${bkLike ? `<td style="text-align:center">${s.ciclos_no_vacios}</td>` : ''}
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
                ${bkLike ? `<td style="text-align:center">${snap.ciclos_no_vacios}</td>` : ''}
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
// RESUMEN DE TURNO — helpers de semana ISO
// ══════════════════════════════════════════════════════════════════════════════

function getISOWeekFE(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { week: Math.ceil((((date - yearStart) / 86400000) + 1) / 7), year: date.getUTCFullYear() };
}

function getISOWeekRangeFE(week, year) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const w1Mon = new Date(jan4);
  w1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const mon = new Date(w1Mon);
  mon.setUTCDate(w1Mon.getUTCDate() + (week - 1) * 7);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { desde: mon.toISOString().slice(0, 10), hasta: sun.toISOString().slice(0, 10) };
}

function renderHBarChart(items, colorFn) {
  if (!items.length) return '<div class="p-muted" style="font-size:12px;padding:8px">Sin datos</div>';
  const max = Math.max(...items.map(d => d.value), 1);
  return `<div style="display:flex;flex-direction:column;gap:4px">${items.map(d => `
    <div style="display:flex;align-items:center;gap:6px">
      <div style="width:140px;font-size:11px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0" title="${escHtml(d.label)}">${escHtml(d.label)}</div>
      <div style="flex:1;background:#f3f4f6;border-radius:2px;height:18px;min-width:60px">
        <div style="width:${(d.value / max * 100).toFixed(1)}%;background:${colorFn ? colorFn(d) : '#3b82f6'};height:100%;border-radius:2px"></div>
      </div>
      <div style="width:60px;font-size:11px;font-weight:600;text-align:right">${d.label2 !== undefined ? d.label2 : d.value}</div>
    </div>`).join('')}</div>`;
}

async function showDefectosDrilldown(linea, desde, hasta, turno) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:700px;max-width:96vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0;font-size:16px">🔍 Detalle de Defectos — ${escHtml(linea)}</h3>
      <button id="closeDefModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">×</button>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px">${desde} al ${hasta}${turno ? ' · Turno ' + turno : ''}</p>
    <div id="defModalBody"><div style="text-align:center;padding:24px;color:#6b7280">⏳ Cargando...</div></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeDefModal').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  try {
    const params = new URLSearchParams({ desde, hasta, linea });
    if (turno) params.set('turno', turno);
    const data = await GET('/resumen/defectos?' + params);
    const defs = data.defectos || [];
    if (!defs.length) {
      overlay.querySelector('#defModalBody').innerHTML = '<div style="text-align:center;padding:24px;color:#16a34a;font-weight:600">Sin defectos registrados en este período ✅</div>';
      return;
    }
    const defConteo = {};
    defs.forEach(d => { defConteo[d.defecto] = (defConteo[d.defecto] || 0) + 1; });
    const defPareto = Object.entries(defConteo).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
    overlay.querySelector('#defModalBody').innerHTML = `
      <div style="margin-bottom:16px">
        <h4 style="font-size:13px;margin:0 0 8px;color:#374151">Conteo por tipo de defecto (${defs.length} total)</h4>
        ${renderHBarChart(defPareto, () => '#ef4444')}
      </div>
      <h4 style="font-size:13px;margin:0 0 8px;color:#374151">Ciclos / Cavidades con defecto</h4>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Fecha</th>
          <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Turno</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Herramental</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Operador</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Motivo de rechazo</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Detalle</th>
        </tr></thead>
        <tbody>${defs.map(d => `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:5px 8px">${escHtml(d.fecha)}</td>
          <td style="padding:5px 8px;text-align:center;font-weight:600">${escHtml(d.turno)}</td>
          <td style="padding:5px 8px">${escHtml(d.herramental)}</td>
          <td style="padding:5px 8px">${escHtml(d.operador)}</td>
          <td style="padding:5px 8px;color:#dc2626;font-weight:600">${escHtml(d.defecto)}</td>
          <td style="padding:5px 8px;color:#6b7280;font-size:11px">${escHtml(d.detalle || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  } catch (e) {
    overlay.querySelector('#defModalBody').innerHTML = `<div style="color:#dc2626;padding:16px">Error: ${escHtml(e.message)}</div>`;
  }
}

async function showParetoParo(linea, desde, hasta, tituloExtra, turno = '') {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:620px;max-width:96vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0;font-size:16px">⏸ Paros — ${escHtml(linea)} ${tituloExtra ? '· ' + escHtml(tituloExtra) : ''}</h3>
      <button id="closePModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">×</button>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px">${desde} al ${hasta}${turno ? ' · Turno ' + escHtml(turno) : ''}</p>
    <div id="paroModalBody"><div style="text-align:center;padding:24px;color:#6b7280">⏳ Cargando...</div></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#closePModal').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  try {
    let paroUrl = '/resumen/paros?desde=' + desde + '&hasta=' + hasta + '&linea=' + linea;
    if (turno) paroUrl += '&turno=' + turno;
    const data = await GET(paroUrl);
    const paros = data.paros || [];
    if (!paros.length) {
      overlay.querySelector('#paroModalBody').innerHTML = '<div style="text-align:center;padding:24px;color:#16a34a;font-weight:600">Sin paros en este período ✅</div>';
      return;
    }
    const motivoTiempo = {};
    paros.forEach(p => { const k = p.motivo || 'Sin motivo'; motivoTiempo[k] = (motivoTiempo[k] || 0) + Number(p.duracion_min || 0); });
    const paretoParos = Object.entries(motivoTiempo).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, label2: (value / 60).toFixed(1) + 'h' }));
    const paroPorDia = {};
    paros.forEach(p => { paroPorDia[p.fecha_inicio] = (paroPorDia[p.fecha_inicio] || 0) + Number(p.duracion_min || 0); });
    const diasParos = Object.entries(paroPorDia).sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value, label2: (value / 60).toFixed(1) + 'h' }));
    const totalMin = paros.reduce((s, p) => s + Number(p.duracion_min || 0), 0);
    overlay.querySelector('#paroModalBody').innerHTML = `
      <div style="font-size:12px;color:#6b7280;margin-bottom:12px">${paros.length} paros · <b>${(totalMin / 60).toFixed(1)} horas</b> acumuladas</div>
      <h4 style="font-size:13px;margin:0 0 8px;color:#374151">Pareto por motivo</h4>
      ${renderHBarChart(paretoParos, () => '#f59e0b')}
      <h4 style="font-size:13px;margin:16px 0 8px;color:#374151">Tiempo de paro por día</h4>
      ${renderHBarChart(diasParos, () => '#3b82f6')}`;
  } catch (e) {
    overlay.querySelector('#paroModalBody').innerHTML = `<div style="color:#dc2626;padding:16px">Error: ${escHtml(e.message)}</div>`;
  }
}

function showEficienciaDrilldown(snap) {
  const fmtPct = v => v != null ? (v * 100).toFixed(1) + '%' : '—';
  const fmtNum = v => v != null ? v : '—';
  const totalObj = (snap.slots || []).reduce((s, x) => s + (x.ciclos_obj || 0), 0);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:560px;max-width:96vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0;font-size:16px">📊 Eficiencia por Hora — ${escHtml(snap.linea)} · ${escHtml(snap.fecha)} ${escHtml(snap.turno)}</h3>
      <button id="closeEfModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">×</button>
    </div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:14px">
      Total turno: <strong>${snap.ciclos_totales}</strong> ciclos de <strong>${totalObj}</strong> objetivo
      · Eficiencia: <strong>${fmtPct(snap.eficiencia)}</strong>
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Hora</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Ciclos reales</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Objetivo</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Eficiencia</th>
      </tr></thead>
      <tbody>${(snap.slots || []).map(s => {
        const ef = s.eficiencia;
        const clr = ef == null ? '' : ef >= 0.9 ? 'color:#16a34a;font-weight:700' : ef >= 0.7 ? 'color:#d97706;font-weight:700' : 'color:#dc2626;font-weight:700';
        return `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:5px 8px;color:#374151">${escHtml(s.hora_inicio)}–${escHtml(s.hora_fin)}</td>
          <td style="padding:5px 8px;text-align:center;font-weight:600">${fmtNum(s.ciclos_totales)}</td>
          <td style="padding:5px 8px;text-align:center;color:#6b7280">${fmtNum(s.ciclos_obj)}</td>
          <td style="padding:5px 8px;text-align:center;${clr}">${fmtPct(ef)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeEfModal').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

function showCapacidadDrilldown(snap) {
  const fmtPct = v => v != null ? (v * 100).toFixed(1) + '%' : '—';
  const fmtNum = v => v != null ? v : '—';
  const totalPiezas = (snap.slots || []).reduce((s, x) => s + (x.piezas_total || 0), 0);
  const totalObj    = (snap.slots || []).reduce((s, x) => s + (x.piezas_obj_total || 0), 0);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:560px;max-width:96vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0;font-size:16px">📦 Capacidad por Hora — ${escHtml(snap.linea)} · ${escHtml(snap.fecha)} ${escHtml(snap.turno)}</h3>
      <button id="closeCapModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">×</button>
    </div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:14px">
      Total turno: <strong>${totalPiezas}</strong> piezas de <strong>${totalObj}</strong> objetivo
      · Capacidad: <strong>${fmtPct(snap.capacidad)}</strong>
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Hora</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Piezas carg.</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Objetivo</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Capacidad</th>
      </tr></thead>
      <tbody>${(snap.slots || []).map(s => {
        const cap = s.capacidad;
        const clr = cap == null ? 'color:#6b7280' : cap >= 0.9 ? 'color:#16a34a;font-weight:700' : cap >= 0.7 ? 'color:#d97706;font-weight:700' : 'color:#dc2626;font-weight:700';
        return `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:5px 8px;color:#374151">${escHtml(s.hora_inicio)}–${escHtml(s.hora_fin)}</td>
          <td style="padding:5px 8px;text-align:center;font-weight:600">${fmtNum(s.piezas_total)}</td>
          <td style="padding:5px 8px;text-align:center;color:#6b7280">${fmtNum(s.piezas_obj_total) !== '—' && s.piezas_obj_total > 0 ? s.piezas_obj_total : '—'}</td>
          <td style="padding:5px 8px;text-align:center;${clr}">${fmtPct(cap)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeCapModal').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

function showEficienciaDetalle(weekSnaps, linea, semanaLabel) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:520px;max-width:96vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0;font-size:16px">📊 Eficiencia — ${escHtml(linea)} · ${escHtml(semanaLabel)}</h3>
      <button id="closeEfModal" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">×</button>
    </div>
    <div id="efModalBody"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeEfModal').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  const snaps = weekSnaps.filter(s => s.linea === linea);
  if (!snaps.length) {
    overlay.querySelector('#efModalBody').innerHTML = '<div style="text-align:center;padding:24px;color:#6b7280">Sin datos para este período</div>';
    return;
  }
  const efPorDia = {};
  const efPorDiaCnt = {};
  snaps.forEach(s => { efPorDia[s.fecha] = (efPorDia[s.fecha] || 0) + (s.eficiencia || 0); efPorDiaCnt[s.fecha] = (efPorDiaCnt[s.fecha] || 0) + 1; });
  const dias = Object.keys(efPorDia).sort().map(f => {
    const v = Math.round(efPorDia[f] / efPorDiaCnt[f] * 100);
    return { label: f, value: v, label2: v + '%' };
  });
  const tableRows = snaps.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.turno.localeCompare(b.turno)).map(s => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:4px 8px">${s.fecha}</td>
      <td style="padding:4px 8px;text-align:center;font-weight:600">${s.turno}</td>
      <td style="padding:4px 8px;text-align:center">${s.ciclos_totales}</td>
      <td style="padding:4px 8px;text-align:center" class="${kpiColor(s.eficiencia != null ? s.eficiencia * 100 : null)}">${s.eficiencia != null ? (s.eficiencia * 100).toFixed(1) + '%' : '—'}</td>
    </tr>`).join('');
  overlay.querySelector('#efModalBody').innerHTML = `
    <h4 style="font-size:13px;margin:0 0 8px;color:#374151">Eficiencia promedio por día</h4>
    ${renderHBarChart(dias, d => d.value >= 90 ? '#16a34a' : d.value >= 70 ? '#f59e0b' : '#ef4444')}
    <h4 style="font-size:13px;margin:16px 0 8px;color:#374151">Detalle por turno</h4>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Fecha</th>
        <th style="padding:5px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Turno</th>
        <th style="padding:5px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Ciclos</th>
        <th style="padding:5px 8px;text-align:center;border-bottom:1px solid #e5e7eb">Eficiencia</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RESUMEN DE TURNO
// ══════════════════════════════════════════════════════════════════════════════

async function viewResumenTurno(el) {
  const today = new Date().toLocaleDateString('en-CA');
  const currentYear = new Date().getFullYear();
  const { week: currentWeek } = getISOWeekFE(today);

  const isAdmin = state.user?.role === 'admin';
  let activeTab = 'L3';
  let activeSubTab = 'detalle';
  let lastSnaps = [];

  const weekOpts = Array.from({ length: 53 }, (_, i) => i + 1).map(w => {
    try {
      const r = getISOWeekRangeFE(w, currentYear);
      if (r.desde.slice(0, 4) !== String(currentYear) && r.hasta.slice(0, 4) !== String(currentYear)) return '';
      return `<option value="${w}" ${w === currentWeek ? 'selected' : ''}>Sem ${w} · ${r.desde} – ${r.hasta}</option>`;
    } catch (_) { return ''; }
  }).filter(Boolean).join('');

  const initRange = getISOWeekRangeFE(currentWeek, currentYear);

  el.innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn tab-active" data-tab="L3">Línea 3</button>
      <button class="tab-btn" data-tab="L4">Línea 4</button>
      <button class="tab-btn" data-tab="Baker">Baker</button>
      <button class="tab-btn" data-tab="L1">Línea 1</button>
    </div>
    <div class="filters-bar" style="flex-wrap:wrap;gap:8px;align-items:flex-end">
      <div><span class="flabel">Semana</span>
        <select id="rt-semana" style="min-width:220px">
          <option value="">— Usar fechas manuales —</option>
          ${weekOpts}
        </select>
      </div>
      <div><span class="flabel">Turno</span>
        <select id="rt-turno"><option value="">Todos</option><option>T1</option><option>T2</option><option>T3</option></select>
      </div>
      <div><span class="flabel">Desde</span><input type="date" id="rt-desde" value="${initRange.desde}"/></div>
      <div><span class="flabel">Hasta</span><input type="date" id="rt-hasta" value="${initRange.hasta}"/></div>
      <button class="btn btn-outline btn-sm" id="rt-buscar">🔍 Buscar</button>
      <button class="btn btn-dark btn-sm" id="rt-export">📥 Excel</button>
      ${isAdmin ? `<button class="btn btn-primary btn-sm" id="rt-guardar">💾 Guardar Resumen</button>` : ''}
    </div>
    <div style="display:flex;border-bottom:2px solid #e5e7eb;margin-bottom:12px;gap:0">
      <button class="rt-stab rt-stab-on" data-st="detalle" style="padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:#2563eb;border-bottom:2px solid #2563eb;margin-bottom:-2px">📑 Detalle</button>
      <button class="rt-stab" data-st="analisis" style="padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#6b7280;border-bottom:2px solid transparent;margin-bottom:-2px">📊 Análisis Semanal</button>
      <button class="rt-stab" data-st="scorecard" style="padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#6b7280;border-bottom:2px solid transparent;margin-bottom:-2px">🏆 Score Card</button>
    </div>
    <div id="rt-resultado"><div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div></div>`;

  const getEl = id => document.getElementById(id);

  el.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      activeTab = btn.dataset.tab;
      buscar();
    });
  });

  el.querySelectorAll('.rt-stab').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.rt-stab').forEach(b => {
        b.style.color = '#6b7280'; b.style.fontWeight = '400'; b.style.borderBottom = '2px solid transparent'; b.classList.remove('rt-stab-on');
      });
      btn.style.color = '#2563eb'; btn.style.fontWeight = '600'; btn.style.borderBottom = '2px solid #2563eb'; btn.classList.add('rt-stab-on');
      activeSubTab = btn.dataset.st;
      renderSubTab();
    });
  });

  getEl('rt-semana').addEventListener('change', () => {
    const w = Number(getEl('rt-semana').value);
    if (w) { const r = getISOWeekRangeFE(w, currentYear); getEl('rt-desde').value = r.desde; getEl('rt-hasta').value = r.hasta; }
  });

  async function buscar() {
    const params = new URLSearchParams({ linea: activeTab });
    const turno = getEl('rt-turno').value;
    const desde = getEl('rt-desde').value;
    const hasta  = getEl('rt-hasta').value;
    if (turno) params.set('turno', turno);
    if (desde) params.set('desde', desde);
    if (hasta)  params.set('hasta', hasta);
    const res = getEl('rt-resultado');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
    try {
      const data = await GET('/kpis?' + params);
      lastSnaps = data?.snapshots || [];
      renderSubTab();
    } catch (e) {
      getEl('rt-resultado').innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  function renderSubTab() {
    const res = getEl('rt-resultado');
    if (activeSubTab === 'scorecard') { renderScorecardView(res); return; }
    if (!lastSnaps.length) { res.innerHTML = '<div class="empty-state"><div class="icon">📑</div><p>Sin datos para estos filtros.</p></div>'; return; }
    if (activeSubTab === 'detalle') {
      res.innerHTML = renderResumenTurnoTable(lastSnaps, activeTab);
      res.querySelectorAll('.eficiencia-click').forEach(td => {
        td.style.cursor = 'pointer';
        td.addEventListener('click', () => {
          const snap = lastSnaps.find(s => s.id === td.dataset.sid);
          if (snap) showEficienciaDrilldown(snap);
        });
      });
      res.querySelectorAll('.calidad-click').forEach(td => {
        td.style.cursor = 'pointer';
        td.title = 'Clic para ver detalle de defectos';
        td.addEventListener('click', () => {
          const snap = lastSnaps.find(s => s.id === td.dataset.sid);
          if (snap) {
            // T3 cruza medianoche: hasta = día siguiente para incluir descargas 00:00–06:30
            const hasta = snap.turno === 'T3'
              ? new Date(new Date(snap.fecha+'T12:00:00').getTime()+86400000).toISOString().slice(0,10)
              : snap.fecha;
            showDefectosDrilldown(snap.linea, snap.fecha, hasta, snap.turno);
          }
        });
      });
      res.querySelectorAll('.capacidad-click').forEach(td => {
        td.style.cursor = 'pointer';
        td.addEventListener('click', () => {
          const snap = lastSnaps.find(s => s.id === td.dataset.sid);
          if (snap) showCapacidadDrilldown(snap);
        });
      });
      res.querySelectorAll('.disponibilidad-click').forEach(td => {
        td.style.cursor = 'pointer';
        td.title = 'Clic para ver paros de este turno';
        td.addEventListener('click', () => {
          const snap = lastSnaps.find(s => s.id === td.dataset.sid);
          if (snap) {
            // T3 cruza medianoche: hasta = día siguiente para incluir paros 00:00–06:30
            const hasta = snap.turno === 'T3'
              ? new Date(new Date(snap.fecha+'T12:00:00').getTime()+86400000).toISOString().slice(0,10)
              : snap.fecha;
            showParetoParo(snap.linea, snap.fecha, hasta, snap.turno);
          }
        });
      });
    } else if (activeSubTab === 'analisis') {
      renderAnalisisSemanal(res);
    }
  }

  async function renderAnalisisSemanal(container) {
    const desde = getEl('rt-desde').value;
    const hasta  = getEl('rt-hasta').value;
    if (!desde || !hasta) { container.innerHTML = '<div class="alert">Selecciona un rango de fechas.</div>'; return; }
    container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando análisis...</p></div>';
    try {
      const [parosData, defData] = await Promise.all([
        GET('/resumen/paros?desde=' + desde + '&hasta=' + hasta + '&linea=' + activeTab),
        GET('/resumen/defectos?desde=' + desde + '&hasta=' + hasta + '&linea=' + activeTab)
      ]);
      const paros = parosData.paros || [];
      const defs  = defData.defectos || [];

      const motivoTiempo = {};
      paros.forEach(p => { const k = p.motivo || 'Sin motivo'; motivoTiempo[k] = (motivoTiempo[k] || 0) + Number(p.duracion_min || 0); });
      const paretoParos = Object.entries(motivoTiempo).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, label2: (value / 60).toFixed(1) + 'h' }));

      const paroPorDia = {};
      paros.forEach(p => { paroPorDia[p.fecha_inicio] = (paroPorDia[p.fecha_inicio] || 0) + Number(p.duracion_min || 0); });
      const diasParos = Object.entries(paroPorDia).sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value, label2: (value / 60).toFixed(1) + 'h' }));

      const defTipo = {};
      defs.forEach(d => { defTipo[d.defecto] = (defTipo[d.defecto] || 0) + 1; });
      const paretoDefectos = Object.entries(defTipo).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

      const defPorDia = {};
      defs.forEach(d => { defPorDia[d.fecha] = (defPorDia[d.fecha] || 0) + 1; });
      const diasDefs = Object.entries(defPorDia).sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));

      const efPorDia = {};
      const efPorDiaCnt = {};
      lastSnaps.forEach(s => { efPorDia[s.fecha] = (efPorDia[s.fecha] || 0) + (s.eficiencia || 0); efPorDiaCnt[s.fecha] = (efPorDiaCnt[s.fecha] || 0) + 1; });
      const diasEf = Object.keys(efPorDia).sort().map(f => { const v = Math.round(efPorDia[f] / efPorDiaCnt[f] * 100); return { label: f, value: v, label2: v + '%' }; });

      const cardStyle = 'background:#fff;border-radius:12px;padding:16px;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,.05)';
      container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div style="${cardStyle}">
            <h4 style="margin:0 0 10px;font-size:14px">⏸ Pareto Motivos de Paro — ${escHtml(activeTab)}</h4>
            <div style="font-size:12px;color:#6b7280;margin-bottom:8px">${paros.length} paros · ${(paros.reduce((s,p)=>s+Number(p.duracion_min||0),0)/60).toFixed(1)}h totales</div>
            ${paretoParos.length ? renderHBarChart(paretoParos, () => '#f59e0b') : '<div style="color:#16a34a;font-size:12px">Sin paros ✅</div>'}
          </div>
          <div style="${cardStyle}">
            <h4 style="margin:0 0 10px;font-size:14px">📅 Tiempo de Paro por Día — ${escHtml(activeTab)}</h4>
            ${diasParos.length ? renderHBarChart(diasParos, () => '#fb923c') : '<div style="color:#16a34a;font-size:12px">Sin paros ✅</div>'}
          </div>
          <div style="${cardStyle}">
            <h4 style="margin:0 0 10px;font-size:14px">❌ Pareto Tipos de Defecto — ${escHtml(activeTab)}</h4>
            <div style="font-size:12px;color:#6b7280;margin-bottom:8px">${defs.length} ciclos/cavidades con defecto</div>
            ${paretoDefectos.length ? renderHBarChart(paretoDefectos, () => '#ef4444') : '<div style="color:#16a34a;font-size:12px">Sin defectos ✅</div>'}
          </div>
          <div style="${cardStyle}">
            <h4 style="margin:0 0 10px;font-size:14px">📈 Eficiencia por Día — ${escHtml(activeTab)}</h4>
            ${diasEf.length ? renderHBarChart(diasEf, d => d.value >= 90 ? '#16a34a' : d.value >= 70 ? '#f59e0b' : '#ef4444') : '<div style="color:#6b7280;font-size:12px">Sin datos</div>'}
          </div>
        </div>`;
    } catch (e) {
      container.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  async function renderScorecardView(container) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando Score Card...</p></div>';
    const desdeVal = getEl('rt-desde').value || today;
    const year  = parseInt(desdeVal.slice(0, 4));
    const month = parseInt(desdeVal.slice(5, 7));
    const mesLabel = new Date(year, month - 1, 15).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    const primerDia = year + '-' + String(month).padStart(2, '0') + '-01';
    const ultimoDia = new Date(year, month, 0).toISOString().slice(0, 10);
    try {
      const [dL3, dL4, dBk, dL1, pL3, pL4, pBk, pL1] = await Promise.all([
        GET('/kpis?linea=L3&desde=' + primerDia + '&hasta=' + ultimoDia),
        GET('/kpis?linea=L4&desde=' + primerDia + '&hasta=' + ultimoDia),
        GET('/kpis?linea=Baker&desde=' + primerDia + '&hasta=' + ultimoDia),
        GET('/kpis?linea=L1&desde=' + primerDia + '&hasta=' + ultimoDia),
        GET('/resumen/paros?desde=' + primerDia + '&hasta=' + ultimoDia + '&linea=L3'),
        GET('/resumen/paros?desde=' + primerDia + '&hasta=' + ultimoDia + '&linea=L4'),
        GET('/resumen/paros?desde=' + primerDia + '&hasta=' + ultimoDia + '&linea=Baker'),
        GET('/resumen/paros?desde=' + primerDia + '&hasta=' + ultimoDia + '&linea=L1')
      ]);
      const allSnaps = [...(dL3.snapshots||[]),...(dL4.snapshots||[]),...(dBk.snapshots||[]),...(dL1.snapshots||[])];
      const parosSrc = { L3: pL3.paros||[], L4: pL4.paros||[], Baker: pBk.paros||[], L1: pL1.paros||[] };

      const LINEAS = ['Baker','L1','L3','L4'];
      const LLAB   = { Baker:'Bk', L1:'L1', L3:'L3', L4:'L4' };
      const TURNO_H = { T1:8, T2:7, T3:9 };

      function aggKPI(snaps, l, filterFn) {
        const s = snaps.filter(x => x.linea === l && (filterFn ? filterFn(x) : true));
        if (!s.length) return { ef:null, cal:null };
        let efNum=0, efDen=0, buenos=0, noVacios=0;
        s.forEach(x => { const h=TURNO_H[x.turno]||8; if(x.eficiencia!=null){efNum+=x.eficiencia*h;efDen+=h;} buenos+=(x.ciclos_buenos_calidad??x.ciclos_buenos); noVacios+=(x.ciclos_no_vacios_calidad??x.ciclos_no_vacios); });
        return { ef:efDen>0?efNum/efDen:null, cal:noVacios>0?buenos/noVacios:null };
      }
      function paroHrs(l, filterFn) {
        const arr = filterFn ? parosSrc[l].filter(filterFn) : parosSrc[l];
        return arr.reduce((s,p)=>s+Number(p.duracion_min||0),0)/60;
      }
      const fmtP = v => v!=null ? (v*100).toFixed(1)+'%' : '—';
      const fmtH = v => v>0 ? v.toFixed(1)+'h' : '—';
      const clr  = v => v==null?'':v>=0.9?'color:#16a34a;font-weight:700':v>=0.7?'color:#d97706;font-weight:700':'color:#dc2626;font-weight:700';

      const weeks = [...new Set(allSnaps.map(s=>s.semana))].sort((a,b)=>a-b);
      const rows = [{ label: mesLabel.charAt(0).toUpperCase()+mesLabel.slice(1), type:'month', filter:()=>true, pFilter:()=>true, desde:primerDia, hasta:ultimoDia }];
      weeks.forEach(w => {
        const r = getISOWeekRangeFE(w, year);
        rows.push({ label:'Sem '+w, type:'week', week:w, desde:r.desde, hasta:r.hasta, filter:s=>s.semana===w, pFilter:p=>p.fecha_inicio>=r.desde&&p.fecha_inicio<=r.hasta });
      });

      const th = s => `<th style="padding:7px 6px;text-align:center;min-width:72px;font-size:12px">${s}</th>`;
      const thead = `<tr style="background:#1e3a5f;color:#fff">
        <th style="padding:7px 10px;text-align:left;min-width:110px;position:sticky;left:0;background:#1e3a5f">Período</th>
        ${LINEAS.map(l=>`<th style="padding:7px 6px;text-align:center;min-width:72px;font-size:12px" title="Eficiencia ${l}">Eff ${LLAB[l]}</th>`).join('')}
        ${LINEAS.map(l=>`<th style="padding:7px 6px;text-align:center;min-width:72px;font-size:12px" title="Horas paro ${l}">Paro ${LLAB[l]}</th>`).join('')}
        ${LINEAS.map(l=>`<th style="padding:7px 6px;text-align:center;min-width:72px;font-size:12px" title="Calidad ${l}">Cal ${LLAB[l]}</th>`).join('')}
      </tr>`;

      const tbodyRows = rows.map((row, ri) => {
        const bg = row.type==='month'?'#f0f9ff':ri%2===0?'#fafafa':'#fff';
        const wt = row.type==='month'?'font-weight:700':'';
        const efCells = LINEAS.map(l => {
          const { ef } = aggKPI(allSnaps, l, row.filter);
          return `<td data-action="ef" data-linea="${l}" data-desde="${row.desde}" data-hasta="${row.hasta}" data-week="${row.week||''}" style="padding:6px;text-align:center;${wt};${clr(ef)};cursor:pointer">${fmtP(ef)}</td>`;
        }).join('');
        const paroCells = LINEAS.map(l => {
          const h = paroHrs(l, row.pFilter);
          return `<td data-action="paro" data-linea="${l}" data-desde="${row.desde}" data-hasta="${row.hasta}" style="padding:6px;text-align:center;${wt};color:${h>0?'#dc2626':'#16a34a'};cursor:pointer">${fmtH(h)}</td>`;
        }).join('');
        const calCells = LINEAS.map(l => {
          const { cal } = aggKPI(allSnaps, l, row.filter);
          return `<td data-action="cal" data-linea="${l}" data-desde="${row.desde}" data-hasta="${row.hasta}" style="padding:6px;text-align:center;${wt};${clr(cal)};cursor:pointer">${fmtP(cal)}</td>`;
        }).join('');
        return `<tr style="background:${bg};border-bottom:1px solid #e5e7eb">
          <td style="padding:6px 10px;${wt};position:sticky;left:0;background:${bg}">${escHtml(row.label)}</td>
          ${efCells}${paroCells}${calCells}
        </tr>`;
      }).join('');

      container.innerHTML = `
        <div style="margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700">${escHtml(mesLabel.charAt(0).toUpperCase()+mesLabel.slice(1))} — Score Card</span>
          <span style="font-size:11px;color:#6b7280">Clic en celda para desglosar</span>
        </div>
        <div style="overflow-x:auto">
          <table style="border-collapse:collapse;min-width:900px;font-size:13px">
            <thead>${thead}</thead>
            <tbody>${tbodyRows}</tbody>
          </table>
        </div>`;

      container.querySelectorAll('td[data-action]').forEach(td => {
        td.addEventListener('click', () => {
          const { action, linea, desde, hasta, week } = td.dataset;
          if (action === 'ef') {
            const ws = week ? allSnaps.filter(s=>s.linea===linea&&s.semana===Number(week)) : allSnaps.filter(s=>s.linea===linea);
            showEficienciaDetalle(ws, linea, week ? 'Sem '+week : mesLabel);
          } else if (action === 'paro') {
            showParetoParo(linea, desde, hasta, '');
          } else if (action === 'cal') {
            showDefectosDrilldown(linea, desde, hasta, '');
          }
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="alert alert-warn">⚠️ ${escHtml(e.message)}</div>`;
    }
  }

  getEl('rt-buscar').addEventListener('click', buscar);
  buscar();

  getEl('rt-export').addEventListener('click', () => {
    if (!lastSnaps.length) { alert('Primero ejecuta una búsqueda.'); return; }
    const rows = lastSnaps.map(s => ({
      Semana: s.semana, Fecha: s.fecha, Turno: s.turno, Línea: s.linea,
      Ciclos_Totales: s.ciclos_totales, Ciclos_Buenos: s.ciclos_buenos,
      Eficiencia_pct:    s.eficiencia    != null ? +(s.eficiencia    * 100).toFixed(1) : '',
      Calidad_pct:       s.calidad       != null ? +(s.calidad       * 100).toFixed(1) : '',
      Disponibilidad_pct:s.disponibilidad!= null ? +(s.disponibilidad* 100).toFixed(1) : '',
      Tiempo_Paro_min:   s.paros_min_total
    }));
    const ws2 = XLSX.utils.json_to_sheet(rows);
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws2, 'Resumen_' + activeTab);
    XLSX.writeFile(wb2, 'resumen_turno_' + activeTab + '_' + today + '.xlsx');
  });

  if (isAdmin) {
    getEl('rt-guardar').addEventListener('click', async () => {
      const btn = getEl('rt-guardar');
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        const r = await POST('/kpis/guardar', { fecha: getEl('rt-hasta').value || today, linea: activeTab, turno: getEl('rt-turno').value || 'all' });
        alert('✅ Resumen guardado: ' + r.guardados + ' registro(s)');
        buscar();
      } catch (e) { alert('Error: ' + e.message); }
      finally { btn.disabled = false; btn.textContent = '💾 Guardar Resumen'; }
    });
  }
}

function renderResumenTurnoTable(snaps, linea) {
  const fmtPct = v => v != null ? (v * 100).toFixed(1) + '%' : '—';
  const fmtNum = v => v != null ? v : '—';
  const isBakerLike = linea === 'Baker' || linea === 'L1';

  const byWeek = {};
  snaps.forEach(s => { if (!byWeek[s.semana]) byWeek[s.semana] = []; byWeek[s.semana].push(s); });

  const rows = snaps.map(s => `
    <tr>
      <td style="font-size:11px;color:#6b7280;text-align:center">${s.semana ? 'S' + s.semana : ''}</td>
      <td>${escHtml(s.fecha)}</td>
      <td style="text-align:center;font-weight:600">${escHtml(s.turno)}</td>
      <td style="text-align:center">${escHtml(s.linea)}</td>
      <td style="text-align:center;font-weight:700">${fmtNum(s.ciclos_totales)}</td>
      ${isBakerLike ? `<td style="text-align:center">${fmtNum(s.ciclos_no_vacios)}</td>` : ''}
      <td style="text-align:center">${fmtNum(s.ciclos_buenos)}</td>
      <td class="${kpiColor(s.eficiencia != null ? s.eficiencia * 100 : null)} eficiencia-click" data-sid="${s.id}" title="Clic para ver ciclos por hora">${fmtPct(s.eficiencia)} 🔍</td>
      <td class="${kpiColor(s.calidad != null ? s.calidad * 100 : null)} calidad-click" data-sid="${s.id}" title="Clic para ver defectos">${fmtPct(s.calidad)}${s.calidad != null && s.calidad < 1 ? ' 🔍' : ''}</td>
      <td class="${kpiColor(s.capacidad != null ? s.capacidad * 100 : null)} capacidad-click" data-sid="${s.id}" title="Clic para ver piezas por hora">${fmtPct(s.capacidad)}${s.capacidad != null ? ' 🔍' : ''}</td>
      <td class="${kpiColor(s.disponibilidad != null ? s.disponibilidad * 100 : null)} disponibilidad-click" data-sid="${s.id}" title="Clic para ver paros">${fmtPct(s.disponibilidad)}${s.disponibilidad != null && s.disponibilidad < 1 ? ' 🔍' : ''}</td>
      <td style="text-align:center">${fmtNum(s.piezas_total)}</td>
      <td style="text-align:center">${fmtNum(s.paros_min_total)} min</td>
    </tr>`).join('');

  const weekRows = Object.entries(byWeek).sort((a, b) => Number(a[0]) - Number(b[0])).map(([wk, ws]) => {
    const ciclosTot   = ws.reduce((s,x)=>s+x.ciclos_totales,0);
    const ciclosBuenos = ws.reduce((s,x)=>s+x.ciclos_buenos,0);
    const ciclosNoV   = ws.reduce((s,x)=>s+x.ciclos_no_vacios,0);
    const paroMin = ws.reduce((s,x)=>s+x.paros_min_total,0);
    const TURNO_H = {T1:8,T2:7,T3:9};
    let efNum=0,efDen=0; ws.forEach(x=>{if(x.eficiencia!=null){const h=TURNO_H[x.turno]||8;efNum+=x.eficiencia*h;efDen+=h;}});
    const ef  = efDen>0?efNum/efDen:null;
    const cal = ciclosNoV>0?ciclosBuenos/ciclosNoV:null;
    return `<tr style="background:#eff6ff;font-weight:700;border-top:2px solid #bfdbfe">
      <td colspan="4" style="padding:4px 8px;font-size:12px;color:#1d4ed8">∑ Semana ${wk} — ${ws.length} turno(s)</td>
      <td style="text-align:center">${ciclosTot}</td>
      ${isBakerLike ? `<td style="text-align:center">${ciclosNoV}</td>` : ''}
      <td style="text-align:center">${ciclosBuenos}</td>
      <td class="${kpiColor(ef!=null?ef*100:null)}">${fmtPct(ef)}</td>
      <td class="${kpiColor(cal!=null?cal*100:null)}">${fmtPct(cal)}</td>
      <td>—</td>
      <td>—</td>
      <td style="text-align:center">${ws.reduce((s,x)=>s+x.piezas_total,0)}</td>
      <td style="text-align:center">${paroMin.toFixed(0)} min</td>
    </tr>`;
  }).join('');

  return `
    <div class="table-card">
      <div class="table-header">
        <h3>Resumen de Turnos — ${escHtml(linea)}</h3>
        <span style="font-size:13px;color:var(--p-muted)">${snaps.length} registro(s) · Clic en Calidad para ver defectos</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Sem</th><th>Fecha</th><th>Turno</th><th>Línea</th>
            <th>Ciclos Tot.</th>${isBakerLike ? '<th>Cav. Tot.</th>' : ''}<th>${isBakerLike ? 'Cav. Buenas' : 'Ciclos Buenos'}</th>
            <th>Eficiencia 🔍</th><th>Calidad 🔍</th><th>Capacidad 🔍</th><th>Disponibilidad 🔍</th>
            <th>Piezas</th><th>T. Paro</th>
          </tr></thead>
          <tbody>${rows}${weekRows}</tbody>
        </table>
      </div>
    </div>`;
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
