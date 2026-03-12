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

// ── Exportar base de datos completa ───────────────────────────────────────────
router.get('/export-db', (req, res) => {
  const db = read();
  // Ocultar hashes de contraseñas por seguridad
  const safe = {
    ...db,
    users: (db.users || []).map(u => ({ ...u, password_hash: undefined }))
  };
  const json = JSON.stringify(safe, null, 2);
  const filename = `backup-db-${new Date().toISOString().slice(0,10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(json);
});

// ── Importar / reemplazar base de datos completa ──────────────────────────────
router.post('/import-db', (req, res) => {
  if (req.body.confirm !== 'IMPORT_CONFIRMAR') {
    return res.status(400).json({ error: 'Debes enviar { confirm: "IMPORT_CONFIRMAR", data: {...} }' });
  }
  const incoming = req.body.data;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Se requiere el campo "data" con el JSON de la base de datos' });
  }
  // Conservar password_hashes de usuarios existentes y mezclar con los importados
  const currentDb = read();
  const merged = { ...currentDb, ...incoming };
  // Re-mapear contraseñas: si el usuario importado no trae hash, conservar el actual
  merged.users = (incoming.users || []).map(u => {
    if (u.password_hash) return u;
    const existing = currentDb.users.find(x => x.id === u.id || x.email === u.email);
    return { ...u, password_hash: existing?.password_hash || bcrypt.hashSync('Demo123*', 10) };
  });
  write(merged);
  res.json({
    ok: true,
    message: `Base de datos importada correctamente. ${merged.users?.length || 0} usuarios, ${merged.suppliers?.length || 0} proveedores, ${merged.catalog_items?.length || 0} ítems de catálogo.`
  });
});

// ── Reset de base de datos de pruebas (conserva catálogos y usuarios) ─────────
// ⚠ SOLO PARA ENTORNOS DE PRUEBA — eliminar antes de producción final
router.post('/reset-db', (req, res) => {
  const db = read();
  if (req.body.confirm !== 'RESET_CONFIRMAR') {
    return res.status(400).json({ error: 'Debes enviar { confirm: "RESET_CONFIRMAR" }' });
  }
  db.requisitions = [];
  db.requisition_items = [];
  db.quotation_requests = [];
  db.quotations = [];
  db.purchase_orders = [];
  db.purchase_order_items = [];
  db.invoices = [];
  db.invoice_items = [];
  db.payments = [];
  db.status_history = [];
  write(db);
  res.json({ ok: true, message: 'Base de datos de transacciones reiniciada. Catálogos, usuarios, proveedores, reglas e inventario conservados.' });
});

module.exports = router;
