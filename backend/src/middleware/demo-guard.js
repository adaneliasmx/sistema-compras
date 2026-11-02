/**
 * demo-guard.js — Middleware de seguridad para rol "muestra"
 *
 * Capas de protección:
 *  1. Bloquea TODAS las escrituras (POST/PUT/PATCH/DELETE) excepto login/logout
 *  2. Bloquea endpoints de exportación/descarga de datos
 *  3. Bloquea acceso a super-admin, terminal, admin de usuarios
 *  4. Enmascara datos sensibles en respuestas GET
 *  5. Registra auditoría de toda acción del usuario muestra
 */

const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../jwt-secret');

// ── Constantes ────────────────────────────────────────────────────────────────

// Rutas de login/logout (permitidas siempre, incluso POST)
const AUTH_WHITELIST = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/vales/auth/login',
  '/api/rhh/auth/login',
  '/api/produccion/auth/login',
  '/api/mant/auth/login',
  '/api/inv/auth/login',
  '/api/val/auth/login',
  '/api/flujo/auth/login',
  '/api/empleados/auth/login',
];

// Rutas 100% bloqueadas (ni GET) para usuario muestra
const BLOCKED_PATHS = [
  '/api/super-admin',         // todo super-admin
  '/api/admin/users',         // gestión de usuarios
  '/api/auth/change-password',
  '/api/auth/request-reset',
  '/api/auth/reset-password',
  '/api/auth/verify-password',
];

// Patrones de export/download a bloquear
const EXPORT_PATTERNS = [
  '/export', '/download', '/csv', '/xlsx', '/backup',
  '/migration', '/import', '/reseed',
];

// Campos sensibles a enmascarar en respuestas JSON
const SENSITIVE_FIELDS = new Set([
  'email', 'correo', 'phone', 'telefono', 'tel',
  'rfc', 'curp', 'nss', 'imss',
  'salary', 'salario', 'base_salary', 'daily_salary', 'sueldo',
  'sueldo_diario', 'sueldo_mensual', 'monto', 'amount',
  'total', 'subtotal', 'unit_cost', 'unit_price', 'precio',
  'precio_unitario', 'precio_total', 'costo', 'cost',
  'password', 'password_hash', 'token', 'secret',
  'emergency_contact_phone', 'emergency_contact_name',
  'birth_date', 'fecha_nacimiento',
  'address', 'direccion',
  'bank_account', 'cuenta_bancaria', 'clabe',
  'bank', 'banco',
]);

// Campos que son IDs/nombres y NO deben enmascararse
const SAFE_FIELDS = new Set([
  'id', 'name', 'nombre', 'full_name', 'folio', 'status', 'estatus',
  'role', 'role_code', 'department', 'active', 'activo',
  'created_at', 'updated_at', 'date', 'fecha',
  'ok', 'error', 'message', 'count', 'total_count',
  'module', 'label', 'icon', 'url', 'description',
  'tipo', 'type', 'category', 'categoria', 'linea',
  'turno', 'shift', 'semana', 'week', 'month', 'mes',
  'year', 'anio', 'periodo',
]);

// ── Audit log en memoria (últimas 500 acciones) ──────────────────────────────
const _auditLog = [];
const AUDIT_MAX = 500;

function logDemoAction(userId, userName, method, path, blocked, detail) {
  const entry = {
    ts: new Date().toLocaleString('sv', { timeZone: 'America/Mexico_City' }),
    user_id: userId,
    user_name: userName,
    method,
    path,
    blocked,
    detail: detail || null,
  };
  _auditLog.push(entry);
  if (_auditLog.length > AUDIT_MAX) _auditLog.shift();
  // También log a consola para Railway logs
  const icon = blocked ? '[DEMO-BLOCK]' : '[DEMO-LOG]';
  console.log(`${icon} ${entry.ts} | ${userName} (${userId}) | ${method} ${path}${detail ? ' | ' + detail : ''}`);
}

// ── Enmascaramiento de datos sensibles ───────────────────────────────────────

function maskValue(key, value) {
  if (value === null || value === undefined) return value;
  const k = String(key).toLowerCase();

  // Campos monetarios → mostrar "***"
  if (['salary', 'salario', 'base_salary', 'daily_salary', 'sueldo',
       'sueldo_diario', 'sueldo_mensual', 'monto', 'amount',
       'total', 'subtotal', 'unit_cost', 'unit_price', 'precio',
       'precio_unitario', 'precio_total', 'costo', 'cost'].includes(k)) {
    return '***';
  }

  // Emails → a***@***.com
  if (['email', 'correo'].includes(k) && typeof value === 'string' && value.includes('@')) {
    const [local, domain] = value.split('@');
    return local[0] + '***@***.com';
  }

  // Teléfonos → ***-****
  if (['phone', 'telefono', 'tel', 'emergency_contact_phone'].includes(k)) {
    return '***-***-****';
  }

  // RFC, CURP, NSS → primeros 3 chars + ***
  if (['rfc', 'curp', 'nss', 'imss'].includes(k) && typeof value === 'string') {
    return value.length > 3 ? value.slice(0, 3) + '***' : '***';
  }

  // Passwords/tokens → nunca mostrar
  if (['password', 'password_hash', 'token', 'secret', 'hash_prefix'].includes(k)) {
    return '***';
  }

  // Direcciones, bancos, cuentas
  if (['address', 'direccion', 'bank_account', 'cuenta_bancaria', 'clabe', 'bank', 'banco'].includes(k)) {
    return '***';
  }

  // Fecha de nacimiento
  if (['birth_date', 'fecha_nacimiento'].includes(k)) {
    return '****-**-**';
  }

  // Contacto de emergencia
  if (['emergency_contact_name'].includes(k)) {
    return '***';
  }

  return value;
}

function maskObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(item => maskObject(item));
  if (typeof obj !== 'object') return obj;

  const masked = {};
  for (const [key, value] of Object.entries(obj)) {
    const k = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(k)) {
      masked[key] = maskValue(key, value);
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskObject(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ── Extraer info del token JWT (sin requerir auth middleware previo) ──────────

function extractDemoInfo(req) {
  // Primero verificar si auth middleware ya corrió
  if (req.user && req.user.role_code === 'muestra') {
    return { isDemo: true, userId: req.user.id, userName: req.user.full_name || 'demo' };
  }
  if (req._demoChecked) return req._demoInfo || { isDemo: false };

  // Extraer del JWT directamente (para rutas que no usan authRequired)
  let token = null;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7);
  if (!token) {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === 'session') { token = v.join('='); break; }
    }
  }
  if (!token) {
    req._demoChecked = true;
    req._demoInfo = { isDemo: false };
    return req._demoInfo;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const isDemo = payload.role === 'muestra' || payload.role_code === 'muestra';
    req._demoChecked = true;
    req._demoInfo = { isDemo, userId: payload.sub, userName: payload.name || 'demo' };
    return req._demoInfo;
  } catch {
    req._demoChecked = true;
    req._demoInfo = { isDemo: false };
    return req._demoInfo;
  }
}

// ── Middleware principal ──────────────────────────────────────────────────────

function demoGuard(req, res, next) {
  const info = extractDemoInfo(req);
  if (!info.isDemo) return next();

  // Marcar el request como demo para otros middlewares/handlers
  req._isDemo = true;

  const method = req.method.toUpperCase();
  const path = req.path.toLowerCase();

  // 1) Permitir login/logout siempre
  for (const wl of AUTH_WHITELIST) {
    if (path === wl || path.startsWith(wl + '/')) {
      logDemoAction(info.userId, info.userName, method, req.path, false, 'auth-whitelist');
      return next();
    }
  }

  // 2) Bloquear rutas 100% prohibidas (incluso GET)
  for (const bp of BLOCKED_PATHS) {
    if (path === bp || path.startsWith(bp + '/') || path.startsWith(bp)) {
      logDemoAction(info.userId, info.userName, method, req.path, true, 'blocked-path');
      return res.status(403).json({
        error: 'Acceso restringido — cuenta de demostración',
        demo: true
      });
    }
  }

  // 3) Bloquear exports/downloads
  for (const ep of EXPORT_PATTERNS) {
    if (path.includes(ep)) {
      logDemoAction(info.userId, info.userName, method, req.path, true, 'export-blocked');
      return res.status(403).json({
        error: 'Descarga no disponible — cuenta de demostración',
        demo: true
      });
    }
  }

  // 4) Bloquear TODAS las escrituras (POST, PUT, PATCH, DELETE)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    logDemoAction(info.userId, info.userName, method, req.path, true, 'write-blocked');
    return res.status(403).json({
      error: 'Operación no permitida — cuenta de demostración. Los cambios no se guardan.',
      demo: true
    });
  }

  // 5) GET permitido — registrar y enmascarar respuesta
  logDemoAction(info.userId, info.userName, method, req.path, false);

  // Interceptar res.json para enmascarar datos sensibles
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    try {
      const masked = maskObject(data);
      return originalJson(masked);
    } catch {
      return originalJson(data);
    }
  };

  next();
}

// ── Endpoint de auditoría del usuario muestra (solo super-admin) ─────────────

function getDemoAuditLog() {
  return [..._auditLog].reverse();
}

module.exports = { demoGuard, getDemoAuditLog, extractDemoInfo, logDemoAction };
