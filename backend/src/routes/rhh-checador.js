/* ═══════════════════════════════════════════════════════════════════════════
   RHH — Checador: importación y análisis de registros del reloj checador
   ═══════════════════════════════════════════════════════════════════════════ */
const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ── Utilidades ────────────────────────────────────────────────────────────────

/** "HH:MM" o "HH:MM:SS" → minutos desde medianoche */
function timeToMin(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** minutos → "HH:MM" */
function minToHHMM(total) {
  if (total == null || isNaN(total)) return '--';
  const h = Math.floor(Math.abs(total) / 60);
  const m = Math.abs(total) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parsea el CSV del checador.
 * Encabezado: sName,sJobNo,sCard,Date,Time,IN/OUT,...
 * Fechas en DD/MM/YYYY, valores con apóstrofe inicial.
 */
function parseChecadorCSV(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Normaliza encabezado (quita apóstrofes, pasa a minúsculas)
  const header = lines[0].split(',').map(h => h.trim().replace(/^'/, '').toLowerCase());

  const idxName   = header.findIndex(h => h === 'sname');
  const idxJobNo  = header.findIndex(h => h === 'sjobno');
  const idxDate   = header.findIndex(h => h === 'date');
  const idxTime   = header.findIndex(h => h === 'time');

  if (idxName < 0 || idxJobNo < 0 || idxDate < 0 || idxTime < 0) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 6) continue;

    const rawName   = (parts[idxName]  || '').trim().replace(/^'/, '');
    const rawJobNo  = (parts[idxJobNo] || '').trim().replace(/^'/, '');
    const rawDate   = (parts[idxDate]  || '').trim().replace(/^'/, '');
    const rawTime   = (parts[idxTime]  || '').trim().replace(/^'/, '');

    const checadorId = parseInt(rawJobNo, 10);
    if (isNaN(checadorId) || checadorId <= 0) continue;

    // DD/MM/YYYY → YYYY-MM-DD
    const [dd, mm, yyyy] = rawDate.split('/');
    if (!dd || !mm || !yyyy) continue;
    const dateIso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

    // HH:MM:SS → minutos y string HH:MM
    const timeParts = rawTime.split(':').map(Number);
    const timeMin   = (timeParts[0] || 0) * 60 + (timeParts[1] || 0);
    const timeStr   = `${String(timeParts[0] || 0).padStart(2, '0')}:${String(timeParts[1] || 0).padStart(2, '0')}`;

    rows.push({ checadorId, checadorName: rawName, dateIso, timeMin, timeStr });
  }

  return rows;
}

/**
 * Detecta el turno más probable según la hora de entrada.
 * Prioriza el turno cuyo start_time sea más cercano (±120 min).
 * Maneja turnos nocturnos (end < start).
 */
function detectShift(shifts, entryMin) {
  if (!shifts || shifts.length === 0) return null;

  let best = null;
  let bestDist = Infinity;

  for (const shift of shifts) {
    const startMin = timeToMin(shift.start_time);
    const endMin   = timeToMin(shift.end_time);
    const overnight = endMin < startMin; // ej. T3: 21:30 – 06:30

    let dist;
    if (overnight) {
      // Entrada esperada: ventana alrededor de startMin (tarde/noche)
      const dEvening = Math.abs(entryMin - startMin);
      // O si checa en madrugada (salida T3) no lo tomamos como entrada
      dist = dEvening;
    } else {
      dist = Math.abs(entryMin - startMin);
    }

    if (dist < bestDist) {
      bestDist = dist;
      best = shift;
    }
  }

  return bestDist <= 120 ? best : null; // solo aceptar si está dentro de ±2 h
}

/**
 * Agrupa las checadas de un empleado en sesiones (turno completo).
 * Nueva sesión si la brecha entre checadas consecutivas es > 10 h (600 min).
 * Deduplica checadas con diferencia ≤ 1 min.
 */
function buildSessions(rows) {
  // Ordenar cronológicamente
  rows.sort((a, b) => {
    if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? -1 : 1;
    return a.timeMin - b.timeMin;
  });

  // Deduplicar (misma fecha, diferencia ≤ 1 min)
  const deduped = [];
  for (const row of rows) {
    const last = deduped[deduped.length - 1];
    if (last && last.dateIso === row.dateIso && Math.abs(last.timeMin - row.timeMin) <= 1) continue;
    deduped.push(row);
  }

  if (deduped.length === 0) return [];

  const SESSION_GAP = 600; // 10 horas
  const sessions = [[deduped[0]]];

  for (let i = 1; i < deduped.length; i++) {
    const prev = deduped[i - 1];
    const curr = deduped[i];
    const prevDT = new Date(`${prev.dateIso}T${prev.timeStr}:00`);
    const currDT = new Date(`${curr.dateIso}T${curr.timeStr}:00`);
    const gapMin = (currDT - prevDT) / 60000;

    if (gapMin > SESSION_GAP) {
      sessions.push([curr]);
    } else {
      sessions[sessions.length - 1].push(curr);
    }
  }

  return sessions;
}

/**
 * Procesa filas del CSV → registros estructurados por sesión/turno.
 */
function processRows(rows, shifts, mappings) {
  // Agrupar por checadorId
  const byId = {};
  for (const r of rows) {
    if (!byId[r.checadorId]) byId[r.checadorId] = { name: r.checadorName, rows: [] };
    byId[r.checadorId].rows.push(r);
  }

  const records = [];

  for (const [cidStr, { name, rows: empRows }] of Object.entries(byId)) {
    const checadorId = parseInt(cidStr, 10);
    const mapping    = mappings.find(m => m.checador_id === checadorId);
    const employeeId = mapping ? mapping.employee_id : null;

    const sessions = buildSessions(empRows);

    for (const session of sessions) {
      const entry   = session[0];
      const exit    = session[session.length - 1];
      const hasExit = session.length > 1;

      // Detectar turno por hora de entrada
      const shift = detectShift(shifts, entry.timeMin);

      // Calcular retardo (tolerancia 15 min)
      let retardoMin = 0;
      if (shift) {
        const shiftStartMin = timeToMin(shift.start_time);
        const late = entry.timeMin - shiftStartMin;
        if (late > 15) retardoMin = late;
      }

      // Calcular tiempo trabajado
      let workedMin = null;
      if (hasExit) {
        const entryDT = new Date(`${entry.dateIso}T${entry.timeStr}:00`);
        const exitDT  = new Date(`${exit.dateIso}T${exit.timeStr}:00`);
        workedMin = Math.round((exitDT - entryDT) / 60000);
      }

      // Calcular duración esperada del turno y tiempo extra (>15 min sobre el turno)
      let overtimeMin = 0;
      if (shift && workedMin !== null) {
        const shiftStartMin = timeToMin(shift.start_time);
        const shiftEndMin   = timeToMin(shift.end_time);
        const shiftDuration = shiftEndMin > shiftStartMin
          ? shiftEndMin - shiftStartMin
          : (1440 - shiftStartMin) + shiftEndMin;
        if (workedMin > shiftDuration + 15) overtimeMin = workedMin - shiftDuration;
      }

      records.push({
        checador_id:      checadorId,
        checador_name:    name,
        employee_id:      employeeId,
        date:             entry.dateIso,
        shift_id:         shift ? shift.id   : null,
        shift_name:       shift ? shift.name : 'Desconocido',
        entry_time:       entry.timeStr,
        exit_time:        hasExit ? exit.timeStr  : null,
        exit_date:        hasExit ? exit.dateIso  : null,
        worked_minutes:   workedMin,
        retardo_minutes:  retardoMin,
        overtime_minutes: overtimeMin,
        checada_count:    session.length,
        status:           'pendiente',
      });
    }
  }

  return records;
}

// ── POST /api/rhh/checador/parse  (preview sin guardar) ──────────────────────
router.post('/parse', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { csv_text, date_from, date_to } = req.body || {};
  if (!csv_text) return res.status(400).json({ error: 'csv_text es requerido' });

  const db       = read();
  const shifts   = db.rhh_shifts || [];
  const mappings = db.rhh_checador_mappings || [];
  const employees = db.rhh_employees || [];

  let rows = parseChecadorCSV(csv_text);
  if (rows.length === 0) return res.status(400).json({ error: 'No se encontraron registros válidos en el CSV' });

  if (date_from) rows = rows.filter(r => r.dateIso >= date_from);
  if (date_to)   rows = rows.filter(r => r.dateIso <= date_to);
  if (rows.length === 0) return res.status(400).json({ error: 'Sin registros en el rango de fechas indicado' });

  const records = processRows(rows, shifts, mappings);

  // Lista de trabajadores únicos del CSV
  const workerMap = {};
  for (const r of rows) {
    if (!workerMap[r.checadorId]) workerMap[r.checadorId] = r.checadorName;
  }

  const workers = Object.entries(workerMap).map(([cidStr, name]) => {
    const cid = parseInt(cidStr, 10);
    const map = mappings.find(m => m.checador_id === cid);
    const emp = map ? employees.find(e => e.id === map.employee_id) : null;
    return {
      checador_id:    cid,
      checador_name:  name,
      employee_id:    map ? map.employee_id : null,
      employee_name:  emp ? emp.full_name   : null,
      mapped:         !!map,
    };
  }).sort((a, b) => a.checador_id - b.checador_id);

  res.json({ total_rows: rows.length, total_sessions: records.length, workers, records });
});

// ── GET /api/rhh/checador/mappings ────────────────────────────────────────────
router.get('/mappings', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const mappings  = db.rhh_checador_mappings || [];
  const employees = db.rhh_employees || [];

  res.json(mappings.map(m => ({
    ...m,
    employee_name: (employees.find(e => e.id === m.employee_id) || {}).full_name || null,
  })));
});

// ── POST /api/rhh/checador/mappings  (bulk upsert) ────────────────────────────
router.post('/mappings', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { mappings } = req.body || {};
  if (!Array.isArray(mappings)) return res.status(400).json({ error: 'mappings debe ser un array' });

  const db = read();
  let existing = db.rhh_checador_mappings || [];

  for (const m of mappings) {
    const { checador_id, employee_id, checador_name } = m;
    if (!checador_id) continue;

    const idx = existing.findIndex(e => e.checador_id === Number(checador_id));
    const now = new Date().toISOString();

    if (idx !== -1) {
      existing[idx] = {
        ...existing[idx],
        employee_id:    employee_id ? Number(employee_id) : null,
        checador_name:  checador_name || existing[idx].checador_name,
        updated_at:     now,
        updated_by:     req.rhhUser.id,
      };
    } else {
      existing.push({
        id:            nextId(existing),
        checador_id:   Number(checador_id),
        checador_name: checador_name || '',
        employee_id:   employee_id ? Number(employee_id) : null,
        created_at:    now,
        created_by:    req.rhhUser.id,
      });
    }
  }

  db.rhh_checador_mappings = existing;
  write(db);

  res.json({ ok: true, count: existing.length });
});

// ── POST /api/rhh/checador/process  (guardar en DB) ──────────────────────────
router.post('/process', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { csv_text, replace, date_from, date_to } = req.body || {};
  if (!csv_text) return res.status(400).json({ error: 'csv_text es requerido' });

  const db       = read();
  const shifts   = db.rhh_shifts || [];
  const mappings = db.rhh_checador_mappings || [];

  let rows = parseChecadorCSV(csv_text);
  if (rows.length === 0) return res.status(400).json({ error: 'No se encontraron registros válidos' });

  if (date_from) rows = rows.filter(r => r.dateIso >= date_from);
  if (date_to)   rows = rows.filter(r => r.dateIso <= date_to);

  const processed = processRows(rows, shifts, mappings);

  const base   = replace ? [] : (db.rhh_checador_records || []);
  let nextRecId = base.length > 0 ? Math.max(...base.map(r => r.id || 0)) : 0;

  const newRecs = processed.map(r => ({
    ...r,
    id:          ++nextRecId,
    imported_at: new Date().toISOString(),
    imported_by: req.rhhUser.id,
  }));

  db.rhh_checador_records = replace ? newRecs : [...base, ...newRecs];
  write(db);

  res.json({ ok: true, count: newRecs.length, records: newRecs });
});

// ── GET /api/rhh/checador/records ────────────────────────────────────────────
router.get('/records', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  let records  = db.rhh_checador_records || [];
  const employees = db.rhh_employees || [];

  const { date_from, date_to, employee_id, status, checador_id } = req.query;
  if (date_from)    records = records.filter(r => r.date >= date_from);
  if (date_to)      records = records.filter(r => r.date <= date_to);
  if (employee_id)  records = records.filter(r => r.employee_id === Number(employee_id));
  if (checador_id)  records = records.filter(r => r.checador_id === Number(checador_id));
  if (status)       records = records.filter(r => r.status === status);

  res.json(records.map(r => ({
    ...r,
    worked_hhmm:  minToHHMM(r.worked_minutes),
    retardo_hhmm: r.retardo_minutes > 0 ? minToHHMM(r.retardo_minutes) : '00:00',
    employee_name: (employees.find(e => e.id === r.employee_id) || {}).full_name || r.checador_name,
  })));
});

// ── PATCH /api/rhh/checador/records/:id  (validar / ignorar) ─────────────────
router.patch('/records/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db  = read();
  const id  = Number(req.params.id);
  const recs = db.rhh_checador_records || [];
  const idx  = recs.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Registro no encontrado' });

  const { status, notes } = req.body || {};
  const VALID = ['pendiente', 'validado', 'ignorado'];
  if (status && !VALID.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

  if (status !== undefined) recs[idx].status = status;
  if (notes  !== undefined) recs[idx].notes  = notes;
  recs[idx].reviewed_by = req.rhhUser.id;
  recs[idx].reviewed_at = new Date().toISOString();

  db.rhh_checador_records = recs;
  write(db);
  res.json(recs[idx]);
});

// ── POST /api/rhh/checador/detect-absences  (inasistencias automáticas) ──────
router.post('/detect-absences', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { date_from, date_to } = req.body || {};
  if (!date_from || !date_to) return res.status(400).json({ error: 'date_from y date_to son requeridos' });

  const db        = read();
  const shifts    = db.rhh_shifts    || [];
  const employees = db.rhh_employees || [];
  const mappings  = db.rhh_checador_mappings || [];
  const records   = db.rhh_checador_records  || [];
  const holidays  = new Set((db.rhh_holidays || []).map(h => h.date));

  // Solo empleados activos con mapeo en el checador
  const mappedEmpIds = new Set(mappings.filter(m => m.employee_id).map(m => m.employee_id));
  const activeEmps   = employees.filter(e => e.status === 'active' && mappedEmpIds.has(e.id));

  const absences = [];
  // Usar mediodía UTC para evitar problemas de zona horaria
  const from = new Date(date_from + 'T12:00:00Z');
  const to   = new Date(date_to   + 'T12:00:00Z');

  for (const emp of activeEmps) {
    const shift = shifts.find(s => s.id === emp.shift_id);
    // Sin turno asignado → marcar como "sin_turno" (por definir)
    const workDays = shift ? (shift.work_days || []) : null;

    const cursor = new Date(from);
    while (cursor <= to) {
      const dayOfWeek = cursor.getUTCDay();
      const dateIso   = cursor.toISOString().slice(0, 10);

      const shouldWork = workDays
        ? workDays.includes(dayOfWeek) && !holidays.has(dateIso)
        : false; // sin turno definido → no generamos ausencia automática

      if (shouldWork) {
        const hasRecord = records.some(r => r.employee_id === emp.id && r.date === dateIso);
        if (!hasRecord) {
          absences.push({
            employee_id:   emp.id,
            employee_name: emp.full_name,
            date:          dateIso,
            shift_id:      shift.id,
            shift_name:    shift.name,
          });
        }
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  // Empleados activos con mapeo pero sin turno → listar para aviso
  const sinTurno = employees.filter(e =>
    e.status === 'active' && mappedEmpIds.has(e.id) && !shifts.find(s => s.id === e.shift_id)
  ).map(e => ({ employee_id: e.id, employee_name: e.full_name }));

  absences.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.employee_name || '').localeCompare(b.employee_name || '')
  );

  res.json({ count: absences.length, absences, sin_turno: sinTurno });
});

// ── DELETE /api/rhh/checador/records  (limpiar todos) ────────────────────────
router.delete('/records', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  db.rhh_checador_records = [];
  write(db);
  res.json({ ok: true });
});

module.exports = router;
