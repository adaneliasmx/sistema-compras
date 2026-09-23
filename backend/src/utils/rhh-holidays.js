// Festivos con fecha fija (monthDay) o móvil (nthMonday: { month, nth })
const UNION_HOLIDAY_RULES = [
  { key: 'union-01-01', monthDay: '01-01', name: '1 de enero — Acuerdo sindical', startYear: 2026 },
  { key: 'lft-02-const', nthMonday: { month: 2, nth: 1 }, name: 'Día de la Constitución', startYear: 2026, source: 'lft' },
  { key: 'lft-03-juarez', nthMonday: { month: 3, nth: 3 }, name: 'Natalicio de Benito Juárez', startYear: 2026, source: 'lft' },
  { key: 'lft-05-01', monthDay: '05-01', name: 'Día del Trabajo', startYear: 2026, source: 'lft' },
  { key: 'lft-09-16', monthDay: '09-16', name: 'Día de la Independencia', startYear: 2026, source: 'lft' },
  { key: 'lft-11-rev', nthMonday: { month: 11, nth: 3 }, name: 'Revolución Mexicana', startYear: 2026, source: 'lft' },
  { key: 'union-12-24', monthDay: '12-24', name: '24 de diciembre — Acuerdo sindical', startYear: 2026 },
  { key: 'union-12-25', monthDay: '12-25', name: 'Navidad', startYear: 2026 },
  { key: 'union-12-31', monthDay: '12-31', name: '31 de diciembre — Otorgado por la empresa', startYear: 2026 },
];

/** Calcula el N-ésimo lunes de un mes en un año dado */
function nthMondayOf(year, month, nth) {
  const first = new Date(year, month - 1, 1);
  const dow = first.getDay(); // 0=dom..6=sab
  const firstMonday = dow <= 1 ? 1 + (1 - dow) : 1 + (8 - dow);
  const day = firstMonday + (nth - 1) * 7;
  return String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function normalizeYears(years) {
  const values = Array.isArray(years) ? years : [years];
  return [...new Set(values.map(Number).filter(y => Number.isInteger(y) && y >= 2026 && y <= 2200))];
}

/**
 * Materializa los feriados recurrentes en el catálogo basado en fechas.
 * Soporta fecha fija (monthDay) y N-ésimo lunes (nthMonday).
 * Si una fecha ya existe, conserva el registro y añade el origen.
 */
function ensureUnionAgreementHolidays(db, years) {
  if (!db.rhh_holidays) db.rhh_holidays = [];
  if (!db.rhh_recurring_holidays) db.rhh_recurring_holidays = [];

  let changed = false;
  for (const rule of UNION_HOLIDAY_RULES) {
    let storedRule = db.rhh_recurring_holidays.find(r => r.key === rule.key);
    if (!storedRule) {
      storedRule = {
        id: db.rhh_recurring_holidays.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1,
        key: rule.key,
        month_day: rule.monthDay || null,
        nth_monday: rule.nthMonday || null,
        name: rule.name,
        start_year: rule.startYear,
        source: rule.source || 'acuerdo_sindical',
        active: true,
      };
      db.rhh_recurring_holidays.push(storedRule);
      changed = true;
    }
  }

  // Limpiar festivos con recurring_key que ya no existen en las reglas
  const validKeys = new Set(UNION_HOLIDAY_RULES.map(r => r.key));
  const toRemove = db.rhh_holidays.filter(h => h.recurring_key && !validKeys.has(h.recurring_key));
  for (const h of toRemove) {
    db.rhh_holidays.splice(db.rhh_holidays.indexOf(h), 1);
    changed = true;
  }

  const ruleSource = rule => rule.source || 'acuerdo_sindical';

  for (const year of normalizeYears(years)) {
    for (const rule of UNION_HOLIDAY_RULES) {
      if (year < rule.startYear) continue;
      const md = rule.nthMonday
        ? nthMondayOf(year, rule.nthMonday.month, rule.nthMonday.nth)
        : rule.monthDay;
      const date = `${year}-${md}`;
      const src = ruleSource(rule);
      const existing = db.rhh_holidays.find(h => h.date === date);
      if (existing) {
        const sources = Array.isArray(existing.sources) ? existing.sources : [];
        if (!sources.includes(src)) {
          existing.sources = [...sources, src];
          if (src === 'acuerdo_sindical') existing.union_agreement = true;
          existing.recurring_key = rule.key;
          changed = true;
        }
        // Actualizar nombre si cambió
        if (existing.name !== rule.name) {
          existing.name = rule.name;
          changed = true;
        }
        continue;
      }

      db.rhh_holidays.push({
        id: db.rhh_holidays.reduce((m, h) => Math.max(m, Number(h.id) || 0), 0) + 1,
        date,
        name: rule.name,
        sources: [src],
        union_agreement: src === 'acuerdo_sindical',
        recurring_key: rule.key,
        created_at: new Date().toISOString(),
      });
      changed = true;
    }
  }

  return changed;
}

module.exports = { UNION_HOLIDAY_RULES, ensureUnionAgreementHolidays };
