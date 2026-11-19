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
    'rhh_checador_records', 'rhh_checador_weekly', 'rhh_overtime', 'rhh_attendance', 'rhh_attendance_log',
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

// ── Helpers compartidos ───────────────────────────────────────────────────────

function buildWeekDates(week_start, holidays) {
  if (!holidays) holidays = (read().rhh_holidays || []);
  const wsDate = new Date(week_start + 'T12:00:00');
  const DAY_NAMES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const weekDates = [];
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
  return weekDates;
}

const INCIDENCE_LABELS = {
  festivo: 'Festivo', vacaciones: 'Vacaciones', permiso: 'Permiso',
  permiso_sin_goce: 'Permiso s/g', incapacidad: 'Incapacidad',
  falta: 'Falta', cumpleanos: 'Cumpleaños', cumpleanos_trabajado: 'Cumpl. trabajado',
  cumpleanos_descanso: 'Cumpl. descanso', descanso: 'Descanso',
  retardo: 'Retardo (inc)', baja: 'Baja', paro_tecnico: 'Paro técnico',
  labora: 'Labora', vacio: '', turno_incompleto: 'T. incompleto',
  vacaciones_pendiente: 'Vac. pend.', permiso_pendiente: 'Permiso pend.',
  falta_pendiente: 'Falta pend.',
};

// Status que justifican la ausencia de checada (no generan alerta)
const JUSTIFIED_STATUSES = new Set([
  'festivo', 'vacaciones', 'permiso', 'permiso_sin_goce', 'incapacidad',
  'cumpleanos', 'cumpleanos_descanso', 'baja', 'paro_tecnico', 'descanso',
  'vacaciones_pendiente', 'permiso_pendiente', 'falta',
]);

/**
 * Construye reporte semanal cruzando checadas con la MISMA lógica de
 * GET /api/rhh/schedule/weekly-attendance (turno, incidencias, T.E.).
 * Sobre esa base evalúa checadas, retardos y alertas.
 */
function buildWeekReport(db, week_start) {
  const shifts    = db.rhh_shifts || [];
  const holidays  = db.rhh_holidays || [];
  const weekDates = buildWeekDates(week_start, holidays);
  const weekEnd   = weekDates[6].date;

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

  // ── Misma plantilla que weekly-attendance (ROL + catálogo + snapshot) ──
  const weekRols = (db.rhh_weekly_rol || []).filter(r => r.week_start === week_start && r.shift_id != null);
  const weekRolIds = new Set(weekRols.map(r => r.id));
  const assignedForWeek = (db.rhh_rol_assignments || [])
    .filter(a => weekRolIds.has(a.rol_id))
    .map(a => a.employee_id);
  const template = buildAttendanceEmployeesForWeek(db, week_start, assignedForWeek);
  const employees = template.employees || [];

  // DEBUG: diagnóstico de turnos
  const shiftStats = {};
  for (const e of employees) {
    const k = e.shift_id == null ? 'null' : String(e.shift_id);
    shiftStats[k] = (shiftStats[k] || 0) + 1;
  }
  console.log(`[checador] buildWeekReport week=${week_start} emps=${employees.length} rols=${weekRols.length} assigned=${assignedForWeek.length} shifts:`, shiftStats);

  const attendanceRecords = db.rhh_attendance || [];
  const incidences = db.rhh_incidences || [];

  // Checadas guardadas para esta semana
  const savedChecadas = (db.rhh_checador_weekly || []).filter(
    c => c.date >= week_start && c.date <= weekEnd
  );
  const checadaMap = {};
  for (const c of savedChecadas) {
    checadaMap[`${c.employee_id}_${c.date}`] = c;
  }

  // Construir reporte por turno
  const reportByShift = {};
  for (const shift of shifts) {
    reportByShift[shift.id] = { shift: { id: shift.id, name: shift.name, code: shift.code, color: shift.color, start_time: shift.start_time, end_time: shift.end_time }, employees: [] };
  }
  reportByShift['none'] = { shift: { id: null, name: 'Sin turno', code: '--', color: '#94a3b8', start_time: null, end_time: null }, employees: [] };

  let totalComplete = 0, totalMissing = 0, totalPartial = 0, totalNoComedor = 0;
  let totalRetardos = 0, totalScheduledDays = 0, totalJustified = 0, totalAlerts = 0;
  let totalTE = 0;

  for (const emp of employees) {
    if (emp.template_status === 'baja') continue;

    // Turno: exactamente igual que weekly-attendance (emp.shift_id del template)
    const shift = shifts.find(s => s.id === emp.shift_id) || null;

    const days = [];
    let empScheduled = 0, empChecked = 0, empTE = 0;

    for (const day of weekDates) {
      const dateStr = day.date;
      const dayOfWeek = day.day_num;

      // ══ PASO 1: Status base idéntico a weekly-attendance ══
      let attStatus = 'vacio';
      const isFutureDate = dateStr > todayStr;

      if (shift && !isFutureDate) {
        const workDays = Array.isArray(shift.work_days) ? shift.work_days : [];
        if (day.is_holiday) {
          attStatus = 'festivo';
        } else if (workDays.includes(dayOfWeek)) {
          attStatus = 'labora';
        } else {
          attStatus = 'descanso';
        }
      }

      // ══ PASO 2: Registro explícito en rhh_attendance ══
      const attRecord = attendanceRecords.find(a =>
        a.employee_id === emp.id && (a.date === dateStr || a.fecha === dateStr)
      );
      let teHours = 0;
      let notes = null;
      if (attRecord) {
        attStatus = attRecord.status || attRecord.incidencia_type || attStatus;
        teHours = attRecord.te_hours || 0;
        notes = attRecord.notes || attRecord.notas || null;
      }

      // ══ PASO 3: Incidencias APROBADAS ══
      const coveringApproved = incidences.filter(i =>
        i.employee_id === emp.id &&
        i.status === 'aprobada' &&
        i.date <= dateStr &&
        (i.date_end || i.date) >= dateStr
      );
      if (coveringApproved.length > 0) {
        const inc = coveringApproved[coveringApproved.length - 1];
        if (inc.type === 'vacacion') attStatus = 'vacaciones';
        else if (inc.type === 'incapacidad') attStatus = 'incapacidad';
        else if (inc.type === 'permiso_con_goce' || inc.type === 'permiso_sin_goce' || inc.type === 'permiso') attStatus = 'permiso';
        else if (inc.type === 'falta') attStatus = 'falta';
        else if (inc.type === 'retardo') attStatus = 'retardo';
      }

      // ══ PASO 3b: Incidencias PENDIENTES ══
      if (coveringApproved.length === 0 && !attRecord) {
        const coveringPending = incidences.filter(i =>
          i.employee_id === emp.id &&
          i.status === 'pendiente' &&
          i.date <= dateStr &&
          (i.date_end || i.date) >= dateStr
        );
        if (coveringPending.length > 0) {
          const inc = coveringPending[coveringPending.length - 1];
          if (inc.type === 'vacacion') attStatus = 'vacaciones_pendiente';
          else if (inc.type === 'permiso' || inc.type === 'permiso_con_goce' || inc.type === 'permiso_sin_goce') attStatus = 'permiso_pendiente';
          else if (inc.type === 'falta') attStatus = 'falta_pendiente';
        }
      }

      // ══ PASO 4: Cumpleaños ══
      let birthday = false;
      if (emp.birth_date) {
        const bMD = emp.birth_date.slice(5);
        if (bMD === dateStr.slice(5)) {
          birthday = true;
          if (!attRecord && attStatus !== 'baja') attStatus = 'cumpleanos';
        }
      }

      // attStatus ahora es IDÉNTICO al de Lista de Asistencia

      // ══ PASO 5: Superponer checadas del checador ══
      const shouldWork = attStatus === 'labora' || attStatus === 'retardo'
                       || attStatus === 'cumpleanos_trabajado';
      const key = `${emp.id}_${dateStr}`;
      const checada = checadaMap[key];
      const entry   = checada ? checada.entry : null;
      const exit    = checada ? checada.exit : null;
      const comedor = checada ? checada.comedor : null;
      const hasAsist = !!entry;

      // Detectar retardo por checada
      let retardo = false;
      if (hasAsist && shift) {
        const shiftStart = timeToMin(shift.start_time);
        const entryMin = timeToMin(entry);
        if (entryMin - shiftStart > 15) retardo = true;
      }

      // ══ PASO 6: Status final combinando asistencia + checada ══
      let checadorStatus;
      if (JUSTIFIED_STATUSES.has(attStatus)) {
        // La incidencia/asistencia justifica — mostrar el status del sistema
        checadorStatus = attStatus;
        if (shouldWork) totalJustified++;
      } else if (shouldWork && !hasAsist) {
        // Debería trabajar, sin checada
        checadorStatus = 'sin_checada';
        totalMissing++;
      } else if (shouldWork && hasAsist && !exit) {
        checadorStatus = 'parcial';
        totalPartial++;
      } else if (shouldWork && retardo) {
        checadorStatus = 'retardo_checador';
        totalRetardos++;
      } else if (shouldWork && hasAsist) {
        checadorStatus = 'ok';
        totalComplete++;
      } else {
        checadorStatus = attStatus; // descanso, vacio, etc.
      }

      // Alerta: asistencia marcada "labora" pero sin registro en checador
      let alerta_sin_registro = false;
      if (attStatus === 'labora' && !hasAsist && savedChecadas.length > 0) {
        alerta_sin_registro = true;
        totalAlerts++;
      }

      if (shouldWork) {
        totalScheduledDays++;
        empScheduled++;
        if (hasAsist) empChecked++;
        if (hasAsist && !comedor) totalNoComedor++;
      }
      empTE += teHours;

      days.push({
        date: dateStr,
        label: day.label,
        day_num: dayOfWeek,
        is_holiday: day.is_holiday,
        holiday_name: day.holiday_name,
        should_work: shouldWork,
        att_status: attStatus,
        att_label: INCIDENCE_LABELS[attStatus] || attStatus,
        status: checadorStatus,
        entry, exit, comedor, retardo,
        te_hours: teHours,
        notes,
        birthday,
        alerta_sin_registro,
        checada_count: checada ? (checada.asist_times || []).length : 0,
      });
    }

    totalTE += empTE;

    const empData = {
      id: emp.id,
      employee_number: emp.employee_number || '',
      full_name: emp.full_name,
      shift_id: emp.shift_id || null,
      shift_code: shift ? shift.code : '--',
      shift_name: shift ? shift.name : 'Sin turno',
      days,
      scheduled: empScheduled,
      checked: empChecked,
      te_total: empTE,
    };

    // Agrupar por shift_id — idéntico a weekly-attendance (línea 760)
    const groupKey = emp.shift_id || 'none';
    if (!reportByShift[groupKey]) {
      reportByShift[groupKey] = { shift: shift || reportByShift['none'].shift, employees: [] };
    }
    reportByShift[groupKey].employees.push(empData);
  }

  // Ordenar por turno, luego por nombre
  const sortedShiftIds = [...shifts.map(s => s.id), 'none'];
  const shiftGroups = [];
  for (const sid of sortedShiftIds) {
    const g = reportByShift[sid];
    if (g && g.employees.length > 0) {
      g.employees.sort((a, b) => a.full_name.localeCompare(b.full_name));
      shiftGroups.push(g);
    }
  }

  const hasSavedData = savedChecadas.length > 0;

  return {
    week_start,
    week_end: weekEnd,
    days: weekDates,
    shift_groups: shiftGroups,
    has_data: hasSavedData,
    summary: {
      total_employees: employees.filter(e => e.template_status !== 'baja').length,
      total_scheduled_days: totalScheduledDays,
      complete: totalComplete,
      missing: totalMissing,
      partial: totalPartial,
      no_comedor: totalNoComedor,
      retardos: totalRetardos,
      justified: totalJustified,
      alerts: totalAlerts,
      te_total: totalTE,
    },
    checadas_count: savedChecadas.length,
  };
}

// ── GET /api/rhh/checador/week-report?week_start=YYYY-MM-DD ─────────────────
// Retorna reporte de la semana con datos guardados (sin necesidad de subir archivo).
router.get('/week-report', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: 'week_start es requerido' });
  const db = read();
  const report = buildWeekReport(db, week_start);
  res.json(report);
});

// ── POST /api/rhh/checador/analyze-week ─────────────────────────────────────
// Parsea archivos .dat, GUARDA checadas en DB (merge) y retorna reporte.
router.post('/analyze-week', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { asistencia_text, comedor_text, week_start } = req.body || {};
  if (!week_start) return res.status(400).json({ error: 'week_start es requerido' });
  if (!asistencia_text && !comedor_text) return res.status(400).json({ error: 'Sube al menos un archivo' });

  const db = read();
  const employees = db.rhh_employees || [];
  const mappings  = db.rhh_checador_mappings || [];

  const weekDates = buildWeekDates(week_start, db.rhh_holidays || []);
  const weekEnd   = weekDates[6].date;

  // Parsear archivos
  const asistRows   = asistencia_text ? parseChecadorAuto(asistencia_text) : [];
  const comedorRows = comedor_text ? parseChecadorAuto(comedor_text) : [];

  const inWeek = r => r.dateIso >= week_start && r.dateIso <= weekEnd;
  const asistWeek   = asistRows.filter(inWeek);
  const comedorWeek = comedorRows.filter(inWeek);

  // Resolver checadorId → employeeId
  const resolvedMap = {};
  const unmapped = [];
  const allChecadorIds = new Set();
  for (const r of asistRows) allChecadorIds.add(r.checadorId);
  for (const r of comedorRows) allChecadorIds.add(r.checadorId);

  for (const cid of allChecadorIds) {
    const saved = mappings.find(m => m.checador_id === cid);
    if (saved && saved.employee_id) {
      const emp = employees.find(e => e.id === saved.employee_id);
      resolvedMap[cid] = { employee_id: saved.employee_id, employee_name: emp ? emp.full_name : `#${saved.employee_id}`, source: 'mapping' };
      continue;
    }
    const empByNum = employees.find(e => e.employee_number && parseInt(e.employee_number, 10) === cid);
    if (empByNum) {
      resolvedMap[cid] = { employee_id: empByNum.id, employee_name: empByNum.full_name, source: 'auto' };
      continue;
    }
    const datName = asistRows.find(r => r.checadorId === cid)?.checadorName
                 || comedorRows.find(r => r.checadorId === cid)?.checadorName || '';
    unmapped.push({ checador_id: cid, checador_name: datName });
  }

  // Agrupar checadas por employeeId + fecha
  const asistByEmpDate = {};
  for (const r of asistWeek) {
    const resolved = resolvedMap[r.checadorId];
    if (!resolved) continue;
    const key = `${resolved.employee_id}_${r.dateIso}`;
    if (!asistByEmpDate[key]) asistByEmpDate[key] = [];
    asistByEmpDate[key].push(r);
  }
  const comedorByEmpDate = {};
  for (const r of comedorWeek) {
    const resolved = resolvedMap[r.checadorId];
    if (!resolved) continue;
    const key = `${resolved.employee_id}_${r.dateIso}`;
    if (!comedorByEmpDate[key]) comedorByEmpDate[key] = [];
    comedorByEmpDate[key].push(r);
  }

  // ── Merge con datos existentes en DB ──
  if (!db.rhh_checador_weekly) db.rhh_checador_weekly = [];
  const existing = db.rhh_checador_weekly;
  const now = new Date().toISOString();
  let newCount = 0, updatedCount = 0;

  // Recopilar todos los emp+date con checadas nuevas
  const allKeys = new Set([...Object.keys(asistByEmpDate), ...Object.keys(comedorByEmpDate)]);

  for (const key of allKeys) {
    const [empIdStr, dateStr] = key.split('_');
    const empId = Number(empIdStr);
    const asistChecks = (asistByEmpDate[key] || []).sort((a, b) => a.timeMin - b.timeMin);
    const comedorChecks = (comedorByEmpDate[key] || []).sort((a, b) => a.timeMin - b.timeMin);

    const newAsistTimes = asistChecks.map(r => r.timeStr);
    const newComedorTimes = comedorChecks.map(r => r.timeStr);

    const idx = existing.findIndex(c => c.employee_id === empId && c.date === dateStr);

    if (idx !== -1) {
      // Merge: unir tiempos sin duplicados
      const rec = existing[idx];
      const mergedAsist = [...new Set([...(rec.asist_times || []), ...newAsistTimes])].sort();
      const mergedComedor = [...new Set([...(rec.comedor_times || []), ...newComedorTimes])].sort();
      rec.asist_times = mergedAsist;
      rec.comedor_times = mergedComedor;
      rec.entry = mergedAsist.length > 0 ? mergedAsist[0] : null;
      rec.exit  = mergedAsist.length > 1 ? mergedAsist[mergedAsist.length - 1] : null;
      rec.comedor = mergedComedor.length > 0 ? mergedComedor[0] : null;
      rec.updated_at = now;
      rec.updated_by = req.rhhUser.id;
      updatedCount++;
    } else {
      // Nuevo registro
      existing.push({
        id: nextId(existing),
        employee_id: empId,
        date: dateStr,
        asist_times: newAsistTimes,
        comedor_times: newComedorTimes,
        entry: newAsistTimes.length > 0 ? newAsistTimes[0] : null,
        exit:  newAsistTimes.length > 1 ? newAsistTimes[newAsistTimes.length - 1] : null,
        comedor: newComedorTimes.length > 0 ? newComedorTimes[0] : null,
        uploaded_at: now,
        uploaded_by: req.rhhUser.id,
      });
      newCount++;
    }
  }

  db.rhh_checador_weekly = existing;
  write(db);

  // Construir reporte con datos guardados
  const report = buildWeekReport(db, week_start);
  report.unmapped = unmapped;
  report.upload_summary = {
    new_records: newCount,
    updated_records: updatedCount,
    asistencia_parsed: asistWeek.length,
    comedor_parsed: comedorWeek.length,
  };

  res.json(report);
});

module.exports = router;
