const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('position-based weekly role rejects stale concurrent edits', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-role-version-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const repoRoot = path.resolve(__dirname, '../../..');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const routerModule = path.resolve(__dirname, '../routes/rhh-schedule.js');
  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [{ id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true }],
    rhh_employees: [
      { id: 10, employee_number: '100', full_name: 'EMPLEADO UNO', status: 'active', shift_id: 1 },
      { id: 11, employee_number: '101', full_name: 'EMPLEADO DOS', status: 'active', shift_id: 1 },
    ],
    rhh_shifts: [{ id: 1, name: 'Turno 1' }],
    rhh_positions: [{ id: 1, name: 'Operador' }],
    rhh_periodos: [{ id: 1, no_periodo: 31, year: 2026, period_key: '2026-S31', fecha_inicio: '2026-07-27', fecha_fin: '2026-08-02' }],
    rhh_employee_period_snapshots: [10, 11].map((id, index) => ({ id: index + 1, employee_id: id, employee_number: String(90 + id), full_name: id === 10 ? 'EMPLEADO UNO' : 'EMPLEADO DOS', no_periodo: 31, year: 2026, period_key: '2026-S31', fecha_inicio: '2026-07-27', fecha_fin: '2026-08-02', shift_id: 1 })),
    rhh_weekly_rol: [{ id: 1, week_start: '2026-07-27', shift_id: 1, status: 'draft', version: 1 }],
    rhh_rol_slots: [{ id: 1, rol_id: 1, position_id: 1, required_count: 2 }],
  }));
  const script = `
    const express=require('express');const jwt=require('jsonwebtoken');const db=require(${JSON.stringify(dbModule)});const router=require(${JSON.stringify(routerModule)});
    (async()=>{await db.initDb();const app=express();app.use(express.json());app.use('/api/rhh/schedule',router);const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
      try{const token=jwt.sign({sub:1,module:'rhh',role:'admin'},process.env.JWT_SECRET||'cambia-esta-clave');const post=async employee=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/rhh/schedule/weekly-rol/1/assign',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({slot_id:1,employee_id:employee,version:1})});return{status:r.status,body:await r.json()};};const first=await post(10);const stale=await post(11);process.stdout.write('RESULT:'+JSON.stringify({first,stale,state:db.read()}));}finally{await new Promise(resolve=>server.close(resolve));}
    })().catch(e=>{console.error(e);process.exit(1)});
  `;
  try {
    const child = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('RESULT:') + 7));
    assert.equal(result.first.status, 201);
    assert.equal(result.first.body.rol_version, 2);
    assert.equal(result.stale.status, 409);
    assert.equal(result.state.rhh_rol_assignments.length, 1);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});
