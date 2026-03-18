const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ── Plantillas ────────────────────────────────────────────────────────────────

// GET /api/rhh/evaluations/templates
router.get('/templates', rhhAuthRequired, (req, res) => {
  const db = read();
  res.json(db.rhh_evaluation_templates || []);
});

// POST /api/rhh/evaluations/templates
router.post('/templates', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, position_id, fields } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name es requerido' });

  const templates = db.rhh_evaluation_templates || [];
  const tpl = {
    id: nextId(templates),
    name: String(name),
    position_id: position_id ? Number(position_id) : null,
    fields: Array.isArray(fields) ? fields : [],
    created_at: new Date().toISOString()
  };

  templates.push(tpl);
  db.rhh_evaluation_templates = templates;
  write(db);

  res.status(201).json(tpl);
});

// ── Periodos ──────────────────────────────────────────────────────────────────

// GET /api/rhh/evaluations/periods
router.get('/periods', rhhAuthRequired, (req, res) => {
  const db = read();
  res.json(db.rhh_evaluation_periods || []);
});

// POST /api/rhh/evaluations/periods
router.post('/periods', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, start_date, end_date, evaluations } = req.body || {};
  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: 'name, start_date y end_date son requeridos' });
  }

  const periods = db.rhh_evaluation_periods || [];
  const period = {
    id: nextId(periods),
    name: String(name),
    start_date,
    end_date,
    status: 'open',
    quality_met: null,
    claims_met: null,
    evaluations: Array.isArray(evaluations) ? evaluations.map(e => ({
      evaluator_id: Number(e.evaluator_id),
      employee_id: Number(e.employee_id),
      template_id: Number(e.template_id),
      completed: false
    })) : [],
    created_at: new Date().toISOString()
  };

  periods.push(period);
  db.rhh_evaluation_periods = periods;
  write(db);

  res.status(201).json(period);
});

// PATCH /api/rhh/evaluations/periods/:id
router.patch('/periods/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  const periods = db.rhh_evaluation_periods || [];
  const idx = periods.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Periodo no encontrado' });

  const p = { ...periods[idx] };
  const { status, quality_met, claims_met } = req.body || {};

  if (status !== undefined) {
    const VALID = ['open', 'closed', 'draft'];
    if (!VALID.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    p.status = status;
  }
  if (quality_met !== undefined) p.quality_met = Boolean(quality_met);
  if (claims_met !== undefined) p.claims_met = Boolean(claims_met);
  p.updated_at = new Date().toISOString();

  periods[idx] = p;
  db.rhh_evaluation_periods = periods;
  write(db);

  res.json(p);
});

// ── Evaluaciones pendientes del evaluador ─────────────────────────────────────

// GET /api/rhh/evaluations/my-pending
router.get('/my-pending', rhhAuthRequired, (req, res) => {
  const db = read();
  const userId = req.rhhUser.id;
  const periods = (db.rhh_evaluation_periods || []).filter(p => p.status !== 'closed');
  const pending = [];

  for (const period of periods) {
    for (const assignment of (period.evaluations || [])) {
      if (assignment.evaluator_id === userId && !assignment.completed) {
        const emp = (db.rhh_employees || []).find(e => e.id === assignment.employee_id) || null;
        const tpl = (db.rhh_evaluation_templates || []).find(t => t.id === assignment.template_id) || null;
        pending.push({
          period_id: period.id,
          period_name: period.name,
          employee_id: assignment.employee_id,
          employee_name: emp ? emp.full_name : '—',
          template_id: assignment.template_id,
          template_name: tpl ? tpl.name : '—',
          template: tpl
        });
      }
    }
  }

  res.json(pending);
});

// ── Enviar evaluación ─────────────────────────────────────────────────────────

// POST /api/rhh/evaluations/submit
router.post('/submit', rhhAuthRequired, (req, res) => {
  const db = read();
  const { period_id, employee_id, template_id, answers, notes } = req.body || {};

  if (!period_id || !employee_id || !template_id || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'period_id, employee_id, template_id y answers son requeridos' });
  }

  const periods = db.rhh_evaluation_periods || [];
  const periodIdx = periods.findIndex(p => p.id === Number(period_id));
  if (periodIdx === -1) return res.status(404).json({ error: 'Periodo no encontrado' });

  const period = periods[periodIdx];

  // Verificar asignación
  const assignIdx = (period.evaluations || []).findIndex(
    e => e.evaluator_id === req.rhhUser.id &&
         e.employee_id === Number(employee_id) &&
         e.template_id === Number(template_id)
  );
  if (assignIdx === -1) {
    return res.status(403).json({ error: 'No tienes asignada esta evaluación' });
  }

  // Cargar plantilla
  const tpl = (db.rhh_evaluation_templates || []).find(t => t.id === Number(template_id));
  if (!tpl) return res.status(404).json({ error: 'Plantilla no encontrada' });

  // Calcular score
  let weightedSum = 0;
  let totalWeight = 0;

  for (const field of (tpl.fields || [])) {
    const answer = answers.find(a => a.field_id === field.id);
    if (!answer) continue;

    let fieldScore = 0;
    if (field.type === 'score_1_5') {
      fieldScore = (Number(answer.value) / 5) * 100;
    } else if (field.type === 'score_1_10') {
      fieldScore = (Number(answer.value) / 10) * 100;
    } else if (field.type === 'boolean') {
      fieldScore = answer.value ? 100 : 0;
    } else if (field.type === 'text') {
      fieldScore = 0;
    }

    const weight = Number(field.weight) || 0;
    weightedSum += fieldScore * (weight / 100);
    totalWeight += weight;
  }

  // Normalizar si el total de pesos != 100
  const score = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
  const score_final = Math.round(score * 100) / 100;

  // Calcular bonus_days
  const dia_desempeno = score_final / 100;
  const dia_calidad = period.quality_met === true ? 1 : 0;
  const dia_reclamos = period.claims_met === true ? 1 : 0;
  const bonus_days = Math.round((dia_desempeno + dia_calidad + dia_reclamos) * 100) / 100;

  // Guardar evaluación
  const evaluations = db.rhh_evaluations || [];
  const evaluation = {
    id: nextId(evaluations),
    period_id: Number(period_id),
    employee_id: Number(employee_id),
    evaluator_id: req.rhhUser.id,
    template_id: Number(template_id),
    answers,
    score: score_final,
    bonus_days,
    dia_desempeno: Math.round(dia_desempeno * 100) / 100,
    dia_calidad,
    dia_reclamos,
    submitted_at: new Date().toISOString(),
    notes: notes || ''
  };

  evaluations.push(evaluation);
  db.rhh_evaluations = evaluations;

  // Marcar como completada en el periodo
  const updatedPeriod = { ...period, evaluations: [...(period.evaluations || [])] };
  updatedPeriod.evaluations[assignIdx] = { ...updatedPeriod.evaluations[assignIdx], completed: true };
  periods[periodIdx] = updatedPeriod;
  db.rhh_evaluation_periods = periods;

  write(db);

  res.status(201).json(evaluation);
});

// ── Resultados del periodo ────────────────────────────────────────────────────

// GET /api/rhh/evaluations/results/:period_id
router.get('/results/:period_id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const periodId = Number(req.params.period_id);
  const period = (db.rhh_evaluation_periods || []).find(p => p.id === periodId);
  if (!period) return res.status(404).json({ error: 'Periodo no encontrado' });

  const evals = (db.rhh_evaluations || []).filter(e => e.period_id === periodId);

  const results = evals.map(ev => {
    const emp = (db.rhh_employees || []).find(e => e.id === ev.employee_id) || null;
    return {
      employee_id: ev.employee_id,
      employee_name: emp ? emp.full_name : '—',
      score: ev.score,
      bonus_days: ev.bonus_days,
      dia_desempeno: ev.dia_desempeno,
      dia_calidad: ev.dia_calidad,
      dia_reclamos: ev.dia_reclamos
    };
  });

  res.json({ period, results });
});

module.exports = router;
