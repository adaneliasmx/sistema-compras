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

// ── Módulo Producción ─────────────────────────────────────────────────────
const produccionRoutes = require('./routes/produccion');

// ── Módulo Inventarios ────────────────────────────────────────────────────────
const inventariosRoutes = require('./routes/inventarios');

// ── Módulo Mantenimiento ──────────────────────────────────────────────────────
const mantAuthRoutes  = require('./routes/mant-auth');
const mantRoutes      = require('./routes/mantenimiento');

// ── PO Pública (proveedor) ────────────────────────────────────────────────────
const publicPoRoutes = require('./routes/public-po');

const { initDb } = require('./db');
const { initDb: initRhhDb } = require('./db-rhh');
const { initDb: initValesDb } = require('./db-vales');
const { initDb: initProduccionDb } = require('./db-produccion');
const { initDb: initInventariosDb } = require('./db-inventarios');
const { initDb: initMantDb } = require('./db-mantenimiento');

const app = express();

// ── Confiar en el proxy de Render para X-Forwarded-Proto / IP ─────────────────
app.set('trust proxy', 1);

// ── Seguridad de headers HTTP (helmet) ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // La SPA usa inline scripts; CSP requiere configuración específica
  crossOriginEmbedderPolicy: false
}));

// ── CORS: restringido si ALLOWED_ORIGINS está configurado, abierto si no ──────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0
    ? (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return cb(null, true);
        cb(new Error(`CORS: origin no autorizado — ${origin}`));
      }
    : true, // Si no se configura ALLOWED_ORIGINS, permite todo (modo permisivo)
  credentials: true
}));

app.use(express.json({ limit: '15mb' }));
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

// Vista pública PO (proveedor)
app.get('/po-view', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/po-view.html'));
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

const port = Number(process.env.PORT || 3000);

Promise.all([initDb(), initRhhDb(), initValesDb(), initProduccionDb(), initInventariosDb(), initMantDb()])
  .then(() => {
    app.listen(port, () => {
      console.log(`Servidor listo en http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('Error al inicializar la base de datos:', err.message);
    process.exit(1);
  });
