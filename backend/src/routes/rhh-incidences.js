const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

const VALID_TYPES = ['falta', 'vacacion', 'incapacidad', 'permiso', 'permiso_con_goce', 'permiso_sin_goce', 'tiempo_extra', 'cumpleanos'];

// ── Utilidad: días hábiles entre dos fechas ────────────────────────────────────
function workDaysBetween(fromDate, toDate, holidayDates, workDays) {
  let count = 0;
  const from = new Date(fromDate + 'T12:00:00');
  const to = new Date(toDate + 'T12:00:00');
  const cur = new Date(from);
  while (cur <= to) {
    const dayOfWeek = cur.getDay();
    const dateStr = cur.toISOString().slice(0, 10);
    if (workDays.includes(dayOfWeek) && !holidayDates.includes(dateStr)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ── Quejas anónimas ───────────────────────────────────────────────────────────
// (Se definen PRIMERO para evitar colisión con /:id)

const VALID_COMPLAINT_CATEGORIES = [
  'acoso', 'seguridad', 'condiciones_trabajo', 'trato_injusto', 'otro'
];

// POST /api/rhh/incidences/complaints — crear queja (NO guarda employee_id)
router.post('/complaints', rhhAuthRequired, (req, res) => {
  const db = read();
  const { category, description } = req.body || {};

  if (!category || !description) {
    return res.status(400).json({ error: 'Categoría y descripción son requeridas' });
  }
  if (!VALID_COMPLAINT_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Categoría inválida' });
  }
  if (String(description).trim().length < 20) {
    return res.status(400).json({ error: 'La descripción debe tener al menos 20 caracteres' });
  }

  const complaints = db.rhh_anonymous_complaints || [];
  const complaint = {
    id: nextId(complaints),
    date: new Date().toISOString().slice(0, 10),
    category: String(category),
    description: String(description).trim(),
    status: 'new',
    response: null,
    reviewed_by: null,
    created_at: new Date().toISOString()
    // NO se guarda employee_id — es anónimo
  };

  complaints.push(complaint);
  db.rhh_anonymous_complaints = complaints;
  write(db);

  res.status(201).json({ ok: true, message: 'Tu queja ha sido registrada de forma anónima.' });
});

// GET /api/rhh/incidences/complaints — listar quejas (solo rh/admin)
router.get('/complaints', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const complaints = (db.rhh_anonymous_complaints || [])
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(complaints);
});

// PATCH /api/rhh/incidences/complaints/:id — responder/cerrar
router.patch('/complaints/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  const idx = (db.rhh_anonymous_complaints || []).findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Queja no encontrada' });

  const { status, response } = req.body || {};
  const VALID_STATUS = ['new', 'reviewed', 'closed'];

  const complaint = { ...db.rhh_anonymous_complaints[idx] };
  if (status) {
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    complaint.status = status;
  }
  if (response !== undefined) complaint.response = response;
  complaint.reviewed_by = req.rhhUser.id;
  complaint.updated_at = new Date().toISOString();

  db.rhh_anonymous_complaints[idx] = complaint;
  write(db);

  res.json(complaint);
});

// ── Aclaraciones de nómina ────────────────────────────────────────────────────
// (Se definen ANTES de /:id para evitar colisión)

const VALID_CLARIFICATION_REASONS = [
  'falta_mal_registrada', 'te_no_pagado', 'descuento_incorrecto', 'bono_no_aplicado', 'otro'
];

// POST /api/rhh/incidences/payroll-clarifications — empleado crea aclaración
router.post('/payroll-clarifications', rhhAuthRequired, (req, res) => {
  const db = read();
  const { period, reason, description, attachment_data } = req.body || {};

  if (!period || !reason || !description) {
    return res.status(400).json({ error: 'Período, motivo y descripción son requeridos' });
  }
  if (!VALID_CLARIFICATION_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Motivo inválido' });
  }

  // Determinar employee_id del solicitante
  let empId = req.rhhUser.employee_id;
  if (!empId && ['rh', 'admin'].includes(req.rhhUser.role) && req.body.employee_id) {
    empId = Number(req.body.employee_id);
  }
  if (!empId) return res.status(400).json({ error: 'No tienes un perfil de empleado vinculado' });

  const clarifications = db.rhh_payroll_clarifications || [];
  const entry = {
    id: nextId(clarifications),
    employee_id: empId,
    period: String(period),
    reason: String(reason),
    description: String(description).trim(),
    attachment_data: attachment_data || null,
    status: 'open',
    response: null,
    created_at: new Date().toISOString()
  };

  clarifications.push(entry);
  db.rhh_payroll_clarifications = clarifications;
  write(db);

  res.status(201).json(entry);
});

// GET /api/rhh/incidences/payroll-clarifications
// Empleado ve las suyas; rh/admin ve todas
router.get('/payroll-clarifications', rhhAuthRequired, (req, res) => {
  const db = read();
  let list = db.rhh_payroll_clarifications || [];

  if (req.rhhUser.role === 'empleado' && req.rhhUser.employee_id) {
    list = list.filter(c => c.employee_id === req.rhhUser.employee_id);
  }

  list = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const employees = db.rhh_employees || [];
  const enriched = list.map(c => {
    const emp = employees.find(e => e.id === c.employee_id) || null;
    return {
      ...c,
      employee: emp ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null
    };
  });

  res.json(enriched);
});

// PATCH /api/rhh/incidences/payroll-clarifications/:id — rh/admin responde
router.patch('/payroll-clarifications/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  const idx = (db.rhh_payroll_clarifications || []).findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Aclaración no encontrada' });

  const { status, response } = req.body || {};
  const VALID_STATUS = ['open', 'in_review', 'resolved'];

  const entry = { ...db.rhh_payroll_clarifications[idx] };
  if (status) {
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    entry.status = status;
  }
  if (response !== undefined) entry.response = response;
  entry.reviewed_by = req.rhhUser.id;
  entry.updated_at = new Date().toISOString();

  db.rhh_payroll_clarifications[idx] = entry;
  write(db);

  res.json(entry);
});

// ── Reglas de vacaciones ──────────────────────────────────────────────────────

// GET /api/rhh/incidences/vacation-rules
router.get('/vacation-rules', rhhAuthRequired, (req, res) => {
  const db = read();
  const rules = db.rhh_vacation_rules || [];
  if (rules.length === 0) {
    // Reglas por defecto
    return res.json({
      id: 1,
      name: 'Reglas de vacaciones',
      rules: [
        { max_days: 1, min_advance_days: 1, label: '1 día: mínimo 1 día de anticipación' },
        { max_days: 3, min_advance_days: 7, label: '2-3 días: mínimo 1 semana de anticipación' },
        { max_days: 999, min_advance_days: 14, label: '4+ días: mínimo 2 semanas de anticipación' }
      ],
      max_days_per_week: 1,
      count_holidays: true,
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by: null
    });
  }
  res.json(rules[0]);
});

// PATCH /api/rhh/incidences/vacation-rules — solo admin/rh
router.patch('/vacation-rules', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { rules, max_days_per_week, count_holidays } = req.body || {};

  let vacRules = db.rhh_vacation_rules || [];
  const existing = vacRules.length > 0 ? { ...vacRules[0] } : {
    id: 1,
    name: 'Reglas de vacaciones',
    rules: [],
    max_days_per_week: 1,
    count_holidays: true,
    updated_at: null,
    updated_by: null
  };

  if (Array.isArray(rules)) existing.rules = rules;
  if (max_days_per_week !== undefined) existing.max_days_per_week = Number(max_days_per_week);
  if (count_holidays !== undefined) existing.count_holidays = Boolean(count_holidays);
  existing.updated_at = new Date().toISOString();
  existing.updated_by = req.rhhUser.id;

  if (vacRules.length > 0) {
    vacRules[0] = existing;
  } else {
    vacRules = [existing];
  }
  db.rhh_vacation_rules = vacRules;
  write(db);

  res.json(existing);
});

// ── Incidencias ───────────────────────────────────────────────────────────────

// GET /api/rhh/incidences/today-absences
router.get('/today-absences', rhhAuthRequired, (req, res) => {
  const db = read();
  const today = new Date().toISOString().slice(0, 10);

  let employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    employees = employees.filter(e => e.supervisor_id === req.rhhUser.employee_id);
  }

  const todayIncidences = (db.rhh_incidences || []).filter(
    i => i.date === today && i.status !== 'rechazada'
  );

  const absences = todayIncidences.filter(i =>
    ['falta', 'vacacion', 'incapacidad', 'permiso'].includes(i.type)
  );

  const result = absences.map(inc => {
    const emp = employees.find(e => e.id === inc.employee_id) || null;
    const dept = emp ? (db.rhh_departments || []).find(d => d.id === emp.department_id) : null;
    const shift = emp ? (db.rhh_shifts || []).find(s => s.id === emp.shift_id) : null;
    return { ...inc, employee: emp, department: dept, shift };
  }).filter(a => a.employee !== null);

  res.json({ date: today, count: result.length, absences: result });
});

// GET /api/rhh/incidences/coverage-suggestions
router.get('/coverage-suggestions', rhhAuthRequired, (req, res) => {
  const db = read();
  const { date, shift_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date es requerido' });

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const shiftFilter = shift_id ? Number(shift_id) : null;

  const incidencesOnDate = (db.rhh_incidences || []).filter(
    i => i.date === date && i.status !== 'rechazada' &&
    ['falta', 'vacacion', 'incapacidad', 'permiso'].includes(i.type)
  );
  const absentIds = new Set(incidencesOnDate.map(i => i.employee_id));

  let available = (db.rhh_employees || []).filter(e => {
    if (e.status !== 'active') return false;
    if (absentIds.has(e.id)) return false;
    const shift = (db.rhh_shifts || []).find(s => s.id === e.shift_id);
    if (!shift) return false;
    return true;
  });

  const shifts = db.rhh_shifts || [];
  available = available.map(emp => {
    const shift = shifts.find(s => s.id === emp.shift_id) || null;
    const worksToday = shift ? shift.work_days.includes(dayOfWeek) : false;
    return { ...emp, shift, worksToday, priority: worksToday ? 2 : 1 };
  }).sort((a, b) => b.priority - a.priority);

  res.json({ date, suggestions: available });
});

// GET /api/rhh/incidences
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  let list = db.rhh_incidences || [];

  const { employee_id, type, date_from, date_to, status } = req.query;

  // Empleado solo ve las suyas
  if (req.rhhUser.role === 'empleado' && req.rhhUser.employee_id) {
    list = list.filter(i => i.employee_id === req.rhhUser.employee_id);
  } else if (req.rhhUser.role === 'supervisor' && req.rhhUser.employee_id) {
    // Supervisor ve las de sus subordinados
    const subordinates = (db.rhh_employees || [])
      .filter(e => e.supervisor_id === req.rhhUser.employee_id)
      .map(e => e.id);
    subordinates.push(req.rhhUser.employee_id);
    list = list.filter(i => subordinates.includes(i.employee_id));
  }

  if (employee_id) list = list.filter(i => i.employee_id === Number(employee_id));
  if (type) list = list.filter(i => i.type === type);
  if (status) list = list.filter(i => i.status === status);
  if (date_from) list = list.filter(i => i.date >= date_from);
  if (date_to) list = list.filter(i => i.date <= date_to);

  list = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const employees = db.rhh_employees || [];
  const departments = db.rhh_departments || [];
  const shifts = db.rhh_shifts || [];

  const enriched = list.map(inc => {
    const emp = employees.find(e => e.id === inc.employee_id) || null;
    const dept = emp ? departments.find(d => d.id === emp.department_id) : null;
    const shift = emp ? shifts.find(s => s.id === emp.shift_id) : null;
    return {
      ...inc,
      employee: emp ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null,
      department: dept ? { id: dept.id, name: dept.name } : null,
      shift: shift ? { id: shift.id, name: shift.name } : null
    };
  });

  res.json(enriched);
});

// POST /api/rhh/incidences
router.post('/', rhhAuthRequired, (req, res) => {
  const db = read();
  const { employee_id, type, date, date_end, notes, hours } = req.body || {};

  if (!type || !date) return res.status(400).json({ error: 'Tipo y fecha son requeridos' });
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de incidencia inválido' });

  // Determinar employee_id
  let targetEmpId = employee_id ? Number(employee_id) : null;

  // Si es empleado, solo puede registrar para sí mismo
  if (req.rhhUser.role === 'empleado') {
    targetEmpId = req.rhhUser.employee_id;
  }

  if (!targetEmpId) return res.status(400).json({ error: 'employee_id requerido' });

  const emp = (db.rhh_employees || []).find(e => e.id === targetEmpId && e.status === 'active');
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  // ── Validaciones para vacaciones y permisos (Automatización 4) ───────────────
  const isVacationType = ['vacacion', 'permiso_con_goce', 'permiso_sin_goce', 'permiso'].includes(type);
  if (isVacationType) {
    const today = new Date().toISOString().slice(0, 10);
    const endDate = date_end || date;
    const holidayDates = (db.rhh_holidays || []).map(h => h.date);
    const shift = (db.rhh_shifts || []).find(s => s.id === emp.shift_id);
    const workDays = shift ? (shift.work_days || [1,2,3,4,5]) : [1,2,3,4,5];

    const vacRules = db.rhh_vacation_rules || [];
    const currentRules = vacRules.length > 0 ? vacRules[0] : {
      rules: [
        { max_days: 1, min_advance_days: 1 },
        { max_days: 3, min_advance_days: 7 },
        { max_days: 999, min_advance_days: 14 }
      ],
      count_holidays: true
    };

    // Calcular días de la solicitud
    const requestedDays = workDaysBetween(date, endDate, currentRules.count_holidays ? holidayDates : [], workDays);

    // Solo para vacaciones: validar días disponibles
    if (type === 'vacacion') {
      const currentYear = new Date(date).getFullYear();
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;

      const usedDays = (db.rhh_incidences || []).filter(i =>
        i.employee_id === targetEmpId &&
        i.type === 'vacacion' &&
        i.status === 'aprobada' &&
        i.date >= yearStart && i.date <= yearEnd
      ).reduce((acc, i) => {
        const eDate = i.date_end || i.date;
        return acc + workDaysBetween(i.date, eDate, currentRules.count_holidays ? holidayDates : [], workDays);
      }, 0);

      const totalVac = emp.total_vacation_days || 15;
      const remaining = totalVac - usedDays;

      if (requestedDays > remaining) {
        return res.status(400).json({
          error: `No tienes suficientes días de vacaciones. Tienes ${remaining} días disponibles y estás solicitando ${requestedDays}.`
        });
      }
    }

    // Validar reglas de anticipación
    const advanceDays = workDaysBetween(today, date, holidayDates, workDays);
    const rules = currentRules.rules || [];
    // Ordenar por max_days ascendente
    const sortedRules = [...rules].sort((a, b) => a.max_days - b.max_days);
    let applicableRule = null;
    for (const rule of sortedRules) {
      if (requestedDays <= rule.max_days) {
        applicableRule = rule;
        break;
      }
    }

    if (applicableRule && advanceDays < applicableRule.min_advance_days) {
      return res.status(400).json({
        error: `Para solicitar ${requestedDays} día(s) necesitas al menos ${applicableRule.min_advance_days} día(s) de anticipación. Tu solicitud empieza en ${advanceDays} día(s) hábil(es).`,
        advance_days: advanceDays,
        required_advance: applicableRule.min_advance_days,
        requested_days: requestedDays
      });
    }
  }

  // Determinar estado inicial según rol
  let initialStatus = 'pendiente';
  if (['rh', 'admin'].includes(req.rhhUser.role)) {
    initialStatus = 'aprobada';
  }
  // Faltas registradas por supervisor se aprueban automáticamente
  if (req.rhhUser.role === 'supervisor' && type === 'falta') {
    initialStatus = 'aprobada';
  }

  const incidences = db.rhh_incidences || [];
  const inc = {
    id: nextId(incidences),
    employee_id: targetEmpId,
    type: String(type),
    date: String(date),
    date_end: date_end || String(date),
    hours: hours ? Number(hours) : null,
    notes: notes || null,
    status: initialStatus,
    created_by: req.rhhUser.id,
    created_at: new Date().toISOString(),
    approved_by: initialStatus === 'aprobada' ? req.rhhUser.id : null,
    approved_at: initialStatus === 'aprobada' ? new Date().toISOString() : null
  };

  incidences.push(inc);
  db.rhh_incidences = incidences;
  write(db);

  res.status(201).json(inc);
});

// PATCH /api/rhh/incidences/:id — aprobar/rechazar o editar
router.patch('/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const idx = (db.rhh_incidences || []).findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Incidencia no encontrada' });

  const inc = { ...db.rhh_incidences[idx] };

  // Solo supervisor/rh/admin pueden cambiar status
  if (req.body.status !== undefined) {
    if (!['supervisor', 'rh', 'admin'].includes(req.rhhUser.role)) {
      return res.status(403).json({ error: 'No autorizado para cambiar el estado' });
    }
    const newStatus = req.body.status;
    if (!['aprobada', 'rechazada', 'pendiente'].includes(newStatus)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    inc.status = newStatus;
    if (newStatus === 'aprobada') {
      inc.approved_by = req.rhhUser.id;
      inc.approved_at = new Date().toISOString();
    } else if (newStatus === 'rechazada') {
      inc.rejected_by = req.rhhUser.id;
      inc.rejected_at = new Date().toISOString();
      inc.rejection_reason = req.body.rejection_reason || null;
    }
  }

  // Edición de campos (solo rh/admin o el creador si sigue pendiente)
  const editableFields = ['type', 'date', 'date_end', 'hours', 'notes'];
  const canEdit = ['rh', 'admin'].includes(req.rhhUser.role) ||
    (inc.created_by === req.rhhUser.id && inc.status === 'pendiente');

  if (canEdit) {
    for (const field of editableFields) {
      if (req.body[field] !== undefined) inc[field] = req.body[field];
    }
  }

  inc.updated_at = new Date().toISOString();
  db.rhh_incidences[idx] = inc;
  write(db);

  res.json(inc);
});

// DELETE /api/rhh/incidences/:id
router.delete('/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const idx = (db.rhh_incidences || []).findIndex(i => i.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Incidencia no encontrada' });

  db.rhh_incidences.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

module.exports = router;
