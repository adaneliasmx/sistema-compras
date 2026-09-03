const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('./rhh-asistencia');
const { ensureUnionAgreementHolidays } = require('../utils/rhh-holidays');

const {
  employeeDayContext,
  enrichTxtPayment,
  ensureAutomaticSundayBirthdayGratifications,
  getTxtDebtSnapshot,
  getTxtBalanceAsOf,
  shiftHours,
  syncTxtOriginAttendance,
  syncDeudaTurnoIncompleto,
  txtPaymentComment,
} = router._test;

test('feriados sindicales se materializan sin duplicar fechas existentes', () => {
  const db = { rhh_holidays: [{ id: 1, date: '2026-01-01', name: 'Año Nuevo' }] };
  assert.equal(ensureUnionAgreementHolidays(db, 2026), true);
  assert.equal(db.rhh_holidays.filter(h => h.date === '2026-01-01').length, 1);
  assert.equal(db.rhh_holidays.filter(h => h.date === '2026-12-24').length, 1);
  assert.equal(db.rhh_holidays.find(h => h.date === '2026-01-01').union_agreement, true);
  assert.equal(ensureUnionAgreementHolidays(db, 2026), false);
});

test('horas completas usan la duración real de cada turno', () => {
  const db = { rhh_shifts: [
    { id: 1, start_time: '06:30', end_time: '14:30' },
    { id: 2, start_time: '14:30', end_time: '21:30' },
    { id: 3, start_time: '21:30', end_time: '06:30' },
  ] };
  assert.equal(shiftHours(db, 1), 8);
  assert.equal(shiftHours(db, 2), 7);
  assert.equal(shiftHours(db, 3), 9);
});

test('saldo TXT histórico sólo descuenta pagos hechos hasta la fecha de corte', () => {
  const db = {
    rhh_txt_deudas: [{
      id: 1, employee_id: 10, origen_fecha: '2026-08-03', horas_deuda_original: 8,
      horas_pendientes: 0, status: 'pagado', created_at: '2026-08-03 12:00',
    }],
    rhh_txt_pagos: [{
      id: 1, deuda_id: 1, employee_id: 10, fecha_pago: '2026-08-09', horas_aplicadas: 7,
    }, {
      id: 2, deuda_id: 1, employee_id: 10, fecha_pago: '2026-08-16', horas_aplicadas: 1,
    }],
  };
  assert.equal(getTxtBalanceAsOf(db, 10, '2026-08-08'), 8);
  assert.equal(getTxtBalanceAsOf(db, 10, '2026-08-09'), 1);
  assert.equal(getTxtBalanceAsOf(db, 10, '2026-08-16'), 0);
});

test('TXT conserva la falta como antecedente y al liquidarse marca el día pagado como trabajado', () => {
  const db = {
    rhh_attendance: [{ id: 7, employee_id: 10, fecha: '2026-08-03', incidencia_type: 'falta' }],
    rhh_txt_deudas: [{
      id: 2, employee_id: 10, origen_attendance_id: 7, origen_fecha: '2026-08-03', origen_tipo: 'falta',
      horas_deuda_original: 8, horas_pagadas: 3, horas_pendientes: 5, status: 'pendiente_pago',
      created_at: '2026-08-03 10:00',
    }],
    rhh_txt_pagos: [{
      id: 1, employee_id: 10, deuda_id: 2, fecha_pago: '2026-08-08', horas_aplicadas: 3,
      horas_trabajadas: 3, aplicaciones: [{ deuda_id: 2, horas: 3 }],
    }],
  };
  const deuda = db.rhh_txt_deudas[0];
  assert.equal(getTxtDebtSnapshot(db, deuda, '2026-08-08').displayStatus, 'parcial');
  syncTxtOriginAttendance(db, deuda);
  assert.equal(db.rhh_attendance[0].incidencia_type, 'falta');
  assert.equal(db.rhh_attendance[0].txt_status, 'parcial');
  assert.equal(db.rhh_attendance[0].txt_pagado_como_trabajado, false);

  deuda.horas_pagadas = 8;
  deuda.horas_pendientes = 0;
  deuda.status = 'pagado';
  db.rhh_txt_pagos.push({
    id: 2, employee_id: 10, deuda_id: 2, fecha_pago: '2026-08-09', horas_aplicadas: 5,
    horas_trabajadas: 5, aplicaciones: [{ deuda_id: 2, horas: 5 }],
  });
  syncTxtOriginAttendance(db, deuda);
  assert.equal(db.rhh_attendance[0].incidencia_type, 'falta');
  assert.equal(db.rhh_attendance[0].txt_status, 'pagado');
  assert.equal(db.rhh_attendance[0].txt_pagado_como_trabajado, true);
  assert.match(txtPaymentComment(db, db.rhh_txt_pagos[1]), /a cuenta de falta del lunes 03\/08/);
  assert.equal(enrichTxtPayment(db, db.rhh_txt_pagos[1]).horas_trabajadas, 5);
});

test('cumpleaños que coincide con festivo se identifica como no laborable', () => {
  const db = {
    rhh_employees: [{ id: 5, birth_date: '1990-12-24', shift_id: 1 }],
    rhh_shifts: [{ id: 1, work_days: [1, 2, 3, 4, 5, 6] }],
    rhh_holidays: [{ id: 1, date: '2026-12-24', name: 'Acuerdo sindical' }],
    rhh_weekly_rol: [], rhh_rol_assignments: [],
  };
  assert.equal(employeeDayContext(db, 5, '2026-12-24').birthdayHolidayConflict, true);
});

test('cumpleaños en domingo programa una sola gratificación y un festivo la impide', () => {
  const base = {
    rhh_employees: [{ id: 5, birth_date: '1990-08-09', salary_daily: 350 }],
    rhh_employee_period_snapshots: [],
    rhh_incidencias_semanales: [],
    rhh_cumpleanos_incidencias: [],
    rhh_holidays: [],
  };
  const employees = [{ ...base.rhh_employees[0], template_status: 'included' }];

  assert.equal(ensureAutomaticSundayBirthdayGratifications(base, employees, ['2026-08-09']), true);
  assert.equal(base.rhh_cumpleanos_incidencias.length, 1);
  assert.equal(base.rhh_cumpleanos_incidencias[0].semana_pago, '2026-08-10');
  assert.equal(base.rhh_incidencias_semanales.length, 1);
  assert.equal(base.rhh_incidencias_semanales[0].gratificacion_cumpleanos_importe, 350);
  assert.equal(ensureAutomaticSundayBirthdayGratifications(base, employees, ['2026-08-09']), false);
  assert.equal(base.rhh_cumpleanos_incidencias.length, 1);

  const holidayDb = {
    ...base,
    rhh_incidencias_semanales: [],
    rhh_cumpleanos_incidencias: [],
    rhh_holidays: [{ id: 1, date: '2026-08-09', name: 'Festivo' }],
  };
  assert.equal(ensureAutomaticSundayBirthdayGratifications(holidayDb, employees, ['2026-08-09']), false);
  assert.equal(holidayDb.rhh_cumpleanos_incidencias.length, 0);
  assert.equal(holidayDb.rhh_incidencias_semanales.length, 0);
});

test('turno incompleto actualiza la deuda sin borrar pagos históricos', () => {
  const db = { rhh_txt_deudas: [] };
  const attendance = { id: 20, employee_id: 4, fecha: '2026-08-05', incidencia_type: 'turno_incompleto', horas_pendientes_turno: 4 };
  syncDeudaTurnoIncompleto(db, attendance, 'Supervisor');
  assert.equal(db.rhh_txt_deudas[0].horas_pendientes, 4);
  db.rhh_txt_deudas[0].horas_pagadas = 2;
  attendance.horas_pendientes_turno = 3;
  syncDeudaTurnoIncompleto(db, attendance, 'Supervisor');
  assert.equal(db.rhh_txt_deudas[0].horas_pendientes, 1);
  attendance.incidencia_type = 'labora';
  syncDeudaTurnoIncompleto(db, attendance, 'Supervisor');
  assert.equal(db.rhh_txt_deudas[0].status, 'pagado');
  assert.equal(db.rhh_txt_deudas[0].horas_pagadas, 2);
});
