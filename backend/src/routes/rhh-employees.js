const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ── Utilidades ────────────────────────────────────────────────────────────────
function enrichEmployee(emp, db) {
  const dept = (db.rhh_departments || []).find(d => d.id === emp.department_id) || null;
  const pos = (db.rhh_positions || []).find(p => p.id === emp.position_id) || null;
  const shift = (db.rhh_shifts || []).find(s => s.id === emp.shift_id) || null;
  const supervisor = emp.supervisor_id
    ? (db.rhh_employees || []).find(e => e.id === emp.supervisor_id) || null
    : null;
  return {
    ...emp,
    department: dept,
    position: pos,
    shift,
    supervisor: supervisor ? { id: supervisor.id, full_name: supervisor.full_name } : null
  };
}

// GET /api/rhh/employees
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  let list = db.rhh_employees || [];

  const { department_id, shift_id, status, search } = req.query;

  if (department_id) list = list.filter(e => e.department_id === Number(department_id));
  if (shift_id) list = list.filter(e => e.shift_id === Number(shift_id));
  if (status) list = list.filter(e => e.status === status);
  else list = list.filter(e => e.status !== 'deleted');

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(e =>
      e.full_name?.toLowerCase().includes(q) ||
      e.email?.toLowerCase().includes(q) ||
      e.employee_number?.toLowerCase().includes(q)
    );
  }

  // Si es supervisor, solo ve sus subordinados directos
  if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    list = list.filter(e => e.supervisor_id === req.rhhUser.employee_id || e.id === req.rhhUser.employee_id);
  }

  // Si es empleado, solo se ve a sí mismo
  if (req.rhhUser.role === 'empleado' && req.rhhUser.employee_id) {
    list = list.filter(e => e.id === req.rhhUser.employee_id);
  }

  res.json(list.map(e => enrichEmployee(e, db)));
});

// GET /api/rhh/employees/:id
router.get('/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  // Empleado solo puede ver su propio perfil
  if (req.rhhUser.role === 'empleado' && emp.id !== req.rhhUser.employee_id) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  res.json(enrichEmployee(emp, db));
});

// POST /api/rhh/employees
router.post('/', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const {
    full_name, email, phone, department_id, position_id, shift_id,
    supervisor_id, start_date, birth_date, contract_type, base_salary, status
  } = req.body || {};

  if (!full_name || !email) return res.status(400).json({ error: 'Nombre y email son requeridos' });

  // Verificar email único
  const exists = (db.rhh_employees || []).find(e => e.email?.toLowerCase() === email.toLowerCase() && e.status !== 'deleted');
  if (exists) return res.status(409).json({ error: 'Ya existe un empleado con ese email' });

  const employees = db.rhh_employees || [];
  const newId = nextId(employees);
  const empNum = `EMP-${String(newId).padStart(3, '0')}`;

  const emp = {
    id: newId,
    employee_number: empNum,
    full_name: String(full_name),
    email: String(email).toLowerCase(),
    phone: phone || null,
    department_id: department_id ? Number(department_id) : null,
    position_id: position_id ? Number(position_id) : null,
    shift_id: shift_id ? Number(shift_id) : null,
    supervisor_id: supervisor_id ? Number(supervisor_id) : null,
    start_date: start_date || null,
    birth_date: birth_date || null,
    status: status || 'active',
    contract_type: contract_type || 'indefinido',
    base_salary: base_salary ? Number(base_salary) : 0,
    photo: null,
    created_at: new Date().toISOString()
  };

  employees.push(emp);
  db.rhh_employees = employees;
  write(db);

  res.status(201).json(enrichEmployee(emp, db));
});

// PATCH /api/rhh/employees/:id
router.patch('/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_employees || []).findIndex(e => e.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Empleado no encontrado' });

  const allowed = ['full_name', 'email', 'phone', 'department_id', 'position_id',
    'shift_id', 'supervisor_id', 'start_date', 'birth_date', 'contract_type',
    'base_salary', 'status', 'photo'];

  const emp = { ...db.rhh_employees[idx] };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      emp[key] = req.body[key];
    }
  }
  emp.updated_at = new Date().toISOString();
  db.rhh_employees[idx] = emp;
  write(db);

  res.json(enrichEmployee(emp, db));
});

// DELETE /api/rhh/employees/:id — soft delete
router.delete('/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_employees || []).findIndex(e => e.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Empleado no encontrado' });

  db.rhh_employees[idx].status = 'inactive';
  db.rhh_employees[idx].updated_at = new Date().toISOString();
  write(db);

  res.json({ ok: true, message: 'Empleado desactivado' });
});

// GET /api/rhh/employees/:id/timeline
router.get('/:id/timeline', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  // Empleado solo puede ver su propia línea de tiempo
  if (req.rhhUser.role === 'empleado' && empId !== req.rhhUser.employee_id) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const incidences = (db.rhh_incidences || [])
    .filter(i => i.employee_id === empId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const overtime = (db.rhh_overtime || [])
    .filter(o => o.employee_id === empId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const schedule = (db.rhh_schedule || [])
    .filter(s => s.employee_id === empId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);

  const timeline = [
    ...incidences.map(i => ({ type: 'incidencia', ...i })),
    ...overtime.map(o => ({ type: 'tiempo_extra', ...o })),
    ...schedule.map(s => ({ type: 'asignacion', ...s }))
  ].sort((a, b) => {
    const da = new Date(b.date || b.created_at || 0);
    const db2 = new Date(a.date || a.created_at || 0);
    return da - db2;
  });

  res.json({ employee: enrichEmployee(emp, db), timeline });
});

module.exports = router;
