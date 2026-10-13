'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./production-test-harness');
test('integracion real de Produccion expone piezas de cada linea y metas configuradas', () => {
  const h = load();
  const router = h.context.module.exports;
  h.data.config.eficiencia_obj_l3 = 93;
  assert.equal(router._getPlannerObjectives().L3.eficiencia, 93);
  const daily = router._getDailyKpis('2026-10-10');
  assert.equal(daily.piezas.L3, 10);
  assert.equal(daily.piezas.L4, 20);
  assert.equal(daily.piezas.Baker, 9);
  assert.equal(daily.piezas.L1, 30);
  for (const linea of ['Baker','L1','L3','L4']) assert.equal(daily.kpis[linea].piezas_total, daily.piezas[linea]);
  assert.ok(Array.isArray(router._getPlannerDefects('2026-10-10')));
});
