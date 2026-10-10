'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function loadClient(fetch) {
  const timers = new Map();
  let nextTimer = 0;
  const sandbox = {
    fetch, localStorage: { getItem: () => null, removeItem() {} },
    document: { getElementById: () => ({ style: {} }) },
    setInterval: fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearInterval: id => timers.delete(id), clearTimeout() {}, console
  };
  let source = fs.readFileSync(path.join(__dirname, '../../frontend/public/produccion/slideshow.js'), 'utf8');
  source = source.slice(0, source.indexOf("  if (document.readyState === 'loading') {")) + [
    '  globalThis.client = { apiFetch, startDataRefresh, startClock, doLogout,',
    '    setToken(value) { token = value; },',
    '    stubRefresh(fn) { fetchKpi = fn; fetchWeeklyKpi = fetchScrap = fetchWeeklyScrap = fetchReconocimientos = fetchConfig = async () => {};',
    '      buildSlides = renderCurrentSlide = () => {}; } };',
    '})();'
  ].join('\n');
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  return { client: context.client, timers };
}
test('cliente reutiliza JSON de slideshow ante 304 y conserva las imágenes', async () => {
  const calls = [];
  const image = { slideshow: { slides: [{ imagen_b64: 'data:image/png;base64,AAAA' }] } };
  const { client } = loadClient(async (url, opts) => {
    calls.push(opts.headers);
    return calls.length === 1
      ? { status: 200, ok: true, json: async () => image, headers: { get: () => '"v1"' } }
      : { status: 304, ok: false, json: () => { throw new Error('304 no tiene JSON'); } };
  });
  client.setToken('test');
  const first = await client.apiFetch('/slideshow-config');
  const next = await client.apiFetch('/slideshow-config');
  assert.equal(next, first);
  assert.equal(calls[1]['If-None-Match'], '"v1"');
});
test('reiniciar refresco y reloj no acumula intervalos; logout los elimina', () => {
  const { client, timers } = loadClient(() => { throw new Error('red prohibida'); });
  client.setToken('test');
  client.startDataRefresh();
  client.startDataRefresh();
  client.startClock();
  client.startClock();
  assert.equal(timers.size, 2);
  client.doLogout();
  assert.equal(timers.size, 0);
});
test('dos ticks mientras una consulta sigue pendiente no duplican el refresco', async () => {
  const { client, timers } = loadClient(() => { throw new Error('red prohibida'); });
  client.setToken('test');
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  client.stubRefresh(async () => { calls++; await pending; });
  client.startDataRefresh();
  const tick = [...timers.values()][0];
  const first = tick();
  await tick();
  assert.equal(calls, 1);
  release();
  await first;
});
