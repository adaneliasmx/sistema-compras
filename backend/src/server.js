const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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

// ── Módulo Validaciones Almacen (SKF/CUESTO sync) ─────────────────────────────
const validacionesRoutes = require('./routes/validaciones');

// ── PO Pública (proveedor) ────────────────────────────────────────────────────
const publicPoRoutes = require('./routes/public-po');

const { initDb } = require('./db');
const { initDb: initRhhDb } = require('./db-rhh');
const { initDb: initValesDb } = require('./db-vales');
const { initDb: initProduccionDb } = require('./db-produccion');
const { initDb: initInventariosDb } = require('./db-inventarios');
const { initDb: initMantDb } = require('./db-mantenimiento');
const { initDb: initValDb } = require('./db-validaciones');

const app = express();

// ── Confiar en el proxy de Render para X-Forwarded-Proto / IP ─────────────────
app.set('trust proxy', 1);

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
const DEFAULT_ORIGINS = ['https://cuestocompras.onrender.com'];
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

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/storage', express.static(path.resolve(process.cwd(), 'storage')));
app.use(express.static(path.resolve(process.cwd(), 'frontend/public'), { index: false }));

// ── API Health + memoria ──────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  if (global.gc) global.gc();
  const m = process.memoryUsage();
  const mb = v => Math.round(v / 1024 / 1024);
  const heapUsedMB = mb(m.heapUsed);
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

// ── Middleware: loguear picos de memoria ──────────────────────────────────────
app.use((req, res, next) => {
  const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  if (heapMB > 220) {
    console.warn(`[MEM] ${heapMB}MB heap | ${req.method} ${req.path}`);
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

// ── API Validaciones Almacen ──────────────────────────────────────────────────
app.use('/api/val', validacionesRoutes);

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

// ── API Empleados (autoservicio) ──────────────────────────────────────────────
app.use('/api/empleados/auth', empleadosAuthRoutes);
app.use('/api/empleados',      empleadosRoutes);

// ── Rutas de módulos (SPA) ────────────────────────────────────────────────────
// Portal principal
app.get('/', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/portal.html'));
});

// Módulo Compras
app.get('/compras', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});
app.get('/compras/*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

// Super Admin panel
app.get('/super-admin', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/super-admin/index.html'));
});
app.get('/super-admin/*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/super-admin/index.html'));
});

// Módulo RHH
app.get('/rhh', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/rhh/index.html'));
});
app.get('/rhh/*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/rhh/index.html'));
});

// Módulo Vales
app.get('/vales', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/vales/index.html'));
});
app.get('/vales/*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/vales/index.html'));
});

// Módulo Inventarios
app.get('/inventarios', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/inventarios/index.html')));
app.get('/inventarios/*', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/inventarios/index.html')));

// Módulo Producción
app.get('/produccion', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/produccion/index.html')));
app.get('/produccion/*', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/produccion/index.html')));
app.get('/pizarron', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/produccion/pizarron.html')));
app.get('/pizarron/vista', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/produccion/slideshow.html')));

// Módulo Mantenimiento
app.get('/mantenimiento', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/mantenimiento/index.html')));
app.get('/mantenimiento/*', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/mantenimiento/index.html')));

// Módulo Validaciones Almacen
app.get('/validaciones-almacen', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/validaciones-almacen/index.html')));
app.get('/validaciones-almacen/*', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/validaciones-almacen/index.html')));

// Portal Empleados (autoservicio)
app.get('/empleados', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/empleados/index.html')));
app.get('/empleados/*', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/empleados/index.html')));

// Inventario con App (escaneo QR movil)
app.get('/home/inventarioconapp', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/home/inventarioconapp/index.html')));
app.get('/home/inventarioconapp/*', (req, res) => res.sendFile(path.resolve(process.cwd(), 'frontend/public/home/inventarioconapp/index.html')));

// Vista pública PO (proveedor)
app.get('/po-view', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/po-view.html'));
});

// ── API 404: rutas /api inexistentes devuelven JSON, no HTML ──────────────────
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Fallback SPA — solo rutas no-API
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

const port = Number(process.env.PORT || 3000);

Promise.all([initDb(), initRhhDb(), initValesDb(), initProduccionDb(), initInventariosDb(), initMantDb(), initValDb()])
  .then(() => {
    app.listen(port, () => {
      console.log(`Servidor listo en http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('Error al inicializar la base de datos:', err.message);
    process.exit(1);
  });
