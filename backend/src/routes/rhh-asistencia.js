/* ══════════════════════════════════════════════════════════════════════════════
   RHH — Control de Asistencias
   Rol semanal, captura diaria, vista grid semanal, vales de tiempo extra
   ══════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { read, write, writeAsync, nextId, getSystemEmpIds } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function nowMxTime() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
}
function nowMxDateTime() {
  return `${nowMxDate()} ${nowMxTime()}`;
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

const OVERTIME_RAZONES = [
  'Producción urgente / pedido cliente',
  'Mantenimiento preventivo',
  'Mantenimiento correctivo',
  'Limpieza y orden de área',
  'Capacitación',
  'Inventario',
  'Paro técnico recuperación',
  'Apoyo a otro turno',
  'Auditoría / visita cliente',
  'Otro',
];

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

/* Calcular horas entre dos strings HH:MM */
function calcHoras(entrada, salida) {
  if (!entrada || !salida) return null;
  const [h1, m1] = entrada.split(':').map(Number);
  const [h2, m2] = salida.split(':').map(Number);
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins <= 0) return null;
  return Math.round(mins / 6) / 10; // redondeo a 1 decimal
}

/* ¿Registro bloqueado para supervisor? */
function isLockedForSupervisor(rec, fecha, role) {
  if (role === 'rh' || role === 'admin') return false;
  if (!rec) return false;  // sin registro = no bloqueado
  if (!rec.incidencia_type) return false; // sin incidencia registrada = no bloqueado
  return fecha < nowMxDate();
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

/* Crear o actualizar vale de tiempo extra para un registro de asistencia */
function upsertOvertimeVale(db, attRec, solicitado_por) {
  if (!db.rhh_overtime_vales) db.rhh_overtime_vales = [];
  const vales = db.rhh_overtime_vales;

  // Si ya existe un vale para este attendance id, actualizar (si sigue pendiente)
  const existing = vales.find(v => v.attendance_id === attRec.id);
  if (existing) {
    if (existing.status === 'pendiente') {
      existing.te_hora_entrada = attRec.te_hora_entrada;
      existing.te_hora_salida  = attRec.te_hora_salida;
      existing.te_horas        = attRec.te_horas;
      existing.te_razon        = attRec.te_razon;
      existing.te_proyecto     = attRec.te_proyecto;
      existing.updated_at      = nowMxDateTime();
    }
    return existing.id;
  }

  const vale = {
    id:              nextId(vales),
    attendance_id:   attRec.id,
    employee_id:     attRec.employee_id,
    fecha:           attRec.fecha,
    te_hora_entrada: attRec.te_hora_entrada,
    te_hora_salida:  attRec.te_hora_salida,
    te_horas:        attRec.te_horas,
    te_razon:        attRec.te_razon,
    te_proyecto:     attRec.te_proyecto,
    status:          'pendiente',
    solicitado_por,
    creado_at:       nowMxDateTime(),
    autorizado_por:  null,
    autorizado_at:   null,
    notas_rechazo:   null,
  };
  vales.push(vale);
  return vale.id;
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
  // Activos para la plantilla nueva; asignados inactivos se conservan para no
  // destruir el historial del ROL al refrescar o guardar desde otra pantalla.
  const activeEmployees = (db.rhh_employees || []).filter(e => e.status !== 'inactive' && !_sysIds.has(Number(e.id)));
  const assignedIds = new Set(assignments.map(a => a.employee_id));
  const assignedInactive = (db.rhh_employees || []).filter(e =>
    e.status === 'inactive' && assignedIds.has(e.id) && !_sysIds.has(Number(e.id))
  );
  const employees = [...activeEmployees, ...assignedInactive];

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
  const unassigned = sortEmps(activeEmployees.filter(e => !assignedIds.has(e.id)));

  // Agrupar asignados por turno
  const byShift = {};
  for (const emp of assigned) {
    const sn = emp.shift?.name || 'Sin turno';
    if (!byShift[sn]) byShift[sn] = { shift: emp.shift, employees: [] };
    byShift[sn].employees.push(emp);
  }

  res.json({
    week_start: week,
    rol:        rol ? { ...rol, version: rol.version || 1 } : null,
    version:    rol?.version || 0,
    by_shift:   byShift,
    assigned,
    unassigned,
    all_employees: [...assigned, ...unassigned],
    shifts:     db.rhh_shifts || [],
    positions:  db.rhh_positions || [],
    proyectos:  PROYECTOS,
  });
});

// POST /api/rhh/asistencia/rol
router.post('/rol', rhhAuthRequired, rhhRequireRole('supervisor', 'rh', 'admin'), async (req, res) => {
  const { week_start, no_periodo, assignments = [], version = 0 } = req.body || {};
  if (!week_start) return res.status(400).json({ error: 'week_start requerido' });

  const db    = structuredClone(read());
  let   roles = db.rhh_weekly_rol    || [];
  let   asigs = db.rhh_rol_assignments || [];

  let rol = roles.find(r => r.week_start === week_start);
  const currentVersion = rol?.version || (rol ? 1 : 0);
  if (Number(version) !== currentVersion) {
    return res.status(409).json({
      error: 'El ROL fue actualizado desde otra sesión. Recarga antes de guardar.',
      current_version: currentVersion,
    });
  }
  if (!rol) {
    rol = {
      id:         nextId(roles),
      week_start,
      no_periodo: no_periodo || null,
      status:     'published',
      created_by: req.rhhUser.email || req.rhhUser.full_name,
      created_at: nowMxDate(),
      version:    1,
    };
    roles.push(rol);
  } else {
    rol.updated_at = nowMxDate();
    rol.status     = 'published';
    rol.version    = currentVersion + 1;
  }

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

  db.rhh_weekly_rol      = roles;
  db.rhh_rol_assignments = asigs;
  // writeAsync garantiza persistencia en PostgreSQL antes de responder
  try { await writeAsync(db); } catch(e) { return res.status(500).json({ error: 'Error al guardar ROL: ' + e.message }); }
  res.json({ ok: true, rol, version: rol.version, saved: assignments.length });
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
    const workDays = shift?.work_days || [1,2,3,4,5];
    const diasStr  = DIAS.filter((_, i) => workDays.includes(i + 1)).join(', ');
    const entry    = shift?.start_time || '—';
    const exitTime = shift?.end_time   || '—';
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
<button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Imprimir / Guardar PDF</button>
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

// GET /api/rhh/asistencia/diaria?week=YYYY-MM-DD&shift_id=X
router.get('/diaria', rhhAuthRequired, (req, res) => {
  const week  = weekMonday(req.query.week);
  const dates = weekDates(week);
  const today = nowMxDate();
  const db    = read();
  const role  = req.rhhUser.role;

  const rol         = (db.rhh_weekly_rol    || []).find(r => r.week_start === week);
  const assignments = rol ? (db.rhh_rol_assignments || []).filter(a => a.rol_id === rol.id) : [];

  let empIds = null;
  if (req.query.shift_id) {
    // Filtrar por turno específico
    const sid = Number(req.query.shift_id);
    empIds = new Set(assignments.filter(a => a.shift_id === sid).map(a => a.employee_id));
  } else if (rol && assignments.length > 0) {
    // Si existe ROL para la semana, mostrar solo los empleados asignados al ROL
    empIds = new Set(assignments.map(a => a.employee_id));
  }
  // Sin ROL o ROL vacío → mostrar todos los activos (comportamiento original)

  const _sysIds2  = getSystemEmpIds();
  const employees = (db.rhh_employees  || []).filter(e =>
    e.status !== 'inactive' && !_sysIds2.has(Number(e.id)) && (!empIds || empIds.has(e.id))
  );
  const positions  = db.rhh_positions  || [];
  const shifts     = db.rhh_shifts     || [];
  const holidays   = (db.rhh_holidays  || []).map(h => h.date);
  const vacSols    = (db.rhh_vac_solicitudes || []).filter(v => v.estado === 'aprobada');
  const records    = (db.rhh_attendance || []).filter(r =>
    r.fecha >= dates[0] && r.fecha <= dates[5]
  );
  const audits     = db.rhh_attendance_audit || [];
  const ovVales    = db.rhh_overtime_vales   || [];

  const grid = employees
    .map(emp => {
      const ra       = assignments.find(a => a.employee_id === emp.id);
      const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
      const position = positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

      const days = dates.map((fecha, di) => {
        const rec     = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
        const dow     = di + 1;
        const worksDay = shift?.work_days ? shift.work_days.includes(dow) : dow <= 5;
        const isFest   = holidays.includes(fecha);
        const isVac    = vacSols.some(v =>
          v.employee_id === emp.id && fecha >= v.fecha_inicio && fecha <= v.fecha_fin
        );

        let autoType = null;
        if (!worksDay) autoType = 'descanso';
        if (isFest)    autoType = 'festivo';
        if (isVac)     autoType = 'vacacion';

        const locked    = isLockedForSupervisor(rec, fecha, role);
        const vale      = rec ? ovVales.find(v => v.attendance_id === rec.id) : null;
        const recAudit  = rec ? audits.filter(a => a.attendance_id === rec.id)
          .sort((a, b) => a.id - b.id) : [];

        return {
          fecha,
          id:                 rec?.id               ?? null,
          incidencia_type:    rec?.incidencia_type  ?? autoType,
          tiempo_retardo_min: rec?.tiempo_retardo_min ?? null,
          proyecto:           rec?.proyecto          ?? ra?.project ?? null,
          notas:              rec?.notas             ?? null,
          is_auto:            !rec && !!autoType,
          registrado_por:     rec?.registrado_por    ?? null,
          registered_at:      rec?.updated_at        ?? rec?.created_at ?? null,
          // Tiempo extra
          te_activo:          rec?.te_activo          ?? false,
          te_hora_entrada:    rec?.te_hora_entrada    ?? null,
          te_hora_salida:     rec?.te_hora_salida     ?? null,
          te_horas:           rec?.te_horas           ?? null,
          te_razon:           rec?.te_razon           ?? null,
          te_proyecto:        rec?.te_proyecto        ?? null,
          te_vale_id:         vale?.id                ?? null,
          te_vale_status:     vale?.status            ?? null,
          // Lock
          is_locked:          locked,
          // Audit trail (para modal RHH/Admin)
          audit_trail:        recAudit.map(a => ({
            cambiado_por: a.cambiado_por,
            cambiado_at:  a.cambiado_at,
            campo:        a.campo,
            de:           a.valor_anterior,
            a:            a.valor_nuevo,
            motivo:       a.motivo,
          })),
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
    week_start:      week,
    today,
    dates,
    shifts,
    proyectos:       PROYECTOS,
    overtime_razones: OVERTIME_RAZONES,
    incidencia_types: INCIDENCIA_LABELS,
    grid,
    user_role:       role,
  });
});

// ── Función interna de upsert para bulk y single ──────────────────────────────
function upsertAttendance(att, item, userLabel, role, skipLockCheck) {
  const {
    employee_id, fecha, incidencia_type, tiempo_retardo_min,
    proyecto, shift_id, notas,
    te_activo, te_hora_entrada, te_hora_salida, te_razon, te_proyecto,
  } = item;

  if (!employee_id || !fecha || !incidencia_type) return { error: 'Campos requeridos faltantes', skip: true };
  if (!INCIDENCIA_TYPES.includes(incidencia_type)) return { error: `incidencia_type inválido: ${incidencia_type}`, skip: true };
  if (incidencia_type === 'paro_tecnico' && !['rh','admin'].includes(role)) return { error: 'Paro técnico solo RHH/Admin', skip: true };

  const today = nowMxDate();
  const idx   = att.findIndex(r => r.employee_id === Number(employee_id) && r.fecha === fecha);

  // Lock check para supervisores
  if (!skipLockCheck && role === 'supervisor' && fecha < today && idx !== -1 && att[idx].incidencia_type) {
    return { error: 'Incidencia bloqueada para supervisor', locked: true, skip: true };
  }

  const teHoras = te_activo ? calcHoras(te_hora_entrada, te_hora_salida) : null;

  if (idx !== -1) {
    att[idx] = {
      ...att[idx],
      incidencia_type,
      tiempo_retardo_min: tiempo_retardo_min != null ? Number(tiempo_retardo_min) : att[idx].tiempo_retardo_min,
      proyecto:           proyecto    ?? att[idx].proyecto,
      shift_id:           shift_id    ? Number(shift_id) : att[idx].shift_id,
      notas:              notas       ?? att[idx].notas,
      te_activo:          !!te_activo,
      te_hora_entrada:    te_activo ? (te_hora_entrada || null) : null,
      te_hora_salida:     te_activo ? (te_hora_salida  || null) : null,
      te_horas:           teHoras,
      te_razon:           te_activo ? (te_razon    || null) : null,
      te_proyecto:        te_activo ? (te_proyecto || null) : null,
      registrado_por:     userLabel,
      updated_at:         nowMxDateTime(),
    };
    return { rec: att[idx], isNew: false };
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
    te_activo:          !!te_activo,
    te_hora_entrada:    te_activo ? (te_hora_entrada || null) : null,
    te_hora_salida:     te_activo ? (te_hora_salida  || null) : null,
    te_horas:           teHoras,
    te_razon:           te_activo ? (te_razon    || null) : null,
    te_proyecto:        te_activo ? (te_proyecto || null) : null,
    registrado_por:     userLabel,
    created_at:         nowMxDateTime(),
  };
  att.push(rec);
  return { rec, isNew: true };
}

// POST /api/rhh/asistencia/diaria — guardar un registro individual (per-row)
router.post('/diaria', rhhAuthRequired, (req, res) => {
  const db      = read();
  const att     = db.rhh_attendance || [];
  const role    = req.rhhUser.role;
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;

  const result = upsertAttendance(att, req.body || {}, userLbl, role, false);

  if (result.skip) {
    const code = result.locked ? 403 : 400;
    return res.status(code).json({ error: result.error });
  }

  // Generar/actualizar vale de tiempo extra si aplica
  if (result.rec.te_activo) {
    const valeId = upsertOvertimeVale(db, result.rec, userLbl);
    result.rec.te_vale_id = valeId;
  }

  db.rhh_attendance = att;
  write(db);
  res.status(result.isNew ? 201 : 200).json(result.rec);
});

// POST /api/rhh/asistencia/diaria/bulk — guardar múltiples registros (compatibilidad)
router.post('/diaria/bulk', rhhAuthRequired, (req, res) => {
  const { records = [] } = req.body || {};
  if (!records.length) return res.json({ ok: true, saved: 0 });

  const db      = read();
  const att     = db.rhh_attendance || [];
  const role    = req.rhhUser.role;
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;
  let saved = 0, locked = 0;

  for (const item of records) {
    const result = upsertAttendance(att, item, userLbl, role, false);
    if (result.skip) {
      if (result.locked) locked++;
      continue;
    }
    if (result.rec.te_activo) {
      upsertOvertimeVale(db, result.rec, userLbl);
    }
    saved++;
  }

  db.rhh_attendance = att;
  write(db);
  res.json({ ok: true, saved, locked });
});

// PUT /api/rhh/asistencia/diaria/:id/rh-editar — RHH/Admin override con trazabilidad
router.put('/diaria/:id/rh-editar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const id      = Number(req.params.id);
  const { incidencia_type, proyecto, notas, motivo } = req.body || {};

  if (!motivo) return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });
  if (incidencia_type && !INCIDENCIA_TYPES.includes(incidencia_type)) {
    return res.status(400).json({ error: 'incidencia_type inválido' });
  }

  const db  = read();
  const att = db.rhh_attendance || [];
  const idx = att.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Registro no encontrado' });

  const old = { ...att[idx] };
  const userLbl = req.rhhUser.full_name || req.rhhUser.email;

  // Registrar en audit trail
  if (!db.rhh_attendance_audit) db.rhh_attendance_audit = [];
  const audits = db.rhh_attendance_audit;

  const fields = [];
  if (incidencia_type && incidencia_type !== old.incidencia_type) {
    fields.push({ campo: 'incidencia_type', valor_anterior: old.incidencia_type, valor_nuevo: incidencia_type });
  }
  if (proyecto !== undefined && proyecto !== old.proyecto) {
    fields.push({ campo: 'proyecto', valor_anterior: old.proyecto, valor_nuevo: proyecto });
  }
  if (notas !== undefined && notas !== old.notas) {
    fields.push({ campo: 'notas', valor_anterior: old.notas, valor_nuevo: notas });
  }

  for (const f of fields) {
    audits.push({
      id:             nextId(audits),
      attendance_id:  id,
      employee_id:    old.employee_id,
      fecha:          old.fecha,
      campo:          f.campo,
      valor_anterior: f.valor_anterior,
      valor_nuevo:    f.valor_nuevo,
      cambiado_por:   userLbl,
      cambiado_at:    nowMxDateTime(),
      motivo,
    });
  }

  // Aplicar cambios
  if (incidencia_type) att[idx].incidencia_type = incidencia_type;
  if (proyecto !== undefined) att[idx].proyecto = proyecto || null;
  if (notas !== undefined) att[idx].notas = notas || null;
  att[idx].editado_por_rh = userLbl;
  att[idx].editado_at_rh  = nowMxDateTime();

  db.rhh_attendance       = att;
  db.rhh_attendance_audit = audits;
  write(db);
  res.json({ ok: true, rec: att[idx], audit_entries: fields.length });
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
// VALES DE TIEMPO EXTRA
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/asistencia/overtime-vales?status=pendiente&week=YYYY-MM-DD
router.get('/overtime-vales', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db     = read();
  const vales  = db.rhh_overtime_vales || [];
  const emps   = db.rhh_employees || [];
  let list     = [...vales];

  if (req.query.status) {
    list = list.filter(v => v.status === req.query.status);
  }
  if (req.query.week) {
    const dates = weekDates(weekMonday(req.query.week));
    list = list.filter(v => v.fecha >= dates[0] && v.fecha <= dates[5]);
  }

  const enriched = list.map(v => {
    const emp = emps.find(e => e.id === v.employee_id);
    return { ...v, employee: emp ? { id: emp.id, full_name: emp.full_name, employee_number: emp.employee_number } : null };
  }).sort((a, b) => (b.creado_at || '').localeCompare(a.creado_at || ''));

  res.json(enriched);
});

// POST /api/rhh/asistencia/overtime-vales/:id/autorizar
router.post('/overtime-vales/:id/autorizar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const id  = Number(req.params.id);
  const db  = read();
  if (!db.rhh_overtime_vales) db.rhh_overtime_vales = [];
  const vale = db.rhh_overtime_vales.find(v => v.id === id);
  if (!vale) return res.status(404).json({ error: 'Vale no encontrado' });
  if (vale.status !== 'pendiente') return res.status(400).json({ error: 'El vale ya fue procesado' });

  vale.status        = 'autorizado';
  vale.autorizado_por = req.rhhUser.full_name || req.rhhUser.email;
  vale.autorizado_at  = nowMxDateTime();

  write(db);
  res.json({ ok: true, vale });
});

// POST /api/rhh/asistencia/overtime-vales/:id/rechazar
router.post('/overtime-vales/:id/rechazar', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const id    = Number(req.params.id);
  const { notas_rechazo } = req.body || {};
  const db    = read();
  if (!db.rhh_overtime_vales) db.rhh_overtime_vales = [];
  const vale  = db.rhh_overtime_vales.find(v => v.id === id);
  if (!vale) return res.status(404).json({ error: 'Vale no encontrado' });
  if (vale.status !== 'pendiente') return res.status(400).json({ error: 'El vale ya fue procesado' });

  vale.status         = 'rechazado';
  vale.autorizado_por = req.rhhUser.full_name || req.rhhUser.email;
  vale.autorizado_at  = nowMxDateTime();
  vale.notas_rechazo  = notas_rechazo || null;

  write(db);
  res.json({ ok: true, vale });
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
    const sid    = Number(req.query.shift_id);
    const empIds = new Set(assignments.filter(a => a.shift_id === sid).map(a => a.employee_id));
    employees    = employees.filter(e => empIds.has(e.id) || e.shift_id === sid);
  }

  const positions = db.rhh_positions || [];
  const shifts    = db.rhh_shifts    || [];

  const grid = employees.map(emp => {
    const ra       = assignments.find(a => a.employee_id === emp.id);
    const shift    = shifts.find(s => s.id === (ra?.shift_id ?? emp.shift_id));
    const position = positions.find(p => p.id === (ra?.position_id ?? emp.position_id));

    const days = dates.map((fecha, di) => {
      const rec    = records.find(r => r.employee_id === emp.id && r.fecha === fecha);
      const dow    = di + 1;
      const works  = shift?.work_days ? shift.work_days.includes(dow) : dow <= 5;
      const isFest = holidays.includes(fecha);
      const isVac  = vacSols.some(v => v.employee_id === emp.id && fecha >= v.fecha_inicio && fecha <= v.fecha_fin);
      let autoType = works ? null : 'descanso';
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
        te_activo:          rec?.te_activo       ?? false,
        te_horas:           rec?.te_horas        ?? null,
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
    shifts,
    proyectos:         PROYECTOS,
    incidencia_labels: INCIDENCIA_LABELS,
  });
});

// GET /api/rhh/asistencia/proyectos
router.get('/proyectos', rhhAuthRequired, (req, res) => res.json(PROYECTOS));

// GET /api/rhh/asistencia/overtime-razones
router.get('/overtime-razones', rhhAuthRequired, (req, res) => res.json(OVERTIME_RAZONES));

module.exports = router;
