const express = require('express');
const { read, write, nextId, calcVacBalance } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ── Utilidades de fecha ────────────────────────────────────────────────────────
function getWeekDates(weekStr) {
  // weekStr: "2026-W12"
  const [year, week] = weekStr.split('-W').map(Number);
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(startOfWeek1);
  start.setDate(startOfWeek1.getDate() + (week - 1) * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function currentWeekStr() {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = now - startOfWeek1;
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function fmtDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// Devuelve la fecha de hoy en zona horaria local del servidor (YYYY-MM-DD)
function localToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// GET /api/rhh/schedule — asignaciones de la semana
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  const weekStr = req.query.week || currentWeekStr();
  const deptId = req.query.department_id ? Number(req.query.department_id) : null;
  const shiftId = req.query.shift_id ? Number(req.query.shift_id) : null;

  let dates;
  try {
    dates = getWeekDates(weekStr);
  } catch (e) {
    return res.status(400).json({ error: 'Formato de semana inválido. Use YYYY-Wnn' });
  }

  const [startDate, endDate] = [dates[0], dates[dates.length - 1]];

  let employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  if (deptId) employees = employees.filter(e => e.department_id === deptId);
  if (shiftId) employees = employees.filter(e => e.shift_id === shiftId);

  // Supervisor solo ve sus subordinados
  if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    employees = employees.filter(e =>
      e.supervisor_id === req.rhhUser.employee_id || e.id === req.rhhUser.employee_id
    );
  }

  const scheduleEntries = (db.rhh_schedule || []).filter(
    s => s.date >= startDate && s.date <= endDate
  );

  const incidences = (db.rhh_incidences || []).filter(
    i => i.date >= startDate && i.date <= endDate && i.status !== 'rechazada'
  );

  // Cargar TE autorizadas del rango
  const teAuths = (db.rhh_te_authorizations || []).filter(
    t => t.date >= startDate && t.date <= endDate && t.status === 'approved'
  );

  const shifts = db.rhh_shifts || [];
  const departments = db.rhh_departments || [];
  const positions = db.rhh_positions || [];

  const result = employees.map(emp => {
    const shift = shifts.find(s => s.id === emp.shift_id) || null;
    const dept = departments.find(d => d.id === emp.department_id) || null;
    const pos = positions.find(p => p.id === emp.position_id) || null;

    const days = dates.map(date => {
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      const worksThisDay = shift ? shift.work_days.includes(dayOfWeek) : false;

      const incidence = incidences.find(i => i.employee_id === emp.id && i.date === date) || null;
      const assigned = scheduleEntries.find(s => s.employee_id === emp.id && s.date === date) || null;

      // Verificar si hay TE autorizada para este día/turno
      const teAuth = shift ? teAuths.find(t => t.date === date && t.shift_id === shift.id) || null : null;

      let cellStatus = 'no_laboral';
      if (worksThisDay) cellStatus = 'asignado';
      if (!worksThisDay && teAuth) cellStatus = 'tiempo_extra'; // día no laboral con TE
      if (incidence) {
        cellStatus = incidence.type === 'vacacion' ? 'vacacion' :
          incidence.type === 'falta' ? 'falta' :
          incidence.type === 'incapacidad' ? 'incapacidad' :
          incidence.type === 'permiso' ? 'permiso' :
          incidence.type === 'tiempo_extra' ? 'tiempo_extra' : 'incidencia';
      }

      return {
        date,
        day_of_week: dayOfWeek,
        works_this_day: worksThisDay,
        status: cellStatus,
        incidence,
        schedule_entry: assigned,
        te_authorization: teAuth
      };
    });

    return {
      employee: {
        id: emp.id,
        employee_number: emp.employee_number,
        full_name: emp.full_name,
        department: dept,
        position: pos,
        shift
      },
      days
    };
  });

  res.json({ week: weekStr, dates, data: result });
});

// POST /api/rhh/schedule/assign — asignar empleado a fecha/turno
router.post('/assign', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const { employee_id, date, shift_id, notes } = req.body || {};

  if (!employee_id || !date) return res.status(400).json({ error: 'employee_id y date son requeridos' });

  const emp = (db.rhh_employees || []).find(e => e.id === Number(employee_id) && e.status === 'active');
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado o inactivo' });

  const schedule = db.rhh_schedule || [];

  // Verificar si ya existe asignación
  const existing = schedule.findIndex(s => s.employee_id === Number(employee_id) && s.date === date);
  if (existing !== -1) {
    // Actualizar
    schedule[existing] = {
      ...schedule[existing],
      shift_id: shift_id ? Number(shift_id) : emp.shift_id,
      notes: notes || null,
      updated_at: new Date().toISOString(),
      updated_by: req.rhhUser.id
    };
    db.rhh_schedule = schedule;
    write(db);
    return res.json(schedule[existing]);
  }

  const entry = {
    id: nextId(schedule),
    employee_id: Number(employee_id),
    date: String(date),
    shift_id: shift_id ? Number(shift_id) : emp.shift_id,
    notes: notes || null,
    created_at: new Date().toISOString(),
    created_by: req.rhhUser.id
  };

  schedule.push(entry);
  db.rhh_schedule = schedule;
  write(db);

  res.status(201).json(entry);
});

// DELETE /api/rhh/schedule/:id
router.delete('/:id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_schedule || []).findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Asignación no encontrada' });

  db.rhh_schedule.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// GET /api/rhh/schedule/calendar — vista mensual
router.get('/calendar', rhhAuthRequired, (req, res) => {
  const db = read();
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;

  // Si es empleado, forzar su propio ID
  let targetEmployeeId = employeeId;
  if (req.rhhUser.role === 'empleado') {
    targetEmployeeId = req.rhhUser.employee_id;
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  let employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  if (targetEmployeeId) {
    employees = employees.filter(e => e.id === targetEmployeeId);
  }

  const incidences = (db.rhh_incidences || []).filter(
    i => i.date >= startDate && i.date <= endDate
  );
  const overtime = (db.rhh_overtime || []).filter(
    o => o.date >= startDate && o.date <= endDate
  );

  const shifts = db.rhh_shifts || [];

  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();

    const dayData = employees.map(emp => {
      const shift = shifts.find(s => s.id === emp.shift_id) || null;
      const worksThisDay = shift ? shift.work_days.includes(dayOfWeek) : false;
      const incidence = incidences.find(i => i.employee_id === emp.id && i.date === dateStr) || null;
      const ot = overtime.find(o => o.employee_id === emp.id && o.date === dateStr) || null;

      return {
        employee_id: emp.id,
        full_name: emp.full_name,
        works: worksThisDay,
        shift,
        incidence,
        overtime: ot
      };
    });

    days.push({ date: dateStr, day_of_week: dayOfWeek, employees: dayData });
  }

  res.json({ year, month, days });
});

// ── TE Authorizations ─────────────────────────────────────────────────────────

// GET /api/rhh/schedule/te-authorizations?month=YYYY-MM
router.get('/te-authorizations', rhhAuthRequired, (req, res) => {
  const db = read();
  let list = db.rhh_te_authorizations || [];

  const { month } = req.query;
  if (month) {
    list = list.filter(t => t.date && t.date.startsWith(month));
  }

  res.json(list);
});

// POST /api/rhh/schedule/te-authorizations — crear solicitud TE
router.post('/te-authorizations', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const { date, shift_id, positions, notes } = req.body || {};

  if (!date || !shift_id) return res.status(400).json({ error: 'date y shift_id son requeridos' });

  const teAuths = db.rhh_te_authorizations || [];
  const entry = {
    id: nextId(teAuths),
    date: String(date),
    shift_id: Number(shift_id),
    status: 'pending',
    requested_by: req.rhhUser.id,
    approved_by: null,
    notes: notes || null,
    positions: Array.isArray(positions) ? positions.map(Number) : [],
    created_at: new Date().toISOString()
  };

  teAuths.push(entry);
  db.rhh_te_authorizations = teAuths;

  // Crear notificaciones para empleados elegibles (Automatización 6)
  const positionIds = Array.isArray(positions) ? positions.map(Number) : [];
  if (positionIds.length > 0) {
    const notifications = db.rhh_notifications || [];
    const allPositions = db.rhh_positions || [];
    const allEmployees = db.rhh_employees || [];

    // Buscar empleados activos que tengan alguno de los puestos requeridos habilitados
    const eligibleEmps = allEmployees.filter(emp =>
      emp.status === 'active' &&
      Array.isArray(emp.enabled_positions) &&
      emp.enabled_positions.some(pid => positionIds.includes(Number(pid)))
    );

    for (const emp of eligibleEmps) {
      const posName = allPositions.find(p => positionIds.includes(p.id))?.name || 'varios puestos';
      notifications.push({
        id: nextId(notifications),
        employee_id: emp.id,
        type: 'te_available',
        title: '⚡ Tiempo Extra Disponible',
        message: `Hay tiempo extra disponible para ${posName} el ${date}. ¡Postúlate!`,
        data: { te_authorization_id: entry.id, date: entry.date, shift_id: entry.shift_id, position_ids: positionIds },
        read: false,
        created_at: new Date().toISOString()
      });
    }
    db.rhh_notifications = notifications;
  }

  write(db);

  res.status(201).json(entry);
});

// ── POST /api/rhh/schedule/te-applications — postularse a TE ──────────────────
router.post('/te-applications', rhhAuthRequired, (req, res) => {
  const db = read();
  const { te_authorization_id } = req.body || {};
  if (!te_authorization_id) return res.status(400).json({ error: 'te_authorization_id es requerido' });

  const empId = req.rhhUser.employee_id;
  if (!empId) return res.status(400).json({ error: 'No tienes perfil de empleado vinculado' });

  const auth = (db.rhh_te_authorizations || []).find(t => t.id === Number(te_authorization_id));
  if (!auth) return res.status(404).json({ error: 'Autorización TE no encontrada' });

  // Verificar que el empleado tenga algún puesto requerido
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const positionIds = auth.positions || [];
  if (positionIds.length > 0) {
    const empPositions = Array.isArray(emp.enabled_positions) ? emp.enabled_positions.map(Number) : [];
    const hasPosition = positionIds.some(pid => empPositions.includes(Number(pid)));
    if (!hasPosition) return res.status(403).json({ error: 'No tienes el puesto requerido para esta TE' });
  }

  const applications = db.rhh_te_applications || [];

  // Verificar que no haya ya una aplicación del mismo empleado
  const existing = applications.find(a => a.te_authorization_id === Number(te_authorization_id) && a.employee_id === empId);
  if (existing) return res.status(409).json({ error: 'Ya te postulaste para esta TE' });

  const application = {
    id: nextId(applications),
    te_authorization_id: Number(te_authorization_id),
    employee_id: empId,
    status: 'applied',
    applied_at: new Date().toISOString(),
    selected_by: null,
    selected_at: null,
    notes: null
  };
  applications.push(application);
  db.rhh_te_applications = applications;
  write(db);

  res.status(201).json({ ok: true, application });
});

// ── GET /api/rhh/schedule/te-applications/my — mis postulaciones (empleado) ───
router.get('/te-applications/my', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = req.rhhUser?.employee_id;
  if (!empId) return res.json([]);
  const applications = (db.rhh_te_applications || []).filter(a => a.employee_id === empId);
  res.json(applications);
});

// ── GET /api/rhh/schedule/te-applications/:te_authorization_id ────────────────
router.get('/te-applications/:te_authorization_id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const teAuthId = Number(req.params.te_authorization_id);
  const applications = (db.rhh_te_applications || []).filter(a => a.te_authorization_id === teAuthId);
  const employees = db.rhh_employees || [];

  const enriched = applications.map(app => {
    const emp = employees.find(e => e.id === app.employee_id) || null;
    return { ...app, employee: emp ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null };
  });

  res.json(enriched);
});

// ── PATCH /api/rhh/schedule/te-applications/:id ───────────────────────────────
router.patch('/te-applications/:id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  const { status, notes } = req.body || {};

  const applications = db.rhh_te_applications || [];
  const idx = applications.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Aplicación no encontrada' });

  const VALID = ['applied', 'selected', 'rejected'];
  if (status && !VALID.includes(status)) return res.status(400).json({ error: 'Status inválido' });

  const app = { ...applications[idx] };
  if (status) app.status = status;
  if (notes !== undefined) app.notes = notes;

  if (status === 'selected') {
    app.selected_by = req.rhhUser.id;
    app.selected_at = new Date().toISOString();

    // Rechazar automáticamente las demás aplicaciones del mismo te_authorization_id
    for (let i = 0; i < applications.length; i++) {
      if (applications[i].te_authorization_id === app.te_authorization_id && applications[i].id !== id) {
        applications[i] = { ...applications[i], status: 'rejected' };
      }
    }

    // Actualizar rhh_attendance del empleado seleccionado
    const auth = (db.rhh_te_authorizations || []).find(t => t.id === app.te_authorization_id);
    if (auth) {
      const attendance = db.rhh_attendance || [];
      const attIdx = attendance.findIndex(a => a.employee_id === app.employee_id && a.date === auth.date);
      const now = new Date().toISOString();
      if (attIdx !== -1) {
        attendance[attIdx] = { ...attendance[attIdx], status: 'labora', te_hours: auth.te_hours || 0, updated_at: now };
      } else {
        attendance.push({
          id: nextId(attendance),
          employee_id: app.employee_id,
          date: auth.date,
          status: 'labora',
          te_hours: auth.te_hours || 0,
          notes: 'TE asignada',
          registered_by: req.rhhUser.id,
          created_at: now,
          updated_at: now
        });
      }
      db.rhh_attendance = attendance;
    }
  }

  applications[idx] = app;
  db.rhh_te_applications = applications;
  write(db);

  res.json({ ok: true, application: app });
});

// PATCH /api/rhh/schedule/te-authorizations/:id — aprobar/rechazar TE
router.patch('/te-authorizations/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  const idx = (db.rhh_te_authorizations || []).findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Autorización TE no encontrada' });

  const { status, approved_by, notes } = req.body || {};
  const VALID_STATUS = ['pending', 'approved', 'rejected'];
  if (status && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  const entry = { ...db.rhh_te_authorizations[idx] };
  if (status) entry.status = status;
  if (approved_by !== undefined) entry.approved_by = approved_by;
  else if (status === 'approved' || status === 'rejected') entry.approved_by = req.rhhUser.id;
  if (notes !== undefined) entry.notes = notes;
  entry.updated_at = new Date().toISOString();

  db.rhh_te_authorizations[idx] = entry;
  write(db);

  res.json(entry);
});

// ── Utilidades ISO week ────────────────────────────────────────────────────────
function getISOWeekNumber(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d - startOfWeek1;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

// ── GET /api/rhh/schedule/weekly-attendance?week_start=YYYY-MM-DD ──────────────
router.get('/weekly-attendance', rhhAuthRequired, (req, res) => {
  const db = read();

  // Determinar lunes de la semana
  let weekStart;
  if (req.query.week_start) {
    weekStart = req.query.week_start; // YYYY-MM-DD esperado como lunes
  } else {
    const now = new Date();
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    weekStart = d.toISOString().slice(0, 10);
  }

  // Calcular 7 días (lunes a domingo)
  const days = [];
  const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const holiday = (db.rhh_holidays || []).find(h => h.date === dateStr);
    days.push({
      date: dateStr,
      label: `${DAY_NAMES[d.getDay()]} ${d.getDate()}`,
      day_num: d.getDay(), // 0=Dom, 1=Lun...
      is_holiday: !!holiday,
      holiday_name: holiday ? holiday.name : null
    });
  }

  const weekEndDate = days[6].date;
  const weekNum = getISOWeekNumber(weekStart);

  // Empleados activos
  let employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    employees = employees.filter(e =>
      e.supervisor_id === req.rhhUser.employee_id || e.id === req.rhhUser.employee_id
    );
  }

  // ── Filtrar empleados según contexto de semana ─────────────────────────────
  const todayStr = localToday();
  const isPastWeek    = weekEndDate < todayStr;
  const isFutureWeek  = weekStart > todayStr;
  const isCurrentWeek = !isPastWeek && !isFutureWeek;

  if (!isCurrentWeek) {
    const allAttendance = db.rhh_attendance || [];
    const allIncidences = db.rhh_incidences || [];
    const empWithActivity = new Set();

    // Empleados con registros de asistencia en la semana
    for (const a of allAttendance) {
      if (a.date >= weekStart && a.date <= weekEndDate) empWithActivity.add(a.employee_id);
    }
    // Empleados con incidencias no rechazadas que cubren la semana
    for (const inc of allIncidences) {
      if (inc.status === 'rechazada') continue;
      const iStart = inc.date;
      const iEnd   = inc.date_end || inc.date;
      if (iStart <= weekEndDate && iEnd >= weekStart) empWithActivity.add(inc.employee_id);
    }
    // Empleados en el ROL publicado para esta semana
    const weekRol = (db.rhh_weekly_rol || []).find(r => r.week_start === weekStart && r.status === 'publicado');
    if (weekRol) {
      const slotIds = new Set((db.rhh_rol_slots || []).filter(s => s.rol_id === weekRol.id).map(s => s.id));
      for (const a of (db.rhh_rol_assignments || [])) {
        if (slotIds.has(a.slot_id)) empWithActivity.add(a.employee_id);
      }
    }
    employees = employees.filter(e => empWithActivity.has(e.id));
  }

  const shifts = db.rhh_shifts || [];
  const departments = db.rhh_departments || [];
  const positions = db.rhh_positions || [];
  const holidays = db.rhh_holidays || [];
  const attendanceRecords = db.rhh_attendance || [];
  const incidences = db.rhh_incidences || [];

  const currentYear = new Date(weekStart).getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  // Agrupar por turno
  const shiftGroups = {};
  for (const shift of shifts) {
    shiftGroups[shift.id] = { shift, employees: [] };
  }
  // Grupo para empleados sin turno
  shiftGroups['none'] = { shift: { id: null, name: 'Sin turno', code: '—', color: '#94a3b8' }, employees: [] };

  for (const emp of employees) {
    const shift = shifts.find(s => s.id === emp.shift_id) || null;
    const dept = departments.find(d => d.id === emp.department_id) || null;
    const pos = positions.find(p => p.id === emp.position_id) || null;

    // Calcular vacaciones restantes (fuente única: calcVacBalance)
    const vacBalance = calcVacBalance(db, emp.id, currentYear);
    const vacRestantes = vacBalance ? vacBalance.vacation_remaining : 0;

    // Retardos acumulados en el año
    const retardosAcum = incidences.filter(i =>
      i.employee_id === emp.id &&
      i.type === 'retardo' &&
      i.date >= yearStart && i.date <= yearEnd
    ).length;

    // Construir días
    const empDays = days.map(day => {
      const dateStr = day.date;
      const dayOfWeek = day.day_num; // 0=Dom

      // 1. Status base
      let status = 'vacio';
      const isFutureDate = dateStr > todayStr;
      let isEditable = !isFutureDate; // fechas futuras no son editables para asistencia

      if (shift && !isFutureDate) {
        const workDays = Array.isArray(shift.work_days) ? shift.work_days : [];
        if (day.is_holiday) {
          status = 'festivo';
          isEditable = true;
        } else if (workDays.includes(dayOfWeek)) {
          status = 'labora';
          isEditable = true;
        } else {
          status = 'descanso';
          isEditable = false; // no editable por defecto, salvo TE
        }
      }

      // 2. Registro explícito en rhh_attendance (sobreescribe base)
      const attRecord = attendanceRecords.find(a => a.employee_id === emp.id && a.date === dateStr);
      let teHours = 0;
      let notes = null;
      if (attRecord) {
        status = attRecord.status;
        teHours = attRecord.te_hours || 0;
        notes = attRecord.notes || null;
        if (!isFutureDate) isEditable = true;
      }

      // 3. Incidencias APROBADAS que cubren esta fecha
      const coveringApproved = incidences.filter(i =>
        i.employee_id === emp.id &&
        i.status === 'aprobada' &&
        i.date <= dateStr &&
        (i.date_end || i.date) >= dateStr
      );
      if (coveringApproved.length > 0) {
        const inc = coveringApproved[coveringApproved.length - 1];
        if (inc.type === 'vacacion') status = 'vacaciones';
        else if (inc.type === 'incapacidad') status = 'incapacidad';
        else if (inc.type === 'permiso_con_goce' || inc.type === 'permiso_sin_goce' || inc.type === 'permiso') status = 'permiso';
        else if (inc.type === 'falta') status = 'falta';
        else if (inc.type === 'retardo') status = 'retardo';
      }

      // 3b. Incidencias PENDIENTES que cubren esta fecha (solo si no hay aprobada ni registro explícito)
      if (coveringApproved.length === 0 && !attRecord) {
        const coveringPending = incidences.filter(i =>
          i.employee_id === emp.id &&
          i.status === 'pendiente' &&
          i.date <= dateStr &&
          (i.date_end || i.date) >= dateStr
        );
        if (coveringPending.length > 0) {
          const inc = coveringPending[coveringPending.length - 1];
          if (inc.type === 'vacacion') status = 'vacaciones_pendiente';
          else if (inc.type === 'permiso' || inc.type === 'permiso_con_goce' || inc.type === 'permiso_sin_goce') status = 'permiso_pendiente';
          else if (inc.type === 'falta') status = 'falta_pendiente';
        }
      }

      // 4. Cumpleaños
      let birthday = false;
      let birthday_work = false;
      if (emp.birth_date) {
        const bMD = emp.birth_date.slice(5); // MM-DD
        if (bMD === dateStr.slice(5)) {
          birthday = true;
          if (!isFutureDate && status === 'labora') birthday_work = true;
        }
      }

      // Si tiene TE autorizada para ese turno → TE cell siempre clickeable
      const teAuth = (db.rhh_te_authorizations || []).find(
        t => t.date === dateStr && t.shift_id === emp.shift_id && t.status === 'approved'
      );
      if (teAuth && !isEditable && !isFutureDate) isEditable = true;

      return { date: dateStr, status, te_hours: teHours, notes, is_editable: isEditable, is_future: isFutureDate, birthday, birthday_work };
    });

    // Totales
    const teTotal = empDays.reduce((s, d) => s + (d.te_hours || 0), 0);
    const diasPendientes = Math.round((teTotal / 8) * 100) / 100;

    const empResult = {
      id: emp.id,
      full_name: emp.full_name,
      area: dept ? dept.name : '—',
      project: emp.project || '—',
      position: pos ? pos.name : '—',
      shift_code: shift ? shift.code : '—',
      enabled_positions: emp.enabled_positions || [],
      days: empDays,
      totals: {
        te_total: teTotal,
        dias_pendientes: diasPendientes,
        vacaciones_restantes: vacRestantes,
        retardos_acumulados: retardosAcum
      }
    };

    const groupKey = emp.shift_id || 'none';
    if (!shiftGroups[groupKey]) shiftGroups[groupKey] = { shift: shift || { id: null, name: 'Sin turno', code: '—', color: '#94a3b8' }, employees: [] };
    shiftGroups[groupKey].employees.push(empResult);
  }

  // Construir resultado
  const shiftsResult = [];
  // Primero los turnos con empleados, en orden por id de turno
  const sortedShiftIds = [...shifts.map(s => s.id), 'none'];
  for (const sid of sortedShiftIds) {
    const group = shiftGroups[sid];
    if (group && group.employees.length > 0) {
      shiftsResult.push({ shift: group.shift, employees: group.employees });
    }
  }

  res.json({
    week_start: weekStart,
    week_end: weekEndDate,
    week_number: weekNum,
    days,
    shifts: shiftsResult
  });
});

// ── POST /api/rhh/schedule/attendance ─────────────────────────────────────────
router.post('/attendance', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const { employee_id, date, status, te_hours, notes, cost_center, project_id } = req.body || {};

  if (!employee_id || !date || !status) {
    return res.status(400).json({ error: 'employee_id, date y status son requeridos' });
  }

  const VALID_STATUS = ['labora', 'festivo', 'descanso', 'vacaciones', 'falta', 'retardo', 'cumpleanos', 'vacio', 'permiso', 'permiso_sin_goce', 'incapacidad'];
  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  const attendance = db.rhh_attendance || [];
  const existingIdx = attendance.findIndex(a => a.employee_id === Number(employee_id) && a.date === date);
  const now = new Date().toISOString();

  // Guardar en log de trazabilidad ANTES de modificar
  const prevRecord = existingIdx !== -1 ? attendance[existingIdx] : null;
  const attLog = db.rhh_attendance_log || [];
  const logEntry = {
    id: nextId(attLog),
    employee_id: Number(employee_id),
    date: String(date),
    old_status: prevRecord ? prevRecord.status : 'sin_registro',
    new_status: status,
    old_te: prevRecord ? (prevRecord.te_hours || 0) : 0,
    new_te: te_hours !== undefined ? Number(te_hours) : 0,
    changed_by_id: req.rhhUser.id,
    changed_by_name: req.rhhUser.full_name || req.rhhUser.email,
    changed_at: now,
    ip: null
  };
  attLog.push(logEntry);
  db.rhh_attendance_log = attLog;

  const VALID_CC = ['rh', 'operaciones', 'cliente', null, undefined];
  const cc = cost_center || null;
  if (cc && !['rh', 'operaciones', 'cliente'].includes(cc)) {
    return res.status(400).json({ error: 'cost_center inválido (rh | operaciones | cliente)' });
  }

  if (existingIdx !== -1) {
    attendance[existingIdx] = {
      ...attendance[existingIdx],
      status,
      te_hours: te_hours !== undefined ? Number(te_hours) : attendance[existingIdx].te_hours,
      notes: notes !== undefined ? notes : attendance[existingIdx].notes,
      cost_center: cost_center !== undefined ? cc : attendance[existingIdx].cost_center,
      project_id: project_id !== undefined ? (project_id || null) : attendance[existingIdx].project_id,
      registered_by: req.rhhUser.id,
      updated_at: now
    };
    db.rhh_attendance = attendance;
    write(db);
    return res.json({ ok: true, record: attendance[existingIdx], log: logEntry });
  }

  const record = {
    id: nextId(attendance),
    employee_id: Number(employee_id),
    date: String(date),
    status: String(status),
    te_hours: te_hours !== undefined ? Number(te_hours) : 0,
    notes: notes || null,
    cost_center: cc,
    project_id: project_id || null,
    registered_by: req.rhhUser.id,
    created_at: now,
    updated_at: now
  };

  attendance.push(record);
  db.rhh_attendance = attendance;
  write(db);

  res.status(201).json({ ok: true, record, log: logEntry });
});

// ── GET /api/rhh/schedule/attendance-log ──────────────────────────────────────
router.get('/attendance-log', rhhAuthRequired, (req, res) => {
  const db = read();
  const { employee_id, date, week_start } = req.query;
  let list = db.rhh_attendance_log || [];

  if (employee_id) list = list.filter(l => l.employee_id === Number(employee_id));

  if (date) {
    list = list.filter(l => l.date === date);
  } else if (week_start) {
    // 7 días desde week_start
    const end = new Date(week_start + 'T12:00:00');
    end.setDate(end.getDate() + 6);
    const endStr = end.toISOString().slice(0, 10);
    list = list.filter(l => l.date >= week_start && l.date <= endStr);
  }

  list = list.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  res.json(list);
});

// ── POST /api/rhh/schedule/request-te ─────────────────────────────────────────
router.post('/request-te', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const { employee_id, date, shift_id, te_hours, notes } = req.body || {};

  if (!employee_id || !date || !te_hours) {
    return res.status(400).json({ error: 'employee_id, date y te_hours son requeridos' });
  }

  const teAuths = db.rhh_te_authorizations || [];
  const auth = {
    id: nextId(teAuths),
    employee_id: Number(employee_id),
    date: String(date),
    shift_id: shift_id ? Number(shift_id) : null,
    te_hours: Number(te_hours),
    status: 'pending',
    notes: notes || null,
    requested_by: req.rhhUser.id,
    approved_by: null,
    created_at: new Date().toISOString()
  };

  teAuths.push(auth);
  db.rhh_te_authorizations = teAuths;
  write(db);

  res.status(201).json({ ok: true, authorization: auth });
});

// ── GET /api/rhh/schedule/holidays?year=2026 ──────────────────────────────────
router.get('/holidays', rhhAuthRequired, (req, res) => {
  const db = read();
  const year = req.query.year || String(new Date().getFullYear());
  const list = (db.rhh_holidays || []).filter(h => h.date && h.date.startsWith(year));
  res.json(list);
});

// ── POST /api/rhh/schedule/holidays ───────────────────────────────────────────
router.post('/holidays', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { date, name } = req.body || {};
  if (!date || !name) return res.status(400).json({ error: 'date y name son requeridos' });

  const holidays = db.rhh_holidays || [];
  const existing = holidays.find(h => h.date === date);
  if (existing) return res.status(409).json({ error: 'Ya existe un festivo en esa fecha' });

  const holiday = {
    id: nextId(holidays),
    date: String(date),
    name: String(name),
    created_at: new Date().toISOString()
  };

  holidays.push(holiday);
  db.rhh_holidays = holidays;
  write(db);

  res.status(201).json(holiday);
});

// ── DELETE /api/rhh/schedule/holidays/:id ─────────────────────────────────────
router.delete('/holidays/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_holidays || []).findIndex(h => h.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Festivo no encontrado' });

  db.rhh_holidays.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ── ROL Semanal ────────────────────────────────────────────────────────────────

// GET /api/rhh/schedule/weekly-rol?week_start=YYYY-MM-DD
router.get('/weekly-rol', rhhAuthRequired, (req, res) => {
  const db = read();
  let weekStart;
  if (req.query.week_start) {
    weekStart = req.query.week_start;
  } else {
    const now = new Date();
    const d = new Date(now);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    weekStart = d.toISOString().slice(0, 10);
  }

  const shifts = db.rhh_shifts || [];
  const positions = db.rhh_positions || [];
  const employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  const weeklyRols = db.rhh_weekly_rol || [];
  const rolSlots = db.rhh_rol_slots || [];
  const rolAssignments = db.rhh_rol_assignments || [];

  const result = shifts.map(shift => {
    const rol = weeklyRols.find(r => r.week_start === weekStart && r.shift_id === shift.id) || null;
    const slots = rol ? rolSlots.filter(s => s.rol_id === rol.id) : [];

    const slotsWithAssignments = slots.map(slot => {
      const assignments = rolAssignments.filter(a => a.rol_id === rol.id && a.slot_id === slot.id);
      const position = positions.find(p => p.id === slot.position_id);
      const assigned = assignments.map(a => {
        const emp = employees.find(e => e.id === a.employee_id);
        return {
          assignment_id: a.id,
          employee_id: a.employee_id,
          full_name: emp?.full_name || 'Desconocido',
          employee_number: emp?.employee_number || '',
          shift_id: emp?.shift_id || null
        };
      });
      return {
        ...slot,
        position_name: position?.name || 'Puesto desconocido',
        assigned,
        missing: Math.max(0, (slot.required_count || 1) - assigned.length)
      };
    });

    const totalMissing = slotsWithAssignments.reduce((s, sl) => s + sl.missing, 0);
    return { rol, shift, slots: slotsWithAssignments, total_missing: totalMissing };
  });

  res.json({ week_start: weekStart, shifts: result });
});

// POST /api/rhh/schedule/weekly-rol — crear ROL para semana/turno
router.post('/weekly-rol', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { week_start, shift_id } = req.body || {};
  if (!week_start || !shift_id) return res.status(400).json({ error: 'week_start y shift_id son requeridos' });

  const weeklyRols = db.rhh_weekly_rol || [];
  const existing = weeklyRols.find(r => r.week_start === week_start && r.shift_id === Number(shift_id));
  if (existing) return res.json(existing);

  const rol = {
    id: nextId(weeklyRols),
    week_start: String(week_start),
    shift_id: Number(shift_id),
    status: 'draft',
    published_at: null,
    published_by: null,
    notes: null,
    created_at: new Date().toISOString(),
    created_by: req.rhhUser.id
  };
  weeklyRols.push(rol);
  db.rhh_weekly_rol = weeklyRols;
  write(db);
  res.status(201).json(rol);
});

// POST /api/rhh/schedule/weekly-rol/:id/slots — agregar puesto requerido
router.post('/weekly-rol/:id/slots', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const rolId = Number(req.params.id);
  const { position_id, required_count, days, notes } = req.body || {};
  if (!position_id) return res.status(400).json({ error: 'position_id es requerido' });

  const rol = (db.rhh_weekly_rol || []).find(r => r.id === rolId);
  if (!rol) return res.status(404).json({ error: 'ROL no encontrado' });
  if (rol.status === 'published') return res.status(409).json({ error: 'El ROL ya está publicado' });

  const slots = db.rhh_rol_slots || [];
  const slot = {
    id: nextId(slots),
    rol_id: rolId,
    position_id: Number(position_id),
    required_count: Number(required_count) || 1,
    days: Array.isArray(days) ? days.map(Number) : [1, 2, 3, 4, 5],
    notes: notes || null
  };
  slots.push(slot);
  db.rhh_rol_slots = slots;
  write(db);
  res.status(201).json(slot);
});

// DELETE /api/rhh/schedule/weekly-rol/:id/slots/:slotId
router.delete('/weekly-rol/:id/slots/:slotId', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const rolId = Number(req.params.id);
  const slotId = Number(req.params.slotId);

  const rol = (db.rhh_weekly_rol || []).find(r => r.id === rolId);
  if (!rol) return res.status(404).json({ error: 'ROL no encontrado' });
  if (rol.status === 'published') return res.status(409).json({ error: 'El ROL ya está publicado' });

  const slots = db.rhh_rol_slots || [];
  const idx = slots.findIndex(s => s.id === slotId && s.rol_id === rolId);
  if (idx === -1) return res.status(404).json({ error: 'Puesto no encontrado en ROL' });

  slots.splice(idx, 1);
  db.rhh_rol_slots = slots;
  db.rhh_rol_assignments = (db.rhh_rol_assignments || []).filter(
    a => !(a.rol_id === rolId && a.slot_id === slotId)
  );
  write(db);
  res.json({ ok: true });
});

// POST /api/rhh/schedule/weekly-rol/:id/assign — asignar empleado a puesto
router.post('/weekly-rol/:id/assign', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const rolId = Number(req.params.id);
  const { slot_id, employee_id } = req.body || {};
  if (!slot_id || !employee_id) return res.status(400).json({ error: 'slot_id y employee_id son requeridos' });

  const rol = (db.rhh_weekly_rol || []).find(r => r.id === rolId);
  if (!rol) return res.status(404).json({ error: 'ROL no encontrado' });
  if (rol.status === 'published') return res.status(409).json({ error: 'El ROL ya está publicado' });

  const slot = (db.rhh_rol_slots || []).find(s => s.id === Number(slot_id) && s.rol_id === rolId);
  if (!slot) return res.status(404).json({ error: 'Puesto no encontrado en ROL' });

  const emp = (db.rhh_employees || []).find(e => e.id === Number(employee_id) && e.status === 'active');
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  // Supervisor solo puede asignar sus reportes directos
  if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    if (emp.supervisor_id !== req.rhhUser.employee_id && emp.id !== req.rhhUser.employee_id) {
      return res.status(403).json({ error: 'Solo puedes asignar a tus reportes directos' });
    }
  }

  const assignments = db.rhh_rol_assignments || [];
  const dup = assignments.find(
    a => a.rol_id === rolId && a.slot_id === Number(slot_id) && a.employee_id === Number(employee_id)
  );
  if (dup) return res.status(409).json({ error: 'Empleado ya asignado a este puesto' });

  const assignment = {
    id: nextId(assignments),
    rol_id: rolId,
    slot_id: Number(slot_id),
    employee_id: Number(employee_id),
    assigned_by: req.rhhUser.id,
    created_at: new Date().toISOString()
  };
  assignments.push(assignment);
  db.rhh_rol_assignments = assignments;
  write(db);
  res.status(201).json(assignment);
});

// DELETE /api/rhh/schedule/weekly-rol/:id/assign/:assignId
router.delete('/weekly-rol/:id/assign/:assignId', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const rolId = Number(req.params.id);
  const assignId = Number(req.params.assignId);
  const assignments = db.rhh_rol_assignments || [];
  const idx = assignments.findIndex(a => a.id === assignId && a.rol_id === rolId);
  if (idx === -1) return res.status(404).json({ error: 'Asignación no encontrada' });
  assignments.splice(idx, 1);
  db.rhh_rol_assignments = assignments;
  write(db);
  res.json({ ok: true });
});

// POST /api/rhh/schedule/weekly-rol/:id/publish — publicar ROL
router.post('/weekly-rol/:id/publish', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const rolId = Number(req.params.id);
  const weeklyRols = db.rhh_weekly_rol || [];
  const idx = weeklyRols.findIndex(r => r.id === rolId);
  if (idx === -1) return res.status(404).json({ error: 'ROL no encontrado' });

  const rol = weeklyRols[idx];
  if (rol.status === 'published') return res.status(409).json({ error: 'El ROL ya está publicado' });

  weeklyRols[idx] = {
    ...rol,
    status: 'published',
    published_at: new Date().toISOString(),
    published_by: req.rhhUser.id
  };
  db.rhh_weekly_rol = weeklyRols;

  // Notificar empleados asignados
  const assignments = (db.rhh_rol_assignments || []).filter(a => a.rol_id === rolId);
  const empIds = [...new Set(assignments.map(a => a.employee_id))];
  const shift = (db.rhh_shifts || []).find(s => s.id === rol.shift_id);
  const shiftName = shift?.name || 'su turno';
  const weekDate = new Date(rol.week_start + 'T12:00:00');
  const MONTHS_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const weekLabel = `semana del ${weekDate.getDate()} de ${MONTHS_ES[weekDate.getMonth()]}`;
  const notifications = db.rhh_notifications || [];

  for (const empId of empIds) {
    notifications.push({
      id: nextId(notifications),
      employee_id: empId,
      type: 'rol_published',
      title: '📅 ROL publicado',
      message: `Tu ROL para la ${weekLabel} (${shiftName}) ha sido publicado.`,
      data: { rol_id: rolId, week_start: rol.week_start, shift_id: rol.shift_id },
      read: false,
      created_at: new Date().toISOString()
    });
  }
  db.rhh_notifications = notifications;
  write(db);
  res.json({ ok: true, rol: weeklyRols[idx], notified: empIds.length });
});

// POST /api/rhh/schedule/weekly-rol/:id/copy-previous — copiar puestos de semana anterior
router.post('/weekly-rol/:id/copy-previous', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const rolId = Number(req.params.id);
  const weeklyRols = db.rhh_weekly_rol || [];
  const rol = weeklyRols.find(r => r.id === rolId);
  if (!rol) return res.status(404).json({ error: 'ROL no encontrado' });
  if (rol.status === 'published') return res.status(409).json({ error: 'El ROL ya está publicado' });

  const prevDate = new Date(rol.week_start + 'T12:00:00');
  prevDate.setDate(prevDate.getDate() - 7);
  const prevWeekStr = prevDate.toISOString().slice(0, 10);
  const prevRol = weeklyRols.find(r => r.week_start === prevWeekStr && r.shift_id === rol.shift_id);
  if (!prevRol) return res.status(404).json({ error: 'No hay ROL de la semana anterior para este turno' });

  const prevSlots = (db.rhh_rol_slots || []).filter(s => s.rol_id === prevRol.id);
  if (prevSlots.length === 0) return res.status(404).json({ error: 'La semana anterior no tiene puestos definidos' });

  const slots = db.rhh_rol_slots || [];
  const newSlots = [];
  for (const ps of prevSlots) {
    if (!slots.find(s => s.rol_id === rolId && s.position_id === ps.position_id)) {
      const ns = { id: nextId(slots), rol_id: rolId, position_id: ps.position_id, required_count: ps.required_count, days: ps.days, notes: ps.notes };
      slots.push(ns);
      newSlots.push(ns);
    }
  }
  db.rhh_rol_slots = slots;
  write(db);
  res.json({ ok: true, slots_copied: newSlots.length, slots: newSlots });
});

// ── Cálculo T.E. (LFT) ────────────────────────────────────────────────────────

// GET /api/rhh/schedule/te-calc?week_start=YYYY-MM-DD
router.get('/te-calc', rhhAuthRequired, (req, res) => {
  const db = read();
  let weekStart;
  if (req.query.week_start) {
    weekStart = req.query.week_start;
  } else {
    const now = new Date();
    const d = new Date(now);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    weekStart = d.toISOString().slice(0, 10);
  }

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + i);
    weekDays.push(d.toISOString().slice(0, 10));
  }

  const employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  const shifts = db.rhh_shifts || [];
  const attendanceRecords = db.rhh_attendance || [];
  const holidays = db.rhh_holidays || [];

  const result = employees.map(emp => {
    const shift = shifts.find(s => s.id === emp.shift_id);
    const dailySalary = emp.daily_salary || 0;
    const isT3 = shift?.code === 'T3';
    const dailyHours = isT3 ? 7 : 8;
    const hourlyRate = dailyHours > 0 ? dailySalary / dailyHours : 0;

    const dayDetails = weekDays.map(dateStr => {
      const dow = new Date(dateStr + 'T12:00:00').getDay();
      const isSunday = dow === 0;
      const isHoliday = holidays.some(h => h.date === dateStr);
      const worksThisDay = shift ? shift.work_days.includes(dow) : false;
      const attRecord = attendanceRecords.find(a => a.employee_id === emp.id && a.date === dateStr);
      const teHours = attRecord?.te_hours || 0;
      const actualStatus = attRecord?.status || (worksThisDay ? 'labora' : 'descanso');
      const isBirthdayWork = !!(emp.birth_date &&
        emp.birth_date.slice(5) === dateStr.slice(5) &&
        (actualStatus === 'labora' || actualStatus === 'present'));
      return {
        date: dateStr,
        day_of_week: dow,
        is_sunday: isSunday,
        is_holiday: isHoliday,
        works_this_day: worksThisDay,
        status: actualStatus,
        te_hours: teHours,
        cost_center: attRecord?.cost_center || null,
        project_id: attRecord?.project_id || null,
        birthday_work: isBirthdayWork
      };
    });

    const weeklyTeTotal = dayDetails.reduce((s, d) => s + d.te_hours, 0);

    // T3 default TE: turno de 45h reales, 42h legales → 3h de TE semanales incluidas
    // Solo las horas ADICIONALES a las 3 built-in cuentan como horas extra LFT
    const effectiveTeHours = isT3 ? Math.max(0, weeklyTeTotal - 3) : weeklyTeTotal;

    // LFT: hrs 1-9 = 2x, hrs 10+ = 3x (sobre el salario/hora)
    const te2x = Math.min(effectiveTeHours, 9);
    const te3x = Math.max(0, effectiveTeHours - 9);
    // Monto EXTRA sobre el salario regular (el doble/triple ya incluye el salario base)
    const teExtraPay = te2x * hourlyRate + te3x * hourlyRate * 2;

    // Séptimo día (domingo laboral) y prima dominical
    const sundayWorked = dayDetails.filter(d => d.is_sunday && d.works_this_day && d.status !== 'falta' && d.status !== 'descanso');
    const primaDomin = sundayWorked.length * dailySalary * 0.25;
    const septimoSalary = sundayWorked.length > 0 ? sundayWorked.length * dailySalary * 2 : 0;

    // Cumpleaños laborado → pago doble (extra = 1× salario diario por día trabajado en cumpleaños)
    const birthdayDays = dayDetails.filter(d => d.birthday_work);
    const birthdayExtraPay = birthdayDays.length * dailySalary;

    return {
      employee_id: emp.id,
      employee_number: emp.employee_number,
      full_name: emp.full_name,
      shift_code: shift?.code || '—',
      shift_name: shift?.name || '—',
      daily_salary: dailySalary,
      hourly_rate: Math.round(hourlyRate * 100) / 100,
      is_t3: isT3,
      days: dayDetails,
      weekly_te_total: weeklyTeTotal,
      te_effective: effectiveTeHours,
      te_2x_hours: te2x,
      te_3x_hours: te3x,
      te_extra_pay: Math.round(teExtraPay * 100) / 100,
      prima_dominical: Math.round(primaDomin * 100) / 100,
      septimo_dia_pay: Math.round(septimoSalary * 100) / 100,
      birthday_extra_pay: Math.round(birthdayExtraPay * 100) / 100,
      birthday_days: birthdayDays.map(d => d.date),
      total_extra: Math.round((teExtraPay + primaDomin + birthdayExtraPay) * 100) / 100
    };
  });

  const withTE = result.filter(e => e.weekly_te_total > 0 || e.prima_dominical > 0);
  res.json({ week_start: weekStart, week_end: weekDays[6], employees: withTE, total_employees: result.length });
});

// POST /api/rhh/schedule/import-excel — admin/rh only
// Body: { excel_base64: string, week_start: "YYYY-MM-DD" }
router.post('/import-excel', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const XLSX = require('xlsx');
  const { excel_base64, week_start } = req.body || {};
  if (!excel_base64) return res.status(400).json({ error: 'Se requiere excel_base64' });
  if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return res.status(400).json({ error: 'week_start requerido (YYYY-MM-DD)' });
  }

  try {
    const buf = Buffer.from(excel_base64, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Column mapping: status at [6,10,14,18,22], TE at [8,12,16,20,24] (Mon-Fri)
    const STATUS_COLS = [6, 10, 14, 18, 22];
    const TE_COLS    = [8, 12, 16, 20, 24];
    const STATUS_MAP = {
      'Labora': 'present', 'Falta': 'absent', 'Vacaciones': 'vacation',
      'FESTIVO': 'holiday', 'Retardo': 'late', 'Incapacidad': 'medical_leave',
      'Permiso CG': 'permission_paid', 'Permiso SG': 'permission_unpaid',
      'Paro tecnico': 'technical_stop', 'Descanso': 'rest',
      'Baja': 'terminated', 'TiempoXT': 'time_off'
    };

    const db = read();
    const employees = db.rhh_employees || [];
    if (!db.rhh_attendance) db.rhh_attendance = [];
    const attendance = db.rhh_attendance;

    // Build employee lookup by normalized name
    const empByName = {};
    for (const emp of employees) {
      if (emp.full_name) {
        empByName[emp.full_name.trim().toLowerCase().replace(/\s+/g, ' ')] = emp;
      }
    }

    // Week Mon-Fri dates
    const weekMon = new Date(week_start + 'T00:00:00');
    const weekDates = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekMon);
      d.setDate(weekMon.getDate() + i);
      weekDates.push(d.toISOString().slice(0, 10));
    }

    let created = 0, updated = 0, skipped = 0;

    for (const row of rows) {
      const rawName = String(row[1] || '').trim();
      if (!rawName || typeof row[0] !== 'number') continue;

      const emp = empByName[rawName.toLowerCase().replace(/\s+/g, ' ')];
      if (!emp) { skipped++; continue; }

      for (let di = 0; di < 5; di++) {
        const date = weekDates[di];
        const rawStatus = String(row[STATUS_COLS[di]] || '').trim();
        if (!rawStatus || !STATUS_MAP[rawStatus]) continue;
        const statusCode = STATUS_MAP[rawStatus];
        const teHours = row[TE_COLS[di]];
        const teNum = (typeof teHours === 'number' && teHours > 0) ? teHours : null;

        const idx = attendance.findIndex(a => a.employee_id === emp.id && a.date === date);
        if (idx >= 0) {
          attendance[idx].status = statusCode;
          if (teNum !== null) attendance[idx].te_hours = teNum;
          attendance[idx].updated_at = new Date().toISOString();
          updated++;
        } else {
          attendance.push({
            id: nextId(db, 'rhh_attendance'),
            employee_id: emp.id,
            date,
            status: statusCode,
            te_hours: teNum,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          created++;
        }
      }
    }

    write(db);
    res.json({
      ok: true, created, updated, skipped,
      message: `Importación completada: ${created} nuevos, ${updated} actualizados, ${skipped} empleados no encontrados`
    });
  } catch (err) {
    res.status(500).json({ error: `Error al procesar el Excel: ${err.message}` });
  }
});

module.exports = router;
