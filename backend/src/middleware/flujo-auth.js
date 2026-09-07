const jwt = require('jsonwebtoken');
const { read } = require('../db-flujo');
const JWT_SECRET = require('../jwt-secret');

function flujoAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.module !== 'flujo') return res.status(401).json({ error: 'Token no valido para este modulo' });
    const db = read();
    const user = (db.usuarios_flujo || []).find(u => u.id === payload.sub && u.activo !== false);
    if (!user) return res.status(401).json({ error: 'Usuario invalido' });
    req.flujoUser = { id: user.id, nombre: user.nombre, email: user.email, role: user.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

function flujoAllowRoles(...roles) {
  return (req, res, next) => {
    if (!req.flujoUser) return res.status(401).json({ error: 'No autenticado' });
    if (req.flujoUser.role === 'admin') return next();
    if (roles.includes(req.flujoUser.role)) return next();
    return res.status(403).json({ error: 'Permisos insuficientes' });
  };
}

function flujoSyncKeyRequired(req, res, next) {
  const key = req.headers['x-sync-key'] || '';
  const expected = process.env.FLUJO_SYNC_API_KEY || '';
  if (!expected) return res.status(503).json({ error: 'Sync no configurado en servidor' });
  if (key !== expected) return res.status(401).json({ error: 'API key invalido' });
  next();
}

module.exports = { flujoAuthRequired, flujoAllowRoles, flujoSyncKeyRequired };
