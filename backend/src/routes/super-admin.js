const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read: readCompras, write: writeCompras, nextId: nextIdCompras } = require('../db');
const { read: readRhh, write: writeRhh, nextId: nextIdRhh, forceSeedFromJson } = require('../db-rhh');
const router = express.Router();

const SUPER_ADMIN_EMAIL = 'aelias@cuesto.com.mx';
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esta-clave';

// ── Middleware ────────────────────────────────────────────────────────────────
function superAdminRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Sin autorización' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'super_admin') return res.status(403).json({ error: 'Acceso denegado' });
    req.superAdmin = payload;
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

// ── Utilidad: lista unificada ─────────────────────────────────────────────────
function buildUnifiedList() {
  const comprasDb = readCompras();
  const rhhDb = readRhh();

  const comprasUsers = comprasDb.users || [];
  const rhhUsers = rhhDb.rhh_users || [];
  const rhhEmps = rhhDb.rhh_employees || [];

  // Lookup RHH employee → RHH user
  const rhhUserByEmpId = {};
  for (const u of rhhUsers) {
    if (u.employee_id) rhhUserByEmpId[u.employee_id] = u;
  }

  // Lookup by compras_email field on RHH employee
  const rhhEmpByComprasEmail = {};
  for (const emp of rhhEmps) {
    if (emp.compras_email) rhhEmpByComprasEmail[emp.compras_email.toLowerCase()] = emp;
  }

  const unified = [];
  const usedRhhIds = new Set();

  for (const cu of comprasUsers) {
    const emailLow = (cu.email || '').toLowerCase();

    // Match RHH user by same email OR via compras_email link
    let rhhUser = rhhUsers.find(u => (u.email || '').toLowerCase() === emailLow);
    if (!rhhUser) {
      const linkedEmp = rhhEmpByComprasEmail[emailLow];
      if (linkedEmp) rhhUser = rhhUserByEmpId[linkedEmp.id];
    }
    if (rhhUser) usedRhhIds.add(rhhUser.id);

    unified.push({
      key: emailLow,
      full_name: cu.full_name,
      email: cu.email,
      compras: { id: cu.id, role: cu.role_code, active: cu.active !== false },
      rhh: rhhUser ? { id: rhhUser.id, role: rhhUser.role, active: rhhUser.active !== false } : null,
      is_external: cu.role_code === 'proveedor'
    });
  }

  // RHH-only users
  for (const ru of rhhUsers) {
    if (usedRhhIds.has(ru.id)) continue;
    unified.push({
      key: (ru.email || '').toLowerCase(),
      full_name: ru.full_name,
      email: ru.email,
      compras: null,
      rhh: { id: ru.id, role: ru.role, active: ru.active !== false },
      is_external: false
    });
  }

  return {
    internal: unified.filter(u => !u.is_external),
    external: unified.filter(u => u.is_external)
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (String(email || '').toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase())
    return res.status(401).json({ error: 'Credenciales inválidas' });

  const db = readCompras();
  const user = db.users?.find(u => u.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() && u.active !== false);
  if (!user) return res.status(401).json({ error: 'Usuario super admin no encontrado.' });

  const ok = bcrypt.compareSync(String(password || ''), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign(
    { sub: user.id, role: 'super_admin', email: user.email, name: user.full_name },
    JWT_SECRET, { expiresIn: '8h' }
  );
  res.json({ token, name: user.full_name, email: user.email });
});

router.get('/me', superAdminRequired, (req, res) => {
  res.json({ email: req.superAdmin.email, name: req.superAdmin.name, role: 'super_admin' });
});

// ── Overview (módulos) ────────────────────────────────────────────────────────
router.get('/overview', superAdminRequired, (req, res) => {
  const compras = readCompras();
  const rhh = readRhh();
  const modules = [
    {
      id: 'compras', name: 'Gestión de Compras', icon: '🛒', status: 'active', url: '/compras',
      users: (compras.users || []).map(u => ({ id: u.id, name: u.full_name, email: u.email, role: u.role_code, active: u.active !== false })),
      total_users: (compras.users || []).length
    },
    {
      id: 'rhh', name: 'Recursos Humanos', icon: '👥', status: 'active', url: '/rhh',
      users: (rhh.rhh_users || []).map(u => ({ id: u.id, name: u.full_name, email: u.email, role: u.role, active: u.active !== false })),
      total_users: (rhh.rhh_users || []).length
    },
    { id: 'calidad', name: 'Registros de Calidad', icon: '📋', status: 'development', url: null, users: [], total_users: 0 },
    { id: 'mantenimiento', name: 'Órdenes de Mantenimiento', icon: '🔧', status: 'development', url: null, users: [], total_users: 0 }
  ];
  res.json({ modules });
});

// ── Usuarios unificados ───────────────────────────────────────────────────────

// GET /api/super-admin/unified-users
router.get('/unified-users', superAdminRequired, (req, res) => {
  res.json(buildUnifiedList());
});

// POST /api/super-admin/unified-users — crear en uno o más módulos
router.post('/unified-users', superAdminRequired, (req, res) => {
  const { full_name, email, password, compras_role, rhh_role } = req.body || {};
  if (!full_name || !email || !password) return res.status(400).json({ error: 'Nombre, correo y contraseña requeridos' });
  if (!compras_role && !rhh_role) return res.status(400).json({ error: 'Selecciona al menos un módulo' });

  const pwdHash = bcrypt.hashSync(String(password), 10);
  const emailLow = email.toLowerCase();
  const results = {};

  if (compras_role) {
    const db = readCompras();
    if ((db.users || []).find(u => u.email?.toLowerCase() === emailLow)) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese correo en Compras' });
    }
    const user = {
      id: nextIdCompras(db.users), full_name, email: emailLow,
      password_hash: pwdHash, role_code: compras_role, department: '',
      supplier_id: null, default_cost_center_id: null, default_sub_cost_center_id: null, active: true
    };
    db.users = [...(db.users || []), user];
    writeCompras(db);
    results.compras = { id: user.id, role: user.role_code };
  }

  if (rhh_role) {
    const db = readRhh();
    if ((db.rhh_users || []).find(u => u.email?.toLowerCase() === emailLow)) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese correo en RHH' });
    }
    const employees = db.rhh_employees || [];
    const empId = nextIdRhh(employees);
    const today = new Date().toISOString().slice(0, 10);
    employees.push({
      id: empId, employee_number: 'EMP-' + String(empId).padStart(3, '0'),
      full_name, email: emailLow, phone: null, department_id: null, position_id: null,
      shift_id: rhh_role === 'empleado' ? 1 : 4, supervisor_id: null,
      start_date: today, hire_date: today, birth_date: null, status: 'active',
      contract_type: 'indefinido', base_salary: 0, daily_salary: null,
      rfc: '', curp: '', nss: '', checker_number: '', primary_position_id: null,
      enabled_positions: [], project: '', emergency_contact_name: '',
      emergency_contact_phone: '', total_vacation_days: 15, photo: null,
      created_at: new Date().toISOString()
    });
    db.rhh_employees = employees;
    const user = {
      id: nextIdRhh(db.rhh_users), full_name, email: emailLow,
      password_hash: pwdHash, role: rhh_role, employee_id: empId,
      active: true, created_at: new Date().toISOString()
    };
    db.rhh_users = [...(db.rhh_users || []), user];
    writeRhh(db);
    results.rhh = { id: user.id, role: user.role };
  }

  res.status(201).json({ ok: true, results });
});

// PATCH /api/super-admin/unified-users/toggle — activar/desactivar en un módulo
router.patch('/unified-users/toggle', superAdminRequired, (req, res) => {
  const { module, user_id, active } = req.body || {};
  if (module === 'compras') {
    const db = readCompras();
    const u = (db.users || []).find(u => u.id === Number(user_id));
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado en Compras' });
    u.active = active;
    writeCompras(db);
  } else if (module === 'rhh') {
    const db = readRhh();
    const u = (db.rhh_users || []).find(u => u.id === Number(user_id));
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado en RHH' });
    u.active = active;
    writeRhh(db);
  } else {
    return res.status(400).json({ error: 'Módulo inválido' });
  }
  res.json({ ok: true });
});

// PATCH /api/super-admin/unified-users/role — cambiar rol en un módulo
router.patch('/unified-users/role', superAdminRequired, (req, res) => {
  const { module, user_id, role } = req.body || {};
  if (module === 'compras') {
    const db = readCompras();
    const u = (db.users || []).find(u => u.id === Number(user_id));
    if (!u) return res.status(404).json({ error: 'No encontrado' });
    u.role_code = role;
    writeCompras(db);
  } else if (module === 'rhh') {
    const db = readRhh();
    const u = (db.rhh_users || []).find(u => u.id === Number(user_id));
    if (!u) return res.status(404).json({ error: 'No encontrado' });
    u.role = role;
    writeRhh(db);
  } else {
    return res.status(400).json({ error: 'Módulo inválido' });
  }
  res.json({ ok: true });
});

// PATCH /api/super-admin/unified-users/password — resetear contraseña en todos los módulos vinculados
router.patch('/unified-users/password', superAdminRequired, (req, res) => {
  const { compras_user_id, rhh_user_id, new_password } = req.body || {};
  if (!new_password || new_password.length < 4) return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres' });
  const hash = bcrypt.hashSync(String(new_password), 10);
  const now = new Date().toISOString();

  if (compras_user_id) {
    const db = readCompras();
    const u = (db.users || []).find(u => u.id === Number(compras_user_id));
    if (u) { u.password_hash = hash; u.updated_at = now; writeCompras(db); }
  }
  if (rhh_user_id) {
    const db = readRhh();
    const u = (db.rhh_users || []).find(u => u.id === Number(rhh_user_id));
    if (u) { u.password_hash = hash; u.updated_at = now; writeRhh(db); }
  }
  res.json({ ok: true, message: 'Contraseña actualizada' });
});

// POST /api/super-admin/unified-users/add-to-module — añadir usuario existente a un módulo
router.post('/unified-users/add-to-module', superAdminRequired, (req, res) => {
  const { full_name, email, password_hash, module, role } = req.body || {};
  if (!email || !module || !role) return res.status(400).json({ error: 'Email, módulo y rol requeridos' });
  const emailLow = email.toLowerCase();

  if (module === 'compras') {
    const db = readCompras();
    if ((db.users || []).find(u => u.email?.toLowerCase() === emailLow))
      return res.status(400).json({ error: 'Ya existe en Compras' });
    const user = {
      id: nextIdCompras(db.users), full_name, email: emailLow,
      password_hash: password_hash || bcrypt.hashSync('0000', 10),
      role_code: role, department: '', supplier_id: null,
      default_cost_center_id: null, default_sub_cost_center_id: null, active: true
    };
    db.users = [...(db.users || []), user];
    writeCompras(db);
    return res.json({ ok: true, user: { id: user.id } });
  }

  if (module === 'rhh') {
    const db = readRhh();
    if ((db.rhh_users || []).find(u => u.email?.toLowerCase() === emailLow))
      return res.status(400).json({ error: 'Ya existe en RHH' });
    const employees = db.rhh_employees || [];
    const empId = nextIdRhh(employees);
    const today = new Date().toISOString().slice(0, 10);
    employees.push({
      id: empId, employee_number: 'EMP-' + String(empId).padStart(3, '0'),
      full_name, email: emailLow, phone: null, department_id: null, position_id: null,
      shift_id: role === 'empleado' ? 1 : 4, supervisor_id: null,
      start_date: today, hire_date: today, birth_date: null, status: 'active',
      contract_type: 'indefinido', base_salary: 0, daily_salary: null,
      rfc: '', curp: '', nss: '', checker_number: '', primary_position_id: null,
      enabled_positions: [], project: '', emergency_contact_name: '',
      emergency_contact_phone: '', total_vacation_days: 15, photo: null,
      created_at: new Date().toISOString()
    });
    db.rhh_employees = employees;
    const user = {
      id: nextIdRhh(db.rhh_users), full_name, email: emailLow,
      password_hash: password_hash || bcrypt.hashSync('0000', 10),
      role, employee_id: empId, active: true, created_at: new Date().toISOString()
    };
    db.rhh_users = [...(db.rhh_users || []), user];
    writeRhh(db);
    return res.json({ ok: true, user: { id: user.id } });
  }

  res.status(400).json({ error: 'Módulo no soportado' });
});

// PUT /api/super-admin/unified-users/edit — editar nombre/email en un módulo
router.put('/unified-users/edit', superAdminRequired, (req, res) => {
  const { module, user_id, full_name, email } = req.body || {};
  if (!module || !user_id) return res.status(400).json({ error: 'module y user_id requeridos' });
  const emailLow = email ? email.toLowerCase() : null;

  if (module === 'compras') {
    const db = readCompras();
    const user = (db.users || []).find(u => u.id === Number(user_id));
    if (!user) return res.status(404).json({ error: 'No encontrado en Compras' });
    if (full_name) user.full_name = full_name;
    if (emailLow) user.email = emailLow;
    writeCompras(db);
    return res.json({ ok: true });
  }
  if (module === 'rhh') {
    const db = readRhh();
    const user = (db.rhh_users || []).find(u => u.id === Number(user_id));
    if (!user) return res.status(404).json({ error: 'No encontrado en RHH' });
    if (full_name) user.full_name = full_name;
    if (emailLow) user.email = emailLow;
    if (user.employee_id) {
      const emp = (db.rhh_employees || []).find(e => e.id === user.employee_id);
      if (emp) { if (full_name) emp.full_name = full_name; if (emailLow) emp.email = emailLow; }
    }
    writeRhh(db);
    return res.json({ ok: true });
  }
  res.status(400).json({ error: 'Módulo inválido' });
});

// DELETE /api/super-admin/unified-users/remove — eliminar usuario de un módulo
router.delete('/unified-users/remove', superAdminRequired, (req, res) => {
  const { module, user_id } = req.body || {};
  if (!module || !user_id) return res.status(400).json({ error: 'module y user_id requeridos' });

  if (module === 'compras') {
    const db = readCompras();
    const idx = (db.users || []).findIndex(u => u.id === Number(user_id));
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    db.users.splice(idx, 1);
    writeCompras(db);
    return res.json({ ok: true });
  }
  if (module === 'rhh') {
    const db = readRhh();
    const idx = (db.rhh_users || []).findIndex(u => u.id === Number(user_id));
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    db.rhh_users.splice(idx, 1);
    writeRhh(db);
    return res.json({ ok: true });
  }
  res.status(400).json({ error: 'Módulo inválido' });
});

// ── Endpoints legacy (compatibilidad) ─────────────────────────────────────────
router.get('/users/candidates/:module', superAdminRequired, (req, res) => {
  const { module } = req.params;
  const compras = readCompras();
  const rhh = readRhh();
  const comprasEmails = new Set((compras.users || []).map(u => u.email?.toLowerCase()));
  const rhhEmails = new Set((rhh.rhh_users || []).map(u => u.email?.toLowerCase()));
  let candidates = [];
  if (module === 'compras') {
    candidates = (rhh.rhh_users || []).filter(u => !comprasEmails.has(u.email?.toLowerCase()))
      .map(u => ({ name: u.full_name, email: u.email, from: 'RHH', password_hash: u.password_hash }));
  } else if (module === 'rhh') {
    candidates = (compras.users || []).filter(u => !rhhEmails.has(u.email?.toLowerCase()))
      .map(u => ({ name: u.full_name, email: u.email, from: 'Compras', password_hash: u.password_hash }));
  }
  res.json({ candidates });
});

router.patch('/compras/users/:id', superAdminRequired, (req, res) => {
  const db = readCompras();
  const user = (db.users || []).find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (typeof req.body.active === 'boolean') user.active = req.body.active;
  if (req.body.role_code) user.role_code = req.body.role_code;
  writeCompras(db);
  res.json({ ok: true, user });
});

router.post('/compras/users', superAdminRequired, (req, res) => {
  const { full_name, email, password, password_hash, role_code, department } = req.body || {};
  if (!full_name || !email || !role_code) return res.status(400).json({ error: 'Nombre, correo y rol requeridos' });
  if (!password && !password_hash) return res.status(400).json({ error: 'Contraseña requerida' });
  const db = readCompras();
  if ((db.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
  const user = {
    id: nextIdCompras(db.users), full_name, email: email.toLowerCase(),
    password_hash: password_hash || bcrypt.hashSync(String(password), 10),
    role_code, department: department || '', supplier_id: null,
    default_cost_center_id: null, default_sub_cost_center_id: null, active: true
  };
  db.users = [...(db.users || []), user];
  writeCompras(db);
  res.json({ ok: true, user: { id: user.id, name: user.full_name, email: user.email, role: user.role_code } });
});

router.post('/rhh/users', superAdminRequired, (req, res) => {
  const { full_name, email, password, password_hash, role } = req.body || {};
  if (!full_name || !email || !role) return res.status(400).json({ error: 'Nombre, correo y rol requeridos' });
  if (!password && !password_hash) return res.status(400).json({ error: 'Contraseña requerida' });
  const db = readRhh();
  if ((db.rhh_users || []).find(u => u.email?.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ error: 'Ya existe un usuario con ese correo en RHH' });
  const employees = db.rhh_employees || [];
  const empId = nextIdRhh(employees);
  const today = new Date().toISOString().slice(0, 10);
  employees.push({
    id: empId, employee_number: 'EMP-' + String(empId).padStart(3, '0'),
    full_name, email: email.toLowerCase(), phone: null, department_id: null, position_id: null,
    shift_id: role === 'empleado' ? 1 : 4, supervisor_id: null, start_date: today, hire_date: today,
    birth_date: null, status: 'active', contract_type: 'indefinido', base_salary: 0, daily_salary: null,
    rfc: '', curp: '', nss: '', checker_number: '', primary_position_id: null, enabled_positions: [],
    project: '', emergency_contact_name: '', emergency_contact_phone: '',
    total_vacation_days: 15, photo: null, created_at: new Date().toISOString()
  });
  db.rhh_employees = employees;
  const user = {
    id: nextIdRhh(db.rhh_users), full_name, email: email.toLowerCase(),
    password_hash: password_hash || bcrypt.hashSync(String(password), 10),
    role, employee_id: empId, active: true, created_at: new Date().toISOString()
  };
  db.rhh_users = [...(db.rhh_users || []), user];
  writeRhh(db);
  res.json({ ok: true, user: { id: user.id, name: user.full_name, email: user.email, role: user.role } });
});

router.patch('/rhh/users/:id', superAdminRequired, (req, res) => {
  const db = readRhh();
  const user = (db.rhh_users || []).find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (typeof req.body.active === 'boolean') user.active = req.body.active;
  if (req.body.role) user.role = req.body.role;
  writeRhh(db);
  res.json({ ok: true, user });
});

// POST /api/super-admin/rhh-reseed
router.post('/rhh-reseed', superAdminRequired, async (req, res) => {
  try {
    const data = await forceSeedFromJson();
    const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
    res.json({ ok: true, message: 'Base de datos RHH sincronizada desde JSON seed', counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
