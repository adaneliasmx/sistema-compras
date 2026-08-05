const express = require('express');
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');
const { read, write, nextId, dbPath, seedPath, forceSeedFromJson } = require('../db-rhh');
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
// Importar desde Excel de lista asistencia CONTPAQ i:
//   - Departamento y Puesto del empleado
//   - Incidencias semanales (dias_pagados, faltas, horas_extra, vacaciones, prima_dominical)
// Formato esperado (primera hoja): "lista asistencia semana X"
//   col 0=No, col 1=Nombre, col 2=Área, col 4=Puesto, col 5=Turno
//   cols 6,10,14,18,22,26,30 = Status día (Labora/Falta/Vacaciones/Descanso/Retardo...)
//   cols 8,12,16,20,24,28,32 = Horas TE por día
// Devuelve: { updated, created_depts, created_pos, inc_upserted, skipped, log }
router.post(
  '/import-contpaq',
  rhhAuthRequired,
  rhhRequireRole('admin', 'rh'),
  upload.single('file'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (e) {
      return res.status(400).json({ error: 'Archivo no válido: ' + e.message });
    }

    // Leer primera hoja
    const sheetName = wb.SheetNames[0];
    const ws  = wb.Sheets[sheetName];
    const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const norm = v => String(v || '').trim();

    // Detectar número de período desde el nombre de la hoja (SEMANA 12 → 12)
    // o desde una celda de encabezado ("Semana 12 del...")
    let noPeriodo = null;
    const sheetMatch = sheetName.match(/semana\s+(\d+)/i);
    if (sheetMatch) noPeriodo = Number(sheetMatch[1]);
    if (!noPeriodo) {
      // Buscar en las primeras 3 filas
      for (let i = 0; i < Math.min(3, all.length) && !noPeriodo; i++) {
        for (const cell of all[i]) {
          const m = String(cell || '').match(/semana\s+(\d+)/i);
          if (m) { noPeriodo = Number(m[1]); break; }
        }
      }
    }

    // Detectar columnas de dept/puesto
    let deptCol = 2, posCol = 4, numCol = 0;
    for (let i = 0; i < Math.min(5, all.length); i++) {
      const row = all[i].map(norm).map(v => v.toLowerCase());
      const dIdx = row.findIndex(v => v.includes('departamento') || v === 'área' || v === 'area');
      const pIdx = row.findIndex(v => v.includes('puesto') || v.includes('cargo'));
      const nIdx = row.findIndex(v => v.includes('no.') || v === 'no' || v === '#' || v.includes('empleado') || v.includes('número'));
      if (dIdx >= 0 && pIdx >= 0) {
        deptCol = dIdx; posCol = pIdx;
        if (nIdx >= 0) numCol = nIdx;
        break;
      }
    }

    // Columnas de asistencia (lista asistencia semana):
    // Status: Lun=6, Mar=10, Mié=14, Jue=18, Vie=22, Sab=26, Dom=30
    // TE hrs: Lun=8, Mar=12, Mié=16, Jue=20, Vie=24, Sab=28, Dom=32
    const STATUS_COLS = [6, 10, 14, 18, 22, 26, 30];
    const TE_COLS     = [8, 12, 16, 20, 24, 28, 32];
    const PAID_STATUS = new Set(['labora','festivo','descanso','retardo','tiempoxt','permiso cg','cumpleanos','cumpleaños','paro tecnico']);
    const VAC_STATUS  = new Set(['vacaciones','vacacion']);
    const FALTA_STATUS= new Set(['falta','baja','incapacidad','permiso sg']);

    const db = readFresh();
    const emps = db.rhh_employees || [];
    if (!Array.isArray(db.rhh_incidencias_semanales)) db.rhh_incidencias_semanales = [];

    let updated = 0, skipped = 0, created_depts = 0, created_pos = 0, inc_upserted = 0;
    const log = [];

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

    for (const row of all) {
      const empNum = norm(row[numCol]).replace(/^0+/, '');
      if (!empNum || !/^\d+$/.test(empNum)) continue;
      const deptName = norm(row[deptCol]);
      const posName  = norm(row[posCol]);
      if (!deptName && !posName) { skipped++; continue; }

      const emp = emps.find(e => {
        const en = norm(e.employee_number).replace(/^0+/, '');
        return en === empNum;
      });
      if (!emp) { skipped++; log.push(`#${empNum}: no encontrado`); continue; }

      // Actualizar dept/puesto
      const deptId = findOrCreateDept(deptName);
      const posId  = findOrCreatePos(posName, deptId);
      const changed = emp.department_id !== deptId || emp.position_id !== posId;
      if (changed) {
        emp.department_id = deptId;
        emp.position_id   = posId;
        emp.updated_at    = nowMxDate();
        updated++;
        log.push(`#${empNum} ${emp.full_name}: dept="${deptName}" puesto="${posName}"`);
      }

      // Importar incidencias semanales (solo si se detectó período)
      if (noPeriodo) {
        let diasPagados = 0, faltas = 0, vacDias = 0, primaDom = 0;
        let teTotal = 0;

        for (let i = 0; i < STATUS_COLS.length; i++) {
          const statusRaw = norm(row[STATUS_COLS[i]]).toLowerCase();
          const teHrs     = Number(row[TE_COLS[i]]) || 0;
          teTotal += teHrs;
          if (!statusRaw) continue;
          if (PAID_STATUS.has(statusRaw)) diasPagados++;
          else if (VAC_STATUS.has(statusRaw)) vacDias++;
          else if (FALTA_STATUS.has(statusRaw)) faltas++;
          // Prima dominical: domingo (índice 6) con status labora/tiempoxt
          if (i === 6 && (statusRaw === 'labora' || statusRaw === 'tiempoxt')) primaDom = 1;
        }

        const incList = db.rhh_incidencias_semanales;
        const existIdx = incList.findIndex(r => r.employee_id === emp.id && r.no_periodo === noPeriodo);

        if (existIdx !== -1) {
          // No sobreescribir si fue importado desde PDF (más completo)
          if (incList[existIdx].source !== 'pdf_import') {
            incList[existIdx] = {
              ...incList[existIdx],
              dias_pagados: diasPagados,
              faltas,
              horas_extras_total: teTotal,
              vacaciones_dias: vacDias || incList[existIdx].vacaciones_dias || 0,
              prima_dominical: primaDom,
              source: 'excel_import',
              updated_at: nowMxDate(),
            };
            inc_upserted++;
          }
        } else {
          incList.push({
            id: nextId(incList),
            no_periodo: noPeriodo,
            employee_id: emp.id,
            dias_pagados: diasPagados,
            faltas,
            horas_extras_total: teTotal,
            despensa: 1,
            bono_puntualidad_dias: null,
            bono_eficiencia_dias: null,
            bono_instructor: null,
            prima_dominical: primaDom,
            vacaciones_dias: vacDias || 0,
            gratificacion: null,
            notas: '',
            source: 'excel_import',
            updated_at: nowMxDate(),
            created_at: nowMxDate(),
          });
          inc_upserted++;
        }
      }
    }

    write(db);
    res.json({ ok: true, updated, created_depts, created_pos, skipped, inc_upserted,
               no_periodo: noPeriodo || null, log });
  }
);

module.exports = router;
