const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esta-clave';

function empAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.module !== 'empleado') return res.status(403).json({ error: 'Módulo incorrecto' });
    req.empPayload = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión expirada, vuelve a iniciar sesión' });
  }
}

module.exports = { empAuthRequired };
