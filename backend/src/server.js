const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

// ── Validación de seguridad al arrancar ───────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'cambia-esta-clave') {
  console.error('\n⛔  SEGURIDAD: JWT_SECRET no está configurado o usa el valor por defecto.');
  console.error('    Configura la variable de entorno JWT_SECRET con un valor aleatorio seguro.');
  console.error('    Ejemplo: openssl rand -hex 32\n');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1); // En producción, detiene el servidor
  }
}

// ── Módulo Compras ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const catalogsRoutes = require('./routes/catalogs');
const reqRoutes = require('./routes/requisitions');
const purchasesRoutes = require('./routes/purchases');
const quotationsRoutes = require('./routes/quotations');
const invoicesRoutes = require('./routes/invoices');
const paymentsRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const approvalsRoutes = require('./routes/approvals');
const exportsRoutes = require('./routes/exports');
const notificationsRoutes = require('./routes/notifications');
const auditRoutes = require('./routes/audit');

// ── Super Admin ───────────────────────────────────────────────────────────────
const superAdminRoutes = require('./routes/super-admin');

// ── Módulo Vales de Adición ───────────────────────────────────────────────────
const valesAuthRoutes = require('./routes/vales-auth');
const valesRoutes     = require('./routes/vales');

// ── Módulo RHH ────────────────────────────────────────────────────────────────
const rhhAuthRoutes = require('./routes/rhh-auth');
const rhhEmployeesRoutes = require('./routes/rhh-employees');
const rhhCatalogsRoutes = require('./routes/rhh-catalogs');
const rhhScheduleRoutes = require('./routes/rhh-schedule');
const rhhIncidencesRoutes = require('./routes/rhh-incidences');
const rhhDashboardRoutes = require('./routes/rhh-dashboard');
const rhhVacanciesRoutes = require('./routes/rhh-vacancies');
const rhhEvaluationsRoutes = require('./routes/rhh-evaluations');
const rhhNotificationsRoutes = require('./routes/rhh-notifications');
const rhhChecadorRoutes = require('./routes/rhh-checador');
const rhhNominaRoutes      = require('./routes/rhh-nomina');
const rhhAsistenciaRoutes  = require('./routes/rhh-asistencia');
const rhhCatalogoRoutes    = require('./routes/rhh-catalogo');
const rhhKpiRoutes         = require('./routes/rhh-kpi');

// ── Módulo Empleados (autoservicio) ──────────────────────────────────────────
const empleadosAuthRoutes = require('./routes/empleados-auth');
const empleadosRoutes     = require('./routes/empleados');

// ── Módulo Producción ─────────────────────────────────────────────────────
const produccionRoutes = require('./routes/produccion');

// ── Módulo Inventarios ────────────────────────────────────────────────────────
const inventariosRoutes = require('./routes/inventarios');

// ── Módulo Mantenimiento ──────────────────────────────────────────────────────
const mantAuthRoutes  = require('./routes/mant-auth');
const mantRoutes      = require('./routes/mantenimiento');

// ── Módulo Flujo de Materiales (Tenneco/ASM) ─────────────────────────────────
const flujoRoutes = require('./routes/flujo-materiales');

// ── Módulo Validaciones Almacen (SKF/CUESTO sync) ─────────────────────────────
const validacionesRoutes = require('./routes/validaciones');

// ── Módulo Planner Staff ────────────────────────────────────────────────────
const plannerRoutes = require('./routes/planner');

// ── PO Pública (proveedor) ────────────────────────────────────────────────────
const publicPoRoutes = require('./routes/public-po');

const { initDb } = require('./db');
const { initDb: initRhhDb } = require('./db-rhh');
const { initDb: initValesDb } = require('./db-vales');
const { initDb: initProduccionDb } = require('./db-produccion');
const { initDb: initInventariosDb } = require('./db-inventarios');
const { initDb: initMantDb } = require('./db-mantenimiento');
const { initDb: initValDb } = require('./db-validaciones');
const { initDb: initFlujoDb } = require('./db-flujo');
const { initDb: initPlannerDb } = require('./db-planner');

const app = express();

// ── Confiar en el proxy de Render para X-Forwarded-Proto / IP ─────────────────
app.set('trust proxy', 1);

// ── Redirección Render → Railway (activar con REDIRECT_TARGET en Render) ─────
if (process.env.REDIRECT_TARGET) {
  const target = process.env.REDIRECT_TARGET.replace(/\/$/, '');
  app.use((req, res, next) => {
    // Health check sigue funcionando para que Render no mate el servicio
    if (req.path === '/api/health') return next();
    res.redirect(301, target + req.originalUrl);
  });
}

// ── Seguridad de headers HTTP (helmet) ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.sheetjs.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ── CORS: restringido a orígenes conocidos ────────────────────────────────────
const DEFAULT_ORIGINS = ['https://cuestocompras.onrender.com', 'https://erp-cuesto.com', 'https://www.erp-cuesto.com', 'https://erp-cuesto.up.railway.app'];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
const CORS_ORIGINS = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;
app.use(cors({
  origin: (origin, cb) => {
    // Permitir requests sin origin (server-to-server, curl, mobile apps)
    if (!origin) return cb(null, true);
    if (CORS_ORIGINS.some(o => origin === o || origin.startsWith(o))) return cb(null, true);
    // En desarrollo local, permitir localhost
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: origin no autorizado — ${origin}`));
  },
  credentials: true
}));

app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/storage', express.static(path.resolve(process.cwd(), 'storage')));
app.use(express.static(path.resolve(process.cwd(), 'frontend/public'), {
  index: false,
  maxAge: '1h',
  etag: true
}));

// ── API Health + memoria ──────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  // GC solo si heap > 350 MB (critical) — no en cada health check para no saturar CPU
  const m = process.memoryUsage();
  const mb = v => Math.round(v / 1024 / 1024);
  const heapUsedMB = mb(m.heapUsed);
  if (heapUsedMB > 350 && global.gc) global.gc();
  const rssMB = mb(m.rss);
  const status = heapUsedMB > 350 ? 'critical' : heapUsedMB > 220 ? 'warning' : 'ok';
  res.json({
    ok: true,
    status,
    now: new Date().toISOString(),
    memory: {
      heap_used_mb: heapUsedMB,
      heap_total_mb: mb(m.heapTotal),
      rss_mb: rssMB,
      external_mb: mb(m.external),
    }
  });
});

// ── Middleware: loguear picos de memoria (sampleado 1 de cada 20 requests) ───
let _memSampleCount = 0;
app.use((req, res, next) => {
  if (++_memSampleCount % 20 === 0) {
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (heapMB > 220) {
      console.warn(`[MEM] ${heapMB}MB heap | ${req.method} ${req.path}`);
    }
  }
  next();
});

// ── API Compras ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/catalogs', catalogsRoutes);
app.use('/api/requisitions', reqRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/quotations', quotationsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/exports', exportsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/audit', auditRoutes);

// ── API Vales ─────────────────────────────────────────────────────────────────
app.use('/api/vales/auth', valesAuthRoutes);
app.use('/api/vales',      valesRoutes);

// ── API Super Admin ───────────────────────────────────────────────────────────
app.use('/api/super-admin', superAdminRoutes);

// ── API Producción ────────────────────────────────────────────────────────
app.use('/api/produccion', produccionRoutes);

// ── API Inventarios ───────────────────────────────────────────────────────────
app.use('/api/inv', inventariosRoutes);

// ── API Mantenimiento ─────────────────────────────────────────────────────────
app.use('/api/mant/auth', mantAuthRoutes);
app.use('/api/mant',      mantRoutes);

// ── API Flujo de Materiales ──────────────────────────────────────────────────
app.use('/api/flujo', flujoRoutes);

// ── API Validaciones Almacen ──────────────────────────────────────────────────
app.use('/api/val', validacionesRoutes);

// ── API Planner Staff ───────────────────────────────────────────────────────
app.use('/api/planner', plannerRoutes);

// ── API Inventario con App (aislada, sin acceso a BD del sistema) ─────────────
const crypto = require('crypto');
// INVAPP_USERS: formato env "user1:hash1,user2:hash2" o fallback hardcoded
const INVAPP_USERS = (process.env.INVAPP_USERS || 'IsaCha2026:bd3ef80a63ec33e9e49caee0e21a2d3687b3f7613cd5c32fac99c617019a4579')
  .split(',').reduce((acc, pair) => {
    const [u, h] = pair.split(':');
    if (u && h) acc[u.trim()] = h.trim();
    return acc;
  }, {});
app.post('/api/invapp/login', (req, res) => {
  const { user, pass } = req.body || {};
  const hash = crypto.createHash('sha256').update(String(pass || '')).digest('hex');
  if (INVAPP_USERS[user] && INVAPP_USERS[user] === hash) {
    const token = crypto.createHmac('sha256', JWT_SECRET)
      .update('invapp:' + user + ':' + Date.now()).digest('hex');
    const expires = Date.now() + 24 * 60 * 60 * 1000;
    if (!global._invappTokens) global._invappTokens = {};
    for (const [k, v] of Object.entries(global._invappTokens)) {
      if (v.expires < Date.now()) delete global._invappTokens[k];
    }
    global._invappTokens[token] = { user, expires };
    res.json({ ok: true, token, user });
  } else {
    res.status(401).json({ ok: false, error: 'Usuario o contrasena incorrectos' });
  }
});
app.get('/api/invapp/verify', (req, res) => {
  const token = req.headers['x-invapp-token'] || '';
  const entry = (global._invappTokens || {})[token];
  if (entry && entry.expires > Date.now()) {
    res.json({ ok: true, user: entry.user });
  } else {
    res.status(401).json({ ok: false });
  }
});
// Middleware para validar token invapp
function invappAuth(req, res, next) {
  const token = req.headers['x-invapp-token'] || '';
  const entry = (global._invappTokens || {})[token];
  if (entry && entry.expires > Date.now()) { req.invappUser = entry.user; next(); }
  else res.status(401).json({ ok: false, error: 'No autorizado' });
}
// Archivo aislado para datos de invapp (no toca BD del sistema)
const INVAPP_DATA = path.resolve(process.cwd(), 'database/invapp-data.json');
function readInvapp() {
  try { return JSON.parse(require('fs').readFileSync(INVAPP_DATA, 'utf8')); }
  catch { return { ubicaciones: [] }; }
}
function writeInvapp(data) {
  require('fs').writeFileSync(INVAPP_DATA, JSON.stringify(data, null, 2));
}
app.get('/api/invapp/ubicaciones', invappAuth, (req, res) => {
  const data = readInvapp();
  res.json({ ok: true, ubicaciones: data.ubicaciones || [] });
});
app.post('/api/invapp/ubicaciones', invappAuth, (req, res) => {
  const { ubicaciones: ubis } = req.body || {};
  if (!Array.isArray(ubis)) return res.status(400).json({ ok: false, error: 'Formato invalido' });
  const data = readInvapp();
  data.ubicaciones = ubis.map(u => String(u).trim()).filter(Boolean);
  writeInvapp(data);
  res.json({ ok: true, ubicaciones: data.ubicaciones });
});

// ── API Pública (sin auth) ────────────────────────────────────────────────────
app.use('/api/public/po', publicPoRoutes);

// ── API RHH ───────────────────────────────────────────────────────────────────
app.use('/api/rhh/auth', rhhAuthRoutes);
app.use('/api/rhh/employees', rhhEmployeesRoutes);
app.use('/api/rhh/catalogs', rhhCatalogsRoutes);
app.use('/api/rhh/schedule', rhhScheduleRoutes);
app.use('/api/rhh/incidences', rhhIncidencesRoutes);
app.use('/api/rhh/dashboard', rhhDashboardRoutes);
app.use('/api/rhh/vacancies', rhhVacanciesRoutes);
app.use('/api/rhh/evaluations', rhhEvaluationsRoutes);
app.use('/api/rhh/notifications', rhhNotificationsRoutes);
app.use('/api/rhh/checador', rhhChecadorRoutes);
app.use('/api/rhh/nomina',      rhhNominaRoutes);
app.use('/api/rhh/asistencia', rhhAsistenciaRoutes);
app.use('/api/rhh/catalogo',   rhhCatalogoRoutes);
app.use('/api/rhh/kpi',        rhhKpiRoutes);

// ── API Empleados (autoservicio) ──────────────────────────────────────────────
app.use('/api/empleados/auth', empleadosAuthRoutes);
app.use('/api/empleados',      empleadosRoutes);

// ── Rutas de módulos (SPA) ────────────────────────────────────────────────────
// Portal principal
if (process.env.OPAQUE_ROUTES) {
  // Railway: raíz = login, /home1 = portal de módulos
  app.get('/', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'frontend/public/login.html'));
  });
  app.get('/home1', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'frontend/public/portal.html'));
  });
} else {
  // Render: comportamiento original
  app.get('/', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'frontend/public/portal.html'));
  });
}

// Helper para sendFile
const sf = (rel) => (req, res) => res.sendFile(path.resolve(process.cwd(), rel));
const redir = (target) => (req, res) => res.redirect(302, target + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''));

if (process.env.OPAQUE_ROUTES) {
  // ── Rutas opacas (Railway) ──────────────────────────────────────────────────
  // Compras internas
  app.get('/m/k8f2c4/compras',    sf('frontend/public/index.html'));
  app.get('/m/k8f2c4/compras/*',  sf('frontend/public/index.html'));
  app.get('/compras',             redir('/m/k8f2c4/compras'));
  app.get('/compras/*',           redir('/m/k8f2c4/compras'));

  // Super Admin
  app.get('/z/w4n8k6',            sf('frontend/public/super-admin/index.html'));
  app.get('/z/w4n8k6/*',          sf('frontend/public/super-admin/index.html'));
  app.get('/super-admin',         (req, res) => res.status(404).send('Not Found'));
  app.get('/super-admin/*',       (req, res) => res.status(404).send('Not Found'));

  // RHH
  app.get('/m/v6r9n3/rhh',       sf('frontend/public/rhh/index.html'));
  app.get('/m/v6r9n3/rhh/*',     sf('frontend/public/rhh/index.html'));
  app.get('/rhh',                 redir('/m/v6r9n3/rhh'));
  app.get('/rhh/*',               redir('/m/v6r9n3/rhh'));

  // Vales / Calidad
  app.get('/m/t7q4h2/vales',     sf('frontend/public/vales/index.html'));
  app.get('/m/t7q4h2/vales/*',   sf('frontend/public/vales/index.html'));
  app.get('/vales',               redir('/m/t7q4h2/vales'));
  app.get('/vales/*',             redir('/m/t7q4h2/vales'));

  // Inventarios
  app.get('/m/k5i8r2/inventarios',   sf('frontend/public/inventarios/index.html'));
  app.get('/m/k5i8r2/inventarios/*', sf('frontend/public/inventarios/index.html'));
  app.get('/inventarios',            redir('/m/k5i8r2/inventarios'));
  app.get('/inventarios/*',          redir('/m/k5i8r2/inventarios'));

  // Produccion
  app.get('/m/x3p9d5/produccion',    sf('frontend/public/produccion/index.html'));
  app.get('/m/x3p9d5/produccion/*',  sf('frontend/public/produccion/index.html'));
  app.get('/m/x3p9d5/pizarron',      sf('frontend/public/produccion/pizarron.html'));
  app.get('/m/x3p9d5/pizarron/vista', sf('frontend/public/produccion/slideshow.html'));
  app.get('/produccion',             redir('/m/x3p9d5/produccion'));
  app.get('/produccion/*',           redir('/m/x3p9d5/produccion'));
  app.get('/pizarron',               redir('/m/x3p9d5/pizarron'));
  app.get('/pizarron/vista',         redir('/m/x3p9d5/pizarron/vista'));

  // Flujo de Materiales
  app.get('/m/f7w3k9/flujo-materiales',   sf('frontend/public/flujo-materiales/index.html'));
  app.get('/m/f7w3k9/flujo-materiales/*', sf('frontend/public/flujo-materiales/index.html'));
  app.get('/flujo-materiales',            redir('/m/f7w3k9/flujo-materiales'));
  app.get('/flujo-materiales/*',          redir('/m/f7w3k9/flujo-materiales'));

  // Mantenimiento
  app.get('/m/b6t2v9/mantenimiento',     sf('frontend/public/mantenimiento/index.html'));
  app.get('/m/b6t2v9/mantenimiento/*',   sf('frontend/public/mantenimiento/index.html'));
  app.get('/mantenimiento',              redir('/m/b6t2v9/mantenimiento'));
  app.get('/mantenimiento/*',            redir('/m/b6t2v9/mantenimiento'));

  // Empleados
  app.get('/apps/e6v3m8/empleados',      sf('frontend/public/empleados/index.html'));
  app.get('/apps/e6v3m8/empleados/*',    sf('frontend/public/empleados/index.html'));
  app.get('/empleados',                  redir('/apps/e6v3m8/empleados'));
  app.get('/empleados/*',                redir('/apps/e6v3m8/empleados'));

  // Planner Staff
  app.get('/m/p4s6j8/planner-staff',     sf('frontend/public/planner-staff/index.html'));
  app.get('/m/p4s6j8/planner-staff/*',   sf('frontend/public/planner-staff/index.html'));
  app.get('/planner-staff',              redir('/m/p4s6j8/planner-staff'));
  app.get('/planner-staff/*',            redir('/m/p4s6j8/planner-staff'));

  // Escaneo inventarios
  app.get('/apps/s9q5r2/escaneo-inventarios',   sf('frontend/public/home/inventarioconapp/index.html'));
  app.get('/apps/s9q5r2/escaneo-inventarios/*', sf('frontend/public/home/inventarioconapp/index.html'));
  app.get('/home/inventarioconapp',             redir('/apps/s9q5r2/escaneo-inventarios'));
  app.get('/home/inventarioconapp/*',           redir('/apps/s9q5r2/escaneo-inventarios'));

} else {
  // ── Rutas originales (Render) ───────────────────────────────────────────────
  app.get('/compras',       sf('frontend/public/index.html'));
  app.get('/compras/*',     sf('frontend/public/index.html'));
  app.get('/super-admin',   sf('frontend/public/super-admin/index.html'));
  app.get('/super-admin/*', sf('frontend/public/super-admin/index.html'));
  app.get('/rhh',           sf('frontend/public/rhh/index.html'));
  app.get('/rhh/*',         sf('frontend/public/rhh/index.html'));
  app.get('/vales',         sf('frontend/public/vales/index.html'));
  app.get('/vales/*',       sf('frontend/public/vales/index.html'));
  app.get('/inventarios',   sf('frontend/public/inventarios/index.html'));
  app.get('/inventarios/*', sf('frontend/public/inventarios/index.html'));
  app.get('/produccion',    sf('frontend/public/produccion/index.html'));
  app.get('/produccion/*',  sf('frontend/public/produccion/index.html'));
  app.get('/pizarron',      sf('frontend/public/produccion/pizarron.html'));
  app.get('/pizarron/vista', sf('frontend/public/produccion/slideshow.html'));
  app.get('/flujo-materiales',   sf('frontend/public/flujo-materiales/index.html'));
  app.get('/flujo-materiales/*', sf('frontend/public/flujo-materiales/index.html'));
  app.get('/mantenimiento',      sf('frontend/public/mantenimiento/index.html'));
  app.get('/mantenimiento/*',    sf('frontend/public/mantenimiento/index.html'));
  app.get('/empleados',          sf('frontend/public/empleados/index.html'));
  app.get('/empleados/*',        sf('frontend/public/empleados/index.html'));
  app.get('/planner-staff',      sf('frontend/public/planner-staff/index.html'));
  app.get('/planner-staff/*',    sf('frontend/public/planner-staff/index.html'));
  app.get('/home/inventarioconapp',   sf('frontend/public/home/inventarioconapp/index.html'));
  app.get('/home/inventarioconapp/*', sf('frontend/public/home/inventarioconapp/index.html'));
}

// Validaciones Almacen — ruta opaca (siempre activa, ya migrado)
app.get('/clientes/c7m4q9/validaciones-almacen', sf('frontend/public/validaciones-almacen/index.html'));
app.get('/clientes/c7m4q9/validaciones-almacen/*', sf('frontend/public/validaciones-almacen/index.html'));
app.get('/validaciones-almacen', redir('/clientes/c7m4q9/validaciones-almacen'));
app.get('/validaciones-almacen/*', redir('/clientes/c7m4q9/validaciones-almacen'));

// Vista pública PO (proveedor)
app.get('/po-view', sf('frontend/public/po-view.html'));

// ── API 404: rutas /api inexistentes devuelven JSON, no HTML ──────────────────
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Fallback SPA — solo rutas no-API
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

const port = Number(process.env.PORT || 3000);

Promise.all([initDb(), initRhhDb(), initValesDb(), initProduccionDb(), initInventariosDb(), initMantDb(), initValDb(), initFlujoDb(), initPlannerDb()])
  .then(() => {
    app.listen(port, () => {
      console.log(`Servidor listo en http://localhost:${port} [build 2026-09-10]`);
    });
  })
  .catch(err => {
    console.error('Error al inicializar la base de datos:', err.message);
    process.exit(1);
  });
