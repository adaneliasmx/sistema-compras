'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

// Load the actual router with isolated data; never open production databases.
function appWith(production) {
  const planner = { asignaciones: [{ usuario_id: 1, planner_role: 'staff' }] };
  const readonly = data => ({ read: () => data, write: () => assert.fail('GET must not write') });
  const dependencies = {
    express,
    '../planner-rules': require('../planner-rules'),
    '../db-planner': { ...readonly(planner), DEPARTAMENTOS: [] },
    '../db-produccion': readonly(production),
    './produccion': {},
    '../middleware/auth': {
      authRequired: (req, _res, next) => { req.user = { id: 1 }; next(); }
    }
  };
  for (const name of ['db', 'db-mantenimiento', 'db-inventarios', 'db-vales', 'db-rhh', 'db-flujo']) {
    dependencies['../' + name] = readonly({});
  }
  const filename = path.join(__dirname, 'planner.js');
  const moduleObject = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: moduleObject,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency: ' + name);
      return dependencies[name];
    }
  }, { filename });
  const app = express();
  app.use('/api/planner', moduleObject.exports);
  return app;
}

const fecha = '2026-10-12';
const getParos = (app, date = fecha) => request(app)
  .get('/api/planner/integracion/produccion/paros').query({ fecha: date }).expect(200);

test('separa L3 y L4; conserva Baker/L1 y el total sin duplicados', async () => {
  const data = {
    paros: [
      { id: 1, linea: 'L3', fecha_inicio: fecha, duracion_min: 30, estado: 'cerrado', motivo: 'Falla', folio: 'PR-L3-1' },
      { id: 2, linea: 'L4', fecha_inicio: fecha, duracion_min: 15, estado: 'cerrado', motivo: 'Ajuste', folio: 'PR-L4-1' },
      { id: 3, linea: 'L4', fecha_inicio: fecha, duracion_min: null, estado: 'activo', motivo: 'Revision' }
    ],
    paros_baker: [{ id: 4, fecha_inicio: fecha, duracion_min: 12, estado: 'cerrado' }],
    paros_l1: [{ id: 5, fecha_inicio: fecha, duracion_min: 8, estado: 'cerrado' }]
  };
  const original = JSON.stringify(data);
  const { body } = await getParos(appWith(data));
  assert.equal(body.fecha, fecha);
  assert.deepEqual(Object.fromEntries(Object.entries(body.paros).map(([linea, p]) =>
    [linea, { total: p.total, minutos: p.minutos_total, activos: p.activos, ids: p.paros.map(x => x.id) }])), {
    L3: { total: 1, minutos: 30, activos: 0, ids: [1] },
    L4: { total: 2, minutos: 15, activos: 1, ids: [2, 3] },
    Baker: { total: 1, minutos: 12, activos: 0, ids: [4] },
    L1: { total: 1, minutos: 8, activos: 0, ids: [5] }
  });
  assert.equal(Object.values(body.paros).reduce((sum, p) => sum + p.minutos_total, 0), 65);
  assert.equal(body.paros.L3.paros[0].folio, 'PR-L3-1');
  assert.equal(body.paros.L4.paros[0].motivo, 'Ajuste');
  assert.equal(JSON.stringify(data), original);
});

test('respeta la fecha consultada en las cuatro lineas', async () => {
  const previous = '2026-10-11';
  const app = appWith({
    paros: [{ id: 1, linea: 'L3', fecha_inicio: previous, duracion_min: 40 }, { id: 2, linea: 'L4', fecha_inicio: fecha, duracion_min: 9 }],
    paros_baker: [{ id: 3, fecha_inicio: previous, duracion_min: 5 }],
    paros_l1: [{ id: 4, fecha_inicio: previous, duracion_min: 7 }]
  });
  const today = (await getParos(app)).body.paros;
  assert.equal(today.L3.total, 0);
  assert.equal(today.L4.minutos_total, 9);
  assert.equal(today.Baker.total, 0);
  assert.equal(today.L1.total, 0);
  const yesterday = (await getParos(app, previous)).body.paros;
  assert.equal(yesterday.L3.minutos_total, 40);
  assert.equal(yesterday.L4.total, 0);
  assert.equal(yesterday.Baker.minutos_total, 5);
  assert.equal(yesterday.L1.minutos_total, 7);
});

test('no atribuye registros sin linea o de otra linea a L3/L4', async () => {
  const { body } = await getParos(appWith({ paros: [
    { id: 1, fecha_inicio: fecha, duracion_min: 100 },
    { id: 2, linea: 'L1', fecha_inicio: fecha, duracion_min: 80 },
    { id: 3, linea: 'L3', fecha_inicio: fecha, duracion_min: 6 }
  ] }));
  assert.deepEqual(body.paros.L3.paros.map(p => p.id), [3]);
  assert.equal(body.paros.L4.total, 0);
  assert.equal(body.paros.L1.total, 0);
});

test('sin datos devuelve las cuatro lineas vacias', async () => {
  const { body } = await getParos(appWith({}));
  assert.deepEqual(Object.keys(body.paros), ['L3', 'L4', 'Baker', 'L1']);
  for (const p of Object.values(body.paros)) {
    assert.deepEqual(p, { total: 0, minutos_total: 0, activos: 0, paros: [], por_turno: [] });
  }
});
