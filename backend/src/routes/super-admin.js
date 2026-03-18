const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read: readCompras } = require('../db');
const { read: readRhh } = require('../db-rhh');
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

module.exports = router;
