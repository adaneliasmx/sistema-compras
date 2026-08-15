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
      salary_daily: 275,
      sal_diario: 275,
      manual_position_locked: true,
      manual_salary_locked: true,
    }, {
      id: 12, employee_number: '102', full_name: 'EMPLEADO AUSENTE', status: 'active', department_id: 1, position_id: 1,
    }, {
      id: 13, employee_number: '103', full_name: 'EMPLEADO REINGRESO', status: 'inactive', manual_baja_locked: true, department_id: 1, position_id: 1,
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
      const headers = Array(21).fill('');
      Object.assign(headers, {
        0: 'semana', 1: 'Fecha Inicio', 2: 'Fecha Fin', 3: 'No. Empleado',
        4: 'Nombre', 5: 'Departamento', 6: 'Puesto', 10: 'Fecha Ingreso',
        11: 'Sal. Diario', 12: 'SDI', 13: 'SBC', 15: 'Días Pagados',
        17: 'Hrs. Extras', 18: 'Notas', 19: 'P | 1 Sueldo',
        20: 'P | 24 Aguinaldo',
      });
      const makeRow = (week, start, end, dept, position, salary, number = '100', name = 'EMPLEADO PRUEBA', aguinaldo = 0) => {
        const row = Array(21).fill('');
        Object.assign(row, {
          0: week, 1: start, 2: end, 3: number, 4: name,
          5: dept, 6: position, 10: '01/Ene/2020', 11: salary,
          12: salary + 20, 13: salary + 30, 15: 7, 17: 0, 19: 2000,
          20: aguinaldo,
        });
        return row;
      };
      const sheet = XLSX.utils.aoa_to_sheet([
        headers,
        makeRow(52, '22/Nov/2026', '28/Nov/2026', 'Producción', 'Operador', 300, '100', 'EMPLEADO PRUEBA', 500),
        makeRow(1, '29/Dic/2026', '04/Ene/2027', 'Calidad', 'Inspector', 350),
        makeRow(1, '29/Dic/2026', '04/Ene/2027', 'Producción', 'Operador', 310, '103', 'EMPLEADO REINGRESO'),
        makeRow(52, '22/Nov/2026', '28/Nov/2026', 'Producción', 'Operador', 250, '104', 'EMPLEADO SOLO HISTORICO'),
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
        const postImport = async fields => {
          const form = new FormData();
          form.append('file', new Blob([buffer]), 'consolidado.xlsx');
          for (const [key, value] of Object.entries(fields)) form.append(key, value);
          const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/catalogo/import-contpaq', {
            method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form,
          });
          return { response, body: await response.json() };
        };
        const preview = await postImport({ preview: '1' });
        const previewState = db.read();
        const previewCounts = {
          periods: (previewState.rhh_periodos || []).length,
          incidents: (previewState.rhh_incidencias_semanales || []).length,
          snapshots: (previewState.rhh_employee_period_snapshots || []).length,
          batches: (previewState.rhh_import_batches || []).length,
        };
        const committed = await postImport({ confirm: '1' });
        const duplicate = await postImport({ confirm: '1' });
        const forced = await postImport({ confirm: '1', force: '1' });
        const response = committed.response;
        const body = committed.body;
        const state = db.read();
        process.stdout.write('RESULT:' + JSON.stringify({
          status: response.status,
          body,
          preview: { status: preview.response.status, body: preview.body, counts: previewCounts },
          duplicate: { status: duplicate.response.status, body: duplicate.body },
          forced: { status: forced.response.status, body: forced.body },
          periods: state.rhh_periodos,
          incidents: state.rhh_incidencias_semanales,
          snapshots: state.rhh_employee_period_snapshots,
          batches: state.rhh_import_batches,
          candidates: state.rhh_baja_candidatos,
          employees: state.rhh_employees,
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
    assert.deepEqual(result.incidents.filter(i => i.employee_id === 10).map(i => i.period_key).sort(), ['2026-S52', '2027-S01']);
    assert.deepEqual(result.snapshots.filter(i => i.employee_id === 10).map(s => s.period_key).sort(), ['2026-S52', '2027-S01']);
    assert.equal(result.snapshots.find(s => s.period_key === '2026-S52').sal_diario, 300);
    assert.equal(result.snapshots.find(s => s.period_key === '2027-S01').sal_diario, 350);
    assert.equal(result.employee.sal_diario, 275);
    assert.equal(result.employee.department_id, result.departments.find(d => d.name === 'Calidad').id);
    assert.equal(result.employee.position_id, 1);
    assert.equal(result.snapshots.find(s => s.period_key === '2027-S01').position_name, 'Inspector');
    assert.equal(result.body.ultimo_periodo.period_key, '2027-S01');
    assert.equal(result.preview.status, 200);
    assert.equal(result.preview.body.preview, true);
    assert.equal(result.preview.body.duplicate_rows.length, 1);
    assert.deepEqual(result.preview.counts, { periods: 0, incidents: 0, snapshots: 0, batches: 0 });
    assert.equal(result.duplicate.status, 409);
    assert.equal(result.duplicate.body.code, 'DUPLICATE_IMPORT');
    assert.equal(result.forced.status, 200);
    assert.equal(result.batches.length, 2);
    assert.equal(result.batches[0].status, 'completed');
    assert.equal(result.batches[0].periods.length, 2);
    assert.equal(result.batches[1].forced_reprocess_of, result.batches[0].id);
    assert.equal(result.incidents.length, 4);
    assert.equal(result.snapshots.length, 4);
    assert.equal(result.incidents.every(i => i.import_batch_id === result.batches[1].id), true);
    assert.equal(result.snapshots.every(i => i.import_batch_id === result.batches[1].id), true);
    const historical = result.employees.find(e => e.employee_number === '104');
    assert.equal(historical.status, 'inactive');
    assert.equal(historical.historical_only, true);
    assert.ok(result.candidates.some(c => c.employee_id === 12 && c.kind === 'termination'));
    assert.ok(result.candidates.some(c => c.employee_id === 13 && c.kind === 'rehire'));
    assert.ok(result.candidates.some(c => c.employee_id === 10 && c.reasons.some(reason => reason.type === 'aguinaldo_no_diciembre')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('confirmed CONTPAQ import persists the current attendance template automatically', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhh-contpaq-attendance-'));
  const tempDb = path.join(tempDir, 'rhh.json');
  const repoRoot = path.resolve(__dirname, '../../..');
  const dbModule = path.resolve(__dirname, '../db-rhh.js');
  const routerModule = path.resolve(__dirname, '../routes/rhh-catalogo.js');
  const attendanceTemplateModule = path.resolve(__dirname, './rhh-attendance-template.js');
  const periodsModule = path.resolve(__dirname, './rhh-periods.js');

  fs.writeFileSync(tempDb, JSON.stringify({
    rhh_users: [{ id: 1, email: 'admin@test.local', full_name: 'Admin', role: 'admin', active: true }],
    rhh_employees: [{ id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', status: 'active' }],
    rhh_departments: [],
    rhh_positions: [],
  }));

  const script = `
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const XLSX = require('xlsx');
    const db = require(${JSON.stringify(dbModule)});
    const router = require(${JSON.stringify(routerModule)});
    const { mondayOfWeek } = require(${JSON.stringify(attendanceTemplateModule)});
    const { isoWeekPeriod } = require(${JSON.stringify(periodsModule)});

    (async () => {
      await db.initDb();
      const monday = mondayOfWeek();
      const addDays = (iso, days) => {
        const date = new Date(iso + 'T12:00:00Z');
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
      };
      const excelDate = iso => {
        const [year, month, day] = iso.split('-');
        return day + '/' + month + '/' + year;
      };
      const period = isoWeekPeriod(monday);
      const initial = structuredClone(db.read());
      initial.rhh_attendance_week_templates = [{
        id: 1, week_start: monday, source_period: period, source_period_key: period.period_key,
        version: 3, employees: [{ employee_id: 10, employee_number: '100', full_name: 'EMPLEADO BASE', template_status: 'included' }],
      }];
      await db.writeAsync(initial);

      const headers = Array(20).fill('');
      Object.assign(headers, {
        0: 'semana', 1: 'Fecha Inicio', 2: 'Fecha Fin', 3: 'No. Empleado',
        4: 'Nombre', 5: 'Departamento', 6: 'Puesto', 10: 'Fecha Ingreso',
        11: 'Sal. Diario', 12: 'SDI', 13: 'SBC', 15: 'Días Pagados',
        17: 'Hrs. Extras', 18: 'Notas', 19: 'P | 1 Sueldo',
      });
      const makeRow = (number, name) => {
        const row = Array(20).fill('');
        Object.assign(row, {
          0: period.no_periodo, 1: excelDate(monday), 2: excelDate(addDays(monday, 6)),
          3: number, 4: name, 5: 'Producción', 6: 'Operador',
          10: '01/01/2026', 11: 300, 12: 320, 13: 330, 15: 7, 17: 0, 19: 2100,
        });
        return row;
      };
      const sheet = XLSX.utils.aoa_to_sheet([
        headers,
        makeRow('100', 'EMPLEADO BASE'),
        makeRow('101', 'EMPLEADO NUEVO'),
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
        form.append('file', new Blob([buffer]), 'consolidado-actual.xlsx');
        form.append('confirm', '1');
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/rhh/catalogo/import-contpaq', {
          method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form,
        });
        const body = await response.json();
        const state = db.read();
        process.stdout.write('RESULT:' + JSON.stringify({
          status: response.status,
          body,
          template: state.rhh_attendance_week_templates.find(item => item.week_start === monday),
          employees: state.rhh_employees,
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
    assert.equal(result.body.attendance_template.changed, true);
    assert.equal(result.body.attendance_template.added, 1);
    assert.equal(result.body.attendance_template.employees, 2);
    assert.equal(result.template.version, 4);
    assert.deepEqual(result.template.employees.map(employee => employee.employee_number).sort(), ['100', '101']);
    assert.ok(result.employees.some(employee => employee.employee_number === '101'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
