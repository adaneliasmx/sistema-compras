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
