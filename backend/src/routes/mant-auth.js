const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read } = require('../db');
const { mantAuthRequired } = require('../middleware/mant-auth');
const router = express.Router();

// POST /api/mant/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const db = read();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!user.mant_role) {
    return res.status(403).json({ error: 'Tu cuenta no tiene acceso al módulo de Mantenimiento.' });
  }
  const token = jwt.sign(
    { sub: user.id, module: 'mantenimiento', role: user.mant_role },
    process.env.JWT_SECRET || 'cambia-esta-clave',
    { expiresIn: '12h' }
  );
  res.json({
    token,
    user: { id: user.id, full_name: user.full_name, email: user.email, mant_role: user.mant_role }
  });
});

// GET /api/mant/auth/me
router.get('/me', mantAuthRequired, (req, res) => res.json(req.mantUser));

// POST /api/mant/auth/verify-tecnico — verifica credenciales de técnico para firma de cierre
// (usado desde producción para validar sin crear sesión)
router.post('/verify-tecnico', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Credenciales requeridas' });
  const db = read();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  if (!user.mant_role || !['tecnico_mant', 'admin'].includes(user.mant_role)) {
    return res.status(403).json({ error: 'El usuario no tiene rol de técnico de mantenimiento' });
  }
  res.json({ ok: true, user_id: user.id, full_name: user.full_name, mant_role: user.mant_role });
});

module.exports = router;
