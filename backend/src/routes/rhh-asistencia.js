/* ══════════════════════════════════════════════════════════════════════════════
   RHH — Control de Asistencias
   Rol semanal, captura diaria, vista grid semanal, vales de tiempo extra
   ══════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { read, write, writeAsync, nextId, getSystemEmpIds } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const { canonicalPeriod, comparePeriods, getEmployeeTemplateForWeek, isoWeekPeriod } = require('../utils/rhh-periods');
const router = express.Router();

// ── Diagnóstico temporal (protegido por query param, eliminar después) ────────
router.get('/plantilla/diag', (req, res) => {
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
  'paro_tecnico', 'descanso',
];

const INCIDENCIA_LABELS = {
  labora:      'Labora',
  falta:       'Falta',
  festivo:     'Festivo',
  vacacion:    'Vacación',
  baja:        'Baja',
  retardo:     'Retardo',
  incapacidad: 'Incapacidad',
  permiso_cg:  'Permiso C/G',
  permiso_sg:  'Permiso S/G',
  paro_tecnico:'Paro Técnico',
  descanso:    'Descanso',
};

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

/* Array de 6 fechas Lun-Sáb */
function weekDates(monday) {
  const out = [];
  const d   = new Date(monday + 'T12:00:00');
  for (let i = 0; i < 6; i++) {
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
function isLockedForSupervisor(rec, fecha, role) {
  if (role === 'rh' || role === 'admin') return false;
  if (!rec) return false;  // sin registro = no bloqueado
  if (!rec.incidencia_type) return false; // sin incidencia registrada = no bloqueado
  return fecha < nowMxDate();
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

function isHistoricalWeek(week) {
  return weekMonday(week) < weekMonday(nowMxDate());
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
  const template = getEmployeeTemplateForWeek(db, week);
  const useCurrentMasterStatus = template.source !== 'attendance_week_template' && !isHistoricalWeek(week);
  const systemIds = getSystemEmpIds();
  const masters = new Map((db.rhh_employees || []).map(emp => [Number(emp.id), emp]));
  const rows = [];
  const included = new Set();

  for (const snapshot of template.employees || []) {
    const employeeId = Number(snapshot.employee_id ?? snapshot.id);
    if (!employeeId || systemIds.has(employeeId) || included.has(employeeId)) continue;
    const master = masters.get(employeeId) || {};
    const confirmedInactive = useCurrentMasterStatus && isConfirmedInactive(master);
    const templateStatus = snapshot.template_status === 'baja'
      ? 'baja'
      : (snapshot.template_status === 'absent'
          ? 'absent'
          : (confirmedInactive ? 'baja' : 'included'));
    rows.push({
      ...master,
      id: employeeId,
      employee_number: snapshot.employee_number ?? master.employee_number,
      full_name: snapshot.full_name || master.full_name || `Empleado ${employeeId}`,
      department_id: snapshot.department_id ?? master.department_id ?? null,
      position_id: snapshot.position_id ?? master.position_id ?? null,
      shift_id: snapshot.shift_id ?? master.shift_id ?? null,
      project: snapshot.project ?? master.project ?? null,
      salary_daily: snapshot.salary_daily ?? master.salary_daily ?? null,
      present_in_payroll: snapshot.present_in_payroll ?? null,
      source: snapshot.source || template.source,
      catalog_active_reconciliation: snapshot.catalog_active_reconciliation === true,
      reconciliation_snapshot_period_key: snapshot.reconciliation_snapshot_period_key || null,
      reconciled_at: snapshot.reconciled_at || null,
      status: confirmedInactive ? 'inactive' : (snapshot.status_at_period || 'active'),
      current_status: master.status || null,
      template_status: templateStatus,
      template_period_key: snapshot.period_key || template.period?.period_key || null,
    });
    included.add(employeeId);
  }

  for (const assignment of assignments) {
    const employeeId = Number(assignment.employee_id);
    if (!employeeId || systemIds.has(employeeId) || included.has(employeeId)) continue;
    const master = masters.get(employeeId);
    if (!master) continue;
    const confirmedInactive = useCurrentMasterStatus && isConfirmedInactive(master);
    rows.push({
      ...master,
      current_status: master.status || null,
      template_status: confirmedInactive ? 'baja' : 'absent',
      template_period_key: template.period?.period_key || null,
    });
    included.add(employeeId);
  }

  return { ...template, employees: rows };
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
  const existing = vales.find(v => v.attendance_id === attRec.id);
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
    template_missing: template.source === 'snapshot_missing',
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
  const systemIds = getSystemEmpIds();
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
  const dates = weekDates(week);
  const DIAS  = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const db    = read();

  const rol         = findAttendanceRol(db, week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];
  const weeklyTemplate = employeesForWeek(db, week, assignments);
  const employees   = weeklyTemplate.employees;
  const positions   = db.rhh_positions  || [];
  const shifts      = db.rhh_shifts     || [];

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
    .sort((a, b) => {
      if ((a.shift?.name || '') !== (b.shift?.name || '')) return (a.shift?.name || '').localeCompare(b.shift?.name || '');
      if ((a.pos?.name   || '') !== (b.pos?.name   || '')) return (a.pos?.name   || '').localeCompare(b.pos?.name   || '');
      return (a.emp?.full_name || '').localeCompare(b.emp?.full_name || '');
    });

  const byShift = {};
  rows.forEach(r => {
    const sn = r.shift?.name || 'Sin turno';
    if (!byShift[sn]) byShift[sn] = { shift: r.shift, rows: [] };
    byShift[sn].rows.push(r);
  });

  const d0 = new Date(dates[0] + 'T12:00:00');
  const d5 = new Date(dates[5] + 'T12:00:00');
  const semLbl = `${d0.getDate()} ${MES[d0.getMonth()]} al ${d5.getDate()} ${MES[d5.getMonth()]} ${d5.getFullYear()}`;

  let tableBody = '';
  for (const [shiftName, { shift, rows: sRows }] of Object.entries(byShift)) {
    const workDays = shift?.work_days || [1,2,3,4,5];
    const diasStr  = DIAS.filter((_, i) => workDays.includes(i + 1)).join(', ');
    const entry    = shift?.start_time || '—';
    const exitTime = shift?.end_time   || '—';
    tableBody += `
      <tr style="background:#1e3a5f;color:#fff;">
        <td colspan="5" style="padding:6px 12px;font-weight:700;">
          ${shiftName} &nbsp;|&nbsp; Entrada: ${entry} &nbsp;&nbsp; Salida: ${exitTime} &nbsp;|&nbsp; Días: ${diasStr}
        </td>
      </tr>`;
    let lastPos = '';
    for (const r of sRows) {
      const posName = r.pos?.name || '—';
      if (posName !== lastPos) {
        lastPos = posName;
        tableBody += `<tr style="background:#dbeafe;"><td colspan="5" style="padding:3px 12px;font-weight:700;font-size:11px;color:#1e3a5f;">▸ ${posName}</td></tr>`;
      }
      tableBody += `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:5px 12px;width:70px;">${r.emp?.employee_number || ''}</td>
          <td style="padding:5px 12px;">${r.emp?.full_name || ''}</td>
          <td style="padding:5px 12px;">${posName}</td>
          <td style="padding:5px 12px;text-align:center;">${entry} – ${exitTime}</td>
          <td style="padding:5px 12px;color:#1d4ed8;">${r.project || '—'}</td>
        </tr>`;
    }
  }

  if (!tableBody) tableBody = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#9ca3af;">Sin asignaciones en este rol</td></tr>';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Rol Semanal — ${semLbl}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 16px; color: #111; }
  h2   { text-align: center; color: #1e3a5f; margin: 0 0 4px; }
  .sub { text-align: center; color: #374151; margin-bottom: 16px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #1e3a5f; color: #fff; padding: 6px 12px; text-align: left; font-size: 12px; }
  tr:nth-child(even):not([style*="background"]) { background: #f9fafb; }
  @media print { @page { size: landscape; margin: 1cm; } button { display: none; } }
</style>
</head><body>
<h2>ROL SEMANAL DE TRABAJO</h2>
<div class="sub">Semana: ${semLbl}</div>
<button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Imprimir / Guardar PDF</button>
<table>
  <thead><tr><th>No.</th><th>Nombre</th><th>Puesto</th><th>Horario</th><th>Proyecto</th></tr></thead>
  <tbody>${tableBody}</tbody>
</table>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ══════════════════════════════════════════════════════════════════════════════
// ASISTENCIA DIARIA
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/diaria?week=YYYY-MM-DD&shift_id=X
router.get('/diaria', rhhAuthRequired, (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const today = nowMxDate();
  const db    = read();
  const role  = req.rhhUser.role;

  const rol         = findAttendanceRol(db, week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];

  const template = employeesForWeek(db, week, assignments);
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
    r.fecha >= dates[0] && r.fecha <= dates[5]
  );
  const audits     = db.rhh_attendance_audit || [];
  const ovVales    = db.rhh_overtime_vales   || [];

  const grid = employees
    .map(emp => {
      const ra       = assignments.find(a => a.employee_id === emp.id);
      const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
      const position = emp.template_status === 'baja'
        ? { id: null, name: 'BAJA' }
        : positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

      const days = dates.map((fecha, di) => {
        const rec     = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
        const dow     = di + 1;
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

        const locked    = isLockedForSupervisor(rec, fecha, role);
        const vale      = rec ? ovVales.find(v => v.attendance_id === rec.id) : null;
        const recAudit  = rec ? audits.filter(a => a.attendance_id === rec.id)
          .sort((a, b) => a.id - b.id) : [];

        return {
          fecha,
          id:                 rec?.id               ?? null,
          incidencia_type:    rec?.incidencia_type  ?? autoType,
          tiempo_retardo_min: rec?.tiempo_retardo_min ?? null,
          proyecto:           rec?.proyecto          ?? ra?.project ?? emp.project ?? null,
          notas:              rec?.notas             ?? null,
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
          // Lock
          is_locked:          locked,
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
        days,
      };
    })
    .sort((a, b) => {
      if (a.shift_name !== b.shift_name) return a.shift_name.localeCompare(b.shift_name);
      if (a.position   !== b.position)   return a.position.localeCompare(b.position);
      return a.full_name.localeCompare(b.full_name);
    });

  res.json({
    week_start:      week,
    today,
    dates,
    shifts,
    proyectos:       PROYECTOS,
    overtime_razones: OVERTIME_RAZONES,
    incidencia_types: INCIDENCIA_LABELS,
    grid,
    user_role:       role,
    template_source: template.source,
    template_period: template.period,
    template_missing: template.source === 'snapshot_missing',
  });
});

// ── Función interna de upsert para bulk y single ──────────────────────────────
function upsertAttendance(att, item, userLabel, role, skipLockCheck) {
  const {
    employee_id, fecha, incidencia_type, tiempo_retardo_min,
    proyecto, shift_id, notas,
    te_activo, te_hora_entrada, te_hora_salida, te_razon, te_proyecto,
  } = item;

  if (!employee_id || !fecha || !incidencia_type) return { error: 'Campos requeridos faltantes', skip: true };
  if (!INCIDENCIA_TYPES.includes(incidencia_type)) return { error: `incidencia_type inválido: ${incidencia_type}`, skip: true };
  if (incidencia_type === 'paro_tecnico' && !['rh','admin'].includes(role)) return { error: 'Paro técnico solo RHH/Admin', skip: true };

  const today = nowMxDate();
  const idx   = att.findIndex(r => r.employee_id === Number(employee_id) && r.fecha === fecha);

  // Lock check para supervisores
  if (!skipLockCheck && role === 'supervisor' && fecha < today && idx !== -1 && att[idx].incidencia_type) {
    return { error: 'Incidencia bloqueada para supervisor', locked: true, skip: true };
  }

  const teHoras = te_activo ? calcHoras(te_hora_entrada, te_hora_salida) : null;

  if (idx !== -1) {
    att[idx] = {
      ...att[idx],
      incidencia_type,
      tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : att[idx].tiempo_retardo_min,
      proyecto:           proyecto    ?? att[idx].proyecto,
      shift_id:           shift_id    ? Number(shift_id) : att[idx].shift_id,
      notas:              notas       ?? att[idx].notas,
      te_activo:          !!te_activo,
      te_hora_entrada:    te_activo ? (te_hora_entrada || null) : null,
      te_hora_salida:     te_activo ? (te_hora_salida  || null) : null,
      te_horas:           teHoras,
      te_razon:           te_activo ? (te_razon    || null) : null,
      te_proyecto:        te_activo ? (te_proyecto || null) : null,
      registrado_por:     userLabel,
      updated_at:         nowMxDateTime(),
    };
    return { rec: att[idx], isNew: false };
  }

  const rec = {
    id:                 nextId(att),
    employee_id:        Number(employee_id),
    fecha,
    incidencia_type,
    tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : null,
    proyecto:           proyecto   || null,
    shift_id:           shift_id   ? Number(shift_id) : null,
    notas:              notas      || null,
    te_activo:          !!te_activo,
    te_hora_entrada:    te_activo ? (te_hora_entrada || null) : null,
    te_hora_salida:     te_activo ? (te_hora_salida  || null) : null,
    te_horas:           teHoras,
    te_razon:           te_activo ? (te_razon    || null) : null,
    te_proyecto:        te_activo ? (te_proyecto || null) : null,
    registrado_por:     userLabel,
    created_at:         nowMxDateTime(),
  };
  att.push(rec);
  return { rec, isNew: true };
}

// POST /api/rhh/asistencia/diaria — guardar un registro individual (per-row)
router.post('/diaria', rhhAuthRequired, (req, res) => {
  const db      = read();
  const att     = db.rhh_attendance || [];
  const role    = req.rhhUser.role;
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;

  const result = upsertAttendance(att, req.body || {}, userLbl, role, false);

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
  write(db);
  res.status(result.isNew ? 201 : 200).json(result.rec);
});

// POST /api/rhh/asistencia/diaria/bulk — guardar múltiples registros (compatibilidad)
router.post('/diaria/bulk', rhhAuthRequired, (req, res) => {
  const { records = [] } = req.body || {};
  if (!records.length) return res.json({ ok: true, saved: 0 });

  const db      = read();
  const att     = db.rhh_attendance || [];
  const role    = req.rhhUser.role;
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;
  let saved = 0, locked = 0;

  for (const item of records) {
    const result = upsertAttendance(att, item, userLbl, role, false);
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
  write(db);
  res.json({ ok: true, saved, locked });
});

// PUT /api/rhh/asistencia/diaria/:id/rh-editar — RHH/Admin override con trazabilidad
router.put('/diaria/:id/rh-editar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
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

  db.rhh_attendance       = att;
  db.rhh_attendance_audit = audits;
  write(db);
  res.json({ ok: true, rec: att[idx], audit_entries: fields.length });
});

// DELETE /api/rhh/asistencia/diaria/:id
router.delete('/diaria/:id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db  = read();
  const idx = (db.rhh_attendance || []).findIndex(r => r.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.rhh_attendance.splice(idx, 1);
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
router.get('/semana', rhhAuthRequired, (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const db    = read();

  const rol         = findAttendanceRol(db, week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];
  const records     = (db.rhh_attendance    || []).filter(r => r.fecha >= dates[0] && r.fecha <= dates[5]);
  const holidays    = (db.rhh_holidays      || []).map(h => h.date);
  const vacSols     = (db.rhh_vac_solicitudes || []).filter(v => v.estado === 'aprobada');

  const template = employeesForWeek(db, week, assignments);
  let employees = template.employees;
  if (req.query.shift_id) {
    const sid = Number(req.query.shift_id);
    employees = employees.filter(emp => {
      const assignment = assignments.find(a => Number(a.employee_id) === Number(emp.id));
      return Number(assignment?.shift_id ?? emp.shift_id) === sid;
    });
  }

  const positions = db.rhh_positions || [];
  const shifts    = db.rhh_shifts    || [];

  const grid = employees.map(emp => {
    const ra       = assignments.find(a => a.employee_id === emp.id);
    const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
    const position = emp.template_status === 'baja'
      ? { id: null, name: 'BAJA' }
      : positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

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
      };
    });

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
    template_missing: template.source === 'snapshot_missing',
  });
});

// GET /api/rhh/asistencia/proyectos
router.get('/proyectos', rhhAuthRequired, (req, res) => res.json(PROYECTOS));

// GET /api/rhh/asistencia/overtime-razones
router.get('/overtime-razones', rhhAuthRequired, (req, res) => res.json(OVERTIME_RAZONES));

module.exports = router;
