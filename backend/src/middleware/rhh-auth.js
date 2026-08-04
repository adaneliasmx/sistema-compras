const jwt = require('jsonwebtoken');
const { read } = require('../db-rhh');
const { read: readCompras } = require('../db');

function rhhAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
    if (payload.module && payload.module !== 'rhh') return res.status(401).json({ error: 'Token no válido para este módulo' });

    // Tokens emitidos para admins de compras tienen sub con prefijo "compras_"
    if (typeof payload.sub === 'string' && payload.sub.startsWith('compras_')) {
      const comprasId = Number(payload.sub.replace('compras_', ''));
      const comprasDb = readCompras();
      const cu = (comprasDb.users || []).find(u => u.id === comprasId && u.active !== false);
      if (!cu) return res.status(401).json({ error: 'Usuario inválido' });
      req.rhhUser = { id: payload.sub, full_name: cu.full_name, email: cu.email, role: 'admin', employee_id: null };
      return next();
    }

    const db = read();
    // Comparación numérica explícita (JWT puede devolver sub como string o number)
    const user = (db.rhh_users || []).find(u => Number(u.id) === Number(payload.sub) && u.active !== false);
    if (!user) return res.status(401).json({ error: 'Usuario inválido o inactivo' });
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
