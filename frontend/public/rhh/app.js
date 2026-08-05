/* ══════════════════════════════════════════════════════════════════════════════
   MÓDULO RHH — Recursos Humanos — SPA vanilla JS
   ══════════════════════════════════════════════════════════════════════════════ */

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  user: null,
  token: null,
  // Cachés locales
  employees: [],
  departments: [],
  positions: [],
  shifts: [],
  rhhUsers: []
};

// ── Menú por rol ──────────────────────────────────────────────────────────────
const MENU_BY_ROLE = {
  empleado: [
    ['mi-horario', '📅 Mi Horario'],
    ['mis-solicitudes', '📝 Mis Solicitudes'],
    ['mis-incidencias', '⚠️ Mis Incidencias'],
    ['mis-evaluaciones', '⭐ Mi Evaluación'],
    ['queja-anonima', '📢 Queja anónima'],
    ['aclaracion-nomina', '💬 Aclaración nómina']
  ],
  supervisor: [
    ['asistencias', '🗓️ Control Asistencias'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['ausencias-hoy', '🚨 Ausencias Hoy'],
    ['mis-evaluaciones', '⭐ Mi Evaluación']
  ],
  rh: [
    ['dashboard', '📊 Dashboard'],
    ['checador', '🕐 Checador'],
    ['catalogo-empleados', '👥 Catálogo Empleados'],
    ['asistencias', '🗓️ Control Asistencias'],
    ['incidencias', '📋 Incidencias Semanales'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['lista-raya', '💰 Lista de Raya'],
    ['vacantes', '🔍 Vacantes'],
    ['evaluaciones', '⭐ Evaluaciones'],
    ['reportes', '📊 Reportes'],
    ['quejas-rh', '📢 Quejas'],
    ['aclaraciones-rh', '💬 Aclaraciones']
  ],
  admin: [
    ['dashboard', '📊 Dashboard'],
    ['checador', '🕐 Checador'],
    ['catalogo-empleados', '👥 Catálogo Empleados'],
    ['asistencias', '🗓️ Control Asistencias'],
    ['incidencias', '📋 Incidencias Semanales'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['lista-raya', '💰 Lista de Raya'],
    ['vacantes', '🔍 Vacantes'],
    ['evaluaciones', '⭐ Evaluaciones'],
    ['catalogos', '📁 Catálogos'],
    ['reportes', '📊 Reportes'],
    ['quejas-rh', '📢 Quejas'],
    ['aclaraciones-rh', '💬 Aclaraciones']
  ]
};

const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Utilidades de fecha ───────────────────────────────────────────────────────
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function getWeekDates(startDate) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function weekStr(startDate) {
  // Returns YYYY-Wnn
  const d = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function fmtDateDisplay(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const esc = escHtml;

// ── API helper ────────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    logout();
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  let container = document.getElementById('rhh-toast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'rhh-toast';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Autenticación ─────────────────────────────────────────────────────────────
function logout() {
  state.user = null;
  state.token = null;
  localStorage.removeItem('rhh_token');
  location.hash = '';
  render();
}

async function login(email, password) {
  const errEl = document.getElementById('login-err');
  if (errEl) errEl.textContent = '';
  try {
    const res = await fetch('/api/rhh/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || `Error ${res.status}`;
      if (errEl) errEl.textContent = msg;
      toast(msg, 'error');
      return;
    }
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('rhh_token', data.token);
    await loadCatalogs();
    const role = state.user?.role;
    const menu = MENU_BY_ROLE[role] || [];
    location.hash = menu.length ? menu[0][0] : 'dashboard';
    render();
  } catch (err) {
    const msg = 'Error de conexión con el servidor';
    if (errEl) errEl.textContent = msg;
    toast(msg, 'error');
  }
}

// ── Cargar catálogos al inicio ────────────────────────────────────────────────
async function loadCatalogs() {
  try {
    const [emps, depts, pos, shifts, users] = await Promise.all([
      api('/api/rhh/employees'),
      api('/api/rhh/catalogs/departments'),
      api('/api/rhh/catalogs/positions'),
      api('/api/rhh/catalogs/shifts'),
      api('/api/rhh/catalogs/users').catch(() => [])
    ]);
    state.employees = emps || [];
    state.departments = depts || [];
    state.positions = pos || [];
    state.shifts = shifts || [];
    state.rhhUsers = users || [];
  } catch (_) {}
}

// ── Helpers de UI ─────────────────────────────────────────────────────────────
function statusPill(status) {
  const map = {
    aprobada: 'pill aprobada',
    pendiente: 'pill pendiente',
    rechazada: 'pill rechazada',
    active: 'pill active',
    inactive: 'pill inactive',
    activo: 'pill active'
  };
  const label = { aprobada: 'Aprobada', pendiente: 'Pendiente', rechazada: 'Rechazada', active: 'Activo', inactive: 'Inactivo', activo: 'Activo' };
  return `<span class="${map[status] || 'pill gray'}">${label[status] || status}</span>`;
}

function incTypeLabel(type) {
  const map = {
    falta: 'Falta', vacacion: 'Vacación', incapacidad: 'Incapacidad',
    permiso: 'Permiso', tiempo_extra: 'Tiempo extra', cumpleanos: 'Cumpleaños'
  };
  return map[type] || type;
}

function incTypePill(type) {
  return `<span class="cell-chip type-${type}">${incTypeLabel(type)}</span>`;
}

function shiftDot(shift) {
  if (!shift) return '';
  return `<span class="shift-dot" style="background:${shift.color}"></span>${shift.name}`;
}

function deptName(id) {
  const d = state.departments.find(x => x.id === id);
  return d ? d.name : '—';
}

function shiftName(id) {
  const s = state.shifts.find(x => x.id === id);
  return s ? s.name : '—';
}

// ── Cambiar contraseña ────────────────────────────────────────────────────────
function openRhhChangePwdModal() {
  const existing = document.getElementById('rhhChangePwdModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'rhhChangePwdModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <h3 style="margin:0 0 18px;color:#064e3b;">🔑 Cambiar contraseña</h3>
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Contraseña actual</label>
      <input type="password" id="rcp-cur" placeholder="••••••••" autocomplete="current-password"
        style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px"/>
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Nueva contraseña</label>
      <input type="password" id="rcp-new" placeholder="Mínimo 6 caracteres" autocomplete="new-password"
        style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px"/>
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Confirmar nueva contraseña</label>
      <input type="password" id="rcp-conf" placeholder="Repite la nueva contraseña" autocomplete="new-password"
        style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:16px"/>
      <p id="rcp-err" style="color:#dc2626;font-size:13px;margin:0 0 12px;display:none"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-ghost" onclick="document.getElementById('rhhChangePwdModal').remove()">Cancelar</button>
        <button class="btn-primary" id="rcp-save">Guardar contraseña</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('rcp-save').onclick = async () => {
    const cur  = document.getElementById('rcp-cur').value;
    const nw   = document.getElementById('rcp-new').value;
    const conf = document.getElementById('rcp-conf').value;
    const errEl = document.getElementById('rcp-err');
    const showErr = msg => { errEl.textContent = msg; errEl.style.display = ''; };
    errEl.style.display = 'none';
    if (!cur || !nw || !conf) return showErr('Completa todos los campos');
    if (nw.length < 6) return showErr('La nueva contraseña debe tener al menos 6 caracteres');
    if (nw !== conf) return showErr('Las contraseñas nuevas no coinciden');
    const btn = document.getElementById('rcp-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await api('/api/rhh/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: cur, new_password: nw }) });
      modal.remove();
      toast('Contraseña actualizada correctamente');
    } catch(e) {
      btn.disabled = false; btn.textContent = 'Guardar contraseña';
      showErr(e.message);
    }
  };
}

// ── Shell (layout con sidebar) ────────────────────────────────────────────────
function shell(content, activeHash) {
  const role = state.user?.role || 'empleado';
  const menu = MENU_BY_ROLE[role] || [];
  const menuHtml = menu.map(([hash, label]) =>
    `<a href="#${hash}" class="${activeHash === hash ? 'active' : ''}">${label}</a>`
  ).join('');

  return `
    <div class="layout rhh-layout">
      <div class="sidebar-overlay" id="sidebarOverlay" onclick="document.querySelector('.sidebar').classList.remove('open');this.classList.remove('open')"></div>
      <aside class="sidebar">
        <div class="brand">👥 Recursos Humanos</div>
        <nav class="nav">${menuHtml}</nav>
        <div class="sidebar-footer">
          <a href="#perfil">⚙️ ${state.user?.full_name || 'Mi perfil'}</a>
          <a href="#" onclick="openRhhChangePwdModal();return false;">🔑 Cambiar contraseña</a>
          <a href="#" onclick="logout();return false;">🚪 Cerrar sesión</a>
          <a href="/">← Portal principal</a>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px"><button class="mob-menu-btn" onclick="document.querySelector('.sidebar').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('open')">☰</button><div>
            <strong>${state.user?.full_name || ''}</strong>
            <span class="badge" style="margin-left:8px;">${role.toUpperCase()}</span>
          </div></div>
          <div style="display:flex;align-items:center;gap:12px;">
            <button id="rhhNotifBtn" onclick="toggleNotifPanel()" style="position:relative;background:none;border:none;cursor:pointer;font-size:20px;padding:4px 8px;border-radius:8px;" title="Notificaciones">
              🔔<span id="rhhNotifBadge" style="display:none;position:absolute;top:0;right:0;background:#ef4444;color:#fff;border-radius:50%;font-size:10px;min-width:16px;height:16px;line-height:16px;text-align:center;font-weight:700;"></span>
            </button>
            <div class="small muted">${new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
          </div>
        </div>
        <div id="rhhNotifPanel" style="display:none;position:fixed;top:60px;right:16px;z-index:9990;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.15);width:340px;max-height:420px;overflow-y:auto;">
          <div style="padding:12px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
            <strong style="font-size:14px;">🔔 Notificaciones</strong>
            <button onclick="markAllNotifsRead()" class="btn-ghost" style="font-size:11px;padding:3px 8px;">Marcar todo leído</button>
          </div>
          <div id="rhhNotifList" style="padding:8px 0;">
            <div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">Cargando...</div>
          </div>
        </div>
        ${content}
      </main>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTAS
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Login ──────────────────────────────────────────────────────────────────
function loginView() {
  return `
    <div class="login-wrap">
      <div class="card login-card">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:48px;">👥</div>
          <h1 style="color:#064e3b;">Recursos Humanos</h1>
          <p>Ingresa con tu cuenta institucional</p>
        </div>
        <label>Correo electrónico</label>
        <input id="login-email" type="email" placeholder="correo@empresa.com" autocomplete="username" />
        <label>Contraseña</label>
        <input id="login-pass" type="password" placeholder="••••••••" autocomplete="current-password" />
        <div id="login-err" class="error"></div>
        <button class="btn-primary" style="width:100%;margin-top:16px;" onclick="doLogin()">Iniciar sesión</button>
        <div style="text-align:center;margin-top:16px;">
          <a href="/" style="color:#059669;font-size:13px;">← Volver al portal</a>
        </div>
      </div>
    </div>
  `;
}

async function doLogin() {
  const email = document.getElementById('login-email')?.value?.trim();
  const pass = document.getElementById('login-pass')?.value;
  const errEl = document.getElementById('login-err');
  if (!email || !pass) {
    if (errEl) errEl.textContent = 'Completa todos los campos';
    return;
  }
  if (errEl) errEl.textContent = '';
  await login(email, pass);
}

// Permitir login con Enter
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-pass')) doLogin();
});

// ── 2. Dashboard ──────────────────────────────────────────────────────────────
async function dashboardView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando dashboard...</div>', 'dashboard');

  try {
    const data = await api('/api/rhh/dashboard');
    if (!data) return;

    const kpis = data.kpis || {};
    const absences = data.absences_today || [];
    const birthdays = data.birthdays || [];
    const byShift = data.by_shift || [];

    // Nómina KPIs (solo admin/rh)
    let nominaKpisHtml = '';
    const userRole = state.user?.role || '';
    if (userRole === 'admin' || userRole === 'rh') {
      try {
        // Cargar períodos si hace falta
        if (incSemPeriodos.length === 0) {
          incSemPeriodos = await api('/api/rhh/nomina/periodos') || [];
        }
        const ultimoPeriodo = incSemPeriodos.length > 0
          ? incSemPeriodos[incSemPeriodos.length - 1].no_periodo
          : 0;
        if (ultimoPeriodo) {
          const nk = await api(`/api/rhh/nomina/kpis?no_periodo=${ultimoPeriodo}`);
          if (nk?.ok) {
            const s = nk.resumen;
            const p = nk.periodo;
            const pct = s.total_empleados > 0
              ? Math.round((s.capturados / s.total_empleados) * 100) : 0;
            nominaKpisHtml = `
              <div class="card section" style="margin-top:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                  <h3 style="margin:0;">💰 Nómina — S${ultimoPeriodo}${p ? ` · ${p.fecha_inicio} al ${p.fecha_fin}` : ''}</h3>
                  <button class="btn-ghost" onclick="location.hash='#lista-raya'" style="font-size:12px;">Ver lista de raya →</button>
                </div>
                <div class="grid grid-4" style="margin-bottom:12px;">
                  <div class="card kpi" style="background:#f0fdf4;">
                    <div class="muted small">Capturados</div>
                    <div class="n" style="color:#15803d;font-size:26px;">${s.capturados}/${s.total_empleados}</div>
                    <div style="font-size:11px;color:#6b7280;">${pct}%</div>
                  </div>
                  <div class="card kpi" style="background:#fef2f2;">
                    <div class="muted small">Total faltas</div>
                    <div class="n" style="color:#b91c1c;font-size:26px;">${s.total_faltas}</div>
                    <div style="font-size:11px;color:#6b7280;">prom. ${s.promedio_faltas}/emp</div>
                  </div>
                  <div class="card kpi" style="background:#eff6ff;">
                    <div class="muted small">Horas extra</div>
                    <div class="n" style="color:#1d4ed8;font-size:26px;">${s.total_horas_extras}h</div>
                    <div style="font-size:11px;color:#6b7280;">prom. ${s.promedio_he}h/emp</div>
                  </div>
                  <div class="card kpi" style="background:#fffbeb;">
                    <div class="muted small">Días vacaciones</div>
                    <div class="n" style="color:#b45309;font-size:26px;">${s.total_vac_dias}</div>
                    <div style="font-size:11px;color:#6b7280;">&nbsp;</div>
                  </div>
                </div>
                <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#374151;">
                  <span>🎁 Despensa: <strong>${s.con_despensa}</strong></span>
                  <span>⭐ Bono puntualidad: <strong>${s.con_bono_puntualidad}</strong></span>
                  <span>🏆 Bono eficiencia: <strong>${s.con_bono_eficiencia}</strong></span>
                  <span>☀️ Prima dominical: <strong>${s.con_prima_dominical}</strong></span>
                  <span>📋 Pendientes de captura: <strong style="color:${s.pendientes_captura>0?'#b91c1c':'#15803d'}">${s.pendientes_captura}</strong></span>
                </div>
              </div>`;
          }
        }
      } catch (_) { /* silencioso */ }
    }

    const content = `
      <h2>📊 Dashboard RHH</h2>
      <div class="grid grid-4" style="margin-bottom:20px;">
        <div class="card kpi kpi-rhh">
          <div class="muted small">Total empleados</div>
          <div class="n">${kpis.total_employees ?? 0}</div>
        </div>
        <div class="card kpi kpi-rhh">
          <div class="muted small">Ausencias hoy</div>
          <div class="n" style="color:#b91c1c;">${kpis.absences_today ?? 0}</div>
        </div>
        <div class="card kpi kpi-rhh">
          <div class="muted small">Solicitudes pendientes</div>
          <div class="n" style="color:#b45309;">${kpis.pending_requests ?? 0}</div>
        </div>
        <div class="card kpi kpi-rhh">
          <div class="muted small">Horas extra (semana)</div>
          <div class="n" style="color:#1d4ed8;">${kpis.overtime_hours_week ?? 0}h</div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card section">
          <h3>🚨 Ausencias de hoy</h3>
          ${absences.length === 0
            ? '<div class="empty-state"><div class="empty-icon">✅</div><p>Sin ausencias registradas hoy</p></div>'
            : `<table class="table-wrap"><thead><tr><th>Empleado</th><th>Tipo</th><th>Turno</th><th>Depto</th></tr></thead>
               <tbody>${absences.map(a => `
                 <tr>
                   <td>${a.employee_name}</td>
                   <td>${incTypePill(a.type)}</td>
                   <td>${a.shift_name || '—'}</td>
                   <td>${a.department_name || '—'}</td>
                 </tr>`).join('')}
               </tbody></table>`
          }
        </div>

        <div class="card section">
          <h3>⏱️ Plantilla por turno</h3>
          ${byShift.map(s => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);">
              <div><span class="shift-dot" style="background:${(state.shifts.find(x=>x.name===s.shift)||{}).color||'#999'}"></span>${s.shift}</div>
              <strong>${s.count}</strong>
            </div>
          `).join('')}
          ${birthdays.length > 0 ? `
            <div style="margin-top:16px;padding:12px;background:#fce7f3;border-radius:12px;">
              <strong>🎂 Cumpleaños hoy</strong>
              ${birthdays.map(b => `<div style="margin-top:4px;">${b.full_name}</div>`).join('')}
            </div>` : ''}
        </div>
      </div>
      ${nominaKpisHtml}
    `;

    el.innerHTML = shell(content, 'dashboard');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'dashboard');
  }
}

// ── 3. Calendario semanal ─────────────────────────────────────────────────────
let calWeekOffset = 0;

async function calendarioView() {
  const el = document.getElementById('app');
  const weekStart = getWeekStart();
  weekStart.setDate(weekStart.getDate() + calWeekOffset * 7);
  const dates = getWeekDates(weekStart);
  const wStr = weekStr(weekStart);

  el.innerHTML = shell('<div class="loading-overlay">Cargando calendario...</div>', 'calendario');

  const deptSel = document.getElementById('cal-dept-sel')?.value || '';
  const shiftSel = document.getElementById('cal-shift-sel')?.value || '';

  try {
    let url = `/api/rhh/schedule?week=${wStr}`;
    if (deptSel) url += `&department_id=${deptSel}`;
    if (shiftSel) url += `&shift_id=${shiftSel}`;

    const data = await api(url);
    if (!data) return;

    const deptsOpts = state.departments.map(d =>
      `<option value="${d.id}" ${deptSel == d.id ? 'selected' : ''}>${d.name}</option>`
    ).join('');
    const shiftsOpts = state.shifts.map(s =>
      `<option value="${s.id}" ${shiftSel == s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const rangeLbl = `${fmtDateDisplay(fmtDate(dates[0]))} – ${fmtDateDisplay(fmtDate(dates[6]))}`;

    const rows = (data.data || []).map(row => {
      const emp = row.employee;
      const cells = row.days.map(day => {
        const cls = `cell-${day.status}`;
        const inc = day.incidence;
        const label = inc ? incTypeLabel(inc.type) : (day.works_this_day ? emp.shift?.code || '✓' : '—');
        return `<td><span class="cell-chip ${cls}">${label}</span></td>`;
      }).join('');
      return `
        <tr>
          <td style="white-space:nowrap;">
            <strong>${emp.full_name}</strong><br>
            <span class="small muted">${shiftDot(emp.shift)}</span>
          </td>
          ${cells}
        </tr>`;
    }).join('');

    const headerCells = dates.map((d, i) => {
      const isToday = fmtDate(d) === fmtDate(new Date());
      return `<th style="${isToday ? 'background:#d1fae5;' : ''}">${DAYS_SHORT[d.getDay()]}<br><span class="small">${d.getDate()}/${d.getMonth()+1}</span></th>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>📅 Calendario de Turnos</h2>
      </div>

      <div class="filter-bar">
        <div>
          <label>Departamento</label>
          <select id="cal-dept-sel" onchange="reloadCalendario()">
            <option value="">Todos</option>${deptsOpts}
          </select>
        </div>
        <div>
          <label>Turno</label>
          <select id="cal-shift-sel" onchange="reloadCalendario()">
            <option value="">Todos</option>${shiftsOpts}
          </select>
        </div>
      </div>

      <div class="week-nav">
        <button onclick="calWeekOffset--;reloadCalendario()">‹ Anterior</button>
        <span class="week-label">📅 ${rangeLbl}</span>
        <button onclick="calWeekOffset++;reloadCalendario()">Siguiente ›</button>
        <button onclick="calWeekOffset=0;reloadCalendario()" style="margin-left:8px;font-size:12px;">Hoy</button>
      </div>

      <div class="card section table-wrap">
        ${data.data?.length === 0
          ? '<div class="empty-state"><div class="empty-icon">📅</div><p>Sin empleados para mostrar con los filtros seleccionados</p></div>'
          : `<table class="cal-week-table">
               <thead>
                 <tr>
                   <th style="text-align:left;min-width:140px;">Empleado</th>
                   ${headerCells}
                 </tr>
               </thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>

      <div class="card section" style="margin-top:12px;">
        <strong>Leyenda:</strong>
        <span class="cell-chip cell-asignado" style="margin:0 4px;">Asignado</span>
        <span class="cell-chip cell-falta" style="margin:0 4px;">Falta</span>
        <span class="cell-chip cell-vacacion" style="margin:0 4px;">Vacación</span>
        <span class="cell-chip cell-permiso" style="margin:0 4px;">Permiso</span>
        <span class="cell-chip cell-incapacidad" style="margin:0 4px;">Incapacidad</span>
        <span class="cell-chip cell-tiempo_extra" style="margin:0 4px;">T. Extra</span>
        <span class="cell-chip cell-no_laboral" style="margin:0 4px;">No laboral</span>
      </div>
    `;

    el.innerHTML = shell(content, 'calendario');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice"><span class="error">${err.message}</span></div>`, 'calendario');
  }
}

function reloadCalendario() {
  // Preserve filter selections before re-render
  const deptVal = document.getElementById('cal-dept-sel')?.value || '';
  const shiftVal = document.getElementById('cal-shift-sel')?.value || '';
  calendarioView().then(() => {
    const d = document.getElementById('cal-dept-sel');
    const s = document.getElementById('cal-shift-sel');
    if (d) d.value = deptVal;
    if (s) s.value = shiftVal;
  });
}

// ── 4. Asignación (supervisor) ────────────────────────────────────────────────
let assignWeekOffset = 0;

async function asignacionView() {
  const el = document.getElementById('app');
  const weekStart = getWeekStart();
  weekStart.setDate(weekStart.getDate() + assignWeekOffset * 7);
  const dates = getWeekDates(weekStart);
  const wStr = weekStr(weekStart);

  el.innerHTML = shell('<div class="loading-overlay">Cargando asignaciones...</div>', 'asignacion');

  try {
    const data = await api(`/api/rhh/schedule?week=${wStr}`);
    if (!data) return;

    const rangeLbl = `${fmtDateDisplay(fmtDate(dates[0]))} – ${fmtDateDisplay(fmtDate(dates[6]))}`;

    const shiftsOpts = state.shifts.map(s =>
      `<option value="${s.id}">${s.name}</option>`
    ).join('');

    const rows = (data.data || []).map(row => {
      const emp = row.employee;
      const cells = row.days.map((day, di) => {
        const dateStr = fmtDate(dates[di]);
        const teAuth = approvedTE.find(t => t.date === dateStr && emp.shift && t.shift_id === emp.shift?.id) || null;
        if (!day.works_this_day && !day.incidence && !day.schedule_entry && !teAuth) {
          return `<td style="background:#f3f4f6;text-align:center;"><span class="small muted">—</span></td>`;
        }
        const inc = day.incidence;
        if (inc) {
          return `<td style="text-align:center;"><span class="cell-chip cell-${day.status}">${incTypeLabel(inc.type)}</span></td>`;
        }
        if (!day.works_this_day && teAuth) {
          return `<td style="background:#fef9c3;text-align:center;"><span class="cell-chip cell-tiempo_extra" style="font-size:11px;">🔥 T.E.</span></td>`;
        }
        const assigned = !!day.schedule_entry || day.works_this_day;
        return `<td style="text-align:center;">
          ${assigned
            ? `<span class="cell-chip cell-asignado" style="cursor:default;">✓ ${emp.shift?.code || ''}</span>`
            : `<button class="btn-primary" style="font-size:11px;padding:4px 8px;" onclick="assignDay(${emp.id},'${dateStr}',${emp.shift?.id||0})">Asignar</button>`
          }
        </td>`;
      }).join('');

      return `
        <tr>
          <td>
            <strong>${emp.full_name}</strong><br>
            <span class="small muted">${shiftDot(emp.shift)}</span>
          </td>
          ${cells}
        </tr>`;
    }).join('');

    // Cargar TE autorizadas del período
    const teMonth = fmtDate(dates[0]).slice(0, 7);
    let teAuths = [];
    try {
      teAuths = await api(`/api/rhh/schedule/te-authorizations?month=${teMonth}`) || [];
    } catch(_) {}
    const approvedTE = teAuths.filter(t => t.status === 'approved');

    const headerCells = dates.map(d => {
      const isToday = fmtDate(d) === fmtDate(new Date());
      const dateStr = fmtDate(d);
      // Verificar si algún turno tiene TE en este día
      const hasTEThisDay = approvedTE.some(t => t.date === dateStr);
      return `<th style="${isToday ? 'background:#d1fae5;' : ''}">${DAYS_SHORT[d.getDay()]}<br><span class="small">${d.getDate()}/${d.getMonth()+1}</span>${hasTEThisDay ? '<br><span style="font-size:10px;color:#b45309;font-weight:700;">🔥 T.E.</span>' : ''}</th>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>👥 Asignación de Turnos</h2>
      </div>

      <div class="week-nav">
        <button onclick="assignWeekOffset--;asignacionView()">‹ Anterior</button>
        <span class="week-label">📅 ${rangeLbl}</span>
        <button onclick="assignWeekOffset++;asignacionView()">Siguiente ›</button>
        <button onclick="assignWeekOffset=0;asignacionView()" style="margin-left:8px;font-size:12px;">Hoy</button>
      </div>

      <div class="card section table-wrap">
        ${data.data?.length === 0
          ? '<div class="empty-state"><div class="empty-icon">👥</div><p>No hay empleados bajo tu supervisión</p></div>'
          : `<table class="cal-week-table">
               <thead>
                 <tr>
                   <th style="text-align:left;min-width:140px;">Empleado</th>
                   ${headerCells}
                 </tr>
               </thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>

      <div class="card section" style="margin-top:12px;">
        <h3>Registrar incidencia</h3>
        <div class="row">
          <div>
            <label>Empleado</label>
            <select id="assign-emp">
              <option value="">Seleccionar...</option>
              ${(data.data||[]).map(r => `<option value="${r.employee.id}">${r.employee.full_name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Tipo de incidencia</label>
            <select id="assign-type">
              <option value="falta">Falta</option>
              <option value="permiso">Permiso</option>
              <option value="tiempo_extra">Tiempo extra</option>
              <option value="incapacidad">Incapacidad</option>
            </select>
          </div>
          <div>
            <label>Fecha</label>
            <input type="date" id="assign-date" value="${fmtDate(new Date())}" />
          </div>
          <div>
            <label>Horas (tiempo extra)</label>
            <input type="number" id="assign-hours" placeholder="0" min="0" max="24" />
          </div>
        </div>
        <div style="margin-top:10px;">
          <label>Notas</label>
          <textarea id="assign-notes" rows="2" placeholder="Observaciones..."></textarea>
        </div>
        <div style="margin-top:10px;">
          <button class="btn-primary" onclick="submitIncidence()">Registrar incidencia</button>
        </div>
      </div>
    `;

    el.innerHTML = shell(content, 'asignacion');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'asignacion');
  }
}

async function assignDay(employeeId, date, shiftId) {
  try {
    await api('/api/rhh/schedule/assign', {
      method: 'POST',
      body: JSON.stringify({ employee_id: employeeId, date, shift_id: shiftId })
    });
    toast('Asignación registrada');
    asignacionView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitIncidence() {
  const employee_id = document.getElementById('assign-emp')?.value;
  const type = document.getElementById('assign-type')?.value;
  const date = document.getElementById('assign-date')?.value;
  const hours = document.getElementById('assign-hours')?.value;
  const notes = document.getElementById('assign-notes')?.value;

  if (!employee_id || !type || !date) {
    toast('Selecciona empleado, tipo y fecha', 'warning');
    return;
  }

  try {
    await api('/api/rhh/incidences', {
      method: 'POST',
      body: JSON.stringify({ employee_id: Number(employee_id), type, date, hours: hours ? Number(hours) : null, notes })
    });
    toast('Incidencia registrada exitosamente');
    asignacionView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── 5. Empleados (CRUD) ───────────────────────────────────────────────────────
let empTab = 'list';
let empEditId = null; // ID del empleado actualmente en edición/expediente
let empFilter = { dept: '', shift: '', status: 'active', search: '' };
let empSalarioVisible = false; // salario oculto por defecto

async function empleadosView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando empleados...</div>', 'empleados');

  try {
    let url = '/api/rhh/employees?';
    if (empFilter.dept) url += `department_id=${empFilter.dept}&`;
    if (empFilter.shift) url += `shift_id=${empFilter.shift}&`;
    if (empFilter.status) url += `status=${empFilter.status}&`;
    if (empFilter.search) url += `search=${encodeURIComponent(empFilter.search)}&`;

    const employees = await api(url);
    if (!employees) return;

    const deptsOpts = state.departments.map(d =>
      `<option value="${d.id}" ${empFilter.dept == d.id ? 'selected' : ''}>${d.name}</option>`
    ).join('');
    const shiftsOpts = state.shifts.map(s =>
      `<option value="${s.id}" ${empFilter.shift == s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const listContent = `
      <div class="filter-bar">
        <div>
          <label>Departamento</label>
          <select id="emp-dept" onchange="empFilter.dept=this.value;empleadosView()">
            <option value="">Todos</option>${deptsOpts}
          </select>
        </div>
        <div>
          <label>Turno</label>
          <select id="emp-shift" onchange="empFilter.shift=this.value;empleadosView()">
            <option value="">Todos</option>${shiftsOpts}
          </select>
        </div>
        <div>
          <label>Estatus</label>
          <select id="emp-status" onchange="empFilter.status=this.value;empleadosView()">
            <option value="active" ${empFilter.status==='active'?'selected':''}>Activos</option>
            <option value="inactive" ${empFilter.status==='inactive'?'selected':''}>Inactivos</option>
            <option value="" ${empFilter.status===''?'selected':''}>Todos</option>
          </select>
        </div>
        <div>
          <label>Buscar</label>
          <input type="text" id="emp-search" placeholder="Nombre, email, número..." value="${empFilter.search}"
            oninput="empFilter.search=this.value" onkeydown="if(event.key==='Enter')empleadosView()" />
        </div>
        <div style="align-self:flex-end;">
          <button class="btn-ghost" onclick="empleadosView()">🔍 Buscar</button>
        </div>
      </div>

      <div class="card section table-wrap">
        ${employees.length === 0
          ? '<div class="empty-state"><div class="empty-icon">👥</div><p>Sin empleados que coincidan con los filtros</p></div>'
          : `<table>
               <thead><tr>
                 <th>No. Emp</th><th>Nombre</th>
                 <th>Puesto</th><th>Turno</th>
                 <th>Salario <button onclick="empSalarioVisible=!empSalarioVisible;empleadosView()" style="border:none;background:none;cursor:pointer;font-size:11px;padding:0;color:#6b7280;" title="Mostrar/ocultar">${empSalarioVisible?'🙈':'👁'}</button></th>
                 <th>Vac.</th><th>Estatus</th><th>Usuario</th><th>Acciones</th>
               </tr></thead>
               <tbody>
                 ${employees.map(emp => {
                   const vacRem = emp.vacation_remaining ?? (emp.total_vacation_days || 15);
                   const vacTotal = emp.total_vacation_days || 15;
                   const vacColor = vacRem <= 0 ? '#b91c1c' : vacRem <= 5 ? '#b45309' : '#059669';
                   const hasUser = (state.rhhUsers || []).some(u => u.employee_id === emp.id);
                   const empUser = state.rhhUsers?.find(u => u.employee_id === emp.id);
                   const userBadge = hasUser
                     ? `<span style="font-size:10px;background:#d1fae5;color:#065f46;padding:2px 6px;border-radius:8px;">👤 ${empUser?.role || '—'}</span>
                        <button class="btn-ghost" style="font-size:10px;padding:2px 6px;color:#7c3aed;" title="Restablecer contraseña" onclick="openResetPwdModal(${empUser?.id},'${(emp.full_name||'').replace(/'/g,"\\'")}')">🔑</button>
                        <button class="btn-ghost" style="font-size:10px;padding:2px 6px;color:#0369a1;" title="Cambiar correo de login" onclick="openChangeLoginEmailModal(${empUser?.id},'${(emp.full_name||'').replace(/'/g,"\\'")}','${empUser?.email||''}','${emp.email||''}')">📧</button>`
                     : `<button class="btn-ghost" style="font-size:11px;color:#7c3aed;" onclick="openCreateUserModal(${emp.id},'${(emp.full_name || '').replace(/'/g, "\\'")}','${emp.email || ''}')">+ Cuenta</button>`;
                   const comprasLink = emp.compras_email
                     ? `<br><span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:6px;" title="Vinculado a Compras: ${emp.compras_email}">🔗 ${emp.compras_email}</span>`
                     : '';
                   const salarioCell = empSalarioVisible
                     ? (emp.daily_salary ? `$${Number(emp.daily_salary).toLocaleString()}/día` : (emp.base_salary ? `$${Number(emp.base_salary).toLocaleString()}/mes` : '—'))
                     : `<span style="filter:blur(5px);user-select:none;">$••••</span>`;
                   return `
                   <tr>
                     <td><span class="small muted">${emp.employee_number}</span>${emp.checker_number ? `<br><span class="small muted">Check: ${emp.checker_number}</span>` : ''}</td>
                     <td>
                       <strong>${emp.full_name}</strong><br>
                       <span class="small muted">${emp.email}</span>
                       ${comprasLink}
                     </td>
                     <td>${emp.position?.name || '—'}<br><span class="small muted">${emp.department?.name || ''}</span></td>
                     <td>${shiftDot(emp.shift)}</td>
                     <td style="text-align:right;font-size:12px;">${salarioCell}</td>
                     <td style="text-align:center;font-weight:700;color:${vacColor};font-size:12px;" title="${vacRem} días restantes de ${vacTotal}">${vacRem}/${vacTotal}</td>
                     <td>${statusPill(emp.status)}</td>
                     <td style="text-align:center;">${userBadge}</td>
                     <td>
                       <button class="btn-ghost" style="font-size:12px;" onclick="showEditEmployee(${emp.id})">✏️ Editar</button>
                       <button class="btn-ghost" style="font-size:12px;" onclick="showExpediente(${emp.id})">📁 Exp.</button>
                       <button class="btn-ghost" style="font-size:12px;" onclick="historialEmpleadoView(${emp.id})">📋 Historial</button>
                       <button class="btn-ghost" style="font-size:12px;color:#1d4ed8;" onclick="openLinkComprasModal(${emp.id},'${(emp.full_name||'').replace(/'/g,"\\'")}','${emp.compras_email||''}')">🔗 Vincular</button>
                       ${emp.status === 'active' ? `<button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="deactivateEmployee(${emp.id})">🗑️ Desactivar</button>` : ''}
                     </td>
                   </tr>`;
                 }).join('')}
               </tbody>
             </table>`
        }
      </div>
    `;

    const formContent = `
      <div id="emp-form-wrap">
        ${empFormHtml(null)}
      </div>
    `;

    let tabContent = listContent;
    if (empTab === 'expediente') tabContent = '<div id="expediente-wrap"><div class="loading-overlay">Cargando expediente...</div></div>';
    else if (empTab === 'nuevo') tabContent = formContent;
    else if (empTab === 'compras') tabContent = '<div id="compras-emp-tab"><div class="loading-overlay">Cargando usuarios de Compras...</div></div>';

    const content = `
      <div class="module-title">
        <h2>👥 Gestión de Empleados</h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn-primary" onclick="empTab='nuevo';empEditId=null;empleadosView()">+ Nuevo empleado</button>
          <button class="btn-ghost" onclick="exportEmpleadosExcel()">⬇ Exportar Base</button>
          <label class="btn-ghost" style="cursor:pointer;margin:0;">
            ⬆ Importar Base
            <input type="file" accept=".xlsx,.xls" style="display:none;" onchange="importEmpleadosExcel(this)">
          </label>
        </div>
      </div>
      <div class="tabs">
        <button class="tab-btn ${empTab==='list'?'active':''}" onclick="empTab='list';empleadosView()">📋 Lista</button>
        <button class="tab-btn ${empTab==='nuevo'?'active':''}" onclick="empTab='nuevo';empleadosView()">➕ Nuevo/Editar</button>
        ${empEditId ? `<button class="tab-btn ${empTab==='expediente'?'active':''}" onclick="empTab='expediente';empleadosView()">📁 Expediente</button>` : ''}
        <button class="tab-btn ${empTab==='compras'?'active':''}" onclick="empTab='compras';empleadosView()">🏪 De Compras</button>
      </div>
      ${tabContent}
    `;

    el.innerHTML = shell(content, 'empleados');
    if (empTab === 'expediente' && empEditId) {
      loadExpediente(empEditId);
    } else if (empTab === 'compras') {
      const comprasEl = document.getElementById('compras-emp-tab');
      if (comprasEl) loadComprasEmpTab(comprasEl);
    }
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'empleados');
  }
}

function empFormHtml(emp) {
  const depts = state.departments.map(d =>
    `<option value="${d.id}" ${emp?.department_id == d.id ? 'selected' : ''}>${d.name}</option>`
  ).join('');
  const positions = state.positions.map(p =>
    `<option value="${p.id}" ${emp?.position_id == p.id ? 'selected' : ''}>${p.name}</option>`
  ).join('');
  const shifts = state.shifts.map(s =>
    `<option value="${s.id}" ${emp?.shift_id == s.id ? 'selected' : ''}>${s.name}</option>`
  ).join('');
  const supervisors = state.employees.filter(e => e.status === 'active' && (!emp || e.id !== emp.id)).map(e =>
    `<option value="${e.id}" ${emp?.supervisor_id == e.id ? 'selected' : ''}>${e.full_name}</option>`
  ).join('');

  // Checkboxes de puestos habilitados
  const enabledPosIds = Array.isArray(emp?.enabled_positions) ? emp.enabled_positions.map(Number) : [];
  const positionCheckboxes = state.positions.map(p =>
    `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin:4px 0;">
      <input type="checkbox" class="emp-pos-chk" value="${p.id}" ${enabledPosIds.includes(p.id) ? 'checked' : ''}>
      ${p.name} <span class="small muted">(${state.departments.find(d=>d.id===p.department_id)?.name || ''})</span>
    </label>`
  ).join('');

  return `
    <div class="form-section">
      <h3>${emp ? `Editar: ${emp.full_name}` : 'Nuevo Empleado'}</h3>
      <input type="hidden" id="ef-id" value="${emp?.id || ''}" />

      <h4 style="margin:16px 0 8px;color:#064e3b;border-bottom:1px solid var(--line);padding-bottom:6px;">Datos generales</h4>
      <div class="row">
        <div>
          <label>Nombre completo *</label>
          <input id="ef-name" value="${emp?.full_name || ''}" placeholder="Nombre completo" />
        </div>
        <div>
          <label>Correo electrónico *</label>
          <input id="ef-email" type="email" value="${emp?.email || ''}" placeholder="correo@empresa.com" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>No. Nómina</label>
          <input id="ef-nomina" value="${emp?.nomina_number || ''}" placeholder="003" />
        </div>
        <div>
          <label>Teléfono</label>
          <input id="ef-phone" value="${emp?.phone || ''}" placeholder="555-0000" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>Fecha de nacimiento</label>
          <input id="ef-birth" type="date" value="${emp?.birth_date || ''}" />
        </div>
        <div>
          <label>Sexo</label>
          <select id="ef-gender">
            <option value="">Sin especificar</option>
            <option value="Masculino" ${(emp?.gender||'').trim()==='Masculino'?'selected':''}>Masculino</option>
            <option value="Femenino"  ${(emp?.gender||'').trim()==='Femenino'?'selected':''}>Femenino</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div style="grid-column:1/-1;">
          <label>Dirección</label>
          <input id="ef-address" value="${(emp?.address||'').replace(/"/g,'&quot;')}" placeholder="Calle y número, colonia..." />
        </div>
      </div>
      <div class="row">
        <div>
          <label>Tipo de sangre</label>
          <select id="ef-blood">
            <option value="">Desconocido</option>
            ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(t=>`<option value="${t}" ${(emp?.blood_type||'').trim()===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Hijos</label>
          <input id="ef-children" value="${emp?.children||''}" placeholder="NO / SI (2)" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>Alergias</label>
          <input id="ef-allergies" value="${(emp?.allergies||'').replace(/"/g,'&quot;')}" placeholder="NO / Penicilina..." />
        </div>
        <div>
          <label>Enfermedades</label>
          <input id="ef-diseases" value="${(emp?.diseases||'').replace(/"/g,'&quot;')}" placeholder="NO / Diabetes..." />
        </div>
      </div>

      <h4 style="margin:16px 0 8px;color:#064e3b;border-bottom:1px solid var(--line);padding-bottom:6px;">Datos oficiales</h4>
      <div class="row">
        <div>
          <label>RFC</label>
          <input id="ef-rfc" value="${emp?.rfc || ''}" placeholder="LOAM900322XXX" style="text-transform:uppercase;" />
        </div>
        <div>
          <label>CURP</label>
          <input id="ef-curp" value="${emp?.curp || ''}" placeholder="LOAM900322MDFXXX00" style="text-transform:uppercase;" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>NSS (Núm. Seguro Social)</label>
          <input id="ef-nss" value="${emp?.nss || ''}" placeholder="12345678901" />
        </div>
        <div>
          <label>No. de checador</label>
          <input id="ef-checker" value="${emp?.checker_number || ''}" placeholder="001" />
        </div>
      </div>

      <h4 style="margin:16px 0 8px;color:#064e3b;border-bottom:1px solid var(--line);padding-bottom:6px;">Datos laborales</h4>
      <div class="row">
        <div>
          <label>Departamento</label>
          <select id="ef-dept"><option value="">Sin asignar</option>${depts}</select>
        </div>
        <div>
          <label>Puesto principal</label>
          <select id="ef-pos"><option value="">Sin asignar</option>${positions}</select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Turno</label>
          <select id="ef-shift"><option value="">Sin asignar</option>${shifts}</select>
        </div>
        <div>
          <label>Supervisor directo</label>
          <select id="ef-supervisor"><option value="">Sin supervisor</option>${supervisors}</select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Tipo de contrato</label>
          <select id="ef-contract">
            <option value="indefinido" ${emp?.contract_type==='indefinido'?'selected':''}>Indefinido</option>
            <option value="determinado" ${emp?.contract_type==='determinado'?'selected':''}>Determinado</option>
            <option value="eventual" ${emp?.contract_type==='eventual'?'selected':''}>Eventual</option>
            <option value="temporal" ${emp?.contract_type==='temporal'?'selected':''}>Temporal</option>
            <option value="honorarios" ${emp?.contract_type==='honorarios'?'selected':''}>Honorarios</option>
          </select>
        </div>
        <div>
          <label>Proyecto / Cliente</label>
          <input id="ef-project" value="${emp?.project || ''}" placeholder="SKF, Amsted, etc." />
        </div>
      </div>
      <div class="row">
        <div>
          <label>Fecha de ingreso</label>
          <input id="ef-start" type="date" value="${emp?.start_date || emp?.hire_date || ''}" />
        </div>
        <div>
          <label>Estatus</label>
          <select id="ef-status">
            <option value="active" ${(!emp || emp.status==='active')?'selected':''}>Activo</option>
            <option value="inactive" ${emp?.status==='inactive'?'selected':''}>Inactivo</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Salario diario</label>
          <input id="ef-daily-salary" type="number" value="${emp?.daily_salary || ''}" placeholder="0.00" min="0" step="0.01" />
        </div>
        <div>
          <label>Salario base (mensual)</label>
          <input id="ef-salary" type="number" value="${emp?.base_salary || ''}" placeholder="0.00" min="0" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>Días de vacaciones anuales</label>
          <input id="ef-vac-days" type="number" value="${emp?.total_vacation_days ?? 15}" min="0" max="365" style="width:100px;" />
        </div>
      </div>

      <h4 style="margin:16px 0 8px;color:#064e3b;border-bottom:1px solid var(--line);padding-bottom:6px;">Puestos habilitados</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px;padding:8px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
        ${positionCheckboxes}
      </div>

      <h4 style="margin:16px 0 8px;color:#064e3b;border-bottom:1px solid var(--line);padding-bottom:6px;">Contacto de emergencia</h4>
      <div class="row">
        <div>
          <label>Nombre del contacto</label>
          <input id="ef-ec-name" value="${emp?.emergency_contact_name || ''}" placeholder="Nombre completo" />
        </div>
        <div>
          <label>Teléfono del contacto</label>
          <input id="ef-ec-phone" value="${emp?.emergency_contact_phone || ''}" placeholder="555-0000" />
        </div>
      </div>

      <div class="actions" style="margin-top:16px;">
        <button class="btn-primary" onclick="saveEmployee()">💾 Guardar</button>
        <button class="btn-ghost" onclick="empTab='list';empleadosView()">Cancelar</button>
      </div>
    </div>
  `;
}

async function showEditEmployee(id) {
  try {
    const emp = await api(`/api/rhh/employees/${id}`);
    if (!emp) return;
    empTab = 'nuevo';
    empEditId = id;
    await empleadosView();
    const wrap = document.getElementById('emp-form-wrap');
    if (wrap) wrap.innerHTML = empFormHtml(emp);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function showExpediente(id) {
  empEditId = id;
  empTab = 'expediente';
  await empleadosView();
  loadExpediente(id);
}

async function saveEmployee() {
  const id = document.getElementById('ef-id')?.value;
  // Recolectar puestos habilitados
  const enabledPositions = [...document.querySelectorAll('.emp-pos-chk:checked')].map(c => Number(c.value));

  const body = {
    full_name: document.getElementById('ef-name')?.value?.trim(),
    email: document.getElementById('ef-email')?.value?.trim(),
    phone: document.getElementById('ef-phone')?.value?.trim() || null,
    birth_date: document.getElementById('ef-birth')?.value || null,
    // Datos oficiales
    rfc: document.getElementById('ef-rfc')?.value?.trim()?.toUpperCase() || '',
    curp: document.getElementById('ef-curp')?.value?.trim()?.toUpperCase() || '',
    nss: document.getElementById('ef-nss')?.value?.trim() || '',
    checker_number: document.getElementById('ef-checker')?.value?.trim() || '',
    // Datos laborales
    department_id: document.getElementById('ef-dept')?.value || null,
    position_id: document.getElementById('ef-pos')?.value || null,
    shift_id: document.getElementById('ef-shift')?.value || null,
    supervisor_id: document.getElementById('ef-supervisor')?.value || null,
    contract_type: document.getElementById('ef-contract')?.value,
    project: document.getElementById('ef-project')?.value?.trim() || '',
    start_date: document.getElementById('ef-start')?.value || null,
    hire_date: document.getElementById('ef-start')?.value || null,
    status: document.getElementById('ef-status')?.value,
    daily_salary: document.getElementById('ef-daily-salary')?.value ? Number(document.getElementById('ef-daily-salary').value) : null,
    base_salary: document.getElementById('ef-salary')?.value || 0,
    // Puestos habilitados
    enabled_positions: enabledPositions,
    primary_position_id: document.getElementById('ef-pos')?.value ? Number(document.getElementById('ef-pos').value) : null,
    // Contacto de emergencia
    emergency_contact_name: document.getElementById('ef-ec-name')?.value?.trim() || '',
    emergency_contact_phone: document.getElementById('ef-ec-phone')?.value?.trim() || '',
    // Vacaciones
    total_vacation_days: document.getElementById('ef-vac-days')?.value ? Number(document.getElementById('ef-vac-days').value) : 15,
    // Datos adicionales
    nomina_number: document.getElementById('ef-nomina')?.value?.trim() || '',
    address:   document.getElementById('ef-address')?.value?.trim() || '',
    gender:    document.getElementById('ef-gender')?.value || '',
    blood_type:document.getElementById('ef-blood')?.value || '',
    children:  document.getElementById('ef-children')?.value?.trim() || '',
    allergies: document.getElementById('ef-allergies')?.value?.trim() || '',
    diseases:  document.getElementById('ef-diseases')?.value?.trim() || ''
  };

  if (!body.full_name || !body.email) {
    toast('Nombre y correo son requeridos', 'warning');
    return;
  }

  try {
    if (id) {
      await api(`/api/rhh/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast('Empleado actualizado');
    } else {
      await api('/api/rhh/employees', { method: 'POST', body: JSON.stringify(body) });
      toast('Empleado creado exitosamente');
    }
    await loadCatalogs();
    empTab = 'list';
    empEditId = null;
    empleadosView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deactivateEmployee(id) {
  // Eliminar modal anterior si existe
  const existing = document.getElementById('bajaModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'bajaModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <h3 style="margin:0 0 16px;color:#064e3b;">Dar de baja empleado</h3>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Motivo de baja</label>
        <select id="baja-reason" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
          <option value="baja_voluntaria">Baja voluntaria (renuncia)</option>
          <option value="baja_involuntaria">Baja involuntaria (despido)</option>
        </select>
      </div>
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:#92400e;">
        ⚠️ Se generará una vacante automáticamente para el puesto vacante.
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn-ghost" onclick="document.getElementById('bajaModal').remove()">Cancelar</button>
        <button class="btn-primary" style="background:#b91c1c;" onclick="confirmDeactivate(${id})">Confirmar baja</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function confirmDeactivate(id) {
  const reason = document.getElementById('baja-reason')?.value || 'baja_voluntaria';
  const modal = document.getElementById('bajaModal');
  if (modal) modal.remove();
  try {
    const result = await api(`/api/rhh/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'inactive', termination_reason: reason })
    });
    if (result?.vacancy_created) {
      toast('Empleado dado de baja. Se generó una vacante automáticamente.', 'success');
    } else {
      toast('Empleado dado de baja.');
    }
    await loadCatalogs();
    empleadosView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── 6. Incidencias Semanales ──────────────────────────────────────────────────
// Legacy filter (mantener por compatibilidad con misIncidenciasView / checador)
let incFilter = { employee_id: '', type: '', status: '', date_from: '', date_to: '' };

// Estado módulo semanal
let incSemPeriodo  = 0;
let incSemRows     = [];
let incSemPeriodos = [];
let _heEmpId       = null;

async function incidenciasView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando períodos...</div>', 'incidencias');
  try {
    if (incSemPeriodos.length === 0) {
      incSemPeriodos = await api('/api/rhh/nomina/periodos') || [];
    }
    if (!incSemPeriodo && incSemPeriodos.length > 0) {
      incSemPeriodo = incSemPeriodos[incSemPeriodos.length - 1].no_periodo;
    }
    await _loadIncSem();
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'incidencias');
  }
}

async function _loadIncSem() {
  try {
    if (incSemPeriodo) {
      incSemRows = await api(`/api/rhh/nomina/incidencias?no_periodo=${incSemPeriodo}`) || [];
    }
    _renderIncSem();
  } catch (err) { toast(err.message, 'error'); }
}

function _renderIncSem() {
  const el = document.getElementById('app');
  const periodo = incSemPeriodos.find(p => p.no_periodo === incSemPeriodo);

  const periodOpts = incSemPeriodos.map(p =>
    `<option value="${p.no_periodo}" ${p.no_periodo === incSemPeriodo ? 'selected' : ''}>Semana ${p.no_periodo} &nbsp;·&nbsp; ${p.fecha_inicio} al ${p.fecha_fin}</option>`
  ).join('');

  const tableRows = incSemRows.map((r, idx) => {
    const empId = r.employee_id;
    const heBtn = (r.horas_extras_total || 0) > 0
      ? `<button class="btn-ghost" style="font-size:10px;padding:1px 4px;margin-left:2px;" title="Detalle HE" onclick="showHEDetalle(${empId})">📋</button>`
      : '';
    return `<tr>
      <td style="white-space:nowrap;padding:4px 8px;">
        <strong style="font-size:12px;">${escHtml(r.employee?.full_name || '—')}</strong><br>
        <span class="small muted">${escHtml(r.department?.name || '—')}</span>
      </td>
      <td style="padding:3px;"><input type="number" min="0" max="7" step="0.5" value="${r.dias_pagados ?? 7}" style="width:52px;font-size:12px;" onchange="incSemRows[${idx}].dias_pagados=parseFloat(this.value)||0" /></td>
      <td style="padding:3px;"><input type="number" min="0" max="7" step="0.5" value="${r.faltas ?? 0}" style="width:52px;font-size:12px;" onchange="incSemRows[${idx}].faltas=parseFloat(this.value)||0" /></td>
      <td style="padding:3px;">
        <input type="number" min="0" max="80" step="0.5" value="${r.horas_extras_total ?? 0}" style="width:56px;font-size:12px;" onchange="incSemRows[${idx}].horas_extras_total=parseFloat(this.value)||0" />${heBtn}
      </td>
      <td style="padding:3px;text-align:center;"><input type="checkbox" ${r.despensa ? 'checked' : ''} onchange="incSemRows[${idx}].despensa=this.checked?1:0" /></td>
      <td style="padding:3px;"><input type="number" min="0" max="7" step="0.5" placeholder="N/A" value="${r.bono_puntualidad_dias ?? ''}" style="width:52px;font-size:12px;" onchange="incSemRows[${idx}].bono_puntualidad_dias=this.value===''?null:parseFloat(this.value)" /></td>
      <td style="padding:3px;"><input type="number" min="0" max="7" step="0.5" placeholder="N/A" value="${r.bono_eficiencia_dias ?? ''}" style="width:52px;font-size:12px;" onchange="incSemRows[${idx}].bono_eficiencia_dias=this.value===''?null:parseFloat(this.value)" /></td>
      <td style="padding:3px;"><input type="number" min="0" step="0.5" placeholder="días" value="${r.bono_instructor ?? ''}" style="width:52px;font-size:12px;" onchange="incSemRows[${idx}].bono_instructor=this.value===''?null:parseFloat(this.value)" /></td>
      <td style="padding:3px;text-align:center;"><input type="checkbox" ${r.prima_dominical ? 'checked' : ''} onchange="incSemRows[${idx}].prima_dominical=this.checked?1:0" /></td>
      <td style="padding:3px;"><input type="number" min="0" step="0.5" placeholder="días" value="${r.vacaciones_dias ?? ''}" style="width:52px;font-size:12px;" onchange="incSemRows[${idx}].vacaciones_dias=this.value===''?null:parseFloat(this.value)" /></td>
      <td style="padding:3px;"><input type="number" min="0" step="0.5" placeholder="días" value="${r.gratificacion ?? ''}" style="width:52px;font-size:12px;" onchange="incSemRows[${idx}].gratificacion=this.value===''?null:parseFloat(this.value)" /></td>
      <td style="padding:3px;"><input type="text" value="${escHtml(r.notas || '')}" style="width:90px;font-size:12px;" onchange="incSemRows[${idx}].notas=this.value" /></td>
    </tr>`;
  }).join('');

  const content = `
    <div class="module-title">
      <h2>📋 Incidencias Semanales</h2>
    </div>

    <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Período (semana)</label>
        <select style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" onchange="incSemPeriodo=parseInt(this.value);_loadIncSem()">
          ${periodOpts}
        </select>
      </div>
      ${periodo ? `<span style="font-size:13px;color:#374151;padding:6px 12px;background:#f3f4f6;border-radius:6px;">📅 ${periodo.fecha_inicio} al ${periodo.fecha_fin}</span>` : ''}
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <button class="btn-primary" onclick="guardarTodasIncidencias()">💾 Guardar período</button>
      <button class="btn-ghost" onclick="exportarIncidencias()">⬇ Exportar CSV</button>
      <button class="btn-ghost" style="color:#0369a1;" onclick="incImportarPdfClick()">📄 Importar Lista de Raya PDF</button>
      <button class="btn-ghost" style="color:#7c3aed;" onclick="location.hash='#autorizaciones'">✅ Autorizaciones pendientes</button>
    </div>
    <div id="inc-pdf-msg" style="margin-bottom:8px;"></div>

    <div class="card section" style="overflow-x:auto;padding:0;">
      ${incSemRows.length === 0
        ? '<div class="empty-state" style="padding:32px;"><p>Sin empleados activos</p></div>'
        : `<table style="min-width:1050px;font-size:12px;border-collapse:collapse;">
             <thead>
               <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
                 <th style="text-align:left;padding:6px 8px;min-width:170px;">Empleado</th>
                 <th style="text-align:center;padding:6px 4px;" title="Días pagados">Días</th>
                 <th style="text-align:center;padding:6px 4px;color:#b91c1c;" title="Faltas">Faltas</th>
                 <th style="text-align:center;padding:6px 4px;color:#059669;" title="Horas Extra">H.Extra</th>
                 <th style="text-align:center;padding:6px 4px;" title="Despensa (Sí/No)">
                   Desp.<br>
                   <button onclick="incSemToggleAll('despensa',true)" style="font-size:9px;border:none;background:#dcfce7;color:#15803d;border-radius:4px;cursor:pointer;padding:1px 4px;" title="Activar todos">✓T</button>
                   <button onclick="incSemToggleAll('despensa',false)" style="font-size:9px;border:none;background:#fee2e2;color:#b91c1c;border-radius:4px;cursor:pointer;padding:1px 4px;" title="Quitar todos">✗</button>
                 </th>
                 <th style="text-align:center;padding:6px 4px;" title="Bono Puntualidad (días)">B.Punt.</th>
                 <th style="text-align:center;padding:6px 4px;" title="Bono Eficiencia (días)">B.Efic.</th>
                 <th style="text-align:center;padding:6px 4px;" title="Bono Instructor (días)">B.Inst.</th>
                 <th style="text-align:center;padding:6px 4px;" title="Prima Dominical">
                   P.Dom.<br>
                   <button onclick="incSemToggleAll('prima_dominical',true)" style="font-size:9px;border:none;background:#dcfce7;color:#15803d;border-radius:4px;cursor:pointer;padding:1px 4px;" title="Activar todos">✓T</button>
                   <button onclick="incSemToggleAll('prima_dominical',false)" style="font-size:9px;border:none;background:#fee2e2;color:#b91c1c;border-radius:4px;cursor:pointer;padding:1px 4px;" title="Quitar todos">✗</button>
                 </th>
                 <th style="text-align:center;padding:6px 4px;color:#1d4ed8;" title="Vacaciones (días)">Vac.</th>
                 <th style="text-align:center;padding:6px 4px;" title="Gratificación (días)">Gratif.</th>
                 <th style="text-align:left;padding:6px 4px;">Notas</th>
               </tr>
             </thead>
             <tbody>${tableRows}</tbody>
           </table>`
      }
    </div>
    <div id="he-detalle-panel" style="margin-top:12px;"></div>
  `;

  el.innerHTML = shell(content, 'incidencias');
}

// ── Importar Lista de Raya PDF ────────────────────────────────────────────────

function incImportarPdfClick() {
  // Crear input file dinámico y dispararlo
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async () => {
    const file = input.files[0];
    document.body.removeChild(input);
    if (!file) return;
    await incImportarPdf(file);
  };
  input.click();
}

async function incImportarPdf(file) {
  const msgEl = document.getElementById('inc-pdf-msg');
  if (msgEl) msgEl.innerHTML = '<span style="color:#6b7280;font-size:13px;">⏳ Procesando PDF… puede tardar unos segundos.</span>';

  try {
    const form = new FormData();
    form.append('pdf', file);
    if (incSemPeriodo) form.append('no_periodo', String(incSemPeriodo));

    const res = await fetch('/api/rhh/nomina/importar-pdf', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || `Error ${res.status}`;
      if (msgEl) msgEl.innerHTML = `<span style="color:#b91c1c;font-size:13px;">❌ ${escHtml(msg)}</span>`;
      toast(msg, 'error');
      return;
    }

    _renderPdfResult(data);
  } catch (err) {
    const msg = 'Error de conexión: ' + err.message;
    if (msgEl) msgEl.innerHTML = `<span style="color:#b91c1c;font-size:13px;">❌ ${escHtml(msg)}</span>`;
    toast(msg, 'error');
  }
}

function _renderPdfResult(data) {
  const msgEl = document.getElementById('inc-pdf-msg');
  if (!msgEl) return;

  const per = data.header?.no_periodo ? `Período ${data.header.no_periodo} · ${data.header.fecha_inicio || ''} → ${data.header.fecha_fin || ''}` : '';

  if (data.mode === 'import') {
    // Modo importación exitosa
    let html = `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 16px;font-size:13px;">
        <div style="font-weight:700;color:#15803d;margin-bottom:6px;">✅ Importación completada — ${per}</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
          <span>📄 Total PDF: <strong>${data.total_pdf}</strong></span>
          <span>💾 Importados: <strong>${data.importados}</strong></span>
          <span style="color:#b45309;">⬆ Altas detectadas: <strong>${data.altas?.length || 0}</strong></span>
          <span style="color:#b91c1c;">⬇ Posibles bajas: <strong>${data.posibles_bajas?.length || 0}</strong></span>
        </div>`;

    if (data.altas?.length) {
      html += `<details style="margin-top:4px;"><summary style="cursor:pointer;color:#b45309;font-weight:600;">▸ Altas detectadas (no están en catálogo)</summary><ul style="margin:6px 0 0 16px;padding:0;">`;
      data.altas.forEach(a => { html += `<li>${escHtml(a.no)} ${escHtml(a.nombre)} · ${escHtml(a.dept || '')} · ${escHtml(a.puesto || '')}</li>`; });
      html += '</ul></details>';
    }
    if (data.posibles_bajas?.length) {
      html += `<details style="margin-top:4px;"><summary style="cursor:pointer;color:#b91c1c;font-weight:600;">▸ Posibles bajas (activos en DB, no en PDF)</summary><ul style="margin:6px 0 0 16px;padding:0;">`;
      data.posibles_bajas.forEach(e => { html += `<li>${escHtml(e.employee_number)} ${escHtml(e.full_name)}</li>`; });
      html += '</ul></details>';
    }
    if (data.log?.length) {
      html += `<details style="margin-top:4px;"><summary style="cursor:pointer;color:#6b7280;font-size:12px;">▸ Log detallado (${data.log.length})</summary><pre style="font-size:11px;margin:6px 0 0;white-space:pre-wrap;">${escHtml(data.log.join('\n'))}</pre></details>`;
    }
    html += `<button class="btn-ghost" style="margin-top:8px;font-size:12px;" onclick="this.closest('div[style]').remove();_loadIncSem()">🔄 Recargar tabla</button>`;
    html += '</div>';
    msgEl.innerHTML = html;
    toast(`Importación S${data.no_periodo}: ${data.importados} registros guardados`, 'success');

  } else if (data.mode === 'compare') {
    // Modo comparación
    const conDiff = data.con_diff || 0;
    const color = conDiff === 0 ? '#15803d' : '#b45309';
    let html = `
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;font-size:13px;">
        <div style="font-weight:700;color:${color};margin-bottom:6px;">🔍 Comparación — ${per} (período ya existe en DB)</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
          <span>📄 Total PDF: <strong>${data.total_pdf}</strong></span>
          <span style="color:${conDiff ? '#b91c1c' : '#15803d'};">⚠ Con diferencias: <strong>${conDiff}</strong></span>
          <span style="color:#6b7280;">❓ No encontrados: <strong>${data.no_encontrados || 0}</strong></span>
          <span style="color:#b91c1c;">⬇ Posibles bajas: <strong>${data.posibles_bajas?.length || 0}</strong></span>
        </div>`;

    const diffsWithDiff = (data.diffs || []).filter(d => d.hasDiff || !d.encontrado);
    if (diffsWithDiff.length === 0) {
      html += '<div style="color:#15803d;font-weight:600;">✓ Sin diferencias — el PDF coincide con la base de datos.</div>';
    } else {
      html += '<div style="overflow-x:auto;"><table style="font-size:11px;border-collapse:collapse;min-width:500px;">';
      html += '<thead><tr style="background:#fef3c7;"><th style="padding:4px 8px;text-align:left;">No.</th><th style="padding:4px 8px;text-align:left;">Nombre</th><th style="padding:4px 8px;text-align:left;">Diferencias</th></tr></thead><tbody>';
      diffsWithDiff.forEach(d => {
        const diffs = [...d.campos, ...(d.conceptDiffs || [])].filter(c => c.diff);
        const diffText = diffs.map(c => `${c.campo}: PDF=${c.pdf} / DB=${c.db}`).join('; ') || (d.encontrado ? 'OK' : '❌ No en catálogo');
        html += `<tr style="border-bottom:1px solid #fde68a;"><td style="padding:3px 8px;">${escHtml(d.no)}</td><td style="padding:3px 8px;">${escHtml(d.nombre)}</td><td style="padding:3px 8px;color:#92400e;">${escHtml(diffText)}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }

    if (data.posibles_bajas?.length) {
      html += `<details style="margin-top:6px;"><summary style="cursor:pointer;color:#b91c1c;font-weight:600;">▸ Posibles bajas (${data.posibles_bajas.length})</summary><ul style="margin:6px 0 0 16px;padding:0;">`;
      data.posibles_bajas.forEach(e => { html += `<li>${escHtml(e.employee_number)} ${escHtml(e.full_name)}</li>`; });
      html += '</ul></details>';
    }
    html += `<button class="btn-ghost" style="margin-top:8px;font-size:12px;" onclick="this.closest('div[style]').remove()">✕ Cerrar</button>`;
    html += '</div>';
    msgEl.innerHTML = html;
    toast(`Comparación S${data.no_periodo}: ${conDiff} diferencias encontradas`, conDiff ? 'warning' : 'success');
  }
}

// Activa/desactiva un campo booleano para todos los empleados en la tabla
function incSemToggleAll(campo, valor) {
  incSemRows.forEach(r => { r[campo] = valor ? 1 : 0; });
  _renderIncSem();
  toast(`${campo === 'despensa' ? 'Despensa' : 'Prima dominical'}: ${valor ? 'todos activados' : 'todos desactivados'}`);
}

async function guardarTodasIncidencias() {
  if (!incSemPeriodo || incSemRows.length === 0) { toast('Selecciona un período', 'warning'); return; }
  try {
    const res = await api('/api/rhh/nomina/incidencias/bulk', {
      method: 'POST',
      body: JSON.stringify({
        no_periodo: incSemPeriodo,
        rows: incSemRows.map(r => ({
          employee_id:         r.employee_id,
          dias_pagados:        r.dias_pagados,
          faltas:              r.faltas,
          horas_extras_total:  r.horas_extras_total,
          despensa:            r.despensa,
          bono_puntualidad_dias: r.bono_puntualidad_dias,
          bono_eficiencia_dias:  r.bono_eficiencia_dias,
          bono_instructor:     r.bono_instructor,
          prima_dominical:     r.prima_dominical,
          vacaciones_dias:     r.vacaciones_dias,
          gratificacion:       r.gratificacion,
          notas:               r.notas,
        }))
      })
    });
    toast(`Guardados: ${res.saved} registros`);
  } catch (err) { toast(err.message, 'error'); }
}

async function exportarIncidencias() {
  if (!incSemPeriodo) { toast('Selecciona un período', 'warning'); return; }
  try {
    const data = await api(`/api/rhh/nomina/export?no_periodo=${incSemPeriodo}`);
    if (!data) return;
    const headers = ['No.Empleado','Nombre','Departamento','Puesto','Días Pagados','Faltas','Horas Extra','Despensa','B.Puntualidad (días)','B.Eficiencia (días)','B.Instructor (días)','Prima Dominical','Vacaciones (días)','Gratificación (días)','Notas'];
    const csvRows = [headers.join(',')];
    for (const r of data.rows) {
      csvRows.push([
        r.no_empleado,`"${r.nombre}"`,`"${r.departamento}"`,`"${r.puesto}"`,
        r.dias_pagados,r.faltas,r.horas_extras,r.despensa,
        r.bono_puntualidad_dias,r.bono_eficiencia_dias,r.bono_instructor,
        r.prima_dominical,r.vacaciones_dias,r.gratificacion,`"${r.notas}"`
      ].join(','));
    }
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    const p = data.periodo;
    a.download = `incidencias_S${incSemPeriodo}_${(p?.fecha_inicio||'').replace(/\//g,'-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exportado');
  } catch (err) { toast(err.message, 'error'); }
}

// Catálogos TE en memoria (cache para cascada)
let _teCatalogos = null;

async function _loadTeCatalogos() {
  if (_teCatalogos) return _teCatalogos;
  _teCatalogos = await api('/api/rhh/nomina/te-catalogos') || [];
  return _teCatalogos;
}

// Renderiza el select de motivos según la clasificación elegida
function _heMotivosOpts(cats, clasificId) {
  const cat = cats.find(c => c.id === Number(clasificId));
  if (!cat || !cat.motivos?.length) return '<option value="">— sin motivos —</option>';
  return '<option value="">Seleccionar motivo...</option>' +
    cat.motivos.map((m, i) => `<option value="${m}">${m}</option>`).join('');
}

// Actualiza el select de motivos sin re-renderizar el panel completo
function _heOnClasifChange(sel) {
  const cats  = _teCatalogos || [];
  const mSel  = document.getElementById('he-motivo');
  if (mSel) {
    mSel.innerHTML = _heMotivosOpts(cats, sel.value);
    document.getElementById('he-otro-wrap')?.style && (document.getElementById('he-otro-wrap').style.display = 'none');
  }
}

// Muestra campo de comentario cuando se elige "Otro"
function _heOnMotivoChange(sel) {
  const wrap = document.getElementById('he-otro-wrap');
  if (wrap) wrap.style.display = sel.value === 'Otro' ? 'block' : 'none';
}

async function showHEDetalle(empId) {
  _heEmpId = empId;
  const panel = document.getElementById('he-detalle-panel');
  if (!panel) return;
  try {
    const [data, cats] = await Promise.all([
      api(`/api/rhh/nomina/he-detalle?no_periodo=${incSemPeriodo}&employee_id=${empId}`),
      _loadTeCatalogos(),
    ]);
    const empRow = incSemRows.find(r => r.employee_id === empId);

    const detalleRows = (data || []).map(h => `
      <tr>
        <td>${h.fecha || '—'}</td>
        <td style="text-align:center;">${h.total_horas}h</td>
        <td>${escHtml(h.razon || '—')}</td>
        <td style="font-size:11px;color:#6b7280;">${escHtml(h.sub_razon || '—')}</td>
        <td style="font-size:11px;">${escHtml(h.solicita || '—')}</td>
        <td><button class="btn-ghost" style="font-size:10px;color:#b91c1c;" onclick="deleteHEDetalle(${h.id})">✕</button></td>
      </tr>`).join('');

    const clasifOpts = '<option value="">Seleccionar clasificación...</option>' +
      cats.map(c => `<option value="${c.id}">${escHtml(c.nombre)}</option>`).join('');

    const totalHE = (data || []).reduce((a, h) => a + (h.total_horas || 0), 0);

    panel.innerHTML = `
      <div class="card section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <h3 style="margin:0;">⚡ HE — ${escHtml(empRow?.employee?.full_name || 'Empleado')}</h3>
          <div style="display:flex;align-items:center;gap:12px;">
            ${(data||[]).length > 0 ? `<span style="font-size:12px;color:#1d4ed8;font-weight:700;">Total: ${totalHE}h</span>` : ''}
            <button class="btn-ghost" style="font-size:11px;" onclick="document.getElementById('he-detalle-panel').innerHTML=''">✕ Cerrar</button>
          </div>
        </div>
        ${(data || []).length > 0
          ? `<table style="font-size:12px;margin-bottom:12px;width:100%;">
               <thead><tr><th>Fecha</th><th>Horas</th><th>Clasificación</th><th>Motivo</th><th>Registra</th><th></th></tr></thead>
               <tbody>${detalleRows}</tbody>
             </table>`
          : '<p style="color:var(--muted);font-size:13px;margin-bottom:10px;">Sin registros de HE para este período</p>'}
        <h4 style="margin-top:4px;margin-bottom:8px;">+ Agregar día de HE</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label style="font-size:11px;display:block;margin-bottom:3px;">Fecha</label>
            <input type="date" id="he-fecha" style="width:140px;font-size:12px;" />
          </div>
          <div>
            <label style="font-size:11px;display:block;margin-bottom:3px;">Horas</label>
            <input type="number" id="he-horas" min="0.5" max="12" step="0.5" style="width:70px;font-size:12px;" placeholder="hrs" />
          </div>
          <div>
            <label style="font-size:11px;display:block;margin-bottom:3px;">Clasificación</label>
            <select id="he-clasif" style="font-size:12px;min-width:160px;" onchange="_heOnClasifChange(this)">
              ${clasifOpts}
            </select>
          </div>
          <div>
            <label style="font-size:11px;display:block;margin-bottom:3px;">Motivo</label>
            <select id="he-motivo" style="font-size:12px;min-width:160px;" onchange="_heOnMotivoChange(this)">
              <option value="">— elige clasificación primero —</option>
            </select>
          </div>
          <div id="he-otro-wrap" style="display:none;">
            <label style="font-size:11px;display:block;margin-bottom:3px;">Comentario <span style="color:#b91c1c;">*</span></label>
            <input id="he-otro-comentario" type="text" style="width:180px;font-size:12px;" placeholder="Describe el motivo..." />
          </div>
          <button class="btn-primary" style="font-size:12px;" onclick="saveHEDetalle(${empId})">Agregar</button>
        </div>
      </div>`;
  } catch (err) { if (panel) panel.innerHTML = `<div class="notice error">${err.message}</div>`; }
}

async function saveHEDetalle(empId) {
  const fecha    = document.getElementById('he-fecha')?.value;
  const horas    = document.getElementById('he-horas')?.value;
  const clasifId = document.getElementById('he-clasif')?.value;
  const motivo   = document.getElementById('he-motivo')?.value;
  if (!fecha || !horas) { toast('Fecha y horas son requeridos', 'warning'); return; }
  if (!clasifId) { toast('Selecciona una clasificación', 'warning'); return; }
  if (!motivo)   { toast('Selecciona un motivo', 'warning'); return; }

  // Si el motivo es "Otro", el comentario es obligatorio
  let comentario = document.getElementById('he-otro-comentario')?.value?.trim() || '';
  if (motivo === 'Otro' && !comentario) { toast('El comentario es obligatorio cuando el motivo es "Otro"', 'warning'); return; }

  // Obtener nombre de la clasificación
  const cats    = _teCatalogos || [];
  const cat     = cats.find(c => c.id === Number(clasifId));
  const razon   = cat?.nombre || '';
  const subRazon = motivo === 'Otro' ? `Otro: ${comentario}` : motivo;

  try {
    await api('/api/rhh/nomina/he-detalle', {
      method: 'POST',
      body: JSON.stringify({
        no_periodo:       incSemPeriodo,
        employee_id:      empId,
        fecha,
        total_horas:      Number(horas),
        razon,
        sub_razon:        subRazon,
        clasificacion_id: Number(clasifId),
      })
    });
    toast('HE registrada');
    showHEDetalle(empId);
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteHEDetalle(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await api(`/api/rhh/nomina/he-detalle/${id}`, { method: 'DELETE' });
    toast('Eliminado');
    if (_heEmpId) showHEDetalle(_heEmpId);
  } catch (err) { toast(err.message, 'error'); }
}

// ── INICIO código antiguo incidencias (se mantiene para misIncidenciasView / checador) ──
async function _legacyIncidenciasView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando incidencias...</div>', 'incidencias');

  try {
    let url = '/api/rhh/incidences?';
    if (incFilter.employee_id) url += `employee_id=${incFilter.employee_id}&`;
    if (incFilter.type) url += `type=${incFilter.type}&`;
    if (incFilter.status) url += `status=${incFilter.status}&`;
    if (incFilter.date_from) url += `date_from=${incFilter.date_from}&`;
    if (incFilter.date_to) url += `date_to=${incFilter.date_to}&`;

    const [incidences, employees] = await Promise.all([
      api(url),
      api('/api/rhh/employees')
    ]);
    if (!incidences) return;

    const empOpts = (employees || []).map(e =>
      `<option value="${e.id}" ${incFilter.employee_id == e.id ? 'selected' : ''}>${e.full_name}</option>`
    ).join('');

    const rows = incidences.map(inc => {
      const canApprove = ['supervisor', 'rh', 'admin'].includes(state.user?.role) && inc.status === 'pendiente';
      return `
        <tr>
          <td>${inc.employee?.full_name || '—'}<br><span class="small muted">${inc.employee?.employee_number || ''}</span></td>
          <td>${incTypePill(inc.type)}</td>
          <td>${fmtDateDisplay(inc.date)}${inc.date_end && inc.date_end !== inc.date ? ` → ${fmtDateDisplay(inc.date_end)}` : ''}</td>
          <td>${inc.hours ? inc.hours + 'h' : '—'}</td>
          <td>${statusPill(inc.status)}</td>
          <td>${inc.notes || '—'}</td>
          <td>
            ${canApprove ? `
              <button class="btn-primary" style="font-size:11px;padding:4px 8px;" onclick="approveIncidence(${inc.id},'aprobada')">✅ Aprobar</button>
              <button class="btn-ghost" style="font-size:11px;padding:4px 8px;color:#b91c1c;" onclick="approveIncidence(${inc.id},'rechazada')">✗ Rechazar</button>
            ` : ''}
          </td>
        </tr>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>⚠️ Incidencias</h2>
        <button class="btn-primary" onclick="showIncidenceForm()">+ Nueva incidencia</button>
      </div>

      <div class="filter-bar">
        <div>
          <label>Empleado</label>
          <select id="inc-emp" onchange="incFilter.employee_id=this.value;incidenciasView()">
            <option value="">Todos</option>${empOpts}
          </select>
        </div>
        <div>
          <label>Tipo</label>
          <select id="inc-type" onchange="incFilter.type=this.value;incidenciasView()">
            <option value="">Todos</option>
            <option value="falta" ${incFilter.type==='falta'?'selected':''}>Falta</option>
            <option value="vacacion" ${incFilter.type==='vacacion'?'selected':''}>Vacación</option>
            <option value="permiso" ${incFilter.type==='permiso'?'selected':''}>Permiso</option>
            <option value="incapacidad" ${incFilter.type==='incapacidad'?'selected':''}>Incapacidad</option>
            <option value="tiempo_extra" ${incFilter.type==='tiempo_extra'?'selected':''}>Tiempo extra</option>
          </select>
        </div>
        <div>
          <label>Estado</label>
          <select id="inc-status" onchange="incFilter.status=this.value;incidenciasView()">
            <option value="">Todos</option>
            <option value="pendiente" ${incFilter.status==='pendiente'?'selected':''}>Pendiente</option>
            <option value="aprobada" ${incFilter.status==='aprobada'?'selected':''}>Aprobada</option>
            <option value="rechazada" ${incFilter.status==='rechazada'?'selected':''}>Rechazada</option>
          </select>
        </div>
        <div>
          <label>Desde</label>
          <input type="date" id="inc-from" value="${incFilter.date_from}" onchange="incFilter.date_from=this.value;incidenciasView()" />
        </div>
        <div>
          <label>Hasta</label>
          <input type="date" id="inc-to" value="${incFilter.date_to}" onchange="incFilter.date_to=this.value;incidenciasView()" />
        </div>
      </div>

      <div class="card section table-wrap">
        ${incidences.length === 0
          ? '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Sin incidencias para los filtros seleccionados</p></div>'
          : `<table>
               <thead><tr>
                 <th>Empleado</th><th>Tipo</th><th>Fecha</th>
                 <th>Horas</th><th>Estado</th><th>Notas</th><th>Acciones</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>

      <div id="incidence-form-container"></div>
    `;

    el.innerHTML = shell(content, 'incidencias');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'incidencias');
  }
}

function showIncidenceForm() {
  const container = document.getElementById('incidence-form-container');
  if (!container) return;

  const empOpts = state.employees.map(e =>
    `<option value="${e.id}">${e.full_name}</option>`
  ).join('');

  container.innerHTML = `
    <div class="card section" style="margin-top:12px;">
      <h3>Nueva Incidencia</h3>
      <div class="row">
        <div>
          <label>Empleado *</label>
          <select id="ni-emp"><option value="">Seleccionar...</option>${empOpts}</select>
        </div>
        <div>
          <label>Tipo *</label>
          <select id="ni-type">
            <option value="falta">Falta</option>
            <option value="vacacion">Vacación</option>
            <option value="permiso">Permiso</option>
            <option value="incapacidad">Incapacidad</option>
            <option value="tiempo_extra">Tiempo extra</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Fecha inicio *</label>
          <input type="date" id="ni-date" value="${fmtDate(new Date())}" />
        </div>
        <div>
          <label>Fecha fin</label>
          <input type="date" id="ni-date-end" value="${fmtDate(new Date())}" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>Horas (para tiempo extra)</label>
          <input type="number" id="ni-hours" placeholder="0" min="0" max="24" />
        </div>
        <div>
          <label>Notas</label>
          <input id="ni-notes" placeholder="Observaciones opcionales..." />
        </div>
      </div>
      <div class="actions" style="margin-top:12px;">
        <button class="btn-primary" onclick="saveIncidence()">Guardar incidencia</button>
        <button class="btn-ghost" onclick="document.getElementById('incidence-form-container').innerHTML=''">Cancelar</button>
      </div>
    </div>
  `;
}

async function saveIncidence() {
  const employee_id = document.getElementById('ni-emp')?.value;
  const type = document.getElementById('ni-type')?.value;
  const date = document.getElementById('ni-date')?.value;
  const date_end = document.getElementById('ni-date-end')?.value;
  const hours = document.getElementById('ni-hours')?.value;
  const notes = document.getElementById('ni-notes')?.value;

  if (!employee_id || !type || !date) {
    toast('Empleado, tipo y fecha son requeridos', 'warning');
    return;
  }

  try {
    await api('/api/rhh/incidences', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: Number(employee_id), type, date, date_end,
        hours: hours ? Number(hours) : null, notes: notes || null
      })
    });
    toast('Incidencia registrada');
    incidenciasView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function approveIncidence(id, status) {
  try {
    await api(`/api/rhh/incidences/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    toast(status === 'aprobada' ? 'Incidencia aprobada' : 'Incidencia rechazada');
    incidenciasView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── 7. Mi Horario (empleado) ──────────────────────────────────────────────────
let myCalYear = new Date().getFullYear();
let myCalMonth = new Date().getMonth() + 1;

async function miHorarioView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando tu horario...</div>', 'mi-horario');

  try {
    const empId = state.user?.employee_id;
    if (!empId) {
      el.innerHTML = shell('<div class="notice">No tienes un perfil de empleado vinculado.</div>', 'mi-horario');
      return;
    }

    const today = fmtDate(new Date());
    const monthStr = `${myCalYear}-${String(myCalMonth).padStart(2, '0')}`;
    const [calData, empData, myApps] = await Promise.all([
      api(`/api/rhh/schedule/calendar?year=${myCalYear}&month=${myCalMonth}&employee_id=${empId}`),
      api(`/api/rhh/employees/${empId}`),
      api(`/api/rhh/schedule/te-applications/my`).catch(() => [])
    ]);
    if (!calData) return;

    // TE seleccionados próximos
    const selectedTEs = (myApps || []).filter(a => a.status === 'selected');
    let teAlertHtml = '';
    if (selectedTEs.length > 0) {
      const teAuths = await api(`/api/rhh/schedule/te-authorizations?month=${monthStr}`).catch(() => []);
      const alerts = selectedTEs.map(a => {
        const auth = (teAuths || []).find(t => t.id === a.te_authorization_id);
        if (!auth || auth.date < today) return null;
        const shift = state.shifts.find(s => s.id === auth.shift_id);
        const pos = state.positions.find(p => p.id === a.position_id);
        return `<div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:13px;">
          ⚡ <strong>Tienes tiempo extra programado el ${fmtDateDisplay(auth.date)}</strong>${shift ? ` en turno ${shift.name}` : ''}${pos ? ` · Puesto: ${pos.name}` : ''}
        </div>`;
      }).filter(Boolean).join('');
      teAlertHtml = alerts;
    }

    const firstDayOfWeek = new Date(`${myCalYear}-${String(myCalMonth).padStart(2, '0')}-01T12:00:00`).getDay();
    const lastDay = new Date(myCalYear, myCalMonth, 0).getDate();

    // Build calendar cells
    let cellsHtml = '';
    // Empty cells before first day
    for (let i = 0; i < firstDayOfWeek; i++) {
      cellsHtml += '<div class="month-cal-day empty"></div>';
    }

    for (const dayData of calData.days) {
      const dateStr = dayData.date;
      const isToday = dateStr === today;
      const myData = dayData.employees.find(e => e.employee_id === empId);
      const inc = myData?.incidence;
      const ot = myData?.overtime;
      const works = myData?.works;

      let chipsHtml = '';
      if (inc) chipsHtml += `<div class="cell-chip type-${inc.type}" style="font-size:10px;margin:1px 0;">${incTypeLabel(inc.type)}</div>`;
      else if (works) chipsHtml += `<div class="cell-chip cell-asignado" style="font-size:10px;margin:1px 0;">${myData.shift?.code || '✓'}</div>`;
      if (ot) chipsHtml += `<div class="cell-chip type-tiempo_extra" style="font-size:10px;margin:1px 0;">+${ot.hours || ''}h</div>`;

      cellsHtml += `
        <div class="month-cal-day ${isToday ? 'today' : ''}">
          <div class="day-num">${new Date(dateStr + 'T12:00:00').getDate()}</div>
          <div class="day-chips">${chipsHtml}</div>
        </div>`;
    }

    const shift = empData?.shift;
    const content = `
      <div class="module-title">
        <h2>📅 Mi Horario</h2>
        <div style="font-size:14px;color:var(--muted);">
          ${shift ? `Turno: ${shiftDot(shift)} (${shift.start_time} - ${shift.end_time})` : 'Sin turno asignado'}
        </div>
      </div>

      ${teAlertHtml}

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button class="btn-ghost" onclick="myCalMonth--;if(myCalMonth<1){myCalMonth=12;myCalYear--;}miHorarioView()">‹</button>
        <strong style="min-width:160px;text-align:center;">${MONTHS[myCalMonth-1]} ${myCalYear}</strong>
        <button class="btn-ghost" onclick="myCalMonth++;if(myCalMonth>12){myCalMonth=1;myCalYear++;}miHorarioView()">›</button>
        <button class="btn-ghost" style="font-size:12px;" onclick="myCalYear=new Date().getFullYear();myCalMonth=new Date().getMonth()+1;miHorarioView()">Hoy</button>
      </div>

      <div class="card section">
        <div class="month-cal">
          ${DAYS_SHORT.map(d => `<div class="month-cal-header">${d}</div>`).join('')}
          ${cellsHtml}
        </div>
      </div>

      <div class="card section" style="margin-top:12px;">
        <strong>Leyenda:</strong>
        <span class="cell-chip cell-asignado" style="margin:0 4px;">Día laboral</span>
        <span class="cell-chip type-falta" style="margin:0 4px;">Falta</span>
        <span class="cell-chip type-vacacion" style="margin:0 4px;">Vacación</span>
        <span class="cell-chip type-permiso" style="margin:0 4px;">Permiso</span>
        <span class="cell-chip type-tiempo_extra" style="margin:0 4px;">T. Extra</span>
      </div>
    `;

    el.innerHTML = shell(content, 'mi-horario');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'mi-horario');
  }
}

// ── 8. Mis Solicitudes (empleado) ─────────────────────────────────────────────
async function misSolicitudesView() {
  _msVacBalance = null;
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando solicitudes...</div>', 'mis-solicitudes');

  try {
    const empId = state.user?.employee_id;
    if (incSemPeriodos.length === 0) {
      incSemPeriodos = await api('/api/rhh/nomina/periodos') || [];
    }
    const [incidences, vacSols] = await Promise.all([
      api('/api/rhh/incidences'),
      api('/api/rhh/nomina/vac-solicitudes').catch(() => []),
    ]);
    if (!incidences) return;

    const myIncidences = (incidences || []).filter(i =>
      ['vacacion', 'permiso'].includes(i.type) && i.employee_id === empId
    );
    const myVacSols = (vacSols || []);

    const periodOpts = incSemPeriodos.map(p =>
      `<option value="${p.no_periodo}">Semana ${p.no_periodo} · ${p.fecha_inicio} al ${p.fecha_fin}</option>`
    ).join('');

    const incRows = myIncidences.map(inc => `
      <tr>
        <td>${incTypePill(inc.type)}</td>
        <td>${fmtDateDisplay(inc.date)}${inc.date_end && inc.date_end !== inc.date ? ` → ${fmtDateDisplay(inc.date_end)}` : ''}</td>
        <td>${statusPill(inc.status)}</td>
        <td>${inc.notes || '—'}</td>
        <td>${fmtDateDisplay(inc.created_at?.slice(0, 10))}</td>
      </tr>`).join('');

    const vacSolRows = myVacSols.map(s => {
      const st = { pendiente: '🟡 Pendiente', aprobada: '✅ Aprobada', rechazada: '❌ Rechazada' }[s.estado] || s.estado;
      return `<tr>
        <td>${s.periodo ? `Sem. ${s.periodo.no_periodo} (${s.periodo.fecha_inicio})` : '—'}</td>
        <td style="text-align:center;font-weight:700;">${s.dias} días</td>
        <td>${st}</td>
        <td>${s.notas || '—'}</td>
        <td>${fmtDateDisplay(s.created_at?.slice(0,10))}</td>
      </tr>`;
    }).join('');

    const content = `
      <div class="module-title"><h2>📝 Mis Solicitudes</h2></div>

      <div class="card section" style="margin-bottom:14px;">
        <h3>🌴 Solicitar Vacaciones por Semana</h3>
        <p style="font-size:13px;color:var(--muted);margin-bottom:10px;">Selecciona la semana y cuántos días solicitas. Tu supervisor recibirá la solicitud para autorizar.</p>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Semana *</label>
            <select id="ms-vac-periodo" style="font-size:13px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;">
              <option value="">Seleccionar...</option>
              ${periodOpts}
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Días solicitados *</label>
            <input type="number" id="ms-vac-dias" min="0.5" max="7" step="0.5" style="width:80px;font-size:13px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;" placeholder="días" />
          </div>
          <div style="flex:1;min-width:180px;">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Notas</label>
            <input type="text" id="ms-vac-notas" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;" placeholder="Opcional" />
          </div>
          <button class="btn-primary" onclick="submitVacSolicitud()">Enviar solicitud</button>
        </div>
        ${myVacSols.length > 0 ? `
        <div style="margin-top:14px;">
          <h4 style="margin-bottom:6px;">Mis solicitudes de vacaciones</h4>
          <table style="font-size:12px;">
            <thead><tr><th>Semana</th><th>Días</th><th>Estado</th><th>Notas</th><th>Enviado</th></tr></thead>
            <tbody>${vacSolRows}</tbody>
          </table>
        </div>` : ''}
      </div>

      <div class="card section" style="margin-bottom:14px;">
        <h3>Nueva solicitud de permiso</h3>
        <div class="row">
          <div>
            <label>Tipo *</label>
            <select id="ms-type" onchange="onMsSolicitudTypeChange()">
              <option value="permiso">Permiso</option>
            </select>
          </div>
          <div>
            <label>Fecha inicio *</label>
            <input type="date" id="ms-date" value="${fmtDate(new Date())}" onchange="onMsSolicitudTypeChange()" />
          </div>
          <div>
            <label>Fecha fin</label>
            <input type="date" id="ms-date-end" value="${fmtDate(new Date())}" onchange="onMsSolicitudTypeChange()" />
          </div>
        </div>
        <div id="ms-vac-inline" style="display:none;margin-top:8px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;"></div>
        <div style="margin-top:10px;">
          <label>Motivo / Notas</label>
          <textarea id="ms-notes" rows="2" placeholder="Describe el motivo..."></textarea>
        </div>
        <div id="ms-warn" style="display:none;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:13px;color:#92400e;"></div>
        <div style="margin-top:10px;">
          <button id="ms-submit-btn" class="btn-primary" onclick="submitMiSolicitud()">Enviar permiso</button>
        </div>
      </div>

      <div class="card section">
        <h3>Historial de permisos</h3>
        ${myIncidences.length === 0
          ? '<div class="empty-state"><div class="empty-icon">📝</div><p>No has enviado permisos aún</p></div>'
          : `<table>
               <thead><tr><th>Tipo</th><th>Fechas</th><th>Estado</th><th>Notas</th><th>Solicitado</th></tr></thead>
               <tbody>${incRows}</tbody>
             </table>`
        }
      </div>
    `;

    el.innerHTML = shell(content, 'mis-solicitudes');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'mis-solicitudes');
  }
}

async function submitVacSolicitud() {
  const no_periodo = document.getElementById('ms-vac-periodo')?.value;
  const dias = document.getElementById('ms-vac-dias')?.value;
  const notas = document.getElementById('ms-vac-notas')?.value;
  if (!no_periodo || !dias) { toast('Semana y días son requeridos', 'warning'); return; }
  try {
    await api('/api/rhh/nomina/vac-solicitudes', {
      method: 'POST',
      body: JSON.stringify({ no_periodo: Number(no_periodo), dias: Number(dias), notas: notas || null })
    });
    toast('Solicitud enviada — pendiente de autorización');
    misSolicitudesView();
  } catch (err) { toast(err.message, 'error'); }
}

// Called when type or dates change to show live vacation balance info
let _msVacBalance = null;
async function onMsSolicitudTypeChange() {
  const type = document.getElementById('ms-type')?.value;
  const date = document.getElementById('ms-date')?.value;
  const dateEnd = document.getElementById('ms-date-end')?.value || date;
  const inlineEl = document.getElementById('ms-vac-inline');
  const submitBtn = document.getElementById('ms-submit-btn');
  const warnEl = document.getElementById('ms-warn');

  if (type === 'vacacion' && inlineEl) {
    // Load balance if needed
    if (!_msVacBalance) {
      const empId = state.user?.employee_id;
      if (empId) {
        try { _msVacBalance = await api(`/api/rhh/employees/vacation-balance/${empId}`); } catch (_) {}
      }
    }
    if (_msVacBalance && date && dateEnd) {
      const startD = new Date(date + 'T12:00:00');
      const endD = new Date(dateEnd + 'T12:00:00');
      const requestedDays = Math.round((endD - startD) / (24 * 60 * 60 * 1000)) + 1;
      const remaining = _msVacBalance.vacation_remaining || 0;
      const overLimit = requestedDays > remaining;
      inlineEl.style.display = 'block';
      inlineEl.innerHTML = `Tienes <strong>${remaining}</strong> días disponibles. Solicitar <strong>${requestedDays}</strong> día${requestedDays !== 1 ? 's' : ''}.${overLimit ? ' <span style="color:#b91c1c;font-weight:700;">Insuficiente.</span>' : ''}`;
      if (submitBtn) submitBtn.disabled = overLimit;
      if (warnEl && overLimit) {
        warnEl.textContent = `No tienes suficientes días de vacaciones disponibles. Tienes ${remaining} días y estás solicitando ${requestedDays}.`;
        warnEl.style.display = 'block';
      } else if (warnEl && !overLimit) {
        warnEl.style.display = 'none';
      }
    } else {
      inlineEl.style.display = 'none';
    }
  } else {
    if (inlineEl) inlineEl.style.display = 'none';
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function submitMiSolicitud() {
  const type = document.getElementById('ms-type')?.value;
  const date = document.getElementById('ms-date')?.value;
  const date_end = document.getElementById('ms-date-end')?.value;
  const notes = document.getElementById('ms-notes')?.value;

  if (!type || !date) { toast('Tipo y fecha son requeridos', 'warning'); return; }

  // Verificar reglas de anticipación ANTES de enviar (Automatización 4)
  if (type === 'vacacion' || type === 'permiso') {
    try {
      const rules = await api('/api/rhh/incidences/vacation-rules');
      if (rules && rules.rules && rules.rules.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const endDate = date_end || date;

        // Calcular días simples (calendario) de la solicitud
        const startD = new Date(date + 'T12:00:00');
        const endD = new Date(endDate + 'T12:00:00');
        const requestedDays = Math.round((endD - startD) / (24 * 60 * 60 * 1000)) + 1;

        // Calcular días de anticipación
        const todayD = new Date(today + 'T12:00:00');
        const advanceDays = Math.round((startD - todayD) / (24 * 60 * 60 * 1000));

        // Encontrar regla aplicable
        const sortedRules = [...rules.rules].sort((a, b) => a.max_days - b.max_days);
        let applicableRule = null;
        for (const rule of sortedRules) {
          if (requestedDays <= rule.max_days) { applicableRule = rule; break; }
        }

        if (applicableRule && advanceDays < applicableRule.min_advance_days) {
          const warnEl = document.getElementById('ms-warn');
          if (warnEl) {
            warnEl.textContent = `⚠ Esta solicitud requiere ${applicableRule.min_advance_days} días de anticipación. Tu solicitud empieza en ${advanceDays} días. Podría ser rechazada.`;
            warnEl.style.display = 'block';
          }
        } else {
          const warnEl = document.getElementById('ms-warn');
          if (warnEl) warnEl.style.display = 'none';
        }
      }
    } catch (_) {}
  }

  try {
    await api('/api/rhh/incidences', {
      method: 'POST',
      body: JSON.stringify({ type, date, date_end, notes: notes || null })
    });
    toast('Solicitud enviada. Esperando aprobación.');
    misSolicitudesView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── 9. Mis Incidencias (empleado) ─────────────────────────────────────────────
async function misIncidenciasView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">...</div>', 'mis-incidencias');

  try {
    const empId = state.user?.employee_id;
    const today = fmtDate(new Date());
    const monthStr = today.slice(0, 7);

    const [incidences, teAuths, myApplications] = await Promise.all([
      api('/api/rhh/incidences'),
      api(`/api/rhh/schedule/te-authorizations?month=${monthStr}`).catch(() => []),
      empId ? api(`/api/rhh/schedule/te-applications/my`).catch(() => []) : Promise.resolve([])
    ]);
    if (!incidences) return;

    // ── TE disponibles para postular ──────────────────────────────────────
    const emp = empId ? (await api(`/api/rhh/employees/${empId}`).catch(() => null)) : null;
    const myPositions = emp?.enabled_positions || [];

    const approvedTEs = (teAuths || []).filter(t =>
      t.status === 'approved' &&
      t.date >= today &&
      (t.positions || []).some(p => myPositions.includes(p))
    );

    const teRows = approvedTEs.map(te => {
      const myApp = (myApplications || []).find(a => a.te_authorization_id === te.id);
      const shift = state.shifts.find(s => s.id === te.shift_id);
      let actionHtml;
      if (myApp) {
        if (myApp.status === 'selected') {
          actionHtml = `<span class="pill active" style="font-size:12px;">⚡ Seleccionado</span>`;
        } else if (myApp.status === 'rejected') {
          actionHtml = `<span class="pill rechazada" style="font-size:12px;">✗ No seleccionado</span>`;
        } else {
          actionHtml = `<span class="pill pendiente" style="font-size:12px;">✓ Postulado</span>`;
        }
      } else {
        actionHtml = `<button class="btn-primary" style="font-size:12px;padding:4px 10px;" onclick="postularTE(${te.id})">Postularme</button>`;
      }
      return `<tr>
        <td>${fmtDateDisplay(te.date)}</td>
        <td>${shift ? `${shiftDot(shift)} ${shift.name}` : te.shift_id}</td>
        <td>${te.notes || '—'}</td>
        <td>${actionHtml}</td>
      </tr>`;
    }).join('');

    const teSectionHtml = approvedTEs.length > 0 ? `
      <div class="card section" style="margin-bottom:16px;">
        <h3>⚡ Tiempo Extra Disponible</h3>
        <p style="font-size:13px;color:var(--muted);margin-bottom:10px;">Estos son los TEs autorizados para los cuales puedes postularte según tus puestos habilitados.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Turno</th><th>Notas</th><th>Acción</th></tr></thead>
            <tbody>${teRows}</tbody>
          </table>
        </div>
      </div>` : '';

    const rows = (incidences || []).map(inc => `
      <tr>
        <td>${incTypePill(inc.type)}</td>
        <td>${fmtDateDisplay(inc.date)}</td>
        <td>${inc.hours ? inc.hours + 'h' : '—'}</td>
        <td>${statusPill(inc.status)}</td>
        <td>${inc.notes || '—'}</td>
      </tr>`).join('');

    const content = `
      <h2>⚠️ Mis Incidencias</h2>
      ${teSectionHtml}
      <div class="card section table-wrap">
        ${incidences.length === 0
          ? '<div class="empty-state"><div class="empty-icon">✅</div><p>Sin incidencias registradas</p></div>'
          : `<table>
               <thead><tr><th>Tipo</th><th>Fecha</th><th>Horas</th><th>Estado</th><th>Notas</th></tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>
    `;

    el.innerHTML = shell(content, 'mis-incidencias');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'mis-incidencias');
  }
}

async function postularTE(teAuthId) {
  try {
    await api('/api/rhh/schedule/te-applications', {
      method: 'POST',
      body: JSON.stringify({ te_authorization_id: teAuthId })
    });
    toast('Postulación enviada exitosamente.');
    misIncidenciasView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── 10. Autorizaciones ────────────────────────────────────────────────────────
let autTabIdx = 0;

async function autorizacionesView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando autorizaciones...</div>', 'autorizaciones');
  try {
    const [vacSols, teSols, incidences] = await Promise.all([
      api('/api/rhh/nomina/vac-solicitudes?estado=pendiente'),
      api('/api/rhh/nomina/te-solicitudes'),
      api('/api/rhh/incidences?status=pendiente'),
    ]);

    const vacRows = (vacSols || []).map(s => `
      <tr>
        <td><strong>${escHtml(s.employee?.full_name || '—')}</strong><br><span class="small muted">${s.employee?.employee_number || ''}</span></td>
        <td>${s.department?.name || '—'}</td>
        <td>${s.periodo ? `Semana ${s.periodo.no_periodo} (${s.periodo.fecha_inicio} – ${s.periodo.fecha_fin})` : '—'}</td>
        <td style="text-align:center;font-weight:700;">${s.dias}</td>
        <td>${s.notas || '—'}</td>
        <td>
          <button class="btn-primary" style="font-size:11px;padding:4px 9px;" onclick="aprobarVacSol(${s.id},'aprobada')">✅ Aprobar</button>
          <button class="btn-ghost" style="font-size:11px;padding:4px 9px;color:#b91c1c;" onclick="aprobarVacSol(${s.id},'rechazada')">✗ Rechazar</button>
        </td>
      </tr>`).join('');

    const tePend   = (teSols || []).filter(s => s.estado === 'pendiente_supervisor' || s.estado === 'pendiente_rh');
    const teRows   = tePend.map(s => {
      const needsRH = s.requiere_auth_rh;
      const canApprove = !needsRH || ['rh','admin'].includes(state.user?.role);
      return `<tr>
        <td><strong>${escHtml(s.employee?.full_name || '—')}</strong></td>
        <td>${s.periodo ? `Semana ${s.periodo.no_periodo}` : '—'}</td>
        <td style="text-align:center;font-weight:700;color:#059669;">${s.horas}h</td>
        <td>${s.razon || '—'} ${s.sub_razon ? `/ ${s.sub_razon}` : ''}</td>
        <td>${needsRH ? '<span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600;">⚠ Requiere RHH/Admin</span>' : '<span style="background:#f0fdf4;color:#166534;font-size:11px;padding:2px 6px;border-radius:4px;">OK</span>'}</td>
        <td>${s.solicita || '—'}</td>
        <td>
          ${canApprove
            ? `<button class="btn-primary" style="font-size:11px;padding:4px 9px;" onclick="aprobarTESol(${s.id},'aprobada')">✅ Aprobar</button>
               <button class="btn-ghost" style="font-size:11px;padding:4px 9px;color:#b91c1c;" onclick="aprobarTESol(${s.id},'rechazada')">✗ Rechazar</button>`
            : '<span class="small muted">Solo RHH/Admin</span>'}
        </td>
      </tr>`;
    }).join('');

    const incRows = (incidences || []).map(inc => `
      <tr>
        <td><strong>${inc.employee?.full_name || '—'}</strong><br><span class="small muted">${inc.employee?.employee_number || ''}</span></td>
        <td>${incTypePill(inc.type)}</td>
        <td>${fmtDateDisplay(inc.date)}${inc.date_end && inc.date_end !== inc.date ? ` → ${fmtDateDisplay(inc.date_end)}` : ''}</td>
        <td>${inc.department?.name || '—'}</td>
        <td>${inc.notes || '—'}</td>
        <td>
          <button class="btn-primary" style="font-size:11px;padding:4px 9px;" onclick="approveIncidence(${inc.id},'aprobada')">✅</button>
          <button class="btn-ghost" style="font-size:11px;padding:4px 9px;color:#b91c1c;" onclick="approveIncidence(${inc.id},'rechazada')">✗</button>
        </td>
      </tr>`).join('');

    const tabs = [
      `Vacaciones <span class="badge" style="background:${(vacSols||[]).length>0?'#dc2626':'#6b7280'};font-size:10px;">${(vacSols||[]).length}</span>`,
      `Tiempo Extra <span class="badge" style="background:${tePend.length>0?'#d97706':'#6b7280'};font-size:10px;">${tePend.length}</span>`,
      `Incidencias antiguas <span class="badge" style="background:${(incidences||[]).length>0?'#7c3aed':'#6b7280'};font-size:10px;">${(incidences||[]).length}</span>`,
    ];
    const tabBar = tabs.map((t, i) =>
      `<button class="tab-btn ${autTabIdx===i?'active':''}" onclick="autTabIdx=${i};autorizacionesView()">${t}</button>`
    ).join('');

    let tabContent = '';
    if (autTabIdx === 0) {
      tabContent = vacRows
        ? `<table><thead><tr><th>Empleado</th><th>Depto</th><th>Semana</th><th>Días solicitados</th><th>Notas</th><th>Acción</th></tr></thead><tbody>${vacRows}</tbody></table>`
        : '<div class="empty-state"><div class="empty-icon">✅</div><p>Sin solicitudes de vacaciones pendientes</p></div>';
    } else if (autTabIdx === 1) {
      tabContent = teRows
        ? `<table><thead><tr><th>Empleado</th><th>Semana</th><th>Horas</th><th>Razón</th><th>Nivel auth.</th><th>Solicita</th><th>Acción</th></tr></thead><tbody>${teRows}</tbody></table>`
        : '<div class="empty-state"><div class="empty-icon">✅</div><p>Sin solicitudes de tiempo extra pendientes</p></div>';
    } else {
      tabContent = incRows
        ? `<table><thead><tr><th>Empleado</th><th>Tipo</th><th>Fecha(s)</th><th>Depto</th><th>Notas</th><th>Acción</th></tr></thead><tbody>${incRows}</tbody></table>`
        : '<div class="empty-state"><div class="empty-icon">✅</div><p>Sin incidencias pendientes</p></div>';
    }

    const content = `
      <div class="module-title"><h2>✅ Autorizaciones</h2></div>
      <div class="tab-bar" style="margin-bottom:14px;">${tabBar}</div>
      <div class="card section table-wrap">${tabContent}</div>
    `;
    el.innerHTML = shell(content, 'autorizaciones');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'autorizaciones');
  }
}

async function aprobarVacSol(id, estado) {
  try {
    await api(`/api/rhh/nomina/vac-solicitudes/${id}`, { method: 'PATCH', body: JSON.stringify({ estado }) });
    toast(estado === 'aprobada' ? 'Vacaciones aprobadas y registradas en el período' : 'Solicitud rechazada');
    autorizacionesView();
  } catch (err) { toast(err.message, 'error'); }
}

async function aprobarTESol(id, estado) {
  try {
    await api(`/api/rhh/nomina/te-solicitudes/${id}`, { method: 'PATCH', body: JSON.stringify({ estado }) });
    toast(estado === 'aprobada' ? 'Tiempo extra aprobado y registrado' : 'Solicitud rechazada');
    autorizacionesView();
  } catch (err) { toast(err.message, 'error'); }
}

// ── 11. Ausencias hoy (supervisor) ────────────────────────────────────────────
async function ausenciasHoyView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando ausencias...</div>', 'ausencias-hoy');

  try {
    const data = await api('/api/rhh/incidences/today-absences');
    if (!data) return;

    const rows = (data.absences || []).map(a => `
      <tr>
        <td><strong>${a.employee?.full_name || '—'}</strong></td>
        <td>${incTypePill(a.type)}</td>
        <td>${a.shift_name || '—'}</td>
        <td>${a.department_name || '—'}</td>
        <td>${statusPill(a.status)}</td>
        <td>${a.notes || '—'}</td>
      </tr>`).join('');

    const content = `
      <div class="module-title">
        <h2>🚨 Ausencias de Hoy — ${fmtDateDisplay(fmtDate(new Date()))}</h2>
        <span class="badge" style="background:#fee2e2;color:#991b1b;">${data.count} ausencia(s)</span>
      </div>

      ${data.count === 0
        ? '<div class="card section"><div class="empty-state"><div class="empty-icon">✅</div><p>No hay ausencias registradas para hoy</p></div></div>'
        : `<div class="card section table-wrap">
             <table>
               <thead><tr><th>Empleado</th><th>Tipo</th><th>Turno</th><th>Departamento</th><th>Estado</th><th>Notas</th></tr></thead>
               <tbody>${rows}</tbody>
             </table>
           </div>`
      }

      <div class="card section" style="margin-top:12px;">
        <h3>Sugerir cobertura</h3>
        <div class="row">
          <div>
            <label>Turno para cubrir</label>
            <select id="cov-shift">
              <option value="">Seleccionar turno...</option>
              ${state.shifts.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
          </div>
          <div style="align-self:flex-end;">
            <button class="btn-ghost" onclick="loadCoverage()">🔍 Buscar disponibles</button>
          </div>
        </div>
        <div id="coverage-results" style="margin-top:12px;"></div>
      </div>
    `;

    el.innerHTML = shell(content, 'ausencias-hoy');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'ausencias-hoy');
  }
}

async function loadCoverage() {
  const shiftId = document.getElementById('cov-shift')?.value;
  const today = fmtDate(new Date());
  const container = document.getElementById('coverage-results');
  if (!container) return;

  try {
    const data = await api(`/api/rhh/incidences/coverage-suggestions?date=${today}${shiftId ? `&shift_id=${shiftId}` : ''}`);
    if (!data) return;

    const rows = (data.suggestions || []).slice(0, 10).map(e => `
      <tr>
        <td>${e.full_name}</td>
        <td>${shiftDot(e.shift)}</td>
        <td>${deptName(e.department_id)}</td>
        <td><span class="pill ${e.worksToday ? 'active' : 'gray'}">${e.worksToday ? 'Turno hoy' : 'Descanso'}</span></td>
      </tr>`).join('');

    container.innerHTML = `
      <h4>Empleados disponibles (${data.suggestions.length})</h4>
      <table>
        <thead><tr><th>Nombre</th><th>Turno habitual</th><th>Departamento</th><th>Disponibilidad</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--muted);">Sin empleados disponibles</td></tr>'}</tbody>
      </table>`;
  } catch (err) {
    container.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

// ── 12. Lista de Raya (reemplaza Prenómina) ───────────────────────────────────
let listaRayaPeriodo = 0;
let listaRayaTab     = 0;   // 0=lista, 1=comparar PDF
let _cmpPdfResult    = null; // último resultado de comparación

async function listaRayaView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando...</div>', 'lista-raya');
  try {
    if (incSemPeriodos.length === 0) {
      incSemPeriodos = await api('/api/rhh/nomina/periodos') || [];
    }
    if (!listaRayaPeriodo && incSemPeriodos.length > 0) {
      listaRayaPeriodo = incSemPeriodos[incSemPeriodos.length - 1].no_periodo;
    }
    const periodo = incSemPeriodos.find(p => p.no_periodo === listaRayaPeriodo);

    const periodOpts = incSemPeriodos.map(p =>
      `<option value="${p.no_periodo}" ${p.no_periodo === listaRayaPeriodo ? 'selected' : ''}>S${p.no_periodo} · ${p.fecha_inicio} al ${p.fecha_fin}</option>`
    ).join('');

    const tabBar = `
      <div style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:16px;">
        <button onclick="listaRayaTab=0;listaRayaView()" style="padding:8px 18px;border:none;background:none;cursor:pointer;font-weight:600;border-bottom:${listaRayaTab===0?'3px solid #2563eb;color:#2563eb':'3px solid transparent;color:#6b7280'};">📋 Lista de raya</button>
        <button onclick="listaRayaTab=1;listaRayaView()" style="padding:8px 18px;border:none;background:none;cursor:pointer;font-weight:600;border-bottom:${listaRayaTab===1?'3px solid #2563eb;color:#2563eb':'3px solid transparent;color:#6b7280'};">🔍 Comparar PDF</button>
      </div>`;

    const periodBar = `
      <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
        <div>
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Período (semana)</label>
          <select id="lr-periodo-sel" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" onchange="listaRayaPeriodo=parseInt(this.value);_cmpPdfResult=null;listaRayaView()">
            ${periodOpts}
          </select>
        </div>
        ${periodo ? `<span style="font-size:13px;color:#374151;padding:6px 12px;background:#f3f4f6;border-radius:6px;">📅 ${periodo.fecha_inicio} al ${periodo.fecha_fin}</span>` : ''}
      </div>`;

    let tabContent = '';

    if (listaRayaTab === 0) {
      // ── Tab Lista ────────────────────────────────────────────────────────────
      const data = listaRayaPeriodo ? await api(`/api/rhh/nomina/export?no_periodo=${listaRayaPeriodo}`) : null;

      const tableRows = (data?.rows || []).map(r => `
        <tr>
          <td>${r.no_empleado}</td>
          <td>${escHtml(r.nombre)}</td>
          <td>${escHtml(r.departamento)}</td>
          <td style="text-align:center;">${r.dias_pagados}</td>
          <td style="text-align:center;color:#b91c1c;">${r.faltas || '—'}</td>
          <td style="text-align:center;color:#059669;">${r.horas_extras || '—'}</td>
          <td style="text-align:center;">${r.despensa}</td>
          <td style="text-align:center;">${r.bono_puntualidad_dias !== '' ? r.bono_puntualidad_dias : '—'}</td>
          <td style="text-align:center;">${r.bono_eficiencia_dias !== '' ? r.bono_eficiencia_dias : '—'}</td>
          <td style="text-align:center;">${r.bono_instructor !== '' ? r.bono_instructor : '—'}</td>
          <td style="text-align:center;">${r.prima_dominical}</td>
          <td style="text-align:center;color:#1d4ed8;">${r.vacaciones_dias !== '' ? r.vacaciones_dias : '—'}</td>
          <td style="text-align:center;">${r.gratificacion !== '' ? r.gratificacion : '—'}</td>
          <td style="font-size:11px;color:var(--muted);">${r.notas || ''}</td>
        </tr>`).join('');

      tabContent = `
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button class="btn-primary" onclick="exportarListaRaya()">⬇ Exportar CSV</button>
          <button class="btn-ghost" onclick="location.hash='#incidencias'">✏️ Editar incidencias</button>
        </div>
        <div class="notice" style="margin-bottom:12px;">
          <strong>Reporte de incidencias capturadas.</strong> Verifica contra el PDF de Lista de Raya de CONTPAQ i.
          ${data?.generated_at ? `<span class="muted" style="margin-left:8px;">Generado: ${data.generated_at}</span>` : ''}
        </div>
        <div class="card section" style="overflow-x:auto;padding:0;">
          ${(data?.rows || []).length === 0
            ? '<div class="empty-state" style="padding:32px;"><p>Sin incidencias capturadas para este período</p></div>'
            : `<table style="min-width:1100px;font-size:12px;border-collapse:collapse;">
                 <thead>
                   <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
                     <th style="padding:6px 8px;">No.</th>
                     <th style="padding:6px 8px;text-align:left;">Nombre</th>
                     <th style="padding:6px 8px;text-align:left;">Depto</th>
                     <th style="padding:6px 4px;text-align:center;">Días</th>
                     <th style="padding:6px 4px;text-align:center;color:#b91c1c;">Faltas</th>
                     <th style="padding:6px 4px;text-align:center;color:#059669;">H.Extra</th>
                     <th style="padding:6px 4px;text-align:center;">Despensa</th>
                     <th style="padding:6px 4px;text-align:center;">B.Punt.</th>
                     <th style="padding:6px 4px;text-align:center;">B.Efic.</th>
                     <th style="padding:6px 4px;text-align:center;">B.Inst.</th>
                     <th style="padding:6px 4px;text-align:center;">P.Dom.</th>
                     <th style="padding:6px 4px;text-align:center;color:#1d4ed8;">Vac.</th>
                     <th style="padding:6px 4px;text-align:center;">Gratif.</th>
                     <th style="padding:6px 4px;text-align:left;">Notas</th>
                   </tr>
                 </thead>
                 <tbody>${tableRows}</tbody>
               </table>`
          }
        </div>`;
    } else {
      // ── Tab Comparar PDF ─────────────────────────────────────────────────────
      let cmpResultHtml = '';
      if (_cmpPdfResult) {
        const r = _cmpPdfResult;
        const pillStyle = (ok) => ok
          ? 'background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:10px;font-size:11px;'
          : 'background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:10px;font-size:11px;';
        cmpResultHtml = `
          <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
            <span style="background:#dbeafe;color:#1d4ed8;padding:4px 12px;border-radius:8px;font-size:12px;"><strong>${r.resumen.total_pdf}</strong> en PDF</span>
            <span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:8px;font-size:12px;"><strong>${r.resumen.sin_diff}</strong> sin diferencia</span>
            <span style="background:#fee2e2;color:#b91c1c;padding:4px 12px;border-radius:8px;font-size:12px;"><strong>${r.resumen.con_diff}</strong> con diferencia</span>
            <span style="background:#f3f4f6;color:#6b7280;padding:4px 12px;border-radius:8px;font-size:12px;"><strong>${r.resumen.no_encontrado}</strong> no encontrado</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="min-width:820px;font-size:12px;border-collapse:collapse;width:100%;">
              <thead>
                <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
                  <th style="padding:6px 8px;text-align:left;">Clave</th>
                  <th style="padding:6px 8px;text-align:left;">Nombre PDF</th>
                  <th style="padding:6px 8px;">Estado</th>
                  <th style="padding:6px 8px;">Campo</th>
                  <th style="padding:6px 8px;text-align:right;">PDF</th>
                  <th style="padding:6px 8px;text-align:right;">Capturado</th>
                  <th style="padding:6px 8px;text-align:center;">Diff</th>
                </tr>
              </thead>
              <tbody>
                ${r.diffs.map(emp => {
                  if (!emp.encontrado) {
                    return `<tr style="background:#fef9c3;">
                      <td style="padding:4px 8px;">${emp.clave}</td>
                      <td style="padding:4px 8px;">${escHtml(emp.nombre)}</td>
                      <td colspan="5" style="padding:4px 8px;color:#92400e;font-size:11px;">⚠ No encontrado en DB</td>
                    </tr>`;
                  }
                  return emp.campos.map((c, ci) => `
                    <tr style="${c.diff ? 'background:#fff7ed;' : ''}${ci===0?'border-top:1px solid #e5e7eb;':''}">
                      ${ci === 0 ? `<td style="padding:4px 8px;" rowspan="${emp.campos.length}">${emp.clave}</td>
                        <td style="padding:4px 8px;" rowspan="${emp.campos.length}">${escHtml(emp.nombre)}</td>
                        <td style="padding:4px 8px;text-align:center;" rowspan="${emp.campos.length}">
                          <span style="${pillStyle(!emp.hasDiff)}">${emp.hasDiff ? 'DIFF' : 'OK'}</span>
                        </td>` : ''}
                      <td style="padding:4px 8px;color:#374151;">${c.campo}</td>
                      <td style="padding:4px 8px;text-align:right;">${c.pdf ?? '—'}</td>
                      <td style="padding:4px 8px;text-align:right;">${c.capturado ?? '—'}</td>
                      <td style="padding:4px 8px;text-align:center;">${c.diff ? '⚠' : '✓'}</td>
                    </tr>`).join('');
                }).join('')}
              </tbody>
            </table>
          </div>`;
      }

      tabContent = `
        <div class="card section" style="margin-bottom:16px;">
          <h3 style="margin-top:0;">📄 Comparar PDF de CONTPAQ i</h3>
          <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">
            Sube el PDF de Lista de Raya generado por CONTPAQ i para el período seleccionado. El sistema extraerá los datos y los comparará con las incidencias capturadas.
          </p>
          <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
            <div>
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Archivo PDF</label>
              <input type="file" id="cmp-pdf-file" accept=".pdf" style="font-size:13px;">
            </div>
            <button class="btn-primary" onclick="compararPDF()">🔍 Comparar</button>
            ${_cmpPdfResult ? `<button class="btn-ghost" onclick="_cmpPdfResult=null;listaRayaView()">✕ Limpiar</button>` : ''}
          </div>
        </div>
        ${cmpResultHtml
          ? `<div class="card section">${cmpResultHtml}</div>`
          : `<div class="empty-state"><div class="empty-icon">📄</div><p>Selecciona un PDF y presiona "Comparar"</p></div>`
        }`;
    }

    const content = `
      <div class="module-title"><h2>💰 Lista de Raya</h2></div>
      ${tabBar}
      ${periodBar}
      ${tabContent}
    `;
    el.innerHTML = shell(content, 'lista-raya');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'lista-raya');
  }
}

async function compararPDF() {
  const fileInput = document.getElementById('cmp-pdf-file');
  if (!fileInput?.files?.[0]) { toast('Selecciona un archivo PDF', 'warning'); return; }
  if (!listaRayaPeriodo) { toast('Selecciona un período', 'warning'); return; }

  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando...'; }

  try {
    const form = new FormData();
    form.append('pdf', fileInput.files[0]);
    form.append('no_periodo', listaRayaPeriodo);

    const token = localStorage.getItem('rhh_token');
    const res   = await fetch('/api/rhh/nomina/comparar-pdf', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en el servidor');

    _cmpPdfResult = data;
    listaRayaTab  = 1;
    await listaRayaView();
    toast(`Comparación lista: ${data.resumen.con_diff} diferencias encontradas`, data.resumen.con_diff > 0 ? 'warning' : 'success');
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Comparar'; }
  }
}

async function exportarListaRaya() {
  listaRayaPeriodo = listaRayaPeriodo || incSemPeriodo;
  if (!listaRayaPeriodo) { toast('Selecciona un período', 'warning'); return; }
  // Reusar la función de exportación del módulo incidencias
  const prev = incSemPeriodo;
  incSemPeriodo = listaRayaPeriodo;
  await exportarIncidencias();
  incSemPeriodo = prev;
}

// ── Prenómina (mantenida para backward-compat, ya no aparece en menú) ─────────
let prenomYear = new Date().getFullYear();
let prenomMonth = new Date().getMonth() + 1;
let prenomWeekStart = null;

async function prenominaView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Calculando prenómina...</div>', 'prenomina');

  try {
    // Sincronizar semana con asistencia si está disponible, o usar lunes de hoy
    if (!prenomWeekStart) {
      prenomWeekStart = (typeof attendanceWeekStart !== 'undefined' && attendanceWeekStart)
        ? attendanceWeekStart
        : fmtDate(getWeekStart(new Date()));
    }

    const [attData, teData] = await Promise.all([
      api(`/api/rhh/schedule/weekly-attendance?week_start=${prenomWeekStart}`),
      api(`/api/rhh/schedule/te-calc?week_start=${prenomWeekStart}`).catch(() => ({ employees: [] }))
    ]);
    if (!attData) return;

    // Calcular etiqueta de la semana
    const weekStartDate = new Date(prenomWeekStart + 'T12:00:00');
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    const weekLabel = `${weekStartDate.getDate()} ${MONTHS[weekStartDate.getMonth()].slice(0,3)} – ${weekEndDate.getDate()} ${MONTHS[weekEndDate.getMonth()].slice(0,3)} ${weekEndDate.getFullYear()}`;

    // Mapa de datos TE por employee_id
    const teMap = {};
    for (const te of (teData?.employees || [])) {
      teMap[te.employee_id] = te;
    }

    let totalDiasTrab = 0, totalFaltas = 0, totalVac = 0, totalPermisos = 0, totalIncap = 0;
    let totalTeHrs = 0, totalTeExtra = 0, totalSemana = 0;

    const rows = [];
    for (const shiftGroup of (attData.shifts || [])) {
      for (const emp of (shiftGroup.employees || [])) {
        const days = emp.days || [];
        const diasTrabajados = days.filter(d => d.status === 'labora' || d.status === 'festivo').length;
        const faltas = days.filter(d => d.status === 'falta').length;
        const vacaciones = days.filter(d => d.status === 'vacaciones').length;
        const permisos = days.filter(d => d.status === 'permiso').length;
        const permisosSinGoce = days.filter(d => d.status === 'permiso_sin_goce').length;
        const incapacidades = days.filter(d => d.status === 'incapacidad').length;
        const retardos = days.filter(d => d.status === 'retardo').length;
        const te_hours = emp.totals?.te_total || 0;

        const teEmp = teMap[emp.id] || {};
        const te_extra_pay = teEmp.te_extra_pay || 0;
        const prima_dominical = teEmp.prima_dominical || 0;
        const total_extra = teEmp.total_extra || 0;

        const daily_salary = state.employees.find(e => e.id === emp.id)?.daily_salary || 0;
        // Retardo = 30 min = 0.0625 días (30/480). 3 retardos acumulados en semana = falta completa
        const retardoDeduccion = retardos >= 3 ? Math.floor(retardos / 3) * daily_salary : (retardos * daily_salary * 0.0625);
        const total_semanal = (diasTrabajados * daily_salary) + total_extra
          - (permisosSinGoce * daily_salary)
          - retardoDeduccion;

        totalDiasTrab += diasTrabajados;
        totalFaltas += faltas;
        totalVac += vacaciones;
        totalPermisos += permisos;
        totalIncap += incapacidades;
        totalTeHrs += Number(te_hours) || 0;
        totalTeExtra += Number(te_extra_pay) + Number(prima_dominical);
        totalSemana += total_semanal;

        const permSinGoceCell = permisosSinGoce > 0
          ? `<span style="color:#dc2626;font-weight:700;">${permisosSinGoce}</span>`
          : '—';
        const retardoCell = retardos > 0
          ? `<span style="color:#d97706;font-weight:700;" title="-$${retardoDeduccion.toFixed(2)}">${retardos}${retardos >= 3 ? ' ⚠️' : ''}</span>`
          : '—';

        rows.push(`
          <tr>
            <td>
              <strong>${emp.full_name}</strong><br>
              <span class="small muted">${emp.employee_number || ''}</span>
            </td>
            <td>${emp.shift_code || shiftGroup.shift?.code || '—'}</td>
            <td style="text-align:center;">${days.length}</td>
            <td style="text-align:center;font-weight:700;">${diasTrabajados}</td>
            <td style="text-align:center;color:#b91c1c;">${faltas || '—'}</td>
            <td style="text-align:center;color:#1d4ed8;">${vacaciones || '—'}</td>
            <td style="text-align:center;color:#854d0e;">${permisos || '—'}</td>
            <td style="text-align:center;">${permSinGoceCell}</td>
            <td style="text-align:center;color:#7c3aed;">${incapacidades || '—'}</td>
            <td style="text-align:center;">${retardoCell}</td>
            <td style="text-align:center;color:#059669;font-weight:700;">${Number(te_hours) > 0 ? te_hours + 'h' : '—'}</td>
            <td style="text-align:right;color:#059669;">${(te_extra_pay + prima_dominical) > 0 ? '$' + (te_extra_pay + prima_dominical).toLocaleString('es-MX', {minimumFractionDigits:2}) : '—'}</td>
            <td style="text-align:right;">${daily_salary > 0 ? '$' + Number(daily_salary).toLocaleString('es-MX', {minimumFractionDigits:2}) : '—'}</td>
            <td style="text-align:right;color:#059669;font-weight:700;">$${total_semanal.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
          </tr>`);
      }
    }

    const content = `
      <div class="module-title">
        <h2>💰 Prenómina Semanal</h2>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button class="btn-ghost" onclick="(()=>{const d=new Date(prenomWeekStart+'T12:00:00');d.setDate(d.getDate()-7);prenomWeekStart=fmtDate(d);prenominaView();})()">‹ Semana anterior</button>
        <strong style="min-width:240px;text-align:center;">${weekLabel}</strong>
        <button class="btn-ghost" onclick="(()=>{const d=new Date(prenomWeekStart+'T12:00:00');d.setDate(d.getDate()+7);prenomWeekStart=fmtDate(d);prenominaView();})()">Semana siguiente ›</button>
      </div>

      <div class="card section table-wrap">
        <table class="prenomina-table">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Turno</th>
              <th style="text-align:center;">Días hab.</th>
              <th style="text-align:center;">Trabajados</th>
              <th style="text-align:center;color:#b91c1c;">Faltas</th>
              <th style="text-align:center;color:#1d4ed8;">Vac</th>
              <th style="text-align:center;color:#854d0e;">Permisos c/g</th>
              <th style="text-align:center;color:#dc2626;">Perm s/g</th>
              <th style="text-align:center;color:#7c3aed;">Incap</th>
              <th style="text-align:center;color:#d97706;">Retardos</th>
              <th style="text-align:center;color:#059669;">T.E. hrs</th>
              <th style="text-align:right;color:#059669;">T.E. extra</th>
              <th style="text-align:right;">Salario/día</th>
              <th style="text-align:right;color:#059669;">Total semana</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('') || '<tr><td colspan="14" style="text-align:center;color:var(--muted);">Sin empleados en esta semana</td></tr>'}
          </tbody>
          <tfoot>
            <tr style="background:#f0fdf4;font-weight:800;">
              <td colspan="3"><strong>TOTALES</strong></td>
              <td style="text-align:center;">${totalDiasTrab}</td>
              <td style="text-align:center;color:#b91c1c;">${totalFaltas || '—'}</td>
              <td style="text-align:center;color:#1d4ed8;">${totalVac || '—'}</td>
              <td style="text-align:center;color:#854d0e;">${totalPermisos || '—'}</td>
              <td></td>
              <td style="text-align:center;color:#7c3aed;">${totalIncap || '—'}</td>
              <td></td>
              <td style="text-align:center;color:#059669;">${totalTeHrs > 0 ? totalTeHrs + 'h' : '—'}</td>
              <td style="text-align:right;color:#059669;">${totalTeExtra > 0 ? '$' + totalTeExtra.toLocaleString('es-MX', {minimumFractionDigits:2}) : '—'}</td>
              <td></td>
              <td style="text-align:right;color:#059669;">$${totalSemana.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="notice" style="margin-top:12px;">
        <strong>Nota:</strong> Los valores mostrados son basados en la asistencia registrada en el ROL semanal y el cálculo de tiempo extra. El total semanal = días trabajados × salario diario + T.E. extra.
      </div>
    `;

    el.innerHTML = shell(content, 'prenomina');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'prenomina');
  }
}

// ── 13. Catálogos (admin) ─────────────────────────────────────────────────────
let catTab = 'departments';

async function catalogosView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando catálogos...</div>', 'catalogos');

  try {
    await loadCatalogs();

    let tabContent = '';

    if (catTab === 'vacation-rules') {
      tabContent = await buildVacRulesTab();
    } else

    if (catTab === 'departments') {
      const rows = state.departments.map(d => `
        <tr>
          <td><strong>${d.name}</strong></td>
          <td><span class="badge">${d.code}</span></td>
          <td>${d.manager ? d.manager.full_name : '—'}</td>
          <td>
            <button class="btn-ghost" style="font-size:12px;" onclick="editDept(${d.id},'${d.name}','${d.code}',${d.manager_id||0})">✏️ Editar</button>
            <button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="deleteDept(${d.id})">🗑️</button>
          </td>
        </tr>`).join('');

      tabContent = `
        <div class="card section">
          <h3>Departamentos</h3>
          <div class="row" style="margin-bottom:14px;">
            <input id="nd-name" placeholder="Nombre del departamento" />
            <input id="nd-code" placeholder="Código (ej: PROD)" style="text-transform:uppercase;" />
            <button class="btn-primary" onclick="addDept()">+ Agregar</button>
          </div>
          <table>
            <thead><tr><th>Nombre</th><th>Código</th><th>Jefe</th><th>Acciones</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

    } else if (catTab === 'positions') {
      const deptsOpts = state.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
      const rows = state.positions.map(p => {
        const dept = state.departments.find(d => d.id === p.department_id);
        return `
          <tr>
            <td><strong>${p.name}</strong></td>
            <td>${dept?.name || '—'}</td>
            <td>${p.level}</td>
            <td>
              <button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="deletePosition(${p.id})">🗑️</button>
            </td>
          </tr>`;
      }).join('');

      tabContent = `
        <div class="card section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <h3 style="margin:0;">Puestos</h3>
            <button class="btn-ghost" style="font-size:12px;color:#7c3aed;" onclick="seedPuestosCatalogo()" title="Resetear catálogo con puestos del sistema_rrhh 2026">🔄 Reset catálogo 2026</button>
          </div>
          <div class="row" style="margin-bottom:14px;">
            <input id="np-name" placeholder="Nombre del puesto" />
            <select id="np-dept"><option value="">Departamento...</option>${deptsOpts}</select>
            <input id="np-level" type="number" placeholder="Nivel (1-10)" min="1" max="10" value="2" style="width:100px;" />
            <button class="btn-primary" onclick="addPosition()">+ Agregar</button>
          </div>
          <table>
            <thead><tr><th>Nombre</th><th>Departamento</th><th>Nivel</th><th>Acciones</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

    } else if (catTab === 'shifts') {
      const rows = state.shifts.map(s => `
        <tr>
          <td>
            <span class="shift-dot" style="background:${s.color}"></span>
            <strong>${s.name}</strong>
          </td>
          <td><span class="badge">${s.code}</span></td>
          <td>${s.start_time} – ${s.end_time}</td>
          <td>${(s.work_days || []).map(d => DAYS_SHORT[d]).join(', ')}</td>
          <td>
            <button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="deleteShift(${s.id})">🗑️</button>
          </td>
        </tr>`).join('');

      tabContent = `
        <div class="card section">
          <h3>Turnos</h3>
          <div class="form-section" style="margin-bottom:14px;">
            <div class="row">
              <input id="ns-name" placeholder="Nombre del turno" />
              <input id="ns-code" placeholder="Código (T1, ADM...)" style="text-transform:uppercase;" />
              <input id="ns-start" type="time" value="08:00" />
              <input id="ns-end" type="time" value="16:00" />
              <input id="ns-color" type="color" value="#1d4ed8" style="width:50px;height:42px;padding:2px;" />
            </div>
            <div style="margin-top:10px;">
              <label>Días laborales:</label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
                ${DAYS_SHORT.map((d, i) => `
                  <label style="display:flex;align-items:center;gap:4px;font-weight:normal;">
                    <input type="checkbox" class="ns-day" value="${i}" ${[1,2,3,4,5].includes(i)?'checked':''}> ${d}
                  </label>`).join('')}
              </div>
            </div>
            <button class="btn-primary" style="margin-top:12px;" onclick="addShift()">+ Agregar turno</button>
          </div>
          <table>
            <thead><tr><th>Nombre</th><th>Código</th><th>Horario</th><th>Días</th><th>Acciones</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    // ── Tab: Razones TE ──────────────────────────────────────────────────────
    if (catTab === 'te-razones') {
      const cats = await api('/api/rhh/nomina/te-catalogos') || [];
      const catsHtml = cats.map(cat => `
        <div class="card" style="margin-bottom:12px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:14px;">${escHtml(cat.nombre)}</strong>
            <div style="display:flex;gap:6px;">
              <button class="btn-ghost" style="font-size:11px;" onclick="renameTeCat(${cat.id},'${escHtml(cat.nombre).replace(/'/g,"\\'")}')">✏️ Renombrar</button>
              <button class="btn-ghost" style="font-size:11px;color:#b91c1c;" onclick="deleteTeCat(${cat.id})">🗑️</button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
            ${cat.motivos.map((m, i) => `
              <span style="background:#eff6ff;color:#1d4ed8;border-radius:8px;padding:3px 10px;font-size:12px;display:inline-flex;align-items:center;gap:6px;">
                ${escHtml(m)}
                <button onclick="deleteTeCatMotivo(${cat.id},${i})" style="border:none;background:none;cursor:pointer;color:#b91c1c;font-size:10px;padding:0;line-height:1;">✕</button>
              </span>`).join('')}
            ${cat.motivos.length === 0 ? '<span style="color:#9ca3af;font-size:12px;">Sin motivos</span>' : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <input id="nm-${cat.id}" placeholder="Nuevo motivo..." style="font-size:12px;width:200px;padding:5px 8px;" />
            <button class="btn-ghost" style="font-size:12px;" onclick="addTeCatMotivo(${cat.id})">+ Agregar</button>
          </div>
        </div>`).join('');

      tabContent = `
        <div class="card section" style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;">⚡ Clasificaciones de Tiempo Extra</h3>
            <button class="btn-ghost" style="font-size:12px;color:#7c3aed;" onclick="seedDefaultTeCatalogos()">🔄 Restaurar predeterminados</button>
          </div>
          <div class="row" style="margin-bottom:10px;">
            <input id="nte-nombre" placeholder="Nueva clasificación..." style="width:220px;" />
            <button class="btn-primary" onclick="addTeCat()">+ Agregar clasificación</button>
          </div>
        </div>
        ${catsHtml || '<div class="empty-state"><p>Sin clasificaciones. Usa "+ Agregar" o "Restaurar predeterminados".</p></div>'}`;
    }

    // ── Tab: Migración / Sync ────────────────────────────────────────────────
    if (catTab === 'migracion' && (state.user?.role === 'admin')) {
      // Sync preview desde SQLite externo
      let syncPreviewHtml = '';
      try {
        const sp = await api('/api/rhh/nomina/sync-from-sqlite');
        if (sp?.ok) {
          const pRows = (sp.preview_employees || []).slice(0, 20).map(e => `
            <tr style="${e.action==='crear'?'background:#f0fdf4;':''}">
              <td style="padding:3px 8px;font-weight:600;">${e.no_empleado}</td>
              <td style="padding:3px 8px;">${escHtml(e.nombre)}</td>
              <td style="padding:3px 8px;font-size:11px;">${escHtml(e.departamento)}</td>
              <td style="padding:3px 8px;font-size:11px;">${escHtml(e.puesto)}</td>
              <td style="padding:3px 8px;text-align:center;">
                <span style="font-size:11px;padding:2px 8px;border-radius:8px;${e.action==='crear'?'background:#dcfce7;color:#15803d;':'background:#dbeafe;color:#1d4ed8;'}">${e.action}</span>
              </td>
            </tr>`).join('');
          syncPreviewHtml = `
            <div class="card section" style="margin-bottom:16px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <h3 style="margin:0;">🔗 Sincronizar desde sistema_rrhh (SQLite)</h3>
              </div>
              <p style="font-size:13px;color:#6b7280;margin-bottom:10px;">
                Importa empleados, departamentos y puestos del sistema de referencia externo.
                Los empleados existentes se actualizan; los nuevos se crean automáticamente.
              </p>
              <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
                <div style="background:#f0fdf4;border-radius:8px;padding:8px 14px;font-size:13px;">
                  <strong>${sp.sqlite_employees}</strong> empleados en SQLite
                </div>
                <div style="background:#dcfce7;color:#15803d;border-radius:8px;padding:8px 14px;font-size:13px;">
                  <strong>${sp.to_create}</strong> a crear
                </div>
                <div style="background:#dbeafe;color:#1d4ed8;border-radius:8px;padding:8px 14px;font-size:13px;">
                  <strong>${sp.to_update}</strong> a actualizar
                </div>
                <div style="background:#fef9c3;color:#92400e;border-radius:8px;padding:8px 14px;font-size:13px;">
                  <strong>${sp.sqlite_incidencias}</strong> incidencias disponibles
                </div>
              </div>
              ${sp.new_departments?.length > 0 ? `<p style="font-size:12px;color:#059669;margin-bottom:8px;">✚ Nuevos departamentos: <strong>${sp.new_departments.join(', ')}</strong></p>` : ''}
              ${sp.new_positions?.length > 0 ? `<p style="font-size:12px;color:#059669;margin-bottom:8px;">✚ Nuevos puestos: <strong>${sp.new_positions.join(', ')}</strong></p>` : ''}
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="btn-primary" onclick="ejecutarSyncSqlite(false)">▶ Sincronizar empleados</button>
                <button class="btn-primary" style="background:#059669;" onclick="ejecutarSyncSqlite(true)">▶ Sincronizar + incidencias históricas</button>
              </div>
              ${pRows ? `
                <details>
                  <summary style="cursor:pointer;font-size:13px;font-weight:600;margin-bottom:8px;">Ver preview (${sp.preview_employees?.length || 0} empleados, mostrando primeros 20)</summary>
                  <div style="overflow-x:auto;margin-top:8px;">
                    <table style="font-size:12px;border-collapse:collapse;min-width:500px;">
                      <thead><tr style="background:#f3f4f6;"><th style="padding:4px 8px;">No.</th><th>Nombre</th><th>Departamento</th><th>Puesto</th><th style="text-align:center;">Acción</th></tr></thead>
                      <tbody>${pRows}</tbody>
                    </table>
                  </div>
                </details>` : ''}
            </div>`;
        }
      } catch (_) {
        syncPreviewHtml = `<div class="notice" style="margin-bottom:16px;"><strong>ℹ️</strong> Sync desde SQLite no disponible en este entorno (requiere <code>DB_SISTEMA_RRHH_PATH</code> configurado localmente).</div>`;
      }

      // Migración antigua (rhh_incidences → rhh_incidencias_semanales)
      const preview = await api('/api/rhh/nomina/migrar-incidencias?dry_run=1');
      const rows = (preview?.preview || []).map(p => `
        <tr style="${p.result!=='OK'?'color:#9ca3af;font-style:italic;':''}">
          <td>${p.id}</td>
          <td>${p.employee_id}</td>
          <td>${p.date}</td>
          <td>${p.type}</td>
          <td>S${p.no_periodo || '—'}</td>
          <td>${p.campo || '—'}</td>
          <td style="text-align:center;">${p.valor ?? '—'}</td>
          <td><span style="font-size:11px;${p.result==='OK'?'color:#15803d':'color:#b91c1c'}">${p.result}</span></td>
        </tr>`).join('');

      tabContent = `
        ${syncPreviewHtml}
        <div class="card section">
          <h3 style="margin-top:0;">🔄 Migración de incidencias antiguas (sistema anterior)</h3>
          <p style="font-size:13px;color:#6b7280;">
            Mapea las incidencias del sistema antiguo (rhh_incidences) al nuevo modelo semanal.
            Esta acción es segura: <strong>suma</strong> los valores al registro existente del período.
          </p>
          <div style="display:flex;gap:8px;margin-bottom:14px;">
            <div style="background:#f0fdf4;border-radius:8px;padding:8px 16px;font-size:13px;">
              <strong>${preview?.total || 0}</strong> incidencias antiguas
            </div>
            <div style="background:#dcfce7;border-radius:8px;padding:8px 16px;font-size:13px;color:#15803d;">
              <strong>${preview?.migrated || 0}</strong> a migrar
            </div>
            ${preview?.skipped > 0 ? `<div style="background:#fef9c3;border-radius:8px;padding:8px 16px;font-size:13px;color:#92400e;"><strong>${preview.skipped}</strong> sin período</div>` : ''}
          </div>
          ${preview?.total > 0
            ? `<button class="btn-primary" style="margin-bottom:14px;" onclick="ejecutarMigracion()">▶ Ejecutar migración</button>`
            : `<div class="empty-state"><p>No hay incidencias antiguas para migrar</p></div>`}
          ${rows ? `<div style="overflow-x:auto;">
            <table style="font-size:12px;border-collapse:collapse;min-width:600px;">
              <thead><tr style="background:#f3f4f6;">
                <th style="padding:5px 8px;">ID</th><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Período</th><th>Campo</th><th>Valor</th><th>Estado</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table></div>` : ''}
        </div>`;
    }

    const isAdmin = state.user?.role === 'admin';

    const content = `
      <div class="module-title">
        <h2>📁 Catálogos</h2>
      </div>
      <div class="tabs">
        <button class="tab-btn ${catTab==='departments'?'active':''}" onclick="catTab='departments';catalogosView()">🏢 Departamentos</button>
        <button class="tab-btn ${catTab==='positions'?'active':''}" onclick="catTab='positions';catalogosView()">💼 Puestos</button>
        <button class="tab-btn ${catTab==='shifts'?'active':''}" onclick="catTab='shifts';catalogosView()">⏰ Turnos</button>
        <button class="tab-btn ${catTab==='vacation-rules'?'active':''}" onclick="catTab='vacation-rules';catalogosView()">🌴 Reglas Vacaciones</button>
        <button class="tab-btn ${catTab==='te-razones'?'active':''}" onclick="catTab='te-razones';catalogosView()">⚡ Razones TE</button>
        ${isAdmin ? `<button class="tab-btn ${catTab==='migracion'?'active':''}" onclick="catTab='migracion';catalogosView()">🔄 Migración</button>` : ''}
      </div>
      ${tabContent}
    `;

    el.innerHTML = shell(content, 'catalogos');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'catalogos');
  }
}

// ── Catálogos TE — funciones CRUD ────────────────────────────────────────────

async function addTeCat() {
  const nombre = document.getElementById('nte-nombre')?.value?.trim();
  if (!nombre) { toast('Escribe el nombre de la clasificación', 'warning'); return; }
  try {
    await api('/api/rhh/nomina/te-catalogos', { method: 'POST', body: JSON.stringify({ nombre }) });
    _teCatalogos = null; // limpiar cache
    toast('Clasificación creada');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function renameTeCat(id, nombreActual) {
  const nuevo = prompt('Nuevo nombre de la clasificación:', nombreActual);
  if (!nuevo?.trim() || nuevo.trim() === nombreActual) return;
  try {
    await api(`/api/rhh/nomina/te-catalogos/${id}`, { method: 'PATCH', body: JSON.stringify({ nombre: nuevo.trim() }) });
    _teCatalogos = null;
    toast('Clasificación renombrada');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTeCat(id) {
  if (!confirm('¿Eliminar esta clasificación y todos sus motivos?')) return;
  try {
    await api(`/api/rhh/nomina/te-catalogos/${id}`, { method: 'DELETE' });
    _teCatalogos = null;
    toast('Clasificación eliminada');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function addTeCatMotivo(catId) {
  const input  = document.getElementById(`nm-${catId}`);
  const motivo = input?.value?.trim();
  if (!motivo) { toast('Escribe el motivo', 'warning'); return; }
  try {
    await api(`/api/rhh/nomina/te-catalogos/${catId}/motivos`, { method: 'POST', body: JSON.stringify({ motivo }) });
    _teCatalogos = null;
    toast('Motivo agregado');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTeCatMotivo(catId, midx) {
  if (!confirm('¿Eliminar este motivo?')) return;
  try {
    await api(`/api/rhh/nomina/te-catalogos/${catId}/motivos/${midx}`, { method: 'DELETE' });
    _teCatalogos = null;
    toast('Motivo eliminado');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function seedDefaultTeCatalogos() {
  if (!confirm('¿Restaurar clasificaciones TE a los valores predeterminados? (Se sobreescribe el catálogo actual)')) return;
  try {
    await api('/api/rhh/nomina/te-catalogos/seed-default', { method: 'POST', body: '{}' });
    _teCatalogos = null;
    toast('Catálogo restaurado');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function ejecutarSyncSqlite(incluirIncidencias) {
  const msg = incluirIncidencias
    ? '¿Sincronizar empleados + incidencias históricas (1566 registros) desde el SQLite?\nEsta acción puede tardar varios segundos.'
    : '¿Sincronizar empleados, departamentos y puestos desde el SQLite?';
  if (!confirm(msg)) return;
  try {
    const body = JSON.stringify({ sync_incidencias: incluirIncidencias });
    const res  = await api('/api/rhh/nomina/sync-from-sqlite', { method: 'POST', body });
    if (!res?.ok) throw new Error(res?.error || 'Error en sync');
    const l = res.log;
    toast(
      `Sync completado: ${l.employees.created} empleados creados, ${l.employees.updated} actualizados` +
      (incluirIncidencias ? `, ${l.incidencias.created} incidencias importadas` : ''),
      'success'
    );
    // Recargar catálogos en memoria
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function ejecutarMigracion() {
  if (!confirm('¿Ejecutar la migración ahora? Los datos se sumarán al modelo semanal.')) return;
  try {
    const res = await api('/api/rhh/nomina/migrar-incidencias', { method: 'POST', body: '{}' });
    toast(`Migración completada: ${res.migrated} incidencias → ${res.records_upserted} registros actualizados`, 'success');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Departamentos ─────────────────────────────────────────────────────────────

async function addDept() {
  const name = document.getElementById('nd-name')?.value?.trim();
  const code = document.getElementById('nd-code')?.value?.trim()?.toUpperCase();
  if (!name || !code) { toast('Nombre y código requeridos', 'warning'); return; }
  try {
    await api('/api/rhh/catalogs/departments', { method: 'POST', body: JSON.stringify({ name, code }) });
    toast('Departamento creado');
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function editDept(id, name, code, managerId) {
  const newName = prompt('Nombre del departamento:', name);
  if (!newName) return;
  const newCode = prompt('Código:', code);
  if (!newCode) return;
  try {
    await api(`/api/rhh/catalogs/departments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName, code: newCode })
    });
    toast('Departamento actualizado');
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteDept(id) {
  if (!confirm('¿Eliminar este departamento?')) return;
  try {
    await api(`/api/rhh/catalogs/departments/${id}`, { method: 'DELETE' });
    toast('Departamento eliminado');
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function addPosition() {
  const name = document.getElementById('np-name')?.value?.trim();
  const dept = document.getElementById('np-dept')?.value;
  const level = document.getElementById('np-level')?.value;
  if (!name || !dept) { toast('Nombre y departamento requeridos', 'warning'); return; }
  try {
    await api('/api/rhh/catalogs/positions', {
      method: 'POST',
      body: JSON.stringify({ name, department_id: Number(dept), level: Number(level) || 1 })
    });
    toast('Puesto creado');
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function deletePosition(id) {
  if (!confirm('¿Eliminar este puesto?')) return;
  try {
    await api(`/api/rhh/catalogs/positions/${id}`, { method: 'DELETE' });
    toast('Puesto eliminado');
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function seedPuestosCatalogo() {
  if (!confirm('¿Resetear el catálogo de puestos con los 22 puestos del sistema RRHH 2026?\n\nEsta acción reemplaza todos los puestos actuales.')) return;
  try {
    const res = await api('/api/rhh/nomina/seed-puestos', { method: 'POST' });
    toast(`Catálogo actualizado: ${res.count} puestos`);
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function addShift() {
  const name = document.getElementById('ns-name')?.value?.trim();
  const code = document.getElementById('ns-code')?.value?.trim()?.toUpperCase();
  const start_time = document.getElementById('ns-start')?.value;
  const end_time = document.getElementById('ns-end')?.value;
  const color = document.getElementById('ns-color')?.value;
  const work_days = [...document.querySelectorAll('.ns-day:checked')].map(c => Number(c.value));

  if (!name || !code || !start_time || !end_time) {
    toast('Nombre, código, hora inicio y fin son requeridos', 'warning');
    return;
  }
  try {
    await api('/api/rhh/catalogs/shifts', {
      method: 'POST',
      body: JSON.stringify({ name, code, start_time, end_time, color, work_days })
    });
    toast('Turno creado');
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteShift(id) {
  if (!confirm('¿Eliminar este turno?')) return;
  try {
    await api(`/api/rhh/catalogs/shifts/${id}`, { method: 'DELETE' });
    toast('Turno eliminado');
    await loadCatalogs();
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

// ── 14. Reportes ──────────────────────────────────────────────────────────────
let repYear = new Date().getFullYear();
let repMonth = new Date().getMonth() + 1;

async function reportesView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Generando reportes...</div>', 'reportes');

  try {
    const lastDay = new Date(repYear, repMonth, 0).getDate();
    const dateFrom = `${repYear}-${String(repMonth).padStart(2,'0')}-01`;
    const dateTo = `${repYear}-${String(repMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    const [employees, incidences, otSummary] = await Promise.all([
      api('/api/rhh/employees?status=active'),
      api(`/api/rhh/incidences?date_from=${dateFrom}&date_to=${dateTo}`),
      api(`/api/rhh/dashboard/overtime-summary?date_from=${dateFrom}&date_to=${dateTo}`)
    ]);
    if (!employees) return;

    const incData = incidences || [];
    const byType = {};
    for (const inc of incData) {
      if (inc.status === 'rechazada') continue;
      if (!byType[inc.type]) byType[inc.type] = 0;
      byType[inc.type]++;
    }

    const byDeptOt = (otSummary?.by_department || []).map(d => `
      <tr>
        <td>${d.department}</td>
        <td style="text-align:center;font-weight:700;">${d.total_hours}h</td>
        <td>${d.employees.map(e => `${e.full_name} (${e.hours}h)`).join(', ')}</td>
      </tr>`).join('');

    const content = `
      <div class="module-title">
        <h2>📊 Reportes</h2>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <button class="btn-ghost" onclick="repMonth--;if(repMonth<1){repMonth=12;repYear--;}reportesView()">‹</button>
        <strong style="min-width:160px;text-align:center;">${MONTHS[repMonth-1]} ${repYear}</strong>
        <button class="btn-ghost" onclick="repMonth++;if(repMonth>12){repMonth=1;repYear++;}reportesView()">›</button>
      </div>

      <div class="grid grid-2" style="margin-bottom:20px;">
        <div class="card section">
          <h3>📊 Incidencias por tipo</h3>
          ${Object.entries(byType).length === 0
            ? '<div class="empty-state" style="padding:24px;"><p>Sin incidencias en el período</p></div>'
            : Object.entries(byType).map(([type, count]) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);">
                <span>${incTypePill(type)}</span>
                <strong>${count}</strong>
              </div>`).join('')
          }
        </div>

        <div class="card section">
          <h3>⏱️ Tiempo extra por departamento</h3>
          ${otSummary?.by_department?.length === 0 || !otSummary
            ? '<div class="empty-state" style="padding:24px;"><p>Sin horas extra en el período</p></div>'
            : `<table>
                 <thead><tr><th>Departamento</th><th>Total</th><th>Empleados</th></tr></thead>
                 <tbody>${byDeptOt}</tbody>
               </table>`
          }
        </div>
      </div>

      <div class="card section">
        <h3>📋 Resumen de asistencia — ${MONTHS[repMonth-1]} ${repYear}</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Departamento</th>
                <th>Turno</th>
                <th style="text-align:center;">Faltas</th>
                <th style="text-align:center;">Vacaciones</th>
                <th style="text-align:center;">Permisos</th>
                <th style="text-align:center;">Incapacidades</th>
                <th style="text-align:center;">H. Extra</th>
              </tr>
            </thead>
            <tbody>
              ${(employees || []).map(emp => {
                const empInc = incData.filter(i => i.employee_id === emp.id && i.status !== 'rechazada');
                const f = empInc.filter(i => i.type==='falta').length;
                const v = empInc.filter(i => i.type==='vacacion').length;
                const p = empInc.filter(i => i.type==='permiso').length;
                const ic = empInc.filter(i => i.type==='incapacidad').length;
                const he = empInc.filter(i => i.type==='tiempo_extra').reduce((s, i) => s + (i.hours||0), 0);
                return `
                  <tr>
                    <td><strong>${emp.full_name}</strong></td>
                    <td>${emp.department?.name || '—'}</td>
                    <td>${shiftDot(emp.shift)}</td>
                    <td style="text-align:center;${f>0?'color:#b91c1c;font-weight:700;':''}">${f}</td>
                    <td style="text-align:center;">${v}</td>
                    <td style="text-align:center;">${p}</td>
                    <td style="text-align:center;">${ic}</td>
                    <td style="text-align:center;${he>0?'color:#059669;font-weight:700;':''}">${he > 0 ? he+'h' : '—'}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top:16px;">
          <button class="btn-ghost" onclick="exportReportCSV()">📥 Exportar CSV</button>
        </div>
      </div>
    `;

    // ── Sección Nómina (solo admin/rh) ──────────────────────────────────────
    let nominaSeccion = '';
    const userRole = state.user?.role || '';
    if (userRole === 'admin' || userRole === 'rh') {
      try {
        if (incSemPeriodos.length === 0) {
          incSemPeriodos = await api('/api/rhh/nomina/periodos') || [];
        }
        // Cargar los últimos 4 períodos para comparativa
        const periodosRecientes = incSemPeriodos.slice(-4).reverse();
        const kpisArr = await Promise.all(
          periodosRecientes.map(p => api(`/api/rhh/nomina/kpis?no_periodo=${p.no_periodo}`).catch(() => null))
        );

        const periodoRows = kpisArr.filter(Boolean).map((nk, i) => {
          const p = periodosRecientes[i];
          const s = nk.resumen;
          const pct = s.total_empleados > 0 ? Math.round((s.capturados / s.total_empleados) * 100) : 0;
          const pctColor = pct >= 80 ? '#15803d' : pct >= 50 ? '#b45309' : '#b91c1c';
          return `
            <tr style="cursor:pointer;" onclick="incSemPeriodo=${p.no_periodo};location.hash='#incidencias'">
              <td style="font-weight:600;">S${p.no_periodo}</td>
              <td style="font-size:11px;color:#6b7280;">${p.fecha_inicio} al ${p.fecha_fin}</td>
              <td style="text-align:center;font-weight:700;color:${pctColor};">${s.capturados}/${s.total_empleados} (${pct}%)</td>
              <td style="text-align:center;color:#b91c1c;font-weight:600;">${s.total_faltas}</td>
              <td style="text-align:center;color:#1d4ed8;font-weight:600;">${s.total_horas_extras}h</td>
              <td style="text-align:center;">${s.con_despensa}</td>
              <td style="text-align:center;">${s.con_bono_puntualidad}</td>
              <td style="text-align:center;">${s.con_bono_eficiencia}</td>
              <td style="text-align:center;color:#b45309;">${s.total_vac_dias > 0 ? s.total_vac_dias + ' días' : '—'}</td>
              <td style="text-align:center;">${s.pendientes_captura > 0 ? `<span style="color:#b91c1c;font-weight:600;">${s.pendientes_captura}</span>` : '<span style="color:#15803d;">✓</span>'}</td>
            </tr>`;
        }).join('');

        nominaSeccion = periodoRows ? `
          <div class="card section" style="margin-top:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <h3 style="margin:0;">💰 KPIs Nómina — Últimos 4 períodos</h3>
              <button class="btn-ghost" style="font-size:12px;" onclick="location.hash='#lista-raya'">Ver Lista de Raya →</button>
            </div>
            <p style="font-size:12px;color:#6b7280;margin-bottom:10px;">Haz clic en un período para ir a captura de incidencias.</p>
            <div style="overflow-x:auto;">
              <table style="min-width:750px;font-size:12px;border-collapse:collapse;width:100%;">
                <thead>
                  <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
                    <th style="padding:6px 8px;">Período</th>
                    <th>Fechas</th>
                    <th style="text-align:center;">Capturado</th>
                    <th style="text-align:center;color:#b91c1c;">Faltas</th>
                    <th style="text-align:center;color:#1d4ed8;">H.Extra</th>
                    <th style="text-align:center;">Despensa</th>
                    <th style="text-align:center;">B.Punt.</th>
                    <th style="text-align:center;">B.Efic.</th>
                    <th style="text-align:center;color:#b45309;">Vacaciones</th>
                    <th style="text-align:center;">Pendiente</th>
                  </tr>
                </thead>
                <tbody>${periodoRows}</tbody>
              </table>
            </div>
          </div>` : '';
      } catch (_) { nominaSeccion = ''; }
    }

    el.innerHTML = shell(content + nominaSeccion, 'reportes');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'reportes');
  }
}

function exportReportCSV() {
  toast('Función de exportación: implementa según tu servidor de reportes.', 'warning');
}

// ── 15. Perfil ────────────────────────────────────────────────────────────────
async function perfilView() {
  const el = document.getElementById('app');
  const u = state.user;
  const role = u?.role || 'empleado';
  const menu = MENU_BY_ROLE[role] || [];
  const activeH = menu[0]?.[0] || '';

  // Load vacation balance for employees
  let vacSectionHtml = '';
  if (u?.employee_id) {
    try {
      const vb = await api(`/api/rhh/employees/vacation-balance/${u.employee_id}`).catch(() => null);
      if (vb) {
        const used = vb.vacation_used || 0;
        const total = vb.total_vacation_days || 15;
        const remaining = vb.vacation_remaining || 0;
        const pending = vb.vacation_pending || 0;
        const usedPct = Math.min(100, Math.round((used / total) * 100));
        const barFilled = Math.round(usedPct / 100 * 10);
        const barEmpty = 10 - barFilled;
        const bar = '█'.repeat(barFilled) + '░'.repeat(barEmpty);

        const usedRows = (vb.detail || []).filter(d => d.status === 'aprobada').map(d => `
          <tr>
            <td>${fmtDateDisplay(d.date)}${d.date_end && d.date_end !== d.date ? ` → ${fmtDateDisplay(d.date_end)}` : ''}</td>
            <td>${d.days} día${d.days !== 1 ? 's' : ''}</td>
            <td><span class="pill active">Aprobada</span></td>
          </tr>`).join('');

        const pendRows = (vb.detail || []).filter(d => d.status === 'pendiente').map(d => `
          <tr>
            <td>${fmtDateDisplay(d.date)}${d.date_end && d.date_end !== d.date ? ` → ${fmtDateDisplay(d.date_end)}` : ''}</td>
            <td>${d.days} día${d.days !== 1 ? 's' : ''}</td>
            <td><span class="pill pendiente">Pendiente</span></td>
          </tr>`).join('');

        vacSectionHtml = `
          <div class="card section" style="margin-top:16px;max-width:480px;">
            <h4 style="margin-bottom:12px;">🌴 Mis Vacaciones ${vb.year}</h4>
            <div style="font-family:monospace;font-size:15px;margin-bottom:8px;letter-spacing:2px;color:#047857;">[${bar}]</div>
            <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">
              ${used} de ${total} días usados · <strong style="color:#059669;">${remaining} restantes</strong>${pending > 0 ? ` · ${pending} pendientes de aprobación` : ''}
            </div>
            ${usedRows ? `
              <details open>
                <summary style="font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px;">Vacaciones tomadas</summary>
                <table><thead><tr><th>Fechas</th><th>Días</th><th>Estado</th></tr></thead>
                <tbody>${usedRows}</tbody></table>
              </details>` : '<p style="font-size:13px;color:var(--muted);">No has tomado vacaciones este año.</p>'}
            ${pendRows ? `
              <details style="margin-top:8px;">
                <summary style="font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px;">Solicitudes pendientes</summary>
                <table><thead><tr><th>Fechas</th><th>Días</th><th>Estado</th></tr></thead>
                <tbody>${pendRows}</tbody></table>
              </details>` : ''}
          </div>`;
      }
    } catch (_) {}
  }

  const content = `
    <h2>⚙️ Mi Perfil</h2>
    <div class="card section" style="max-width:480px;">
      <div style="margin-bottom:16px;">
        <div style="font-size:40px;text-align:center;padding:12px;">👤</div>
        <h3 style="text-align:center;">${u?.full_name || ''}</h3>
        <p style="text-align:center;">${u?.email || ''}</p>
        <p style="text-align:center;"><span class="badge">${u?.role?.toUpperCase() || ''}</span></p>
      </div>
      <hr style="border:none;border-top:1px solid var(--line);margin:16px 0;" />
      <h4>Cambiar contraseña</h4>
      <label>Contraseña actual</label>
      <input id="p-curr" type="password" placeholder="Contraseña actual" />
      <label>Nueva contraseña</label>
      <input id="p-new" type="password" placeholder="Mínimo 6 caracteres" />
      <label>Confirmar nueva contraseña</label>
      <input id="p-conf" type="password" placeholder="Repetir nueva contraseña" />
      <div style="margin-top:14px;">
        <button class="btn-primary" onclick="changePassword()">Cambiar contraseña</button>
      </div>
    </div>
    ${vacSectionHtml}
  `;

  el.innerHTML = shell(content, activeH);
}

async function changePassword() {
  const curr = document.getElementById('p-curr')?.value;
  const newP = document.getElementById('p-new')?.value;
  const conf = document.getElementById('p-conf')?.value;
  if (!curr || !newP || !conf) { toast('Completa todos los campos', 'warning'); return; }
  if (newP !== conf) { toast('Las contraseñas nuevas no coinciden', 'warning'); return; }
  try {
    await api('/api/rhh/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: curr, new_password: newP })
    });
    toast('Contraseña actualizada exitosamente');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPEDIENTE DIGITAL
// ══════════════════════════════════════════════════════════════════════════════

const DOC_CATEGORIES = {
  contrato: 'Contrato',
  identificacion: 'Identificación',
  nss: 'NSS',
  curp: 'CURP',
  acta_administrativa: 'Acta administrativa',
  incapacidad: 'Incapacidad',
  carta_renuncia: 'Carta de renuncia',
  evaluacion: 'Evaluación',
  capacitacion: 'Capacitación',
  otro: 'Otro'
};

const DOC_ICONS = {
  'application/pdf': '📄',
  'image/jpeg': '🖼️',
  'image/png': '🖼️',
  'image/jpg': '🖼️',
  default: '📎'
};

function docIcon(fileType) {
  return DOC_ICONS[fileType] || DOC_ICONS.default;
}

async function loadExpediente(empId) {
  const wrap = document.getElementById('expediente-wrap');
  if (!wrap) return;

  try {
    const [emp, docs] = await Promise.all([
      api(`/api/rhh/employees/${empId}`),
      api(`/api/rhh/employees/${empId}/documents`)
    ]);
    if (!emp || !docs) return;

    const REQUIRED_CATEGORIES = ['contrato', 'identificacion', 'nss', 'curp'];
    const presentCats = new Set((docs || []).map(d => d.category));

    const checklistHtml = REQUIRED_CATEGORIES.map(cat =>
      `<span style="margin-right:12px;">${presentCats.has(cat) ? '✅' : '⬜'} ${DOC_CATEGORIES[cat]}</span>`
    ).join('');

    // Agrupar por categoría
    const byCategory = {};
    for (const doc of (docs || [])) {
      if (!byCategory[doc.category]) byCategory[doc.category] = [];
      byCategory[doc.category].push(doc);
    }

    const docsHtml = Object.entries(byCategory).map(([cat, catDocs]) => `
      <div style="margin-bottom:16px;">
        <h5 style="margin:0 0 8px;color:#064e3b;font-size:13px;">${DOC_CATEGORIES[cat] || cat}</h5>
        ${catDocs.map(doc => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px;background:#f0fdf4;border-radius:8px;margin-bottom:6px;border:1px solid #bbf7d0;">
            <span style="font-size:20px;">${docIcon(doc.file_type)}</span>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13px;">${doc.name}</div>
              <div class="small muted">${fmtDateDisplay(doc.uploaded_at?.slice(0,10))}${doc.notes ? ' — ' + doc.notes : ''}</div>
            </div>
            ${doc.has_file ? `<button class="btn-ghost" style="font-size:12px;" onclick="downloadDoc(${empId},${doc.id},'${doc.name}')">⬇️ Descargar</button>` : ''}
            <button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="deleteDoc(${empId},${doc.id})">🗑️</button>
          </div>`).join('')}
      </div>`).join('');

    const catOpts = Object.entries(DOC_CATEGORIES).map(([v, l]) =>
      `<option value="${v}">${l}</option>`
    ).join('');

    // Cargar plantillas de documentos
    let docTemplates = [];
    try { docTemplates = await api('/api/rhh/employees/doc-templates') || []; } catch (_) {}

    const tplOpts = docTemplates.map(t =>
      `<option value="${t.id}">${t.name} (${t.category})</option>`
    ).join('');

    wrap.innerHTML = `
      <div class="card section">
        <h3>📁 Expediente digital — ${emp.full_name}</h3>
        <div style="margin-bottom:16px;padding:12px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
          <strong>Checklist de documentos requeridos:</strong><br>
          <div style="margin-top:8px;">${checklistHtml}</div>
        </div>
        ${docs.length === 0
          ? '<div class="empty-state"><div class="empty-icon">📁</div><p>No hay documentos cargados</p></div>'
          : docsHtml
        }
        <div style="margin-top:16px;padding:16px;background:#fafafa;border-radius:10px;border:1px solid var(--line);">
          <h4 style="margin:0 0 12px;">Subir documento</h4>
          <div class="row">
            <div>
              <label>Categoría *</label>
              <select id="doc-cat">${catOpts}</select>
            </div>
            <div>
              <label>Nombre *</label>
              <input id="doc-name" placeholder="Ej: Contrato indefinido 2025" />
            </div>
          </div>
          <div class="row" style="margin-top:8px;">
            <div>
              <label>Archivo (PDF, JPG, PNG — máx. 5MB)</label>
              <input type="file" id="doc-file" accept=".pdf,.jpg,.jpeg,.png" onchange="previewDocFile(this)" />
            </div>
            <div>
              <label>Notas</label>
              <input id="doc-notes" placeholder="Observaciones opcionales..." />
            </div>
          </div>
          <div id="doc-file-info" class="small muted" style="margin-top:6px;"></div>
          <div style="margin-top:12px;">
            <button class="btn-primary" onclick="uploadDoc(${empId})">📤 Subir documento</button>
          </div>
        </div>
        ${docTemplates.length > 0 ? `
        <div style="margin-top:16px;padding:16px;background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;">
          <h4 style="margin:0 0 12px;color:#1d4ed8;">Generar documento desde plantilla</h4>
          <div class="row">
            <div>
              <label>Plantilla</label>
              <select id="gen-tpl-id">${tplOpts}</select>
            </div>
            <div style="align-self:flex-end;">
              <button class="btn-primary" style="background:#1d4ed8;" onclick="generateDoc(${empId})">📄 Generar documento</button>
            </div>
          </div>
        </div>` : ''}
      </div>
    `;
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}

function previewDocFile(input) {
  const info = document.getElementById('doc-file-info');
  if (!info) return;
  const file = input.files?.[0];
  if (!file) { info.textContent = ''; return; }
  const mb = (file.size / 1024 / 1024).toFixed(2);
  if (file.size > 5 * 1024 * 1024) {
    info.textContent = `⚠️ Archivo demasiado grande (${mb} MB). El límite es 5 MB.`;
    info.style.color = '#b91c1c';
    input.value = '';
    return;
  }
  info.textContent = `✅ ${file.name} (${mb} MB)`;
  info.style.color = '#059669';
}

async function uploadDoc(empId) {
  const category = document.getElementById('doc-cat')?.value;
  const name = document.getElementById('doc-name')?.value?.trim();
  const notes = document.getElementById('doc-notes')?.value?.trim() || null;
  const fileInput = document.getElementById('doc-file');
  const file = fileInput?.files?.[0] || null;

  if (!category || !name) {
    toast('Categoría y nombre son requeridos', 'warning');
    return;
  }

  let file_data = null;
  let file_type = null;

  if (file) {
    if (file.size > 5 * 1024 * 1024) {
      toast('El archivo supera el límite de 5 MB', 'error');
      return;
    }
    file_type = file.type;
    file_data = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  try {
    await api(`/api/rhh/employees/${empId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ category, name, file_data, file_type, notes })
    });
    toast('Documento subido exitosamente');
    loadExpediente(empId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function downloadDoc(empId, docId, name) {
  try {
    const doc = await api(`/api/rhh/employees/${empId}/documents/${docId}`);
    if (!doc?.file_data) { toast('El documento no tiene archivo adjunto', 'warning'); return; }
    const a = document.createElement('a');
    a.href = doc.file_data;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteDoc(empId, docId) {
  if (!confirm('¿Eliminar este documento del expediente?')) return;
  try {
    await api(`/api/rhh/employees/${empId}/documents/${docId}`, { method: 'DELETE' });
    toast('Documento eliminado');
    loadExpediente(empId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function generateDoc(empId) {
  const template_id = document.getElementById('gen-tpl-id')?.value;
  if (!template_id) { toast('Selecciona una plantilla', 'warning'); return; }
  try {
    const result = await api(`/api/rhh/employees/${empId}/generate-doc`, {
      method: 'POST',
      body: JSON.stringify({ template_id: Number(template_id) })
    });
    if (!result) return;

    // Mostrar modal con el documento generado
    const existing = document.getElementById('docGenModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'docGenModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:700px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
          <h3 style="margin:0;color:#064e3b;">📄 ${result.filename}</h3>
          <button class="btn-ghost" onclick="document.getElementById('docGenModal').remove()">✕ Cerrar</button>
        </div>
        <div id="doc-preview-content" style="flex:1;overflow:auto;padding:24px;font-family:serif;line-height:1.6;">${result.html_content}</div>
        <div style="padding:16px 20px;border-top:1px solid #e5e7eb;display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn-ghost" onclick="printGeneratedDoc()">🖨️ Imprimir</button>
          <button class="btn-primary" onclick="saveGeneratedDoc(${empId},'${result.filename}','${result.category}')">💾 Guardar en expediente</button>
          <button class="btn-ghost" onclick="document.getElementById('docGenModal').remove()">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // Guardar html para uso posterior
    modal._htmlContent = result.html_content;
    modal._category = result.category;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function printGeneratedDoc() {
  const content = document.getElementById('doc-preview-content')?.innerHTML;
  if (!content) return;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Documento</title>
    <style>body{font-family:serif;padding:40px;line-height:1.6;}</style></head>
    <body>${content}</body></html>`);
  win.document.close();
  win.print();
}

async function saveGeneratedDoc(empId, filename, category) {
  const content = document.getElementById('doc-preview-content')?.innerHTML;
  if (!content) return;
  const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
  const file_data = 'data:text/html;base64,' + btoa(unescape(encodeURIComponent(htmlContent)));
  try {
    await api(`/api/rhh/employees/${empId}/documents`, {
      method: 'POST',
      body: JSON.stringify({
        category: category || 'contrato',
        name: filename,
        file_data,
        file_type: 'text/html',
        notes: 'Generado automáticamente desde plantilla'
      })
    });
    toast('Documento guardado en el expediente');
    document.getElementById('docGenModal')?.remove();
    loadExpediente(empId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROGRAMACIÓN DE T.E.
// ══════════════════════════════════════════════════════════════════════════════

let teYear = new Date().getFullYear();
let teMonth = new Date().getMonth() + 1;

// Días no laborables por turno que pueden tener TE:
// T1 (id:1): domingos (0)
// T2 (id:2): domingos (0)
// T3 (id:3): sábados (6) y domingos (0)
// ADM (id:4): no aplica TE
const TE_NON_WORK_DAYS = {
  1: [0],       // T1: domingos
  2: [0],       // T2: domingos
  3: [6, 0]     // T3: sábados y domingos
};

async function programacionTEView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando programación T.E....</div>', 'programacion-te');

  try {
    const monthStr = `${teYear}-${String(teMonth).padStart(2, '0')}`;
    const teAuths = await api(`/api/rhh/schedule/te-authorizations?month=${monthStr}`) || [];

    const lastDay = new Date(teYear, teMonth, 0).getDate();
    const operativeShifts = state.shifts.filter(s => TE_NON_WORK_DAYS[s.id]);
    const role = state.user?.role;
    const canApprove = ['rh', 'admin'].includes(role);
    const canRequest = ['supervisor', 'rh', 'admin'].includes(role);

    // Construir grid: columnas = turnos T1, T2, T3
    // Solo mostrar días que al menos un turno tiene como no laboral
    const gridRows = [];
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${teYear}-${String(teMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();
      const dayName = DAYS_SHORT[dayOfWeek];

      const cols = operativeShifts.map(shift => {
        const nonWorkDays = TE_NON_WORK_DAYS[shift.id] || [];
        const isNonWork = nonWorkDays.includes(dayOfWeek);
        if (!isNonWork) return null; // este turno trabaja normalmente este día

        const auth = teAuths.find(t => t.date === dateStr && t.shift_id === shift.id) || null;

        let cellContent = '';
        let cellBg = '#f3f4f6'; // gris = no laboral sin TE

        if (auth) {
          if (auth.status === 'approved') {
            cellBg = '#dcfce7';
            cellContent = `<span class="pill active" style="font-size:11px;">✅ Autorizado</span>`;
            if (canApprove) cellContent += `<br><button class="btn-ghost" style="font-size:10px;margin-top:4px;color:#b91c1c;" onclick="updateTE(${auth.id},'rejected')">Cancelar</button>`;
          } else if (auth.status === 'pending') {
            cellBg = '#fef9c3';
            cellContent = `<span class="pill pendiente" style="font-size:11px;">⏳ Pendiente</span>`;
            if (canApprove) cellContent += `
              <br><button class="btn-primary" style="font-size:10px;margin-top:4px;padding:3px 8px;" onclick="updateTE(${auth.id},'approved')">✅ Aprobar</button>
              <button class="btn-ghost" style="font-size:10px;margin-top:2px;color:#b91c1c;" onclick="updateTE(${auth.id},'rejected')">✗ Rechazar</button>`;
          } else if (auth.status === 'rejected') {
            cellBg = '#fee2e2';
            cellContent = `<span class="pill rechazada" style="font-size:11px;">✗ Rechazado</span>`;
            if (canRequest) cellContent += `<br><button class="btn-ghost" style="font-size:10px;margin-top:4px;" onclick="requestTE('${dateStr}',${shift.id})">Re-solicitar</button>`;
          }
        } else {
          cellContent = `<span class="small muted">No laboral</span>`;
          if (canRequest) cellContent += `<br><button class="btn-primary" style="font-size:10px;margin-top:4px;padding:3px 8px;" onclick="requestTE('${dateStr}',${shift.id})">+ Solicitar T.E.</button>`;
        }

        return { shift, cellBg, cellContent };
      });

      const hasNonWorkDay = cols.some(c => c !== null);
      if (hasNonWorkDay) {
        gridRows.push({ dateStr, dayName, d, cols });
      }
    }

    const shiftHeaders = operativeShifts.map(s =>
      `<th style="text-align:center;"><span class="shift-dot" style="background:${s.color}"></span>${s.name}</th>`
    ).join('');

    const tableRows = gridRows.map(row => {
      const cells = row.cols.map((col, ci) => {
        if (!col) {
          return `<td style="background:white;text-align:center;"><span class="small muted">Laboral</span></td>`;
        }
        return `<td style="background:${col.cellBg};text-align:center;padding:10px 8px;vertical-align:middle;">${col.cellContent}</td>`;
      }).join('');
      return `<tr>
        <td style="font-weight:600;white-space:nowrap;">${row.dayName} ${row.d}</td>
        ${cells}
      </tr>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>🔥 Programación T.E. (Tiempo Extra)</h2>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button class="btn-ghost" onclick="teMonth--;if(teMonth<1){teMonth=12;teYear--;}programacionTEView()">‹</button>
        <strong style="min-width:160px;text-align:center;">${MONTHS[teMonth-1]} ${teYear}</strong>
        <button class="btn-ghost" onclick="teMonth++;if(teMonth>12){teMonth=1;teYear++;}programacionTEView()">›</button>
        <button class="btn-ghost" style="font-size:12px;" onclick="teYear=new Date().getFullYear();teMonth=new Date().getMonth()+1;programacionTEView()">Hoy</button>
      </div>

      <div class="card section" style="margin-bottom:12px;padding:10px 16px;">
        <strong>Leyenda:</strong>
        <span style="margin:0 8px;padding:4px 8px;background:#f3f4f6;border-radius:6px;font-size:12px;">Gris: No laboral</span>
        <span style="margin:0 8px;padding:4px 8px;background:#fef9c3;border-radius:6px;font-size:12px;">Amarillo: TE pendiente</span>
        <span style="margin:0 8px;padding:4px 8px;background:#dcfce7;border-radius:6px;font-size:12px;">Verde: TE autorizado</span>
        <span style="margin:0 8px;padding:4px 8px;background:#fee2e2;border-radius:6px;font-size:12px;">Rojo: Rechazado</span>
        <span style="margin:0 8px;padding:4px 8px;background:white;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;">Blanco: Día laboral</span>
      </div>

      <div class="card section table-wrap">
        ${gridRows.length === 0
          ? '<div class="empty-state"><div class="empty-icon">🔥</div><p>No hay días no laborables en este mes para los turnos operativos</p></div>'
          : `<table>
               <thead>
                 <tr>
                   <th>Día</th>
                   ${shiftHeaders}
                 </tr>
               </thead>
               <tbody>${tableRows}</tbody>
             </table>`
        }
      </div>
    `;

    el.innerHTML = shell(content, 'programacion-te');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'programacion-te');
  }
}

async function requestTE(date, shiftId) {
  const notes = prompt(`Solicitar T.E. para turno en ${date}. Notas (opcional):`);
  if (notes === null) return; // cancelado
  try {
    await api('/api/rhh/schedule/te-authorizations', {
      method: 'POST',
      body: JSON.stringify({ date, shift_id: shiftId, notes: notes || null, positions: [] })
    });
    toast('Solicitud de T.E. enviada');
    programacionTEView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function updateTE(id, status) {
  try {
    await api(`/api/rhh/schedule/te-authorizations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    toast(status === 'approved' ? 'T.E. autorizado' : 'T.E. rechazado/cancelado');
    programacionTEView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// QUEJA ANÓNIMA
// ══════════════════════════════════════════════════════════════════════════════

async function quejaAnonimView() {
  const el = document.getElementById('app');

  const catOpts = [
    ['acoso', 'Acoso'],
    ['seguridad', 'Seguridad'],
    ['condiciones_trabajo', 'Condiciones de trabajo'],
    ['trato_injusto', 'Trato injusto'],
    ['otro', 'Otro']
  ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  const content = `
    <div class="module-title">
      <h2>📢 Queja Anónima</h2>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:900px;">

      <!-- Panel izquierdo: enviar queja -->
      <div class="card section">
        <h3 style="margin-bottom:14px;">📤 Enviar nueva queja</h3>
        <div style="padding:10px 12px;background:#fef9c3;border-radius:10px;border:1px solid #fcd34d;margin-bottom:16px;font-size:13px;">
          <strong>🔒 Tu identidad no será revelada.</strong><br>
          No se registra ningún dato que te identifique. Solo RH puede ver el contenido.
        </div>
        <label>Categoría *</label>
        <select id="qan-cat">${catOpts}</select>
        <div style="margin-top:12px;">
          <label>Descripción * <span class="small muted">(mínimo 20 caracteres)</span></label>
          <textarea id="qan-desc" rows="5" placeholder="Describe la situación con el mayor detalle posible..."></textarea>
          <div id="qan-count" class="small muted" style="text-align:right;margin-top:4px;">0 caracteres</div>
        </div>
        <div style="margin-top:14px;">
          <button class="btn-primary" onclick="submitQueja()">📤 Enviar queja anónima</button>
        </div>

        <!-- Código mostrado tras enviar -->
        <div id="qan-code-box" style="display:none;margin-top:20px;padding:16px;background:#f0fdf4;border:2px solid #86efac;border-radius:12px;">
          <p style="font-size:13px;font-weight:700;color:#166534;margin-bottom:8px;">✅ Queja enviada correctamente</p>
          <p style="font-size:12px;color:#166534;margin-bottom:10px;">
            Guarda este código para consultar la respuesta de RH:
          </p>
          <div style="display:flex;align-items:center;gap:8px;">
            <span id="qan-code-val" style="font-size:22px;font-weight:900;letter-spacing:4px;color:#0f766e;font-family:monospace;"></span>
            <button onclick="copyTrackingCode()" style="padding:4px 10px;font-size:11px;border:1px solid #0f766e;border-radius:6px;background:#fff;color:#0f766e;cursor:pointer;font-weight:700;">📋 Copiar</button>
          </div>
          <p style="font-size:11px;color:#6b7280;margin-top:8px;">
            ⚠️ Este código no se volverá a mostrar. Guárdalo en un lugar seguro.
          </p>
        </div>
      </div>

      <!-- Panel derecho: consultar respuesta -->
      <div class="card section">
        <h3 style="margin-bottom:14px;">🔍 Consultar respuesta</h3>
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
          Si ya enviaste una queja anteriormente, ingresa tu código de seguimiento para ver si RH ha respondido.
        </p>
        <label>Código de seguimiento</label>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <input id="qan-track-input" type="text" placeholder="QJA-XXXXXX"
            style="flex:1;padding:8px 12px;border:1.5px solid var(--line);border-radius:8px;font-size:15px;font-family:monospace;font-weight:700;text-transform:uppercase;letter-spacing:2px;"
            oninput="this.value=this.value.toUpperCase()"
            onkeydown="if(event.key==='Enter')consultarQueja()"/>
          <button class="btn-primary" onclick="consultarQueja()">Buscar</button>
        </div>
        <div id="qan-track-err" style="color:#b91c1c;font-size:12px;margin-top:6px;"></div>

        <!-- Resultado de la consulta -->
        <div id="qan-track-result" style="display:none;margin-top:16px;"></div>
      </div>
    </div>
  `;

  el.innerHTML = shell(content, 'queja-anonima');

  setTimeout(() => {
    const desc = document.getElementById('qan-desc');
    const count = document.getElementById('qan-count');
    if (desc && count) {
      desc.addEventListener('input', () => {
        const n = desc.value.length;
        count.textContent = `${n} caracteres`;
        count.style.color = n < 20 ? '#b91c1c' : '#059669';
      });
    }
  }, 100);
}

let _lastTrackingCode = null;

async function submitQueja() {
  const category = document.getElementById('qan-cat')?.value;
  const description = document.getElementById('qan-desc')?.value?.trim();
  if (!category || !description) { toast('Completa todos los campos', 'warning'); return; }
  if (description.length < 20) { toast('La descripción debe tener al menos 20 caracteres', 'warning'); return; }

  try {
    const result = await api('/api/rhh/incidences/complaints', {
      method: 'POST',
      body: JSON.stringify({ category, description })
    });

    // Mostrar código de seguimiento
    _lastTrackingCode = result.tracking_code;
    const codeBox = document.getElementById('qan-code-box');
    const codeVal = document.getElementById('qan-code-val');
    if (codeBox && codeVal && result.tracking_code) {
      codeVal.textContent = result.tracking_code;
      codeBox.style.display = 'block';
    }

    // Limpiar form
    const cat = document.getElementById('qan-cat');
    const desc = document.getElementById('qan-desc');
    const count = document.getElementById('qan-count');
    if (cat) cat.selectedIndex = 0;
    if (desc) desc.value = '';
    if (count) count.textContent = '0 caracteres';
  } catch (err) {
    toast(err.message, 'error');
  }
}

function copyTrackingCode() {
  if (!_lastTrackingCode) return;
  navigator.clipboard.writeText(_lastTrackingCode).then(() => toast('Código copiado al portapapeles'));
}

async function consultarQueja() {
  const code = document.getElementById('qan-track-input')?.value?.trim().toUpperCase();
  const errEl = document.getElementById('qan-track-err');
  const resultEl = document.getElementById('qan-track-result');
  errEl.textContent = '';
  resultEl.style.display = 'none';

  if (!code || code.length < 4) { errEl.textContent = 'Ingresa el código de seguimiento.'; return; }

  try {
    const data = await api(`/api/rhh/incidences/complaints/track/${encodeURIComponent(code)}`);
    const statusColors = {
      new:      { bg:'#eff6ff', text:'#1e40af', label:'Nueva — pendiente de revisión' },
      reviewed: { bg:'#fef9c3', text:'#854d0e', label:'En revisión por RH' },
      closed:   { bg:'#f0fdf4', text:'#166534', label:'Resuelta' }
    };
    const sc = statusColors[data.status] || { bg:'#f3f4f6', text:'#374151', label: data.status };

    resultEl.innerHTML = `
      <div style="padding:14px;border-radius:10px;border:1px solid ${sc.bg === '#f0fdf4' ? '#86efac' : '#e2e8f0'};background:${sc.bg};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <span style="font-size:12px;font-weight:700;color:${sc.text};background:${sc.bg};padding:3px 10px;border-radius:20px;border:1px solid currentColor;">
            ${sc.label}
          </span>
          <span style="font-size:11px;color:var(--muted);">${data.date}</span>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:${data.has_response ? 12 : 0}px;">
          Categoría: <strong>${data.category}</strong>
        </p>
        ${data.has_response ? `
          <div style="background:#fff;border-left:3px solid ${sc.text};padding:10px 14px;border-radius:0 8px 8px 0;">
            <p style="font-size:11px;font-weight:700;color:${sc.text};margin-bottom:6px;">💬 Respuesta de RH:</p>
            <p style="font-size:13px;color:#1f2937;">${data.response}</p>
          </div>
        ` : `
          <p style="font-size:12px;color:var(--muted);font-style:italic;">
            RH aún no ha respondido. Vuelve a consultar más tarde.
          </p>
        `}
      </div>`;
    resultEl.style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
  }
}

// ── Vista de quejas para RH/Admin ─────────────────────────────────────────────
async function quejasRHView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando quejas...</div>', 'quejas-rh');

  try {
    const complaints = await api('/api/rhh/incidences/complaints') || [];

    const COMPLAINT_LABELS = {
      acoso: 'Acoso',
      seguridad: 'Seguridad',
      condiciones_trabajo: 'Condiciones de trabajo',
      trato_injusto: 'Trato injusto',
      otro: 'Otro'
    };

    const STATUS_LABELS = {
      new: { label: 'Nueva', cls: 'pill pendiente' },
      reviewed: { label: 'En revisión', cls: 'pill active' },
      closed: { label: 'Cerrada', cls: 'pill gray' }
    };

    const rows = complaints.map(c => {
      const statusInfo = STATUS_LABELS[c.status] || { label: c.status, cls: 'pill gray' };
      return `
        <tr>
          <td>${fmtDateDisplay(c.date)}</td>
          <td><span class="badge">${COMPLAINT_LABELS[c.category] || c.category}</span></td>
          <td style="max-width:300px;font-size:13px;">${c.description}</td>
          <td><span class="${statusInfo.cls}">${statusInfo.label}</span></td>
          <td style="max-width:200px;font-size:12px;color:var(--muted);">${c.response || '—'}</td>
          <td>
            <button class="btn-ghost" style="font-size:12px;" onclick="responderQueja(${c.id},'${c.status}')">💬 Responder</button>
          </td>
        </tr>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>📢 Quejas Anónimas</h2>
        <span class="badge">${complaints.filter(c => c.status === 'new').length} nuevas</span>
      </div>

      <div class="card section table-wrap">
        ${complaints.length === 0
          ? '<div class="empty-state"><div class="empty-icon">📢</div><p>No hay quejas registradas</p></div>'
          : `<table>
               <thead><tr>
                 <th>Fecha</th><th>Categoría</th><th>Descripción</th>
                 <th>Estado</th><th>Respuesta</th><th>Acciones</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>
      <div id="queja-resp-container"></div>
    `;

    el.innerHTML = shell(content, 'quejas-rh');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'quejas-rh');
  }
}

function responderQueja(id, currentStatus) {
  const container = document.getElementById('queja-resp-container');
  if (!container) return;

  container.innerHTML = `
    <div class="card section" style="margin-top:12px;max-width:600px;">
      <h4>Responder queja #${id}</h4>
      <div style="margin-bottom:12px;">
        <label>Cambiar estado</label>
        <select id="qr-status">
          <option value="new" ${currentStatus==='new'?'selected':''}>Nueva</option>
          <option value="reviewed" ${currentStatus==='reviewed'?'selected':''}>En revisión</option>
          <option value="closed" ${currentStatus==='closed'?'selected':''}>Cerrada</option>
        </select>
      </div>
      <div>
        <label>Respuesta / Notas internas</label>
        <textarea id="qr-resp" rows="3" placeholder="Escribe una respuesta o nota interna..."></textarea>
      </div>
      <div style="margin-top:12px;">
        <button class="btn-primary" onclick="saveRespQueja(${id})">💾 Guardar</button>
        <button class="btn-ghost" onclick="document.getElementById('queja-resp-container').innerHTML=''">Cancelar</button>
      </div>
    </div>
  `;
}

async function saveRespQueja(id) {
  const status = document.getElementById('qr-status')?.value;
  const response = document.getElementById('qr-resp')?.value?.trim() || null;
  try {
    await api(`/api/rhh/incidences/complaints/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, response })
    });
    toast('Queja actualizada');
    quejasRHView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ACLARACIÓN DE NÓMINA
// ══════════════════════════════════════════════════════════════════════════════

const CLARIFICATION_REASONS = {
  falta_mal_registrada: 'Falta mal registrada',
  te_no_pagado: 'T.E. no pagado',
  descuento_incorrecto: 'Descuento incorrecto',
  bono_no_aplicado: 'Bono no aplicado',
  otro: 'Otro'
};

const CLARIFICATION_STATUS = {
  open: { label: 'Abierta', cls: 'pill pendiente' },
  in_review: { label: 'En revisión', cls: 'pill active' },
  resolved: { label: 'Resuelta', cls: 'pill aprobada' }
};

async function aclaracionNominaView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando aclaraciones...</div>', 'aclaracion-nomina');

  try {
    const clarifications = await api('/api/rhh/incidences/payroll-clarifications') || [];

    const reasonOpts = Object.entries(CLARIFICATION_REASONS).map(([v, l]) =>
      `<option value="${v}">${l}</option>`
    ).join('');

    // Generar opciones de períodos (últimos 12 meses)
    const periodOpts = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const lbl = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      periodOpts.push(`<option value="${val}">${lbl}</option>`);
    }

    const rows = clarifications.map(c => {
      const statusInfo = CLARIFICATION_STATUS[c.status] || { label: c.status, cls: 'pill gray' };
      return `
        <tr>
          <td>${c.period}</td>
          <td><span class="badge">${CLARIFICATION_REASONS[c.reason] || c.reason}</span></td>
          <td style="max-width:250px;font-size:13px;">${c.description}</td>
          <td><span class="${statusInfo.cls}">${statusInfo.label}</span></td>
          <td style="font-size:12px;color:var(--muted);">${c.response || '—'}</td>
          <td>${fmtDateDisplay(c.created_at?.slice(0,10))}</td>
        </tr>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>💬 Aclaración de Nómina</h2>
      </div>

      <div class="card section" style="margin-bottom:16px;">
        <h3>Nueva aclaración</h3>
        <div class="row">
          <div>
            <label>Período *</label>
            <select id="acl-period">${periodOpts.join('')}</select>
          </div>
          <div>
            <label>Motivo *</label>
            <select id="acl-reason">${reasonOpts}</select>
          </div>
        </div>
        <div style="margin-top:12px;">
          <label>Descripción *</label>
          <textarea id="acl-desc" rows="3" placeholder="Describe el problema o discrepancia que encontraste..."></textarea>
        </div>
        <div style="margin-top:12px;">
          <label>Archivo adjunto (opcional, máx. 5MB)</label>
          <input type="file" id="acl-file" accept=".pdf,.jpg,.jpeg,.png" onchange="previewAclFile(this)" />
          <div id="acl-file-info" class="small muted" style="margin-top:4px;"></div>
        </div>
        <div style="margin-top:14px;">
          <button class="btn-primary" onclick="submitAclaracion()">📤 Enviar aclaración</button>
        </div>
      </div>

      <div class="card section">
        <h3>Mis aclaraciones</h3>
        ${clarifications.length === 0
          ? '<div class="empty-state"><div class="empty-icon">💬</div><p>No has enviado aclaraciones aún</p></div>'
          : `<table>
               <thead><tr>
                 <th>Período</th><th>Motivo</th><th>Descripción</th>
                 <th>Estado</th><th>Respuesta</th><th>Enviada</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>
    `;

    el.innerHTML = shell(content, 'aclaracion-nomina');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'aclaracion-nomina');
  }
}

function previewAclFile(input) {
  const info = document.getElementById('acl-file-info');
  if (!info) return;
  const file = input.files?.[0];
  if (!file) { info.textContent = ''; return; }
  const mb = (file.size / 1024 / 1024).toFixed(2);
  if (file.size > 5 * 1024 * 1024) {
    info.textContent = `⚠️ Archivo demasiado grande (${mb} MB). El límite es 5 MB.`;
    info.style.color = '#b91c1c';
    input.value = '';
    return;
  }
  info.textContent = `✅ ${file.name} (${mb} MB)`;
  info.style.color = '#059669';
}

async function submitAclaracion() {
  const period = document.getElementById('acl-period')?.value;
  const reason = document.getElementById('acl-reason')?.value;
  const description = document.getElementById('acl-desc')?.value?.trim();
  const fileInput = document.getElementById('acl-file');
  const file = fileInput?.files?.[0] || null;

  if (!period || !reason || !description) {
    toast('Período, motivo y descripción son requeridos', 'warning');
    return;
  }

  let attachment_data = null;
  if (file) {
    if (file.size > 5 * 1024 * 1024) { toast('El archivo supera el límite de 5 MB', 'error'); return; }
    attachment_data = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  try {
    await api('/api/rhh/incidences/payroll-clarifications', {
      method: 'POST',
      body: JSON.stringify({ period, reason, description, attachment_data })
    });
    toast('Aclaración enviada. RH la revisará pronto.');
    aclaracionNominaView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Vista de aclaraciones para RH/Admin ───────────────────────────────────────
async function aclaracionesRHView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando aclaraciones...</div>', 'aclaraciones-rh');

  try {
    const clarifications = await api('/api/rhh/incidences/payroll-clarifications') || [];

    const rows = clarifications.map(c => {
      const statusInfo = CLARIFICATION_STATUS[c.status] || { label: c.status, cls: 'pill gray' };
      return `
        <tr>
          <td><strong>${c.employee?.full_name || '—'}</strong><br><span class="small muted">${c.employee?.employee_number || ''}</span></td>
          <td>${c.period}</td>
          <td><span class="badge">${CLARIFICATION_REASONS[c.reason] || c.reason}</span></td>
          <td style="max-width:220px;font-size:13px;">${c.description}</td>
          <td><span class="${statusInfo.cls}">${statusInfo.label}</span></td>
          <td style="font-size:12px;color:var(--muted);">${c.response || '—'}</td>
          <td>
            <button class="btn-ghost" style="font-size:12px;" onclick="responderAclaracion(${c.id},'${c.status}')">💬 Responder</button>
          </td>
        </tr>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>💬 Aclaraciones de Nómina</h2>
        <span class="badge">${clarifications.filter(c => c.status === 'open').length} abiertas</span>
      </div>

      <div class="card section table-wrap">
        ${clarifications.length === 0
          ? '<div class="empty-state"><div class="empty-icon">💬</div><p>No hay aclaraciones registradas</p></div>'
          : `<table>
               <thead><tr>
                 <th>Empleado</th><th>Período</th><th>Motivo</th>
                 <th>Descripción</th><th>Estado</th><th>Respuesta</th><th>Acciones</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>
      <div id="acl-resp-container"></div>
    `;

    el.innerHTML = shell(content, 'aclaraciones-rh');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'aclaraciones-rh');
  }
}

function responderAclaracion(id, currentStatus) {
  const container = document.getElementById('acl-resp-container');
  if (!container) return;

  container.innerHTML = `
    <div class="card section" style="margin-top:12px;max-width:600px;">
      <h4>Responder aclaración #${id}</h4>
      <div style="margin-bottom:12px;">
        <label>Cambiar estado</label>
        <select id="ar-status">
          <option value="open" ${currentStatus==='open'?'selected':''}>Abierta</option>
          <option value="in_review" ${currentStatus==='in_review'?'selected':''}>En revisión</option>
          <option value="resolved" ${currentStatus==='resolved'?'selected':''}>Resuelta</option>
        </select>
      </div>
      <div>
        <label>Respuesta</label>
        <textarea id="ar-resp" rows="3" placeholder="Escribe la respuesta para el empleado..."></textarea>
      </div>
      <div style="margin-top:12px;">
        <button class="btn-primary" onclick="saveRespAclaracion(${id})">💾 Guardar</button>
        <button class="btn-ghost" onclick="document.getElementById('acl-resp-container').innerHTML=''">Cancelar</button>
      </div>
    </div>
  `;
}

async function saveRespAclaracion(id) {
  const status = document.getElementById('ar-status')?.value;
  const response = document.getElementById('ar-resp')?.value?.trim() || null;
  try {
    await api(`/api/rhh/incidences/payroll-clarifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, response })
    });
    toast('Aclaración actualizada');
    aclaracionesRHView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VACANTES
// ══════════════════════════════════════════════════════════════════════════════

let vacantesShowForm = false;

async function vacantesView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando vacantes...</div>', 'vacantes');

  try {
    const [vacantes, stats] = await Promise.all([
      api('/api/rhh/vacancies'),
      api('/api/rhh/vacancies/stats')
    ]);
    if (!vacantes) return;

    const REASON_LABEL = {
      baja_voluntaria: 'Baja voluntaria',
      baja_involuntaria: 'Baja involuntaria',
      expansion: 'Expansión',
      nuevo_puesto: 'Nuevo puesto'
    };
    const PRIORITY_STYLE = {
      alta: 'background:#fee2e2;color:#991b1b;',
      media: 'background:#fef3c7;color:#92400e;',
      baja: 'background:#dbeafe;color:#1e40af;'
    };
    const STATUS_LABEL = {
      open: 'Abierta', in_process: 'En proceso', filled: 'Cubierta', cancelled: 'Cancelada'
    };

    const posOpts = state.positions.map(p =>
      `<option value="${p.id}">${p.name}</option>`).join('');
    const deptOpts = state.departments.map(d =>
      `<option value="${d.id}">${d.name}</option>`).join('');
    const shiftOpts = state.shifts.map(s =>
      `<option value="${s.id}">${s.name}</option>`).join('');

    // Agrupar por estado para el layout en cards
    const vacByStatus = {
      open:       vacantes.filter(v => v.status === 'open'),
      in_process: vacantes.filter(v => v.status === 'in_process'),
      filled:     vacantes.filter(v => v.status === 'filled'),
      cancelled:  vacantes.filter(v => v.status === 'cancelled'),
    };

    function vacCard(v) {
      const priStyle = PRIORITY_STYLE[v.priority] || 'background:#f3f4f6;color:#374151;';
      const borderColor = v.priority === 'alta' ? '#b91c1c' : v.priority === 'media' ? '#b45309' : '#3b82f6';
      return `
        <div style="background:#fff;border:1px solid #e5e7eb;border-left:4px solid ${borderColor};border-radius:8px;padding:14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:14px;">${escHtml(v.position?.name || '—')}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px;">
                ${escHtml(v.department?.name || '—')}
                ${v.shift?.name ? ` · ${escHtml(v.shift.name)}` : ''}
              </div>
            </div>
            <span style="flex-shrink:0;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;${priStyle}">${v.priority || '—'}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:11px;background:#f3f4f6;padding:2px 8px;border-radius:6px;">${REASON_LABEL[v.reason] || v.reason}</span>
            <span style="font-size:11px;color:#9ca3af;">📅 ${fmtDateDisplay(v.opened_date)}</span>
            ${v.notes ? `<span style="font-size:11px;color:#6b7280;font-style:italic;">"${escHtml(v.notes)}"</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;">
            ${v.status === 'open' ? `<button class="btn-ghost" style="font-size:11px;" onclick="updateVacancy(${v.id},'in_process')">▶ En proceso</button>` : ''}
            ${v.status === 'in_process' ? `<button class="btn-primary" style="font-size:11px;padding:4px 10px;" onclick="updateVacancy(${v.id},'filled')">✅ Cubierta</button>` : ''}
            ${['open','in_process'].includes(v.status) ? `<button class="btn-ghost" style="font-size:11px;color:#b91c1c;" onclick="updateVacancy(${v.id},'cancelled')">✕ Cancelar</button>` : ''}
          </div>
        </div>`;
    }

    const formHtml = vacantesShowForm ? `
      <div class="card section" style="margin-bottom:16px;">
        <h3>Nueva vacante</h3>
        <div class="row">
          <div><label>Puesto *</label><select id="vac-pos"><option value="">Seleccionar...</option>${posOpts}</select></div>
          <div><label>Departamento *</label><select id="vac-dept"><option value="">Seleccionar...</option>${deptOpts}</select></div>
        </div>
        <div class="row">
          <div><label>Turno</label><select id="vac-shift"><option value="">Sin turno</option>${shiftOpts}</select></div>
          <div><label>Prioridad</label>
            <select id="vac-priority">
              <option value="alta">Alta</option>
              <option value="media" selected>Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div><label>Motivo</label>
            <select id="vac-reason">
              <option value="nuevo_puesto">Nuevo puesto</option>
              <option value="expansion">Expansión</option>
              <option value="baja_voluntaria">Baja voluntaria</option>
              <option value="baja_involuntaria">Baja involuntaria</option>
            </select>
          </div>
          <div><label>Notas</label><input id="vac-notes" placeholder="Observaciones..." /></div>
        </div>
        <div class="actions" style="margin-top:12px;">
          <button class="btn-primary" onclick="saveVacancy()">💾 Guardar</button>
          <button class="btn-ghost" onclick="vacantesShowForm=false;vacantesView()">Cancelar</button>
        </div>
      </div>` : '';

    const content = `
      <div class="module-title">
        <h2>🔍 Gestión de Vacantes</h2>
        <button class="btn-primary" onclick="vacantesShowForm=!vacantesShowForm;vacantesView()">+ Nueva vacante</button>
      </div>

      <div class="grid grid-3" style="margin-bottom:20px;">
        <div class="card kpi kpi-rhh">
          <div class="muted small">Vacantes abiertas</div>
          <div class="n" style="color:#b91c1c;">${stats?.open ?? 0}</div>
        </div>
        <div class="card kpi kpi-rhh">
          <div class="muted small">En proceso</div>
          <div class="n" style="color:#b45309;">${stats?.in_process ?? 0}</div>
        </div>
        <div class="card kpi kpi-rhh">
          <div class="muted small">Cubiertas este mes</div>
          <div class="n" style="color:#059669;">${stats?.filled_this_month ?? 0}</div>
        </div>
      </div>

      ${formHtml}

      ${vacantes.length === 0
        ? '<div class="card section"><div class="empty-state"><div class="empty-icon">🔍</div><p>No hay vacantes registradas</p></div></div>'
        : `<div class="grid grid-2" style="align-items:start;">
             <div>
               ${vacByStatus.open.length > 0 ? `
                 <div class="card section" style="margin-bottom:16px;">
                   <h3 style="margin-top:0;color:#b91c1c;">🔴 Abiertas (${vacByStatus.open.length})</h3>
                   ${vacByStatus.open.map(vacCard).join('')}
                 </div>` : ''}
               ${vacByStatus.in_process.length > 0 ? `
                 <div class="card section">
                   <h3 style="margin-top:0;color:#b45309;">🟡 En proceso (${vacByStatus.in_process.length})</h3>
                   ${vacByStatus.in_process.map(vacCard).join('')}
                 </div>` : ''}
             </div>
             <div>
               ${vacByStatus.filled.length > 0 ? `
                 <div class="card section" style="margin-bottom:16px;">
                   <h3 style="margin-top:0;color:#059669;">✅ Cubiertas recientes (${vacByStatus.filled.length})</h3>
                   ${vacByStatus.filled.slice(0,5).map(vacCard).join('')}
                 </div>` : ''}
               ${vacByStatus.cancelled.length > 0 ? `
                 <div class="card section">
                   <h3 style="margin-top:0;color:#9ca3af;">✕ Canceladas (${vacByStatus.cancelled.length})</h3>
                   ${vacByStatus.cancelled.slice(0,5).map(vacCard).join('')}
                 </div>` : ''}
             </div>
           </div>`
      }
    `;

    el.innerHTML = shell(content, 'vacantes');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'vacantes');
  }
}

async function saveVacancy() {
  const position_id = document.getElementById('vac-pos')?.value;
  const department_id = document.getElementById('vac-dept')?.value;
  const shift_id = document.getElementById('vac-shift')?.value || null;
  const priority = document.getElementById('vac-priority')?.value;
  const reason = document.getElementById('vac-reason')?.value;
  const notes = document.getElementById('vac-notes')?.value?.trim() || '';

  if (!position_id || !department_id) {
    toast('Puesto y departamento son requeridos', 'warning');
    return;
  }

  try {
    await api('/api/rhh/vacancies', {
      method: 'POST',
      body: JSON.stringify({ position_id, department_id, shift_id, priority, reason, notes })
    });
    toast('Vacante creada');
    vacantesShowForm = false;
    vacantesView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function updateVacancy(id, status) {
  try {
    await api(`/api/rhh/vacancies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    const msgs = { in_process: 'Vacante marcada en proceso', filled: 'Vacante cubierta', cancelled: 'Vacante cancelada' };
    toast(msgs[status] || 'Vacante actualizada');
    vacantesView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HISTORIAL DEL EMPLEADO
// ══════════════════════════════════════════════════════════════════════════════

let historialFilter = { type: '', month: '', year: '' };

async function historialEmpleadoView(employeeId) {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando historial...</div>', 'empleados');

  try {
    const result = await api(`/api/rhh/employees/${employeeId}/timeline`);
    if (!result) return;

    const { employee: emp, events, stats } = result;

    // Aplicar filtros
    let filtered = events || [];
    if (historialFilter.type) filtered = filtered.filter(e => e.event_type === historialFilter.type);
    if (historialFilter.month) filtered = filtered.filter(e => {
      const d = e.date || e.created_at?.slice(0, 10) || '';
      return d.startsWith(`${historialFilter.year || new Date().getFullYear()}-${historialFilter.month.padStart(2, '0')}`);
    });

    const initials = (emp.full_name || 'EMP').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const TYPE_LABEL = {
      falta: 'Falta', vacacion: 'Vacación', incapacidad: 'Incapacidad',
      tiempo_extra: 'Tiempo extra', permiso: 'Permiso', asignacion: 'Asignación'
    };

    const monthOpts = Array.from({length:12}, (_, i) =>
      `<option value="${String(i+1).padStart(2,'0')}" ${historialFilter.month===String(i+1).padStart(2,'0')?'selected':''}>${MONTHS[i]}</option>`
    ).join('');

    const typeOpts = Object.entries(TYPE_LABEL).map(([v, l]) =>
      `<option value="${v}" ${historialFilter.type===v?'selected':''}>${l}</option>`
    ).join('');

    const yearNow = new Date().getFullYear();
    const yearOpts = [yearNow, yearNow-1, yearNow-2].map(y =>
      `<option value="${y}" ${(historialFilter.year||String(yearNow))===String(y)?'selected':''}>${y}</option>`
    ).join('');

    const timelineHtml = filtered.length === 0
      ? '<div class="empty-state"><div class="empty-icon">📋</div><p>Sin eventos para los filtros seleccionados</p></div>'
      : filtered.map(ev => {
          const dateStr = ev.date || ev.created_at?.slice(0, 10) || '';
          const desc = ev.notes || ev.type || '';
          return `
            <div style="display:flex;gap:12px;margin-bottom:12px;">
              <div style="width:4px;background:${ev.color || '#64748b'};border-radius:2px;flex-shrink:0;"></div>
              <div style="flex:1;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;border-left:3px solid ${ev.color || '#64748b'};">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <span style="font-size:18px;">${ev.icon || '📌'}</span>
                  <strong style="font-size:14px;">${TYPE_LABEL[ev.event_type] || ev.event_type || '—'}</strong>
                  <span class="small muted" style="margin-left:auto;">${fmtDateDisplay(dateStr)}</span>
                </div>
                ${desc ? `<div style="font-size:13px;color:var(--muted);">${desc}</div>` : ''}
                ${ev.hours ? `<div style="font-size:12px;color:#059669;margin-top:2px;">⏱️ ${ev.hours}h extra</div>` : ''}
              </div>
            </div>`;
        }).join('');

    // CSV export
    const csvData = filtered.map(ev => {
      const dateStr = ev.date || ev.created_at?.slice(0, 10) || '';
      return `"${TYPE_LABEL[ev.event_type] || ev.event_type}","${dateStr}","${ev.notes || ''}"`;
    });

    const content = `
      <div class="module-title">
        <h2>📋 Historial del empleado</h2>
        <button class="btn-ghost" onclick="historialFilter={type:'',month:'',year:''};empTab='list';empleadosView()">← Volver</button>
      </div>

      <div class="card section" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <div style="width:52px;height:52px;border-radius:50%;background:#064e3b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex-shrink:0;">${initials}</div>
          <div>
            <div style="font-size:18px;font-weight:700;">${emp.full_name}</div>
            <div class="small muted">${emp.employee_number} — ${emp.position?.name || '—'}</div>
          </div>
        </div>
        <div class="grid grid-4" style="margin-top:16px;">
          <div class="card kpi kpi-rhh" style="padding:12px;">
            <div class="muted small">Días asignados</div>
            <div class="n" style="font-size:24px;">${stats?.total_days ?? 0}</div>
          </div>
          <div class="card kpi kpi-rhh" style="padding:12px;">
            <div class="muted small">Faltas</div>
            <div class="n" style="font-size:24px;color:#dc2626;">${stats?.faltas ?? 0}</div>
          </div>
          <div class="card kpi kpi-rhh" style="padding:12px;">
            <div class="muted small">Vacaciones</div>
            <div class="n" style="font-size:24px;color:#2563eb;">${stats?.vacaciones ?? 0}</div>
          </div>
          <div class="card kpi kpi-rhh" style="padding:12px;">
            <div class="muted small">Hrs. extra</div>
            <div class="n" style="font-size:24px;color:#16a34a;">${stats?.overtime ?? 0}h</div>
          </div>
        </div>
      </div>

      <div class="filter-bar" style="margin-bottom:16px;">
        <div>
          <label>Tipo de evento</label>
          <select onchange="historialFilter.type=this.value;historialEmpleadoView(${employeeId})">
            <option value="">Todos</option>${typeOpts}
          </select>
        </div>
        <div>
          <label>Mes</label>
          <select onchange="historialFilter.month=this.value;historialEmpleadoView(${employeeId})">
            <option value="">Todos</option>${monthOpts}
          </select>
        </div>
        <div>
          <label>Año</label>
          <select onchange="historialFilter.year=this.value;historialEmpleadoView(${employeeId})">
            ${yearOpts}
          </select>
        </div>
        <div style="align-self:flex-end;">
          <button class="btn-ghost" onclick="exportHistorialCSV(${employeeId})">📥 Exportar CSV</button>
        </div>
      </div>

      <div class="card section" style="padding:16px;">
        ${timelineHtml}
      </div>
    `;

    el.innerHTML = shell(content, 'empleados');
    // Guardar datos filtrados para exportar
    window._historialFiltered = filtered.map(ev => ({
      tipo: TYPE_LABEL[ev.event_type] || ev.event_type,
      fecha: ev.date || ev.created_at?.slice(0, 10) || '',
      notas: ev.notes || ''
    }));
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'empleados');
  }
}

function exportHistorialCSV(employeeId) {
  const data = window._historialFiltered || [];
  if (!data.length) { toast('No hay datos para exportar', 'warning'); return; }
  const csv = ['Tipo,Fecha,Notas', ...data.map(r => `"${r.tipo}","${r.fecha}","${r.notas}"`)].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `historial_empleado_${employeeId}.csv`;
  a.click();
}

// ══════════════════════════════════════════════════════════════════════════════
// EVALUACIONES
// ══════════════════════════════════════════════════════════════════════════════

let evalTab = 'sesion';
let evalSessionId = null;

// ══════════════════════════════════════════════════════════════════════════════
// EVALUACIONES — Vista RH/Admin
// ══════════════════════════════════════════════════════════════════════════════

async function evaluacionesView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando evaluaciones...</div>', 'evaluaciones');

  try {
    // Refrescar empleados y puestos para mostrar datos actualizados
    await loadCatalogs();

    const [sessions, forms] = await Promise.all([
      api('/api/rhh/evaluations/sessions'),
      api('/api/rhh/evaluations/forms')
    ]);
    if (!evalSessionId && sessions.length > 0) evalSessionId = sessions[sessions.length - 1].id;
    window._evalForms = forms || [];

    let tabContent;
    if (evalTab === 'sesion')       tabContent = await buildEvalSessionTab(sessions || [], forms || []);
    else if (evalTab === 'asignar') tabContent = await buildEvalAsignarTab(sessions || [], forms || []);
    else if (evalTab === 'progreso') tabContent = await buildEvalProgresoTab(sessions || []);
    else                             tabContent = await buildEvalFormsTab(forms || []);

    const content = `
      <div class="module-title"><h2>⭐ Evaluaciones de Desempeño</h2></div>
      <div class="tabs">
        <button class="tab-btn ${evalTab==='sesion'?'active':''}" onclick="evalTab='sesion';evaluacionesView()">📋 Sesiones</button>
        <button class="tab-btn ${evalTab==='asignar'?'active':''}" onclick="evalTab='asignar';evaluacionesView()">👥 Asignar</button>
        <button class="tab-btn ${evalTab==='progreso'?'active':''}" onclick="evalTab='progreso';evaluacionesView()">📊 Progreso</button>
        <button class="tab-btn ${evalTab==='formularios'?'active':''}" onclick="evalTab='formularios';evaluacionesView()">📄 Formularios</button>
      </div>
      ${tabContent}`;
    el.innerHTML = shell(content, 'evaluaciones');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'evaluaciones');
  }
}

// Parsea fecha de ingreso en múltiples formatos → Date o null
function parseFechaIngreso(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0, 10) + 'T12:00:00');
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split('/');
    return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T12:00:00`);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

async function buildEvalSessionTab(sessions, forms) {
  const sessionOpts = sessions.map(s =>
    `<option value="${s.id}" ${s.id===evalSessionId?'selected':''}>${escHtml(s.name)} (${s.status==='open'?'Abierta':'Cerrada'})</option>`
  ).join('');
  let session = null;
  if (evalSessionId) {
    try { session = await api(`/api/rhh/evaluations/sessions/${evalSessionId}`); } catch(e) {}
  }
  const supervisorUsers = (state.rhhUsers || []).filter(u => u.role === 'supervisor');
  const supOptsBase = '<option value="">— Sin asignar —</option>' +
    supervisorUsers.map(u => `<option value="${u.id}">${escHtml(u.full_name)}</option>`).join('');
  let entriesHtml = '<div class="card section"><div class="empty-state"><p>Selecciona o crea una sesión</p></div></div>';
  if (session) {
    // Filtrar empleados: activos Y con fecha ingreso ANTES del primer día del mes a evaluar
    const firstDayOfMonth = session.year && session.month
      ? new Date(session.year, session.month - 1, 1)
      : null;

    const allActive = state.employees.filter(e => e.status === 'active');
    const employees = firstDayOfMonth
      ? allActive.filter(e => {
          const fi = parseFechaIngreso(e.fecha_ingreso || e.start_date);
          if (!fi) return true; // sin fecha → incluir
          return fi < firstDayOfMonth;
        })
      : allActive;
    const excluidos = allActive.length - employees.length;
    const excluidosMsg = excluidos > 0
      ? `<div style="font-size:12px;color:#b45309;margin-bottom:8px;">⚠ ${excluidos} empleado${excluidos>1?'s':''} excluido${excluidos>1?'s':''} por ingreso durante el mes (no laboraron mes completo)</div>`
      : '';

    const entryRows = employees.map(emp => {
      const entry = (session.entries || []).find(e => e.employee_id === emp.id);
      const pos = state.positions.find(p => p.id === emp.position_id);
      const isSaved = entry && entry.saved;
      const supOpts = supOptsBase.replace(`value="${entry && entry.evaluador_id}"`, `value="${entry && entry.evaluador_id}" selected`);
      const evalSel = `<select id="ev-eval-${emp.id}" style="font-size:12px;padding:3px 6px;min-width:120px;"${isSaved?' disabled':''}>${supOpts}</select>`;
      const numField = (field, val) => {
        const hasVal = val !== null && val !== undefined;
        return `<input type="number" id="ev-${field}-${emp.id}" min="0" value="${hasVal?val:''}" placeholder="—" style="width:55px;font-size:12px;padding:3px 5px;text-align:center;${isSaved?'background:#f0fdf4;':''}" ${isSaved?'disabled':''}>`;
      };
      return `<tr id="ev-row-${emp.id}" style="${isSaved?'background:#f0fdf4;':''}">
        <td style="font-size:13px;font-weight:600">${escHtml(emp.full_name)}</td>
        <td style="font-size:12px;color:#6b7280">${escHtml(pos?pos.name:'—')}</td>
        <td>${evalSel}</td>
        <td style="text-align:center">${numField('asis', entry?entry.asistencias:undefined)}</td>
        <td style="text-align:center">${numField('falt', entry?entry.faltas:undefined)}</td>
        <td style="text-align:center">${numField('ret', entry?entry.retardos:undefined)}</td>
        <td style="text-align:center">${numField('acta', entry?entry.actas:undefined)}</td>
        <td style="text-align:center">${numField('amon', entry?entry.amonestaciones:undefined)}</td>
        <td style="white-space:nowrap">
          <button class="btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="evalRellenar(${evalSessionId},${emp.id})" title="Datos del sistema">🔄 Rellenar</button>
          ${!isSaved
            ? `<button class="btn-primary" style="font-size:11px;padding:3px 8px;" onclick="evalGuardarFila(${evalSessionId},${emp.id})">💾 Guardar</button>`
            : `<button class="btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="evalEditarFila(${emp.id})">✏️ Editar</button>`}
        </td>
      </tr>`;
    }).join('');
    const savedCount = (session.entries || []).filter(e => e.saved).length;
    entriesHtml = `
      ${excluidosMsg}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="small muted">Progreso: <strong>${savedCount}/${employees.length}</strong> empleados guardados</div>
        ${session.status==='open'
          ? `<button class="btn-ghost" style="font-size:12px;" onclick="cerrarSesion(${session.id})">🔒 Cerrar sesión</button>`
          : '<span class="badge" style="background:#059669;">✓ Cerrada</span>'}
      </div>
      <div class="card section table-wrap">
        <table><thead><tr>
          <th>Trabajador</th><th>Puesto</th><th>Evaluador</th>
          <th style="text-align:center">Asistencias</th><th style="text-align:center">Faltas</th>
          <th style="text-align:center">Retardos</th><th style="text-align:center">Actas Adm.</th>
          <th style="text-align:center">Amonest.</th><th>Acciones</th>
        </tr></thead>
        <tbody>${entryRows}</tbody>
        </table>
      </div>`;
  }
  return `
    <div class="card section" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="font-weight:600;">Sesión:</label>
        ${sessions.length>0
          ? `<select style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;font-size:14px;" onchange="evalSessionId=Number(this.value);evalTab='sesion';evaluacionesView()"><option value="">Seleccionar...</option>${sessionOpts}</select>`
          : '<span class="small muted">Sin sesiones aún</span>'}
        <button class="btn-primary" style="font-size:13px;" onclick="openNuevaSesionModal()">+ Nueva sesión</button>
        ${evalSessionId ? `
          <button class="btn-ghost" style="font-size:12px;color:#b45309;" onclick="evalResetSesion(${evalSessionId})" title="Vacía los datos capturados y reabre la sesión">🔄 Vaciar y reabrir</button>
          <button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="evalBorrarSesion(${evalSessionId})" title="Borra esta sesión permanentemente">🗑 Borrar sesión</button>
        ` : ''}
      </div>
    </div>
    ${entriesHtml}`;
}

async function buildEvalFormsTab(forms) {
  if (!window._evalFormGroupName && forms[0]) window._evalFormGroupName = forms[0].group_name;
  const selGroup = window._evalFormGroupName;
  const POND_COLOR = { 3: '#dc2626', 2: '#f59e0b', 1: '#6b7280' };
  let formHtml = '';
  if (selGroup) {
    const form = forms.find(f => f.group_name === selGroup);
    window._evalFormItems = (form && form.items || []).map(i => Object.assign({}, i));
    window._evalFormId = form ? form.id : null;
    const items = window._evalFormItems;
    const totalPts = items.reduce((s, i) => s + (i.ponderacion || 0), 0);
    const itemRows = items.map((it, idx) => `
      <tr>
        <td style="font-size:13px">${escHtml(it.name)}</td>
        <td style="text-align:center">
          <select onchange="window._evalFormItems[${idx}].ponderacion=Number(this.value)" style="font-size:12px;padding:3px;">
            <option value="3" ${it.ponderacion===3?'selected':''}>3 — Muy Alta</option>
            <option value="2" ${it.ponderacion===2?'selected':''}>2 — Media</option>
            <option value="1" ${it.ponderacion===1?'selected':''}>1 — Muy Baja</option>
          </select>
        </td>
        <td style="text-align:center;font-weight:700;color:${POND_COLOR[it.ponderacion]||'#6b7280'}">${it.ponderacion||0}</td>
        <td><button class="btn-ghost" style="font-size:11px;color:#b91c1c;" onclick="evalDeleteItem(${idx})">✕</button></td>
      </tr>`).join('');
    formHtml = `
      <div class="card section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h4 style="margin:0">Ítems — Puntaje máx: <strong style="color:#2563eb">${totalPts} pts</strong></h4>
          <div style="display:flex;gap:8px;">
            <button class="btn-ghost" style="font-size:13px;" onclick="evalAddItem()">+ Agregar ítem</button>
            <button class="btn-primary" style="font-size:13px;" onclick="evalSaveForm(${form?form.id:0})">💾 Guardar formulario</button>
          </div>
        </div>
        ${items.length===0
          ? '<div class="empty-state"><p>Sin ítems. Carga las plantillas 2026 o agrega manualmente.</p></div>'
          : `<table><thead><tr><th>Ítem</th><th style="text-align:center">Ponderación</th><th style="text-align:center">Pts</th><th></th></tr></thead>
              <tbody id="eval-items-tbody">${itemRows}</tbody>
              <tfoot><tr style="background:#eff6ff;font-weight:700;"><td colspan="2">TOTAL (puntos máximos)</td><td style="text-align:center;color:#2563eb">${totalPts}</td><td></td></tr></tfoot>
             </table>`}
      </div>`;
  }
  return `
    <div class="card section" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="font-weight:600;">Grupo / Puesto:</label>
        ${forms.length>0
          ? `<select style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;font-size:14px;" onchange="window._evalFormGroupName=this.value;evalTab='formularios';evaluacionesView()">
              ${forms.map(f => `<option value="${escHtml(f.group_name)}" ${f.group_name===selGroup?'selected':''}>${escHtml(f.group_name)} (${(f.items||[]).length} ítems)</option>`).join('')}
             </select>`
          : '<span class="small muted">Sin formularios. Carga las plantillas primero.</span>'}
        <button class="btn-ghost" style="font-size:13px;" onclick="evalCargarPlantillas2026()">📋 Cargar Plantillas 2026</button>
        <button class="btn-ghost" style="font-size:13px;color:#0369a1;" onclick="evalSyncPuestos()" title="Actualiza la asignación de formularios según los puestos del catálogo">🔗 Sincronizar puestos</button>
      </div>
    </div>
    ${formHtml}`;
}

// ── Tab: Asignar evaluadores ──────────────────────────────────────────────────
async function buildEvalAsignarTab(sessions, forms) {
  const selId = evalSessionId;
  const sessionOpts = sessions.map(s =>
    `<option value="${s.id}" ${s.id===selId?'selected':''}>${escHtml(s.name)} (${s.status==='open'?'Abierta':'Cerrada'})</option>`
  ).join('');
  const sessionSelector = `
    <div class="card section" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="font-weight:600;">Sesión:</label>
        ${sessions.length>0
          ? `<select style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;font-size:14px;" onchange="evalSessionId=Number(this.value);evalTab='asignar';evaluacionesView()">
              <option value="">Seleccionar...</option>${sessionOpts}</select>`
          : '<span class="small muted">Sin sesiones. Crea una primero en la pestaña Sesiones.</span>'}
        <button class="btn-primary" style="font-size:13px;" onclick="openNuevaSesionModal()">+ Nueva sesión</button>
      </div>
    </div>`;

  if (!selId) return sessionSelector + '<div class="card section"><div class="empty-state"><p>Selecciona una sesión para asignar evaluadores</p></div></div>';

  let session = null;
  try { session = await api('/api/rhh/evaluations/sessions/' + selId); } catch(e) {}

  const employees = (state.employees || []).filter(e => e.active !== false);
  const evaluators = (state.rhhUsers || []).filter(u => u.active !== false && u.role !== 'empleado');

  // Agrupar empleados por grupo de formulario
  const empsByGroup = {};
  for (const emp of employees) {
    const form = forms.find(f => (f.position_ids||[]).includes(emp.position_id) || f.position_id === emp.position_id);
    const gName = form ? form.group_name : 'Sin formulario asignado';
    if (!empsByGroup[gName]) empsByGroup[gName] = [];
    empsByGroup[gName].push(emp);
  }

  const groupEntries = Object.entries(empsByGroup);
  const groupCheckboxes = groupEntries.map(([gName, emps], gIdx) => {
    const rows = emps.map(emp => {
      const entry = session && (session.entries||[]).find(e => e.employee_id === emp.id);
      const assignedUser = entry && entry.evaluador_id
        ? evaluators.find(u => u.id === entry.evaluador_id)
        : null;
      const assignedLabel = assignedUser ? assignedUser.full_name : (entry && entry.evaluador_id ? `ID ${entry.evaluador_id}` : null);
      return `<label class="asign-emp-item asign-g-${gIdx}" style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:5px 8px;border-radius:6px;${assignedLabel?'background:#f0fdf4;':'hover-bg:#f9fafb;'}">
        <input type="checkbox" class="asign-emp-cb" value="${emp.id}" style="cursor:pointer;flex-shrink:0;">
        <span style="flex:1">${escHtml(emp.full_name)}</span>
        ${assignedLabel ? `<span style="font-size:10px;color:#059669;white-space:nowrap;">→ ${escHtml(assignedLabel)}</span>` : ''}
      </label>`;
    }).join('');
    return `
      <div style="margin-bottom:14px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#2563eb;cursor:pointer;margin-bottom:6px;">
          <input type="checkbox" onchange="evalToggleGroup(${gIdx},this.checked)" style="cursor:pointer;">
          ${escHtml(gName)} <span style="font-weight:400;color:#9ca3af;">(${emps.length})</span>
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:2px;padding-left:18px;">
          ${rows}
        </div>
      </div>`;
  }).join('');

  const evalOpts = evaluators.map(u =>
    `<option value="${u.id}">${escHtml(u.full_name)} — ${u.role}</option>`
  ).join('');

  const assignedCount = (session && session.entries || []).filter(e => e.evaluador_id).length;

  return sessionSelector + `
    <div style="display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:start;">
      <div class="card section" style="position:sticky;top:80px;">
        <h4 style="margin:0 0 12px;">👤 Evaluador a asignar</h4>
        <select id="asign-eval-id" style="width:100%;padding:8px;border-radius:8px;border:1px solid #d1d5db;font-size:13px;margin-bottom:10px;">
          <option value="">— Seleccionar —</option>${evalOpts}
        </select>
        <button class="btn-primary" style="width:100%;margin-bottom:8px;" onclick="evalAsignar(${selId})">✅ Asignar seleccionados</button>
        <button class="btn-ghost" style="width:100%;font-size:12px;" onclick="evalSelectAll(true)">Seleccionar todos</button>
        <button class="btn-ghost" style="width:100%;font-size:12px;" onclick="evalSelectAll(false)">Deseleccionar todos</button>
        <div style="font-size:12px;color:#6b7280;margin-top:10px;text-align:center;border-top:1px solid #e5e7eb;padding-top:8px;">
          ${assignedCount} empleado(s) ya asignado(s)
        </div>
      </div>
      <div class="card section">
        <h4 style="margin:0 0 12px;">👥 Seleccionar empleados</h4>
        ${employees.length===0
          ? '<div class="empty-state"><p>Sin empleados activos</p></div>'
          : groupCheckboxes}
      </div>
    </div>`;
}

// ── Tab: Progreso por evaluador ───────────────────────────────────────────────
async function buildEvalProgresoTab(sessions) {
  const selId = evalSessionId;
  const sessionOpts = sessions.map(s =>
    `<option value="${s.id}" ${s.id===selId?'selected':''}>${escHtml(s.name)}</option>`
  ).join('');
  const sessionSelector = `
    <div class="card section" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <label style="font-weight:600;">Sesión:</label>
        ${sessions.length>0
          ? `<select style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;font-size:14px;" onchange="evalSessionId=Number(this.value);evalTab='progreso';evaluacionesView()">
              <option value="">Seleccionar...</option>${sessionOpts}</select>`
          : '<span class="small muted">Sin sesiones aún</span>'}
      </div>
    </div>`;

  if (!selId) return sessionSelector + '<div class="card section"><div class="empty-state"><p>Selecciona una sesión para ver el progreso</p></div></div>';

  try {
    const progress = await api('/api/rhh/evaluations/sessions/' + selId + '/progress') || [];
    if (progress.length === 0) {
      return sessionSelector + '<div class="card section"><div class="empty-state"><p>Sin evaluadores asignados en esta sesión</p></div></div>';
    }
    const totalAll = progress.reduce((s,g) => s+g.total, 0);
    const evalAll  = progress.reduce((s,g) => s+g.evaluated, 0);
    const pctAll   = totalAll > 0 ? Math.round(evalAll/totalAll*100) : 0;
    const colAll   = pctAll>=100?'#059669':pctAll>=50?'#f59e0b':'#2563eb';

    const cards = progress.map(g => {
      const pct   = g.total > 0 ? Math.round(g.evaluated/g.total*100) : 0;
      const color = pct>=100?'#059669':pct>=50?'#f59e0b':'#2563eb';
      const empRows = g.employees.map(e =>
        `<tr>
          <td style="font-size:12px;">${escHtml(e.employee_name)}</td>
          <td style="text-align:center;">${e.evaluated
            ? '<span class="badge" style="background:#059669;font-size:11px;">✓ Evaluado</span>'
            : '<span style="font-size:11px;color:#9ca3af;">Pendiente</span>'}</td>
        </tr>`
      ).join('');
      return `
        <div class="card section" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div>
              <div style="font-size:15px;font-weight:700;">${escHtml(g.evaluador_nombre)}</div>
              <div style="font-size:12px;color:#6b7280;">${g.evaluated} / ${g.total} evaluado(s)</div>
            </div>
            <div style="font-size:24px;font-weight:800;color:${color};">${pct}%</div>
          </div>
          <div style="height:6px;background:#e5e7eb;border-radius:3px;margin-bottom:12px;">
            <div style="height:6px;background:${color};border-radius:3px;width:${pct}%;"></div>
          </div>
          <details>
            <summary style="font-size:12px;color:#6b7280;cursor:pointer;">Ver ${g.total} empleado(s)</summary>
            <div class="table-wrap" style="margin-top:8px;">
              <table><thead><tr><th>Empleado</th><th style="text-align:center;">Estado</th></tr></thead>
              <tbody>${empRows}</tbody></table>
            </div>
          </details>
        </div>`;
    }).join('');

    return sessionSelector +
      `<div class="card section" style="margin-bottom:16px;background:#f0f9ff;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;font-size:15px;">Total general</div>
            <div style="font-size:13px;color:#6b7280;">${progress.length} evaluador(es) · ${evalAll}/${totalAll} completadas</div>
          </div>
          <div style="font-size:28px;font-weight:800;color:${colAll};">${pctAll}%</div>
        </div>
        <div style="height:8px;background:#dbeafe;border-radius:4px;margin-top:8px;">
          <div style="height:8px;background:${colAll};border-radius:4px;width:${pctAll}%;"></div>
        </div>
      </div>` +
      cards;
  } catch(err) {
    return sessionSelector + `<div class="notice error">${escHtml(err.message)}</div>`;
  }
}

function evalToggleGroup(gIdx, checked) {
  document.querySelectorAll(`.asign-g-${gIdx} .asign-emp-cb`).forEach(cb => { cb.checked = checked; });
}

function evalSelectAll(checked) {
  document.querySelectorAll('.asign-emp-cb').forEach(cb => { cb.checked = checked; });
}

async function evalAsignar(sessionId) {
  var evalId = document.getElementById('asign-eval-id')?.value;
  if (!evalId) { toast('Selecciona un evaluador', 'warning'); return; }
  var empIds = Array.from(document.querySelectorAll('.asign-emp-cb:checked')).map(cb => Number(cb.value));
  if (!empIds.length) { toast('Selecciona al menos un empleado', 'warning'); return; }
  try {
    var r = await api('/api/rhh/evaluations/sessions/'+sessionId+'/assign', {
      method: 'POST',
      body: JSON.stringify({ evaluador_id: Number(evalId), employee_ids: empIds })
    });
    toast('✅ ' + r.assigned + ' empleado(s) asignado(s)');
    evaluacionesView();
  } catch(err) { toast(err.message, 'error'); }
}

function evalAddItem() {
  if (!window._evalFormGroupName) { toast('Selecciona un grupo primero', 'warning'); return; }
  if (!window._evalFormItems) window._evalFormItems = [];
  const tbody = document.getElementById('eval-items-tbody');
  if (!tbody) { evaluacionesView(); return; }
  const idx = window._evalFormItems.length;
  window._evalFormItems.push({ id: 0, name: '', ponderacion: 2 });
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input class="eval-item-name" data-idx="${idx}" placeholder="Nombre del ítem" style="font-size:13px;padding:4px 8px;width:100%;"/></td>
    <td style="text-align:center"><select class="eval-item-pond" data-idx="${idx}" style="font-size:12px;padding:3px;">
      <option value="3">3 — Muy Alta</option>
      <option value="2" selected>2 — Media</option>
      <option value="1">1 — Muy Baja</option></select></td>
    <td style="text-align:center;color:#f59e0b;font-weight:700" id="eval-new-pts-${idx}">2</td>
    <td><button class="btn-ghost" style="font-size:11px;color:#b91c1c;" onclick="window._evalFormItems.splice(${idx},1);this.closest('tr').remove()">✕</button></td>`;
  row.querySelector('.eval-item-name').oninput = function(e) { window._evalFormItems[idx].name = e.target.value; };
  row.querySelector('.eval-item-pond').onchange = function(e) {
    window._evalFormItems[idx].ponderacion = Number(e.target.value);
    const el = document.getElementById('eval-new-pts-'+idx);
    if (el) el.textContent = e.target.value;
  };
  tbody.appendChild(row);
}

async function evalCargarPlantillas2026() {
  if (!confirm('¿Cargar las 12 plantillas de evaluación 2026? Esto reemplazará todos los formularios existentes.')) return;
  try {
    var r = await api('/api/rhh/evaluations/seed-forms', { method: 'POST' });
    toast('✅ ' + r.total + ' plantillas cargadas');
    window._evalFormGroupName = null;
    evaluacionesView();
  } catch(err) { toast(err.message, 'error'); }
}

async function evalSyncPuestos() {
  try {
    const r = await api('/api/rhh/evaluations/sync-position-names', { method: 'POST' });
    const n = (r.log || []).length;
    toast(n > 0 ? `✅ ${n} formulario${n>1?'s':''} actualizados con puestos del catálogo` : '✅ Todo ya estaba sincronizado', 'success');
    if (n > 0) evaluacionesView();
  } catch(err) { toast(err.message, 'error'); }
}

function evalDeleteItem(idx) { if (window._evalFormItems) window._evalFormItems.splice(idx, 1); evaluacionesView(); }

async function evalSaveForm(formId) {
  if (!window._evalFormGroupName) { toast('Selecciona un grupo', 'warning'); return; }
  const items = (window._evalFormItems || []).map(function(it, idx) {
    const ne = document.querySelector('.eval-item-name[data-idx="'+idx+'"]');
    const pe = document.querySelector('.eval-item-pond[data-idx="'+idx+'"]');
    return { id: it.id||0, name: ne?ne.value.trim():it.name, ponderacion: pe?Number(pe.value):(it.ponderacion||2) };
  }).filter(function(it) { return it.name; });
  if (!items.length) { toast('Agrega al menos un ítem', 'warning'); return; }
  for (var i=0;i<items.length;i++) {
    if (!items[i].name) { toast('Todos los ítems deben tener nombre','warning'); return; }
    if (![1,2,3].includes(items[i].ponderacion)) { toast('Ponderación inválida (1, 2 o 3)','warning'); return; }
  }
  try {
    if (!formId) { var nf = await api('/api/rhh/evaluations/forms', { method:'POST', body: JSON.stringify({ group_name: window._evalFormGroupName }) }); formId = nf.id; }
    await api('/api/rhh/evaluations/forms/'+formId, { method:'PATCH', body: JSON.stringify({ items: items }) });
    toast('Formulario guardado'); evaluacionesView();
  } catch(err) { toast(err.message,'error'); }
}

function openNuevaSesionModal() {
  var now = new Date();
  var meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // Construir lista de evaluadores
  var evaluators = (state.rhhUsers || []).filter(function(u){ return u.active !== false && u.role !== 'empleado'; });
  var evalOpts = evaluators.map(function(u){
    return '<option value="' + u.id + '">' + escHtml(u.full_name) + ' — ' + u.role + '</option>';
  }).join('');

  // Agrupar empleados por grupo de formulario (desde state)
  var forms = window._evalForms || [];
  var employees = (state.employees || []).filter(function(e){ return e.active !== false; });
  var empsByGroup = {};
  employees.forEach(function(emp) {
    var form = forms.find(function(f){ return (f.position_ids||[]).includes(emp.position_id) || f.position_id === emp.position_id; });
    var gName = form ? form.group_name : 'Sin formulario';
    if (!empsByGroup[gName]) empsByGroup[gName] = [];
    empsByGroup[gName].push(emp);
  });

  var groupHtml = Object.entries(empsByGroup).map(function(entry, gIdx) {
    var gName = entry[0], emps = entry[1];
    var empItems = emps.map(function(emp) {
      return '<label class="ns-emp-item ns-g-' + gIdx + '" style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:13px;">' +
        '<input type="checkbox" class="ns-emp-cb" value="' + emp.id + '" style="cursor:pointer;flex-shrink:0;">' +
        '<span>' + escHtml(emp.full_name) + '</span>' +
      '</label>';
    }).join('');
    return '<div style="margin-bottom:14px;">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#2563eb;cursor:pointer;padding:4px 0;margin-bottom:4px;">' +
        '<input type="checkbox" onchange="nsToggleGroup(' + gIdx + ',this.checked)" style="cursor:pointer;">' +
        escHtml(gName) + ' <span style="font-weight:400;color:#9ca3af;">(' + emps.length + ')</span>' +
      '</label>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px;padding-left:18px;">' +
        empItems +
      '</div>' +
    '</div>';
  }).join('');

  var modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ns-modal';
  modal.innerHTML =
    '<div class="modal" style="max-width:900px;width:95vw;max-height:92vh;display:flex;flex-direction:column;">' +
    '<div class="modal-header" style="flex-shrink:0;">' +
      '<h3 style="margin:0;">📋 Nueva sesión de evaluación</h3>' +
    '</div>' +
    '<div class="modal-body" style="overflow-y:auto;flex:1;padding:20px;">' +

      // Datos de sesión
      '<div style="display:grid;grid-template-columns:1fr 120px 120px;gap:12px;margin-bottom:20px;">' +
        '<div class="form-group" style="margin:0;"><label>Nombre de la sesión *</label>' +
          '<input id="ns-name" value="' + meses[now.getMonth()] + ' ' + now.getFullYear() + '" style="width:100%;"/></div>' +
        '<div class="form-group" style="margin:0;"><label>Mes *</label>' +
          '<input id="ns-month" type="number" min="1" max="12" value="' + (now.getMonth()+1) + '" style="width:100%;"/></div>' +
        '<div class="form-group" style="margin:0;"><label>Año *</label>' +
          '<input id="ns-year" type="number" min="2024" max="2099" value="' + now.getFullYear() + '" style="width:100%;"/></div>' +
      '</div>' +

      // Asignación
      '<div style="border-top:1px solid #e5e7eb;padding-top:16px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">' +
          '<div style="font-size:14px;font-weight:700;">👥 Asignar evaluador (opcional)</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<label style="font-size:13px;">Evaluador:</label>' +
            '<select id="ns-eval-id" style="padding:6px 10px;border-radius:8px;border:1px solid #d1d5db;font-size:13px;min-width:200px;">' +
              '<option value="">— Sin asignar aún —</option>' + evalOpts +
            '</select>' +
            '<button class="btn-ghost" style="font-size:12px;" onclick="nsSelectAll(true)">✓ Todos</button>' +
            '<button class="btn-ghost" style="font-size:12px;" onclick="nsSelectAll(false)">✗ Ninguno</button>' +
          '</div>' +
        '</div>' +
        (groupHtml || '<div class="empty-state" style="padding:20px;"><p>Sin empleados activos</p></div>') +
      '</div>' +

    '</div>' +
    '<div class="modal-footer" style="flex-shrink:0;">' +
      '<button class="btn-ghost" onclick="document.getElementById(\'ns-modal\').remove()">Cancelar</button>' +
      '<button class="btn-primary" onclick="guardarNuevaSesion()">💾 Crear sesión y asignar</button>' +
    '</div></div>';

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });
}

function nsToggleGroup(gIdx, checked) {
  document.querySelectorAll('.ns-g-' + gIdx + ' .ns-emp-cb').forEach(function(cb){ cb.checked = checked; });
}
function nsSelectAll(checked) {
  document.querySelectorAll('.ns-emp-cb').forEach(function(cb){ cb.checked = checked; });
}

async function guardarNuevaSesion() {
  var name  = (document.getElementById('ns-name') || {}).value || '';
  name = name.trim();
  var month = Number((document.getElementById('ns-month') || {}).value);
  var year  = Number((document.getElementById('ns-year') || {}).value);
  if (!name || !month || !year) { toast('Completa nombre, mes y año', 'warning'); return; }

  try {
    var s = await api('/api/rhh/evaluations/sessions', { method:'POST', body: JSON.stringify({ name, month, year }) });
    evalSessionId = s.id;

    // Asignar si hay evaluador y empleados seleccionados
    var evalId = (document.getElementById('ns-eval-id') || {}).value;
    var empIds = Array.from(document.querySelectorAll('.ns-emp-cb:checked')).map(function(cb){ return Number(cb.value); });
    if (evalId && empIds.length > 0) {
      await api('/api/rhh/evaluations/sessions/' + s.id + '/assign', {
        method: 'POST',
        body: JSON.stringify({ evaluador_id: Number(evalId), employee_ids: empIds })
      });
      toast('✅ Sesión creada y ' + empIds.length + ' empleado(s) asignado(s)');
    } else {
      toast('Sesión creada');
    }

    var ov = document.getElementById('ns-modal');
    if (ov) ov.remove();
    evalTab = 'asignar';
    evaluacionesView();
  } catch(err) { toast(err.message, 'error'); }
}

async function evalGuardarFila(sessionId, empId) {
  var evEl = document.getElementById('ev-eval-'+empId);
  var evaluador_id = evEl ? evEl.value : null;
  var asistencias = document.getElementById('ev-asis-'+empId) ? document.getElementById('ev-asis-'+empId).value : null;
  var faltas = document.getElementById('ev-falt-'+empId) ? document.getElementById('ev-falt-'+empId).value : null;
  var retardos = document.getElementById('ev-ret-'+empId) ? document.getElementById('ev-ret-'+empId).value : null;
  var actas = document.getElementById('ev-acta-'+empId) ? document.getElementById('ev-acta-'+empId).value : null;
  var amonestaciones = document.getElementById('ev-amon-'+empId) ? document.getElementById('ev-amon-'+empId).value : null;
  if ([asistencias,faltas,retardos,actas,amonestaciones].some(function(v){return v===''||v===null||v===undefined;})) {
    toast('Completa todos los campos numéricos (incluyendo 0)','warning'); return;
  }
  try {
    await api('/api/rhh/evaluations/sessions/'+sessionId+'/entries',{method:'PATCH',body:JSON.stringify({
      employee_id:empId, evaluador_id:evaluador_id?Number(evaluador_id):null,
      asistencias:Number(asistencias), faltas:Number(faltas), retardos:Number(retardos),
      actas:Number(actas), amonestaciones:Number(amonestaciones)
    })});
    toast('Guardado'); evaluacionesView();
  } catch(err) { toast(err.message,'error'); }
}

function evalEditarFila(empId) {
  var row = document.getElementById('ev-row-'+empId); if (!row) return;
  row.style.background = '';
  row.querySelectorAll('input,select').forEach(function(el){ el.removeAttribute('disabled'); });
  var cells = row.cells;
  cells[cells.length-1].innerHTML = '<button class="btn-primary" style="font-size:11px;padding:3px 8px;" onclick="evalGuardarFila('+evalSessionId+','+empId+')">💾 Guardar</button>';
}

async function evalRellenar(sessionId, empId) {
  try {
    var session = await api('/api/rhh/evaluations/sessions/'+sessionId);
    var month = session.month, year = session.year;
    var from = year+'-'+String(month).padStart(2,'0')+'-01';
    var to   = year+'-'+String(month).padStart(2,'0')+'-31';
    var incs = await api('/api/rhh/incidences?employee_id='+empId+'&fecha_ini='+from+'&fecha_fin='+to).catch(function(){return[];});
    var faltas=0,retardos=0,actas=0,amonestaciones=0;
    (incs||[]).forEach(function(i){
      if(['falta','ausencia'].indexOf(i.type)>=0) faltas++;
      else if(i.type==='retardo') retardos++;
      else if(i.type==='acta_administrativa') actas++;
      else if(i.type==='amonestacion') amonestaciones++;
    });
    var setV=function(id,v){var el=document.getElementById(id);if(el){el.value=v;el.disabled=false;}};
    setV('ev-falt-'+empId,faltas); setV('ev-ret-'+empId,retardos);
    setV('ev-acta-'+empId,actas); setV('ev-amon-'+empId,amonestaciones);
    toast('Datos rellenados desde el sistema');
  } catch(e) { toast('No se pudieron obtener datos automáticamente','warning'); }
}

async function cerrarSesion(sessionId) {
  if (!confirm('¿Cerrar esta sesión de evaluación?')) return;
  try {
    await api('/api/rhh/evaluations/sessions/'+sessionId,{method:'PATCH',body:JSON.stringify({status:'closed'})});
    toast('Sesión cerrada'); evaluacionesView();
  } catch(err) { toast(err.message,'error'); }
}

async function evalResetSesion(sessionId) {
  if (!confirm('¿Vaciar todos los datos capturados y reabrir la sesión?\nEsta acción no se puede deshacer.')) return;
  try {
    await api('/api/rhh/evaluations/sessions/'+sessionId+'/reset', { method: 'POST' });
    toast('Sesión vaciada y reabierta');
    evaluacionesView();
  } catch(err) { toast(err.message, 'error'); }
}

async function evalBorrarSesion(sessionId) {
  if (!confirm('¿Borrar PERMANENTEMENTE esta sesión y todos sus datos?\nEsta acción no se puede deshacer.')) return;
  try {
    await api('/api/rhh/evaluations/sessions/'+sessionId, { method: 'DELETE' });
    toast('Sesión borrada');
    evalSessionId = null;
    evaluacionesView();
  } catch(err) { toast(err.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// MIS EVALUACIONES — Vista Supervisor / Empleado
// ══════════════════════════════════════════════════════════════════════════════

async function misEvaluacionesView() {
  if (state.user && state.user.role === 'empleado') await empleadoEvalView();
  else await supervisorEvalView();
}

async function supervisorEvalView() {
  var el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando...</div>', 'mis-evaluaciones');
  try {
    var pending = await api('/api/rhh/evaluations/sessions/my-pending') || [];
    window._supPending = pending;

    if (pending.length === 0) {
      el.innerHTML = shell(
        '<div class="module-title"><h2>⭐ Mis Evaluaciones</h2></div>' +
        '<div class="card section"><div class="empty-state"><div class="empty-icon">✅</div><p>No tienes evaluaciones asignadas actualmente</p></div></div>',
        'mis-evaluaciones');
      return;
    }

    // Agrupar por sesión
    var grouped = {};
    pending.forEach(function(p) {
      if (!grouped[p.session_id]) grouped[p.session_id] = { name: p.session_name, items: [] };
      grouped[p.session_id].items.push(p);
    });

    var totalDone = pending.filter(function(p){ return p.completed; }).length;
    var totalAll  = pending.length;

    var sectionsHtml = Object.entries(grouped).map(function(entry) {
      var sid = entry[0], group = entry[1];
      var done  = group.items.filter(function(p){ return p.completed; }).length;
      var total = group.items.length;
      var pct   = Math.round(done / total * 100);
      var color = pct >= 100 ? '#059669' : pct >= 50 ? '#f59e0b' : '#2563eb';

      var rows = group.items.map(function(p) {
        var pidx = pending.indexOf(p);
        var formBadge = p.form_group
          ? '<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:8px;margin-left:4px;">' + escHtml(p.form_group) + '</span>'
          : '';
        var evalBtn = !p.form_id
          ? '<span style="font-size:11px;color:#9ca3af;">Sin formulario</span>'
          : p.completed
            ? '<span class="badge" style="background:#059669;">✓ Completada</span>'
            : '<button class="btn-primary" style="font-size:12px;padding:5px 14px;" onclick="openEvalStarsModal(window._supPending[' + pidx + '])">⭐ Evaluar</button>';
        return '<tr style="' + (p.completed ? 'background:#f0fdf4;' : '') + '">' +
          '<td style="font-size:13px;font-weight:600;">' + escHtml(p.employee_name) + '</td>' +
          '<td style="font-size:12px;color:#6b7280;">' + escHtml(p.position_name) + formBadge + '</td>' +
          '<td style="text-align:center;">' + evalBtn + '</td>' +
        '</tr>';
      }).join('');

      return '<div style="margin-bottom:20px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<h3 style="font-size:15px;font-weight:700;margin:0;">📋 ' + escHtml(group.name) + '</h3>' +
          '<span style="font-size:14px;font-weight:700;color:' + color + ';">' + done + ' / ' + total + '</span>' +
        '</div>' +
        '<div style="height:4px;background:#e5e7eb;border-radius:2px;margin-bottom:12px;">' +
          '<div style="height:4px;background:' + color + ';border-radius:2px;width:' + pct + '%;"></div>' +
        '</div>' +
        '<div class="card section table-wrap">' +
          '<table><thead><tr>' +
            '<th>Trabajador</th><th>Puesto</th><th style="text-align:center;">Evaluación</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div></div>';
    }).join('');

    var pctGlobal = Math.round(totalDone / totalAll * 100);
    var colorGlobal = pctGlobal >= 100 ? '#059669' : pctGlobal >= 50 ? '#f59e0b' : '#2563eb';

    el.innerHTML = shell(
      '<div class="module-title">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<h2 style="margin:0;">⭐ Mis Evaluaciones</h2>' +
          '<span style="font-size:18px;font-weight:800;color:' + colorGlobal + ';">' + totalDone + ' / ' + totalAll + '</span>' +
        '</div>' +
        '<div style="height:5px;background:#e5e7eb;border-radius:3px;margin-top:8px;">' +
          '<div style="height:5px;background:' + colorGlobal + ';border-radius:3px;width:' + pctGlobal + '%;"></div>' +
        '</div>' +
      '</div>' +
      sectionsHtml,
      'mis-evaluaciones');
  } catch(err) {
    el.innerHTML = shell('<div class="notice error">' + err.message + '</div>', 'mis-evaluaciones');
  }
}

function openEvalStarsModal(p) {
  if (!p) return;
  var POND_LABEL = { 3: 'Muy Alta', 2: 'Media', 1: 'Muy Baja' };
  var POND_COLOR = { 3: '#dc2626', 2: '#f59e0b', 1: '#6b7280' };
  var VALOR_LEGACY = { alto: 5, medio: 3, bajo: 1 };
  var TIPO_LABEL = { actividades_area: 'Actividades de Área', '5s_seguridad_limpieza': "5'S, Seg. y Limpieza", conducta: 'Conducta' };

  var useNewSystem = (p.form_items || []).some(function(it) { return it.ponderacion; });
  var itemsHtml;

  if (useNewSystem) {
    // Sistema nuevo: lista plana con ponderacion 1/2/3
    itemsHtml = '<div>' +
      (p.form_items || []).map(function(it) {
        var mp = it.ponderacion || VALOR_LEGACY[it.valor] || 0;
        var pondColor = POND_COLOR[it.ponderacion] || '#6b7280';
        var pondLabel = POND_LABEL[it.ponderacion] || it.valor || '';
        return '<div style="margin-bottom:12px;padding:10px;background:#f9fafb;border-radius:8px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<span style="font-size:13px;font-weight:600;">' + escHtml(it.name) + '</span>' +
            '<span style="font-size:11px;color:white;background:' + pondColor + ';padding:2px 8px;border-radius:10px;">Pond. ' + mp + ' · ' + pondLabel + '</span>' +
          '</div>' +
          '<div class="star-rating" data-item-id="' + it.id + '" data-max-pts="' + mp + '" style="display:flex;gap:6px;">' +
            [1,2,3,4,5].map(function(s){ return '<span class="star" data-val="'+s+'" onclick="setStarRating(this.closest(\'.star-rating\'),'+s+')" style="font-size:26px;cursor:pointer;color:#d1d5db;transition:color .15s;">★</span>'; }).join('') +
          '</div>' +
          '<div style="font-size:11px;color:#6b7280;margin-top:4px;">Puntos: <span id="star-pts-' + it.id + '">0</span> / ' + mp + '</div>' +
        '</div>';
      }).join('') + '</div>';
  } else {
    // Sistema legacy: agrupado por tipo
    var byTipo = {};
    (p.form_items || []).forEach(function(it) { var t = it.tipo || 'otro'; if (!byTipo[t]) byTipo[t] = []; byTipo[t].push(it); });
    itemsHtml = Object.entries(byTipo).map(function(entry) {
      var tipo = entry[0], its = entry[1];
      return '<div style="margin-bottom:20px;">' +
        '<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#2563eb;border-bottom:2px solid #dbeafe;padding-bottom:6px;margin-bottom:12px;">' + (TIPO_LABEL[tipo] || tipo) + '</div>' +
        its.map(function(it) {
          var mp = VALOR_LEGACY[it.valor] || 0;
          return '<div style="margin-bottom:14px;padding:10px;background:#f9fafb;border-radius:8px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<span style="font-size:13px;font-weight:600;">' + escHtml(it.name) + '</span>' +
              '<span style="font-size:11px;color:#6b7280;background:#e0e7ff;padding:2px 8px;border-radius:10px;">' + it.valor + ' · ' + mp + ' pts</span>' +
            '</div>' +
            '<div class="star-rating" data-item-id="' + it.id + '" data-max-pts="' + mp + '" style="display:flex;gap:8px;">' +
              [1,2,3,4,5].map(function(s){ return '<span class="star" data-val="'+s+'" onclick="setStarRating(this.closest(\'.star-rating\'),'+s+')" style="font-size:28px;cursor:pointer;color:#d1d5db;transition:color .15s;">★</span>'; }).join('') +
            '</div>' +
            '<div style="font-size:11px;color:#6b7280;margin-top:4px;">Puntos: <span id="star-pts-' + it.id + '">0</span> / ' + mp + '</div>' +
          '</div>';
        }).join('') + '</div>';
    }).join('');
  }

  var modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal" style="max-width:620px;max-height:90vh;overflow-y:auto;">' +
    '<div class="modal-header" style="position:sticky;top:0;background:white;z-index:1;padding-bottom:12px;border-bottom:1px solid #e5e7eb;">' +
      '<h3 style="margin:0;">⭐ Evaluación: ' + escHtml(p.employee_name) + '</h3>' +
      '<div style="font-size:12px;color:#6b7280;margin-top:4px;">' + escHtml(p.position_name) + ' · ' + escHtml(p.session_name) + (p.form_group ? ' · <b>' + escHtml(p.form_group) + '</b>' : '') + '</div>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div style="background:#f0f9ff;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;display:flex;gap:16px;flex-wrap:wrap;">' +
        '<span>✅ Asistencias: <b>' + (p.asistencias != null ? p.asistencias : '—') + '</b></span>' +
        '<span>❌ Faltas: <b>' + (p.faltas != null ? p.faltas : '—') + '</b></span>' +
        '<span>⏰ Retardos: <b>' + (p.retardos != null ? p.retardos : '—') + '</b></span>' +
        '<span>📋 Actas: <b>' + (p.actas != null ? p.actas : '—') + '</b></span>' +
        '<span>⚠️ Amonest.: <b>' + (p.amonestaciones != null ? p.amonestaciones : '—') + '</b></span>' +
      '</div>' +
      (p.form_items && p.form_items.length ? itemsHtml : '<div class="empty-state"><p>Sin ítems de evaluación para este puesto</p></div>') +
      '<div style="background:#f0fdf4;border-radius:8px;padding:12px;margin-top:16px;display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-weight:600;">Puntos obtenidos:</span>' +
        '<span id="eval-total-pts" style="font-size:18px;font-weight:700;color:#059669;">0 / ' + p.form_total_points + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer" style="position:sticky;bottom:0;background:white;padding-top:12px;border-top:1px solid #e5e7eb;">' +
      '<button class="btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Cancelar</button>' +
      '<button class="btn-primary" onclick="submitStarsEvaluation(' + p.session_id + ',' + p.employee_id + ',' + p.form_id + ',' + p.form_total_points + ')">✅ Confirmar evaluación</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
}

function setStarRating(container, val) {
  container.querySelectorAll('.star').forEach(function(s){ s.style.color = Number(s.dataset.val)<=val?'#f59e0b':'#d1d5db'; });
  container.dataset.stars = val;
  var mp = Number(container.dataset.maxPts)||0;
  var pts = Math.round((val/5)*mp*100)/100;
  var pEl = document.getElementById('star-pts-'+container.dataset.itemId); if(pEl) pEl.textContent = pts;
  var total = 0;
  document.querySelectorAll('.star-rating').forEach(function(cr){
    total += Math.round(((Number(cr.dataset.stars)||0)/5)*(Number(cr.dataset.maxPts)||0)*100)/100;
  });
  var tEl = document.getElementById('eval-total-pts');
  if (tEl) { var mx = tEl.textContent.split('/')[1]; mx = mx ? mx.trim() : '0'; tEl.textContent = Math.round(total*100)/100 + ' / ' + mx; }
}

async function submitStarsEvaluation(sessionId, employeeId, formId, formTotalPts) {
  var containers = document.querySelectorAll('.star-rating');
  var item_scores = []; var allFilled = true;
  containers.forEach(function(cr){ if(!cr.dataset.stars) allFilled=false; item_scores.push({item_id:Number(cr.dataset.itemId),stars:Number(cr.dataset.stars)||0}); });
  if (!allFilled) { toast('Debes calificar todos los ítems con estrellas','warning'); return; }
  if (!confirm('¿Confirmar y enviar evaluación? Esta acción no se puede deshacer.')) return;
  try {
    var result = await api('/api/rhh/evaluations/eval-results',{method:'POST',body:JSON.stringify({session_id:sessionId,employee_id:employeeId,form_id:formId,item_scores:item_scores})});
    var ov = document.querySelector('.modal-overlay'); if(ov) ov.remove();
    toast('Evaluación completada: '+result.score_pct+'%');
    supervisorEvalView();
  } catch(err) { toast(err.message,'error'); }
}

async function empleadoEvalView() {
  var el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando...</div>','mis-evaluaciones');
  try {
    var empId = state.user && state.user.employee_id;
    if (!empId) { el.innerHTML = shell('<div class="notice">Tu cuenta no está vinculada a un empleado</div>','mis-evaluaciones'); return; }
    var history = await api('/api/rhh/evaluations/eval-results/employee/'+empId) || [];
    var now = new Date();
    var selMonth = window._evalEmpMonth || (now.getMonth()+1);
    var selYear  = window._evalEmpYear  || now.getFullYear();
    var meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var monthResult = history.find(function(r){ return r.month===selMonth && r.year===selYear; });
    var stats = [
      ['Calificación', monthResult ? monthResult.score_pct.toFixed(1)+'%' : '—', monthResult && monthResult.score_pct>=80?'#059669':monthResult && monthResult.score_pct>=60?'#f59e0b':'#dc2626'],
      ['Asistencias', monthResult && monthResult.asistencias!=null ? monthResult.asistencias : '—','#059669'],
      ['Faltas', monthResult && monthResult.faltas!=null ? monthResult.faltas : '—','#dc2626'],
      ['Retardos', monthResult && monthResult.retardos!=null ? monthResult.retardos : '—','#f59e0b'],
      ['Amonestaciones', monthResult && monthResult.amonestaciones!=null ? monthResult.amonestaciones : '—','#7c3aed'],
      ['Actas Adm.', monthResult && monthResult.actas!=null ? monthResult.actas : '—','#374151']
    ];
    var statsHtml = monthResult
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin-bottom:20px;">' +
          stats.map(function(s){ return '<div class="card" style="text-align:center;padding:16px;"><div style="font-size:'+(s[0]==='Calificación'?'26':'22')+'px;font-weight:700;color:'+s[2]+'">'+s[1]+'</div><div style="font-size:11px;color:#6b7280;margin-top:4px;">'+s[0]+'</div></div>'; }).join('') +
        '</div>'
      : '<div class="card section" style="text-align:center;padding:32px;color:#9ca3af;margin-bottom:20px;">Sin evaluación para ' + meses[selMonth-1] + ' ' + selYear + '</div>';
    var monthOpts = meses.map(function(m,i){ return '<option value="'+(i+1)+'" '+(i+1===selMonth?'selected':'')+'>'+m+'</option>'; }).join('');
    var yearOpts  = [selYear-1,selYear,selYear+1].map(function(y){ return '<option value="'+y+'" '+(y===selYear?'selected':'')+'>'+y+'</option>'; }).join('');
    var yearHistory = history.filter(function(r){ return r.year===selYear; });
    var chartData = meses.map(function(_,i){ var r=yearHistory.find(function(r){return r.month===i+1;}); return r?r.score_pct:null; });
    el.innerHTML = shell(
      '<div class="module-title"><h2>⭐ Mi Evaluación</h2>' +
        '<div style="font-size:14px;color:#6b7280;margin-top:4px;">' + escHtml(state.user&&state.user.full_name||'') + '</div></div>' +
      '<div class="card section" style="margin-bottom:16px;"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
        '<label style="font-weight:600;">Mes:</label>' +
        '<select style="padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;" onchange="window._evalEmpMonth=Number(this.value);empleadoEvalView()">' + monthOpts + '</select>' +
        '<select style="padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;" onchange="window._evalEmpYear=Number(this.value);empleadoEvalView()">' + yearOpts + '</select>' +
      '</div></div>' +
      statsHtml +
      '<div class="card section"><h4 style="margin:0 0 12px;">📊 Historial ' + selYear + '</h4><canvas id="eval-year-chart" height="160"></canvas></div>',
      'mis-evaluaciones');
    var canvas = document.getElementById('eval-year-chart');
    if (canvas) drawEvalBarChart(canvas, meses, chartData);
  } catch(err){ el.innerHTML=shell('<div class="notice error">'+err.message+'</div>','mis-evaluaciones'); }
}

function drawEvalBarChart(canvas, labels, data) {
  var W = canvas.offsetWidth||600; canvas.width=W; canvas.height=160;
  var ctx = canvas.getContext('2d');
  var H=160,padL=36,padR=12,padT=16,padB=28,chartH=H-padT-padB;
  ctx.clearRect(0,0,W,H);
  [0,25,50,75,100].forEach(function(v){
    var y=padT+chartH-(v/100)*chartH;
    ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
    ctx.fillStyle='#9ca3af';ctx.font='10px sans-serif';ctx.textAlign='right';ctx.fillText(v+'%',padL-4,y+4);
  });
  var barW = Math.max(4,Math.floor((W-padL-padR)/12)-4);
  data.forEach(function(val,i){
    var x=padL+i*((W-padL-padR)/12)+2;
    if(val===null){ctx.fillStyle='#e5e7eb';ctx.fillRect(x,padT+chartH-4,barW,4);}
    else{
      var bH=Math.max(4,(val/100)*chartH);
      ctx.fillStyle=val>=80?'#059669':val>=60?'#f59e0b':'#dc2626';
      ctx.fillRect(x,padT+chartH-bH,barW,bH);
      ctx.fillStyle='#374151';ctx.font='bold 10px sans-serif';ctx.textAlign='center';
      ctx.fillText(val.toFixed(0)+'%',x+barW/2,padT+chartH-bH-4);
    }
    ctx.fillStyle='#6b7280';ctx.font='10px sans-serif';ctx.textAlign='center';
    ctx.fillText(labels[i].slice(0,3),x+barW/2,H-padB+14);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// PLANTILLAS DE DOCUMENTOS (vista para admin)
// ══════════════════════════════════════════════════════════════════════════════

let docTplShowForm = false;
const AVAILABLE_VARIABLES = ['nombre','rfc','curp','nss','puesto','departamento','fecha_ingreso','salario_diario','fecha_actual','email','telefono'];
const DOC_TPL_CATEGORIES = { contrato:'Contrato', identificacion:'Identificación', evaluacion:'Evaluación', carta:'Carta', otro:'Otro' };

async function plantillasView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando plantillas...</div>', 'plantillas');

  try {
    const templates = await api('/api/rhh/employees/doc-templates') || [];

    const varChips = AVAILABLE_VARIABLES.map(v =>
      `<span class="badge" style="cursor:pointer;margin:3px;" onclick="insertVariable('{{${v}}}')" title="Insertar {{${v}}}">${v}</span>`
    ).join('');

    const catOpts = Object.entries(DOC_TPL_CATEGORIES).map(([v, l]) =>
      `<option value="${v}">${l}</option>`).join('');

    const tplList = templates.length === 0
      ? '<div class="empty-state"><div class="empty-icon">📄</div><p>No hay plantillas de documentos</p></div>'
      : templates.map(t => `
          <div class="card" style="margin-bottom:10px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong>${t.name}</strong>
                <span class="badge" style="margin-left:8px;">${DOC_TPL_CATEGORIES[t.category] || t.category}</span>
              </div>
              <span class="small muted">${fmtDateDisplay(t.created_at?.slice(0,10))}</span>
            </div>
            ${t.description ? `<div class="small muted" style="margin-top:4px;">${t.description}</div>` : ''}
          </div>`
        ).join('');

    const formHtml = docTplShowForm ? `
      <div class="card section" style="margin-bottom:16px;">
        <h3>Nueva plantilla de documento</h3>
        <div class="row">
          <div><label>Nombre *</label><input id="dt-name" placeholder="Ej: Contrato de trabajo" /></div>
          <div><label>Categoría</label><select id="dt-cat">${catOpts}</select></div>
        </div>
        <div style="margin-top:10px;">
          <label>Descripción</label>
          <input id="dt-desc" placeholder="Descripción breve de la plantilla..." />
        </div>
        <div style="margin-top:10px;">
          <label>Variables disponibles (clic para insertar):</label>
          <div style="margin-top:6px;">${varChips}</div>
        </div>
        <div style="margin-top:10px;">
          <label>Contenido de la plantilla (HTML) *</label>
          <textarea id="dt-content" rows="10"
            style="font-family:monospace;font-size:13px;"
            placeholder="<h2>Contrato</h2><p>Para {{nombre}}...</p>"></textarea>
        </div>
        <div class="actions" style="margin-top:12px;">
          <button class="btn-primary" onclick="saveDocTemplate()">💾 Guardar plantilla</button>
          <button class="btn-ghost" onclick="docTplShowForm=false;plantillasView()">Cancelar</button>
        </div>
      </div>` : '';

    const content = `
      <div class="module-title">
        <h2>📄 Plantillas de Documentos</h2>
        <button class="btn-primary" onclick="docTplShowForm=!docTplShowForm;plantillasView()">+ Nueva plantilla</button>
      </div>
      ${formHtml}
      <div>${tplList}</div>
    `;
    el.innerHTML = shell(content, 'plantillas');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'plantillas');
  }
}

function insertVariable(varStr) {
  const ta = document.getElementById('dt-content');
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + varStr + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + varStr.length;
  ta.focus();
}

async function saveDocTemplate() {
  const name = document.getElementById('dt-name')?.value?.trim();
  const category = document.getElementById('dt-cat')?.value;
  const description = document.getElementById('dt-desc')?.value?.trim() || '';
  const template_content = document.getElementById('dt-content')?.value?.trim();

  if (!name || !template_content) {
    toast('Nombre y contenido son requeridos', 'warning');
    return;
  }

  // Extraer variables usadas
  const variables = [...new Set([...template_content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];

  try {
    await api('/api/rhh/employees/doc-templates', {
      method: 'POST',
      body: JSON.stringify({ name, category, description, template_content, variables })
    });
    toast('Plantilla creada exitosamente');
    docTplShowForm = false;
    plantillasView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LISTA DE ASISTENCIA SEMANAL
// ══════════════════════════════════════════════════════════════════════════════

// ── Estado de la vista ────────────────────────────────────────────────────────
let attendanceWeekStart = null;
let attendanceFilters = { area: '', project: '', shift: '' };
let attendanceData = null;
let totalsVisible = false;
let activeRolTab = 0; // 0=ROL, 1=Asistencia, 2=T.E. Cálculo
let rolWeekStart = null;
let rolData = null;

// ── Estado Control Asistencias (nuevo módulo /api/rhh/asistencia) ─────────────
let asisTab  = 0;        // 0=Rol, 1=Capturar, 2=Lista
let asisWeek = null;     // YYYY-MM-DD (lunes de la semana)
let asisShiftId = '';    // filtro de turno
let asisDayIdx  = 0;     // día seleccionado en captura (0=lun…5=sáb)
let _asisAssignments = []; // asignaciones en edición del rol

const ASIST_INC_TYPES = [
  { v:'labora',       l:'Labora',       bg:'#d1fae5', fg:'#065f46' },
  { v:'falta',        l:'Falta',        bg:'#fee2e2', fg:'#991b1b' },
  { v:'festivo',      l:'Festivo',      bg:'#fef3c7', fg:'#92400e' },
  { v:'vacacion',     l:'Vacación',     bg:'#dbeafe', fg:'#1e40af' },
  { v:'baja',         l:'Baja',         bg:'#f3f4f6', fg:'#374151' },
  { v:'retardo',      l:'Retardo',      bg:'#fef9c3', fg:'#854d0e' },
  { v:'incapacidad',  l:'Incapacidad',  bg:'#f5d0fe', fg:'#7e22ce' },
  { v:'permiso_cg',   l:'Permiso C/G',  bg:'#e0e7ff', fg:'#4338ca' },
  { v:'permiso_sg',   l:'Permiso S/G',  bg:'#ffe4e6', fg:'#9f1239' },
  { v:'paro_tecnico', l:'Paro Téc.',    bg:'#fff7ed', fg:'#c2410c' },
  { v:'descanso',     l:'Descanso',     bg:'#f9fafb', fg:'#9ca3af' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getAttWeekNumber(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d - startOfWeek1;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function fmtWeekLabel(startStr) {
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(startStr + 'T12:00:00');
  end.setDate(end.getDate() + 6);
  const wn = getAttWeekNumber(startStr);
  const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const startLbl = `${start.getDate()} ${MONTHS_ES[start.getMonth()]}`;
  const endLbl = `${end.getDate()} ${MONTHS_ES[end.getMonth()]} ${end.getFullYear()}`;
  return `Semana ${wn} · ${startLbl} al ${endLbl}`;
}

function statusColor(status) {
  const map = {
    labora:               { bg: '#dcfce7', text: '#166534' },  // "Asistió" — verde confirmado
    festivo:              { bg: '#e0e7ff', text: '#3730a3' },
    descanso:             { bg: '#f1f5f9', text: '#64748b' },
    vacaciones:           { bg: '#dbeafe', text: '#1e40af' },
    falta:                { bg: '#fee2e2', text: '#991b1b' },
    retardo:              { bg: '#ffedd5', text: '#9a3412' },
    cumpleanos:           { bg: '#f3e8ff', text: '#6b21a8' },
    permiso:              { bg: '#fef9c3', text: '#854d0e' },
    permiso_sin_goce:     { bg: '#fee2e2', text: '#991b1b', border: '1px solid #fca5a5' },
    incapacidad:          { bg: '#ede9fe', text: '#5b21b6' },
    vacio:                { bg: '#e5e7eb', text: '#9ca3af' },
    // Estados pendientes (Automatización 3)
    vacaciones_pendiente: { bg: '#eff6ff', text: '#1e40af', border: '1px dashed #3b82f6' },
    permiso_pendiente:    { bg: '#fefce8', text: '#854d0e', border: '1px dashed #eab308' },
    falta_pendiente:      { bg: '#fff1f2', text: '#991b1b', border: '1px dashed #f87171' }
  };
  return map[status] || { bg: '#f3f4f6', text: '#6b7280' };
}

function statusLabel(status) {
  const map = {
    labora: 'Asistió', festivo: 'FESTIVO', descanso: 'Descanso',
    vacaciones: 'Vacaciones', falta: 'Falta', retardo: 'Retardo',
    cumpleanos: 'CUMPLEAÑOS', permiso: 'Permiso', permiso_sin_goce: 'Perm s/g',
    incapacidad: 'Incapacidad', vacio: '',
    // Estados pendientes (Automatización 3)
    vacaciones_pendiente: 'Vac. ⏳',
    permiso_pendiente: 'Permiso ⏳',
    falta_pendiente: 'Falta ⏳'
  };
  return map[status] !== undefined ? map[status] : status;
}

function attShiftColor(code) {
  const map = { T1: '#1d4ed8', T2: '#0f766e', T3: '#7c3aed', T4: '#b45309' };
  return map[code] || '#475569';
}

// ── Dropdown de estatus inline ─────────────────────────────────────────────────
function openStatusDropdown(empId, date, currentStatus, cellEl) {
  // Cerrar dropdowns previos
  document.querySelectorAll('.status-dropdown').forEach(d => d.remove());

  const options = [
    { value: 'labora',     label: 'Asistió',         bg: '#dcfce7', text: '#166534' },
    { value: 'falta',      label: 'Falta',            bg: '#fee2e2', text: '#991b1b' },
    { value: 'retardo',    label: 'Retardo',          bg: '#ffedd5', text: '#9a3412' },
    { value: 'vacaciones', label: 'Vacaciones',       bg: '#dbeafe', text: '#1e40af' },
    { value: 'permiso',          label: 'Permiso c/goce',   bg: '#fef9c3', text: '#854d0e' },
    { value: 'permiso_sin_goce', label: 'Permiso s/goce',   bg: '#fee2e2', text: '#991b1b' },
    { value: 'descanso',         label: 'Descanso',         bg: '#f1f5f9', text: '#64748b' },
    { value: 'festivo',    label: 'Festivo',          bg: '#e0e7ff', text: '#3730a3' },
    { value: 'cumpleanos', label: 'CUMPLEAÑOS',       bg: '#f3e8ff', text: '#6b21a8' }
  ];

  const dropdown = document.createElement('div');
  dropdown.className = 'status-dropdown';

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    item.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${opt.bg};border:1px solid ${opt.text}22;"></span>${opt.label}`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      saveAttendance(empId, date, opt.value, cellEl);
    });
    dropdown.appendChild(item);
  });

  // Posicionar cerca de la celda
  const rect = cellEl.getBoundingClientRect();
  dropdown.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 280)}px`;
  dropdown.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;

  document.body.appendChild(dropdown);

  // Cerrar al click fuera
  setTimeout(() => {
    document.addEventListener('click', function closeDropdown() {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }, { once: true });
  }, 0);
}

// ── Guardar asistencia ─────────────────────────────────────────────────────────
async function saveAttendance(empId, date, status, cellEl) {
  try {
    const result = await api('/api/rhh/schedule/attendance', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId, date, status })
    });
    if (!result) return;

    // Actualizar celda en DOM
    const colors = statusColor(status);
    cellEl.style.background = colors.bg;
    cellEl.style.color = colors.text;
    // Preservar emoji cumpleaños
    const bdaySpan = cellEl.querySelector('.bday-icon');
    cellEl.textContent = statusLabel(status);
    if (bdaySpan) cellEl.appendChild(bdaySpan);

    // Actualizar cache en memoria
    if (attendanceData) {
      for (const sg of (attendanceData.shifts || [])) {
        const emp = (sg.employees || []).find(e => e.id === empId);
        if (emp) {
          const day = (emp.days || []).find(d => d.date === date);
          if (day) day.status = status;
          break;
        }
      }
    }

    toast('Asistencia guardada');

    // Mostrar ícono de historial si el servidor devolvió log (Automatización 2)
    if (result.log) {
      const logIcon = document.createElement('span');
      logIcon.className = 'att-log-icon';
      logIcon.textContent = ' 📝';
      logIcon.style.cssText = 'font-size:10px;cursor:pointer;vertical-align:middle;';
      const fmtDt = (iso) => {
        const d = new Date(iso);
        return `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      };
      logIcon.title = `Cambiado por ${result.log.changed_by_name} el ${fmtDt(result.log.changed_at)}`;
      // Eliminar ícono previo si existe
      cellEl.querySelectorAll('.att-log-icon').forEach(el => el.remove());
      cellEl.appendChild(logIcon);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Modal solicitud TE ─────────────────────────────────────────────────────────
function openTEModal(empId, date, empName) {
  let modal = document.getElementById('te-modal-overlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'te-modal-overlay';
    modal.className = 'te-modal-overlay';
    modal.innerHTML = `
      <div class="te-modal-box">
        <h3>Solicitar Tiempo Extra</h3>
        <div id="te-modal-empname" style="font-weight:600;margin-bottom:8px;color:#064e3b;"></div>
        <div id="te-modal-dateshow" style="font-size:13px;color:var(--muted);margin-bottom:8px;"></div>
        <label>Horas solicitadas</label>
        <input id="te-modal-hours" type="number" min="0.5" max="24" step="0.5" placeholder="4" />
        <label>Notas</label>
        <textarea id="te-modal-notes" rows="2" placeholder="Motivo del tiempo extra..."></textarea>
        <div class="te-modal-actions">
          <button class="btn-ghost" onclick="closeTEModal()">Cancelar</button>
          <button class="btn-primary" id="te-modal-confirm">Solicitar autorización</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.dataset.empId = empId;
  modal.dataset.date = date;
  document.getElementById('te-modal-empname').textContent = empName;
  document.getElementById('te-modal-dateshow').textContent = `Fecha: ${date}`;
  document.getElementById('te-modal-hours').value = '';
  document.getElementById('te-modal-notes').value = '';
  modal.classList.add('open');

  document.getElementById('te-modal-confirm').onclick = async () => {
    const hours = parseFloat(document.getElementById('te-modal-hours').value);
    const notes = document.getElementById('te-modal-notes').value;
    if (!hours || hours <= 0) { toast('Ingresa las horas', 'warning'); return; }

    // Buscar shift_id del empleado
    let shiftId = null;
    if (attendanceData) {
      for (const sg of (attendanceData.shifts || [])) {
        const emp = (sg.employees || []).find(e => e.id === empId);
        if (emp) { shiftId = sg.shift?.id || null; break; }
      }
    }

    try {
      await api('/api/rhh/schedule/request-te', {
        method: 'POST',
        body: JSON.stringify({ employee_id: empId, date, shift_id: shiftId, te_hours: hours, notes })
      });
      toast('Solicitud de T.E. enviada');
      closeTEModal();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function closeTEModal() {
  const modal = document.getElementById('te-modal-overlay');
  if (modal) modal.classList.remove('open');
}

// ── Click en celda TE ──────────────────────────────────────────────────────────
function handleTEClick(empId, date, currentHours, empName, isFuture, cellEl) {
  const role = state.user?.role;
  const canManageTE = ['rh', 'admin', 'supervisor'].includes(role);
  if (isFuture) {
    if (!canManageTE) { alert('Solo supervisores y RHH pueden crear solicitudes de tiempo extra.'); return; }
    openTEAuthModal(empId, date, empName);
    return;
  }
  if (canManageTE) {
    openTECCModal(empId, date, currentHours, empName, cellEl);
  } else {
    alert('Solo supervisores y RHH pueden registrar tiempo extra.');
  }
}

function openTEAuthModal(empId, date, empName) {
  const existing = document.getElementById('te-auth-modal');
  if (existing) existing.remove();

  // Obtener shift_id del empleado desde attendanceData
  let shiftId = null;
  if (attendanceData) {
    for (const sg of attendanceData.shifts || []) {
      const emp = (sg.employees || []).find(e => e.id === empId);
      if (emp) { shiftId = sg.shift?.id || null; break; }
    }
  }

  const modal = document.createElement('div');
  modal.id = 'te-auth-modal';
  modal.setAttribute('data-shift-id', shiftId || '');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;min-width:360px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <h3 style="margin:0 0 4px;font-size:16px;">⏱️ Solicitud de Tiempo Extra</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#64748b;">${empName} · ${date}</p>
      ${!shiftId ? '<p style="color:#dc2626;font-size:12px;margin:0 0 12px;padding:8px;background:#fee2e2;border-radius:6px;">⚠ No se encontró turno para este empleado. La solicitud se creará sin turno específico.</p>' : ''}
      <div style="display:grid;gap:10px;">
        <label style="font-size:12px;font-weight:600;color:#374151;">Motivo / Notas
          <textarea id="te-auth-notes" rows="3" placeholder="Describe el motivo del tiempo extra..."
            style="display:block;width:100%;margin-top:4px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
        </label>
      </div>
      <p style="font-size:11px;color:#94a3b8;margin:8px 0 0;">La autorización abarcará el turno completo. Los empleados elegibles recibirán notificación.</p>
      <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;">
        <button onclick="document.getElementById('te-auth-modal').remove()"
          style="padding:8px 18px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;">Cancelar</button>
        <button onclick="saveTEAuthRequest('${date}')"
          style="padding:8px 18px;border:none;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Crear autorización</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveTEAuthRequest(date) {
  const notes = document.getElementById('te-auth-notes').value.trim();
  const modal = document.getElementById('te-auth-modal');
  const shiftId = modal?.getAttribute('data-shift-id') || null;

  if (!shiftId) { alert('No hay turno asociado a este empleado. No se puede crear la solicitud.'); return; }

  try {
    await api('/api/rhh/schedule/te-authorizations', {
      method: 'POST',
      body: JSON.stringify({ date, shift_id: Number(shiftId), notes: notes || null, positions: [] })
    });
    modal.remove();
    toast('Solicitud de TE creada correctamente.');
    listaAsistenciaView();
  } catch (err) {
    alert('Error al crear solicitud: ' + err.message);
  }
}

function openTECCModal(empId, date, currentHours, empName, cellEl) {
  // Leer centro de costo actual del cache
  let currentCC = null, currentProject = null;
  if (attendanceData) {
    for (const sg of (attendanceData.shifts || [])) {
      const emp = (sg.employees || []).find(e => e.id === empId);
      if (emp) {
        const day = (emp.days || []).find(d => d.date === date);
        if (day) { currentCC = day.cost_center || null; currentProject = day.project_id || null; }
        break;
      }
    }
  }

  let modal = document.getElementById('te-cc-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'te-cc-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;place-items:center;';
    document.body.appendChild(modal);
  }

  const projOpts = (state.employees.find(e=>e.id===empId)?.project
    ? `<option value="">— Sin proyecto —</option><option value="${state.employees.find(e=>e.id===empId)?.project}">${state.employees.find(e=>e.id===empId)?.project}</option>`
    : `<option value="">— Sin proyecto —</option>`);
  // Obtener proyectos del catálogo si disponibles
  const allProjects = [...new Set((state.employees||[]).map(e=>e.project).filter(Boolean))];
  const fullProjOpts = `<option value="">— Sin proyecto —</option>` + allProjects.map(p=>`<option value="${p}" ${currentProject===p?'selected':''}>${p}</option>`).join('');

  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;width:min(380px,95vw);box-shadow:0 16px 48px rgba(0,0,0,.2);">
      <h3 style="margin:0 0 4px;font-size:15px;">⏱ Tiempo Extra</h3>
      <div style="color:var(--muted);font-size:12px;margin-bottom:16px;">${empName} · ${date}</div>
      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Horas T.E.</label>
      <input id="te-cc-hours" type="number" min="0" max="24" step="0.5" value="${currentHours || ''}"
        style="width:100%;margin-bottom:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;" placeholder="0" />
      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Centro de costo</label>
      <select id="te-cc-select" style="width:100%;margin-bottom:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;"
        onchange="document.getElementById('te-cc-project-wrap').style.display=this.value==='cliente'?'block':'none'">
        <option value="">— Sin asignar —</option>
        <option value="rh" ${currentCC==='rh'?'selected':''}>RH (ausencias / ajustes)</option>
        <option value="operaciones" ${currentCC==='operaciones'?'selected':''}>Operaciones (solicitud supervisor)</option>
        <option value="cliente" ${currentCC==='cliente'?'selected':''}>Solicitud de Cliente</option>
      </select>
      <div id="te-cc-project-wrap" style="display:${currentCC==='cliente'?'block':'none'};margin-bottom:12px;">
        <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Proyecto / Cliente</label>
        <select id="te-cc-project" style="width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px;">${fullProjOpts}</select>
      </div>
      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Notas</label>
      <textarea id="te-cc-notes" rows="2" style="width:100%;margin-bottom:16px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;resize:vertical;" placeholder="Motivo..."></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-ghost" onclick="document.getElementById('te-cc-modal').style.display='none'">Cancelar</button>
        <button class="btn-primary" onclick="saveTECC(${empId},'${date}',${JSON.stringify(empName).replace(/"/g,"'")})">Guardar</button>
      </div>
    </div>`;
  modal.style.display = 'grid';
}

async function saveTECC(empId, date, empName) {
  const hours = parseFloat(document.getElementById('te-cc-hours').value) || 0;
  const costCenter = document.getElementById('te-cc-select').value || null;
  const projectId = costCenter === 'cliente' ? (document.getElementById('te-cc-project').value || null) : null;
  const notes = document.getElementById('te-cc-notes').value || null;

  try {
    await api('/api/rhh/schedule/attendance', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId, date, status: 'labora', te_hours: hours, cost_center: costCenter, project_id: projectId, notes })
    });
    // Actualizar cache local
    if (attendanceData) {
      for (const sg of (attendanceData.shifts || [])) {
        const emp = (sg.employees || []).find(e => e.id === empId);
        if (emp) {
          const day = (emp.days || []).find(d => d.date === date);
          if (day) { day.te_hours = hours; day.cost_center = costCenter; day.project_id = projectId; }
          emp.totals.te_total = emp.days.reduce((s, d) => s + (d.te_hours || 0), 0);
          emp.totals.dias_pendientes = Math.round((emp.totals.te_total / 8) * 100) / 100;
          break;
        }
      }
    }
    // Actualizar celda en DOM
    const cellEl = document.querySelector(`.te-cell[data-empid="${empId}"][data-date="${date}"]`);
    if (cellEl) {
      const ccIcon = costCenter ? { rh: '🏥', operaciones: '⚙️', cliente: '🤝' }[costCenter] : '';
      cellEl.textContent = hours !== 0 ? `${hours}${ccIcon}` : '';
      if (hours < 0) cellEl.classList.add('te-negative');
      else cellEl.classList.remove('te-negative');
    }
    document.getElementById('te-cc-modal').style.display = 'none';
    toast(`T.E. guardado${costCenter ? ' · CC: ' + costCenter : ''}`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Dropdown de puestos ────────────────────────────────────────────────────────
function openPuestoDropdown(empId, cellEl, employee) {
  document.querySelectorAll('.position-dropdown').forEach(d => d.remove());

  const enabledIds = Array.isArray(employee.enabled_positions) ? employee.enabled_positions.map(Number) : [];
  const allPositions = state.positions || [];

  const dropdown = document.createElement('div');
  dropdown.className = 'position-dropdown';

  if (allPositions.length === 0) {
    dropdown.innerHTML = '<div style="padding:8px;color:var(--muted);font-size:12px;">Sin puestos disponibles</div>';
  } else {
    allPositions.forEach(pos => {
      const isEnabled = enabledIds.includes(pos.id);
      const item = document.createElement('div');
      item.className = 'position-dropdown-item';
      item.innerHTML = `<span style="font-size:14px;">${isEnabled ? '✓' : '○'}</span><span>${pos.name}</span>`;
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        let newEnabled;
        if (isEnabled) {
          newEnabled = enabledIds.filter(id => id !== pos.id);
        } else {
          newEnabled = [...enabledIds, pos.id];
        }
        dropdown.remove();
        try {
          await api(`/api/rhh/employees/${empId}`, {
            method: 'PATCH',
            body: JSON.stringify({ enabled_positions: newEnabled })
          });
          employee.enabled_positions = newEnabled;
          // Actualizar celda
          const posName = newEnabled.length > 0
            ? (allPositions.find(p => p.id === newEnabled[0])?.name || '—')
            : '—';
          cellEl.textContent = posName;
          if (newEnabled.length === 0) cellEl.classList.add('no-position-warn');
          else cellEl.classList.remove('no-position-warn');
          toast('Puestos actualizados');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      dropdown.appendChild(item);
    });
  }

  const rect = cellEl.getBoundingClientRect();
  dropdown.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 300)}px`;
  dropdown.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  document.body.appendChild(dropdown);

  setTimeout(() => {
    document.addEventListener('click', function closePuesto() {
      dropdown.remove();
      document.removeEventListener('click', closePuesto);
    }, { once: true });
  }, 0);
}

// ── Modal + Festivo ────────────────────────────────────────────────────────────
function openHolidayModal() {
  let modal = document.getElementById('holiday-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'holiday-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:grid;place-items:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;width:min(360px,95vw);box-shadow:0 16px 48px rgba(0,0,0,.2);">
      <h3 style="margin:0 0 16px;color:#3730a3;">+ Agregar festivo</h3>
      <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Fecha</label>
      <input id="hol-date" type="date" style="width:100%;margin-bottom:12px;" />
      <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Nombre del festivo</label>
      <input id="hol-name" type="text" placeholder="Ej. Día de la Constitución" style="width:100%;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn-ghost" onclick="document.getElementById('holiday-modal').remove()">Cancelar</button>
        <button class="btn-primary" onclick="saveHoliday()">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveHoliday() {
  const date = document.getElementById('hol-date')?.value;
  const name = document.getElementById('hol-name')?.value?.trim();
  if (!date || !name) { toast('Fecha y nombre son requeridos', 'warning'); return; }

  try {
    await api('/api/rhh/schedule/holidays', {
      method: 'POST',
      body: JSON.stringify({ date, name })
    });
    document.getElementById('holiday-modal')?.remove();
    toast('Festivo agregado');
    listaAsistenciaView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── ROL SEMANAL ────────────────────────────────────────────────────────────────
async function listaRolView(el) {
  el.innerHTML = shell('<div class="loading-overlay">Cargando ROL semanal...</div>', 'lista-asistencia');
  try {
    const role = state.user?.role;
    const canEdit = ['rh','admin'].includes(role);
    const canAssign = ['supervisor','rh','admin'].includes(role);

    const data = await api(`/api/rhh/schedule/weekly-rol?week_start=${rolWeekStart}`);
    if (!data) return;
    rolData = data;

    // Build week label
    const ws = new Date(rolWeekStart + 'T12:00:00');
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const weekLabel = `${ws.getDate()} ${MONTHS[ws.getMonth()]} – ${we.getDate()} ${MONTHS[we.getMonth()]} ${we.getFullYear()}`;

    let shiftsHtml = '';
    const shiftsWithoutRol = data.shifts.filter(sg => !sg.rol);
    for (const sg of data.shifts) {
      const shift = sg.shift;
      const rol = sg.rol;
      // Si no hay ROL para este turno, solo admins/rh ven el botón de crear; los demás lo saltan
      if (!rol) {
        if (canEdit) {
          shiftsHtml += `
            <div class="card section" style="margin-bottom:12px;border-left:4px solid #d1d5db;opacity:.7;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <h3 style="margin:0;color:#6b7280;">${shift.name}</h3>
                <span style="background:#f3f4f6;color:#6b7280;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">Sin ROL programado</span>
                <button class="btn-primary" style="font-size:11px;padding:4px 10px;margin-left:auto;" onclick="createRol('${rolWeekStart}',${shift.id})">+ Crear ROL</button>
              </div>
            </div>`;
        }
        continue;
      }
      const isDraft = rol.status === 'draft';
      const statusBadge = isDraft
        ? `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">BORRADOR</span>`
        : `<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">✓ PUBLICADO ${fmtDateDisplay(rol.published_at?.slice(0,10)||'')}</span>`;
      const missingAlert = sg.total_missing > 0
        ? `<span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">⚠ ${sg.total_missing} puesto${sg.total_missing!==1?'s':''} sin cubrir</span>`
        : '';

      const actionBtns = canEdit ? `
        ${isDraft ? `
          <button class="btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="openAddSlotModal(${rol.id},${shift.id})">+ Puesto</button>
          <button class="btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="copyPreviousRol(${rol.id})">Copiar anterior</button>
          <button class="btn-primary" style="font-size:11px;padding:4px 10px;background:#059669;" onclick="publishRol(${rol.id})">Publicar ROL</button>
        ` : ''}
      ` : '';

      let slotsHtml = '';
      if (sg.slots.length === 0) {
        slotsHtml = `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--muted);font-size:13px;">Sin puestos definidos — ${canEdit ? 'usa "+ Puesto" para agregar' : 'el administrador debe configurar el ROL'}</td></tr>`;
      } else {
        for (const slot of sg.slots) {
          const filledCount = slot.assigned.length;
          const reqCount = slot.required_count || 1;
          const isFull = filledCount >= reqCount;
          const assignedNames = slot.assigned.map(a =>
            `<span class="pill active" style="font-size:11px;display:inline-flex;align-items:center;gap:4px;">
              ${a.full_name}
              ${(canAssign && isDraft) ? `<span onclick="removeRolAssignment(${rol.id},${a.assignment_id})" style="cursor:pointer;opacity:.6;font-weight:700;">✕</span>` : ''}
            </span>`
          ).join('');
          const addBtn = (canAssign && isDraft && filledCount < reqCount)
            ? `<button class="btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="openAssignEmpModal(${rol.id},${slot.id},'${slot.position_name.replace(/'/g,"\\'")}',${ shift.id})">+ Asignar</button>`
            : '';
          const removeSlotBtn = (canEdit && isDraft)
            ? `<button style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:12px;" title="Quitar puesto" onclick="removeRolSlot(${rol.id},${slot.id})">✕</button>`
            : '';
          slotsHtml += `<tr>
            <td style="padding:8px 12px;font-size:13px;">${removeSlotBtn} ${slot.position_name}</td>
            <td style="padding:8px 12px;text-align:center;">
              <span style="font-weight:700;color:${isFull?'#059669':'#dc2626'};">${filledCount}/${reqCount}</span>
            </td>
            <td style="padding:8px 12px;">${assignedNames} ${addBtn}</td>
            <td style="padding:8px 12px;font-size:11px;color:var(--muted);">${(slot.days||[]).map(d=>['D','L','M','X','J','V','S'][d]||'?').join(' ')}</td>
          </tr>`;
        }
      }

      const shiftColor = attShiftColor(shift.code || shift.name || '?');
      shiftsHtml += `
        <div class="card section" style="margin-bottom:16px;border-left:4px solid ${shiftColor};">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
            <h3 style="margin:0;color:${shiftColor};">${shift.name}</h3>
            ${statusBadge} ${missingAlert}
            <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;">${actionBtns}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f9fafb;font-size:12px;color:var(--muted);">
                <th style="padding:6px 12px;text-align:left;font-weight:600;">Puesto</th>
                <th style="padding:6px 12px;text-align:center;font-weight:600;">Cobertura</th>
                <th style="padding:6px 12px;text-align:left;font-weight:600;">Empleados</th>
                <th style="padding:6px 12px;text-align:left;font-weight:600;">Días</th>
              </tr>
            </thead>
            <tbody>${slotsHtml}</tbody>
          </table>
        </div>`;
    }

    const content = `
      <div class="module-title"><h2>📋 ROL / Asistencia Semanal</h2></div>
      ${rolTabBar(0)}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="btn-ghost" onclick="rolNavWeek(-1)">‹ Semana anterior</button>
        <span style="font-weight:700;font-size:14px;">${weekLabel}</span>
        <button class="btn-ghost" onclick="rolNavWeek(1)">Semana siguiente ›</button>
        <button class="btn-ghost" style="font-size:12px;" onclick="rolWeekStart=getMonday(new Date());listaAsistenciaView()">Hoy</button>
      </div>
      ${shiftsHtml}

      <!-- Modal: agregar puesto al ROL -->
      <div id="add-slot-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;place-items:center;display:none;">
        <div style="background:#fff;border-radius:16px;padding:24px;width:min(400px,95vw);box-shadow:0 16px 48px rgba(0,0,0,.2);">
          <h3 style="margin:0 0 16px;">+ Agregar puesto al ROL</h3>
          <input type="hidden" id="slot-rol-id" />
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Puesto</label>
          <select id="slot-position-id" style="width:100%;margin-bottom:12px;">
            ${state.positions.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Empleados requeridos</label>
          <input id="slot-req-count" type="number" min="1" max="20" value="1" style="width:100%;margin-bottom:12px;" />
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Días (marcar los que aplican)</label>
          <div id="slot-days-check" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
            ${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d,i)=>`
              <label style="display:flex;align-items:center;gap:4px;font-size:12px;">
                <input type="checkbox" value="${i}" ${i>=1&&i<=5?'checked':''} /> ${d}
              </label>`).join('')}
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn-ghost" onclick="closeSlotModal()">Cancelar</button>
            <button class="btn-primary" onclick="saveRolSlot()">Agregar</button>
          </div>
        </div>
      </div>

      <!-- Modal: asignar empleado -->
      <div id="assign-emp-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;place-items:center;">
        <div style="background:#fff;border-radius:16px;padding:24px;width:min(400px,95vw);box-shadow:0 16px 48px rgba(0,0,0,.2);">
          <h3 style="margin:0 0 4px;">Asignar empleado</h3>
          <div id="assign-emp-puesto" style="color:var(--muted);font-size:13px;margin-bottom:16px;"></div>
          <input type="hidden" id="assign-rol-id" />
          <input type="hidden" id="assign-slot-id" />
          <input type="hidden" id="assign-shift-id" />
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Empleado</label>
          <select id="assign-emp-select" style="width:100%;margin-bottom:16px;"></select>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn-ghost" onclick="closeAssignModal()">Cancelar</button>
            <button class="btn-primary" onclick="saveRolAssignment()">Asignar</button>
          </div>
        </div>
      </div>
    `;
    el.innerHTML = shell(content, 'lista-asistencia');
  } catch(err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'lista-asistencia');
  }
}

function rolNavWeek(dir) {
  const d = new Date(rolWeekStart + 'T12:00:00');
  d.setDate(d.getDate() + dir * 7);
  rolWeekStart = d.toISOString().slice(0, 10);
  attendanceWeekStart = rolWeekStart; // mantener sincronizados
  listaAsistenciaView();
}

function attNavWeek(dir) {
  const d = new Date(attendanceWeekStart + 'T12:00:00');
  d.setDate(d.getDate() + dir * 7);
  attendanceWeekStart = d.toISOString().slice(0, 10);
  rolWeekStart = attendanceWeekStart; // mantener sincronizados
  listaAsistenciaView();
}

async function createRol(weekStart, shiftId) {
  try {
    const rol = await api('/api/rhh/schedule/weekly-rol', { method: 'POST', body: JSON.stringify({ week_start: weekStart, shift_id: shiftId }) });
    toast('ROL creado');
    listaAsistenciaView();
  } catch(err) { toast(err.message, 'error'); }
}

function openAddSlotModal(rolId, shiftId) {
  document.getElementById('slot-rol-id').value = rolId;
  document.getElementById('add-slot-modal').style.display = 'grid';
}

function closeSlotModal() {
  document.getElementById('add-slot-modal').style.display = 'none';
}

async function saveRolSlot() {
  const rolId = Number(document.getElementById('slot-rol-id').value);
  const positionId = Number(document.getElementById('slot-position-id').value);
  const reqCount = Number(document.getElementById('slot-req-count').value) || 1;
  const days = Array.from(document.querySelectorAll('#slot-days-check input:checked')).map(cb => Number(cb.value));
  try {
    await api(`/api/rhh/schedule/weekly-rol/${rolId}/slots`, {
      method: 'POST', body: JSON.stringify({ position_id: positionId, required_count: reqCount, days })
    });
    closeSlotModal();
    toast('Puesto agregado al ROL');
    listaAsistenciaView();
  } catch(err) { toast(err.message, 'error'); }
}

async function removeRolSlot(rolId, slotId) {
  if (!confirm('¿Quitar este puesto del ROL? Se eliminarán las asignaciones.')) return;
  try {
    await api(`/api/rhh/schedule/weekly-rol/${rolId}/slots/${slotId}`, { method: 'DELETE' });
    toast('Puesto eliminado');
    listaAsistenciaView();
  } catch(err) { toast(err.message, 'error'); }
}

function openAssignEmpModal(rolId, slotId, posName, shiftId) {
  document.getElementById('assign-rol-id').value = rolId;
  document.getElementById('assign-slot-id').value = slotId;
  document.getElementById('assign-shift-id').value = shiftId;
  document.getElementById('assign-emp-puesto').textContent = posName;

  // Solo empleados activos del mismo turno (o todos si no hay turno)
  const employees = state.employees.filter(e =>
    e.status === 'active' &&
    (!shiftId || e.shift_id === Number(shiftId))
  ).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const sel = document.getElementById('assign-emp-select');
  if (employees.length === 0) {
    sel.innerHTML = '<option value="">Sin empleados disponibles para este turno</option>';
  } else {
    sel.innerHTML = employees.map(e =>
      `<option value="${e.id}">${e.full_name} (${e.employee_number || '—'})</option>`
    ).join('');
  }
  document.getElementById('assign-emp-modal').style.display = 'grid';
}

function closeAssignModal() {
  document.getElementById('assign-emp-modal').style.display = 'none';
}

async function saveRolAssignment() {
  const rolId = Number(document.getElementById('assign-rol-id').value);
  const slotId = Number(document.getElementById('assign-slot-id').value);
  const empId = Number(document.getElementById('assign-emp-select').value);
  try {
    await api(`/api/rhh/schedule/weekly-rol/${rolId}/assign`, {
      method: 'POST', body: JSON.stringify({ slot_id: slotId, employee_id: empId })
    });
    closeAssignModal();
    toast('Empleado asignado al ROL');
    listaAsistenciaView();
  } catch(err) { toast(err.message, 'error'); }
}

async function removeRolAssignment(rolId, assignId) {
  try {
    await api(`/api/rhh/schedule/weekly-rol/${rolId}/assign/${assignId}`, { method: 'DELETE' });
    toast('Asignación eliminada');
    listaAsistenciaView();
  } catch(err) { toast(err.message, 'error'); }
}

async function publishRol(rolId) {
  if (!confirm('¿Publicar ROL? Los empleados recibirán una notificación.')) return;
  try {
    const result = await api(`/api/rhh/schedule/weekly-rol/${rolId}/publish`, { method: 'POST', body: '{}' });
    toast(`ROL publicado · ${result.notified} empleado${result.notified!==1?'s':''} notificado${result.notified!==1?'s':''}`);
    listaAsistenciaView();
  } catch(err) { toast(err.message, 'error'); }
}

async function copyPreviousRol(rolId) {
  try {
    const result = await api(`/api/rhh/schedule/weekly-rol/${rolId}/copy-previous`, { method: 'POST', body: '{}' });
    toast(`${result.slots_copied} puesto${result.slots_copied!==1?'s':''} copiado${result.slots_copied!==1?'s':''} de la semana anterior`);
    listaAsistenciaView();
  } catch(err) { toast(err.message, 'error'); }
}

// ── T.E. CÁLCULO ──────────────────────────────────────────────────────────────
async function listaTeCalcView(el) {
  el.innerHTML = shell('<div class="loading-overlay">Calculando T.E....</div>', 'lista-asistencia');
  try {
    const data = await api(`/api/rhh/schedule/te-calc?week_start=${attendanceWeekStart}`);
    if (!data) return;

    const ws = new Date(attendanceWeekStart + 'T12:00:00');
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const weekLabel = `${ws.getDate()} ${MONTHS[ws.getMonth()]} – ${we.getDate()} ${MONTHS[we.getMonth()]} ${we.getFullYear()}`;

    const fmt = (n) => n > 0 ? `$${n.toLocaleString('es-MX', {minimumFractionDigits:2,maximumFractionDigits:2})}` : '—';
    const fmtH = (h) => h > 0 ? `${h}h` : '—';

    let totalTeExtraPay = 0, totalPrima = 0, totalExtra = 0;

    const CC_LABELS = { rh: '🏥 RH', operaciones: '⚙️ Ops', cliente: '🤝 Cliente' };
    const CC_COLORS = { rh: '#7c3aed', operaciones: '#0369a1', cliente: '#059669' };

    const rows = data.employees.map(emp => {
      totalTeExtraPay += emp.te_extra_pay;
      totalPrima += emp.prima_dominical;
      totalExtra += emp.total_extra;

      const t3note = emp.is_t3 && emp.weekly_te_total > 0
        ? `<span title="T3: 3h incluidas en turno, ${emp.te_effective}h facturables" style="font-size:10px;color:#7c3aed;cursor:help;">⚡T3</span>`
        : '';

      // Desglose por CC
      const ccMap = {};
      (emp.days || []).forEach(d => {
        if (d.te_hours > 0) {
          const cc = d.cost_center || 'sin_cc';
          if (!ccMap[cc]) ccMap[cc] = 0;
          ccMap[cc] += d.te_hours;
        }
      });
      const ccBreakdown = Object.entries(ccMap).map(([cc, hrs]) => {
        const label = CC_LABELS[cc] || '— Sin CC';
        const color = CC_COLORS[cc] || '#6b7280';
        const proj = cc === 'cliente' ? (emp.days.find(d => d.cost_center === 'cliente' && d.project_id)?.project_id || '') : '';
        return `<span style="font-size:10px;background:#f3f4f6;padding:2px 6px;border-radius:8px;color:${color};font-weight:700;">${label} ${hrs}h${proj?' · '+proj:''}</span>`;
      }).join(' ');

      return `<tr>
        <td style="padding:8px 10px;font-size:12px;font-weight:600;">${emp.full_name}
          ${ccBreakdown ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${ccBreakdown}</div>` : ''}
        </td>
        <td style="padding:8px 10px;text-align:center;font-size:11px;font-weight:800;color:#4f46e5;">${emp.shift_code}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;">${fmt(emp.daily_salary)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;">${fmt(emp.hourly_rate)}/hr</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;font-weight:700;">${fmtH(emp.weekly_te_total)} ${t3note}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:#059669;">${fmtH(emp.te_2x_hours)}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:#dc2626;">${fmtH(emp.te_3x_hours)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;font-weight:700;">${fmt(emp.te_extra_pay)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:12px;">${fmt(emp.prima_dominical)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:13px;font-weight:800;color:#7c3aed;">${fmt(emp.total_extra)}</td>
      </tr>`;
    }).join('');

    const totalRow = data.employees.length > 0 ? `
      <tr style="background:#f9fafb;border-top:2px solid #e5e7eb;font-weight:700;">
        <td colspan="7" style="padding:10px;text-align:right;font-size:12px;">TOTALES</td>
        <td style="padding:10px;text-align:right;font-size:13px;color:#059669;">${fmt(totalTeExtraPay)}</td>
        <td style="padding:10px;text-align:right;font-size:13px;">${fmt(totalPrima)}</td>
        <td style="padding:10px;text-align:right;font-size:14px;color:#7c3aed;">${fmt(totalExtra)}</td>
      </tr>` : '';

    const emptyMsg = data.employees.length === 0
      ? `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--muted);">Sin horas de T.E. registradas esta semana</td></tr>`
      : '';

    const content = `
      <div class="module-title"><h2>📋 ROL / Asistencia Semanal</h2></div>
      ${rolTabBar(2)}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="btn-ghost" onclick="attNavWeek(-1)">‹ Semana anterior</button>
        <span style="font-weight:700;font-size:14px;">${weekLabel}</span>
        <button class="btn-ghost" onclick="attNavWeek(1)">Semana siguiente ›</button>
        <button class="btn-ghost" style="font-size:12px;" onclick="attendanceWeekStart=getMonday(new Date());listaAsistenciaView()">Hoy</button>
      </div>

      <div class="card section" style="margin-bottom:16px;background:#faf5ff;border-left:4px solid #7c3aed;">
        <div style="font-size:12px;color:#6b7280;line-height:1.6;">
          <strong>Reglas LFT:</strong>
          Horas T.E. 1–9 por semana = <strong>2×</strong> tarifa por hora · Horas 10+ = <strong>3×</strong> ·
          Turno 3: 3 horas semanales incluidas en el turno (no cuentan como extras) ·
          Domingo (séptimo día): <strong>2× salario diario + prima dominical 25%</strong>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:900px;">
          <thead>
            <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px;text-align:left;">Empleado</th>
              <th style="padding:10px;text-align:center;">Turno</th>
              <th style="padding:10px;text-align:right;">Salario/día</th>
              <th style="padding:10px;text-align:right;">Tarifa/hr</th>
              <th style="padding:10px;text-align:center;">T.E. total</th>
              <th style="padding:10px;text-align:center;color:#059669;">Hrs 2×</th>
              <th style="padding:10px;text-align:center;color:#dc2626;">Hrs 3×</th>
              <th style="padding:10px;text-align:right;">Extra T.E.</th>
              <th style="padding:10px;text-align:right;">Prima dom.</th>
              <th style="padding:10px;text-align:right;color:#7c3aed;">Total extra</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${emptyMsg}
            ${totalRow}
          </tbody>
        </table>
      </div>

      <div style="margin-top:12px;font-size:11px;color:var(--muted);">
        * El monto "Total extra" es el importe adicional a pagar sobre el salario regular de esa semana.
        Los valores dependen del salario diario registrado en el perfil del empleado.
      </div>
    `;
    el.innerHTML = shell(content, 'lista-asistencia');
  } catch(err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'lista-asistencia');
  }
}

// ── ROL / ASISTENCIA — TABS ────────────────────────────────────────────────────
function rolTabBar(activeTab) {
  const role = state.user?.role;
  const tabs = [
    [0, '📅 ROL Semanal'],
    [1, '📋 Lista Asistencia'],
    [2, '⏱ Cálculo T.E.']
  ];
  return `<div class="rol-tabs" style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:16px;">
    ${tabs.map(([i, label]) => `
      <button onclick="activeRolTab=${i};listaAsistenciaView()" style="
        padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;
        border-bottom:${activeTab===i ? '3px solid #4f46e5' : '3px solid transparent'};
        color:${activeTab===i ? '#4f46e5' : '#6b7280'};
        margin-bottom:-2px;
      ">${label}</button>
    `).join('')}
  </div>`;
}

// ── VISTA PRINCIPAL ────────────────────────────────────────────────────────────
async function listaAsistenciaView() {
  const el = document.getElementById('app');
  if (!attendanceWeekStart) attendanceWeekStart = getMonday(new Date());
  if (!rolWeekStart) rolWeekStart = attendanceWeekStart;

  if (activeRolTab === 0) { await listaRolView(el); return; }
  if (activeRolTab === 2) { await listaTeCalcView(el); return; }

  el.innerHTML = shell('<div class="loading-overlay">Cargando lista de asistencia...</div>', 'lista-asistencia');

  try {
    const role = state.user?.role;
    const [data, rolWeekData] = await Promise.all([
      api(`/api/rhh/schedule/weekly-attendance?week_start=${attendanceWeekStart}`),
      api(`/api/rhh/schedule/weekly-rol?week_start=${attendanceWeekStart}`).catch(() => null)
    ]);
    if (!data) return;
    attendanceData = data;

    // Construir mapa de posición por empleado desde el ROL
    const rolPositionMap = {};
    if (rolWeekData && Array.isArray(rolWeekData.shifts)) {
      for (const sg of rolWeekData.shifts) {
        for (const emp of (sg.employees || [])) {
          if (emp.employee_id && !rolPositionMap[emp.employee_id]) {
            rolPositionMap[emp.employee_id] = emp.position_name || emp.position || sg.shift?.name || null;
          }
        }
      }
    }
    const rolIsPublished = !!(rolWeekData && rolWeekData.published);

    // Load TE postulants summary for supervisors/rh/admin (Automatización 6)
    let tePendingSummaryHtml = '';
    if (['supervisor', 'rh', 'admin'].includes(role)) {
      try {
        const today = fmtDate(new Date());
        const monthStr = today.slice(0, 7);
        const teAuths = await api(`/api/rhh/schedule/te-authorizations?month=${monthStr}`).catch(() => []);
        const approvedTEs = (teAuths || []).filter(t => t.status === 'approved' && t.date >= today);
        if (approvedTEs.length > 0) {
          // For each approved TE, check applications
          const teWithApps = [];
          for (const te of approvedTEs) {
            const apps = await api(`/api/rhh/schedule/te-applications/${te.id}`).catch(() => []);
            const pendingApps = (apps || []).filter(a => a.status === 'pending');
            if (pendingApps.length > 0) {
              teWithApps.push({ te, apps, pendingApps });
            }
          }
          if (teWithApps.length > 0) {
            const totalPending = teWithApps.reduce((s, t) => s + t.pendingApps.length, 0);
            const teItems = teWithApps.map(({ te, apps, pendingApps }) => {
              const shift = state.shifts.find(s => s.id === te.shift_id);
              const appRows = apps.map(a => {
                const empName = a.employee?.full_name || `Emp. ${a.employee_id}`;
                const empNum = a.employee?.employee_number || '';
                let actionHtml = '';
                if (a.status === 'pending') {
                  actionHtml = `<button class="btn-primary" style="font-size:11px;padding:3px 8px;" onclick="selectTEApplicant(${a.id})">Seleccionar</button>`;
                } else if (a.status === 'selected') {
                  actionHtml = `<span class="pill active" style="font-size:11px;">✅ Seleccionado</span>`;
                } else {
                  actionHtml = `<span class="pill rechazada" style="font-size:11px;">✗ Rechazado</span>`;
                }
                return `<tr>
                  <td style="font-size:12px;">${empName} <span style="color:var(--muted);">(${empNum})</span></td>
                  <td style="font-size:12px;">${actionHtml}</td>
                </tr>`;
              }).join('');
              return `
                <div style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px;overflow:hidden;">
                  <div style="background:#f9fafb;padding:8px 12px;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb;">
                    ⚡ ${fmtDateDisplay(te.date)} — ${shift ? shift.name : 'Turno ?'}
                    <span style="font-weight:400;color:var(--muted);margin-left:8px;">${pendingApps.length} postulante${pendingApps.length !== 1 ? 's' : ''} pendiente${pendingApps.length !== 1 ? 's' : ''}</span>
                  </div>
                  <table style="width:100%;"><tbody>${appRows}</tbody></table>
                </div>`;
            }).join('');

            tePendingSummaryHtml = `
              <div id="te-postulants-section" class="card section" style="margin-bottom:16px;border-left:4px solid #f59e0b;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                  <h3 style="margin:0;">⚡ T.E. con postulantes pendientes</h3>
                  <span style="background:#f59e0b;color:#fff;border-radius:12px;padding:2px 10px;font-size:12px;font-weight:700;">${totalPending} pendiente${totalPending !== 1 ? 's' : ''}</span>
                </div>
                ${teItems}
              </div>`;
          }
        }
      } catch (_) {}
    }

    // Recolectar valores únicos para filtros
    const areas = [...new Set(
      data.shifts.flatMap(sg => sg.employees.map(e => e.area)).filter(a => a && a !== '—')
    )].sort();
    const projects = [...new Set(
      data.shifts.flatMap(sg => sg.employees.map(e => e.project)).filter(p => p && p !== '—')
    )].sort();

    const areaOpts = areas.map(a => `<option value="${a}" ${attendanceFilters.area===a?'selected':''}>${a}</option>`).join('');
    const projOpts = projects.map(p => `<option value="${p}" ${attendanceFilters.project===p?'selected':''}>${p}</option>`).join('');
    const shiftOpts = data.shifts.map(sg => `<option value="${sg.shift.code||sg.shift.name}" ${attendanceFilters.shift===(sg.shift.code||sg.shift.name)?'selected':''}>${sg.shift.name}</option>`).join('');

    // Construir cabeceras de días
    const dayHeaders = data.days.map(day => {
      const holidayCls = day.is_holiday ? 'att-day-holiday-head' : '';
      const holidayTip = day.is_holiday ? ` title="${day.holiday_name}"` : '';
      return `
        <th colspan="2" class="${holidayCls}"${holidayTip} style="text-align:center;min-width:150px;">
          ${day.label}${day.is_holiday ? `<br><span style="font-size:10px;font-weight:700;">🎌 ${day.holiday_name}</span>` : ''}
        </th>`;
    }).join('');

    const daySubHeaders = data.days.map(() =>
      `<th style="text-align:center;min-width:90px;">Asistencia</th><th style="text-align:center;min-width:50px;">T.E.</th>`
    ).join('');

    // Construir filas
    let rowsHtml = '';
    for (const shiftGroup of data.shifts) {
      const shiftCode = shiftGroup.shift.code || shiftGroup.shift.name || '?';
      const shiftColor = attShiftColor(shiftCode);
      const empCount = shiftGroup.employees.length;

      // Filtrar empleados según filtros activos
      const filtered = shiftGroup.employees.filter(emp => {
        if (attendanceFilters.area && emp.area !== attendanceFilters.area) return false;
        if (attendanceFilters.project && emp.project !== attendanceFilters.project) return false;
        if (attendanceFilters.shift && (shiftGroup.shift.code || shiftGroup.shift.name) !== attendanceFilters.shift) return false;
        return true;
      });

      if (filtered.length === 0) continue;

      // Fila separadora de turno
      const totalCols = 5 + data.days.length * 2 + 4; // 5 fijas + 14 días cols + 4 totales
      rowsHtml += `
        <tr class="shift-separator" style="--shift-color:${shiftColor};">
          <td colspan="${totalCols}" class="col-name" style="color:#fff;font-size:12px;font-weight:800;letter-spacing:.5px;background:${shiftColor};">
            ━━━ ${shiftGroup.shift.name} · ${empCount} empleado${empCount !== 1 ? 's' : ''}
          </td>
        </tr>`;

      for (const emp of filtered) {
        // Celda puesto
        const hasPosWarn = !emp.enabled_positions || emp.enabled_positions.length === 0;
        const defaultPosDisplay = hasPosWarn ? '⚠ Sin puesto' : (emp.position || '—');
        const posCellCls = hasPosWarn ? 'col-position no-position-warn' : 'col-position';
        const rolPos = rolPositionMap[emp.id];
        let posDisplay;
        if (rolPos) {
          posDisplay = `<span style="background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:700;">🗓️ ${rolPos}</span>`;
        } else if (rolIsPublished) {
          posDisplay = `${defaultPosDisplay}<br><span style="color:#b91c1c;font-size:10px;">⚠ Sin ROL</span>`;
        } else {
          posDisplay = defaultPosDisplay;
        }

        // Celdas de días
        let dayCells = '';
        emp.days.forEach((day, di) => {
          const colors = statusColor(day.status);
          const label = statusLabel(day.status);
          const editable = day.is_editable;
          const editCls = editable ? 'att-cell' : 'att-cell no-editable';
          const isFuture = !!day.is_future;
          const bdayIcon = day.birthday ? `<span class="bday-icon" style="font-size:13px;"> 🎂</span>` : '';
          const bdayDouble = day.birthday_work ? `<span style="font-size:10px;font-weight:800;color:#b45309;display:block;line-height:1;"> ×2</span>` : '';
          let clickHandler = '';
          if (isFuture) {
            clickHandler = `onclick="alert('Esta fecha es futura. Solo se pueden registrar incidencias programadas (vacaciones, permisos, incapacidades).')"`;
          } else if (editable) {
            clickHandler = `onclick="openStatusDropdown(${emp.id},'${day.date}','${day.status}',this)"`;
          }
          const borderStyle = colors.border ? `border:${colors.border};` : '';
          const attCellStyle = day.birthday_work ? `background:${colors.bg};color:${colors.text};${borderStyle}outline:2px solid #f59e0b;` : `background:${colors.bg};color:${colors.text};${borderStyle}`;

          dayCells += `<td style="padding:2px 3px;">
            <div class="${editCls}" data-empid="${emp.id}" data-date="${day.date}"
              style="${attCellStyle}"
              ${clickHandler}>
              ${label}${bdayIcon}${bdayDouble}
            </div>
          </td>`;

          // Celda TE
          const teVal = day.te_hours || 0;
          const teCls = teVal < 0 ? 'te-cell te-negative' : 'te-cell';
          dayCells += `<td style="padding:2px 3px;">
            <div class="${teCls}" data-empid="${emp.id}" data-date="${day.date}"
              onclick="handleTEClick(${emp.id},'${day.date}',${teVal},'${emp.full_name.replace(/'/g,"\\'")}',${isFuture},this)">
              ${teVal !== 0 ? teVal : (isFuture ? '<span style="font-size:9px;color:#94a3b8;">+TE</span>' : '')}
            </div>
          </td>`;
        });

        // Celdas de totales
        const tot = emp.totals;
        const totalsCls = totalsVisible ? 'col-total' : 'col-total hidden';
        rowsHtml += `
          <tr data-area="${emp.area}" data-project="${emp.project}" data-shift="${shiftGroup.shift.code||shiftGroup.shift.name}">
            <td class="col-name" title="${emp.full_name}">${emp.full_name}</td>
            <td class="col-area" style="font-size:11px;">${emp.area}</td>
            <td class="col-project" style="font-size:11px;">${emp.project}</td>
            <td class="${posCellCls}" onclick="openPuestoDropdown(${emp.id},this,${JSON.stringify(emp).replace(/"/g,'&quot;')})" title="Click para editar puestos">${posDisplay}</td>
            <td class="col-shift" style="font-weight:800;color:${shiftColor};">${emp.shift_code}</td>
            ${dayCells}
            <td class="${totalsCls}" style="font-weight:700;color:#16a34a;">${tot.te_total || 0}h</td>
            <td class="${totalsCls}">${tot.dias_pendientes}</td>
            <td class="${totalsCls}" style="color:#1e40af;">${tot.vacaciones_restantes}</td>
            <td class="${totalsCls}" style="color:#9a3412;">${tot.retardos_acumulados}</td>
          </tr>`;
      }
    }

    const totalCols = 5 + data.days.length * 2 + 4;
    const totalsCls = totalsVisible ? 'col-total' : 'col-total hidden';

    const content = `
      <div class="module-title">
        <h2>📋 ROL / Asistencia Semanal</h2>
      </div>
      ${rolTabBar(1)}
      ${tePendingSummaryHtml}

      <div class="attendance-controls">
        <div class="att-week-nav">
          <button class="btn-ghost" onclick="attNavWeek(-1)">‹ Semana anterior</button>
          <span class="att-week-label">${fmtWeekLabel(attendanceWeekStart)}</span>
          <button class="btn-ghost" onclick="attNavWeek(1)">Semana siguiente ›</button>
          <button class="btn-ghost" style="font-size:12px;" onclick="attendanceWeekStart=getMonday(new Date());listaAsistenciaView()">Hoy</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px;">
          <select onchange="attendanceFilters.area=this.value;applyAttFilters()" style="font-size:12px;padding:5px 8px;">
            <option value="">Área: todas</option>${areaOpts}
          </select>
          <select onchange="attendanceFilters.project=this.value;applyAttFilters()" style="font-size:12px;padding:5px 8px;">
            <option value="">Proyecto: todos</option>${projOpts}
          </select>
          <select onchange="attendanceFilters.shift=this.value;applyAttFilters()" style="font-size:12px;padding:5px 8px;">
            <option value="">Turno: todos</option>${shiftOpts}
          </select>
          <button class="btn-toggle-totals" onclick="toggleTotals()">
            ${totalsVisible ? '◀ Ocultar totales' : 'Expandir totales ▶'}
          </button>
          ${['rh','admin'].includes(state.user?.role) ? `<button class="btn-add-holiday" onclick="openHolidayModal()">🎌 + Festivo</button>` : ''}
          ${['rh','admin'].includes(state.user?.role) ? `<label class="btn-ghost" style="cursor:pointer;margin:0;font-size:12px;" title="Importar lista de asistencia desde Excel (mismo formato)">
            ⬆ Importar Excel
            <input type="file" accept=".xlsx,.xls" style="display:none;" onchange="importAsistenciaExcel(this)">
          </label>` : ''}
        </div>
      </div>

      <div class="attendance-wrap">
        <table class="attendance-table" id="att-table">
          <thead>
            <tr>
              <th class="col-name" rowspan="2">Nombre</th>
              <th class="col-area" rowspan="2">Área</th>
              <th class="col-project" rowspan="2">Proyecto</th>
              <th class="col-position" rowspan="2">Puesto</th>
              <th class="col-shift" rowspan="2">Turno</th>
              ${dayHeaders}
              <th class="${totalsCls}" rowspan="2">Total T.E.</th>
              <th class="${totalsCls}" rowspan="2">Días pend.</th>
              <th class="${totalsCls}" rowspan="2">Vacac. rest.</th>
              <th class="${totalsCls}" rowspan="2">Retardos</th>
            </tr>
            <tr>
              ${daySubHeaders}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="${totalCols}" style="text-align:center;padding:32px;color:var(--muted);">Sin empleados para mostrar</td></tr>`}
          </tbody>
        </table>
      </div>

      <div style="margin-top:12px;font-size:11px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;">
        <strong>Leyenda:</strong>
        <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-weight:700;">Asistió</span>
        <span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-weight:700;">Falta</span>
        <span style="background:#ffedd5;color:#9a3412;padding:2px 8px;border-radius:4px;font-weight:700;">Retardo</span>
        <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-weight:700;">Vacaciones</span>
        <span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:4px;font-weight:700;">Permiso</span>
        <span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:4px;font-weight:700;">Festivo</span>
        <span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:4px;font-weight:700;">Descanso</span>
        <span style="background:#f3e8ff;color:#6b21a8;padding:2px 8px;border-radius:4px;font-weight:700;">Cumpleaños</span>
        <span style="background:#e5e7eb;color:#9ca3af;padding:2px 8px;border-radius:4px;font-weight:700;">No opera</span>
      </div>
    `;

    el.innerHTML = shell(content, 'lista-asistencia');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'lista-asistencia');
  }
}

async function selectTEApplicant(appId) {
  try {
    await api(`/api/rhh/schedule/te-applications/${appId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'selected' })
    });
    toast('Empleado seleccionado para T.E.');
    listaAsistenciaView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function toggleTotals() {
  totalsVisible = !totalsVisible;
  const cols = document.querySelectorAll('.col-total');
  cols.forEach(c => c.classList.toggle('hidden', !totalsVisible));
  const btn = document.querySelector('.btn-toggle-totals');
  if (btn) btn.textContent = totalsVisible ? '◀ Ocultar totales' : 'Expandir totales ▶';
}

function applyAttFilters() {
  // Los filtros son client-side: mostrar/ocultar filas según data-atributos
  const table = document.getElementById('att-table');
  if (!table) return;
  const rows = table.querySelectorAll('tbody tr:not(.shift-separator)');
  rows.forEach(row => {
    const area = row.dataset.area || '';
    const project = row.dataset.project || '';
    const shift = row.dataset.shift || '';
    let visible = true;
    if (attendanceFilters.area && area !== attendanceFilters.area) visible = false;
    if (attendanceFilters.project && project !== attendanceFilters.project) visible = false;
    if (attendanceFilters.shift && shift !== attendanceFilters.shift) visible = false;
    row.style.display = visible ? '' : 'none';
  });
  // Ocultar separadores de turno si todos sus hijos están ocultos
  const separators = table.querySelectorAll('tbody tr.shift-separator');
  separators.forEach(sep => {
    let next = sep.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('shift-separator')) {
      if (next.style.display !== 'none') { hasVisible = true; break; }
      next = next.nextElementSibling;
    }
    sep.style.display = hasVisible ? '' : 'none';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICACIONES RHH (Automatización 6)
// ══════════════════════════════════════════════════════════════════════════════

let _notifPanelOpen = false;

async function loadNotifBadge() {
  try {
    const list = await api('/api/rhh/notifications');
    if (!list) return;
    const unread = list.filter(n => !n.read).length;
    const badge = document.getElementById('rhhNotifBadge');
    if (badge) {
      if (unread > 0) {
        badge.style.display = 'block';
        badge.textContent = unread > 9 ? '9+' : unread;
      } else {
        badge.style.display = 'none';
      }
    }
    return list;
  } catch (_) {}
}

async function toggleNotifPanel() {
  const panel = document.getElementById('rhhNotifPanel');
  if (!panel) return;
  _notifPanelOpen = !_notifPanelOpen;
  panel.style.display = _notifPanelOpen ? 'block' : 'none';
  if (_notifPanelOpen) {
    await renderNotifList();
  }
}

async function renderNotifList() {
  const listEl = document.getElementById('rhhNotifList');
  if (!listEl) return;
  try {
    const list = await api('/api/rhh/notifications');
    if (!list) return;
    if (list.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">Sin notificaciones</div>';
      return;
    }
    listEl.innerHTML = list.map(n => `
      <div style="padding:10px 16px;border-bottom:1px solid #f3f4f6;${n.read ? 'opacity:0.6;' : 'background:#f0fdf4;'}">
        <div style="font-size:13px;font-weight:${n.read ? 400 : 700};">${n.title}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">${n.message}</div>
        ${!n.read ? `<button class="btn-ghost" style="font-size:11px;margin-top:4px;padding:2px 6px;" onclick="markNotifRead(${n.id})">Marcar leída</button>` : ''}
      </div>`).join('');
    // Actualizar badge
    const unread = list.filter(n => !n.read).length;
    const badge = document.getElementById('rhhNotifBadge');
    if (badge) {
      badge.style.display = unread > 0 ? 'block' : 'none';
      badge.textContent = unread > 9 ? '9+' : unread;
    }
  } catch (err) {
    listEl.innerHTML = `<div style="padding:12px;color:#b91c1c;font-size:12px;">${err.message}</div>`;
  }
}

async function markNotifRead(id) {
  try {
    await api(`/api/rhh/notifications/${id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) });
    await renderNotifList();
  } catch (err) { toast(err.message, 'error'); }
}

async function markAllNotifsRead() {
  try {
    await api('/api/rhh/notifications/read-all', { method: 'PATCH' });
    await renderNotifList();
    toast('Notificaciones marcadas como leídas');
  } catch (err) { toast(err.message, 'error'); }
}

// Cerrar panel al hacer click fuera
document.addEventListener('click', (e) => {
  const panel = document.getElementById('rhhNotifPanel');
  const btn = document.getElementById('rhhNotifBtn');
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.style.display = 'none';
    _notifPanelOpen = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// REGLAS DE VACACIONES — tab en catálogos (Automatización 4)
// ══════════════════════════════════════════════════════════════════════════════

async function buildVacRulesTab() {
  let rulesData;
  try {
    rulesData = await api('/api/rhh/incidences/vacation-rules');
  } catch (_) {
    rulesData = { rules: [], max_days_per_week: 1, count_holidays: true };
  }

  const rules = rulesData.rules || [];
  const rulesRows = rules.map((r, i) => `
    <tr>
      <td><input type="number" class="vr-maxdays" data-idx="${i}" value="${r.max_days}" style="width:70px;" /></td>
      <td><input type="number" class="vr-advance" data-idx="${i}" value="${r.min_advance_days}" style="width:70px;" /></td>
      <td><input type="text" class="vr-label" data-idx="${i}" value="${r.label || ''}" style="width:260px;" /></td>
      <td><button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="removeVacRule(${i})">🗑️</button></td>
    </tr>`).join('');

  return `
    <div class="card section">
      <h3>Reglas de vacaciones</h3>
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
        <label style="font-weight:600;display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="vr-count-holidays" ${rulesData.count_holidays ? 'checked' : ''} />
          Contar festivos en el cálculo de días
        </label>
        <label style="font-weight:600;">
          Máx. días por semana:
          <input type="number" id="vr-max-week" value="${rulesData.max_days_per_week || 1}" style="width:60px;margin-left:6px;" />
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Hasta N días</th>
            <th>Anticipación mínima (días)</th>
            <th>Descripción</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody id="vr-rules-body">
          ${rulesRows || '<tr><td colspan="4" style="text-align:center;color:var(--muted);">Sin reglas configuradas</td></tr>'}
        </tbody>
      </table>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn-ghost" onclick="addVacRule()">+ Agregar regla</button>
        <button class="btn-primary" onclick="saveVacRules()">💾 Guardar cambios</button>
      </div>
    </div>`;
}

function addVacRule() {
  const tbody = document.getElementById('vr-rules-body');
  if (!tbody) return;
  const idx = tbody.querySelectorAll('tr').length;
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="number" class="vr-maxdays" data-idx="${idx}" value="1" style="width:70px;" /></td>
    <td><input type="number" class="vr-advance" data-idx="${idx}" value="1" style="width:70px;" /></td>
    <td><input type="text" class="vr-label" data-idx="${idx}" value="" style="width:260px;" /></td>
    <td><button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="this.closest('tr').remove()">🗑️</button></td>`;
  tbody.appendChild(row);
}

function removeVacRule(idx) {
  const tbody = document.getElementById('vr-rules-body');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  if (rows[idx]) rows[idx].remove();
}

async function saveVacRules() {
  const countHolidays = document.getElementById('vr-count-holidays')?.checked ?? true;
  const maxWeek = Number(document.getElementById('vr-max-week')?.value) || 1;
  const tbody = document.getElementById('vr-rules-body');
  if (!tbody) return;

  const rules = [];
  const rows = tbody.querySelectorAll('tr');
  rows.forEach(row => {
    const maxDays = Number(row.querySelector('.vr-maxdays')?.value) || 1;
    const minAdv = Number(row.querySelector('.vr-advance')?.value) || 1;
    const label = row.querySelector('.vr-label')?.value?.trim() || '';
    rules.push({ max_days: maxDays, min_advance_days: minAdv, label });
  });

  try {
    await api('/api/rhh/incidences/vacation-rules', {
      method: 'PATCH',
      body: JSON.stringify({ rules, max_days_per_week: maxWeek, count_holidays: countHolidays })
    });
    toast('Reglas de vacaciones actualizadas');
    catalogosView();
  } catch (err) { toast(err.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO CONTROL DE ASISTENCIAS
// ══════════════════════════════════════════════════════════════════════════════

function asisTabs(active) {
  const tabs = ['📋 Rol Semanal', '✏️ Capturar Asistencia', '📊 Lista de Asistencia'];
  return `<div class="tab-bar" style="margin-bottom:16px;">
    ${tabs.map((t,i)=>`<button class="tab-btn ${i===active?'active':''}" onclick="asisTab=${i};asistenciasView()">${t}</button>`).join('')}
  </div>`;
}

function asisNavWeek(dir) {
  const d = new Date(asisWeek + 'T12:00:00');
  d.setDate(d.getDate() + dir * 7);
  asisWeek = d.toISOString().slice(0, 10);
  asistenciasView();
}

/* Short day+date label from YYYY-MM-DD */
function asisDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  return `${dias[d.getDay()]} ${d.getDate()}`;
}

function asistenciasView() {
  if (!asisWeek) asisWeek = getMonday(new Date());
  if (asisTab === 0) { asisRolView(); return; }
  if (asisTab === 1) { asisCaptureView(); return; }
  asisListaView();
}

// ── Tab 0: Rol Semanal ────────────────────────────────────────────────────────
// _asisAssignments: [{ employee_id, shift_id, position_id, project, full_name, pos_name, shift_name }]
async function asisRolView() {
  const el = document.getElementById('app');
  if (!asisWeek) asisWeek = getMonday(new Date());
  el.innerHTML = shell('<div class="loading-overlay">Cargando rol...</div>', 'asistencias');

  try {
    const data = await api(`/api/rhh/asistencia/rol?week=${asisWeek}`);
    if (!data) return;

    const shifts    = data.shifts    || [];
    const positions = data.positions || [];
    const proyectos = data.proyectos || ['SKF','AMSTED','TENNECO'];
    const unassigned = data.unassigned || [];

    // Populate _asisAssignments from backend (reset each load)
    _asisAssignments = (data.assigned || []).map(emp => ({
      employee_id: emp.id,
      shift_id:    emp.assignment?.shift_id   ?? emp.shift_id,
      position_id: emp.assignment?.position_id ?? emp.position_id ?? null,
      project:     emp.assignment?.project     ?? null,
      full_name:   emp.full_name,
      pos_name:    emp.position?.name || '',
      shift_name:  emp.shift?.name    || '',
    }));

    const shiftOpts = shifts.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
    const posOpts   = positions.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
    const projOpts  = proyectos.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');

    const unassignedRows = unassigned.length
      ? unassigned.map(emp => `
          <div onclick="openAsisAssignModal(${emp.id},'${emp.full_name.replace(/'/g,'&#39;')}')"
            style="cursor:pointer;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;background:#fff;display:flex;justify-content:space-between;align-items:center;"
            onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#e5e7eb'">
            <span style="font-size:13px;">${escHtml(emp.full_name)}</span>
            <span style="font-size:11px;color:var(--muted);">${escHtml(emp.shift?.name||'')}</span>
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px;">Todos asignados ✓</div>';

    let shiftsHtml = '';
    for (const shift of shifts) {
      const assigned = _asisAssignments.filter(a => a.shift_id === shift.id);
      const rows = assigned.length
        ? assigned.map(a => `
            <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid #f3f4f6;">
              <span style="flex:1;font-size:13px;">${escHtml(a.full_name)}</span>
              <span style="font-size:11px;color:#6366f1;background:#eef2ff;padding:2px 6px;border-radius:4px;">${escHtml(a.pos_name||'—')}</span>
              <span style="font-size:11px;color:#0369a1;background:#e0f2fe;padding:2px 6px;border-radius:4px;">${escHtml(a.project||'—')}</span>
              <button onclick="removeAsisAssignment(${a.employee_id})"
                style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:16px;line-height:1;padding:0 2px;" title="Quitar">×</button>
            </div>`)
          .join('')
        : '<div style="font-size:12px;color:var(--muted);padding:10px;text-align:center;">Sin asignados</div>';

      const shiftColor = attShiftColor(shift.code || shift.name || '?');
      shiftsHtml += `
        <div class="card section" style="margin-bottom:12px;border-left:4px solid ${shiftColor};">
          <div style="font-weight:700;color:${shiftColor};margin-bottom:8px;font-size:14px;">
            ${escHtml(shift.name)}
            <span style="font-weight:400;font-size:12px;color:var(--muted);margin-left:6px;">${assigned.length} empleado${assigned.length!==1?'s':''}</span>
          </div>
          ${rows}
        </div>`;
    }

    const content = `
      <div class="module-title"><h2>🗓️ Control de Asistencias</h2></div>
      ${asisTabs(0)}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="btn-ghost" onclick="asisNavWeek(-1)">‹ Anterior</button>
        <span style="font-weight:700;">${fmtWeekLabel(asisWeek)}</span>
        <button class="btn-ghost" onclick="asisNavWeek(1)">Siguiente ›</button>
        <button class="btn-ghost" style="font-size:12px;" onclick="asisWeek=getMonday(new Date());asistenciasView()">Hoy</button>
        <div style="margin-left:auto;display:flex;gap:8px;">
          <button class="btn-ghost" onclick="window.open('/api/rhh/asistencia/rol/html?week=${asisWeek}','_blank')">🖨️ Imprimir</button>
          <button class="btn-primary" onclick="saveAsisRol()">💾 Guardar Rol</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:start;">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">Sin asignar (${unassigned.length})</div>
          ${unassignedRows}
        </div>
        <div>${shiftsHtml || '<div class="notice">No hay turnos configurados</div>'}</div>
      </div>

      <!-- Modal asignación -->
      <div id="asis-assign-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;place-items:center;">
        <div style="background:#fff;border-radius:16px;padding:24px;width:min(380px,95vw);box-shadow:0 16px 48px rgba(0,0,0,.2);">
          <h3 style="margin:0 0 4px;font-size:15px;">Asignar al Rol</h3>
          <div id="asis-assign-emp-name" style="color:var(--muted);font-size:13px;margin-bottom:16px;"></div>
          <input type="hidden" id="asis-assign-emp-id" />
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Turno</label>
          <select id="asis-assign-shift" style="width:100%;margin-bottom:12px;padding:7px;border:1px solid #e5e7eb;border-radius:8px;">${shiftOpts}</select>
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Puesto</label>
          <select id="asis-assign-puesto" style="width:100%;margin-bottom:12px;padding:7px;border:1px solid #e5e7eb;border-radius:8px;">
            <option value="">— Sin puesto —</option>${posOpts}
          </select>
          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Proyecto</label>
          <select id="asis-assign-proyecto" style="width:100%;margin-bottom:16px;padding:7px;border:1px solid #e5e7eb;border-radius:8px;">
            <option value="">— Sin proyecto —</option>${projOpts}
          </select>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn-ghost" onclick="document.getElementById('asis-assign-modal').style.display='none'">Cancelar</button>
            <button class="btn-primary" onclick="confirmAsisAssign()">Asignar</button>
          </div>
        </div>
      </div>`;

    el.innerHTML = shell(content, 'asistencias');
  } catch(err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'asistencias');
  }
}

function openAsisAssignModal(empId, empName) {
  const m = document.getElementById('asis-assign-modal');
  if (!m) return;
  document.getElementById('asis-assign-emp-id').value = empId;
  document.getElementById('asis-assign-emp-name').textContent = empName;
  m.style.display = 'grid';
}

function removeAsisAssignment(empId) {
  _asisAssignments = _asisAssignments.filter(a => a.employee_id !== empId);
  asisRolView();
}

function confirmAsisAssign() {
  const empId     = Number(document.getElementById('asis-assign-emp-id').value);
  const shiftId   = Number(document.getElementById('asis-assign-shift').value);
  const posId     = document.getElementById('asis-assign-puesto').value;
  const project   = document.getElementById('asis-assign-proyecto').value;
  const posName   = document.getElementById('asis-assign-puesto').selectedOptions[0]?.text || '';
  const shiftName = document.getElementById('asis-assign-shift').selectedOptions[0]?.text || '';
  const emp = state.employees.find(e => e.id === empId);
  const fullName = emp?.full_name || `Emp. ${empId}`;

  _asisAssignments = _asisAssignments.filter(a => a.employee_id !== empId);
  _asisAssignments.push({
    employee_id: empId, shift_id: shiftId,
    position_id: posId ? Number(posId) : null,
    project: project || null,
    full_name: fullName, pos_name: posName, shift_name: shiftName,
  });

  document.getElementById('asis-assign-modal').style.display = 'none';
  asisRolView();
}

async function saveAsisRol() {
  try {
    await api('/api/rhh/asistencia/rol', {
      method: 'POST',
      body: JSON.stringify({
        week_start: asisWeek,
        assignments: _asisAssignments.map(a => ({
          employee_id: a.employee_id,
          shift_id:    a.shift_id,
          position_id: a.position_id || null,
          project:     a.project     || null,
        }))
      })
    });
    toast('Rol guardado correctamente');
  } catch(err) { toast(err.message, 'error'); }
}

// ── Tab 1: Capturar Asistencia ────────────────────────────────────────────────
async function asisCaptureView() {
  const el = document.getElementById('app');
  if (!asisWeek) asisWeek = getMonday(new Date());
  el.innerHTML = shell('<div class="loading-overlay">Cargando...</div>', 'asistencias');

  try {
    const url = `/api/rhh/asistencia/diaria?week=${asisWeek}${asisShiftId ? '&shift_id='+asisShiftId : ''}`;
    const data = await api(url);
    if (!data) return;

    const shifts    = data.shifts    || [];
    const dates     = data.dates     || [];   // ['YYYY-MM-DD', ...]
    const grid      = data.grid      || [];
    const proyectos = data.proyectos || ['SKF','AMSTED','TENNECO'];
    const role = state.user?.role;
    const canParoTecnico = ['rh','admin'].includes(role);

    if (asisDayIdx >= dates.length) asisDayIdx = 0;
    const selFecha = dates[asisDayIdx] || null;

    const shiftOpts = shifts.map(s =>
      `<option value="${s.id}" ${asisShiftId==s.id?'selected':''}>${escHtml(s.name)}</option>`
    ).join('');

    const dayTabsHtml = dates.map((fecha, i) => {
      const label = asisDateLabel(fecha);
      return `<button class="tab-btn ${i===asisDayIdx?'active':''}" onclick="asisDayIdx=${i};asisCaptureView()">${label}</button>`;
    }).join('');

    let rowsHtml = '';
    if (selFecha) {
      for (const emp of grid) {
        const dayData = (emp.days||[]).find(d => d.fecha === selFecha) || {};
        const inc   = dayData.incidencia_type || 'labora';
        const auto  = !!dayData.is_auto;
        const incType = ASIST_INC_TYPES.find(t => t.v === inc) || ASIST_INC_TYPES[0];
        const selStyle = `background:${incType.bg};color:${incType.fg};`;
        const incSelOpts = ASIST_INC_TYPES
          .filter(t => canParoTecnico || t.v !== 'paro_tecnico')
          .map(t => `<option value="${t.v}" ${inc===t.v?'selected':''}>${t.l}</option>`)
          .join('');
        const projOpts = proyectos.map(p =>
          `<option value="${p}" ${dayData.proyecto===p?'selected':''}>${p}</option>`
        ).join('');

        rowsHtml += `<tr>
          <td style="padding:8px 10px;font-size:13px;">${escHtml(emp.full_name)}</td>
          <td style="padding:8px 10px;font-size:12px;color:var(--muted);">${escHtml(emp.position||'—')}</td>
          <td style="padding:4px 6px;">
            <select data-emp="${emp.employee_id}" data-fecha="${selFecha}" class="asis-inc-sel"
              ${auto?'disabled title="Detectado automáticamente"':''}
              style="width:100%;padding:5px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;${selStyle}"
              onchange="var t=ASIST_INC_TYPES.find(x=>x.v===this.value)||ASIST_INC_TYPES[0];this.style.background=t.bg;this.style.color=t.fg;">
              ${incSelOpts}
            </select>
          </td>
          <td style="padding:4px 6px;">
            <select data-emp="${emp.employee_id}" data-fecha="${selFecha}" class="asis-proj-sel"
              style="width:100%;padding:5px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;">
              <option value="" ${!dayData.proyecto?'selected':''}>— Sin proyecto —</option>
              ${projOpts}
            </select>
          </td>
          <td style="padding:0 6px;font-size:11px;color:var(--muted);">${auto?'auto':''}</td>
        </tr>`;
      }
    }

    const content = `
      <div class="module-title"><h2>🗓️ Control de Asistencias</h2></div>
      ${asisTabs(1)}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button class="btn-ghost" onclick="asisNavWeek(-1)">‹ Anterior</button>
        <span style="font-weight:700;">${fmtWeekLabel(asisWeek)}</span>
        <button class="btn-ghost" onclick="asisNavWeek(1)">Siguiente ›</button>
        <button class="btn-ghost" style="font-size:12px;" onclick="asisWeek=getMonday(new Date());asistenciasView()">Hoy</button>
        <select onchange="asisShiftId=this.value;asisCaptureView()"
          style="margin-left:auto;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;">
          <option value="">Todos los turnos</option>${shiftOpts}
        </select>
      </div>
      <div class="tab-bar" style="margin-bottom:12px;">${dayTabsHtml||'<span style="color:var(--muted);font-size:13px;">Sin días</span>'}</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:480px;">
          <thead>
            <tr style="background:#f9fafb;font-size:12px;color:var(--muted);">
              <th style="padding:8px 10px;text-align:left;font-weight:600;">Empleado</th>
              <th style="padding:8px 10px;text-align:left;font-weight:600;">Puesto</th>
              <th style="padding:8px 10px;text-align:left;font-weight:600;min-width:140px;">Incidencia</th>
              <th style="padding:8px 10px;text-align:left;font-weight:600;min-width:130px;">Proyecto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">Sin empleados en este turno</td></tr>`}</tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button class="btn-primary" onclick="saveAsisCaptureDay('${selFecha||''}')">💾 Guardar día</button>
      </div>`;

    el.innerHTML = shell(content, 'asistencias');
  } catch(err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'asistencias');
  }
}

async function saveAsisCaptureDay(fecha) {
  if (!fecha) { toast('Selecciona un día válido', 'warning'); return; }
  const incSels = document.querySelectorAll(`.asis-inc-sel[data-fecha="${fecha}"]`);
  const records = [];
  incSels.forEach(sel => {
    if (sel.disabled) return;
    const empId = Number(sel.getAttribute('data-emp'));
    const incidencia_type = sel.value;
    const projSel = document.querySelector(`.asis-proj-sel[data-emp="${empId}"][data-fecha="${fecha}"]`);
    const proyecto = projSel ? projSel.value : '';
    records.push({ employee_id: empId, fecha, incidencia_type, proyecto: proyecto || null });
  });

  if (!records.length) { toast('Sin cambios manuales que guardar', 'warning'); return; }

  try {
    await api('/api/rhh/asistencia/diaria/bulk', {
      method: 'POST',
      body: JSON.stringify({ records })
    });
    toast(`${records.length} registro${records.length!==1?'s':''} guardado${records.length!==1?'s':''}`);
  } catch(err) { toast(err.message, 'error'); }
}

// ── Tab 2: Lista de Asistencia ────────────────────────────────────────────────
async function asisListaView() {
  const el = document.getElementById('app');
  if (!asisWeek) asisWeek = getMonday(new Date());
  el.innerHTML = shell('<div class="loading-overlay">Cargando lista...</div>', 'asistencias');

  try {
    const url = `/api/rhh/asistencia/semana?week=${asisWeek}${asisShiftId ? '&shift_id='+asisShiftId : ''}`;
    const data = await api(url);
    if (!data) return;

    const shifts = data.shifts || [];
    const dates  = data.dates  || [];
    const grid   = data.grid   || [];

    const dayHeaders = dates.map(fecha => `
      <th style="text-align:center;min-width:80px;padding:6px 4px;font-size:12px;font-weight:600;">${asisDateLabel(fecha)}</th>
    `).join('');

    let rowsHtml = '';
    let lastShift = null;
    for (const emp of grid) {
      if (emp.shift_name !== lastShift) {
        const sc = attShiftColor(emp.shift_name || '?');
        rowsHtml += `<tr><td colspan="${3+dates.length}" style="background:${sc};color:#fff;font-size:12px;font-weight:800;padding:6px 12px;letter-spacing:.5px;">━━━ ${escHtml(emp.shift_name||'Sin turno')}</td></tr>`;
        lastShift = emp.shift_name;
      }
      const dayCells = dates.map(fecha => {
        const rec = (emp.days||[]).find(dr => dr.fecha === fecha);
        const inc = rec?.incidencia_type || 'descanso';
        const t   = ASIST_INC_TYPES.find(x => x.v === inc) || { l: inc, bg:'#f9fafb', fg:'#9ca3af' };
        return `<td style="text-align:center;padding:4px 2px;"><span style="display:inline-block;padding:3px 7px;border-radius:6px;font-size:11px;font-weight:600;background:${t.bg};color:${t.fg};">${t.l}</span></td>`;
      }).join('');

      rowsHtml += `<tr>
        <td style="padding:6px 10px;font-size:13px;">${escHtml(emp.full_name)}</td>
        <td style="padding:6px 10px;font-size:12px;color:var(--muted);">${escHtml(emp.position||'—')}</td>
        <td style="padding:6px 10px;font-size:12px;color:var(--muted);">${escHtml(emp.project||'—')}</td>
        ${dayCells}
      </tr>`;
    }

    const shiftOpts = shifts.map(s =>
      `<option value="${s.id}" ${asisShiftId==s.id?'selected':''}>${escHtml(s.name)}</option>`
    ).join('');

    const legend = ASIST_INC_TYPES.map(t =>
      `<span style="background:${t.bg};color:${t.fg};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;display:inline-block;">${t.l}</span>`
    ).join(' ');

    const content = `
      <div class="module-title"><h2>🗓️ Control de Asistencias</h2></div>
      ${asisTabs(2)}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button class="btn-ghost" onclick="asisNavWeek(-1)">‹ Anterior</button>
        <span style="font-weight:700;">${fmtWeekLabel(asisWeek)}</span>
        <button class="btn-ghost" onclick="asisNavWeek(1)">Siguiente ›</button>
        <button class="btn-ghost" style="font-size:12px;" onclick="asisWeek=getMonday(new Date());asistenciasView()">Hoy</button>
        <select onchange="asisShiftId=this.value;asisListaView()"
          style="margin-left:auto;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;">
          <option value="">Todos los turnos</option>${shiftOpts}
        </select>
      </div>
      <div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;">${legend}</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:600px;">
          <thead>
            <tr style="background:#f9fafb;font-size:12px;color:var(--muted);">
              <th style="padding:8px 10px;text-align:left;font-weight:600;">Empleado</th>
              <th style="padding:8px 10px;text-align:left;font-weight:600;">Puesto</th>
              <th style="padding:8px 10px;text-align:left;font-weight:600;">Proyecto</th>
              ${dayHeaders}
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="${3+dates.length}" style="text-align:center;padding:24px;color:var(--muted);">Sin datos para esta semana</td></tr>`}</tbody>
        </table>
      </div>`;

    el.innerHTML = shell(content, 'asistencias');
  } catch(err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'asistencias');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════════════
function render() {
  const el = document.getElementById('app');
  if (!el) return;

  if (!state.user) {
    el.innerHTML = loginView();
    return;
  }

  let hash = location.hash.slice(1) || 'dashboard';
  // Keep notification badge current on every navigation
  setTimeout(() => loadNotifBadge(), 200);
  const role = state.user.role;

  // Redirigir programacion-te → lista-asistencia en tab 2
  if (hash === 'programacion-te') {
    activeRolTab = 2;
    hash = 'lista-asistencia';
  }

  // Vista por hash
  const views = {
    dashboard: dashboardView,
    calendario: () => { window.location.hash = '#dashboard'; },
    asignacion: asignacionView,
    'lista-asistencia': listaAsistenciaView,
    empleados: empleadosView,
    incidencias: incidenciasView,
    autorizaciones: autorizacionesView,
    'ausencias-hoy': ausenciasHoyView,
    'mi-horario': miHorarioView,
    'mis-solicitudes': misSolicitudesView,
    'mis-incidencias': misIncidenciasView,
    prenomina: prenominaView,
    'lista-raya': listaRayaView,
    catalogos: catalogosView,
    reportes: reportesView,
    perfil: perfilView,
    'programacion-te': listaAsistenciaView,
    'queja-anonima': quejaAnonimView,
    'quejas-rh': quejasRHView,
    'aclaracion-nomina': aclaracionNominaView,
    'aclaraciones-rh': aclaracionesRHView,
    vacantes: vacantesView,
    evaluaciones: evaluacionesView,
    'mis-evaluaciones': misEvaluacionesView,
    plantillas: plantillasView,
    checador: checadorView,
    asistencias: asistenciasView,
    'catalogo-empleados': catalogoEmpleadosView
  };

  const viewFn = views[hash];
  if (viewFn) {
    viewFn();
  } else {
    // Default por rol
    const defaultView = MENU_BY_ROLE[role]?.[0]?.[0];
    if (defaultView && views[defaultView]) {
      views[defaultView]();
    } else {
      el.innerHTML = shell('<div class="notice">Vista no encontrada</div>', hash);
    }
  }
}

// ── Inicialización ────────────────────────────────────────────────────────────
async function init() {
  const savedToken = localStorage.getItem('rhh_token');
  if (savedToken) {
    state.token = savedToken;
    try {
      const user = await api('/api/rhh/auth/me');
      if (user) {
        state.user = user;
        await loadCatalogs();
      } else {
        state.token = null;
        localStorage.removeItem('rhh_token');
      }
    } catch (_) {
      state.token = null;
      localStorage.removeItem('rhh_token');
    }
  }
  render();
}


// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO CHECADOR
// ══════════════════════════════════════════════════════════════════════════════

// Estado local del módulo checador
const checadorState = {
  tab: 0,
  preview: null,
  csvText: '',
  filterDate: '',
  filterDateTo: '',
  filterStatus: '',
  filterEmp: '',
  records: [],
  mappings: [],
  absences: [],
  absenceFrom: '',
  absenceTo: '',
  absenceLoading: false,
  parseFrom: '',
  parseTo: '',
  calWeekOff: 0,
};

const CHECADOR_TABS = ['📥 Importar', '🔗 Mapear trabajadores', '📋 Registros', '✅ Validar', '🚫 Inasistencias', '📅 Calendario', '🗑 Limpieza'];
const TURNO_COLORS = { 'Turno 1': '#1d4ed8', 'Turno 2': '#0f766e', 'Turno 3': '#7c3aed', 'Administrativo': '#b45309', 'Turno Administrativo': '#10b981' };

function turnoChip(name) {
  const color = TURNO_COLORS[name] || '#64748b';
  return '<span style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;border-radius:9999px;padding:2px 8px;font-size:11px;font-weight:600;">' + name + '</span>';
}

function statusChipCh(status) {
  const map = { pendiente: ['#b45309','Pendiente'], validado: ['#15803d','Validado'], ignorado: ['#64748b','Ignorado'] };
  const [c, label] = map[status] || ['#64748b', status];
  return '<span style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55;border-radius:9999px;padding:2px 8px;font-size:11px;font-weight:600;">' + label + '</span>';
}

function fmtWorked(minutes) {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return h + 'h ' + String(m).padStart(2,'0') + 'm';
}

function diaSemana(dateIso) {
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  return dias[new Date(dateIso + 'T12:00:00Z').getUTCDay()];
}

async function checadorView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando checador...</div>', 'checador');
  try {
    const [mappingsRes, recordsRes] = await Promise.all([
      api('/api/rhh/checador/mappings'),
      api('/api/rhh/checador/records'),
    ]);
    checadorState.mappings = mappingsRes || [];
    checadorState.records  = recordsRes  || [];
  } catch (_) {}
  renderChecador();
}

function renderChecador() {
  const el = document.getElementById('app');
  const tabsHtml = CHECADOR_TABS.map((t, i) =>
    '<button class="tab-btn' + (checadorState.tab === i ? ' active' : '') + '" onclick="checadorSetTab(' + i + ')">' + t + '</button>'
  ).join('');
  let body = '';
  if      (checadorState.tab === 0) body = renderChecadorImportar();
  else if (checadorState.tab === 1) body = renderChecadorMapear();
  else if (checadorState.tab === 2) body = renderChecadorRegistros();
  else if (checadorState.tab === 3) body = renderChecadorValidar();
  else if (checadorState.tab === 4) body = renderChecadorInasistencias();
  else if (checadorState.tab === 5) body = renderChecadorCalendario();
  else if (checadorState.tab === 6) body = renderChecadorLimpieza();
  const content = '<div class="section-header"><h2>&#128336; Checador &mdash; Importaci&oacute;n y An&aacute;lisis</h2></div>' +
    '<div class="tab-bar" style="margin-bottom:16px;">' + tabsHtml + '</div>' + body;
  el.innerHTML = shell(content, 'checador');
}

function checadorSetTab(i) { checadorState.tab = i; renderChecador(); }

window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', init);

// ── Exportar / Importar Base de Empleados (Excel) ─────────────────────────────

async function exportEmpleadosExcel() {
  try {
    toast('Generando archivo...', 'info');
    const resp = await fetch('/api/rhh/employees/export-excel', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('rhh_token') || '') }
    });
    if (!resp.ok) { const e = await resp.json().catch(()=>({})); throw new Error(e.error || 'Error al exportar'); }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `BASE_DE_DATOS_COLABORADORES_${fecha}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Archivo descargado');
  } catch (err) { toast(err.message, 'error'); }
}

async function importEmpleadosExcel(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  toast('Leyendo archivo...', 'info');
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const preview = await api('/api/rhh/employees/import-excel', {
      method: 'POST',
      body: JSON.stringify({ file_base64: b64, mode: 'preview' })
    });
    showImportExcelModal(preview);
  } catch (err) { toast(err.message || 'Error al leer archivo', 'error'); }
}

function showImportExcelModal(preview) {
  const { exact_duplicates = [], similar_name = [], truly_new = [], total = 0 } = preview;

  // Estado global del modal
  window._importResolutions = {};
  window._importEdits       = {};   // key → campos editados manualmente
  window._importRows        = [];   // idx → { key, incoming }
  window._importPreview     = preview;

  // Defaults de resolución
  for (const d of exact_duplicates) {
    const key = d.incoming.email || d.incoming.full_name;
    window._importResolutions[key] = d.matches[0] ? `update:${d.matches[0].id}` : 'create';
  }
  for (const s of similar_name) {
    const key = s.incoming.email || s.incoming.full_name;
    window._importResolutions[key] = 'create';
  }

  // Cambiar resolución (botones de acción)
  window._setImportRes = function(idx, value) {
    const row = window._importRows[idx];
    if (!row) return;
    window._importResolutions[row.key] = value;
    const grp = document.querySelector(`[data-resgrp="${idx}"]`);
    if (grp) grp.querySelectorAll('.res-btn').forEach(b => {
      const on = b.dataset.val === value;
      b.style.background = on ? '#064e3b' : '';
      b.style.color = on ? '#fff' : '';
      b.style.fontWeight = on ? '700' : '';
    });
  };

  // Abrir / cerrar mini-formulario de edición
  window._toggleImportEdit = function(idx) {
    const existing = document.getElementById('ief-' + idx);
    if (existing) { existing.remove(); return; }
    const row = window._importRows[idx];
    if (!row) return;
    const data = { ...row.incoming, ...(window._importEdits[row.key] || {}) };
    const tr = document.querySelector(`tr[data-rowid="${idx}"]`);
    if (!tr) return;

    function fi(id, label, val, type) {
      return `<div>
        <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px;">${label}</label>
        <input id="ief-${idx}-${id}" type="${type||'text'}" value="${(val||'').toString().replace(/"/g,'&quot;')}"
          style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;" />
      </div>`;
    }
    function fs(id, label, val, opts) {
      return `<div>
        <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px;">${label}</label>
        <select id="ief-${idx}-${id}" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;">
          ${opts.map(o=>`<option value="${o}" ${val===o?'selected':''}>${o||'—'}</option>`).join('')}
        </select>
      </div>`;
    }

    const formHtml = `
      <tr id="ief-${idx}">
        <td colspan="3" style="padding:0 8px 12px;">
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <strong style="font-size:12px;color:#0369a1;">✏️ Editar datos antes de importar</strong>
              <span style="font-size:11px;color:#6b7280;">(el correo se elige en la fila de arriba)</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:12px;">
              ${fi('full_name','Nombre completo',data.full_name)}
              ${fi('nomina_number','No. Nómina',data.nomina_number)}
              ${fi('rfc','RFC',data.rfc)}
              ${fi('curp','CURP',data.curp)}
              ${fi('nss','NSS',data.nss)}
              ${fi('phone','Teléfono',data.phone)}
              ${fi('hire_date','Fecha de ingreso',data.hire_date,'date')}
              ${fi('birth_date','Fecha de nacimiento',data.birth_date,'date')}
              ${fi('daily_salary','Salario diario',data.daily_salary,'number')}
              ${fi('position_name','Puesto',data.position_name)}
              ${fi('shift_code','Turno',data.shift_code)}
              ${fi('address','Dirección',data.address)}
              ${fs('gender','Sexo',data.gender,['','Masculino','Femenino'])}
              ${fs('blood_type','Tipo de sangre',data.blood_type,['','A+','A-','B+','B-','AB+','AB-','O+','O-'])}
              ${fi('children','Hijos',data.children)}
              ${fi('allergies','Alergias',data.allergies)}
              ${fi('diseases','Enfermedades',data.diseases)}
              ${fi('total_vacation_days','Días vacaciones',data.total_vacation_days,'number')}
              ${fi('emergency_contact_name','Contacto emergencia',data.emergency_contact_name)}
              ${fi('emergency_contact_phone','Tel emergencia',data.emergency_contact_phone)}
            </div>
            <div style="display:flex;gap:8px;">
              <button onclick="window._saveImportEdit(${idx})"
                style="font-size:12px;padding:6px 14px;background:#064e3b;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                💾 Aplicar edición
              </button>
              <button onclick="document.getElementById('ief-${idx}')?.remove()"
                style="font-size:12px;padding:6px 14px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;">
                Cancelar
              </button>
            </div>
          </div>
        </td>
      </tr>`;
    tr.insertAdjacentHTML('afterend', formHtml);
  };

  // Cambiar correo seleccionado para la fila
  window._setImportEmail = function(idx, email) {
    const row = window._importRows[idx];
    if (!row) return;
    window._importEdits[row.key] = { ...(window._importEdits[row.key] || {}), email };
  };

  // Guardar edición y marcar visualmente la fila
  window._saveImportEdit = function(idx) {
    const row = window._importRows[idx];
    if (!row) return;
    const fields = ['full_name','nomina_number','rfc','curp','nss','phone','hire_date',
      'birth_date','daily_salary','position_name','shift_code','address','gender',
      'blood_type','children','allergies','diseases','total_vacation_days',
      'emergency_contact_name','emergency_contact_phone'];
    const edits = {};
    for (const f of fields) {
      const el = document.getElementById(`ief-${idx}-${f}`);
      if (el) edits[f] = el.value.trim();
    }
    // Merge: preservar email elegido en el selector de correo
    window._importEdits[row.key] = { ...(window._importEdits[row.key] || {}), ...edits };
    document.getElementById('ief-' + idx)?.remove();
    // Mostrar badge de "editado"
    const badge = document.querySelector(`[data-editbadge="${idx}"]`);
    if (badge) { badge.style.display = 'inline'; }
    // Actualizar nombre visible en la celda si cambió
    const nameEl = document.querySelector(`[data-namecel="${idx}"]`);
    if (nameEl && edits.full_name) nameEl.textContent = edits.full_name;
    toast('Edición guardada', 'success');
  };

  // Construir fila de resolución
  let rowIdx = 0;
  function resRow(item, defaultVal, suggestions) {
    const inc = item.incoming;
    const key = inc.email || inc.full_name;
    const idx = rowIdx++;
    window._importRows[idx] = { key, incoming: inc };
    const sel = window._importResolutions[key] || defaultVal;
    const matchItems = item.matches || suggestions || [];

    const updateBtns = matchItems.map(m => {
      const label = m.reasons ? `[${m.reasons.join(',')}]` : `${m.score}%`;
      const on = sel === `update:${m.id}`;
      return `<button class="res-btn" data-val="update:${m.id}"
        title="${m.full_name} · ${m.email||''}"
        style="font-size:11px;padding:4px 8px;border:1px solid #d1fae5;border-radius:6px;cursor:pointer;
               background:${on?'#064e3b':''};color:${on?'#fff':''};font-weight:${on?'700':''};"
        onclick="window._setImportRes(${idx},'update:${m.id}')">
        🔗 ${label} ${m.full_name}
      </button>`;
    }).join('');

    // Opciones de correo: Excel + todos los matches del sistema
    const emailOpts = [];
    if (inc.email) emailOpts.push({ label: `📥 Archivo: ${inc.email}`, val: inc.email });
    for (const m of matchItems) {
      if (m.email && m.email !== inc.email) {
        emailOpts.push({ label: `🗂️ Sistema: ${m.email} (${m.full_name.trim()})`, val: m.email });
      }
    }
    const emailSelector = emailOpts.length > 1
      ? `<div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
           <span style="font-size:11px;color:#374151;font-weight:600;">📧 Correo a usar:</span>
           <select id="iems-${idx}" style="font-size:11px;border:1px solid #93c5fd;border-radius:6px;padding:3px 6px;color:#1e40af;"
             onchange="window._setImportEmail(${idx},this.value)">
             ${emailOpts.map(e=>`<option value="${e.val}">${e.label}</option>`).join('')}
           </select>
         </div>`
      : (inc.email ? `<div style="margin-top:6px;font-size:11px;color:#6b7280;">📧 ${inc.email}</div>` : '');

    return `
      <tr data-rowid="${idx}" style="border-bottom:1px solid #f3f4f6;vertical-align:top;">
        <td style="padding:10px 8px;font-size:13px;min-width:180px;">
          <strong data-namecel="${idx}">${inc.full_name}</strong>
          <span data-editbadge="${idx}" style="display:none;font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:8px;margin-left:4px;">✏️ editado</span><br>
          <span style="color:#6b7280;font-size:11px;">${inc.email||'—'}</span><br>
          <span style="color:#9ca3af;font-size:10px;">RFC: ${inc.rfc||'—'} · NSS: ${inc.nss||'—'}</span>
        </td>
        <td style="padding:10px 8px;">
          <div data-resgrp="${idx}" style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px;">
            ${updateBtns}
            <button class="res-btn" data-val="create"
              style="font-size:11px;padding:4px 8px;border:1px solid #d1fae5;border-radius:6px;cursor:pointer;
                     background:${sel==='create'?'#064e3b':''};color:${sel==='create'?'#fff':''};font-weight:${sel==='create'?'700':''};"
              onclick="window._setImportRes(${idx},'create')">➕ Crear nuevo</button>
            <button class="res-btn" data-val="skip"
              style="font-size:11px;padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;
                     background:${sel==='skip'?'#6b7280':''};color:${sel==='skip'?'#fff':'#6b7280'};"
              onclick="window._setImportRes(${idx},'skip')">⊘ Omitir</button>
          </div>
          ${emailSelector}
          <div style="margin-top:6px;">
            <button onclick="window._toggleImportEdit(${idx})"
              style="font-size:11px;padding:3px 10px;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1d4ed8;background:#eff6ff;">
              ✏️ Editar otros datos
            </button>
          </div>
        </td>
      </tr>`;
  }

  const thead = `<thead style="background:#f9fafb;position:sticky;top:0;z-index:1;"><tr>
    <th style="padding:8px;font-size:12px;text-align:left;font-weight:600;">En el archivo</th>
    <th style="padding:8px;font-size:12px;text-align:left;font-weight:600;">Acción · Editar</th>
  </tr></thead>`;

  const exactRows = exact_duplicates.map(d => resRow(d, `update:${(d.matches[0]||{}).id||''}`, null)).join('');
  const simRows   = similar_name.map(s => resRow({ incoming: s.incoming, matches: null }, 'create', s.suggestions)).join('');

  let modal = document.getElementById('import-excel-modal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'import-excel-modal'; document.body.appendChild(modal); }
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;overflow-y:auto;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;width:min(900px,98vw);box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <h3 style="margin:0 0 4px;">📥 Importar Base de Colaboradores</h3>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px;">
        Total en archivo: <strong>${total}</strong> ·
        <span style="color:#059669;">✅ ${truly_new.length} nuevos</span> ·
        <span style="color:#d97706;">⚠️ ${exact_duplicates.length} duplicados exactos</span> ·
        <span style="color:#7c3aed;">🔍 ${similar_name.length} similares por nombre</span>
      </p>

      ${exact_duplicates.length > 0 ? `
        <details open>
          <summary style="cursor:pointer;font-weight:700;font-size:14px;color:#92400e;padding:8px;background:#fef3c7;border-radius:8px;margin-bottom:8px;">
            ⚠️ Duplicados exactos (${exact_duplicates.length}) — coinciden por correo, RFC, CURP o NSS
          </summary>
          <p style="font-size:12px;color:#6b7280;margin:6px 0 8px;">
            Al ligar, se actualizan todos los campos <strong>excepto el correo</strong> (credencial de acceso).
            Usa ✏️ Editar para ajustar los datos antes de importar.
          </p>
          <div style="max-height:320px;overflow-y:auto;border:1px solid #fde68a;border-radius:8px;margin-bottom:16px;">
            <table style="width:100%;border-collapse:collapse;">${thead}<tbody>${exactRows}</tbody></table>
          </div>
        </details>
      ` : ''}

      ${similar_name.length > 0 ? `
        <details open>
          <summary style="cursor:pointer;font-weight:700;font-size:14px;color:#5b21b6;padding:8px;background:#f5f3ff;border-radius:8px;margin-bottom:8px;">
            🔍 Similares por nombre (${similar_name.length}) — podrían existir con nombre distinto
          </summary>
          <p style="font-size:12px;color:#6b7280;margin:6px 0 8px;">
            Usa 🔗 para ligar al existente (actualiza datos, preserva correo) o ➕ para crear como nuevo.
            Con ✏️ Editar puedes ajustar los datos antes de confirmar.
          </p>
          <div style="max-height:360px;overflow-y:auto;border:1px solid #ddd6fe;border-radius:8px;margin-bottom:16px;">
            <table style="width:100%;border-collapse:collapse;">${thead}<tbody>${simRows}</tbody></table>
          </div>
        </details>
      ` : ''}

      ${truly_new.length > 0 ? `
        <details>
          <summary style="cursor:pointer;font-weight:600;font-size:13px;color:#059669;padding:8px;background:#ecfdf5;border-radius:8px;margin-bottom:12px;">
            ✅ Completamente nuevos (${truly_new.length}) — se crearán automáticamente
          </summary>
          <ul style="margin:8px 0 12px 20px;font-size:12px;color:#374151;columns:2;gap:16px;">
            ${truly_new.map(r=>`<li>${r.full_name} <span style="color:#9ca3af;">${r.email||''}</span></li>`).join('')}
          </ul>
        </details>
      ` : ''}

      ${(!exact_duplicates.length && !similar_name.length && !truly_new.length)
        ? '<p style="text-align:center;color:#6b7280;padding:24px;">Sin datos para importar.</p>' : ''}

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;">
        <button class="btn-ghost" onclick="document.getElementById('import-excel-modal').remove()">Cancelar</button>
        <button class="btn-primary" onclick="commitImportExcel()">✅ Confirmar importación</button>
      </div>
    </div>`;
}

async function commitImportExcel() {
  const preview = window._importPreview;
  const resolutions = window._importResolutions || {};
  const edits = window._importEdits || {};
  if (!preview) return;

  // Merge edits into each incoming row before sending
  function mergeEdits(row) {
    const key = row.email || row.full_name;
    return edits[key] ? { ...row, ...edits[key] } : row;
  }

  const truly_new = (preview.truly_new || []).map(mergeEdits);
  const to_resolve = [
    ...(preview.exact_duplicates || []).map(d => ({ incoming: mergeEdits(d.incoming) })),
    ...(preview.similar_name     || []).map(s => ({ incoming: mergeEdits(s.incoming) }))
  ];

  try {
    const result = await api('/api/rhh/employees/import-excel', {
      method: 'POST',
      body: JSON.stringify({ mode: 'commit', truly_new, to_resolve, resolutions })
    });
    document.getElementById('import-excel-modal')?.remove();
    const msg = `Importado: ${result.created} creados, ${result.updated} actualizados, ${result.skipped} omitidos` +
      (result.errors?.length ? ` · ${result.errors.length} errores` : '');
    toast(msg, result.errors?.length ? 'warning' : 'success');
    await loadCatalogs();
    empleadosView();
  } catch (err) { toast(err.message || 'Error al importar', 'error'); }
}

// ── Crear cuenta de usuario para empleado ─────────────────────────────────────
function openCreateUserModal(empId, empName, empEmail) {
  let modal = document.getElementById('create-user-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'create-user-modal';
  document.body.appendChild(modal);
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:grid;place-items:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;width:min(380px,95vw);box-shadow:0 16px 48px rgba(0,0,0,.2);">
      <h3 style="margin:0 0 4px;">Crear cuenta de acceso</h3>
      <div style="color:var(--muted);font-size:13px;margin-bottom:16px;">${empName} · ${empEmail}</div>
      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Rol en el sistema</label>
      <select id="cu-role" style="width:100%;margin-bottom:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;">
        <option value="empleado">Empleado</option>
        <option value="supervisor">Supervisor</option>
        <option value="rh">RH</option>
        <option value="admin">Admin</option>
      </select>
      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Contraseña inicial</label>
      <input id="cu-password" type="text" placeholder="Mínimo 6 caracteres" value="${empEmail.split('@')[0]}123"
        style="width:100%;margin-bottom:16px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-ghost" onclick="document.getElementById('create-user-modal').remove()">Cancelar</button>
        <button class="btn-primary" onclick="saveCreateUser(${empId})">Crear cuenta</button>
      </div>
    </div>`;
}

async function saveCreateUser(empId) {
  const role = document.getElementById('cu-role').value;
  const password = document.getElementById('cu-password').value;
  if (!password || password.length < 6) { toast('Contraseña mínimo 6 caracteres', 'warning'); return; }
  try {
    await api(`/api/rhh/employees/${empId}/create-user`, { method: 'POST', body: JSON.stringify({ role, password }) });
    document.getElementById('create-user-modal')?.remove();
    toast('Cuenta creada exitosamente');
    await loadCatalogs();
    empleadosView();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Tab "De Compras" en empleados ─────────────────────────────────────────────
async function loadComprasEmpTab(el) {
  const candidates = await api('/api/rhh/employees/from-compras').catch(() => []);
  if (!candidates || !candidates.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏪</div><p>Todos los usuarios de Compras ya tienen empleado en RHH</p></div>';
    return;
  }
  el.innerHTML = `
    <div class="notice" style="margin-bottom:12px;">
      Usuarios del módulo Compras que aún no tienen empleado registrado en RHH.
      Puedes crearles un expediente directamente.
    </div>
    <div class="card section table-wrap">
      <table>
        <thead><tr>
          <th>Nombre</th><th>Email</th><th>Rol Compras</th><th>Acción</th>
        </tr></thead>
        <tbody>
          ${candidates.map(c => `<tr>
            <td>${c.full_name}</td>
            <td style="font-size:12px;">${c.email}</td>
            <td><span class="pill">${c.role_code || '—'}</span></td>
            <td><button class="btn-primary" style="font-size:12px;" onclick="createEmpFromCompras(${JSON.stringify(c).replace(/"/g, '&quot;')})">+ Crear empleado</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Vincular empleado RHH a usuario de Compras ────────────────────────────────
async function openLinkComprasModal(empId, empName, currentEmail) {
  document.getElementById('link-compras-modal')?.remove();
  const users = await api('/api/rhh/employees/compras-users').catch(() => []);

  const rows = (users || []).map(u => {
    const isCurrent = u.email === currentEmail;
    const isLinked = u.linked_to && u.linked_to !== empName;
    return `<tr style="${isCurrent ? 'background:#eff6ff;' : ''}" onclick="selectComprasUser('${u.email}','${(u.full_name||'').replace(/'/g,"\\'")}')">
      <td style="padding:6px 8px;cursor:pointer;">
        <strong style="font-size:13px;">${u.full_name}</strong><br>
        <span style="font-size:11px;color:var(--muted);">${u.email}</span>
      </td>
      <td style="padding:6px 8px;font-size:11px;"><span class="pill">${u.role_code||'—'}</span></td>
      <td style="padding:6px 8px;font-size:11px;">${isCurrent ? '<span style="color:#1d4ed8;font-weight:700;">✓ Actual</span>' : (isLinked ? `<span style="color:#9ca3af">Vinc. a ${u.linked_to}</span>` : '')}</td>
    </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'link-compras-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:500px;max-width:95vw;max-height:80vh;display:flex;flex-direction:column;">
      <h3 style="margin:0 0 4px;">🔗 Vincular cuenta de Compras</h3>
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px;"><strong>${empName}</strong> — selecciona su usuario en el módulo Compras</p>
      <input id="lc-search" type="text" placeholder="Buscar por nombre o correo..." oninput="filterLcUsers(this.value)"
        style="padding:8px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px;" />
      <div style="overflow-y:auto;flex:1;border:1px solid #e5e7eb;border-radius:8px;">
        <table id="lc-table" style="width:100%;border-collapse:collapse;">
          <thead style="background:#f9fafb;position:sticky;top:0;">
            <tr><th style="padding:6px 8px;font-size:12px;text-align:left;">Usuario Compras</th><th style="padding:6px 8px;font-size:12px;">Rol</th><th style="padding:6px 8px;font-size:12px;">Estado</th></tr>
          </thead>
          <tbody id="lc-rows">${rows || '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--muted);">Sin usuarios en Compras</td></tr>'}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px;">
        <button class="btn-ghost" style="color:#b91c1c;" onclick="saveLinkCompras(${empId},null)">✕ Desvincular</button>
        <div style="display:flex;gap:8px;">
          <button class="btn-ghost" onclick="document.getElementById('link-compras-modal').remove()">Cancelar</button>
          <button class="btn-primary" id="lc-save-btn" disabled onclick="saveLinkCompras(${empId},document.getElementById('lc-selected').value)">Vincular</button>
        </div>
      </div>
      <input type="hidden" id="lc-selected" value="${currentEmail||''}" />
    </div>`;
  document.body.appendChild(overlay);
}

function filterLcUsers(q) {
  const rows = document.querySelectorAll('#lc-rows tr');
  const ql = q.toLowerCase();
  rows.forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(ql) ? '' : 'none';
  });
}

function selectComprasUser(email, name) {
  document.getElementById('lc-selected').value = email;
  document.getElementById('lc-save-btn').disabled = false;
  document.querySelectorAll('#lc-rows tr').forEach(r => r.style.background = '');
  const rows = document.querySelectorAll('#lc-rows tr');
  rows.forEach(r => { if (r.textContent.includes(email)) r.style.background = '#eff6ff'; });
}

async function saveLinkCompras(empId, comprasEmail) {
  try {
    await api(`/api/rhh/employees/${empId}/link-compras`, {
      method: 'POST',
      body: JSON.stringify({ compras_email: comprasEmail || null })
    });
    document.getElementById('link-compras-modal')?.remove();
    toast(comprasEmail ? `Vinculado a ${comprasEmail}` : 'Vínculo removido');
    empleadosView();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Restablecer contraseña (admin/rh) ─────────────────────────────────────────
function openResetPwdModal(userId, empName) {
  document.getElementById('reset-pwd-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'reset-pwd-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:340px;max-width:95vw;">
      <h3 style="margin:0 0 4px;">🔑 Restablecer contraseña</h3>
      <p style="font-size:13px;color:var(--muted);margin:0 0 16px;">${empName}</p>
      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Nueva contraseña</label>
      <input id="rp-password" type="text" placeholder="Mínimo 4 caracteres" value="0000"
        style="width:100%;margin-bottom:16px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-ghost" onclick="document.getElementById('reset-pwd-modal').remove()">Cancelar</button>
        <button class="btn-primary" onclick="saveResetPwd(${userId})">Restablecer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('rp-password').focus();
}

async function saveResetPwd(userId) {
  const pwd = document.getElementById('rp-password')?.value || '';
  if (pwd.length < 4) { toast('Contraseña mínimo 4 caracteres', 'warning'); return; }
  try {
    await api(`/api/rhh/auth/users/${userId}/reset-password`, {
      method: 'PATCH',
      body: JSON.stringify({ new_password: pwd })
    });
    document.getElementById('reset-pwd-modal')?.remove();
    toast('Contraseña restablecida');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Cambiar correo de login de usuario RHH ────────────────────────────────────
function openChangeLoginEmailModal(userId, empName, currentLoginEmail, empContactEmail) {
  document.getElementById('change-login-email-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'change-login-email-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  // Construir opciones únicas: correo de login actual + correo de contacto del empleado
  const opts = new Map();
  if (currentLoginEmail) opts.set(currentLoginEmail.toLowerCase(), `🔑 Login actual: ${currentLoginEmail}`);
  if (empContactEmail && empContactEmail.toLowerCase() !== currentLoginEmail?.toLowerCase()) {
    opts.set(empContactEmail.toLowerCase(), `📋 Correo del empleado: ${empContactEmail}`);
  }

  const optHtml = [...opts.entries()].map(([val, label]) =>
    `<option value="${val}" ${val === currentLoginEmail?.toLowerCase() ? 'selected' : ''}>${label}</option>`
  ).join('');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:24px;width:400px;max-width:95vw;">
      <h3 style="margin:0 0 4px;">📧 Correo de acceso</h3>
      <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">${empName}</p>

      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Correo actual de login</label>
      <div style="font-size:13px;color:#0369a1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 12px;margin-bottom:16px;">
        ${currentLoginEmail || '—'}
      </div>

      <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">Seleccionar correo para login</label>
      <select id="cle-select" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:8px;">
        ${optHtml}
        <option value="__custom__">✏️ Escribir otro correo...</option>
      </select>
      <input id="cle-custom" type="email" placeholder="otro@correo.com"
        style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:16px;display:none;box-sizing:border-box;"
        oninput="document.getElementById('cle-select').value='__custom__'" />

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-ghost" onclick="document.getElementById('change-login-email-modal').remove()">Cancelar</button>
        <button class="btn-primary" onclick="saveLoginEmail(${userId})">💾 Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('cle-select').addEventListener('change', function() {
    document.getElementById('cle-custom').style.display = this.value === '__custom__' ? 'block' : 'none';
  });
}

async function saveLoginEmail(userId) {
  const sel = document.getElementById('cle-select')?.value;
  const custom = document.getElementById('cle-custom')?.value?.trim();
  const email = sel === '__custom__' ? custom : sel;
  if (!email || !email.includes('@')) { toast('Correo inválido', 'warning'); return; }
  try {
    await api(`/api/rhh/auth/users/${userId}/email`, { method: 'PATCH', body: JSON.stringify({ email }) });
    document.getElementById('change-login-email-modal')?.remove();
    toast(`Correo de login actualizado: ${email}`);
    await loadCatalogs();
    empleadosView();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Importar lista de asistencia desde Excel ──────────────────────────────────
async function importAsistenciaExcel(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(e.target.result)));
    try {
      toast('Procesando Excel...', 'info');
      const result = await api('/api/rhh/schedule/import-excel', {
        method: 'POST',
        body: JSON.stringify({
          excel_base64: base64,
          week_start: attendanceWeekStart
        })
      });
      toast(result.message || 'Importación completada');
      await listaAsistenciaView();
    } catch (err) { toast(err.message || 'Error al importar', 'error'); }
  };
  reader.readAsArrayBuffer(file);
}

async function createEmpFromCompras(candidate) {
  empTab = 'nuevo'; empEditId = null;
  await empleadosView();
  setTimeout(() => {
    const nameEl = document.getElementById('ef-name');
    const emailEl = document.getElementById('ef-email');
    if (nameEl) nameEl.value = candidate.full_name;
    if (emailEl) emailEl.value = candidate.email;
    window._pendingComprasHash = candidate.password_hash;
    toast('Completa los datos del empleado y guarda', 'info');
  }, 300);
}



// ── Tab 0: Importar ───────────────────────────────────────────────────────────
function renderChecadorImportar() {
  const preview = checadorState.preview;
  const hasRecords = checadorState.records.length > 0;
  return `
    <div class="card section">
      <h3>Paso 1 — Importar CSV del reloj checador</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:12px;">
        Pega o carga el archivo CSV exportado del reloj checador.<br>
        Formato esperado: <code>sName, sJobNo, sCard, Date (DD/MM/YYYY), Time, IN/OUT, ...</code>
      </p>
      <div style="margin-bottom:12px;">
        <label style="font-size:13px;font-weight:600;">Cargar archivo .csv</label>
        <input type="file" accept=".csv,.txt" onchange="checadorLoadFile(this)"
          style="display:block;margin-top:4px;font-size:13px;" />
      </div>
      <label style="font-size:13px;font-weight:600;">O pegar CSV aquí:</label>
      <textarea id="ch-csv-text" rows="8" style="width:100%;font-family:monospace;font-size:12px;margin-top:4px;border:1px solid var(--line);border-radius:6px;padding:8px;resize:vertical;"
        oninput="checadorState.csvText=this.value">${checadorState.csvText}</textarea>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:12px;">
        <div>
          <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:2px;">Filtrar desde</label>
          <input type="date" value="${checadorState.parseFrom}"
            onchange="checadorState.parseFrom=this.value"
            style="font-size:13px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;" />
        </div>
        <div>
          <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:2px;">Filtrar hasta</label>
          <input type="date" value="${checadorState.parseTo}"
            onchange="checadorState.parseTo=this.value"
            style="font-size:13px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;" />
        </div>
        <button class="btn" onclick="checadorParsear()">🔍 Analizar CSV</button>
        ${hasRecords ? `<button class="btn btn-secondary" onclick="checadorProcesar(true)">↩️ Reemplazar registros guardados</button>` : ''}
        ${preview ? `<button class="btn" style="background:#15803d;" onclick="checadorProcesar(false)">💾 Guardar registros procesados</button>` : ''}
      </div>
    </div>
    ${preview ? renderChecadorPreview() : ''}
    ${hasRecords ? `
      <div class="card section" style="background:#f0fdf4;border:1px solid #bbf7d0;">
        <p style="margin:0;color:#15803d;font-weight:600;">
          ✅ ${checadorState.records.length} registros almacenados en el sistema.
          <button class="btn btn-secondary" style="margin-left:12px;font-size:12px;" onclick="checadorSetTab(2)">Ver registros →</button>
        </p>
      </div>` : ''}
  `;
}

function renderChecadorPreview() {
  const p = checadorState.preview;
  const unmapped = p.workers.filter(w => !w.mapped);
  return `
    <div class="card section">
      <h3>Vista previa del análisis</h3>
      <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;">
        <div><span style="font-size:22px;font-weight:700;">${p.total_rows}</span><br><span style="color:var(--muted);font-size:12px;">Registros en CSV</span></div>
        <div><span style="font-size:22px;font-weight:700;">${p.total_sessions}</span><br><span style="color:var(--muted);font-size:12px;">Sesiones detectadas</span></div>
        <div><span style="font-size:22px;font-weight:700;">${p.workers.length}</span><br><span style="color:var(--muted);font-size:12px;">Trabajadores</span></div>
        <div><span style="font-size:22px;font-weight:700;color:${unmapped.length > 0 ? '#dc2626' : '#15803d'};">${unmapped.length}</span><br><span style="color:var(--muted);font-size:12px;">Sin mapear</span></div>
      </div>
      ${unmapped.length > 0 ? `
        <div class="notice warning" style="margin-bottom:12px;">
          ⚠️ ${unmapped.length} trabajador(es) del checador no están vinculados a un empleado del sistema.
          <button class="btn btn-secondary" style="margin-left:8px;font-size:12px;" onclick="checadorSetTab(1)">Ir a Mapear →</button>
        </div>` : ''}
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID Checador</th><th>Nombre checador</th><th>Empleado vinculado</th><th>Estado</th></tr></thead>
          <tbody>
            ${p.workers.map(w => `
              <tr>
                <td>${w.checador_id}</td>
                <td>${w.checador_name}</td>
                <td>${w.employee_name || '<span style="color:#dc2626;">Sin vincular</span>'}</td>
                <td>${w.mapped
                  ? '<span style="color:#15803d;font-weight:600;">✅ Vinculado</span>'
                  : '<span style="color:#dc2626;font-weight:600;">⚠️ Sin mapear</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card section">
      <h3>Registros procesados (primeros 50 por fecha)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Trabajador</th><th>Fecha</th><th>Día</th><th>Turno detectado</th><th>Entrada</th><th>Salida</th><th>Tiempo trabajado</th><th>Retardo</th></tr></thead>
          <tbody>
            ${[...p.records].sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).slice(0, 50).map(r => {
              const empName = r.employee_id
                ? (checadorState.mappings.find(m => m.checador_id === r.checador_id) || {}).employee_name || r.checador_name
                : r.checador_name;
              return `
              <tr>
                <td>${empName}</td>
                <td>${r.date}</td>
                <td style="color:var(--muted);font-size:12px;">${diaSemana(r.date)}</td>
                <td>${turnoChip(r.shift_name)}</td>
                <td>${r.entry_time}</td>
                <td>${r.exit_time || '<span style="color:#dc2626;">Sin salida</span>'}</td>
                <td>${r.worked_minutes != null ? fmtWorked(r.worked_minutes) : '--'}</td>
                <td>${r.retardo_minutes > 0
                  ? `<span style="color:#dc2626;font-weight:600;">⏱ ${fmtWorked(r.retardo_minutes)}</span>`
                  : '<span style="color:#15803d;">Sin retardo</span>'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${p.records.length > 50 ? `<p style="color:var(--muted);font-size:12px;margin-top:8px;">Mostrando 50 de ${p.records.length} registros por fecha. Guarda para ver todos.</p>` : ''}
    </div>
  `;
}

// ── Tab 1: Mapear ────────────────────────────────────────────────────────────
function renderChecadorMapear() {
  const workers = checadorState.preview
    ? checadorState.preview.workers
    : checadorState.mappings.map(m => ({
        checador_id: m.checador_id, checador_name: m.checador_name,
        employee_id: m.employee_id, employee_name: m.employee_name,
        mapped: !!m.employee_id,
      }));

  if (workers.length === 0) {
    return `
      <div class="card section">
        <div class="empty-state">
          <div class="empty-icon">🔗</div>
          <p>Primero importa un CSV para ver los trabajadores del checador.</p>
          <button class="btn" onclick="checadorSetTab(0)">← Ir a Importar</button>
        </div>
      </div>`;
  }

  const activeEmps = state.employees.filter(e=>e.status==='active')
    .sort((a,b)=>(a.full_name||'').localeCompare(b.full_name||''));

  return `
    <div class="card section">
      <h3>Paso 2 — Vincular ID del checador con empleados del sistema</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        Cada trabajador del reloj tiene un número de ID propio. Aquí los vinculas con el empleado correcto del sistema.
        Esta vinculación se guarda y no hay que repetirla en futuros imports.
      </p>
      <datalist id="emplist-ch">
        ${activeEmps.map(e=>`<option value="${e.full_name}"></option>`).join('')}
      </datalist>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID Checador</th><th>Nombre en checador</th><th>Empleado en sistema</th><th>Estado</th></tr></thead>
          <tbody>
            ${workers.map(w => {
              const currentName = w.employee_id
                ? (activeEmps.find(e=>e.id===w.employee_id)||{}).full_name || ''
                : '';
              return `
              <tr>
                <td><strong>${w.checador_id}</strong></td>
                <td>${w.checador_name}</td>
                <td>
                  <input type="text" list="emplist-ch"
                    id="chmap-${w.checador_id}"
                    value="${currentName.replace(/"/g,'&quot;')}"
                    placeholder="Escribe para buscar empleado..."
                    style="width:100%;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:5px;"
                    oninput="checadorSelectEmpByText(${w.checador_id},'${(w.checador_name||'').replace(/'/g,"\\'")}',this.value)" />
                  <div style="margin-top:4px;">
                    <button class="btn btn-secondary" style="font-size:11px;padding:2px 8px;"
                      onclick="checadorNuevoEmpleado()">+ Nuevo empleado</button>
                  </div>
                </td>
                <td id="chmap-st-${w.checador_id}">
                  ${w.mapped
                    ? '<span style="color:#15803d;font-weight:600;">✅ Vinculado</span>'
                    : '<span style="color:#dc2626;font-weight:600;">⚠️ Sin mapear</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:16px;">
        <button class="btn" onclick="checadorGuardarMapeos()">💾 Guardar vinculaciones</button>
      </div>
    </div>
  `;
}

// ── Tab 2: Registros ──────────────────────────────────────────────────────────
function renderChecadorRegistros() {
  if (checadorState.records.length === 0) {
    return `
      <div class="card section">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>No hay registros procesados. Importa un CSV para comenzar.</p>
          <button class="btn" onclick="checadorSetTab(0)">← Ir a Importar</button>
        </div>
      </div>`;
  }

  let recs = checadorState.records;
  if (checadorState.filterDate)    recs = recs.filter(r => r.date >= checadorState.filterDate);
  if (checadorState.filterDateTo)  recs = recs.filter(r => r.date <= checadorState.filterDateTo);
  if (checadorState.filterStatus)  recs = recs.filter(r => r.status === checadorState.filterStatus);
  if (checadorState.filterEmp)     recs = recs.filter(r => String(r.employee_id) === checadorState.filterEmp);

  const totalRetardo  = checadorState.records.filter(r => r.retardo_minutes > 0).length;
  const totalOvertime = checadorState.records.filter(r => r.overtime_minutes > 0).length;
  const sinSalida     = checadorState.records.filter(r => !r.exit_time).length;
  const sinVincular   = checadorState.records.filter(r => !r.employee_id).length;

  const empOptions = state.employees.filter(e=>e.status==='active')
    .sort((a,b)=>(a.full_name||'').localeCompare(b.full_name||''))
    .map(e=>`<option value="${e.id}" ${checadorState.filterEmp===String(e.id)?'selected':''}>${e.full_name}</option>`)
    .join('');

  return `
    <div class="card section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <h3 style="margin:0;">Historial de registros del checador</h3>
        <button class="btn btn-secondary" style="color:#dc2626;border-color:#dc2626;" onclick="checadorLimpiarRegistros()">🗑 Limpiar todos</button>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px;">
        <div><span style="font-size:20px;font-weight:700;">${checadorState.records.length}</span><br><span style="color:var(--muted);font-size:12px;">Total registros</span></div>
        <div><span style="font-size:20px;font-weight:700;color:#dc2626;">${totalRetardo}</span><br><span style="color:var(--muted);font-size:12px;">Con retardo</span></div>
        <div><span style="font-size:20px;font-weight:700;color:#7c3aed;">${totalOvertime}</span><br><span style="color:var(--muted);font-size:12px;">Tiempo extra</span></div>
        <div><span style="font-size:20px;font-weight:700;color:#b45309;">${sinSalida}</span><br><span style="color:var(--muted);font-size:12px;">Sin salida</span></div>
        <div><span style="font-size:20px;font-weight:700;color:#64748b;">${sinVincular}</span><br><span style="color:var(--muted);font-size:12px;">Sin vincular</span></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input type="date" value="${checadorState.filterDate}"
          onchange="checadorState.filterDate=this.value;renderChecador()"
          style="font-size:13px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;" />
        <input type="date" value="${checadorState.filterDateTo}"
          onchange="checadorState.filterDateTo=this.value;renderChecador()"
          style="font-size:13px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;" />
        <select onchange="checadorState.filterStatus=this.value;renderChecador()"
          style="font-size:13px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;">
          <option value="" ${!checadorState.filterStatus?'selected':''}>Todos los estados</option>
          <option value="pendiente" ${checadorState.filterStatus==='pendiente'?'selected':''}>Pendiente</option>
          <option value="validado"  ${checadorState.filterStatus==='validado'?'selected':''}>Validado</option>
          <option value="ignorado"  ${checadorState.filterStatus==='ignorado'?'selected':''}>Ignorado</option>
        </select>
        <select onchange="checadorState.filterEmp=this.value;renderChecador()"
          style="font-size:13px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;">
          <option value="">Todos los empleados</option>
          ${empOptions}
        </select>
        ${(checadorState.filterDate||checadorState.filterDateTo||checadorState.filterStatus||checadorState.filterEmp)
          ? `<button class="btn btn-secondary" style="font-size:12px;"
               onclick="checadorState.filterDate='';checadorState.filterDateTo='';checadorState.filterStatus='';checadorState.filterEmp='';renderChecador()">✕ Limpiar</button>`
          : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Trabajador</th><th>Fecha</th><th>Día</th><th>Turno detectado</th>
              <th>Entrada</th><th>Salida</th><th>Tiempo trabajado</th><th>Retardo</th><th>T. Extra</th>
              <th>Estado</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${recs.length === 0
              ? '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:24px;">Sin registros para los filtros seleccionados</td></tr>'
              : recs.map(r => `
              <tr style="${!r.employee_id ? 'background:#fef9c3;' : r.retardo_minutes>0 ? 'background:#fef2f2;' : r.overtime_minutes>0 ? 'background:#f5f3ff;' : ''}">
                <td>
                  <div style="font-weight:600;">${r.employee_name || r.checador_name}</div>
                  <div style="font-size:11px;color:var(--muted);">ID checador: ${r.checador_id}${!r.employee_id ? ' · <span style="color:#dc2626;">Sin vincular</span>' : ''}</div>
                </td>
                <td>${r.date}</td>
                <td style="color:var(--muted);font-size:12px;">${diaSemana(r.date)}</td>
                <td>${turnoChip(r.shift_name)}</td>
                <td style="font-weight:600;">${r.entry_time}</td>
                <td>${r.exit_time
                  ? (r.exit_date && r.exit_date !== r.date
                    ? `${r.exit_time} <span style="font-size:10px;color:var(--muted);">(+1 día)</span>`
                    : r.exit_time)
                  : '<span style="color:#dc2626;font-size:12px;">Sin registro</span>'}</td>
                <td>${r.worked_minutes != null ? fmtWorked(r.worked_minutes) : '--'}</td>
                <td>${r.retardo_minutes > 0
                  ? `<span style="color:#dc2626;font-weight:600;">⏱ ${fmtWorked(r.retardo_minutes)}</span>`
                  : '<span style="color:#15803d;font-size:12px;">Sin retardo</span>'}</td>
                <td>
                  ${r.overtime_minutes > 0
                  ? `<span style="display:inline-flex;align-items:center;gap:4px;">
                       <span style="color:#7c3aed;font-weight:600;">+${fmtWorked(r.overtime_minutes)}</span>
                       <button onclick="checadorBorrarOvertime(${r.id})" title="Borrar tiempo extra"
                         style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:12px;padding:0 2px;line-height:1;">🗑</button>
                     </span>`
                  : '<span style="color:var(--muted);font-size:12px;">—</span>'}</td>
                <td>${statusChipCh(r.status)}</td>
                <td>
                  <div style="display:flex;gap:4px;">
                    ${r.status !== 'validado'
                      ? `<button class="btn" style="font-size:11px;padding:2px 8px;background:#15803d;" onclick="checadorSetStatus(${r.id},'validado')" title="Validar">✅</button>`
                      : ''}
                    ${r.status !== 'ignorado'
                      ? `<button class="btn btn-secondary" style="font-size:11px;padding:2px 8px;" onclick="checadorSetStatus(${r.id},'ignorado')" title="Ignorar">✕</button>`
                      : ''}
                    ${r.status !== 'pendiente'
                      ? `<button class="btn btn-secondary" style="font-size:11px;padding:2px 8px;" onclick="checadorSetStatus(${r.id},'pendiente')" title="Revertir a pendiente">↩</button>`
                      : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--muted);font-size:12px;margin-top:8px;">Mostrando ${recs.length} de ${checadorState.records.length} registros.</p>
    </div>
  `;
}

// ── Tab 3: Validar ────────────────────────────────────────────────────────────
function renderChecadorValidar() {
  if (checadorState.records.length === 0) {
    return `
      <div class="card section">
        <div class="empty-state">
          <div class="empty-icon">✅</div>
          <p>Primero importa y valida registros del checador.</p>
          <button class="btn" onclick="checadorSetTab(0)">← Ir a Importar</button>
        </div>
      </div>`;
  }

  const validated  = checadorState.records.filter(r => r.status === 'validado');
  const retardos   = validated.filter(r => r.retardo_minutes > 0);
  const sinSalida  = validated.filter(r => !r.exit_time);
  const overtimes  = validated.filter(r => r.overtime_minutes > 0);

  return `
    <div class="card section">
      <h3>Validación de incidencias detectadas</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        Compara los registros del checador con los del sistema. Desde aquí puedes crear incidencias
        de retardo, falta o tiempo extra para los registros validados.
      </p>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;flex:1;min-width:150px;">
          <div style="font-size:24px;font-weight:700;color:#15803d;">${validated.length}</div>
          <div style="color:#15803d;font-size:13px;">Registros validados</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;flex:1;min-width:150px;">
          <div style="font-size:24px;font-weight:700;color:#dc2626;">${retardos.length}</div>
          <div style="color:#dc2626;font-size:13px;">Con retardo detectado</div>
        </div>
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:16px;flex:1;min-width:150px;">
          <div style="font-size:24px;font-weight:700;color:#7c3aed;">${overtimes.length}</div>
          <div style="color:#7c3aed;font-size:13px;">Con tiempo extra</div>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;flex:1;min-width:150px;">
          <div style="font-size:24px;font-weight:700;color:#b45309;">${sinSalida.length}</div>
          <div style="color:#b45309;font-size:13px;">Sin registro de salida</div>
        </div>
      </div>

      ${retardos.length > 0 ? `
        <div style="margin-bottom:24px;">
          <h4 style="margin:0 0 8px;color:#dc2626;">Retardos detectados por checador (${retardos.length})</h4>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Trabajador</th><th>Fecha</th><th>Turno</th><th>Hora entrada</th><th>Retardo</th><th>Acción</th></tr>
              </thead>
              <tbody>
                ${retardos.map(r => `
                <tr style="background:#fef2f2;">
                  <td>${r.employee_name || r.checador_name}</td>
                  <td>${r.date}</td>
                  <td>${turnoChip(r.shift_name)}</td>
                  <td style="font-weight:600;">${r.entry_time}</td>
                  <td><span style="color:#dc2626;font-weight:600;">⏱ ${fmtWorked(r.retardo_minutes)}</span></td>
                  <td>
                    ${r.employee_id
                      ? `<button class="btn" style="font-size:11px;padding:3px 10px;background:#dc2626;"
                           onclick="checadorCrearRetardo(${r.id},${r.employee_id},'${r.date}',${r.retardo_minutes},'${(r.shift_name||'').replace(/'/g,"\\'")}')">
                           + Crear retardo</button>`
                      : '<span style="color:#64748b;font-size:12px;">Sin vincular</span>'}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

      ${overtimes.length > 0 ? `
        <div style="margin-bottom:24px;">
          <h4 style="margin:0 0 8px;color:#7c3aed;">Tiempo extra detectado (${overtimes.length})</h4>
          <p style="color:var(--muted);font-size:12px;margin-bottom:8px;">
            Salida tardía (&gt;15 min sobre fin de turno) o llegada anticipada (&gt;80 min antes del turno).
            Confirma antes de crear el registro de tiempo extra.
          </p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Trabajador</th><th>Fecha</th><th>Día</th><th>Turno</th><th>Entrada</th><th>Salida</th><th>T. Extra</th><th>Tipo</th><th>Acción</th></tr>
              </thead>
              <tbody>
                ${overtimes.map(r => `
                <tr style="background:#f5f3ff;">
                  <td>${r.employee_name || r.checador_name}</td>
                  <td>${r.date}</td>
                  <td style="color:var(--muted);font-size:12px;">${diaSemana(r.date)}</td>
                  <td>${turnoChip(r.shift_name)}</td>
                  <td>${r.entry_time}</td>
                  <td>${r.exit_time || '—'}</td>
                  <td><span style="color:#7c3aed;font-weight:600;">+${fmtWorked(r.overtime_minutes)}</span></td>
                  <td><span style="font-size:11px;color:var(--muted);">${
                    r.overtime_type === 'salida' ? 'Salida tardía' :
                    r.overtime_type === 'llegada_anticipada' ? '⚠️ Llegada anticipada' :
                    r.overtime_type === 'ambos' ? 'Salida + Llegada' : '—'
                  }</span></td>
                  <td>
                    ${r.employee_id
                      ? `<button class="btn" style="font-size:11px;padding:3px 10px;background:#7c3aed;"
                           onclick="checadorCrearOvertime(${r.id},${r.employee_id},'${r.date}',${r.overtime_minutes},'${(r.shift_name||'').replace(/'/g,"\\'")}','${r.overtime_type||''}')">
                           + Tiempo extra</button>`
                      : '<span style="color:#64748b;font-size:12px;">Sin vincular</span>'}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

      ${sinSalida.length > 0 ? `
        <div>
          <h4 style="margin:0 0 4px;color:#b45309;">Sin registro de salida — posible inasistencia (${sinSalida.length})</h4>
          <p style="color:var(--muted);font-size:12px;margin-bottom:8px;">
            Solo 1 checada registrada. Puede ser falta parcial o error del reloj. Revisa antes de crear incidencia.
          </p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Trabajador</th><th>Fecha</th><th>Turno detectado</th><th>Checada única</th><th>Acción</th></tr>
              </thead>
              <tbody>
                ${sinSalida.map(r => `
                <tr style="background:#fffbeb;">
                  <td>${r.employee_name || r.checador_name}</td>
                  <td>${r.date}</td>
                  <td>${turnoChip(r.shift_name)}</td>
                  <td>${r.entry_time}</td>
                  <td>
                    ${r.employee_id
                      ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;"
                           onclick="checadorCrearFalta(${r.id},${r.employee_id},'${r.date}')">
                           ⚠️ Registrar falta</button>`
                      : '<span style="color:#64748b;font-size:12px;">Sin vincular</span>'}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

      ${validated.length === 0
        ? `<div class="empty-state"><div class="empty-icon">⚠️</div>
           <p>No hay registros validados. Ve a la pestaña Registros y valida los que correspondan.</p></div>`
        : ''}
    </div>
  `;
}

// ── Tab 4: Inasistencias ───────────────────────────────────────────────────────
function renderChecadorInasistencias() {
  const noMappings = checadorState.mappings.length === 0;
  const abs = checadorState.absences;

  const byDate = {};
  for (const a of abs) {
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push(a);
  }
  const dates = Object.keys(byDate).sort();

  return `
    <div class="card section">
      <h3>Detección automática de inasistencias</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        El sistema cruza los días laborables de cada turno con los registros importados del checador.
        Los días sin checada = inasistencia candidata. Solo aparecen empleados con vinculación activa.
      </p>

      ${noMappings ? `
        <div class="notice warning" style="margin-bottom:16px;">
          ⚠️ No hay trabajadores vinculados al checador. Ve a <strong>Mapear trabajadores</strong> y guarda las vinculaciones primero.
          <button class="btn btn-secondary" style="margin-left:8px;font-size:12px;" onclick="checadorSetTab(1)">Ir a Mapear →</button>
        </div>` : ''}

      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
        <div>
          <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:2px;">Desde</label>
          <input type="date" value="${checadorState.absenceFrom}"
            onchange="checadorState.absenceFrom=this.value"
            style="font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;" />
        </div>
        <div>
          <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:2px;">Hasta</label>
          <input type="date" value="${checadorState.absenceTo}"
            onchange="checadorState.absenceTo=this.value"
            style="font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;" />
        </div>
        <button class="btn" onclick="checadorDetectarInasistencias()" ${checadorState.absenceLoading ? 'disabled' : ''}>
          ${checadorState.absenceLoading ? '⏳ Detectando...' : '🔍 Detectar inasistencias'}
        </button>
      </div>

      ${abs.length > 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;color:#dc2626;">
            ${abs.length} inasistencia(s) detectada(s) en ${dates.length} día(s)
          </div>
          <button class="btn" style="background:#dc2626;font-size:12px;" onclick="checadorCrearTodasFaltas()">
            ⚠️ Crear todas las faltas
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Día</th><th>Trabajador</th><th>Turno esperado</th><th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${dates.map(date => {
                const dayName = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][new Date(date + 'T12:00:00Z').getUTCDay()];
                return byDate[date].map((a, i) => `
                  <tr style="background:#fef2f2;">
                    ${i === 0 ? `<td rowspan="${byDate[date].length}" style="font-weight:600;vertical-align:top;padding-top:10px;">${date}</td>
                                 <td rowspan="${byDate[date].length}" style="color:var(--muted);vertical-align:top;padding-top:10px;">${dayName}</td>` : ''}
                    <td>${a.employee_name}</td>
                    <td>${turnoChip(a.shift_name)}</td>
                    <td>
                      <button class="btn btn-secondary" style="font-size:11px;padding:2px 8px;color:#dc2626;border-color:#dc2626;"
                        onclick="checadorCrearFaltaAbsence(${a.employee_id},'${a.date}','${(a.shift_name||'').replace(/'/g,"\\'")}')">
                        + Falta
                      </button>
                    </td>
                  </tr>`).join('');
              }).join('')}
            </tbody>
          </table>
        </div>` : abs.length === 0 && checadorState.absenceFrom && checadorState.absenceTo && !checadorState.absenceLoading
          ? '<div class="empty-state"><div class="empty-icon">✅</div><p>Sin inasistencias detectadas en el rango seleccionado.</p></div>'
          : '<div class="empty-state"><div class="empty-icon">🚫</div><p>Selecciona un rango de fechas y presiona Detectar.</p></div>'
      }
    </div>
  `;
}

// ── Tab 6: Limpieza de datos ──────────────────────────────────────────────────
const CLEANUP_COLLECTIONS = [
  { key: 'rhh_incidences',          label: 'Incidencias',              desc: 'Retardos, faltas, permisos, incapacidades, etc.' },
  { key: 'rhh_weekly_rol',          label: 'ROL semanal (plantillas)',  desc: 'Cabeceras de semana del módulo ROL' },
  { key: 'rhh_rol_slots',           label: 'ROL — slots',              desc: 'Slots de turno asignados' },
  { key: 'rhh_rol_assignments',     label: 'ROL — asignaciones',       desc: 'Asignaciones de empleado a slot' },
  { key: 'rhh_checador_records',    label: 'Registros del checador',   desc: 'Sesiones importadas del reloj' },
  { key: 'rhh_overtime',            label: 'Tiempo extra',             desc: 'Registros de horas extra aprobadas' },
  { key: 'rhh_attendance',          label: 'Asistencia',               desc: 'Registros de asistencia manual' },
  { key: 'rhh_attendance_log',      label: 'Log de asistencia',        desc: 'Historial de cambios de asistencia' },
  { key: 'rhh_vacation_requests',   label: 'Solicitudes de vacaciones', desc: 'Requests de vacaciones pendientes y aprobados' },
  { key: 'rhh_te_applications',     label: 'Solicitudes de T.E.',      desc: 'Solicitudes de tiempo extra' },
  { key: 'rhh_te_authorizations',   label: 'Autorizaciones de T.E.',   desc: 'Autorizaciones de tiempo extra' },
  { key: 'rhh_notifications',       label: 'Notificaciones',           desc: 'Notificaciones del sistema RHH' },
  { key: 'rhh_payroll_clarifications', label: 'Aclaraciones de nómina', desc: 'Tickets de aclaración de nómina' },
];

function renderChecadorLimpieza() {
  const sel = checadorState._cleanupSel || {};
  return `
    <div class="card section" style="border:2px solid #fecaca;">
      <h3 style="color:#dc2626;margin-bottom:4px;">🗑 Limpieza de registros</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        Borra colecciones de registros de la plataforma. <strong>Los datos de empleados, usuarios y contraseñas NO se ven afectados.</strong><br>
        Esta acción es <strong>irreversible</strong>. Selecciona solo lo que quieras eliminar.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;margin-bottom:20px;">
        ${CLEANUP_COLLECTIONS.map(c => `
          <label style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid ${sel[c.key]?'#dc2626':'var(--line)'};border-radius:8px;cursor:pointer;background:${sel[c.key]?'#fef2f2':'#fff'};">
            <input type="checkbox" ${sel[c.key]?'checked':''} style="margin-top:2px;accent-color:#dc2626;"
              onchange="checadorCleanupToggle('${c.key}',this.checked)" />
            <div>
              <div style="font-weight:600;font-size:13px;">${c.label}</div>
              <div style="font-size:11px;color:var(--muted);">${c.desc}</div>
            </div>
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn" style="background:#dc2626;" onclick="checadorEjecutarLimpieza()">
          🗑 Eliminar seleccionados
        </button>
        <button class="btn btn-secondary" onclick="checadorCleanupSelAll(true)">Seleccionar todo</button>
        <button class="btn btn-secondary" onclick="checadorCleanupSelAll(false)">Ninguno</button>
        <span style="color:var(--muted);font-size:12px;">${Object.values(sel).filter(Boolean).length} colección(es) seleccionada(s)</span>
      </div>
    </div>`;
}

// ── Tab 5: Calendario semanal del checador ────────────────────────────────────
function renderChecadorCalendario() {
  const allRecs = checadorState.records;
  if (allRecs.length === 0) {
    return `<div class="card section"><div class="empty-state"><div class="empty-icon">📅</div>
      <p>Importa y guarda registros del checador para ver el calendario.</p>
      <button class="btn" onclick="checadorSetTab(0)">← Ir a Importar</button></div></div>`;
  }

  // Semana activa
  const base = getWeekStart();
  base.setDate(base.getDate() + checadorState.calWeekOff * 7);
  const weekDates = getWeekDates(base); // 7 días Lun–Dom
  const weekIsos  = weekDates.map(d => fmtDate(d));
  const rangeLbl  = `${weekIsos[0]} – ${weekIsos[6]}`;

  // Índice: employee_key → { name, shift_name, byDate: {date: record} }
  const byEmp = {};
  for (const r of allRecs) {
    const key  = r.employee_id != null ? `e${r.employee_id}` : `c${r.checador_id}`;
    const name = r.employee_name || r.checador_name;
    if (!byEmp[key]) byEmp[key] = { name, shift_name: r.shift_name, byDate: {} };
    // Si hay múltiples registros el mismo día, queda el más reciente (no normal)
    byEmp[key].byDate[r.date] = r;
  }
  // Agregar ausencias detectadas como "falta" si no hay registro ese día
  for (const a of checadorState.absences) {
    if (!weekIsos.includes(a.date)) continue;
    const key = `e${a.employee_id}`;
    if (!byEmp[key]) byEmp[key] = { name: a.employee_name, shift_name: a.shift_name, byDate: {} };
    if (!byEmp[key].byDate[a.date]) byEmp[key].byDate[a.date] = { _absence: true, shift_name: a.shift_name };
  }

  const empKeys = Object.keys(byEmp).sort((a, b) => byEmp[a].name.localeCompare(byEmp[b].name));

  function cellFor(emp, dateIso) {
    const r = emp.byDate[dateIso];
    if (!r) return '<td style="text-align:center;"><span style="color:#d1d5db;">—</span></td>';
    if (r._absence) return '<td style="text-align:center;"><span class="cell-chip cell-falta" style="font-size:11px;">Falta</span></td>';

    let cls = 'cell-asignado', lbl = '✓';
    if (!r.exit_time)           { cls = 'cell-permiso';     lbl = '?sal'; }
    if (r.retardo_minutes > 0)  { cls = 'cell-vacacion';    lbl = '⏱Ret'; }
    if (r.overtime_minutes > 0) { cls = 'cell-tiempo_extra'; lbl = `+${fmtWorked(r.overtime_minutes)}`; }
    if (r.retardo_minutes > 0 && r.overtime_minutes > 0) { cls = 'cell-incapacidad'; lbl = '⏱+TE'; }

    const tip = `${r.entry_time || '?'}–${r.exit_time || '?'} | Ret:${r.retardo_minutes||0}m | TE:${r.overtime_minutes||0}m`;
    return `<td style="text-align:center;" title="${tip}">
      <span class="cell-chip ${cls}" style="font-size:11px;cursor:default;">${lbl}</span></td>`;
  }

  const headerCells = weekDates.map(d => {
    const iso = fmtDate(d);
    const isToday = iso === fmtDate(new Date());
    const dow = DAYS_SHORT[d.getDay()];
    return `<th style="${isToday ? 'background:#d1fae5;' : ''}text-align:center;">${dow}<br><span style="font-size:11px;font-weight:400;">${d.getDate()}/${d.getMonth()+1}</span></th>`;
  }).join('');

  const rows = empKeys.map(key => {
    const emp = byEmp[key];
    const cells = weekIsos.map(iso => cellFor(emp, iso)).join('');
    return `<tr>
      <td style="white-space:nowrap;padding:6px 8px;">
        <strong style="font-size:13px;">${emp.name}</strong><br>
        <span style="font-size:11px;color:var(--muted);">${turnoChip(emp.shift_name)}</span>
      </td>${cells}</tr>`;
  }).join('');

  return `
    <div class="card section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <h3 style="margin:0;">Calendario semanal — Checador</h3>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-secondary" style="font-size:13px;padding:4px 12px;"
            onclick="checadorState.calWeekOff--;renderChecador()">‹ Anterior</button>
          <span style="font-size:13px;font-weight:600;padding:0 8px;">📅 ${rangeLbl}</span>
          <button class="btn btn-secondary" style="font-size:13px;padding:4px 12px;"
            onclick="checadorState.calWeekOff++;renderChecador()">Siguiente ›</button>
          <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;"
            onclick="checadorState.calWeekOff=0;renderChecador()">Hoy</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="cal-week-table">
          <thead><tr>
            <th style="text-align:left;min-width:150px;">Empleado</th>${headerCells}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <strong style="font-size:12px;">Leyenda:</strong>
        <span class="cell-chip cell-asignado" style="font-size:11px;">✓ Asistencia</span>
        <span class="cell-chip cell-vacacion" style="font-size:11px;">⏱ Retardo</span>
        <span class="cell-chip cell-tiempo_extra" style="font-size:11px;">+ T. Extra</span>
        <span class="cell-chip cell-incapacidad" style="font-size:11px;">⏱+ Ret+TE</span>
        <span class="cell-chip cell-permiso" style="font-size:11px;">?sal Sin salida</span>
        <span class="cell-chip cell-falta" style="font-size:11px;">Falta</span>
      </div>
    </div>`;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function checadorLoadFile(input) {
  const file = input.files[0];
  if (!file) return;
  checadorState.csvText = await file.text();
  renderChecador();
}

async function checadorParsear() {
  const text = checadorState.csvText || document.getElementById('ch-csv-text')?.value || '';
  if (!text.trim()) { toast('Pega o carga el CSV primero', 'warning'); return; }
  checadorState.csvText = text;
  try {
    const data = await api('/api/rhh/checador/parse', {
      method: 'POST',
      body: JSON.stringify({ csv_text: text, date_from: checadorState.parseFrom || undefined, date_to: checadorState.parseTo || undefined }),
    });
    checadorState.preview  = data;
    checadorState.mappings = data.workers.filter(w => w.mapped).map(w => ({
      checador_id: w.checador_id, checador_name: w.checador_name,
      employee_id: w.employee_id, employee_name: w.employee_name,
    }));
    toast(`Análisis completo: ${data.total_sessions} sesiones detectadas`);
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorProcesar(replace) {
  const text = checadorState.csvText || '';
  if (!text.trim()) { toast('CSV no disponible', 'warning'); return; }
  if (replace && !confirm('¿Seguro que deseas reemplazar TODOS los registros almacenados?')) return;
  try {
    await api('/api/rhh/checador/process', {
      method: 'POST',
      body: JSON.stringify({ csv_text: text, replace, date_from: checadorState.parseFrom || undefined, date_to: checadorState.parseTo || undefined }),
    });
    checadorState.records = await api('/api/rhh/checador/records');
    toast(`Registros guardados: ${checadorState.records.length}`);
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

function checadorSelectEmpByText(checadorId, checadorName, text) {
  const emp = state.employees.find(e => e.status === 'active' && e.full_name === text);
  const employeeId = emp ? emp.id : null;
  checadorUpdateMapLocal(checadorId, checadorName, employeeId);
}

function checadorNuevoEmpleado() {
  if (!confirm('Se abrirá el formulario de nuevo empleado. Al regresar al Checador, el nuevo empleado aparecerá en la búsqueda.')) return;
  empTab = 'nuevo';
  empEditId = null;
  location.hash = '#empleados';
}

const _pendingMaps = {};
function checadorUpdateMapLocal(checadorId, checadorName, employeeId) {
  _pendingMaps[checadorId] = { checador_id: checadorId, checador_name: checadorName, employee_id: employeeId ? Number(employeeId) : null };
  const st = document.getElementById(`chmap-st-${checadorId}`);
  if (st) st.innerHTML = employeeId
    ? '<span style="color:#b45309;font-weight:600;">🔄 Cambio pendiente</span>'
    : '<span style="color:#dc2626;font-weight:600;">⚠️ Sin mapear</span>';
}

async function checadorGuardarMapeos() {
  const maps = Object.values(_pendingMaps);
  if (maps.length === 0) { toast('No hay cambios de vinculación pendientes', 'warning'); return; }
  try {
    await api('/api/rhh/checador/mappings', {
      method: 'POST',
      body: JSON.stringify({ mappings: maps }),
    });
    if (checadorState.preview) {
      for (const m of maps) {
        const w = checadorState.preview.workers.find(x => x.checador_id === m.checador_id);
        if (w) {
          w.employee_id   = m.employee_id;
          w.employee_name = (state.employees.find(e => e.id === m.employee_id) || {}).full_name || null;
          w.mapped        = !!m.employee_id;
        }
      }
    }
    Object.keys(_pendingMaps).forEach(k => delete _pendingMaps[k]);
    checadorState.mappings = await api('/api/rhh/checador/mappings');
    toast('Vinculaciones guardadas');
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorSetStatus(id, status) {
  try {
    const updated = await api(`/api/rhh/checador/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    const idx = checadorState.records.findIndex(r => r.id === id);
    if (idx !== -1) checadorState.records[idx] = { ...checadorState.records[idx], ...updated };
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorLimpiarRegistros() {
  if (!confirm('¿Eliminar TODOS los registros del checador? Esta acción no se puede deshacer.')) return;
  try {
    await api('/api/rhh/checador/records', { method: 'DELETE' });
    checadorState.records = [];
    toast('Registros eliminados');
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorCrearRetardo(recId, empId, date, minutes, shiftName) {
  if (!confirm(`¿Crear incidencia de retardo para el ${date} (${fmtWorked(minutes)} — ${shiftName})?`)) return;
  try {
    await api('/api/rhh/incidences', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: empId,
        type:     'retardo',
        date,
        date_end: date,
        hours:    Math.round(minutes / 60 * 10) / 10,
        notes:    `Retardo detectado por checador. Turno: ${shiftName}. Tiempo de retardo: ${fmtWorked(minutes)}.`,
      }),
    });
    await checadorSetStatus(recId, 'validado');
    toast('Incidencia de retardo creada');
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorCrearFalta(recId, empId, date) {
  if (!confirm(`¿Registrar falta para el ${date}? Solo se registró 1 checada (sin salida).`)) return;
  try {
    await api('/api/rhh/incidences', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: empId,
        type:     'falta',
        date,
        date_end: date,
        notes:    'Inasistencia detectada por checador: solo 1 checada registrada, sin registro de salida.',
      }),
    });
    await checadorSetStatus(recId, 'validado');
    toast('Falta registrada');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Context menu para tiempo extra ────────────────────────────────────────────
(function() {
  const menu = document.createElement('div');
  menu.id = 'ch-ctx-menu';
  menu.style.cssText = 'position:fixed;display:none;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:9999;min-width:180px;padding:4px 0;font-size:13px;';
  document.body.appendChild(menu);
  document.addEventListener('click', () => { menu.style.display = 'none'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.style.display = 'none'; });
})();

function checadorOvertimeMenu(event, recId) {
  const menu = document.getElementById('ch-ctx-menu');
  menu.innerHTML = `
    <div style="padding:6px 14px;color:#64748b;font-size:11px;border-bottom:1px solid #f1f5f9;">T. Extra — Opciones</div>
    <div onclick="checadorBorrarOvertime(${recId})"
      style="padding:8px 14px;cursor:pointer;color:#dc2626;display:flex;align-items:center;gap:6px;"
      onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background=''">
      🗑 Borrar tiempo extra
    </div>`;
  menu.style.display = 'block';
  const x = Math.min(event.clientX, window.innerWidth - 200);
  const y = Math.min(event.clientY, window.innerHeight - 80);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function checadorCleanupToggle(key, val) {
  if (!checadorState._cleanupSel) checadorState._cleanupSel = {};
  checadorState._cleanupSel[key] = val;
  renderChecador();
}

function checadorCleanupSelAll(val) {
  checadorState._cleanupSel = {};
  if (val) CLEANUP_COLLECTIONS.forEach(c => { checadorState._cleanupSel[c.key] = true; });
  renderChecador();
}

async function checadorEjecutarLimpieza() {
  const sel = checadorState._cleanupSel || {};
  const cols = Object.entries(sel).filter(([,v])=>v).map(([k])=>k);
  if (cols.length === 0) { toast('Selecciona al menos una colección', 'warning'); return; }
  const labels = cols.map(k => CLEANUP_COLLECTIONS.find(c=>c.key===k)?.label || k).join('\n  • ');
  if (!confirm(`⚠️ ¿Confirmas borrar permanentemente estos registros?\n\n  • ${labels}\n\nEsta acción NO se puede deshacer.`)) return;
  if (!confirm(`Segunda confirmación: ¿ESTÁS SEGURO? Se borrarán ${cols.length} colección(es).`)) return;
  try {
    const res = await api('/api/rhh/checador/admin/cleanup', {
      method: 'POST',
      body: JSON.stringify({ collections: cols }),
    });
    const detalles = Object.entries(res.cleared).map(([k,n])=>`${k}: ${n} registros`).join('\n');
    toast(`Limpieza completada. ${cols.length} colecciones borradas.`);
    alert(`Registros eliminados:\n${detalles}`);
    checadorState._cleanupSel = {};
    checadorState.records = [];
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorBorrarOvertime(recId) {
  document.getElementById('ch-ctx-menu').style.display = 'none';
  if (!confirm('¿Borrar el tiempo extra de este registro?')) return;
  try {
    await api(`/api/rhh/checador/records/${recId}`, {
      method: 'PATCH',
      body: JSON.stringify({ overtime_minutes: 0 }),
    });
    const idx = checadorState.records.findIndex(r => r.id === recId);
    if (idx !== -1) { checadorState.records[idx].overtime_minutes = 0; checadorState.records[idx].overtime_type = null; }
    toast('Tiempo extra eliminado');
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorCrearOvertime(recId, empId, date, minutes, shiftName, overtimeType) {
  const tipoMsg = overtimeType === 'llegada_anticipada'
    ? `\n⚠️ NOTA: Este tiempo extra es por llegada anticipada (más de 1h20 antes del turno).\nVerifica que corresponda realmente a tiempo extra autorizado.`
    : overtimeType === 'ambos'
    ? `\n⚠️ NOTA: Incluye tiempo de llegada anticipada y salida tardía.`
    : '';
  if (!confirm(`¿Registrar tiempo extra para el ${date}?\nTurno: ${shiftName}\nTiempo extra: ${fmtWorked(minutes)}${tipoMsg}`)) return;
  try {
    await api('/api/rhh/overtime', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: empId,
        date,
        date_end: date,
        hours: Math.round(minutes / 60 * 100) / 100,
        notes: `Tiempo extra detectado por checador. Turno: ${shiftName}. Tipo: ${overtimeType || 'salida'}. Tiempo: ${fmtWorked(minutes)}.`,
        status: 'pendiente',
      }),
    });
    await checadorSetStatus(recId, 'validado');
    toast('Tiempo extra registrado');
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorDetectarInasistencias() {
  if (!checadorState.absenceFrom || !checadorState.absenceTo) {
    toast('Selecciona el rango de fechas', 'warning'); return;
  }
  if (checadorState.absenceFrom > checadorState.absenceTo) {
    toast('La fecha inicial debe ser menor o igual a la final', 'warning'); return;
  }
  checadorState.absenceLoading = true;
  renderChecador();
  try {
    const data = await api('/api/rhh/checador/detect-absences', {
      method: 'POST',
      body: JSON.stringify({ date_from: checadorState.absenceFrom, date_to: checadorState.absenceTo }),
    });
    checadorState.absences = data.absences || [];
    if (data.sin_turno && data.sin_turno.length > 0) {
      toast(`${data.count} inasistencia(s). ${data.sin_turno.length} empleado(s) sin turno definido (no incluidos).`, 'warning');
    } else {
      toast(`${data.count} inasistencia(s) detectada(s)`);
    }
  } catch (err) { toast(err.message, 'error'); checadorState.absences = []; }
  checadorState.absenceLoading = false;
  renderChecador();
}

async function checadorCrearFaltaAbsence(empId, date, shiftName) {
  if (!confirm(`¿Crear falta para el ${date} (${shiftName})?`)) return;
  try {
    await api('/api/rhh/incidences', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: empId,
        type:     'falta',
        date,
        date_end: date,
        notes:    `Inasistencia detectada por checador. Turno: ${shiftName}. Sin checada registrada ese día.`,
      }),
    });
    // Remover del listado local
    checadorState.absences = checadorState.absences.filter(a => !(a.employee_id === empId && a.date === date));
    toast('Falta registrada');
    renderChecador();
  } catch (err) { toast(err.message, 'error'); }
}

async function checadorCrearTodasFaltas() {
  const n = checadorState.absences.length;
  if (n === 0) return;
  if (!confirm(`¿Crear ${n} incidencia(s) de falta? Esta acción no se puede deshacer.`)) return;
  let ok = 0, fail = 0;
  for (const a of checadorState.absences) {
    try {
      await api('/api/rhh/incidences', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: a.employee_id,
          type:     'falta',
          date:     a.date,
          date_end: a.date,
          notes:    `Inasistencia detectada por checador. Turno: ${a.shift_name}. Sin checada registrada ese día.`,
        }),
      });
      ok++;
    } catch (_) { fail++; }
  }
  checadorState.absences = [];
  toast(fail > 0 ? `${ok} faltas creadas, ${fail} errores` : `${ok} faltas creadas`, fail > 0 ? 'warning' : 'success');
  renderChecador();
}

// ══════════════════════════════════════════════════════════════════════════════
// CATÁLOGO EMPLEADOS — lee directo del JSON del repositorio
// ══════════════════════════════════════════════════════════════════════════════
let _catEmpDetalle = null; // id del empleado actualmente abierto

async function catalogoEmpleadosView() {
  const el = document.getElementById('app');
  if (!el) return;

  _catEmpDetalle = null;
  el.innerHTML = shell(`
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <h2 style="margin:0">👥 Catálogo Empleados</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select id="cat-status" class="form-select" style="width:auto">
        <option value="active">Activos</option>
        <option value="inactive">Inactivos</option>
        <option value="all">Todos</option>
      </select>
      <input id="cat-search" class="form-input" placeholder="Buscar nombre o #..." style="width:200px"/>
      <button class="btn-primary" onclick="catCargar()">🔍 Buscar</button>
      <button class="btn-ghost" onclick="catImportContpaq()" title="Actualizar Departamento y Puesto desde lista de asistencia CONTPAQ i (Excel .xlsx)">📥 Cargar CONTPAQ i</button>
    </div>
  </div>
  <div id="cat-import-msg" style="font-size:12px;color:#64748b;margin-bottom:8px"></div>
  <div id="cat-body"><div class="loading-overlay">Cargando catálogo...</div></div>
  `, 'catalogo-empleados');

  document.getElementById('cat-status')?.addEventListener('change', catCargar);
  document.getElementById('cat-search')?.addEventListener('keydown', e => { if (e.key === 'Enter') catCargar(); });

  catCargar();
}

async function catCargar() {
  const status = document.getElementById('cat-status')?.value || 'active';
  const search = document.getElementById('cat-search')?.value?.trim() || '';
  const body   = document.getElementById('cat-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-overlay">Cargando...</div>';

  const params = new URLSearchParams({ status });
  if (search) params.set('search', search);

  let data;
  try {
    data = await api(`/api/rhh/catalogo?${params}`);
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><p>Error: ${err.message || 'No se pudo cargar el catálogo'}</p></div>`;
    return;
  }
  if (!data || !data.employees) {
    body.innerHTML = '<div class="empty-state"><p>Error al cargar catálogo</p></div>';
    return;
  }

  const emps = data.employees;
  if (!emps.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>Sin empleados con ese filtro</p></div>';
    return;
  }

  const rows = emps.map(e => {
    const statusBadge = e.status === 'active'
      ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">Activo</span>'
      : '<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">Inactivo</span>';
    const portalBadge = e.has_portal
      ? `<span style="background:#eff6ff;color:#2563eb;padding:2px 6px;border-radius:20px;font-size:10px">🔑 ${e.portal_username}</span>`
      : '';
    return `
    <tr style="cursor:pointer" onclick="catVerDetalle(${e.id})">
      <td style="font-weight:600;color:#1e293b">#${e.employee_number}</td>
      <td>${esc(e.full_name)}</td>
      <td style="color:#64748b;font-size:13px">${esc(e.department_name || '—')}</td>
      <td style="color:#64748b;font-size:13px">${esc(e.position_name || '—')}</td>
      <td>${statusBadge}</td>
      <td>${portalBadge}</td>
      <td>
        <button class="btn-ghost btn-sm" onclick="event.stopPropagation();catVerDetalle(${e.id})">Ver</button>
        ${e.status === 'active' ? `<a href="/empleados" target="_blank" class="btn-ghost btn-sm" onclick="event.stopPropagation()" style="text-decoration:none">🏭 Portal</a>` : ''}
      </td>
    </tr>`;
  }).join('');

  body.innerHTML = `
  <div style="font-size:13px;color:#64748b;margin-bottom:10px">${emps.length} empleado${emps.length !== 1 ? 's' : ''}</div>
  <div style="overflow-x:auto">
  <table class="data-table">
    <thead><tr><th>#</th><th>Nombre</th><th>Departamento</th><th>Puesto</th><th>Estatus</th><th>Portal</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>`;
}

async function catVerDetalle(empId) {
  _catEmpDetalle = empId;
  const el = document.getElementById('app');
  if (!el) return;

  el.innerHTML = shell('<div class="loading-overlay">Cargando expediente...</div>', 'catalogo-empleados');

  const data = await api(`/api/rhh/catalogo/${empId}`).catch(() => null);
  if (!data || !data.employee) {
    el.innerHTML = shell('<div class="empty-state"><p>Error cargando empleado</p></div>', 'catalogo-empleados');
    return;
  }

  const e   = data.employee;
  const inc = data.incidencias || [];
  const acl = data.aclaraciones || [];
  const vac = data.vacaciones   || [];
  const ev  = data.evaluaciones || [];

  const statusColor = e.status === 'active' ? '#16a34a' : '#64748b';
  const statusLabel = e.status === 'active' ? 'Activo' : 'Inactivo';

  const incHtml = inc.length ? inc.slice(0, 20).map(r => `
  <tr>
    <td>S${r.no_periodo}</td>
    <td style="font-size:12px;color:#64748b">${r.fecha_inicio||''}–${r.fecha_fin||''}</td>
    <td style="text-align:center">${r.dias_pagados ?? '—'}</td>
    <td style="text-align:center;color:${r.faltas ? '#dc2626' : 'inherit'}">${r.faltas || 0}</td>
    <td style="text-align:center">${r.horas_extras_total || 0}</td>
    <td style="text-align:center">${r.despensa ? '✓' : ''}</td>
  </tr>`).join('')
  : '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">Sin incidencias registradas</td></tr>';

  const aclHtml = acl.length ? acl.map(a => `
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600">S${a.no_periodo} — ${a.created_at}</span>
      <span style="background:${a.status==='pendiente'?'#fef3c7':'#dcfce7'};color:${a.status==='pendiente'?'#92400e':'#16a34a'};padding:2px 8px;border-radius:20px;font-size:11px">${a.status}</span>
    </div>
    <p style="font-size:13px;color:#475569;margin:0 0 8px">${esc(a.mensaje)}</p>
    ${a.respuesta ? `<p style="font-size:12px;color:#1e40af;background:#eff6ff;padding:8px;border-radius:6px;margin:0">RH: ${esc(a.respuesta)}</p>` : `
    <div style="display:flex;gap:8px;margin-top:8px">
      <input class="form-input" id="resp-${a.id}" placeholder="Escribe respuesta..." style="flex:1;font-size:13px"/>
      <button class="btn-primary btn-sm" onclick="catResponderAcl(${e.id},${a.id})">Responder</button>
    </div>`}
  </div>`).join('')
  : '<div style="text-align:center;color:#94a3b8;padding:20px">Sin aclaraciones</div>';

  const vacHtml = vac.length ? vac.map(v => `
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:13px;font-weight:600">${v.fecha_inicio} → ${v.fecha_fin} (${v.dias} días)</div>
      <div style="font-size:12px;color:#64748b">${v.motivo || ''} · ${v.created_at}</div>
      ${v.notas_rh ? `<div style="font-size:12px;color:#1e40af">${esc(v.notas_rh)}</div>` : ''}
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <span style="background:${v.status==='aprobado'?'#dcfce7':v.status==='rechazado'?'#fee2e2':'#fef3c7'};color:${v.status==='aprobado'?'#16a34a':v.status==='rechazado'?'#dc2626':'#92400e'};padding:2px 8px;border-radius:20px;font-size:11px">${v.status}</span>
      ${v.status === 'pendiente' ? `
        <button class="btn-primary btn-sm" onclick="catAprobarVac(${v.id},'aprobado')">✓</button>
        <button class="btn-ghost btn-sm" onclick="catAprobarVac(${v.id},'rechazado')">✗</button>
      ` : ''}
    </div>
  </div>`).join('')
  : '<div style="text-align:center;color:#94a3b8;padding:20px">Sin solicitudes de vacaciones</div>';

  const credHtml = e.has_portal ? `
  <div style="background:#eff6ff;border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="font-size:13px;font-weight:600;color:#1e40af;margin-bottom:6px">Acceso al Portal del Empleado</div>
    <div style="font-size:13px;color:#475569">Usuario: <strong>${esc(e.portal_username)}</strong></div>
    <div style="font-size:12px;color:#64748b;margin-top:4px">Contraseña: configurada por el empleado</div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-ghost btn-sm" onclick="catResetCredencial(${e.id})">🔄 Resetear contraseña</button>
      <a href="/empleados" target="_blank" class="btn-ghost btn-sm" style="text-decoration:none">🏭 Ir al portal</a>
    </div>
  </div>` : `<div style="color:#94a3b8;font-size:13px">Sin acceso al portal configurado</div>`;

  el.innerHTML = shell(`
  <div style="margin-bottom:16px">
    <button class="btn-ghost" onclick="catalogoEmpleadosView()">← Volver al catálogo</button>
  </div>

  <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap">
    <div style="width:52px;height:52px;background:#eff6ff;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">👤</div>
    <div style="flex:1">
      <h2 style="margin:0;font-size:20px">${esc(e.full_name)}</h2>
      <div style="color:#64748b;font-size:14px">#${e.employee_number} · ${esc(e.position_name||'—')} · ${esc(e.department_name||'—')}</div>
      <div style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="background:${statusColor}22;color:${statusColor};padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600">${statusLabel}</span>
        <button class="btn-ghost btn-sm" onclick="catToggleEditForm(${e.id})">✏️ Editar datos</button>
      </div>
    </div>
  </div>

  <!-- Formulario de edición completa (oculto por defecto) -->
  <div id="cat-edit-form-${e.id}" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px">
    <div style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:14px">Editar información del empleado</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Departamento</label>
        <select id="edf-dept-${e.id}" class="form-input" style="font-size:13px">
          <option value="">— Sin asignar —</option>
          ${(data.departments||[]).sort((a,b)=>a.name.localeCompare(b.name)).map(d =>
            `<option value="${d.id}" ${d.id===e.department_id?'selected':''}>${esc(d.name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Puesto</label>
        <select id="edf-pos-${e.id}" class="form-input" style="font-size:13px">
          <option value="">— Sin asignar —</option>
          ${(data.positions||[]).sort((a,b)=>a.name.localeCompare(b.name)).map(p =>
            `<option value="${p.id}" ${p.id===e.position_id?'selected':''}>${esc(p.name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Turno</label>
        <select id="edf-shift-${e.id}" class="form-input" style="font-size:13px">
          <option value="">— Sin asignar —</option>
          ${(data.shifts||[]).map(s =>
            `<option value="${s.id}" ${s.id===e.shift_id?'selected':''}>${esc(s.name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Estatus</label>
        <select id="edf-status-${e.id}" class="form-input" style="font-size:13px">
          <option value="active"   ${e.status==='active'  ?'selected':''}>Activo</option>
          <option value="inactive" ${e.status==='inactive'?'selected':''}>Inactivo</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Teléfono</label>
        <input id="edf-phone-${e.id}" class="form-input" style="font-size:13px" value="${esc(e.phone||'')}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Correo electrónico</label>
        <input id="edf-email-${e.id}" class="form-input" style="font-size:13px" type="email" value="${esc(e.email||'')}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha Ingreso</label>
        <input id="edf-ingreso-${e.id}" class="form-input" style="font-size:13px" type="date" value="${esc(e.start_date||'')}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Salario Diario</label>
        <input id="edf-salario-${e.id}" class="form-input" style="font-size:13px" type="number" step="0.01" value="${e.salary_daily||''}"/>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-primary btn-sm" onclick="catGuardarEmpleado(${e.id})">Guardar cambios</button>
      <button class="btn-ghost btn-sm" onclick="catToggleEditForm(${e.id})">Cancelar</button>
    </div>
  </div>

  <div class="tabs" style="margin-bottom:16px">
    <button class="tab-btn active" id="tab-datos"       onclick="catEmpTab('datos')">📋 Datos</button>
    <button class="tab-btn"        id="tab-incidencias" onclick="catEmpTab('incidencias')">📊 Incidencias (${inc.length})</button>
    <button class="tab-btn"        id="tab-aclaraciones" onclick="catEmpTab('aclaraciones')">💬 Aclaraciones (${acl.length})</button>
    <button class="tab-btn"        id="tab-vacaciones"  onclick="catEmpTab('vacaciones')">🏖️ Vacaciones (${vac.length})</button>
    <button class="tab-btn"        id="tab-portal"      onclick="catEmpTab('portal')">🔑 Portal</button>
  </div>

  <!-- Datos -->
  <div id="tab-content-datos">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">RFC</label><div style="font-size:14px;padding:8px 0">${esc(e.rfc||'—')}</div></div>
      <div class="form-group"><label class="form-label">CURP</label><div style="font-size:13px;padding:8px 0">${esc(e.curp||'—')}</div></div>
      <div class="form-group"><label class="form-label">NSS</label><div style="font-size:14px;padding:8px 0">${esc(e.nss||'—')}</div></div>
      <div class="form-group"><label class="form-label">Fecha Ingreso</label><div style="font-size:14px;padding:8px 0">${esc(e.start_date||'—')}</div></div>
      <div class="form-group"><label class="form-label">Turno</label><div style="font-size:14px;padding:8px 0">${esc(e.shift_name||'—')}</div></div>
      <div class="form-group"><label class="form-label">Salario Diario</label><div style="font-size:14px;padding:8px 0">${e.salary_daily ? '$'+Number(e.salary_daily).toFixed(2) : '—'}</div></div>
      <div class="form-group"><label class="form-label">Teléfono</label><div style="font-size:14px;padding:8px 0">${esc(e.phone||'—')}</div></div>
      <div class="form-group"><label class="form-label">Correo</label><div style="font-size:14px;padding:8px 0">${esc(e.email||'—')}</div></div>
    </div>
    ${e.status === 'inactive' && e.fecha_baja ? `<div style="background:#fef2f2;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:13px;color:#991b1b">Baja: ${e.fecha_baja}${e.baja_motivo ? ' — '+esc(e.baja_motivo) : ''}</div>` : ''}
  </div>

  <!-- Incidencias -->
  <div id="tab-content-incidencias" style="display:none">
    <div style="overflow-x:auto">
    <table class="data-table">
      <thead><tr><th>Período</th><th>Fechas</th><th>Días Pag.</th><th>Faltas</th><th>H. Extra</th><th>Despensa</th></tr></thead>
      <tbody>${incHtml}</tbody>
    </table>
    </div>
  </div>

  <!-- Aclaraciones -->
  <div id="tab-content-aclaraciones" style="display:none">${aclHtml}</div>

  <!-- Vacaciones -->
  <div id="tab-content-vacaciones" style="display:none">${vacHtml}</div>

  <!-- Portal -->
  <div id="tab-content-portal" style="display:none">${credHtml}</div>

  `, 'catalogo-empleados');
}

function catEmpTab(name) {
  ['datos','incidencias','aclaraciones','vacaciones','portal'].forEach(t => {
    document.getElementById(`tab-content-${t}`)?.style.setProperty('display', t === name ? 'block' : 'none');
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === name);
  });
}

async function catResponderAcl(empId, aclId) {
  const respuesta = document.getElementById(`resp-${aclId}`)?.value?.trim();
  if (!respuesta) { toast('Escribe una respuesta', 'warning'); return; }
  const r = await api(`/api/rhh/catalogo/${empId}/aclaracion/${aclId}`, { method:'PATCH', body: JSON.stringify({ respuesta, status: 'respondido' }) }).catch(() => null);
  if (r) { toast('Respuesta guardada'); catVerDetalle(empId); }
}

async function catAprobarVac(vacId, status) {
  const r = await api(`/api/rhh/catalogo/vacaciones/${vacId}`, { method:'PATCH', body: JSON.stringify({ status }) }).catch(() => null);
  if (r) { toast(status === 'aprobado' ? 'Vacaciones aprobadas' : 'Solicitud rechazada'); catVerDetalle(_catEmpDetalle); }
}

async function catResetCredencial(empId) {
  if (!confirm('¿Resetear contraseña del portal? El empleado deberá cambiarla al ingresar.')) return;
  const r = await api(`/api/rhh/catalogo/${empId}/credenciales`, { method:'PATCH', body: JSON.stringify({}) }).catch(() => null);
  if (r && r.ok) {
    toast(`Credenciales reseteadas. Usuario: ${r.username} / Pass inicial: ${r.password}`, 'success');
    catVerDetalle(empId);
  }
}

// Guardar dept/puesto individual
async function catGuardarInfo(empId) {
  const deptId = document.getElementById('edit-dept-' + empId)?.value;
  const posId  = document.getElementById('edit-pos-'  + empId)?.value;
  const msgEl  = document.getElementById('cat-info-msg-' + empId);
  const r = await api(`/api/rhh/catalogo/${empId}/info`, {
    method: 'PATCH',
    body: JSON.stringify({ department_id: deptId || null, position_id: posId || null })
  }).catch(() => null);
  if (r && r.ok) {
    if (msgEl) { msgEl.style.display = 'block'; msgEl.textContent = '✓ Guardado correctamente'; setTimeout(()=>{ msgEl.style.display='none'; }, 3000); }
    toast('Departamento y puesto actualizados', 'success');
  } else {
    toast('Error al guardar', 'error');
  }
}

// Mostrar/ocultar formulario de edición completa
function catToggleEditForm(empId) {
  const f = document.getElementById('cat-edit-form-' + empId);
  if (!f) return;
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

// Guardar todos los campos editables del empleado
async function catGuardarEmpleado(empId) {
  const g = id => document.getElementById(id)?.value;
  const payload = {
    department_id: g('edf-dept-'+empId) || null,
    position_id:   g('edf-pos-'+empId)  || null,
    shift_id:      g('edf-shift-'+empId) || null,
    status:        g('edf-status-'+empId),
    phone:         g('edf-phone-'+empId),
    email:         g('edf-email-'+empId),
    start_date:    g('edf-ingreso-'+empId),
    salary_daily:  g('edf-salario-'+empId) ? Number(g('edf-salario-'+empId)) : null,
  };
  const r = await api(`/api/rhh/catalogo/${empId}/info`, {
    method: 'PATCH', body: JSON.stringify(payload)
  }).catch(() => null);
  if (r && r.ok) {
    toast('Empleado actualizado', 'success');
    catVerDetalle(empId);
  } else {
    toast('Error al guardar', 'error');
  }
}

// Importar Departamento y Puesto desde lista CONTPAQ i (Excel)
async function catImportContpaq() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const msgEl = document.getElementById('cat-import-msg');
    if (msgEl) msgEl.textContent = 'Importando...';
    try {
      const res = await fetch('/api/rhh/catalogo/import-contpaq', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token },
        body: fd
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.error || 'Error al importar', 'error'); return; }
      const msg = `✓ Actualizados: ${d.updated} | Nuevos depts: ${d.created_depts} | Nuevos puestos: ${d.created_pos} | Omitidos: ${d.skipped}`;
      if (msgEl) { msgEl.textContent = msg; msgEl.style.color = '#16a34a'; }
      toast(msg, 'success');
      // Refrescar catálogos en memoria para que evaluaciones y otras vistas usen datos actualizados
      await loadCatalogs();
      setTimeout(() => catalogoEmpleadosView(), 1200);
    } catch (err) {
      toast('Error de conexión', 'error');
    }
  };
  input.click();
}

