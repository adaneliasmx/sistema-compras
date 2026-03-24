const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read, write } = require('../db');
const { valesAuthRequired } = require('../middleware/vales-auth');
const router = express.Router();

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const db = read();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!user.vales_role) {
    return res.status(403).json({ error: 'Tu cuenta no tiene acceso al módulo de Vales. Contacta al administrador.' });
  }
  const token = jwt.sign(
    { sub: user.id, module: 'vales', role: user.vales_role },
    process.env.JWT_SECRET || 'cambia-esta-clave',
    { expiresIn: '8h' }
  );
  res.json({
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      vales_role: user.vales_role
    }
  });
});

// Cambiar contraseña
router.post('/change-password', valesAuthRequired, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
  if (new_password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const db = read();
  const user = db.users.find(u => u.id === req.valesUser.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  }
  user.password_hash = bcrypt.hashSync(new_password, 10);
  write(db);
  res.json({ ok: true });
});

module.exports = router;
