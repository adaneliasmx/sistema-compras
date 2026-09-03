const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const dbPath = require.resolve('../db-rhh');
const authPath = require.resolve('../middleware/rhh-auth');
const routePath = require.resolve('./rhh-asistencia');
const scheduleRoutePath = require.resolve('./rhh-schedule');
const payrollRoutePath = require.resolve('./rhh-nomina');

let db;
function resetDb() {
  db = {
    rhh_users: [],
    rhh_employees: [
      { id: 1, employee_number: '001', full_name: 'Operador Uno', status: 'active', shift_id: 1, birth_date: '1990-02-01' },
      { id: 2, employee_number: '002', full_name: 'Operador Dos', status: 'active', shift_id: 3, birth_date: '1991-03-02' },
    ],
    rhh_shifts: [
      { id: 1, name: 'Turno 1', code: 'T1', start_time: '06:30', end_time: '14:30', work_days: [1,2,3,4,5,6] },
      { id: 2, name: 'Turno 2', code: 'T2', start_time: '14:30', end_time: '21:30', work_days: [1,2,3,4,5,6] },
      { id: 3, name: 'Turno 3', code: 'T3', start_time: '21:30', end_time: '06:30', work_days: [1,2,3,4,5] },
    ],
    rhh_weekly_rol: [],
    rhh_rol_assignments: [],
    rhh_attendance: [{ id: 1, employee_id: 1, fecha: '2026-08-03', incidencia_type: 'falta', shift_id: 1 }],
    rhh_holidays: [],
    rhh_txt_deudas: [],
    rhh_txt_pagos: [],
    rhh_bono_vales: [],
    rhh_cumpleanos_incidencias: [],
    rhh_overtime_vales: [],
    rhh_te_authorizations: [],
    rhh_te_applications: [],
    rhh_he_detalle: [],
  };
}
resetDb();

const realDb = require(dbPath);
require.cache[dbPath].exports = {
  ...realDb,
  read: () => db,
  write: () => {},
  writeAsync: async () => {},
  getSystemEmpIds: () => new Set(),
};
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    rhhAuthRequired: (req, _res, next) => {
      const role = req.headers['x-test-role'] || 'empleado';
      req.rhhUser = { id: 99, employee_id: 1, full_name: `Usuario ${role}`, email: `${role}@test.local`, role };
      next();
    },
    rhhRequireRole: (...roles) => (req, res, next) => roles.includes(req.rhhUser.role)
      ? next()
      : res.status(403).json({ error: 'Acceso no autorizado para este rol' }),
  },
};
delete require.cache[routePath];
delete require.cache[scheduleRoutePath];
delete require.cache[payrollRoutePath];
const router = require(routePath);
const scheduleRouter = require(scheduleRoutePath);
const payrollRouter = require(payrollRoutePath);
const app = express();
app.use(express.json());
app.use(router);
app.use('/schedule', scheduleRouter);
app.use('/nomina', payrollRouter);

test.beforeEach(resetDb);

test('supervisor solicita bono usando turno realmente trabajado; empleado no puede', async () => {
  const body = { employee_id: 1, fecha: '2026-08-08', bono_type: 'limpieza', shift_worked_id: 3 };
  const denied = await request(app).post('/bonos').set('x-test-role', 'empleado').send(body);
  assert.equal(denied.status, 403);

  const created = await request(app).post('/bonos').set('x-test-role', 'supervisor').send(body);
  assert.equal(created.status, 201);
  assert.equal(created.body.scheduled_shift_id, 1);
  assert.equal(created.body.shift_worked_id, 3);
  assert.equal(created.body.status, 'pendiente');
});

test('Encendido de Resistencias queda limitado a un trabajador por semana', async () => {
  const first = await request(app).post('/bonos').set('x-test-role', 'supervisor').send({
    employee_id: 1, fecha: '2026-08-09', bono_type: 'encendido_resistencias', shift_worked_id: 1,
  });
  assert.equal(first.status, 201);
  const second = await request(app).post('/bonos').set('x-test-role', 'supervisor').send({
    employee_id: 2, fecha: '2026-08-09', bono_type: 'encendido_resistencias', shift_worked_id: 3,
  });
  assert.equal(second.status, 400);
});

test('bono solicitado por supervisor sólo puede ser autorizado por RHH/Admin', async () => {
  const created = await request(app).post('/bonos').set('x-test-role', 'supervisor').send({
    employee_id: 1, fecha: '2026-08-09', bono_type: 'limpieza', shift_worked_id: 1,
  });
  assert.equal(created.status, 201);
  const denied = await request(app).post(`/bonos/${created.body.id}/autorizar`).set('x-test-role', 'supervisor');
  assert.equal(denied.status, 403);
  const approved = await request(app).post(`/bonos/${created.body.id}/autorizar`).set('x-test-role', 'rh');
  assert.equal(approved.status, 200);
  assert.equal(approved.body.bono.status, 'autorizado');
});

test('sólo RHH/Admin crea deuda TXT y únicamente desde la falta exacta', async () => {
  const body = { employee_id: 1, attendance_id: 1, fecha: '2026-08-03' };
  const denied = await request(app).post('/txt/crear-deuda').set('x-test-role', 'supervisor').send(body);
  assert.equal(denied.status, 403);
  const created = await request(app).post('/txt/crear-deuda').set('x-test-role', 'rh').send(body);
  assert.equal(created.status, 201);
  assert.equal(created.body.horas_deuda_original, 8);
  assert.equal(db.rhh_attendance[0].incidencia_type, 'falta');
  assert.equal(db.rhh_attendance[0].txt_status, 'por_pagar');

  db.rhh_attendance[0].incidencia_type = 'labora';
  db.rhh_txt_deudas = [];
  const invalid = await request(app).post('/txt/crear-deuda').set('x-test-role', 'rh').send(body);
  assert.equal(invalid.status, 400);
});

test('flujo TXT muestra por pagar, parcial y pagado con relación entre pago y falta', async () => {
  const created = await request(app).post('/txt/crear-deuda').set('x-test-role', 'rh').send({
    employee_id: 1, attendance_id: 1, fecha: '2026-08-03',
  });
  assert.equal(created.status, 201);

  const pendingView = await request(app).get('/diaria?week=2026-08-03').set('x-test-role', 'supervisor');
  assert.equal(pendingView.status, 200);
  const pendingEmployee = pendingView.body.grid.find(e => e.employee_id === 1);
  const absenceDay = pendingEmployee.days.find(d => d.fecha === '2026-08-03');
  assert.equal(absenceDay.incidencia_type, 'falta');
  assert.equal(absenceDay.txt_display_status, 'por_pagar');
  assert.match(absenceDay.txt_display_label, /TXT por pagar/);

  const partial = await request(app).post('/txt/pagar').set('x-test-role', 'supervisor').send({
    deuda_id: created.body.id, fecha_pago: '2026-08-09', tipo_pago: 'parcial', horas_aplicadas: 3,
  });
  assert.equal(partial.status, 200);
  assert.equal(db.rhh_attendance.find(a => a.id === 1).txt_pagado_como_trabajado, false);

  const partialView = await request(app).get('/semana?week=2026-08-03').set('x-test-role', 'supervisor');
  assert.equal(partialView.status, 200);
  const partialEmployee = partialView.body.grid.find(e => e.employee_id === 1);
  assert.equal(partialEmployee.days.find(d => d.fecha === '2026-08-03').txt_display_status, 'parcial');
  assert.equal(partialEmployee.days.find(d => d.fecha === '2026-08-09').txt_pagado_horas, 3);
  assert.ok(partialEmployee.comentarios.some(c => c.text.includes('a cuenta de falta del lunes 03/08')));

  const settled = await request(app).post('/txt/pagar').set('x-test-role', 'supervisor').send({
    deuda_id: created.body.id, fecha_pago: '2026-08-09', tipo_pago: 'parcial', horas_aplicadas: 5,
  });
  assert.equal(settled.status, 200);
  assert.equal(db.rhh_attendance.find(a => a.id === 1).txt_pagado_como_trabajado, true);

  const paidView = await request(app).get('/semana?week=2026-08-03').set('x-test-role', 'supervisor');
  const paidEmployee = paidView.body.grid.find(e => e.employee_id === 1);
  assert.equal(paidEmployee.days.find(d => d.fecha === '2026-08-03').txt_display_status, 'pagado');
  assert.equal(paidEmployee.days.find(d => d.fecha === '2026-08-03').txt_counts_as_paid_day, true);
  assert.equal(paidEmployee.days.find(d => d.fecha === '2026-08-09').txt_pagado_horas, 8);

  db.rhh_periodos = [{ no_periodo: 32, year: 2026, period_key: '2026-S32', fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09' }];
  db.rhh_employee_period_snapshots = [{
    employee_id: 1, employee_number: '001', full_name: 'Operador Uno', no_periodo: 32,
    year: 2026, period_key: '2026-S32', fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09',
  }];
  db.rhh_incidencias_semanales = [{
    id: 1, employee_id: 1, no_periodo: 32, year: 2026, period_key: '2026-S32', dias_pagados: 6, faltas: 1,
  }];
  const payrollView = await request(app).get('/nomina/incidencias?no_periodo=32&year=2026').set('x-test-role', 'rh');
  assert.equal(payrollView.status, 200);
  assert.equal(payrollView.body[0].dias_pagados, 7);
  assert.equal(payrollView.body[0].faltas, 0);
  assert.deepEqual(payrollView.body[0].txt_dias_pagados, ['2026-08-03']);
});

test('pago TXT en descanso registra presencia y convierte excedente en vale pendiente', async () => {
  db.rhh_txt_deudas.push({
    id: 1, employee_id: 1, origen_attendance_id: 1, origen_fecha: '2026-08-03',
    origen_tipo: 'falta', horas_deuda_original: 8, horas_pagadas: 0,
    horas_pendientes: 8, status: 'pendiente_pago', created_at: '2026-08-03 10:00',
  });
  const paid = await request(app).post('/txt/pagar').set('x-test-role', 'supervisor').send({
    deuda_id: 1,
    fecha_pago: '2026-08-09',
    tipo_pago: 'turno_completo',
    shift_id_pagado: 3,
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.pago.horas_aplicadas, 8);
  assert.equal(paid.body.pago.horas_trabajadas, 9);
  assert.equal(paid.body.horas_sobrante, 1);
  assert.equal(db.rhh_txt_deudas[0].status, 'pagado');
  assert.equal(db.rhh_attendance.find(a => a.id === 1).txt_pagado_como_trabajado, true);
  const attendance = db.rhh_attendance.find(a => a.employee_id === 1 && a.fecha === '2026-08-09');
  assert.equal(attendance.incidencia_type, 'descanso');
  assert.equal(attendance.txt_presento, true);
  assert.equal(db.rhh_overtime_vales[0].status, 'pendiente');
  assert.equal(db.rhh_overtime_vales[0].te_horas, 1);
});

test('deuda TXT bloquea captura, autorización y asignación de tiempo extra por todas las rutas', async () => {
  db.rhh_txt_deudas.push({
    id: 1, employee_id: 1, origen_attendance_id: 1, origen_fecha: '2026-08-03',
    origen_tipo: 'falta', horas_deuda_original: 8, horas_pagadas: 0,
    horas_pendientes: 8, status: 'pendiente_pago', created_at: '2026-08-03 10:00',
  });
  db.rhh_overtime_vales.push({ id: 1, employee_id: 1, status: 'pendiente' });
  db.rhh_te_authorizations.push({ id: 10, date: '2026-08-09', positions: [], status: 'approved' });
  db.rhh_te_applications.push({ id: 20, te_authorization_id: 10, employee_id: 1, status: 'applied' });

  const direct = await request(app).post('/diaria').set('x-test-role', 'supervisor').send({
    employee_id: 1, fecha: '2026-08-04', incidencia_type: 'labora', shift_id: 1,
    te_activo: true, te_hora_entrada: '14:30', te_hora_salida: '16:30',
  });
  assert.equal(direct.status, 400);

  const vale = await request(app).post('/overtime-vales/1/autorizar').set('x-test-role', 'rh');
  assert.equal(vale.status, 409);

  const requestTe = await request(app).post('/schedule/request-te').set('x-test-role', 'supervisor').send({
    employee_id: 1, date: '2026-08-09', shift_id: 1, te_hours: 2,
  });
  assert.equal(requestTe.status, 409);

  const applyTe = await request(app).post('/schedule/te-applications').set('x-test-role', 'empleado').send({
    te_authorization_id: 10,
  });
  assert.equal(applyTe.status, 409);

  const selectTe = await request(app).patch('/schedule/te-applications/20').set('x-test-role', 'supervisor').send({ status: 'selected' });
  assert.equal(selectTe.status, 409);

  const payrollTe = await request(app).post('/nomina/he-detalle').set('x-test-role', 'supervisor').send({
    no_periodo: 32, year: 2026, employee_id: 1, fecha: '2026-08-09', total_horas: 2,
  });
  assert.equal(payrollTe.status, 409);
});

test('cumpleaños en festivo bloquea cualquier forma de trabajo incluso por API', async () => {
  db.rhh_employees[0].birth_date = '1990-08-09';
  db.rhh_holidays.push({ id: 1, date: '2026-08-09', name: 'Festivo sindical' });
  db.rhh_txt_deudas.push({
    id: 1, employee_id: 1, origen_attendance_id: 1, origen_fecha: '2026-08-03',
    origen_tipo: 'falta', horas_deuda_original: 8, horas_pagadas: 0,
    horas_pendientes: 8, status: 'pendiente_pago', created_at: '2026-08-03 10:00',
  });

  const attendance = await request(app).post('/diaria').set('x-test-role', 'supervisor').send({
    employee_id: 1, fecha: '2026-08-09', incidencia_type: 'labora', shift_id: 1,
  });
  assert.equal(attendance.status, 400);

  const txt = await request(app).post('/txt/pagar').set('x-test-role', 'supervisor').send({
    deuda_id: 1, fecha_pago: '2026-08-09', tipo_pago: 'turno_completo', shift_id_pagado: 1,
  });
  assert.equal(txt.status, 400);

  const bonus = await request(app).post('/bonos').set('x-test-role', 'supervisor').send({
    employee_id: 1, fecha: '2026-08-09', bono_type: 'limpieza', shift_worked_id: 1,
  });
  assert.equal(bonus.status, 400);

  const birthday = await request(app).post('/cumpleanos-laboro').set('x-test-role', 'supervisor').send({
    employee_id: 1, fecha: '2026-08-09', laboro: true,
  });
  assert.equal(birthday.status, 400);
});
