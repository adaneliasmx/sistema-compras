/* ══════════════════════════════════════════════════════════════════════════════
   RHH — Módulo Nómina Semanal
   Períodos, incidencias semanales, HE detalle, solicitudes vac/TE
   ══════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

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
  const periodos = (db.rhh_periodos || []).length > 0
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));
  res.json(periodos);
});

// POST /api/rhh/nomina/periodos/seed  (rh/admin)
router.post('/periodos/seed', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  db.rhh_periodos = PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));
  write(db);
  res.json({ ok: true, count: db.rhh_periodos.length });
});

// ── Incidencias Semanales ─────────────────────────────────────────────────────

// GET /api/rhh/nomina/incidencias?no_periodo=X
router.get('/incidencias', rhhAuthRequired, (req, res) => {
  const db = read();
  const no_periodo = Number(req.query.no_periodo);
  if (!no_periodo) return res.status(400).json({ error: 'no_periodo requerido' });

  const lista     = db.rhh_incidencias_semanales || [];
  const employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  const depts     = db.rhh_departments || [];

  const result = employees.map(emp => {
    const inc = lista.find(i => i.no_periodo === no_periodo && i.employee_id === emp.id) || {};
    const dept = depts.find(d => d.id === emp.department_id);
    return {
      id:                  inc.id || null,
      no_periodo,
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
router.post('/incidencias/bulk', rhhAuthRequired, rhhRequireRole('rh', 'admin', 'supervisor'), (req, res) => {
  const db = read();
  const { no_periodo, rows } = req.body || {};
  if (!no_periodo || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'no_periodo y rows[] requeridos' });
  }

  const lista = db.rhh_incidencias_semanales || [];
  let saved = 0;

  for (const row of rows) {
    const empId = Number(row.employee_id);
    if (!empId) continue;
    const idx = lista.findIndex(i => i.no_periodo === Number(no_periodo) && i.employee_id === empId);

    const record = {
      no_periodo:            Number(no_periodo),
      employee_id:           empId,
      dias_pagados:          row.dias_pagados          !== undefined ? Number(row.dias_pagados)          : 7,
      faltas:                row.faltas                !== undefined ? Number(row.faltas)                : 0,
      horas_extras_total:    row.horas_extras_total    !== undefined ? Number(row.horas_extras_total)    : 0,
      despensa:              row.despensa              !== undefined ? (row.despensa ? 1 : 0)            : 1,
      bono_puntualidad_dias: row.bono_puntualidad_dias != null ? Number(row.bono_puntualidad_dias) : null,
      bono_eficiencia_dias:  row.bono_eficiencia_dias  != null ? Number(row.bono_eficiencia_dias)  : null,
      bono_instructor:       row.bono_instructor       != null ? Number(row.bono_instructor)       : null,
      prima_dominical:       row.prima_dominical       !== undefined ? (row.prima_dominical ? 1 : 0) : 0,
      vacaciones_dias:       row.vacaciones_dias       != null ? Number(row.vacaciones_dias)       : null,
      gratificacion:         row.gratificacion         != null ? Number(row.gratificacion)         : null,
      notas:                 row.notas || '',
      updated_by:            req.rhhUser.id,
      updated_at:            new Date().toISOString(),
    };

    if (idx !== -1) {
      record.id = lista[idx].id;
      record.created_at = lista[idx].created_at;
      lista[idx] = record;
    } else {
      record.id = nextId(lista);
      record.created_at = new Date().toISOString();
      lista.push(record);
    }
    saved++;
  }

  db.rhh_incidencias_semanales = lista;
  write(db);
  res.json({ ok: true, saved });
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

  const { estado } = req.query;
  if (estado) lista = lista.filter(s => s.estado === estado);

  const employees = db.rhh_employees  || [];
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

  const employees = db.rhh_employees || [];
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

  const periodos   = (db.rhh_periodos || []).length > 0
    ? db.rhh_periodos
    : PERIODOS_2026.map((p, i) => ({ id: i + 1, ...p }));
  const periodo    = periodos.find(p => p.no_periodo === no_periodo);
  const lista      = (db.rhh_incidencias_semanales || []).filter(i => i.no_periodo === no_periodo);
  const employees  = (db.rhh_employees || []).filter(e => e.status === 'active');
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
        departamento:         dept?.name || '',
        puesto:               pos?.name  || '',
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

  res.json({ periodo, rows, generated_at: nowMxDate() });
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

module.exports = router;
