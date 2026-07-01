const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
const VALOR_PTS = { alto: 5, medio: 3, bajo: 1 };
const TIPOS_VALIDOS = ['actividades_area', '5s_seguridad_limpieza', 'conducta'];

function calcTotalPts(items) {
  return (items || []).reduce((s, it) => s + (VALOR_PTS[it.valor] || 0), 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIOS POR PUESTO
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/evaluations/forms
router.get('/forms', rhhAuthRequired, (req, res) => {
  const db = read();
  const forms = (db.rhh_eval_forms || []).map(f => ({
    ...f,
    position_name: (db.rhh_positions || []).find(p => p.id === f.position_id)?.name || '—',
    total_points: calcTotalPts(f.items)
  }));
  res.json(forms);
});

// POST /api/rhh/evaluations/forms
router.post('/forms', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { position_id } = req.body || {};
  if (!position_id) return res.status(400).json({ error: 'position_id requerido' });

  const forms = db.rhh_eval_forms || [];
  const existing = forms.find(f => f.position_id === Number(position_id));
  if (existing) return res.status(409).json({ error: 'Ya existe un formulario para este puesto', form: existing });

  const form = {
    id: nextId(forms),
    position_id: Number(position_id),
    items: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  forms.push(form);
  db.rhh_eval_forms = forms;
  write(db);
  res.status(201).json(form);
});

// PATCH /api/rhh/evaluations/forms/:id — update items
router.patch('/forms/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const forms = db.rhh_eval_forms || [];
  const idx = forms.findIndex(f => f.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Formulario no encontrado' });

  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items requerido (array)' });

  for (const it of items) {
    if (!String(it.name || '').trim()) return res.status(400).json({ error: 'Cada ítem debe tener nombre' });
    if (!VALOR_PTS[it.valor]) return res.status(400).json({ error: 'Valor inválido: alto, medio o bajo' });
    if (!TIPOS_VALIDOS.includes(it.tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  }

  let maxId = Math.max(0, ...(forms[idx].items || []).map(i => i.id || 0));
  const updatedItems = items.map(it => ({
    ...it,
    id: it.id || ++maxId,
    name: String(it.name).trim()
  }));

  forms[idx] = { ...forms[idx], items: updatedItems, updated_at: new Date().toISOString() };
  db.rhh_eval_forms = forms;
  write(db);
  res.json({ ...forms[idx], total_points: calcTotalPts(forms[idx].items) });
});

// DELETE /api/rhh/evaluations/forms/:form_id/items/:item_id
router.delete('/forms/:form_id/items/:item_id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const forms = db.rhh_eval_forms || [];
  const idx = forms.findIndex(f => f.id === Number(req.params.form_id));
  if (idx === -1) return res.status(404).json({ error: 'Formulario no encontrado' });

  forms[idx] = {
    ...forms[idx],
    items: (forms[idx].items || []).filter(i => i.id !== Number(req.params.item_id)),
    updated_at: new Date().toISOString()
  };
  db.rhh_eval_forms = forms;
  write(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// SESIONES DE EVALUACIÓN
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/evaluations/sessions
router.get('/sessions', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  res.json(db.rhh_eval_sessions || []);
});

// POST /api/rhh/evaluations/sessions
router.post('/sessions', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, month, year } = req.body || {};
  if (!name || !month || !year) return res.status(400).json({ error: 'name, month y year requeridos' });

  const sessions = db.rhh_eval_sessions || [];
  const session = {
    id: nextId(sessions),
    name: String(name),
    month: Number(month),
    year: Number(year),
    status: 'open',
    entries: [],
    created_at: new Date().toISOString()
  };
  sessions.push(session);
  db.rhh_eval_sessions = sessions;
  write(db);
  res.status(201).json(session);
});

// GET /api/rhh/evaluations/sessions/my-pending  ← debe ir ANTES de /:id
router.get('/sessions/my-pending', rhhAuthRequired, (req, res) => {
  const db = read();
  const userId = req.rhhUser.id;
  const sessions = (db.rhh_eval_sessions || []).filter(s => s.status === 'open');
  const results = db.rhh_eval_results || [];
  const pending = [];

  for (const session of sessions) {
    for (const entry of (session.entries || [])) {
      if (entry.evaluador_id === userId && entry.saved) {
        const alreadyDone = results.some(
          r => r.session_id === session.id && r.employee_id === entry.employee_id
        );
        const emp = (db.rhh_employees || []).find(e => e.id === entry.employee_id);
        const pos = emp ? (db.rhh_positions || []).find(p => p.id === emp.position_id) : null;
        const form = (db.rhh_eval_forms || []).find(f => f.position_id === emp?.position_id);
        pending.push({
          session_id: session.id,
          session_name: session.name,
          employee_id: entry.employee_id,
          employee_name: emp?.full_name || '—',
          position_name: pos?.name || '—',
          asistencias: entry.asistencias,
          faltas: entry.faltas,
          retardos: entry.retardos,
          actas: entry.actas,
          amonestaciones: entry.amonestaciones,
          form_id: form?.id || null,
          form_items: form?.items || [],
          form_total_points: calcTotalPts(form?.items || []),
          completed: alreadyDone
        });
      }
    }
  }

  res.json(pending);
});

// GET /api/rhh/evaluations/sessions/:id
router.get('/sessions/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const session = (db.rhh_eval_sessions || []).find(s => s.id === Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json(session);
});

// PATCH /api/rhh/evaluations/sessions/:id — close/reopen
router.patch('/sessions/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessions = db.rhh_eval_sessions || [];
  const idx = sessions.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });

  const { status } = req.body || {};
  if (status) sessions[idx] = { ...sessions[idx], status };
  db.rhh_eval_sessions = sessions;
  write(db);
  res.json(sessions[idx]);
});

// PATCH /api/rhh/evaluations/sessions/:id/entries — save entry (RH)
router.patch('/sessions/:id/entries', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessions = db.rhh_eval_sessions || [];
  const idx = sessions.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });

  const { employee_id, evaluador_id, asistencias, faltas, retardos, actas, amonestaciones } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id requerido' });

  const session = { ...sessions[idx], entries: [...(sessions[idx].entries || [])] };
  const entryIdx = session.entries.findIndex(e => e.employee_id === Number(employee_id));
  const entry = {
    employee_id: Number(employee_id),
    evaluador_id: evaluador_id ? Number(evaluador_id) : null,
    asistencias: asistencias !== undefined ? Number(asistencias) : null,
    faltas: faltas !== undefined ? Number(faltas) : null,
    retardos: retardos !== undefined ? Number(retardos) : null,
    actas: actas !== undefined ? Number(actas) : null,
    amonestaciones: amonestaciones !== undefined ? Number(amonestaciones) : null,
    saved: true
  };

  if (entryIdx >= 0) session.entries[entryIdx] = { ...session.entries[entryIdx], ...entry };
  else session.entries.push(entry);

  sessions[idx] = session;
  db.rhh_eval_sessions = sessions;
  write(db);
  res.json(session);
});

// ══════════════════════════════════════════════════════════════════════════════
// RESULTADOS DE EVALUACIÓN
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/evaluations/eval-results/employee/:id  ← ANTES de /eval-results/session/:id
router.get('/eval-results/employee/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const user = req.rhhUser;

  if (!['rh', 'admin'].includes(user.role) && user.employee_id !== empId) {
    return res.status(403).json({ error: 'Sin acceso' });
  }

  const results = (db.rhh_eval_results || [])
    .filter(r => r.employee_id === empId)
    .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));

  const sessions = db.rhh_eval_sessions || [];
  const enriched = results.map(r => {
    const session = sessions.find(s => s.id === r.session_id);
    const entry = (session?.entries || []).find(e => e.employee_id === empId);
    return {
      ...r,
      session_name: session?.name || '—',
      asistencias: entry?.asistencias ?? null,
      faltas: entry?.faltas ?? null,
      retardos: entry?.retardos ?? null,
      actas: entry?.actas ?? null,
      amonestaciones: entry?.amonestaciones ?? null
    };
  });

  res.json(enriched);
});

// GET /api/rhh/evaluations/eval-results/session/:session_id
router.get('/eval-results/session/:session_id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessionId = Number(req.params.session_id);
  const results = (db.rhh_eval_results || []).filter(r => r.session_id === sessionId);
  const employees = db.rhh_employees || [];
  const enriched = results.map(r => {
    const emp = employees.find(e => e.id === r.employee_id);
    return { ...r, employee_name: emp?.full_name || '—' };
  });
  res.json(enriched);
});

// POST /api/rhh/evaluations/eval-results
router.post('/eval-results', rhhAuthRequired, (req, res) => {
  const db = read();
  const { session_id, employee_id, form_id, item_scores } = req.body || {};
  if (!session_id || !employee_id || !form_id || !Array.isArray(item_scores)) {
    return res.status(400).json({ error: 'session_id, employee_id, form_id e item_scores requeridos' });
  }

  const form = (db.rhh_eval_forms || []).find(f => f.id === Number(form_id));
  if (!form) return res.status(404).json({ error: 'Formulario no encontrado' });

  const session = (db.rhh_eval_sessions || []).find(s => s.id === Number(session_id));
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  const entry = (session.entries || []).find(
    e => e.employee_id === Number(employee_id) && e.evaluador_id === req.rhhUser.id
  );
  if (!entry) return res.status(403).json({ error: 'No tienes asignada esta evaluación' });

  const already = (db.rhh_eval_results || []).find(
    r => r.session_id === Number(session_id) && r.employee_id === Number(employee_id)
  );
  if (already) return res.status(409).json({ error: 'Esta evaluación ya fue enviada' });

  let pointsObtained = 0;
  let totalPoints = 0;
  const scoredItems = [];

  for (const it of (form.items || [])) {
    const maxPts = VALOR_PTS[it.valor] || 0;
    const score = item_scores.find(s => s.item_id === it.id);
    const stars = score ? Math.min(5, Math.max(0, Number(score.stars))) : 0;
    const pts = Math.round((stars / 5) * maxPts * 100) / 100;
    scoredItems.push({ item_id: it.id, item_name: it.name, stars, max_points: maxPts, points: pts });
    pointsObtained += pts;
    totalPoints += maxPts;
  }

  const score_pct = totalPoints > 0 ? Math.round((pointsObtained / totalPoints) * 10000) / 100 : 0;

  const results = db.rhh_eval_results || [];
  const result = {
    id: nextId(results),
    session_id: Number(session_id),
    employee_id: Number(employee_id),
    evaluador_id: req.rhhUser.id,
    form_id: Number(form_id),
    month: session.month,
    year: session.year,
    item_scores: scoredItems,
    points_obtained: Math.round(pointsObtained * 100) / 100,
    total_points: totalPoints,
    score_pct,
    submitted_at: new Date().toISOString()
  };
  results.push(result);
  db.rhh_eval_results = results;
  write(db);

  res.status(201).json(result);
});

module.exports = router;
