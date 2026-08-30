const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { read } = require('../db');
const { mantAuthRequired } = require('../middleware/mant-auth');
const JWT_SECRET = require('../jwt-secret');
const { createRateLimiter } = require('../rate-limit');
const _rl = createRateLimiter();
const router = express.Router();

// POST /api/mant/auth/login
router.post('/login', (req, res) => {
  const { email, user_id, password } = req.body || {};
  if (typeof password !== 'string' || (!email && !user_id)) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  if (email && typeof email !== 'string') return res.status(400).json({ error: 'Credenciales inválidas' });
  const rlKey = `mant|${user_id || email}|${_rl.getIp(req)}`;
  const lim = _rl.check(rlKey);
  if (lim.blocked) return res.status(429).json({ error: `Demasiados intentos. Intenta en ${lim.wait} min.` });
  const db = read();
  const user = db.users.find(u => {
    if (!u.active) return false;
    if (user_id) return u.id === Number(user_id);
    return u.email && u.email.toLowerCase() === String(email).toLowerCase();
  });
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    _rl.recordFail(rlKey);
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!user.mant_role) {
    return res.status(403).json({ error: 'Tu cuenta no tiene acceso al módulo de Mantenimiento.' });
  }
  const token = jwt.sign(
    { sub: user.id, module: 'mantenimiento', role: user.mant_role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({
    token,
    user: { id: user.id, full_name: user.full_name, email: user.email, mant_role: user.mant_role }
  });
});

// GET /api/mant/auth/usuarios — lista pública para dropdown de login
router.get('/usuarios', (req, res) => {
  const db = read();
  const users = (db.users || [])
    .filter(u => u.active !== false && u.mant_role)
    .map(u => ({ id: u.id, nombre: u.full_name }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  res.json(users);
});

// GET /api/mant/auth/me
router.get('/me', mantAuthRequired, (req, res) => res.json(req.mantUser));

// POST /api/mant/auth/verify-tecnico — verifica credenciales de técnico para firma de cierre
// (usado desde producción para validar sin crear sesión)
const _verifyAttempts = new Map();
router.post('/verify-tecnico', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
    return res.status(400).json({ error: 'Credenciales requeridas' });
  // Rate limit: 5 intentos por IP cada 15 min
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim();
  const now = Date.now();
  const att = _verifyAttempts.get(ip) || { count: 0, resetAt: now + 900000 };
  if (now > att.resetAt) { att.count = 0; att.resetAt = now + 900000; }
  if (att.count >= 5) return res.status(429).json({ error: 'Demasiados intentos. Intenta en unos minutos.' });
  const db = read();
  const user = db.users.find(u => u.email?.toLowerCase() === email.toLowerCase() && u.active);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    att.count++; _verifyAttempts.set(ip, att);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  if (!user.mant_role || !['tecnico_mant', 'admin', 'superadmin_mant'].includes(user.mant_role)) {
    return res.status(403).json({ error: 'El usuario no tiene rol de técnico de mantenimiento' });
  }
  _verifyAttempts.delete(ip);
  res.json({ ok: true, user_id: user.id, full_name: user.full_name, mant_role: user.mant_role });
});

module.exports = router;
