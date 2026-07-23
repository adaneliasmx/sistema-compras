const jwt = require('jsonwebtoken');
const { read } = require('../db-validaciones');

function valAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module !== 'validaciones') return res.status(401).json({ error: 'Token no valido para este modulo' });
    const db = read();
    const user = (db.usuarios_val || []).find(u => u.id === payload.sub && u.activo !== false);
    if (!user) return res.status(401).json({ error: 'Usuario invalido' });
    req.valUser = { id: user.id, nombre: user.nombre, email: user.email, role: user.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

function valAllowRoles(...roles) {
  return (req, res, next) => {
    if (!req.valUser) return res.status(401).json({ error: 'No autenticado' });
    if (req.valUser.role === 'admin') return next();
    if (roles.includes(req.valUser.role)) return next();
    return res.status(403).json({ error: 'Permisos insuficientes' });
  };
}

// Middleware para el sync de la app Python (API key)
function syncKeyRequired(req, res, next) {
  const key = req.headers['x-sync-key'] || '';
  const expected = process.env.VAL_SYNC_API_KEY || '';
  if (!expected) return res.status(503).json({ error: 'Sync no configurado en servidor' });
  if (key !== expected) return res.status(401).json({ error: 'API key invalido' });
  next();
}

module.exports = { valAuthRequired, valAllowRoles, syncKeyRequired };
