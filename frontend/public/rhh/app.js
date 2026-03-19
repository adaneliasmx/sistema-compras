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
  shifts: []
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
    ['lista-asistencia', '📋 ROL / Asistencia'],
    ['calendario', '📅 Calendario'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['ausencias-hoy', '🚨 Ausencias Hoy'],
    ['mis-evaluaciones', '⭐ Mi Evaluación']
  ],
  rh: [
    ['dashboard', '📊 Dashboard'],
    ['lista-asistencia', '📋 ROL / Asistencia'],
    ['empleados', '👥 Empleados'],
    ['calendario', '📅 Calendario'],
    ['incidencias', '⚠️ Incidencias'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['prenomina', '💰 Prenómina'],
    ['vacantes', '🔍 Vacantes'],
    ['evaluaciones', '⭐ Evaluaciones'],
    ['reportes', '📊 Reportes'],
    ['quejas-rh', '📢 Quejas'],
    ['aclaraciones-rh', '💬 Aclaraciones']
  ],
  admin: [
    ['dashboard', '📊 Dashboard'],
    ['lista-asistencia', '📋 ROL / Asistencia'],
    ['empleados', '👥 Empleados'],
    ['calendario', '📅 Calendario'],
    ['incidencias', '⚠️ Incidencias'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['prenomina', '💰 Prenómina'],
    ['vacantes', '🔍 Vacantes'],
    ['evaluaciones', '⭐ Evaluaciones'],
    ['catalogos', '📁 Catálogos'],
    ['plantillas', '📄 Plantillas'],
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
  try {
    const data = await api('/api/rhh/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (!data) return;
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('rhh_token', data.token);
    await loadCatalogs();
    const role = state.user.role;
    const menu = MENU_BY_ROLE[role] || [];
    location.hash = menu.length ? menu[0][0] : 'dashboard';
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Cargar catálogos al inicio ────────────────────────────────────────────────
async function loadCatalogs() {
  try {
    const [emps, depts, pos, shifts] = await Promise.all([
      api('/api/rhh/employees'),
      api('/api/rhh/catalogs/departments'),
      api('/api/rhh/catalogs/positions'),
      api('/api/rhh/catalogs/shifts')
    ]);
    state.employees = emps || [];
    state.departments = depts || [];
    state.positions = pos || [];
    state.shifts = shifts || [];
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

// ── Shell (layout con sidebar) ────────────────────────────────────────────────
function shell(content, activeHash) {
  const role = state.user?.role || 'empleado';
  const menu = MENU_BY_ROLE[role] || [];
  const menuHtml = menu.map(([hash, label]) =>
    `<a href="#${hash}" class="${activeHash === hash ? 'active' : ''}">${label}</a>`
  ).join('');

  return `
    <div class="layout rhh-layout">
      <aside class="sidebar">
        <div class="brand">👥 Recursos Humanos</div>
        <nav class="nav">${menuHtml}</nav>
        <div class="sidebar-footer">
          <a href="#perfil">⚙️ ${state.user?.full_name || 'Mi perfil'}</a>
          <a href="#" onclick="logout();return false;">🚪 Cerrar sesión</a>
          <a href="/">← Portal principal</a>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <strong>${state.user?.full_name || ''}</strong>
            <span class="badge" style="margin-left:8px;">${role.toUpperCase()}</span>
          </div>
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
                 <th>No. Emp</th><th>Nombre</th><th>Departamento</th>
                 <th>Puesto</th><th>Turno</th><th>Salario</th><th>Vac.</th><th>Estatus</th><th>Acciones</th>
               </tr></thead>
               <tbody>
                 ${employees.map(emp => {
                   const vacRem = emp.vacation_remaining ?? (emp.total_vacation_days || 15);
                   const vacTotal = emp.total_vacation_days || 15;
                   const vacColor = vacRem <= 0 ? '#b91c1c' : vacRem <= 5 ? '#b45309' : '#059669';
                   return `
                   <tr>
                     <td><span class="small muted">${emp.employee_number}</span>${emp.checker_number ? `<br><span class="small muted">Check: ${emp.checker_number}</span>` : ''}</td>
                     <td>
                       <strong>${emp.full_name}</strong><br>
                       <span class="small muted">${emp.email}</span>
                     </td>
                     <td>${emp.department?.name || '—'}</td>
                     <td>${emp.position?.name || '—'}</td>
                     <td>${shiftDot(emp.shift)}</td>
                     <td style="text-align:right;font-size:12px;">${emp.daily_salary ? `$${Number(emp.daily_salary).toLocaleString()}/día` : (emp.base_salary ? `$${Number(emp.base_salary).toLocaleString()}/mes` : '—')}</td>
                     <td style="text-align:center;font-weight:700;color:${vacColor};font-size:12px;" title="${vacRem} días restantes de ${vacTotal}">${vacRem}/${vacTotal}</td>
                     <td>${statusPill(emp.status)}</td>
                     <td>
                       <button class="btn-ghost" style="font-size:12px;" onclick="showEditEmployee(${emp.id})">✏️ Editar</button>
                       <button class="btn-ghost" style="font-size:12px;" onclick="showExpediente(${emp.id})">📁 Exp.</button>
                       <button class="btn-ghost" style="font-size:12px;" onclick="historialEmpleadoView(${emp.id})">📋 Historial</button>
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

    const content = `
      <div class="module-title">
        <h2>👥 Gestión de Empleados</h2>
        <button class="btn-primary" onclick="empTab='nuevo';empEditId=null;empleadosView()">+ Nuevo empleado</button>
      </div>
      <div class="tabs">
        <button class="tab-btn ${empTab==='list'?'active':''}" onclick="empTab='list';empleadosView()">📋 Lista</button>
        <button class="tab-btn ${empTab==='nuevo'?'active':''}" onclick="empTab='nuevo';empleadosView()">➕ Nuevo/Editar</button>
        ${empEditId ? `<button class="tab-btn ${empTab==='expediente'?'active':''}" onclick="empTab='expediente';empleadosView()">📁 Expediente</button>` : ''}
      </div>
      ${empTab === 'list' ? listContent : (empTab === 'expediente' ? '<div id="expediente-wrap"><div class="loading-overlay">Cargando expediente...</div></div>' : formContent)}
    `;

    el.innerHTML = shell(content, 'empleados');
    if (empTab === 'expediente' && empEditId) {
      loadExpediente(empEditId);
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
          <label>Teléfono</label>
          <input id="ef-phone" value="${emp?.phone || ''}" placeholder="555-0000" />
        </div>
        <div>
          <label>Fecha de nacimiento</label>
          <input id="ef-birth" type="date" value="${emp?.birth_date || ''}" />
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
    total_vacation_days: document.getElementById('ef-vac-days')?.value ? Number(document.getElementById('ef-vac-days').value) : 15
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

// ── 6. Incidencias ────────────────────────────────────────────────────────────
let incFilter = { employee_id: '', type: '', status: '', date_from: '', date_to: '' };

async function incidenciasView() {
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
  _msVacBalance = null; // reset cache on each view load
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando solicitudes...</div>', 'mis-solicitudes');

  try {
    const empId = state.user?.employee_id;
    const [incidences, vacBalance] = await Promise.all([
      api('/api/rhh/incidences'),
      empId ? api(`/api/rhh/employees/vacation-balance/${empId}`).catch(() => null) : Promise.resolve(null)
    ]);
    if (!incidences) return;

    const myIncidences = (incidences || []).filter(i =>
      ['vacacion', 'permiso'].includes(i.type) && i.employee_id === empId
    );

    const vacInfoHtml = vacBalance
      ? `<div style="padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:12px;font-size:13px;">
          🌴 <strong>Vacaciones ${vacBalance.year}:</strong>
          Usadas <strong>${vacBalance.vacation_used}</strong> ·
          Pendientes <strong>${vacBalance.vacation_pending}</strong> ·
          <span style="color:#059669;font-weight:700;">${vacBalance.vacation_remaining} días disponibles</span> de ${vacBalance.total_vacation_days}
        </div>`
      : '';

    const rows = myIncidences.map(inc => `
      <tr>
        <td>${incTypePill(inc.type)}</td>
        <td>${fmtDateDisplay(inc.date)}${inc.date_end && inc.date_end !== inc.date ? ` → ${fmtDateDisplay(inc.date_end)}` : ''}</td>
        <td>${statusPill(inc.status)}</td>
        <td>${inc.notes || '—'}</td>
        <td>${fmtDateDisplay(inc.created_at?.slice(0, 10))}</td>
      </tr>`).join('');

    const content = `
      <div class="module-title">
        <h2>📝 Mis Solicitudes</h2>
      </div>

      ${vacInfoHtml}

      <div class="card section" style="margin-bottom:16px;">
        <h3>Nueva solicitud</h3>
        <div class="row">
          <div>
            <label>Tipo *</label>
            <select id="ms-type" onchange="onMsSolicitudTypeChange()">
              <option value="vacacion">Vacación</option>
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
          <textarea id="ms-notes" rows="2" placeholder="Describe el motivo de tu solicitud..."></textarea>
        </div>
        <div id="ms-warn" style="display:none;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:13px;color:#92400e;"></div>
        <div style="margin-top:10px;">
          <button id="ms-submit-btn" class="btn-primary" onclick="submitMiSolicitud()">Enviar solicitud</button>
        </div>
      </div>

      <div class="card section">
        <h3>Historial de solicitudes</h3>
        ${myIncidences.length === 0
          ? '<div class="empty-state"><div class="empty-icon">📝</div><p>No has enviado solicitudes aún</p></div>'
          : `<table>
               <thead><tr><th>Tipo</th><th>Fechas</th><th>Estado</th><th>Notas</th><th>Solicitado</th></tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>
    `;

    el.innerHTML = shell(content, 'mis-solicitudes');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'mis-solicitudes');
  }
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
async function autorizacionesView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando solicitudes pendientes...</div>', 'autorizaciones');

  try {
    const incidences = await api('/api/rhh/incidences?status=pendiente');
    if (!incidences) return;

    const rows = incidences.map(inc => `
      <tr>
        <td>
          <strong>${inc.employee?.full_name || '—'}</strong><br>
          <span class="small muted">${inc.employee?.employee_number || ''}</span>
        </td>
        <td>${incTypePill(inc.type)}</td>
        <td>${fmtDateDisplay(inc.date)}${inc.date_end && inc.date_end !== inc.date ? ` → ${fmtDateDisplay(inc.date_end)}` : ''}</td>
        <td>${inc.department?.name || '—'}</td>
        <td>${inc.notes || '—'}</td>
        <td>${fmtDateDisplay(inc.created_at?.slice(0, 10))}</td>
        <td>
          <button class="btn-primary" style="font-size:11px;padding:5px 10px;" onclick="approveIncidence(${inc.id},'aprobada')">✅ Aprobar</button>
          <button class="btn-ghost" style="font-size:11px;padding:5px 10px;color:#b91c1c;margin-top:4px;" onclick="approveIncidence(${inc.id},'rechazada')">✗ Rechazar</button>
        </td>
      </tr>`).join('');

    const content = `
      <div class="module-title">
        <h2>✅ Solicitudes Pendientes</h2>
        <span class="badge">${incidences.length} pendientes</span>
      </div>

      <div class="card section table-wrap">
        ${incidences.length === 0
          ? '<div class="empty-state"><div class="empty-icon">✅</div><p>No hay solicitudes pendientes de autorización</p></div>'
          : `<table>
               <thead><tr>
                 <th>Empleado</th><th>Tipo</th><th>Fecha(s)</th>
                 <th>Departamento</th><th>Notas</th><th>Solicitado</th><th>Acción</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>
    `;

    el.innerHTML = shell(content, 'autorizaciones');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'autorizaciones');
  }
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

// ── 12. Prenómina ─────────────────────────────────────────────────────────────
let prenomYear = new Date().getFullYear();
let prenomMonth = new Date().getMonth() + 1;

async function prenominaView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Calculando prenómina...</div>', 'prenomina');

  try {
    const [employees, incData] = await Promise.all([
      api('/api/rhh/employees?status=active'),
      api(`/api/rhh/incidences?date_from=${prenomYear}-${String(prenomMonth).padStart(2,'0')}-01&date_to=${prenomYear}-${String(prenomMonth).padStart(2,'0')}-${new Date(prenomYear, prenomMonth, 0).getDate()}`)
    ]);
    if (!employees || !incData) return;

    const incidences = incData || [];
    const lastDay = new Date(prenomYear, prenomMonth, 0).getDate();

    const rows = (employees || []).map(emp => {
      const empInc = incidences.filter(i => i.employee_id === emp.id && i.status !== 'rechazada');
      const faltas = empInc.filter(i => i.type === 'falta').length;
      const vacaciones = empInc.filter(i => i.type === 'vacacion').length;
      const permisos = empInc.filter(i => i.type === 'permiso').length;
      const incapacidades = empInc.filter(i => i.type === 'incapacidad').length;
      const htExtra = empInc.filter(i => i.type === 'tiempo_extra').reduce((s, i) => s + (i.hours || 0), 0);

      // Cálculo de días trabajados (estimado)
      const shift = state.shifts.find(s => s.id === emp.shift_id);
      const workDays = shift ? shift.work_days : [1, 2, 3, 4, 5];
      let laborDays = 0;
      for (let d = 1; d <= lastDay; d++) {
        const dow = new Date(`${prenomYear}-${String(prenomMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00`).getDay();
        if (workDays.includes(dow)) laborDays++;
      }

      const diasTrabajados = Math.max(0, laborDays - faltas - vacaciones - permisos - incapacidades);
      const salarioDiario = (emp.base_salary || 0) / 30;
      const totalEst = (diasTrabajados * salarioDiario).toFixed(2);

      return `
        <tr>
          <td>
            <strong>${emp.full_name}</strong><br>
            <span class="small muted">${emp.employee_number}</span>
          </td>
          <td>${shiftDot(state.shifts.find(s => s.id === emp.shift_id) || null)}</td>
          <td style="text-align:center;">${laborDays}</td>
          <td style="text-align:center;color:#b91c1c;">${faltas}</td>
          <td style="text-align:center;color:#1d4ed8;">${vacaciones}</td>
          <td style="text-align:center;color:#854d0e;">${permisos}</td>
          <td style="text-align:center;color:#7c3aed;">${incapacidades}</td>
          <td style="text-align:center;color:#059669;font-weight:700;">${htExtra > 0 ? htExtra + 'h' : '—'}</td>
          <td style="text-align:center;font-weight:700;">${diasTrabajados}</td>
          <td style="text-align:right;font-weight:700;">$${Number(emp.base_salary || 0).toLocaleString()}</td>
          <td style="text-align:right;color:#059669;font-weight:700;">$${Number(totalEst).toLocaleString()}</td>
        </tr>`;
    }).join('');

    const content = `
      <div class="module-title">
        <h2>💰 Prenómina</h2>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button class="btn-ghost" onclick="prenomMonth--;if(prenomMonth<1){prenomMonth=12;prenomYear--;}prenominaView()">‹</button>
        <strong style="min-width:160px;text-align:center;">${MONTHS[prenomMonth-1]} ${prenomYear}</strong>
        <button class="btn-ghost" onclick="prenomMonth++;if(prenomMonth>12){prenomMonth=1;prenomYear++;}prenominaView()">›</button>
      </div>

      <div class="card section table-wrap">
        <table class="prenomina-table">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Turno</th>
              <th style="text-align:center;">Días hábiles</th>
              <th style="text-align:center;color:#b91c1c;">Faltas</th>
              <th style="text-align:center;color:#1d4ed8;">Vacac.</th>
              <th style="text-align:center;color:#854d0e;">Permisos</th>
              <th style="text-align:center;color:#7c3aed;">Incapac.</th>
              <th style="text-align:center;color:#059669;">H. Extra</th>
              <th style="text-align:center;">Días trab.</th>
              <th style="text-align:right;">Salario base</th>
              <th style="text-align:right;color:#059669;">Total est.</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="11" style="text-align:center;color:var(--muted);">Sin empleados activos</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="notice" style="margin-top:12px;">
        <strong>Nota:</strong> Los valores mostrados son estimados basados en los días hábiles del mes, incidencias aprobadas y el salario base mensual. El cálculo real de nómina puede incluir bonos, deducciones y otros factores.
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
          <h3>Puestos</h3>
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

    const content = `
      <div class="module-title">
        <h2>📁 Catálogos</h2>
      </div>
      <div class="tabs">
        <button class="tab-btn ${catTab==='departments'?'active':''}" onclick="catTab='departments';catalogosView()">🏢 Departamentos</button>
        <button class="tab-btn ${catTab==='positions'?'active':''}" onclick="catTab='positions';catalogosView()">💼 Puestos</button>
        <button class="tab-btn ${catTab==='shifts'?'active':''}" onclick="catTab='shifts';catalogosView()">⏰ Turnos</button>
        <button class="tab-btn ${catTab==='vacation-rules'?'active':''}" onclick="catTab='vacation-rules';catalogosView()">🌴 Reglas Vacaciones</button>
      </div>
      ${tabContent}
    `;

    el.innerHTML = shell(content, 'catalogos');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'catalogos');
  }
}

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
      api('/api/rhh/dashboard/overtime-summary')
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

    el.innerHTML = shell(content, 'reportes');
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

    <div class="card section" style="max-width:600px;">
      <div style="padding:12px;background:#fef9c3;border-radius:10px;border:1px solid #fcd34d;margin-bottom:20px;">
        <strong>🔒 Tu identidad no será revelada.</strong><br>
        <span class="small">Esta queja es completamente anónima. Solo el área de Recursos Humanos puede ver su contenido. No se registra ningún dato que te identifique.</span>
      </div>

      <div class="row">
        <div>
          <label>Categoría *</label>
          <select id="qan-cat">${catOpts}</select>
        </div>
      </div>
      <div style="margin-top:12px;">
        <label>Descripción * (mínimo 20 caracteres)</label>
        <textarea id="qan-desc" rows="5" placeholder="Describe la situación con el mayor detalle posible..."></textarea>
        <div id="qan-count" class="small muted" style="text-align:right;margin-top:4px;">0 caracteres</div>
      </div>
      <div style="margin-top:14px;">
        <button class="btn-primary" onclick="submitQueja()">📤 Enviar queja anónima</button>
      </div>
    </div>
  `;

  const role = state.user?.role || 'empleado';
  el.innerHTML = shell(content, 'queja-anonima');

  // Contador de caracteres
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

async function submitQueja() {
  const category = document.getElementById('qan-cat')?.value;
  const description = document.getElementById('qan-desc')?.value?.trim();
  if (!category || !description) { toast('Completa todos los campos', 'warning'); return; }
  if (description.length < 20) { toast('La descripción debe tener al menos 20 caracteres', 'warning'); return; }

  try {
    await api('/api/rhh/incidences/complaints', {
      method: 'POST',
      body: JSON.stringify({ category, description })
    });
    toast('Tu queja ha sido enviada de forma anónima. Gracias por reportar.');
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

    const rows = vacantes.map(v => `
      <tr>
        <td>${v.position?.name || '—'}</td>
        <td>${v.department?.name || '—'}</td>
        <td>${v.shift?.name || '—'}</td>
        <td><span class="badge">${REASON_LABEL[v.reason] || v.reason}</span></td>
        <td><span style="padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;${PRIORITY_STYLE[v.priority] || ''}">${v.priority || '—'}</span></td>
        <td>${STATUS_LABEL[v.status] || v.status}</td>
        <td>${fmtDateDisplay(v.opened_date)}</td>
        <td>
          ${v.status === 'open' ? `<button class="btn-ghost" style="font-size:12px;" onclick="updateVacancy(${v.id},'in_process')">▶ En proceso</button>` : ''}
          ${v.status === 'in_process' ? `<button class="btn-primary" style="font-size:11px;padding:4px 8px;" onclick="updateVacancy(${v.id},'filled')">✅ Cubierta</button>` : ''}
          ${['open','in_process'].includes(v.status) ? `<button class="btn-ghost" style="font-size:11px;color:#b91c1c;" onclick="updateVacancy(${v.id},'cancelled')">✕ Cancelar</button>` : ''}
        </td>
      </tr>`).join('');

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

      <div class="card section table-wrap">
        ${vacantes.length === 0
          ? '<div class="empty-state"><div class="empty-icon">🔍</div><p>No hay vacantes registradas</p></div>'
          : `<table>
               <thead><tr>
                 <th>Puesto</th><th>Depto</th><th>Turno</th><th>Motivo</th>
                 <th>Prioridad</th><th>Estado</th><th>Apertura</th><th>Acciones</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>`
        }
      </div>
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

let evalTab = 'periodos';

async function evaluacionesView() {
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando evaluaciones...</div>', 'evaluaciones');

  try {
    const [periods, templates] = await Promise.all([
      api('/api/rhh/evaluations/periods'),
      api('/api/rhh/evaluations/templates')
    ]);

    const tabContent = evalTab === 'periodos'
      ? await buildPeriodosTab(periods || [], templates || [])
      : evalTab === 'plantillas'
      ? buildPlantillasTab(templates || [])
      : await buildResultadosTab(periods || []);

    const content = `
      <div class="module-title">
        <h2>⭐ Evaluaciones de Desempeño</h2>
      </div>
      <div class="tabs">
        <button class="tab-btn ${evalTab==='periodos'?'active':''}" onclick="evalTab='periodos';evaluacionesView()">📅 Periodos</button>
        <button class="tab-btn ${evalTab==='plantillas'?'active':''}" onclick="evalTab='plantillas';evaluacionesView()">📋 Plantillas</button>
        <button class="tab-btn ${evalTab==='resultados'?'active':''}" onclick="evalTab='resultados';evaluacionesView()">📊 Resultados</button>
      </div>
      ${tabContent}
    `;
    el.innerHTML = shell(content, 'evaluaciones');
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'evaluaciones');
  }
}

async function buildPeriodosTab(periods, templates) {
  const empOpts = state.employees.map(e =>
    `<option value="${e.id}">${e.full_name}</option>`).join('');
  const tplOpts = templates.map(t =>
    `<option value="${t.id}">${t.name}</option>`).join('');
  const userOpts = state.employees.map(e =>
    `<option value="${e.id}">${e.full_name}</option>`).join('');

  const STATUS_LABEL = { open: 'Abierto', closed: 'Cerrado', draft: 'Borrador' };

  const periodsHtml = periods.length === 0
    ? '<div class="empty-state"><div class="empty-icon">📅</div><p>No hay periodos registrados</p></div>'
    : periods.map(p => {
        const completedCount = (p.evaluations || []).filter(e => e.completed).length;
        const totalCount = (p.evaluations || []).length;
        return `
          <div class="card" style="margin-bottom:12px;padding:16px;border-left:4px solid ${p.status==='closed'?'#059669':'#f59e0b'};">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <strong>${p.name}</strong>
              <span class="badge">${STATUS_LABEL[p.status] || p.status}</span>
            </div>
            <div class="small muted">${fmtDateDisplay(p.start_date)} → ${fmtDateDisplay(p.end_date)}</div>
            <div class="small muted" style="margin-top:4px;">Evaluaciones: ${completedCount}/${totalCount} completadas</div>
            ${p.status === 'closed' || p.status === 'open' ? `
              <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap;align-items:center;">
                <label style="font-weight:normal;font-size:13px;">
                  Calidad cumplida:
                  <select onchange="updatePeriodo(${p.id},{quality_met:this.value==='true'})" style="font-size:13px;padding:3px 6px;">
                    <option value="true" ${p.quality_met===true?'selected':''}>Sí</option>
                    <option value="false" ${p.quality_met===false?'selected':''}>No</option>
                    <option value="null" ${p.quality_met===null?'selected':''}>—</option>
                  </select>
                </label>
                <label style="font-weight:normal;font-size:13px;">
                  Reclamos cumplidos:
                  <select onchange="updatePeriodo(${p.id},{claims_met:this.value==='true'})" style="font-size:13px;padding:3px 6px;">
                    <option value="true" ${p.claims_met===true?'selected':''}>Sí</option>
                    <option value="false" ${p.claims_met===false?'selected':''}>No</option>
                    <option value="null" ${p.claims_met===null?'selected':''}>—</option>
                  </select>
                </label>
                ${p.status === 'open' ? `<button class="btn-ghost" style="font-size:12px;" onclick="updatePeriodo(${p.id},{status:'closed'})">🔒 Cerrar periodo</button>` : ''}
              </div>` : ''}
          </div>`;
      }).join('');

  return `
    <div class="card section" style="margin-bottom:16px;">
      <h3>Crear nuevo periodo</h3>
      <div class="row">
        <div><label>Nombre *</label><input id="ep-name" placeholder="Ej: Marzo 2026" /></div>
        <div><label>Fecha inicio *</label><input id="ep-start" type="date" /></div>
      </div>
      <div class="row">
        <div><label>Fecha fin *</label><input id="ep-end" type="date" /></div>
      </div>
      <h4 style="margin:12px 0 8px;">Asignaciones (evaluador → evaluado)</h4>
      <div id="ep-assignments" style="margin-bottom:8px;"></div>
      <button class="btn-ghost" onclick="addEpAssignment('${empOpts.replace(/'/g,"\\'")}','${tplOpts.replace(/'/g,"\\'")}','${userOpts.replace(/'/g,"\\'")}')">+ Agregar asignación</button>
      <div class="actions" style="margin-top:12px;">
        <button class="btn-primary" onclick="savePeriodo()">💾 Guardar periodo</button>
      </div>
    </div>
    <div>${periodsHtml}</div>
  `;
}

let _epEmpOpts = '', _epTplOpts = '', _epUserOpts = '';
function addEpAssignment(empOpts, tplOpts, userOpts) {
  if (empOpts) { _epEmpOpts = empOpts; _epTplOpts = tplOpts; _epUserOpts = userOpts; }
  const container = document.getElementById('ep-assignments');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.style.cssText = 'margin-bottom:8px;align-items:center;';
  row.innerHTML = `
    <div><label style="font-size:12px;">Evaluador</label>
      <select class="ep-evaluator" style="font-size:13px;"><option value="">—</option>${_epUserOpts}</select></div>
    <div><label style="font-size:12px;">Evaluado</label>
      <select class="ep-employee" style="font-size:13px;"><option value="">—</option>${_epEmpOpts}</select></div>
    <div><label style="font-size:12px;">Plantilla</label>
      <select class="ep-template" style="font-size:13px;"><option value="">—</option>${_epTplOpts}</select></div>
    <div style="align-self:flex-end;"><button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="this.closest('.row').remove()">✕</button></div>
  `;
  container.appendChild(row);
}

async function savePeriodo() {
  const name = document.getElementById('ep-name')?.value?.trim();
  const start_date = document.getElementById('ep-start')?.value;
  const end_date = document.getElementById('ep-end')?.value;
  if (!name || !start_date || !end_date) {
    toast('Nombre, fecha inicio y fecha fin son requeridos', 'warning');
    return;
  }
  const evaluations = [];
  document.querySelectorAll('#ep-assignments .row').forEach(row => {
    const ev = row.querySelector('.ep-evaluator')?.value;
    const emp = row.querySelector('.ep-employee')?.value;
    const tpl = row.querySelector('.ep-template')?.value;
    if (ev && emp && tpl) {
      evaluations.push({ evaluator_id: Number(ev), employee_id: Number(emp), template_id: Number(tpl) });
    }
  });
  try {
    await api('/api/rhh/evaluations/periods', {
      method: 'POST',
      body: JSON.stringify({ name, start_date, end_date, evaluations })
    });
    toast('Periodo creado');
    evaluacionesView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function updatePeriodo(id, body) {
  try {
    await api(`/api/rhh/evaluations/periods/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    toast('Periodo actualizado');
    evaluacionesView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function buildPlantillasTab(templates) {
  const FIELD_TYPES = { score_1_5: 'Puntuación 1-5', score_1_10: 'Puntuación 1-10', boolean: 'Sí/No', text: 'Texto' };

  const tplList = templates.length === 0
    ? '<div class="empty-state"><div class="empty-icon">📋</div><p>No hay plantillas registradas</p></div>'
    : templates.map(t => `
        <div class="card" style="margin-bottom:10px;padding:14px;">
          <strong>${t.name}</strong>
          ${t.position_id ? `<span class="small muted"> — ${state.positions.find(p=>p.id===t.position_id)?.name||''}</span>` : ''}
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
            ${(t.fields||[]).map(f => `<span class="badge">${f.label} (${f.weight}%)</span>`).join('')}
          </div>
        </div>`
      ).join('');

  const posOpts = state.positions.map(p =>
    `<option value="${p.id}">${p.name}</option>`).join('');

  return `
    <div class="card section" style="margin-bottom:16px;">
      <h3>Nueva plantilla de evaluación</h3>
      <div class="row">
        <div><label>Nombre *</label><input id="tpl-name" placeholder="Ej: Evaluación Operativo" /></div>
        <div><label>Puesto (opcional)</label>
          <select id="tpl-pos"><option value="">Todos los puestos</option>${posOpts}</select>
        </div>
      </div>
      <h4 style="margin:12px 0 8px;">Campos de evaluación</h4>
      <div id="tpl-fields"></div>
      <button class="btn-ghost" onclick="addTplField()">+ Agregar campo</button>
      <div class="actions" style="margin-top:12px;">
        <button class="btn-primary" onclick="saveTemplate()">💾 Guardar plantilla</button>
      </div>
    </div>
    <div>${tplList}</div>
  `;
}

function addTplField() {
  const container = document.getElementById('tpl-fields');
  if (!container) return;
  const idx = container.children.length;
  const row = document.createElement('div');
  row.className = 'row';
  row.style.cssText = 'margin-bottom:8px;align-items:center;';
  row.innerHTML = `
    <div><label style="font-size:12px;">Etiqueta</label><input class="tpl-f-label" placeholder="Ej: Puntualidad" style="font-size:13px;" /></div>
    <div><label style="font-size:12px;">Tipo</label>
      <select class="tpl-f-type" style="font-size:13px;">
        <option value="score_1_5">Puntuación 1-5</option>
        <option value="score_1_10">Puntuación 1-10</option>
        <option value="boolean">Sí/No</option>
        <option value="text">Texto</option>
      </select></div>
    <div><label style="font-size:12px;">Peso %</label><input class="tpl-f-weight" type="number" min="0" max="100" value="0" style="font-size:13px;width:70px;" /></div>
    <div style="align-self:flex-end;"><button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="this.closest('.row').remove()">✕</button></div>
  `;
  container.appendChild(row);
}

async function saveTemplate() {
  const name = document.getElementById('tpl-name')?.value?.trim();
  const position_id = document.getElementById('tpl-pos')?.value || null;
  if (!name) { toast('El nombre de la plantilla es requerido', 'warning'); return; }

  const fields = [];
  document.querySelectorAll('#tpl-fields .row').forEach((row, i) => {
    const label = row.querySelector('.tpl-f-label')?.value?.trim();
    const type = row.querySelector('.tpl-f-type')?.value;
    const weight = Number(row.querySelector('.tpl-f-weight')?.value) || 0;
    if (label) fields.push({ id: i + 1, label, type, weight, description: '' });
  });

  try {
    await api('/api/rhh/evaluations/templates', {
      method: 'POST',
      body: JSON.stringify({ name, position_id, fields })
    });
    toast('Plantilla creada');
    evaluacionesView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function buildResultadosTab(periods) {
  const periodOpts = periods.map(p =>
    `<option value="${p.id}">${p.name}</option>`).join('');

  const selectedPeriodId = window._evalResultPeriodId || (periods[0]?.id);
  let resultsHtml = '';

  if (selectedPeriodId) {
    try {
      const data = await api(`/api/rhh/evaluations/results/${selectedPeriodId}`);
      if (data?.results?.length > 0) {
        const rows = data.results.map(r => `
          <tr>
            <td>${r.employee_name}</td>
            <td style="text-align:center;font-weight:700;">${r.score?.toFixed(1) ?? '—'}</td>
            <td style="text-align:center;">${r.dia_desempeno?.toFixed(2) ?? '—'}</td>
            <td style="text-align:center;">${r.dia_calidad ?? '—'}</td>
            <td style="text-align:center;">${r.dia_reclamos ?? '—'}</td>
            <td style="text-align:center;font-weight:700;color:#059669;">${r.bonus_days?.toFixed(2) ?? '—'}</td>
          </tr>`).join('');
        const totalBonus = data.results.reduce((s, r) => s + (r.bonus_days || 0), 0);
        resultsHtml = `
          <table>
            <thead><tr>
              <th>Empleado</th><th style="text-align:center;">Score (%)</th>
              <th style="text-align:center;">Día desempeño</th>
              <th style="text-align:center;">Día calidad</th>
              <th style="text-align:center;">Día reclamos</th>
              <th style="text-align:center;">Total días bono</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:#f0fdf4;font-weight:700;">
                <td>TOTAL</td><td></td><td></td><td></td><td></td>
                <td style="text-align:center;color:#059669;">${totalBonus.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>`;
      } else {
        resultsHtml = '<div class="empty-state"><p>Sin resultados para este periodo</p></div>';
      }
    } catch (e) {
      resultsHtml = `<div class="notice error">${e.message}</div>`;
    }
  }

  return `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;">
      <label style="font-weight:600;">Periodo:</label>
      <select onchange="window._evalResultPeriodId=Number(this.value);evaluacionesView();evalTab='resultados';"
              style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;">
        <option value="">Seleccionar...</option>${periodOpts.replace(`value="${selectedPeriodId}"`, `value="${selectedPeriodId}" selected`)}
      </select>
    </div>
    <div class="card section table-wrap">${resultsHtml || '<div class="empty-state"><p>Selecciona un periodo</p></div>'}</div>
  `;
}

// ── Mis evaluaciones (empleados/supervisores como evaluadores) ─────────────────

async function misEvaluacionesView() {
  const el = document.getElementById('app');
  const hash = state.user?.role === 'empleado' ? 'mis-evaluaciones' : 'mis-evaluaciones';
  el.innerHTML = shell('<div class="loading-overlay">Cargando evaluaciones pendientes...</div>', 'mis-evaluaciones');

  try {
    const pending = await api('/api/rhh/evaluations/my-pending') || [];

    const rows = pending.length === 0
      ? '<div class="empty-state"><div class="empty-icon">⭐</div><p>No tienes evaluaciones pendientes</p></div>'
      : pending.map((p, i) => `
          <div class="card" style="margin-bottom:12px;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong>${p.period_name}</strong>
                <div class="small muted">Evaluar a: ${p.employee_name}</div>
                <div class="small muted">Plantilla: ${p.template_name}</div>
              </div>
              <button class="btn-primary" onclick="openEvalForm(${i})">Evaluar →</button>
            </div>
            <div id="eval-form-${i}" style="display:none;margin-top:16px;"></div>
          </div>`).join('');

    el.innerHTML = shell(`
      <div class="module-title">
        <h2>⭐ Mis Evaluaciones Pendientes</h2>
      </div>
      ${rows}
    `, 'mis-evaluaciones');

    // Guardar datos para uso en formularios
    window._pendingEvals = pending;
  } catch (err) {
    el.innerHTML = shell(`<div class="notice error">${err.message}</div>`, 'mis-evaluaciones');
  }
}

function openEvalForm(idx) {
  const container = document.getElementById(`eval-form-${idx}`);
  if (!container) return;
  const isVisible = container.style.display !== 'none';
  container.style.display = isVisible ? 'none' : 'block';
  if (isVisible) return;

  const pending = window._pendingEvals?.[idx];
  if (!pending) return;

  const fields = pending.template?.fields || [];
  const fieldsHtml = fields.map(f => {
    const inputId = `ef-f-${idx}-${f.id}`;
    let inputHtml = '';
    if (f.type === 'score_1_5') {
      inputHtml = `<div style="display:flex;gap:6px;margin-top:6px;">
        ${[1,2,3,4,5].map(v =>
          `<label style="display:flex;flex-direction:column;align-items:center;gap:4px;font-weight:normal;">
            <input type="radio" name="${inputId}" value="${v}" style="width:auto;" />${v}
          </label>`).join('')}
      </div>`;
    } else if (f.type === 'score_1_10') {
      inputHtml = `<input type="range" id="${inputId}" min="1" max="10" value="5"
        oninput="document.getElementById('${inputId}-val').textContent=this.value"
        style="width:100%;margin-top:6px;" />
        <span id="${inputId}-val" style="font-size:13px;color:#059669;">5</span>/10`;
    } else if (f.type === 'boolean') {
      inputHtml = `<label style="display:flex;align-items:center;gap:8px;font-weight:normal;margin-top:6px;">
        <input type="checkbox" id="${inputId}" style="width:auto;" /> Sí
      </label>`;
    } else if (f.type === 'text') {
      inputHtml = `<textarea id="${inputId}" rows="2" placeholder="Comentario..." style="margin-top:6px;"></textarea>`;
    }

    return `
      <div style="margin-bottom:16px;padding:12px;background:#f9fafb;border-radius:8px;border:1px solid var(--line);">
        <label style="font-weight:600;">${f.label} <span class="small muted">(${f.weight}%)</span></label>
        ${inputHtml}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div>
      ${fieldsHtml}
      <div>
        <label>Notas adicionales</label>
        <textarea id="eval-notes-${idx}" rows="2" placeholder="Observaciones opcionales..."></textarea>
      </div>
      <div class="actions" style="margin-top:12px;">
        <button class="btn-primary" onclick="submitEvaluation(${idx})">📤 Enviar evaluación</button>
      </div>
    </div>
  `;
}

async function submitEvaluation(idx) {
  const pending = window._pendingEvals?.[idx];
  if (!pending) return;

  const fields = pending.template?.fields || [];
  const answers = fields.map(f => {
    const inputId = `ef-f-${idx}-${f.id}`;
    let value;
    if (f.type === 'score_1_5') {
      const checked = document.querySelector(`input[name="${inputId}"]:checked`);
      value = checked ? Number(checked.value) : 0;
    } else if (f.type === 'score_1_10') {
      value = Number(document.getElementById(inputId)?.value || 5);
    } else if (f.type === 'boolean') {
      value = document.getElementById(inputId)?.checked || false;
    } else {
      value = document.getElementById(inputId)?.value?.trim() || '';
    }
    return { field_id: f.id, value };
  });

  const notes = document.getElementById(`eval-notes-${idx}`)?.value?.trim() || '';

  try {
    await api('/api/rhh/evaluations/submit', {
      method: 'POST',
      body: JSON.stringify({
        period_id: pending.period_id,
        employee_id: pending.employee_id,
        template_id: pending.template_id,
        answers,
        notes
      })
    });
    toast('Evaluación enviada exitosamente');
    misEvaluacionesView();
  } catch (err) {
    toast(err.message, 'error');
  }
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
    labora:               { bg: '#dcfce7', text: '#166534' },
    festivo:              { bg: '#e0e7ff', text: '#3730a3' },
    descanso:             { bg: '#f1f5f9', text: '#64748b' },
    vacaciones:           { bg: '#dbeafe', text: '#1e40af' },
    falta:                { bg: '#fee2e2', text: '#991b1b' },
    retardo:              { bg: '#ffedd5', text: '#9a3412' },
    cumpleanos:           { bg: '#f3e8ff', text: '#6b21a8' },
    permiso:              { bg: '#fef9c3', text: '#854d0e' },
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
    labora: 'Labora', festivo: 'FESTIVO', descanso: 'Descanso',
    vacaciones: 'Vacaciones', falta: 'Falta', retardo: 'Retardo',
    cumpleanos: 'CUMPLEAÑOS', permiso: 'Permiso', incapacidad: 'Incapacidad',
    vacio: '',
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
    { value: 'labora',     label: 'Labora',          bg: '#dcfce7', text: '#166534' },
    { value: 'falta',      label: 'Falta',            bg: '#fee2e2', text: '#991b1b' },
    { value: 'retardo',    label: 'Retardo',          bg: '#ffedd5', text: '#9a3412' },
    { value: 'vacaciones', label: 'Vacaciones',       bg: '#dbeafe', text: '#1e40af' },
    { value: 'permiso',    label: 'Permiso',          bg: '#fef9c3', text: '#854d0e' },
    { value: 'descanso',   label: 'Descanso',         bg: '#f1f5f9', text: '#64748b' },
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
      for (const sg of attendanceData.shifts) {
        const emp = sg.employees.find(e => e.id === empId);
        if (emp) {
          const day = emp.days.find(d => d.date === date);
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
      for (const sg of attendanceData.shifts) {
        const emp = sg.employees.find(e => e.id === empId);
        if (emp) { shiftId = sg.shift.id; break; }
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
function handleTEClick(empId, date, currentHours, empName, isLaborDay, cellEl) {
  openTECCModal(empId, date, currentHours, empName, cellEl);
}

function openTECCModal(empId, date, currentHours, empName, cellEl) {
  // Leer centro de costo actual del cache
  let currentCC = null, currentProject = null;
  if (attendanceData) {
    for (const sg of attendanceData.shifts) {
      const emp = sg.employees.find(e => e.id === empId);
      if (emp) {
        const day = emp.days.find(d => d.date === date);
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
      for (const sg of attendanceData.shifts) {
        const emp = sg.employees.find(e => e.id === empId);
        if (emp) {
          const day = emp.days.find(d => d.date === date);
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
    for (const sg of data.shifts) {
      const shift = sg.shift;
      const rol = sg.rol;
      const isDraft = !rol || rol.status === 'draft';
      const statusBadge = isDraft
        ? `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">BORRADOR</span>`
        : `<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">✓ PUBLICADO ${fmtDateDisplay(rol.published_at?.slice(0,10)||'')}</span>`;
      const missingAlert = sg.total_missing > 0
        ? `<span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">⚠ ${sg.total_missing} puesto${sg.total_missing!==1?'s':''} sin cubrir</span>`
        : '';

      const actionBtns = canEdit ? `
        ${!rol ? `<button class="btn-primary" style="font-size:11px;padding:4px 10px;" onclick="createRol('${rolWeekStart}',${shift.id})">+ Crear ROL</button>` : ''}
        ${rol && isDraft ? `
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
    const data = await api(`/api/rhh/schedule/weekly-attendance?week_start=${attendanceWeekStart}`);
    if (!data) return;
    attendanceData = data;

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
        const posDisplay = hasPosWarn ? '⚠ Sin puesto' : (emp.position || '—');
        const posCellCls = hasPosWarn ? 'col-position no-position-warn' : 'col-position';

        // Celdas de días
        let dayCells = '';
        emp.days.forEach((day, di) => {
          const colors = statusColor(day.status);
          const label = statusLabel(day.status);
          const editable = day.is_editable;
          const editCls = editable ? 'att-cell' : 'att-cell no-editable';
          const bdayIcon = day.birthday ? `<span class="bday-icon" style="font-size:13px;"> 🎂</span>` : '';
          const clickHandler = editable
            ? `onclick="openStatusDropdown(${emp.id},'${day.date}','${day.status}',this)"`
            : '';
          const borderStyle = colors.border ? `border:${colors.border};` : '';

          dayCells += `<td style="padding:2px 3px;">
            <div class="${editCls}" data-empid="${emp.id}" data-date="${day.date}"
              style="background:${colors.bg};color:${colors.text};${borderStyle}"
              ${clickHandler}>
              ${label}${bdayIcon}
            </div>
          </td>`;

          // Celda TE
          const teVal = day.te_hours || 0;
          const teCls = teVal < 0 ? 'te-cell te-negative' : 'te-cell';
          dayCells += `<td style="padding:2px 3px;">
            <div class="${teCls}" data-empid="${emp.id}" data-date="${day.date}"
              onclick="handleTEClick(${emp.id},'${day.date}',${teVal},'${emp.full_name.replace(/'/g,"\\'")}',${editable},this)">
              ${teVal !== 0 ? teVal : ''}
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
        <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-weight:700;">Labora</span>
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
    calendario: calendarioView,
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
    plantillas: plantillasView
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

window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', init);
