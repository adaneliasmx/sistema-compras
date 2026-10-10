'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductionMetricsCache } = require('./production-metrics-cache');

const fixture = () => ({
  cargas: [
    { id: 1, linea: 'L3', fecha_descarga: '2026-10-05', cantidad: 10 },
    { id: 1, linea: 'L4', fecha_descarga: '2026-10-05', cantidad: 20 }
  ],
  cargas_baker: [{ id: 1, fecha_descarga: '2026-10-05', cantidad: 30 }],
  cargas_l1: [],
  paros: [], paros_baker: [], paros_l1: [],
  componentes_l3: [], config: { ciclos_objetivo_l3: 2, slideshow: { slides: [] } }
});
function setup(options) {
  const data = fixture();
  const cache = new ProductionMetricsCache(options);
  cache.attach(data);
  return { data, cache };
}
const deps = (cache, line = 'L3', date = '2026-10-05') =>
  cache.dependencies(line, date, '2026-10-06');

test('20 lectores comparten un cálculo y reciben objetos independientes', () => {
  const { cache } = setup();
  let builds = 0;
  for (let i = 0; i < 20; i++) {
    const value = cache.get('day', deps(cache), 'closed', () => { builds++; return { ciclos: 4 }; });
    value.ciclos = 99;
  }
  assert.equal(builds, 1);
  assert.equal(cache.get('day', deps(cache), 'closed', () => null).ciclos, 4);
});
test('una edición del objeto mutable sin cambiar longitud invalida el resultado', () => {
  const { cache, data } = setup();
  cache.get('day', deps(cache), 'closed', () => 10);
  data.cargas[0].cantidad = 11;
  cache.sync(data, ['cargas']);
  assert.equal(cache.get('day', deps(cache), 'closed', () => 11), 11);
});
test('mover un registro invalida la fecha anterior y la nueva', () => {
  const { cache, data } = setup();
  const old = deps(cache);
  const next = cache.dependencies('L3', '2026-10-07', '2026-10-08');
  cache.get('old', old, 'closed', () => 1);
  cache.get('next', next, 'closed', () => 0);
  data.cargas[0].fecha_descarga = '2026-10-07';
  cache.sync(data, ['cargas']);
  assert.equal(cache.peek('old', old, 'closed'), null);
  assert.equal(cache.peek('next', next, 'closed'), null);
});
test('un registro nuevo de L3 no recalcula Baker ni una fecha ajena', () => {
  const { cache, data } = setup();
  const baker = deps(cache, 'Baker');
  const older = cache.dependencies('L3', '2026-10-01', '2026-10-02');
  cache.get('baker', baker, 'closed', () => 30);
  cache.get('older', older, 'closed', () => 4);
  data.cargas.push({ id: 3, linea: 'L3', fecha_descarga: '2026-10-05', cantidad: 40 });
  cache.sync(data, ['cargas']);
  assert.ok(cache.peek('baker', baker, 'closed'));
  assert.ok(cache.peek('older', older, 'closed'));
});
test('borrar cargas y cambiar catálogos invalida métricas', () => {
  const { cache, data } = setup();
  const dependencies = deps(cache);
  cache.get('day', dependencies, 'closed', () => 10);
  data.cargas.splice(0, 1);
  cache.sync(data);
  assert.equal(cache.peek('day', dependencies, 'closed'), null);
  cache.get('day', dependencies, 'closed', () => 0);
  data.componentes_l3.push({ id: 1, piezas_objetivo: 40 });
  cache.sync(data);
  assert.equal(cache.peek('day', dependencies, 'closed'), null);
});
test('editar un paro L3 invalida L3 conservando Baker', () => {
  const { cache, data } = setup();
  cache.get('l3', deps(cache), 'closed', () => 1);
  cache.get('baker', deps(cache, 'Baker'), 'closed', () => 2);
  data.paros.push({ id: 1, linea: 'L3', fecha_inicio: '2026-10-05', hora_inicio: '08:00' });
  cache.sync(data, ['paros']);
  assert.equal(cache.peek('l3', deps(cache), 'closed'), null);
  assert.ok(cache.peek('baker', deps(cache, 'Baker'), 'closed'));
});
test('imágenes nuevas no invalidan la base de KPI; objetivos sí', () => {
  const { cache, data } = setup();
  const dependencies = deps(cache);
  cache.get('day', dependencies, 'closed', () => 10);
  data.config.slideshow.slides.push({ imagen_b64: 'data:image/png;base64,AAAA' });
  cache.sync(data, ['config']);
  assert.ok(cache.peek('day', dependencies, 'closed'));
  data.config.ciclos_objetivo_l3 = 3;
  cache.sync(data, ['config']);
  assert.equal(cache.peek('day', dependencies, 'closed'), null);
});
test('restaurar otro objeto elimina índices y resultados anteriores', () => {
  const { cache } = setup();
  cache.get('day', deps(cache), 'closed', () => 10);
  const restored = fixture();
  restored.cargas[0].cantidad = 42;
  cache.attach(restored);
  assert.equal(cache.peek('day', deps(cache), 'closed'), null);
  assert.equal(cache.view(restored, 'L3', '2026-10-05', '2026-10-06').cargas[0].cantidad, 42);
});
test('índice conserva orden, incluye T3 del día siguiente y no mezcla IDs de otras colecciones', () => {
  const { cache, data } = setup();
  data.cargas.push({ id: 3, linea: 'L3', fecha_descarga: '2026-10-06', hora_descarga: '01:00' });
  cache.sync(data);
  const view = cache.view(data, 'L3', '2026-10-05', '2026-10-06');
  assert.deepEqual(view.cargas.map(row => row.id), [1, 3]);
  assert.equal(cache.root(view), data);
  assert.equal(cache.view(data, 'Baker', '2026-10-05', '2026-10-06').cargas_baker[0].cantidad, 30);
});
test('avance del reloj invalida solo la entrada temporal', () => {
  const { cache } = setup();
  cache.get('base', deps(cache), 'static', () => 10);
  cache.get('live', deps(cache), '10:01', () => 1);
  assert.equal(cache.peek('live', deps(cache), '10:02'), null);
  assert.ok(cache.peek('base', deps(cache), 'static'));
});
test('un cálculo fallido no queda almacenado', () => {
  const { cache } = setup();
  assert.throws(() => cache.get('bad', [], 'static', () => { throw new Error('fallo'); }));
  assert.equal(cache.peek('bad', [], 'static'), null);
  assert.equal(cache.get('bad', [], 'static', () => 3), 3);
});
test('LRU respeta límite de entradas y bytes incluso con imágenes grandes', () => {
  const { cache } = setup({ maxEntries: 2, maxBytes: 100 });
  cache.get('a', [], 'static', () => 'a');
  cache.get('b', [], 'static', () => 'b');
  cache.get('c', [], 'static', () => 'c');
  assert.equal(cache.entries.size, 2);
  assert.equal(cache.peek('a', [], 'static'), null);
  cache.get('large', [], 'static', () => 'x'.repeat(200));
  assert.ok(cache.bytes <= 100);
  assert.equal(cache.peek('large', [], 'static'), null);
});


test('db-produccion real notifica correcciones de su objeto mutable antes de persistir', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const path = require('node:path');
  const { cache, data } = setup();
  let persisted;
  const sandbox = { module: { exports: {} }, console,
    process: { cwd: () => '/aislado', env: {}, once() {} },
    require(id) {
      if (id === 'fs') return { existsSync: () => true, readFileSync: () => JSON.stringify(data),
        writeFileSync: (file, value) => { persisted = JSON.parse(value); } };
      if (id === 'path') return path;
      if (id === './db-pool') return null;
      if (id === './production-metrics-cache') return { shared: cache };
      throw new Error('Dependencia prohibida');
    } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'db-produccion.js'), 'utf8'), sandbox);
  const actual = sandbox.module.exports;
  const mutable = actual.read();
  cache.get('day', deps(cache), 'closed', () => 10);
  mutable.cargas[0].cantidad = 44;
  actual.write(mutable, 'cargas');
  assert.equal(cache.peek('day', deps(cache), 'closed'), null);
  assert.equal(persisted.cargas[0].cantidad, 44);
});


test('un paro nuevo de hoy conserva los KPI históricos anteriores a su inicio', () => {
  const { cache, data } = setup();
  const historical = cache.dependencies('L3', '2026-10-01', '2026-10-02');
  const current = cache.dependencies('L3', '2026-10-10', '2026-10-11');
  cache.get('historical', historical, 'closed', () => 7);
  cache.get('current', current, '10:00', () => 8);
  data.paros.push({ id: 1, linea: 'L3', fecha_inicio: '2026-10-10', hora_inicio: '09:50' });
  cache.sync(data, ['paros']);
  assert.ok(cache.peek('historical', historical, 'closed'));
  assert.equal(cache.peek('current', current, '10:00'), null);
});
