const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ══════════════════════════════════════════════════════════════
// DEPARTAMENTOS
// ══════════════════════════════════════════════════════════════

// GET /api/rhh/catalogs/departments
router.get('/departments', rhhAuthRequired, (req, res) => {
  const db = read();
  const depts = (db.rhh_departments || []).map(d => {
    const manager = d.manager_id
      ? (db.rhh_employees || []).find(e => e.id === d.manager_id)
      : null;
    return { ...d, manager: manager ? { id: manager.id, full_name: manager.full_name } : null };
  });
  res.json(depts);
});

// POST /api/rhh/catalogs/departments
router.post('/departments', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, code, manager_id } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: 'Nombre y código son requeridos' });

  const exists = (db.rhh_departments || []).find(d => d.code?.toUpperCase() === code.toUpperCase());
  if (exists) return res.status(409).json({ error: 'Ya existe un departamento con ese código' });

  const depts = db.rhh_departments || [];
  const dept = {
    id: nextId(depts),
    name: String(name),
    code: String(code).toUpperCase(),
    manager_id: manager_id ? Number(manager_id) : null
  };
  depts.push(dept);
  db.rhh_departments = depts;
  write(db);
  res.status(201).json(dept);
});

// PATCH /api/rhh/catalogs/departments/:id
router.patch('/departments/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_departments || []).findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Departamento no encontrado' });

  const dept = { ...db.rhh_departments[idx] };
  if (req.body.name !== undefined) dept.name = req.body.name;
  if (req.body.code !== undefined) dept.code = String(req.body.code).toUpperCase();
  if (req.body.manager_id !== undefined) dept.manager_id = req.body.manager_id ? Number(req.body.manager_id) : null;

  db.rhh_departments[idx] = dept;
  write(db);
  res.json(dept);
});

// DELETE /api/rhh/catalogs/departments/:id
router.delete('/departments/:id', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_departments || []).findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Departamento no encontrado' });

  // Verificar si tiene empleados
  const inUse = (db.rhh_employees || []).some(e => e.department_id === Number(req.params.id) && e.status !== 'deleted');
  if (inUse) return res.status(409).json({ error: 'No se puede eliminar: el departamento tiene empleados activos' });

  db.rhh_departments.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
// PUESTOS
// ══════════════════════════════════════════════════════════════

// GET /api/rhh/catalogs/positions
router.get('/positions', rhhAuthRequired, (req, res) => {
  const db = read();
  const { department_id } = req.query;
  let list = db.rhh_positions || [];
  if (department_id) list = list.filter(p => p.department_id === Number(department_id));

  const enriched = list.map(p => {
    const dept = (db.rhh_departments || []).find(d => d.id === p.department_id) || null;
    return { ...p, department: dept };
  });
  res.json(enriched);
});

// POST /api/rhh/catalogs/positions
router.post('/positions', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, department_id, level } = req.body || {};
  if (!name || !department_id) return res.status(400).json({ error: 'Nombre y departamento son requeridos' });

  const positions = db.rhh_positions || [];
  const pos = {
    id: nextId(positions),
    name: String(name),
    department_id: Number(department_id),
    level: level ? Number(level) : 1
  };
  positions.push(pos);
  db.rhh_positions = positions;
  write(db);
  res.status(201).json(pos);
});

// PATCH /api/rhh/catalogs/positions/:id
router.patch('/positions/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_positions || []).findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Puesto no encontrado' });

  const pos = { ...db.rhh_positions[idx] };
  if (req.body.name !== undefined) pos.name = req.body.name;
  if (req.body.department_id !== undefined) pos.department_id = Number(req.body.department_id);
  if (req.body.level !== undefined) pos.level = Number(req.body.level);

  db.rhh_positions[idx] = pos;
  write(db);
  res.json(pos);
});

// DELETE /api/rhh/catalogs/positions/:id
router.delete('/positions/:id', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_positions || []).findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Puesto no encontrado' });

  const inUse = (db.rhh_employees || []).some(e => e.position_id === Number(req.params.id) && e.status !== 'deleted');
  if (inUse) return res.status(409).json({ error: 'No se puede eliminar: hay empleados con este puesto' });

  db.rhh_positions.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
// TURNOS
// ══════════════════════════════════════════════════════════════

// GET /api/rhh/catalogs/shifts
router.get('/shifts', rhhAuthRequired, (req, res) => {
  const db = read();
  res.json(db.rhh_shifts || []);
});

// POST /api/rhh/catalogs/shifts
router.post('/shifts', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, code, start_time, end_time, work_days, color } = req.body || {};
  if (!name || !code || !start_time || !end_time) {
    return res.status(400).json({ error: 'Nombre, código, hora inicio y fin son requeridos' });
  }

  const shifts = db.rhh_shifts || [];
  const shift = {
    id: nextId(shifts),
    name: String(name),
    code: String(code).toUpperCase(),
    start_time: String(start_time),
    end_time: String(end_time),
    work_days: Array.isArray(work_days) ? work_days : [1, 2, 3, 4, 5],
    color: color || '#1d4ed8'
  };
  shifts.push(shift);
  db.rhh_shifts = shifts;
  write(db);
  res.status(201).json(shift);
});

// PATCH /api/rhh/catalogs/shifts/:id
router.patch('/shifts/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_shifts || []).findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Turno no encontrado' });

  const shift = { ...db.rhh_shifts[idx] };
  const allowed = ['name', 'code', 'start_time', 'end_time', 'work_days', 'color'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) shift[key] = req.body[key];
  }

  db.rhh_shifts[idx] = shift;
  write(db);
  res.json(shift);
});

// DELETE /api/rhh/catalogs/shifts/:id
router.delete('/shifts/:id', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_shifts || []).findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Turno no encontrado' });

  const inUse = (db.rhh_employees || []).some(e => e.shift_id === Number(req.params.id) && e.status !== 'deleted');
  if (inUse) return res.status(409).json({ error: 'No se puede eliminar: hay empleados asignados a este turno' });

  db.rhh_shifts.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

module.exports = router;
