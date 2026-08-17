const express = require('express');
const fs   = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');
const multer = require('multer');
const { read, write, writeAsync, nextId, seedPath, forceSeedFromJson, getSystemEmpIds } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const {
  canonicalPeriod,
  comparePeriods,
  effectivePeriodYear,
  samePeriod,
  upsertCanonicalPeriod,
  upsertEmployeePeriodSnapshot,
} = require('../utils/rhh-periods');
const { materializeAttendanceWeekTemplate, mondayOfWeek } = require('../utils/rhh-attendance-template');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function nowMxTs() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(' ', 'T');
}

// Las rutas de este archivo realizan cambios de varias entidades a la vez.
// Trabajar sobre una copia evita contaminar la cache si PostgreSQL rechaza writeAsync().
function readFresh() { return structuredClone(read()); }

function recordStatusEvent(db, employee, event) {
  if (!Array.isArray(db.rhh_status_events)) db.rhh_status_events = [];
  db.rhh_status_events.push({
    id: nextId(db.rhh_status_events),
    employee_id: employee.id,
    employee_number: employee.employee_number,
    from_status: event.from_status ?? null,
    to_status: event.to_status ?? employee.status ?? null,
    event_type: event.event_type,
    source: event.source || 'manual',
    period_key: event.period_key || null,
    import_batch_id: event.import_batch_id || null,
    performed_by: event.performed_by || null,
    notes: event.notes || null,
    created_at: nowMxTs(),
  });
}

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
    if (inc.year || inc.period_key || inc.fecha_inicio || inc.fecha_fin) {
      return effectivePeriodYear(inc) === currentYear
        ? sum + (Number(inc.vacaciones_dias) || 0)
        : sum;
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
function upsertBajaCandidato(db, emp, detectedPeriod, reason, nowDate, nowTs, importBatchId = null) {
  if (!Array.isArray(db.rhh_baja_candidatos)) db.rhh_baja_candidatos = [];
  const period = canonicalPeriod(
    typeof detectedPeriod === 'object' ? detectedPeriod : { no_periodo: detectedPeriod }
  );
  if (!period) return;
  const isPossibleRehire = reason.type === 'possible_rehire';
  const candidateKind = isPossibleRehire ? 'rehire' : 'termination';
  if (!isPossibleRehire && emp.manual_baja_locked) return;
  if (!isPossibleRehire && emp.status === 'inactive') return;

  const existing = db.rhh_baja_candidatos.find(c =>
    c.employee_id === emp.id && samePeriod({
      no_periodo: c.detected_week,
      year: c.detected_year,
      period_key: c.period_key,
    }, period.no_periodo, period.year) && c.state === 'pending' &&
    (c.kind || ((c.reasons || []).some(r => r.type === 'possible_rehire') ? 'rehire' : 'termination')) === candidateKind
  );
  if (existing) {
    if (!existing.reasons.some(r => r.type === reason.type)) existing.reasons.push(reason);
    if (importBatchId) existing.last_import_batch_id = importBatchId;
  } else {
    // Una decision previa para el mismo motivo y semana se respeta. Una evidencia
    // diferente o una semana nueva si puede abrir una revision nueva.
    const alreadyResolved = db.rhh_baja_candidatos.some(c =>
      c.employee_id === emp.id && samePeriod({
        no_periodo: c.detected_week,
        year: c.detected_year,
        period_key: c.period_key,
      }, period.no_periodo, period.year) &&
      ['dismissed', 'confirmed'].includes(c.state) &&
      (c.reasons || []).some(r => r.type === reason.type)
    );
    if (alreadyResolved) return;
    db.rhh_baja_candidatos.push({
      id: nextId(db.rhh_baja_candidatos),
      employee_id:     emp.id,
      employee_name:   emp.full_name,
      employee_number: emp.employee_number,
      detected_week:   period.no_periodo,
      detected_year:   period.year,
      period_key:      period.period_key,
      detected_at:     nowTs,
      detected_by_import: true,
      import_batch_id: importBatchId,
      kind:            candidateKind,
      reasons:         [reason],
      state:           'pending',
      confirmed_by:    null, confirmed_at:   null,
      dismissed_by:    null, dismissed_at:   null,
      superseded_at:   null, superseded_reason: null,
    });
  }
}

// ── GET /api/rhh/catalogo/diag ─── diagnóstico restringido a admin ────────────
router.get('/diag', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const db = read();
  const emps = db.rhh_employees || [];
  const reales = emps.filter(e => {
    const num = String(e.employee_number || '').trim();
    return num.length >= 3 && /^\d+$/.test(num.replace(/^0+/, '') || '0');
  });
  res.json({
    seedExists: fs.existsSync(seedPath),
    totalEmpleados: emps.length,
    empleadosReales: reales.length,
    activos: reales.filter(e => e.status === 'active').length,
    primerEmp: reales[0] ? { id: reales[0].id, num: reales[0].employee_number, name: reales[0].full_name } : null,
  });
});

// ── POST /api/rhh/catalogo/force-seed ─── reseed admin + secreto de entorno ───
router.post('/force-seed', rhhAuthRequired, rhhRequireRole('admin'), async (req, res) => {
  const expectedKey = process.env.RHH_SEED_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: 'RHH_SEED_KEY no está configurada; reseed deshabilitado' });
  }
  const key = req.get('x-rhh-seed-key') || req.body?.key;
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

router.get('/import-batches', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const batches = (db.rhh_import_batches || [])
    .slice()
    .sort((a, b) => String(b.imported_at || '').localeCompare(String(a.imported_at || '')))
    .slice(0, limit);
  res.json({ batches, total: (db.rhh_import_batches || []).length });
});

// ── POST /api/rhh/catalogo/baja-candidatos/:id/confirm ────────────────────────
router.post('/baja-candidatos/:id/confirm', rhhAuthRequired, rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = readFresh();
  if (!Array.isArray(db.rhh_baja_candidatos)) db.rhh_baja_candidatos = [];

  const cand = db.rhh_baja_candidatos.find(c => c.id === Number(req.params.id));
  if (!cand) return res.status(404).json({ error: 'Candidato no encontrado' });
  if (cand.state !== 'pending') return res.status(400).json({ error: `Candidato ya en estado: ${cand.state}` });
  if ((cand.reasons || []).every(r => r.type === 'possible_rehire')) {
    return res.status(400).json({ error: 'Este candidato corresponde a un posible reingreso, no a una baja' });
  }

  const emp = (db.rhh_employees || []).find(e => e.id === cand.employee_id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const user  = req.rhhUser?.email || req.rhhUser?.username || 'rh';
  const nowD  = nowMxDate();
  const nowTs = nowMxTs();

  // Actualizar empleado
  const previousStatus = emp.status || null;
  emp.status                = 'inactive';
  emp.manual_baja_locked    = true;
  emp.status_source         = 'confirmed';
  emp.fecha_baja            = req.body?.fecha_baja || nowD;
  emp.baja_semana_efectiva  = String(req.body?.semana_efectiva || cand.detected_week);
  emp.baja_motivo           = req.body?.motivo || null;
  emp.baja_confirmada_por   = user;
  emp.baja_confirmada_at    = nowTs;
  emp.updated_at            = nowD;
  recordStatusEvent(db, emp, {
    from_status: previousStatus,
    to_status: 'inactive', event_type: 'termination_confirmed', source: 'candidate',
    period_key: cand.period_key, performed_by: user, notes: emp.baja_motivo,
  });

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
  recordStatusEvent(db, emp, {
    from_status: 'inactive', to_status: 'active', event_type: 'rehire',
    source: 'manual', performed_by: user,
  });

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

// Reactivar desde una evidencia concreta conserva trazabilidad y no resuelve
// candidatos no relacionados del mismo empleado.
router.post('/baja-candidatos/:id/reactivate', rhhAuthRequired, rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = readFresh();
  if (!Array.isArray(db.rhh_baja_candidatos)) db.rhh_baja_candidatos = [];
  const cand = db.rhh_baja_candidatos.find(c => c.id === Number(req.params.id));
  if (!cand) return res.status(404).json({ error: 'Candidato no encontrado' });
  if (cand.state !== 'pending') return res.status(400).json({ error: `Candidato ya en estado: ${cand.state}` });
  if (!(cand.reasons || []).some(r => r.type === 'possible_rehire')) {
    return res.status(400).json({ error: 'El candidato no contiene evidencia de reingreso' });
  }
  const emp = (db.rhh_employees || []).find(e => e.id === cand.employee_id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  const user = req.rhhUser?.email || req.rhhUser?.username || 'rh';
  const nowD = nowMxDate();
  const nowTs = nowMxTs();
  emp.status = 'active';
  emp.manual_baja_locked = false;
  emp.status_source = 'manual_rehire';
  emp.fecha_reingreso = req.body?.fecha_reingreso || nowD;
  emp.reingreso_semana_efectiva = String(req.body?.semana_efectiva || cand.detected_week);
  emp.reingreso_por = user;
  emp.reingreso_at = nowTs;
  emp.updated_at = nowD;
  recordStatusEvent(db, emp, {
    from_status: 'inactive', to_status: 'active', event_type: 'rehire',
    source: 'candidate', period_key: cand.period_key, performed_by: user,
  });
  cand.state = 'confirmed';
  cand.confirmed_by = user;
  cand.confirmed_at = nowTs;
  cand.confirmed_action = 'reactivate';
  try {
    await writeAsync(db);
    res.json({ ok: true, candidato: cand, employee: enrich(emp, db) });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
  }
});

// Libera únicamente los campos indicados para que una importación futura pueda
// volver a actualizarlos. La liberación nunca cambia el dato actual por sí sola.
router.post('/employees/:id/unlock-fields', rhhAuthRequired, rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = readFresh();
  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  const allowed = new Set(['department', 'position', 'shift', 'project', 'salary', 'start_date', 'baja']);
  const fields = Array.isArray(req.body?.fields) ? req.body.fields.filter(f => allowed.has(f)) : [];
  if (!fields.length) return res.status(400).json({ error: 'fields[] requerido' });
  for (const field of fields) emp[`manual_${field}_locked`] = false;
  emp.updated_at = nowMxDate();
  try {
    await writeAsync(db);
    res.json({ ok: true, employee: enrich(emp, db), unlocked_fields: fields });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
  }
});

router.get('/employees/:id/status-events', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const employeeId = Number(req.params.id);
  const db = readFresh();
  if (!(db.rhh_employees || []).some(emp => emp.id === employeeId)) {
    return res.status(404).json({ error: 'Empleado no encontrado' });
  }
  const events = (db.rhh_status_events || [])
    .filter(event => Number(event.employee_id) === employeeId)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json({ employee_id: employeeId, events });
});

// ── GET /api/rhh/catalogo/:id ─────────────────────────────────────────────────
router.get('/:id', rhhAuthRequired, (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
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
    .sort((a, b) => comparePeriods(b, a))
    .map(r => {
      const year = effectivePeriodYear(r);
      const p = periodos.find(p => samePeriod(p, r.no_periodo, year)) || {};
      return {
        ...r,
        year,
        period_key: r.period_key || canonicalPeriod({ ...r, year })?.period_key,
        fecha_inicio: p.fecha_inicio || r.fecha_inicio || null,
        fecha_fin: p.fecha_fin || r.fecha_fin || null,
      };
    });

  const aclaraciones = (db.rhh_payroll_clarifications || [])
    .filter(r => r.employee_id === emp.id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const vacaciones = (db.rhh_vac_solicitudes || [])
    .filter(r => r.employee_id === emp.id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Semanas donde se tomaron vacaciones (desde incidencias semanales)
  const semanas_vacaciones = incidencias
    .filter(r => Number(r.vacaciones_dias) > 0)
    .map(r => ({
      no_periodo: r.no_periodo,
      year: effectivePeriodYear(r),
      fecha_inicio: r.fecha_inicio || null,
      fecha_fin: r.fecha_fin || null,
      vacaciones_dias: Number(r.vacaciones_dias),
      fuente: r._vac_fuente || 'contpaq',
    }));

  const evaluaciones = (db.rhh_evaluations || [])
    .filter(r => r.employee_id === emp.id);

  const vac_info = calcVacInfo(emp, db, nowMxDate());

  res.json({
    employee:    enriched,
    incidencias,
    aclaraciones,
    vacaciones,
    semanas_vacaciones,
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
// Aprobar/rechazar solicitud de vacaciones (opera sobre rhh_vac_solicitudes)
router.patch('/vacaciones/:vid', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const { status, notas_rh } = req.body || {};
  const estado = status === 'aprobado' ? 'aprobada' : status === 'rechazado' ? 'rechazada' : status;
  if (!['aprobada', 'rechazada'].includes(estado)) {
    return res.status(400).json({ error: 'status debe ser aprobado o rechazado' });
  }

  const lista = db.rhh_vac_solicitudes || [];
  const idx = lista.findIndex(v => v.id === Number(req.params.vid));
  if (idx === -1) return res.status(404).json({ error: 'Solicitud no encontrada' });

  lista[idx].estado = estado;
  lista[idx].notas_respuesta = notas_rh || lista[idx].notas_respuesta || null;
  lista[idx].autorizado_por = req.rhhUser?.id || req.rhhUser?.email || 'rh';
  lista[idx].autorizado_at = nowMxTs();

  // Al aprobar: crear/actualizar incidencia semanal con vacaciones_dias
  if (estado === 'aprobada') {
    const s = lista[idx];
    const incLista = db.rhh_incidencias_semanales || [];
    const year = effectivePeriodYear(s) || new Date().getFullYear();
    const incIdx = incLista.findIndex(i =>
      samePeriod(i, s.no_periodo, year) && i.employee_id === s.employee_id
    );
    const diasVac = Number(s.dias) || 0;
    if (incIdx !== -1) {
      incLista[incIdx].vacaciones_dias = (Number(incLista[incIdx].vacaciones_dias) || 0) + diasVac;
      incLista[incIdx].updated_at = nowMxTs();
      incLista[incIdx]._vac_fuente = 'solicitud_aprobada';
    } else {
      incLista.push({
        id: nextId(incLista),
        no_periodo: s.no_periodo,
        year,
        period_key: s.period_key || `${year}-W${String(s.no_periodo).padStart(2, '0')}`,
        employee_id: s.employee_id,
        dias_pagados: 7, faltas: 0, horas_extras_total: 0, despensa: 1,
        bono_puntualidad_dias: null, bono_eficiencia_dias: null, bono_instructor: null,
        prima_dominical: 0, vacaciones_dias: diasVac, gratificacion: null, notas: '',
        _vac_fuente: 'solicitud_aprobada',
        updated_by: req.rhhUser?.id || null, updated_at: nowMxTs(), created_at: nowMxTs(),
      });
    }
    db.rhh_incidencias_semanales = incLista;
  }

  write(db);
  res.json({ ok: true });
});

// ── POST /api/rhh/catalogo/:id/vacaciones/manual ─────────────────────────────
// Agregar o quitar días de vacaciones manualmente en una semana
router.post('/:id/vacaciones/manual', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const empId = Number(req.params.id);
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const { no_periodo, year, dias, accion } = req.body || {};
  if (!no_periodo || !year || !dias) return res.status(400).json({ error: 'no_periodo, year y dias son requeridos' });
  if (!['agregar', 'quitar'].includes(accion)) return res.status(400).json({ error: 'accion debe ser agregar o quitar' });

  const incLista = db.rhh_incidencias_semanales || [];
  const noPer = Number(no_periodo);
  const yr = Number(year);
  const diasNum = Number(dias);

  const incIdx = incLista.findIndex(i =>
    samePeriod(i, noPer, yr) && i.employee_id === empId
  );

  if (accion === 'agregar') {
    if (incIdx !== -1) {
      incLista[incIdx].vacaciones_dias = (Number(incLista[incIdx].vacaciones_dias) || 0) + diasNum;
      incLista[incIdx].updated_at = nowMxTs();
      incLista[incIdx]._vac_fuente = 'manual_rhh';
    } else {
      incLista.push({
        id: nextId(incLista),
        no_periodo: noPer, year: yr,
        period_key: `${yr}-W${String(noPer).padStart(2, '0')}`,
        employee_id: empId,
        dias_pagados: 7, faltas: 0, horas_extras_total: 0, despensa: 1,
        bono_puntualidad_dias: null, bono_eficiencia_dias: null, bono_instructor: null,
        prima_dominical: 0, vacaciones_dias: diasNum, gratificacion: null, notas: '',
        _vac_fuente: 'manual_rhh',
        updated_by: req.rhhUser?.id || null, updated_at: nowMxTs(), created_at: nowMxTs(),
      });
    }
    // Registrar como solicitud aprobada para auditoría
    if (!Array.isArray(db.rhh_vac_solicitudes)) db.rhh_vac_solicitudes = [];
    const solLista = db.rhh_vac_solicitudes;
    solLista.push({
      id: (solLista.reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1,
      employee_id: empId, no_periodo: noPer, year: yr,
      period_key: `${yr}-W${String(noPer).padStart(2, '0')}`,
      dias: diasNum, notas: 'Ajuste manual RHH',
      estado: 'aprobada', origen: 'manual_rhh',
      autorizado_por: req.rhhUser?.id || req.rhhUser?.email || 'rh',
      autorizado_at: nowMxTs(), created_at: nowMxTs(),
    });
  } else {
    // quitar
    if (incIdx === -1) return res.status(404).json({ error: 'No hay incidencia semanal para ese periodo' });
    const current = Number(incLista[incIdx].vacaciones_dias) || 0;
    incLista[incIdx].vacaciones_dias = Math.max(0, current - diasNum);
    incLista[incIdx].updated_at = nowMxTs();
  }

  db.rhh_incidencias_semanales = incLista;
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

  const { department_id, position_id, shift_id, project, status, phone, email, start_date, salary_daily, vac_dias_disponibles, fecha_baja, fecha_alta, motivo_baja } = req.body || {};
  if (department_id !== undefined) {
    const value = department_id ? Number(department_id) : null;
    if (emp.department_id !== value) { emp.department_id = value; emp.manual_department_locked = true; }
  }
  if (position_id !== undefined) {
    const value = position_id ? Number(position_id) : null;
    if (emp.position_id !== value) { emp.position_id = value; emp.manual_position_locked = true; }
  }
  if (shift_id !== undefined) {
    const value = shift_id ? Number(shift_id) : null;
    if (emp.shift_id !== value) { emp.shift_id = value; emp.manual_shift_locked = true; }
  }
  if (project !== undefined) {
    const value = project || null;
    if (emp.project !== value) { emp.project = value; emp.manual_project_locked = true; }
  }
  if (status                 !== undefined) {
    const previousStatus = emp.status || null;
    emp.status = status;
    if (status === 'inactive') {
      emp.manual_baja_locked = true;
      emp.status_source      = 'manual';
      if (!emp.fecha_baja) emp.fecha_baja = nowMxDate();
      emp.baja_confirmada_por = req.rhhUser?.email || req.rhhUser?.username || 'rh';
      emp.baja_confirmada_at  = nowMxTs();
      if (!emp.baja_semana_efectiva && req.body?.baja_semana_efectiva) emp.baja_semana_efectiva = String(req.body.baja_semana_efectiva);
    } else if (status === 'active') {
      emp.manual_baja_locked = false;
      emp.status_source      = 'manual';
      emp.fecha_baja = null;
      emp.baja_semana_efectiva = null;
      emp.baja_motivo = null;
      emp.baja_confirmada_por = null;
      emp.baja_confirmada_at = null;
    }
    if (previousStatus !== status) {
      recordStatusEvent(db, emp, {
        from_status: previousStatus, to_status: status,
        event_type: status === 'inactive' ? 'manual_termination' : 'manual_reactivation',
        source: 'catalog', performed_by: req.rhhUser?.email || req.rhhUser?.username || 'rh',
      });
    }
  }
  if (phone                  !== undefined) emp.phone                  = phone   || null;
  if (email                  !== undefined) emp.email                  = email   || null;
  if (start_date !== undefined) {
    const value = start_date || null;
    if ((emp.start_date || emp.fecha_ingreso || null) !== value) {
      emp.start_date = value; emp.fecha_ingreso = value; emp.manual_start_date_locked = true;
    }
  }
  if (salary_daily           !== undefined) {
    const value = salary_daily !== null && salary_daily !== '' ? Number(salary_daily) : null;
    if ((emp.salary_daily ?? emp.sal_diario ?? null) !== value) {
      emp.salary_daily = value; emp.sal_diario = value; emp.manual_salary_locked = true;
    }
  }
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
//    Detección: col 0 = "semana" o "Periodo No.", col 3 = "No. Empleado", cols con "P | " y "D | "
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
    const previewOnly = String(req.body?.preview || '') === '1';
    const confirmed = String(req.body?.confirm || '') === '1';
    const forceReprocess = String(req.body?.force || '') === '1';
    if (!previewOnly && !confirmed) {
      return res.status(400).json({
        error: 'Primero analiza el archivo con preview=1 y después confirma con confirm=1',
        code: 'IMPORT_CONFIRMATION_REQUIRED',
      });
    }
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

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
    const isConsolidado = (hdrs[0] === 'semana' || hdrs[0] === 'periodo no.') &&
      all[0].some(v => String(v).startsWith('P | ') || String(v).startsWith('P(info) | '));
    console.log('[import-contpaq] hojas disponibles:', wb.SheetNames, '| hoja seleccionada:', sheetName, '| filas:', all.length, '| hdr[0]:', JSON.stringify(all[0][0]), '| isConsolidado:', isConsolidado);

    const db = readFresh();
    const emps = db.rhh_employees || [];
    if (!Array.isArray(db.rhh_incidencias_semanales)) db.rhh_incidencias_semanales = [];
    if (!Array.isArray(db.rhh_baja_candidatos))       db.rhh_baja_candidatos = [];
    if (!Array.isArray(db.rhh_periodos))              db.rhh_periodos = [];
    if (!Array.isArray(db.rhh_employee_period_snapshots)) db.rhh_employee_period_snapshots = [];
    if (!Array.isArray(db.rhh_import_batches)) db.rhh_import_batches = [];
    if (!Array.isArray(db.rhh_status_events)) db.rhh_status_events = [];

    const previousBatch = db.rhh_import_batches.find(batch =>
      batch.file_hash === fileHash && batch.status === 'completed'
    );
    if (confirmed && previousBatch && !forceReprocess) {
      return res.status(409).json({
        error: 'Este mismo archivo ya fue importado. Confirma el reproceso explícitamente.',
        code: 'DUPLICATE_IMPORT',
        previous_batch: previousBatch,
      });
    }
    const importBatchId = confirmed ? nextId(db.rhh_import_batches) : null;

    let updated = 0, skipped = 0, created_depts = 0, created_pos = 0, inc_upserted = 0;
    const semanasImportadas = new Set();
    const periodosImportados = new Map();
    const log = [];
    const nuevos = [];
    const nuevos_historicos = [];
    const aguinaldo_no_dic = [];
    const duplicate_rows = [];
    const empEncontradosPorPeriodo = new Map(); // period_key -> Set<empId>

    async function finishImport(result) {
      const response = {
        ...result,
        preview: previewOnly,
        requires_confirmation: previewOnly,
        file_hash: fileHash,
        duplicate_rows,
        nuevos_historicos,
      };
      if (previewOnly) return res.json(response);

      const attendanceWeek = mondayOfWeek();
      const attendanceRolIds = new Set((db.rhh_weekly_rol || [])
        .filter(rol => rol.week_start === attendanceWeek)
        .map(rol => Number(rol.id)));
      const attendanceAssignmentIds = (db.rhh_rol_assignments || [])
        .filter(assignment => attendanceRolIds.has(Number(assignment.rol_id)))
        .map(assignment => Number(assignment.employee_id));
      const attendanceTemplate = materializeAttendanceWeekTemplate(db, attendanceWeek, {
        excludedEmployeeIds: getSystemEmpIds(db),
        extraEmployeeIds: attendanceAssignmentIds,
        requirePayrollSource: true,
        updatedAt: nowMxTs(),
        updatedBy: `contpaq:${req.rhhUser?.email || req.rhhUser?.username || req.rhhUser?.id || 'rh'}`,
      });
      response.attendance_template = {
        week_start: attendanceWeek,
        changed: attendanceTemplate.changed,
        reason: attendanceTemplate.reason,
        added: attendanceTemplate.added || 0,
        employees: attendanceTemplate.template?.employees?.length || 0,
        version: attendanceTemplate.template?.version || null,
      };

      const batch = {
        id: importBatchId,
        file_hash: fileHash,
        file_name: req.file.originalname || null,
        file_size: req.file.size || req.file.buffer.length,
        sheet_name: sheetName,
        formato: result.formato,
        status: 'completed',
        forced_reprocess_of: previousBatch?.id || null,
        imported_by: req.rhhUser?.email || req.rhhUser?.username || req.rhhUser?.id || 'rh',
        imported_at: nowMxTs(),
        periods: result.periodos || (result.semanas || []).map(no_periodo => ({ no_periodo })),
        counts: {
          updated: result.updated || 0,
          new_employees: (result.nuevos || []).length,
          new_historical_employees: nuevos_historicos.length,
          incidents_upserted: result.inc_upserted || 0,
          snapshots_upserted: result.snapshots_upserted || 0,
          candidates_pending: (result.candidatos_pendientes || []).length,
          skipped: result.skipped || 0,
          duplicate_rows: duplicate_rows.length,
          attendance_template_added: attendanceTemplate.added || 0,
        },
      };
      db.rhh_import_batches.push(batch);
      try {
        await writeAsync(db);
      } catch (e) {
        console.error('[import-contpaq] Error al persistir en DB:', e.message);
        return res.status(500).json({ error: 'La importación no fue aplicada: ' + e.message });
      }
      return res.json({ ...response, import_batch: batch });
    }

    function excelMonth(value) {
      if (value instanceof Date && !isNaN(value)) return value.getMonth() + 1;
      if (typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        return parsed?.m || null;
      }
      const s = norm(value).toLowerCase();
      const names = { ene:1, jan:1, feb:2, mar:3, abr:4, apr:4, may:5, jun:6,
        jul:7, ago:8, aug:8, sep:9, oct:10, nov:11, dic:12, dec:12 };
      const named = Object.keys(names).find(k => s.includes(k));
      if (named) return names[named];
      const parts = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
      return parts ? Number(parts[2]) : null;
    }

    function findEmpByNum(num) {
      const n = norm(num).replace(/^0+/, '');
      return emps.find(e => norm(e.employee_number || '').replace(/^0+/, '') === n) || null;
    }

    function findEmpByNameOrNum(excelNum, excelName) {
      const byNum = findEmpByNum(excelNum);
      if (byNum) return byNum;
      // Si CONTPAQ aporta número, éste es la identidad canónica. No intentar
      // unir por nombre porque dos personas pueden compartir nombres similares.
      if (norm(excelNum)) return null;
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

    function upsertIncidencia(emp, periodInput, rec) {
      const period = canonicalPeriod(
        typeof periodInput === 'object'
          ? periodInput
          : { no_periodo: periodInput, year: req.body?.year }
      );
      if (!period) return;
      const incList = db.rhh_incidencias_semanales;
      const existIdx = incList.findIndex(r =>
        r.employee_id === emp.id && samePeriod(r, period.no_periodo, period.year)
      );
      const canonicalFields = {
        no_periodo: period.no_periodo,
        year: period.year,
        period_key: period.period_key,
        fecha_inicio: period.fecha_inicio,
        fecha_fin: period.fecha_fin,
        import_batch_id: importBatchId,
      };
      if (existIdx !== -1) {
        incList[existIdx] = { ...incList[existIdx], ...rec, ...canonicalFields, updated_at: nowMxTs() };
      } else {
        incList.push({ id: nextId(incList), employee_id: emp.id,
                       faltas: 0, notas: '', created_at: nowMxTs(), ...rec, ...canonicalFields });
      }
      inc_upserted++;
      semanasImportadas.add(period.no_periodo);
      periodosImportados.set(period.period_key, period);
    }

    // ── FORMATO CONSOLIDADO ──────────────────────────────────────────────────
    if (isConsolidado) {
      // Mapear índices de columnas desde los encabezados
      const hdrRaw = all[0];
      const colIdx = {};
      hdrRaw.forEach((v, i) => { colIdx[norm(v)] = i; });

      // Aceptar "semana" o "Periodo No." como nombre de la columna de periodo
      const periodoHeader = colIdx['semana'] !== undefined ? 'semana' : (colIdx['Periodo No.'] !== undefined ? 'Periodo No.' : null);
      const requiredHeaders = [periodoHeader || 'semana', 'Fecha Inicio', 'Fecha Fin', 'No. Empleado', 'Nombre'];
      const missingHeaders = requiredHeaders.filter(header => colIdx[header] === undefined);
      if (missingHeaders.length) {
        return res.status(422).json({
          error: `Faltan encabezados requeridos: ${missingHeaders.join(', ')}`,
          code: 'INVALID_HEADERS',
          missing_headers: missingHeaders,
        });
      }

      const semanaCol   = colIdx[periodoHeader]   ?? 0;
      const fechaIniCol = colIdx['Fecha Inicio']  ?? 1;
      const fechaFinCol = colIdx['Fecha Fin']     ?? 2;
      const empNumCol   = colIdx['No. Empleado']  ?? 3;
      const nombreCol   = colIdx['Nombre']        ?? 4;
      const deptCol     = colIdx['Departamento']  ?? 5;
      const puestoCol   = colIdx['Puesto']        ?? 6;
      const rfcCol      = colIdx['RFC']            ?? -1;
      const curpCol     = colIdx['CURP']           ?? -1;
      const salDiarioCol= colIdx['Sal. Diario']   ?? 11;
      const sdiCol      = colIdx['SDI']           ?? 12;
      const sbcCol      = colIdx['SBC']           ?? 13;
      const fechaIngCol = colIdx['Fecha Ingreso'] ?? 10;
      const diasPagCol  = colIdx['Días Pagados']  ?? 15;
      const hrsExtCol   = colIdx['Hrs. Extras']   ?? 17;
      const notasCol    = colIdx['Notas']         ?? 18;
      const projectCol  = hdrRaw.findIndex(v => normName(v).includes('proyecto'));

      const rowPeriods = all.slice(1).map(row => canonicalPeriod({
        no_periodo: Number(row[semanaCol]),
        year: req.body?.year,
        fecha_inicio: row[fechaIniCol],
        fecha_fin: row[fechaFinCol],
      })).filter(Boolean);
      if (rowPeriods.length === 0) {
        return res.status(400).json({ error: 'No se detectaron períodos válidos en el Consolidado' });
      }
      const latestPeriodArchivo = [...rowPeriods].sort(comparePeriods).at(-1);

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
      const filterYear = Number(req.body?.year) || null;

      // Primera pasada: crear identidades nuevas desde la ultima semana antes de
      // procesar el historial. Asi sus filas de semanas anteriores también pueden
      // vincularse a incidencias sin convertir empleados solo historicos en activos.
      for (const row of all.slice(1)) {
        const rowPeriod = canonicalPeriod({
          no_periodo: Number(row[semanaCol]), year: req.body?.year,
          fecha_inicio: row[fechaIniCol], fecha_fin: row[fechaFinCol],
        });
        if (!rowPeriod || rowPeriod.period_key !== latestPeriodArchivo.period_key) continue;
        const empNumRaw = norm(row[empNumCol]);
        const empName = norm(row[nombreCol]);
        if (!empNumRaw || findEmpByNum(empNumRaw) || findEmpByNameOrNum(empNumRaw, empName)) continue;
        const dNom = norm(row[deptCol]);
        const pNom = norm(row[puestoCol]);
        const dId = findOrCreateDept(dNom);
        const pId = findOrCreatePos(pNom, dId);
        const rfcRaw = rfcCol >= 0 ? norm(row[rfcCol]).replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
        const curpRaw = curpCol >= 0 ? norm(row[curpCol]).replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
        const emp = {
          id: nextId(db.rhh_employees), employee_number: empNumRaw, full_name: empName,
          status: 'active', department_id: dId, position_id: pId,
          rfc: rfcRaw || null, curp: curpRaw || null,
          sal_diario: toNum(row[salDiarioCol]), salary_daily: toNum(row[salDiarioCol]),
          sdi: toNum(row[sdiCol]), sbc: toNum(row[sbcCol]),
          fecha_ingreso: norm(row[fechaIngCol]), fecha_alta: nowMxDate(),
          created_at: nowMxDate(), updated_at: nowMxDate(),
        };
        if (rfcRaw.length >= 10 && curpRaw.length >= 6) {
          emp.emp_login = { username: rfcRaw.slice(0, 10), password: curpRaw.slice(-6), must_change: true };
        }
        db.rhh_employees.push(emp);
        nuevos.push({ id: emp.id, employee_number: empNumRaw, full_name: empName });
        recordStatusEvent(db, emp, {
          from_status: null, to_status: 'active', event_type: 'hire', source: 'contpaq_import',
          period_key: latestPeriodArchivo.period_key, import_batch_id: importBatchId,
          performed_by: req.rhhUser?.email || req.rhhUser?.username || 'rh',
        });
        updated++;
        if (log.length < 20) log.push(`${latestPeriodArchivo.period_key} #${empNumRaw} "${empName}": nuevo empleado creado`);
      }

      // Identidades que sólo existen en semanas históricas también se conservan.
      // Nacen inactivas y nunca contaminan la plantilla de la última semana.
      const historicalUnknown = new Map();
      for (const row of all.slice(1)) {
        const period = canonicalPeriod({
          no_periodo: Number(row[semanaCol]), year: req.body?.year,
          fecha_inicio: row[fechaIniCol], fecha_fin: row[fechaFinCol],
        });
        const empNumRaw = norm(row[empNumCol]);
        const empName = norm(row[nombreCol]);
        if (!period || !empNumRaw || findEmpByNum(empNumRaw) || findEmpByNameOrNum(empNumRaw, empName)) continue;
        const key = empNumRaw.replace(/^0+/, '');
        const previous = historicalUnknown.get(key);
        if (!previous || comparePeriods(previous.period, period) < 0) historicalUnknown.set(key, { row, period, empNumRaw, empName });
      }
      for (const item of historicalUnknown.values()) {
        const row = item.row;
        const dId = findOrCreateDept(norm(row[deptCol]));
        const pId = findOrCreatePos(norm(row[puestoCol]), dId);
        const emp = {
          id: nextId(db.rhh_employees), employee_number: item.empNumRaw, full_name: item.empName,
          status: 'inactive', status_source: 'historical_import', historical_only: true,
          department_id: dId, position_id: pId,
          sal_diario: toNum(row[salDiarioCol]), salary_daily: toNum(row[salDiarioCol]),
          sdi: toNum(row[sdiCol]), sbc: toNum(row[sbcCol]), fecha_ingreso: norm(row[fechaIngCol]),
          created_at: nowMxDate(), updated_at: nowMxDate(),
        };
        db.rhh_employees.push(emp);
        nuevos_historicos.push({ id: emp.id, employee_number: emp.employee_number, full_name: emp.full_name, period_key: item.period.period_key });
        recordStatusEvent(db, emp, {
          from_status: null, to_status: 'inactive', event_type: 'historical_identity_created',
          source: 'contpaq_import', period_key: item.period.period_key,
          import_batch_id: importBatchId, performed_by: req.rhhUser?.email || req.rhhUser?.username || 'rh',
        });
      }

      const seenEmployeePeriods = new Set();
      for (const row of all.slice(1)) {
        const semana = Number(row[semanaCol]);
        const rowPeriod = canonicalPeriod({
          no_periodo: semana, year: req.body?.year,
          fecha_inicio: row[fechaIniCol], fecha_fin: row[fechaFinCol],
        });
        if (!rowPeriod) continue;
        if (filterSemana && semana !== filterSemana) continue;
        if (filterYear && rowPeriod.year !== filterYear) continue;
        upsertCanonicalPeriod(db.rhh_periodos, rowPeriod);

        const empNumRaw = norm(row[empNumCol]);
        const empName   = norm(row[nombreCol]);
        if (!empNumRaw && !empName) { skipped++; continue; }
        const duplicateKey = `${empNumRaw.replace(/^0+/, '')}|${rowPeriod.period_key}`;
        if (seenEmployeePeriods.has(duplicateKey)) duplicate_rows.push({ employee_number: empNumRaw, employee_name: empName, period_key: rowPeriod.period_key });
        seenEmployeePeriods.add(duplicateKey);

        let emp = findEmpByNum(empNumRaw) || findEmpByNameOrNum(empNumRaw, empName);
        if (!emp && empNumRaw && rowPeriod.period_key === latestPeriodArchivo.period_key) {
          // Nuevo empleado — crear registro mínimo y agregarlo al catálogo
          const dNom = norm(row[deptCol]);
          const pNom = norm(row[puestoCol]);
          const dId2 = findOrCreateDept(dNom);
          const pId2 = findOrCreatePos(pNom, dId2);
          const rfcRaw2 = rfcCol >= 0 ? norm(row[rfcCol]).replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
          const curpRaw2 = curpCol >= 0 ? norm(row[curpCol]).replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
          emp = {
            id: nextId(db.rhh_employees),
            employee_number: empNumRaw,
            full_name: empName,
            status: 'active',
            department_id: dId2,
            position_id: pId2,
            rfc: rfcRaw2 || null, curp: curpRaw2 || null,
            sal_diario: toNum(row[salDiarioCol]),
            salary_daily: toNum(row[salDiarioCol]),
            sdi: toNum(row[sdiCol]),
            sbc: toNum(row[sbcCol]),
            fecha_ingreso: norm(row[fechaIngCol]),
            fecha_alta: nowMxDate(),
            created_at: nowMxDate(),
            updated_at: nowMxDate(),
          };
          if (rfcRaw2.length >= 10 && curpRaw2.length >= 6) {
            emp.emp_login = { username: rfcRaw2.slice(0, 10), password: curpRaw2.slice(-6), must_change: true };
          }
          db.rhh_employees.push(emp);
          nuevos.push({ id: emp.id, employee_number: empNumRaw, full_name: empName });
          recordStatusEvent(db, emp, {
            from_status: null, to_status: 'active', event_type: 'hire', source: 'contpaq_import',
            period_key: rowPeriod.period_key, import_batch_id: importBatchId,
            performed_by: req.rhhUser?.email || req.rhhUser?.username || 'rh',
          });
          updated++;
          if (log.length < 20) log.push(`S${semana} #${empNumRaw} "${empName}": nuevo empleado creado`);
        } else if (!emp) {
          skipped++;
          if (log.length < 20) log.push(`S${semana} #${empNumRaw} "${empName}": no encontrado`);
          continue;
        }

        // Registrar presencia en esta semana
        if (!empEncontradosPorPeriodo.has(rowPeriod.period_key)) empEncontradosPorPeriodo.set(rowPeriod.period_key, new Set());
        empEncontradosPorPeriodo.get(rowPeriod.period_key).add(emp.id);

        // Actualizar el catalogo maestro exclusivamente con la ultima semana.
        // Las incidencias se conservan para todas las semanas.
        const deptName   = norm(row[deptCol]);
        const posName    = norm(row[puestoCol]);
        const salDiario  = toNum(row[salDiarioCol]);
        const sdi        = toNum(row[sdiCol]);
        const sbc        = toNum(row[sbcCol]);
        const fechaIngr  = norm(row[fechaIngCol]);
        const project    = projectCol >= 0 ? norm(row[projectCol]) : null;
        let empChanged = false;

        const isLatestRow = rowPeriod.period_key === latestPeriodArchivo.period_key;
        const deptId = findOrCreateDept(deptName);
        const posId  = findOrCreatePos(posName, deptId);
        if (isLatestRow && !emp.manual_department_locked && emp.department_id !== deptId) { emp.department_id = deptId; empChanged = true; }
        if (isLatestRow && !emp.manual_position_locked   && emp.position_id   !== posId)  { emp.position_id   = posId;  empChanged = true; }
        if (isLatestRow && project && !emp.manual_project_locked && emp.project !== project) { emp.project = project; empChanged = true; }
        if (isLatestRow && salDiario && !emp.manual_salary_locked && emp.sal_diario !== salDiario) { emp.sal_diario = salDiario; emp.salary_daily = salDiario; empChanged = true; }
        if (isLatestRow && sdi && emp.sdi !== sdi) { emp.sdi = sdi; empChanged = true; }
        if (isLatestRow && sbc && emp.sbc !== sbc) { emp.sbc = sbc; empChanged = true; }
        if (isLatestRow && fechaIngr && !emp.manual_start_date_locked && emp.fecha_ingreso !== fechaIngr) { emp.fecha_ingreso = fechaIngr; emp.start_date = fechaIngr; empChanged = true; }
        // Actualizar RFC/CURP si vienen en el Excel y el empleado no los tiene
        if (isLatestRow && rfcCol >= 0) {
          const rfcVal = norm(row[rfcCol]).replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (rfcVal && !emp.rfc) { emp.rfc = rfcVal; empChanged = true; }
        }
        if (isLatestRow && curpCol >= 0) {
          const curpVal = norm(row[curpCol]).replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (curpVal && !emp.curp) { emp.curp = curpVal; empChanged = true; }
        }
        // Crear emp_login si el empleado tiene RFC y CURP pero no tiene login
        if (isLatestRow && !emp.emp_login) {
          const rfcLogin = (emp.rfc || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const curpLogin = (emp.curp || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (rfcLogin.length >= 10 && curpLogin.length >= 6) {
            emp.emp_login = { username: rfcLogin.slice(0, 10), password: curpLogin.slice(-6), must_change: true };
            empChanged = true;
          }
        }
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
            const month = excelMonth(row[fechaIniCol]) || excelMonth(row[fechaFinCol]);
            const isDecember = month === 12;
            // Si no hay fecha interpretable, no inferir una baja por calendario.
            if (month && !isDecember && !aguinaldo_no_dic.find(x => x.id === emp.id && x.period_key === rowPeriod.period_key)) {
              aguinaldo_no_dic.push({
                id: emp.id, employee_number: emp.employee_number, full_name: emp.full_name,
                semana, year: rowPeriod.year, period_key: rowPeriod.period_key, importe: aguinaldoImp,
              });
            }
          }
        }

        upsertEmployeePeriodSnapshot(db.rhh_employee_period_snapshots, {
          employee_id: emp.id,
          employee_number: emp.employee_number,
          full_name: empName || emp.full_name,
          ...rowPeriod,
          present_in_payroll: true,
          status_at_period: 'active',
          department_id: deptId,
          department_name: deptName || null,
          position_id: posId,
          position_name: posName || null,
          project: project || null,
          sal_diario: salDiario,
          salary_daily: salDiario,
          sdi,
          sbc,
          fecha_ingreso: fechaIngr || null,
          source: 'consolidado_import',
          import_batch_id: importBatchId,
          updated_at: nowMxTs(),
          created_at: nowMxTs(),
        });

        upsertIncidencia(emp, rowPeriod, {
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
      const periodosList = [...periodosImportados.values()].sort(comparePeriods);
      const ultimaPeriod = latestPeriodArchivo || periodosList.at(-1) || null;
      const ultimaSemana = ultimaPeriod?.no_periodo || null;

      // Posibles bajas: empleados activos que NO aparecen en la última semana importada
      // Excluir empleados recién creados en este mismo import (no son bajas)
      const nuevosIds = new Set(nuevos.map(n => n.id));
      const posibles_bajas = [];
      if (ultimaPeriod && empEncontradosPorPeriodo.has(ultimaPeriod.period_key)) {
        const enUltima = empEncontradosPorPeriodo.get(ultimaPeriod.period_key) || new Set();
        const sysIds   = getSystemEmpIds(db);
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
      if (ultimaPeriod && empEncontradosPorPeriodo.has(ultimaPeriod.period_key)) {
        const enUltima = empEncontradosPorPeriodo.get(ultimaPeriod.period_key) || new Set();

        // 1. Reaparicion: solo invalida el motivo de ausencia. Evidencias como
        // aguinaldo fuera de diciembre siguen requiriendo decision de RHH.
        for (const c of db.rhh_baja_candidatos) {
          if (c.state !== 'pending') continue;
          if (!enUltima.has(c.employee_id)) continue;
          const empC = (db.rhh_employees || []).find(e => e.id === c.employee_id);
          if (empC?.manual_baja_locked) continue; // reingreso: se maneja abajo
          const before = c.reasons || [];
          c.reasons = before.filter(r => r.type !== 'ausencia_ultima_semana');
          if (c.reasons.length === 0) {
            c.state             = 'superseded';
            c.superseded_at     = nowTs;
            c.superseded_reason = `Empleado reaparece en semana ${ultimaSemana}`;
          }
        }

        // 2. Possible rehire: empleados con manual_baja_locked que aparecen en ultimaSemana
        for (const e of db.rhh_employees) {
          if (!e.manual_baja_locked && e.status !== 'inactive') continue;
          if (!enUltima.has(e.id)) continue;
          upsertBajaCandidato(db, e, ultimaPeriod, {
            type:     'possible_rehire',
            evidence: `Empleado con baja confirmada reaparece en semana ${ultimaSemana}`,
          }, nowDate, nowTs, importBatchId);
        }

        // 3. Ausencia en ultimaSemana → posible baja
        for (const baja of posibles_bajas) {
          const e = (db.rhh_employees || []).find(x => x.id === baja.id);
          if (!e) continue;
          upsertBajaCandidato(db, e, ultimaPeriod, {
            type:     'ausencia_ultima_semana',
            evidence: `No aparece en semana ${ultimaSemana} del Consolidado`,
          }, nowDate, nowTs, importBatchId);
        }

        // 4. Aguinaldo fuera de diciembre → posible liquidación
        for (const ag of aguinaldo_no_dic) {
          const e = (db.rhh_employees || []).find(x => x.id === ag.id);
          if (!e) continue;
          upsertBajaCandidato(db, e, {
            no_periodo: ag.semana,
            year: ag.year,
            period_key: ag.period_key,
          }, {
            type:     'aguinaldo_no_diciembre',
            evidence: `Aguinaldo de $${ag.importe} en semana ${ag.semana} (fuera de diciembre)`,
          }, nowDate, nowTs, importBatchId);
        }
      }

      const candidatos_pendientes = db.rhh_baja_candidatos.filter(c => c.state === 'pending');

      console.log('[import-contpaq] Consolidado procesado — semanas:', semanasList, '| inc_upserted:', inc_upserted, '| updated:', updated, '| skipped:', skipped, '| nuevos:', nuevos.length, '| candidatos_pendientes:', candidatos_pendientes.length);
      return finishImport({
        ok: true, formato: 'consolidado',
        updated, created_depts, created_pos, skipped, inc_upserted,
        semanas: semanasList, periodos: periodosList, log,
        nuevos, posibles_bajas, aguinaldo_no_dic, ultima_semana: ultimaSemana,
        ultimo_periodo: ultimaPeriod,
        snapshots_upserted: db.rhh_employee_period_snapshots.filter(s => periodosImportados.has(s.period_key)).length,
        candidatos_pendientes,
      });
    }

    // ── FORMATO LISTA ASISTENCIA (semana X) ──────────────────────────────────
    let noPeriodo = Number(req.body?.no_periodo) || null;
    if (!noPeriodo) {
      const sheetMatch = sheetName.match(/semana\s*(\d+)/i);
      if (sheetMatch) noPeriodo = Number(sheetMatch[1]);
    }

    const fileYearMatch = `${req.file.originalname || ''} ${sheetName}`.match(/\b(20\d{2})\b/);
    const listaYear = Number(req.body?.year) || Number(fileYearMatch?.[1]) || new Date().getFullYear();
    const listaPeriod = noPeriodo ? canonicalPeriod({ no_periodo: noPeriodo, year: listaYear }) : null;
    if (listaPeriod) upsertCanonicalPeriod(db.rhh_periodos, listaPeriod);
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
      if ((!emp.manual_department_locked && emp.department_id !== deptId) || (!emp.manual_position_locked && emp.position_id !== posId)) {
        if (!emp.manual_department_locked) emp.department_id = deptId;
        if (!emp.manual_position_locked) emp.position_id = posId;
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
        upsertIncidencia(emp, {
          no_periodo: noPeriodo,
          year: listaYear,
        }, {
          dias_pagados: diasPagados, faltas, horas_extras_total: teTotal,
          despensa: 1, prima_dominical: primaDom, vacaciones_dias: vacDias || 0,
          source: 'excel_import',
        });
        upsertEmployeePeriodSnapshot(db.rhh_employee_period_snapshots, {
          employee_id: emp.id,
          employee_number: emp.employee_number,
          full_name: emp.full_name,
          ...listaPeriod,
          present_in_payroll: true,
          status_at_period: 'active',
          department_id: deptId,
          department_name: deptName || null,
          position_id: posId,
          position_name: posName || null,
          project: emp.project || null,
          sal_diario: emp.sal_diario ?? emp.salary_daily ?? null,
          salary_daily: emp.salary_daily ?? emp.sal_diario ?? null,
          sdi: emp.sdi ?? null,
          sbc: emp.sbc ?? null,
          fecha_ingreso: emp.fecha_ingreso || emp.start_date || null,
          source: 'lista_asistencia_import',
          import_batch_id: importBatchId,
          updated_at: nowMxTs(),
          created_at: nowMxTs(),
        });
      }
    }

    return finishImport({ ok: true, formato: 'lista_asistencia',
      updated, created_depts, created_pos, skipped, inc_upserted,
      semanas: noPeriodo ? [noPeriodo] : [],
      periodos: listaPeriod ? [listaPeriod] : [],
      snapshots_upserted: listaPeriod
        ? db.rhh_employee_period_snapshots.filter(s => s.period_key === listaPeriod.period_key).length
        : 0,
      log,
    });
  }
);

// GET /api/rhh/catalogo/debug-incidencias  — diagnóstico: semanas guardadas en DB
router.get('/debug-incidencias', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = read();
  const lista = db.rhh_incidencias_semanales || [];
  const semanas = {};
  for (const r of lista) {
    const key = canonicalPeriod(r)?.period_key || `legacy-S${r.no_periodo}`;
    semanas[key] = (semanas[key] || 0) + 1;
  }
  res.json({
    total: lista.length,
    periodos_con_datos: Object.keys(semanas).sort(),
    conteo_por_periodo: semanas,
  });
});

module.exports = router;
