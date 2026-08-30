// Fuente centralizada de JWT_SECRET — importar desde aquí en vez de repetir fallback
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esta-clave';
module.exports = JWT_SECRET;
