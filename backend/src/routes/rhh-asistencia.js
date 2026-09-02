/* ══════════════════════════════════════════════════════════════════════════════
   RHH — Control de Asistencias
   Rol semanal, captura diaria, vista grid semanal, vales de tiempo extra
   ══════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { read, write, writeAsync, nextId, getSystemEmpIds } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const { canonicalPeriod, comparePeriods, getEmployeeTemplateForWeek, isoWeekPeriod } = require('../utils/rhh-periods');
const { buildAttendanceEmployeesForWeek } = require('../utils/rhh-attendance-template');
const router = express.Router();

// ── Diagnóstico temporal (eliminar después) ──────────────────────────────────
router.get('/plantilla/diag', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  if (req.query.key !== 'diag2026') return res.status(404).json({ error: 'not found' });
  const db = read();
  const emps = db.rhh_employees || [];
  const snaps = db.rhh_employee_period_snapshots || [];
  const templates = db.rhh_attendance_week_templates || [];
  const users = db.rhh_users || [];
  const systemIds = new Set(users.filter(u => u.role !== 'empleado' && u.employee_id != null).map(u => Number(u.employee_id)));
  const snapEmpIds = new Set(snaps.map(s => Number(s.employee_id)));
  const activos = emps.filter(e => e.status === 'active');
  const activosSinSnap = activos.filter(e => !snapEmpIds.has(Number(e.id)));
  const validNum = e => { const v = String(e.employee_number||'').trim(); return v.length >= 3 && /^\d+$/.test(v.replace(/^0+/,'') || '0'); };
  const periods = {};
  for (const s of snaps) {
    const k = s.period_key || `${s.year}-S${String(s.no_periodo).padStart(2,'0')}`;
    periods[k] = (periods[k] || 0) + 1;
  }
  // IDs de activos no-system
  const expectedIds = new Set(activos.filter(e => !systemIds.has(Number(e.id))).map(e => Number(e.id)));
  // IDs en la plantilla materializada de la semana actual
  const currentWeek = templates.find(t => t.week_start === '2026-08-10');
  const templateIds = new Set((currentWeek?.employees || []).map(e => Number(e.employee_id ?? e.id)));
  const templateInc = new Set((currentWeek?.employees || []).filter(e => e.template_status === 'included').map(e => Number(e.employee_id ?? e.id)));
  // Activos que faltan en la plantilla
  const missingFromTemplate = [...expectedIds].filter(id => !templateIds.has(id));
  // En plantilla pero no activos
  const extraInTemplate = [...templateIds].filter(id => !expectedIds.has(id));
  // Snapshot S32
  const s32Ids = new Set(snaps.filter(s => s.period_key === '2026-S32' || (s.year === 2026 && s.no_periodo === 32)).map(s => Number(s.employee_id)));
  const activosNoS32 = [...expectedIds].filter(id => !s32Ids.has(id));

  const empById = new Map(emps.map(e => [Number(e.id), e]));

  res.json({
    total_empleados: emps.length,
    activos: activos.length,
    inactivos: emps.filter(e => e.status === 'inactive').length,
    baja_locked: emps.filter(e => e.manual_baja_locked).length,
    snapshots_total: snaps.length,
    snapshot_periods: periods,
    templates_materializadas: templates.map(t => ({
      week: t.week_start, emps: t.employees?.length, version: t.version, updated: t.updated_at,
      included: t.employees?.filter(e => e.template_status === 'included').length,
      baja: t.employees?.filter(e => e.template_status === 'baja').length,
      absent: t.employees?.filter(e => e.template_status === 'absent').length,
    })),
    system_employee_ids: [...systemIds],
    expected_in_template: expectedIds.size,
    in_template: templateIds.size,
    in_template_included: templateInc.size,
    missing_from_template: missingFromTemplate.map(id => {
      const e = empById.get(id);
      return { id, num: e?.employee_number, name: e?.full_name, in_s32: s32Ids.has(id) };
    }),
    extra_in_template: extraInTemplate.map(id => {
      const e = empById.get(id);
      const te = (currentWeek?.employees||[]).find(x => Number(x.employee_id??x.id) === id);
      return { id, num: e?.employee_number, name: e?.full_name, status: e?.status, tmpl_status: te?.template_status };
    }),
    activos_not_in_s32: activosNoS32.map(id => {
      const e = empById.get(id);
      return { id, num: e?.employee_number, name: e?.full_name };
    }),
    activos_sin_snapshot: activosSinSnap.map(e => ({
      id: e.id, num: e.employee_number, name: e.full_name, valid_num: validNum(e),
      baja_locked: !!e.manual_baja_locked, is_system: systemIds.has(Number(e.id)),
    })),
    activos_num_invalido: activos.filter(e => !validNum(e)).map(e => ({
      id: e.id, num: e.employee_number, name: e.full_name,
    })),
    // Detalle de system users
    system_users_detail: users.filter(u => u.role !== 'empleado' && u.employee_id != null).map(u => ({
      user_id: u.id, email: u.email, role: u.role, employee_id: u.employee_id,
      emp_name: empById.get(Number(u.employee_id))?.full_name,
      emp_num: empById.get(Number(u.employee_id))?.employee_number,
      emp_status: empById.get(Number(u.employee_id))?.status,
    })),
    // Buscar los 5 reportados
    reported_missing: [163,164,165,166,167].map(num => {
      const e = emps.find(x => Number(x.employee_number) === num || Number(x.id) === num);
      if (!e) return { num, found: false };
      const id = Number(e.id);
      return {
        num, id, name: e.full_name, status: e.status,
        baja_locked: !!e.manual_baja_locked,
        is_system: systemIds.has(id),
        valid_num: validNum(e),
        in_s32: s32Ids.has(id),
        in_template: templateIds.has(id),
        has_any_snapshot: snapEmpIds.has(id),
      };
    }),
  });
});

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function nowMxTime() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
}
function nowMxDateTime() {
  return `${nowMxDate()} ${nowMxTime()}`;
}

const PROYECTOS = ['SKF', 'AMSTED', 'TENNECO'];

const INCIDENCIA_TYPES = [
  'labora', 'falta', 'festivo', 'vacacion', 'baja',
  'retardo', 'incapacidad', 'permiso_cg', 'permiso_sg',
  'paro_tecnico', 'descanso', 'turno_incompleto',
];

const INCIDENCIA_LABELS = {
  labora:            'Labora',
  falta:             'Falta',
  festivo:           'Festivo',
  vacacion:          'Vacación',
  baja:              'Baja',
  retardo:           'Retardo',
  incapacidad:       'Incapacidad',
  permiso_cg:        'Permiso C/G',
  permiso_sg:        'Permiso S/G',
  paro_tecnico:      'Paro Técnico',
  descanso:          'Descanso',
  turno_incompleto:  'Turno Inc.',
};

/* ── Helpers TxT ───────────────────────────────────────────────────────────── */
function getTxtDeudas(db) { if (!db.rhh_txt_deudas) db.rhh_txt_deudas = []; return db.rhh_txt_deudas; }
function getTxtPagos(db) { if (!db.rhh_txt_pagos) db.rhh_txt_pagos = []; return db.rhh_txt_pagos; }
function getBonoVales(db) { if (!db.rhh_bono_vales) db.rhh_bono_vales = []; return db.rhh_bono_vales; }
function getCumpleIncidencias(db) { if (!db.rhh_cumpleanos_incidencias) db.rhh_cumpleanos_incidencias = []; return db.rhh_cumpleanos_incidencias; }

function getActiveDeudas(db, employeeId) {
  return getTxtDeudas(db).filter(d => d.employee_id === Number(employeeId) && d.status === 'pendiente_pago');
}
function getTotalHorasPendientes(db, employeeId) {
  return getActiveDeudas(db, employeeId).reduce((s, d) => s + (d.horas_pendientes || 0), 0);
}

function pagoAplicadoADeuda(pago, deudaId) {
  if (Array.isArray(pago.aplicaciones)) {
    return pago.aplicaciones
      .filter(a => Number(a.deuda_id) === Number(deudaId))
      .reduce((sum, a) => sum + (Number(a.horas) || 0), 0);
  }
  return Number(pago.deuda_id) === Number(deudaId) ? (Number(pago.horas_aplicadas) || 0) : 0;
}

function getTxtBalanceAsOf(db, employeeId, cutoffDate) {
  const pagos = getTxtPagos(db).filter(p =>
    p.employee_id === Number(employeeId) && (!cutoffDate || p.fecha_pago <= cutoffDate)
  );
  return getTxtDeudas(db)
    .filter(d =>
      d.employee_id === Number(employeeId) &&
      d.status !== 'cancelado' &&
      (!cutoffDate || (
        d.origen_fecha <= cutoffDate &&
        (!d.created_at || String(d.created_at).slice(0, 10) <= cutoffDate)
      ))
    )
    .reduce((sum, deuda) => {
      const pagado = pagos.reduce((s, pago) => s + pagoAplicadoADeuda(pago, deuda.id), 0);
      return sum + Math.max(0, (Number(deuda.horas_deuda_original) || 0) - pagado);
    }, 0);
}

/* Horas de turno por shift_id */
function shiftHours(db, shiftId) {
  const s = (db.rhh_shifts || []).find(sh => sh.id === Number(shiftId));
  if (!s || !s.start_time || !s.end_time) return 8;
  const [h1, m1] = s.start_time.split(':').map(Number);
  const [h2, m2] = s.end_time.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins <= 0) mins += 24 * 60; // turno nocturno
  return Math.round(mins / 6) / 10;
}

function shiftForEmployeeDate(db, employeeId, fecha) {
  const rol = findAttendanceRol(db, weekMonday(fecha));
  const assignment = rol
    ? (db.rhh_rol_assignments || []).find(a => a.rol_id === rol.id && Number(a.employee_id) === Number(employeeId))
    : null;
  const emp = (db.rhh_employees || []).find(e => Number(e.id) === Number(employeeId));
  const shiftId = assignment?.shift_id ?? emp?.shift_id ?? null;
  return (db.rhh_shifts || []).find(s => Number(s.id) === Number(shiftId)) || null;
}

function employeeDayContext(db, employeeId, fecha) {
  const emp = (db.rhh_employees || []).find(e => Number(e.id) === Number(employeeId));
  const shift = shiftForEmployeeDate(db, employeeId, fecha);
  const jsDay = new Date(fecha + 'T12:00:00').getDay();
  const workDay = jsDay === 0 ? 7 : jsDay;
  const worksDay = Array.isArray(shift?.work_days) ? shift.work_days.includes(workDay) : workDay <= 5;
  const holiday = (db.rhh_holidays || []).find(h => h.date === fecha) || null;
  const isBirthday = !!(emp?.birth_date && emp.birth_date.slice(5) === fecha.slice(5));
  return {
    emp,
    shift,
    isRestDay: !worksDay,
    holiday,
    isBirthday,
    birthdayHolidayConflict: !!holiday && isBirthday,
  };
}

const OVERTIME_RAZONES = [
  'Producción urgente / pedido cliente',
  'Mantenimiento preventivo',
  'Mantenimiento correctivo',
  'Limpieza y orden de área',
  'Capacitación',
  'Inventario',
  'Paro técnico recuperación',
  'Apoyo a otro turno',
  'Auditoría / visita cliente',
  'Otro',
];

/* Lunes de la semana que contiene dateStr (YYYY-MM-DD) */
function weekMonday(dateStr) {
  const d   = new Date((dateStr || nowMxDate()) + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toLocaleDateString('en-CA', { timeZone: 'UTC' });
}

/* Array de 7 fechas Lun-Dom */
function weekDates(monday) {
  const out = [];
  const d   = new Date(monday + 'T12:00:00');
  for (let i = 0; i < 7; i++) {
    const nd = new Date(d);
    nd.setDate(d.getDate() + i);
    out.push(nd.toLocaleDateString('en-CA', { timeZone: 'UTC' }));
  }
  return out;
}

/* Calcular horas entre dos strings HH:MM */
function calcHoras(entrada, salida) {
  if (!entrada || !salida) return null;
  const [h1, m1] = entrada.split(':').map(Number);
  const [h2, m2] = salida.split(':').map(Number);
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins <= 0) return null;
  return Math.round(mins / 6) / 10; // redondeo a 1 decimal
}

/* ¿Registro bloqueado para supervisor? */
function isLockedForSupervisor(rec, fecha, role, unlocks) {
  if (role === 'rh' || role === 'admin') return false;
  if (!rec) return false;  // sin registro = no bloqueado
  if (!rec.incidencia_type) return false; // sin incidencia registrada = no bloqueado
  if (fecha >= nowMxDate()) return false;
  // Verificar si hay un desbloqueo vigente para esta fecha
  if (unlocks && unlocks.length > 0) {
    const now = nowMxDateTime();
    const hasUnlock = unlocks.some(u =>
      u.fecha === fecha && u.active !== false && u.start_dt <= now && u.end_dt >= now
    );
    if (hasUnlock) return false;
  }
  return true;
}

/* Enriquece un empleado con dept/position/shift */
function enrichEmp(emp, db) {
  if (!emp) return null;
  return {
    ...emp,
    department: (db.rhh_departments || []).find(d => d.id === emp.department_id) || null,
    position:   (db.rhh_positions   || []).find(p => p.id === emp.position_id)   || null,
    shift:      (db.rhh_shifts      || []).find(s => s.id === emp.shift_id)       || null,
  };
}

function isConfirmedInactive(emp) {
  return emp?.status === 'inactive' && emp?.manual_baja_locked === true;
}

function hasValidPayrollNumber(emp) {
  const value = String(emp?.employee_number || '').trim();
  return value.length >= 3 && /^\d+$/.test(value.replace(/^0+/, '') || '0');
}

function weeklyEmployeeSeed(emp) {
  const seed = {
    employee_id: Number(emp?.employee_id ?? emp?.id) || undefined,
    employee_number: emp?.employee_number,
    full_name: emp?.full_name,
    no_periodo: emp?.no_periodo,
    year: emp?.year,
    period_key: emp?.period_key,
    fecha_inicio: emp?.fecha_inicio,
    fecha_fin: emp?.fecha_fin,
    present_in_payroll: emp?.present_in_payroll,
    status_at_period: emp?.status_at_period,
    department_id: emp?.department_id,
    department_name: emp?.department_name,
    position_id: emp?.position_id,
    position_name: emp?.position_name,
    shift_id: emp?.shift_id,
    project: emp?.project,
    sal_diario: emp?.sal_diario,
    salary_daily: emp?.salary_daily,
    sdi: emp?.sdi,
    sbc: emp?.sbc,
    fecha_ingreso: emp?.fecha_ingreso ?? emp?.start_date,
    source: emp?.source,
    import_batch_id: emp?.import_batch_id,
    template_status: emp?.template_status,
    template_period_key: emp?.template_period_key,
    legacy_catalog_reconciliation: emp?.legacy_catalog_reconciliation,
    legacy_reconciled_at: emp?.legacy_reconciled_at,
    catalog_active_reconciliation: emp?.catalog_active_reconciliation,
    reconciliation_snapshot_period_key: emp?.reconciliation_snapshot_period_key,
    reconciled_at: emp?.reconciled_at,
  };
  return Object.fromEntries(Object.entries(seed).filter(([, value]) => value !== undefined));
}

/*
 * Materializa la plantilla correspondiente a la semana seleccionada. Los datos
 * laborales salen del snapshot semanal; el catálogo maestro sólo aporta la
 * identidad y campos que no forman parte del snapshot. Un empleado que ya está
 * asignado al ROL nunca se elimina silenciosamente: si ya no aparece en la
 * plantilla se conserva marcado como ausente/baja para decisión de RHH.
 */
function employeesForWeek(db, week, assignments = []) {
  return buildAttendanceEmployeesForWeek(db, week, assignments, {
    excludedEmployeeIds: getSystemEmpIds(db),
  });
}

// Esta pantalla comparte colecciones históricas con el ROL por puestos. Se
// distingue por no tener shift_id para evitar que un guardado replace-all de
// Control de Asistencias borre asignaciones del otro flujo.
function findAttendanceRol(db, week) {
  return (db.rhh_weekly_rol || []).find(r => r.week_start === week && r.shift_id == null);
}

/* Crear o actualizar vale de tiempo extra para un registro de asistencia */
function upsertOvertimeVale(db, attRec, solicitado_por) {
  if (!db.rhh_overtime_vales) db.rhh_overtime_vales = [];
  const vales = db.rhh_overtime_vales;

  // Si ya existe un vale para este attendance id, actualizar (si sigue pendiente)
  const existing = vales.find(v => v.attendance_id === attRec.id && v.origen !== 'txt_excedente');
  if (existing) {
    if (existing.status === 'pendiente') {
      existing.te_hora_entrada = attRec.te_hora_entrada;
      existing.te_hora_salida  = attRec.te_hora_salida;
      existing.te_horas        = attRec.te_horas;
      existing.te_razon        = attRec.te_razon;
      existing.te_proyecto     = attRec.te_proyecto;
      existing.updated_at      = nowMxDateTime();
    }
    return existing.id;
  }

  const vale = {
    id:              nextId(vales),
    attendance_id:   attRec.id,
    employee_id:     attRec.employee_id,
    fecha:           attRec.fecha,
    te_hora_entrada: attRec.te_hora_entrada,
    te_hora_salida:  attRec.te_hora_salida,
    te_horas:        attRec.te_horas,
    te_razon:        attRec.te_razon,
    te_proyecto:     attRec.te_proyecto,
    status:          'pendiente',
    solicitado_por,
    creado_at:       nowMxDateTime(),
    autorizado_por:  null,
    autorizado_at:   null,
    notas_rechazo:   null,
  };
  vales.push(vale);
  return vale.id;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROL SEMANAL
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/rol?week=YYYY-MM-DD
router.get('/rol', rhhAuthRequired, (req, res) => {
  const week = weekMonday(req.query.week);
  const db   = read();

  const rol         = findAttendanceRol(db, week);
  const assignments = rol
    ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id)
    : [];

  const template = employeesForWeek(db, week, assignments);
  const templateEmployees = template.employees.filter(e => e.template_status === 'included');
  const assignedIds = new Set(assignments.map(a => a.employee_id));
  const employees = template.employees;

  const enrich = e => {
    const a        = assignments.find(x => x.employee_id === e.id);
    const shift    = (db.rhh_shifts    || []).find(s => s.id === (a?.shift_id ?? e.shift_id));
    const position = e.template_status === 'baja'
      ? { id: null, name: 'BAJA' }
      : (db.rhh_positions || []).find(p => p.id === (a?.position_id ?? e.position_id));
    const dept     = (db.rhh_departments || []).find(d => d.id === e.department_id);
    return { ...e, department: dept, position, shift, assignment: a || null };
  };

  const sortEmps = list => list.map(enrich).sort((a, b) => {
    const pa = a.position?.name || '';
    const pb = b.position?.name || '';
    if (pa !== pb) return pa.localeCompare(pb);
    return (a.full_name || '').localeCompare(b.full_name || '');
  });

  const assigned   = sortEmps(employees.filter(e =>  assignedIds.has(e.id)));
  const unassigned = sortEmps(templateEmployees.filter(e => !assignedIds.has(e.id)));
  const bajas      = sortEmps(employees.filter(e => e.template_status === 'baja' && !assignedIds.has(e.id)));

  // Agrupar asignados por turno
  const byShift = {};
  for (const emp of assigned) {
    const sn = emp.shift?.name || 'Sin turno';
    if (!byShift[sn]) byShift[sn] = { shift: emp.shift, employees: [] };
    byShift[sn].employees.push(emp);
  }

  res.json({
    week_start: week,
    rol:        rol ? { ...rol, version: rol.version || 1 } : null,
    version:    rol?.version || 0,
    by_shift:   byShift,
    assigned,
    unassigned,
    bajas,
    all_employees: [...assigned, ...unassigned, ...bajas],
    shifts:     db.rhh_shifts || [],
    positions:  db.rhh_positions || [],
    proyectos:  PROYECTOS,
    template_source: template.source,
    template_period: template.period,
    template_missing: template.employees.length === 0,
    catalog_reconciled_count: template.catalog_reconciled_count || 0,
    template_materialized: template.materialized || null,
  });
});

// POST /api/rhh/asistencia/plantilla/refresh
// Materializa una sola plantilla compartida para los tres submenús. No modifica
// asignaciones existentes; únicamente sincroniza membresía y bajas confirmadas.
router.post('/plantilla/refresh', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), async (req, res) => {
  const week = weekMonday(req.body?.week || req.body?.week_start);
  const currentWeek = weekMonday(nowMxDate());
  if (week < currentWeek) {
    return res.status(409).json({
      error: 'La plantilla histórica está protegida y no puede actualizarse con datos posteriores',
      code: 'HISTORICAL_TEMPLATE_LOCKED',
      week_start: week,
      current_week_start: currentWeek,
    });
  }
  const db = structuredClone(read());
  if (!Array.isArray(db.rhh_attendance_week_templates)) db.rhh_attendance_week_templates = [];

  const source = getEmployeeTemplateForWeek(db, week, {
    ignoreMaterialized: true,
    allowLatestLoaded: true,
  });
  const masters = new Map((db.rhh_employees || []).map(emp => [Number(emp.id), emp]));
  const systemIds = getSystemEmpIds(db);
  const targetPeriod = canonicalPeriod(source.period) || isoWeekPeriod(week);
  const latestSnapshotByEmployee = new Map();
  for (const snapshot of db.rhh_employee_period_snapshots || []) {
    const employeeId = Number(snapshot.employee_id);
    const period = canonicalPeriod(snapshot);
    if (!employeeId || !period) continue;
    if (targetPeriod && comparePeriods(period, targetPeriod) > 0) continue;
    const previous = latestSnapshotByEmployee.get(employeeId);
    if (!previous || comparePeriods(period, previous.period) > 0) {
      latestSnapshotByEmployee.set(employeeId, { snapshot, period });
    }
  }
  // Mientras RHH no confirme una baja, el catálogo maestro mantiene al
  // empleado disponible para la plantilla actual/futura. Tener un snapshot
  // histórico no debe excluirlo: ese era el hueco que omitía altas legacy.
  const activeCatalogCandidates = [...masters.values()].filter(emp =>
    emp.status === 'active'
    && !isConfirmedInactive(emp)
    && !systemIds.has(Number(emp.id))
    && hasValidPayrollNumber(emp)
  );
  if (!source.employees?.length && activeCatalogCandidates.length === 0) {
    return res.status(409).json({
      error: 'No hay una semana importada ni empleados activos para actualizar esta plantilla',
      template_source: source.source,
    });
  }
  const weekRoleIds = new Set((db.rhh_weekly_rol || [])
    .filter(rol => rol.week_start === week)
    .map(rol => Number(rol.id)));
  const assignedIds = new Set((db.rhh_rol_assignments || [])
    .filter(assignment => weekRoleIds.has(Number(assignment.rol_id)))
    .map(assignment => Number(assignment.employee_id)));

  const templates = db.rhh_attendance_week_templates;
  const existingIndex = templates.findIndex(template => template.week_start === week);
  const existing = existingIndex >= 0 ? templates[existingIndex] : null;
  let comparisonEmployees = existing?.employees || null;
  if (!comparisonEmployees) {
    comparisonEmployees = templates
      .filter(template => template.week_start < week)
      .sort((left, right) => left.week_start.localeCompare(right.week_start))
      .at(-1)?.employees || null;
  }
  if (!comparisonEmployees && source.period) {
    const sourcePeriod = canonicalPeriod(source.period);
    const periodMap = new Map();
    for (const snapshot of db.rhh_employee_period_snapshots || []) {
      const period = canonicalPeriod(snapshot);
      if (period) periodMap.set(period.period_key, period);
    }
    const previousPeriod = [...periodMap.values()]
      .filter(period => sourcePeriod && comparePeriods(period, sourcePeriod) < 0)
      .sort(comparePeriods)
      .at(-1);
    if (previousPeriod) {
      comparisonEmployees = (db.rhh_employee_period_snapshots || [])
        .filter(snapshot => canonicalPeriod(snapshot)?.period_key === previousPeriod.period_key);
    }
  }
  const previousIncludedIds = new Set((comparisonEmployees || [])
    .filter(employee => employee.template_status === undefined || employee.template_status === 'included')
    .map(employee => Number(employee.employee_id ?? employee.id)));
  const previousRows = new Map((existing?.employees || [])
    .map(employee => [Number(employee.employee_id ?? employee.id), employee]));
  const rows = new Map();

  const materialize = (raw, forcedStatus = null) => {
    const employeeId = Number(raw?.employee_id ?? raw?.id);
    if (!employeeId || systemIds.has(employeeId)) return;
    const master = masters.get(employeeId) || {};
    const seed = weeklyEmployeeSeed(raw);
    const templateStatus = forcedStatus || (isConfirmedInactive(master) ? 'baja' : 'included');
    rows.set(employeeId, {
      ...seed,
      employee_id: employeeId,
      employee_number: seed.employee_number ?? master.employee_number ?? null,
      full_name: seed.full_name || master.full_name || `Empleado ${employeeId}`,
      department_id: master.manual_department_locked
        ? (master.department_id ?? null)
        : (seed.department_id ?? master.department_id ?? null),
      position_id: master.manual_position_locked
        ? (master.position_id ?? null)
        : (seed.position_id ?? master.position_id ?? null),
      shift_id: master.manual_shift_locked
        ? (master.shift_id ?? null)
        : (seed.shift_id ?? master.shift_id ?? null),
      project: master.manual_project_locked
        ? (master.project ?? null)
        : (seed.project ?? master.project ?? null),
      sal_diario: master.manual_salary_locked
        ? (master.sal_diario ?? master.salary_daily ?? null)
        : (seed.sal_diario ?? master.sal_diario ?? master.salary_daily ?? null),
      salary_daily: master.manual_salary_locked
        ? (master.salary_daily ?? master.sal_diario ?? null)
        : (seed.salary_daily ?? seed.sal_diario ?? master.salary_daily ?? master.sal_diario ?? null),
      fecha_ingreso: master.manual_start_date_locked
        ? (master.fecha_ingreso ?? master.start_date ?? null)
        : (seed.fecha_ingreso ?? master.fecha_ingreso ?? master.start_date ?? null),
      status_at_period: templateStatus === 'baja' ? 'inactive' : (seed.status_at_period || 'active'),
      template_status: templateStatus,
      template_period_key: source.period?.period_key || seed.period_key || null,
    });
  };

  for (const snapshot of source.employees) materialize(snapshot);

  const catalogRecovered = [];
  const legacyRecovered = [];
  for (const emp of activeCatalogCandidates) {
    if (rows.has(Number(emp.id))) continue;
    const latest = latestSnapshotByEmployee.get(Number(emp.id));
    const period = targetPeriod || latest?.period || null;
    materialize({
      ...weeklyEmployeeSeed(latest?.snapshot || emp),
      employee_id: Number(emp.id),
      employee_number: emp.employee_number,
      full_name: emp.full_name,
      no_periodo: period?.no_periodo,
      year: period?.year,
      period_key: period?.period_key,
      fecha_inicio: source.period?.fecha_inicio || null,
      fecha_fin: source.period?.fecha_fin || null,
      present_in_payroll: false,
      source: 'catalog_active_reconciliation',
      catalog_active_reconciliation: true,
      reconciliation_snapshot_period_key: latest?.period?.period_key || null,
      reconciled_at: nowMxDateTime(),
    }, 'included');
    const recovered = {
      id: emp.id,
      employee_number: emp.employee_number,
      full_name: emp.full_name,
      last_snapshot_period_key: latest?.period?.period_key || null,
    };
    catalogRecovered.push(recovered);
    if (!latest) legacyRecovered.push(recovered);
  }

  // Una asignación nunca desaparece por actualizar la plantilla. Si falta en la
  // última nómina queda como ausente; sólo una baja confirmada recibe "BAJA".
  for (const employeeId of assignedIds) {
    if (rows.has(employeeId)) continue;
    const master = masters.get(employeeId);
    if (!master) continue;
    materialize(weeklyEmployeeSeed(master), isConfirmedInactive(master) ? 'baja' : 'absent');
  }

  // Conserva bajas confirmadas que ya pertenecían a esta plantilla aunque no
  // estén asignadas, para que los tres submenús reflejen la misma decisión.
  for (const [employeeId, previous] of previousRows) {
    if (rows.has(employeeId)) continue;
    const master = masters.get(employeeId);
    if (isConfirmedInactive(master)) materialize({ ...previous, ...weeklyEmployeeSeed(master) }, 'baja');
  }

  const employees = [...rows.values()];
  const included = employees.filter(employee => employee.template_status === 'included');
  const newEmployees = included.filter(employee => !previousIncludedIds.has(Number(employee.employee_id)));
  const now = nowMxDateTime();
  const templateRecord = {
    ...(existing || {}),
    id: existing?.id ?? nextId(templates),
    week_start: week,
    source: source.source,
    source_period: source.period || null,
    source_period_key: source.period?.period_key || null,
    employees,
    version: Number(existing?.version || 0) + 1,
    created_at: existing?.created_at || now,
    updated_at: now,
    updated_by: req.rhhUser.email || req.rhhUser.full_name || 'rhh',
  };
  if (existingIndex >= 0) templates[existingIndex] = templateRecord;
  else templates.push(templateRecord);

  try {
    await writeAsync(db);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo guardar la plantilla: ' + error.message });
  }

  res.json({
    ok: true,
    week_start: week,
    template: templateRecord,
    added: newEmployees.length,
    new_employees: newEmployees.map(employee => ({
      id: employee.employee_id,
      employee_number: employee.employee_number,
      full_name: employee.full_name,
    })),
    active: included.length,
    confirmed_inactive: employees.filter(employee => employee.template_status === 'baja').length,
    assigned_preserved: assignedIds.size,
    catalog_recovered: catalogRecovered.length,
    catalog_employees: catalogRecovered,
    legacy_recovered: legacyRecovered.length,
    legacy_employees: legacyRecovered,
  });
});

// POST /api/rhh/asistencia/rol
router.post('/rol', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), async (req, res) => {
  const { week_start, no_periodo, assignments = [], version = 0 } = req.body || {};
  if (!week_start) return res.status(400).json({ error: 'week_start requerido' });

  const db    = structuredClone(read());
  let   roles = db.rhh_weekly_rol    || [];
  let   asigs = db.rhh_rol_assignments || [];

  let rol = roles.find(r => r.week_start === week_start && r.shift_id == null);
  const currentVersion = rol?.version || (rol ? 1 : 0);
  if (Number(version) !== currentVersion) {
    return res.status(409).json({
      error: 'El ROL fue actualizado desde otra sesión. Recarga antes de guardar.',
      current_version: currentVersion,
    });
  }

  const originalAssignments = rol
    ? asigs.filter(a => a.rol_id === rol.id)
      .map(a => ({ employee_id: Number(a.employee_id), shift_id: Number(a.shift_id), position_id: a.position_id ? Number(a.position_id) : null, project: a.project || null }))
      .sort((a, b) => a.employee_id - b.employee_id)
    : [];
  const requestedAssignments = assignments
    .filter(a => a.employee_id && a.shift_id)
    .map(a => ({ employee_id: Number(a.employee_id), shift_id: Number(a.shift_id), position_id: a.position_id ? Number(a.position_id) : null, project: a.project || null }))
    .sort((a, b) => a.employee_id - b.employee_id);
  if (rol && JSON.stringify(originalAssignments) === JSON.stringify(requestedAssignments)) {
    return res.json({ ok: true, rol, version: currentVersion, saved: requestedAssignments.length, unchanged: true });
  }
  if (!rol) {
    rol = {
      id:         nextId(roles),
      week_start,
      no_periodo: no_periodo || null,
      scope:      'attendance_control',
      status:     'published',
      created_by: req.rhhUser.email || req.rhhUser.full_name,
      created_at: nowMxDate(),
      version:    1,
    };
    roles.push(rol);
  } else {
    rol.updated_at = nowMxDate();
    rol.status     = 'published';
    rol.version    = currentVersion + 1;
  }

  asigs = asigs.filter(a => a.rol_id !== rol.id);
  for (const a of assignments) {
    if (!a.employee_id || !a.shift_id) continue;
    asigs.push({
      id:          nextId(asigs),
      rol_id:      rol.id,
      employee_id: Number(a.employee_id),
      shift_id:    Number(a.shift_id),
      position_id: a.position_id ? Number(a.position_id) : null,
      project:     a.project || null,
      notas:       a.notas   || null,
    });
  }

  db.rhh_weekly_rol      = roles;
  db.rhh_rol_assignments = asigs;
  // writeAsync garantiza persistencia en PostgreSQL antes de responder
  try { await writeAsync(db); } catch(e) { return res.status(500).json({ error: 'Error al guardar ROL: ' + e.message }); }
  res.json({ ok: true, rol, version: rol.version, saved: assignments.length });
});

// GET /api/rhh/asistencia/rol/html?week=YYYY-MM-DD — HTML para imprimir/PDF
router.get('/rol/html', rhhAuthRequired, (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week).slice(0, 6); // Solo L-S para impresión
  const DIAS_SHORT = ['L','M','Mi','J','V','S'];
  const DIAS  = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const db    = read();

  const rol         = findAttendanceRol(db, week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];
  const weeklyTemplate = employeesForWeek(db, week, assignments);
  const employees   = weeklyTemplate.employees;
  const positions   = db.rhh_positions  || [];
  const shifts      = db.rhh_shifts     || [];

  // Color por código de turno (mismos colores que el frontend)
  const SHIFT_COLORS = { T1: '#1d4ed8', T2: '#0f766e', T3: '#7c3aed', T4: '#b45309' };
  const DEFAULT_COLOR = '#475569';
  function shiftColor(shift) {
    if (shift?.color) return shift.color;
    return SHIFT_COLORS[shift?.code] || DEFAULT_COLOR;
  }

  const rows = assignments
    .map(a => {
      const emp   = employees.find(e => e.id === a.employee_id);
      const shift = shifts.find(s => s.id === a.shift_id);
      const pos   = emp?.template_status === 'baja'
        ? { id: null, name: 'BAJA' }
        : positions.find(p => p.id === (a.position_id ?? emp?.position_id));
      return { ...a, emp, shift, pos };
    })
    .filter(r => r.emp)
    // Excluir turno administrativo de la impresión
    .filter(r => !(r.shift?.name || '').toLowerCase().includes('administrativo'))
    .sort((a, b) => {
      if ((a.shift?.name || '') !== (b.shift?.name || '')) return (a.shift?.name || '').localeCompare(b.shift?.name || '');
      return (a.emp?.full_name || '').localeCompare(b.emp?.full_name || '');
    });

  const byShift = {};
  rows.forEach(r => {
    const sn = r.shift?.name || 'Sin turno';
    if (!byShift[sn]) byShift[sn] = { shift: r.shift, rows: [] };
    byShift[sn].rows.push(r);
  });

  // Ordenar: Turno 1, Turno 2, Turno 3 primero, luego el resto alfabético
  const PRIORITY = ['turno 1', 'turno 2', 'turno 3'];
  const sortedShiftEntries = Object.entries(byShift).sort((a, b) => {
    const ai = PRIORITY.indexOf(a[0].toLowerCase());
    const bi = PRIORITY.indexOf(b[0].toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a[0].localeCompare(b[0]);
  });

  const d0 = new Date(dates[0] + 'T12:00:00');
  const d5 = new Date(dates[5] + 'T12:00:00');
  const semLbl = `${d0.getDate()} ${MES[d0.getMonth()]} al ${d5.getDate()} ${MES[d5.getMonth()]} ${d5.getFullYear()}`;

  // Cabeceras de días con fecha
  const dayHeaders = dates.map((dt, i) => {
    const d = new Date(dt + 'T12:00:00');
    return `<th class="day-col">${DIAS_SHORT[i]}<br><span class="day-date">${d.getDate()} ${MES[d.getMonth()]}</span></th>`;
  }).join('');

  // Construir filas
  const totalCols = 4 + 6; // No., Nombre, Puesto, Horario + 6 días
  let tableBody = '';
  for (const [shiftName, { shift, rows: sRows }] of sortedShiftEntries) {
    const color    = shiftColor(shift);
    // Color suave para filas de empleados (10% opacidad del color del turno)
    const lightBg  = color + '18';
    const workDays = shift?.work_days || [1,2,3,4,5];
    const entry    = shift?.start_time || '—';
    const exitTime = shift?.end_time   || '—';
    const empCount = sRows.length;

    // Fila separadora de turno con color
    tableBody += `
      <tr class="shift-header" style="background:${color};">
        <td colspan="${totalCols}">
          ━━━ ${shiftName} · ${entry} – ${exitTime} · ${empCount} empleado${empCount !== 1 ? 's' : ''}
        </td>
      </tr>`;

    for (const r of sRows) {
      const posName = r.pos?.name || '—';

      // Celdas de días: marca ✓ si trabaja, D si descansa
      const dayCells = dates.map((_, di) => {
        const dow = di + 1;
        const works = workDays.includes(dow);
        if (works) {
          return `<td class="day-cell work" style="--sc:${color};">✓</td>`;
        }
        return `<td class="day-cell rest">D</td>`;
      }).join('');

      tableBody += `
        <tr class="emp-row" style="background:${lightBg};">
          <td class="col-num">${r.emp?.employee_number || ''}</td>
          <td class="col-name">${r.emp?.full_name || ''}</td>
          <td class="col-pos">${posName}</td>
          <td class="col-hours">${entry} – ${exitTime}</td>
          ${dayCells}
        </tr>`;
    }
  }

  if (!tableBody) tableBody = `<tr><td colspan="${totalCols}" style="padding:20px;text-align:center;color:#9ca3af;">Sin asignaciones en este rol</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Rol Semanal — ${semLbl}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 12px; background: #fff; }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; border-bottom: 2px solid #7cb9e8; padding-bottom: 8px; }
  .header img { height: 40px; }
  .header-text { flex: 1; }
  .header-text h1 { font-size: 14px; font-weight: 800; color: #0f172a; letter-spacing: .3px; margin-bottom: 1px; }
  .header-text .week-label { font-size: 11px; color: #475569; font-weight: 600; }
  .btn-print { display: inline-block; margin-bottom: 10px; padding: 5px 16px; background: #1e3a5f; color: #fff; border: none; border-radius: 5px; cursor: pointer; font-size: 11px; font-weight: 600; }
  .btn-print:hover { background: #15304f; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #94a3b8; }
  thead th { background: #1e293b; color: #fff; padding: 3px 4px; text-align: left; font-size: 10px; font-weight: 700; border: 1px solid #475569; }
  thead th.day-col { text-align: center; width: 38px; min-width: 38px; padding: 3px 2px; }
  thead .day-date { font-size: 8px; font-weight: 400; opacity: .8; }
  .shift-header td { color: #fff; font-size: 11px; font-weight: 800; padding: 4px 6px; letter-spacing: .3px; border: 1px solid rgba(255,255,255,.3); }
  .emp-row td { padding: 2px 4px; border: 1px solid #cbd5e1; }
  .col-num { width: 35px; color: #64748b; font-weight: 600; text-align: center; font-size: 9px; }
  .col-name { font-weight: 600; white-space: nowrap; font-size: 10px; }
  .col-pos { color: #475569; font-size: 9px; }
  .col-hours { text-align: center; font-weight: 600; color: #334155; white-space: nowrap; font-size: 9px; }
  .day-cell { text-align: center; font-weight: 700; font-size: 10px; width: 38px; border: 1px solid #cbd5e1; }
  .day-cell.work { color: var(--sc, #16a34a); background: color-mix(in srgb, var(--sc, #16a34a) 10%, transparent); }
  .day-cell.rest { color: #94a3b8; background: #f1f5f9; font-size: 9px; }
  .legend { margin-top: 8px; display: flex; gap: 12px; flex-wrap: wrap; font-size: 10px; align-items: center; }
  .legend-item { display: flex; align-items: center; gap: 3px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
  .summary { margin-top: 6px; font-size: 10px; color: #64748b; }
  @media print {
    @page { size: portrait; margin: 6mm; }
    .btn-print { display: none; }
    body { padding: 0; font-size: 9px; }
    table { font-size: 9px; }
    .col-name { font-size: 9px; }
    .col-num, .col-pos, .col-hours { font-size: 8px; }
    .day-cell { font-size: 9px; width: 34px; }
    thead th { font-size: 9px; padding: 2px 3px; }
    .emp-row td { padding: 1px 3px; }
    .shift-header td { font-size: 10px; padding: 3px 5px; }
  }
</style>
</head><body>
<div class="header">
  <img src="/img/logo.png" alt="Cuesto" />
  <div class="header-text">
    <h1>CORPORATIVO CUESTO — ROL DE SEMANA ${(() => { const d = new Date(week + 'T12:00:00'); const jan4 = new Date(d.getFullYear(), 0, 4); const s = new Date(jan4); s.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7)); return Math.floor((d - s) / 604800000) + 1; })()}</h1>
    <div class="week-label">${semLbl}</div>
  </div>
</div>
<button class="btn-print" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
<table>
  <thead>
    <tr>
      <th>No.</th>
      <th>Nombre</th>
      <th>Puesto</th>
      <th>Horario</th>
      ${dayHeaders}
    </tr>
  </thead>
  <tbody>${tableBody}</tbody>
</table>
<div class="legend">
  <strong>Turnos:</strong>
  ${sortedShiftEntries.map(([name, { shift }]) => {
    const c = shiftColor(shift);
    return `<span class="legend-item"><span class="legend-dot" style="background:${c};"></span> ${name}</span>`;
  }).join('')}
  <span class="legend-item" style="margin-left:16px;"><span class="legend-dot" style="background:#f1f5f9;border:1px solid #cbd5e1;"></span> D = Descanso</span>
</div>
<div class="summary">Total empleados: ${rows.length} &nbsp;|&nbsp; Generado: ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })}</div>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ══════════════════════════════════════════════════════════════════════════════
// ASISTENCIA DIARIA
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/diaria?week=YYYY-MM-DD&shift_id=X
router.get('/diaria', rhhAuthRequired, async (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const today = nowMxDate();
  const db    = read();
  const role  = req.rhhUser.role;

  const rol         = findAttendanceRol(db, week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];

  const template = employeesForWeek(db, week, assignments);
  // Un cumpleaños en domingo genera por sí mismo la gratificación de la
  // semana siguiente. Si además es festivo, prevalece la regla de no laborar
  // y no se genera el beneficio para evitar acumulaciones incompatibles.
  if (ensureAutomaticSundayBirthdayGratifications(db, template.employees, dates)) {
    try {
      await writeAsync(db);
    } catch (err) {
      return res.status(500).json({ error: 'No fue posible actualizar las gratificaciones de cumpleaños' });
    }
  }
  // Los tres submenús consumen la misma plantilla. Quien aún no tiene turno se
  // muestra como "Sin turno" en vez de desaparecer de Capturar/Lista.
  let employees = template.employees;
  if (req.query.shift_id) {
    const sid = Number(req.query.shift_id);
    employees = employees.filter(emp => {
      const assignment = assignments.find(a => Number(a.employee_id) === Number(emp.id));
      return Number(assignment?.shift_id ?? emp.shift_id) === sid;
    });
  }
  const positions  = db.rhh_positions  || [];
  const shifts     = db.rhh_shifts     || [];
  const holidays   = (db.rhh_holidays  || []).map(h => h.date);
  const vacSols    = (db.rhh_vac_solicitudes || []).filter(v => v.estado === 'aprobada');
  const records    = (db.rhh_attendance || []).filter(r =>
    r.fecha >= dates[0] && r.fecha <= dates[6]
  );
  const audits     = db.rhh_attendance_audit || [];
  const ovVales    = db.rhh_overtime_vales   || [];
  const unlocks    = db.rhh_attendance_unlocks || [];

  // Pre-cargar datos TxT y cumpleaños para enriquecer grid
  const allDeudas  = getTxtDeudas(db);
  const allPagos   = getTxtPagos(db);
  const allBonos   = getBonoVales(db);
  const cumpleIncs = getCumpleIncidencias(db);

  const grid = employees
    .map(emp => {
      const ra       = assignments.find(a => a.employee_id === emp.id);
      const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
      const position = emp.template_status === 'baja'
        ? { id: null, name: 'BAJA' }
        : positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

      const txtHorasPend = getTxtBalanceAsOf(db, emp.id, dates[6]);

      const days = dates.map((fecha, di) => {
        const rec      = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
        const dow      = di + 1; // 1=L..6=S, 7=Dom
        const isSunday = dow === 7;
        const worksDay = shift?.work_days ? shift.work_days.includes(dow) : dow <= 5;
        const isFest   = holidays.includes(fecha);
        const isVac    = vacSols.some(v =>
          v.employee_id === emp.id && fecha >= v.fecha_inicio && fecha <= v.fecha_fin
        );

        let autoType = null;
        if (!worksDay) autoType = 'descanso';
        if (isFest)    autoType = 'festivo';
        if (isVac)     autoType = 'vacacion';
        if (emp.template_status === 'baja') autoType = 'baja';

        const locked    = isLockedForSupervisor(rec, fecha, role, unlocks);
        const vale      = rec ? ovVales.find(v => v.attendance_id === rec.id) : null;
        const recAudit  = rec ? audits.filter(a => a.attendance_id === rec.id)
          .sort((a, b) => a.id - b.id) : [];

        // Cumpleaños
        const isBirthday = !!(emp.birth_date && emp.birth_date.slice(5) === fecha.slice(5));
        const cumpleRegistro = cumpleIncs.find(c => c.employee_id === emp.id && c.birth_date_match === fecha);
        // Bonos del día
        const dayBonos = allBonos.filter(b => b.employee_id === emp.id && b.fecha === fecha);
        // Pagos TxT del día (se conservan separados de la incidencia base)
        const dayTxtPagos = allPagos.filter(p => p.employee_id === emp.id && p.fecha_pago === fecha);
        const txtPagadoHoras = dayTxtPagos.reduce((s, p) => s + (Number(p.horas_aplicadas) || 0), 0);
        const txtExcedenteHoras = dayTxtPagos.reduce((s, p) => s + (Number(p.horas_extra_sobrante) || 0), 0);
        const origenTxtDeuda = rec
          ? allDeudas.find(d => d.origen_attendance_id === rec.id && d.status !== 'cancelado')
          : null;

        return {
          fecha,
          id:                 rec?.id               ?? null,
          incidencia_type:    rec?.incidencia_type  ?? autoType,
          tiempo_retardo_min: rec?.tiempo_retardo_min ?? null,
          proyecto:           rec?.proyecto          ?? ra?.project ?? emp.project ?? null,
          proyectos:          rec?.proyectos         ?? null,
          notas:              rec?.notas             ?? null,
          horas_pendientes_turno: rec?.horas_pendientes_turno ?? null,
          is_auto:            !rec && !!autoType,
          registrado_por:     rec?.registrado_por    ?? null,
          registered_at:      rec?.updated_at        ?? rec?.created_at ?? null,
          // Tiempo extra
          te_activo:          rec?.te_activo          ?? false,
          te_hora_entrada:    rec?.te_hora_entrada    ?? null,
          te_hora_salida:     rec?.te_hora_salida     ?? null,
          te_horas:           rec?.te_horas           ?? null,
          te_razon:           rec?.te_razon           ?? null,
          te_proyecto:        rec?.te_proyecto        ?? null,
          te_vale_id:         vale?.id                ?? null,
          te_vale_status:     vale?.status            ?? null,
          // Sunday / Lock
          is_sunday:          isSunday,
          is_locked:          locked,
          // Cumpleaños
          is_birthday:        isBirthday,
          cumpleanos_laborado: !!cumpleRegistro?.laboro,
          is_holiday:         isFest,
          holiday_name:       isFest ? ((db.rhh_holidays || []).find(h => h.date === fecha)?.name || 'Festivo') : null,
          birthday_holiday_conflict: isBirthday && isFest,
          festivo_laborado:    isFest && rec?.incidencia_type === 'labora',
          // Tiempo por Tiempo pagado en esta fecha
          txt_pagado_horas:    txtPagadoHoras,
          txt_excedente_horas: txtExcedenteHoras,
          txt_pagos:           dayTxtPagos.map(p => ({
            id: p.id,
            horas_aplicadas: p.horas_aplicadas,
            horas_extra_sobrante: p.horas_extra_sobrante || 0,
            tipo_pago: p.tipo_pago,
          })),
          txt_deuda_id:        origenTxtDeuda?.id || null,
          txt_deuda_status:    origenTxtDeuda?.status || null,
          txt_deuda_horas:     origenTxtDeuda?.horas_deuda_original || null,
          // Bonos
          bonos:              dayBonos.map(b => ({ id: b.id, type: b.bono_type, status: b.status })),
          // Audit trail (para modal RHH/Admin)
          audit_trail:        recAudit.map(a => ({
            cambiado_por: a.cambiado_por,
            cambiado_at:  a.cambiado_at,
            campo:        a.campo,
            de:           a.valor_anterior,
            a:            a.valor_nuevo,
            motivo:       a.motivo,
          })),
        };
      });

      return {
        employee_id:     emp.id,
        employee_number: emp.employee_number,
        full_name:       emp.full_name,
        position:        position?.name || '',
        shift_name:      shift?.name    || '',
        shift_id:        ra?.shift_id   ?? emp.shift_id,
        project_default: ra?.project    ?? emp.project ?? null,
        template_status: emp.template_status,
        txt_horas_pendientes: txtHorasPend,
        birth_date:      emp.birth_date || null,
        days,
      };
    })
    .sort((a, b) => {
      if (a.shift_name !== b.shift_name) return a.shift_name.localeCompare(b.shift_name);
      if (a.position   !== b.position)   return a.position.localeCompare(b.position);
      return a.full_name.localeCompare(b.full_name);
    });

  // Datos de turnos para frontend (shift hours)
  const shiftsWithHours = shifts.map(s => ({ ...s, hours: shiftHours(db, s.id) }));

  res.json({
    week_start:      week,
    today,
    dates,
    shifts:          shiftsWithHours,
    proyectos:       PROYECTOS,
    unlocks:         unlocks.filter(u => u.active !== false),
    overtime_razones: OVERTIME_RAZONES,
    incidencia_types: INCIDENCIA_LABELS,
    bonos_week: allBonos
      .filter(b => b.fecha >= dates[0] && b.fecha <= dates[6] && b.status !== 'rechazado')
      .map(b => ({ id: b.id, employee_id: b.employee_id, bono_type: b.bono_type, fecha: b.fecha, status: b.status })),
    grid,
    user_role:       role,
    template_source: template.source,
    template_period: template.period,
    template_missing: template.employees.length === 0,
    catalog_reconciled_count: template.catalog_reconciled_count || 0,
  });
});

function syncDeudaTurnoIncompleto(db, attRec, userLabel) {
  const deudas = getTxtDeudas(db);
  const existing = deudas.find(d => d.origen_attendance_id === attRec.id && d.origen_tipo === 'turno_incompleto' && d.status !== 'cancelado');
  const horas = attRec.incidencia_type === 'turno_incompleto'
    ? Number(attRec.horas_pendientes_turno) || 0
    : 0;

  if (!existing && horas > 0) {
    deudas.push({
      id: nextId(deudas),
      employee_id: attRec.employee_id,
      origen_attendance_id: attRec.id,
      origen_fecha: attRec.fecha,
      origen_tipo: 'turno_incompleto',
      horas_deuda_original: horas,
      horas_pagadas: 0,
      horas_pendientes: horas,
      status: 'pendiente_pago',
      created_at: nowMxDateTime(),
      created_by: userLabel,
      updated_at: null,
    });
    return;
  }
  if (!existing) return;

  const pagadas = Number(existing.horas_pagadas) || 0;
  if (horas <= 0) {
    // Conserva pagos históricos; cancela únicamente el saldo no liquidado.
    existing.horas_deuda_original = pagadas;
    existing.horas_pendientes = 0;
    existing.status = pagadas > 0 ? 'pagado' : 'cancelado';
    existing.ajuste_motivo = 'Incidencia turno incompleto eliminada';
  } else {
    existing.horas_deuda_original = Math.max(horas, pagadas);
    existing.horas_pendientes = Math.max(0, existing.horas_deuda_original - pagadas);
    existing.status = existing.horas_pendientes > 0 ? 'pendiente_pago' : 'pagado';
    existing.ajuste_motivo = horas < pagadas ? 'Horas ajustadas al mínimo ya pagado' : null;
  }
  existing.updated_at = nowMxDateTime();
  existing.updated_by = userLabel;
}

// ── Función interna de upsert para bulk y single ──────────────────────────────
function upsertAttendance(att, item, userLabel, role, skipLockCheck, unlocks, db) {
  const {
    employee_id, fecha, incidencia_type, tiempo_retardo_min,
    proyecto, proyectos, shift_id, notas,
    te_activo, te_hora_entrada, te_hora_salida, te_razon, te_proyecto,
    horas_pendientes_turno,
  } = item;

  if (!employee_id || !fecha || !incidencia_type) return { error: 'Campos requeridos faltantes', skip: true };
  if (!INCIDENCIA_TYPES.includes(incidencia_type)) return { error: `incidencia_type inválido: ${incidencia_type}`, skip: true };
  if (incidencia_type === 'paro_tecnico' && !['rh','admin'].includes(role)) return { error: 'Paro técnico solo RHH/Admin', skip: true };
  if (incidencia_type === 'turno_incompleto' && !(Number(horas_pendientes_turno) > 0)) {
    return { error: 'Turno incompleto requiere horas pendientes mayores que cero', skip: true };
  }

  const dayContext = db ? employeeDayContext(db, employee_id, fecha) : null;
  const workIncidences = ['labora', 'retardo', 'turno_incompleto', 'paro_tecnico'];
  if (dayContext?.birthdayHolidayConflict && (workIncidences.includes(incidencia_type) || te_activo)) {
    return { error: 'El trabajador no puede laborar: su cumpleaños coincide con un festivo', skip: true };
  }

  // Bloqueo TE si hay deuda TxT activa
  if (te_activo && db) {
    const horasPend = getTotalHorasPendientes(db, employee_id);
    if (horasPend > 0) {
      return { error: `No puede hacer TE: debe ${horasPend}h (TxT)`, skip: true };
    }
  }

  const today = nowMxDate();
  const idx   = att.findIndex(r => r.employee_id === Number(employee_id) && r.fecha === fecha);

  // Lock check para supervisores (respeta desbloqueos vigentes)
  if (!skipLockCheck && role === 'supervisor' && fecha < today && idx !== -1 && att[idx].incidencia_type) {
    const now = nowMxDateTime();
    const hasUnlock = (unlocks || []).some(u =>
      u.fecha === fecha && u.active !== false && u.start_dt <= now && u.end_dt >= now
    );
    if (!hasUnlock) return { error: 'Incidencia bloqueada para supervisor', locked: true, skip: true };
  }

  const teHoras = te_activo ? calcHoras(te_hora_entrada, te_hora_salida) : null;

  // Multi-proyecto: si viene 'proyectos' (array [{name,pct}]) lo usa; si viene 'proyecto' (string) lo convierte
  let proyectosArr = null;
  if (Array.isArray(proyectos) && proyectos.length > 0) {
    proyectosArr = proyectos;
  } else if (proyecto) {
    proyectosArr = [{ name: proyecto, pct: 100 }];
  }

  const hpTurno = incidencia_type === 'turno_incompleto' && horas_pendientes_turno > 0
    ? Number(horas_pendientes_turno) : null;

  if (idx !== -1) {
    att[idx] = {
      ...att[idx],
      incidencia_type,
      tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : att[idx].tiempo_retardo_min,
      proyecto:           proyecto    ?? att[idx].proyecto,
      proyectos:          proyectosArr ?? att[idx].proyectos ?? null,
      shift_id:           shift_id    ? Number(shift_id) : att[idx].shift_id,
      notas:              notas       ?? att[idx].notas,
      te_activo:          !!te_activo,
      te_hora_entrada:    te_activo ? (te_hora_entrada || null) : null,
      te_hora_salida:     te_activo ? (te_hora_salida  || null) : null,
      te_horas:           teHoras,
      te_razon:           te_activo ? (te_razon    || null) : null,
      te_proyecto:        te_activo ? (te_proyecto || null) : null,
      horas_pendientes_turno: hpTurno,
      registrado_por:     userLabel,
      updated_at:         nowMxDateTime(),
    };
    if (db) syncDeudaTurnoIncompleto(db, att[idx], userLabel);
    return { rec: att[idx], isNew: false };
  }

  const rec = {
    id:                 nextId(att),
    employee_id:        Number(employee_id),
    fecha,
    incidencia_type,
    tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : null,
    proyecto:           proyecto   || null,
    proyectos:          proyectosArr || null,
    shift_id:           shift_id   ? Number(shift_id) : null,
    notas:              notas      || null,
    te_activo:          !!te_activo,
    te_hora_entrada:    te_activo ? (te_hora_entrada || null) : null,
    te_hora_salida:     te_activo ? (te_hora_salida  || null) : null,
    te_horas:           teHoras,
    te_razon:           te_activo ? (te_razon    || null) : null,
    te_proyecto:        te_activo ? (te_proyecto || null) : null,
    horas_pendientes_turno: hpTurno,
    registrado_por:     userLabel,
    created_at:         nowMxDateTime(),
  };
  att.push(rec);
  if (db) syncDeudaTurnoIncompleto(db, rec, userLabel);
  return { rec, isNew: true };
}

// POST /api/rhh/asistencia/diaria — guardar un registro individual (per-row)
router.post('/diaria', rhhAuthRequired, async (req, res) => {
  const db      = read();
  const att     = db.rhh_attendance || [];
  const role    = req.rhhUser.role;
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;
  const unlocks = db.rhh_attendance_unlocks || [];

  const result = upsertAttendance(att, req.body || {}, userLbl, role, false, unlocks, db);

  if (result.skip) {
    const code = result.locked ? 403 : 400;
    return res.status(code).json({ error: result.error });
  }

  // Generar/actualizar vale de tiempo extra si aplica
  if (result.rec.te_activo) {
    const valeId = upsertOvertimeVale(db, result.rec, userLbl);
    result.rec.te_vale_id = valeId;
  }

  db.rhh_attendance = att;
  try {
    await writeAsync(db);
    res.status(result.isNew ? 201 : 200).json(result.rec);
  } catch (err) {
    res.status(500).json({ error: 'No fue posible guardar la asistencia' });
  }
});

// POST /api/rhh/asistencia/diaria/bulk — guardar múltiples registros (compatibilidad)
router.post('/diaria/bulk', rhhAuthRequired, async (req, res) => {
  const { records = [] } = req.body || {};
  if (!records.length) return res.json({ ok: true, saved: 0 });

  const db      = read();
  const att     = db.rhh_attendance || [];
  const role    = req.rhhUser.role;
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;
  const unlocks = db.rhh_attendance_unlocks || [];
  let saved = 0, locked = 0;

  for (const item of records) {
    const result = upsertAttendance(att, item, userLbl, role, false, unlocks, db);
    if (result.skip) {
      if (result.locked) locked++;
      continue;
    }
    if (result.rec.te_activo) {
      upsertOvertimeVale(db, result.rec, userLbl);
    }
    saved++;
  }

  db.rhh_attendance = att;
  try {
    await writeAsync(db);
    res.json({ ok: true, saved, locked });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible guardar las asistencias' });
  }
});

// PUT /api/rhh/asistencia/diaria/:id/rh-editar — RHH/Admin override con trazabilidad
router.put('/diaria/:id/rh-editar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), async (req, res) => {
  const id      = Number(req.params.id);
  const { incidencia_type, proyecto, notas, motivo } = req.body || {};

  if (!motivo) return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });
  if (incidencia_type && !INCIDENCIA_TYPES.includes(incidencia_type)) {
    return res.status(400).json({ error: 'incidencia_type inválido' });
  }

  const db  = read();
  const att = db.rhh_attendance || [];
  const idx = att.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Registro no encontrado' });
  if (incidencia_type === 'turno_incompleto' && !(Number(att[idx].horas_pendientes_turno) > 0)) {
    return res.status(400).json({ error: 'Turno incompleto requiere horas pendientes mayores que cero' });
  }
  if (incidencia_type && ['labora', 'retardo', 'turno_incompleto', 'paro_tecnico'].includes(incidencia_type)) {
    const ctx = employeeDayContext(db, att[idx].employee_id, att[idx].fecha);
    if (ctx.birthdayHolidayConflict) {
      return res.status(400).json({ error: 'El trabajador no puede laborar: su cumpleaños coincide con un festivo' });
    }
  }

  const old = { ...att[idx] };
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;

  // Registrar en audit trail
  if (!db.rhh_attendance_audit) db.rhh_attendance_audit = [];
  const audits = db.rhh_attendance_audit;

  const fields = [];
  if (incidencia_type && incidencia_type !== old.incidencia_type) {
    fields.push({ campo: 'incidencia_type', valor_anterior: old.incidencia_type, valor_nuevo: incidencia_type });
  }
  if (proyecto !== undefined && proyecto !== old.proyecto) {
    fields.push({ campo: 'proyecto', valor_anterior: old.proyecto, valor_nuevo: proyecto });
  }
  if (notas !== undefined && notas !== old.notas) {
    fields.push({ campo: 'notas', valor_anterior: old.notas, valor_nuevo: notas });
  }

  for (const f of fields) {
    audits.push({
      id:             nextId(audits),
      attendance_id:  id,
      employee_id:    old.employee_id,
      fecha:          old.fecha,
      campo:          f.campo,
      valor_anterior: f.valor_anterior,
      valor_nuevo:    f.valor_nuevo,
      cambiado_por:   userLbl,
      cambiado_at:    nowMxDateTime(),
      motivo,
    });
  }

  // Aplicar cambios
  if (incidencia_type) att[idx].incidencia_type = incidencia_type;
  if (proyecto !== undefined) att[idx].proyecto = proyecto || null;
  if (notas !== undefined) att[idx].notas = notas || null;
  att[idx].editado_por_rh = userLbl;
  att[idx].editado_at_rh  = nowMxDateTime();
  syncDeudaTurnoIncompleto(db, att[idx], userLbl);

  db.rhh_attendance       = att;
  db.rhh_attendance_audit = audits;
  try {
    await writeAsync(db);
    res.json({ ok: true, rec: att[idx], audit_entries: fields.length });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible guardar la edición de asistencia' });
  }
});

// DELETE /api/rhh/asistencia/diaria/:id
router.delete('/diaria/:id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), async (req, res) => {
  const db  = read();
  const idx = (db.rhh_attendance || []).findIndex(r => r.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  const rec = db.rhh_attendance[idx];
  const hasLinkedPayment = getTxtPagos(db).some(p => p.attendance_id === rec.id);
  const hasLinkedBonus = getBonoVales(db).some(b => b.attendance_id === rec.id && b.status !== 'rechazado');
  if (hasLinkedPayment || hasLinkedBonus) {
    return res.status(409).json({ error: 'No se puede eliminar: la asistencia tiene pagos TXT o bonos vinculados' });
  }
  syncDeudaTurnoIncompleto(db, { ...rec, incidencia_type: null, horas_pendientes_turno: null }, req.rhhUser.full_name || req.rhhUser.email);
  db.rhh_attendance.splice(idx, 1);
  try {
    await writeAsync(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible eliminar la asistencia' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DESBLOQUEOS TEMPORALES DE DÍAS PASADOS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/unlocks — listar desbloqueos
router.get('/unlocks', rhhAuthRequired, (req, res) => {
  const db = read();
  const unlocks = (db.rhh_attendance_unlocks || []).filter(u => u.active !== false);
  res.json(unlocks);
});

// POST /api/rhh/asistencia/unlocks — crear desbloqueo (solo rh/admin)
router.post('/unlocks', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { fecha, start_dt, end_dt, motivo } = req.body || {};
  if (!fecha || !start_dt || !end_dt) return res.status(400).json({ error: 'fecha, start_dt y end_dt son requeridos' });
  if (end_dt <= start_dt) return res.status(400).json({ error: 'end_dt debe ser posterior a start_dt' });

  const db = read();
  const unlocks = db.rhh_attendance_unlocks || [];
  const unlock = {
    id: nextId(unlocks),
    fecha,
    start_dt,
    end_dt,
    motivo: motivo || null,
    created_by: req.rhhUser.full_name || req.rhhUser.email,
    created_at: nowMxDateTime(),
    active: true
  };
  unlocks.push(unlock);
  db.rhh_attendance_unlocks = unlocks;
  write(db);
  res.status(201).json(unlock);
});

// DELETE /api/rhh/asistencia/unlocks/:id — desactivar desbloqueo
router.delete('/unlocks/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const unlocks = db.rhh_attendance_unlocks || [];
  const idx = unlocks.findIndex(u => u.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Desbloqueo no encontrado' });
  unlocks[idx].active = false;
  db.rhh_attendance_unlocks = unlocks;
  write(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// VALES DE TIEMPO EXTRA
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/overtime-vales?status=pendiente&week=YYYY-MM-DD
router.get('/overtime-vales', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db     = read();
  const vales  = db.rhh_overtime_vales || [];
  const emps   = db.rhh_employees || [];
  let list     = [...vales];

  if (req.query.status) {
    list = list.filter(v => v.status === req.query.status);
  }
  if (req.query.week) {
    const dates = weekDates(weekMonday(req.query.week));
    list = list.filter(v => v.fecha >= dates[0] && v.fecha <= dates[5]);
  }

  const enriched = list.map(v => {
    const emp = emps.find(e => e.id === v.employee_id);
    return { ...v, employee: emp ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null };
  }).sort((a, b) => (b.creado_at || '').localeCompare(a.creado_at || ''));

  res.json(enriched);
});

// POST /api/rhh/asistencia/overtime-vales/:id/autorizar
router.post('/overtime-vales/:id/autorizar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const id  = Number(req.params.id);
  const db  = read();
  if (!db.rhh_overtime_vales) db.rhh_overtime_vales = [];
  const vale = db.rhh_overtime_vales.find(v => v.id === id);
  if (!vale) return res.status(404).json({ error: 'Vale no encontrado' });
  if (vale.status !== 'pendiente') return res.status(400).json({ error: 'El vale ya fue procesado' });

  vale.status        = 'autorizado';
  vale.autorizado_por = req.rhhUser.full_name || req.rhhUser.email;
  vale.autorizado_at  = nowMxDateTime();

  write(db);
  res.json({ ok: true, vale });
});

// POST /api/rhh/asistencia/overtime-vales/:id/rechazar
router.post('/overtime-vales/:id/rechazar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const id    = Number(req.params.id);
  const { notas_rechazo } = req.body || {};
  const db    = read();
  if (!db.rhh_overtime_vales) db.rhh_overtime_vales = [];
  const vale  = db.rhh_overtime_vales.find(v => v.id === id);
  if (!vale) return res.status(404).json({ error: 'Vale no encontrado' });
  if (vale.status !== 'pendiente') return res.status(400).json({ error: 'El vale ya fue procesado' });

  vale.status         = 'rechazado';
  vale.autorizado_por = req.rhhUser.full_name || req.rhhUser.email;
  vale.autorizado_at  = nowMxDateTime();
  vale.notas_rechazo  = notas_rechazo || null;

  write(db);
  res.json({ ok: true, vale });
});

// ══════════════════════════════════════════════════════════════════════════════
// VISTA SEMANA — grid completo para lista de asistencia
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/semana?week=YYYY-MM-DD&shift_id=X
router.get('/semana', rhhAuthRequired, async (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const db    = read();

  const rol         = findAttendanceRol(db, week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];
  const records     = (db.rhh_attendance    || []).filter(r => r.fecha >= dates[0] && r.fecha <= dates[6]);
  const holidays    = (db.rhh_holidays      || []).map(h => h.date);
  const vacSols     = (db.rhh_vac_solicitudes || []).filter(v => v.estado === 'aprobada');

  const template = employeesForWeek(db, week, assignments);
  if (ensureAutomaticSundayBirthdayGratifications(db, template.employees, dates)) {
    try {
      await writeAsync(db);
    } catch (err) {
      return res.status(500).json({ error: 'No fue posible actualizar las gratificaciones de cumpleaños' });
    }
  }
  let employees = template.employees;
  if (req.query.shift_id) {
    const sid = Number(req.query.shift_id);
    employees = employees.filter(emp => {
      const assignment = assignments.find(a => Number(a.employee_id) === Number(emp.id));
      return Number(assignment?.shift_id ?? emp.shift_id) === sid;
    });
  }

  const positions  = db.rhh_positions || [];
  const shifts     = db.rhh_shifts    || [];
  const allPagos   = getTxtPagos(db);
  const allBonos   = getBonoVales(db);
  const cumpleIncs = getCumpleIncidencias(db);

  const grid = employees.map(emp => {
    const ra       = assignments.find(a => a.employee_id === emp.id);
    const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
    const position = emp.template_status === 'baja'
      ? { id: null, name: 'BAJA' }
      : positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

    let teHorasWeek = 0;
    const days = dates.map((fecha, di) => {
      const rec    = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
      const dow    = di + 1;
      const works  = shift?.work_days ? shift.work_days.includes(dow) : dow <= 5;
      const isFest = holidays.includes(fecha);
      const isVac  = vacSols.some(v => v.employee_id === emp.id && fecha >= v.fecha_inicio && fecha <= v.fecha_fin);
      let autoType = works ? null : 'descanso';
      if (isFest) autoType = 'festivo';
      if (isVac)  autoType = 'vacacion';
      if (emp.template_status === 'baja') autoType = 'baja';
      if (rec?.te_horas) teHorasWeek += rec.te_horas;
      const isBirthday = !!(emp.birth_date && emp.birth_date.slice(5) === fecha.slice(5));
      const dayTxtPagos = allPagos.filter(p => p.employee_id === emp.id && p.fecha_pago === fecha);
      const txtPagadoHoras = dayTxtPagos.reduce((s, p) => s + (Number(p.horas_aplicadas) || 0), 0);
      const cumpleRegistro = cumpleIncs.find(c => c.employee_id === emp.id && c.birth_date_match === fecha && c.laboro);

      return {
        fecha,
        id:                 rec?.id             ?? null,
        incidencia_type:    rec?.incidencia_type ?? autoType,
        tiempo_retardo_min: rec?.tiempo_retardo_min ?? null,
        proyecto:           rec?.proyecto        ?? ra?.project ?? emp.project ?? null,
        notas:              rec?.notas           ?? null,
        is_auto:            !rec && !!autoType,
        te_activo:          rec?.te_activo       ?? false,
        te_horas:           rec?.te_horas        ?? null,
        is_holiday:         isFest,
        holiday_name:       isFest ? ((db.rhh_holidays || []).find(h => h.date === fecha)?.name || 'Festivo') : null,
        is_birthday:        isBirthday,
        birthday_holiday_conflict: isBirthday && isFest,
        festivo_laborado:   isFest && rec?.incidencia_type === 'labora',
        cumpleanos_laborado: !!cumpleRegistro,
        txt_pagado_horas:   txtPagadoHoras,
        txt_excedente_horas: dayTxtPagos.reduce((s, p) => s + (Number(p.horas_extra_sobrante) || 0), 0),
      };
    });

    // Comentarios enriquecidos
    const empBonos = allBonos.filter(b => b.employee_id === emp.id && b.week_start === week);
    const txtPend = getTxtBalanceAsOf(db, emp.id, dates[6]);
    const empPagosWeek = allPagos.filter(p => p.employee_id === emp.id && p.fecha_pago >= dates[0] && p.fecha_pago <= dates[6]);
    const txtPagadoWeek = empPagosWeek.reduce((s, p) => s + (Number(p.horas_aplicadas) || 0), 0);
    const empCumple = cumpleIncs.find(c => c.employee_id === emp.id && c.birth_date_match >= dates[0] && c.birth_date_match <= dates[6] && c.laboro);
    const vacDays = days.filter(d => d.incidencia_type === 'vacacion').length;
    const festivosLaborados = days.filter(d => d.festivo_laborado).length;
    const specialConflicts = days.filter(d => d.birthday_holiday_conflict).length;

    const comentarios = [];
    for (const b of empBonos) {
      const lbl = b.bono_type === 'limpieza' ? 'Bono Limp.' : 'Bono Enc.Res.';
      comentarios.push({ text: `${lbl}: ${b.status}`, type: 'bono', status: b.status });
    }
    if (empCumple) comentarios.push({ text: 'Cumple. laborado', type: 'cumpleanos' });
    if (festivosLaborados > 0) comentarios.push({ text: `Festivo laborado: ${festivosLaborados} día${festivosLaborados > 1 ? 's' : ''}`, type: 'festivo' });
    if (specialConflicts > 0) comentarios.push({ text: 'Festivo + cumpleaños: no labora', type: 'especial_no_labora' });
    if (teHorasWeek > 0) comentarios.push({ text: `Tiempo extra: ${teHorasWeek} h`, type: 'te' });
    if (txtPagadoWeek > 0) comentarios.push({ text: `Pagó ${txtPagadoWeek} h TXT${txtPend > 0 ? `; resta ${txtPend} h` : '; deuda liquidada'}`, type: 'txt_pago' });
    if (txtPend > 0) comentarios.push({ text: `Debe ${txtPend} h de Tiempo por Tiempo`, type: 'deuda' });
    if (vacDays > 0) comentarios.push({ text: `Vac: ${vacDays}d`, type: 'vacacion' });

    return {
      employee_id:     emp.id,
      employee_number: emp.employee_number,
      full_name:       emp.full_name,
      position:        position?.name || '',
      shift_name:      shift?.name    || '',
      shift_sort:      shift?.name    || 'ZZZZ',
      project:         ra?.project    ?? emp.project ?? null,
      template_status: emp.template_status,
      days,
      comentarios,
      te_horas_week:   teHorasWeek,
      txt_horas_pend:  txtPend,
      txt_horas_pagadas_week: txtPagadoWeek,
    };
  }).sort((a, b) => {
    if (a.shift_sort !== b.shift_sort) return a.shift_sort.localeCompare(b.shift_sort);
    if (a.position   !== b.position)   return a.position.localeCompare(b.position);
    return a.full_name.localeCompare(b.full_name);
  });

  res.json({
    week_start: week,
    dates,
    grid,
    shifts,
    proyectos:         PROYECTOS,
    incidencia_labels: INCIDENCIA_LABELS,
    template_source: template.source,
    template_period: template.period,
    template_missing: template.employees.length === 0,
    catalog_reconciled_count: template.catalog_reconciled_count || 0,
  });
});

// GET /api/rhh/asistencia/proyectos
router.get('/proyectos', rhhAuthRequired, (req, res) => res.json(PROYECTOS));

// GET /api/rhh/asistencia/overtime-razones
router.get('/overtime-razones', rhhAuthRequired, (req, res) => res.json(OVERTIME_RAZONES));

// ══════════════════════════════════════════════════════════════════════════════
// TxT — Tiempo por Tiempo (deudas y pagos)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/rhh/asistencia/txt/crear-deuda — crea deuda desde un día con falta
router.post('/txt/crear-deuda', rhhAuthRequired, rhhRequireRole('rh', 'admin'), async (req, res) => {
  const { employee_id, attendance_id, fecha, horas } = req.body || {};
  if (!employee_id || !attendance_id || !fecha) return res.status(400).json({ error: 'employee_id, attendance_id y fecha requeridos' });
  const db = read();
  const deudas = getTxtDeudas(db);

  // La deuda sólo puede originarse en la falta exacta que RHH está autorizando.
  const att = (db.rhh_attendance || []).find(r => r.id === Number(attendance_id));
  if (!att) return res.status(404).json({ error: 'Registro de asistencia no encontrado' });
  if (att.employee_id !== Number(employee_id) || att.fecha !== fecha) {
    return res.status(400).json({ error: 'La falta no corresponde al empleado o fecha indicados' });
  }
  if (att.incidencia_type !== 'falta') {
    return res.status(400).json({ error: 'TXT sólo puede autorizarse desde una incidencia Falta' });
  }

  // Evitar duplicado
  if (attendance_id && deudas.some(d => d.origen_attendance_id === Number(attendance_id) && d.status !== 'cancelado')) {
    return res.status(400).json({ error: 'Ya existe una deuda para este registro' });
  }

  // Determinar horas de deuda: si viene del front, usar esas; sino calcular por turno
  const empShiftId = att.shift_id || shiftForEmployeeDate(db, employee_id, fecha)?.id;
  const horasDeuda = Number(horas) || (empShiftId ? shiftHours(db, empShiftId) : 8);
  if (!(horasDeuda > 0 && horasDeuda <= 24)) return res.status(400).json({ error: 'Horas de deuda inválidas' });

  const deuda = {
    id: nextId(deudas),
    employee_id: Number(employee_id),
    origen_attendance_id: attendance_id ? Number(attendance_id) : null,
    origen_fecha: fecha,
    origen_tipo: 'falta',
    horas_deuda_original: horasDeuda,
    horas_pagadas: 0,
    horas_pendientes: horasDeuda,
    status: 'pendiente_pago',
    created_at: nowMxDateTime(),
    created_by: req.rhhUser.full_name || req.rhhUser.email,
    autorizado_por: req.rhhUser.full_name || req.rhhUser.email,
    autorizado_at: nowMxDateTime(),
    updated_at: null,
  };
  deudas.push(deuda);
  try {
    await writeAsync(db);
    res.status(201).json(deuda);
  } catch (err) {
    res.status(500).json({ error: 'No fue posible guardar la deuda TXT' });
  }
});

// POST /api/rhh/asistencia/txt/pagar — pagar deuda (turno completo o parcial)
router.post('/txt/pagar', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), async (req, res) => {
  const { deuda_id, attendance_id, fecha_pago, tipo_pago, shift_id_pagado, horas_aplicadas } = req.body || {};
  if (!deuda_id || !fecha_pago) return res.status(400).json({ error: 'deuda_id y fecha_pago requeridos' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_pago)) return res.status(400).json({ error: 'fecha_pago inválida' });

  const db = read();
  const deudas = getTxtDeudas(db);
  const pagos  = getTxtPagos(db);
  const deuda  = deudas.find(d => d.id === Number(deuda_id));
  if (!deuda) return res.status(404).json({ error: 'Deuda no encontrada' });
  if (deuda.status !== 'pendiente_pago') return res.status(400).json({ error: 'Deuda ya saldada o cancelada' });

  const ctx = employeeDayContext(db, deuda.employee_id, fecha_pago);
  if (!ctx.emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  if (ctx.birthdayHolidayConflict) {
    return res.status(400).json({ error: 'No puede registrar TXT: cumpleaños y festivo coinciden' });
  }

  let attendance = attendance_id
    ? (db.rhh_attendance || []).find(a => a.id === Number(attendance_id))
    : (db.rhh_attendance || []).find(a => a.employee_id === deuda.employee_id && a.fecha === fecha_pago);
  if (attendance && (attendance.employee_id !== deuda.employee_id || attendance.fecha !== fecha_pago)) {
    return res.status(400).json({ error: 'El registro de asistencia no corresponde al empleado o fecha de pago' });
  }
  if (!ctx.isRestDay && (!attendance || !['labora', 'retardo', 'turno_incompleto'].includes(attendance.incidencia_type))) {
    return res.status(400).json({ error: 'En un día laborable primero debe registrar que el trabajador se presentó' });
  }
  if (attendance?.incidencia_type === 'falta') {
    return res.status(400).json({ error: 'No se puede pagar TXT sobre un día marcado como falta' });
  }

  let horasAplicar;
  if (tipo_pago === 'turno_completo') {
    const paidShift = (db.rhh_shifts || []).find(s => Number(s.id) === Number(shift_id_pagado));
    if (!paidShift) return res.status(400).json({ error: 'Selecciona el turno realmente trabajado' });
    horasAplicar = shiftHours(db, paidShift.id);
  } else if (tipo_pago === 'parcial') {
    horasAplicar = Number(horas_aplicadas) || 0;
  } else {
    return res.status(400).json({ error: 'tipo_pago inválido' });
  }
  if (!(horasAplicar > 0 && horasAplicar <= 24)) return res.status(400).json({ error: 'Horas a aplicar deben estar entre 0 y 24' });

  // Registrar la presencia TXT sin convertir el descanso en jornada ordinaria.
  if (!attendance) {
    if (!db.rhh_attendance) db.rhh_attendance = [];
    attendance = {
      id: nextId(db.rhh_attendance),
      employee_id: deuda.employee_id,
      fecha: fecha_pago,
      incidencia_type: ctx.holiday ? 'festivo' : 'descanso',
      shift_id: ctx.shift?.id || null,
      txt_presento: true,
      registrado_por: req.rhhUser.full_name || req.rhhUser.email,
      created_at: nowMxDateTime(),
    };
    db.rhh_attendance.push(attendance);
  } else {
    attendance.txt_presento = true;
    attendance.txt_confirmado_por = req.rhhUser.full_name || req.rhhUser.email;
    attendance.txt_confirmado_at = nowMxDateTime();
  }

  // Distribuir contra las deudas más antiguas; sólo el remanente total será TE.
  let restante = horasAplicar;
  const aplicaciones = [];
  const deudasActivas = deudas
    .filter(d => d.employee_id === deuda.employee_id && d.status === 'pendiente_pago')
    .sort((a, b) => String(a.origen_fecha).localeCompare(String(b.origen_fecha)) || a.id - b.id);
  for (const item of deudasActivas) {
    if (restante <= 0) break;
    const aplicadas = Math.min(restante, Number(item.horas_pendientes) || 0);
    if (aplicadas <= 0) continue;
    item.horas_pagadas = (Number(item.horas_pagadas) || 0) + aplicadas;
    item.horas_pendientes = Math.max(0, (Number(item.horas_pendientes) || 0) - aplicadas);
    item.status = item.horas_pendientes > 0 ? 'pendiente_pago' : 'pagado';
    item.updated_at = nowMxDateTime();
    aplicaciones.push({ deuda_id: item.id, horas: aplicadas });
    restante -= aplicadas;
  }
  const horasEfectivas = aplicaciones.reduce((s, a) => s + a.horas, 0);
  const horasSobrante = Math.max(0, restante);

  const pago = {
    id: nextId(pagos),
    deuda_id: aplicaciones[0]?.deuda_id || deuda.id,
    employee_id: deuda.employee_id,
    attendance_id: attendance.id,
    fecha_pago,
    tipo_pago,
    shift_id_pagado: shift_id_pagado ? Number(shift_id_pagado) : null,
    horas_aplicadas: horasEfectivas,
    horas_extra_sobrante: horasSobrante,
    horas_trabajadas: horasAplicar,
    aplicaciones,
    presento_a_pagar: true,
    confirmado_por: req.rhhUser.full_name || req.rhhUser.email,
    created_at: nowMxDateTime(),
    created_by: req.rhhUser.full_name || req.rhhUser.email,
  };
  pagos.push(pago);

  if (horasSobrante > 0) {
    if (!db.rhh_overtime_vales) db.rhh_overtime_vales = [];
    db.rhh_overtime_vales.push({
      id: nextId(db.rhh_overtime_vales),
      attendance_id: attendance.id,
      employee_id: deuda.employee_id,
      fecha: fecha_pago,
      te_hora_entrada: null,
      te_hora_salida: null,
      te_horas: horasSobrante,
      te_razon: 'Excedente de pago Tiempo por Tiempo',
      te_proyecto: attendance.proyecto || null,
      status: 'pendiente',
      origen: 'txt_excedente',
      txt_pago_id: pago.id,
      solicitado_por: req.rhhUser.full_name || req.rhhUser.email,
      creado_at: nowMxDateTime(),
      autorizado_por: null,
      autorizado_at: null,
      notas_rechazo: null,
    });
  }

  try {
    await writeAsync(db);
    res.json({
      ok: true,
      deuda,
      pago,
      horas_sobrante: horasSobrante,
      horas_pendientes_total: getTotalHorasPendientes(db, deuda.employee_id),
      mensaje: horasSobrante > 0 ? `Se generó un vale por ${horasSobrante} h de tiempo extra pendiente de autorización` : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible guardar el pago TXT' });
  }
});

// GET /api/rhh/asistencia/txt/deudas?employee_id=X
router.get('/txt/deudas', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const deudas = getTxtDeudas(db);
  let list = [...deudas];
  if (req.query.employee_id) {
    list = list.filter(d => d.employee_id === Number(req.query.employee_id));
  }
  if (req.query.status) {
    list = list.filter(d => d.status === req.query.status);
  }
  const emps = db.rhh_employees || [];
  const enriched = list.map(d => {
    const emp = emps.find(e => e.id === d.employee_id);
    return { ...d, employee_name: emp?.full_name || '?' };
  });
  res.json(enriched);
});

// GET /api/rhh/asistencia/txt/deudas-semana?week=YYYY-MM-DD
router.get('/txt/deudas-semana', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const deudas = getTxtDeudas(db).filter(d => d.status === 'pendiente_pago');
  const emps = db.rhh_employees || [];
  res.json(deudas.map(d => {
    const emp = emps.find(e => e.id === d.employee_id);
    return { ...d, employee_name: emp?.full_name || '?' };
  }));
});

// POST /api/rhh/asistencia/txt/cancelar-deuda — cancelar deuda (solo rh/admin)
router.post('/txt/cancelar-deuda', rhhAuthRequired, rhhRequireRole('rh', 'admin'), async (req, res) => {
  const { deuda_id } = req.body || {};
  const db = read();
  const deudas = getTxtDeudas(db);
  const deuda = deudas.find(d => d.id === Number(deuda_id));
  if (!deuda) return res.status(404).json({ error: 'Deuda no encontrada' });
  deuda.status = 'cancelado';
  deuda.updated_at = nowMxDateTime();
  try {
    await writeAsync(db);
    res.json({ ok: true, deuda });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible cancelar la deuda TXT' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// BONOS (limpieza, encendido resistencias)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/rhh/asistencia/bonos — crear solicitud
router.post('/bonos', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), async (req, res) => {
  const { attendance_id, employee_id, fecha, bono_type, shift_worked_id } = req.body || {};
  if (!employee_id || !fecha || !bono_type) return res.status(400).json({ error: 'Campos requeridos' });
  if (!['limpieza','encendido_resistencias'].includes(bono_type)) return res.status(400).json({ error: 'bono_type inválido' });

  const db = read();
  const bonos = getBonoVales(db);

  const ctx = employeeDayContext(db, employee_id, fecha);
  if (!ctx.emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  if (ctx.birthdayHolidayConflict) {
    return res.status(400).json({ error: 'No se puede solicitar bono: cumpleaños y festivo coinciden' });
  }

  // Validar día: sábado con turno realmente trabajado T3 O domingo (cualquier turno)
  const d = new Date(fecha + 'T12:00:00');
  const dow = d.getDay(); // 0=dom, 6=sáb
  const workedShift = (db.rhh_shifts || []).find(s => Number(s.id) === Number(shift_worked_id));
  if (!workedShift) return res.status(400).json({ error: 'Selecciona el turno realmente trabajado' });

  if (dow === 6) {
    const isT3 = String(workedShift.code || '').toUpperCase() === 'T3' || /turno\s*3/i.test(workedShift.name || '');
    if (!isT3) return res.status(400).json({ error: 'Bono en sábado solo aplica cuando el turno realmente trabajado es Turno 3' });
  } else if (dow !== 0) {
    return res.status(400).json({ error: 'Bonos solo aplican en sábado (T3) o domingo' });
  }

  // Limpieza: una vez por empleado/semana. Resistencias: un trabajador en toda la semana.
  const ws = weekMonday(fecha);
  const wDates = weekDates(ws);
  const existing = bonos.find(b =>
    b.bono_type === bono_type &&
    (bono_type === 'limpieza' ? b.employee_id === Number(employee_id) : true) &&
    b.fecha >= wDates[0] && b.fecha <= wDates[6] &&
    b.status !== 'rechazado'
  );
  if (existing) {
    const error = bono_type === 'limpieza'
      ? 'El trabajador ya tiene un Bono Limpieza esta semana'
      : 'Ya existe un trabajador propuesto para Encendido de Resistencias esta semana';
    return res.status(400).json({ error });
  }

  const bono = {
    id: nextId(bonos),
    attendance_id: attendance_id ? Number(attendance_id) : null,
    employee_id: Number(employee_id),
    fecha,
    bono_type,
    scheduled_shift_id: ctx.shift?.id || null,
    shift_worked_id: workedShift.id,
    presencia_confirmada: true,
    presencia_confirmada_por: req.rhhUser.full_name || req.rhhUser.email,
    week_start: ws,
    status: 'pendiente',
    solicitado_por: req.rhhUser.full_name || req.rhhUser.email,
    creado_at: nowMxDateTime(),
    autorizado_por: null,
    autorizado_at: null,
    notas_rechazo: null,
  };
  bonos.push(bono);
  try {
    await writeAsync(db);
    res.status(201).json(bono);
  } catch (err) {
    res.status(500).json({ error: 'No fue posible guardar la solicitud de bono' });
  }
});

// GET /api/rhh/asistencia/bonos?week=&status=
router.get('/bonos', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  let bonos = [...getBonoVales(db)];
  if (req.query.week) {
    const ws = weekMonday(req.query.week);
    bonos = bonos.filter(b => b.week_start === ws);
  }
  if (req.query.status) {
    bonos = bonos.filter(b => b.status === req.query.status);
  }
  const emps = db.rhh_employees || [];
  const shifts = db.rhh_shifts || [];
  res.json(bonos.map(b => {
    const emp = emps.find(e => e.id === b.employee_id);
    const scheduledShift = shifts.find(s => s.id === b.scheduled_shift_id);
    const workedShift = shifts.find(s => s.id === b.shift_worked_id);
    return {
      ...b,
      employee_name: emp?.full_name || '?',
      scheduled_shift_name: scheduledShift?.name || null,
      shift_worked_name: workedShift?.name || null,
    };
  }));
});

// POST /api/rhh/asistencia/bonos/:id/autorizar
router.post('/bonos/:id/autorizar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), async (req, res) => {
  const db = read();
  const bonos = getBonoVales(db);
  const bono = bonos.find(b => b.id === Number(req.params.id));
  if (!bono) return res.status(404).json({ error: 'Bono no encontrado' });
  if (bono.status !== 'pendiente') return res.status(400).json({ error: 'Ya procesado' });
  bono.status = 'autorizado';
  bono.autorizado_por = req.rhhUser.full_name || req.rhhUser.email;
  bono.autorizado_at = nowMxDateTime();
  try {
    await writeAsync(db);
    res.json({ ok: true, bono });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible autorizar el bono' });
  }
});

// POST /api/rhh/asistencia/bonos/:id/rechazar
router.post('/bonos/:id/rechazar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), async (req, res) => {
  const db = read();
  const bonos = getBonoVales(db);
  const bono = bonos.find(b => b.id === Number(req.params.id));
  if (!bono) return res.status(404).json({ error: 'Bono no encontrado' });
  if (bono.status !== 'pendiente') return res.status(400).json({ error: 'Ya procesado' });
  bono.status = 'rechazado';
  bono.autorizado_por = req.rhhUser.full_name || req.rhhUser.email;
  bono.autorizado_at = nowMxDateTime();
  bono.notas_rechazo = req.body.notas_rechazo || null;
  try {
    await writeAsync(db);
    res.json({ ok: true, bono });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible rechazar el bono' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CUMPLEAÑOS LABORADO
// ══════════════════════════════════════════════════════════════════════════════

function syncBirthdayGratification(db, employeeId, birthdayDate, semanaPago, laboro) {
  if (!db.rhh_incidencias_semanales) db.rhh_incidencias_semanales = [];
  const period = isoWeekPeriod(semanaPago);
  if (!period) return null;
  const rows = db.rhh_incidencias_semanales;
  let rec = rows.find(r => Number(r.employee_id) === Number(employeeId) && r.period_key === period.period_key);
  if (!rec && !laboro) return null;
  if (!rec) {
    rec = {
      id: nextId(rows),
      employee_id: Number(employeeId),
      no_periodo: period.no_periodo,
      year: period.year,
      period_key: period.period_key,
      dias_pagados: 7,
      faltas: 0,
      horas_extras_total: 0,
      despensa: 1,
      prima_dominical: 0,
      vacaciones_dias: null,
      gratificacion: null,
      notas: '',
    };
    rows.push(rec);
  }

  const emp = (db.rhh_employees || []).find(e => Number(e.id) === Number(employeeId));
  const snapshot = (db.rhh_employee_period_snapshots || []).find(s =>
    Number(s.employee_id) === Number(employeeId) && s.period_key === period.period_key
  );
  const dailySalary = Number(snapshot?.sal_diario ?? snapshot?.salary_daily ?? emp?.sal_diario ?? emp?.salary_daily) || 0;
  const previousComponent = Number(rec.gratificacion_cumpleanos_importe) || 0;
  const otherGratification = Math.max(0, (Number(rec.gratificacion) || 0) - previousComponent);
  const newComponent = laboro ? dailySalary : 0;
  const newTotal = otherGratification + newComponent || null;
  const changed =
    Number(rec.gratificacion_cumpleanos_importe || 0) !== newComponent ||
    (rec.gratificacion_cumpleanos_fecha || null) !== (laboro ? birthdayDate : null) ||
    (rec.gratificacion || null) !== newTotal;
  rec.gratificacion_cumpleanos_importe = newComponent;
  rec.gratificacion_cumpleanos_fecha = laboro ? birthdayDate : null;
  rec.gratificacion = newTotal;
  if (changed) rec.updated_at = nowMxDateTime();
  return { period, dailySalary, record: rec, changed };
}

/*
 * El cumpleaños que cae en domingo concede un día de salario en la semana
 * siguiente sin exigir que el trabajador marque "laboró". Se materializa al
 * consultar Captura o Lista para que el registro quede persistido e idempotente.
 * Un festivo en la misma fecha cancela únicamente el beneficio automático: el
 * trabajador no puede laborar ni acumular ambos conceptos.
 */
function ensureAutomaticSundayBirthdayGratifications(db, employees, dates) {
  const incs = getCumpleIncidencias(db);
  const holidays = new Set((db.rhh_holidays || []).map(h => h.date));
  let changed = false;

  for (const fecha of dates || []) {
    if (new Date(fecha + 'T12:00:00').getDay() !== 0) continue;
    const nextWeek = new Date(weekMonday(fecha) + 'T12:00:00');
    nextWeek.setDate(nextWeek.getDate() + 7);
    const semanaPago = nextWeek.toLocaleDateString('en-CA', { timeZone: 'UTC' });

    for (const emp of employees || []) {
      if (emp.template_status && emp.template_status !== 'included') continue;
      if (!emp.birth_date || emp.birth_date.slice(5) !== fecha.slice(5)) continue;

      let existing = incs.find(i =>
        Number(i.employee_id) === Number(emp.id) && i.birth_date_match === fecha
      );

      if (holidays.has(fecha)) {
        if (existing?.automatico === true && existing.status !== 'bloqueado_festivo') {
          existing.laboro = false;
          existing.status = 'bloqueado_festivo';
          existing.semana_pago = null;
          existing.gratificacion_tipo = null;
          existing.updated_at = nowMxDateTime();
          syncBirthdayGratification(db, emp.id, fecha, semanaPago, false);
          changed = true;
        }
        continue;
      }

      if (!existing) {
        existing = {
          id: nextId(incs),
          employee_id: Number(emp.id),
          birth_date_match: fecha,
          semana_pago: semanaPago,
          laboro: false,
          status: 'gratificacion_programada',
          gratificacion_tipo: 'domingo_cumpleanos',
          automatico: true,
          created_at: nowMxDateTime(),
          created_by: 'Sistema',
        };
        incs.push(existing);
        changed = true;
      } else if (!existing.laboro && (
        existing.semana_pago !== semanaPago ||
        existing.status !== 'gratificacion_programada' ||
        existing.gratificacion_tipo !== 'domingo_cumpleanos' ||
        existing.automatico !== true
      )) {
        existing.semana_pago = semanaPago;
        existing.status = 'gratificacion_programada';
        existing.gratificacion_tipo = 'domingo_cumpleanos';
        existing.automatico = true;
        existing.updated_at = nowMxDateTime();
        changed = true;
      }

      const grant = syncBirthdayGratification(db, emp.id, fecha, semanaPago, true);
      if (grant?.changed) changed = true;
    }
  }

  return changed;
}

// POST /api/rhh/asistencia/cumpleanos-laboro — marcar/desmarcar
router.post('/cumpleanos-laboro', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), async (req, res) => {
  const { employee_id, fecha, laboro } = req.body || {};
  if (!employee_id || !fecha) return res.status(400).json({ error: 'Campos requeridos' });
  const db = read();
  const incs = getCumpleIncidencias(db);
  const ctx = employeeDayContext(db, employee_id, fecha);
  if (!ctx.emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  if (!ctx.isBirthday) return res.status(400).json({ error: 'La fecha no corresponde al cumpleaños del trabajador' });
  if (laboro && ctx.birthdayHolidayConflict) {
    return res.status(400).json({ error: 'El trabajador no puede laborar cuando su cumpleaños coincide con un festivo' });
  }
  const attendance = (db.rhh_attendance || []).find(a => a.employee_id === Number(employee_id) && a.fecha === fecha);
  if (laboro && !ctx.isRestDay && attendance?.incidencia_type !== 'labora') {
    return res.status(400).json({ error: 'Primero debe registrar la asistencia como Labora' });
  }

  const nextWeek = new Date(weekMonday(fecha) + 'T12:00:00');
  nextWeek.setDate(nextWeek.getDate() + 7);
  const semanaPago = nextWeek.toLocaleDateString('en-CA', { timeZone: 'UTC' });

  const existing = incs.find(i => i.employee_id === Number(employee_id) && i.birth_date_match === fecha);
  if (existing) {
    existing.laboro = !!laboro;
    existing.status = laboro ? 'cumpleanos_laborado' : 'pendiente';
    existing.updated_at = nowMxDateTime();
    if (laboro) {
      const d = new Date(fecha + 'T12:00:00');
      existing.semana_pago = semanaPago;
      existing.gratificacion_tipo = d.getDay() === 0 ? 'domingo_cumpleanos' : 'cumpleanos_laborado';
    } else {
      existing.semana_pago = null;
      existing.gratificacion_tipo = null;
    }
  } else {
    const d = new Date(fecha + 'T12:00:00');
    incs.push({
      id: nextId(incs),
      employee_id: Number(employee_id),
      birth_date_match: fecha,
      semana_pago: laboro ? semanaPago : null,
      laboro: !!laboro,
      status: laboro ? 'cumpleanos_laborado' : 'pendiente',
      gratificacion_tipo: laboro ? (d.getDay() === 0 ? 'domingo_cumpleanos' : 'cumpleanos_laborado') : null,
      created_at: nowMxDateTime(),
      created_by: req.rhhUser.full_name || req.rhhUser.email,
    });
  }
  const gratificacion = syncBirthdayGratification(db, employee_id, fecha, semanaPago, !!laboro);
  try {
    await writeAsync(db);
    res.json({ ok: true, gratificacion: gratificacion ? {
      period_key: gratificacion.period.period_key,
      importe: gratificacion.dailySalary,
    } : null });
  } catch (err) {
    res.status(500).json({ error: 'No fue posible guardar el cumpleaños laborado' });
  }
});

// GET /api/rhh/asistencia/cumpleanos?week=
router.get('/cumpleanos', rhhAuthRequired, (req, res) => {
  const db = read();
  const incs = getCumpleIncidencias(db);
  if (!req.query.week) return res.json(incs);
  const ws = weekMonday(req.query.week);
  const wDates = weekDates(ws);
  const filtered = incs.filter(i => i.birth_date_match >= wDates[0] && i.birth_date_match <= wDates[6]);
  res.json(filtered);
});

// ══════════════════════════════════════════════════════════════════════════════
// VISTA SEMANA — enriquecida con bonos, deudas, cumpleaños, TE, vacaciones
// ══════════════════════════════════════════════════════════════════════════════

// Enriquecer GET /semana con datos adicionales para columna Comentarios
// (El endpoint /semana ya existe arriba; lo extendemos con un middleware de post-procesamiento)
// Ya se hizo inline en la respuesta del GET /semana — ver abajo la modificación

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT EXCEL — Lista de asistencia semanal
// ══════════════════════════════════════════════════════════════════════════════

router.get('/semana/export-excel', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const db    = read();

  const rol         = findAttendanceRol(db, week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];
  const records     = (db.rhh_attendance || []).filter(r => r.fecha >= dates[0] && r.fecha <= dates[6]);
  const holidays    = (db.rhh_holidays   || []).map(h => h.date);
  const vacSols     = (db.rhh_vac_solicitudes || []).filter(v => v.estado === 'aprobada');
  const allPagos    = getTxtPagos(db);
  const allBonos    = getBonoVales(db);
  const cumpleIncs  = getCumpleIncidencias(db);

  const template = employeesForWeek(db, week, assignments);
  const positions = db.rhh_positions || [];
  const shifts    = db.rhh_shifts    || [];

  const rows = template.employees.map(emp => {
    const ra       = assignments.find(a => a.employee_id === emp.id);
    const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
    const position = emp.template_status === 'baja'
      ? { name: 'BAJA' }
      : positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

    let asistencias = 0, faltas = 0, teHorasWeek = 0, vacDays = 0;
    const daysData = dates.map(fecha => {
      const rec  = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
      const dow  = new Date(fecha + 'T12:00:00').getDay();
      const works = shift?.work_days ? shift.work_days.includes(dow === 0 ? 7 : dow) : dow >= 1 && dow <= 5;
      const isFest = holidays.includes(fecha);
      const isVac  = vacSols.some(v => v.employee_id === emp.id && fecha >= v.fecha_inicio && fecha <= v.fecha_fin);
      const inc = rec?.incidencia_type || (!works ? 'descanso' : (isFest ? 'festivo' : (isVac ? 'vacacion' : null)));
      if (inc === 'labora' || inc === 'retardo' || inc === 'turno_incompleto') asistencias++;
      if (inc === 'falta') faltas++;
      if (inc === 'vacacion') vacDays++;
      if (rec?.te_horas) teHorasWeek += rec.te_horas;
      return inc;
    });

    // Comentarios
    const comentarios = [];
    const empBonos = allBonos.filter(b => b.employee_id === emp.id && b.week_start === week);
    for (const b of empBonos) {
      const lbl = b.bono_type === 'limpieza' ? 'Bono Limpieza' : 'Bono Enc. Resistencias';
      comentarios.push(`${lbl}: ${b.status}`);
    }
    const txtPend = getTxtBalanceAsOf(db, emp.id, dates[6]);
    const empPagosWeek = allPagos.filter(p => p.employee_id === emp.id && p.fecha_pago >= dates[0] && p.fecha_pago <= dates[6]);
    const txtPagadoWeek = empPagosWeek.reduce((s, p) => s + (Number(p.horas_aplicadas) || 0), 0);
    if (txtPagadoWeek > 0) comentarios.push(`TXT pagado: ${txtPagadoWeek}h${txtPend > 0 ? `; resta ${txtPend}h` : '; deuda liquidada'}`);
    if (txtPend > 0) comentarios.push(`Debe ${txtPend}h de Tiempo por Tiempo`);
    if (teHorasWeek > 0) comentarios.push(`TE: +${teHorasWeek}h`);
    const empCumple = cumpleIncs.find(c => c.employee_id === emp.id && c.birth_date_match >= dates[0] && c.birth_date_match <= dates[6] && c.laboro);
    if (empCumple) comentarios.push('Cumpleaños laborado');
    const specialDays = dates.map(fecha => {
      const rec = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
      const holiday = (db.rhh_holidays || []).some(h => h.date === fecha);
      const birthday = !!(emp.birth_date && emp.birth_date.slice(5) === fecha.slice(5));
      if (holiday && birthday) return 'Festivo + cumpleaños (no labora)';
      if (holiday && rec?.incidencia_type === 'labora') return 'Festivo laborado';
      return null;
    }).filter(Boolean);
    comentarios.push(...specialDays);
    if (vacDays > 0) comentarios.push(`Vacaciones: ${vacDays}d`);

    return {
      nomina: emp.employee_number || '',
      nombre: emp.full_name || '',
      proyecto: ra?.project ?? emp.project ?? '',
      asistencias,
      faltas,
      tiempo_extra: teHorasWeek,
      txt_pagado: txtPagadoWeek,
      saldo_txt: txtPend,
      vacaciones: vacDays,
      comentarios: comentarios.join('; '),
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));

  try {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['nomina','nombre','proyecto','asistencias','faltas','tiempo_extra','txt_pagado','saldo_txt','vacaciones','comentarios'],
    });
    ws['!cols'] = [
      { wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 60 },
    ];
    // Renombrar headers
    ws.A1.v = 'Nómina'; ws.B1.v = 'Nombre'; ws.C1.v = 'Proyecto';
    ws.D1.v = 'Asistencias'; ws.E1.v = 'Faltas'; ws.F1.v = 'Tiempo Extra (h)';
    ws.G1.v = 'TXT pagado (h)'; ws.H1.v = 'Saldo TXT (h)';
    ws.I1.v = 'Vacaciones (d)'; ws.J1.v = 'Comentarios';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="asistencia_${week}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('[asistencia] Error generando Excel:', err.message);
    res.status(500).json({ error: 'Error generando Excel' });
  }
});

router._test = {
  employeeDayContext,
  ensureAutomaticSundayBirthdayGratifications,
  getTxtBalanceAsOf,
  shiftHours,
  syncDeudaTurnoIncompleto,
};

module.exports = router;
