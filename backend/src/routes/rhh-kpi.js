/* ══════════════════════════════════════════════════════════════════════════════
   RHH — KPIs (Costos RHH, Costos por Proyecto, Incidencias por Área)
   Solo visible para roles rh y admin
   ══════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { read } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

/** Extrae importe de percepciones por clave parcial (ej. "4 Horas extras") */
function perc(inc, ...keys) {
  if (!inc.percepciones) return 0;
  let total = 0;
  for (const k of keys) {
    for (const [pk, pv] of Object.entries(inc.percepciones)) {
      if (pk.includes(k)) total += Number(pv) || 0;
    }
  }
  return total;
}

/** Calcula costos de una incidencia semanal */
function costos(inc, emp) {
  const sd = emp?.salary_daily || emp?.sal_diario || 0;
  const hasPerc = inc.percepciones && Object.keys(inc.percepciones).length > 0;

  if (hasPerc) {
    // Datos de Consolidado CONTPAQ — importes directos
    return {
      te:       perc(inc, '4 Horas extras'),
      vac:      perc(inc, '19 Vacaciones', '20 Prima de vacaciones', '21 Vacaciones reportadas', '22 Prima de vacaciones reportada'),
      bonos:    perc(inc, '15 Bono puntualidad', '7 Bono de productividad', '139 Bono instructor', '140 Bono por entregas', '141 Bono por actividades'),
      nomina:   perc(inc, '1 Sueldo', '3 Séptimo día', '10 Prima dominical'),
      despensa: perc(inc, '32 Despensa'),
      neto:     inc.neto_pdf || 0,
      total_perc: inc.total_perc_pdf || 0,
    };
  }

  // Fallback: datos legacy SQLite (campos básicos)
  return {
    te:       (inc.horas_extras_total || 0) * (sd / 8) * 2,
    vac:      inc.vacaciones_dias || 0,  // ya es importe en SQLite
    bonos:    (inc.bono_puntualidad_dias || 0) + (inc.bono_eficiencia_dias || 0) + (inc.bono_instructor || 0),
    nomina:   (inc.dias_pagados || 0) * sd,
    despensa: 0,
    neto:     0,
    total_perc: 0,
  };
}

/** Genera labels de semanas y meses a partir de incidencias */
function buildPeriodLabels(incidencias) {
  // Semanas
  const weekMap = new Map();
  incidencias.forEach(inc => {
    const np = inc.no_periodo;
    if (!np) return;
    const yr = inc.year || 2026;
    const key = `${yr}-S${String(np).padStart(2, '0')}`;
    if (!weekMap.has(key)) {
      weekMap.set(key, {
        key,
        label: `S${String(np).padStart(2, '0')}`,
        no_periodo: np,
        year: yr,
        fecha_inicio: inc.fecha_inicio || null,
        fecha_fin: inc.fecha_fin || null,
      });
    }
  });
  const weeks = [...weekMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  // Meses (agrupar semanas en meses)
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const monthMap = new Map();
  weeks.forEach(w => {
    // Estimar mes a partir del no_periodo (semana 1 ≈ ene, semana 5 ≈ feb, etc.)
    const monthIdx = Math.min(11, Math.floor((w.no_periodo - 1) / 4.33));
    const mKey = `${w.year}-${String(monthIdx + 1).padStart(2, '0')}`;
    if (!monthMap.has(mKey)) {
      monthMap.set(mKey, { key: mKey, label: `${monthNames[monthIdx]} ${w.year}`, monthIdx, year: w.year, weeks: [] });
    }
    monthMap.get(mKey).weeks.push(w);
  });
  const months = [...monthMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  return { weeks, months };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/rhh/kpi/costos-rhh — Costos RHH por semana o mes
// ══════════════════════════════════════════════════════════════════════════════
router.get('/costos-rhh', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const incs = db.rhh_incidencias_semanales || [];
  const emps = db.rhh_employees || [];
  const empMap = new Map(emps.map(e => [e.id, e]));

  const { weeks, months } = buildPeriodLabels(incs);

  // Por semana
  const byWeek = weeks.map(w => {
    const weekIncs = incs.filter(i => i.no_periodo === w.no_periodo && (i.year || 2026) === w.year);
    const totals = { te: 0, vac: 0, bonos: 0, nomina: 0, despensa: 0 };
    weekIncs.forEach(inc => {
      const c = costos(inc, empMap.get(inc.employee_id));
      totals.te += c.te;
      totals.vac += c.vac;
      totals.bonos += c.bonos;
      totals.nomina += c.nomina;
      totals.despensa += c.despensa;
    });
    return { ...w, ...totals, total: totals.te + totals.vac + totals.bonos + totals.nomina + totals.despensa, employees: weekIncs.length };
  });

  // Por mes
  const byMonth = months.map(m => {
    const totals = { te: 0, vac: 0, bonos: 0, nomina: 0, despensa: 0 };
    m.weeks.forEach(w => {
      const wd = byWeek.find(bw => bw.key === w.key);
      if (wd) {
        totals.te += wd.te;
        totals.vac += wd.vac;
        totals.bonos += wd.bonos;
        totals.nomina += wd.nomina;
        totals.despensa += wd.despensa;
      }
    });
    return { key: m.key, label: m.label, ...totals, total: totals.te + totals.vac + totals.bonos + totals.nomina + totals.despensa };
  });

  res.json({
    weeks_labels: weeks.map(w => w.label),
    months_labels: months.map(m => m.label),
    by_week: byWeek,
    by_month: byMonth,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/rhh/kpi/costos-proyecto — Costos por departamento + desglose puesto
// Query: ?semana_desde=N&semana_hasta=N&dept_id=N
// ══════════════════════════════════════════════════════════════════════════════
router.get('/costos-proyecto', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const incs = db.rhh_incidencias_semanales || [];
  const emps = db.rhh_employees || [];
  const depts = db.rhh_departments || [];
  const positions = db.rhh_positions || [];
  const empMap = new Map(emps.map(e => [e.id, e]));
  const deptMap = new Map(depts.map(d => [d.id, d.name]));
  const posMap = new Map(positions.map(p => [p.id, p.name]));

  // Filtros opcionales
  const semDesde = req.query.semana_desde ? Number(req.query.semana_desde) : null;
  const semHasta = req.query.semana_hasta ? Number(req.query.semana_hasta) : null;
  const filtDept = req.query.dept_id ? Number(req.query.dept_id) : null;

  const { weeks, months } = buildPeriodLabels(incs);

  // Filtrar semanas por rango
  const filteredWeeks = weeks.filter(w => {
    if (semDesde && w.no_periodo < semDesde) return false;
    if (semHasta && w.no_periodo > semHasta) return false;
    return true;
  });
  const filteredMonths = months.map(m => ({
    ...m,
    weeks: m.weeks.filter(w => filteredWeeks.some(fw => fw.key === w.key)),
  })).filter(m => m.weeks.length > 0);

  // Agrupar empleados por departamento
  const deptGroups = new Map(); // dept_id → { name, empIds: Set }
  emps.forEach(emp => {
    const did = emp.department_id;
    if (!did) return;
    if (filtDept && did !== filtDept) return;
    if (!deptGroups.has(did)) deptGroups.set(did, { name: deptMap.get(did) || `Dept ${did}`, empIds: new Set() });
    deptGroups.get(did).empIds.add(emp.id);
  });

  // Para cada departamento: totales por semana + desglose por puesto
  const departments = [...deptGroups.entries()].map(([deptId, grp]) => {
    // Totales del departamento por semana filtrada
    const byWeek = filteredWeeks.map(w => {
      const weekIncs = incs.filter(i =>
        i.no_periodo === w.no_periodo &&
        (i.year || 2026) === w.year &&
        grp.empIds.has(i.employee_id)
      );
      let amount = 0;
      weekIncs.forEach(inc => {
        const c = costos(inc, empMap.get(inc.employee_id));
        amount += c.te + c.vac + c.bonos + c.nomina + c.despensa;
      });
      return { amount };
    });

    const byMonth = filteredMonths.map(m => {
      let amount = 0;
      m.weeks.forEach(w => {
        const wIdx = filteredWeeks.findIndex(wk => wk.key === w.key);
        if (wIdx >= 0 && byWeek[wIdx]) amount += byWeek[wIdx].amount;
      });
      return { amount };
    });

    const total = byWeek.reduce((s, w) => s + w.amount, 0);

    // Desglose por puesto dentro de este departamento
    const posGroups = new Map(); // position_id → { name, empIds }
    emps.filter(e => grp.empIds.has(e.id)).forEach(emp => {
      const pid = emp.position_id || 0;
      if (!posGroups.has(pid)) posGroups.set(pid, { name: posMap.get(pid) || 'Sin puesto', empIds: new Set() });
      posGroups.get(pid).empIds.add(emp.id);
    });

    const puestos = [...posGroups.entries()].map(([posId, pg]) => {
      let posTotal = 0;
      const filtIncs = incs.filter(i => {
        if (!pg.empIds.has(i.employee_id)) return false;
        const np = i.no_periodo;
        if (semDesde && np < semDesde) return false;
        if (semHasta && np > semHasta) return false;
        return true;
      });
      filtIncs.forEach(inc => {
        const c = costos(inc, empMap.get(inc.employee_id));
        posTotal += c.te + c.vac + c.bonos + c.nomina + c.despensa;
      });
      return { name: pg.name, employees: pg.empIds.size, total: posTotal };
    }).filter(p => p.total > 0).sort((a, b) => b.total - a.total);

    return { dept_id: deptId, name: grp.name, employees: grp.empIds.size, by_week: byWeek, by_month: byMonth, total, puestos };
  }).sort((a, b) => b.total - a.total);

  res.json({
    weeks_labels: filteredWeeks.map(w => w.label),
    months_labels: filteredMonths.map(m => m.label),
    all_weeks: weeks.map(w => ({ no_periodo: w.no_periodo, label: w.label })),
    all_depts: depts.map(d => ({ id: d.id, name: d.name })),
    departments,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/rhh/kpi/incidencias — Incidencias por departamento
// ══════════════════════════════════════════════════════════════════════════════
router.get('/incidencias', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const incs = db.rhh_incidencias_semanales || [];
  const emps = db.rhh_employees || [];
  const depts = db.rhh_departments || [];
  const empMap = new Map(emps.map(e => [e.id, e]));

  const { weeks, months } = buildPeriodLabels(incs);

  // Por departamento
  const departments = depts.map(dept => {
    const deptEmpIds = new Set(emps.filter(e => e.department_id === dept.id).map(e => e.id));
    if (deptEmpIds.size === 0) return null;

    const byWeek = weeks.map(w => {
      const weekIncs = incs.filter(i =>
        i.no_periodo === w.no_periodo &&
        (i.year || 2026) === w.year &&
        deptEmpIds.has(i.employee_id)
      );
      const empleados = weekIncs.length;
      const asistencias = weekIncs.reduce((s, i) => s + (i.dias_pagados || 0), 0);
      const faltas = weekIncs.reduce((s, i) => s + (i.faltas || 0), 0);
      const vacaciones = weekIncs.filter(i => (i.vacaciones_dias || 0) > 0).length;
      return { empleados, asistencias: Math.round(asistencias * 100) / 100, faltas, vacaciones };
    });

    const byMonth = months.map(m => {
      const totals = { empleados: 0, asistencias: 0, faltas: 0, vacaciones: 0 };
      let weekCount = 0;
      m.weeks.forEach(w => {
        const wIdx = weeks.findIndex(wk => wk.key === w.key);
        if (wIdx >= 0 && byWeek[wIdx]) {
          totals.empleados = Math.max(totals.empleados, byWeek[wIdx].empleados);
          totals.asistencias += byWeek[wIdx].asistencias;
          totals.faltas += byWeek[wIdx].faltas;
          totals.vacaciones += byWeek[wIdx].vacaciones;
          weekCount++;
        }
      });
      return totals;
    });

    // Totales acumulados
    const totalEmpleados = Math.max(...byWeek.map(w => w.empleados), 0);
    const totalAsist = byWeek.reduce((s, w) => s + w.asistencias, 0);
    const totalFaltas = byWeek.reduce((s, w) => s + w.faltas, 0);
    const totalVac = byWeek.reduce((s, w) => s + w.vacaciones, 0);

    return {
      id: dept.id,
      name: dept.name,
      total_empleados: totalEmpleados,
      total_asistencias: Math.round(totalAsist * 100) / 100,
      total_faltas: totalFaltas,
      total_vacaciones: totalVac,
      by_week: byWeek,
      by_month: byMonth,
    };
  }).filter(Boolean).sort((a, b) => b.total_empleados - a.total_empleados);

  res.json({
    weeks_labels: weeks.map(w => w.label),
    months_labels: months.map(m => m.label),
    departments,
  });
});

module.exports = router;
