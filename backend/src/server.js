const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const catalogsRoutes = require('./routes/catalogs');
const reqRoutes = require('./routes/requisitions');
const maintenanceRoutes = require('./routes/maintenance');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/storage', express.static(path.resolve(process.cwd(), 'storage')));
app.use(express.static(path.resolve(process.cwd(), 'frontend/public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/catalogs', catalogsRoutes);
app.use('/api/requisitions', reqRoutes);
app.use('/api/maintenance', maintenanceRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'frontend/public/index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port}`);
});
