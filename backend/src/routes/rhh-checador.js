/* ═══════════════════════════════════════════════════════════════════════════
   RHH — Checador: importación y análisis de registros del reloj checador
   ═══════════════════════════════════════════════════════════════════════════ */
const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const { buildAttendanceEmployeesForWeek } = require('../utils/rhh-attendance-template');
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
 * Parsea archivo .dat de ZKTeco.
 * Formato: emp_id\tYYYY-MM-DD HH:MM:SS\t...  (tab-separated)
 */
function parseDatFile(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const empIdStr = parts[0].trim();
    const checadorId = parseInt(empIdStr, 10);
    if (isNaN(checadorId) || checadorId <= 0) continue;
    // parts[1] = "YYYY-MM-DD HH:MM:SS"
    const dtMatch = parts[1].trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):\d{2}$/);
    if (!dtMatch) continue;
    const dateIso = dtMatch[1];
    const h = parseInt(dtMatch[2], 10);
    const m = parseInt(dtMatch[3], 10);
    const timeMin = h * 60 + m;
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    rows.push({ checadorId, checadorName: '', dateIso, timeMin, timeStr });
  }
  return rows;
}

/**
 * Auto-detecta formato y parsea: .dat (tab + YYYY-MM-DD) o CSV (sName,sJobNo).
 */
function parseChecadorAuto(text) {
  if (!text || !text.trim()) return [];
  const firstLine = text.trim().split(/\r?\n/)[0] || '';
  // Si la primera linea tiene tabs y parece fecha YYYY-MM-DD → formato .dat
  if (firstLine.includes('\t') && /\d{4}-\d{2}-\d{2}/.test(firstLine)) {
    return parseDatFile(text);
  }
  return parseChecadorCSV(text);
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
 * Si se conoce el turno asignado, el SESSION_GAP se ajusta dinámicamente:
 *   gap = max(600, 24h - duración_turno - 1h_buffer)
 * Esto evita dividir sesiones de trabajadores que llegan muy antes de su turno.
 * Deduplica checadas con diferencia ≤ 1 min.
 */
function buildSessions(rows, assignedShift = null) {
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

  // Regla 1: misma fecha calendar → siempre misma sesión
  //   (cubre el caso de llegar antes del turno y salir al final del mismo)
  // Regla 2: fechas distintas → nueva sesión si la brecha > SESSION_GAP (10h)
  //   (cubre turnos nocturnos que cruzan medianoche)
  const SESSION_GAP = 600;

  const sessions = [[deduped[0]]];

  for (let i = 1; i < deduped.length; i++) {
    const prev = deduped[i - 1];
    const curr = deduped[i];

    if (prev.dateIso === curr.dateIso) {
      // Misma fecha → mismo turno sin importar la brecha horaria
      sessions[sessions.length - 1].push(curr);
    } else {
      const prevDT = new Date(`${prev.dateIso}T${prev.timeStr}:00`);
      const currDT = new Date(`${curr.dateIso}T${curr.timeStr}:00`);
      const gapMin = (currDT - prevDT) / 60000;
      if (gapMin > SESSION_GAP) {
        sessions.push([curr]);
      } else {
        sessions[sessions.length - 1].push(curr); // turno nocturno cruzando medianoche
      }
    }
  }

  return sessions;
}

/**
 * Procesa filas del CSV → registros estructurados por sesión/turno.
 * Usa el turno asignado al empleado (vía mapping + employees) para ajustar
 * el SESSION_GAP y confirmar el turno sin depender solo de la hora de entrada.
 */
function processRows(rows, shifts, mappings, employees = []) {
  // Agrupar por checadorId
  const byId = {};
  for (const r of rows) {
    if (!byId[r.checadorId]) byId[r.checadorId] = { name: r.checadorName, rows: [] };
    byId[r.checadorId].rows.push(r);
  }

  const records = [];

  for (const [cidStr, { name, rows: empRows }] of Object.entries(byId)) {
    const checadorId   = parseInt(cidStr, 10);
    const mapping      = mappings.find(m => m.checador_id === checadorId);
    const employeeId   = mapping ? mapping.employee_id : null;

    // Turno asignado en el sistema → prioridad sobre detección por hora
    const employee     = employeeId ? employees.find(e => e.id === employeeId) : null;
    const assignedShift = employee ? shifts.find(s => s.id === employee.shift_id) : null;

    const sessions = buildSessions(empRows, assignedShift);

    for (const session of sessions) {
      const entry   = session[0];
      const exit    = session[session.length - 1];
      const hasExit = session.length > 1;

      // Turno: usar el asignado en sistema si existe; si no, detectar por hora de entrada
      const shift = assignedShift || detectShift(shifts, entry.timeMin);

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

      // Calcular tiempo extra:
      //   - Salida tardía: exit > shift_end + 15 min → cuenta desde shift_end
      //   - Llegada anticipada >80 min (1h20) antes del turno → cuenta toda la anticipación
      //   - Llegar antes sin exceder 80 min NO es tiempo extra
      let overtimeMin = 0;
      let overtimeType = null; // 'salida' | 'llegada_anticipada' | 'ambos'

      if (shift && hasExit) {
        const overnight = timeToMin(shift.end_time) < timeToMin(shift.start_time);

        const entryDT = new Date(`${entry.dateIso}T${entry.timeStr}:00`);
        const exitDT  = new Date(`${exit.dateIso}T${exit.timeStr}:00`);

        // Fin de turno esperado (siguiente día si es nocturno)
        let expectedEndDT = new Date(`${entry.dateIso}T${shift.end_time}:00`);
        if (overnight) expectedEndDT.setDate(expectedEndDT.getDate() + 1);

        // Salida tardía
        const lateMin = Math.round((exitDT - expectedEndDT) / 60000);
        if (lateMin > 15) { overtimeMin += lateMin; overtimeType = 'salida'; }

        // Llegada anticipada excepcional (>80 min antes del inicio del turno)
        const expectedStartDT = new Date(`${entry.dateIso}T${shift.start_time}:00`);
        const earlyMin = Math.round((expectedStartDT - entryDT) / 60000);
        if (earlyMin > 80) {
          overtimeMin += earlyMin;
          overtimeType = overtimeType ? 'ambos' : 'llegada_anticipada';
        }
      }

      // Tope legal: máximo 12 horas extra por día
      if (overtimeMin > 720) overtimeMin = 720;

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
        overtime_type:    overtimeType,
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

  const records = processRows(rows, shifts, mappings, employees);

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
  const employees = db.rhh_employees || [];

  let rows = parseChecadorCSV(csv_text);
  if (rows.length === 0) return res.status(400).json({ error: 'No se encontraron registros válidos' });

  if (date_from) rows = rows.filter(r => r.dateIso >= date_from);
  if (date_to)   rows = rows.filter(r => r.dateIso <= date_to);

  const processed = processRows(rows, shifts, mappings, employees);

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

  const { status, notes, overtime_minutes } = req.body || {};
  const VALID = ['pendiente', 'validado', 'ignorado'];
  if (status && !VALID.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

  if (status           !== undefined) recs[idx].status           = status;
  if (notes            !== undefined) recs[idx].notes            = notes;
  if (overtime_minutes !== undefined) { recs[idx].overtime_minutes = overtime_minutes; recs[idx].overtime_type = null; }
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

// ── POST /api/rhh/admin/cleanup  (limpiar colecciones de registros) ──────────
router.post('/admin/cleanup', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { collections } = req.body || {};
  const ALLOWED = [
    'rhh_incidences', 'rhh_weekly_rol', 'rhh_rol_slots', 'rhh_rol_assignments',
    'rhh_checador_records', 'rhh_overtime', 'rhh_attendance', 'rhh_attendance_log',
    'rhh_vacation_requests', 'rhh_payroll_clarifications', 'rhh_notifications',
    'rhh_te_applications', 'rhh_te_authorizations',
  ];
  if (!Array.isArray(collections) || collections.length === 0)
    return res.status(400).json({ error: 'Indica al menos una colección a limpiar' });

  const invalid = collections.filter(c => !ALLOWED.includes(c));
  if (invalid.length > 0)
    return res.status(400).json({ error: `Colecciones no permitidas: ${invalid.join(', ')}` });

  const db = read();
  const cleared = {};
  for (const col of collections) {
    cleared[col] = (db[col] || []).length;
    db[col] = [];
  }
  write(db);
  res.json({ ok: true, cleared });
});

// ── DELETE /api/rhh/checador/records  (limpiar todos) ────────────────────────
router.delete('/records', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  db.rhh_checador_records = [];
  write(db);
  res.json({ ok: true });
});

// ── POST /api/rhh/checador/analyze-week ─────────────────────────────────────
// Cruza archivos .dat/.csv (Asistencia + Comedor) con turnos del ROL semanal.
// No guarda nada en DB — solo analiza y retorna el reporte.
router.post('/analyze-week', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { asistencia_text, comedor_text, week_start } = req.body || {};
  if (!week_start) return res.status(400).json({ error: 'week_start es requerido' });
  if (!asistencia_text && !comedor_text) return res.status(400).json({ error: 'Sube al menos un archivo' });

  const db = read();
  const shifts    = db.rhh_shifts || [];
  const employees = db.rhh_employees || [];
  const mappings  = db.rhh_checador_mappings || [];
  const holidays  = db.rhh_holidays || [];
  const schedule  = db.rhh_schedule || [];

  // Calcular rango de la semana (lunes a domingo)
  const wsDate = new Date(week_start + 'T12:00:00');
  const weekDates = [];
  const DAY_NAMES = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(wsDate);
    d.setDate(wsDate.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const holiday = holidays.find(h => h.date === dateStr);
    weekDates.push({
      date: dateStr,
      label: `${DAY_NAMES[d.getDay()]} ${d.getDate()}`,
      day_num: d.getDay(),
      is_holiday: !!holiday,
      holiday_name: holiday ? holiday.name : null,
    });
  }
  const weekEnd = weekDates[6].date;

  // Parsear ambos archivos
  const asistRows = asistencia_text ? parseChecadorAuto(asistencia_text) : [];
  const comedorRows = comedor_text ? parseChecadorAuto(comedor_text) : [];

  // Filtrar solo registros de esta semana
  const inWeek = r => r.dateIso >= week_start && r.dateIso <= weekEnd;
  const asistWeek   = asistRows.filter(inWeek);
  const comedorWeek = comedorRows.filter(inWeek);

  // Construir mapa checadorId → employeeId (auto-match por employee_number + mappings guardados)
  const resolvedMap = {}; // checadorId → { employee_id, employee_name, source }
  const unmapped = [];

  // Recopilar todos los checadorIds unicos de ambos archivos
  const allChecadorIds = new Set();
  for (const r of asistRows) allChecadorIds.add(r.checadorId);
  for (const r of comedorRows) allChecadorIds.add(r.checadorId);

  for (const cid of allChecadorIds) {
    // 1. Mapeo guardado
    const saved = mappings.find(m => m.checador_id === cid);
    if (saved && saved.employee_id) {
      const emp = employees.find(e => e.id === saved.employee_id);
      resolvedMap[cid] = { employee_id: saved.employee_id, employee_name: emp ? emp.full_name : `#${saved.employee_id}`, source: 'mapping' };
      continue;
    }
    // 2. Auto-match: checadorId === employee_number (como entero)
    const empByNum = employees.find(e => e.employee_number && parseInt(e.employee_number, 10) === cid);
    if (empByNum) {
      resolvedMap[cid] = { employee_id: empByNum.id, employee_name: empByNum.full_name, source: 'auto' };
      continue;
    }
    // 3. Sin mapear
    const datName = asistRows.find(r => r.checadorId === cid)?.checadorName
                 || comedorRows.find(r => r.checadorId === cid)?.checadorName || '';
    unmapped.push({ checador_id: cid, checador_name: datName });
  }

  // Obtener empleados de la plantilla semanal (turnos reales por semana)
  const template = buildAttendanceEmployeesForWeek(db, week_start);
  const templateEmps = template.employees || [];

  // Agrupar checadas de asistencia por employeeId + fecha → sesiones (entrada/salida)
  const asistByEmpDate = {}; // `${empId}_${date}` → [checadas]
  for (const r of asistWeek) {
    const resolved = resolvedMap[r.checadorId];
    if (!resolved) continue;
    const key = `${resolved.employee_id}_${r.dateIso}`;
    if (!asistByEmpDate[key]) asistByEmpDate[key] = [];
    asistByEmpDate[key].push(r);
  }

  // Agrupar checadas de comedor por employeeId + fecha
  const comedorByEmpDate = {}; // `${empId}_${date}` → [checadas]
  for (const r of comedorWeek) {
    const resolved = resolvedMap[r.checadorId];
    if (!resolved) continue;
    const key = `${resolved.employee_id}_${r.dateIso}`;
    if (!comedorByEmpDate[key]) comedorByEmpDate[key] = [];
    comedorByEmpDate[key].push(r);
  }

  // Construir reporte por empleado
  const reportByShift = {};
  for (const shift of shifts) {
    reportByShift[shift.id] = { shift: { id: shift.id, name: shift.name, code: shift.code, color: shift.color, start_time: shift.start_time, end_time: shift.end_time }, employees: [] };
  }
  reportByShift['none'] = { shift: { id: null, name: 'Sin turno', code: '--', color: '#94a3b8', start_time: null, end_time: null }, employees: [] };

  // Contadores globales
  let totalComplete = 0, totalMissing = 0, totalPartial = 0, totalNoComedor = 0, totalRetardos = 0;
  let totalScheduledDays = 0;

  for (const emp of templateEmps) {
    if (emp.template_status === 'baja') continue;
    const shift = shifts.find(s => s.id === emp.shift_id) || null;
    const workDays = shift ? (shift.work_days || []) : [];

    // Revisar si tiene sobrescritura de turno por fecha
    const getShiftForDate = (dateStr) => {
      const override = schedule.find(s => s.employee_id === emp.id && s.date === dateStr);
      if (override) return shifts.find(s => s.id === override.shift_id) || shift;
      return shift;
    };

    const days = [];
    let empScheduled = 0, empChecked = 0;

    for (const day of weekDates) {
      const dayShift = getShiftForDate(day.date);
      const dayWorkDays = dayShift ? (dayShift.work_days || []) : [];
      const shouldWork = dayWorkDays.includes(day.day_num) && !day.is_holiday;

      const key = `${emp.id}_${day.date}`;
      const asistChecks = asistByEmpDate[key] || [];
      const comedorChecks = comedorByEmpDate[key] || [];

      // Procesar asistencia: primera = entrada, ultima = salida (si > 1)
      asistChecks.sort((a, b) => a.timeMin - b.timeMin);
      comedorChecks.sort((a, b) => a.timeMin - b.timeMin);

      const entry = asistChecks.length > 0 ? asistChecks[0].timeStr : null;
      const exit  = asistChecks.length > 1 ? asistChecks[asistChecks.length - 1].timeStr : null;
      const comedor = comedorChecks.length > 0 ? comedorChecks[0].timeStr : null;
      const hasAsist = asistChecks.length > 0;

      // Detectar retardo
      let retardo = false;
      if (hasAsist && dayShift) {
        const shiftStart = timeToMin(dayShift.start_time);
        const entryMin = asistChecks[0].timeMin;
        if (entryMin - shiftStart > 15) retardo = true;
      }

      // Determinar status de la celda
      let status;
      if (day.is_holiday) {
        status = 'festivo';
      } else if (!shouldWork) {
        status = 'descanso';
      } else if (!hasAsist) {
        status = 'sin_checada';
        totalMissing++;
      } else if (!exit) {
        status = 'parcial';
        totalPartial++;
      } else if (retardo) {
        status = 'retardo';
        totalRetardos++;
      } else {
        status = 'ok';
        totalComplete++;
      }

      if (shouldWork) {
        totalScheduledDays++;
        empScheduled++;
        if (hasAsist) empChecked++;
        if (hasAsist && !comedor) totalNoComedor++;
      }

      days.push({
        date: day.date,
        label: day.label,
        day_num: day.day_num,
        is_holiday: day.is_holiday,
        holiday_name: day.holiday_name,
        should_work: shouldWork,
        status,
        entry, exit, comedor, retardo,
        checada_count: asistChecks.length,
        shift_override: dayShift && shift && dayShift.id !== shift.id ? dayShift.code : null,
      });
    }

    const empData = {
      id: emp.id,
      employee_number: emp.employee_number || '',
      full_name: emp.full_name,
      shift_code: shift ? shift.code : '--',
      shift_name: shift ? shift.name : 'Sin turno',
      days,
      scheduled: empScheduled,
      checked: empChecked,
    };

    const groupKey = shift ? shift.id : 'none';
    if (!reportByShift[groupKey]) {
      reportByShift[groupKey] = { shift: reportByShift['none'].shift, employees: [] };
    }
    reportByShift[groupKey].employees.push(empData);
  }

  // Ordenar empleados dentro de cada turno y filtrar turnos vacios
  const shiftGroups = Object.values(reportByShift)
    .filter(g => g.employees.length > 0)
    .map(g => {
      g.employees.sort((a, b) => a.full_name.localeCompare(b.full_name));
      return g;
    })
    .sort((a, b) => (a.shift.id || 999) - (b.shift.id || 999));

  res.json({
    week_start,
    week_end: weekEnd,
    days: weekDates,
    shift_groups: shiftGroups,
    unmapped,
    summary: {
      total_employees: templateEmps.filter(e => e.template_status !== 'baja').length,
      total_scheduled_days: totalScheduledDays,
      complete: totalComplete,
      missing: totalMissing,
      partial: totalPartial,
      no_comedor: totalNoComedor,
      retardos: totalRetardos,
    },
    asistencia_records: asistWeek.length,
    comedor_records: comedorWeek.length,
  });
});

module.exports = router;
