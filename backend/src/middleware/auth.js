const jwt = require('jsonwebtoken');
const { read } = require('../db');

function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cambia-esta-clave');
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
