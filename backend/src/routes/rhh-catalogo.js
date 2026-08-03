/**
 * Catálogo de Empleados — lee siempre del JSON del repositorio
 * (evita el problema de caché PostgreSQL desactualizado)
 */
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');

const router = express.Router();

const dbPath = path.resolve(process.cwd(), process.env.DB_RHH_PATH || './database/rhh.json');

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// Lee el JSON fresco del disco (no la caché PostgreSQL)
function readFresh() {
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
  catch (e) { return null; }
}

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

  res.json({
    employee: enriched,
    incidencias,
    aclaraciones,
    vacaciones,
    evaluaciones,
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

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
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

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
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

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  res.json({ ok: true });
});

module.exports = router;
