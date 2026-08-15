const {
  canonicalPeriod,
  comparePeriods,
  getEmployeeTemplateForWeek,
  isoWeekPeriod,
} = require('./rhh-periods');

function mxToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

function mondayOfWeek(dateInput) {
  const value = String(dateInput || mxToday()).slice(0, 10);
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isConfirmedInactive(employee) {
  return employee?.status === 'inactive' && employee?.manual_baja_locked === true;
}

function hasValidPayrollNumber(employee) {
  const value = String(employee?.employee_number || '').trim();
  return value.length >= 3 && /^\d+$/.test(value.replace(/^0+/, '') || '0');
}

function weeklyEmployeeSeed(employee) {
  const seed = {
    employee_id: Number(employee?.employee_id ?? employee?.id) || undefined,
    employee_number: employee?.employee_number,
    full_name: employee?.full_name,
    no_periodo: employee?.no_periodo,
    year: employee?.year,
    period_key: employee?.period_key,
    fecha_inicio: employee?.fecha_inicio,
    fecha_fin: employee?.fecha_fin,
    present_in_payroll: employee?.present_in_payroll,
    status_at_period: employee?.status_at_period,
    department_id: employee?.department_id,
    department_name: employee?.department_name,
    position_id: employee?.position_id,
    position_name: employee?.position_name,
    shift_id: employee?.shift_id,
    project: employee?.project,
    sal_diario: employee?.sal_diario,
    salary_daily: employee?.salary_daily,
    sdi: employee?.sdi,
    sbc: employee?.sbc,
    fecha_ingreso: employee?.fecha_ingreso ?? employee?.start_date,
    source: employee?.source,
    import_batch_id: employee?.import_batch_id,
    template_status: employee?.template_status,
    template_period_key: employee?.template_period_key,
    legacy_catalog_reconciliation: employee?.legacy_catalog_reconciliation,
    legacy_reconciled_at: employee?.legacy_reconciled_at,
    catalog_active_reconciliation: employee?.catalog_active_reconciliation,
    reconciliation_snapshot_period_key: employee?.reconciliation_snapshot_period_key,
    reconciled_at: employee?.reconciled_at,
  };
  return Object.fromEntries(Object.entries(seed).filter(([, value]) => value !== undefined));
}

function latestSnapshotsByEmployee(db, targetPeriod) {
  const latest = new Map();
  for (const snapshot of db?.rhh_employee_period_snapshots || []) {
    const employeeId = Number(snapshot.employee_id);
    const period = canonicalPeriod(snapshot);
    if (!employeeId || !period) continue;
    if (targetPeriod && comparePeriods(period, targetPeriod) > 0) continue;
    const previous = latest.get(employeeId);
    if (!previous || comparePeriods(period, previous.period) > 0) {
      latest.set(employeeId, { snapshot, period });
    }
  }
  return latest;
}

/**
 * Construye la única plantilla de empleados usada por ROL, captura diaria,
 * lista semanal y lista de asistencia. Las plantillas históricas quedan
 * congeladas. La semana actual y la siguiente se reconcilian en lectura con el
 * catálogo activo para que una plantilla materializada antes de una importación
 * no oculte altas nuevas.
 */
function buildAttendanceEmployeesForWeek(db, weekInput, extraEmployeeIds = [], options = {}) {
  const weekStart = mondayOfWeek(weekInput);
  if (!weekStart) return { employees: [], source: 'invalid_date', period: null, catalog_reconciled_count: 0 };

  const template = getEmployeeTemplateForWeek(db, weekStart, options.templateOptions || {});
  const currentWeek = mondayOfWeek(options.today || mxToday());
  const lastDynamicWeek = addDays(currentWeek, 7);
  const reconcileCatalog = weekStart >= currentWeek && weekStart <= lastDynamicWeek;
  const excludedIds = options.excludedEmployeeIds instanceof Set
    ? options.excludedEmployeeIds
    : new Set(options.excludedEmployeeIds || []);
  const masters = new Map((db?.rhh_employees || []).map(employee => [Number(employee.id), employee]));
  const targetPeriod = (template.period ? canonicalPeriod(template.period) : null) || isoWeekPeriod(weekStart);
  const latestByEmployee = latestSnapshotsByEmployee(db, targetPeriod);
  const rows = [];
  const included = new Set();
  let catalogReconciledCount = 0;

  const addEmployee = (raw, forcedStatus = null, reconciledFromCatalog = false) => {
    const employeeId = Number(raw?.employee_id ?? raw?.id);
    if (!employeeId || excludedIds.has(employeeId) || included.has(employeeId)) return;
    const master = masters.get(employeeId) || {};
    const confirmedInactive = reconcileCatalog && isConfirmedInactive(master);
    const rawStatus = forcedStatus || raw?.template_status;
    const templateStatus = rawStatus === 'baja'
      ? 'baja'
      : (rawStatus === 'absent'
          ? 'absent'
          : (confirmedInactive ? 'baja' : 'included'));
    const useManual = reconcileCatalog;

    rows.push({
      ...master,
      id: employeeId,
      employee_number: raw?.employee_number ?? master.employee_number,
      full_name: raw?.full_name || master.full_name || `Empleado ${employeeId}`,
      department_id: useManual && master.manual_department_locked
        ? (master.department_id ?? null)
        : (raw?.department_id ?? master.department_id ?? null),
      position_id: useManual && master.manual_position_locked
        ? (master.position_id ?? null)
        : (raw?.position_id ?? master.position_id ?? null),
      shift_id: useManual && master.manual_shift_locked
        ? (master.shift_id ?? null)
        : (raw?.shift_id ?? master.shift_id ?? null),
      project: useManual && master.manual_project_locked
        ? (master.project ?? null)
        : (raw?.project ?? master.project ?? null),
      sal_diario: useManual && master.manual_salary_locked
        ? (master.sal_diario ?? master.salary_daily ?? null)
        : (raw?.sal_diario ?? master.sal_diario ?? master.salary_daily ?? null),
      salary_daily: useManual && master.manual_salary_locked
        ? (master.salary_daily ?? master.sal_diario ?? null)
        : (raw?.salary_daily ?? raw?.sal_diario ?? master.salary_daily ?? master.sal_diario ?? null),
      fecha_ingreso: useManual && master.manual_start_date_locked
        ? (master.fecha_ingreso ?? master.start_date ?? null)
        : (raw?.fecha_ingreso ?? master.fecha_ingreso ?? master.start_date ?? null),
      present_in_payroll: raw?.present_in_payroll ?? null,
      source: reconciledFromCatalog ? 'catalog_active_reconciliation' : (raw?.source || template.source),
      catalog_active_reconciliation: reconciledFromCatalog || raw?.catalog_active_reconciliation === true,
      reconciliation_snapshot_period_key: reconciledFromCatalog
        ? (raw?.period_key || null)
        : (raw?.reconciliation_snapshot_period_key || null),
      reconciled_at: raw?.reconciled_at || null,
      status: confirmedInactive ? 'inactive' : (raw?.status_at_period || master.status || 'active'),
      current_status: master.status || null,
      template_status: templateStatus,
      template_period_key: raw?.period_key || template.period?.period_key || null,
    });
    included.add(employeeId);
    if (reconciledFromCatalog) catalogReconciledCount++;
  };

  for (const snapshot of template.employees || []) addEmployee(snapshot);

  if (reconcileCatalog) {
    for (const master of masters.values()) {
      if (master.status !== 'active' || isConfirmedInactive(master) || !hasValidPayrollNumber(master)) continue;
      const employeeId = Number(master.id);
      if (!employeeId || excludedIds.has(employeeId) || included.has(employeeId)) continue;
      const latest = latestByEmployee.get(employeeId);
      addEmployee({
        ...weeklyEmployeeSeed(latest?.snapshot || master),
        employee_id: employeeId,
        employee_number: master.employee_number,
        full_name: master.full_name,
        present_in_payroll: latest?.snapshot?.present_in_payroll ?? false,
        period_key: latest?.period?.period_key,
      }, 'included', true);
    }
  }

  for (const rawId of extraEmployeeIds || []) {
    const employeeId = Number(rawId?.employee_id ?? rawId);
    if (!employeeId || excludedIds.has(employeeId) || included.has(employeeId)) continue;
    const master = masters.get(employeeId);
    if (!master) continue;
    const latest = latestByEmployee.get(employeeId);
    addEmployee(
      { ...weeklyEmployeeSeed(latest?.snapshot || master), employee_id: employeeId },
      reconcileCatalog && isConfirmedInactive(master) ? 'baja' : 'absent'
    );
  }

  return {
    ...template,
    employees: rows,
    catalog_reconciled_count: catalogReconciledCount,
    catalog_reconciled: catalogReconciledCount > 0,
  };
}

function sameEmployeeRows(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

/**
 * Persiste la plantilla resuelta. Se usa al terminar una importación CONTPAQ;
 * así la carga y la plantilla forman una sola escritura y sobreviven reinicios.
 */
function materializeAttendanceWeekTemplate(db, weekInput, options = {}) {
  const weekStart = mondayOfWeek(weekInput);
  if (!weekStart) return { changed: false, reason: 'invalid_date', template: null };
  if (!Array.isArray(db.rhh_attendance_week_templates)) db.rhh_attendance_week_templates = [];
  const templates = db.rhh_attendance_week_templates;
  const existingIndex = templates.findIndex(template => template.week_start === weekStart);
  const existing = existingIndex >= 0 ? templates[existingIndex] : null;
  const priorBajaIds = (existing?.employees || [])
    .filter(employee => employee.template_status === 'baja')
    .map(employee => Number(employee.employee_id ?? employee.id));
  const extraIds = [...new Set([...(options.extraEmployeeIds || []).map(Number), ...priorBajaIds].filter(Boolean))];
  const resolved = buildAttendanceEmployeesForWeek(db, weekStart, extraIds, {
    ...options,
    templateOptions: {
      ignoreMaterialized: true,
      allowLatestLoaded: options.allowLatestLoaded === true,
    },
  });
  if (options.requirePayrollSource && !resolved.period) {
    return { changed: false, reason: 'no_payroll_period', template: existing || null, resolved };
  }
  if (resolved.employees.length === 0) {
    return { changed: false, reason: 'no_employees', template: existing || null, resolved };
  }

  const employees = resolved.employees.map(employee => weeklyEmployeeSeed({
    ...employee,
    employee_id: Number(employee.id ?? employee.employee_id),
  }));
  const changed = !existing
    || !sameEmployeeRows(existing.employees, employees)
    || existing.source_period_key !== (resolved.period?.period_key || null);
  if (!changed) return { changed: false, reason: 'unchanged', template: existing, resolved };

  const now = options.updatedAt || new Date().toISOString();
  const record = {
    ...(existing || {}),
    id: existing?.id ?? Math.max(0, ...templates.map(template => Number(template.id) || 0)) + 1,
    week_start: weekStart,
    source: resolved.source,
    source_period: resolved.period || null,
    source_period_key: resolved.period?.period_key || null,
    employees,
    version: Number(existing?.version || 0) + 1,
    created_at: existing?.created_at || now,
    updated_at: now,
    updated_by: options.updatedBy || 'system',
  };
  if (existingIndex >= 0) templates[existingIndex] = record;
  else templates.push(record);
  return {
    changed: true,
    reason: existing ? 'updated' : 'created',
    template: record,
    resolved,
    added: employees.filter(employee => !(existing?.employees || []).some(previous =>
      Number(previous.employee_id ?? previous.id) === Number(employee.employee_id)
    )).length,
  };
}

module.exports = {
  buildAttendanceEmployeesForWeek,
  hasValidPayrollNumber,
  isConfirmedInactive,
  materializeAttendanceWeekTemplate,
  mondayOfWeek,
  weeklyEmployeeSeed,
};
