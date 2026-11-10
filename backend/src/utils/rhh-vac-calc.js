const { effectivePeriodYear, isoWeekPeriod, validWeek } = require('./rhh-periods');

const DEFAULT_LFT_RULES = [
  { years: 1,  dias: 12 }, { years: 2,  dias: 14 }, { years: 3,  dias: 16 },
  { years: 4,  dias: 18 }, { years: 5,  dias: 20 }, { years: 6,  dias: 22 },
  { years: 11, dias: 24 },
];

/**
 * Calcula informacion de vacaciones para un empleado.
 * Fuente canonica unica — usada por /empleados y /rhh.
 *
 * dias_tomados   = incidencias semana <= actual (ya pagadas)
 * dias_programados = tomados + futuras (incidencias semana > actual) + pendientes (solicitudes)
 */
function calcVacInfo(emp, db, today) {
  const currentYear = new Date(today).getFullYear();
  const todayPeriod = isoWeekPeriod(today);
  const currentWeek = todayPeriod ? todayPeriod.no_periodo : 53;
  const startDate   = emp.start_date || emp.fecha_ingreso || null;

  let elegible = false, ciclos = 0, lft_dias = 0;

  if (startDate) {
    let start;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(startDate)) {
      const [d, m, y] = startDate.split('/');
      start = new Date(`${y}-${m}-${d}T12:00:00`);
    } else {
      start = new Date(startDate + 'T12:00:00');
    }
    if (!isNaN(start.getTime())) {
      const startYear    = start.getFullYear();
      const eligDeadline = new Date(currentYear - 1, 10, 1); // Nov 1 anio anterior
      if (startYear < currentYear && start < eligDeadline) {
        elegible = true;
        ciclos   = currentYear - startYear;
        const rules = (db.rhh_lft_rules && db.rhh_lft_rules.length)
          ? [...db.rhh_lft_rules].sort((a, b) => a.years - b.years)
          : DEFAULT_LFT_RULES;
        for (const r of rules) { if (ciclos >= r.years) lft_dias = r.dias; }
      }
    }
  }

  const override_dias    = emp.vac_dias_disponibles != null ? Number(emp.vac_dias_disponibles) : null;
  const dias_disponibles = override_dias !== null ? override_dias : lft_dias;

  // Separar incidencias en tomadas (semana <= actual) y futuras (semana > actual)
  const incidencias = (db.rhh_incidencias_semanales || []).filter(i => i.employee_id === emp.id);
  let dias_tomados = 0;
  let dias_inc_futuras = 0;

  for (const inc of incidencias) {
    if (!inc.vacaciones_dias) continue;
    const dias = Number(inc.vacaciones_dias) || 0;
    if (!dias) continue;

    let incYear;
    if (inc.year || inc.period_key || inc.fecha_inicio || inc.fecha_fin) {
      incYear = effectivePeriodYear(inc);
      if (incYear !== currentYear) continue;
    } else {
      if (!(inc.no_periodo >= 1 && inc.no_periodo <= 53)) continue;
      incYear = currentYear;
    }

    const incWeek = validWeek(inc.no_periodo);
    if (incWeek && incWeek > currentWeek) {
      dias_inc_futuras += dias;
    } else {
      dias_tomados += dias;
    }
  }

  // Solicitudes pendientes (aun no aprobadas → no tienen incidencia)
  const CUTOFF = '2026-08-11';
  const solicitudes = (db.rhh_vac_solicitudes || []).filter(r =>
    r.employee_id === emp.id && (r.created_at || '') >= CUTOFF
  );
  const diasPendientes = solicitudes
    .filter(r => r.estado === 'pendiente')
    .reduce((s, r) => s + (r.dias || 0), 0);

  // programados = tomados + futuras (ya en incidencias) + pendientes (solo solicitudes)
  const dias_programados = dias_tomados + dias_inc_futuras + diasPendientes;
  const dias_restantes   = Math.max(0, dias_disponibles - dias_programados);

  return {
    elegible, ciclos, lft_dias, override_dias, dias_disponibles,
    dias_tomados, dias_programados, dias_restantes,
    dias_pendientes: diasPendientes,
    dias_aprobados_futuro: dias_inc_futuras,
  };
}

module.exports = { calcVacInfo, DEFAULT_LFT_RULES };
