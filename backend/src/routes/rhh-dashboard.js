const express = require('express');
const { read } = require('../db-rhh');
const { rhhAuthRequired } = require('../middleware/rhh-auth');
const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// GET /api/rhh/dashboard — KPIs principales con datos reales
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  const today = nowMxDate();
  const currentMonthStr = today.slice(5, 7);

  const activeEmployees = (db.rhh_employees || []).filter(e => e.status === 'active');
  const totalEmployees = activeEmployees.length;
  const departments = db.rhh_departments || [];
  const shifts = db.rhh_shifts || [];
  const employees = db.rhh_employees || [];

  // ── Datos reales desde incidencias semanales ──────────────────────────────
  const semanales = db.rhh_incidencias_semanales || [];
  const allPeriodos = [...new Set(semanales.map(r => r.no_periodo))].sort((a, b) => a - b);
  const latestPeriodo = allPeriodos.length > 0 ? allPeriodos[allPeriodos.length - 1] : null;

  // Semana actual (último período con datos)
  const weeklyData = latestPeriodo
    ? semanales.filter(r => r.no_periodo === latestPeriodo)
    : [];

  const weeklyFaltas = weeklyData.reduce((s, r) => s + (r.faltas || 0), 0);
  const weeklyTE = weeklyData.reduce((s, r) => s + (r.horas_extras_total || 0), 0);
  const weeklyVacCount = weeklyData.filter(r => (r.vacaciones_dias || 0) > 0).length;
  const weeklyDespensa = weeklyData.filter(r => r.despensa).length;
  const weeklyPrimaDom = weeklyData.filter(r => r.prima_dominical).length;
  const weeklyBonoPunt = weeklyData.filter(r => (r.bono_puntualidad_dias || 0) > 0).length;
  const weeklyBonoEfic = weeklyData.filter(r => (r.bono_eficiencia_dias || 0) > 0).length;

  // Resumen mensual (últimas 4 semanas)
  const last4Periods = allPeriodos.slice(-4);
  const monthlyData = semanales.filter(r => last4Periods.includes(r.no_periodo));
  const monthlyFaltas = monthlyData.reduce((s, r) => s + (r.faltas || 0), 0);
  const monthlyTE = monthlyData.reduce((s, r) => s + (r.horas_extras_total || 0), 0);
  const monthlyVacCount = new Set(monthlyData.filter(r => (r.vacaciones_dias || 0) > 0).map(r => r.employee_id)).size;

  // ── TE por departamento (semana actual) ───────────────────────────────────
  const teByDept = {};
  for (const r of weeklyData) {
    if ((r.horas_extras_total || 0) <= 0) continue;
    const emp = employees.find(e => e.id === r.employee_id);
    if (!emp) continue;
    const dept = departments.find(d => d.id === emp.department_id);
    const deptName = dept ? dept.name : 'Sin depto';
    teByDept[deptName] = (teByDept[deptName] || 0) + r.horas_extras_total;
  }

  // ── Distribución por departamento ─────────────────────────────────────────
  const byDept = departments.map(d => ({
    department: d.name,
    count: activeEmployees.filter(e => e.department_id === d.id).length
  })).filter(d => d.count > 0).sort((a, b) => b.count - a.count);

  // ── Distribución por turno ────────────────────────────────────────────────
  const byShift = shifts.map(s => ({
    shift: s.name,
    code: s.code,
    color: s.color,
    count: activeEmployees.filter(e => e.shift_id === s.id).length
  })).filter(s => s.count > 0);

  // ── Incidencias de hoy (desde rhh_incidences + rhh_attendance) ────────────
  const todayIncidences = (db.rhh_incidences || []).filter(
    i => i.date <= today && (i.date_end || i.date) >= today &&
    i.status !== 'rechazada' &&
    ['falta', 'vacacion', 'incapacidad', 'permiso', 'retardo'].includes(i.type)
  );
  const absencesDetail = todayIncidences.map(inc => {
    const emp = employees.find(e => e.id === inc.employee_id) || null;
    const dept = emp ? departments.find(d => d.id === emp.department_id) : null;
    const shift = emp ? shifts.find(s => s.id === emp.shift_id) : null;
    return {
      ...inc,
      employee_name: emp ? emp.full_name : 'Desconocido',
      department_name: dept ? dept.name : null,
      shift_name: shift ? shift.name : null
    };
  });

  // ── Solicitudes pendientes ────────────────────────────────────────────────
  const pendingRequests = (db.rhh_incidences || []).filter(
    i => i.status === 'pendiente' && ['vacacion', 'permiso'].includes(i.type)
  ).length;

  // ── Cumpleaños hoy y del mes ──────────────────────────────────────────────
  const todayMD = today.slice(5);
  const birthdaysToday = activeEmployees
    .filter(e => e.birth_date && e.birth_date.slice(5) === todayMD)
    .map(e => ({ id: e.id, full_name: e.full_name, birth_date: e.birth_date }));
  const birthdaysMonth = activeEmployees
    .filter(e => e.birth_date && e.birth_date.slice(5, 7) === currentMonthStr)
    .map(e => ({ id: e.id, full_name: e.full_name, birth_date: e.birth_date, day: Number(e.birth_date.slice(8)) }))
    .sort((a, b) => a.day - b.day);

  // ── Próximos feriados y feriados del mes ───────────────────────────────────
  const holidaysUpcoming = (db.rhh_holidays || [])
    .filter(h => h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map(h => ({ date: h.date, name: h.name }));
  const holidaysMonth = (db.rhh_holidays || [])
    .filter(h => h.date.slice(0, 7) === today.slice(0, 7))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(h => ({ date: h.date, name: h.name }));

  // ── Vacaciones programadas del mes ────────────────────────────────────────
  const monthStart = today.slice(0, 7) + '-01';
  const monthEnd = today.slice(0, 7) + '-31';
  const vacationsMonth = (db.rhh_incidences || []).filter(i =>
    i.type === 'vacacion' && i.status !== 'rechazada' &&
    i.date <= monthEnd && (i.date_end || i.date) >= monthStart
  ).map(i => {
    const emp = employees.find(e => e.id === i.employee_id);
    return { employee_name: emp ? emp.full_name : 'Desconocido', date: i.date, date_end: i.date_end || i.date, status: i.status };
  });
  // También solicitudes de vacaciones
  const vacRequests = (db.rhh_vacation_requests || []).filter(v =>
    v.status !== 'rechazada' &&
    ((v.start_date && v.start_date <= monthEnd && (v.end_date || v.start_date) >= monthStart) ||
     (v.date && v.date <= monthEnd && (v.date_end || v.date) >= monthStart))
  ).map(v => {
    const emp = employees.find(e => e.id === v.employee_id);
    return { employee_name: emp ? emp.full_name : 'Desconocido', date: v.start_date || v.date, date_end: v.end_date || v.date_end || v.start_date || v.date, status: v.status };
  });
  // Empleados con pago vacaciones en últimos períodos
  const vacPayWeekly = weeklyData.filter(r => (r.vacaciones_dias || 0) > 0).map(r => {
    const emp = employees.find(e => e.id === r.employee_id);
    return { employee_name: emp ? emp.full_name : 'ID ' + r.employee_id, periodo: r.no_periodo };
  });

  // ── Tendencia últimos 8 períodos ──────────────────────────────────────────
  const lastNPeriods = allPeriodos.slice(-8);
  const trends = lastNPeriods.map(p => {
    const periodData = semanales.filter(r => r.no_periodo === p);
    return {
      period: 'S' + p,
      te_hours: +periodData.reduce((s, r) => s + (r.horas_extras_total || 0), 0).toFixed(1),
      faltas: periodData.reduce((s, r) => s + (r.faltas || 0), 0),
      employees: periodData.length,
      vac_count: periodData.filter(r => (r.vacaciones_dias || 0) > 0).length,
    };
  });

  // ── Top empleados con más TE (semana actual) ──────────────────────────────
  const topTE = weeklyData
    .filter(r => (r.horas_extras_total || 0) > 0)
    .map(r => {
      const emp = employees.find(e => e.id === r.employee_id);
      const dept = emp ? departments.find(d => d.id === emp.department_id) : null;
      return { employee_name: emp ? emp.full_name : 'ID ' + r.employee_id, hours: r.horas_extras_total, department: dept ? dept.name : '' };
    })
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  res.json({
    kpis: {
      total_employees: totalEmployees,
      absences_today: todayIncidences.length,
      pending_requests: pendingRequests,
      overtime_hours_week: +(weeklyTE.toFixed(1)),
      weekly_faltas: weeklyFaltas,
      weekly_vac_count: weeklyVacCount,
    },
    current_period: latestPeriodo ? 'S' + latestPeriodo : null,
    weekly_summary: {
      periodo: latestPeriodo,
      total_employees: weeklyData.length,
      faltas: weeklyFaltas,
      te_hours: +(weeklyTE.toFixed(1)),
      vac_count: weeklyVacCount,
      despensa: weeklyDespensa,
      prima_dominical: weeklyPrimaDom,
      bono_puntualidad: weeklyBonoPunt,
      bono_eficiencia: weeklyBonoEfic,
    },
    monthly_summary: {
      periods: last4Periods.map(p => 'S' + p),
      total_faltas: monthlyFaltas,
      total_te_hours: +(monthlyTE.toFixed(1)),
      avg_te_per_employee: weeklyData.length > 0 ? +(monthlyTE / weeklyData.length).toFixed(1) : 0,
      vac_count: monthlyVacCount,
    },
    te_by_department: Object.entries(teByDept)
      .map(([dept, hours]) => ({ department: dept, hours: +(+hours).toFixed(1) }))
      .sort((a, b) => b.hours - a.hours),
    top_te_employees: topTE,
    by_department: byDept,
    by_shift: byShift,
    absences_today: absencesDetail,
    birthdays: birthdaysToday,
    birthdays_month: birthdaysMonth,
    holidays_upcoming: holidaysUpcoming,
    holidays_month: holidaysMonth,
    vacations_month: [...vacationsMonth, ...vacRequests],
    vac_pay_weekly: vacPayWeekly,
    trends,
    generated_at: new Date().toISOString()
  });
});

// GET /api/rhh/dashboard/overtime-summary — resumen de tiempo extra
// Soporta: ?week=YYYY-W## | ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD | sin params (semana actual)
router.get('/overtime-summary', rhhAuthRequired, (req, res) => {
  const db = read();
  const { week, date_from, date_to } = req.query;

  let startDate, endDate;
  if (date_from && date_to) {
    startDate = date_from;
    endDate   = date_to;
  } else if (week) {
    const [year, weekNum] = week.split('-W').map(Number);
    const jan4 = new Date(year, 0, 4);
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const start = new Date(startOfWeek1);
    start.setDate(startOfWeek1.getDate() + (weekNum - 1) * 7);
    startDate = start.toISOString().slice(0, 10);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    endDate = end.toISOString().slice(0, 10);
  } else {
    const today = nowMxDate();
    const now = new Date(today + 'T12:00:00');
    const d = now.getDay();
    const diff = now.getDate() - d + (d === 0 ? -6 : 1);
    const start = new Date(now);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    startDate = start.toISOString().slice(0, 10);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    endDate = end.toISOString().slice(0, 10);
  }

  const attTE = (db.rhh_attendance || []).filter(a =>
    a.te_hours > 0 && a.date >= startDate && a.date <= endDate
  );
  const attTeMap = {};
  for (const a of attTE) {
    attTeMap[a.employee_id] = (attTeMap[a.employee_id] || 0) + (a.te_hours || 0);
  }

  const overtimeIncidences = (db.rhh_incidences || []).filter(i =>
    i.type === 'tiempo_extra' &&
    i.status !== 'rechazada' &&
    i.date >= startDate &&
    i.date <= endDate
  );

  const employees = db.rhh_employees || [];
  const departments = db.rhh_departments || [];

  const empTeHours = { ...attTeMap };
  for (const inc of overtimeIncidences) {
    if (!empTeHours[inc.employee_id]) {
      empTeHours[inc.employee_id] = (empTeHours[inc.employee_id] || 0) + (inc.hours || 0);
    }
  }

  const byDept = {};
  for (const [empIdStr, hours] of Object.entries(empTeHours)) {
    const empId = Number(empIdStr);
    const emp = employees.find(e => e.id === empId);
    if (!emp) continue;
    const dept = departments.find(d => d.id === emp.department_id);
    const deptKey = dept ? dept.name : 'Sin departamento';
    if (!byDept[deptKey]) byDept[deptKey] = { department: deptKey, employees: [], total_hours: 0 };
    byDept[deptKey].total_hours += hours;
    byDept[deptKey].employees.push({ id: emp.id, full_name: emp.full_name, hours });
  }

  const totalHours = Object.values(empTeHours).reduce((s, h) => s + h, 0);

  res.json({
    period: { start: startDate, end: endDate },
    by_department: Object.values(byDept),
    total_hours: totalHours
  });
});

module.exports = router;
