const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

function enrichVacancy(v, db) {
  const pos = (db.rhh_positions || []).find(p => p.id === v.position_id) || null;
  const dept = (db.rhh_departments || []).find(d => d.id === v.department_id) || null;
  const shift = (db.rhh_shifts || []).find(s => s.id === v.shift_id) || null;
  const originEmp = v.origin_employee_id
    ? (db.rhh_employees || []).find(e => e.id === v.origin_employee_id) || null
    : null;
  return {
    ...v,
    position: pos ? { id: pos.id, name: pos.name } : null,
    department: dept ? { id: dept.id, name: dept.name } : null,
    shift: shift ? { id: shift.id, name: shift.name } : null,
    origin_employee: originEmp ? { id: originEmp.id, full_name: originEmp.full_name } : null
  };
}

// GET /api/rhh/vacancies
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  let list = db.rhh_vacancies || [];
  const { status } = req.query;
  if (status) list = list.filter(v => v.status === status);
  res.json(list.map(v => enrichVacancy(v, db)));
});

// GET /api/rhh/vacancies/stats
router.get('/stats', rhhAuthRequired, (req, res) => {
  const db = read();
  const list = db.rhh_vacancies || [];
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const open = list.filter(v => v.status === 'open').length;
  const in_process = list.filter(v => v.status === 'in_process').length;
  const filled_this_month = list.filter(v =>
    v.status === 'filled' && v.filled_date && v.filled_date.startsWith(thisMonth)
  ).length;

  // by_department
  const deptMap = {};
  for (const v of list.filter(v => v.status === 'open' || v.status === 'in_process')) {
    const dept = (db.rhh_departments || []).find(d => d.id === v.department_id);
    const name = dept ? dept.name : 'Sin depto';
    deptMap[name] = (deptMap[name] || 0) + 1;
  }
  const by_department = Object.entries(deptMap).map(([name, count]) => ({ name, count }));

  res.json({ open, in_process, filled_this_month, by_department });
});

// POST /api/rhh/vacancies
router.post('/', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { position_id, department_id, shift_id, reason, priority, project, notes } = req.body || {};

  if (!position_id || !department_id) {
    return res.status(400).json({ error: 'position_id y department_id son requeridos' });
  }

  const vacancies = db.rhh_vacancies || [];
  const vacancy = {
    id: nextId(vacancies),
    position_id: Number(position_id),
    department_id: Number(department_id),
    shift_id: shift_id ? Number(shift_id) : null,
    reason: reason || 'nuevo_puesto',
    origin_employee_id: null,
    status: 'open',
    priority: priority || 'media',
    project: project || '',
    notes: notes || '',
    opened_date: new Date().toISOString().slice(0, 10),
    filled_date: null,
    opened_by: req.rhhUser.id,
    filled_by: null
  };

  vacancies.push(vacancy);
  db.rhh_vacancies = vacancies;
  write(db);

  res.status(201).json(enrichVacancy(vacancy, db));
});

// PATCH /api/rhh/vacancies/:id
router.patch('/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  const list = db.rhh_vacancies || [];
  const idx = list.findIndex(v => v.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Vacante no encontrada' });

  const v = { ...list[idx] };
  const { status, notes, filled_date } = req.body || {};

  if (status !== undefined) {
    const VALID = ['open', 'in_process', 'filled', 'cancelled'];
    if (!VALID.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    v.status = status;
    if (status === 'filled') {
      v.filled_by = req.rhhUser.id;
      v.filled_date = filled_date || new Date().toISOString().slice(0, 10);
    }
  }
  if (notes !== undefined) v.notes = notes;
  if (filled_date !== undefined) v.filled_date = filled_date;
  v.updated_at = new Date().toISOString();

  list[idx] = v;
  db.rhh_vacancies = list;
  write(db);

  res.json(enrichVacancy(v, db));
});

module.exports = router;
