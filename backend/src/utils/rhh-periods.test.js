const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalPeriod,
  backfillCanonicalPeriodFields,
  comparePeriods,
  getEmployeeTemplateForWeek,
  parsePeriodDate,
  resolveRequestedYear,
  samePeriod,
  upsertCanonicalPeriod,
  upsertEmployeePeriodSnapshot,
} = require('./rhh-periods');

test('normalizes Excel dates and Spanish text dates', () => {
  assert.equal(parsePeriodDate('30/Dic/2025'), '2025-12-30');
  assert.equal(parsePeriodDate('05/Ene/2026'), '2026-01-05');
  assert.equal(parsePeriodDate('03/08/2026'), '2026-08-03');
  assert.equal(parsePeriodDate(46022), '2025-12-31');
});

test('period crossing December and January belongs to end-date year', () => {
  const period = canonicalPeriod({
    no_periodo: 1,
    fecha_inicio: '30/Dic/2025',
    fecha_fin: '05/Ene/2026',
  });

  assert.equal(period.year, 2026);
  assert.equal(period.period_key, '2026-S01');
  assert.equal(period.fecha_inicio, '2025-12-30');
  assert.equal(period.fecha_fin, '2026-01-05');
});

test('same week in different years creates distinct periods and snapshots', () => {
  const periods = [];
  upsertCanonicalPeriod(periods, { no_periodo: 1, year: 2026, fecha_fin: '2026-01-05' });
  upsertCanonicalPeriod(periods, { no_periodo: 1, year: 2027, fecha_fin: '2027-01-04' });
  assert.equal(periods.length, 2);
  assert.equal(samePeriod(periods[0], 1, 2027), false);

  const snapshots = [];
  upsertEmployeePeriodSnapshot(snapshots, {
    employee_id: 10, no_periodo: 1, year: 2026, full_name: 'Empleado', position_name: 'Puesto 2026',
  });
  upsertEmployeePeriodSnapshot(snapshots, {
    employee_id: 10, no_periodo: 1, year: 2027, full_name: 'Empleado', position_name: 'Puesto 2027',
  });
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.find(s => s.year === 2026).position_name, 'Puesto 2026');
  assert.equal(snapshots.find(s => s.year === 2027).position_name, 'Puesto 2027');
});

test('reimport updates only the snapshot for the same canonical period', () => {
  const snapshots = [];
  upsertEmployeePeriodSnapshot(snapshots, {
    employee_id: 10, no_periodo: 31, year: 2026, sal_diario: 300,
  });
  upsertEmployeePeriodSnapshot(snapshots, {
    employee_id: 10, no_periodo: 31, year: 2026, sal_diario: 325,
  });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].sal_diario, 325);
});

test('latest period is determined chronologically, not by largest week number', () => {
  const periods = [
    canonicalPeriod({ no_periodo: 52, year: 2026, fecha_fin: '2026-12-27' }),
    canonicalPeriod({ no_periodo: 1, year: 2027, fecha_fin: '2027-01-03' }),
  ];
  assert.equal(periods.sort(comparePeriods).at(-1).period_key, '2027-S01');
});

test('requests without year select newest available year while legacy data remains 2026', () => {
  assert.equal(samePeriod({ no_periodo: 1 }, 1, 2026), true);
  assert.equal(samePeriod({ no_periodo: 1 }, 1, 2027), false);
  assert.equal(resolveRequestedYear({ rhh_incidencias_semanales: [{ no_periodo: 31 }] }, 31), 2026);
  assert.equal(resolveRequestedYear({
    rhh_periodos: [
      { no_periodo: 1, year: 2026 },
      { no_periodo: 1, year: 2027 },
    ],
  }, 1), 2027);
});

test('weekly template uses exact snapshot and only inherits one following week', () => {
  const db = {
    rhh_employees: [{ id: 1, status: 'active', full_name: 'Catalog current' }],
    rhh_periodos: [{
      no_periodo: 31, year: 2026, fecha_inicio: '2026-07-27', fecha_fin: '2026-08-02',
    }],
    rhh_employee_period_snapshots: [{
      employee_id: 1, no_periodo: 31, year: 2026,
      fecha_inicio: '2026-07-27', fecha_fin: '2026-08-02', full_name: 'Snapshot S31',
    }],
  };
  assert.equal(getEmployeeTemplateForWeek(db, '2026-07-27').source, 'snapshot_exact');
  assert.equal(getEmployeeTemplateForWeek(db, '2026-08-03').source, 'snapshot_previous_week');
  assert.equal(getEmployeeTemplateForWeek(db, '2026-08-10').source, 'snapshot_missing');
});

test('backfill adds canonical fields without changing legacy business values', () => {
  const original = {
    rhh_employees: [{ id: 2, employee_number: '100', full_name: 'Empleado', department_id: 4, position_id: 5 }],
    rhh_incidencias_semanales: [{ id: 1, employee_id: 2, no_periodo: 31, dias_pagados: 5.83 }],
    rhh_te_solicitudes: [{ id: 2, no_periodo: 31, horas: 3 }],
    rhh_baja_candidatos: [{ id: 3, detected_week: 31 }],
  };
  const result = backfillCanonicalPeriodFields(original);
  assert.equal(original.rhh_incidencias_semanales[0].year, undefined);
  assert.equal(result.db.rhh_incidencias_semanales[0].period_key, '2026-S31');
  assert.equal(result.db.rhh_incidencias_semanales[0].dias_pagados, 5.83);
  assert.equal(result.db.rhh_te_solicitudes[0].period_key, '2026-S31');
  assert.equal(result.db.rhh_baja_candidatos[0].period_key, '2026-S31');
  assert.equal(result.stats.updated, 3);
  assert.equal(result.stats.snapshots_created, 1);
  assert.equal(result.db.rhh_employee_period_snapshots[0].backfill_quality, 'approximate_current_catalog');
  assert.equal(result.stats.ambiguous_rows.length, 3);
});
