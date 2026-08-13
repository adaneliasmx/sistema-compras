/* ══════════════════════════════════════════════════════════════════════════════
   RHH — Módulo Nómina Semanal
   Períodos, incidencias semanales, HE detalle, solicitudes vac/TE,
   comparación PDF Lista de Raya, dashboard KPIs, importación SQLite
   ══════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const multer  = require('multer');
const { read, write, writeAsync, nextId, getSystemEmpIds } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const { mergeWeeklyIncident } = require('../utils/rhh-data-integrity');
const {
  canonicalPeriod,
  comparePeriods,
  periodKey,
  resolveRequestedYear,
  samePeriod,
} = require('../utils/rhh-periods');
const router = express.Router();

// Multer — solo memoria (no guarda en disco)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// pdf-parse se carga dinámicamente solo cuando se usa (evita error si no está instalado)
function getPdfParse() {
  try { return require('pdf-parse'); }
  catch (_) { return null; }
}

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ── Períodos 2026 (semanas 1–30) ──────────────────────────────────────────────
const PERIODOS_2026 = [
  { no_periodo: 1,  fecha_inicio: '29/Dic/2025', fecha_fin: '04/Ene/2026' },
  { no_periodo: 2,  fecha_inicio: '05/Ene/2026', fecha_fin: '11/Ene/2026' },
  { no_periodo: 3,  fecha_inicio: '12/Ene/2026', fecha_fin: '18/Ene/2026' },
  { no_periodo: 4,  fecha_inicio: '19/Ene/2026', fecha_fin: '25/Ene/2026' },
  { no_periodo: 5,  fecha_inicio: '26/Ene/2026', fecha_fin: '01/Feb/2026' },
  { no_periodo: 6,  fecha_inicio: '02/Feb/2026', fecha_fin: '08/Feb/2026' },
  { no_periodo: 7,  fecha_inicio: '09/Feb/2026', fecha_fin: '15/Feb/2026' },
  { no_periodo: 8,  fecha_inicio: '16/Feb/2026', fecha_fin: '22/Feb/2026' },
  { no_periodo: 9,  fecha_inicio: '23/Feb/2026', fecha_fin: '01/Mar/2026' },
  { no_periodo: 10, fecha_inicio: '02/Mar/2026', fecha_fin: '08/Mar/2026' },
  { no_periodo: 11, fecha_inicio: '09/Mar/2026', fecha_fin: '15/Mar/2026' },
  { no_periodo: 12, fecha_inicio: '16/Mar/2026', fecha_fin: '22/Mar/2026' },
  { no_periodo: 13, fecha_inicio: '23/Mar/2026', fecha_fin: '29/Mar/2026' },
  { no_periodo: 14, fecha_inicio: '30/Mar/2026', fecha_fin: '05/Abr/2026' },
  { no_periodo: 15, fecha_inicio: '06/Abr/2026', fecha_fin: '12/Abr/2026' },
  { no_periodo: 16, fecha_inicio: '13/Abr/2026', fecha_fin: '19/Abr/2026' },
  { no_periodo: 17, fecha_inicio: '20/Abr/2026', fecha_fin: '26/Abr/2026' },
  { no_periodo: 18, fecha_inicio: '27/Abr/2026', fecha_fin: '03/May/2026' },
  { no_periodo: 19, fecha_inicio: '04/May/2026', fecha_fin: '10/May/2026' },
  { no_periodo: 20, fecha_inicio: '11/May/2026', fecha_fin: '17/May/2026' },
  { no_periodo: 21, fecha_inicio: '18/May/2026', fecha_fin: '24/May/2026' },
  { no_periodo: 22, fecha_inicio: '25/May/2026', fecha_fin: '31/May/2026' },
  { no_periodo: 23, fecha_inicio: '01/Jun/2026', fecha_fin: '07/Jun/2026' },
  { no_periodo: 24, fecha_inicio: '08/Jun/2026', fecha_fin: '14/Jun/2026' },
  { no_periodo: 25, fecha_inicio: '15/Jun/2026', fecha_fin: '21/Jun/2026' },
  { no_periodo: 26, fecha_inicio: '22/Jun/2026', fecha_fin: '28/Jun/2026' },
  { no_periodo: 27, fecha_inicio: '29/Jun/2026', fecha_fin: '05/Jul/2026' },
  { no_periodo: 28, fecha_inicio: '06/Jul/2026', fecha_fin: '12/Jul/2026' },
  { no_periodo: 29, fecha_inicio: '13/Jul/2026', fecha_fin: '19/Jul/2026' },
  { no_periodo: 30, fecha_inicio: '20/Jul/2026', fecha_fin: '26/Jul/2026' },
  { no_periodo: 31, fecha_inicio: '27/Jul/2026', fecha_fin: '02/Ago/2026' },
  { no_periodo: 32, fecha_inicio: '03/Ago/2026', fecha_fin: '09/Ago/2026' },
  { no_periodo: 33, fecha_inicio: '10/Ago/2026', fecha_fin: '16/Ago/2026' },
  { no_periodo: 34, fecha_inicio: '17/Ago/2026', fecha_fin: '23/Ago/2026' },
  { no_periodo: 35, fecha_inicio: '24/Ago/2026', fecha_fin: '30/Ago/2026' },
  { no_periodo: 36, fecha_inicio: '31/Ago/2026', fecha_fin: '06/Sep/2026' },
  { no_periodo: 37, fecha_inicio: '07/Sep/2026', fecha_fin: '13/Sep/2026' },
  { no_periodo: 38, fecha_inicio: '14/Sep/2026', fecha_fin: '20/Sep/2026' },
  { no_periodo: 39, fecha_inicio: '21/Sep/2026', fecha_fin: '27/Sep/2026' },
  { no_periodo: 40, fecha_inicio: '28/Sep/2026', fecha_fin: '04/Oct/2026' },
  { no_periodo: 41, fecha_inicio: '05/Oct/2026', fecha_fin: '11/Oct/2026' },
  { no_periodo: 42, fecha_inicio: '12/Oct/2026', fecha_fin: '18/Oct/2026' },
  { no_periodo: 43, fecha_inicio: '19/Oct/2026', fecha_fin: '25/Oct/2026' },
  { no_periodo: 44, fecha_inicio: '26/Oct/2026', fecha_fin: '01/Nov/2026' },
  { no_periodo: 45, fecha_inicio: '02/Nov/2026', fecha_fin: '08/Nov/2026' },
  { no_periodo: 46, fecha_inicio: '09/Nov/2026', fecha_fin: '15/Nov/2026' },
  { no_periodo: 47, fecha_inicio: '16/Nov/2026', fecha_fin: '22/Nov/2026' },
  { no_periodo: 48, fecha_inicio: '23/Nov/2026', fecha_fin: '29/Nov/2026' },
  { no_periodo: 49, fecha_inicio: '30/Nov/2026', fecha_fin: '06/Dic/2026' },
  { no_periodo: 50, fecha_inicio: '07/Dic/2026', fecha_fin: '13/Dic/2026' },
  { no_periodo: 51, fecha_inicio: '14/Dic/2026', fecha_fin: '20/Dic/2026' },
  { no_periodo: 52, fecha_inicio: '21/Dic/2026', fecha_fin: '27/Dic/2026' },
];

// Catálogo de puestos extraído del sistema_rrhh
const PUESTOS_CATALOGO = [
  { name: 'Auxiliar de Almacén' },
  { name: 'Auxiliar de Limpieza' },
  { name: 'Ayudante General' },
  { name: 'Auxiliar de Empaque' },
  { name: 'Auxiliar de Calidad' },
  { name: 'Operador PTAR' },
  { name: 'Empacador' },
  { name: 'Fosfatador' },
  { name: 'Operador de Fosfatado' },
  { name: 'Operador Línea 1' },
  { name: 'Operador de Empaque' },
  { name: 'Supervisor de Producción' },
  { name: 'Supervisor de Turno' },
  { name: 'Supervisor' },
  { name: 'Coordinador' },
  { name: 'Ingeniero de Calidad' },
  { name: 'Intendencia' },
  { name: 'Becario/a' },
  { name: 'Técnico en Mantenimiento' },
  { name: 'Ingeniero de Mantenimiento' },
  { name: 'Coordinador de Seguridad y Medio Ambiente' },
  { name: 'Administradora RRHH' },
];

// Límite de HE sin autorización extra (hrs/semana)
const HE_LIMIT_SEM = 8;

// ── Períodos ──────────────────────────────────────────────────────────────────

// GET /api/rhh/nomina/periodos
router.get('/periodos', rhhAuthRequired, (req, res) => {
  const db = read();
  const dbPeriodos = db.rhh_periodos || [];
  const requestedYear = Number(req.query.year) || null;
  // Merge: PERIODOS_2026 como base (garantiza todos los periodos disponibles),
  // DB overrides para cualquier periodo que haya sido personalizado.
  const base = PERIODOS_2026.map((p, i) => canonicalPeriod({ id: i + 1, ...p, year: 2026 }));
  if (dbPeriodos.length === 0) return res.json(
    requestedYear && requestedYear !== 2026 ? [] : base
  );
  const dbMap = {};
  for (const raw of dbPeriodos) {
    const p = canonicalPeriod(raw);
    if (p) dbMap[p.period_key] = p;
  }
  const merged = base.map(p => dbMap[p.period_key] || p);
  // Agregar periodos de DB que no existan en la base hardcodeada
  for (const p of dbPeriodos) {
    const canonical = canonicalPeriod(p);
    if (canonical && !base.find(b => b.period_key === canonical.period_key)) merged.push(canonical);
  }
  const filtered = requestedYear ? merged.filter(p => p.year === requestedYear) : merged;
  filtered.sort(comparePeriods);
  res.json(filtered);
});

// POST /api/rhh/nomina/periodos/seed  (rh/admin)
router.post('/periodos/seed', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  db.rhh_periodos = PERIODOS_2026.map((p, i) => canonicalPeriod({ id: i + 1, ...p, year: 2026 }));
  write(db);
  res.json({ ok: true, count: db.rhh_periodos.length });
});

// ── Incidencias Semanales ─────────────────────────────────────────────────────

// GET /api/rhh/nomina/incidencias?no_periodo=X
router.get('/incidencias', rhhAuthRequired, (req, res) => {
  const db = read();
  const no_periodo = Number(req.query.no_periodo);
  if (!no_periodo) return res.status(400).json({ error: 'no_periodo requerido' });
  const year = resolveRequestedYear(db, no_periodo, req.query.year);

  const lista     = db.rhh_incidencias_semanales || [];
  const _sysIds   = getSystemEmpIds();
  const snapshots = (db.rhh_employee_period_snapshots || []).filter(s =>
    samePeriod(s, no_periodo, year) && !_sysIds.has(Number(s.employee_id))
  );
  const employees = snapshots.length > 0
    ? snapshots.map(s => ({
        ...(db.rhh_employees || []).find(e => e.id === Number(s.employee_id)),
        id: Number(s.employee_id),
        full_name: s.full_name,
        employee_number: s.employee_number,
        department_id: s.department_id,
        position_id: s.position_id,
        _snapshot: s,
      }))
    : (db.rhh_employees || []).filter(e => e.status === 'active' && !_sysIds.has(Number(e.id)));
  const depts     = db.rhh_departments || [];

  const result = employees.map(emp => {
    const inc = lista.find(i => samePeriod(i, no_periodo, year) && i.employee_id === emp.id) || {};
    const dept = depts.find(d => d.id === emp.department_id);
    return {
      id:                  inc.id || null,
      no_periodo,
      year,
      period_key: periodKey(year, no_periodo),
      employee_id:         emp.id,
      dias_pagados:        inc.dias_pagados        ?? 7,
      faltas:              inc.faltas              ?? 0,
      horas_extras_total:  inc.horas_extras_total  ?? 0,
      despensa:            inc.despensa            ?? 1,
      bono_puntualidad_dias: inc.bono_puntualidad_dias ?? null,
      bono_eficiencia_dias:  inc.bono_eficiencia_dias  ?? null,
      bono_instructor:     inc.bono_instructor     ?? null,
      prima_dominical:     inc.prima_dominical     ?? 0,
      vacaciones_dias:     inc.vacaciones_dias     ?? null,
      gratificacion:       inc.gratificacion       ?? null,
      notas:               inc.notas               || '',
      updated_at:          inc.updated_at          || null,
      employee: { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number },
      department: dept ? { id: dept.id, name: dept.name } : null,
    };
  }).sort((a, b) => {
    const da = a.department?.name || '';
    const db2 = b.department?.name || '';
    if (da !== db2) return da.localeCompare(db2);
    return (a.employee?.full_name || '').localeCompare(b.employee?.full_name || '');
  });

  res.json(result);
});

// POST /api/rhh/nomina/incidencias/bulk  — guarda múltiples filas de un período
router.post('/incidencias/bulk', rhhAuthRequired, rhhRequireRole('rh', 'admin', 'supervisor'), async (req, res) => {
  const db = structuredClone(read());
  const { no_periodo, rows } = req.body || {};
  if (!no_periodo || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'no_periodo y rows[] requeridos' });
  }

  const lista = db.rhh_incidencias_semanales || [];
  const year = resolveRequestedYear(db, no_periodo, req.body?.year);
  let saved = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const empId = Number(row.employee_id);
    if (!empId) continue;
    const idx = lista.findIndex(i => samePeriod(i, Number(no_periodo), year) && i.employee_id === empId);

    const existing = idx !== -1 ? lista[idx] : null;
    const record = mergeWeeklyIncident(existing, row, {
      no_periodo: Number(no_periodo),
      year,
      period_key: periodKey(year, no_periodo),
      updated_by: req.rhhUser.id,
      now,
      id: existing?.id ?? nextId(lista),
    });

    if (idx !== -1) {
      lista[idx] = record;
    } else {
      lista.push(record);
    }
    saved++;
  }

  db.rhh_incidencias_semanales = lista;
  try {
    await writeAsync(db);
    res.json({ ok: true, saved });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron guardar las incidencias: ' + error.message });
  }
});

// ── HE Detalle ────────────────────────────────────────────────────────────────

// GET /api/rhh/nomina/he-detalle?no_periodo=X&employee_id=Y
router.get('/he-detalle', rhhAuthRequired, (req, res) => {
  const db = read();
  let lista = db.rhh_he_detalle || [];
  const { no_periodo, employee_id } = req.query;
  if (no_periodo)   lista = lista.filter(h => h.no_periodo  === Number(no_periodo));
  if (employee_id)  lista = lista.filter(h => h.employee_id === Number(employee_id));
  res.json(lista.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')));
});

// POST /api/rhh/nomina/he-detalle
router.post('/he-detalle', rhhAuthRequired, rhhRequireRole('rh', 'admin', 'supervisor'), (req, res) => {
  const db = read();
  const { no_periodo, employee_id, fecha, total_horas, razon, sub_razon } = req.body || {};
  if (!no_periodo || !employee_id || !fecha || !total_horas) {
    return res.status(400).json({ error: 'no_periodo, employee_id, fecha y total_horas son requeridos' });
  }
  const lista = db.rhh_he_detalle || [];
  const record = {
    id:           nextId(lista),
    no_periodo:   Number(no_periodo),
    employee_id:  Number(employee_id),
    fecha:        String(fecha),
    total_horas:  Number(total_horas),
    razon:        razon    || null,
    sub_razon:    sub_razon || null,
    solicita:     req.rhhUser.full_name || req.rhhUser.email || null,
    created_at:   new Date().toISOString(),
  };
  lista.push(record);
  db.rhh_he_detalle = lista;
  write(db);
  res.status(201).json(record);
});

// DELETE /api/rhh/nomina/he-detalle/:id
router.delete('/he-detalle/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin', 'supervisor'), (req, res) => {
  const db = read();
  const idx = (db.rhh_he_detalle || []).findIndex(h => h.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.rhh_he_detalle.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ── Solicitudes de Vacaciones ─────────────────────────────────────────────────

// GET /api/rhh/nomina/vac-solicitudes
router.get('/vac-solicitudes', rhhAuthRequired, (req, res) => {
  const db    = read();
  let lista   = db.rhh_vac_solicitudes || [];
  const role  = req.rhhUser.role;

  if (role === 'empleado' && req.rhhUser.employee_id) {
    lista = lista.filter(s => s.employee_id === req.rhhUser.employee_id);
  } else if (role === 'supervisor' && req.rhhUser.employee_id) {
    const myIds = (db.rhh_employees || [])
      .filter(e => e.supervisor_id === req.rhhUser.employee_id)
      .map(e => e.id);
    myIds.push(req.rhhUser.employee_id);
    lista = lista.filter(s => myIds.includes(s.employee_id));
  }

  const { estado, created_from } = req.query;
  if (estado) lista = lista.filter(s => s.estado === estado);
  if (created_from) lista = lista.filter(s => (s.created_at || '') >= created_from);

  const _sysIds2  = getSystemEmpIds();
  const employees = (db.rhh_employees || []).filter(e => !_sysIds2.has(Number(e.id)));
  const depts     = db.rhh_departments || [];
  const periodos  = (db.rhh_periodos || []).length > 0
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));

  const enriched = lista.map(s => {
    const emp    = employees.find(e => e.id === s.employee_id);
    const dept   = emp ? depts.find(d => d.id === emp.department_id) : null;
    const periodo = periodos.find(p => p.no_periodo === s.no_periodo);
    return {
      ...s,
      employee:   emp  ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null,
      department: dept ? { id: dept.id, name: dept.name } : null,
      periodo:    periodo || null,
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json(enriched);
});

// POST /api/rhh/nomina/vac-solicitudes
router.post('/vac-solicitudes', rhhAuthRequired, (req, res) => {
  const db = read();
  const { no_periodo, dias, notas } = req.body || {};
  if (!no_periodo || !dias) return res.status(400).json({ error: 'no_periodo y dias son requeridos' });

  let employee_id = Number(req.body.employee_id) || null;
  if (req.rhhUser.role === 'empleado') employee_id = req.rhhUser.employee_id;
  if (!employee_id) return res.status(400).json({ error: 'employee_id requerido' });

  const lista = db.rhh_vac_solicitudes || [];
  const record = {
    id:           nextId(lista),
    employee_id,
    no_periodo:   Number(no_periodo),
    dias:         Number(dias),
    notas:        notas || null,
    estado:       'pendiente',
    autorizado_por:  null,
    autorizado_at:   null,
    created_by:   req.rhhUser.id,
    created_at:   new Date().toISOString(),
  };
  lista.push(record);
  db.rhh_vac_solicitudes = lista;
  write(db);
  res.status(201).json(record);
});

// PATCH /api/rhh/nomina/vac-solicitudes/:id  — supervisor/rh/admin aprueba
router.patch('/vac-solicitudes/:id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db  = read();
  const idx = (db.rhh_vac_solicitudes || []).findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Solicitud no encontrada' });

  const { estado, notas_respuesta } = req.body || {};
  if (!['aprobada', 'rechazada'].includes(estado)) {
    return res.status(400).json({ error: 'estado debe ser aprobada o rechazada' });
  }

  const s = { ...db.rhh_vac_solicitudes[idx] };
  s.estado         = estado;
  s.autorizado_por = req.rhhUser.id;
  s.autorizado_at  = new Date().toISOString();
  if (notas_respuesta) s.notas_respuesta = notas_respuesta;

  // Al aprobar: actualizar incidencia semanal
  if (estado === 'aprobada') {
    const lista  = db.rhh_incidencias_semanales || [];
    const incIdx = lista.findIndex(i => i.no_periodo === s.no_periodo && i.employee_id === s.employee_id);
    const diasVac = Number(s.dias) || 0;
    if (incIdx !== -1) {
      lista[incIdx].vacaciones_dias = (Number(lista[incIdx].vacaciones_dias) || 0) + diasVac;
      lista[incIdx].updated_at = new Date().toISOString();
    } else {
      lista.push({
        id: nextId(lista), no_periodo: s.no_periodo, employee_id: s.employee_id,
        dias_pagados: 7, faltas: 0, horas_extras_total: 0, despensa: 1,
        bono_puntualidad_dias: null, bono_eficiencia_dias: null, bono_instructor: null,
        prima_dominical: 0, vacaciones_dias: diasVac, gratificacion: null, notas: '',
        updated_by: req.rhhUser.id, updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
      });
    }
    db.rhh_incidencias_semanales = lista;
  }

  db.rhh_vac_solicitudes[idx] = s;
  write(db);
  res.json(s);
});

// ── Solicitudes de Tiempo Extra ───────────────────────────────────────────────

// GET /api/rhh/nomina/te-solicitudes
router.get('/te-solicitudes', rhhAuthRequired, (req, res) => {
  const db   = read();
  let lista  = db.rhh_te_solicitudes || [];
  const role = req.rhhUser.role;

  if (role === 'supervisor' && req.rhhUser.employee_id) {
    const myIds = (db.rhh_employees || [])
      .filter(e => e.supervisor_id === req.rhhUser.employee_id)
      .map(e => e.id);
    myIds.push(req.rhhUser.employee_id);
    lista = lista.filter(s => myIds.includes(s.employee_id));
  }

  const { estado, no_periodo } = req.query;
  if (estado)     lista = lista.filter(s => s.estado     === estado);
  if (no_periodo) lista = lista.filter(s => s.no_periodo === Number(no_periodo));

  const _sysIds3  = getSystemEmpIds();
  const employees = (db.rhh_employees || []).filter(e => !_sysIds3.has(Number(e.id)));
  const periodos  = (db.rhh_periodos || []).length > 0
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));

  const enriched = lista.map(s => {
    const emp    = employees.find(e => e.id === s.employee_id);
    const periodo = periodos.find(p => p.no_periodo === s.no_periodo);
    return {
      ...s,
      employee: emp ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null,
      periodo:  periodo || null,
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json(enriched);
});

// POST /api/rhh/nomina/te-solicitudes  — supervisor registra TE para un empleado
router.post('/te-solicitudes', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db = read();
  const { employee_id, no_periodo, horas, razon, sub_razon } = req.body || {};
  if (!employee_id || !no_periodo || !horas) {
    return res.status(400).json({ error: 'employee_id, no_periodo y horas son requeridos' });
  }

  // Acumular HE del empleado en el período (solicitudes no rechazadas)
  const heActual = (db.rhh_te_solicitudes || [])
    .filter(s => s.employee_id === Number(employee_id) && s.no_periodo === Number(no_periodo) && s.estado !== 'rechazada')
    .reduce((acc, s) => acc + (Number(s.horas) || 0), 0);

  const nuevoTotal = heActual + Number(horas);
  const requiereRH = nuevoTotal > HE_LIMIT_SEM;

  const lista = db.rhh_te_solicitudes || [];
  const record = {
    id:                  nextId(lista),
    employee_id:         Number(employee_id),
    no_periodo:          Number(no_periodo),
    horas:               Number(horas),
    razon:               razon    || null,
    sub_razon:           sub_razon || null,
    solicita:            req.rhhUser.full_name || req.rhhUser.email || null,
    requiere_auth_rh:    requiereRH,
    total_he_semana:     nuevoTotal,
    estado:              requiereRH ? 'pendiente_rh' : 'pendiente_supervisor',
    autorizado_por:      null,
    autorizado_at:       null,
    created_by:          req.rhhUser.id,
    created_at:          new Date().toISOString(),
  };
  lista.push(record);
  db.rhh_te_solicitudes = lista;
  write(db);

  res.status(201).json({
    ...record,
    mensaje: requiereRH
      ? `Esta solicitud acumula ${nuevoTotal}h en la semana (limite: ${HE_LIMIT_SEM}h). Requiere autorización de RHH/Admin.`
      : `Solicitud registrada. Total HE semana: ${nuevoTotal}h.`,
  });
});

// PATCH /api/rhh/nomina/te-solicitudes/:id
router.patch('/te-solicitudes/:id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db  = read();
  const idx = (db.rhh_te_solicitudes || []).findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Solicitud no encontrada' });

  const s = { ...db.rhh_te_solicitudes[idx] };

  // Si requiere autorización de RH, solo rh/admin pueden aprobar
  if (s.requiere_auth_rh && !['rh', 'admin'].includes(req.rhhUser.role)) {
    return res.status(403).json({ error: 'Esta solicitud requiere autorización de RHH o Admin (supera límite de horas semanales)' });
  }

  const { estado } = req.body || {};
  if (!['aprobada', 'rechazada'].includes(estado)) {
    return res.status(400).json({ error: 'estado debe ser aprobada o rechazada' });
  }

  s.estado        = estado;
  s.autorizado_por = req.rhhUser.id;
  s.autorizado_at  = new Date().toISOString();

  // Al aprobar: sumar horas al registro semanal
  if (estado === 'aprobada') {
    const lista  = db.rhh_incidencias_semanales || [];
    const incIdx = lista.findIndex(i => i.no_periodo === s.no_periodo && i.employee_id === s.employee_id);
    const horas  = Number(s.horas) || 0;
    if (incIdx !== -1) {
      lista[incIdx].horas_extras_total = (Number(lista[incIdx].horas_extras_total) || 0) + horas;
      lista[incIdx].updated_at = new Date().toISOString();
    } else {
      lista.push({
        id: nextId(lista), no_periodo: s.no_periodo, employee_id: s.employee_id,
        dias_pagados: 7, faltas: 0, horas_extras_total: horas, despensa: 1,
        bono_puntualidad_dias: null, bono_eficiencia_dias: null, bono_instructor: null,
        prima_dominical: 0, vacaciones_dias: null, gratificacion: null, notas: '',
        updated_by: req.rhhUser.id, updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
      });
    }
    db.rhh_incidencias_semanales = lista;
  }

  db.rhh_te_solicitudes[idx] = s;
  write(db);
  res.json(s);
});

// ── Export incidencias ────────────────────────────────────────────────────────

// GET /api/rhh/nomina/export?no_periodo=X
router.get('/export', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const no_periodo = Number(req.query.no_periodo);
  if (!no_periodo) return res.status(400).json({ error: 'no_periodo requerido' });
  const year = resolveRequestedYear(db, no_periodo, req.query.year);

  const periodos   = (db.rhh_periodos || []).length > 0
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => canonicalPeriod({ id: i + 1, ...p, year: 2026 }));
  const periodo    = periodos.find(p => samePeriod(p, no_periodo, year));
  const lista      = (db.rhh_incidencias_semanales || []).filter(i => samePeriod(i, no_periodo, year));
  const snapshots  = (db.rhh_employee_period_snapshots || []).filter(s => samePeriod(s, no_periodo, year));
  const employees  = snapshots.length > 0
    ? snapshots.map(s => ({
        ...(db.rhh_employees || []).find(e => e.id === Number(s.employee_id)),
        id: Number(s.employee_id),
        full_name: s.full_name,
        employee_number: s.employee_number,
        department_id: s.department_id,
        position_id: s.position_id,
        _snapshot: s,
      }))
    : (db.rhh_employees || []).filter(e => e.status === 'active');
  const depts      = db.rhh_departments || [];
  const positions  = db.rhh_positions   || [];

  const rows = employees
    .sort((a, b) => {
      const da = (depts.find(d => d.id === a.department_id)?.name || '');
      const db2 = (depts.find(d => d.id === b.department_id)?.name || '');
      if (da !== db2) return da.localeCompare(db2);
      return (a.full_name || '').localeCompare(b.full_name || '');
    })
    .map(emp => {
      const inc  = lista.find(i => i.employee_id === emp.id);
      const dept = depts.find(d => d.id === emp.department_id);
      const pos  = positions.find(p => p.id === emp.position_id);
      return {
        no_empleado:          emp.employee_number || emp.id,
        nombre:               emp.full_name,
        departamento:         emp._snapshot?.department_name || dept?.name || '',
        puesto:               emp._snapshot?.position_name || pos?.name  || '',
        dias_pagados:         inc?.dias_pagados        ?? 7,
        faltas:               inc?.faltas              ?? 0,
        horas_extras:         inc?.horas_extras_total  ?? 0,
        despensa:             inc?.despensa  ? 'SÍ' : 'NO',
        bono_puntualidad_dias: inc?.bono_puntualidad_dias ?? '',
        bono_eficiencia_dias:  inc?.bono_eficiencia_dias  ?? '',
        bono_instructor:      inc?.bono_instructor        ?? '',
        prima_dominical:      inc?.prima_dominical ? 'SÍ' : 'NO',
        vacaciones_dias:      inc?.vacaciones_dias  ?? '',
        gratificacion:        inc?.gratificacion    ?? '',
        notas:                inc?.notas            || '',
      };
    });

  res.json({
    periodo: periodo || { no_periodo, year, period_key: periodKey(year, no_periodo) },
    rows,
    generated_at: nowMxDate(),
  });
});

// ── Seed catálogo de puestos ──────────────────────────────────────────────────

// POST /api/rhh/nomina/seed-puestos  (solo admin)
router.post('/seed-puestos', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const db = read();
  db.rhh_positions = PUESTOS_CATALOGO.map((p, i) => ({
    id:          i + 1,
    name:        p.name,
    code:        null,
    description: null,
  }));
  write(db);
  res.json({ ok: true, count: db.rhh_positions.length, positions: db.rhh_positions });
});

// ══════════════════════════════════════════════════════════════════════════════
// FASE 5 — Catálogos editables de Razones TE + Migración incidencias antiguas
// ══════════════════════════════════════════════════════════════════════════════

/* Seed inicial de clasificaciones TE (se aplica solo si el catálogo está vacío) */
const TE_CATALOGOS_SEED = [
  {
    id: 1,
    nombre: 'Motivo RHH',
    motivos: [
      'Extensión de Jornada Noche',
      'Cubrir Vacaciones',
      'Cubrir Ausentismos',
      'Cubrir Fin de Semana',
      'Cubrir Incapacidades',
      'Cubrir Vacante',
      'Cubre por Capacitación',
      'Asiste a Curso / Junta',
    ]
  },
  {
    id: 2,
    nombre: 'Cliente / Proyecto',
    motivos: [
      'Solicita SKF',
      'Solicita Amsted',
      'Solicita Tenneco',
    ]
  },
  {
    id: 3,
    nombre: 'Producción',
    motivos: [
      'Atraso en Entregas',
      'Apoyo en Limpieza',
      'Contención Reclamo',
      'Supervisión a Embarque',
      'Apoyo en Embarque',
      'Apoyo en Inspección',
      'Apoyo a Almacén',
      'Inventarios Interno',
    ]
  },
  {
    id: 4,
    nombre: 'Otros Motivos',
    motivos: [
      'Mantenimiento Programado',
      'Otro',   // al seleccionar este, el formulario pedirá comentario obligatorio
    ]
  },
];

// GET /api/rhh/nomina/te-catalogos
router.get('/te-catalogos', rhhAuthRequired, (req, res) => {
  const db = read();
  let cats = db.rhh_te_catalogos || [];
  // Si está vacío, retornar seed (sin persistir) para que el UI lo muestre de inmediato
  if (cats.length === 0) cats = TE_CATALOGOS_SEED;
  res.json(cats);
});

// POST /api/rhh/nomina/te-catalogos  { nombre }  → crea nueva clasificación
router.post('/te-catalogos', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
  const db   = read();
  let cats   = db.rhh_te_catalogos || [];
  if (cats.length === 0) cats = TE_CATALOGOS_SEED.map(c => ({ ...c, motivos: [...c.motivos] }));
  const newId = cats.length > 0 ? Math.max(...cats.map(c => c.id)) + 1 : 1;
  const cat  = { id: newId, nombre: nombre.trim(), motivos: [] };
  cats.push(cat);
  db.rhh_te_catalogos = cats;
  write(db);
  res.status(201).json(cat);
});

// PATCH /api/rhh/nomina/te-catalogos/:id  { nombre }  → renombra clasificación
router.patch('/te-catalogos/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
  const db   = read();
  let cats   = db.rhh_te_catalogos || [];
  if (cats.length === 0) cats = TE_CATALOGOS_SEED.map(c => ({ ...c, motivos: [...c.motivos] }));
  const idx  = cats.findIndex(c => c.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Clasificación no encontrada' });
  cats[idx].nombre = nombre.trim();
  db.rhh_te_catalogos = cats;
  write(db);
  res.json(cats[idx]);
});

// DELETE /api/rhh/nomina/te-catalogos/:id
router.delete('/te-catalogos/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db  = read();
  let cats  = db.rhh_te_catalogos || [];
  if (cats.length === 0) cats = TE_CATALOGOS_SEED.map(c => ({ ...c, motivos: [...c.motivos] }));
  const idx = cats.findIndex(c => c.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Clasificación no encontrada' });
  cats.splice(idx, 1);
  db.rhh_te_catalogos = cats;
  write(db);
  res.json({ ok: true });
});

// POST /api/rhh/nomina/te-catalogos/:id/motivos  { motivo: string }  → agrega motivo
router.post('/te-catalogos/:id/motivos', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const { motivo } = req.body || {};
  if (!motivo?.trim()) return res.status(400).json({ error: 'motivo requerido' });
  const db   = read();
  let cats   = db.rhh_te_catalogos || [];
  if (cats.length === 0) cats = TE_CATALOGOS_SEED.map(c => ({ ...c, motivos: [...c.motivos] }));
  const cat  = cats.find(c => c.id === Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Clasificación no encontrada' });
  if (cat.motivos.includes(motivo.trim())) return res.status(409).json({ error: 'Motivo ya existe' });
  cat.motivos.push(motivo.trim());
  db.rhh_te_catalogos = cats;
  write(db);
  res.status(201).json(cat);
});

// DELETE /api/rhh/nomina/te-catalogos/:id/motivos/:midx  (midx = índice del motivo)
router.delete('/te-catalogos/:id/motivos/:midx', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db   = read();
  let cats   = db.rhh_te_catalogos || [];
  if (cats.length === 0) cats = TE_CATALOGOS_SEED.map(c => ({ ...c, motivos: [...c.motivos] }));
  const cat  = cats.find(c => c.id === Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Clasificación no encontrada' });
  const midx = Number(req.params.midx);
  if (midx < 0 || midx >= cat.motivos.length) return res.status(404).json({ error: 'Motivo no encontrado' });
  cat.motivos.splice(midx, 1);
  db.rhh_te_catalogos = cats;
  write(db);
  res.json(cat);
});

// POST /api/rhh/nomina/te-catalogos/seed-default  → restaura el catálogo a los valores predeterminados
router.post('/te-catalogos/seed-default', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const db = read();
  db.rhh_te_catalogos = TE_CATALOGOS_SEED.map(c => ({ ...c, motivos: [...c.motivos] }));
  write(db);
  res.json({ ok: true, count: db.rhh_te_catalogos.length });
});

// ── Migración de incidencias antiguas (rhh_incidences → rhh_incidencias_semanales) ──────

const MESES_MX = { 'Ene':1,'Feb':2,'Mar':3,'Abr':4,'May':5,'Jun':6,'Jul':7,'Ago':8,'Sep':9,'Oct':10,'Nov':11,'Dic':12 };

function parsePeriodoDate(str) {
  // '29/Dic/2025' → Date  (noon para evitar problemas de timezone)
  const [d, m, y] = str.split('/');
  return new Date(`${y}-${String(MESES_MX[m]).padStart(2,'0')}-${d.padStart(2,'0')}T12:00:00`);
}

function findPeriodo(dateStr, periodos) {
  const dt = new Date(dateStr + 'T12:00:00');
  return periodos.find(p => {
    const ini = parsePeriodoDate(p.fecha_inicio);
    const fin = parsePeriodoDate(p.fecha_fin);
    return dt >= ini && dt <= fin;
  }) || null;
}

function countDaysMx(dateStr, dateEndStr) {
  const s = new Date(dateStr    + 'T12:00:00');
  const e = new Date((dateEndStr || dateStr) + 'T12:00:00');
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

// GET /api/rhh/nomina/migrar-incidencias?dry_run=1  → preview de lo que se migraría
// POST /api/rhh/nomina/migrar-incidencias           → ejecuta migración (admin)
router.all('/migrar-incidencias', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const dryRun = req.method === 'GET' || req.query.dry_run === '1';
  const db = read();

  const incidencias = db.rhh_incidences || [];
  if (incidencias.length === 0) return res.json({ ok: true, migrated: 0, skipped: 0, preview: [], message: 'No hay incidencias antiguas' });

  const periodos = (db.rhh_periodos || []).length > 0
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));

  // Map: tipo de incidencia antigua → campo en el nuevo modelo
  const TYPE_MAP = {
    'vacacion':     { campo: 'vacaciones_dias',   fn: countDaysMx },
    'falta':        { campo: 'faltas',             fn: () => 1 },
    'incapacidad':  { campo: 'faltas',             fn: countDaysMx },
    'tiempo_extra': { campo: 'horas_extras_total', fn: (d, de) => Number(de) || 1 }, // date_end reused as hours in old model
    'permiso':      { campo: 'faltas',             fn: () => 0 },  // permisos → no cuentan como falta
  };

  const preview = [];
  const upsertMap = {}; // key: `${employee_id}_${no_periodo}`

  for (const inc of incidencias) {
    const periodo = findPeriodo(inc.date, periodos);
    if (!periodo) {
      preview.push({ id: inc.id, employee_id: inc.employee_id, date: inc.date, type: inc.type, result: 'SIN_PERIODO', no_periodo: null });
      continue;
    }
    const mapping = TYPE_MAP[inc.type];
    if (!mapping) {
      preview.push({ id: inc.id, employee_id: inc.employee_id, date: inc.date, type: inc.type, result: 'TIPO_DESCONOCIDO', no_periodo: periodo.no_periodo });
      continue;
    }
    const valor = mapping.fn(inc.date, inc.date_end);
    const key   = `${inc.employee_id}_${periodo.no_periodo}`;
    if (!upsertMap[key]) upsertMap[key] = { employee_id: inc.employee_id, no_periodo: periodo.no_periodo, campos: {} };
    upsertMap[key].campos[mapping.campo] = (upsertMap[key].campos[mapping.campo] || 0) + valor;
    preview.push({ id: inc.id, employee_id: inc.employee_id, date: inc.date, type: inc.type, campo: mapping.campo, valor, no_periodo: periodo.no_periodo, result: 'OK' });
  }

  const okCount      = preview.filter(p => p.result === 'OK').length;
  const skippedCount = preview.length - okCount;

  if (dryRun) {
    return res.json({ ok: true, dry_run: true, total: incidencias.length, migrated: okCount, skipped: skippedCount, preview });
  }

  // Ejecutar: upsert en rhh_incidencias_semanales
  const lista = db.rhh_incidencias_semanales || [];
  let touched = 0;

  for (const { employee_id, no_periodo, campos } of Object.values(upsertMap)) {
    let rec = lista.find(r => r.employee_id === employee_id && r.no_periodo === no_periodo);
    if (!rec) {
      rec = { id: nextId(lista), employee_id, no_periodo, dias_pagados: 7, faltas: 0, horas_extras_total: 0,
              despensa: false, bono_puntualidad_dias: 0, bono_eficiencia_dias: 0, bono_instructor: false,
              prima_dominical: false, vacaciones_dias: 0, gratificacion: false, notas: 'Migrado de sistema antiguo' };
      lista.push(rec);
    }
    for (const [campo, valor] of Object.entries(campos)) {
      rec[campo] = (rec[campo] || 0) + valor;
    }
    touched++;
  }

  db.rhh_incidencias_semanales = lista;
  write(db);
  res.json({ ok: true, dry_run: false, total: incidencias.length, migrated: okCount, skipped: skippedCount, records_upserted: touched, preview });
});

// ══════════════════════════════════════════════════════════════════════════════
// FASE 3 — Import / Comparación PDF Lista de Raya
// ══════════════════════════════════════════════════════════════════════════════

// Carga el extractor con coordenadas (pdfjs-dist) de forma diferida
function getExtractor() {
  try {
    return require('../utils/pdf-lista-raya');
  } catch (e) {
    return null;
  }
}

// Códigos de conceptos CONTPAQ i → campos del modelo interno
const CODE_TO_FIELD = {
  '4':   'horas_extras',        // Tiempo Extra
  '15':  'bono_puntualidad',    // Bono Puntualidad
  '7':   'bono_eficiencia',     // Bono Eficiencia
  '139': 'bono_instructor',     // Bono Instructor
  '10':  'prima_dominical',     // Prima Dominical
  '19':  'vacaciones_importe',  // Vacaciones
  '12':  'gratificacion',       // Gratificación
  '32':  'despensa',            // Despensa (informativa)
};

function conceptsToFields(percepciones) {
  const out = {};
  for (const [col, imp] of Object.entries(percepciones)) {
    const code = col.split(' ')[0];
    const field = CODE_TO_FIELD[code];
    if (field) out[field] = imp;
  }
  return out;
}

// ── POST /api/rhh/nomina/importar-pdf ─────────────────────────────────────────
// Sube PDF Lista de Raya CONTPAQ i:
//   - Si el período YA existe en DB → sólo compara, devuelve diffs
//   - Si es NUEVO → crea rhh_incidencias_semanales, actualiza salario/dept/puesto,
//     detecta altas y posibles bajas
router.post('/importar-pdf', rhhAuthRequired, rhhRequireRole('rh', 'admin'),
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Se requiere el archivo PDF (campo: pdf)' });

      const extractor = getExtractor();
      if (!extractor) return res.status(503).json({ error: 'Módulo pdf-lista-raya no disponible' });

      const { extractListaRaya, PERC_INFO, DED_INFO, cleanNum } = extractor;

      // ── Parsear PDF ──
      let parsed;
      try {
        parsed = await extractListaRaya(req.file.buffer);
      } catch (parseErr) {
        console.error('[importar-pdf] parse error:', parseErr.message);
        return res.status(422).json({ error: 'No se pudo leer el PDF: ' + parseErr.message });
      }

      const { header, employees: pdfEmps } = parsed;

      // Número de período desde el PDF o desde el body como override
      const noPeriodo = Number(req.body.no_periodo) || Number(header.no_periodo) || null;
      if (!noPeriodo) {
        return res.status(400).json({ error: 'No se pudo detectar el número de período. Envíalo como no_periodo en el body.' });
      }

      const db          = read();
      const empsCat     = db.rhh_employees  || [];
      const depts       = db.rhh_departments || [];
      const positions   = db.rhh_positions   || [];
      const incList     = db.rhh_incidencias_semanales || [];
      const sysIds      = getSystemEmpIds();

      const periodoExist = incList.some(i => i.no_periodo === noPeriodo);

      // ── HELPERS ──

      // Busca empleado por employee_number (acepta con/sin ceros a la izquierda)
      function findEmpByClave(clave) {
        const stripped = String(clave).replace(/^0+/, '') || '0';
        return empsCat.find(e =>
          !sysIds.has(Number(e.id)) &&
          (String(e.employee_number) === String(clave) ||
           String(e.employee_number).replace(/^0+/, '') === stripped)
        ) || null;
      }

      function findOrCreateDept(name) {
        if (!name) return null;
        let d = depts.find(d => d.name.toLowerCase() === name.toLowerCase());
        if (!d) {
          d = { id: depts.length ? Math.max(...depts.map(x => x.id)) + 1 : 1, name };
          depts.push(d);
        }
        return d;
      }

      function findOrCreatePos(name) {
        if (!name) return null;
        let p = positions.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!p) {
          p = { id: positions.length ? Math.max(...positions.map(x => x.id)) + 1 : 1, name, code: null, description: null };
          positions.push(p);
        }
        return p;
      }

      // ── MODO COMPARACIÓN (período ya existe) ──
      if (periodoExist) {
        const diffs = [];
        const CAMPOS = [
          { pdfKey: 'dias_pag',   dbKey: 'dias_pagados',      label: 'Días pagados' },
          { pdfKey: 'hrs_extra',  dbKey: 'horas_extras_total', label: 'Hrs extras' },
          { pdfKey: 'sal_diario', dbKey: 'salary_daily',       label: 'Sal. diario', isEmpField: true },
        ];

        for (const pEmp of pdfEmps) {
          const emp = findEmpByClave(pEmp.no);
          const inc = emp ? incList.find(i => i.no_periodo === noPeriodo && i.employee_id === emp.id) : null;

          const campos = CAMPOS.map(c => {
            const pdfVal = pEmp[c.pdfKey] ?? null;
            const dbVal  = c.isEmpField ? (emp ? (emp[c.dbKey] ?? null) : null) : (inc ? (inc[c.dbKey] ?? null) : null);
            const diff   = pdfVal !== null && dbVal !== null ? Math.abs(pdfVal - dbVal) > 0.01 : (pdfVal !== null || dbVal !== null);
            return { campo: c.label, pdf: pdfVal, db: dbVal, diff };
          });

          // Conceptos con diferencia
          const conceptDiffs = [];
          const fields = conceptsToFields(pEmp.percepciones);
          if (inc) {
            for (const [fld, pdfVal] of Object.entries(fields)) {
              const dbVal = inc[fld] ?? 0;
              if (Math.abs((pdfVal || 0) - (dbVal || 0)) > 0.01) {
                conceptDiffs.push({ campo: fld, pdf: pdfVal, db: dbVal });
              }
            }
          }

          diffs.push({
            no: pEmp.no,
            nombre: pEmp.nombre,
            dept_pdf: pEmp.dept_nm,
            emp_id: emp?.id || null,
            encontrado: !!emp,
            hasDiff: campos.some(c => c.diff) || conceptDiffs.length > 0,
            campos,
            conceptDiffs,
            total_perc_pdf: pEmp.total_perc_pdf,
            total_ded_pdf: pEmp.total_ded_pdf,
            neto_pdf: pEmp.neto_pdf,
          });
        }

        // Empleados activos en DB que no están en el PDF (posibles bajas)
        const pdfNos = new Set(pdfEmps.map(e => String(e.no).replace(/^0+/, '') || '0'));
        const posiblesBajas = empsCat
          .filter(e => e.status === 'active' && !sysIds.has(Number(e.id)))
          .filter(e => !pdfNos.has(String(e.employee_number).replace(/^0+/, '') || '0'))
          .map(e => ({ id: e.id, full_name: e.full_name, employee_number: e.employee_number }));

        return res.json({
          ok: true,
          mode: 'compare',
          no_periodo: noPeriodo,
          header,
          total_pdf: pdfEmps.length,
          con_diff: diffs.filter(d => d.hasDiff).length,
          no_encontrados: diffs.filter(d => !d.encontrado).length,
          posibles_bajas: posiblesBajas,
          diffs,
        });
      }

      // ── MODO IMPORTACIÓN (período nuevo) ──
      const log = [];
      const newIncs = [];
      const altas = [];
      const posiblesBajas = [];

      for (const pEmp of pdfEmps) {
        const emp = findEmpByClave(pEmp.no);

        if (!emp) {
          altas.push({ no: pEmp.no, nombre: pEmp.nombre, dept: pEmp.dept_nm, puesto: pEmp.puesto });
          log.push(`ALTA detectada: ${pEmp.no} ${pEmp.nombre} (no existe en catálogo)`);
          continue;
        }

        // Actualizar salario diario si cambió
        if (pEmp.sal_diario !== null && emp.salary_daily !== null) {
          const diff = Math.abs(pEmp.sal_diario - (emp.salary_daily || 0));
          if (diff > 0.01) {
            log.push(`Salario actualizado ${emp.full_name}: ${emp.salary_daily} → ${pEmp.sal_diario}`);
            emp.salary_daily = pEmp.sal_diario;
          }
        }
        if (pEmp.sdi !== null) emp.sdi = pEmp.sdi;
        if (pEmp.sbc !== null) emp.sbc = pEmp.sbc;

        // Actualizar departamento si cambió
        if (pEmp.dept_nm) {
          const dept = findOrCreateDept(pEmp.dept_nm);
          if (dept && emp.department_id !== dept.id) {
            log.push(`Dept actualizado ${emp.full_name}: dept_id → ${dept.id} (${dept.name})`);
            emp.department_id = dept.id;
          }
        }

        // Actualizar puesto si cambió
        if (pEmp.puesto) {
          const pos = findOrCreatePos(pEmp.puesto);
          if (pos && emp.position_id !== pos.id) {
            log.push(`Puesto actualizado ${emp.full_name}: pos_id → ${pos.id} (${pos.name})`);
            emp.position_id = pos.id;
          }
        }

        // Actualizar fecha ingreso si llegó con reingreso
        if (pEmp.fecha_ingr && emp.fecha_ingreso !== pEmp.fecha_ingr) {
          const oldFi = emp.fecha_ingreso;
          if (oldFi && oldFi !== pEmp.fecha_ingr) {
            log.push(`Fecha ingreso cambió ${emp.full_name}: ${oldFi} → ${pEmp.fecha_ingr} (posible reingreso)`);
          }
          emp.fecha_ingreso = pEmp.fecha_ingr;
        }

        emp.updated_at = nowMxDate();

        // Construir registro de incidencias
        const fields = conceptsToFields(pEmp.percepciones);
        // Calcular días de vacaciones: importe P|19 / salario diario
        const vacImporte = fields.vacaciones_importe ?? 0;
        const salDiario  = emp.sal_diario || emp.salary_daily || 0;
        const vacDias    = (vacImporte && salDiario) ? Math.round(vacImporte / salDiario) : null;

        const rec = {
          id: nextId([...incList, ...newIncs]),
          no_periodo: noPeriodo,
          employee_id: emp.id,
          dias_pagados: pEmp.dias_pag ?? 7,
          faltas: 0,
          horas_extras_total: pEmp.hrs_extra ?? 0,
          despensa: fields.despensa ? 1 : 0,
          bono_puntualidad_dias: fields.bono_puntualidad ?? null,
          bono_eficiencia_dias:  fields.bono_eficiencia  ?? null,
          bono_instructor:       fields.bono_instructor  ?? null,
          prima_dominical:       fields.prima_dominical  ? 1 : 0,
          vacaciones_dias:       vacDias,
          gratificacion:         fields.gratificacion    ?? null,
          percepciones:          pEmp.percepciones || {},
          deducciones:           pEmp.deducciones  || {},
          total_perc_pdf:        pEmp.total_perc_pdf,
          total_ded_pdf:         pEmp.total_ded_pdf,
          neto_pdf:              pEmp.neto_pdf,
          notas:                 pEmp.notas || '',
          source:                'pdf_import',
          updated_by:            req.rhhUser.id,
          updated_at:            nowMxDate(),
          created_at:            nowMxDate(),
        };
        newIncs.push(rec);
      }

      // Empleados activos que NO están en el PDF → posibles bajas
      const pdfNos = new Set(pdfEmps.map(e => String(e.no).replace(/^0+/, '') || '0'));
      for (const e of empsCat) {
        if (e.status !== 'active' || sysIds.has(Number(e.id))) continue;
        const stripped = String(e.employee_number).replace(/^0+/, '') || '0';
        if (!pdfNos.has(stripped)) {
          posiblesBajas.push({ id: e.id, full_name: e.full_name, employee_number: e.employee_number });
          log.push(`Posible baja: ${e.employee_number} ${e.full_name} (activo en DB pero no en PDF)`);
        }
      }

      // Guardar
      db.rhh_departments = depts;
      db.rhh_positions   = positions;
      db.rhh_incidencias_semanales = [...incList, ...newIncs];
      write(db);

      return res.json({
        ok: true,
        mode: 'import',
        no_periodo: noPeriodo,
        header,
        total_pdf: pdfEmps.length,
        importados: newIncs.length,
        altas,
        posibles_bajas: posiblesBajas,
        log,
      });

    } catch (err) {
      console.error('[nomina/importar-pdf]', err.message, err.stack);
      res.status(500).json({ error: 'Error al procesar el PDF: ' + err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// FASE 3b — Comparación PDF Lista de Raya (método anterior, texto plano)
// ══════════════════════════════════════════════════════════════════════════════

/* Códigos de conceptos CONTPAQ i relevantes */
const CONCEPTOS = {
  4:   'horas_extras',
  15:  'bono_puntualidad',
  7:   'bono_eficiencia',
  139: 'bono_instructor',
  10:  'prima_dominical',
  19:  'vacaciones_importe',
  12:  'gratificacion_importe',
  32:  'despensa_importe',
};

/**
 * Extrae datos de empleados desde texto plano de un PDF Lista de Raya CONTPAQ i.
 * Retorna array de objetos con campos económicos por empleado.
 */
function parsePdfText(text) {
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];
  let current   = null;

  const reEmp      = /^(\d{3,4})\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s,]+)$/;
  const reDias     = /[Dd][íi]as\s+pagados[:\s]*([\d.]+)/i;
  const reHrsExt   = /Hrs\s+extras[:\s]*([\d.]+)/i;
  const rePercep   = /Total\s+Percepciones\s+([\d,]+\.?\d*)/i;
  const reDeduc    = /Total\s+Deducciones\s+([\d,]+\.?\d*)/i;
  const reNeto     = /Neto\s+a\s+pagar\s+([\d,]+\.?\d*)/i;
  const reConcept  = /^(\d{1,3})\s+.+?\s+([\d,]+\.\d{2})\s*$/;

  const pn = s => parseFloat((s || '0').replace(/,/g, '')) || 0;

  for (const line of lines) {
    // Detectar línea de empleado (clave + nombre)
    const mEmp = line.match(reEmp);
    if (mEmp) {
      if (current) results.push(current);
      current = {
        clave:               mEmp[1],
        nombre:              mEmp[2].trim(),
        dias_pagados:        0,
        horas_extras:        0,
        bono_puntualidad:    0,
        bono_eficiencia:     0,
        bono_instructor:     0,
        prima_dominical:     0,
        vacaciones_importe:  0,
        gratificacion_importe: 0,
        despensa_importe:    0,
        total_percepciones:  0,
        total_deducciones:   0,
        neto_pagar:          0,
      };
      continue;
    }
    if (!current) continue;

    const mDias   = line.match(reDias);    if (mDias)   { current.dias_pagados       = pn(mDias[1]);   continue; }
    const mHrs    = line.match(reHrsExt);  if (mHrs)    { current.horas_extras        = pn(mHrs[1]);    continue; }
    const mPerc   = line.match(rePercep);  if (mPerc)   { current.total_percepciones  = pn(mPerc[1]);   continue; }
    const mDeduc  = line.match(reDeduc);   if (mDeduc)  { current.total_deducciones   = pn(mDeduc[1]);  continue; }
    const mNeto   = line.match(reNeto);    if (mNeto)   { current.neto_pagar          = pn(mNeto[1]);   continue; }

    // Líneas de concepto: código  descripción  importe
    const mConc = line.match(reConcept);
    if (mConc) {
      const cod   = Number(mConc[1]);
      const campo = CONCEPTOS[cod];
      if (campo) current[campo] = pn(mConc[2]);
    }
  }
  if (current) results.push(current);
  return results;
}

// POST /api/rhh/nomina/parse-pdf
// Sube un PDF de Lista de Raya y retorna los datos extraídos (sin guardar)
router.post('/parse-pdf', rhhAuthRequired, rhhRequireRole('rh', 'admin'),
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Se requiere el archivo PDF (campo: pdf)' });
      const pdfParse = getPdfParse();
      if (!pdfParse) return res.status(503).json({ error: 'pdf-parse no está instalado en este servidor. Instala con: npm install pdf-parse' });
      const data = await pdfParse(req.file.buffer);
      const empleados = parsePdfText(data.text);
      res.json({ ok: true, total: empleados.length, empleados });
    } catch (err) {
      console.error('[nomina/parse-pdf]', err.message);
      res.status(500).json({ error: 'Error al procesar el PDF: ' + err.message });
    }
  }
);

// POST /api/rhh/nomina/comparar-pdf
// Sube PDF + no_periodo → compara vs rhh_incidencias_semanales capturadas
// Retorna array de diffs por empleado
router.post('/comparar-pdf', rhhAuthRequired, rhhRequireRole('rh', 'admin'),
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Se requiere el archivo PDF (campo: pdf)' });
      const no_periodo = Number(req.body.no_periodo);
      if (!no_periodo) return res.status(400).json({ error: 'no_periodo requerido en body' });

      const pdfParse = getPdfParse();
      if (!pdfParse) return res.status(503).json({ error: 'pdf-parse no está instalado en este servidor. Instala con: npm install pdf-parse' });
      const data       = await pdfParse(req.file.buffer);
      const pdfEmps    = parsePdfText(data.text);
      const db         = read();
      const year       = resolveRequestedYear(db, no_periodo, req.body.year);
      const lista      = (db.rhh_incidencias_semanales || []).filter(i => samePeriod(i, no_periodo, year));
      const employees  = db.rhh_employees || [];

      const CAMPOS_CMP = [
        { key: 'dias_pagados',     label: 'Días pagados' },
        { key: 'horas_extras',     label: 'Hrs extras',       dbKey: 'horas_extras_total' },
        { key: 'bono_puntualidad', label: 'Bono puntualidad', dbKey: 'bono_puntualidad_dias' },
        { key: 'bono_eficiencia',  label: 'Bono eficiencia',  dbKey: 'bono_eficiencia_dias' },
        { key: 'bono_instructor',  label: 'Bono instructor' },
        { key: 'prima_dominical',  label: 'Prima dominical' },
        { key: 'neto_pagar',       label: 'Neto a pagar' },
      ];

      const diffs = pdfEmps.map(pEmp => {
        // Buscar empleado en la DB por clave (employee_number) o nombre aproximado
        const emp = employees.find(e =>
          String(e.employee_number) === String(pEmp.clave) ||
          (e.full_name || '').toUpperCase().includes(pEmp.nombre.split(' ')[0])
        );
        const inc = emp ? lista.find(i => i.employee_id === emp.id) : null;

        const campos = CAMPOS_CMP.map(c => {
          const pdfVal = pEmp[c.key] ?? null;
          const dbKey  = c.dbKey || c.key;
          const dbVal  = inc ? (inc[dbKey] ?? null) : null;
          const diff   = (pdfVal !== null && dbVal !== null)
            ? Math.abs(pdfVal - dbVal) > 0.01
            : (pdfVal !== null || dbVal !== null);
          return { campo: c.label, pdf: pdfVal, capturado: dbVal, diff };
        });

        const hasDiff = campos.some(c => c.diff);
        return {
          clave:      pEmp.clave,
          nombre:     pEmp.nombre,
          emp_id:     emp?.id || null,
          encontrado: !!emp,
          hasDiff,
          campos,
        };
      });

      const resumen = {
        total_pdf:    pdfEmps.length,
        con_diff:     diffs.filter(d => d.hasDiff).length,
        sin_diff:     diffs.filter(d => !d.hasDiff && d.encontrado).length,
        no_encontrado: diffs.filter(d => !d.encontrado).length,
      };

      res.json({ ok: true, no_periodo, year, period_key: periodKey(year, no_periodo), resumen, diffs });
    } catch (err) {
      console.error('[nomina/comparar-pdf]', err.message);
      res.status(500).json({ error: 'Error al comparar PDF: ' + err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// FASE 4 — Dashboard KPIs Nómina
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/nomina/kpis?no_periodo=X
// KPIs agregados de incidencias del período (admin/rh)
router.get('/kpis', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const no_periodo = Number(req.query.no_periodo);
  if (!no_periodo) return res.status(400).json({ error: 'no_periodo requerido' });
  const year = resolveRequestedYear(db, no_periodo, req.query.year);

  const lista     = (db.rhh_incidencias_semanales || []).filter(i => samePeriod(i, no_periodo, year));
  const _sysIds   = getSystemEmpIds();
  const employees = (db.rhh_employees || []).filter(e => e.status === 'active' && !_sysIds.has(Number(e.id)));
  const totalEmp  = employees.length;
  const capturados = lista.length;

  const sum = (key, dflt = 0) => lista.reduce((a, i) => a + (Number(i[key]) || dflt), 0);

  const totalFaltas        = sum('faltas');
  const totalHE            = sum('horas_extras_total');
  const conDespensa        = lista.filter(i => i.despensa).length;
  const conPrimaDominical  = lista.filter(i => i.prima_dominical).length;
  const totalVacDias       = sum('vacaciones_dias');
  const conBonoPuntual     = lista.filter(i => (i.bono_puntualidad_dias || 0) > 0).length;
  const conBonoEficiencia  = lista.filter(i => (i.bono_eficiencia_dias  || 0) > 0).length;

  // Distribución de faltas (0, 1, 2, 3+)
  const distFaltas = { 0: 0, 1: 0, 2: 0, '3+': 0 };
  lista.forEach(i => {
    const f = i.faltas || 0;
    if (f === 0)      distFaltas[0]++;
    else if (f === 1) distFaltas[1]++;
    else if (f === 2) distFaltas[2]++;
    else              distFaltas['3+']++;
  });

  const periodos = (db.rhh_periodos || []).length > 0
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));
  const periodo = periodos.find(p => samePeriod(p, no_periodo, year)) || null;

  res.json({
    ok: true,
    periodo,
    year,
    period_key: periodKey(year, no_periodo),
    resumen: {
      total_empleados:       totalEmp,
      capturados,
      pendientes_captura:    totalEmp - capturados,
      total_faltas:          totalFaltas,
      promedio_faltas:       capturados ? +(totalFaltas / capturados).toFixed(2) : 0,
      total_horas_extras:    +totalHE.toFixed(2),
      promedio_he:           capturados ? +(totalHE / capturados).toFixed(2) : 0,
      con_despensa:          conDespensa,
      con_prima_dominical:   conPrimaDominical,
      total_vac_dias:        totalVacDias,
      con_bono_puntualidad:  conBonoPuntual,
      con_bono_eficiencia:   conBonoEficiencia,
    },
    distribucion_faltas: distFaltas,
  });
});

// POST /api/rhh/nomina/import-sqlite  (solo admin, solo local — requiere DB_SISTEMA_RRHH_PATH)
// Importa tabla consolidado_pdf desde SQLite externo a rhh_consolidado_pdf
router.post('/import-sqlite', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const sqlitePath = process.env.DB_SISTEMA_RRHH_PATH;
  if (!sqlitePath) {
    return res.status(503).json({ error: 'DB_SISTEMA_RRHH_PATH no configurado (solo disponible en entorno local)' });
  }
  try {
    const Database = require('better-sqlite3');
    const sdb      = new Database(sqlitePath, { readonly: true });
    const rows     = sdb.prepare('SELECT * FROM consolidado_pdf').all();
    sdb.close();

    const db = read();
    db.rhh_consolidado_pdf = rows;
    write(db);
    res.json({ ok: true, imported: rows.length });
  } catch (err) {
    console.error('[nomina/import-sqlite]', err.message);
    res.status(500).json({ error: 'Error al importar SQLite: ' + err.message });
  }
});

// GET /api/rhh/nomina/consolidado-stats?periodos=1,2,3
// Estadísticas del consolidado importado desde sistema_rrhh
router.get('/consolidado-stats', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const consolidado = db.rhh_consolidado_pdf || [];
  if (consolidado.length === 0) {
    return res.json({ ok: true, total: 0, stats: null, message: 'Sin datos importados. Use import-sqlite primero.' });
  }

  // Filtrar por períodos si se especifica
  let rows = consolidado;
  if (req.query.periodos) {
    const pIds = req.query.periodos.split(',').map(Number).filter(Boolean);
    rows = consolidado.filter(r => pIds.includes(Number(r.no_periodo)));
  }

  const pn  = v => parseFloat(v) || 0;
  const sum = key => rows.reduce((a, r) => a + pn(r[key]), 0);

  // Agrupar por período
  const byPeriodo = {};
  rows.forEach(r => {
    const p = r.no_periodo;
    if (!byPeriodo[p]) byPeriodo[p] = { no_periodo: p, empleados: 0, total_neto: 0, total_he: 0, total_faltas: 0 };
    byPeriodo[p].empleados++;
    byPeriodo[p].total_neto    += pn(r.neto_pagar || r.neto);
    byPeriodo[p].total_he      += pn(r.horas_extras || r.he_importe);
    byPeriodo[p].total_faltas  += pn(r.faltas || 0);
  });

  res.json({
    ok: true,
    total: rows.length,
    stats: {
      total_neto:           +sum('neto_pagar' in (rows[0] || {}) ? 'neto_pagar' : 'neto').toFixed(2),
      total_percepciones:   +sum('total_percepciones').toFixed(2),
      total_deducciones:    +sum('total_deducciones').toFixed(2),
      promedio_neto:        rows.length ? +(sum('neto_pagar' in (rows[0] || {}) ? 'neto_pagar' : 'neto') / rows.length).toFixed(2) : 0,
    },
    por_periodo: Object.values(byPeriodo).sort((a, b) => a.no_periodo - b.no_periodo),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC desde sistema_rrhh SQLite
// ══════════════════════════════════════════════════════════════════════════════

/* Limpia el prefijo numérico de nombres de departamento: "1 Almacen" → "Almacén" */
const DEPT_MAP = {
  'almacen':                       'Almacén',
  'produccion':                    'Producción',
  'mantenimiento':                 'Mantenimiento',
  'calidad':                       'Calidad',
  'limpieza':                      'Limpieza',
  'proyecto skf':                  'Proyecto SKF',
  'proyecto amsted':               'Proyecto AMSTED',
  'ptar':                          'PTAR',
  'seguridad y medio ambiente':    'Seguridad y Medio Ambiente',
  'rrhh':                          'RRHH',
};

function normDeptName(raw) {
  // Quita prefijo numérico: "1 Almacen" → "Almacen"
  const clean = (raw || '').replace(/^\d+\s+/, '').trim();
  return DEPT_MAP[clean.toLowerCase()] || clean;
}

function parseDateMx(str) {
  // "11/11/2024" → "2024-11-11"
  if (!str) return null;
  const [d, m, y] = str.split('/');
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function normalizeEmpNum(n) {
  // "083" y "83" deben ser iguales → comparar como número
  return String(parseInt(n, 10) || 0);
}

// Fija casing de puestos (primera letra mayúscula por palabra)
function titleCase(str) {
  if (!str) return str;
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * POST /api/rhh/nomina/sync-from-sqlite
 * Body (opcional): { sync_incidencias: true }
 *
 * Lee empleados, departamentos, puestos e incidencias del SQLite externo
 * y los sincroniza con el sistema RHH.
 * Solo disponible cuando DB_SISTEMA_RRHH_PATH está configurado (entorno local).
 */
router.post('/sync-from-sqlite', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const sqlitePath = process.env.DB_SISTEMA_RRHH_PATH;
  if (!sqlitePath) {
    return res.status(503).json({ error: 'DB_SISTEMA_RRHH_PATH no configurado (solo disponible en entorno local)' });
  }

  let sdb;
  try {
    const Database = require('better-sqlite3');
    sdb = new Database(sqlitePath, { readonly: true });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo abrir el archivo SQLite: ' + err.message });
  }

  try {
    const db = read();
    const log = { depts: { created: 0, updated: 0 }, positions: { created: 0, updated: 0 }, employees: { created: 0, updated: 0, skipped: 0 }, incidencias: { created: 0, updated: 0 } };

    // ── 1. Departamentos ───────────────────────────────────────────────────────
    const sqlDepts = sdb.prepare('SELECT DISTINCT departamento FROM empleados ORDER BY departamento').all();
    let depts = db.rhh_departments || [];

    for (const row of sqlDepts) {
      const nombre = normDeptName(row.departamento);
      if (!nombre) continue;
      const existing = depts.find(d => d.name.toLowerCase() === nombre.toLowerCase());
      if (!existing) {
        const newId = depts.length > 0 ? Math.max(...depts.map(d => d.id)) + 1 : 1;
        depts.push({ id: newId, name: nombre, code: nombre.substring(0, 4).toUpperCase(), manager_id: null });
        log.depts.created++;
      }
      // Si ya existe no sobrescribir (el usuario puede haber editado el nombre)
    }
    db.rhh_departments = depts;

    // ── 2. Puestos ─────────────────────────────────────────────────────────────
    const sqlPuestos = sdb.prepare('SELECT DISTINCT puesto FROM empleados ORDER BY puesto').all();
    let positions = db.rhh_positions || [];

    for (const row of sqlPuestos) {
      const nombre = titleCase(row.puesto?.trim() || '');
      if (!nombre) continue;
      const existing = positions.find(p => p.name.toLowerCase() === nombre.toLowerCase());
      if (!existing) {
        const newId = positions.length > 0 ? Math.max(...positions.map(p => p.id)) + 1 : 1;
        positions.push({ id: newId, name: nombre, code: null, description: null });
        log.positions.created++;
      }
    }
    db.rhh_positions = positions;

    // ── 3. Empleados ───────────────────────────────────────────────────────────
    const sqlEmps = sdb.prepare('SELECT * FROM empleados').all();
    let employees = db.rhh_employees || [];

    for (const se of sqlEmps) {
      const empNum = String(se.no_empleado || '').trim();
      if (!empNum) { log.employees.skipped++; continue; }

      const dept     = depts.find(d => d.name.toLowerCase() === normDeptName(se.departamento).toLowerCase());
      const puesto   = titleCase((se.puesto || '').trim());
      const position = positions.find(p => p.name.toLowerCase() === puesto.toLowerCase());
      const status   = (se.status || '').toLowerCase() === 'activo' ? 'active' : 'inactive';
      const hireDate = parseDateMx(se.fecha_ingreso);

      // Match por employee_number (comparando como número para tolerar ceros a la izquierda)
      const existing = employees.find(e =>
        normalizeEmpNum(e.employee_number) === normalizeEmpNum(empNum)
      );

      if (existing) {
        // Actualizar datos del sistema externo
        existing.full_name      = se.nombre?.trim() || existing.full_name;
        existing.department_id  = dept?.id    ?? existing.department_id;
        existing.position_id    = position?.id ?? existing.position_id;
        existing.rfc            = se.rfc?.trim()  || existing.rfc;
        existing.curp           = se.curp?.trim() || existing.curp;
        existing.nss            = se.afiliacion_imss?.trim() || existing.nss;
        existing.hire_date      = hireDate || existing.hire_date;
        existing.start_date     = hireDate || existing.start_date;
        existing.status         = status;
        existing.updated_at     = nowMxDate();
        log.employees.updated++;
      } else {
        // Crear empleado nuevo
        const newId = employees.length > 0 ? Math.max(...employees.map(e => Number(e.id) || 0)) + 1 : 1;
        employees.push({
          id:              newId,
          employee_number: empNum,
          full_name:       se.nombre?.trim() || '',
          email:           '',
          phone:           '',
          department_id:   dept?.id    ?? null,
          position_id:     position?.id ?? null,
          shift_id:        null,
          supervisor_id:   null,
          start_date:      hireDate,
          hire_date:       hireDate,
          birth_date:      null,
          status,
          contract_type:   'indefinido',
          base_salary:     null,
          daily_salary:    null,
          rfc:             se.rfc?.trim()  || null,
          curp:            se.curp?.trim() || null,
          nss:             se.afiliacion_imss?.trim() || null,
          checker_number:  null,
          total_vacation_days: 15,
          photo:           null,
          created_at:      nowMxDate(),
          updated_at:      nowMxDate(),
        });
        log.employees.created++;
      }
    }
    db.rhh_employees = employees;

    // ── 4. Incidencias (opcional) ──────────────────────────────────────────────
    const syncInc = req.body?.sync_incidencias === true || req.body?.sync_incidencias === 'true' || req.query.sync_incidencias === '1';
    if (syncInc) {
      const sqlIncs = sdb.prepare('SELECT * FROM incidencias').all();
      let lista = db.rhh_incidencias_semanales || [];

      // Refresca el array de empleados sincronizado para los lookups
      const empsSync = db.rhh_employees;

      for (const si of sqlIncs) {
        const emp = empsSync.find(e => normalizeEmpNum(e.employee_number) === normalizeEmpNum(si.no_empleado));
        if (!emp) continue;

        const existing = lista.find(r => r.no_periodo === Number(si.no_periodo) && r.employee_id === emp.id);
        if (existing) {
          // Solo actualiza si el registro está "vacío" (default values) para no sobreescribir capturas manuales
          if (existing._from_sqlite) {
            existing.dias_pagados         = Number(si.dias_pagados)        ?? 7;
            existing.faltas               = Number(si.faltas)              ?? 0;
            existing.horas_extras_total   = Number(si.horas_extras_total)  ?? 0;
            existing.despensa             = si.despensa ? 1 : 0;
            existing.bono_puntualidad_dias = si.bono_puntualidad_dias != null ? Number(si.bono_puntualidad_dias) : null;
            existing.bono_eficiencia_dias  = si.bono_eficiencia_dias  != null ? Number(si.bono_eficiencia_dias)  : null;
            existing.bono_instructor      = si.bono_instructor        != null ? Number(si.bono_instructor)       : null;
            existing.prima_dominical      = si.prima_dominical ? 1 : 0;
            existing.vacaciones_dias      = si.vacaciones_dias != null ? Number(si.vacaciones_dias) : null;
            existing.gratificacion        = si.gratificacion   != null ? Number(si.gratificacion)   : null;
            existing.notas                = si.notas || null;
            log.incidencias.updated++;
          }
        } else {
          const newId = lista.length > 0 ? Math.max(...lista.map(r => r.id || 0)) + 1 : 1;
          lista.push({
            id:                   newId,
            no_periodo:           Number(si.no_periodo),
            employee_id:          emp.id,
            dias_pagados:         Number(si.dias_pagados)        ?? 7,
            faltas:               Number(si.faltas)              ?? 0,
            horas_extras_total:   Number(si.horas_extras_total)  ?? 0,
            despensa:             si.despensa ? 1 : 0,
            bono_puntualidad_dias: si.bono_puntualidad_dias != null ? Number(si.bono_puntualidad_dias) : null,
            bono_eficiencia_dias:  si.bono_eficiencia_dias  != null ? Number(si.bono_eficiencia_dias)  : null,
            bono_instructor:      si.bono_instructor        != null ? Number(si.bono_instructor)       : null,
            prima_dominical:      si.prima_dominical ? 1 : 0,
            vacaciones_dias:      si.vacaciones_dias != null ? Number(si.vacaciones_dias) : null,
            gratificacion:        si.gratificacion   != null ? Number(si.gratificacion)   : null,
            notas:                si.notas || null,
            _from_sqlite:         true,
          });
          log.incidencias.created++;
        }
      }
      db.rhh_incidencias_semanales = lista;
    }

    // ── 5. Persistir ───────────────────────────────────────────────────────────
    sdb.close();
    write(db);

    res.json({
      ok: true,
      log,
      totals: {
        departments: db.rhh_departments.length,
        positions:   db.rhh_positions.length,
        employees:   db.rhh_employees.length,
        incidencias: syncInc ? (db.rhh_incidencias_semanales || []).length : 'no sincronizadas',
      }
    });

  } catch (err) {
    if (sdb) try { sdb.close(); } catch (_) {}
    console.error('[sync-from-sqlite]', err.message);
    res.status(500).json({ error: 'Error en sincronización: ' + err.message });
  }
});

/**
 * GET /api/rhh/nomina/sync-from-sqlite  →  preview (dry-run, sin escribir)
 */
router.get('/sync-from-sqlite', rhhAuthRequired, rhhRequireRole('admin'), (req, res) => {
  const sqlitePath = process.env.DB_SISTEMA_RRHH_PATH;
  if (!sqlitePath) return res.status(503).json({ error: 'DB_SISTEMA_RRHH_PATH no configurado' });

  let sdb;
  try {
    const Database = require('better-sqlite3');
    sdb = new Database(sqlitePath, { readonly: true });
    const sqlEmps  = sdb.prepare('SELECT * FROM empleados').all();
    const sqlDepts = sdb.prepare('SELECT DISTINCT departamento FROM empleados').all();
    const sqlPuest = sdb.prepare('SELECT DISTINCT puesto FROM empleados').all();
    const sqlIncs  = sdb.prepare('SELECT COUNT(*) as n FROM incidencias').get();
    sdb.close();

    const db = read();
    const existingNums = new Set((db.rhh_employees || []).map(e => normalizeEmpNum(e.employee_number)));

    const toCreate = sqlEmps.filter(e => !existingNums.has(normalizeEmpNum(e.no_empleado)));
    const toUpdate = sqlEmps.filter(e =>  existingNums.has(normalizeEmpNum(e.no_empleado)));
    const newDepts = sqlDepts.map(d => normDeptName(d.departamento)).filter(n => n && !(db.rhh_departments||[]).some(d => d.name.toLowerCase() === n.toLowerCase()));
    const newPuest = sqlPuest.map(p => titleCase(p.puesto?.trim()||'')).filter(n => n && !(db.rhh_positions||[]).some(p => p.name.toLowerCase() === n.toLowerCase()));

    res.json({
      ok: true,
      dry_run: true,
      sqlite_employees: sqlEmps.length,
      sqlite_incidencias: sqlIncs.n,
      to_create: toCreate.length,
      to_update: toUpdate.length,
      new_departments: newDepts,
      new_positions:   newPuest,
      preview_employees: sqlEmps.map(e => ({
        no_empleado: e.no_empleado,
        nombre: e.nombre,
        departamento: normDeptName(e.departamento),
        puesto: titleCase(e.puesto||''),
        status: e.status,
        action: existingNums.has(normalizeEmpNum(e.no_empleado)) ? 'actualizar' : 'crear',
      })),
    });
  } catch (err) {
    if (sdb) try { sdb.close(); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
