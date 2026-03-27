const jwt = require('jsonwebtoken');
const { read } = require('../db-rhh');

function rhhAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module && payload.module !== 'rhh') return res.status(401).json({ error: 'Token no válido para este módulo' });
    const db = read();
    const user = (db.rhh_users || []).find(u => u.id === payload.sub && u.active);
    if (!user) return res.status(401).json({ error: 'Usuario inválido' });
    req.rhhUser = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      employee_id: user.employee_id || null
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Middleware factory: verifica que el rol esté en la lista permitida
function rhhRequireRole(...roles) {
  return (req, res, next) => {
    if (!req.rhhUser) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.rhhUser.role)) {
      return res.status(403).json({ error: 'Acceso no autorizado para este rol' });
    }
    next();
  };
}

module.exports = { rhhAuthRequired, rhhRequireRole };
