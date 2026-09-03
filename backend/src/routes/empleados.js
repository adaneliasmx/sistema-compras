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

  // Turno asignado en control de asistencia de la semana en curso
  let turno_asistencia = null;
  const today = nowMxDate();
  const td = new Date(today + 'T12:00:00');
  const dow = td.getDay();
  const monday = new Date(td);
  monday.setDate(td.getDate() - (dow === 0 ? 6 : dow - 1));
  const weekStart = monday.toISOString().slice(0, 10);
  const weekRols = (db.rhh_weekly_rol || []).filter(r => r.week_start === weekStart && r.shift_id != null);
  const weekRolIds = new Set(weekRols.map(r => r.id));
  const myAssign = (db.rhh_rol_assignments || []).find(a => weekRolIds.has(a.rol_id) && a.employee_id === emp.id);
  if (myAssign) {
    const rolShift = weekRols.find(r => r.id === myAssign.rol_id);
    if (rolShift) {
      const s = (db.rhh_shifts || []).find(s => s.id === rolShift.shift_id);
      if (s) turno_asistencia = s.name;
    }
  }

  return {
    id: emp.id,
    employee_number: emp.employee_number,
    full_name: emp.full_name,
    email: emp.email,
    phone: emp.phone,
    department: dept ? dept.name : null,
    position: pos ? pos.name : null,
    shift: shift ? shift.name : null,
    turno_asistencia,
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
  const movimientos = [];
  for (const d of (db.rhh_txt_deudas || []).filter(d => d.employee_id === empId)) {
    movimientos.push({
      id: `txt-deuda-${d.id}`,
      date: d.origen_fecha,
      type: 'txt_deuda',
      title: 'Tiempo por Tiempo',
      detail: `Deuda original: ${d.horas_deuda_original || 0} h · saldo: ${d.horas_pendientes || 0} h`,
      status: d.status,
    });
  }
  for (const p of (db.rhh_txt_pagos || []).filter(p => p.employee_id === empId)) {
    const applications = Array.isArray(p.aplicaciones) && p.aplicaciones.length
      ? p.aplicaciones
      : [{ deuda_id: p.deuda_id, horas: p.horas_aplicadas }];
    const originDetail = applications.map(a => {
      const deuda = (db.rhh_txt_deudas || []).find(d => Number(d.id) === Number(a.deuda_id));
      return deuda?.origen_fecha ? `${a.horas || 0} h a cuenta de la ${deuda.origen_tipo === 'turno_incompleto' ? 'jornada incompleta' : 'falta'} del ${deuda.origen_fecha}` : null;
    }).filter(Boolean).join(' · ');
    const workedHours = Number(p.horas_trabajadas) || (Number(p.horas_aplicadas) || 0) + (Number(p.horas_extra_sobrante) || 0);
    movimientos.push({
      id: `txt-pago-${p.id}`,
      date: p.fecha_pago,
      type: 'txt_pago',
      title: p.status === 'anulado' ? 'Pago TXT anulado' : 'TXT pagado',
      detail: `${workedHours} h trabajadas${originDetail ? ` · ${originDetail}` : ''}${p.horas_extra_sobrante ? ` · ${p.horas_extra_sobrante} h enviadas a autorización como TE` : ''}${p.status === 'anulado' && p.motivo_anulacion ? ` · Motivo: ${p.motivo_anulacion}` : ''}`,
      status: p.status === 'anulado' ? 'anulado' : 'registrado',
    });
  }
  for (const b of (db.rhh_bono_vales || []).filter(b => b.employee_id === empId)) {
    movimientos.push({
      id: `bono-${b.id}`,
      date: b.fecha,
      type: 'bono',
      title: b.bono_type === 'limpieza' ? 'Bono Limpieza' : 'Bono Encendido de Resistencias',
      detail: 'Solicitud generada desde Control de Asistencias',
      status: b.status,
    });
  }
  for (const c of (db.rhh_cumpleanos_incidencias || []).filter(c =>
    c.employee_id === empId && (
      c.laboro || c.status === 'gratificacion_programada' || c.status === 'bloqueado_festivo'
    )
  )) {
    const bloqueadoFestivo = c.status === 'bloqueado_festivo';
    const gratificacionDomingo = c.status === 'gratificacion_programada' && !c.laboro;
    movimientos.push({
      id: `cumple-${c.id}`,
      date: c.birth_date_match,
      type: bloqueadoFestivo
        ? 'cumpleanos_festivo'
        : (gratificacionDomingo ? 'gratificacion_cumpleanos' : 'cumpleanos_laborado'),
      title: bloqueadoFestivo
        ? 'Cumpleaños en día festivo'
        : (gratificacionDomingo ? 'Gratificación de cumpleaños' : 'Cumpleaños laborado'),
      detail: bloqueadoFestivo
        ? 'No labora y no acumula gratificación de cumpleaños con el festivo'
        : (c.semana_pago ? `Gratificación programada para la semana ${c.semana_pago}` : 'Registrado'),
      status: c.status,
    });
  }
  movimientos.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  res.json({ rows, vac_info, movimientos });
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

  // Preferir la semana mas reciente que tenga percepciones (datos PDF),
  // si no hay ninguna con PDF, usar la mas reciente con datos
  const all = (db.rhh_incidencias_semanales || [])
    .filter(r => r.employee_id === req.empPayload.sub)
    .sort((a, b) => b.no_periodo - a.no_periodo);
  let row = all.find(r => r.percepciones && Object.keys(r.percepciones).length > 0) || all[0] || null;

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

// ── GET /api/empleados/mi-rol — asistencia de la semana en curso ─────────────
router.get('/mi-rol', empAuthRequired, (req, res) => {
  const db = read();
  const empId = req.empPayload.sub;
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const today = nowMxDate();
  const td = new Date(today + 'T12:00:00');
  const dow = td.getDay();
  const monday = new Date(td);
  monday.setDate(td.getDate() - (dow === 0 ? 6 : dow - 1));
  const weekStart = monday.toISOString().slice(0, 10);

  const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
  const shifts = db.rhh_shifts || [];
  const shift = shifts.find(s => s.id === emp.shift_id) || null;
  const workDays = shift && Array.isArray(shift.work_days) ? shift.work_days : [];
  const holidays = db.rhh_holidays || [];
  const attendance = db.rhh_attendance || [];
  const incidences = db.rhh_incidences || [];
  const txtPagos = (db.rhh_txt_pagos || []).filter(p => p.status !== 'anulado');
  const txtDeudas = db.rhh_txt_deudas || [];
  const bonoVales = db.rhh_bono_vales || [];
  const cumpleIncs = db.rhh_cumpleanos_incidencias || [];
  const vacSols = (db.rhh_vac_solicitudes || []).filter(v =>
    v.employee_id === empId && v.estado === 'aprobada' && v.fecha_inicio && v.fecha_fin
  );

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay();
    const isFuture = dateStr > today;
    const holiday = holidays.find(h => h.date === dateStr);

    let status = 'pendiente';
    let te_hours = 0;
    let notes = null;

    // Base status from shift
    if (shift && !isFuture) {
      if (holiday) status = 'festivo';
      else if (workDays.includes(dayOfWeek)) status = 'labora';
      else status = 'descanso';
    } else if (isFuture) {
      if (holiday) status = 'festivo';
      else if (workDays.includes(dayOfWeek)) status = 'programado';
      else status = 'descanso';
    }

    // Attendance record overrides (campo fecha + incidencia_type de rhh-asistencia)
    const att = attendance.find(a => a.employee_id === empId && (a.fecha === dateStr || a.date === dateStr));
    if (att) {
      status = att.incidencia_type || att.status || status;
      te_hours = att.te_horas || att.te_hours || 0;
      notes = att.notas || att.notes || null;
    }

    // Incidences override
    const covering = incidences.filter(inc =>
      inc.employee_id === empId && inc.status === 'aprobada' &&
      inc.date <= dateStr && (inc.date_end || inc.date) >= dateStr
    );
    if (covering.length > 0) {
      const inc = covering[covering.length - 1];
      if (inc.type === 'vacacion') status = 'vacacion';
      else if (inc.type === 'incapacidad') status = 'incapacidad';
      else if (inc.type === 'permiso' || inc.type === 'permiso_con_goce' || inc.type === 'permiso_sin_goce') status = 'permiso';
      else if (inc.type === 'falta') status = 'falta';
      else if (inc.type === 'retardo') status = 'retardo';
    }

    // Vacation solicitudes override
    const vacCovering = vacSols.find(v => dateStr >= v.fecha_inicio && dateStr <= v.fecha_fin);
    if (vacCovering && status !== 'vacacion') status = 'vacacion';

    // Birthday check
    let birthday = false;
    if (emp.birth_date && emp.birth_date.slice(5) === dateStr.slice(5)) birthday = true;

    const dayTxtPagos = txtPagos.filter(p => p.employee_id === empId && p.fecha_pago === dateStr);
    const txt_paid_hours = dayTxtPagos.reduce((sum, p) => sum + (Number(p.horas_trabajadas) || Number(p.horas_aplicadas) || 0), 0);
    const dayBonos = bonoVales.filter(b => b.employee_id === empId && b.fecha === dateStr);
    const cumpleRegistro = cumpleIncs.find(c => c.employee_id === empId && c.birth_date_match === dateStr);
    const cumpleLaborado = !!cumpleRegistro?.laboro;
    const gratificacionCumpleanos = cumpleRegistro?.status === 'gratificacion_programada';

    const originDebt = att ? txtDeudas.find(d => Number(d.origen_attendance_id) === Number(att.id) && d.status !== 'cancelado') : null;
    const originPaid = Number(originDebt?.horas_pagadas) || 0;
    const originPending = Number(originDebt?.horas_pendientes) || 0;
    const originTxtStatus = originDebt
      ? (originPending <= 0 ? 'pagado' : (originPaid > 0 ? 'parcial' : 'por_pagar'))
      : null;

    // Condiciones derivadas: la falta queda como antecedente; TXT liquidado se
    // presenta y contabiliza como día pagado/trabajado.
    if (birthday && holiday) status = 'festivo_cumpleanos_no_labora';
    else if (originTxtStatus) status = 'txt_por_pagar';
    else if (dayTxtPagos.length) status = 'txt_pagado';
    else if (holiday && att?.incidencia_type === 'labora') status = 'festivo_laborado';
    else if (cumpleLaborado) status = 'cumpleanos_laborado';
    else if (gratificacionCumpleanos) status = 'cumpleanos_gratificacion';

    // Pending clarification for this day
    const hasClarif = (db.rhh_attendance_clarifications || []).some(
      c => c.employee_id === empId && c.date === dateStr && c.status === 'pendiente'
    );

    days.push({
      date: dateStr,
      day_name: DAY_NAMES[dayOfWeek],
      day_num: d.getDate(),
      status,
      te_hours,
      notes,
      is_future: isFuture,
      is_holiday: !!holiday,
      holiday_name: holiday ? holiday.name : null,
      birthday,
      birthday_holiday_conflict: birthday && !!holiday,
      txt_paid_hours,
      txt_origin_status: originTxtStatus,
      txt_origin_paid_hours: originPaid,
      txt_origin_pending_hours: originPending,
      bonos: dayBonos.map(b => ({
        type: b.bono_type,
        status: b.status,
      })),
      has_clarification: hasClarif,
    });
  }

  const txt_pending_hours = txtDeudas
    .filter(d => d.employee_id === empId && d.status === 'pendiente_pago')
    .reduce((sum, d) => sum + (Number(d.horas_pendientes) || 0), 0);

  res.json({
    week_start: weekStart,
    shift_name: shift ? shift.name : null,
    txt_pending_hours,
    days,
  });
});

// ── POST /api/empleados/mi-rol/aclaracion — solicitar aclaracion por dia ─────
router.post('/mi-rol/aclaracion', empAuthRequired, (req, res) => {
  const { date, mensaje } = req.body || {};
  if (!date || !mensaje) return res.status(400).json({ error: 'Fecha y mensaje requeridos' });

  const db = read();
  if (!Array.isArray(db.rhh_attendance_clarifications)) db.rhh_attendance_clarifications = [];

  const dup = db.rhh_attendance_clarifications.find(
    c => c.employee_id === req.empPayload.sub && c.date === date && c.status === 'pendiente'
  );
  if (dup) return res.status(409).json({ error: 'Ya tienes una aclaracion pendiente para este dia' });

  const nId = (db.rhh_attendance_clarifications.reduce((m, c) => Math.max(m, c.id || 0), 0)) + 1;
  db.rhh_attendance_clarifications.push({
    id: nId,
    employee_id: req.empPayload.sub,
    date,
    mensaje: String(mensaje).trim().slice(0, 500),
    status: 'pendiente',
    created_at: nowMxDate(),
    respuesta: null,
    respondido_at: null,
  });
  write(db);
  res.json({ ok: true, id: nId });
});

// ── GET /api/empleados/vacaciones/calendario ─────────────────────────────────
// Datos para el calendario de vacaciones: festivos, cumpleaños, solicitudes previas
router.get('/vacaciones/calendario', empAuthRequired, (req, res) => {
  const db = read();
  const emp = (db.rhh_employees || []).find(e => e.id === req.empPayload.sub);
  const holidays = (db.rhh_holidays || []).map(h => ({ date: h.date, name: h.name }));
  const birth_date = emp?.birth_date || null;
  const vacInfo = emp ? calcVacInfo(emp, db, nowMxDate()) : {};
  const solicitudes = (db.rhh_vac_solicitudes || [])
    .filter(r => r.employee_id === req.empPayload.sub
      && r.estado !== 'rechazada'
      && r.estado !== 'cancelada'
      && r.cambio_solicitado !== 'cancelacion')
    .map(r => ({ fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin, estado: r.estado }));
  res.json({ holidays, birth_date, vac_info: vacInfo, solicitudes });
});

// ── GET /api/empleados/vacaciones ─────────────────────────────────────────────
router.get('/vacaciones', empAuthRequired, (req, res) => {
  const db = read();
  const rows = (db.rhh_vac_solicitudes || [])
    .filter(r => r.employee_id === req.empPayload.sub)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  // Mapear campos para compatibilidad con frontend portal
  const mapped = rows.map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    fecha_inicio: r.fecha_inicio || null,
    fecha_fin: r.fecha_fin || null,
    dias: r.dias,
    motivo: r.notas || r.motivo || null,
    status: r.estado === 'aprobada' ? 'aprobado' : r.estado === 'rechazada' ? 'rechazado' : r.estado === 'cancelada' ? 'cancelado' : 'pendiente',
    created_at: r.created_at,
    notas_rh: r.notas_respuesta || null,
    no_periodo: r.no_periodo,
    cambio_solicitado: r.cambio_solicitado || null,
    cambio_motivo: r.cambio_motivo || null,
    cambio_respuesta: r.cambio_respuesta || null,
  }));
  res.json(mapped);
});

// ── POST /api/empleados/vacaciones ────────────────────────────────────────────
router.post('/vacaciones', empAuthRequired, (req, res) => {
  const { fecha_inicio, fecha_fin, motivo } = req.body || {};
  if (!fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Fechas requeridas' });

  const d1 = new Date(fecha_inicio + 'T12:00:00');
  const d2 = new Date(fecha_fin + 'T12:00:00');
  if (isNaN(d1) || isNaN(d2) || d2 < d1) return res.status(400).json({ error: 'Rango de fechas inválido' });

  const db  = read();
  const emp = (db.rhh_employees || []).find(e => e.id === req.empPayload.sub);

  // Calcular dias efectivos de vacaciones (excluir domingos, festivos, cumpleaños)
  const holidayDates = new Set((db.rhh_holidays || []).map(h => h.date));
  const birthMD = emp?.birth_date ? emp.birth_date.slice(5) : null; // MM-DD
  let diasVac = 0, diasFestivo = 0, diasDescanso = 0, diasCumple = 0;
  const totalNatural = Math.round((d2 - d1) / 86400000) + 1;
  for (let i = 0; i < totalNatural; i++) {
    const dt = new Date(d1.getTime() + i * 86400000);
    const iso = dt.toISOString().slice(0, 10);
    const dow = dt.getDay(); // 0=domingo
    const md = iso.slice(5); // MM-DD
    if (dow === 0) { diasDescanso++; }
    else if (holidayDates.has(iso)) { diasFestivo++; }
    else if (birthMD && md === birthMD) { diasCumple++; }
    else { diasVac++; }
  }

  // Validar días disponibles (solo dias efectivos de vacaciones)
  if (emp) {
    const vacInfo = calcVacInfo(emp, db, nowMxDate());
    if (!vacInfo.elegible) {
      return res.status(400).json({ error: 'Aun no tienes dias de vacaciones disponibles para este año.' });
    }
    if (diasVac > vacInfo.dias_restantes) {
      return res.status(400).json({
        error: `No tienes suficientes dias disponibles. Disponibles: ${vacInfo.dias_disponibles}, comprometidos: ${vacInfo.dias_programados}, restantes: ${vacInfo.dias_restantes}. Solicitas: ${diasVac} dias de vacaciones.`
      });
    }
  }

  // Reglas de anticipacion
  const todayStr = nowMxDate();
  const daysAhead = Math.floor((d1 - new Date(todayStr + 'T12:00:00')) / 86400000);
  if (diasVac <= 1 && daysAhead < 1) {
    return res.status(400).json({ error: 'Para solicitar 1 dia de vacaciones necesitas al menos 1 dia habil de anticipacion.' });
  }
  if (diasVac <= 3 && daysAhead < 7) {
    return res.status(400).json({ error: `Para solicitar ${diasVac} dias necesitas al menos 1 semana de anticipacion (${daysAhead} dias de anticipacion).` });
  }
  if (diasVac > 3 && daysAhead < 14) {
    return res.status(400).json({ error: `Para solicitar ${diasVac} dias necesitas al menos 2 semanas de anticipacion (${daysAhead} dias de anticipacion).` });
  }

  // Determinar periodo ISO de fecha_inicio
  const isoDate = new Date(fecha_inicio + 'T12:00:00');
  const dayOfWeek = isoDate.getUTCDay() || 7;
  const thursday = new Date(isoDate);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const no_periodo = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  const year = thursday.getUTCFullYear();

  if (!Array.isArray(db.rhh_vac_solicitudes)) db.rhh_vac_solicitudes = [];
  const lista = db.rhh_vac_solicitudes;
  const newId = (lista.reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1;
  const desglose = [];
  if (diasVac) desglose.push(`${diasVac} dia${diasVac>1?'s':''} vacaciones`);
  if (diasFestivo) desglose.push(`${diasFestivo} festivo${diasFestivo>1?'s':''}`);
  if (diasDescanso) desglose.push(`${diasDescanso} domingo${diasDescanso>1?'s':''}`);
  if (diasCumple) desglose.push(`${diasCumple} cumpleaños`);
  const record = {
    id: newId,
    employee_id: req.empPayload.sub,
    no_periodo,
    year,
    period_key: `${year}-W${String(no_periodo).padStart(2, '0')}`,
    dias: diasVac,
    dias_naturales: totalNatural,
    dias_festivo: diasFestivo,
    dias_descanso: diasDescanso,
    dias_cumple: diasCumple,
    desglose: desglose.join(' + '),
    fecha_inicio,
    fecha_fin,
    notas: String(motivo || '').trim().slice(0, 300) || null,
    estado: 'pendiente',
    origen: 'portal_empleado',
    autorizado_por: null,
    autorizado_at: null,
    created_by: null,
    created_at: nowMxDate(),
  };
  lista.push(record);
  write(db);
  res.json({ ok: true, id: newId, dias: diasVac, dias_naturales: totalNatural, desglose: desglose.join(' + ') });
});

// ── POST /api/empleados/vacaciones/cambio ─────────────────────────────────────
// Solicitar cambio o cancelación de vacaciones aprobadas
router.post('/vacaciones/cambio', empAuthRequired, (req, res) => {
  const { vacacion_id, tipo, motivo, nueva_fecha_inicio, nueva_fecha_fin } = req.body || {};
  if (!vacacion_id || !['modificacion', 'cancelacion'].includes(tipo)) {
    return res.status(400).json({ error: 'vacacion_id y tipo (modificacion|cancelacion) son requeridos' });
  }
  if (tipo === 'modificacion' && (!nueva_fecha_inicio || !nueva_fecha_fin)) {
    return res.status(400).json({ error: 'Debes indicar las nuevas fechas (nueva_fecha_inicio, nueva_fecha_fin)' });
  }
  const db = read();
  const sol = (db.rhh_vac_solicitudes || []).find(s =>
    s.id === Number(vacacion_id) && s.employee_id === req.empPayload.sub
  );
  if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (sol.estado !== 'aprobada') return res.status(400).json({ error: 'Solo puedes solicitar cambios en vacaciones aprobadas' });

  sol.cambio_solicitado = tipo;
  sol.cambio_motivo = String(motivo || '').trim().slice(0, 300);
  sol.cambio_fecha = nowMxDate();
  if (tipo === 'modificacion') {
    sol.cambio_nueva_fecha_inicio = nueva_fecha_inicio;
    sol.cambio_nueva_fecha_fin = nueva_fecha_fin;
  }

  write(db);
  res.json({ ok: true });
});

module.exports = router;
