const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('weekly attendance template preserves assignments and only inherits one week', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-attendance-template-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const repoRoot = path.resolve(__dirname, '../../..');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const routerModule = path.resolve(__dirname, '../routes/rhh-asistencia.js');
  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [{ id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true }],
    rhh_employees: [
      { id: 10, employee_number: '100', full_name: 'ALTA SEMANAL', status: 'active', position_id: 1 },
      { id: 11, employee_number: '101', full_name: 'BAJA ASIGNADA', status: 'inactive', position_id: 1 },
    ],
    rhh_positions: [{ id: 1, name: 'Operador' }],
    rhh_shifts: [{ id: 1, name: 'Turno 1', work_days: [1,2,3,4,5] }],
    rhh_periodos: [{ id: 1, no_periodo: 31, year: 2026, period_key: '2026-S31', fecha_inicio: '2026-07-27', fecha_fin: '2026-08-02' }],
    rhh_employee_period_snapshots: [{ id: 1, employee_id: 10, employee_number: '100', full_name: 'ALTA SEMANAL', no_periodo: 31, year: 2026, period_key: '2026-S31', fecha_inicio: '2026-07-27', fecha_fin: '2026-08-02', position_id: 1 }],
    rhh_weekly_rol: [{ id: 1, week_start: '2026-07-27', scope: 'attendance_control', version: 1 }],
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
        const get = async week => { const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia/rol?week=' + week, { headers: { authorization: 'Bearer ' + token } }); return { status:r.status, body:await r.json() }; };
        const exact = await get('2026-07-27');
        const post = async version => { const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia/rol', { method:'POST', headers: { authorization:'Bearer ' + token, 'content-type':'application/json' }, body:JSON.stringify({ week_start:'2026-07-27', version, assignments:[{ employee_id:11, shift_id:1, position_id:1 }] }) }); return { status:r.status, body:await r.json() }; };
        const unchanged = await post(1);
        const changed = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia/rol', { method:'POST', headers: { authorization:'Bearer ' + token, 'content-type':'application/json' }, body:JSON.stringify({ week_start:'2026-07-27', version:1, assignments:[{ employee_id:11, shift_id:1, position_id:1, project:'SKF' }] }) });
        const changedBody = await changed.json();
        const conflict = await post(1);
        const next = await get('2026-08-03');
        const far = await get('2026-08-10');
        process.stdout.write('RESULT:' + JSON.stringify({ exact, unchanged, changed:{status:changed.status,body:changedBody}, conflict, next, far }));
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
    assert.equal(result.far.body.template_missing, true);
    assert.deepEqual(result.far.body.unassigned, []);
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
  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [{ id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true }],
    rhh_employees: [
      { id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', status: 'active', position_id: 1, shift_id: 1 },
      { id: 11, employee_number: '101', full_name: 'BAJA CONFIRMADA', status: 'inactive', manual_baja_locked: true, position_id: 1 },
      { id: 12, employee_number: '102', full_name: 'ALTA SEMANA 33', status: 'active', position_id: 1 },
      { id: 13, employee_number: '103', full_name: 'AUSENTE NO CONFIRMADO', status: 'active', position_id: 1 },
    ],
    rhh_positions: [{ id: 1, name: 'Operador' }],
    rhh_shifts: [{ id: 1, name: 'Turno 1', work_days: [1,2,3,4,5] }],
    rhh_periodos: [
      { id: 1, no_periodo: 32, year: 2026, period_key: '2026-S32', fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09' },
      { id: 2, no_periodo: 33, year: 2026, period_key: '2026-S33' },
    ],
    rhh_employee_period_snapshots: [
      { id: 1, employee_id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', no_periodo: 32, year: 2026, period_key: '2026-S32', fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09', position_id: 1 },
      { id: 2, employee_id: 11, employee_number: '101', full_name: 'BAJA CONFIRMADA', no_periodo: 32, year: 2026, period_key: '2026-S32', fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09', position_id: 1 },
      { id: 3, employee_id: 13, employee_number: '103', full_name: 'AUSENTE NO CONFIRMADO', no_periodo: 32, year: 2026, period_key: '2026-S32', fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09', position_id: 1 },
      // Sin fechas: reproduce el formato de Excel que sólo informa año + semana.
      { id: 4, employee_id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', no_periodo: 33, year: 2026, period_key: '2026-S33', position_id: 1, shift_id: 1 },
      { id: 5, employee_id: 12, employee_number: '102', full_name: 'ALTA SEMANA 33', no_periodo: 33, year: 2026, period_key: '2026-S33', position_id: 1 },
    ],
    rhh_weekly_rol: [{ id: 1, week_start: '2026-08-10', scope: 'attendance_control', version: 1 }],
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
    (async () => {
      await db.initDb();
      const app = express(); app.use(express.json()); app.use('/api/rhh/asistencia', router);
      const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
      try {
        const token = jwt.sign({ sub: 1, module: 'rhh', role: 'admin' }, process.env.JWT_SECRET || 'cambia-esta-clave');
        const base = 'http://127.0.0.1:' + server.address().port + '/api/rhh/asistencia';
        const request = async (url, options = {}) => {
          const r = await fetch(base + url, { ...options, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(options.headers || {}) } });
          return { status: r.status, body: await r.json() };
        };
        const refresh = await request('/plantilla/refresh', { method: 'POST', body: JSON.stringify({ week: '2026-08-10' }) });
        const rol = await request('/rol?week=2026-08-10');
        const save = await request('/rol', { method: 'POST', body: JSON.stringify({
          week_start: '2026-08-10', version: rol.body.version,
          assignments: [10,11,12,13].map(employee_id => ({ employee_id, shift_id: 1, position_id: 1 }))
        }) });
        const refreshAgain = await request('/plantilla/refresh', { method: 'POST', body: JSON.stringify({ week: '2026-08-10' }) });
        const daily = await request('/diaria?week=2026-08-10');
        const weekly = await request('/semana?week=2026-08-10');
        process.stdout.write('RESULT:' + JSON.stringify({ refresh, rol, save, refreshAgain, daily, weekly, state: db.read() }));
      } finally { await new Promise(resolve => server.close(resolve)); }
    })().catch(error => { console.error(error); process.exit(1); });
  `;

  try {
    const child = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('RESULT:') + 7));
    assert.equal(result.refresh.status, 200);
    assert.equal(result.refresh.body.template.source_period_key, '2026-S33');
    assert.equal(result.refresh.body.added, 1);
    assert.deepEqual(result.refresh.body.new_employees.map(employee => employee.id), [12]);
    assert.deepEqual(result.rol.body.unassigned.map(employee => employee.id), [12]);
    assert.equal(result.rol.body.assigned.find(employee => employee.id === 11).template_status, 'baja');
    assert.equal(result.rol.body.assigned.find(employee => employee.id === 11).position.name, 'BAJA');
    assert.equal(result.rol.body.assigned.find(employee => employee.id === 13).template_status, 'absent');
    assert.equal(result.save.status, 200);
    assert.equal(result.refreshAgain.status, 200);
    assert.deepEqual(result.daily.body.grid.map(employee => employee.employee_id).sort((a, b) => a - b), [10,11,12,13]);
    assert.deepEqual(result.weekly.body.grid.map(employee => employee.employee_id).sort((a, b) => a - b), [10,11,12,13]);
    assert.equal(result.daily.body.grid.find(employee => employee.employee_id === 11).position, 'BAJA');
    assert.equal(result.weekly.body.grid.find(employee => employee.employee_id === 11).position, 'BAJA');
    assert.equal(result.state.rhh_attendance_week_templates.length, 1);
    assert.equal(result.state.rhh_rol_assignments.length, 4);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
