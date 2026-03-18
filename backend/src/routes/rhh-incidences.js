const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

const VALID_TYPES = ['falta', 'vacacion', 'incapacidad', 'permiso', 'tiempo_extra', 'cumpleanos'];

// GET /api/rhh/incidences/today-absences
router.get('/today-absences', rhhAuthRequired, (req, res) => {
  const db = read();
  const today = new Date().toISOString().slice(0, 10);

  let employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    employees = employees.filter(e => e.supervisor_id === req.rhhUser.employee_id);
  }

  const todayIncidences = (db.rhh_incidences || []).filter(
    i => i.date === today && i.status !== 'rechazada'
  );

  const absences = todayIncidences.filter(i =>
    ['falta', 'vacacion', 'incapacidad', 'permiso'].includes(i.type)
  );

  const result = absences.map(inc => {
    const emp = employees.find(e => e.id === inc.employee_id) || null;
    const dept = emp ? (db.rhh_departments || []).find(d => d.id === emp.department_id) : null;
    const shift = emp ? (db.rhh_shifts || []).find(s => s.id === emp.shift_id) : null;
    return { ...inc, employee: emp, department: dept, shift };
  }).filter(a => a.employee !== null);

  res.json({ date: today, count: result.length, absences: result });
});

// GET /api/rhh/incidences/coverage-suggestions
router.get('/coverage-suggestions', rhhAuthRequired, (req, res) => {
  const db = read();
  const { date, shift_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date es requerido' });

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const shiftFilter = shift_id ? Number(shift_id) : null;

  const incidencesOnDate = (db.rhh_incidences || []).filter(
    i => i.date === date && i.status !== 'rechazada' &&
    ['falta', 'vacacion', 'incapacidad', 'permiso'].includes(i.type)
  );
  const absentIds = new Set(incidencesOnDate.map(i => i.employee_id));

  let available = (db.rhh_employees || []).filter(e => {
    if (e.status !== 'active') return false;
    if (absentIds.has(e.id)) return false;
    const shift = (db.rhh_shifts || []).find(s => s.id === e.shift_id);
    if (!shift) return false;
    // Si se pide un turno específico, preferir empleados de ese turno o de turno diferente
    return true;
  });

  const shifts = db.rhh_shifts || [];
  available = available.map(emp => {
    const shift = shifts.find(s => s.id === emp.shift_id) || null;
    const worksToday = shift ? shift.work_days.includes(dayOfWeek) : false;
    return { ...emp, shift, worksToday, priority: worksToday ? 2 : 1 };
  }).sort((a, b) => b.priority - a.priority);

  res.json({ date, suggestions: available });
});

// GET /api/rhh/incidences
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  let list = db.rhh_incidences || [];

  const { employee_id, type, date_from, date_to, status } = req.query;

  // Empleado solo ve las suyas
  if (req.rhhUser.role === 'empleado' && req.rhhUser.employee_id) {
    list = list.filter(i => i.employee_id === req.rhhUser.employee_id);
  } else if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    // Supervisor ve las de sus subordinados
    const subordinates = (db.rhh_employees || [])
      .filter(e => e.supervisor_id === req.rhhUser.employee_id)
      .map(e => e.id);
    subordinates.push(req.rhhUser.employee_id);
    list = list.filter(i => subordinates.includes(i.employee_id));
  }

  if (employee_id) list = list.filter(i => i.employee_id === Number(employee_id));
  if (type) list = list.filter(i => i.type === type);
  if (status) list = list.filter(i => i.status === status);
  if (date_from) list = list.filter(i => i.date >= date_from);
  if (date_to) list = list.filter(i => i.date <= date_to);

  list = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const employees = db.rhh_employees || [];
  const departments = db.rhh_departments || [];
  const shifts = db.rhh_shifts || [];

  const enriched = list.map(inc => {
    const emp = employees.find(e => e.id === inc.employee_id) || null;
    const dept = emp ? departments.find(d => d.id === emp.department_id) : null;
    const shift = emp ? shifts.find(s => s.id === emp.shift_id) : null;
    return {
      ...inc,
      employee: emp ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null,
      department: dept ? { id: dept.id, name: dept.name } : null,
      shift: shift ? { id: shift.id, name: shift.name } : null
    };
  });

  res.json(enriched);
});

// POST /api/rhh/incidences
router.post('/', rhhAuthRequired, (req, res) => {
  const db = read();
  const { employee_id, type, date, date_end, notes, hours } = req.body || {};

  if (!type || !date) return res.status(400).json({ error: 'Tipo y fecha son requeridos' });
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de incidencia inválido' });

  // Determinar employee_id
  let targetEmpId = employee_id ? Number(employee_id) : null;

  // Si es empleado, solo puede registrar para sí mismo
  if (req.rhhUser.role === 'empleado') {
    targetEmpId = req.rhhUser.employee_id;
  }

  if (!targetEmpId) return res.status(400).json({ error: 'employee_id requerido' });

  const emp = (db.rhh_employees || []).find(e => e.id === targetEmpId && e.status === 'active');
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  // Determinar estado inicial según rol
  let initialStatus = 'pendiente';
  if (['rh', 'admin'].includes(req.rhhUser.role)) {
    initialStatus = 'aprobada';
  }
  // Faltas registradas por supervisor se aprueban automáticamente
  if (req.rhhUser.role === 'supervisor' && type === 'falta') {
    initialStatus = 'aprobada';
  }

  const incidences = db.rhh_incidences || [];
  const inc = {
    id: nextId(incidences),
    employee_id: targetEmpId,
    type: String(type),
    date: String(date),
    date_end: date_end || String(date),
    hours: hours ? Number(hours) : null,
    notes: notes || null,
    status: initialStatus,
    created_by: req.rhhUser.id,
    created_at: new Date().toISOString(),
    approved_by: initialStatus === 'aprobada' ? req.rhhUser.id : null,
    approved_at: initialStatus === 'aprobada' ? new Date().toISOString() : null
  };

  incidences.push(inc);
  db.rhh_incidences = incidences;
  write(db);

  res.status(201).json(inc);
});

// PATCH /api/rhh/incidences/:id — aprobar/rechazar o editar
router.patch('/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const idx = (db.rhh_incidences || []).findIndex(i => i.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Incidencia no encontrada' });

  const inc = { ...db.rhh_incidences[idx] };

  // Solo supervisor/rh/admin pueden cambiar status
  if (req.body.status !== undefined) {
    if (!['supervisor', 'rh', 'admin'].includes(req.rhhUser.role)) {
      return res.status(403).json({ error: 'No autorizado para cambiar el estado' });
    }
    const newStatus = req.body.status;
    if (!['aprobada', 'rechazada', 'pendiente'].includes(newStatus)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    inc.status = newStatus;
    if (newStatus === 'aprobada') {
      inc.approved_by = req.rhhUser.id;
      inc.approved_at = new Date().toISOString();
    } else if (newStatus === 'rechazada') {
      inc.rejected_by = req.rhhUser.id;
      inc.rejected_at = new Date().toISOString();
      inc.rejection_reason = req.body.rejection_reason || null;
    }
  }

  // Edición de campos (solo rh/admin o el creador si sigue pendiente)
  const editableFields = ['type', 'date', 'date_end', 'hours', 'notes'];
  const canEdit = ['rh', 'admin'].includes(req.rhhUser.role) ||
    (inc.created_by === req.rhhUser.id && inc.status === 'pendiente');

  if (canEdit) {
    for (const field of editableFields) {
      if (req.body[field] !== undefined) inc[field] = req.body[field];
    }
  }

  inc.updated_at = new Date().toISOString();
  db.rhh_incidences[idx] = inc;
  write(db);

  res.json(inc);
});

// DELETE /api/rhh/incidences/:id
router.delete('/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_incidences || []).findIndex(i => i.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Incidencia no encontrada' });

  db.rhh_incidences.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

module.exports = router;
