const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read: readCompras } = require('../db');
const { read: readRhh, forceSeedFromJson } = require('../db-rhh');
const router = express.Router();

const SUPER_ADMIN_EMAIL = 'aelias@cuesto.com.mx';
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esta-clave';

// Middleware super admin
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

// Login super admin — valida contra usuarios de compras con email del super admin
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (String(email || '').toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase())
    return res.status(401).json({ error: 'Credenciales inválidas' });

  // Buscar en DB de compras
  const db = readCompras();
  const user = db.users?.find(u => u.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() && u.active !== false);
  if (!user) return res.status(401).json({ error: 'Usuario super admin no encontrado. Créalo en el módulo Compras.' });

  const ok = bcrypt.compareSync(String(password || ''), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign({ sub: user.id, role: 'super_admin', email: user.email, name: user.full_name }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, name: user.full_name, email: user.email });
});

// Info del super admin logueado
router.get('/me', superAdminRequired, (req, res) => {
  res.json({ email: req.superAdmin.email, name: req.superAdmin.name, role: 'super_admin' });
});

// Resumen de módulos y usuarios
router.get('/overview', superAdminRequired, (req, res) => {
  const compras = readCompras();
  const rhh = readRhh();

  const modules = [
    {
      id: 'compras',
      name: 'Gestión de Compras',
      icon: '🛒',
      status: 'active',
      url: '/compras',
      users: (compras.users || []).filter(u => u.active !== false).map(u => ({
        id: u.id, name: u.full_name, email: u.email, role: u.role_code, active: u.active !== false
      })),
      total_users: (compras.users || []).length
    },
    {
      id: 'rhh',
      name: 'Recursos Humanos',
      icon: '👥',
      status: 'active',
      url: '/rhh',
      users: (rhh.rhh_users || []).filter(u => u.active !== false).map(u => ({
        id: u.id, name: u.full_name, email: u.email, role: u.role, active: u.active !== false
      })),
      total_users: (rhh.rhh_users || []).length
    },
    {
      id: 'calidad',
      name: 'Registros de Calidad',
      icon: '📋',
      status: 'development',
      url: null,
      users: [],
      total_users: 0
    },
    {
      id: 'mantenimiento',
      name: 'Órdenes de Mantenimiento',
      icon: '🔧',
      status: 'development',
      url: null,
      users: [],
      total_users: 0
    }
  ];

  res.json({ modules });
});

// Toggle usuario activo/inactivo en compras
router.patch('/compras/users/:id', superAdminRequired, (req, res) => {
  const db = readCompras();
  const { write } = require('../db');
  const user = db.users?.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (typeof req.body.active === 'boolean') user.active = req.body.active;
  if (req.body.role_code) user.role_code = req.body.role_code;
  write(db);
  res.json({ ok: true, user });
});

// Usuarios de otros módulos que NO están en el módulo indicado
router.get('/users/candidates/:module', superAdminRequired, (req, res) => {
  const { module } = req.params;
  const compras = readCompras();
  const rhh = readRhh();

  const comprasEmails = new Set((compras.users || []).map(u => u.email?.toLowerCase()));
  const rhhEmails    = new Set((rhh.rhh_users || []).map(u => u.email?.toLowerCase()));

  let candidates = [];
  if (module === 'compras') {
    // Usuarios de RHH que aún no están en compras
    candidates = (rhh.rhh_users || [])
      .filter(u => !comprasEmails.has(u.email?.toLowerCase()))
      .map(u => ({ name: u.full_name, email: u.email, from: 'RHH', password_hash: u.password_hash }));
  } else if (module === 'rhh') {
    // Usuarios de compras que aún no están en RHH
    candidates = (compras.users || [])
      .filter(u => !rhhEmails.has(u.email?.toLowerCase()))
      .map(u => ({ name: u.full_name, email: u.email, from: 'Compras', password_hash: u.password_hash }));
  }
  res.json({ candidates });
});

// Crear usuario en compras (nuevo o asignación desde otro módulo)
router.post('/compras/users', superAdminRequired, (req, res) => {
  const { full_name, email, password, password_hash, role_code, department } = req.body || {};
  if (!full_name || !email || !role_code)
    return res.status(400).json({ error: 'Nombre, correo y rol son requeridos' });
  if (!password && !password_hash)
    return res.status(400).json({ error: 'Contraseña requerida' });
  const db = readCompras();
  const { write, nextId } = require('../db');
  if ((db.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ error: 'Ya existe un usuario con ese correo en este módulo' });
  const user = {
    id: nextId(db.users),
    full_name,
    email: email.toLowerCase(),
    password_hash: password_hash || bcrypt.hashSync(String(password), 10),
    role_code,
    department: department || '',
    supplier_id: null,
    default_cost_center_id: null,
    default_sub_cost_center_id: null,
    active: true
  };
  db.users = [...(db.users || []), user];
  write(db);
  res.json({ ok: true, user: { id: user.id, name: user.full_name, email: user.email, role: user.role_code } });
});

// Crear usuario en RHH (nuevo o asignación desde otro módulo)
router.post('/rhh/users', superAdminRequired, (req, res) => {
  const { full_name, email, password, password_hash, role } = req.body || {};
  if (!full_name || !email || !role)
    return res.status(400).json({ error: 'Nombre, correo y rol son requeridos' });
  if (!password && !password_hash)
    return res.status(400).json({ error: 'Contraseña requerida' });
  const db = readRhh();
  const { write, nextId } = require('../db-rhh');
  if ((db.rhh_users || []).find(u => u.email?.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ error: 'Ya existe un usuario con ese correo en este módulo' });

  // Determinar department_id y shift_id según el rol
  // IDs de departamentos: 1=Operaciones, 2=Producción, 3=Calidad, 4=Mantenimiento, 5=Servicios, 6=Administración
  const depts = db.rhh_departments || [];
  const findDept = (name) => {
    const d = depts.find(d => d.name?.toLowerCase().includes(name.toLowerCase()));
    return d ? d.id : null;
  };
  let dept_id, shift_id;
  if (role === 'admin') {
    dept_id = findDept('administra') || 6;
    shift_id = 4; // Administrativo
  } else if (role === 'rh') {
    dept_id = findDept('administra') || 6;
    shift_id = 4;
  } else if (role === 'supervisor') {
    dept_id = findDept('produc') || 2;
    shift_id = 1;
  } else {
    dept_id = findDept('produc') || 2;
    shift_id = 1;
  }

  // Crear el empleado primero para obtener su ID
  const employees = db.rhh_employees || [];
  const empId = nextId(employees);
  const empNum = 'EMP-' + String(empId).padStart(3, '0');
  const today = new Date().toISOString().slice(0, 10);

  const employee = {
    id: empId,
    employee_number: empNum,
    full_name,
    email: email.toLowerCase(),
    phone: null,
    department_id: dept_id,
    position_id: null,
    shift_id,
    supervisor_id: null,
    start_date: today,
    hire_date: today,
    birth_date: null,
    status: 'active',
    contract_type: 'indefinido',
    base_salary: 0,
    daily_salary: null,
    rfc: '',
    curp: '',
    nss: '',
    checker_number: '',
    primary_position_id: null,
    enabled_positions: [],
    project: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    total_vacation_days: 15,
    photo: null,
    created_at: new Date().toISOString()
  };
  employees.push(employee);
  db.rhh_employees = employees;

  // Crear el usuario vinculado al empleado
  const user = {
    id: nextId(db.rhh_users),
    full_name,
    email: email.toLowerCase(),
    password_hash: password_hash || bcrypt.hashSync(String(password), 10),
    role,
    employee_id: empId,
    active: true,
    created_at: new Date().toISOString()
  };
  db.rhh_users = [...(db.rhh_users || []), user];
  write(db);
  res.json({ ok: true, user: { id: user.id, name: user.full_name, email: user.email, role: user.role }, employee_created: true, employee });
});

// Toggle usuario activo/inactivo en rhh
router.patch('/rhh/users/:id', superAdminRequired, (req, res) => {
  const db = readRhh();
  const { write } = require('../db-rhh');
  const user = db.rhh_users?.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (typeof req.body.active === 'boolean') user.active = req.body.active;
  if (req.body.role) user.role = req.body.role;
  write(db);
  res.json({ ok: true, user });
});

// POST /api/super-admin/rhh-reseed — sincroniza el JSON seed al PostgreSQL online
router.post('/rhh-reseed', superAdminRequired, async (req, res) => {
  try {
    const data = await forceSeedFromJson();
    const counts = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
    );
    res.json({ ok: true, message: 'Base de datos RHH sincronizada desde JSON seed', counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
