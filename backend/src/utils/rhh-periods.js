const LEGACY_PERIOD_YEAR = 2026;

const MONTHS = {
  ene: 1, jan: 1,
  feb: 2,
  mar: 3,
  abr: 4, apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8, aug: 8,
  sep: 9, sept: 9,
  oct: 10,
  nov: 11,
  dic: 12, dec: 12,
};

function validYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
}

function validWeek(value) {
  const week = Number(value);
  return Number.isInteger(week) && week >= 1 && week <= 53 ? week : null;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Interpreta Date, serial de Excel, YYYY-MM-DD, DD/MM/YYYY y DD/Mon/YYYY. */
function parsePeriodDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + Math.floor(value) * 86400000);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return isoDate(year, Number(match[2]), Number(match[1]));
  }

  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  match = normalized.match(/^(\d{1,2})[\s\/-]+([a-z]{3,})[\s\/-]+(\d{2,4})$/);
  if (match) {
    const month = MONTHS[match[2].slice(0, 4)] || MONTHS[match[2].slice(0, 3)];
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return month ? isoDate(year, month, Number(match[1])) : null;
  }

  return null;
}

function periodKey(year, noPeriodo) {
  const safeYear = validYear(year);
  const safeWeek = validWeek(noPeriodo);
  if (!safeYear || !safeWeek) return null;
  return `${safeYear}-S${String(safeWeek).padStart(2, '0')}`;
}

function yearFromPeriodKey(key) {
  const match = String(key ?? '').match(/^(\d{4})-S(?:0?)(\d{1,2})$/i);
  return match && validWeek(match[2]) ? validYear(match[1]) : null;
}

/** La semana que cruza diciembre/enero pertenece al año de su fecha final. */
function derivePeriodYear({ year, fecha_inicio, fecha_fin } = {}, fallbackYear = LEGACY_PERIOD_YEAR) {
  const explicit = validYear(year);
  if (explicit) return explicit;
  const end = parsePeriodDate(fecha_fin);
  if (end) return Number(end.slice(0, 4));
  const start = parsePeriodDate(fecha_inicio);
  if (start) return Number(start.slice(0, 4));
  return validYear(fallbackYear) || LEGACY_PERIOD_YEAR;
}

function effectivePeriodYear(record = {}, fallbackYear = LEGACY_PERIOD_YEAR) {
  return validYear(record.year ?? record.period_year ?? record.payroll_year)
    || yearFromPeriodKey(record.period_key)
    || derivePeriodYear(record, fallbackYear);
}

function canonicalPeriod(record = {}, fallbackYear = LEGACY_PERIOD_YEAR) {
  const noPeriodo = validWeek(record.no_periodo ?? record.week);
  if (!noPeriodo) return null;
  const fechaInicio = parsePeriodDate(record.fecha_inicio ?? record.start_date);
  const fechaFin = parsePeriodDate(record.fecha_fin ?? record.end_date);
  const year = derivePeriodYear({
    year: record.year ?? record.period_year ?? record.payroll_year,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
  }, fallbackYear);

  return {
    ...record,
    no_periodo: noPeriodo,
    year,
    period_key: periodKey(year, noPeriodo),
    fecha_inicio: fechaInicio || record.fecha_inicio || record.start_date || null,
    fecha_fin: fechaFin || record.fecha_fin || record.end_date || null,
  };
}

function samePeriod(record, noPeriodo, year = LEGACY_PERIOD_YEAR) {
  return validWeek(record?.no_periodo) === validWeek(noPeriodo)
    && effectivePeriodYear(record, LEGACY_PERIOD_YEAR) === validYear(year);
}

function comparePeriods(left, right) {
  const a = canonicalPeriod(left);
  const b = canonicalPeriod(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const aDate = parsePeriodDate(a.fecha_fin) || parsePeriodDate(a.fecha_inicio);
  const bDate = parsePeriodDate(b.fecha_fin) || parsePeriodDate(b.fecha_inicio);
  if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
  return (a.year - b.year) || (a.no_periodo - b.no_periodo);
}

function nextNumericId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}

function upsertCanonicalPeriod(periods, input) {
  const period = canonicalPeriod(input);
  if (!period) return null;
  const index = periods.findIndex(item => samePeriod(item, period.no_periodo, period.year));
  const previous = index >= 0 ? periods[index] : null;
  const result = {
    ...(previous || {}),
    ...period,
    id: previous?.id ?? nextNumericId(periods),
  };
  if (index >= 0) periods[index] = result;
  else periods.push(result);
  return result;
}

function upsertEmployeePeriodSnapshot(snapshots, input) {
  const period = canonicalPeriod(input);
  const employeeId = Number(input.employee_id);
  if (!period || !employeeId) return null;
  const index = snapshots.findIndex(item =>
    Number(item.employee_id) === employeeId && samePeriod(item, period.no_periodo, period.year)
  );
  const previous = index >= 0 ? snapshots[index] : null;
  const result = {
    ...(previous || {}),
    ...input,
    employee_id: employeeId,
    no_periodo: period.no_periodo,
    year: period.year,
    period_key: period.period_key,
    fecha_inicio: period.fecha_inicio,
    fecha_fin: period.fecha_fin,
    id: previous?.id ?? nextNumericId(snapshots),
    created_at: previous?.created_at ?? input.created_at,
  };
  if (index >= 0) snapshots[index] = result;
  else snapshots.push(result);
  return result;
}

function resolveRequestedYear(db, noPeriodo, requestedYear) {
  const explicit = validYear(requestedYear);
  if (explicit) return explicit;
  const candidates = [
    ...(db?.rhh_periodos || []),
    ...(db?.rhh_incidencias_semanales || []),
    ...(db?.rhh_employee_period_snapshots || []),
  ].filter(record => validWeek(record.no_periodo) === validWeek(noPeriodo));
  if (candidates.length === 0) return LEGACY_PERIOD_YEAR;
  return Math.max(...candidates.map(record => effectivePeriodYear(record)));
}

function periodContainsRange(period, startDate, endDate = startDate) {
  const canonical = canonicalPeriod(period);
  const start = parsePeriodDate(startDate);
  const end = parsePeriodDate(endDate);
  const periodStart = parsePeriodDate(canonical?.fecha_inicio);
  const periodEnd = parsePeriodDate(canonical?.fecha_fin);
  if (!canonical || !start || !end || !periodStart || !periodEnd) return false;
  return start <= periodEnd && end >= periodStart;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekStart(year, noPeriodo) {
  const safeYear = validYear(year);
  const safeWeek = validWeek(noPeriodo);
  if (!safeYear || !safeWeek) return null;
  const januaryFourth = new Date(Date.UTC(safeYear, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + ((safeWeek - 1) * 7));
  return monday.toISOString().slice(0, 10);
}

function isoWeekPeriod(iso) {
  const parsed = parsePeriodDate(iso);
  if (!parsed) return null;
  const date = new Date(`${parsed}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const noPeriodo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return canonicalPeriod({ no_periodo: noPeriodo, year: isoYear });
}

function resolvePeriodForDate(db, startDate, endDate = startDate) {
  const start = parsePeriodDate(startDate);
  const end = parsePeriodDate(endDate);
  if (!start || !end) return null;
  const periods = (db?.rhh_periodos || []).map(period => canonicalPeriod(period)).filter(Boolean);
  const exact = periods.filter(period => periodContainsRange(period, start, end)).sort(comparePeriods).at(-1);
  if (exact) return exact;

  const snapshots = db?.rhh_employee_period_snapshots || [];
  const snapshotPeriods = new Map();
  for (const raw of snapshots) {
    const period = canonicalPeriod(raw);
    if (period) snapshotPeriods.set(period.period_key, period);
  }
  return [...snapshotPeriods.values()]
    .filter(period => periodContainsRange(period, start, end))
    .sort(comparePeriods)
    .at(-1) || null;
}

/**
 * Returns the employee template for an attendance week. Exact snapshots are
 * preferred. Only the immediately following week may inherit the last known
 * snapshot; older/far-future weeks do not silently use today's catalog.
 */
function getEmployeeTemplateForWeek(db, weekStart, options = {}) {
  const start = parsePeriodDate(weekStart);
  if (!start) return { employees: [], source: 'invalid_date', period: null };
  const end = addDays(start, 6);
  const requestedPeriod = isoWeekPeriod(start);

  if (options.ignoreMaterialized !== true) {
    const materialized = (db?.rhh_attendance_week_templates || [])
      .find(template => parsePeriodDate(template.week_start) === start);
    if (materialized) {
      return {
        employees: (materialized.employees || []).map(employee => ({ ...employee })),
        source: 'attendance_week_template',
        period: materialized.source_period || null,
        materialized: {
          id: materialized.id,
          week_start: materialized.week_start,
          version: Number(materialized.version || 1),
          updated_at: materialized.updated_at || null,
          updated_by: materialized.updated_by || null,
        },
      };
    }
  }

  const snapshots = db?.rhh_employee_period_snapshots || [];
  const periods = new Map();
  for (const raw of [...(db?.rhh_periodos || []), ...snapshots]) {
    const period = canonicalPeriod(raw);
    if (period) periods.set(period.period_key, period);
  }
  const snapshotPeriodKeys = new Set(
    snapshots.map(snapshot => canonicalPeriod(snapshot)?.period_key).filter(Boolean)
  );

  let selected = [...periods.values()]
    .filter(period => snapshotPeriodKeys.has(period.period_key) && (
      periodContainsRange(period, start, end)
      || (requestedPeriod && samePeriod(period, requestedPeriod.no_periodo, requestedPeriod.year))
    ))
    .sort(comparePeriods)
    .at(-1) || null;
  let source = selected ? 'snapshot_exact' : null;

  if (!selected && options.allowNextWeek !== false) {
    const previous = [...periods.values()]
      .filter(period => snapshotPeriodKeys.has(period.period_key) && parsePeriodDate(period.fecha_fin) && parsePeriodDate(period.fecha_fin) < start)
      .sort(comparePeriods)
      .at(-1);
    if (previous) {
      const expectedNextStart = addDays(parsePeriodDate(previous.fecha_fin), 1);
      const maxInheritedStart = addDays(expectedNextStart, 6);
      if (start >= expectedNextStart && start <= maxInheritedStart) {
        selected = previous;
        source = 'snapshot_previous_week';
      }
    }

    if (!selected && requestedPeriod) {
      const previousNumeric = [...periods.values()]
        .filter(period => snapshotPeriodKeys.has(period.period_key) && comparePeriods(period, requestedPeriod) < 0)
        .sort(comparePeriods)
        .at(-1);
      if (previousNumeric) {
        const previousMonday = isoWeekStart(previousNumeric.year, previousNumeric.no_periodo);
        if (previousMonday && addDays(previousMonday, 7) === start) {
          selected = previousNumeric;
          source = 'snapshot_previous_week';
        }
      }
    }
  }

  // Sólo una acción explícita de "Actualizar plantilla" puede usar la última
  // nómina cargada aunque no corresponda a la semana inmediata anterior.
  if (!selected && options.allowLatestLoaded === true && requestedPeriod) {
    selected = [...periods.values()]
      .filter(period => snapshotPeriodKeys.has(period.period_key) && comparePeriods(period, requestedPeriod) <= 0)
      .sort(comparePeriods)
      .at(-1) || null;
    if (selected) source = 'snapshot_latest_loaded';
  }

  if (selected) {
    const rows = snapshots.filter(snapshot => samePeriod(snapshot, selected.no_periodo, selected.year));
    if (rows.length > 0) {
      return { employees: rows.map(row => ({ ...row })), source, period: selected };
    }
  }

  if (snapshots.length === 0 && options.catalogFallback !== false) {
    return {
      employees: (db?.rhh_employees || []).filter(employee => employee.status !== 'inactive'),
      source: 'catalog_fallback',
      period: null,
    };
  }

  return { employees: [], source: 'snapshot_missing', period: selected };
}

function backfillCanonicalPeriodFields(db, options = {}) {
  const mutate = options.mutate === true;
  const target = mutate ? db : structuredClone(db);
  const stats = { updated: 0, ambiguous_legacy_2026: 0, ambiguous_rows: [], snapshots_created: 0, by_collection: {} };
  const collections = [
    'rhh_periodos',
    'rhh_incidencias_semanales',
    'rhh_he_detalle',
    'rhh_vac_solicitudes',
    'rhh_te_solicitudes',
    'rhh_employee_period_snapshots',
  ];

  for (const name of collections) {
    const rows = target[name] || [];
    let changed = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const period = canonicalPeriod(row);
      if (!period) continue;
      if (!row.year && !row.period_key && !row.fecha_inicio && !row.fecha_fin) {
        stats.ambiguous_legacy_2026++;
        stats.ambiguous_rows.push({ collection: name, id: row.id ?? null, no_periodo: row.no_periodo ?? null, assumed_year: LEGACY_PERIOD_YEAR });
      }
      if (row.year !== period.year || row.period_key !== period.period_key ||
          row.fecha_inicio !== period.fecha_inicio || row.fecha_fin !== period.fecha_fin) {
        rows[index] = { ...row, year: period.year, period_key: period.period_key };
        if (period.fecha_inicio) rows[index].fecha_inicio = period.fecha_inicio;
        if (period.fecha_fin) rows[index].fecha_fin = period.fecha_fin;
        changed++;
      }
    }
    stats.by_collection[name] = changed;
    stats.updated += changed;
  }

  const candidates = target.rhh_baja_candidatos || [];
  let candidateChanges = 0;
  for (const candidate of candidates) {
    const period = canonicalPeriod({
      no_periodo: candidate.detected_week,
      year: candidate.detected_year,
      period_key: candidate.period_key,
    });
    if (!period) continue;
    if (!candidate.detected_year && !candidate.period_key) {
      stats.ambiguous_legacy_2026++;
      stats.ambiguous_rows.push({ collection: 'rhh_baja_candidatos', id: candidate.id ?? null, no_periodo: candidate.detected_week ?? null, assumed_year: LEGACY_PERIOD_YEAR });
    }
    if (candidate.detected_year !== period.year || candidate.period_key !== period.period_key) {
      candidate.detected_year = period.year;
      candidate.period_key = period.period_key;
      candidateChanges++;
    }
  }
  stats.by_collection.rhh_baja_candidatos = candidateChanges;
  stats.updated += candidateChanges;

  if (!Array.isArray(target.rhh_employee_period_snapshots)) target.rhh_employee_period_snapshots = [];
  const employees = new Map((target.rhh_employees || []).map(employee => [Number(employee.id), employee]));
  const periods = target.rhh_periodos || [];
  const createApproximateSnapshot = (employeeId, period, sourceRecord) => {
    const employee = employees.get(Number(employeeId));
    const canonical = canonicalPeriod(period);
    if (!employee || !canonical) return;
    if (target.rhh_employee_period_snapshots.some(snapshot =>
      Number(snapshot.employee_id) === Number(employeeId) && samePeriod(snapshot, canonical.no_periodo, canonical.year)
    )) return;
    upsertEmployeePeriodSnapshot(target.rhh_employee_period_snapshots, {
      employee_id: Number(employeeId),
      employee_number: employee.employee_number,
      full_name: employee.full_name,
      ...canonical,
      present_in_payroll: true,
      status_at_period: 'active',
      department_id: employee.department_id ?? null,
      position_id: employee.position_id ?? null,
      shift_id: employee.shift_id ?? null,
      project: employee.project ?? null,
      sal_diario: employee.sal_diario ?? employee.salary_daily ?? null,
      salary_daily: employee.salary_daily ?? employee.sal_diario ?? null,
      sdi: employee.sdi ?? null,
      sbc: employee.sbc ?? null,
      fecha_ingreso: employee.fecha_ingreso || employee.start_date || null,
      source: 'legacy_backfill',
      backfill_quality: 'approximate_current_catalog',
      backfill_source_collection: sourceRecord,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    stats.snapshots_created++;
  };

  for (const incidence of target.rhh_incidencias_semanales || []) {
    createApproximateSnapshot(incidence.employee_id, incidence, 'rhh_incidencias_semanales');
  }
  for (const rol of target.rhh_weekly_rol || []) {
    const period = resolvePeriodForDate(target, rol.week_start);
    if (!period) continue;
    for (const assignment of (target.rhh_rol_assignments || []).filter(item => item.rol_id === rol.id)) {
      createApproximateSnapshot(assignment.employee_id, period, 'rhh_rol_assignments');
    }
  }
  stats.by_collection.rhh_employee_period_snapshots_created = stats.snapshots_created;

  return { db: target, stats };
}

module.exports = {
  LEGACY_PERIOD_YEAR,
  canonicalPeriod,
  backfillCanonicalPeriodFields,
  comparePeriods,
  derivePeriodYear,
  effectivePeriodYear,
  parsePeriodDate,
  periodContainsRange,
  periodKey,
  resolveRequestedYear,
  resolvePeriodForDate,
  samePeriod,
  getEmployeeTemplateForWeek,
  isoWeekPeriod,
  upsertCanonicalPeriod,
  upsertEmployeePeriodSnapshot,
  validWeek,
  validYear,
};
