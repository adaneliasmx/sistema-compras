const jwt = require('jsonwebtoken');
const { read } = require('../db');

function mantAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module !== 'mantenimiento') return res.status(401).json({ error: 'Token no válido para este módulo' });
    const db = read();
    const user = db.users.find(u => u.id === payload.sub && u.active);
    if (!user) return res.status(401).json({ error: 'Usuario inválido' });
    if (!user.mant_role) return res.status(403).json({ error: 'Sin acceso al módulo de Mantenimiento' });
    req.mantUser = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      mant_role: user.mant_role
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function mantAllowRoles(...roles) {
  return (req, res, next) => {
    if (!req.mantUser) return res.status(401).json({ error: 'No autenticado' });
    if (req.mantUser.mant_role === 'admin') return next();
    if (roles.includes(req.mantUser.mant_role)) return next();
    return res.status(403).json({ error: 'Permisos insuficientes' });
  };
}

module.exports = { mantAuthRequired, mantAllowRoles };
