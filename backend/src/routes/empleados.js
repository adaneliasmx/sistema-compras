const express = require('express');
const { read, write } = require('../db-rhh');
const { empAuthRequired } = require('../middleware/empleados-auth');

const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

const DEFAULT_LFT_RULES = [
  { years: 1,  dias: 12 }, { years: 2,  dias: 14 }, { years: 3,  dias: 16 },
  { years: 4,  dias: 18 }, { years: 5,  dias: 20 }, { years: 6,  dias: 22 },
  { years: 11, dias: 24 },
];

function calcVacInfo(emp, db, today) {
  const currentYear = new Date(today).getFullYear();
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
      const startYear      = start.getFullYear();
      const eligDeadline   = new Date(currentYear - 1, 10, 1); // Nov 1 año anterior
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

  // Días tomados — única fuente: Consolidado CONTPAQ (vacaciones_dias en incidencias)
  const incidencias = (db.rhh_incidencias_semanales || []).filter(i => i.employee_id === emp.id);
  const dias_tomados = incidencias.reduce((sum, inc) => {
    if (!inc.vacaciones_dias) return sum;
    const fechaRef = inc.fecha_inicio || null;
    if (fechaRef) {
      const yr = new Date(fechaRef + 'T12:00:00').getFullYear();
      return yr === currentYear ? sum + (Number(inc.vacaciones_dias) || 0) : sum;
    }
    return (inc.no_periodo >= 1 && inc.no_periodo <= 53)
      ? sum + (Number(inc.vacaciones_dias) || 0) : sum;
  }, 0);

  // Solicitudes pendientes del nuevo sistema (a partir de 2026-08-11)
  const CUTOFF = '2026-08-11';
  const requests = (db.rhh_vac_solicitudes || []).filter(r =>
    r.employee_id === emp.id && r.estado === 'pendiente' && (r.created_at || '') >= CUTOFF
  );
  const diasPendientes   = requests.reduce((s, r) => s + (r.dias || 0), 0);
  const dias_programados = dias_tomados + diasPendientes;
  const dias_restantes   = Math.max(0, dias_disponibles - dias_programados);
  return { elegible, ciclos, lft_dias, override_dias, dias_disponibles, dias_tomados, dias_programados, dias_restantes };
}

// Periodos 2026 (CONTPAQ, lun-dom) — fallback cuando rhh_periodos está vacío
const PERIODOS_2026 = [
  { no_periodo:  1, fecha_inicio:'30/Dic/2025', fecha_fin:'05/Ene/2026' },
  { no_periodo:  2, fecha_inicio:'06/Ene/2026', fecha_fin:'12/Ene/2026' },
  { no_periodo:  3, fecha_inicio:'13/Ene/2026', fecha_fin:'19/Ene/2026' },
  { no_periodo:  4, fecha_inicio:'20/Ene/2026', fecha_fin:'26/Ene/2026' },
  { no_periodo:  5, fecha_inicio:'27/Ene/2026', fecha_fin:'02/Feb/2026' },
  { no_periodo:  6, fecha_inicio:'03/Feb/2026', fecha_fin:'09/Feb/2026' },
  { no_periodo:  7, fecha_inicio:'10/Feb/2026', fecha_fin:'16/Feb/2026' },
  { no_periodo:  8, fecha_inicio:'17/Feb/2026', fecha_fin:'23/Feb/2026' },
  { no_periodo:  9, fecha_inicio:'24/Feb/2026', fecha_fin:'02/Mar/2026' },
  { no_periodo: 10, fecha_inicio:'03/Mar/2026', fecha_fin:'09/Mar/2026' },
  { no_periodo: 11, fecha_inicio:'10/Mar/2026', fecha_fin:'16/Mar/2026' },
  { no_periodo: 12, fecha_inicio:'17/Mar/2026', fecha_fin:'23/Mar/2026' },
  { no_periodo: 13, fecha_inicio:'24/Mar/2026', fecha_fin:'30/Mar/2026' },
  { no_periodo: 14, fecha_inicio:'31/Mar/2026', fecha_fin:'06/Abr/2026' },
  { no_periodo: 15, fecha_inicio:'07/Abr/2026', fecha_fin:'13/Abr/2026' },
  { no_periodo: 16, fecha_inicio:'14/Abr/2026', fecha_fin:'20/Abr/2026' },
  { no_periodo: 17, fecha_inicio:'21/Abr/2026', fecha_fin:'27/Abr/2026' },
  { no_periodo: 18, fecha_inicio:'28/Abr/2026', fecha_fin:'04/May/2026' },
  { no_periodo: 19, fecha_inicio:'05/May/2026', fecha_fin:'11/May/2026' },
  { no_periodo: 20, fecha_inicio:'12/May/2026', fecha_fin:'18/May/2026' },
  { no_periodo: 21, fecha_inicio:'19/May/2026', fecha_fin:'25/May/2026' },
  { no_periodo: 22, fecha_inicio:'26/May/2026', fecha_fin:'01/Jun/2026' },
  { no_periodo: 23, fecha_inicio:'02/Jun/2026', fecha_fin:'08/Jun/2026' },
  { no_periodo: 24, fecha_inicio:'09/Jun/2026', fecha_fin:'15/Jun/2026' },
  { no_periodo: 25, fecha_inicio:'16/Jun/2026', fecha_fin:'22/Jun/2026' },
  { no_periodo: 26, fecha_inicio:'23/Jun/2026', fecha_fin:'29/Jun/2026' },
  { no_periodo: 27, fecha_inicio:'30/Jun/2026', fecha_fin:'06/Jul/2026' },
  { no_periodo: 28, fecha_inicio:'07/Jul/2026', fecha_fin:'13/Jul/2026' },
  { no_periodo: 29, fecha_inicio:'14/Jul/2026', fecha_fin:'20/Jul/2026' },
  { no_periodo: 30, fecha_inicio:'21/Jul/2026', fecha_fin:'27/Jul/2026' },
  { no_periodo: 31, fecha_inicio:'28/Jul/2026', fecha_fin:'03/Ago/2026' },
  { no_periodo: 32, fecha_inicio:'04/Ago/2026', fecha_fin:'10/Ago/2026' },
  { no_periodo: 33, fecha_inicio:'11/Ago/2026', fecha_fin:'17/Ago/2026' },
  { no_periodo: 34, fecha_inicio:'18/Ago/2026', fecha_fin:'24/Ago/2026' },
  { no_periodo: 35, fecha_inicio:'25/Ago/2026', fecha_fin:'31/Ago/2026' },
  { no_periodo: 36, fecha_inicio:'01/Sep/2026', fecha_fin:'07/Sep/2026' },
  { no_periodo: 37, fecha_inicio:'08/Sep/2026', fecha_fin:'14/Sep/2026' },
  { no_periodo: 38, fecha_inicio:'15/Sep/2026', fecha_fin:'21/Sep/2026' },
  { no_periodo: 39, fecha_inicio:'22/Sep/2026', fecha_fin:'28/Sep/2026' },
  { no_periodo: 40, fecha_inicio:'29/Sep/2026', fecha_fin:'05/Oct/2026' },
  { no_periodo: 41, fecha_inicio:'06/Oct/2026', fecha_fin:'12/Oct/2026' },
  { no_periodo: 42, fecha_inicio:'13/Oct/2026', fecha_fin:'19/Oct/2026' },
  { no_periodo: 43, fecha_inicio:'20/Oct/2026', fecha_fin:'26/Oct/2026' },
  { no_periodo: 44, fecha_inicio:'27/Oct/2026', fecha_fin:'02/Nov/2026' },
  { no_periodo: 45, fecha_inicio:'03/Nov/2026', fecha_fin:'09/Nov/2026' },
  { no_periodo: 46, fecha_inicio:'10/Nov/2026', fecha_fin:'16/Nov/2026' },
  { no_periodo: 47, fecha_inicio:'17/Nov/2026', fecha_fin:'23/Nov/2026' },
  { no_periodo: 48, fecha_inicio:'24/Nov/2026', fecha_fin:'30/Nov/2026' },
  { no_periodo: 49, fecha_inicio:'01/Dic/2026', fecha_fin:'07/Dic/2026' },
  { no_periodo: 50, fecha_inicio:'08/Dic/2026', fecha_fin:'14/Dic/2026' },
  { no_periodo: 51, fecha_inicio:'15/Dic/2026', fecha_fin:'21/Dic/2026' },
  { no_periodo: 52, fecha_inicio:'22/Dic/2026', fecha_fin:'28/Dic/2026' },
];

const MESES = { Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11 };
function periodoToDate(str) {
  const [d, m, y] = str.split('/');
  return new Date(Number(y), MESES[m], Number(d));
}

function currentPeriodo() {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }));
  for (const p of PERIODOS_2026) {
    const ini = periodoToDate(p.fecha_inicio);
    const fin = periodoToDate(p.fecha_fin);
    if (today >= ini && today <= fin) return p.no_periodo;
  }
  return PERIODOS_2026[PERIODOS_2026.length - 1].no_periodo;
}

function resolveEmpData(emp, db) {
  const dept = (db.rhh_departments || []).find(d => d.id === emp.department_id);
  const pos  = (db.rhh_positions  || []).find(p => p.id === emp.position_id);
  const shift = (db.rhh_shifts    || []).find(s => s.id === emp.shift_id);
  return {
    id: emp.id,
    employee_number: emp.employee_number,
    full_name: emp.full_name,
    email: emp.email,
    phone: emp.phone,
    department: dept ? dept.name : null,
    position: pos ? pos.name : null,
    shift: shift ? shift.name : null,
    start_date: emp.start_date || emp.hire_date,
    rfc: emp.rfc,
    nss: emp.nss,
    curp: emp.curp,
    status: emp.status,
    salary_daily: emp.salary_daily,
    ultimo_periodo_pagado: emp.ultimo_periodo_pagado,
  };
}

// ── GET /api/empleados/perfil ─────────────────────────────────────────────────
router.get('/perfil', empAuthRequired, (req, res) => {
  const db = read();
  const emp = (db.rhh_employees || []).find(e => e.id === req.empPayload.sub);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  res.json(resolveEmpData(emp, db));
});

// ── GET /api/empleados/incidencias ────────────────────────────────────────────
router.get('/incidencias', empAuthRequired, (req, res) => {
  const db      = read();
  const empId   = req.empPayload.sub;
  const emp     = (db.rhh_employees || []).find(e => e.id === empId);
  const periodos = db.rhh_periodos && db.rhh_periodos.length ? db.rhh_periodos : PERIODOS_2026;
  const rows = (db.rhh_incidencias_semanales || [])
    .filter(r => r.employee_id === empId)
    .sort((a, b) => b.no_periodo - a.no_periodo)
    .slice(0, 52)
    .map(r => {
      const p = periodos.find(p => p.no_periodo === r.no_periodo) || {};
      return { ...r, fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin };
    });
  const vac_info = emp ? calcVacInfo(emp, db, nowMxDate()) : null;
  res.json({ rows, vac_info });
});

// ── GET /api/empleados/evaluaciones ──────────────────────────────────────────
router.get('/evaluaciones', empAuthRequired, (req, res) => {
  const db = read();
  const rows = (db.rhh_evaluations || [])
    .filter(r => r.employee_id === req.empPayload.sub)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  res.json(rows);
});

// ── GET /api/empleados/evaluaciones-historial ─────────────────────────────────
router.get('/evaluaciones-historial', empAuthRequired, (req, res) => {
  const db    = read();
  const empId = req.empPayload.sub;
  const emp   = (db.rhh_employees || []).find(e => e.id === empId);
  const salDiario = emp ? (emp.salary_daily || emp.sal_diario || 0) : 0;

  const incidencias  = (db.rhh_incidencias_semanales || []).filter(r => r.employee_id === empId);
  const evalResults  = (db.rhh_eval_results          || []).filter(r => r.employee_id === empId);
  const sessions     = db.rhh_eval_sessions || [];
  const periodos     = (db.rhh_periodos && db.rhh_periodos.length > 0)
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));

  const MES = { Ene:1,Ene:1,Feb:2,Mar:3,Abr:4,May:5,Jun:6,Jul:7,Ago:8,Sep:9,Oct:10,Nov:11,Dic:12 };
  function periodoToMonthYear(p) {
    const fi = p.fecha_inicio || '';
    const m  = fi.match(/\d{2}\/([A-Za-z]+)\/(\d{4})/);
    if (m) return { month: MES[m[1]] || 0, year: Number(m[2]) };
    const m2 = fi.match(/(\d{4})-(\d{2})/);
    if (m2) return { month: Number(m2[2]), year: Number(m2[1]) };
    return { month: 0, year: 0 };
  }

  const periodMap = {};
  for (const p of periodos) periodMap[p.no_periodo] = periodoToMonthYear(p);

  const monthData = {};
  const key = (y, m) => `${y}-${String(m).padStart(2,'0')}`;

  // Agrupar incidencias por mes — sumar P|7 Bono productividad
  for (const inc of incidencias) {
    const pm = periodMap[inc.no_periodo];
    if (!pm || !pm.month) continue;
    const k = key(pm.year, pm.month);
    if (!monthData[k]) monthData[k] = { year: pm.year, month: pm.month, bono_prod_importe: 0, semanas: [], eval: null };
    monthData[k].semanas.push(inc.no_periodo);
    const percs = inc.percepciones || {};
    for (const [label, val] of Object.entries(percs)) {
      if (/^7\s/.test(label)) monthData[k].bono_prod_importe += Number(val) || 0;
    }
  }

  // Agregar resultado de evaluación mensual
  for (const ev of evalResults) {
    const session = sessions.find(s => s.id === ev.session_id);
    if (!session || !session.month || !session.year) continue;
    const k = key(session.year, session.month);
    if (!monthData[k]) monthData[k] = { year: session.year, month: session.month, bono_prod_importe: 0, semanas: [], eval: null };
    const eval_days = ev.total_points > 0
      ? Math.round((ev.points_obtained / ev.total_points) * 100) / 100
      : 0;
    const dias_reclamos = session.dias_reclamos ?? 0;
    const dias_calidad  = session.dias_calidad  ?? 0;
    monthData[k].eval = {
      session_name:     session.name,
      score_pct:        ev.score_pct,
      points_obtained:  ev.points_obtained,
      total_points:     ev.total_points,
      eval_days,
      dias_reclamos,
      dias_calidad,
      total_bono: Math.min(3, Math.round((eval_days + dias_reclamos + dias_calidad) * 100) / 100),
      items: (ev.item_scores || []).map(it => ({
        name:       it.item_name,
        stars:      it.stars || 0,
        points:     it.points,
        max_points: it.max_points || it.ponderacion || 0
      }))
    };
  }

  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const historial = Object.values(monthData)
    .map(d => ({
      ...d,
      month_name:         MONTH_NAMES[d.month - 1] || '',
      bono_prod_importe:  Math.round(d.bono_prod_importe * 100) / 100,
      bono_prod_dias:     salDiario > 0 ? Math.round((d.bono_prod_importe / salDiario) * 100) / 100 : null,
    }))
    .sort((a, b) => b.year - a.year || b.month - a.month);

  res.json({ historial, sal_diario: salDiario });
});

// ── GET /api/empleados/lista-raya ─────────────────────────────────────────────
// Retorna el período anterior (o el último pagado) del empleado
router.get('/lista-raya', empAuthRequired, (req, res) => {
  const db = read();
  const periodos = db.rhh_periodos && db.rhh_periodos.length ? db.rhh_periodos : PERIODOS_2026;
  const emp = (db.rhh_employees || []).find(e => e.id === req.empPayload.sub);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const curP = currentPeriodo();
  const targetPeriodo = curP > 1 ? curP - 1 : 1;

  // Buscar el registro de ese período; si no, el más reciente
  let row = (db.rhh_incidencias_semanales || []).find(
    r => r.employee_id === req.empPayload.sub && r.no_periodo === targetPeriodo
  );
  if (!row) {
    const all = (db.rhh_incidencias_semanales || [])
      .filter(r => r.employee_id === req.empPayload.sub)
      .sort((a, b) => b.no_periodo - a.no_periodo);
    row = all[0] || null;
  }

  if (!row) return res.json({ periodo: null, datos: null });

  const p = periodos.find(p => p.no_periodo === row.no_periodo) || {};

  // Calcular monto estimado (solo referencia)
  const salarioDiario = emp.salary_daily || emp.sal_diario || 0;
  const montoBase = salarioDiario * (row.dias_pagados || 0);
  const montoHE = row.horas_extras_total ? (salarioDiario / 8 * 1.5 * row.horas_extras_total) : 0;

  // ¿Ya existe aclaración pendiente para este período?
  const yaAclaracion = (db.rhh_payroll_clarifications || []).some(
    c => c.employee_id === req.empPayload.sub && c.no_periodo === row.no_periodo && c.status === 'pendiente'
  );

  res.json({
    periodo: { no_periodo: row.no_periodo, fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin },
    datos: row,
    salario_diario: salarioDiario,
    monto_base: Math.round(montoBase * 100) / 100,
    monto_he: Math.round(montoHE * 100) / 100,
    percepciones: row.percepciones || null,
    deducciones: row.deducciones || null,
    total_perc: row.total_perc_pdf || null,
    total_ded: row.total_ded_pdf || null,
    neto_pagar: row.neto_pdf || null,
    ya_aclaracion: yaAclaracion,
  });
});

// ── POST /api/empleados/aclaracion ────────────────────────────────────────────
router.post('/aclaracion', empAuthRequired, (req, res) => {
  const { no_periodo, mensaje } = req.body || {};
  if (!no_periodo || !mensaje) return res.status(400).json({ error: 'Período y mensaje requeridos' });

  const db = read();
  if (!Array.isArray(db.rhh_payroll_clarifications)) db.rhh_payroll_clarifications = [];

  const dup = db.rhh_payroll_clarifications.find(
    c => c.employee_id === req.empPayload.sub && c.no_periodo === Number(no_periodo) && c.status === 'pendiente'
  );
  if (dup) return res.status(409).json({ error: 'Ya tienes una aclaración pendiente para este período' });

  const nextId = (db.rhh_payroll_clarifications.reduce((m, c) => Math.max(m, c.id || 0), 0)) + 1;
  const record = {
    id: nextId,
    employee_id: req.empPayload.sub,
    no_periodo: Number(no_periodo),
    mensaje: String(mensaje).trim().slice(0, 500),
    status: 'pendiente',
    created_at: nowMxDate(),
    respuesta: null,
    respondido_at: null,
  };
  db.rhh_payroll_clarifications.push(record);
  write(db);
  res.json({ ok: true, id: nextId });
});

// ── POST /api/empleados/queja ─────────────────────────────────────────────────
router.post('/queja', empAuthRequired, (req, res) => {
  const { categoria, mensaje } = req.body || {};
  if (!mensaje) return res.status(400).json({ error: 'Mensaje requerido' });

  const db = read();
  if (!Array.isArray(db.rhh_anonymous_complaints)) db.rhh_anonymous_complaints = [];

  const nextId = (db.rhh_anonymous_complaints.reduce((m, c) => Math.max(m, c.id || 0), 0)) + 1;
  const record = {
    id: nextId,
    // NO se guarda employee_id — queja anónima
    categoria: String(categoria || 'general').trim(),
    mensaje: String(mensaje).trim().slice(0, 1000),
    status: 'nuevo',
    created_at: nowMxDate(),
    leido_at: null,
  };
  db.rhh_anonymous_complaints.push(record);
  write(db);
  res.json({ ok: true });
});

// ── GET /api/empleados/vacaciones ─────────────────────────────────────────────
router.get('/vacaciones', empAuthRequired, (req, res) => {
  const db = read();
  const rows = (db.rhh_vacation_requests || [])
    .filter(r => r.employee_id === req.empPayload.sub)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  res.json(rows);
});

// ── POST /api/empleados/vacaciones ────────────────────────────────────────────
router.post('/vacaciones', empAuthRequired, (req, res) => {
  const { fecha_inicio, fecha_fin, motivo } = req.body || {};
  if (!fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Fechas requeridas' });

  const d1 = new Date(fecha_inicio);
  const d2 = new Date(fecha_fin);
  if (isNaN(d1) || isNaN(d2) || d2 < d1) return res.status(400).json({ error: 'Rango de fechas inválido' });

  const dias = Math.round((d2 - d1) / 86400000) + 1;

  const db  = read();
  const emp = (db.rhh_employees || []).find(e => e.id === req.empPayload.sub);
  if (!Array.isArray(db.rhh_vacation_requests)) db.rhh_vacation_requests = [];

  // Validar días disponibles (no debe superar días_restantes incluyendo ya programados)
  if (emp) {
    const vacInfo = calcVacInfo(emp, db, nowMxDate());
    if (!vacInfo.elegible) {
      return res.status(400).json({ error: 'Aún no tienes días de vacaciones disponibles para este año. Debes haber laborado al menos 2 meses del año anterior.' });
    }
    if (dias > vacInfo.dias_restantes) {
      return res.status(400).json({
        error: `No tienes suficientes días disponibles. Disponibles: ${vacInfo.dias_disponibles}, ya comprometidos: ${vacInfo.dias_programados}, restantes: ${vacInfo.dias_restantes}. Solicitas: ${dias} días.${vacInfo.dias_programados > 0 ? ' Si quieres cambiar fechas, cancela primero los días ya programados.' : ''}`
      });
    }
  }

  const nextId = (db.rhh_vacation_requests.reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1;
  const record = {
    id: nextId,
    employee_id: req.empPayload.sub,
    fecha_inicio,
    fecha_fin,
    dias,
    motivo: String(motivo || '').trim().slice(0, 300),
    status: 'pendiente',
    created_at: nowMxDate(),
    reviewed_by: null,
    reviewed_at: null,
    notas_rh: null,
  };
  db.rhh_vacation_requests.push(record);
  write(db);
  res.json({ ok: true, id: nextId, dias });
});

module.exports = router;
