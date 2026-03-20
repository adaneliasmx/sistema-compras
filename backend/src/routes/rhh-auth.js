const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read, write } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// POST /api/rhh/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const db = read();
  const user = (db.rhh_users || []).find(
    u => u.email?.toLowerCase() === String(email).toLowerCase() && u.active
  );
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

  const ok = bcrypt.compareSync(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign(
    { sub: user.id, role: user.role, employee_id: user.employee_id },
    process.env.JWT_SECRET || 'cambia-esta-clave',
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      employee_id: user.employee_id || null
    }
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
