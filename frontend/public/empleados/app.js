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

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
}
function showInstallBanner() {
  if (isStandalone()) return; // ya está instalada, no mostrar
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  showInstallBanner();
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
  { id: 'mi_rol',       icon: '📅', label: 'Mi ROL' },
  { id: 'incidencias',  icon: '📋', label: 'Incidencias' },
  { id: 'lista_raya',   icon: '💰', label: 'Lista de Raya' },
  { id: 'vacaciones',   icon: '🏖️',  label: 'Vacaciones' },
  { id: 'evaluaciones', icon: '⭐', label: 'Evaluaciones' },
  { id: 'queja',        icon: '📝', label: 'Queja Anónima' },
];
// Secciones en bottom nav (móvil) — máx 4 primarias + botón Más
const NAV_PRIMARY = ['perfil', 'mi_rol', 'lista_raya', 'vacaciones'];
const NAV_MORE    = ['incidencias', 'evaluaciones', 'queja'];

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
  document.querySelectorAll('.emp-nav-item[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === section);
  });
  // Botón "Más" activo si la sección actual está en NAV_MORE
  const btnMore = document.getElementById('btn-nav-more');
  if (btnMore) btnMore.classList.toggle('active', NAV_MORE.includes(section));
  document.querySelectorAll('.emp-sidebar-item, .emp-drawer-item').forEach(el => {
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
  const views = { perfil, mi_rol, incidencias, lista_raya, vacaciones, evaluaciones, queja };
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
  if (_installPrompt) showInstallBanner();
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
  const inMore = NAV_MORE.includes(state.section);

  const primaryItems = NAV_PRIMARY.map(id => {
    const s = SECTIONS.find(x => x.id === id);
    return `<button class="emp-nav-item${state.section === id ? ' active' : ''}" data-nav="${id}">
      <span class="nav-icon">${s.icon}</span>
      <span>${s.label}</span>
    </button>`;
  }).join('');

  const moreItems = NAV_MORE.map(id => {
    const s = SECTIONS.find(x => x.id === id);
    return `<button class="emp-drawer-item${state.section === id ? ' active' : ''}" data-nav="${id}">
      <span class="si-icon">${s.icon}</span>${s.label}
    </button>`;
  }).join('');

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
        <div class="brand-text">Portal del Empleado</div>
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

    <!-- Bottom nav (móvil) — 4 primarios + Más -->
    <nav class="emp-bottom-nav">
      ${primaryItems}
      <button class="emp-nav-item${inMore ? ' active' : ''}" id="btn-nav-more">
        <span class="nav-icon">···</span>
        <span>Más</span>
      </button>
    </nav>

    <!-- Drawer "Más" -->
    <div class="emp-drawer-overlay" id="drawer-overlay" style="display:none"></div>
    <div class="emp-drawer" id="nav-drawer" style="display:none">
      <div class="emp-drawer-handle"></div>
      <div class="emp-drawer-title">Más opciones</div>
      ${moreItems}
      <button class="emp-drawer-logout" id="btn-logout-drawer">Cerrar sesión</button>
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

function openDrawer() {
  document.getElementById('nav-drawer').style.display = 'flex';
  document.getElementById('drawer-overlay').style.display = 'block';
  requestAnimationFrame(() => {
    document.getElementById('nav-drawer').classList.add('open');
  });
}
function closeDrawer() {
  const d = document.getElementById('nav-drawer');
  d.classList.remove('open');
  setTimeout(() => {
    d.style.display = 'none';
    document.getElementById('drawer-overlay').style.display = 'none';
  }, 260);
}

function bindLayout() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => { closeDrawer(); navigate(el.dataset.nav); });
  });
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-logout-d')?.addEventListener('click', logout);
  document.getElementById('btn-logout-drawer')?.addEventListener('click', logout);
  document.getElementById('btn-nav-more')?.addEventListener('click', openDrawer);
  document.getElementById('drawer-overlay')?.addEventListener('click', closeDrawer);
  if (_installPrompt) showInstallBanner();
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
  const initials = (d.full_name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  el.innerHTML = `
  <p class="emp-page-title">Mi Perfil</p>

  <!-- Header con avatar -->
  <div class="emp-card" style="padding:0;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:24px 20px;text-align:center;color:#fff">
      <div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.2);display:inline-flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;letter-spacing:1px;margin-bottom:8px">${initials}</div>
      <div style="font-size:18px;font-weight:700">${esc(d.full_name)}</div>
      <div style="font-size:13px;opacity:.8;margin-top:2px">${esc(d.position||'—')} &middot; ${esc(d.department||'—')}</div>
      <div style="font-size:12px;opacity:.6;margin-top:2px">No. ${esc(d.employee_number)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #e2e8f0">
      <div style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Turno catalogo</div>
        <div style="font-size:14px;font-weight:700;color:#1e293b;margin-top:2px">${esc(d.shift||'—')}</div>
      </div>
      <div style="padding:12px 16px;text-align:center">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Turno semanal</div>
        <div style="font-size:14px;font-weight:700;color:${d.turno_asistencia ? '#059669' : '#94a3b8'};margin-top:2px">${esc(d.turno_asistencia||'Sin asignar')}</div>
      </div>
    </div>
  </div>

  <!-- Datos personales -->
  <div class="emp-card">
    <div class="emp-card-title">Datos personales</div>
    <div class="emp-field"><label>RFC</label><span>${esc(d.rfc||'—')}</span></div>
    <div class="emp-field"><label>CURP</label><span style="font-size:11px;word-break:break-all">${esc(d.curp||'—')}</span></div>
    <div class="emp-field"><label>NSS</label><span>${esc(d.nss||'—')}</span></div>
  </div>

  <!-- Info laboral -->
  <div class="emp-card">
    <div class="emp-card-title">Informacion laboral</div>
    <div class="emp-field"><label>Fecha de ingreso</label><span>${fmtDate(d.start_date)}</span></div>
    <div class="emp-field"><label>Salario diario</label><span>${d.salary_daily ? fmtMoney(d.salary_daily) : '—'}</span></div>
  </div>

  <div class="emp-card" style="background:#f0f9ff;border:1px solid #bae6fd">
    <div style="font-size:12px;color:#0369a1;line-height:1.6">
      Sitio en prueba. Si necesitas actualizar tus datos o tienes alguna duda, acude a Recursos Humanos.
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: MI ROL — asistencia semanal en tiempo real
// ══════════════════════════════════════════════════════════════════════════════
const _rolStatusLabel = {
  asistencia: 'Asistencia', labora: 'Asistencia', retardo: 'Retardo', falta: 'Falta',
  vacacion: 'Vacacion', vacaciones: 'Vacacion', incapacidad: 'Incapacidad',
  permiso: 'Permiso', descanso: 'Descanso', festivo: 'Festivo',
  programado: 'Programado', pendiente: '—', vacio: '—',
};
const _rolStatusColor = {
  asistencia: '#059669', labora: '#059669', retardo: '#d97706', falta: '#dc2626',
  vacacion: '#2563eb', vacaciones: '#2563eb', incapacidad: '#7c3aed',
  permiso: '#0891b2', descanso: '#94a3b8', festivo: '#ea580c',
  programado: '#94a3b8', pendiente: '#cbd5e1', vacio: '#cbd5e1',
};

async function mi_rol(el) {
  el.innerHTML = '<p class="emp-page-title">Mi ROL</p><div class="emp-empty"><div class="empty-icon">...</div><p>Cargando...</p></div>';
  const r = await api('GET', '/mi-rol');
  if (!r || !r.ok) { el.innerHTML = `<p class="emp-page-title">Mi ROL</p><div class="emp-empty"><p>Error al cargar</p></div>`; return; }
  const { week_start, shift_name, days } = r.data;

  const dayRows = days.map(d => {
    const label = _rolStatusLabel[d.status] || d.status;
    const color = _rolStatusColor[d.status] || '#64748b';
    const isRed = d.status === 'falta';
    const teInfo = d.te_hours ? `<span style="color:#059669;font-weight:700;margin-left:6px">+${d.te_hours}h TE</span>` : '';
    const holidayTag = d.is_holiday ? `<span style="font-size:10px;color:#ea580c;margin-left:4px">(${esc(d.holiday_name||'Festivo')})</span>` : '';
    const bdayTag = d.birthday ? '<span style="font-size:10px;margin-left:4px">🎂</span>' : '';
    const clarifTag = d.has_clarification ? '<span style="font-size:10px;color:#d97706;margin-left:4px">Aclaracion pendiente</span>' : '';
    const canClarif = !d.is_future && !d.has_clarification && d.status !== 'descanso' && d.status !== 'programado' && d.status !== 'pendiente';

    return `<tr style="${d.is_future ? 'opacity:.5' : ''}">
      <td style="padding:10px 12px;white-space:nowrap">
        <div style="font-weight:700;font-size:14px">${esc(d.day_name)}</div>
        <div style="font-size:12px;color:#64748b">${d.day_num}</div>
      </td>
      <td style="padding:10px 8px">
        <span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;color:#fff;background:${color}${isRed ? ';animation:pulse-red 1.5s infinite' : ''}">${label}</span>
        ${teInfo}${holidayTag}${bdayTag}${clarifTag}
        ${d.notes ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${esc(d.notes)}</div>` : ''}
      </td>
      <td style="padding:10px 8px;text-align:center">
        ${canClarif ? `<button onclick="_rolAclaracion('${d.date}')" style="background:none;border:1px solid #cbd5e1;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:#475569">Aclarar</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
  <p class="emp-page-title">Mi ROL</p>
  <div class="emp-card" style="padding:12px 16px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:13px;font-weight:700;color:#1e293b">Semana del ${week_start}</div>
        ${shift_name ? `<div style="font-size:12px;color:#64748b">Turno: ${esc(shift_name)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span style="font-size:10px;padding:3px 8px;border-radius:10px;background:#059669;color:#fff">Asist.</span>
        <span style="font-size:10px;padding:3px 8px;border-radius:10px;background:#d97706;color:#fff">Retardo</span>
        <span style="font-size:10px;padding:3px 8px;border-radius:10px;background:#dc2626;color:#fff">Falta</span>
        <span style="font-size:10px;padding:3px 8px;border-radius:10px;background:#2563eb;color:#fff">Vac.</span>
      </div>
    </div>
  </div>
  <div class="emp-card" style="padding:0;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
        <th style="padding:8px 12px;text-align:left;font-size:12px">Dia</th>
        <th style="padding:8px 8px;text-align:left;font-size:12px">Incidencia</th>
        <th style="padding:8px 8px;text-align:center;font-size:12px">Accion</th>
      </tr></thead>
      <tbody>${dayRows}</tbody>
    </table>
  </div>
  <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:8px">Sitio en prueba, cualquier aclaracion o inconsistencia validar con RHH</div>
  <style>@keyframes pulse-red{0%,100%{opacity:1}50%{opacity:.6}}</style>`;
}

async function _rolAclaracion(date) {
  const msg = prompt('Describe tu aclaracion para este dia:');
  if (!msg || !msg.trim()) return;
  const r = await api('POST', '/mi-rol/aclaracion', { date, mensaje: msg.trim() });
  if (r && r.ok) {
    alert('Aclaracion enviada. RHH la revisara.');
    const el = document.getElementById('emp-main-content');
    if (el) mi_rol(el);
  } else {
    alert((r?.data?.error) || 'Error al enviar');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA: MIS INCIDENCIAS
// ══════════════════════════════════════════════════════════════════════════════
async function incidencias(el) {
  const [rInc, rVac] = await Promise.all([
    api('GET', '/incidencias'),
    api('GET', '/vacaciones'),
  ]);
  if (!rInc || !rInc.ok) { el.innerHTML = `<div class="emp-empty"><p>Error al cargar incidencias</p></div>`; return; }
  const rows    = Array.isArray(rInc.data) ? rInc.data : (rInc.data?.rows || []);
  const vacInfo = Array.isArray(rInc.data) ? null : (rInc.data?.vac_info || null);
  const vacList = (rVac && rVac.ok && Array.isArray(rVac.data)) ? rVac.data : [];
  if (!rows.length) {
    el.innerHTML = `<p class="emp-page-title">Mis Incidencias</p><div class="emp-empty"><div class="empty-icon">📋</div><p>Sin registros de incidencias</p></div>`;
    return;
  }

  // Totales
  let totFaltas = 0, totHE = 0, totVac = 0;
  rows.forEach(r => { totFaltas += (r.faltas||0); totHE += (r.horas_extras_total||0); totVac += (r.vacaciones_dias||0); });

  // Vacation breakdown
  const vacAprobadas = vacList.filter(v => v.status === 'aprobado');
  const vacPendientes = vacList.filter(v => v.status === 'pendiente');
  const diasTomados = vacAprobadas.reduce((s, v) => s + (v.dias || 0), 0);
  const diasProg = vacPendientes.reduce((s, v) => s + (v.dias || 0), 0);

  const tblRows = rows.map(r => `<tr>
    <td style="white-space:nowrap;font-weight:600">S${r.no_periodo}</td>
    <td style="font-size:11px;color:#64748b;white-space:nowrap">${r.fecha_inicio||''}<br>${r.fecha_fin||''}</td>
    <td style="text-align:center">${fmt(r.dias_pagados)}</td>
    <td style="text-align:center;${r.faltas ? 'color:#dc2626;font-weight:700' : ''}">${fmt(r.faltas||0)}</td>
    <td style="text-align:center">${fmt(r.horas_extras_total||0)}</td>
    <td style="text-align:center">${fmt(r.vacaciones_dias||0)}</td>
    <td style="text-align:center">${r.despensa ? 'Si' : '—'}</td>
  </tr>`).join('');

  el.innerHTML = `
  <p class="emp-page-title">Mis Incidencias</p>

  ${vacInfo ? `<div class="emp-card" style="padding:12px 16px">
    <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;text-align:center">
      <div><div style="font-size:20px;font-weight:800;color:#1e40af">${vacInfo.dias_disponibles ?? '—'}</div><div style="font-size:10px;color:#64748b">Dias derecho</div></div>
      <div><div style="font-size:20px;font-weight:800;color:#059669">${diasTomados}</div><div style="font-size:10px;color:#64748b">Vac. tomadas</div></div>
      <div><div style="font-size:20px;font-weight:800;color:#d97706">${diasProg}</div><div style="font-size:10px;color:#64748b">Vac. programadas</div></div>
      <div><div style="font-size:20px;font-weight:800;color:${(vacInfo.dias_restantes??0)>0?'#0369a1':'#dc2626'}">${vacInfo.dias_restantes ?? '—'}</div><div style="font-size:10px;color:#64748b">Restantes</div></div>
    </div>
  </div>` : ''}

  <div class="emp-card" style="padding:0;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
        <th style="padding:8px 10px;text-align:left">Sem</th>
        <th style="padding:8px 6px;text-align:left">Periodo</th>
        <th style="padding:8px 6px;text-align:center">Dias pag.</th>
        <th style="padding:8px 6px;text-align:center">Faltas</th>
        <th style="padding:8px 6px;text-align:center">H.Extra</th>
        <th style="padding:8px 6px;text-align:center">Vac.</th>
        <th style="padding:8px 6px;text-align:center">Desp.</th>
      </tr></thead>
      <tbody>${tblRows}</tbody>
      <tfoot><tr style="background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1">
        <td colspan="3" style="padding:8px 10px">Totales</td>
        <td style="text-align:center;${totFaltas?'color:#dc2626':''}">${fmt(totFaltas)}</td>
        <td style="text-align:center">${fmt(totHE)}</td>
        <td style="text-align:center">${fmt(totVac)}</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>

  <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:8px">Sitio en prueba, cualquier aclaracion o inconsistencia validar con RHH</div>`;
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
  <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#92400e">Sitio en prueba, cualquier aclaracion o inconsistencia validar con RHH.</div>

  <div class="emp-card">
    <div class="raya-header">
      <div>
        <div class="raya-periodo">Período S${periodo.no_periodo} (ultima semana cargada)</div>
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
// VISTA: VACACIONES — estilo "boarding pass" con calendario interactivo
// ══════════════════════════════════════════════════════════════════════════════

// Estado del calendario de vacaciones
let _vacCal = { holidays: [], birthMD: null, solicitudes: [], selStart: null, selEnd: null, month: null, year: null, diasRestantes: 0 };
const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_CORTO = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

function _vacDayType(iso) {
  const dt = new Date(iso + 'T12:00:00');
  const dow = dt.getDay();
  if (dow === 0) return 'descanso';
  if (_vacCal.holidays.some(h => h.date === iso)) return 'festivo';
  if (_vacCal.birthMD && iso.slice(5) === _vacCal.birthMD) return 'cumple';
  // Ya solicitado?
  if (_vacCal.solicitudes.some(s => s.fecha_inicio <= iso && s.fecha_fin >= iso)) return 'ocupado';
  return 'habil';
}

function _vacBuildCalendar() {
  const y = _vacCal.year, m = _vacCal.month;
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

  const currentYear = new Date().getFullYear();
  const canPrev = !(y === currentYear && m === 0);
  const canNext = !(y === currentYear && m === 11);
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <button onclick="_vacNavMonth(-1)" ${!canPrev?'disabled':''} style="background:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;cursor:${canPrev?'pointer':'default'};font-size:16px;opacity:${canPrev?'1':'0.3'}">&lt;</button>
    <div style="font-size:15px;font-weight:700;color:#1e293b">${MESES_NOMBRE[m]} ${y}</div>
    <button onclick="_vacNavMonth(1)" ${!canNext?'disabled':''} style="background:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;cursor:${canNext?'pointer':'default'};font-size:16px;opacity:${canNext?'1':'0.3'}">&gt;</button>
  </div>`;

  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">';
  // Headers
  for (const d of DIAS_CORTO) {
    html += `<div style="font-size:10px;font-weight:700;color:${d==='Do'?'#dc2626':'#64748b'};padding:4px 0">${d}</div>`;
  }
  // Blanks
  for (let i = 0; i < firstDay; i++) html += '<div></div>';
  // Days
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const type = _vacDayType(iso);
    const isPast = iso < today;
    const isSelected = _vacCal.selStart && _vacCal.selEnd && iso >= _vacCal.selStart && iso <= _vacCal.selEnd;
    const isStart = iso === _vacCal.selStart;
    const isEnd = iso === _vacCal.selEnd;
    const isOnlyStart = _vacCal.selStart === iso && !_vacCal.selEnd;

    let bg = '#fff', color = '#1e293b', border = '1px solid #f1f5f9', opacity = '1', cursor = 'pointer', extra = '';
    if (isPast) { color = '#cbd5e1'; cursor = 'default'; opacity = '0.5'; }
    else if (type === 'descanso') { bg = '#fee2e2'; color = '#991b1b'; cursor = 'default'; extra = 'Do'; }
    else if (type === 'festivo') { bg = '#fef3c7'; color = '#92400e'; cursor = 'default'; extra = _vacCal.holidays.find(h=>h.date===iso)?.name?.slice(0,8)||'Festivo'; }
    else if (type === 'cumple') { bg = '#fce7f3'; color = '#9d174d'; cursor = 'default'; extra = 'Cumple'; }
    else if (type === 'ocupado') { bg = '#e0e7ff'; color = '#4338ca'; cursor = 'default'; extra = 'Solic.'; }

    if (isSelected && !isPast) {
      if (type === 'habil') { bg = '#2563eb'; color = '#fff'; border = '1px solid #1d4ed8'; }
    }
    if (isOnlyStart && !isPast) { bg = '#2563eb'; color = '#fff'; border = '2px solid #1e40af'; }
    if (isStart && _vacCal.selEnd && type === 'habil') { border = '2px solid #1e40af'; }
    if (isEnd && type === 'habil') { border = '2px solid #1e40af'; }

    const canClick = !isPast && type === 'habil' && _vacCal.diasRestantes > 0;
    html += `<div onclick="${canClick ? `_vacSelectDay('${iso}')` : ''}"
      style="position:relative;padding:6px 2px;border-radius:8px;background:${bg};color:${color};border:${border};
      opacity:${opacity};cursor:${cursor};font-size:13px;font-weight:${isSelected?'700':'500'};min-height:38px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all .15s">
      <span>${d}</span>
      ${extra ? `<span style="font-size:7px;line-height:1;margin-top:1px;white-space:nowrap">${extra}</span>` : ''}
    </div>`;
  }
  html += '</div>';

  // Leyenda
  html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:10px;color:#64748b">
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;border-radius:3px;background:#fee2e2;border:1px solid #fca5a5"></span> Domingo</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;border-radius:3px;background:#fef3c7;border:1px solid #fcd34d"></span> Festivo</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;border-radius:3px;background:#fce7f3;border:1px solid #f9a8d4"></span> Cumpleaños</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;border-radius:3px;background:#e0e7ff;border:1px solid #a5b4fc"></span> Solicitado</span>
    <span style="display:flex;align-items:center;gap:3px"><span style="width:10px;height:10px;border-radius:3px;background:#2563eb"></span> Seleccion</span>
  </div>`;

  document.getElementById('vac-calendar').innerHTML = html;
  _vacUpdateSummary();
}

function _vacNavMonth(dir) {
  const currentYear = new Date().getFullYear();
  let newMonth = _vacCal.month + dir;
  let newYear = _vacCal.year;
  if (newMonth > 11) { newMonth = 0; newYear++; }
  if (newMonth < 0)  { newMonth = 11; newYear--; }
  // Bloquear navegacion fuera del año actual
  if (newYear !== currentYear) return;
  _vacCal.month = newMonth;
  _vacCal.year = newYear;
  _vacBuildCalendar();
}

function _vacSelectDay(iso) {
  if (_vacCal.diasRestantes <= 0) return;
  if (!_vacCal.selStart || _vacCal.selEnd) {
    _vacCal.selStart = iso;
    _vacCal.selEnd = null;
  } else {
    if (iso < _vacCal.selStart) {
      _vacCal.selEnd = _vacCal.selStart;
      _vacCal.selStart = iso;
    } else {
      _vacCal.selEnd = iso;
    }
  }
  _vacBuildCalendar();
}

function _vacUpdateSummary() {
  const box = document.getElementById('vac-summary');
  if (!box) return;
  if (!_vacCal.selStart) {
    box.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:16px;font-size:13px">Selecciona fecha de inicio en el calendario</div>';
    return;
  }
  if (!_vacCal.selEnd) {
    box.innerHTML = `<div style="text-align:center;color:#64748b;padding:16px;font-size:13px">Inicio: <strong>${_vacCal.selStart}</strong> — ahora selecciona la fecha de fin</div>`;
    return;
  }
  // Calcular desglose
  const d1 = new Date(_vacCal.selStart + 'T12:00:00');
  const d2 = new Date(_vacCal.selEnd + 'T12:00:00');
  const totalNat = Math.round((d2 - d1) / 86400000) + 1;
  let vacDias = 0, festivos = 0, domingos = 0, cumples = 0;
  const festNames = [];
  for (let i = 0; i < totalNat; i++) {
    const dt = new Date(d1.getTime() + i * 86400000);
    const iso = dt.toISOString().slice(0, 10);
    const type = _vacDayType(iso);
    if (type === 'descanso') domingos++;
    else if (type === 'festivo') { festivos++; const h = _vacCal.holidays.find(x=>x.date===iso); if(h) festNames.push(h.name); }
    else if (type === 'cumple') cumples++;
    else vacDias++;
  }

  const parts = [];
  parts.push(`<span style="font-size:28px;font-weight:800;color:#1e40af">${vacDias}</span> <span style="font-size:13px;color:#475569">dias de vacaciones</span>`);

  const extras = [];
  if (festivos) extras.push(`<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-size:11px">${festivos} festivo${festivos>1?'s':''}</span>`);
  if (domingos) extras.push(`<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:11px">${domingos} domingo${domingos>1?'s':''}</span>`);
  if (cumples) extras.push(`<span style="background:#fce7f3;color:#9d174d;padding:2px 8px;border-radius:12px;font-size:11px">${cumples} cumpleaños</span>`);

  box.innerHTML = `
  <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;overflow:hidden">
    <!-- Boarding pass header -->
    <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:14px 18px;color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.7">Salida</div>
          <div style="font-size:18px;font-weight:700">${_vacCal.selStart}</div>
        </div>
        <div style="font-size:22px;opacity:.5">→</div>
        <div style="text-align:right">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.7">Regreso</div>
          <div style="font-size:18px;font-weight:700">${_vacCal.selEnd}</div>
        </div>
      </div>
    </div>
    <!-- Desglose -->
    <div style="padding:16px 18px;border-bottom:2px dashed #e2e8f0">
      <div style="margin-bottom:8px">${parts.join('')}</div>
      ${extras.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${extras.join('')}</div>` : ''}
      ${festNames.length ? `<div style="font-size:11px;color:#64748b;margin-top:6px">${festNames.join(', ')}</div>` : ''}
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">${totalNat} dias naturales en total</div>
    </div>
    <!-- Motivo + enviar -->
    <div style="padding:16px 18px">
      <div style="margin-bottom:10px">
        <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Motivo (opcional)</label>
        <input type="text" id="vac-motivo" placeholder="Ej: Vacaciones familiares"
          style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;background:#f8fafc;outline:none"/>
      </div>
      <p class="emp-error" id="vac-err" style="margin-bottom:8px"></p>
      <button class="emp-btn" id="btn-vac-send" ${vacDias <= 0 ? 'disabled' : ''}>Solicitar ${vacDias} dia${vacDias!==1?'s':''} de vacaciones</button>
    </div>
  </div>`;

  // Bind enviar
  const btn = document.getElementById('btn-vac-send');
  if (btn) btn.onclick = async () => {
    const motivo = document.getElementById('vac-motivo')?.value?.trim() || '';
    const errEl = document.getElementById('vac-err');
    if (errEl) errEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Enviando...';
    const r = await api('POST', '/vacaciones', { fecha_inicio: _vacCal.selStart, fecha_fin: _vacCal.selEnd, motivo });
    btn.disabled = false; btn.textContent = `Solicitar ${vacDias} dia${vacDias!==1?'s':''} de vacaciones`;
    if (!r || !r.ok) {
      if (errEl) errEl.textContent = (r?.data?.error) || 'Error al enviar';
      return;
    }
    _vacCal.selStart = null; _vacCal.selEnd = null;
    const desg = r.data.desglose || `${r.data.dias} dias`;
    // Mostrar confirmacion estilo boarding pass
    document.getElementById('vac-summary').innerHTML = `
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:16px;padding:20px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">&#9989;</div>
      <div style="font-size:15px;font-weight:700;color:#166534;margin-bottom:4px">Solicitud enviada</div>
      <div style="font-size:13px;color:#15803d">${desg}</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px">RH te confirmara pronto</div>
    </div>`;
    setTimeout(() => vacaciones(document.getElementById('app-content') || el), 2000);
  };
}

async function _vacSolicitarCambio(vacId, tipo) {
  if (tipo === 'cancelacion') {
    const motivo = prompt('Escribe el motivo de la cancelacion:');
    if (motivo === null) return;
    const r = await api('POST', '/vacaciones/cambio', { vacacion_id: vacId, tipo, motivo: motivo.trim() });
    if (r && r.ok) {
      alert('Solicitud de cancelacion enviada. RH revisara tu peticion.');
      vacaciones(document.getElementById('app-content') || document.getElementById('app'));
    } else { alert((r?.data?.error) || 'Error al enviar'); }
    return;
  }
  // Modificacion: pedir nuevas fechas
  const box = document.getElementById(`vac-cambio-form-${vacId}`);
  if (box) { box.style.display = box.style.display === 'none' ? 'block' : 'none'; return; }
}

async function _vacEnviarCambio(vacId) {
  const ini = document.getElementById(`vac-cambio-ini-${vacId}`)?.value;
  const fin = document.getElementById(`vac-cambio-fin-${vacId}`)?.value;
  const motivo = document.getElementById(`vac-cambio-motivo-${vacId}`)?.value?.trim() || '';
  if (!ini || !fin) { alert('Selecciona las nuevas fechas'); return; }
  if (fin < ini) { alert('La fecha fin no puede ser antes que inicio'); return; }
  const r = await api('POST', '/vacaciones/cambio', {
    vacacion_id: vacId, tipo: 'modificacion', motivo,
    nueva_fecha_inicio: ini, nueva_fecha_fin: fin
  });
  if (r && r.ok) {
    alert('Solicitud de cambio enviada. RH revisara las nuevas fechas.');
    vacaciones(document.getElementById('app-content') || document.getElementById('app'));
  } else { alert((r?.data?.error) || 'Error al enviar'); }
}

function _vacClearSelection() {
  _vacCal.selStart = null;
  _vacCal.selEnd = null;
  _vacBuildCalendar();
}

async function vacaciones(el) {
  el.innerHTML = '<p class="emp-page-title">Vacaciones</p><div class="emp-empty"><div class="empty-icon">...</div><p>Cargando...</p></div>';

  const [rVac, rInc, rCal] = await Promise.all([
    api('GET', '/vacaciones'),
    api('GET', '/incidencias'),
    api('GET', '/vacaciones/calendario'),
  ]);
  const lista   = (rVac && rVac.ok && Array.isArray(rVac.data)) ? rVac.data : [];
  const vacInfo = (!Array.isArray(rInc?.data) ? rInc?.data?.vac_info : null) || {};
  const calData = (rCal && rCal.ok) ? rCal.data : {};

  // Inicializar estado calendario
  const now = new Date();
  _vacCal.holidays = calData.holidays || [];
  _vacCal.birthMD = calData.birth_date ? calData.birth_date.slice(5) : null;
  _vacCal.solicitudes = calData.solicitudes || [];
  _vacCal.selStart = null;
  _vacCal.selEnd = null;
  _vacCal.month = now.getMonth();
  _vacCal.year = now.getFullYear();

  const vi = vacInfo;
  _vacCal.diasRestantes = vi.dias_restantes ?? 0;
  const dispColor  = (vi.dias_restantes ?? 0) === 0 ? '#dc2626' : '#0369a1';

  // Badge estilo boarding pass para cada solicitud
  const listaHtml = lista.length ? lista.map(v => {
    const stColor = v.status==='aprobado' ? '#16a34a' : v.status==='rechazado' ? '#dc2626' : '#d97706';
    const stBg    = v.status==='aprobado' ? '#f0fdf4' : v.status==='rechazado' ? '#fef2f2' : '#fffbeb';
    const stBorder = v.status==='aprobado' ? '#86efac' : v.status==='rechazado' ? '#fca5a5' : '#fcd34d';
    const stLabel = v.status==='aprobado' ? 'APROBADO' : v.status==='rechazado' ? 'RECHAZADO' : 'PENDIENTE';
    return `
    <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:14px;margin-bottom:10px;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px">
        <div>
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Periodo</div>
          <div style="font-size:14px;font-weight:700;color:#1e293b">${fmtDate(v.fecha_inicio)} → ${fmtDate(v.fecha_fin)}</div>
        </div>
        <div style="background:${stBg};border:1px solid ${stBorder};color:${stColor};padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.5px">${stLabel}</div>
      </div>
      <div style="border-top:1px dashed #e2e8f0;padding:8px 16px;display:flex;gap:16px;font-size:12px;color:#64748b">
        <span><strong>${v.dias}</strong> dia${v.dias!==1?'s':''}</span>
        <span>Solicitado: ${fmtDate(v.created_at)}</span>
      </div>
      ${v.motivo ? `<div style="padding:0 16px 8px;font-size:11px;color:#94a3b8">${esc(v.motivo)}</div>` : ''}
      ${v.notas_rh ? `<div style="padding:0 16px 10px;font-size:11px;color:#1e40af;background:#eff6ff;margin:0 12px 10px;border-radius:6px;padding:6px 8px">RH: ${esc(v.notas_rh)}</div>` : ''}
      ${v.cambio_solicitado && !v.cambio_respuesta ? `<div style="padding:8px 16px;font-size:11px;background:#fffbeb;border-top:1px solid #fcd34d;color:#92400e">
        ${v.cambio_solicitado === 'cancelacion' ? 'Cancelacion solicitada' : 'Cambio solicitado'} — esperando respuesta de RH
        ${v.cambio_motivo ? ` · ${esc(v.cambio_motivo)}` : ''}</div>` : ''}
      ${v.cambio_respuesta ? `<div style="padding:8px 16px;font-size:11px;background:#eff6ff;border-top:1px solid #bfdbfe;color:#1e40af">RH: ${esc(v.cambio_respuesta)}</div>` : ''}
      ${v.status === 'aprobado' && !v.cambio_solicitado ? `<div style="border-top:1px dashed #e2e8f0;padding:10px 16px">
        <div style="display:flex;gap:8px;margin-bottom:0">
          <button onclick="_vacSolicitarCambio(${v.id},'modificacion')" style="flex:1;padding:7px;border:1px solid #d97706;background:#fffbeb;color:#92400e;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer">Solicitar cambio</button>
          <button onclick="_vacSolicitarCambio(${v.id},'cancelacion')" style="flex:1;padding:7px;border:1px solid #dc2626;background:#fef2f2;color:#991b1b;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer">Cancelar vacaciones</button>
        </div>
        <div id="vac-cambio-form-${v.id}" style="display:none;margin-top:10px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px">Nuevas fechas solicitadas:</div>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <div style="flex:1"><label style="font-size:10px;color:#64748b">Inicio</label><input type="date" id="vac-cambio-ini-${v.id}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px"/></div>
            <div style="flex:1"><label style="font-size:10px;color:#64748b">Fin</label><input type="date" id="vac-cambio-fin-${v.id}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px"/></div>
          </div>
          <input type="text" id="vac-cambio-motivo-${v.id}" placeholder="Motivo del cambio" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;margin-bottom:8px"/>
          <button onclick="_vacEnviarCambio(${v.id})" style="width:100%;padding:8px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Enviar solicitud de cambio</button>
        </div>
      </div>` : ''}
      ${v.status === 'cancelado' ? `<div style="border-top:1px solid #fecaca;padding:8px 16px;font-size:11px;color:#991b1b;background:#fef2f2">Vacaciones canceladas</div>` : ''}
    </div>`;
  }).join('') : '<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">Sin solicitudes previas</div>';

  el.innerHTML = `
  <p class="emp-page-title">Vacaciones</p>

  <!-- Nota portal en prueba -->
  <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#92400e;line-height:1.5">
    <strong>Portal en prueba</strong> — Tus dias de vacaciones pueden variar o no coincidir con los registros internos. Si tienes alguna duda, acude a RHH.
  </div>

  <!-- Resumen de dias -->
  <div class="emp-card" style="background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;padding:18px;margin-bottom:14px;border:none;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:.7;margin-bottom:10px">Dias de vacaciones ${now.getFullYear()}</div>
    ${!vi.elegible ? '<div style="background:rgba(255,255,255,.15);padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:8px">Aun no tienes dias de vacaciones disponibles para este año.</div>' : ''}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
      <div style="text-align:center;background:rgba(255,255,255,.12);border-radius:10px;padding:10px;">
        <div style="font-size:22px;font-weight:800">${vi.dias_disponibles ?? 0}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;opacity:.7">Disponibles</div>
      </div>
      <div style="text-align:center;background:rgba(255,255,255,.12);border-radius:10px;padding:10px;">
        <div style="font-size:22px;font-weight:800">${vi.dias_tomados ?? 0}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;opacity:.7">Tomados</div>
      </div>
      <div style="text-align:center;background:rgba(255,255,255,.12);border-radius:10px;padding:10px;">
        <div style="font-size:22px;font-weight:800">${(vi.dias_programados??0)-(vi.dias_tomados??0)}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;opacity:.7">Pendientes</div>
      </div>
      <div style="text-align:center;background:rgba(255,255,255,.2);border-radius:10px;padding:10px;border:1px solid rgba(255,255,255,.3)">
        <div style="font-size:22px;font-weight:800">${vi.dias_restantes ?? 0}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;opacity:.7">Restantes</div>
      </div>
    </div>
  </div>

  <!-- Calendario -->
  ${!vi.elegible ? `<div class="emp-card" style="padding:18px;margin-bottom:14px;background:#fef2f2;border:1px solid #fecaca;text-align:center">
    <div style="font-size:14px;font-weight:700;color:#991b1b;margin-bottom:4px">No tienes derecho a vacaciones este año</div>
    <div style="font-size:12px;color:#b91c1c">Si tienes alguna duda, acude a RHH.</div>
  </div>` : `<div class="emp-card" style="padding:16px;margin-bottom:14px">
    ${(vi.dias_restantes ?? 0) <= 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-bottom:12px;text-align:center">
      <div style="font-size:13px;font-weight:700;color:#991b1b">Ya programaste todos tus dias de vacaciones</div>
      <div style="font-size:11px;color:#b91c1c;margin-top:2px">Si necesitas hacer cambios, usa los botones de tus solicitudes aprobadas o acude a RHH.</div>
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700;color:#1e293b">${(vi.dias_restantes ?? 0) > 0 ? 'Selecciona tus fechas' : 'Tus vacaciones programadas'}</div>
      ${(vi.dias_restantes ?? 0) > 0 ? `<button onclick="_vacClearSelection()" style="background:none;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:#64748b">Limpiar</button>` : ''}
    </div>
    <div id="vac-calendar"></div>
  </div>`}

  <!-- Resumen / Boarding Pass -->
  <div id="vac-summary" style="margin-bottom:14px"></div>

  <!-- Historial de solicitudes -->
  <div style="margin-top:6px">
    <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:10px">Mis solicitudes</div>
    ${listaHtml}
  </div>`;

  if (document.getElementById('vac-calendar')) _vacBuildCalendar();
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
