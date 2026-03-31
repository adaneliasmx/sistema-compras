const jwt = require('jsonwebtoken');

function produccionAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module !== 'produccion') {
      return res.status(401).json({ error: 'Token no válido para este módulo' });
    }
    req.prodUser = {
      id: payload.sub,
      nombre: payload.nombre,
      role: payload.role,
      linea: payload.linea,
      user_type: payload.user_type
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function produccionAllowRoles(...roles) {
  return (req, res, next) => {
    if (!req.prodUser) return res.status(401).json({ error: 'No autenticado' });
    if (req.prodUser.role === 'admin') return next();
    if (roles.includes(req.prodUser.role)) return next();
    return res.status(403).json({ error: 'Permisos insuficientes' });
  };
}

module.exports = { produccionAuthRequired, produccionAllowRoles };
