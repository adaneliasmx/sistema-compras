const express = require('express');
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');
const { read, write, writeAsync, nextId, dbPath, seedPath, forceSeedFromJson, getSystemEmpIds } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function nowMxTs() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(' ', 'T');
}

function readFresh() { return read(); }

// ── Tabla LFT por defecto (si la BD no tiene reglas configuradas) ─────────────
const DEFAULT_LFT_RULES = [
  { years: 1,  dias: 12 },
  { years: 2,  dias: 14 },
  { years: 3,  dias: 16 },
  { years: 4,  dias: 18 },
  { years: 5,  dias: 20 },
  { years: 6,  dias: 22 },
  { years: 11, dias: 24 },
];

/**
 * Calcula información de vacaciones para un empleado.
 * @param {object} emp   - objeto empleado (con start_date, vac_dias_disponibles)
 * @param {object} db    - base de datos completa
 * @param {string} today - fecha actual 'YYYY-MM-DD'
 * @returns {{ elegible, ciclos, lft_dias, override_dias, dias_disponibles,
 *             dias_tomados, dias_programados, dias_restantes }}
 */
function calcVacInfo(emp, db, today) {
  const currentYear = new Date(today).getFullYear();
  const startDate   = emp.start_date || emp.fecha_ingreso || null;

  // Elegibilidad: ingresó antes del 1 de noviembre del año anterior
  let elegible = false;
  let ciclos   = 0;
  let lft_dias = 0;

  if (startDate) {
    let start;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(startDate)) {
      const [d, m, y] = startDate.split('/');
      start = new Date(`${y}-${m}-${d}T12:00:00`);
    } else {
      start = new Date(startDate + 'T12:00:00');
    }
    if (!isNaN(start.getTime())) {
      const startYear = start.getFullYear();
      const eligDeadline = new Date(currentYear - 1, 10, 1); // Nov 1 año anterior
      if (startYear < currentYear && start < eligDeadline) {
        elegible = true;
        ciclos   = currentYear - startYear;

        const rules = (db.rhh_lft_rules && db.rhh_lft_rules.length)
          ? [...db.rhh_lft_rules].sort((a, b) => a.years - b.years)
          : DEFAULT_LFT_RULES;

        for (const r of rules) {
          if (ciclos >= r.years) lft_dias = r.dias;
        }
      }
    }
  }

  // Override manual de RHH
  const override_dias     = emp.vac_dias_disponibles != null ? Number(emp.vac_dias_disponibles) : null;
  const dias_disponibles  = override_dias !== null ? override_dias : lft_dias;

  // Días tomados — única fuente: Consolidado CONTPAQ (vacaciones_dias en incidencias)
  // Usa fecha_inicio del propio registro para validar año, sin depender de rhh_periodos
  const incidencias = (db.rhh_incidencias_semanales || []).filter(i => i.employee_id === emp.id);
  const dias_tomados = incidencias.reduce((sum, inc) => {
    if (!inc.vacaciones_dias) return sum;
    const fechaRef = inc.fecha_inicio || null;
    if (fechaRef) {
      const yr = new Date(fechaRef + 'T12:00:00').getFullYear();
      return yr === currentYear ? sum + (Number(inc.vacaciones_dias) || 0) : sum;
    }
    // Sin fecha: incluir si no_periodo es válido (datos del año activo)
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

  return {
    elegible,
    ciclos,
    lft_dias,
    override_dias,
    dias_disponibles,
    dias_tomados,
    dias_programados,
    dias_restantes,
  };
}

/**
 * Inserta o acumula un candidato a baja en rhh_baja_candidatos.
 * Llave única: employee_id + detected_week + state='pending'.
 * Reglas: no crea candidato si emp es manual_baja_locked (excepto possible_rehire);
 *         no crea candidato si emp.status === 'inactive' (excepto possible_rehire);
 *         si ya existe pending con misma llave, solo agrega el reason (sin duplicados).
 */
function upsertBajaCandidato(db, emp, detectedWeek, reason, nowDate, nowTs) {
  if (!Array.isArray(db.rhh_baja_candidatos)) db.rhh_baja_candidatos = [];
  const isPossibleRehire = reason.type === 'possible_rehire';
  if (!isPossibleRehire && emp.manual_baja_locked) return;
  if (!isPossibleRehire && emp.status === 'inactive') return;

  const existing = db.rhh_baja_candidatos.find(c =>
    c.employee_id === emp.id && c.detected_week === detectedWeek && c.state === 'pending'
  );
  if (existing) {
    if (!existing.reasons.some(r => r.type === reason.type)) existing.reasons.push(reason);
  } else {
    db.rhh_baja_candidatos.push({
      id: nextId(db.rhh_baja_candidatos),
      employee_id:     emp.id,
      employee_name:   emp.full_name,
      employee_number: emp.employee_number,
      detected_week:   detectedWeek,
      detected_at:     nowTs,
      detected_by_import: true,
      reasons:         [reason],
      state:           'pending',
      confirmed_by:    null, confirmed_at:   null,
      dismissed_by:    null, dismissed_at:   null,
      superseded_at:   null, superseded_reason: null,
    });
  }
}

// ── GET /api/rhh/catalogo/diag ─── DIAGNÓSTICO PÚBLICO (sin auth) ─────────────
router.get('/diag', (req, res) => {
  const db = read();
  const emps = db.rhh_employees || [];
  const reales = emps.filter(e => {
    const num = String(e.employee_number || '').trim();
    return num.length >= 3 && /^\d+$/.test(num.replace(/^0+/, '') || '0');
  });
  res.json({
    seedPath,
    seedExists: fs.existsSync(seedPath),
    dbPath,
    totalEmpleados: emps.length,
    empleadosReales: reales.length,
    activos: reales.filter(e => e.status === 'active').length,
    primerEmp: reales[0] ? { id: reales[0].id, num: reales[0].employee_number, name: reales[0].full_name } : null,
  });
});

// ── POST /api/rhh/catalogo/force-seed ─── RESEED DESDE JSON (key simple) ──────
router.post('/force-seed', async (req, res) => {
  const { key } = req.query;
  const expectedKey = process.env.RHH_SEED_KEY || 'cuesto2026rhh';
  if (key !== expectedKey) return res.status(401).json({ error: 'key inválida' });
  try {
    const data = await forceSeedFromJson();
    const emps = data.rhh_employees || [];
    res.json({ ok: true, empleados: emps.length, activos: emps.filter(e => e.status === 'active').length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enriquece un empleado con datos de catálogos
function enrich(emp, db) {
  const dept  = (db.rhh_departments || []).find(d => d.id === emp.department_id);
  const pos   = (db.rhh_positions   || []).find(p => p.id === emp.position_id);
  const shift = (db.rhh_shifts      || []).find(s => s.id === emp.shift_id);
  return {
    ...emp,
    department_name: dept  ? dept.name  : null,
    position_name:   pos   ? pos.name   : null,
    shift_name:      shift ? shift.name : null,
    has_portal:      !!(emp.emp_login && (emp.emp_login.password || emp.emp_login.password_hash)),
    portal_username: emp.emp_login ? emp.emp_login.username : null,
  };
}

// ── GET /api/rhh/catalogo ──────────────────────────────────────────────────────
// Lista completa de empleados del catálogo (solo reales: employee_number numérico)
router.get('/', rhhAuthRequired, (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'No se pudo leer el catálogo de empleados' });

  const { status, search, depto } = req.query;

  let emps = (db.rhh_employees || [])
    .filter(e => {
      // Filtrar fantasmas: solo empleados con número de nómina válido (>= 3 chars)
      const num = String(e.employee_number || '').trim();
      return num.length >= 3 && /^\d+$/.test(num.replace(/^0+/, '') || '0');
    });

  if (status && status !== 'all') {
    emps = emps.filter(e => e.status === status);
  }
  if (depto) {
    emps = emps.filter(e => e.department_id === Number(depto));
  }
  if (search) {
    const q = search.toLowerCase();
    emps = emps.filter(e =>
      (e.full_name || '').toLowerCase().includes(q) ||
      (e.employee_number || '').includes(q)
    );
  }

  emps = emps.sort((a, b) =>
    String(a.employee_number).localeCompare(String(b.employee_number), undefined, { numeric: true })
  );

  res.json({
    employees: emps.map(e => enrich(e, db)),
    total: emps.length,
    departments: db.rhh_departments || [],
    positions:   db.rhh_positions   || [],
    shifts:      db.rhh_shifts      || [],
  });
});

// ── GET /api/rhh/catalogo/baja-candidatos ─────────────────────────────────────
router.get('/baja-candidatos', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  if (!Array.isArray(db.rhh_baja_candidatos)) db.rhh_baja_candidatos = [];
  const { state } = req.query;
  let list = db.rhh_baja_candidatos;
  if (state) list = list.filter(c => c.state === state);
  res.json({ candidatos: list, total: list.length });
});

// ── POST /api/rhh/catalogo/baja-candidatos/:id/confirm ────────────────────────
router.post('/baja-candidatos/:id/confirm', rhhAuthRequired, rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = readFresh();
  if (!Array.isArray(db.rhh_baja_candidatos)) db.rhh_baja_candidatos = [];

  const cand = db.rhh_baja_candidatos.find(c => c.id === Number(req.params.id));
  if (!cand) return res.status(404).json({ error: 'Candidato no encontrado' });
  if (cand.state !== 'pending') return res.status(400).json({ error: `Candidato ya en estado: ${cand.state}` });

  const emp = (db.rhh_employees || []).find(e => e.id === cand.employee_id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const user  = req.rhhUser?.email || req.rhhUser?.username || 'rh';
  const nowD  = nowMxDate();
  const nowTs = nowMxTs();

  // Actualizar empleado
  emp.status                = 'inactive';
  emp.manual_baja_locked    = true;
  emp.status_source         = 'confirmed';
  emp.fecha_baja            = nowD;
  emp.baja_semana_efectiva  = String(cand.detected_week);
  emp.baja_motivo           = req.body?.motivo || null;
  emp.baja_confirmada_por   = user;
  emp.baja_confirmada_at    = nowTs;
  emp.updated_at            = nowD;

  // Actualizar candidato (misma escritura)
  cand.state        = 'confirmed';
  cand.confirmed_by = user;
  cand.confirmed_at = nowTs;

  try {
    await writeAsync(db);
    res.json({ ok: true, candidato: cand, employee: enrich(emp, db) });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
  }
});

// ── POST /api/rhh/catalogo/baja-candidatos/:id/dismiss ────────────────────────
router.post('/baja-candidatos/:id/dismiss', rhhAuthRequired, rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = readFresh();
  if (!Array.isArray(db.rhh_baja_candidatos)) db.rhh_baja_candidatos = [];

  const cand = db.rhh_baja_candidatos.find(c => c.id === Number(req.params.id));
  if (!cand) return res.status(404).json({ error: 'Candidato no encontrado' });
  if (cand.state !== 'pending') return res.status(400).json({ error: `Candidato ya en estado: ${cand.state}` });

  const user  = req.rhhUser?.email || req.rhhUser?.username || 'rh';
  const nowTs = nowMxTs();

  cand.state         = 'dismissed';
  cand.dismissed_by  = user;
  cand.dismissed_at  = nowTs;
  cand.dismiss_motivo = req.body?.motivo || null;

  try {
    await writeAsync(db);
    res.json({ ok: true, candidato: cand });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
  }
});

// ── POST /api/rhh/catalogo/employees/:id/reactivate ──────────────────────────
router.post('/employees/:id/reactivate', rhhAuthRequired, rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = readFresh();
  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const user  = req.rhhUser?.email || req.rhhUser?.username || 'rh';
  const nowD  = nowMxDate();
  const nowTs = nowMxTs();

  emp.status               = 'active';
  emp.manual_baja_locked   = false;
  emp.status_source        = 'manual';
  emp.fecha_baja           = null;
  emp.baja_semana_efectiva = null;
  emp.baja_motivo          = null;
  emp.baja_confirmada_por  = null;
  emp.baja_confirmada_at   = null;
  emp.fecha_reingreso      = nowD;
  emp.reingreso_por        = user;
  emp.updated_at           = nowD;

  // Cerrar candidatos pending/superseded de este empleado
  if (Array.isArray(db.rhh_baja_candidatos)) {
    for (const c of db.rhh_baja_candidatos) {
      if (c.employee_id === emp.id && (c.state === 'pending' || c.state === 'superseded')) {
        c.state         = 'dismissed';
        c.dismissed_by  = user;
        c.dismissed_at  = nowTs;
        c.dismiss_motivo = 'reingreso confirmado';
      }
    }
  }

  try {
    await writeAsync(db);
    res.json({ ok: true, employee: enrich(emp, db) });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
  }
});

// ── GET /api/rhh/catalogo/:id ─────────────────────────────────────────────────
router.get('/:id', rhhAuthRequired, (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const enriched = enrich(emp, db);

  // Historial de incidencias semanales
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
  const periodos = (db.rhh_periodos && db.rhh_periodos.length) ? db.rhh_periodos : PERIODOS_2026;

  const incidencias = (db.rhh_incidencias_semanales || [])
    .filter(r => r.employee_id === emp.id)
    .sort((a, b) => b.no_periodo - a.no_periodo)
    .map(r => {
      const p = periodos.find(p => p.no_periodo === r.no_periodo) || {};
      return { ...r, fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin };
    });

  const aclaraciones = (db.rhh_payroll_clarifications || [])
    .filter(r => r.employee_id === emp.id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const vacaciones = (db.rhh_vacation_requests || [])
    .filter(r => r.employee_id === emp.id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const evaluaciones = (db.rhh_evaluations || [])
    .filter(r => r.employee_id === emp.id);

  const vac_info = calcVacInfo(emp, db, nowMxDate());

  res.json({
    employee:    enriched,
    incidencias,
    aclaraciones,
    vacaciones,
    evaluaciones,
    vac_info,
    departments: db.rhh_departments || [],
    positions:   db.rhh_positions   || [],
    shifts:      db.rhh_shifts      || [],
  });
});

// ── PATCH /api/rhh/catalogo/:id/credenciales ──────────────────────────────────
// Resetear credenciales del portal del empleado
router.patch('/:id/credenciales', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  if (!emp.emp_login) return res.status(400).json({ error: 'Empleado sin credenciales configuradas' });

  // Resetear a contraseña inicial
  const curp = String(emp.curp || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const pass = curp.slice(-6);
  if (!pass || pass.length < 4) return res.status(400).json({ error: 'CURP no disponible para generar contraseña' });

  emp.emp_login.password = pass;
  delete emp.emp_login.password_hash;
  emp.emp_login.must_change = true;
  emp.updated_at = nowMxDate();

  write(db);
  res.json({ ok: true, username: emp.emp_login.username, password: pass });
});

// ── PATCH /api/rhh/catalogo/:id/aclaracion/:acid ─────────────────────────────
// Responder aclaración de nómina
router.patch('/:id/aclaracion/:acid', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const { respuesta, status } = req.body || {};
  const acl = (db.rhh_payroll_clarifications || []).find(c =>
    c.employee_id === Number(req.params.id) && c.id === Number(req.params.acid)
  );
  if (!acl) return res.status(404).json({ error: 'Aclaración no encontrada' });

  acl.respuesta    = respuesta || acl.respuesta;
  acl.status       = status || 'respondido';
  acl.respondido_at = nowMxDate();

  write(db);
  res.json({ ok: true });
});

// ── PATCH /api/rhh/catalogo/vacaciones/:vid ───────────────────────────────────
// Aprobar/rechazar solicitud de vacaciones
router.patch('/vacaciones/:vid', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const { status, notas_rh } = req.body || {};
  const vac = (db.rhh_vacation_requests || []).find(v => v.id === Number(req.params.vid));
  if (!vac) return res.status(404).json({ error: 'Solicitud no encontrada' });

  vac.status      = status || 'aprobado';
  vac.notas_rh    = notas_rh || null;
  vac.reviewed_at = nowMxDate();

  write(db);
  res.json({ ok: true });
});

// ── PATCH /api/rhh/catalogo/:id/info ──────────────────────────────────────────
// Actualizar dept/puesto/turno/status de un empleado individual
router.patch('/:id/info', rhhAuthRequired, rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const { department_id, position_id, shift_id, status, phone, email, start_date, salary_daily, vac_dias_disponibles, fecha_baja, fecha_alta, motivo_baja } = req.body || {};
  if (department_id          !== undefined) { emp.department_id = department_id ? Number(department_id) : null; emp.manual_department_locked = true; }
  if (position_id            !== undefined) { emp.position_id   = position_id   ? Number(position_id)   : null; emp.manual_position_locked   = true; }
  if (shift_id               !== undefined) emp.shift_id               = shift_id      ? Number(shift_id)      : null;
  if (status                 !== undefined) {
    emp.status = status;
    if (status === 'inactive') {
      emp.manual_baja_locked = true;
      emp.status_source      = 'manual';
      if (!emp.fecha_baja) emp.fecha_baja = nowMxDate();
    } else if (status === 'active') {
      emp.manual_baja_locked = false;
      emp.status_source      = 'manual';
    }
  }
  if (phone                  !== undefined) emp.phone                  = phone   || null;
  if (email                  !== undefined) emp.email                  = email   || null;
  if (start_date             !== undefined) emp.start_date             = start_date || null;
  if (salary_daily           !== undefined) emp.salary_daily           = salary_daily ? Number(salary_daily) : null;
  if (vac_dias_disponibles   !== undefined) emp.vac_dias_disponibles   = vac_dias_disponibles !== null && vac_dias_disponibles !== '' ? Number(vac_dias_disponibles) : null;
  if (fecha_baja             !== undefined) emp.fecha_baja             = fecha_baja  || null;
  if (fecha_alta             !== undefined) emp.fecha_alta             = fecha_alta  || null;
  if (motivo_baja            !== undefined) emp.motivo_baja            = motivo_baja || null;
  emp.updated_at = nowMxDate();

  try {
    await writeAsync(db);
    res.json({ ok: true, employee: enrich(emp, db) });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar: ' + e.message });
  }
});

// ── GET /api/rhh/catalogo/lft-rules ──────────────────────────────────────────
router.get('/lft-rules', rhhAuthRequired, (req, res) => {
  const db = read();
  const rules = (db.rhh_lft_rules && db.rhh_lft_rules.length) ? db.rhh_lft_rules : DEFAULT_LFT_RULES;
  res.json(rules);
});

// ── PATCH /api/rhh/catalogo/lft-rules — reemplaza toda la tabla ──────────────
router.patch('/lft-rules', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const { rules } = req.body || {};
  if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules[] requerido' });
  const db = read();
  db.rhh_lft_rules = rules.map(r => ({ years: Number(r.years), dias: Number(r.dias) }))
    .filter(r => r.years > 0 && r.dias > 0)
    .sort((a, b) => a.years - b.years);
  write(db);
  res.json(db.rhh_lft_rules);
});

// ── POST /api/rhh/catalogo/import-contpaq ─────────────────────────────────────
// Soporta dos formatos:
//
// 1. CONSOLIDADO (CONSOLIDADO_Listas_Raya_2026.xlsx — hoja "Consolidado"):
//    Detección: col 0 = "semana", col 3 = "No. Empleado", cols con "P | " y "D | "
//    - Una fila por empleado por semana; importa incidencias + percepciones + deducciones
//    - Actualiza dept, puesto, sal_diario, SDI, SBC, fecha_ingreso del empleado
//
// 2. LISTA ASISTENCIA (lista asistencia semana X.xlsx):
//    Detección: cols con "Asistencia"/"T.E." en encabezados, semana en nombre hoja
//    - Calcula dias_pagados/faltas/horas_extra desde los status del día
//
// Devuelve: { formato, updated, created_depts, created_pos, inc_upserted, semanas, skipped, log }
router.post(
  '/import-contpaq',
  rhhAuthRequired,
  rhhRequireRole('admin', 'rh'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (e) {
      return res.status(400).json({ error: 'Archivo no válido: ' + e.message });
    }

    const norm     = v => String(v || '').trim();
    const normName = s => s.toLowerCase().replace(/\*/g, '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const toNum    = v => { const n = parseFloat(String(v || '').replace(/,/g, '')); return isNaN(n) ? null : n; };

    // Buscar la hoja "Consolidado" por nombre; si no existe, usar la primera hoja
    const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('consolidado')) || wb.SheetNames[0];
    const ws  = wb.Sheets[sheetName];
    const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (all.length < 2) return res.status(400).json({ error: 'El archivo no tiene datos' });

    // Detectar formato: CONSOLIDADO vs LISTA ASISTENCIA
    const hdrs = all[0].map(v => norm(v).toLowerCase());
    const isConsolidado = hdrs[0] === 'semana' &&
      all[0].some(v => String(v).startsWith('P | ') || String(v).startsWith('P(info) | '));
    console.log('[import-contpaq] hojas disponibles:', wb.SheetNames, '| hoja seleccionada:', sheetName, '| filas:', all.length, '| hdr[0]:', JSON.stringify(all[0][0]), '| isConsolidado:', isConsolidado);

    const db = readFresh();
    const emps = db.rhh_employees || [];
    if (!Array.isArray(db.rhh_incidencias_semanales)) db.rhh_incidencias_semanales = [];
    if (!Array.isArray(db.rhh_baja_candidatos))       db.rhh_baja_candidatos = [];

    let updated = 0, skipped = 0, created_depts = 0, created_pos = 0, inc_upserted = 0;
    const semanasImportadas = new Set();
    const log = [];
    const nuevos = [];
    const aguinaldo_no_dic = [];
    const empEncontradosPorSemana = new Map(); // semana → Set<empId>
    const MES_MESES = { Ene:1, Feb:2, Mar:3, Abr:4, May:5, Jun:6, Jul:7, Ago:8, Sep:9, Oct:10, Nov:11, Dic:12 };

    function findEmpByNum(num) {
      const n = norm(num).replace(/^0+/, '');
      return emps.find(e => norm(e.employee_number || '').replace(/^0+/, '') === n) || null;
    }

    function findEmpByNameOrNum(excelNum, excelName) {
      const byNum = findEmpByNum(excelNum);
      if (byNum) return byNum;
      const excelWords = new Set(normName(excelName).split(' ').filter(w => w.length > 1));
      if (excelWords.size < 2) return null;
      let bestMatch = null, bestScore = 0;
      for (const e of emps) {
        const dbWords = normName(e.full_name || '').split(' ').filter(w => w.length > 1);
        let hits = 0;
        for (const w of excelWords) { if (dbWords.includes(w)) hits++; }
        const score = hits / excelWords.size;
        if (score > bestScore && score >= 0.75) { bestScore = score; bestMatch = e; }
      }
      return bestMatch;
    }

    function findOrCreateDept(name) {
      if (!name) return null;
      const n = norm(name);
      let d = (db.rhh_departments || []).find(x => norm(x.name).toLowerCase() === n.toLowerCase());
      if (!d) {
        d = { id: nextId(db.rhh_departments), name: n, description: '', created_at: nowMxDate() };
        db.rhh_departments = [...(db.rhh_departments || []), d];
        created_depts++;
      }
      return d.id;
    }

    function findOrCreatePos(name, deptId) {
      if (!name) return null;
      const n = norm(name);
      let p = (db.rhh_positions || []).find(x => norm(x.name).toLowerCase() === n.toLowerCase());
      if (!p) {
        p = { id: nextId(db.rhh_positions), name: n, department_id: deptId || null, description: '', created_at: nowMxDate() };
        db.rhh_positions = [...(db.rhh_positions || []), p];
        created_pos++;
      }
      return p.id;
    }

    function upsertIncidencia(emp, noPeriodo, rec) {
      const incList = db.rhh_incidencias_semanales;
      const existIdx = incList.findIndex(r => r.employee_id === emp.id && r.no_periodo === noPeriodo);
      if (existIdx !== -1) {
        incList[existIdx] = { ...incList[existIdx], ...rec, updated_at: nowMxDate() };
      } else {
        incList.push({ id: nextId(incList), employee_id: emp.id, no_periodo: noPeriodo,
                       faltas: 0, notas: '', created_at: nowMxDate(), ...rec });
      }
      inc_upserted++;
      semanasImportadas.add(noPeriodo);
    }

    // ── FORMATO CONSOLIDADO ──────────────────────────────────────────────────
    if (isConsolidado) {
      // Mapear índices de columnas desde los encabezados
      const hdrRaw = all[0];
      const colIdx = {};
      hdrRaw.forEach((v, i) => { colIdx[norm(v)] = i; });

      const semanaCol   = colIdx['semana']        ?? 0;
      const empNumCol   = colIdx['No. Empleado']  ?? 3;
      const nombreCol   = colIdx['Nombre']        ?? 4;
      const deptCol     = colIdx['Departamento']  ?? 5;
      const puestoCol   = colIdx['Puesto']        ?? 6;
      const salDiarioCol= colIdx['Sal. Diario']   ?? 11;
      const sdiCol      = colIdx['SDI']           ?? 12;
      const sbcCol      = colIdx['SBC']           ?? 13;
      const fechaIngCol = colIdx['Fecha Ingreso'] ?? 10;
      const diasPagCol  = colIdx['Días Pagados']  ?? 15;
      const hrsExtCol   = colIdx['Hrs. Extras']   ?? 17;
      const notasCol    = colIdx['Notas']         ?? 18;

      // Detectar columnas de percepciones (P |) y deducciones (D |)
      const percCols = []; // { col, label }
      const dedCols  = [];
      hdrRaw.forEach((v, i) => {
        const s = norm(v);
        if (s.startsWith('P | ') || s.startsWith('P(info) | ')) percCols.push({ col: i, label: s.replace(/^P\(info\) \| /, '').replace(/^P \| /, '') });
        else if (s.startsWith('D | ') || s.startsWith('D(info) | ')) dedCols.push({ col: i, label: s.replace(/^D\(info\) \| /, '').replace(/^D \| /, '') });
      });
      const totalPercCol = hdrRaw.findIndex(v => norm(v).toLowerCase().includes('total percepciones'));
      const totalDedCol  = hdrRaw.findIndex(v => norm(v).toLowerCase().includes('total deducciones'));
      const netoCol      = hdrRaw.findIndex(v => norm(v).toLowerCase().includes('neto a pagar'));

      // Opcional: filtrar por semana específica si se pasó en body
      const filterSemana = Number(req.body?.no_periodo) || null;

      for (const row of all.slice(1)) {
        const semana = Number(row[semanaCol]);
        if (!semana) continue;
        if (filterSemana && semana !== filterSemana) continue;

        const empNumRaw = norm(row[empNumCol]);
        const empName   = norm(row[nombreCol]);
        if (!empNumRaw && !empName) { skipped++; continue; }

        let emp = findEmpByNum(empNumRaw) || findEmpByNameOrNum(empNumRaw, empName);
        if (!emp && empNumRaw) {
          // Nuevo empleado — crear registro mínimo y agregarlo al catálogo
          const dNom = norm(row[deptCol]);
          const pNom = norm(row[puestoCol]);
          const dId2 = findOrCreateDept(dNom);
          const pId2 = findOrCreatePos(pNom, dId2);
          emp = {
            id: nextId(db.rhh_employees),
            employee_number: empNumRaw,
            full_name: empName,
            status: 'active',
            department_id: dId2,
            position_id: pId2,
            sal_diario: toNum(row[salDiarioCol]),
            salary_daily: toNum(row[salDiarioCol]),
            sdi: toNum(row[sdiCol]),
            sbc: toNum(row[sbcCol]),
            fecha_ingreso: norm(row[fechaIngCol]),
            fecha_alta: nowMxDate(),
            created_at: nowMxDate(),
            updated_at: nowMxDate(),
          };
          db.rhh_employees.push(emp);
          nuevos.push({ id: emp.id, employee_number: empNumRaw, full_name: empName });
          updated++;
          if (log.length < 20) log.push(`S${semana} #${empNumRaw} "${empName}": nuevo empleado creado`);
        } else if (!emp) {
          skipped++;
          if (log.length < 20) log.push(`S${semana} #${empNumRaw} "${empName}": no encontrado`);
          continue;
        }

        // Registrar presencia en esta semana
        if (!empEncontradosPorSemana.has(semana)) empEncontradosPorSemana.set(semana, new Set());
        empEncontradosPorSemana.get(semana).add(emp.id);

        // Actualizar campos del empleado
        const deptName   = norm(row[deptCol]);
        const posName    = norm(row[puestoCol]);
        const salDiario  = toNum(row[salDiarioCol]);
        const sdi        = toNum(row[sdiCol]);
        const sbc        = toNum(row[sbcCol]);
        const fechaIngr  = norm(row[fechaIngCol]);
        let empChanged = false;

        const deptId = findOrCreateDept(deptName);
        const posId  = findOrCreatePos(posName, deptId);
        if (emp.department_id !== deptId) { emp.department_id = deptId; empChanged = true; }
        if (emp.position_id   !== posId)  { emp.position_id   = posId;  empChanged = true; }
        if (salDiario && emp.sal_diario !== salDiario) { emp.sal_diario = salDiario; emp.salary_daily = salDiario; empChanged = true; }
        if (sdi && emp.sdi !== sdi) { emp.sdi = sdi; empChanged = true; }
        if (sbc && emp.sbc !== sbc) { emp.sbc = sbc; empChanged = true; }
        if (fechaIngr && emp.fecha_ingreso !== fechaIngr) { emp.fecha_ingreso = fechaIngr; empChanged = true; }
        // NO reactivar empleados inactivos: si tiene manual_baja_locked se detecta como possible_rehire
        if (empChanged) { emp.updated_at = nowMxDate(); updated++; }

        // Construir objetos percepciones y deducciones
        const percepciones = {};
        for (const { col, label } of percCols) {
          const v = toNum(row[col]);
          if (v !== null && v !== 0) percepciones[label] = v;
        }
        const deducciones = {};
        for (const { col, label } of dedCols) {
          const v = toNum(row[col]);
          if (v !== null && v !== 0) deducciones[label] = v;
        }

        const diasPag   = toNum(row[diasPagCol]) ?? 7;
        const hrsExtra  = toNum(row[hrsExtCol])  ?? 0;
        const totalPerc = totalPercCol >= 0 ? toNum(row[totalPercCol]) : null;
        const totalDed  = totalDedCol  >= 0 ? toNum(row[totalDedCol])  : null;
        const neto      = netoCol      >= 0 ? toNum(row[netoCol])      : null;
        const notas     = norm(row[notasCol]);

        // Calcular días de vacaciones: importe P|19 / salario diario
        const vacImporte = toNum(row[hdrRaw.findIndex(v => String(v).includes('19 Vacaciones'))]);
        const sdLocal    = salDiario || emp.sal_diario || emp.salary_daily || 0;
        const vacDias    = (vacImporte && sdLocal) ? Math.round(vacImporte / sdLocal) : null;

        // Prima dominical: si P|10 > 0
        const primaDomCol = hdrRaw.findIndex(v => String(v).includes('10 Prima dominical'));
        const primaDom = primaDomCol >= 0 && toNum(row[primaDomCol]) > 0 ? 1 : 0;

        // Despensa: si P|32 > 0
        const despensaCol = hdrRaw.findIndex(v => String(v).includes('32 Despensa'));
        const despensa = despensaCol >= 0 && toNum(row[despensaCol]) > 0 ? 1 : 0;

        // Detectar aguinaldo (P|24) fuera de diciembre → posible baja por liquidación
        const aguinaldoColIdx = hdrRaw.findIndex(v => String(v).includes('24 Aguinaldo'));
        if (aguinaldoColIdx >= 0) {
          const aguinaldoImp = toNum(row[aguinaldoColIdx]);
          if (aguinaldoImp && aguinaldoImp > 0) {
            const periodos = db.rhh_periodos || [];
            const pInfo = periodos.find(x => x.no_periodo === semana);
            let isDecember = semana >= 49; // fallback
            if (pInfo) {
              const mMatch = String(pInfo.fecha_inicio || '').match(/(\w{3})\/\d{4}$/);
              if (mMatch) isDecember = (MES_MESES[mMatch[1]] || 0) === 12;
            }
            if (!isDecember && !aguinaldo_no_dic.find(x => x.id === emp.id)) {
              aguinaldo_no_dic.push({ id: emp.id, employee_number: emp.employee_number, full_name: emp.full_name, semana, importe: aguinaldoImp });
            }
          }
        }

        upsertIncidencia(emp, semana, {
          dias_pagados:        diasPag,
          faltas:              0,
          horas_extras_total:  hrsExtra,
          despensa,
          prima_dominical:     primaDom,
          vacaciones_dias:     vacDias,
          percepciones,
          deducciones,
          total_perc_pdf:      totalPerc,
          total_ded_pdf:       totalDed,
          neto_pdf:            neto,
          notas,
          source: 'consolidado_import',
        });
      }

      const semanasList = [...semanasImportadas].sort((a,b)=>a-b);
      const ultimaSemana = semanasList.length > 0 ? semanasList[semanasList.length - 1] : null;

      // Posibles bajas: empleados activos que NO aparecen en la última semana importada
      // Excluir empleados recién creados en este mismo import (no son bajas)
      const nuevosIds = new Set(nuevos.map(n => n.id));
      const posibles_bajas = [];
      if (ultimaSemana) {
        const enUltima = empEncontradosPorSemana.get(ultimaSemana) || new Set();
        const sysIds   = getSystemEmpIds();
        for (const e of db.rhh_employees) {
          if (e.status === 'inactive') continue;
          if (sysIds.has(Number(e.id))) continue;
          if (nuevosIds.has(e.id)) continue; // recién creado en este import → no es baja
          const num = String(e.employee_number || '').trim();
          if (num.length < 3 || !/^\d+$/.test(num.replace(/^0+/, '') || '0')) continue;
          if (!enUltima.has(e.id)) {
            posibles_bajas.push({ id: e.id, employee_number: e.employee_number, full_name: e.full_name });
          }
        }
      }

      // ── Candidatos a baja / posibles reingresos ─────────────────────────────
      const nowDate = nowMxDate();
      const nowTs   = nowMxTs();
      if (ultimaSemana) {
        const enUltima = empEncontradosPorSemana.get(ultimaSemana) || new Set();

        // 1. Supersede: candidatos pendientes cuyo empleado reapareció en ultimaSemana
        for (const c of db.rhh_baja_candidatos) {
          if (c.state !== 'pending') continue;
          if (!enUltima.has(c.employee_id)) continue;
          const empC = (db.rhh_employees || []).find(e => e.id === c.employee_id);
          if (empC?.manual_baja_locked) continue; // reingreso: se maneja abajo
          c.state            = 'superseded';
          c.superseded_at    = nowTs;
          c.superseded_reason = `Empleado reaparece en semana ${ultimaSemana}`;
        }

        // 2. Possible rehire: empleados con manual_baja_locked que aparecen en ultimaSemana
        for (const e of db.rhh_employees) {
          if (!e.manual_baja_locked) continue;
          if (!enUltima.has(e.id)) continue;
          upsertBajaCandidato(db, e, ultimaSemana, {
            type:     'possible_rehire',
            evidence: `Empleado con baja confirmada reaparece en semana ${ultimaSemana}`,
          }, nowDate, nowTs);
        }

        // 3. Ausencia en ultimaSemana → posible baja
        for (const baja of posibles_bajas) {
          const e = (db.rhh_employees || []).find(x => x.id === baja.id);
          if (!e) continue;
          upsertBajaCandidato(db, e, ultimaSemana, {
            type:     'ausencia_ultima_semana',
            evidence: `No aparece en semana ${ultimaSemana} del Consolidado`,
          }, nowDate, nowTs);
        }

        // 4. Aguinaldo fuera de diciembre → posible liquidación
        for (const ag of aguinaldo_no_dic) {
          const e = (db.rhh_employees || []).find(x => x.id === ag.id);
          if (!e) continue;
          upsertBajaCandidato(db, e, ultimaSemana, {
            type:     'aguinaldo_no_diciembre',
            evidence: `Aguinaldo de $${ag.importe} en semana ${ag.semana} (fuera de diciembre)`,
          }, nowDate, nowTs);
        }
      }

      const candidatos_pendientes = db.rhh_baja_candidatos.filter(c => c.state === 'pending');

      console.log('[import-contpaq] Consolidado procesado — semanas:', semanasList, '| inc_upserted:', inc_upserted, '| updated:', updated, '| skipped:', skipped, '| nuevos:', nuevos.length, '| candidatos_pendientes:', candidatos_pendientes.length);
      try {
        await writeAsync(db);
        console.log('[import-contpaq] writeAsync OK — incidencias totales en DB:', db.rhh_incidencias_semanales.length);
      } catch (e) {
        console.error('[import-contpaq] Error al persistir en DB:', e.message);
        return res.status(500).json({ error: 'Datos procesados pero no se pudo guardar en la base de datos: ' + e.message });
      }
      return res.json({
        ok: true, formato: 'consolidado',
        updated, created_depts, created_pos, skipped, inc_upserted,
        semanas: semanasList, log,
        nuevos, posibles_bajas, aguinaldo_no_dic, ultima_semana: ultimaSemana,
        candidatos_pendientes,
      });
    }

    // ── FORMATO LISTA ASISTENCIA (semana X) ──────────────────────────────────
    let noPeriodo = Number(req.body?.no_periodo) || null;
    if (!noPeriodo) {
      const sheetMatch = sheetName.match(/semana\s*(\d+)/i);
      if (sheetMatch) noPeriodo = Number(sheetMatch[1]);
    }
    if (!noPeriodo) {
      for (let i = 0; i < Math.min(3, all.length) && !noPeriodo; i++) {
        for (const cell of all[i]) {
          const m = String(cell || '').match(/semana\s*(\d+)/i);
          if (m) { noPeriodo = Number(m[1]); break; }
        }
      }
    }

    let deptCol = 2, posCol = 4, numCol = 0, nameCol = 1;
    for (let i = 0; i < Math.min(6, all.length); i++) {
      const row = all[i].map(norm).map(v => v.toLowerCase());
      const dIdx = row.findIndex(v => v.includes('departamento') || v === 'área' || v === 'area');
      const pIdx = row.findIndex(v => v.includes('puesto') || v.includes('cargo'));
      if (dIdx >= 0 && pIdx >= 0) {
        deptCol = dIdx; posCol = pIdx;
        const nIdx  = row.findIndex(v => v.includes('no.') || v === 'no' || v === '#' || v.includes('empleado') || v.includes('numero'));
        const nmIdx = row.findIndex(v => v === 'nombre' || v.includes('nombre'));
        if (nIdx  >= 0) numCol  = nIdx;
        if (nmIdx >= 0) nameCol = nmIdx;
        break;
      }
    }

    let STATUS_COLS = [6, 10, 14, 18, 22, 26, 30];
    let TE_COLS     = [8, 12, 16, 20, 24, 28, 32];
    for (let i = 0; i < Math.min(6, all.length); i++) {
      const row = all[i];
      const aCols = row.map((v,j) => String(v||'').trim().toLowerCase() === 'asistencia' ? j : -1).filter(j => j >= 0);
      const tCols = row.map((v,j) => String(v||'').trim().toLowerCase() === 't.e.' ? j : -1).filter(j => j >= 0);
      if (aCols.length >= 5) { STATUS_COLS = aCols; TE_COLS = tCols; break; }
    }

    const normStatus = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    const PAID_STATUS  = new Set(['labora','festivo','descanso','retardo','tiempoxt','permiso cg','cumpleanos','paro tecnico']);
    const VAC_STATUS   = new Set(['vacaciones','vacacion']);
    const FALTA_STATUS = new Set(['falta','baja','incapacidad','permiso sg']);

    for (const row of all) {
      const empNum  = norm(row[numCol]).replace(/^0+/, '');
      const empName = norm(row[nameCol]).replace(/\*/g, '');
      if (!empName || empName.toLowerCase() === 'nombre') continue;
      if (empNum && !/^\d+$/.test(empNum)) continue;
      const deptName = norm(row[deptCol]);
      const posName  = norm(row[posCol]);
      if (!deptName && !posName) { skipped++; continue; }

      const emp = findEmpByNameOrNum(empNum, empName);
      if (!emp) { skipped++; if (log.length < 20) log.push(`"${empName}": no encontrado`); continue; }

      const deptId = findOrCreateDept(deptName);
      const posId  = findOrCreatePos(posName, deptId);
      if (emp.department_id !== deptId || emp.position_id !== posId) {
        emp.department_id = deptId; emp.position_id = posId;
        emp.updated_at = nowMxDate(); updated++;
      }

      if (noPeriodo) {
        let diasPagados = 0, faltas = 0, vacDias = 0, primaDom = 0, teTotal = 0;
        for (let i = 0; i < STATUS_COLS.length; i++) {
          const st  = normStatus(norm(row[STATUS_COLS[i]]));
          const te  = Number(row[TE_COLS[i]]) || 0;
          teTotal  += te;
          if (!st) continue;
          if (PAID_STATUS.has(st)) diasPagados++;
          else if (VAC_STATUS.has(st)) vacDias++;
          else if (FALTA_STATUS.has(st)) faltas++;
          if (i === 6 && (st === 'labora' || st === 'tiempoxt')) primaDom = 1;
        }
        upsertIncidencia(emp, noPeriodo, {
          dias_pagados: diasPagados, faltas, horas_extras_total: teTotal,
          despensa: 1, prima_dominical: primaDom, vacaciones_dias: vacDias || 0,
          source: 'excel_import',
        });
      }
    }

    try {
      await writeAsync(db);
    } catch (e) {
      console.error('[import-contpaq] Error al persistir en DB:', e.message);
      return res.status(500).json({ error: 'Datos procesados pero no se pudo guardar en la base de datos: ' + e.message });
    }
    res.json({ ok: true, formato: 'lista_asistencia',
               updated, created_depts, created_pos, skipped, inc_upserted,
               semanas: noPeriodo ? [noPeriodo] : [], log });
  }
);

// GET /api/rhh/catalogo/debug-incidencias  — diagnóstico: semanas guardadas en DB
router.get('/debug-incidencias', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = read();
  const lista = db.rhh_incidencias_semanales || [];
  const semanas = {};
  for (const r of lista) {
    semanas[r.no_periodo] = (semanas[r.no_periodo] || 0) + 1;
  }
  res.json({
    total: lista.length,
    semanas_con_datos: Object.keys(semanas).map(Number).sort((a,b)=>a-b),
    conteo_por_semana: semanas,
  });
});

module.exports = router;
