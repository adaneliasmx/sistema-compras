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
    ['mis-incidencias', '⚠️ Mis Incidencias']
  ],
  supervisor: [
    ['calendario', '📅 Calendario'],
    ['asignacion', '👥 Asignación'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['ausencias-hoy', '🚨 Ausencias Hoy']
  ],
  rh: [
    ['dashboard', '📊 Dashboard'],
    ['empleados', '👥 Empleados'],
    ['calendario', '📅 Calendario'],
    ['incidencias', '⚠️ Incidencias'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['prenomina', '💰 Prenómina'],
    ['reportes', '📊 Reportes']
  ],
  admin: [
    ['dashboard', '📊 Dashboard'],
    ['empleados', '👥 Empleados'],
    ['calendario', '📅 Calendario'],
    ['incidencias', '⚠️ Incidencias'],
    ['autorizaciones', '✅ Autorizaciones'],
    ['prenomina', '💰 Prenómina'],
    ['catalogos', '📁 Catálogos'],
    ['reportes', '📊 Reportes']
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
          <div class="small muted">${new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
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
        const assignId = day.schedule_entry?.id;
        if (!day.works_this_day && !day.incidence && !day.schedule_entry) {
          return `<td style="background:#f9fafb;text-align:center;"><span class="small muted">—</span></td>`;
        }
        const inc = day.incidence;
        if (inc) {
          return `<td style="text-align:center;"><span class="cell-chip cell-${day.status}">${incTypeLabel(inc.type)}</span></td>`;
        }
        const assigned = !!day.schedule_entry || day.works_this_day;
        return `<td style="text-align:center;">
          ${assigned
            ? `<span class="cell-chip cell-asignado" style="cursor:default;">✓ ${emp.shift?.code || ''}</span>`
            : `<button class="btn-primary" style="font-size:11px;padding:4px 8px;" onclick="assignDay(${emp.id},'${fmtDate(dates[di])}',${emp.shift?.id||0})">Asignar</button>`
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

    const headerCells = dates.map(d => {
      const isToday = fmtDate(d) === fmtDate(new Date());
      return `<th style="${isToday ? 'background:#d1fae5;' : ''}">${DAYS_SHORT[d.getDay()]}<br><span class="small">${d.getDate()}/${d.getMonth()+1}</span></th>`;
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
                 <th>Número</th><th>Nombre</th><th>Departamento</th>
                 <th>Puesto</th><th>Turno</th><th>Estatus</th><th>Acciones</th>
               </tr></thead>
               <tbody>
                 ${employees.map(emp => `
                   <tr>
                     <td><span class="small muted">${emp.employee_number}</span></td>
                     <td>
                       <strong>${emp.full_name}</strong><br>
                       <span class="small muted">${emp.email}</span>
                     </td>
                     <td>${emp.department?.name || '—'}</td>
                     <td>${emp.position?.name || '—'}</td>
                     <td>${shiftDot(emp.shift)}</td>
                     <td>${statusPill(emp.status)}</td>
                     <td>
                       <button class="btn-ghost" style="font-size:12px;" onclick="showEditEmployee(${emp.id})">✏️ Editar</button>
                       ${emp.status === 'active' ? `<button class="btn-ghost" style="font-size:12px;color:#b91c1c;" onclick="deactivateEmployee(${emp.id})">🗑️ Desactivar</button>` : ''}
                     </td>
                   </tr>`).join('')}
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
        <button class="btn-primary" onclick="empTab='nuevo';empleadosView()">+ Nuevo empleado</button>
      </div>
      <div class="tabs">
        <button class="tab-btn ${empTab==='list'?'active':''}" onclick="empTab='list';empleadosView()">📋 Lista</button>
        <button class="tab-btn ${empTab==='nuevo'?'active':''}" onclick="empTab='nuevo';empleadosView()">➕ Nuevo empleado</button>
      </div>
      ${empTab === 'list' ? listContent : formContent}
    `;

    el.innerHTML = shell(content, 'empleados');
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

  return `
    <div class="form-section">
      <h3>${emp ? `Editar: ${emp.full_name}` : 'Nuevo Empleado'}</h3>
      <input type="hidden" id="ef-id" value="${emp?.id || ''}" />
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
          <label>Departamento</label>
          <select id="ef-dept"><option value="">Sin asignar</option>${depts}</select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Puesto</label>
          <select id="ef-pos"><option value="">Sin asignar</option>${positions}</select>
        </div>
        <div>
          <label>Turno</label>
          <select id="ef-shift"><option value="">Sin asignar</option>${shifts}</select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Supervisor directo</label>
          <select id="ef-supervisor"><option value="">Sin supervisor</option>${supervisors}</select>
        </div>
        <div>
          <label>Tipo de contrato</label>
          <select id="ef-contract">
            <option value="indefinido" ${emp?.contract_type==='indefinido'?'selected':''}>Indefinido</option>
            <option value="temporal" ${emp?.contract_type==='temporal'?'selected':''}>Temporal</option>
            <option value="honorarios" ${emp?.contract_type==='honorarios'?'selected':''}>Honorarios</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Fecha de ingreso</label>
          <input id="ef-start" type="date" value="${emp?.start_date || ''}" />
        </div>
        <div>
          <label>Fecha de nacimiento</label>
          <input id="ef-birth" type="date" value="${emp?.birth_date || ''}" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>Salario base (mensual)</label>
          <input id="ef-salary" type="number" value="${emp?.base_salary || ''}" placeholder="0.00" min="0" />
        </div>
        <div>
          <label>Estatus</label>
          <select id="ef-status">
            <option value="active" ${(!emp || emp.status==='active')?'selected':''}>Activo</option>
            <option value="inactive" ${emp?.status==='inactive'?'selected':''}>Inactivo</option>
          </select>
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
  const el = document.getElementById('app');
  try {
    const emp = await api(`/api/rhh/employees/${id}`);
    if (!emp) return;
    empTab = 'nuevo';
    await empleadosView();
    const wrap = document.getElementById('emp-form-wrap');
    if (wrap) wrap.innerHTML = empFormHtml(emp);
    // Switch to nuevo tab
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.textContent.includes('Nuevo'));
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function saveEmployee() {
  const id = document.getElementById('ef-id')?.value;
  const body = {
    full_name: document.getElementById('ef-name')?.value?.trim(),
    email: document.getElementById('ef-email')?.value?.trim(),
    phone: document.getElementById('ef-phone')?.value?.trim() || null,
    department_id: document.getElementById('ef-dept')?.value || null,
    position_id: document.getElementById('ef-pos')?.value || null,
    shift_id: document.getElementById('ef-shift')?.value || null,
    supervisor_id: document.getElementById('ef-supervisor')?.value || null,
    contract_type: document.getElementById('ef-contract')?.value,
    start_date: document.getElementById('ef-start')?.value || null,
    birth_date: document.getElementById('ef-birth')?.value || null,
    base_salary: document.getElementById('ef-salary')?.value || 0,
    status: document.getElementById('ef-status')?.value
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
    empleadosView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deactivateEmployee(id) {
  if (!confirm('¿Desactivar este empleado?')) return;
  try {
    await api(`/api/rhh/employees/${id}`, { method: 'DELETE' });
    toast('Empleado desactivado');
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

    const [calData, empData] = await Promise.all([
      api(`/api/rhh/schedule/calendar?year=${myCalYear}&month=${myCalMonth}&employee_id=${empId}`),
      api(`/api/rhh/employees/${empId}`)
    ]);
    if (!calData) return;

    const today = fmtDate(new Date());
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
  const el = document.getElementById('app');
  el.innerHTML = shell('<div class="loading-overlay">Cargando solicitudes...</div>', 'mis-solicitudes');

  try {
    const incidences = await api('/api/rhh/incidences?type=vacacion&type=permiso') || await api('/api/rhh/incidences');
    if (!incidences) return;

    const myIncidences = (incidences || []).filter(i =>
      ['vacacion', 'permiso'].includes(i.type) && i.employee_id === state.user?.employee_id
    );

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

      <div class="card section" style="margin-bottom:16px;">
        <h3>Nueva solicitud</h3>
        <div class="row">
          <div>
            <label>Tipo *</label>
            <select id="ms-type">
              <option value="vacacion">Vacación</option>
              <option value="permiso">Permiso</option>
            </select>
          </div>
          <div>
            <label>Fecha inicio *</label>
            <input type="date" id="ms-date" value="${fmtDate(new Date())}" />
          </div>
          <div>
            <label>Fecha fin</label>
            <input type="date" id="ms-date-end" value="${fmtDate(new Date())}" />
          </div>
        </div>
        <div style="margin-top:10px;">
          <label>Motivo / Notas</label>
          <textarea id="ms-notes" rows="2" placeholder="Describe el motivo de tu solicitud..."></textarea>
        </div>
        <div style="margin-top:10px;">
          <button class="btn-primary" onclick="submitMiSolicitud()">Enviar solicitud</button>
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

async function submitMiSolicitud() {
  const type = document.getElementById('ms-type')?.value;
  const date = document.getElementById('ms-date')?.value;
  const date_end = document.getElementById('ms-date-end')?.value;
  const notes = document.getElementById('ms-notes')?.value;

  if (!type || !date) { toast('Tipo y fecha son requeridos', 'warning'); return; }

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
    const incidences = await api('/api/rhh/incidences');
    if (!incidences) return;

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
  `;

  const role = u?.role || 'empleado';
  const menu = MENU_BY_ROLE[role] || [];
  const activeH = menu[0]?.[0] || '';
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
// ROUTER
// ══════════════════════════════════════════════════════════════════════════════
function render() {
  const el = document.getElementById('app');
  if (!el) return;

  if (!state.user) {
    el.innerHTML = loginView();
    return;
  }

  const hash = location.hash.slice(1) || 'dashboard';
  const role = state.user.role;

  // Vista por hash
  const views = {
    dashboard: dashboardView,
    calendario: calendarioView,
    asignacion: asignacionView,
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
    perfil: perfilView
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
