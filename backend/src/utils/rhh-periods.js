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

module.exports = {
  LEGACY_PERIOD_YEAR,
  canonicalPeriod,
  comparePeriods,
  derivePeriodYear,
  effectivePeriodYear,
  parsePeriodDate,
  periodKey,
  resolveRequestedYear,
  samePeriod,
  upsertCanonicalPeriod,
  upsertEmployeePeriodSnapshot,
  validWeek,
  validYear,
};
