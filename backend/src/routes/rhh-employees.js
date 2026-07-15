const express = require('express');
const bcrypt = require('bcryptjs');
const { read, write, nextId, calcVacBalance } = require('../db-rhh');
const { read: readCompras } = require('../db');
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
  // Fuente única: calcVacBalance desde db-rhh (misma lógica que /vacation-balance/:id)
  const vacBalance = calcVacBalance(db, emp.id, new Date().getFullYear()) || {};
  return {
    ...emp,
    department: dept,
    position: pos,
    shift,
    supervisor: supervisor ? { id: supervisor.id, full_name: supervisor.full_name } : null,
    vacation_used: vacBalance.vacation_used ?? 0,
    vacation_remaining: vacBalance.vacation_remaining ?? (emp.total_vacation_days || 15),
    vacation_pending: vacBalance.vacation_pending ?? 0,
    total_vacation_days: vacBalance.total_vacation_days ?? emp.total_vacation_days ?? 15
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
router.get('/:id', rhhAuthRequired, (req, res, next) => {
  // Pasar al siguiente handler si el id no es numérico (ej: 'export-excel')
  if (!/^\d+$/.test(req.params.id)) return next();
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
    primary_position_id, project, emergency_contact_name, emergency_contact_phone,
    nomina_number, address, blood_type, allergies, diseases, children, gender
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
    nomina_number: nomina_number || '',
    address: address || '',
    blood_type: blood_type || '',
    allergies: allergies || '',
    diseases: diseases || '',
    children: children || '',
    gender: gender || '',
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
    'total_vacation_days',
    'nomina_number', 'address', 'blood_type', 'allergies', 'diseases', 'children', 'gender'
  ];

  const emp = { ...db.rhh_employees[idx] };
  const wasActive = emp.status === 'active';
  const numericFields = new Set(['department_id', 'position_id', 'shift_id', 'supervisor_id', 'primary_position_id']);
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const val = req.body[key];
      if (numericFields.has(key)) {
        emp[key] = val !== null && val !== '' ? Number(val) : null;
      } else {
        emp[key] = val;
      }
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

  // Limpieza al dar de baja: schedule futuro, TE pendientes e incidencias pendientes
  let cleanup = null;
  if (wasActive && req.body.status === 'inactive') {
    const today = new Date().toISOString().slice(0, 10);

    // Cancelar entradas de schedule futuras
    const schedBefore = (db.rhh_schedule || []).length;
    db.rhh_schedule = (db.rhh_schedule || []).filter(s => !(s.employee_id === emp.id && s.date > today));
    const schedCancelled = schedBefore - db.rhh_schedule.length;

    // Rechazar postulaciones TE pendientes
    let teAppsCancelled = 0;
    (db.rhh_te_applications || []).forEach(app => {
      if (app.employee_id === emp.id && app.status === 'applied') {
        app.status = 'rejected';
        app.notes = (app.notes ? app.notes + ' | ' : '') + 'Cancelado: empleado dado de baja';
        app.updated_at = new Date().toISOString();
        teAppsCancelled++;
      }
    });

    // Rechazar incidencias pendientes del empleado
    let incPending = 0;
    (db.rhh_incidences || []).forEach(i => {
      if (i.employee_id === emp.id && i.status === 'pendiente') {
        i.status = 'rechazada';
        i.rejection_reason = 'Empleado dado de baja';
        i.updated_at = new Date().toISOString();
        incPending++;
      }
    });

    if (schedCancelled > 0 || teAppsCancelled > 0 || incPending > 0) {
      cleanup = { schedule_cancelled: schedCancelled, te_apps_cancelled: teAppsCancelled, pending_incidences_rejected: incPending };
    }
  }

  write(db);

  const response = { ok: true, employee: enrichEmployee(emp, db), vacancy_created };
  if (vacancy_created) response.vacancy = vacancy;
  if (cleanup) response.cleanup = cleanup;
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
  if (!(db.rhh_employees || []).find(e => e.id === empId)) {
    return res.status(404).json({ error: 'Empleado no encontrado' });
  }
  if (req.rhhUser.role === 'empleado' && empId !== req.rhhUser.employee_id) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  const balance = calcVacBalance(db, empId, year);
  res.json(balance);
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

// ── Exportar base de datos como XLSX ──────────────────────────────────────────

// GET /api/rhh/employees/export-excel
router.get('/export-excel', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const XLSX = require('xlsx');
  const db = read();

  function fmtDate(str) {
    if (!str) return '';
    const d = new Date(str + 'T12:00:00');
    if (isNaN(d)) return str;
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function calcAge(birthStr) {
    if (!birthStr) return '';
    const b = new Date(birthStr);
    const today = new Date();
    let age = today.getFullYear() - b.getFullYear();
    if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--;
    return age;
  }

  const HDR_BASE = ['#','No. Nomina','NOMBRE DEL EMPLEADO','Departamento/Proyecto','AREA','Puesto','Turno',
    'Fecha de ingreso','Fecha de ingreso real','S.D','RFC','CURP','NSS','Telefono','Dirección',
    'Contacto de emergencia','Tel de emergencia','Cumpleaños','','Edad','Sexo','Tipo Sangre',
    'Alergias','Enfermedades','Hijos','Correo electronico','Vacaciones',''];

  const HDR_BAJAS = ['#','No.Nomina','NOMBRE DEL EMPLEADO','Área','Puesto','Turno',
    'Fecha de ingreso','Fecha de ingreso real','S.D','RFC','CURP','NSS','Telefono','Dirección',
    'Contacto de emergencia','Tel de emergencia','Cumpleaños','','Edad','Sexo','Tipo Sangre',
    'Alergias','Enfermedades','Hijos','Correo electronico','','',''];

  const HDR_CORREOS = ['#','No. Nomina','NOMBRE DEL EMPLEADO','Puesto','Área Real',
    'Area por Proyecto','S.D. ACTUAL','S.D. NUEVO','Correo electronico'];

  function toBaseRow(emp, idx) {
    const dept  = (db.rhh_departments||[]).find(d=>d.id===emp.department_id);
    const pos   = (db.rhh_positions||[]).find(p=>p.id===emp.position_id);
    const shift = (db.rhh_shifts||[]).find(s=>s.id===emp.shift_id);
    return [String(idx+1).padStart(3,'0'), emp.nomina_number||'', emp.full_name||'',
      emp.project||'', dept?dept.name:'', pos?pos.name:'', shift?(shift.code||shift.name):'',
      fmtDate(emp.hire_date||emp.start_date), fmtDate(emp.start_date||emp.hire_date),
      emp.daily_salary||'', emp.rfc||'', emp.curp||'', emp.nss||'', emp.phone||'',
      emp.address||'', emp.emergency_contact_name||'', emp.emergency_contact_phone||'',
      fmtDate(emp.birth_date), '', calcAge(emp.birth_date),
      emp.gender||'', emp.blood_type||'', emp.allergies||'', emp.diseases||'',
      emp.children||'', emp.email||'', emp.total_vacation_days||15, ''];
  }

  function toBajasRow(emp, idx) {
    const dept  = (db.rhh_departments||[]).find(d=>d.id===emp.department_id);
    const pos   = (db.rhh_positions||[]).find(p=>p.id===emp.position_id);
    const shift = (db.rhh_shifts||[]).find(s=>s.id===emp.shift_id);
    return [String(idx+1).padStart(3,'0'), emp.nomina_number||'', emp.full_name||'',
      dept?dept.name:'', pos?pos.name:'', shift?(shift.code||shift.name):'',
      fmtDate(emp.hire_date||emp.start_date), fmtDate(emp.start_date||emp.hire_date),
      emp.daily_salary||'', emp.rfc||'', emp.curp||'', emp.nss||'', emp.phone||'',
      emp.address||'', emp.emergency_contact_name||'', emp.emergency_contact_phone||'',
      fmtDate(emp.birth_date), '', calcAge(emp.birth_date),
      emp.gender||'', emp.blood_type||'', emp.allergies||'', emp.diseases||'',
      emp.children||'', emp.email||'', emp.termination_date?fmtDate(emp.termination_date):'', '', ''];
  }

  const activos = (db.rhh_employees||[]).filter(e=>e.status==='active');
  const bajas   = (db.rhh_employees||[]).filter(e=>e.status==='inactive');
  const todos   = (db.rhh_employees||[]).filter(e=>e.status!=='deleted');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR_BASE,  ...activos.map(toBaseRow)]),  'Base de datos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR_BAJAS, ...bajas.map(toBajasRow)]),   'BAJAS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR_CORREOS, ...todos.map((emp, idx) => {
    const pos  = (db.rhh_positions||[]).find(p=>p.id===emp.position_id);
    const dept = (db.rhh_departments||[]).find(d=>d.id===emp.department_id);
    return [String(idx+1).padStart(3,'0'), emp.nomina_number||'', emp.full_name||'',
      pos?pos.name:'', dept?dept.name:'', emp.project||'',
      emp.daily_salary||'', emp.daily_salary||'', emp.email||''];
  })]), 'correos actualizados');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fecha = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="BASE_DE_DATOS_COLABORADORES_${fecha}.xlsx"`);
  res.send(buf);
});

// ── Importar base de datos desde XLSX (preview + commit) ──────────────────────

// POST /api/rhh/employees/import-excel
router.post('/import-excel', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const XLSX = require('xlsx');
  const { file_base64, mode = 'preview', truly_new = [], to_resolve = [], resolutions = {} } = req.body || {};

  // ── Helpers compartidos ──
  function xlsxDate(val) {
    if (!val && val !== 0) return null;
    if (typeof val === 'number') {
      const d = new Date((val - 25569) * 86400 * 1000);
      return d.toISOString().slice(0, 10);
    }
    if (typeof val === 'string') {
      const m = val.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return val.trim();
    }
    return null;
  }

  function parseSheet(ws) {
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let hi = 0;
    for (let i = 0; i < Math.min(raw.length, 5); i++) {
      if (raw[i].some(c => String(c).toUpperCase().includes('NOMBRE'))) { hi = i; break; }
    }
    return raw.slice(hi + 1)
      .filter(r => r[2] && String(r[2]).trim())
      .map(r => ({
        nomina_number:           String(r[1]  || '').trim(),
        full_name:               String(r[2]  || '').trim(),
        project:                 String(r[3]  || '').trim(),
        area:                    String(r[4]  || '').trim(),
        position_name:           String(r[5]  || '').trim(),
        shift_code:              String(r[6]  || '').trim(),
        hire_date:               xlsxDate(r[7]),
        start_date:              xlsxDate(r[8]) || xlsxDate(r[7]),
        daily_salary:            r[9]  ? Number(r[9])  : null,
        rfc:                     String(r[10] || '').trim().toUpperCase(),
        curp:                    String(r[11] || '').trim().toUpperCase(),
        nss:                     String(r[12] || '').trim(),
        phone:                   String(r[13] || '').trim(),
        address:                 String(r[14] || '').trim(),
        emergency_contact_name:  String(r[15] || '').trim(),
        emergency_contact_phone: String(r[16] || '').trim(),
        birth_date:              xlsxDate(r[17]),
        gender:                  String(r[20] || '').trim(),
        blood_type:              String(r[21] || '').trim(),
        allergies:               String(r[22] || '').trim(),
        diseases:                String(r[23] || '').trim(),
        children:                String(r[24] || '').trim(),
        email:                   String(r[25] || '').trim().toLowerCase(),
        total_vacation_days:     r[26] ? Number(r[26]) : 15
      }));
  }

  // Similitud de nombres: porcentaje de palabras en común (palabras > 2 letras)
  function nameSim(a, b) {
    const wA = a.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const wB = b.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (!wA.length || !wB.length) return 0;
    let hits = 0;
    for (const w of wA) { if (wB.some(wb => wb.includes(w) || w.includes(wb))) hits++; }
    return hits / Math.max(wA.length, wB.length);
  }

  // ── PREVIEW ──
  if (mode === 'preview') {
    if (!file_base64) return res.status(400).json({ error: 'file_base64 requerido' });
    let rows;
    try {
      const buf = Buffer.from(file_base64, 'base64');
      const wb2 = XLSX.read(buf, { type: 'buffer' });
      const sName = wb2.SheetNames.find(n => n.trim().toLowerCase().startsWith('base de datos')) || wb2.SheetNames[0];
      rows = parseSheet(wb2.Sheets[sName]);
    } catch (e) {
      return res.status(400).json({ error: 'Error al leer archivo: ' + e.message });
    }

    const db = read();
    const existing = (db.rhh_employees || []).filter(e => e.status !== 'deleted');

    const exactDups   = [];   // coincidencia por email/RFC/CURP/NSS
    const similarName = [];   // sin coincidencia exacta pero nombre similar
    const trulyNew    = [];   // sin ninguna coincidencia

    for (const row of rows) {
      // 1. Buscar coincidencias exactas
      const exactMatches = [];
      for (const emp of existing) {
        const reasons = [];
        if (row.email && emp.email && row.email === emp.email.toLowerCase()) reasons.push('correo');
        if (row.rfc  && emp.rfc  && row.rfc  === emp.rfc.toUpperCase())  reasons.push('RFC');
        if (row.curp && emp.curp && row.curp === emp.curp.toUpperCase()) reasons.push('CURP');
        if (row.nss  && emp.nss  && row.nss  === emp.nss)                reasons.push('NSS');
        if (reasons.length) exactMatches.push({ id: emp.id, full_name: emp.full_name, email: emp.email, status: emp.status, reasons });
      }
      if (exactMatches.length) {
        exactDups.push({ incoming: row, matches: exactMatches, match_type: 'exact' });
        continue;
      }

      // 2. Sin coincidencia exacta: buscar por similitud de nombre
      const suggestions = [];
      for (const emp of existing) {
        const score = nameSim(row.full_name, emp.full_name);
        if (score >= 0.35) suggestions.push({ id: emp.id, full_name: emp.full_name, email: emp.email, status: emp.status, score: Math.round(score * 100) });
      }
      suggestions.sort((a, b) => b.score - a.score);

      if (suggestions.length) {
        similarName.push({ incoming: row, suggestions: suggestions.slice(0, 5), match_type: 'name' });
      } else {
        trulyNew.push(row);
      }
    }

    return res.json({
      mode: 'preview',
      exact_duplicates: exactDups,
      similar_name: similarName,
      truly_new: trulyNew,
      total: rows.length
    });
  }

  // ── COMMIT ──
  if (mode === 'commit') {
    const db = read();
    const employees = db.rhh_employees || [];

    function applyRow(row) {
      const dept  = (db.rhh_departments||[]).find(d => d.name?.trim().toLowerCase() === (row.area||'').toLowerCase());
      const pos   = (db.rhh_positions||[]).find(p  => p.name?.trim().toLowerCase() === (row.position_name||'').toLowerCase());
      const shift = (db.rhh_shifts||[]).find(s =>
        s.code?.toLowerCase() === (row.shift_code||'').toLowerCase() ||
        s.name?.toLowerCase() === (row.shift_code||'').toLowerCase()
      );
      return {
        full_name: row.full_name,
        email: row.email || null,
        phone: row.phone || null,
        nomina_number: row.nomina_number || '',
        address: row.address || '',
        blood_type: row.blood_type || '',
        allergies: row.allergies || '',
        diseases: row.diseases || '',
        children: row.children || '',
        gender: row.gender || '',
        department_id: dept ? dept.id : null,
        position_id: pos ? pos.id : null,
        primary_position_id: pos ? pos.id : null,
        enabled_positions: pos ? [pos.id] : [],
        shift_id: shift ? shift.id : null,
        hire_date: row.hire_date || null,
        start_date: row.start_date || row.hire_date || null,
        birth_date: row.birth_date || null,
        daily_salary: row.daily_salary || null,
        rfc: row.rfc || '',
        curp: row.curp || '',
        nss: row.nss || '',
        project: row.project || '',
        emergency_contact_name: row.emergency_contact_name || '',
        emergency_contact_phone: row.emergency_contact_phone || '',
        total_vacation_days: row.total_vacation_days || 15,
        status: 'active'
      };
    }

    let created = 0, updated = 0, skipped = 0;
    const errors = [];

    // Auto-crear los completamente nuevos
    for (const row of truly_new) {
      if (!row.full_name) continue;
      const newId = nextId(employees);
      employees.push({
        id: newId,
        employee_number: 'EMP-' + String(newId).padStart(3, '0'),
        ...applyRow(row),
        contract_type: 'indefinido',
        base_salary: 0,
        checker_number: '',
        supervisor_id: null,
        photo: null,
        created_at: new Date().toISOString()
      });
      created++;
    }

    // Aplicar resoluciones (exactos + similares por nombre — misma lógica)
    for (const item of to_resolve) {
      const key = item.incoming.email || item.incoming.full_name;
      const action = resolutions[key] || 'skip';
      if (action === 'skip') { skipped++; continue; }
      if (action === 'create') {
        const newId = nextId(employees);
        employees.push({
          id: newId,
          employee_number: 'EMP-' + String(newId).padStart(3, '0'),
          ...applyRow(item.incoming),
          contract_type: 'indefinido',
          base_salary: 0,
          checker_number: '',
          supervisor_id: null,
          photo: null,
          created_at: new Date().toISOString()
        });
        created++;
      } else if (action && action.startsWith('update:')) {
        const targetId = Number(action.split(':')[1]);
        const idx = employees.findIndex(e => e.id === targetId);
        if (idx !== -1) {
          const applied = applyRow(item.incoming);
          employees[idx] = { ...employees[idx], ...applied, updated_at: new Date().toISOString() };
          updated++;
        } else {
          errors.push('Empleado no encontrado: ID ' + targetId);
        }
      }
    }

    db.rhh_employees = employees;
    write(db);
    return res.json({ ok: true, created, updated, skipped, errors });
  }

  return res.status(400).json({ error: 'mode debe ser preview o commit' });
});

module.exports = router;
