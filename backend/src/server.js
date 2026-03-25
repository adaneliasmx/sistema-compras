const express = require('express');
const cors = require('cors');
const path = require('path');

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

const { initDb } = require('./db');
const { initDb: initRhhDb } = require('./db-rhh');
const { initDb: initValesDb } = require('./db-vales');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/storage', express.static(path.resolve(process.cwd(), 'storage')));
app.use(express.static(path.resolve(process.cwd(), 'frontend/public'), { index: false }));

// ── API Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

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

// ── Seed temporal (migración SQLite → PostgreSQL) ─────────────────────────────
const { write: writeValesDb } = require('./db-vales');
app.post('/api/vales-seed', (req, res) => {
  const secret = req.headers['x-seed-secret'];
  if (!secret || secret !== (process.env.SEED_SECRET || 'vales-seed-2026')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const seedPath = path.resolve(process.cwd(), 'database/vales.json');
    const data = JSON.parse(require('fs').readFileSync(seedPath, 'utf8'));
    writeValesDb(data);
    const summary = Object.fromEntries(Object.entries(data).map(([k,v]) => [k, v.length]));
    console.log('[seed] Datos cargados en PostgreSQL:', summary);
    res.json({ ok: true, summary });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API Vales ─────────────────────────────────────────────────────────────────
app.use('/api/vales/auth', valesAuthRoutes);
app.use('/api/vales',      valesRoutes);

// ── API Super Admin ───────────────────────────────────────────────────────────
app.use('/api/super-admin', superAdminRoutes);

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

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

const port = Number(process.env.PORT || 3000);

Promise.all([initDb(), initRhhDb(), initValesDb()])
  .then(() => {
    app.listen(port, () => {
      console.log(`Servidor listo en http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('Error al inicializar la base de datos:', err.message);
    process.exit(1);
  });
