'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { load } = require('./production-test-harness');
const request = (h, route, query = {}, role = 'admin') =>
  supertest(h.app).get('/api/produccion' + route).query(query).set('Authorization', 'Bearer ' + h.token(role));
const boardQuery = { linea: 'ambas', fecha: '2026-10-10', turno: 'all' };

test('pizarrón: 20 solicitudes HTTP comparten respuesta después de autenticarse', async () => {
  const h = load();
  const first = await request(h, '/pizarron', boardQuery);
  assert.equal(first.status, 200);
  const builds = h.cache.stats.builds;
  const responses = await Promise.all(Array.from({ length: 20 }, () => request(h, '/pizarron', boardQuery)));
  for (const res of responses) assert.deepEqual(res.body, first.body);
  assert.equal(h.cache.stats.builds, builds);
  assert.equal(first.body.data.L3.T1.totals.ciclos_totales, 1);
  assert.equal(first.body.data.Baker.T1.totals.ciclos_buenos, 9);
  assert.equal(first.body.data.L1.T1.totals.piezas_total, 30);
});
test('las respuestas compartidas no evitan el JWT ni permisos de rol', async () => {
  const h = load();
  await request(h, '/stats/semana-linea', { linea: 'L3', fecha_ini: '2026-10-05' });
  const missing = await supertest(h.app).get('/api/produccion/stats/semana-linea?linea=L3&fecha_ini=2026-10-05');
  assert.equal(missing.status, 401);
  assert.equal((await request(h, '/stats/semana-linea', { linea: 'L3', fecha_ini: '2026-10-05' }, 'invalido')).status, 403);
});
test('actualizar una cantidad y mover su descarga refleja ambos días sin esperar TTL', async () => {
  const h = load();
  await request(h, '/pizarron', boardQuery);
  h.data.cargas[0].cantidad = 42;
  h.prod.write(h.data, 'cargas');
  let res = await request(h, '/pizarron', boardQuery);
  assert.equal(res.body.data.L3.T1.totals.piezas_total, 42);
  h.data.cargas[0].fecha_descarga = '2026-10-09';
  h.prod.write(h.data, 'cargas');
  res = await request(h, '/pizarron', boardQuery);
  assert.equal(res.body.data.L3.T1.totals.ciclos_totales, 0);
  res = await request(h, '/pizarron', { linea: 'L3', fecha: '2026-10-09', turno: 'T1' });
  assert.equal(res.body.data.L3.T1.totals.piezas_total, 42);
});
test('T3 conserva las descargas de madrugada en la fecha operativa anterior', async () => {
  const h = load();
  const res = await request(h, '/pizarron', { linea: 'L3', fecha: '2026-10-09', turno: 'T3' });
  assert.equal(res.body.data.L3.T3.totals.ciclos_totales, 1);
});
test('el reloj actualiza paros abiertos y eficiencia sin escrituras', async () => {
  const h = load();
  h.data.paros.push({ id: 1, linea: 'L3', fecha_inicio: '2026-10-10', hora_inicio: '09:50', motivo: 'Abierto' });
  h.prod.write(h.data, 'paros');
  const first = await request(h, '/pizarron', boardQuery);
  h.clock.ms += 10 * 60 * 1000;
  const next = await request(h, '/pizarron', boardQuery);
  assert.ok(next.body.data.L3.T1.totals.paros_min > first.body.data.L3.T1.totals.paros_min);
});
test('TL4 sigue extendiendo tiempo adicional con cargas activas y se actualiza al descargar', async () => {
  const h = load();
  h.clock.ms = Date.parse('2026-10-10T23:10:00Z');
  h.data.cargas.push({ id: 4, linea: 'L4', estado: 'activo', fecha_turno: '2026-10-10', hora_carga: '16:00' });
  h.prod.write(h.data, 'cargas');
  const first = await request(h, '/pizarron', boardQuery);
  assert.equal(first.body.data.L4.TL4.cargas_activas, 1);
  h.clock.ms += 10 * 60 * 1000;
  const next = await request(h, '/pizarron', boardQuery);
  assert.ok(next.body.data.L4.TL4.minutos_adicionales > first.body.data.L4.TL4.minutos_adicionales);
  Object.assign(h.data.cargas.at(-1), { estado: 'completado', fecha_descarga: '2026-10-10', hora_descarga: '17:20' });
  h.prod.write(h.data, 'cargas');
  assert.equal((await request(h, '/pizarron', boardQuery)).body.data.L4.TL4.cargas_activas, 0);
});
test('estadísticas semanales conservan operadores separados', async () => {
  const h = load();
  const one = await request(h, '/stats/operador-semana', { operador_id: 1, fecha_ini: '2026-10-05', fecha_fin: '2026-10-11' });
  const two = await request(h, '/stats/operador-semana', { operador_id: 2, fecha_ini: '2026-10-05', fecha_fin: '2026-10-11' });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.notDeepEqual(one.body, two.body);
});
test('slideshow mantiene imágenes; ETag evita volver a transferirlas; configuración de línea es ligera', async () => {
  const h = load();
  const first = await request(h, '/slideshow-config');
  assert.equal(first.body.slideshow.slides[0].imagen_b64, 'data:image/png;base64,AAAA');
  const repeated = await request(h, '/slideshow-config').set('If-None-Match', first.headers.etag);
  assert.equal(repeated.status, 304);
  assert.equal(repeated.text, '');
  h.data.config.slideshow.slides[0].imagen_b64 = 'data:image/png;base64,BBBB';
  h.prod.write(h.data);
  const edited = await request(h, '/slideshow-config').set('If-None-Match', first.headers.etag);
  assert.equal(edited.status, 200);
  assert.notEqual(edited.headers.etag, first.headers.etag);
  const full = await request(h, '/config');
  const summary = await request(h, '/config', { resumen: '1' });
  assert.ok(full.body.slideshow);
  assert.equal(summary.body.slideshow, undefined);
  assert.equal(summary.body.ciclos_objetivo_l3, full.body.ciclos_objetivo_l3);
});
test('las validaciones fallidas se mantienen y no se almacenan como éxito', async () => {
  const h = load();
  assert.equal((await request(h, '/stats/operador-semana')).status, 400);
  assert.equal((await request(h, '/kpis', { desde: 'invalid' })).status, 400);
});


test('cambiar objetivos, horarios y restaurar datos invalida resultados existentes', async () => {
  const h = load();
  const first = await request(h, '/pizarron', boardQuery);
  h.data.config.ciclos_objetivo_l3 = 4;
  h.prod.write(h.data, 'config');
  const edited = await request(h, '/pizarron', boardQuery);
  assert.notEqual(edited.body.data.L3.T1.totals.objetivo_eficiencia, first.body.data.L3.T1.totals.objetivo_eficiencia);
  h.data.turno_l4_config[0].dias.sabado.activo = false;
  h.prod.write(h.data, 'turno_l4_config');
  assert.equal((await request(h, '/pizarron', boardQuery)).body.data.L4.TL4, undefined);
  const restored = JSON.parse(JSON.stringify(h.data));
  restored.cargas[0].cantidad = 88;
  h.prod.write(restored);
  assert.equal((await request(h, '/pizarron', boardQuery)).body.data.L3.T1.totals.piezas_total, 88);
});
test('cancelar o borrar una carga desaparece de los totales ya consultados', async () => {
  const h = load();
  await request(h, '/pizarron', boardQuery);
  h.data.cargas[0].estado = 'cancelado';
  h.prod.write(h.data);
  assert.equal((await request(h, '/pizarron', boardQuery)).body.data.L3.T1.totals.ciclos_totales, 0);
  h.data.cargas_l1.splice(0, 1);
  h.prod.write(h.data, 'cargas_l1');
  assert.equal((await request(h, '/pizarron', boardQuery)).body.data.L1.T1.totals.ciclos_totales, 0);
});
test('paros que cruzan medianoche conservan el solapamiento de T3', async () => {
  const h = load();
  h.data.paros.push({ id: 1, linea: 'L3', fecha_inicio: '2026-10-09', hora_inicio: '23:30',
    fecha_fin: '2026-10-10', hora_fin: '00:30', duracion_min: 60, motivo: 'Nocturno' });
  h.prod.write(h.data);
  const res = await request(h, '/pizarron', { linea: 'L3', fecha: '2026-10-09', turno: 'T3' });
  assert.equal(res.body.data.L3.T3.totals.paros_min, 60);
});
