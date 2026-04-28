const jwt = require('jsonwebtoken');
const { read } = require('../db-inventarios');

function invAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module !== 'inventarios') return res.status(401).json({ error: 'Token no válido para este módulo' });
    const db = read();
    const user = (db.usuarios_inv || []).find(u => u.id === payload.sub && u.activo !== false);
    if (!user) return res.status(401).json({ error: 'Usuario inválido' });
    req.invUser = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      role: user.role,
      permisos_inv: user.permisos_inv || []
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function invAllowRoles(...roles) {
  return (req, res, next) => {
    if (!req.invUser) return res.status(401).json({ error: 'No autenticado' });
    if (req.invUser.role === 'admin') return next();
    if (roles.includes(req.invUser.role)) return next();
    return res.status(403).json({ error: 'Permisos insuficientes' });
  };
}

// Verifica que el usuario tenga acceso a un inv_type concreto
// admin: siempre sí; inventarios: si inv_type está en permisos_inv; otros roles: siempre sí (comprador/recepcion ven todo)
function invCanAccessType(inv_type) {
  return (req, res, next) => {
    if (!req.invUser) return res.status(401).json({ error: 'No autenticado' });
    const { role, permisos_inv } = req.invUser;
    if (role === 'admin' || role === 'recepcion' || role === 'comprador') return next();
    if (role === 'inventarios' && (permisos_inv || []).includes(inv_type)) return next();
    return res.status(403).json({ error: 'Sin acceso a este inventario' });
  };
}

module.exports = { invAuthRequired, invAllowRoles, invCanAccessType };
