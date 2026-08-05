/* ══════════════════════════════════════════════════════════════════════════════
   PORTAL DEL EMPLEADO — SPA vanilla JS
   Vistas: perfil · incidencias · evaluaciones · lista_raya · vacaciones · queja
   ══════════════════════════════════════════════════════════════════════════════ */

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  token: null,
  user: null,         // { id, employee_number, full_name }
  mustChange: false,
  section: 'perfil',
  _inactTimer: null,
};

// ── PWA Install ───────────────────────────────────────────────────────────────
let _installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  // Mostrar banner si ya está en la pantalla de login
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.remove();
});

function pwaInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') _installPrompt = null;
  });
}

// ── Navegación ────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'perfil',       icon: '👤', label: 'Mi Perfil' },
  { id: 'incidencias',  icon: '📋', label: 'Incidencias' },
  { id: 'lista_raya',   icon: '💰', label: 'Lista de Raya' },
  { id: 'vacaciones',   icon: '🏖️',  label: 'Vacaciones' },
  { id: 'evaluaciones', icon: '⭐', label: 'Evaluaciones' },
  { id: 'queja',        icon: '📝', label: 'Queja Anónima' },
];

// ── Auth helpers ──────────────────────────────────────────────────────────────
function tryRestore() {
  const t = localStorage.getItem('emp_token');
  const u = localStorage.getItem('emp_user');
  const mc = localStorage.getItem('emp_must_change');
  if (t && u) {
    state.token = t;
    state.user = JSON.parse(u);
    state.mustChange = mc === 'true';
    return true;
  }
  return false;
}
function saveSession(token, user, mustChange) {
  state.token = token;
  state.user = user;
  state.mustChange = !!mustChange;
  localStorage.setItem('emp_token', token);
  localStorage.setItem('emp_user', JSON.stringify(user));
  localStorage.setItem('emp_must_change', mustChange ? 'true' : 'false');
}
function logout() {
  state.token = null; state.user = null; state.mustChange = false;
  localStorage.removeItem('emp_token');
  localStorage.removeItem('emp_user');
  localStorage.removeItem('emp_must_change');
  clearTimeout(state._inactTimer);
  render();
}

// ── Inactividad (30 min) ──────────────────────────────────────────────────────
function resetInact() {
  clearTimeout(state._inactTimer);
  state._inactTimer = setTimeout(logout, 30 * 60 * 1000);
}
document.addEventListener('touchstart', resetInact, { passive: true });
document.addEventListener('click', resetInact);

// ── API helper ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const res = await fetch('/api/empleados' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); return null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'Error de red' } };
  }
}

// ── Navigate ──────────────────────────────────────────────────────────────────
function navigate(section) {
  state.section = section;
  renderMain();
  // actualizar nav activo sin re-renderizar layout completo
  document.querySelectorAll('.emp-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === section);
  });
  document.querySelectorAll('.emp-sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === section);
  });
}

// ── Render raíz ───────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!state.user) {
    app.innerHTML = loginView();
    bindLogin();
    return;
  }
  if (state.mustChange) {
    app.innerHTML = changePwdView();
    bindChangePwd();
    return;
  }
  app.innerHTML = layoutView();
  bindLayout();
  renderMain();
  resetInact();
}

function renderMain() {
  const el = document.getElementById('emp-main-content');
  if (!el) return;
  el.innerHTML = '<div class="emp-spinner">Cargando...</div>';
  const views = { perfil, incidencias, lista_raya, vacaciones, evaluaciones, queja };
  const fn = views[state.section];
  if (fn) fn(el);
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
function loginView() {
  return `
  <div class="emp-login">
    <div class="emp-login-card">
      <div class="emp-login-logo">
        <div class="logo-icon">🏭</div>
        <h1>Portal del Empleado</h1>
        <p>Accede a tu información de nómina, incidencias y más</p>
      </div>
      <div class="emp-form-group">
        <label>Usuario</label>
        <input class="emp-input" type="text" id="l-user" placeholder="RFC sin homoclave (10 caracteres)" autocomplete="username" autocapitalize="characters" spellcheck="false"/>
      </div>
      <div class="emp-form-group">
        <label>Contraseña</label>
        <input class="emp-input" type="password" id="l-pass" placeholder="••••••" autocomplete="current-password"/>
      </div>
      <button class="emp-btn" id="btn-login">Ingresar</button>
      <p class="emp-error" id="login-err"></p>
      <p class="emp-hint">
        Usuario: las primeras 10 letras de tu RFC (sin guiones)<br>
        Contraseña inicial: últimas 6 letras de tu CURP
      </p>
    </div>
  </div>
  <div id="pwa-install-banner" class="pwa-banner" style="display:none">
    <div class="pwa-banner-icon">🏭</div>
    <div class="pwa-banner-text">
      <strong>Instalar aplicación</strong>
      <span>Accede más rápido desde tu celular</span>
    </div>
    <button class="pwa-banner-btn" onclick="pwaInstall()">Instalar</button>
    <button class="pwa-banner-close" onclick="this.closest('.pwa-banner').remove()">✕</button>
  </div>`;
}

function bindLogin() {
  // Mostrar banner si el prompt ya fue capturado antes del render
  if (_installPrompt) {
    const b = document.getElementById('pwa-install-banner');
    if (b) b.style.display = 'flex';
  }
  const btn = document.getElementById('btn-login');
  const doLogin = async () => {
    const username = (document.getElementById('l-user').value.trim()).toUpperCase();
    const password = document.getElementById('l-pass').value;
    const err = document.getElementById('login-err');
    err.textContent = '';
    if (!username || !password) { err.textContent = 'Completa usuario y contraseña'; return; }
    btn.disabled = true; btn.textContent = 'Verificando...';
    try {
      const res = await fetch('/api/empleados/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { err.textContent = data.error || 'Credenciales incorrectas'; btn.disabled = false; btn.textContent = 'Ingresar'; return; }
      saveSession(data.token, data.user, data.must_change);
      render();
    } catch (e) { err.textContent = 'Error de red. Intenta de nuevo.'; btn.disabled = false; btn.textContent = 'Ingresar'; }
  };
  btn.addEventListener('click', doLogin);
  document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('l-user').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('l-pass').focus(); });
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMBIAR CONTRASEÑA (primer acceso)
// ══════════════════════════════════════════════════════════════════════════════
function changePwdView() {
  return `
  <div class="emp-chpwd-wrap">
    <div class="emp-chpwd-card">
      <h2>🔑 Crear tu contraseña</h2>
      <p>Es tu primer acceso. Define una contraseña personal para futuros ingresos (mínimo 6 caracteres).</p>
      <div class="emp-form-group">
        <label>Nueva contraseña</label>
        <input class="emp-input" type="password" id="cp-new" placeholder="Mínimo 6 caracteres" autocomplete="new-password"/>
      </div>
      <div class="emp-form-group">
        <label>Confirmar contraseña</label>
        <input class="emp-input" type="password" id="cp-conf" autocomplete="new-password"/>
      </div>
      <p class="emp-error" id="cp-err"></p>
      <button class="emp-btn" id="btn-cp">Guardar contraseña</button>
    </div>
  </div>`;
}

function bindChangePwd() {
  const btn = document.getElementById('btn-cp');
  btn.addEventListener('click', async () => {
    const np = document.getElementById('cp-new').value;
    const nc = document.getElementById('cp-conf').value;
    const err = document.getElementById('cp-err');
    err.textContent = '';
    if (np.length < 6) { err.textContent = 'Mínimo 6 caracteres'; return; }
    if (np !== nc) { err.textContent = 'Las contraseñas no coinciden'; return; }
    btn.disabled = true; btn.textContent = 'Guardando...';
    const r = await api('POST', '/auth/change-password', { new_password: np });
    if (!r || !r.ok) {
      err.textContent = (r && r.data && r.data.error) || 'Error al guardar';
      btn.disabled = false; btn.textContent = 'Guardar contraseña';
      return;
    }
    state.mustChange = false;
    localStorage.setItem('emp_must_change', 'false');
    render();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYOUT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
function layoutView() {
  const navItems = SECTIONS.map(s => `
    <button class="emp-nav-item${state.section === s.id ? ' active' : ''}" data-nav="${s.id}">
      <span class="nav-icon">${s.icon}</span>
      <span>${s.label}</span>
    </button>`).join('');

  const sidebarItems = SECTIONS.map(s => `
    <button class="emp-sidebar-item${state.section === s.id ? ' active' : ''}" data-nav="${s.id}">
      <span class="si-icon">${s.icon}</span>${s.label}
    </button>`).join('');

  return `
  <div class="emp-layout">
    <!-- Top bar (móvil) -->
    <div class="emp-topbar">
      <div class="emp-topbar-brand">
        <div class="brand-icon">🏭</div>
        <div>
          <div class="brand-text">Portal del Empleado</div>
        </div>
      </div>
      <div class="emp-topbar-user">
        <span class="user-name">${esc(state.user.full_name.split(' ')[0])}</span>
        <button class="emp-btn-logout" id="btn-logout">Salir</button>
      </div>
    </div>

    <!-- Sidebar (desktop) -->
    <div class="emp-sidebar">
      <div class="emp-sidebar-brand">
        <div class="brand-icon">🏭</div>
        <div class="brand-text">Portal del Empleado</div>
        <div class="brand-sub">Autoservicio</div>
      </div>
      <nav class="emp-sidebar-nav">${sidebarItems}</nav>
      <div class="emp-sidebar-footer">
        <div class="user-name">${esc(state.user.full_name)}</div>
        <button class="emp-btn-logout" id="btn-logout-d">Cerrar sesión</button>
      </div>
    </div>

    <!-- Contenido principal -->
    <div class="emp-main">
      <div id="emp-main-content"></div>
    </div>

    <!-- Bottom nav (móvil) -->
    <nav class="emp-bottom-nav">${navItems}</nav>
  </div>
  <div id="pwa-install-banner" class="pwa-banner" style="display:none">
    <div class="pwa-banner-icon">🏭</div>
    <div class="pwa-banner-text">
      <strong>Instalar aplicación</strong>
      <span>Accede más rápido desde tu celular</span>
    </div>
    <button class="pwa-banner-btn" onclick="pwaInstall()">Instalar</button>
    <button class="pwa-banner-close" onclick="this.closest('.pwa-banner').remove()">✕</button>
  </div>`;
}

function bindLayout() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-logout-d')?.addEventListener('click', logout);
  // Mostrar banner de instalación si el prompt ya fue capturado
  if (_installPrompt) {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'flex';
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(v, decimals = 0) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtMoney(v) {
  if (!v && v !== 0) return '—';
  return '$' + Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '—';
  // dd/Mes/yyyy
  if (String(s).includes('/')) return s;
  // YYYY-MM-DD
  const [y,m,d] = String(s).split('-');
  const meses = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${d}/${meses[Number(m)]}/${y}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: MI PERFIL
// ══════════════════════════════════════════════════════════════════════════════
async function perfil(el) {
  const r = await api('GET', '/perfil');
  if (!r || !r.ok) { el.innerHTML = `<div class="emp-empty"><p>${(r&&r.data&&r.data.error)||'Error al cargar perfil'}</p></div>`; return; }
  const d = r.data;
  el.innerHTML = `
  <p class="emp-page-title">Mi Perfil</p>

  <div class="emp-card">
    <div class="emp-card-title">Datos personales</div>
    <div class="emp-field"><label>Nombre completo</label><span>${esc(d.full_name)}</span></div>
    <div class="emp-field"><label>No. Nómina</label><span>${esc(d.employee_number)}</span></div>
    <div class="emp-field"><label>RFC</label><span>${esc(d.rfc||'—')}</span></div>
    <div class="emp-field"><label>CURP</label><span style="font-size:12px">${esc(d.curp||'—')}</span></div>
    <div class="emp-field"><label>NSS</label><span>${esc(d.nss||'—')}</span></div>
  </div>

  <div class="emp-card">
    <div class="emp-card-title">Información laboral</div>
    <div class="emp-field"><label>Departamento</label><span>${esc(d.department||'—')}</span></div>
    <div class="emp-field"><label>Puesto</label><span>${esc(d.position||'—')}</span></div>
    <div class="emp-field"><label>Turno</label><span>${esc(d.shift||'—')}</span></div>
    <div class="emp-field"><label>Fecha de ingreso</label><span>${fmtDate(d.start_date)}</span></div>
    <div class="emp-field"><label>Salario diario</label><span>${d.salary_daily ? fmtMoney(d.salary_daily) : '—'}</span></div>
  </div>

  <div class="emp-card" style="background:#eff6ff">
    <div style="font-size:12px;color:#3b82f6;line-height:1.6">
      ¿Necesitas actualizar tus datos? Acude al área de Recursos Humanos.
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: MIS INCIDENCIAS
// ══════════════════════════════════════════════════════════════════════════════
async function incidencias(el) {
  const r = await api('GET', '/incidencias');
  if (!r || !r.ok) { el.innerHTML = `<div class="emp-empty"><p>Error al cargar incidencias</p></div>`; return; }
  const rows = r.data;
  if (!rows.length) {
    el.innerHTML = `<p class="emp-page-title">Mis Incidencias</p><div class="emp-empty"><div class="empty-icon">📋</div><p>Sin registros de incidencias aún</p></div>`;
    return;
  }
  const rowsHtml = rows.map(r => `
  <div class="inc-row">
    <div class="inc-row-header">
      <span class="inc-periodo">Período S${r.no_periodo}</span>
      <span class="inc-fechas">${r.fecha_inicio||''} – ${r.fecha_fin||''}</span>
    </div>
    <div class="inc-grid">
      <div class="inc-cell"><div class="val">${fmt(r.dias_pagados)}</div><div class="lbl">Días pagados</div></div>
      <div class="inc-cell"><div class="val" style="color:${r.faltas ? '#dc2626' : '#1e293b'}">${fmt(r.faltas||0)}</div><div class="lbl">Faltas</div></div>
      <div class="inc-cell"><div class="val">${fmt(r.horas_extras_total||0)}</div><div class="lbl">H. Extra</div></div>
      <div class="inc-cell"><div class="val">${r.despensa ? 'Sí' : 'No'}</div><div class="lbl">Despensa</div></div>
      <div class="inc-cell"><div class="val">${fmt(r.vacaciones_dias||0)}</div><div class="lbl">Vacaciones</div></div>
      <div class="inc-cell"><div class="val">${r.prima_dominical ? 'Sí' : 'No'}</div><div class="lbl">Prima dom.</div></div>
    </div>
    ${r.notas ? `<div style="margin-top:8px;font-size:12px;color:#64748b">Nota: ${esc(r.notas)}</div>` : ''}
  </div>`).join('');

  el.innerHTML = `<p class="emp-page-title">Mis Incidencias</p>${rowsHtml}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: LISTA DE RAYA
// ══════════════════════════════════════════════════════════════════════════════
// Catálogo de conceptos CONTPAQ i para mostrar en nómina
const PERC_CATALOG = [
  ['1',   'Sueldo'],
  ['3',   '7° Día'],
  ['4',   'T. Extra'],
  ['10',  'Prima dominical'],
  ['32',  'Despensa'],
  ['131', 'Fondo ahorro empresa'],
  ['12',  'Gratificación'],
  ['19',  'Vac. a tiempo'],
  ['20',  'Prima vacacional'],
  ['139', 'Bono instructor'],
  ['7',   'Bono eficiencia'],
  ['22',  'Prima vac. rep. $'],
  ['24',  'Aguinaldo'],
  ['15',  'Bono puntualidad'],
  ['140', 'Bono entregas'],
  ['21',  'Vac. rep. $'],
  ['133', 'Pago Fondo Ahorro'],
];
const DED_CATALOG = [
  ['41',  'ISR antes subs'],
  ['45',  'ISR (mes)'],
  ['52',  'IMSS'],
  ['67',  'Fondo ahorro'],
  ['99',  'Ajuste neto'],
  ['175', 'Fondo Ahorro Empresa'],
  ['14',  'Seg. vivienda Infonavit'],
  ['16',  'Préstamo Infonavit'],
  ['181', 'Infonavit CF'],
  ['64',  'Préstamo empresa'],
  ['32',  'Subs Empleo acred.'],
  ['43',  'ISR Art174'],
  ['55',  'ISR compensar'],
  ['104', 'ISR ajuste mensual'],
  ['105', 'ISR ajust. subsidio'],
  ['107', 'Ajuste Subsidio'],
];

// Busca el importe de un concepto por código en el objeto percepciones/deducciones
// Las claves del objeto son como "1 Sueldo", "19 Vacaciones a tiempo", etc.
function findConcepto(obj, code) {
  if (!obj) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (String(k).split(' ')[0] === String(code)) return v;
  }
  return null;
}

async function lista_raya(el) {
  const r = await api('GET', '/lista-raya');
  if (!r || !r.ok) { el.innerHTML = `<div class="emp-empty"><p>Error al cargar lista de raya</p></div>`; return; }
  const { periodo, datos, salario_diario, monto_base, monto_he,
          percepciones, deducciones, total_perc, total_ded, neto_pagar, ya_aclaracion } = r.data;

  if (!datos) {
    el.innerHTML = `
    <p class="emp-page-title">Lista de Raya</p>
    <div class="emp-empty">
      <div class="empty-icon">💰</div>
      <p>Sin datos de nómina disponibles aún</p>
    </div>`;
    return;
  }

  // ── Construir tabla de percepciones/deducciones si hay datos del PDF ──
  let nominaHtml = '';
  if (percepciones && Object.keys(percepciones).length > 0) {
    const percRows = PERC_CATALOG
      .map(([code, label]) => ({ label, val: findConcepto(percepciones, code) }))
      .filter(x => x.val != null && x.val !== 0);

    const dedRows = DED_CATALOG
      .map(([code, label]) => ({ label, val: findConcepto(deducciones, code) }))
      .filter(x => x.val != null && x.val !== 0);

    const percHtml = percRows.map(x => `
      <div class="nomina-row">
        <span class="nomina-concept">${esc(x.label)}</span>
        <span class="nomina-amount">${fmtMoney(x.val)}</span>
      </div>`).join('');

    const dedHtml = dedRows.map(x => `
      <div class="nomina-row ded">
        <span class="nomina-concept">${esc(x.label)}</span>
        <span class="nomina-amount" style="color:#dc2626">- ${fmtMoney(x.val)}</span>
      </div>`).join('');

    nominaHtml = `
    <div class="emp-card" style="margin-top:12px;padding:0;overflow:hidden">
      <div style="background:#f0fdf4;padding:12px 16px;border-bottom:1px solid #bbf7d0">
        <div style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.5px">Percepciones</div>
      </div>
      <div style="padding:8px 0">${percHtml || '<div style="padding:8px 16px;color:#94a3b8;font-size:13px">Sin percepciones registradas</div>'}</div>
      <div style="background:#f8f9fa;padding:10px 16px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between">
        <span style="font-weight:700;font-size:13px">Total Percepciones</span>
        <span style="font-weight:700;font-size:13px;color:#15803d">${fmtMoney(total_perc)}</span>
      </div>

      <div style="background:#fff5f5;padding:12px 16px;border-bottom:1px solid #fecaca">
        <div style="font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.5px">Deducciones</div>
      </div>
      <div style="padding:8px 0">${dedHtml || '<div style="padding:8px 16px;color:#94a3b8;font-size:13px">Sin deducciones registradas</div>'}</div>
      <div style="background:#f8f9fa;padding:10px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between">
        <span style="font-weight:700;font-size:13px">Total Deducciones</span>
        <span style="font-weight:700;font-size:13px;color:#dc2626">- ${fmtMoney(total_ded)}</span>
      </div>

      <div style="background:#eff6ff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:800;font-size:15px;color:#1d4ed8">Neto a Pagar</span>
        <span style="font-weight:800;font-size:18px;color:#1d4ed8">${fmtMoney(neto_pagar)}</span>
      </div>
    </div>`;
  } else {
    // Fallback: vista estimada
    const montoTotal = (monto_base || 0) + (monto_he || 0);
    nominaHtml = `
    ${salario_diario ? `
    <div class="raya-monto">
      <div class="monto-val">${fmtMoney(montoTotal)}</div>
      <div class="monto-lbl">Estimado base + horas extra</div>
    </div>` : ''}
    <div class="raya-grid">
      <div class="raya-item"><div class="rv">${fmt(datos.dias_pagados)}</div><div class="rl">Días pagados</div></div>
      <div class="raya-item"><div class="rv" style="color:${datos.faltas ? '#dc2626' : '#1e293b'}">${fmt(datos.faltas||0)}</div><div class="rl">Faltas</div></div>
      <div class="raya-item"><div class="rv">${fmt(datos.horas_extras_total||0)}</div><div class="rl">Horas extra</div></div>
      <div class="raya-item"><div class="rv">${datos.despensa ? 'Sí' : 'No'}</div><div class="rl">Despensa</div></div>
      <div class="raya-item"><div class="rv">${fmt(datos.vacaciones_dias||0)}</div><div class="rl">Días vacaciones</div></div>
      <div class="raya-item"><div class="rv">${datos.prima_dominical ? 'Sí' : 'No'}</div><div class="rl">Prima dominical</div></div>
      ${datos.bono_puntualidad_dias ? `<div class="raya-item"><div class="rv">${fmt(datos.bono_puntualidad_dias)}</div><div class="rl">Bono puntualidad</div></div>` : ''}
      ${datos.bono_eficiencia_dias  ? `<div class="raya-item"><div class="rv">${fmt(datos.bono_eficiencia_dias)}</div><div class="rl">Bono eficiencia</div></div>` : ''}
      ${datos.bono_instructor       ? `<div class="raya-item"><div class="rv">${fmt(datos.bono_instructor)}</div><div class="rl">Bono instructor</div></div>` : ''}
      ${datos.gratificacion         ? `<div class="raya-item"><div class="rv">${fmtMoney(datos.gratificacion)}</div><div class="rl">Gratificación</div></div>` : ''}
    </div>
    <p class="raya-disclaimer">* El monto mostrado es estimado. Los descuentos IMSS, INFONAVIT y retenciones no están incluidos.</p>`;
  }

  el.innerHTML = `
  <p class="emp-page-title">Lista de Raya</p>

  <div class="emp-card">
    <div class="raya-header">
      <div>
        <div class="raya-periodo">Período S${periodo.no_periodo}</div>
        <div class="raya-fechas">${periodo.fecha_inicio||''} – ${periodo.fecha_fin||''}</div>
      </div>
    </div>
    ${nominaHtml}
    ${datos.notas ? `<div style="font-size:12px;color:#64748b;margin-top:8px">Nota: ${esc(datos.notas)}</div>` : ''}
    ${ya_aclaracion
      ? `<div style="background:#fef3c7;border-radius:10px;padding:12px;font-size:13px;color:#92400e;margin-top:12px">Ya tienes una aclaración pendiente para este período. Te contactaremos pronto.</div>`
      : `<button class="emp-btn secondary" id="btn-aclaracion" style="margin-top:12px">✋ Solicitar aclaración</button>`
    }
    <div id="aclaracion-form" style="display:none;margin-top:14px">
      <div class="emp-form-group">
        <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Describe tu duda o discrepancia:</label>
        <textarea class="emp-textarea" id="acl-msg" placeholder="Ej: No se me registraron 2 horas extra del martes..."></textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button class="emp-btn" id="btn-acl-send" style="flex:1">Enviar</button>
        <button class="emp-btn secondary" id="btn-acl-cancel" style="flex:1">Cancelar</button>
      </div>
      <p class="emp-error" id="acl-err"></p>
    </div>
  </div>`;

  document.getElementById('btn-aclaracion')?.addEventListener('click', () => {
    document.getElementById('aclaracion-form').style.display = 'block';
    document.getElementById('btn-aclaracion').style.display = 'none';
  });
  document.getElementById('btn-acl-cancel')?.addEventListener('click', () => {
    document.getElementById('aclaracion-form').style.display = 'none';
    document.getElementById('btn-aclaracion').style.display = 'block';
  });
  document.getElementById('btn-acl-send')?.addEventListener('click', async () => {
    const msg = document.getElementById('acl-msg').value.trim();
    const err = document.getElementById('acl-err');
    err.textContent = '';
    if (!msg) { err.textContent = 'Escribe tu aclaración'; return; }
    const btn = document.getElementById('btn-acl-send');
    btn.disabled = true; btn.textContent = 'Enviando...';
    const res = await api('POST', '/aclaracion', { no_periodo: periodo.no_periodo, mensaje: msg });
    if (!res || !res.ok) {
      err.textContent = (res&&res.data&&res.data.error) || 'Error al enviar';
      btn.disabled = false; btn.textContent = 'Enviar';
      return;
    }
    // Recargar vista
    lista_raya(el);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: VACACIONES
// ══════════════════════════════════════════════════════════════════════════════
async function vacaciones(el) {
  const r = await api('GET', '/vacaciones');
  const lista = (r && r.ok && Array.isArray(r.data)) ? r.data : [];

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }).slice(0, 10);
  const minDate = today;

  const listaHtml = lista.length ? lista.map(v => `
  <div class="emp-card" style="padding:14px 16px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600">${fmtDate(v.fecha_inicio)} – ${fmtDate(v.fecha_fin)}</span>
      <span class="vac-badge ${v.status}">${v.status}</span>
    </div>
    <div style="font-size:12px;color:#64748b">${v.dias} día${v.dias !== 1 ? 's' : ''} · Solicitado: ${fmtDate(v.created_at)}</div>
    ${v.motivo ? `<div style="font-size:12px;color:#94a3b8;margin-top:4px">${esc(v.motivo)}</div>` : ''}
    ${v.notas_rh ? `<div style="font-size:12px;color:#1e40af;margin-top:6px;background:#eff6ff;border-radius:6px;padding:6px 8px">RH: ${esc(v.notas_rh)}</div>` : ''}
  </div>`).join('') : `<div class="emp-empty" style="padding:20px 0"><p>Sin solicitudes previas</p></div>`;

  el.innerHTML = `
  <p class="emp-page-title">Vacaciones</p>

  <div class="emp-card" id="vac-form-card">
    <div class="emp-card-title">Nueva solicitud</div>
    <div id="vac-success" class="emp-success"></div>
    <div class="emp-form-group">
      <label>Fecha de inicio</label>
      <input class="emp-input" type="date" id="vac-ini" min="${minDate}"/>
    </div>
    <div class="emp-form-group">
      <label>Fecha de regreso (último día de vacaciones)</label>
      <input class="emp-input" type="date" id="vac-fin" min="${minDate}"/>
    </div>
    <div class="emp-form-group">
      <label>Motivo (opcional)</label>
      <input class="emp-input" type="text" id="vac-motivo" placeholder="Ej: Vacaciones familiares"/>
    </div>
    <p class="emp-error" id="vac-err"></p>
    <button class="emp-btn" id="btn-vac-send">Solicitar vacaciones</button>
  </div>

  <div style="margin-top:20px">
    <p style="font-size:14px;font-weight:600;color:#475569;margin-bottom:10px">Mis solicitudes</p>
    ${listaHtml}
  </div>`;

  document.getElementById('btn-vac-send').addEventListener('click', async () => {
    const ini = document.getElementById('vac-ini').value;
    const fin = document.getElementById('vac-fin').value;
    const motivo = document.getElementById('vac-motivo').value.trim();
    const err = document.getElementById('vac-err');
    const suc = document.getElementById('vac-success');
    err.textContent = ''; suc.classList.remove('show');

    if (!ini || !fin) { err.textContent = 'Selecciona las fechas'; return; }
    if (fin < ini) { err.textContent = 'La fecha de fin no puede ser antes del inicio'; return; }

    const btn = document.getElementById('btn-vac-send');
    btn.disabled = true; btn.textContent = 'Enviando...';
    const res = await api('POST', '/vacaciones', { fecha_inicio: ini, fecha_fin: fin, motivo });
    btn.disabled = false; btn.textContent = 'Solicitar vacaciones';
    if (!res || !res.ok) {
      err.textContent = (res&&res.data&&res.data.error) || 'Error al enviar';
      return;
    }
    const { dias } = res.data;
    suc.textContent = `Solicitud enviada correctamente (${dias} día${dias !== 1 ? 's' : ''}). RH te confirmará pronto.`;
    suc.classList.add('show');
    document.getElementById('vac-ini').value = '';
    document.getElementById('vac-fin').value = '';
    document.getElementById('vac-motivo').value = '';
    // Recargar lista
    setTimeout(() => vacaciones(el), 1500);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: EVALUACIONES
// ══════════════════════════════════════════════════════════════════════════════
async function evaluaciones(el) {
  el.innerHTML = `<p class="emp-page-title">⭐ Mis Evaluaciones</p><div class="emp-empty"><div class="empty-icon">⏳</div><p>Cargando...</p></div>`;
  const r = await api('GET', '/evaluaciones-historial');
  if (!r || !r.ok) {
    el.innerHTML = `<p class="emp-page-title">⭐ Mis Evaluaciones</p><div class="emp-empty"><p>Error al cargar datos</p></div>`;
    return;
  }
  const { historial = [], sal_diario = 0 } = r.data || {};

  if (!historial.length) {
    el.innerHTML = `<p class="emp-page-title">⭐ Mis Evaluaciones</p><div class="emp-empty"><div class="empty-icon">⭐</div><p>Sin historial de evaluaciones</p></div>`;
    return;
  }

  // Años disponibles para filtro
  const years = [...new Set(historial.map(d => d.year))].sort((a,b) => b - a);
  const selYear = window._evalYear || years[0];
  window._evalYear = selYear;
  const filtered = historial.filter(d => d.year === selYear);

  // Gráfica de barras (CSS) — días de bono por mes
  const maxBono = 3;
  const chartBars = filtered.slice().reverse().map(d => {
    const dias  = d.eval ? d.eval.total_bono : (d.bono_prod_dias || 0);
    const pct   = Math.min(100, (dias / maxBono) * 100);
    const color = dias >= 2.5 ? '#059669' : dias >= 1.5 ? '#f59e0b' : dias > 0 ? '#3b82f6' : '#e5e7eb';
    const label = d.month_name.slice(0, 3);
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:36px;">
        <div style="font-size:10px;font-weight:700;color:${dias>0?color:'#9ca3af'};">${dias > 0 ? dias.toFixed(1) : '—'}</div>
        <div style="width:28px;background:#f1f5f9;border-radius:4px;height:80px;display:flex;align-items:flex-end;overflow:hidden;">
          <div style="width:100%;height:${pct}%;background:${color};border-radius:4px;transition:height .3s;"></div>
        </div>
        <div style="font-size:10px;color:#64748b;">${label}</div>
      </div>`;
  }).join('');

  // Cards por mes
  const cards = filtered.map(d => {
    const ev = d.eval;
    const hasEval = !!ev;
    const bonoProdFmt = d.bono_prod_importe > 0
      ? `<span style="font-size:11px;color:#6b7280;">Bono pagado: $${d.bono_prod_importe.toLocaleString('es-MX', {minimumFractionDigits:2})}</span>`
      : '';

    let evalContent;
    if (!hasEval) {
      evalContent = `<div style="font-size:12px;color:#9ca3af;font-style:italic;">Sin evaluación este mes</div>`;
    } else {
      const pct   = ev.score_pct?.toFixed(1) || '—';
      const color = ev.score_pct >= 80 ? '#059669' : ev.score_pct >= 60 ? '#f59e0b' : '#dc2626';
      const diasRows = [
        ev.dias_reclamos > 0 ? `<div class="eval-dias-row"><span>Días Reclamos</span><span style="font-weight:700;color:#2563eb;">+${ev.dias_reclamos.toFixed(2)} día(s)</span></div>` : '',
        ev.dias_calidad  > 0 ? `<div class="eval-dias-row"><span>Días Calidad</span><span style="font-weight:700;color:#2563eb;">+${ev.dias_calidad.toFixed(2)} día(s)</span></div>` : '',
        `<div class="eval-dias-row"><span>Evaluación (${pct}%)</span><span style="font-weight:700;color:${color};">+${ev.eval_days.toFixed(2)} día(s)</span></div>`,
        `<div class="eval-dias-row" style="border-top:1px solid #e2e8f0;margin-top:4px;padding-top:6px;">
          <span style="font-weight:700;">Total días bono</span>
          <span style="font-weight:800;font-size:15px;color:${ev.total_bono>=2?'#059669':'#f59e0b'};">${ev.total_bono.toFixed(2)}</span>
        </div>`
      ].filter(Boolean).join('');

      evalContent = `
        <div style="margin-bottom:8px;">${diasRows}</div>
        ${bonoProdFmt}
        <button class="emp-btn" style="margin-top:10px;padding:7px 16px;font-size:12px;"
          onclick="evalVerDetalle(${JSON.stringify(ev).replace(/"/g,'&quot;')})">
          🔍 Ver Evaluación
        </button>`;
    }

    const monthColor = hasEval ? '#f0fdf4' : '#fafafa';
    const borderColor = hasEval ? '#bbf7d0' : '#e2e8f0';
    return `
      <div class="emp-card" style="background:${monthColor};border:1px solid ${borderColor};margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:15px;font-weight:700;color:#1e293b;">${d.month_name} ${d.year}</div>
          ${hasEval
            ? `<span style="background:#059669;color:#fff;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:600;">✓ Evaluado</span>`
            : `<span style="background:#e5e7eb;color:#9ca3af;border-radius:12px;padding:2px 10px;font-size:11px;">Sin evaluación</span>`}
        </div>
        ${evalContent}
        ${!hasEval && bonoProdFmt ? `<div style="margin-top:4px;">${bonoProdFmt}</div>` : ''}
      </div>`;
  }).join('');

  const yearOpts = years.map(y => `<option value="${y}" ${y===selYear?'selected':''}>${y}</option>`).join('');

  el.innerHTML = `
    <p class="emp-page-title">⭐ Mis Evaluaciones</p>

    <div class="emp-card" style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <label style="font-size:13px;font-weight:600;">Año:</label>
        <select class="emp-select" style="width:auto;padding:6px 12px;" onchange="window._evalYear=Number(this.value);evaluaciones(document.getElementById('emp-main'))">
          ${yearOpts}
        </select>
      </div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:8px;">Días de bono por mes</div>
      <div style="display:flex;gap:6px;align-items:flex-end;overflow-x:auto;padding-bottom:4px;">
        ${chartBars || '<span style="color:#9ca3af;font-size:12px;">Sin datos</span>'}
      </div>
      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
        <span style="font-size:10px;color:#059669;">■ ≥2.5 días</span>
        <span style="font-size:10px;color:#f59e0b;">■ 1.5–2.4 días</span>
        <span style="font-size:10px;color:#3b82f6;">■ &lt;1.5 días</span>
        <span style="font-size:10px;color:#9ca3af;">■ Sin datos</span>
      </div>
    </div>

    ${cards || '<div class="emp-empty"><p>Sin datos para este año</p></div>'}`;
}

function evalVerDetalle(ev) {
  const pct   = ev.score_pct?.toFixed(1) || '—';
  const color = ev.score_pct >= 80 ? '#059669' : ev.score_pct >= 60 ? '#f59e0b' : '#dc2626';

  const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  const itemsHtml = (ev.items || []).map(it => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;gap:8px;">
      <div style="font-size:12px;color:#334155;flex:1;">${esc(it.name)}</div>
      <div style="font-size:16px;color:#f59e0b;white-space:nowrap;">${stars(it.stars)}</div>
    </div>`).join('');

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:20px;width:100%;max-width:440px;max-height:85vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:16px;font-weight:700;">Evaluación — ${esc(ev.session_name || '')}</div>
        <button onclick="this.closest('.eval-modal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;">✕</button>
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:16px;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Resultado final</div>
        <div style="font-size:32px;font-weight:800;color:${color};">${pct}%</div>
        <div style="font-size:12px;color:#64748b;">${ev.points_obtained?.toFixed(1)} / ${ev.total_points} pts → ${ev.eval_days?.toFixed(2)} días de bono por evaluación</div>
      </div>
      <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;">Criterios evaluados</div>
      ${itemsHtml}
    </div>`;
  modal.classList.add('eval-modal');
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('button').onclick = () => modal.remove();
  document.body.appendChild(modal);
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: QUEJA ANÓNIMA
// ══════════════════════════════════════════════════════════════════════════════
function queja(el) {
  el.innerHTML = `
  <p class="emp-page-title">Queja Anónima</p>

  <div class="emp-card" style="background:#eff6ff;border:none;margin-bottom:14px">
    <div style="font-size:13px;color:#1e40af;line-height:1.6">
      <strong>Confidencialidad total.</strong> Tu queja no incluye tu nombre ni número de nómina. Solo RH puede ver el contenido.
    </div>
  </div>

  <div class="emp-card">
    <div id="queja-success" class="emp-success"></div>
    <div class="emp-form-group">
      <label>Categoría</label>
      <select class="emp-select" id="qj-cat">
        <option value="general">General</option>
        <option value="acoso">Acoso o maltrato</option>
        <option value="seguridad">Seguridad e higiene</option>
        <option value="nomina">Nómina / pagos</option>
        <option value="instalaciones">Instalaciones</option>
        <option value="otro">Otro</option>
      </select>
    </div>
    <div class="emp-form-group">
      <label>Describe tu queja o sugerencia</label>
      <textarea class="emp-textarea" id="qj-msg" placeholder="Describe la situación con el mayor detalle posible..." style="min-height:140px"></textarea>
    </div>
    <p class="emp-error" id="qj-err"></p>
    <button class="emp-btn" id="btn-qj">Enviar queja anónima</button>
  </div>`;

  document.getElementById('btn-qj').addEventListener('click', async () => {
    const categoria = document.getElementById('qj-cat').value;
    const mensaje   = document.getElementById('qj-msg').value.trim();
    const err = document.getElementById('qj-err');
    const suc = document.getElementById('queja-success');
    err.textContent = ''; suc.classList.remove('show');
    if (!mensaje) { err.textContent = 'Escribe tu queja antes de enviar'; return; }
    const btn = document.getElementById('btn-qj');
    btn.disabled = true; btn.textContent = 'Enviando...';
    const res = await api('POST', '/queja', { categoria, mensaje });
    btn.disabled = false; btn.textContent = 'Enviar queja anónima';
    if (!res || !res.ok) {
      err.textContent = (res&&res.data&&res.data.error) || 'Error al enviar';
      return;
    }
    suc.textContent = 'Tu queja fue recibida. Gracias por tu confianza.';
    suc.classList.add('show');
    document.getElementById('qj-msg').value = '';
    document.getElementById('qj-cat').value = 'general';
  });
}

// ── Inicialización ────────────────────────────────────────────────────────────
tryRestore();
render();
