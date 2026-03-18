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
  const startOfYear = new Date(now.getFullYear(), 0, 1);
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

      let cellStatus = 'no_laboral';
      if (worksThisDay) cellStatus = 'asignado';
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
        schedule_entry: assigned
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

module.exports = router;
