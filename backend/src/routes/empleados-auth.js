const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { read, write } = require('../db-rhh');
const { empAuthRequired } = require('../middleware/empleados-auth');

const router = express.Router();
const JWT_SECRET = require('../jwt-secret');
const { createRateLimiter } = require('../rate-limit');
const _rl = createRateLimiter();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// POST /api/empleados/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const rlKey = `emp|${username.toUpperCase()}|${_rl.getIp(req)}`;
  const lim = _rl.check(rlKey);
  if (lim.blocked) return res.status(429).json({ error: `Demasiados intentos. Intenta en ${lim.wait} min.` });

  const db = read();
  const emp = (db.rhh_employees || []).find(e =>
    e.emp_login && e.emp_login.username === String(username).toUpperCase().trim()
  );
  if (!emp || emp.status !== 'active') { _rl.recordFail(rlKey); return res.status(401).json({ error: 'Credenciales inválidas' }); }

  const login = emp.emp_login;

  // Soporte dual: hash bcrypt (después del primer cambio) o texto plano (credencial inicial)
  let ok = false;
  if (login.password_hash) {
    ok = bcrypt.compareSync(password, login.password_hash);
  } else if (login.password) {
    ok = password === String(login.password);
    // Auto-migrar a bcrypt en login exitoso con texto plano
    if (ok) {
      login.password_hash = bcrypt.hashSync(password, 10);
      delete login.password;
      write(db);
    }
  }
  if (!ok) { _rl.recordFail(rlKey); return res.status(401).json({ error: 'Credenciales inválidas' }); }
  _rl.clear(rlKey);

  const token = jwt.sign(
    { sub: emp.id, module: 'empleado', employee_number: emp.employee_number },
    JWT_SECRET,
    { expiresIn: '10h' }
  );

  res.json({
    token,
    must_change: !!login.must_change,
    user: {
      id: emp.id,
      employee_number: emp.employee_number,
      full_name: emp.full_name,
    }
  });
});

// POST /api/empleados/auth/change-password
router.post('/change-password', empAuthRequired, (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const db = read();
  const emp = (db.rhh_employees || []).find(e => e.id === req.empPayload.sub);
  if (!emp || !emp.emp_login) return res.status(404).json({ error: 'Empleado no encontrado' });

  emp.emp_login.password_hash = bcrypt.hashSync(String(new_password), 10);
  delete emp.emp_login.password; // eliminar contraseña inicial en texto plano
  emp.emp_login.must_change = false;
  emp.updated_at = nowMxDate();
  write(db);

  res.json({ ok: true });
});

// GET /api/empleados/auth/me
router.get('/me', empAuthRequired, (req, res) => {
  const db = read();
  const emp = (db.rhh_employees || []).find(e => e.id === req.empPayload.sub);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  res.json({
    id: emp.id,
    employee_number: emp.employee_number,
    full_name: emp.full_name,
    must_change: !!(emp.emp_login && emp.emp_login.must_change),
  });
});

module.exports = router;
