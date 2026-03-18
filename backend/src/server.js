const express = require('express');
const cors = require('cors');
const path = require('path');

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

const { initDb } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/storage', express.static(path.resolve(process.cwd(), 'storage')));
app.use(express.static(path.resolve(process.cwd(), 'frontend/public')));

app.get('/api/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));
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

// Portal: raíz → portada de módulos
app.get('/', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/portal.html'));
});

// Módulo Compras: cualquier ruta bajo /compras → SPA de compras
app.get('/compras', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});
app.get('/compras/*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

// Fallback para rutas legacy (hash routing no necesita esto, pero por compatibilidad)
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

const port = Number(process.env.PORT || 3000);

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Servidor listo en http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('Error al inicializar la base de datos:', err.message);
    process.exit(1);
  });
