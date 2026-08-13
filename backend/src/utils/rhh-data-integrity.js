function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function normalizeEmployeeNumber(value) {
  return String(value ?? '').trim().replace(/^0+/, '');
}

/**
 * Adds employees that only exist in the repository seed without replacing any
 * field already persisted in production. The persisted record is the source of
 * truth; the seed only supplies fields that the persisted record does not have.
 */
function mergeEmployeesFromSeed(existingEmployees = [], seedEmployees = []) {
  const merged = existingEmployees.map(clone);

  for (const seedEmployee of seedEmployees) {
    const seedNumber = normalizeEmployeeNumber(
      seedEmployee.employee_number ?? seedEmployee.no
    );

    let index = -1;
    if (seedNumber) {
      index = merged.findIndex(employee => normalizeEmployeeNumber(
        employee.employee_number ?? employee.no
      ) === seedNumber);
    } else if (seedEmployee.id != null) {
      index = merged.findIndex(employee => employee.id === seedEmployee.id);
    }

    if (index !== -1) {
      // Existing values, including null/false, are intentional production data.
      merged[index] = { ...clone(seedEmployee), ...merged[index] };
      continue;
    }

    const employeeToAdd = clone(seedEmployee);
    if (merged.some(employee => employee.id === employeeToAdd.id)) {
      employeeToAdd.id = merged.reduce(
        (max, employee) => Math.max(max, Number(employee.id) || 0),
        0
      ) + 1;
    }
    merged.push(employeeToAdd);
  }

  return merged;
}

function optionalNumber(value, fallback = null) {
  if (value === null || value === '') return null;
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculatePaidDays(absences) {
  const safeAbsences = Math.min(6, Math.max(0, Number(absences) || 0));
  const attendance = Math.max(0, 6 - safeAbsences);
  const seventhDay = Math.round((attendance / 6) * 100) / 100;
  return attendance + seventhDay;
}

/**
 * Updates only the fields owned by the weekly-incidence form. Imported payroll
 * data (perceptions, deductions, totals, dates and source metadata) remains on
 * the record. dias_pagados sent by the client is respected because it can be
 * the real CONTPAQ value and is recalculated in the UI only when faltas changes.
 */
function mergeWeeklyIncident(existing, row, context) {
  const now = context.now;
  const absenceValue = optionalNumber(row.faltas, existing?.faltas ?? 0);
  const absences = Math.min(6, Math.max(0, absenceValue ?? 0));
  const paidDays = row.dias_pagados !== undefined
    ? optionalNumber(row.dias_pagados, existing?.dias_pagados ?? calculatePaidDays(absences))
    : (existing?.dias_pagados ?? calculatePaidDays(absences));

  const editable = {
    no_periodo:              Number(context.no_periodo),
    year:                    Number(context.year || existing?.year || 2026),
    period_key:              context.period_key || existing?.period_key || `${Number(context.year || existing?.year || 2026)}-S${String(Number(context.no_periodo)).padStart(2, '0')}`,
    employee_id:             Number(row.employee_id),
    dias_pagados:            paidDays,
    faltas:                  absences,
    horas_extras_total:      optionalNumber(row.horas_extras_total, existing?.horas_extras_total ?? 0),
    despensa:                row.despensa !== undefined ? (row.despensa ? 1 : 0) : (existing?.despensa ?? 0),
    bono_puntualidad_dias:   optionalNumber(row.bono_puntualidad_dias, existing?.bono_puntualidad_dias ?? null),
    bono_eficiencia_dias:    optionalNumber(row.bono_eficiencia_dias, existing?.bono_eficiencia_dias ?? null),
    bono_instructor:         optionalNumber(row.bono_instructor, existing?.bono_instructor ?? null),
    prima_dominical:         row.prima_dominical !== undefined ? (row.prima_dominical ? 1 : 0) : (existing?.prima_dominical ?? 0),
    vacaciones_dias:         optionalNumber(row.vacaciones_dias, existing?.vacaciones_dias ?? null),
    gratificacion:           optionalNumber(row.gratificacion, existing?.gratificacion ?? null),
    notas:                   row.notas !== undefined ? String(row.notas || '') : (existing?.notas || ''),
    updated_by:              context.updated_by,
    updated_at:              now,
  };

  return {
    ...(existing || {}),
    ...editable,
    id: existing?.id ?? context.id,
    created_at: existing?.created_at ?? now,
  };
}

module.exports = {
  calculatePaidDays,
  mergeEmployeesFromSeed,
  mergeWeeklyIncident,
  normalizeEmployeeNumber,
};
