function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.role_code === 'admin') return next();
    // Rol "muestra" pasa como viewer universal (solo lectura) — escrituras bloqueadas por demoGuard
    // EXCEPTO rutas de admin de usuarios (doble protección)
    if (req.user.role_code === 'muestra' && req.method === 'GET') {
      if (roles.length === 1 && roles[0] === 'admin') {
        return res.status(403).json({ error: 'No autorizado — cuenta de demostración' });
      }
      return next();
    }
    if (!roles.includes(req.user.role_code)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
}

module.exports = { allowRoles };
