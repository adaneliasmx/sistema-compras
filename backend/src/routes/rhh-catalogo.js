const express = require('express');
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');
const { read, write, writeAsync, nextId, dbPath, seedPath, forceSeedFromJson } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

function readFresh() { return read(); }

// ── GET /api/rhh/catalogo/diag ─── DIAGNÓSTICO PÚBLICO (sin auth) ─────────────
router.get('/diag', (req, res) => {
  const db = read();
  const emps = db.rhh_employees || [];
  const reales = emps.filter(e => {
    const num = String(e.employee_number || '').trim();
    return num.length >= 3 && /^\d+$/.test(num.replace(/^0+/, '') || '0');
  });
  res.json({
    seedPath,
    seedExists: fs.existsSync(seedPath),
    dbPath,
    totalEmpleados: emps.length,
    empleadosReales: reales.length,
    activos: reales.filter(e => e.status === 'active').length,
    primerEmp: reales[0] ? { id: reales[0].id, num: reales[0].employee_number, name: reales[0].full_name } : null,
  });
});

// ── POST /api/rhh/catalogo/force-seed ─── RESEED DESDE JSON (key simple) ──────
router.post('/force-seed', async (req, res) => {
  const { key } = req.query;
  const expectedKey = process.env.RHH_SEED_KEY || 'cuesto2026rhh';
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
    employee:    enriched,
    incidencias,
    aclaraciones,
    vacaciones,
    evaluaciones,
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

  write(db);
  res.json({ ok: true });
});

// ── PATCH /api/rhh/catalogo/:id/info ──────────────────────────────────────────
// Actualizar dept/puesto/turno/status de un empleado individual
router.patch('/:id/info', rhhAuthRequired, rhhRequireRole('admin', 'rh'), (req, res) => {
  const db = readFresh();
  if (!db) return res.status(500).json({ error: 'Error leyendo catálogo' });

  const emp = (db.rhh_employees || []).find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const { department_id, position_id, shift_id, status, phone, email, start_date, salary_daily } = req.body || {};
  if (department_id !== undefined) emp.department_id = department_id ? Number(department_id) : null;
  if (position_id   !== undefined) emp.position_id   = position_id   ? Number(position_id)   : null;
  if (shift_id      !== undefined) emp.shift_id      = shift_id      ? Number(shift_id)      : null;
  if (status        !== undefined) emp.status        = status;
  if (phone         !== undefined) emp.phone         = phone   || null;
  if (email         !== undefined) emp.email         = email   || null;
  if (start_date    !== undefined) emp.start_date    = start_date || null;
  if (salary_daily  !== undefined) emp.salary_daily  = salary_daily ? Number(salary_daily) : null;
  emp.updated_at = nowMxDate();

  write(db);
  res.json({ ok: true, employee: enrich(emp, db) });
});

// ── POST /api/rhh/catalogo/import-contpaq ─────────────────────────────────────
// Soporta dos formatos:
//
// 1. CONSOLIDADO (CONSOLIDADO_Listas_Raya_2026.xlsx — hoja "Consolidado"):
//    Detección: col 0 = "semana", col 3 = "No. Empleado", cols con "P | " y "D | "
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

    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (e) {
      return res.status(400).json({ error: 'Archivo no válido: ' + e.message });
    }

    const sheetName = wb.SheetNames[0];
    const ws  = wb.Sheets[sheetName];
    const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (all.length < 2) return res.status(400).json({ error: 'El archivo no tiene datos' });

    const norm     = v => String(v || '').trim();
    const normName = s => s.toLowerCase().replace(/\*/g, '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const toNum    = v => { const n = parseFloat(String(v || '').replace(/,/g, '')); return isNaN(n) ? null : n; };

    // Detectar formato: CONSOLIDADO vs LISTA ASISTENCIA
    const hdrs = all[0].map(v => norm(v).toLowerCase());
    const isConsolidado = hdrs[0] === 'semana' &&
      all[0].some(v => String(v).startsWith('P | ') || String(v).startsWith('P(info) | '));

    const db = readFresh();
    const emps = db.rhh_employees || [];
    if (!Array.isArray(db.rhh_incidencias_semanales)) db.rhh_incidencias_semanales = [];

    let updated = 0, skipped = 0, created_depts = 0, created_pos = 0, inc_upserted = 0;
    const semanasImportadas = new Set();
    const log = [];

    function findEmpByNum(num) {
      const n = norm(num).replace(/^0+/, '');
      return emps.find(e => norm(e.employee_number || '').replace(/^0+/, '') === n) || null;
    }

    function findEmpByNameOrNum(excelNum, excelName) {
      const byNum = findEmpByNum(excelNum);
      if (byNum) return byNum;
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

    function upsertIncidencia(emp, noPeriodo, rec) {
      const incList = db.rhh_incidencias_semanales;
      const existIdx = incList.findIndex(r => r.employee_id === emp.id && r.no_periodo === noPeriodo);
      if (existIdx !== -1) {
        incList[existIdx] = { ...incList[existIdx], ...rec, updated_at: nowMxDate() };
      } else {
        incList.push({ id: nextId(incList), employee_id: emp.id, no_periodo: noPeriodo,
                       faltas: 0, notas: '', created_at: nowMxDate(), ...rec });
      }
      inc_upserted++;
      semanasImportadas.add(noPeriodo);
    }

    // ── FORMATO CONSOLIDADO ──────────────────────────────────────────────────
    if (isConsolidado) {
      // Mapear índices de columnas desde los encabezados
      const hdrRaw = all[0];
      const colIdx = {};
      hdrRaw.forEach((v, i) => { colIdx[norm(v)] = i; });

      const semanaCol   = colIdx['semana']        ?? 0;
      const empNumCol   = colIdx['No. Empleado']  ?? 3;
      const nombreCol   = colIdx['Nombre']        ?? 4;
      const deptCol     = colIdx['Departamento']  ?? 5;
      const puestoCol   = colIdx['Puesto']        ?? 6;
      const salDiarioCol= colIdx['Sal. Diario']   ?? 11;
      const sdiCol      = colIdx['SDI']           ?? 12;
      const sbcCol      = colIdx['SBC']           ?? 13;
      const fechaIngCol = colIdx['Fecha Ingreso'] ?? 10;
      const diasPagCol  = colIdx['Días Pagados']  ?? 15;
      const hrsExtCol   = colIdx['Hrs. Extras']   ?? 17;
      const notasCol    = colIdx['Notas']         ?? 18;

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

      for (const row of all.slice(1)) {
        const semana = Number(row[semanaCol]);
        if (!semana) continue;
        if (filterSemana && semana !== filterSemana) continue;

        const empNumRaw = norm(row[empNumCol]);
        const empName   = norm(row[nombreCol]);
        if (!empNumRaw && !empName) { skipped++; continue; }

        const emp = findEmpByNum(empNumRaw) || findEmpByNameOrNum(empNumRaw, empName);
        if (!emp) { skipped++; if (log.length < 20) log.push(`S${semana} #${empNumRaw} "${empName}": no encontrado`); continue; }

        // Actualizar campos del empleado
        const deptName   = norm(row[deptCol]);
        const posName    = norm(row[puestoCol]);
        const salDiario  = toNum(row[salDiarioCol]);
        const sdi        = toNum(row[sdiCol]);
        const sbc        = toNum(row[sbcCol]);
        const fechaIngr  = norm(row[fechaIngCol]);
        let empChanged = false;

        const deptId = findOrCreateDept(deptName);
        const posId  = findOrCreatePos(posName, deptId);
        if (emp.department_id !== deptId) { emp.department_id = deptId; empChanged = true; }
        if (emp.position_id   !== posId)  { emp.position_id   = posId;  empChanged = true; }
        if (salDiario && emp.sal_diario !== salDiario) { emp.sal_diario = salDiario; emp.salary_daily = salDiario; empChanged = true; }
        if (sdi && emp.sdi !== sdi) { emp.sdi = sdi; empChanged = true; }
        if (sbc && emp.sbc !== sbc) { emp.sbc = sbc; empChanged = true; }
        if (fechaIngr && emp.fecha_ingreso !== fechaIngr) { emp.fecha_ingreso = fechaIngr; empChanged = true; }
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

        upsertIncidencia(emp, semana, {
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

      try {
        await writeAsync(db);
      } catch (e) {
        console.error('[import-contpaq] Error al persistir en DB:', e.message);
        return res.status(500).json({ error: 'Datos procesados pero no se pudo guardar en la base de datos: ' + e.message });
      }
      const semanasList = [...semanasImportadas].sort((a,b)=>a-b);
      return res.json({
        ok: true, formato: 'consolidado',
        updated, created_depts, created_pos, skipped, inc_upserted,
        semanas: semanasList, log,
      });
    }

    // ── FORMATO LISTA ASISTENCIA (semana X) ──────────────────────────────────
    let noPeriodo = Number(req.body?.no_periodo) || null;
    if (!noPeriodo) {
      const sheetMatch = sheetName.match(/semana\s*(\d+)/i);
      if (sheetMatch) noPeriodo = Number(sheetMatch[1]);
    }
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
      if (emp.department_id !== deptId || emp.position_id !== posId) {
        emp.department_id = deptId; emp.position_id = posId;
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
        upsertIncidencia(emp, noPeriodo, {
          dias_pagados: diasPagados, faltas, horas_extras_total: teTotal,
          despensa: 1, prima_dominical: primaDom, vacaciones_dias: vacDias || 0,
          source: 'excel_import',
        });
      }
    }

    try {
      await writeAsync(db);
    } catch (e) {
      console.error('[import-contpaq] Error al persistir en DB:', e.message);
      return res.status(500).json({ error: 'Datos procesados pero no se pudo guardar en la base de datos: ' + e.message });
    }
    res.json({ ok: true, formato: 'lista_asistencia',
               updated, created_depts, created_pos, skipped, inc_upserted,
               semanas: noPeriodo ? [noPeriodo] : [], log });
  }
);

module.exports = router;
