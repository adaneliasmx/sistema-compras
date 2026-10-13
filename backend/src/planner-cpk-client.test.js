'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadForm() {
  const file = path.join(__dirname, '../../frontend/public/planner-staff/index.html');
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('async function renderCpkForm(container) {');
  const end = source.indexOf('function renderSgcForm(', start);
  assert.ok(start >= 0 && end > start);
  const nodes = new Map();
  const calls = [], alerts = [];
  let html = '';
  // Model DOM replacement: assigning innerHTML removes the previous inputs.
  const container = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      nodes.clear();
      for (const match of value.matchAll(/id="(cpk_desde|cpk_hasta)" value="([^"]*)"/g)) {
        nodes.set(match[1], { value: match[2] });
      }
    }
  };
  const context = vm.createContext({
    _dailyRegistro: null,
    document: { getElementById: id => nodes.get(id) || null },
    alert: message => alerts.push(message),
    esc: value => String(value ?? ''),
    dailyFormWrap: (_title, content) => content,
    apiFetch: async url => {
      calls.push(url);
      if (url.startsWith('/api/planner/integracion/vales/cpk')) {
        const query = new URL(url, 'http://test.local').searchParams;
        return { titulaciones: {}, cpk_params: [], semana: {
          ini: query.get('desde') || '2026-10-12', fin: query.get('hasta') || '2026-10-18'
        } };
      }
      assert.equal(url.replace('/empaque/', '/vales/'), calls[calls.length - 2]);
      return { partes: [] };
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    container, nodes, calls, alerts,
    render: () => context.renderCpkForm(container),
    setRange: (desde, hasta) => {
      nodes.get('cpk_desde').value = desde;
      nodes.get('cpk_hasta').value = hasta;
    }
  };
}

test('entrada inicial usa el periodo predeterminado y muestra las fechas devueltas', async () => {
  const form = loadForm();
  await form.render();
  assert.equal(form.calls[0], '/api/planner/integracion/vales/cpk');
  assert.equal(form.nodes.get('cpk_desde').value, '2026-10-12');
  assert.equal(form.nodes.get('cpk_hasta').value, '2026-10-18');
  assert.equal(form.alerts.length, 0);
});

test('consultar conserva el rango personalizado incluso sin muestras y en consultas sucesivas', async () => {
  const form = loadForm();
  await form.render();
  for (const [desde, hasta] of [['2026-09-01', '2026-09-30'], ['2026-10-05', '2026-10-11']]) {
    form.setRange(desde, hasta);
    form.calls.length = 0;
    await form.render();
    assert.equal(form.calls[0], `/api/planner/integracion/vales/cpk?desde=${desde}&hasta=${hasta}`);
    assert.equal(form.nodes.get('cpk_desde').value, desde);
    assert.equal(form.nodes.get('cpk_hasta').value, hasta);
    assert.match(form.container.innerHTML, /Sin datos de Peso Fosfato disponibles/);
  }
});

test('permite consultar un solo dia', async () => {
  const form = loadForm();
  await form.render();
  form.setRange('2026-10-09', '2026-10-09');
  form.calls.length = 0;
  await form.render();
  assert.equal(form.calls[0], '/api/planner/integracion/vales/cpk?desde=2026-10-09&hasta=2026-10-09');
  assert.equal(form.alerts.length, 0);
});

test('rango invertido avisa sin consultar ni borrar el formulario', async () => {
  const form = loadForm();
  await form.render();
  form.setRange('2026-10-12', '2026-10-05');
  const previousHtml = form.container.innerHTML;
  form.calls.length = 0;
  await form.render();
  assert.equal(form.calls.length, 0);
  assert.match(form.alerts[0], /Desde.*posterior.*Hasta/);
  assert.equal(form.container.innerHTML, previousHtml);
  assert.equal(form.nodes.get('cpk_hasta').value, '2026-10-05');
});

test('rango incompleto pide ambas fechas sin consultar ni borrar la seleccion', async () => {
  for (const range of [['2026-10-05', ''], ['', '2026-10-11']]) {
    const form = loadForm();
    await form.render();
    form.setRange(...range);
    form.calls.length = 0;
    await form.render();
    assert.equal(form.calls.length, 0);
    assert.match(form.alerts[0], /ambas fechas/);
    assert.equal(form.nodes.get('cpk_desde').value, range[0]);
    assert.equal(form.nodes.get('cpk_hasta').value, range[1]);
  }
});
