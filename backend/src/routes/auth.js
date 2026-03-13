const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = read();
  const user = db.users.find(u => u.email?.toLowerCase() === String(email || '').toLowerCase() && u.active);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
  const ok = bcrypt.compareSync(String(password || ''), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = jwt.sign({ sub: user.id, role: user.role_code }, process.env.JWT_SECRET || 'cambia-esta-clave', { expiresIn: '8h' });
  res.json({
    token,
    user: {
      id: user.id,
      name: user.full_name,
      email: user.email,
      role: user.role_code,
      department: user.department,
      supplier_id: user.supplier_id || null,
      default_cost_center_id: user.default_cost_center_id || null,
      default_sub_cost_center_id: user.default_sub_cost_center_id || null,
      allowed_scc_ids: user.allowed_scc_ids || []
    }
  });
});

router.get('/me', authRequired, (req, res) => res.json(req.user));

// ── Solicitar recuperación de contraseña ──────────────────────────────────────
router.post('/request-reset', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Correo requerido' });
  const db = read();
  const user = db.users.find(u => u.email?.toLowerCase() === String(email).toLowerCase() && u.active !== false);
  if (!user) return res.status(404).json({ error: 'No existe un usuario activo con ese correo' });

  if (!db.password_reset_requests) db.password_reset_requests = [];
  // Eliminar solicitudes anteriores del mismo usuario
  db.password_reset_requests = db.password_reset_requests.filter(r => r.user_id !== user.id);

  const request = {
    id: nextId(db.password_reset_requests.concat([{id:0}])),
    user_id: user.id,
    user_email: user.email,
    user_name: user.full_name,
    requested_at: new Date().toISOString(),
    status: 'pending'
  };
  db.password_reset_requests.push(request);
  write(db);

  // mailto al admin
  const admins = db.users.filter(u => u.role_code === 'admin' && u.active !== false);
  const adminEmails = admins.map(a => a.email).join(',') || '';
  const subject = `Solicitud de cambio de contraseña · ${user.full_name}`;
  const body = `Se ha solicitado un cambio de contraseña para:\n\nNombre: ${user.full_name}\nCorreo: ${user.email}\n\nIngresa al panel de Administración para aprobar o rechazar esta solicitud.\n\n(Solicitud #${request.id})`;
  const mailto = `mailto:${encodeURIComponent(adminEmails)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  res.json({ ok: true, mailto, message: 'Solicitud enviada. El administrador recibirá una notificación para autorizar el cambio.' });
});

// ── Aplicar nueva contraseña con token ────────────────────────────────────────
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const db = read();
  if (!db.password_reset_tokens) return res.status(400).json({ error: 'Token inválido o expirado' });

  const tokenRecord = db.password_reset_tokens.find(t => t.token === token && t.status === 'active');
  if (!tokenRecord) return res.status(400).json({ error: 'El enlace no es válido o ya fue utilizado' });

  // Expira en 24 horas
  const ageHours = (Date.now() - new Date(tokenRecord.created_at).getTime()) / 3600000;
  if (ageHours > 24) {
    tokenRecord.status = 'expired';
    write(db);
    return res.status(400).json({ error: 'El enlace ha expirado. Solicita un nuevo cambio de contraseña.' });
  }

  const user = db.users.find(u => u.id === tokenRecord.user_id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  user.password_hash = bcrypt.hashSync(String(password), 10);
  user.updated_at = new Date().toISOString();
  tokenRecord.status = 'used';
  write(db);

  res.json({ ok: true, message: 'Contraseña cambiada exitosamente. Ya puedes iniciar sesión.' });
});

// Verificar contraseña del usuario actual (para confirmación de acciones sensibles)
router.post('/verify-password', authRequired, (req, res) => {
  const db = read();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const ok = bcrypt.compareSync(req.body.password || '', user.password_hash || '');
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ ok: true });
});

module.exports = router;
