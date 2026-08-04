/* ══════════════════════════════════════════════════════════════════════════════
   RHH — Control de Asistencias
   Rol semanal, captura diaria, vista grid semanal
   ══════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { read, write, nextId, getSystemEmpIds } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

const PROYECTOS = ['SKF', 'AMSTED', 'TENNECO'];

const INCIDENCIA_TYPES = [
  'labora', 'falta', 'festivo', 'vacacion', 'baja',
  'retardo', 'incapacidad', 'permiso_cg', 'permiso_sg',
  'paro_tecnico', 'descanso',
];

const INCIDENCIA_LABELS = {
  labora:      'Labora',
  falta:       'Falta',
  festivo:     'Festivo',
  vacacion:    'Vacación',
  baja:        'Baja',
  retardo:     'Retardo',
  incapacidad: 'Incapacidad',
  permiso_cg:  'Permiso C/G',
  permiso_sg:  'Permiso S/G',
  paro_tecnico:'Paro Técnico',
  descanso:    'Descanso',
};

/* Lunes de la semana que contiene dateStr (YYYY-MM-DD) */
function weekMonday(dateStr) {
  const d   = new Date((dateStr || nowMxDate()) + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toLocaleDateString('en-CA', { timeZone: 'UTC' });
}

/* Array de 6 fechas Lun-Sáb */
function weekDates(monday) {
  const out = [];
  const d   = new Date(monday + 'T12:00:00');
  for (let i = 0; i < 6; i++) {
    const nd = new Date(d);
    nd.setDate(d.getDate() + i);
    out.push(nd.toLocaleDateString('en-CA', { timeZone: 'UTC' }));
  }
  return out;
}

/* Enriquece un empleado con dept/position/shift */
function enrichEmp(emp, db) {
  if (!emp) return null;
  return {
    ...emp,
    department: (db.rhh_departments || []).find(d => d.id === emp.department_id) || null,
    position:   (db.rhh_positions   || []).find(p => p.id === emp.position_id)   || null,
    shift:      (db.rhh_shifts      || []).find(s => s.id === emp.shift_id)       || null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ROL SEMANAL
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/rol?week=YYYY-MM-DD
router.get('/rol', rhhAuthRequired, (req, res) => {
  const week = weekMonday(req.query.week);
  const db   = read();

  const rol         = (db.rhh_weekly_rol    || []).find(r => r.week_start === week);
  const assignments = rol
    ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id)
    : [];

  const _sysIds    = getSystemEmpIds();
  const employees  = (db.rhh_employees || []).filter(e => e.status === 'active' && !_sysIds.has(Number(e.id)));
  const assignedIds = new Set(assignments.map(a => a.employee_id));

  const enrich = e => {
    const a        = assignments.find(x => x.employee_id === e.id);
    const shift    = (db.rhh_shifts    || []).find(s => s.id === (a?.shift_id ?? e.shift_id));
    const position = (db.rhh_positions || []).find(p => p.id === (a?.position_id ?? e.position_id));
    const dept     = (db.rhh_departments || []).find(d => d.id === e.department_id);
    return { ...e, department: dept, position, shift, assignment: a || null };
  };

  const sortEmps = list => list.map(enrich).sort((a, b) => {
    const pa = a.position?.name || '';
    const pb = b.position?.name || '';
    if (pa !== pb) return pa.localeCompare(pb);
    return (a.full_name || '').localeCompare(b.full_name || '');
  });

  const assigned   = sortEmps(employees.filter(e =>  assignedIds.has(e.id)));
  const unassigned = sortEmps(employees.filter(e => !assignedIds.has(e.id)));

  // Agrupar asignados por turno
  const byShift = {};
  for (const emp of assigned) {
    const sn = emp.shift?.name || 'Sin turno';
    if (!byShift[sn]) byShift[sn] = { shift: emp.shift, employees: [] };
    byShift[sn].employees.push(emp);
  }

  res.json({
    week_start: week,
    rol:        rol || null,
    by_shift:   byShift,
    assigned,
    unassigned,
    shifts:     db.rhh_shifts || [],
    positions:  db.rhh_positions || [],
    proyectos:  PROYECTOS,
  });
});

// POST /api/rhh/asistencia/rol
// Body: { week_start, no_periodo, assignments: [{employee_id, shift_id, position_id, project}] }
router.post('/rol', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const { week_start, no_periodo, assignments = [] } = req.body || {};
  if (!week_start) return res.status(400).json({ error: 'week_start requerido' });

  const db    = read();
  let   roles = db.rhh_weekly_rol    || [];
  let   asigs = db.rhh_rol_assignments || [];

  let rol = roles.find(r => r.week_start === week_start);
  if (!rol) {
    rol = {
      id:         nextId(roles),
      week_start,
      no_periodo: no_periodo || null,
      status:     'published',
      created_by: req.rhhUser.email || req.rhhUser.full_name,
      created_at: nowMxDate(),
    };
    roles.push(rol);
  } else {
    rol.updated_at = nowMxDate();
    rol.status     = 'published';
  }

  // Reemplaza todas las asignaciones de este rol
  asigs = asigs.filter(a => a.rol_id !== rol.id);
  for (const a of assignments) {
    if (!a.employee_id || !a.shift_id) continue;
    asigs.push({
      id:          nextId(asigs),
      rol_id:      rol.id,
      employee_id: Number(a.employee_id),
      shift_id:    Number(a.shift_id),
      position_id: a.position_id ? Number(a.position_id) : null,
      project:     a.project || null,
      notas:       a.notas   || null,
    });
  }

  db.rhh_weekly_rol    = roles;
  db.rhh_rol_assignments = asigs;
  write(db);
  res.json({ ok: true, rol, saved: assignments.length });
});

// GET /api/rhh/asistencia/rol/html?week=YYYY-MM-DD — HTML para imprimir/PDF
router.get('/rol/html', rhhAuthRequired, (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const DIAS  = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const db    = read();

  const rol         = (db.rhh_weekly_rol    || []).find(r => r.week_start === week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];
  const employees   = db.rhh_employees  || [];
  const positions   = db.rhh_positions  || [];
  const shifts      = db.rhh_shifts     || [];

  // Filas enriquecidas y ordenadas turno → puesto → nombre
  const rows = assignments
    .map(a => {
      const emp   = employees.find(e => e.id === a.employee_id);
      const shift = shifts.find(s => s.id === a.shift_id);
      const pos   = positions.find(p => p.id === (a.position_id ?? emp?.position_id));
      return { ...a, emp, shift, pos };
    })
    .filter(r => r.emp)
    .sort((a, b) => {
      if ((a.shift?.name || '') !== (b.shift?.name || '')) return (a.shift?.name || '').localeCompare(b.shift?.name || '');
      if ((a.pos?.name   || '') !== (b.pos?.name   || '')) return (a.pos?.name   || '').localeCompare(b.pos?.name   || '');
      return (a.emp?.full_name || '').localeCompare(b.emp?.full_name || '');
    });

  // Agrupar por turno
  const byShift = {};
  rows.forEach(r => {
    const sn = r.shift?.name || 'Sin turno';
    if (!byShift[sn]) byShift[sn] = { shift: r.shift, rows: [] };
    byShift[sn].rows.push(r);
  });

  const d0 = new Date(dates[0] + 'T12:00:00');
  const d5 = new Date(dates[5] + 'T12:00:00');
  const semLbl = `${d0.getDate()} ${MES[d0.getMonth()]} al ${d5.getDate()} ${MES[d5.getMonth()]} ${d5.getFullYear()}`;

  let tableBody = '';
  for (const [shiftName, { shift, rows: sRows }] of Object.entries(byShift)) {
    const workDays   = shift?.work_days || [1,2,3,4,5];
    const diasStr    = DIAS.filter((_, i) => workDays.includes(i + 1)).join(', ');
    const entry      = shift?.start_time || '—';
    const exitTime   = shift?.end_time   || '—';
    tableBody += `
      <tr style="background:#1e3a5f;color:#fff;">
        <td colspan="5" style="padding:6px 12px;font-weight:700;">
          ${shiftName} &nbsp;|&nbsp; Entrada: ${entry} &nbsp;&nbsp; Salida: ${exitTime} &nbsp;|&nbsp; Días: ${diasStr}
        </td>
      </tr>`;
    let lastPos = '';
    for (const r of sRows) {
      const posName = r.pos?.name || '—';
      if (posName !== lastPos) {
        lastPos = posName;
        tableBody += `<tr style="background:#dbeafe;"><td colspan="5" style="padding:3px 12px;font-weight:700;font-size:11px;color:#1e3a5f;">▸ ${posName}</td></tr>`;
      }
      tableBody += `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:5px 12px;width:70px;">${r.emp?.employee_number || ''}</td>
          <td style="padding:5px 12px;">${r.emp?.full_name || ''}</td>
          <td style="padding:5px 12px;">${posName}</td>
          <td style="padding:5px 12px;text-align:center;">${entry} – ${exitTime}</td>
          <td style="padding:5px 12px;color:#1d4ed8;">${r.project || '—'}</td>
        </tr>`;
    }
  }

  if (!tableBody) tableBody = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#9ca3af;">Sin asignaciones en este rol</td></tr>';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Rol Semanal — ${semLbl}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 16px; color: #111; }
  h2   { text-align: center; color: #1e3a5f; margin: 0 0 4px; }
  .sub { text-align: center; color: #374151; margin-bottom: 16px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #1e3a5f; color: #fff; padding: 6px 12px; text-align: left; font-size: 12px; }
  tr:nth-child(even):not([style*="background"]) { background: #f9fafb; }
  @media print { @page { size: landscape; margin: 1cm; } button { display: none; } }
</style>
</head><body>
<h2>ROL SEMANAL DE TRABAJO</h2>
<div class="sub">Semana: ${semLbl}</div>
<button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">🖨️ Imprimir / Guardar PDF</button>
<table>
  <thead><tr><th>No.</th><th>Nombre</th><th>Puesto</th><th>Horario</th><th>Proyecto</th></tr></thead>
  <tbody>${tableBody}</tbody>
</table>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ══════════════════════════════════════════════════════════════════════════════
// ASISTENCIA DIARIA
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/diaria?week=YYYY-MM-DD&shift_id=X&fecha=YYYY-MM-DD
router.get('/diaria', rhhAuthRequired, (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const db    = read();

  const rol         = (db.rhh_weekly_rol    || []).find(r => r.week_start === week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];

  // Empleados del turno solicitado (o todos si no se filtra)
  let empIds = null;
  if (req.query.shift_id) {
    const sid = Number(req.query.shift_id);
    empIds = new Set(assignments.filter(a => a.shift_id === sid).map(a => a.employee_id));
  }

  const _sysIds2   = getSystemEmpIds();
  const employees  = (db.rhh_employees  || []).filter(e =>
    e.status === 'active' && !_sysIds2.has(Number(e.id)) && (!empIds || empIds.has(e.id))
  );
  const positions  = db.rhh_positions  || [];
  const shifts     = db.rhh_shifts     || [];
  const holidays   = (db.rhh_holidays  || []).map(h => h.date);
  const vacSols    = (db.rhh_vac_solicitudes || []).filter(v => v.estado === 'aprobada');
  const records    = (db.rhh_attendance || []).filter(r =>
    r.fecha >= dates[0] && r.fecha <= dates[5]
  );

  // Construir grid: empleado × 6 días
  const grid = employees
    .map(emp => {
      const ra       = assignments.find(a => a.employee_id === emp.id);
      const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
      const position = positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

      const days = dates.map((fecha, di) => {
        const rec     = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
        const dow     = di + 1; // 1=Lun...6=Sáb
        const worksDay = shift?.work_days ? shift.work_days.includes(dow) : dow <= 5;
        const isFest   = holidays.includes(fecha);
        const isVac    = vacSols.some(v =>
          v.employee_id === emp.id && fecha >= v.fecha_inicio && fecha <= v.fecha_fin
        );

        let autoType = null;
        if (!worksDay)  autoType = 'descanso';
        if (isFest)     autoType = 'festivo';
        if (isVac)      autoType = 'vacacion';

        return {
          fecha,
          id:                  rec?.id               ?? null,
          incidencia_type:     rec?.incidencia_type  ?? autoType,
          tiempo_retardo_min:  rec?.tiempo_retardo_min ?? null,
          proyecto:            rec?.proyecto          ?? ra?.project ?? null,
          notas:               rec?.notas             ?? null,
          is_auto:             !rec && !!autoType,
          registrado_por:      rec?.registrado_por    ?? null,
        };
      });

      return {
        employee_id:     emp.id,
        employee_number: emp.employee_number,
        full_name:       emp.full_name,
        position:        position?.name || '',
        shift_name:      shift?.name    || '',
        shift_id:        ra?.shift_id   ?? emp.shift_id,
        project_default: ra?.project    ?? null,
        days,
      };
    })
    .sort((a, b) => {
      if (a.shift_name !== b.shift_name) return a.shift_name.localeCompare(b.shift_name);
      if (a.position   !== b.position)   return a.position.localeCompare(b.position);
      return a.full_name.localeCompare(b.full_name);
    });

  res.json({
    week_start: week,
    dates,
    shifts:     shifts,
    proyectos:  PROYECTOS,
    incidencia_types: INCIDENCIA_LABELS,
    grid,
  });
});

// POST /api/rhh/asistencia/diaria  — crear/actualizar un registro individual
router.post('/diaria', rhhAuthRequired, (req, res) => {
  const { employee_id, fecha, incidencia_type, tiempo_retardo_min, proyecto, shift_id, notas } = req.body || {};
  if (!employee_id || !fecha || !incidencia_type) {
    return res.status(400).json({ error: 'employee_id, fecha e incidencia_type son requeridos' });
  }
  if (!INCIDENCIA_TYPES.includes(incidencia_type)) {
    return res.status(400).json({ error: 'incidencia_type inválido: ' + incidencia_type });
  }
  if (incidencia_type === 'paro_tecnico' && !['rh', 'admin'].includes(req.rhhUser.role)) {
    return res.status(403).json({ error: 'Paro técnico solo puede registrarlo RHH o Admin' });
  }

  const db  = read();
  const att = db.rhh_attendance || [];
  const idx = att.findIndex(r => r.employee_id === Number(employee_id) && r.fecha === fecha);

  if (idx !== -1) {
    att[idx] = {
      ...att[idx],
      incidencia_type,
      tiempo_retardo_min:  tiempo_retardo_min != null ? Number(tiempo_retardo_min) : null,
      proyecto:            proyecto    ?? att[idx].proyecto,
      shift_id:            shift_id    ? Number(shift_id) : att[idx].shift_id,
      notas:               notas       ?? att[idx].notas,
      registrado_por:      req.rhhUser.email || req.rhhUser.full_name,
      updated_at:          nowMxDate(),
    };
    db.rhh_attendance = att;
    write(db);
    return res.json(att[idx]);
  }

  const rec = {
    id:                 nextId(att),
    employee_id:        Number(employee_id),
    fecha,
    incidencia_type,
    tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : null,
    proyecto:           proyecto   || null,
    shift_id:           shift_id   ? Number(shift_id) : null,
    notas:              notas      || null,
    registrado_por:     req.rhhUser.email || req.rhhUser.full_name,
    created_at:         nowMxDate(),
  };
  att.push(rec);
  db.rhh_attendance = att;
  write(db);
  res.status(201).json(rec);
});

// POST /api/rhh/asistencia/diaria/bulk — guardar múltiples registros de un día
router.post('/diaria/bulk', rhhAuthRequired, (req, res) => {
  const { records = [] } = req.body || {};
  if (!records.length) return res.json({ ok: true, saved: 0 });

  const db  = read();
  const att = db.rhh_attendance || [];
  let saved = 0;

  for (const item of records) {
    const { employee_id, fecha, incidencia_type, tiempo_retardo_min, proyecto, shift_id, notas } = item;
    if (!employee_id || !fecha || !incidencia_type) continue;
    if (!INCIDENCIA_TYPES.includes(incidencia_type)) continue;
    if (incidencia_type === 'paro_tecnico' && !['rh','admin'].includes(req.rhhUser.role)) continue;

    const idx = att.findIndex(r => r.employee_id === Number(employee_id) && r.fecha === fecha);
    if (idx !== -1) {
      att[idx] = { ...att[idx], incidencia_type,
        tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : null,
        proyecto: proyecto ?? att[idx].proyecto, shift_id: shift_id ? Number(shift_id) : att[idx].shift_id,
        notas: notas ?? att[idx].notas, registrado_por: req.rhhUser.email || req.rhhUser.full_name, updated_at: nowMxDate() };
    } else {
      att.push({ id: nextId(att), employee_id: Number(employee_id), fecha, incidencia_type,
        tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : null,
        proyecto: proyecto || null, shift_id: shift_id ? Number(shift_id) : null,
        notas: notas || null, registrado_por: req.rhhUser.email || req.rhhUser.full_name, created_at: nowMxDate() });
    }
    saved++;
  }

  db.rhh_attendance = att;
  write(db);
  res.json({ ok: true, saved });
});

// DELETE /api/rhh/asistencia/diaria/:id
router.delete('/diaria/:id', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), (req, res) => {
  const db  = read();
  const idx = (db.rhh_attendance || []).findIndex(r => r.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.rhh_attendance.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// VISTA SEMANA — grid completo para lista de asistencia
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/semana?week=YYYY-MM-DD&shift_id=X
router.get('/semana', rhhAuthRequired, (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const db    = read();

  const rol         = (db.rhh_weekly_rol    || []).find(r => r.week_start === week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];
  const records     = (db.rhh_attendance    || []).filter(r => r.fecha >= dates[0] && r.fecha <= dates[5]);
  const holidays    = (db.rhh_holidays      || []).map(h => h.date);
  const vacSols     = (db.rhh_vac_solicitudes || []).filter(v => v.estado === 'aprobada');

  let employees = (db.rhh_employees || []).filter(e => e.status === 'active');
  if (req.query.shift_id) {
    const sid      = Number(req.query.shift_id);
    const empIds   = new Set(assignments.filter(a => a.shift_id === sid).map(a => a.employee_id));
    employees = employees.filter(e => empIds.has(e.id) || e.shift_id === sid);
  }

  const positions = db.rhh_positions  || [];
  const shifts    = db.rhh_shifts     || [];

  const grid = employees.map(emp => {
    const ra       = assignments.find(a => a.employee_id === emp.id);
    const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
    const position = positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

    const days = dates.map((fecha, di) => {
      const rec     = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
      const dow     = di + 1;
      const works   = shift?.work_days ? shift.work_days.includes(dow) : dow <= 5;
      const isFest  = holidays.includes(fecha);
      const isVac   = vacSols.some(v => v.employee_id === emp.id && fecha >= v.fecha_inicio && fecha <= v.fecha_fin);
      let autoType  = works ? null : 'descanso';
      if (isFest) autoType = 'festivo';
      if (isVac)  autoType = 'vacacion';

      return {
        fecha,
        id:                 rec?.id             ?? null,
        incidencia_type:    rec?.incidencia_type ?? autoType,
        tiempo_retardo_min: rec?.tiempo_retardo_min ?? null,
        proyecto:           rec?.proyecto        ?? ra?.project ?? null,
        notas:              rec?.notas           ?? null,
        is_auto:            !rec && !!autoType,
      };
    });

    return {
      employee_id:     emp.id,
      employee_number: emp.employee_number,
      full_name:       emp.full_name,
      position:        position?.name || '',
      shift_name:      shift?.name    || '',
      shift_sort:      shift?.name    || 'ZZZZ',
      project:         ra?.project    ?? null,
      days,
    };
  }).sort((a, b) => {
    if (a.shift_sort !== b.shift_sort) return a.shift_sort.localeCompare(b.shift_sort);
    if (a.position   !== b.position)   return a.position.localeCompare(b.position);
    return a.full_name.localeCompare(b.full_name);
  });

  res.json({
    week_start: week,
    dates,
    grid,
    shifts:    shifts,
    proyectos: PROYECTOS,
    incidencia_labels: INCIDENCIA_LABELS,
  });
});

// GET /api/rhh/asistencia/proyectos
router.get('/proyectos', rhhAuthRequired, (req, res) => res.json(PROYECTOS));

module.exports = router;
