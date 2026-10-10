'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ProductionMetricsCache } = require('./production-metrics-cache');
const SECRET = 'pruebas-aisladas-produccion';
function fixture() {
  const data = {
    config: { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2, ciclos_objetivo_baker: 2, ciclos_objetivo_l1: 2,
      slideshow: { default_duracion_seg: 120, slides: [{ id: 99, type: 'imagen', imagen_b64: 'data:image/png;base64,AAAA' }] } },
    cargas: [
      { id: 1, linea: 'L3', estado: 'completado', fecha_descarga: '2026-10-10', hora_descarga: '08:00', cantidad: 10, operador_id: 1, operador: 'Op1' },
      { id: 2, linea: 'L3', estado: 'completado', fecha_descarga: '2026-10-10', hora_descarga: '01:00', cantidad: 5, operador_id: 2, operador: 'Op2' },
      { id: 3, linea: 'L4', estado: 'completado', fecha_descarga: '2026-10-10', hora_descarga: '09:00', cantidad: 20, operador_id: 1, operador: 'Op1' }
    ],
    cargas_baker: [{ id: 1, estado: 'completado', herramental_tipo: 'barril', fecha_descarga: '2026-10-10', hora_descarga: '08:00',
      cavidades_cargadas: 10, cavidades_buenas: 9, herramental_cavidades: 12, operador_id: 1, operador: 'Op1',
      cavidades: [{ estado: 'defecto', defecto: 'D1' }] }],
    cargas_l1: [{ id: 1, estado: 'completado', herramental_tipo: 'rack', fecha_descarga: '2026-10-10', hora_descarga: '08:00', cantidad: 30, operador_id: 1, operador: 'Op1' }],
    paros: [], paros_baker: [], paros_l1: [], registros_scrap: [], kpi_snapshots: [],
    turno_schedules: [], turno_l4_config: [{ week_start: '2026-10-05', dias: {
      sabado: { activo: true, hora_entrada: '08:00', hora_salida: '17:00' },
      viernes: { activo: true, hora_entrada: '08:00', hora_salida: '17:00' },
      lunes: { activo: true, hora_entrada: '08:00', hora_salida: '17:00' }
    } }]
  };
  for (const suffix of ['l3', 'l4', 'baker', 'l1']) {
    for (const prefix of ['componentes', 'herramentales', 'motivos_paro', 'operadores']) data[prefix + '_' + suffix] = [];
  }
  return data;
}
function load(data = fixture(), sourcePath = path.join(__dirname, 'routes/produccion.js')) {
  let current = data;
  const clock = { ms: Date.parse('2026-10-10T16:00:00Z') };
  const cache = new ProductionMetricsCache();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.ms])); }
    static now() { return clock.ms; }
  }
  const fakeDb = { read: () => ({}), write: () => { throw new Error('DB ajena prohibida'); }, nextId: rows => Math.max(0, ...rows.map(r => Number(r.id) || 0)) + 1 };
  const prod = { ...fakeDb, read: () => { cache.attach(current); return current; },
    write: (next, ...keys) => { cache.sync(next, keys); current = next; } };
  const authContext = vm.createContext({ module: { exports: {} },
    require: id => id === 'jsonwebtoken' ? jwt : SECRET });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'middleware/produccion-auth.js'), 'utf8'), authContext);
  const sandbox = {
    module: { exports: {} }, console, Date: FixedDate,
    require(id) {
      if (id === 'express') return express;
      if (id === 'bcryptjs' || id === 'jsonwebtoken') return require(id);
      if (id === '../jwt-secret') return SECRET;
      if (id === '../db-produccion') return prod;
      if (id === '../production-metrics-cache') return { shared: cache };
      if (['../db', '../db-rhh', '../db-mantenimiento'].includes(id)) return fakeDb;
      if (id === '../rate-limit') return { createRateLimiter: () => ({ check: () => true }) };
      if (id === '../middleware/produccion-auth') return authContext.module.exports;
      throw new Error('Dependencia no permitida: ' + id);
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
  const app = express();
  app.use(express.json());
  app.use('/api/produccion', context.module.exports);
  const token = role => jwt.sign({ sub: 1, module: 'produccion', role }, SECRET);
  return { app, cache, clock, context, data, prod, token };
}
module.exports = { load, fixture };
