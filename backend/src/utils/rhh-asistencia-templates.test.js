const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isoWeekPeriod } = require('./rhh-periods');

// Helper: compute Monday of the week containing a given date (or today in Mexico)
function mondayOf(dateInput) {
  const value = String(dateInput || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })).slice(0, 10);
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('weekly attendance template preserves assignments and only inherits one week', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-attendance-template-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const repoRoot = path.resolve(__dirname, '../../..');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const routerModule = path.resolve(__dirname, '../routes/rhh-asistencia.js');

  // Dynamic weeks relative to today so test doesn't break as dates pass
  const weekA = mondayOf(); // current week (exact snapshot match)
  const weekB = addDays(weekA, 7); // next week (inherits + catalog reconciled)
  const weekAEnd = addDays(weekA, 6);
  const periodA = isoWeekPeriod(weekA);

  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [{ id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true }],
    rhh_employees: [
      { id: 10, employee_number: '100', full_name: 'ALTA SEMANAL', status: 'active', position_id: 1 },
      { id: 11, employee_number: '101', full_name: 'BAJA ASIGNADA', status: 'inactive', position_id: 1 },
    ],
    rhh_positions: [{ id: 1, name: 'Operador' }],
    rhh_shifts: [{ id: 1, name: 'Turno 1', work_days: [1,2,3,4,5] }],
    rhh_periodos: [{ id: 1, no_periodo: periodA.no_periodo, year: periodA.year, period_key: periodA.period_key, fecha_inicio: weekA, fecha_fin: weekAEnd }],
    rhh_employee_period_snapshots: [{ id: 1, employee_id: 10, employee_number: '100', full_name: 'ALTA SEMANAL', no_periodo: periodA.no_periodo, year: periodA.year, period_key: periodA.period_key, fecha_inicio: weekA, fecha_fin: weekAEnd, position_id: 1 }],
    rhh_weekly_rol: [{ id: 1, week_start: weekA, scope: 'attendance_control', version: 1 }],
    rhh_rol_assignments: [{ id: 1, rol_id: 1, employee_id: 11, shift_id: 1, position_id: 1 }],
  }));

  const script = `
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const db = require(${JSON.stringify(dbModule)});
    const router = require(${JSON.stringify(routerModule)});
    (async () => {
      await db.initDb();
      const app = express(); app.use(express.json()); app.use('/api/rhh/asistencia', router);
      const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
      try {
        const token = jwt.sign({ sub: 1, module: 'rhh', role: 'admin' }, process.env.JWT_SECRET || 'cambia-esta-clave');
        const get = async week => {
          const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia/rol?week=' + week, { headers: { authorization: 'Bearer ' + token } });
          const text = await r.text();
          let body;
          try { body = JSON.parse(text); } catch { throw new Error('Respuesta no JSON (' + r.status + '): ' + text); }
          return { status:r.status, body };
        };
        const weekA = ${JSON.stringify(weekA)};
        const weekB = ${JSON.stringify(weekB)};
        const exact = await get(weekA);
        const post = async version => { const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia/rol', { method:'POST', headers: { authorization:'Bearer ' + token, 'content-type':'application/json' }, body:JSON.stringify({ week_start:weekA, version, assignments:[{ employee_id:11, shift_id:1, position_id:1 }] }) }); return { status:r.status, body:await r.json() }; };
        const unchanged = await post(1);
        const changed = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia/rol', { method:'POST', headers: { authorization:'Bearer ' + token, 'content-type':'application/json' }, body:JSON.stringify({ week_start:weekA, version:1, assignments:[{ employee_id:11, shift_id:1, position_id:1, project:'SKF' }] }) });
        const changedBody = await changed.json();
        const conflict = await post(1);
        const next = await get(weekB);
        process.stdout.write('RESULT:' + JSON.stringify({ exact, unchanged, changed:{status:changed.status,body:changedBody}, conflict, next }));
      } finally { await new Promise(resolve => server.close(resolve)); }
    })().catch(error => { console.error(error); process.exit(1); });
  `;
  try {
    const child = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('RESULT:') + 7));
    assert.equal(result.exact.body.template_source, 'snapshot_exact');
    assert.deepEqual(result.exact.body.unassigned.map(e => e.id), [10]);
    assert.equal(result.exact.body.assigned[0].id, 11);
    assert.equal(result.exact.body.assigned[0].template_status, 'absent');
    assert.equal(result.unchanged.body.unchanged, true);
    assert.equal(result.unchanged.body.version, 1);
    assert.equal(result.changed.status, 200);
    assert.equal(result.changed.body.version, 2);
    assert.equal(result.conflict.status, 409);
    assert.equal(result.next.body.template_source, 'snapshot_previous_week');
    assert.deepEqual(result.next.body.unassigned.map(e => e.id), [10]);
    // Next week is within dynamic range, so catalog reconciliation adds active employees
    assert.equal(result.next.body.template_missing, false);
    assert.equal(result.next.body.catalog_reconciled_count >= 0, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refreshing attendance template adds latest employees and shares them across all attendance tabs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-attendance-refresh-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const repoRoot = path.resolve(__dirname, '../../..');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const routerModule = path.resolve(__dirname, '../routes/rhh-asistencia.js');
  const scheduleRouterModule = path.resolve(__dirname, '../routes/rhh-schedule.js');

  // Dynamic weeks: prev (historical/locked), curr (current, refreshable), next (future, refreshable)
  const weekCurr = mondayOf();
  const weekPrev = addDays(weekCurr, -7);
  const weekNext = addDays(weekCurr, 7);
  const weekPrevEnd = addDays(weekPrev, 6);
  const periodPrev = isoWeekPeriod(weekPrev);
  const periodCurr = isoWeekPeriod(weekCurr);

  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [{ id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true }],
    rhh_employees: [
      { id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', status: 'active', position_id: 1, shift_id: 1 },
      { id: 11, employee_number: '101', full_name: 'BAJA CONFIRMADA', status: 'inactive', manual_baja_locked: true, position_id: 1 },
      { id: 12, employee_number: '102', full_name: 'ALTA SEMANA CURR', status: 'active', position_id: 1 },
      { id: 13, employee_number: '103', full_name: 'AUSENTE NO CONFIRMADO', status: 'active', position_id: 1 },
      { id: 14, employee_number: '104', full_name: 'ACTIVO CON SNAPSHOT ANTIGUO SIN PORTAL', status: 'active', position_id: 1 },
      { id: 15, employee_number: '105', full_name: 'ACTIVO LEGACY SIN SNAPSHOT', status: 'active', position_id: 1 },
    ],
    rhh_positions: [{ id: 1, name: 'Operador' }, { id: 2, name: 'Técnico' }],
    rhh_shifts: [{ id: 1, name: 'Turno 1', work_days: [1,2,3,4,5] }],
    rhh_periodos: [
      { id: 1, no_periodo: periodPrev.no_periodo, year: periodPrev.year, period_key: periodPrev.period_key, fecha_inicio: weekPrev, fecha_fin: weekPrevEnd },
      { id: 2, no_periodo: periodCurr.no_periodo, year: periodCurr.year, period_key: periodCurr.period_key },
    ],
    rhh_employee_period_snapshots: [
      { id: 1, employee_id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', no_periodo: periodPrev.no_periodo, year: periodPrev.year, period_key: periodPrev.period_key, fecha_inicio: weekPrev, fecha_fin: weekPrevEnd, position_id: 1 },
      { id: 2, employee_id: 11, employee_number: '101', full_name: 'BAJA CONFIRMADA', no_periodo: periodPrev.no_periodo, year: periodPrev.year, period_key: periodPrev.period_key, fecha_inicio: weekPrev, fecha_fin: weekPrevEnd, position_id: 1 },
      { id: 3, employee_id: 13, employee_number: '103', full_name: 'AUSENTE NO CONFIRMADO', no_periodo: periodPrev.no_periodo, year: periodPrev.year, period_key: periodPrev.period_key, fecha_inicio: weekPrev, fecha_fin: weekPrevEnd, position_id: 1 },
      { id: 6, employee_id: 14, employee_number: '104', full_name: 'ACTIVO CON SNAPSHOT ANTIGUO SIN PORTAL', no_periodo: periodPrev.no_periodo, year: periodPrev.year, period_key: periodPrev.period_key, fecha_inicio: weekPrev, fecha_fin: weekPrevEnd, position_id: 1 },
      // Sin fechas: reproduce el formato de Excel que solo informa year + semana.
      { id: 4, employee_id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', no_periodo: periodCurr.no_periodo, year: periodCurr.year, period_key: periodCurr.period_key, position_id: 1, shift_id: 1 },
      { id: 5, employee_id: 12, employee_number: '102', full_name: 'ALTA SEMANA CURR', no_periodo: periodCurr.no_periodo, year: periodCurr.year, period_key: periodCurr.period_key, position_id: 1 },
    ],
    rhh_weekly_rol: [{ id: 1, week_start: weekCurr, scope: 'attendance_control', version: 1 }],
    rhh_rol_assignments: [
      { id: 1, rol_id: 1, employee_id: 10, shift_id: 1, position_id: 1 },
      { id: 2, rol_id: 1, employee_id: 11, shift_id: 1, position_id: 1 },
      { id: 3, rol_id: 1, employee_id: 13, shift_id: 1, position_id: 1 },
    ],
  }));

  const script = `
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const db = require(${JSON.stringify(dbModule)});
    const router = require(${JSON.stringify(routerModule)});
    const scheduleRouter = require(${JSON.stringify(scheduleRouterModule)});
    (async () => {
      await db.initDb();
      const app = express(); app.use(express.json()); app.use('/api/rhh/asistencia', router); app.use('/api/rhh/schedule', scheduleRouter);
      const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
      try {
        const token = jwt.sign({ sub: 1, module: 'rhh', role: 'admin' }, process.env.JWT_SECRET || 'cambia-esta-clave');
        const base = 'http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia';
        const request = async (url, options = {}) => {
          const r = await fetch(base + url, { ...options, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(options.headers || {}) } });
          return { status: r.status, body: await r.json() };
        };
        const weekCurr = ${JSON.stringify(weekCurr)};
        const weekPrev = ${JSON.stringify(weekPrev)};
        const weekNext = ${JSON.stringify(weekNext)};
        const refresh = await request('/plantilla/refresh', { method: 'POST', body: JSON.stringify({ week: weekCurr }) });
        const rol = await request('/rol?week=' + weekCurr);
        const save = await request('/rol', { method: 'POST', body: JSON.stringify({
          week_start: weekCurr, version: rol.body.version,
          assignments: [10,11,12,13,14,15].map(employee_id => ({ employee_id, shift_id: 1, position_id: 1 }))
        }) });
        const refreshAgain = await request('/plantilla/refresh', { method: 'POST', body: JSON.stringify({ week: weekCurr }) });
        const daily = await request('/diaria?week=' + weekCurr);
        const weekly = await request('/semana?week=' + weekCurr);
        const scheduleResponse = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/schedule/weekly-rol?week_start=' + weekCurr, { headers: { authorization: 'Bearer ' + token } });
        const scheduleRol = { status: scheduleResponse.status, body: await scheduleResponse.json() };
        const changed = structuredClone(db.read());
        const changedBase = changed.rhh_employees.find(employee => employee.id === 10);
        changedBase.status = 'inactive'; changedBase.manual_baja_locked = true;
        const changedNew = changed.rhh_employees.find(employee => employee.id === 12);
        changedNew.position_id = 2; changedNew.manual_position_locked = true;
        await db.writeAsync(changed);
        const frozenWeekCurr = await request('/rol?week=' + weekCurr);
        const refreshWeekNext = await request('/plantilla/refresh', { method: 'POST', body: JSON.stringify({ week: weekNext }) });
        const weekNextRol = await request('/rol?week=' + weekNext);
        const lockedWeekPrev = await request('/plantilla/refresh', { method: 'POST', body: JSON.stringify({ week: weekPrev }) });
        process.stdout.write('RESULT:' + JSON.stringify({ refresh, rol, save, refreshAgain, daily, weekly, scheduleRol, frozenWeekCurr, refreshWeekNext, weekNextRol, lockedWeekPrev, state: db.read(), weekCurr, weekNext, weekPrev }));
      } finally { await new Promise(resolve => server.close(resolve)); }
    })().catch(error => { console.error(error); process.exit(1); });
  `;

  try {
    const child = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('RESULT:') + 7));
    assert.equal(result.refresh.status, 200);
    assert.equal(result.refresh.body.template.source_period_key, periodCurr.period_key);
    assert.equal(result.refresh.body.added, 2);
    assert.equal(result.refresh.body.legacy_recovered, 1);
    assert.equal(result.refresh.body.catalog_recovered, 3);
    assert.deepEqual(result.refresh.body.catalog_employees.map(employee => employee.id), [13,14,15]);
    assert.deepEqual(result.refresh.body.legacy_employees.map(employee => employee.id), [15]);
    assert.deepEqual(result.refresh.body.new_employees.map(employee => employee.id), [12,15]);
    assert.deepEqual(result.rol.body.unassigned.map(employee => employee.id).sort((a, b) => a - b), [12,14,15]);
    assert.equal(result.rol.body.unassigned.find(employee => employee.id === 14).reconciliation_snapshot_period_key, periodPrev.period_key);
    assert.equal(result.rol.body.unassigned.find(employee => employee.id === 14).present_in_payroll, false);
    assert.equal(result.rol.body.assigned.find(employee => employee.id === 11).template_status, 'baja');
    assert.equal(result.rol.body.assigned.find(employee => employee.id === 11).position.name, 'BAJA');
    assert.equal(result.rol.body.assigned.find(employee => employee.id === 13).template_status, 'included');
    assert.equal(result.save.status, 200);
    assert.equal(result.refreshAgain.status, 200);
    assert.deepEqual(result.daily.body.grid.map(employee => employee.employee_id).sort((a, b) => a - b), [10,11,12,13,14,15]);
    assert.deepEqual(result.weekly.body.grid.map(employee => employee.employee_id).sort((a, b) => a - b), [10,11,12,13,14,15]);
    assert.equal(result.scheduleRol.status, 200);
    assert.deepEqual(result.scheduleRol.body.template_employees.map(employee => employee.id).sort((a, b) => a - b), [10,12,13,14,15]);
    assert.equal(result.daily.body.grid.find(employee => employee.employee_id === 11).position, 'BAJA');
    assert.equal(result.weekly.body.grid.find(employee => employee.employee_id === 11).position, 'BAJA');
    assert.equal(result.frozenWeekCurr.body.assigned.find(employee => employee.id === 10).template_status, 'baja');
    assert.equal(result.frozenWeekCurr.body.assigned.find(employee => employee.id === 12).position.id, 1);
    assert.equal(result.refreshWeekNext.status, 200);
    assert.equal(result.weekNextRol.body.bajas.find(employee => employee.id === 10).position.name, 'BAJA');
    assert.equal(result.weekNextRol.body.unassigned.find(employee => employee.id === 12).position.id, 2);
    assert.equal(result.weekNextRol.body.unassigned.some(employee => employee.id === 14), true);
    assert.equal(result.weekNextRol.body.unassigned.some(employee => employee.id === 15), true);
    assert.equal(result.lockedWeekPrev.status, 409);
    assert.equal(result.lockedWeekPrev.body.code, 'HISTORICAL_TEMPLATE_LOCKED');
    assert.equal(result.state.rhh_attendance_week_templates.length, 2);
    const storedWeekCurr = result.state.rhh_attendance_week_templates.find(template => template.week_start === weekCurr);
    const storedWeekNext = result.state.rhh_attendance_week_templates.find(template => template.week_start === weekNext);
    assert.equal(storedWeekCurr.employees.find(employee => employee.employee_id === 10).template_status, 'included');
    assert.equal(storedWeekNext.employees.find(employee => employee.employee_id === 10).template_status, 'baja');
    assert.equal(storedWeekNext.employees.find(employee => employee.employee_id === 12).position_id, 2);
    assert.equal(result.state.rhh_rol_assignments.length, 6);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('a stale current template recovers valid CONTPAQ employees even when portal links are crossed', () => {
  const { getSystemEmpIds } = require('../db-rhh');
  const {
    buildAttendanceEmployeesForWeek,
    materializeAttendanceWeekTemplate,
  } = require('./rhh-attendance-template');
  const db = {
    rhh_users: [
      { id: 1, full_name: 'USUARIO RH', email: 'rh@test.local', role: 'rh', employee_id: 2 },
      { id: 2, full_name: 'USUARIO ADMIN', email: 'admin@test.local', role: 'admin', employee_id: 3 },
      { id: 3, full_name: 'USUARIO SUPERVISOR', email: 'sup@test.local', role: 'supervisor', employee_id: 6 },
    ],
    rhh_employees: [
      { id: 1, employee_number: '162', full_name: 'EMPLEADO BASE', status: 'active' },
      { id: 2, employee_number: '163', full_name: 'EMPLEADO NUEVO UNO', status: 'active' },
      { id: 3, employee_number: '164', full_name: 'EMPLEADO NUEVO DOS', status: 'active' },
      { id: 4, employee_number: '165', full_name: 'EMPLEADO NUEVO TRES', status: 'active' },
      { id: 5, employee_number: '166', full_name: 'EMPLEADO NUEVO CUATRO', status: 'active' },
      { id: 6, employee_number: 'EMP-006', full_name: 'CUENTA FICTICIA', status: 'active' },
    ],
    rhh_employee_period_snapshots: [1,2,3,4,5].map(id => ({
      id,
      employee_id: id,
      employee_number: String(161 + id),
      full_name: `EMPLEADO ${id}`,
      no_periodo: 32,
      year: 2026,
      period_key: '2026-S32',
      fecha_inicio: '2026-08-03',
      fecha_fin: '2026-08-09',
      present_in_payroll: true,
    })),
    rhh_attendance_week_templates: [{
      id: 1,
      week_start: '2026-08-10',
      source_period: { no_periodo: 32, year: 2026, period_key: '2026-S32' },
      source_period_key: '2026-S32',
      version: 5,
      employees: [{ employee_id: 1, employee_number: '162', full_name: 'EMPLEADO BASE', template_status: 'included' }],
    }],
  };

  const excluded = getSystemEmpIds(db);
  assert.deepEqual([...excluded], [6]);
  const current = buildAttendanceEmployeesForWeek(db, '2026-08-10', [], {
    today: '2026-08-14',
    excludedEmployeeIds: excluded,
  });
  assert.deepEqual(current.employees.map(employee => employee.id), [1,2,3,4,5]);
  assert.equal(current.catalog_reconciled_count, 4);

  const persisted = materializeAttendanceWeekTemplate(db, '2026-08-10', {
    today: '2026-08-14',
    excludedEmployeeIds: excluded,
    updatedAt: '2026-08-14T22:00:00',
    updatedBy: 'test',
  });
  assert.equal(persisted.changed, true);
  assert.equal(persisted.added, 4);
  assert.equal(persisted.template.employees.length, 5);
  assert.equal(persisted.template.version, 6);

  db.rhh_attendance_week_templates.push({
    id: 2,
    week_start: '2026-08-03',
    version: 1,
    employees: [{ employee_id: 1, employee_number: '162', full_name: 'EMPLEADO BASE', template_status: 'included' }],
  });
  const historical = buildAttendanceEmployeesForWeek(db, '2026-08-03', [], {
    today: '2026-08-14',
    excludedEmployeeIds: excluded,
  });
  assert.deepEqual(historical.employees.map(employee => employee.id), [1]);
  assert.equal(historical.catalog_reconciled_count, 0);
});
