const express = require('express');
const { read, write, nextId } = require('../db-rhh');
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
  write(db);

  res.status(201).json(entry);
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

    // Calcular vacaciones restantes (año actual)
    const vacUsedInYear = incidences.filter(i =>
      i.employee_id === emp.id &&
      i.type === 'vacacion' &&
      i.status === 'aprobada' &&
      i.date >= yearStart && i.date <= yearEnd
    ).reduce((acc, i) => {
      if (i.date_end && i.date_end !== i.date) {
        const start = new Date(i.date + 'T12:00:00');
        const end = new Date(i.date_end + 'T12:00:00');
        const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
        return acc + diffDays;
      }
      return acc + 1;
    }, 0);
    const totalVac = emp.vacation_days_per_year || 15;
    const vacRestantes = totalVac - vacUsedInYear;

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
      let isEditable = false;

      if (shift) {
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
        isEditable = true;
      }

      // 3. Incidencias aprobadas que cubren esta fecha
      const covering = incidences.filter(i =>
        i.employee_id === emp.id &&
        i.status === 'aprobada' &&
        i.date <= dateStr &&
        (i.date_end || i.date) >= dateStr
      );
      if (covering.length > 0) {
        const inc = covering[covering.length - 1];
        if (inc.type === 'vacacion') status = 'vacaciones';
        else if (inc.type === 'incapacidad') status = 'incapacidad';
        else if (inc.type === 'permiso_con_goce' || inc.type === 'permiso_sin_goce' || inc.type === 'permiso') status = 'permiso';
        else if (inc.type === 'falta') status = 'falta';
        else if (inc.type === 'retardo') status = 'retardo';
      }

      // 4. Cumpleaños
      let birthday = false;
      if (emp.birth_date) {
        const bParts = emp.birth_date.split('-');
        const dParts = dateStr.split('-');
        if (bParts[1] === dParts[1] && bParts[2] === dParts[2]) {
          birthday = true;
        }
      }

      // Si tiene TE autorizada para ese turno en día no laboral → editable
      const teAuth = (db.rhh_te_authorizations || []).find(
        t => t.date === dateStr && t.shift_id === emp.shift_id && t.status === 'approved'
      );
      if (teAuth && !isEditable) isEditable = true;

      return { date: dateStr, status, te_hours: teHours, notes, is_editable: isEditable, birthday };
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
  const { employee_id, date, status, te_hours, notes } = req.body || {};

  if (!employee_id || !date || !status) {
    return res.status(400).json({ error: 'employee_id, date y status son requeridos' });
  }

  const VALID_STATUS = ['labora', 'festivo', 'descanso', 'vacaciones', 'falta', 'retardo', 'cumpleanos', 'vacio', 'permiso', 'incapacidad'];
  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  const attendance = db.rhh_attendance || [];
  const existingIdx = attendance.findIndex(a => a.employee_id === Number(employee_id) && a.date === date);
  const now = new Date().toISOString();

  if (existingIdx !== -1) {
    attendance[existingIdx] = {
      ...attendance[existingIdx],
      status,
      te_hours: te_hours !== undefined ? Number(te_hours) : attendance[existingIdx].te_hours,
      notes: notes !== undefined ? notes : attendance[existingIdx].notes,
      registered_by: req.rhhUser.id,
      updated_at: now
    };
    db.rhh_attendance = attendance;
    write(db);
    return res.json({ ok: true, record: attendance[existingIdx] });
  }

  const record = {
    id: nextId(attendance),
    employee_id: Number(employee_id),
    date: String(date),
    status: String(status),
    te_hours: te_hours !== undefined ? Number(te_hours) : 0,
    notes: notes || null,
    registered_by: req.rhhUser.id,
    created_at: now,
    updated_at: now
  };

  attendance.push(record);
  db.rhh_attendance = attendance;
  write(db);

  res.status(201).json({ ok: true, record });
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

module.exports = router;
