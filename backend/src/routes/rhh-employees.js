const express = require('express');
const bcrypt = require('bcryptjs');
const { read, write, nextId } = require('../db-rhh');
const { read: readCompras } = require('../db');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ── Utilidades ────────────────────────────────────────────────────────────────
function calcVacationBalance(emp, db) {
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;
  const incidences = db.rhh_incidences || [];

  const vacApproved = incidences.filter(i =>
    i.employee_id === emp.id &&
    i.type === 'vacacion' &&
    i.status === 'aprobada' &&
    i.date >= yearStart && i.date <= yearEnd
  );

  const vacPending = incidences.filter(i =>
    i.employee_id === emp.id &&
    i.type === 'vacacion' &&
    i.status === 'pendiente' &&
    i.date >= yearStart && i.date <= yearEnd
  );

  function countDays(inc) {
    const end = inc.date_end || inc.date;
    if (end !== inc.date) {
      const start = new Date(inc.date + 'T12:00:00');
      const endD = new Date(end + 'T12:00:00');
      return Math.round((endD - start) / (24 * 60 * 60 * 1000)) + 1;
    }
    return 1;
  }

  const vacation_used = vacApproved.reduce((acc, i) => acc + countDays(i), 0);
  const vacation_pending = vacPending.reduce((acc, i) => acc + countDays(i), 0);
  const total_vacation_days = emp.total_vacation_days || 15;
  const vacation_remaining = Math.max(0, total_vacation_days - vacation_used);

  return { vacation_used, vacation_remaining, vacation_pending, total_vacation_days };
}

function enrichEmployee(emp, db) {
  const dept = (db.rhh_departments || []).find(d => d.id === emp.department_id) || null;
  const pos = (db.rhh_positions || []).find(p => p.id === emp.position_id) || null;
  const shift = (db.rhh_shifts || []).find(s => s.id === emp.shift_id) || null;
  const supervisor = emp.supervisor_id
    ? (db.rhh_employees || []).find(e => e.id === emp.supervisor_id) || null
    : null;
  const vacBalance = calcVacationBalance(emp, db);
  return {
    ...emp,
    department: dept,
    position: pos,
    shift,
    supervisor: supervisor ? { id: supervisor.id, full_name: supervisor.full_name } : null,
    ...vacBalance
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

// ── Plantillas de documentos (ANTES de /:id para evitar colisión) ─────────────

// GET /api/rhh/employees/doc-templates
router.get('/doc-templates', rhhAuthRequired, (req, res) => {
  const db = read();
  const templates = (db.rhh_doc_templates || []).map(({ template_content, ...rest }) => rest);
  res.json(templates);
});

// POST /api/rhh/employees/doc-templates
router.post('/doc-templates', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, category, description, template_content, variables } = req.body || {};
  if (!name || !template_content) {
    return res.status(400).json({ error: 'name y template_content son requeridos' });
  }

  const templates = db.rhh_doc_templates || [];
  const tpl = {
    id: Math.max(0, ...templates.map(t => Number(t.id) || 0)) + 1,
    name: String(name),
    category: category || 'otro',
    description: description || '',
    template_content: String(template_content),
    variables: Array.isArray(variables) ? variables : [],
    created_at: new Date().toISOString()
  };

  templates.push(tpl);
  db.rhh_doc_templates = templates;
  write(db);

  const { template_content: _tc, ...tplResponse } = tpl;
  res.status(201).json(tplResponse);
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
    supervisor_id, start_date, hire_date, birth_date, contract_type, base_salary, status,
    rfc, curp, nss, checker_number, daily_salary, enabled_positions,
    primary_position_id, project, emergency_contact_name, emergency_contact_phone
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
    start_date: start_date || hire_date || null,
    hire_date: hire_date || start_date || null,
    birth_date: birth_date || null,
    status: status || 'active',
    contract_type: contract_type || 'indefinido',
    base_salary: base_salary ? Number(base_salary) : 0,
    daily_salary: daily_salary ? Number(daily_salary) : null,
    rfc: rfc || '',
    curp: curp || '',
    nss: nss || '',
    checker_number: checker_number || '',
    primary_position_id: primary_position_id ? Number(primary_position_id) : (position_id ? Number(position_id) : null),
    enabled_positions: Array.isArray(enabled_positions) ? enabled_positions.map(Number) : (position_id ? [Number(position_id)] : []),
    project: project || '',
    emergency_contact_name: emergency_contact_name || '',
    emergency_contact_phone: emergency_contact_phone || '',
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

  const allowed = [
    'full_name', 'email', 'phone', 'department_id', 'position_id',
    'shift_id', 'supervisor_id', 'start_date', 'hire_date', 'birth_date',
    'contract_type', 'base_salary', 'daily_salary', 'status', 'photo',
    'rfc', 'curp', 'nss', 'checker_number',
    'primary_position_id', 'enabled_positions',
    'project', 'emergency_contact_name', 'emergency_contact_phone',
    'total_vacation_days'
  ];

  const emp = { ...db.rhh_employees[idx] };
  const wasActive = emp.status === 'active';
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      emp[key] = req.body[key];
    }
  }
  // Si start_date/hire_date cambia, sincronizar ambos
  if (req.body.start_date && !req.body.hire_date) emp.hire_date = req.body.start_date;
  if (req.body.hire_date && !req.body.start_date) emp.start_date = req.body.hire_date;

  emp.updated_at = new Date().toISOString();
  db.rhh_employees[idx] = emp;

  // Auto-crear vacante si el empleado se da de baja
  let vacancy = null;
  let vacancy_created = false;
  if (wasActive && req.body.status === 'inactive' && emp.primary_position_id) {
    const vacancies = db.rhh_vacancies || [];
    vacancy = {
      id: Math.max(0, ...vacancies.map(v => Number(v.id) || 0)) + 1,
      position_id: emp.primary_position_id,
      department_id: emp.department_id || null,
      shift_id: emp.shift_id || null,
      reason: req.body.termination_reason || 'baja_voluntaria',
      origin_employee_id: emp.id,
      status: 'open',
      priority: 'alta',
      project: emp.project || '',
      notes: '',
      opened_date: new Date().toISOString().slice(0, 10),
      filled_date: null,
      opened_by: req.rhhUser.id,
      filled_by: null
    };
    vacancies.push(vacancy);
    db.rhh_vacancies = vacancies;
    vacancy_created = true;
  }

  write(db);

  const response = { ok: true, employee: enrichEmployee(emp, db), vacancy_created };
  if (vacancy_created) response.vacancy = vacancy;
  res.json(response);
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

  const ICON_MAP = {
    falta:        { icon: '❌', color: '#dc2626' },
    vacacion:     { icon: '🌴', color: '#2563eb' },
    incapacidad:  { icon: '🏥', color: '#f59e0b' },
    tiempo_extra: { icon: '⚡', color: '#16a34a' },
    permiso:      { icon: '📋', color: '#7c3aed' },
    asignacion:   { icon: '📅', color: '#64748b' }
  };

  const incidences = (db.rhh_incidences || [])
    .filter(i => i.employee_id === empId)
    .map(i => {
      const info = ICON_MAP[i.type] || { icon: '📌', color: '#64748b' };
      return { ...i, event_type: i.type, icon: info.icon, color: info.color };
    });

  const schedule = (db.rhh_schedule || [])
    .filter(s => s.employee_id === empId)
    .slice(0, 30)
    .map(s => {
      const info = ICON_MAP.asignacion;
      return { ...s, event_type: 'asignacion', icon: info.icon, color: info.color };
    });

  const events = [...incidences, ...schedule].sort((a, b) => {
    const da = new Date(b.date || b.created_at || 0);
    const db2 = new Date(a.date || a.created_at || 0);
    return da - db2;
  });

  // Calcular stats
  const faltas = incidences.filter(i => i.event_type === 'falta').length;
  const vacaciones = incidences.filter(i => i.event_type === 'vacacion').length;
  const incapacidades = incidences.filter(i => i.event_type === 'incapacidad').length;
  const overtime = incidences.filter(i => i.event_type === 'tiempo_extra')
    .reduce((sum, i) => sum + (Number(i.hours) || 0), 0);
  const total_days = schedule.length;

  res.json({
    employee: enrichEmployee(emp, db),
    events,
    stats: { total_days, faltas, vacaciones, incapacidades, overtime }
  });
});

// ── Documentos del empleado ───────────────────────────────────────────────────

// GET /api/rhh/employees/:id/documents
router.get('/:id/documents', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  // Empleado solo puede ver sus propios documentos
  if (req.rhhUser.role === 'empleado' && empId !== req.rhhUser.employee_id) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const docs = (db.rhh_documents || [])
    .filter(d => d.employee_id === empId)
    // No enviar file_data para no sobrecargar la lista
    .map(d => {
      const { file_data, ...rest } = d;
      return { ...rest, has_file: !!file_data };
    });

  res.json(docs);
});

// POST /api/rhh/employees/:id/documents
router.post('/:id/documents', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const { category, name, file_data, file_type, notes, file_url } = req.body || {};
  if (!category || !name) return res.status(400).json({ error: 'Categoría y nombre son requeridos' });

  const VALID_CATEGORIES = [
    'contrato', 'identificacion', 'nss', 'curp', 'acta_administrativa',
    'incapacidad', 'carta_renuncia', 'evaluacion', 'capacitacion', 'otro'
  ];
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Categoría inválida' });
  }

  const docs = db.rhh_documents || [];
  const doc = {
    id: nextId(docs),
    employee_id: empId,
    category,
    name: String(name),
    file_data: file_data || null,
    file_url: file_url || null,
    file_type: file_type || null,
    notes: notes || null,
    uploaded_by: req.rhhUser.id,
    uploaded_at: new Date().toISOString()
  };

  docs.push(doc);
  db.rhh_documents = docs;
  write(db);

  // Devolver sin file_data
  const { file_data: _fd, ...docResponse } = doc;
  res.status(201).json({ ...docResponse, has_file: !!file_data });
});

// GET /api/rhh/employees/:id/documents/:docId — obtener un documento con file_data
router.get('/:id/documents/:docId', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const docId = Number(req.params.docId);

  if (req.rhhUser.role === 'empleado' && empId !== req.rhhUser.employee_id) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const doc = (db.rhh_documents || []).find(d => d.id === docId && d.employee_id === empId);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

  res.json(doc);
});

// DELETE /api/rhh/employees/:id/documents/:docId
router.delete('/:id/documents/:docId', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const docId = Number(req.params.docId);

  const idx = (db.rhh_documents || []).findIndex(d => d.id === docId && d.employee_id === empId);
  if (idx === -1) return res.status(404).json({ error: 'Documento no encontrado' });

  db.rhh_documents.splice(idx, 1);
  write(db);

  res.json({ ok: true });
});

// GET /api/rhh/employees/vacation-balance/:id
router.get('/vacation-balance/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  // Empleado solo puede ver su propio balance
  if (req.rhhUser.role === 'empleado' && empId !== req.rhhUser.employee_id) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;
  const incidences = db.rhh_incidences || [];

  const vacIncidences = incidences.filter(i =>
    i.employee_id === empId &&
    i.type === 'vacacion' &&
    i.date >= yearStart && i.date <= yearEnd
  );

  function countDays(inc) {
    const end = inc.date_end || inc.date;
    if (end !== inc.date) {
      const start = new Date(inc.date + 'T12:00:00');
      const endD = new Date(end + 'T12:00:00');
      return Math.round((endD - start) / (24 * 60 * 60 * 1000)) + 1;
    }
    return 1;
  }

  const detail = vacIncidences.map(i => ({
    start_date: i.date,
    end_date: i.date_end || i.date,
    days: countDays(i),
    status: i.status
  }));

  const vacation_used = vacIncidences.filter(i => i.status === 'aprobada').reduce((acc, i) => acc + countDays(i), 0);
  const vacation_pending = vacIncidences.filter(i => i.status === 'pendiente').reduce((acc, i) => acc + countDays(i), 0);
  const total_vacation_days = emp.total_vacation_days || 15;
  const vacation_remaining = Math.max(0, total_vacation_days - vacation_used);

  res.json({
    employee_id: empId,
    employee_name: emp.full_name,
    total_vacation_days,
    vacation_used,
    vacation_remaining,
    vacation_pending,
    year: currentYear,
    detail
  });
});

// POST /api/rhh/employees/:id/generate-doc
router.post('/:id/generate-doc', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const { template_id } = req.body || {};
  if (!template_id) return res.status(400).json({ error: 'template_id es requerido' });

  const tpl = (db.rhh_doc_templates || []).find(t => t.id === Number(template_id));
  if (!tpl) return res.status(404).json({ error: 'Plantilla no encontrada' });

  const pos = (db.rhh_positions || []).find(p => p.id === emp.position_id);
  const dept = (db.rhh_departments || []).find(d => d.id === emp.department_id);

  function fmtDDMMYYYY(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  const today = new Date().toISOString().slice(0, 10);
  const replacements = {
    nombre: emp.full_name || '',
    rfc: emp.rfc || '',
    curp: emp.curp || '',
    nss: emp.nss || '',
    puesto: pos ? pos.name : '',
    departamento: dept ? dept.name : '',
    fecha_ingreso: fmtDDMMYYYY(emp.start_date || emp.hire_date),
    salario_diario: emp.daily_salary ? String(emp.daily_salary) : '',
    fecha_actual: fmtDDMMYYYY(today)
  };

  let html_content = tpl.template_content;
  for (const [key, value] of Object.entries(replacements)) {
    html_content = html_content.split(`{{${key}}}`).join(value);
  }

  const namePart = (emp.full_name || 'documento').toLowerCase().replace(/\s+/g, '_');
  const filename = `documento_${namePart}_${today}.html`;

  res.json({ html_content, filename, category: tpl.category });
});

// GET /api/rhh/employees/from-compras
router.get('/from-compras', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const comprasDb = readCompras();
  const rhhEmails = new Set((db.rhh_employees || []).map(e => e.email?.toLowerCase()));
  const candidates = (comprasDb.users || []).filter(u =>
    u.active !== false && !rhhEmails.has(u.email?.toLowerCase())
  ).map(u => ({
    id: u.id, full_name: u.full_name, email: u.email,
    role_code: u.role_code, department: u.department || '',
    from: 'compras', password_hash: u.password_hash
  }));
  res.json(candidates);
});

// POST /api/rhh/employees/import-csv
router.post('/import-csv', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows[] requerido' });

  let created = 0, updated = 0;
  const errors = [];
  for (const row of rows) {
    if (!row.full_name || !row.email) { errors.push(`Fila sin nombre o email: ${JSON.stringify(row)}`); continue; }
    const idx = (db.rhh_employees || []).findIndex(e => e.email?.toLowerCase() === row.email.toLowerCase());
    if (idx !== -1) {
      db.rhh_employees[idx] = { ...db.rhh_employees[idx], ...row, id: db.rhh_employees[idx].id, updated_at: new Date().toISOString() };
      updated++;
    } else {
      const employees = db.rhh_employees || [];
      const dept = (db.rhh_departments || []).find(d => d.name?.toLowerCase() === String(row.department || '').toLowerCase());
      const pos = (db.rhh_positions || []).find(p => p.name?.toLowerCase() === String(row.position || '').toLowerCase());
      const shift = (db.rhh_shifts || []).find(s => s.code?.toLowerCase() === String(row.shift_code || '').toLowerCase() || s.name?.toLowerCase() === String(row.shift || '').toLowerCase());
      const newId = nextId(employees);
      const newEmp = {
        id: newId,
        employee_number: row.employee_number || 'EMP-' + String(newId).padStart(3, '0'),
        full_name: row.full_name, email: row.email.toLowerCase(),
        phone: row.phone || null, department_id: dept?.id || null,
        position_id: pos?.id || null, shift_id: shift?.id || null,
        supervisor_id: null, start_date: row.start_date || new Date().toISOString().slice(0, 10),
        hire_date: row.hire_date || row.start_date || new Date().toISOString().slice(0, 10),
        birth_date: row.birth_date || null, status: row.status || 'active',
        contract_type: row.contract_type || 'indefinido',
        base_salary: Number(row.base_salary) || 0, daily_salary: Number(row.daily_salary) || null,
        rfc: row.rfc || '', curp: row.curp || '', nss: row.nss || '',
        checker_number: row.checker_number || '',
        primary_position_id: pos?.id || null, enabled_positions: pos ? [pos.id] : [],
        project: row.project || '', total_vacation_days: Number(row.vacation_days) || 15,
        photo: null, created_at: new Date().toISOString()
      };
      employees.push(newEmp);
      db.rhh_employees = employees;
      created++;
    }
  }
  write(db);
  res.json({ ok: true, created, updated, errors });
});

// POST /api/rhh/employees/:id/create-user
router.post('/:id/create-user', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { role, password, password_hash } = req.body || {};
  const empId = Number(req.params.id);
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  const existing = (db.rhh_users || []).find(u => u.email?.toLowerCase() === emp.email?.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
  if (!password && !password_hash) return res.status(400).json({ error: 'Contraseña requerida' });
  const users = db.rhh_users || [];
  const user = {
    id: nextId(users),
    full_name: emp.full_name,
    email: emp.email,
    password_hash: password_hash || bcrypt.hashSync(String(password), 10),
    role: role || 'empleado',
    employee_id: empId,
    active: true,
    created_at: new Date().toISOString()
  };
  db.rhh_users = [...users, user];
  write(db);
  res.status(201).json({ ok: true, user: { id: user.id, email: user.email, role: user.role } });
});

// GET /api/rhh/employees/compras-users — lista todos los usuarios de Compras (para vincular)
router.get('/compras-users', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const comprasDb = readCompras();
  const rhhDb = read();
  const rhhEmps = rhhDb.rhh_employees || [];
  const users = (comprasDb.users || []).map(u => ({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    role_code: u.role_code,
    linked_to: rhhEmps.find(e => e.compras_email === u.email)?.full_name || null
  }));
  res.json(users);
});

// POST /api/rhh/employees/:id/link-compras — vincula empleado a cuenta de Compras
router.post('/:id/link-compras', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { compras_email } = req.body || {};
  const db = read();
  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  emp.compras_email = compras_email || null;
  emp.updated_at = new Date().toISOString();
  write(db);
  res.json({ ok: true, compras_email: emp.compras_email });
});

module.exports = router;
