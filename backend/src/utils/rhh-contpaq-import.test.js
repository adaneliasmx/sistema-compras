const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('CONTPAQ import creates year-aware incidents and weekly employee snapshots', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-contpaq-periods-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const repoRoot = path.resolve(__dirname, '../../..');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const routerModule = path.resolve(__dirname, '../routes/rhh-catalogo.js');

  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [{ id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true }],
    rhh_employees: [{
      id: 10,
      employee_number: '100',
      full_name: 'EMPLEADO PRUEBA',
      status: 'active',
      department_id: 1,
      position_id: 1,
    }],
    rhh_departments: [{ id: 1, name: 'Producción' }],
    rhh_positions: [{ id: 1, name: 'Operador', department_id: 1 }],
  }));

  const script = `
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const XLSX = require('xlsx');
    const db = require(${JSON.stringify(dbModule)});
    const router = require(${JSON.stringify(routerModule)});

    (async () => {
      await db.initDb();
      const headers = Array(20).fill('');
      Object.assign(headers, {
        0: 'semana', 1: 'Fecha Inicio', 2: 'Fecha Fin', 3: 'No. Empleado',
        4: 'Nombre', 5: 'Departamento', 6: 'Puesto', 10: 'Fecha Ingreso',
        11: 'Sal. Diario', 12: 'SDI', 13: 'SBC', 15: 'Días Pagados',
        17: 'Hrs. Extras', 18: 'Notas', 19: 'P | 1 Sueldo',
      });
      const makeRow = (week, start, end, dept, position, salary) => {
        const row = Array(20).fill('');
        Object.assign(row, {
          0: week, 1: start, 2: end, 3: '100', 4: 'EMPLEADO PRUEBA',
          5: dept, 6: position, 10: '01/Ene/2020', 11: salary,
          12: salary + 20, 13: salary + 30, 15: 7, 17: 0, 19: 2000,
        });
        return row;
      };
      const sheet = XLSX.utils.aoa_to_sheet([
        headers,
        makeRow(52, '22/Dic/2026', '28/Dic/2026', 'Producción', 'Operador', 300),
        makeRow(1, '29/Dic/2026', '04/Ene/2027', 'Calidad', 'Inspector', 350),
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Consolidado');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      const app = express();
      app.use(express.json());
      app.use('/api/rhh/catalogo', router);
      const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      });
      try {
        const token = jwt.sign({ sub: 1, module: 'rhh', role: 'admin' }, process.env.JWT_SECRET || 'cambia-esta-clave');
        const form = new FormData();
        form.append('file', new Blob([buffer]), 'consolidado.xlsx');
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/catalogo/import-contpaq', {
          method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form,
        });
        const body = await response.json();
        const state = db.read();
        process.stdout.write('RESULT:' + JSON.stringify({
          status: response.status,
          body,
          periods: state.rhh_periodos,
          incidents: state.rhh_incidencias_semanales,
          snapshots: state.rhh_employee_period_snapshots,
          employee: state.rhh_employees.find(e => e.id === 10),
          departments: state.rhh_departments,
          positions: state.rhh_positions,
        }));
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    })().catch(error => { console.error(error); process.exit(1); });
  `;

  try {
    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: '', DB_RHH_PATH: tempDb },
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr);
    const marker = child.stdout.lastIndexOf('RESULT:');
    assert.notEqual(marker, -1, child.stdout);
    const result = JSON.parse(child.stdout.slice(marker + 7));

    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.periods.map(p => p.period_key).sort(), ['2026-S52', '2027-S01']);
    assert.deepEqual(result.incidents.map(i => i.period_key).sort(), ['2026-S52', '2027-S01']);
    assert.deepEqual(result.snapshots.map(s => s.period_key).sort(), ['2026-S52', '2027-S01']);
    assert.equal(result.snapshots.find(s => s.period_key === '2026-S52').sal_diario, 300);
    assert.equal(result.snapshots.find(s => s.period_key === '2027-S01').sal_diario, 350);
    assert.equal(result.employee.sal_diario, 350);
    assert.equal(result.employee.department_id, result.departments.find(d => d.name === 'Calidad').id);
    assert.equal(result.employee.position_id, result.positions.find(p => p.name === 'Inspector').id);
    assert.equal(result.body.ultimo_periodo.period_key, '2027-S01');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

