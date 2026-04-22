const jwt = require('jsonwebtoken');
const { read } = require('../db');

function _getCookieToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'session') return v.join('=');
  }
  return null;
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = _getCookieToken(req) || bearerToken;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module && payload.module !== 'compras') return res.status(401).json({ error: 'Token no válido para este módulo' });
    const db = read();
    const user = db.users.find(u => u.id === payload.sub && u.active);
    if (!user) return res.status(401).json({ error: 'Usuario inválido' });
    req.user = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role_code: user.role_code,
      department: user.department,
      supplier_id: user.supplier_id || null
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = { authRequired };
