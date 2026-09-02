const UNION_HOLIDAY_RULES = [
  { key: 'union-01-01', monthDay: '01-01', name: '1 de enero — Acuerdo sindical', startYear: 2026 },
  { key: 'union-12-24', monthDay: '12-24', name: '24 de diciembre — Acuerdo sindical', startYear: 2026 },
];

function normalizeYears(years) {
  const values = Array.isArray(years) ? years : [years];
  return [...new Set(values.map(Number).filter(y => Number.isInteger(y) && y >= 2026 && y <= 2200))];
}

/**
 * Materializa los feriados sindicales recurrentes en el catálogo basado en fechas.
 * Si una fecha ya existe (p. ej. Año Nuevo), conserva el registro y añade el origen
 * sindical en vez de crear un duplicado.
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
        month_day: rule.monthDay,
        name: rule.name,
        start_year: rule.startYear,
        source: 'acuerdo_sindical',
        active: true,
      };
      db.rhh_recurring_holidays.push(storedRule);
      changed = true;
    }
  }

  for (const year of normalizeYears(years)) {
    for (const rule of UNION_HOLIDAY_RULES) {
      if (year < rule.startYear) continue;
      const date = `${year}-${rule.monthDay}`;
      const existing = db.rhh_holidays.find(h => h.date === date);
      if (existing) {
        const sources = Array.isArray(existing.sources) ? existing.sources : [];
        if (!sources.includes('acuerdo_sindical')) {
          existing.sources = [...sources, 'acuerdo_sindical'];
          existing.union_agreement = true;
          existing.recurring_key = rule.key;
          changed = true;
        }
        continue;
      }

      db.rhh_holidays.push({
        id: db.rhh_holidays.reduce((m, h) => Math.max(m, Number(h.id) || 0), 0) + 1,
        date,
        name: rule.name,
        sources: ['acuerdo_sindical'],
        union_agreement: true,
        recurring_key: rule.key,
        created_at: new Date().toISOString(),
      });
      changed = true;
    }
  }

  return changed;
}

module.exports = { UNION_HOLIDAY_RULES, ensureUnionAgreementHolidays };
