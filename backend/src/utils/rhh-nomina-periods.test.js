const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('vacation, overtime and HE requests stay isolated by canonical year and weekly template', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-nomina-periods-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const repoRoot = path.resolve(__dirname, '../../..');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const routerModule = path.resolve(__dirname, '../routes/rhh-nomina.js');
  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [
      { id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true },
      { id: 2, email: 'emp@test.local', full_name: 'Empleado', role: 'empleado', active: true, employee_id: 10 },
    ],
    rhh_employees: [{ id: 10, employee_number: '100', full_name: 'EMPLEADO', status: 'active' }],
    rhh_periodos: [
      { id: 1, no_periodo: 1, year: 2026, period_key: '2026-S01', fecha_inicio: '2025-12-29', fecha_fin: '2026-01-04' },
      { id: 2, no_periodo: 1, year: 2027, period_key: '2027-S01', fecha_inicio: '2026-12-28', fecha_fin: '2027-01-03' },
    ],
    rhh_employee_period_snapshots: [
      { id: 1, employee_id: 10, employee_number: '100', full_name: 'EMPLEADO', no_periodo: 1, year: 2026, period_key: '2026-S01', fecha_inicio: '2025-12-29', fecha_fin: '2026-01-04' },
      { id: 2, employee_id: 10, employee_number: '100', full_name: 'EMPLEADO', no_periodo: 1, year: 2027, period_key: '2027-S01', fecha_inicio: '2026-12-28', fecha_fin: '2027-01-03' },
    ],
  }));
  const script = `
    const express = require('express'); const jwt = require('jsonwebtoken');
    const db = require(${JSON.stringify(dbModule)}); const router = require(${JSON.stringify(routerModule)});
    (async()=>{ await db.initDb(); const app=express(); app.use(express.json()); app.use('/api/rhh/nomina',router);
      const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
      try { const base='http://127.0.0.1:'+server.address().port; const token=jwt.sign({sub:1,module:'rhh',role:'admin'},process.env.JWT_SECRET||'cambia-esta-clave');
        const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
        const v26=await post('/api/rhh/nomina/vac-solicitudes',{employee_id:10,no_periodo:1,year:2026,dias:1});
        const v27=await post('/api/rhh/nomina/vac-solicitudes',{employee_id:10,no_periodo:1,year:2027,dias:2});
        const te=await post('/api/rhh/nomina/te-solicitudes',{employee_id:10,no_periodo:1,year:2027,horas:2});
        const he=await post('/api/rhh/nomina/he-detalle',{employee_id:10,no_periodo:1,year:2027,fecha:'2026-12-30',total_horas:2});
        const state=db.read(); process.stdout.write('RESULT:'+JSON.stringify({v26,v27,te,he,state}));
      } finally {await new Promise(resolve=>server.close(resolve));}
    })().catch(e=>{console.error(e);process.exit(1)});
  `;
  try {
    const child = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb }, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('RESULT:') + 7));
    assert.equal(result.v26.body.period_key, '2026-S01');
    assert.equal(result.v27.body.period_key, '2027-S01');
    assert.equal(result.te.body.period_key, '2027-S01');
    assert.equal(result.he.body.period_key, '2027-S01');
    assert.deepEqual(result.state.rhh_vac_solicitudes.map(r => r.period_key).sort(), ['2026-S01', '2027-S01']);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});
