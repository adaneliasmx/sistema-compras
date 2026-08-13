const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  calculatePaidDays,
  mergeEmployeesFromSeed,
  mergeWeeklyIncident,
} = require('./rhh-data-integrity');

test('deploy merge preserves every persisted employee field', () => {
  const existing = [{
    id: 10,
    employee_number: '00123',
    full_name: 'Nombre actualizado en producción',
    position_id: 99,
    status: 'inactive',
    manual_position_locked: true,
    manual_baja_locked: true,
    status_source: 'manual',
    baja_confirmada_por: 'rh@empresa.test',
    future_metadata: { source: 'production' },
  }];
  const seed = [{
    id: 2,
    employee_number: '123',
    full_name: 'Nombre viejo del seed',
    position_id: 3,
    status: 'active',
    rfc: 'RFC123',
  }];

  const result = mergeEmployeesFromSeed(existing, seed);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 10);
  assert.equal(result[0].full_name, 'Nombre actualizado en producción');
  assert.equal(result[0].position_id, 99);
  assert.equal(result[0].status, 'inactive');
  assert.equal(result[0].manual_position_locked, true);
  assert.equal(result[0].manual_baja_locked, true);
  assert.equal(result[0].baja_confirmada_por, 'rh@empresa.test');
  assert.deepEqual(result[0].future_metadata, { source: 'production' });
  assert.equal(result[0].rfc, 'RFC123');
});

test('deploy merge retains production-only employees and adds new seed employees safely', () => {
  const existing = [
    { id: 1, employee_number: '900', full_name: 'Producción' },
    { id: 5, employee_number: '901', full_name: 'Alta importada' },
  ];
  const seed = [
    { id: 1, employee_number: '900', full_name: 'Seed existente' },
    { id: 5, employee_number: '902', full_name: 'Empleado nuevo del seed' },
  ];

  const result = mergeEmployeesFromSeed(existing, seed);

  assert.equal(result.length, 3);
  assert.equal(result.find(e => e.employee_number === '901').full_name, 'Alta importada');
  assert.equal(result.find(e => e.employee_number === '902').id, 6);
  assert.equal(new Set(result.map(e => e.id)).size, result.length);
});

test('weekly save preserves imported payroll payload and real paid days', () => {
  const existing = {
    id: 77,
    employee_id: 10,
    no_periodo: 31,
    dias_pagados: 5.83,
    faltas: 0,
    percepciones: { '1 Sueldo': 1500, '32 Despensa': 200 },
    deducciones: { '45 ISR': 120 },
    total_perc_pdf: 1700,
    total_ded_pdf: 120,
    neto_pdf: 1580,
    fecha_inicio: '27/Jul/2026',
    fecha_fin: '02/Ago/2026',
    source: 'consolidado_import',
    created_at: '2026-08-01T10:00:00.000Z',
  };

  const result = mergeWeeklyIncident(existing, {
    employee_id: 10,
    dias_pagados: 5.83,
    faltas: 0,
    horas_extras_total: 2,
    gratificacion: 1,
    notas: 'Revisado por RH',
  }, {
    no_periodo: 31,
    updated_by: 4,
    now: '2026-08-13T12:00:00.000Z',
    id: 99,
  });

  assert.equal(result.id, 77);
  assert.equal(result.dias_pagados, 5.83);
  assert.deepEqual(result.percepciones, existing.percepciones);
  assert.deepEqual(result.deducciones, existing.deducciones);
  assert.equal(result.neto_pdf, 1580);
  assert.equal(result.fecha_inicio, '27/Jul/2026');
  assert.equal(result.source, 'consolidado_import');
  assert.equal(result.year, 2026);
  assert.equal(result.period_key, '2026-S31');
  assert.equal(result.gratificacion, 1);
  assert.equal(result.created_at, existing.created_at);
});

test('weekly save calculates paid days only when client does not provide them', () => {
  const result = mergeWeeklyIncident(null, {
    employee_id: 22,
    faltas: 2,
  }, {
    no_periodo: 31,
    updated_by: 4,
    now: '2026-08-13T12:00:00.000Z',
    id: 100,
  });

  assert.equal(result.dias_pagados, calculatePaidDays(2));
  assert.equal(result.dias_pagados, 4.67);
});

test('persistence queue flushes background writes in their original order', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-write-queue-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const script = `
    const fs = require('node:fs');
    const db = require(${JSON.stringify(dbModule)});
    (async () => {
      await db.initDb();
      for (let sequence = 1; sequence <= 25; sequence++) {
        db.write({ ...db.read(), queue_test_sequence: sequence });
      }
      await db.writeAsync({ ...db.read(), queue_test_barrier: true });
      const persisted = JSON.parse(fs.readFileSync(process.env.DB_RHH_PATH, 'utf8'));
      process.stdout.write(JSON.stringify({
        sequence: persisted.queue_test_sequence,
        barrier: persisted.queue_test_barrier,
      }));
    })().catch(error => { console.error(error); process.exit(1); });
  `;

  try {
    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const jsonStart = child.stdout.lastIndexOf('{');
    const result = JSON.parse(child.stdout.slice(jsonStart));
    assert.deepEqual(result, { sequence: 25, barrier: true });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('failed persistence rolls cache back when no newer write supersedes it', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-write-rollback-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const script = `
    const fs = require('node:fs');
    const db = require(${JSON.stringify(dbModule)});
    (async () => {
      await db.initDb();
      await db.writeAsync({ ...db.read(), stable_value: 'persisted' });
      fs.rmSync(process.env.DB_RHH_PATH, { force: true });
      fs.mkdirSync(process.env.DB_RHH_PATH);
      let failed = false;
      try { await db.writeAsync({ ...db.read(), stable_value: 'not-persisted' }); }
      catch (_) { failed = true; }
      process.stdout.write('RESULT:' + JSON.stringify({ failed, cached: db.read().stable_value }));
    })().catch(error => { console.error(error); process.exit(1); });
  `;
  try {
    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const marker = child.stdout.lastIndexOf('RESULT:');
    const result = JSON.parse(child.stdout.slice(marker + 7));
    assert.deepEqual(result, { failed: true, cached: 'persisted' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
