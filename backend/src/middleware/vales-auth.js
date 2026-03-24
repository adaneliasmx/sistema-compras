const jwt = require('jsonwebtoken');
const { read } = require('../db');

function valesAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module !== 'vales') return res.status(401).json({ error: 'Token no válido para este módulo' });
    const db = read();
    const user = db.users.find(u => u.id === payload.sub && u.active);
    if (!user) return res.status(401).json({ error: 'Usuario inválido' });
    if (!user.vales_role) return res.status(403).json({ error: 'Sin acceso al módulo de Vales' });
    req.valesUser = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role_code: user.role_code,
      vales_role: user.vales_role
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function valesAllowRoles(...roles) {
  return (req, res, next) => {
    if (!req.valesUser) return res.status(401).json({ error: 'No autenticado' });
    if (req.valesUser.vales_role === 'admin') return next();
    if (roles.includes(req.valesUser.vales_role)) return next();
    return res.status(403).json({ error: 'Permisos insuficientes' });
  };
}

module.exports = { valesAuthRequired, valesAllowRoles };
