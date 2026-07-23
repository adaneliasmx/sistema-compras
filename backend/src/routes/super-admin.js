const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read: readCompras, write: writeCompras, nextId: nextIdCompras } = require('../db');
const { read: readRhh, write: writeRhh, nextId: nextIdRhh, forceSeedFromJson } = require('../db-rhh');
const { read: readProduccion, write: writeProduccion, nextId: nextIdProd } = require('../db-produccion');
const { read: readInv, write: writeInv, nextId: nextIdInv } = require('../db-inventarios');
const { read: readVal, write: writeVal, nextId: nextIdVal } = require('../db-validaciones');
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

// ── Utilidad: auto-provisionar usuario en compras desde RHH ──────────────────
function ensureComprasUser(email, comprasDb, rhhDb) {
  const emailLow = (email || '').toLowerCase();
  let user = (comprasDb.users || []).find(u => (u.email || '').toLowerCase() === emailLow);
  if (user) return user;

  // Buscar en rhh_users
  const rhhUser = (rhhDb.rhh_users || []).find(u => (u.email || '').toLowerCase() === emailLow);
  if (!rhhUser) return null;

  comprasDb.users = comprasDb.users || [];
  const newUser = {
    id: nextIdCompras(comprasDb.users),
    full_name: rhhUser.full_name || emailLow,
    email: emailLow,
    password_hash: rhhUser.password_hash || bcrypt.hashSync('0000', 10),
    role_code: 'sin_rol',
    department: '',
    supplier_id: null,
    default_cost_center_id: null,
    default_sub_cost_center_id: null,
    active: true,
    vales_role: null,
    produccion_role: null,
    mant_role: null,
    created_at: new Date().toISOString()
  };
  comprasDb.users.push(newUser);
  return newUser;
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
      compras: { id: cu.id, role: cu.role_code, active: cu.active !== false, vales_role: cu.vales_role || null, produccion_role: cu.produccion_role || null, mant_role: cu.mant_role || null },
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
    {
      id: 'calidad', name: 'Registros de Calidad', icon: '📋', status: 'active', url: '/vales',
      users: (compras.users || []).filter(u => u.vales_role).map(u => ({ id: u.id, name: u.full_name, email: u.email, role: u.vales_role, active: u.active !== false })),
      total_users: (compras.users || []).filter(u => u.vales_role).length
    },
    {
      id: 'produccion', name: 'Registros de Producción', icon: '🏭', status: 'active', url: '/produccion',
      users: (compras.users || []).filter(u => u.produccion_role).map(u => ({ id: u.id, name: u.full_name, email: u.email, role: u.produccion_role, active: u.active !== false })),
      total_users: (compras.users || []).filter(u => u.produccion_role).length
    },
    {
      id: 'mantenimiento', name: 'Órdenes de Mantenimiento', icon: '🔧', status: 'development', url: null,
      users: (compras.users || []).filter(u => u.mant_role).map(u => ({ id: u.id, name: u.full_name, email: u.email, role: u.mant_role, active: u.active !== false })),
      total_users: (compras.users || []).filter(u => u.mant_role).length
    },
    {
      id: 'validaciones', name: 'Validaciones Almacen (SKF/CUESTO)', icon: '📦', status: 'active', url: '/validaciones-almacen',
      users: (() => { try { const v = readVal(); return (v.usuarios_val || []).filter(u => u.activo !== false).map(u => ({ id: u.id, name: u.nombre, email: u.email, role: u.role, active: u.activo !== false })); } catch(_) { return []; } })(),
      total_users: (() => { try { return (readVal().usuarios_val || []).length; } catch(_) { return 0; } })()
    }
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
      supplier_id: null, default_cost_center_id: null, default_sub_cost_center_id: null,
      active: true, vales_role: (req.body.vales_role) || null,
      produccion_role: req.body.produccion_role || null, mant_role: req.body.mant_role || null
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

  const updated = [];
  if (compras_user_id && Number(compras_user_id) > 0) {
    const db = readCompras();
    const u = (db.users || []).find(u => u.id === Number(compras_user_id));
    if (u) { u.password_hash = hash; u.updated_at = now; writeCompras(db); updated.push('compras'); }
  }
  if (rhh_user_id && Number(rhh_user_id) > 0) {
    const db = readRhh();
    const u = (db.rhh_users || []).find(u => u.id === Number(rhh_user_id));
    if (u) { u.password_hash = hash; u.updated_at = now; writeRhh(db); updated.push('rhh'); }
  }
  if (updated.length === 0) return res.status(404).json({ error: 'No se encontró ningún usuario con los IDs proporcionados' });
  res.json({ ok: true, message: `Contraseña actualizada en: ${updated.join(', ')}` });
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

// PATCH /api/super-admin/unified-users/vales-role — asignar rol Calidad
router.patch('/unified-users/vales-role', superAdminRequired, (req, res) => {
  const { user_id, email, vales_role } = req.body || {};
  if (vales_role && !['admin', 'operador', 'consulta'].includes(vales_role))
    return res.status(400).json({ error: 'Rol inválido. Use: admin, operador, consulta o null' });
  const db = readCompras();
  const rhhDb = readRhh();
  let user = email
    ? ensureComprasUser(email, db, rhhDb)
    : (db.users || []).find(u => u.id === Number(user_id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user.vales_role = vales_role || null;
  writeCompras(db);
  res.json({ ok: true });
});

// GET /api/super-admin/export-accesos — descargar base de accesos como JSON
router.get('/export-accesos', superAdminRequired, (req, res) => {
  const list = buildUnifiedList();
  const all = [...list.internal, ...list.external];
  const exported = all.map(u => ({
    full_name:      u.full_name,
    email:          u.email,
    compras_role:   u.compras?.role   || null,
    compras_active: u.compras?.active !== false,
    vales_role:     u.compras?.vales_role || null,
    rhh_role:       u.rhh?.role       || null,
    rhh_active:     u.rhh?.active     !== false
  }));
  const json = JSON.stringify({ exported_at: new Date().toISOString(), users: exported }, null, 2);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="accesos-${new Date().toISOString().slice(0,10)}.json"`);
  res.send(json);
});

// POST /api/super-admin/import-accesos — cargar base de accesos desde JSON
router.post('/import-accesos', superAdminRequired, (req, res) => {
  const users = req.body.users || req.body;
  if (!Array.isArray(users) || users.length === 0)
    return res.status(400).json({ error: 'Se esperaba un array de usuarios' });

  const comprasDb = readCompras();
  const rhhDb = readRhh();
  const results = { created_compras: 0, updated_compras: 0, created_rhh: 0, updated_rhh: 0 };

  for (const u of users) {
    if (!u.email) continue;
    const emailLow = u.email.toLowerCase();

    if (u.compras_role) {
      const existing = (comprasDb.users || []).find(x => x.email?.toLowerCase() === emailLow);
      if (existing) {
        existing.role_code = u.compras_role;
        if (typeof u.compras_active === 'boolean') existing.active = u.compras_active;
        if (u.vales_role !== undefined) existing.vales_role = u.vales_role || null;
        results.updated_compras++;
      } else {
        comprasDb.users = comprasDb.users || [];
        comprasDb.users.push({
          id: nextIdCompras(comprasDb.users), full_name: u.full_name || emailLow,
          email: emailLow, password_hash: bcrypt.hashSync('0000', 10),
          role_code: u.compras_role, department: '', supplier_id: null,
          default_cost_center_id: null, default_sub_cost_center_id: null,
          active: u.compras_active !== false, vales_role: u.vales_role || null
        });
        results.created_compras++;
      }
    }

    if (u.rhh_role) {
      const existingRhh = (rhhDb.rhh_users || []).find(x => x.email?.toLowerCase() === emailLow);
      if (existingRhh) {
        existingRhh.role = u.rhh_role;
        if (typeof u.rhh_active === 'boolean') existingRhh.active = u.rhh_active;
        results.updated_rhh++;
      } else {
        const employees = rhhDb.rhh_employees || [];
        const empId = nextIdRhh(employees);
        const today = new Date().toISOString().slice(0, 10);
        employees.push({
          id: empId, employee_number: 'EMP-' + String(empId).padStart(3, '0'),
          full_name: u.full_name || emailLow, email: emailLow, phone: null,
          department_id: null, position_id: null, shift_id: u.rhh_role === 'empleado' ? 1 : 4,
          supervisor_id: null, start_date: today, hire_date: today, birth_date: null,
          status: 'active', contract_type: 'indefinido', base_salary: 0, daily_salary: null,
          rfc: '', curp: '', nss: '', checker_number: '', primary_position_id: null,
          enabled_positions: [], project: '', emergency_contact_name: '',
          emergency_contact_phone: '', total_vacation_days: 15, photo: null,
          created_at: new Date().toISOString()
        });
        rhhDb.rhh_employees = employees;
        rhhDb.rhh_users = rhhDb.rhh_users || [];
        rhhDb.rhh_users.push({
          id: nextIdRhh(rhhDb.rhh_users), full_name: u.full_name || emailLow,
          email: emailLow, password_hash: bcrypt.hashSync('0000', 10),
          role: u.rhh_role, employee_id: empId, active: u.rhh_active !== false,
          created_at: new Date().toISOString()
        });
        results.created_rhh++;
      }
    }
  }

  writeCompras(comprasDb);
  writeRhh(rhhDb);
  res.json({ ok: true, results });
});

// ── Validaciones Almacen users ────────────────────────────────────────────────

// GET /api/super-admin/val-users
router.get('/val-users', superAdminRequired, (req, res) => {
  const db = readVal();
  res.json((db.usuarios_val || []).map(u => ({
    id: u.id, nombre: u.nombre, email: u.email,
    role: u.role, activo: u.activo !== false
  })));
});

// PATCH /api/super-admin/unified-users/val-role
// Asignar/revocar acceso a Validaciones Almacen.
// Crea el usuario en usuarios_val si no existe (reutiliza password hash de compras o rhh).
// Roles validos: admin | viewer | null (null = revocar)
router.patch('/unified-users/val-role', superAdminRequired, (req, res) => {
  const { email, val_role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email requerido' });
  const validRoles = ['admin', 'viewer'];
  if (val_role && !validRoles.includes(val_role))
    return res.status(400).json({ error: 'Rol invalido. Use: admin, viewer o null' });

  const emailLow = email.toLowerCase();
  const valDb = readVal();
  valDb.usuarios_val = valDb.usuarios_val || [];

  if (!val_role) {
    const u = valDb.usuarios_val.find(u => u.email === emailLow);
    if (u) { u.activo = false; writeVal(valDb); }
    return res.json({ ok: true });
  }

  // Obtener password hash del usuario en compras o rhh
  let passwordHash = bcrypt.hashSync('0000', 10);
  let nombre = emailLow;
  const comprasDb = readCompras();
  const rhhDb = readRhh();
  const comprasUser = (comprasDb.users || []).find(u => (u.email || '').toLowerCase() === emailLow);
  const rhhUser = (rhhDb.rhh_users || []).find(u => (u.email || '').toLowerCase() === emailLow);
  if (comprasUser) { passwordHash = comprasUser.password_hash; nombre = comprasUser.full_name; }
  else if (rhhUser) { passwordHash = rhhUser.password_hash; nombre = rhhUser.full_name; }

  const existing = valDb.usuarios_val.find(u => u.email === emailLow);
  if (existing) {
    existing.role = val_role;
    existing.activo = true;
    writeVal(valDb);
    return res.json({ ok: true });
  }

  const newUser = {
    id: nextIdVal(valDb.usuarios_val),
    nombre, email: emailLow,
    password_hash: passwordHash,
    role: val_role,
    activo: true,
    created_at: new Date().toISOString()
  };
  valDb.usuarios_val.push(newUser);
  writeVal(valDb);
  res.json({ ok: true, created: true, id: newUser.id });
});

// PATCH /api/super-admin/val-users/password
router.patch('/val-users/password', superAdminRequired, (req, res) => {
  const { email, new_password } = req.body || {};
  if (!email || !new_password || new_password.length < 4)
    return res.status(400).json({ error: 'email y contrasena (min 4 chars) requeridos' });
  const db = readVal();
  const user = (db.usuarios_val || []).find(u => u.email === email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado en Validaciones' });
  user.password_hash = bcrypt.hashSync(String(new_password), 10);
  writeVal(db);
  res.json({ ok: true });
});

// PATCH /api/super-admin/unified-users/mant-role
router.patch('/unified-users/mant-role', superAdminRequired, (req, res) => {
  const { user_id, email, mant_role } = req.body || {};
  if (mant_role && !['supervisor_mant', 'tecnico_mant', 'admin', 'superadmin_mant'].includes(mant_role))
    return res.status(400).json({ error: 'Rol inválido. Use: supervisor_mant, tecnico_mant, admin o null' });
  const db = readCompras();
  const rhhDb = readRhh();
  let user = email
    ? ensureComprasUser(email, db, rhhDb)
    : (db.users || []).find(u => u.id === Number(user_id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user.mant_role = mant_role || null;
  writeCompras(db);
  res.json({ ok: true });
});

// PATCH /api/super-admin/unified-users/produccion-role
router.patch('/unified-users/produccion-role', superAdminRequired, (req, res) => {
  const { user_id, email, produccion_role } = req.body || {};
  if (produccion_role && !['pizarron', 'produccion', 'admin'].includes(produccion_role))
    return res.status(400).json({ error: 'Rol inválido. Use: pizarron, produccion, admin o null' });
  const db = readCompras();
  const rhhDb = readRhh();
  let user = email
    ? ensureComprasUser(email, db, rhhDb)
    : (db.users || []).find(u => u.id === Number(user_id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user.produccion_role = produccion_role || null;
  writeCompras(db);
  res.json({ ok: true });
});

// GET /api/super-admin/produccion/operadores/:linea
router.get('/produccion/operadores/:linea', superAdminRequired, (req, res) => {
  const db = readProduccion();
  const key = `operadores_${req.params.linea.toLowerCase()}`;
  const ops = (db[key] || []).map(({ pin_hash, ...o }) => o);
  res.json(ops);
});

// POST /api/super-admin/produccion/operadores/:linea
router.post('/produccion/operadores/:linea', superAdminRequired, (req, res) => {
  const bcrypt = require('bcryptjs');
  const { nombre, pin } = req.body || {};
  if (!nombre || !pin) return res.status(400).json({ error: 'Nombre y PIN requeridos' });
  const db = readProduccion();
  const key = `operadores_${req.params.linea.toLowerCase()}`;
  db[key] = db[key] || [];
  const op = { id: nextIdProd(db[key]), nombre, pin_hash: bcrypt.hashSync(String(pin), 10), activo: true, created_at: new Date().toISOString() };
  db[key].push(op);
  writeProduccion(db);
  const { pin_hash, ...safe } = op;
  res.status(201).json(safe);
});

// PATCH /api/super-admin/produccion/operadores/:linea/:id
router.patch('/produccion/operadores/:linea/:id', superAdminRequired, (req, res) => {
  const bcrypt = require('bcryptjs');
  const db = readProduccion();
  const key = `operadores_${req.params.linea.toLowerCase()}`;
  const op = (db[key] || []).find(o => o.id === Number(req.params.id));
  if (!op) return res.status(404).json({ error: 'Operador no encontrado' });
  if (req.body.nombre !== undefined) op.nombre = req.body.nombre;
  if (req.body.pin) op.pin_hash = bcrypt.hashSync(String(req.body.pin), 10);
  if (typeof req.body.activo === 'boolean') op.activo = req.body.activo;
  writeProduccion(db);
  const { pin_hash, ...safe } = op;
  res.json(safe);
});

// ── Inventarios users ─────────────────────────────────────────────────────────

// GET /api/super-admin/inv-users — lista todos los usuarios_inv
router.get('/inv-users', superAdminRequired, (req, res) => {
  const db = readInv();
  const users = (db.usuarios_inv || []).map(u => ({
    id: u.id, nombre: u.nombre, email: u.email,
    role: u.role, permisos_inv: u.permisos_inv || [], activo: u.activo !== false
  }));
  res.json(users);
});

// PATCH /api/super-admin/unified-users/inv-role — asignar/revocar rol en Inventarios
// Crea el usuario en usuarios_inv si no existe (usando password hash de compras o rhh)
// Si inv_role es null/'' desactiva al usuario en inventarios
router.patch('/unified-users/inv-role', superAdminRequired, (req, res) => {
  const { email, inv_role, permisos_inv } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email requerido' });
  const validRoles = ['admin', 'inventarios', 'recepcion', 'comprador'];
  if (inv_role && !validRoles.includes(inv_role))
    return res.status(400).json({ error: 'Rol inválido. Use: admin, inventarios, recepcion, comprador o null' });

  const emailLow = email.toLowerCase();
  const invDb = readInv();
  invDb.usuarios_inv = invDb.usuarios_inv || [];

  if (!inv_role) {
    // Revocar: desactivar si existe
    const u = invDb.usuarios_inv.find(u => u.email === emailLow);
    if (u) { u.activo = false; writeInv(invDb); }
    return res.json({ ok: true });
  }

  // Obtener password hash del usuario en compras o rhh
  let passwordHash = bcrypt.hashSync('0000', 10);
  let nombre = emailLow;
  const comprasDb = readCompras();
  const rhhDb = readRhh();
  const comprasUser = (comprasDb.users || []).find(u => (u.email || '').toLowerCase() === emailLow);
  const rhhUser = (rhhDb.rhh_users || []).find(u => (u.email || '').toLowerCase() === emailLow);
  if (comprasUser) { passwordHash = comprasUser.password_hash; nombre = comprasUser.full_name; }
  else if (rhhUser) { passwordHash = rhhUser.password_hash; nombre = rhhUser.full_name; }

  const existing = invDb.usuarios_inv.find(u => u.email === emailLow);
  if (existing) {
    existing.role = inv_role;
    existing.activo = true;
    if (inv_role === 'inventarios' && permisos_inv !== undefined) existing.permisos_inv = permisos_inv || [];
    if (inv_role !== 'inventarios') existing.permisos_inv = [];
    writeInv(invDb);
    return res.json({ ok: true });
  }

  // Crear nuevo
  const newUser = {
    id: nextIdInv(invDb.usuarios_inv),
    nombre, email: emailLow,
    password_hash: passwordHash,
    role: inv_role,
    permisos_inv: inv_role === 'inventarios' ? (permisos_inv || []) : [],
    activo: true,
    created_at: new Date().toISOString()
  };
  invDb.usuarios_inv.push(newUser);
  writeInv(invDb);
  res.json({ ok: true, created: true, id: newUser.id });
});

// PATCH /api/super-admin/inv-users/:id/permisos — actualizar permisos_inv
router.patch('/inv-users/:id/permisos', superAdminRequired, (req, res) => {
  const id = Number(req.params.id);
  const { permisos_inv } = req.body || {};
  const db = readInv();
  const user = (db.usuarios_inv || []).find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado en Inventarios' });
  user.permisos_inv = Array.isArray(permisos_inv) ? permisos_inv : [];
  writeInv(db);
  res.json({ ok: true });
});

// PATCH /api/super-admin/inv-users/password — resetear contraseña de usuario inventarios
router.patch('/inv-users/password', superAdminRequired, (req, res) => {
  const { email, new_password } = req.body || {};
  if (!email || !new_password || new_password.length < 4)
    return res.status(400).json({ error: 'email y contraseña (min 4 chars) requeridos' });
  const db = readInv();
  const user = (db.usuarios_inv || []).find(u => u.email === email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado en Inventarios' });
  user.password_hash = bcrypt.hashSync(String(new_password), 10);
  writeInv(db);
  res.json({ ok: true });
});

// POST /api/super-admin/rhh-reseed
// ── Detectar y unificar usuarios duplicados ───────────────────────────────────
router.get('/detect-duplicates', superAdminRequired, (req, res) => {
  const comprasDb = readCompras();
  const rhhDb = readRhh();

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function sim(a, b) {
    const wA = norm(a).split(/\s+/).filter(w => w.length > 2);
    const wB = norm(b).split(/\s+/).filter(w => w.length > 2);
    if (!wA.length || !wB.length) return 0;
    let hAB = 0; for (const w of wA) { if (wB.some(wb => wb.includes(w) || w.includes(wb))) hAB++; }
    let hBA = 0; for (const w of wB) { if (wA.some(wa => wa.includes(w) || w.includes(wa))) hBA++; }
    return Math.max(hAB / wA.length, hBA / wB.length);
  }

  // Enriquecer con datos del empleado RHH (por email)
  function getRhhEmp(email) {
    const ru = (rhhDb.rhh_users || []).find(u => u.email && norm(u.email) === norm(email || ''));
    if (!ru?.employee_id) return null;
    return (rhhDb.rhh_employees || []).find(e => e.id === ru.employee_id) || null;
  }

  function enrichUser(u, isCompras) {
    const emp = getRhhEmp(u.email);
    return {
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: isCompras ? u.role_code : u.role,
      employee_id: u.employee_id || emp?.id || null,
      rhh_emp_name: emp?.full_name || null,
      rhh_emp_dept: emp?.department || null,
      rhh_emp_position: emp?.position || null,
      active: u.active !== false
    };
  }

  function findPairs(users, module) {
    const pairs = [];
    const isCompras = module === 'compras';
    const active = users.filter(u => u.active !== false && !u.merged_into);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (norm(a.email) === norm(b.email)) continue;
        const s = sim(a.full_name, b.full_name);
        if (s >= 0.55) {
          pairs.push({
            module,
            similarity: Math.round(s * 100),
            a: enrichUser(a, isCompras),
            b: enrichUser(b, isCompras)
          });
        }
      }
    }
    return pairs.sort((x, y) => y.similarity - x.similarity);
  }

  const comprasPairs = findPairs(comprasDb.users || [], 'compras');
  const rhhPairs = findPairs(rhhDb.rhh_users || [], 'rhh');
  res.json([...comprasPairs, ...rhhPairs]);
});

router.post('/merge-users', superAdminRequired, (req, res) => {
  // keep_id = cuenta dueña del login_email elegido
  // remove_id = cuenta que se desactiva (datos históricos intactos)
  const { module, keep_id, remove_id, login_email } = req.body || {};
  if (!module || !keep_id || !remove_id || !login_email) {
    return res.status(400).json({ error: 'module, keep_id, remove_id y login_email requeridos' });
  }
  const emailLow = login_email.trim().toLowerCase();

  // Buscar nombre del empleado en RHH para cualquiera de los dos correos
  function getRhhName(emailA, emailB) {
    const rhhDb = readRhh();
    const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    for (const email of [emailA, emailB]) {
      const ru = (rhhDb.rhh_users||[]).find(u => norm(u.email) === norm(email||''));
      if (ru?.employee_id) {
        const emp = (rhhDb.rhh_employees||[]).find(e => e.id === ru.employee_id);
        if (emp) return { name: emp.full_name, dept: emp.department || null, emp_id: emp.id };
      }
    }
    return null;
  }

  if (module === 'compras') {
    const db = readCompras();
    const keeper = (db.users || []).find(u => u.id === Number(keep_id));
    const removed = (db.users || []).find(u => u.id === Number(remove_id));
    if (!keeper || !removed) return res.status(404).json({ error: 'Usuario no encontrado' });

    const conflict = (db.users||[]).find(u => u.id !== Number(keep_id) && u.id !== Number(remove_id) && u.email?.toLowerCase() === emailLow);
    if (conflict) return res.status(409).json({ error: 'Ese correo ya está en uso por otro usuario' });

    // Nombre e info vienen de RHH; solo se conserva el login de compras
    const rhhInfo = getRhhName(keeper.email, removed.email);
    if (rhhInfo) {
      keeper.full_name = rhhInfo.name;
      if (rhhInfo.dept) keeper.department = rhhInfo.dept;
    }
    keeper.email = emailLow;
    keeper.active = true;
    keeper.updated_at = new Date().toISOString();

    removed.active = false;
    removed.merged_into = Number(keep_id);
    removed.updated_at = new Date().toISOString();

    writeCompras(db);
    return res.json({ ok: true, kept: keeper.id, removed: removed.id, rhh_name_applied: !!rhhInfo });
  }

  if (module === 'rhh') {
    const db = readRhh();
    const keeper = (db.rhh_users||[]).find(u => u.id === Number(keep_id));
    const removed = (db.rhh_users||[]).find(u => u.id === Number(remove_id));
    if (!keeper || !removed) return res.status(404).json({ error: 'Usuario no encontrado' });

    const conflict = (db.rhh_users||[]).find(u => u.id !== Number(keep_id) && u.id !== Number(remove_id) && u.email?.toLowerCase() === emailLow);
    if (conflict) return res.status(409).json({ error: 'Ese correo ya está en uso por otro usuario' });

    // Transferir employee_id al keeper si no tiene
    if (!keeper.employee_id && removed.employee_id) keeper.employee_id = removed.employee_id;

    // Nombre desde rhh_employees (fuente de verdad)
    const empId = keeper.employee_id;
    const emp = empId ? (db.rhh_employees||[]).find(e => e.id === empId) : null;
    if (emp) keeper.full_name = emp.full_name;

    keeper.email = emailLow;
    keeper.active = true;
    keeper.updated_at = new Date().toISOString();

    removed.active = false;
    removed.merged_into = Number(keep_id);
    removed.updated_at = new Date().toISOString();

    writeRhh(db);
    return res.json({ ok: true, kept: keeper.id, removed: removed.id, rhh_name_applied: !!emp });
  }

  res.status(400).json({ error: 'Módulo no soportado: compras | rhh' });
});

// ── Vincular empleados RHH existentes a módulos ───────────────────────────────
function _nSA(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function _simSA(a, b) {
  const wA = _nSA(a).split(/\s+/).filter(w => w.length > 2);
  const wB = _nSA(b).split(/\s+/).filter(w => w.length > 2);
  if (!wA.length || !wB.length) return 0;
  let hAB = 0; for (const w of wA) { if (wB.some(wb => wb.includes(w) || w.includes(wb))) hAB++; }
  let hBA = 0; for (const w of wB) { if (wA.some(wa => wa.includes(w) || w.includes(wa))) hBA++; }
  return Math.max(hAB / wA.length, hBA / wB.length);
}

router.get('/rhh-employees-preview', superAdminRequired, (req, res) => {
  const comprasDb = readCompras();
  const rhhDb = readRhh();
  const employees = (rhhDb.rhh_employees || []).filter(e => e.active !== false && e.status !== 'baja');
  const comprasUsers = comprasDb.users || [];

  const result = employees.map(emp => {
    const byEmail = comprasUsers.find(u => u.email && emp.email && _nSA(u.email) === _nSA(emp.email));
    const byName = !byEmail ? comprasUsers.find(u => _simSA(u.full_name, emp.full_name) >= 0.6) : null;
    const comprasMatch = byEmail || byName;
    const rhhUser = (rhhDb.rhh_users || []).find(u => u.employee_id === emp.id);
    return {
      emp_id: emp.id,
      full_name: emp.full_name,
      emp_email: emp.email || '',
      department: emp.department || '',
      has_rhh_user: !!rhhUser,
      rhh_user_id: rhhUser?.id || null,
      rhh_login_email: rhhUser?.email || '',
      has_compras_user: !!comprasMatch,
      compras_user_id: comprasMatch?.id || null,
      compras_user_email: comprasMatch?.email || '',
      match_type: byEmail ? 'email' : byName ? 'nombre' : null
    };
  });

  result.sort((a, b) => {
    if (a.has_compras_user !== b.has_compras_user) return a.has_compras_user ? 1 : -1;
    if (a.has_rhh_user !== b.has_rhh_user) return a.has_rhh_user ? 1 : -1;
    return a.full_name.localeCompare(b.full_name);
  });

  res.json(result);
});

router.post('/rhh-employees-sync', superAdminRequired, (req, res) => {
  const { selections } = req.body || {};
  if (!Array.isArray(selections) || !selections.length) {
    return res.status(400).json({ error: 'Se requiere "selections" array' });
  }
  const comprasDb = readCompras();
  const rhhDb = readRhh();
  let createdCompras = 0, createdRhh = 0, skipped = 0;
  const errors = [];

  for (const sel of selections) {
    const { emp_id, chosen_email, create_compras, create_rhh } = sel;
    const emp = (rhhDb.rhh_employees || []).find(e => e.id === emp_id);
    if (!emp) { errors.push(`Empleado ID ${emp_id} no encontrado`); continue; }
    const email = (chosen_email || emp.email || '').trim().toLowerCase();
    if (!email) { errors.push(`${emp.full_name}: sin correo`); skipped++; continue; }

    if (create_compras) {
      const exists = (comprasDb.users || []).find(u => _nSA(u.email) === _nSA(email));
      if (!exists) {
        if (!comprasDb.users) comprasDb.users = [];
        comprasDb.users.push({
          id: nextIdCompras(comprasDb.users),
          full_name: emp.full_name,
          email,
          password_hash: bcrypt.hashSync('Demo123*', 10),
          role_code: 'cliente_requisicion',
          department: emp.department || 'GENERAL',
          active: true,
          created_at: new Date().toISOString()
        });
        createdCompras++;
      }
    }

    if (create_rhh) {
      const exists = (rhhDb.rhh_users || []).find(u => u.employee_id === emp_id);
      if (!exists) {
        if (!rhhDb.rhh_users) rhhDb.rhh_users = [];
        rhhDb.rhh_users.push({
          id: nextIdRhh(rhhDb.rhh_users),
          full_name: emp.full_name,
          email,
          password_hash: bcrypt.hashSync('Demo123*', 10),
          role: 'empleado',
          employee_id: emp_id,
          active: true,
          created_at: new Date().toISOString()
        });
        createdRhh++;
      }
    }
  }

  writeCompras(comprasDb);
  writeRhh(rhhDb);
  res.json({ ok: true, createdCompras, createdRhh, skipped, errors });
});

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
