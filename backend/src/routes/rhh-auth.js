const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read, write } = require('../db-rhh');
const { read: readCompras } = require('../db');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// POST /api/rhh/auth/login
// Busca primero en rhh_users; si no existe o la contraseña no coincide,
// verifica credenciales del módulo compras como fallback.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
    return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const emailLow = String(email).toLowerCase().trim();
  const db = read();
  const comprasDb = readCompras();

  // Usuario vinculado de compras (mismo correo)
  const comprasUser = (comprasDb.users || []).find(
    u => u.email?.toLowerCase() === emailLow && u.active !== false
  );

  // 1. Buscar en rhh_users
  const rhhUser = (db.rhh_users || []).find(u => u.email?.toLowerCase() === emailLow && u.active !== false);
  if (rhhUser) {
    // Verificar con contraseña RHH
    let ok = bcrypt.compareSync(String(password), rhhUser.password_hash);
    // Fallback: si el usuario también existe en compras, aceptar esa contraseña
    // (útil cuando super-admin asigna rol RHH a usuario ya existente en otros módulos)
    if (!ok && comprasUser) {
      ok = bcrypt.compareSync(String(password), comprasUser.password_hash);
    }
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign(
      { sub: rhhUser.id, module: 'rhh', role: rhhUser.role, employee_id: rhhUser.employee_id },
      process.env.JWT_SECRET || 'cambia-esta-clave',
      { expiresIn: '8h' }
    );
    return res.json({
      token,
      user: { id: rhhUser.id, full_name: rhhUser.full_name, email: rhhUser.email, role: rhhUser.role, employee_id: rhhUser.employee_id || null }
    });
  }

  // 2. Fallback: usuario de compras con rol admin/super_admin (acceso total a RHH)
  if (!comprasUser) return res.status(401).json({ error: 'Credenciales inválidas' });
  if (comprasUser.role_code !== 'admin' && comprasUser.role_code !== 'super_admin') {
    return res.status(403).json({ error: 'No tienes acceso al módulo RHH. Solicita que te asignen un rol.' });
  }
  const ok = bcrypt.compareSync(String(password), comprasUser.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign(
    { sub: `compras_${comprasUser.id}`, module: 'rhh', role: 'admin', employee_id: null },
    process.env.JWT_SECRET || 'cambia-esta-clave',
    { expiresIn: '8h' }
  );
  return res.json({
    token,
    user: { id: `compras_${comprasUser.id}`, full_name: comprasUser.full_name, email: comprasUser.email, role: 'admin', employee_id: null }
  });
});

// GET /api/rhh/auth/me
router.get('/me', rhhAuthRequired, (req, res) => {
  const db = read();
  const user = req.rhhUser;
  // Enriquecer con datos del empleado si tiene
  let employee = null;
  if (user.employee_id) {
    employee = (db.rhh_employees || []).find(e => e.id === user.employee_id) || null;
  }
  res.json({ ...user, employee });
});

// PATCH /api/rhh/auth/users/:id/email — cambiar correo de login (admin/rh only)
router.patch('/users/:id/email', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Correo inválido' });
  const db = read();
  const user = (db.rhh_users || []).find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const dup = (db.rhh_users || []).find(u => u.id !== user.id && u.email?.toLowerCase() === email.trim().toLowerCase());
  if (dup) return res.status(409).json({ error: 'Ese correo ya está en uso por otro usuario' });
  user.email = email.trim().toLowerCase();
  user.updated_at = new Date().toISOString();
  write(db);
  res.json({ ok: true, email: user.email });
});

// PATCH /api/rhh/auth/users/:id/reset-password — admin/rh only
router.patch('/users/:id/reset-password', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || String(new_password).length < 4) {
    return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres' });
  }
  const db = read();
  const user = (db.rhh_users || []).find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  user.password_hash = bcrypt.hashSync(String(new_password), 10);
  user.updated_at = new Date().toISOString();
  write(db);
  res.json({ ok: true, message: 'Contraseña restablecida' });
});

// POST /api/rhh/auth/change-password
router.post('/change-password', rhhAuthRequired, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  const db = read();
  const user = (db.rhh_users || []).find(u => u.id === req.rhhUser.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const ok = bcrypt.compareSync(String(current_password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  user.password_hash = bcrypt.hashSync(String(new_password), 10);
  user.updated_at = new Date().toISOString();
  write(db);

  res.json({ ok: true, message: 'Contraseña actualizada exitosamente' });
});

module.exports = router;
