'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const rules = require('./planner-rules');
function loadPlanner(options = {}) {
  const planner = options.planner || { asignaciones: [{ usuario_id: 1, planner_role: 'admin', departamentos: ['smya'] }, { usuario_id: 2, planner_role: 'staff', departamentos: ['produccion'] }], actividades: [], daily_registros: [] };
  const compras = options.compras || { users: [{ id: 1, full_name: 'Ana Prueba', email: 'ana@example.test', active: true }, { id: 2, full_name: 'Luis Prueba', email: 'luis@example.test', active: true }, { id: 3, full_name: 'Usuario Sin Planner', active: true }] };
  const production = options.production || {};
  const rhh = options.rhh || {};
  let writes = 0;
  const empty = { read: () => ({}) };
  const objectives = Object.fromEntries(rules.LINEAS.map(l => [l, { eficiencia: 91, calidad: 98, disponibilidad: 94 }]));
  const dependencies = {
    express, '../planner-rules': rules,
    '../db-planner': { read: () => planner, write: () => writes++, DEPARTAMENTOS: ['smya','rhh','produccion','calidad','mantenimiento','procesos','compras','sgc','operaciones'].map(id => ({ id, nombre: id })) },
    '../db': { read: () => compras }, '../db-produccion': { read: () => production }, '../db-rhh': { read: () => rhh },
    '../db-vales': { read: () => options.vales || {} }, '../db-flujo': { read: () => options.flujo || {} },
    '../db-mantenimiento': { read: () => options.mantenimiento || {} }, '../db-inventarios': empty,
    './produccion': { _getPlannerObjectives: () => objectives, _getPlannerDefects: () => [{ defecto: 'Ejemplo', cantidad: 2 }], _getDailyKpis: fecha => ({ fecha, kpis: Object.fromEntries(rules.LINEAS.map(l => [l, { eficiencia: .92, calidad: .99, disponibilidad: .95 }])) }) },
    '../middleware/auth': { authRequired: (req, res, next) => { const user = compras.users.find(u => u.id === Number(req.headers['x-user'] || 1)); if (!user) return res.status(401).end(); req.user = user; next(); } }
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-12T18:00:00Z'])); } static now() { return Date.parse('2026-10-12T18:00:00Z'); } }
  const filename = path.join(__dirname, 'routes/planner.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, Date: FixedDate, process: { env: {} }, require: name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; } }, { filename });
  const app = express(); app.use(express.json()); app.use('/api/planner', module.exports);
  return { app, planner, compras, production, rhh, writes: () => writes, objectives };
}
module.exports = { loadPlanner };
