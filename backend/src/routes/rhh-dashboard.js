const express = require('express');
const { read } = require('../db-rhh');
const { rhhAuthRequired } = require('../middleware/rhh-auth');
const router = express.Router();

// GET /api/rhh/dashboard — KPIs principales
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  const today = new Date().toISOString().slice(0, 10);

  // Total empleados activos
  const activeEmployees = (db.rhh_employees || []).filter(e => e.status === 'active');
  const totalEmployees = activeEmployees.length;

  // Ausencias hoy — usa rango para capturar incidencias de varios días vigentes hoy
  const todayIncidences = (db.rhh_incidences || []).filter(
    i => i.date <= today && (i.date_end || i.date) >= today &&
    i.status !== 'rechazada' &&
    ['falta', 'vacacion', 'incapacidad', 'permiso'].includes(i.type)
  );
  const absencesCount = todayIncidences.length;

  // Solicitudes pendientes
  const pendingRequests = (db.rhh_incidences || []).filter(
    i => i.status === 'pendiente' && ['vacacion', 'permiso'].includes(i.type)
  ).length;

  // Horas extra esta semana
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(now);
  weekStart.setDate(diff);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekStart.getDate() + 6);
  const weekEndStr = weekEndDate.toISOString().slice(0, 10);

  // Horas extra desde rhh_attendance (fuente unificada, igual que overtime-summary)
  const overtimeHours = (db.rhh_attendance || [])
    .filter(a => a.te_hours > 0 && a.date >= weekStartStr && a.date <= weekEndStr)
    .reduce((sum, a) => sum + (a.te_hours || 0), 0);

  // Cumpleaños de hoy
  const todayMD = today.slice(5); // MM-DD
  const birthdays = activeEmployees.filter(e => {
    if (!e.birth_date) return false;
    return e.birth_date.slice(5) === todayMD;
  }).map(e => ({ id: e.id, full_name: e.full_name, birth_date: e.birth_date }));

  // Distribución por departamento
  const departments = db.rhh_departments || [];
  const byDept = departments.map(d => ({
    department: d.name,
    count: activeEmployees.filter(e => e.department_id === d.id).length
  }));

  // Distribución por turno
  const shifts = db.rhh_shifts || [];
  const byShift = shifts.map(s => ({
    shift: s.name,
    code: s.code,
    color: s.color,
    count: activeEmployees.filter(e => e.shift_id === s.id).length
  }));

  // Ausencias de hoy con detalle
  const employees = db.rhh_employees || [];
  const absencesDetail = todayIncidences.map(inc => {
    const emp = employees.find(e => e.id === inc.employee_id) || null;
    const dept = emp ? departments.find(d => d.id === emp.department_id) : null;
    const shift = emp ? shifts.find(s => s.id === emp.shift_id) : null;
    return {
      ...inc,
      employee_name: emp?.full_name || 'Desconocido',
      department_name: dept?.name || null,
      shift_name: shift?.name || null
    };
  });

  res.json({
    kpis: {
      total_employees: totalEmployees,
      absences_today: absencesCount,
      pending_requests: pendingRequests,
      overtime_hours_week: overtimeHours
    },
    birthdays,
    absences_today: absencesDetail,
    by_department: byDept,
    by_shift: byShift,
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
    // Semana actual
    const now = new Date();
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

  // Leer TE desde rhh_attendance (fuente unificada) y también de incidences para compatibilidad
  // Primero se toman las horas de rhh_attendance; si no hay registro, se busca en incidencias
  const attTE = (db.rhh_attendance || []).filter(a =>
    a.te_hours > 0 && a.date >= startDate && a.date <= endDate
  );
  // Mapa employee_id → total TE hours desde attendance
  const attTeMap = {};
  for (const a of attTE) {
    attTeMap[a.employee_id] = (attTeMap[a.employee_id] || 0) + (a.te_hours || 0);
  }

  // También sumar TE de incidencias aprobadas que NO tienen registro en attendance
  const overtimeIncidences = (db.rhh_incidences || []).filter(i =>
    i.type === 'tiempo_extra' &&
    i.status !== 'rechazada' &&
    i.date >= startDate &&
    i.date <= endDate
  );

  const employees = db.rhh_employees || [];
  const departments = db.rhh_departments || [];

  // Consolidar horas TE: preferir rhh_attendance, complementar con incidencias
  const empTeHours = { ...attTeMap };
  for (const inc of overtimeIncidences) {
    if (!empTeHours[inc.employee_id]) {
      empTeHours[inc.employee_id] = (empTeHours[inc.employee_id] || 0) + (inc.hours || 0);
    }
  }

  // Agrupar por departamento
  const byDept = {};
  for (const [empIdStr, hours] of Object.entries(empTeHours)) {
    const empId = Number(empIdStr);
    const emp = employees.find(e => e.id === empId);
    if (!emp) continue;
    const dept = departments.find(d => d.id === emp.department_id);
    const deptKey = dept?.name || 'Sin departamento';
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
