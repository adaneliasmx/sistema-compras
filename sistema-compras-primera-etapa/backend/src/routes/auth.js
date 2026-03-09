const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = read();
  const user = db.users.find(u => u.email === email && u.active);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = jwt.sign({ sub: user.id, role: user.role_code }, process.env.JWT_SECRET || 'cambia-esta-clave', { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, name: user.full_name, email: user.email, role: user.role_code, department: user.department } });
});

router.get('/me', authRequired, (req, res) => res.json(req.user));
module.exports = router;
