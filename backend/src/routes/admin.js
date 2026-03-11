const express = require('express');
const bcrypt = require('bcryptjs');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const router = express.Router();
router.use(authRequired);
router.use(allowRoles('admin'));

router.get('/users', (req, res) => res.json(read().users.map(u => ({ ...u, password_hash: undefined }))));

router.post('/users', (req, res) => {
  const db = read();
  const row = {
    id: nextId(db.users),
    full_name: req.body.full_name,
    email: req.body.email,
    password_hash: bcrypt.hashSync(req.body.password || 'Demo123*', 10),
    role_code: req.body.role_code || 'cliente_requisicion',
    supplier_id: req.body.supplier_id ? Number(req.body.supplier_id) : null,
    default_cost_center_id: req.body.default_cost_center_id ? Number(req.body.default_cost_center_id) : null,
    department: req.body.department || 'GENERAL',
    active: req.body.active !== false
  };
  if (!row.full_name || !row.email) return res.status(400).json({ error: 'Nombre y correo requeridos' });
  if (row.role_code === 'proveedor' && !row.supplier_id) {
    return res.status(400).json({ error: 'Los usuarios de tipo proveedor deben tener un proveedor asignado' });
  }
  db.users.push(row);
  write(db);
  res.status(201).json({ ...row, password_hash: undefined });
});

router.patch('/users/:id', (req, res) => {
  const db = read();
  const u = db.users.find(x => x.id === Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (req.body.full_name !== undefined) u.full_name = req.body.full_name;
  if (req.body.email !== undefined) u.email = req.body.email;
  if (req.body.role_code !== undefined) u.role_code = req.body.role_code;
  if (req.body.supplier_id !== undefined) u.supplier_id = req.body.supplier_id ? Number(req.body.supplier_id) : null;
  if (req.body.default_cost_center_id !== undefined) u.default_cost_center_id = req.body.default_cost_center_id ? Number(req.body.default_cost_center_id) : null;
  if (req.body.department !== undefined) u.department = req.body.department;
  if (req.body.active !== undefined) u.active = req.body.active;
  if (req.body.password) u.password_hash = bcrypt.hashSync(req.body.password, 10);
  if (u.role_code === 'proveedor' && !u.supplier_id) {
    return res.status(400).json({ error: 'Los usuarios de tipo proveedor deben tener un proveedor asignado' });
  }
  write(db);
  res.json({ ...u, password_hash: undefined });
});

// Crear proveedor + usuario proveedor en una sola operación
router.post('/suppliers-with-user', (req, res) => {
  const db = read();
  if (!req.body.business_name) return res.status(400).json({ error: 'Nombre del proveedor requerido' });
  if (!req.body.user_email) return res.status(400).json({ error: 'Correo del usuario proveedor requerido' });
  if (!req.body.user_full_name) return res.status(400).json({ error: 'Nombre del usuario proveedor requerido' });

  // Crear proveedor
  const supplier = {
    id: nextId(db.suppliers),
    provider_code: req.body.provider_code || req.body.business_name.substring(0, 3).toUpperCase() + '-' + String(nextId(db.suppliers)).padStart(3, '0'),
    business_name: req.body.business_name,
    contact_name: req.body.contact_name || req.body.user_full_name,
    email: req.body.email || req.body.user_email,
    phone: req.body.phone || '',
    rfc: req.body.rfc || '',
    address: req.body.address || '',
    active: true,
    created_at: new Date().toISOString()
  };
  db.suppliers.push(supplier);

  // Crear usuario proveedor principal
  const user = {
    id: nextId(db.users),
    full_name: req.body.user_full_name,
    email: req.body.user_email,
    password_hash: bcrypt.hashSync(req.body.user_password || 'Demo123*', 10),
    role_code: 'proveedor',
    supplier_id: supplier.id,
    department: 'EXTERNO',
    active: true,
    created_at: new Date().toISOString()
  };
  db.users.push(user);

  write(db);
  res.status(201).json({
    supplier,
    user: { ...user, password_hash: undefined },
    message: `Proveedor "${supplier.business_name}" creado con usuario "${user.email}"`
  });
});

module.exports = router;
