const express = require('express');
const router = express.Router();
const { read: readMant, write: writeMant, nextId, nextFolio } = require('../db-mantenimiento');
const { read: readMain } = require('../db');
const dbProd = require('../db-produccion');
const { mantAuthRequired, mantAllowRoles } = require('../middleware/mant-auth');

function toMinsMant(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function nowMxStr() {
  const now = new Date();
  return {
    fecha: now.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }),
    hora: (() => {
      const mx = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
      return mx.getHours().toString().padStart(2,'0') + ':' + mx.getMinutes().toString().padStart(2,'0');
    })()
  };
}

router.use(mantAuthRequired);

// ── Helpers ───────────────────────────────────────────────────────────────────
function enrichOrden(o, db, dbMain) {
  const equipo = (db.equipos_mant || []).find(e => e.id === o.equipo_id) || {};
  const parte  = (db.partes_equipo || []).find(p => p.id === o.parte_equipo_id) || {};
  const tecnico = o.tecnico_asignado_id
    ? (dbMain.users || []).find(u => u.id === o.tecnico_asignado_id) || {}
    : {};
  const cerradoPor = o.cerrada_por_user_id
    ? (dbMain.users || []).find(u => u.id === o.cerrada_por_user_id) || {}
    : {};
  // Fallback: resolve solicitante_nombre from solicitante_user_id if not stored
  const solicitanteNombre = o.solicitante_nombre ||
    (o.solicitante_user_id
      ? ((dbMain.users || []).find(u => u.id === o.solicitante_user_id) || {}).full_name || null
      : null);
  const atendidaPor = o.atendida_por_user_id
    ? (dbMain.users || []).find(u => u.id === o.atendida_por_user_id) || {}
    : {};
  const validadoPor = o.validado_por_user_id
    ? (dbMain.users || []).find(u => u.id === o.validado_por_user_id) || {}
    : {};
  // Resoler estado del paro de producción vinculado
  let produccion_paro_cerrado = null;
  let produccion_paro_fecha_inicio = null;
  let produccion_paro_fecha_fin = null;
  if (o.origen_produccion && o.origen_produccion.paro_id) {
    const linea = (o.origen_produccion.linea || '').toLowerCase();
    const parosKey = linea === 'baker' ? 'paros_baker' : linea === 'l1' ? 'paros_l1' : 'paros';
    // eslint-disable-next-line eqeqeq
    const paro = (dbMain[parosKey] || []).find(p => p.id == o.origen_produccion.paro_id);
    if (paro) {
      produccion_paro_cerrado = !!(paro.fecha_fin || paro.estado === 'cerrado');
      produccion_paro_fecha_inicio = paro.fecha_inicio || null;
      produccion_paro_fecha_fin = paro.fecha_fin || null;
    }
  }
  return {
    ...o,
    equipo_nombre: o.equipo_custom || equipo.nombre || '-',
    equipo_codigo: equipo.codigo || '-',
    parte_nombre: o.parte_custom || parte.nombre || '-',
    tecnico_nombre: tecnico.full_name || null,
    cerrada_por_nombre: cerradoPor.full_name || null,
    atendida_por_nombre: atendidaPor.full_name || null,
    validado_por_nombre: validadoPor.full_name || null,
    solicitante_nombre: solicitanteNombre,
    produccion_paro_cerrado,
    produccion_paro_fecha_inicio,
    produccion_paro_fecha_fin,
  };
}

// ── ÓRDENES ───────────────────────────────────────────────────────────────────

// GET /api/mant/ordenes
router.get('/ordenes', (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const { status, tipo, equipo_id, fecha_ini, fecha_fin, tecnico_id, solicitante_id, rechazada } = req.query;

  let ordenes = db.ordenes_mantenimiento || [];

  // Técnico: ve todas las órdenes activas (para atender cualquiera) + sus propias cerradas/en_validacion
  if (req.mantUser.mant_role === 'tecnico_mant') {
    ordenes = ordenes.filter(o =>
      ['abierta','asignada','en_proceso'].includes(o.status) ||
      o.tecnico_asignado_id === req.mantUser.id ||
      o.atendida_por_user_id === req.mantUser.id
    );
  }
  // Supervisor: ve sus propias solicitudes + órdenes automáticas (producción) en_validacion
  if (req.mantUser.mant_role === 'supervisor_mant') {
    ordenes = ordenes.filter(o =>
      o.solicitante_user_id === req.mantUser.id ||
      (o.status === 'en_validacion' && o.origen_produccion)
    );
  }

  // Filtro rechazadas: órdenes que fueron rechazadas por supervisor (tienen motivo_rechazo y volvieron a abierta)
  if (rechazada === '1') {
    ordenes = ordenes.filter(o => o.motivo_rechazo && o.status === 'abierta');
  } else {
    if (status)  ordenes = ordenes.filter(o => o.status === status);
    if (tipo)    ordenes = ordenes.filter(o => o.tipo === tipo);
  }
  if (equipo_id)     ordenes = ordenes.filter(o => o.equipo_id === Number(equipo_id));
  if (tecnico_id)    ordenes = ordenes.filter(o => o.tecnico_asignado_id === Number(tecnico_id));
  if (solicitante_id) ordenes = ordenes.filter(o => o.solicitante_user_id === Number(solicitante_id));
  if (fecha_ini)     ordenes = ordenes.filter(o => o.fecha_solicitud >= fecha_ini);
  if (fecha_fin)     ordenes = ordenes.filter(o => o.fecha_solicitud <= fecha_fin);

  ordenes = ordenes
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .map(o => enrichOrden(o, db, dbMain));

  res.json(ordenes);
});

// GET /api/mant/ordenes/mes — OTs tipo programado del mes
router.get('/ordenes/mes', mantAllowRoles('admin'), (req, res) => {
  const year  = Number(req.query.anio) || new Date().getFullYear();
  const month = Number(req.query.mes)  || (new Date().getMonth() + 1);
  const pad = n => String(n).padStart(2,'0');
  const mStart = `${year}-${pad(month)}-01`;
  const mEnd   = `${year}-${pad(month)}-${new Date(year, month, 0).getDate()}`;
  const db = readMant(); const dbMain = readMain();
  const ordenes = (db.ordenes_mantenimiento || [])
    .filter(o => o.tipo === 'programado' && o.fecha_programada >= mStart && o.fecha_programada <= mEnd)
    .sort((a, b) => (a.fecha_programada||'').localeCompare(b.fecha_programada||''))
    .map(o => {
      const prog = (db.mantenimientos_programados || []).find(p => p.id === o.programado_id) || {};
      return { ...enrichOrden(o, db, dbMain), prog_frecuencia: prog.frecuencia || null, prog_tarea: prog.tarea || null };
    });
  res.json(ordenes);
});

// GET /api/mant/ordenes/urgencias-nuevas — polling para alerta de técnicos
router.get('/ordenes/urgencias-nuevas', (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const desde = req.query.desde || new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const nuevas = (db.ordenes_mantenimiento || [])
    .filter(o =>
      o.tipo === 'correctivo_urgente' &&
      o.status === 'abierta' &&
      o.created_at >= desde
    )
    .map(o => enrichOrden(o, db, dbMain));
  res.json(nuevas);
});

// GET /api/mant/ordenes/:id
router.get('/ordenes/:id', (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const o = (db.ordenes_mantenimiento || []).find(x => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
  // Técnico solo queda bloqueado si la orden ya está cerrada/cancelada y no es suya
  if (req.mantUser.mant_role === 'tecnico_mant' &&
      ['cerrada','cancelada'].includes(o.status) &&
      o.tecnico_asignado_id !== req.mantUser.id &&
      o.atendida_por_user_id !== req.mantUser.id) {
    return res.status(403).json({ error: 'Sin acceso a esta orden' });
  }
  res.json(enrichOrden(o, db, dbMain));
});

// POST /api/mant/ordenes — crear solicitud (supervisor o admin)
router.post('/ordenes', mantAllowRoles('supervisor_mant'), (req, res) => {
  const db = readMant();
  const now = new Date().toISOString();
  const { fecha: fechaMx, hora: horaMx } = nowMxStr();
  const folio = nextFolio(db);
  // Resolver nombre del departamento
  const dbMainLocal = readMain();
  const dpto = req.body.departamento_id
    ? (dbMainLocal.cost_centers || []).find(c => c.id === Number(req.body.departamento_id))
    : null;

  const equipoIdRaw = req.body.equipo_id;
  const parteIdRaw  = req.body.parte_equipo_id;
  const orden = {
    id: nextId(db.ordenes_mantenimiento),
    folio,
    tipo: 'correctivo_solicitud',
    origen: 'mantenimiento',
    paro_id: null,
    equipo_id: (equipoIdRaw && equipoIdRaw !== 'otro') ? Number(equipoIdRaw) : null,
    equipo_custom: (equipoIdRaw === 'otro') ? (req.body.equipo_custom || 'Otro') : null,
    parte_equipo_id: (parteIdRaw && parteIdRaw !== 'otro') ? Number(parteIdRaw) : null,
    parte_custom: (parteIdRaw === 'otro') ? (req.body.parte_custom || 'Otra') : null,
    solicitante_nombre: req.mantUser.full_name,
    solicitante_user_id: req.mantUser.id,
    departamento_id: dpto ? dpto.id : null,
    departamento_nombre: dpto ? dpto.name : null,
    fecha_solicitud: req.body.fecha_solicitud || fechaMx,
    hora_solicitud: req.body.hora_solicitud || horaMx,
    maquina_parada: !!req.body.maquina_parada,
    descripcion_falla: req.body.descripcion_falla || '',
    nivel_urgencia: req.body.maquina_parada ? 'alta' : (req.body.nivel_urgencia || 'media'),
    tecnico_asignado_id: null,
    status: 'abierta',
    fecha_cierre: null,
    hora_cierre: null,
    cerrada_por_user_id: null,
    descripcion_trabajo: null,
    refaccion_utilizada: null,
    parte_danada: null,
    programado_id: null,
    created_at: now,
    updated_at: now,
  };
  if (!orden.equipo_id && !orden.equipo_custom) return res.status(400).json({ error: 'Equipo requerido' });
  if (!orden.descripcion_falla) return res.status(400).json({ error: 'Descripción de falla requerida' });

  db.ordenes_mantenimiento.push(orden);
  writeMant(db);
  res.status(201).json(orden);
});

// PATCH /api/mant/ordenes/:id — editar / asignar técnico
router.patch('/ordenes/:id', mantAllowRoles('admin', 'supervisor_mant'), (req, res) => {
  const db = readMant();
  const dbMainLocal = readMain();
  const orden = (db.ordenes_mantenimiento || []).find(o => o.id === Number(req.params.id));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (orden.status === 'cerrada') return res.status(400).json({ error: 'La orden ya está cerrada' });

  const { tecnico_asignado_id, nivel_urgencia, status, fecha_programada, descripcion_falla } = req.body;
  if (tecnico_asignado_id !== undefined) {
    if (tecnico_asignado_id) {
      const targetUser = (dbMainLocal.users || []).find(u => u.id === Number(tecnico_asignado_id));
      if (!targetUser || targetUser.mant_role !== 'tecnico_mant') {
        return res.status(400).json({ error: 'Solo se puede asignar a usuarios con rol técnico' });
      }
    }
    orden.tecnico_asignado_id = tecnico_asignado_id ? Number(tecnico_asignado_id) : null;
    if (orden.status === 'abierta' && tecnico_asignado_id) orden.status = 'asignada';
    if (!tecnico_asignado_id && orden.status === 'asignada') orden.status = 'abierta';
  }
  if (nivel_urgencia) orden.nivel_urgencia = nivel_urgencia;
  if (status && ['abierta','asignada','en_proceso','en_validacion','cancelada'].includes(status)) orden.status = status;
  if (fecha_programada !== undefined) orden.fecha_programada = fecha_programada;
  if (descripcion_falla !== undefined) orden.descripcion_falla = descripcion_falla;
  orden.updated_at = new Date().toISOString();
  writeMant(db);
  res.json(orden);
});

// DELETE /api/mant/ordenes/:id — borrar orden (solo superadmin_mant)
router.delete('/ordenes/:id', mantAllowRoles('superadmin_mant'), (req, res) => {
  const db = readMant();
  const idx = (db.ordenes_mantenimiento || []).findIndex(o => o.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Orden no encontrada' });
  db.ordenes_mantenimiento.splice(idx, 1);
  writeMant(db);
  res.json({ ok: true });
});

// PATCH /api/mant/ordenes/:id/aplazar
router.patch('/ordenes/:id/aplazar', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const orden = (db.ordenes_mantenimiento || []).find(o => o.id === Number(req.params.id));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (orden.status === 'cerrada') return res.status(400).json({ error: 'No se puede aplazar una orden cerrada' });
  const { nueva_fecha, motivo } = req.body;
  if (!nueva_fecha) return res.status(400).json({ error: 'nueva_fecha requerida' });
  orden.fecha_programada_original = orden.fecha_programada_original || orden.fecha_programada;
  orden.fecha_programada = nueva_fecha;
  orden.fecha_requerida = nueva_fecha;
  orden.aplazado = true;
  orden.motivo_aplazamiento = motivo || null;
  orden.updated_at = new Date().toISOString();
  writeMant(db);
  res.json(orden);
});

// POST /api/mant/ordenes/:id/cerrar — técnico envía a validación
router.post('/ordenes/:id/cerrar', (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const orden = (db.ordenes_mantenimiento || []).find(o => o.id === Number(req.params.id));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (['cerrada','en_validacion'].includes(orden.status)) return res.status(400).json({ error: 'La orden ya fue cerrada o está en validación' });

  const { descripcion_trabajo, refaccion_utilizada, parte_danada } = req.body;
  if (!descripcion_trabajo) return res.status(400).json({ error: 'Descripción del trabajo requerida' });

  const now = new Date().toISOString();
  const { fecha: fechaMx, hora: horaMx } = nowMxStr();
  // Si no tiene técnico asignado, auto-asignar al que cierra
  if (!orden.tecnico_asignado_id) {
    orden.tecnico_asignado_id = req.mantUser.id;
    orden.status = 'asignada'; // transitorio antes de en_validacion
  }
  // Registrar quién atendió realmente
  orden.atendida_por_user_id = req.mantUser.id;
  if (!Array.isArray(orden.historial_atencion)) orden.historial_atencion = [];
  orden.historial_atencion.push({ user_id: req.mantUser.id, nombre: req.mantUser.full_name, accion: 'cierre', ts: now });

  orden.status = 'en_validacion';
  orden.fecha_cierre = fechaMx;
  orden.hora_cierre = horaMx;
  orden.cerrada_por_user_id = req.mantUser.id;
  orden.descripcion_trabajo = descripcion_trabajo;
  orden.refaccion_utilizada = refaccion_utilizada || null;
  orden.parte_danada = parte_danada || null;
  // Si estaba con máquina parada y no se registró el fin, cerrarlo ahora
  if (orden.maquina_parada_inicio && !orden.maquina_parada_fin) orden.maquina_parada_fin = now;

  // Guardar ciclo de atención en historial unificado
  if (!Array.isArray(orden.historial)) orden.historial = [];
  const atencionNum = orden.historial.filter(e => e.tipo === 'atencion').length + 1;
  orden.historial.push({
    tipo: 'atencion',
    numero: atencionNum,
    fecha_inicio: orden.fecha_en_proceso || null,
    hora_inicio: orden.hora_en_proceso || null,
    fecha_cierre: fechaMx,
    hora_cierre: horaMx,
    tecnico_id: req.mantUser.id,
    tecnico_nombre: req.mantUser.full_name,
    descripcion_trabajo,
    refaccion_utilizada: refaccion_utilizada || null,
    parte_danada: parte_danada || null,
  });

  orden.updated_at = now;

  // Si es un mantenimiento programado → registrar ejecución y calcular próxima fecha
  if (orden.programado_id) {
    const prog = (db.mantenimientos_programados || []).find(p => p.id === orden.programado_id);
    if (prog) {
      prog.fecha_ultimo_mant = now.slice(0, 10);
      prog.proxima_fecha = calcNextDate(prog);
      const ejec = {
        id: nextId(db.mant_ejecuciones),
        programado_id: prog.id,
        orden_id: orden.id,
        fecha_ejecucion: now.slice(0, 10),
        tecnico_id: req.mantUser.id,
        observaciones: descripcion_trabajo,
      };
      db.mant_ejecuciones.push(ejec);
    }
  }

  writeMant(db);

  // Si viene de producción y la integración está activa → cerrar paro automáticamente
  let paro_cerrado = null;
  if (orden.origen_produccion) {
    try {
      const { linea, paro_id } = orden.origen_produccion;
      const parosKey = linea === 'baker' ? 'paros_baker' : linea === 'l1' ? 'paros_l1' : 'paros';
      const pdb = dbProd.read();
      const arr = pdb[parosKey] || [];
      const idx = arr.findIndex(p => String(p.id) === String(paro_id));
      if (idx !== -1 && !arr[idx].fecha_fin) {
        const { fecha, hora } = nowMxStr();
        const ini = toMinsMant(arr[idx].hora_inicio);
        const fin = toMinsMant(hora);
        arr[idx].fecha_fin = fecha;
        arr[idx].hora_fin = hora;
        arr[idx].duracion_min = fin >= ini ? fin - ini : 1440 - ini + fin;
        arr[idx].cerrado_por_ot = orden.folio;
        pdb[parosKey] = arr;
        dbProd.write(pdb);
        paro_cerrado = { linea, paro_id };
      }
    } catch (e) {
      console.error('[MANT] Error auto-cerrando paro producción:', e.message);
    }
  }

  res.json({ ok: true, orden, paro_cerrado });
});

// PATCH /api/mant/ordenes/:id/iniciar-proceso — técnico inicia atención
router.patch('/ordenes/:id/iniciar-proceso', (req, res) => {
  const db = readMant();
  const orden = (db.ordenes_mantenimiento || []).find(o => o.id === Number(req.params.id));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (orden.status === 'en_proceso') return res.status(400).json({ error: 'La orden ya está en proceso' });
  if (['cerrada','en_validacion','cancelada'].includes(orden.status)) {
    return res.status(400).json({ error: 'No se puede iniciar proceso en una orden cerrada o cancelada' });
  }
  const { diagnostico, tiempo_estimado_cierre, status_equipo } = req.body;
  if (!diagnostico) return res.status(400).json({ error: 'Diagnóstico requerido' });
  if (!tiempo_estimado_cierre) return res.status(400).json({ error: 'Tiempo estimado de cierre requerido' });
  if (!['trabajando_normal','trabajando_ajuste','maquina_parada'].includes(status_equipo)) {
    return res.status(400).json({ error: 'status_equipo inválido' });
  }
  const now = new Date().toISOString();
  const { fecha: fechaMx, hora: horaMx } = nowMxStr();
  // Auto-asignar si no tiene técnico
  if (!orden.tecnico_asignado_id) orden.tecnico_asignado_id = req.mantUser.id;
  // Registrar historial
  if (!Array.isArray(orden.historial_atencion)) orden.historial_atencion = [];
  orden.historial_atencion.push({ user_id: req.mantUser.id, nombre: req.mantUser.full_name, accion: 'en_proceso', ts: now });
  orden.atendida_por_user_id = req.mantUser.id;
  orden.diagnostico = diagnostico;
  orden.tiempo_estimado_cierre = tiempo_estimado_cierre;
  orden.status_equipo = status_equipo;
  orden.fecha_en_proceso = fechaMx;
  orden.hora_en_proceso  = horaMx;
  if (status_equipo === 'maquina_parada') orden.maquina_parada_inicio = now;
  orden.status = 'en_proceso';
  orden.updated_at = now;
  writeMant(db);
  const dbMain = readMain();
  res.json(enrichOrden(orden, db, dbMain));
});

// PATCH /api/mant/ordenes/:id/validar — supervisor confirma cierre
router.patch('/ordenes/:id/validar', mantAllowRoles('supervisor_mant', 'admin', 'superadmin_mant'), (req, res) => {
  const db = readMant();
  const orden = (db.ordenes_mantenimiento || []).find(o => o.id === Number(req.params.id));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (orden.status !== 'en_validacion') return res.status(400).json({ error: 'La orden no está en validación' });
  const now = new Date().toISOString();
  const { fecha: fechaMx, hora: horaMx } = nowMxStr();
  if (orden.maquina_parada_inicio && !orden.maquina_parada_fin) orden.maquina_parada_fin = now;
  orden.status = 'cerrada';
  orden.fecha_validacion = fechaMx;
  orden.hora_validacion  = horaMx;
  orden.validado_por_user_id = req.mantUser.id;
  orden.updated_at = now;
  writeMant(db);
  const dbMain = readMain();
  res.json(enrichOrden(orden, db, dbMain));
});

// PATCH /api/mant/ordenes/:id/rechazar — supervisor rechaza, vuelve a abierta
router.patch('/ordenes/:id/rechazar', mantAllowRoles('supervisor_mant', 'admin', 'superadmin_mant'), (req, res) => {
  const db = readMant();
  const orden = (db.ordenes_mantenimiento || []).find(o => o.id === Number(req.params.id));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (orden.status !== 'en_validacion') return res.status(400).json({ error: 'La orden no está en validación' });
  const { motivo_rechazo } = req.body;
  if (!motivo_rechazo) return res.status(400).json({ error: 'Motivo de rechazo requerido' });
  const now = new Date().toISOString();
  const { fecha: fechaMx, hora: horaMx } = nowMxStr();

  // Guardar rechazo en historial unificado
  if (!Array.isArray(orden.historial)) orden.historial = [];
  const rechazoNum = orden.historial.filter(e => e.tipo === 'rechazo').length + 1;
  orden.historial.push({
    tipo: 'rechazo',
    numero: rechazoNum,
    fecha: fechaMx,
    hora: horaMx,
    motivo: motivo_rechazo,
    rechazado_por_id: req.mantUser.id,
    rechazado_por_nombre: req.mantUser.full_name,
  });

  orden.status = 'abierta';
  orden.motivo_rechazo = motivo_rechazo;
  orden.fecha_rechazo = fechaMx;
  orden.rechazado_por_user_id = req.mantUser.id;
  // Limpiar campos de cierre y en_proceso para que el siguiente ciclo empiece fresco
  orden.fecha_cierre = null;
  orden.hora_cierre = null;
  orden.cerrada_por_user_id = null;
  orden.fecha_en_proceso = null;
  orden.hora_en_proceso = null;
  orden.atendida_por_user_id = null;
  orden.updated_at = now;
  writeMant(db);
  const dbMain = readMain();
  res.json({ ok: true, orden: enrichOrden(orden, db, dbMain) });
});

// ── CATÁLOGO EQUIPOS ──────────────────────────────────────────────────────────

router.get('/equipos', (req, res) => {
  const db = readMant();
  res.json((db.equipos_mant || []).filter(e => req.query.all === '1' || e.activo));
});

router.post('/equipos', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const { nombre, codigo, tipo, linea_produccion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const equipo = {
    id: nextId(db.equipos_mant),
    nombre, codigo: codigo || '', tipo: tipo || 'otro',
    linea_produccion: linea_produccion || null,
    activo: true,
  };
  db.equipos_mant.push(equipo);
  writeMant(db);
  res.status(201).json(equipo);
});

router.patch('/equipos/:id', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const equipo = (db.equipos_mant || []).find(e => e.id === Number(req.params.id));
  if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  const { nombre, codigo, tipo, linea_produccion, activo } = req.body;
  if (nombre !== undefined) equipo.nombre = nombre;
  if (codigo !== undefined) equipo.codigo = codigo;
  if (tipo !== undefined) equipo.tipo = tipo;
  if (linea_produccion !== undefined) equipo.linea_produccion = linea_produccion;
  if (activo !== undefined) equipo.activo = activo;
  writeMant(db);
  res.json(equipo);
});

router.delete('/equipos/:id', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const idx = (db.equipos_mant || []).findIndex(e => e.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Equipo no encontrado' });
  db.equipos_mant.splice(idx, 1);
  writeMant(db);
  res.json({ ok: true });
});

// ── CATÁLOGO PARTES ───────────────────────────────────────────────────────────

router.get('/equipos/:id/partes', (req, res) => {
  const db = readMant();
  const partes = (db.partes_equipo || []).filter(p => p.equipo_id === Number(req.params.id) && (req.query.all === '1' || p.activo));
  res.json(partes);
});

router.post('/partes', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const { equipo_id, nombre, codigo } = req.body;
  if (!equipo_id || !nombre) return res.status(400).json({ error: 'Equipo y nombre requeridos' });
  const parte = {
    id: nextId(db.partes_equipo),
    equipo_id: Number(equipo_id), nombre,
    codigo: codigo || '', activo: true,
  };
  db.partes_equipo.push(parte);
  writeMant(db);
  res.status(201).json(parte);
});

router.patch('/partes/:id', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const parte = (db.partes_equipo || []).find(p => p.id === Number(req.params.id));
  if (!parte) return res.status(404).json({ error: 'Parte no encontrada' });
  const { nombre, codigo, activo } = req.body;
  if (nombre !== undefined) parte.nombre = nombre;
  if (codigo !== undefined) parte.codigo = codigo;
  if (activo !== undefined) parte.activo = activo;
  writeMant(db);
  res.json(parte);
});

router.delete('/partes/:id', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const idx = (db.partes_equipo || []).findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Parte no encontrada' });
  db.partes_equipo.splice(idx, 1);
  writeMant(db);
  res.json({ ok: true });
});

// ── MANTENIMIENTOS PROGRAMADOS ────────────────────────────────────────────────

// POST /programados/generar-mes — genera OTs para el mes (idempotente)
router.post('/programados/generar-mes', mantAllowRoles('admin'), (req, res) => {
  const year  = Number(req.body.anio);
  const month = Number(req.body.mes) - 1; // 0-indexed
  if (!year || isNaN(month)) return res.status(400).json({ error: 'anio y mes requeridos' });
  const pad = n => String(n).padStart(2,'0');
  const mStart = `${year}-${pad(month+1)}-01`;
  const mEnd   = `${year}-${pad(month+1)}-${new Date(year, month+1, 0).getDate()}`;

  const db = readMant(); const dbMain = readMain();
  const progs = (db.mantenimientos_programados || []).filter(p => p.status !== 'inactivo');
  let created = 0;

  for (const prog of progs) {
    const dates = getOccurrencesInMonth(prog, year, month);
    for (const fecha of dates) {
      const exists = (db.ordenes_mantenimiento || []).some(o =>
        o.programado_id === prog.id && o.fecha_programada === fecha && o.status !== 'cancelada'
      );
      if (exists) continue;
      const now = new Date().toISOString();
      const folio = nextFolio(db);
      const ot = {
        id: nextId(db.ordenes_mantenimiento),
        folio,
        tipo: 'programado',
        status: prog.tecnico_responsable_id ? 'asignada' : 'abierta',
        prioridad: 'normal',
        nivel_urgencia: 'baja',
        equipo_id: prog.equipo_id,
        parte_equipo_id: prog.parte_equipo_id || null,
        descripcion_falla: prog.tarea,
        departamento_id: null,
        departamento_nombre: null,
        solicitante_user_id: null,
        hora_solicitud: '00:00',
        tecnico_asignado_id: prog.tecnico_responsable_id || null,
        fecha_solicitud: now.slice(0, 10),
        fecha_programada: fecha,
        fecha_requerida: fecha,
        programado_id: prog.id,
        origen_produccion: null,
        aplazado: false,
        motivo_aplazamiento: null,
        fecha_programada_original: null,
        fecha_cierre: null,
        hora_cierre: null,
        cerrada_por_user_id: null,
        descripcion_trabajo: null,
        refaccion_utilizada: null,
        parte_danada: null,
        created_at: now,
        updated_at: now,
      };
      if (!db.ordenes_mantenimiento) db.ordenes_mantenimiento = [];
      db.ordenes_mantenimiento.push(ot);
      created++;
    }
  }
  if (created > 0) writeMant(db);

  const ordenes = (db.ordenes_mantenimiento || [])
    .filter(o => o.tipo === 'programado' && o.fecha_programada >= mStart && o.fecha_programada <= mEnd)
    .sort((a, b) => (a.fecha_programada||'').localeCompare(b.fecha_programada||''))
    .map(o => {
      const prog = (db.mantenimientos_programados || []).find(p => p.id === o.programado_id) || {};
      return { ...enrichOrden(o, db, dbMain), prog_frecuencia: prog.frecuencia || null };
    });
  res.json({ created, ordenes });
});

router.get('/programados', mantAllowRoles('tecnico_mant', 'admin'), (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const items = (db.mantenimientos_programados || [])
    .filter(p => req.query.all === '1' || p.status === 'activo')
    .map(p => {
      const equipo = (db.equipos_mant || []).find(e => e.id === p.equipo_id) || {};
      const parte  = (db.partes_equipo || []).find(x => x.id === p.parte_equipo_id) || {};
      const tec    = p.tecnico_responsable_id ? (dbMain.users || []).find(u => u.id === p.tecnico_responsable_id) || {} : {};
      const hoy    = new Date().toISOString().slice(0, 10);
      const vencido = p.proxima_fecha && p.proxima_fecha < hoy;
      const proximo = p.proxima_fecha && !vencido && daysDiff(hoy, p.proxima_fecha) <= 3;
      return {
        ...p,
        equipo_nombre: equipo.nombre || '-',
        parte_nombre: parte.nombre || '-',
        tecnico_nombre: tec.full_name || null,
        vencido, proximo,
        dias_para_prox: p.proxima_fecha ? daysDiff(hoy, p.proxima_fecha) : null,
      };
    });
  res.json(items);
});

router.post('/programados', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const { equipo_id, parte_equipo_id, tarea, frecuencia, dias_intervalo,
          fecha_inicio, fecha_ultimo_mant, tecnico_responsable_id } = req.body;
  if (!equipo_id || !tarea || !frecuencia || !fecha_inicio) {
    return res.status(400).json({ error: 'Equipo, tarea, frecuencia y fecha de inicio requeridos' });
  }
  const prog = {
    id: nextId(db.mantenimientos_programados),
    equipo_id: Number(equipo_id),
    parte_equipo_id: parte_equipo_id ? Number(parte_equipo_id) : null,
    tarea,
    frecuencia,
    dias_intervalo: frecuencia === 'personalizado' ? Number(dias_intervalo || 30) : null,
    fecha_inicio,
    fecha_ultimo_mant: fecha_ultimo_mant || null,
    proxima_fecha: null,
    tecnico_responsable_id: tecnico_responsable_id ? Number(tecnico_responsable_id) : null,
    status: 'activo',
    created_at: new Date().toISOString(),
  };
  prog.proxima_fecha = calcNextDate(prog);
  db.mantenimientos_programados.push(prog);
  writeMant(db);
  res.status(201).json(prog);
});

router.patch('/programados/:id', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const prog = (db.mantenimientos_programados || []).find(p => p.id === Number(req.params.id));
  if (!prog) return res.status(404).json({ error: 'Programado no encontrado' });
  const fields = ['tarea','frecuencia','dias_intervalo','fecha_inicio','fecha_ultimo_mant','tecnico_responsable_id','status','equipo_id','parte_equipo_id'];
  fields.forEach(f => { if (req.body[f] !== undefined) prog[f] = req.body[f]; });
  prog.proxima_fecha = calcNextDate(prog);
  writeMant(db);
  res.json(prog);
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────

router.get('/settings', mantAllowRoles('admin'), (req, res) => {
  res.json(readMant().settings || {});
});

router.patch('/settings', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  db.settings = { ...db.settings, ...req.body };
  writeMant(db);
  res.json(db.settings);
});

// ── HERRAMIENTA: corregir fechas UTC → Mexico CDT (UTC-5) ────────────────────
function _detectarFechasUtc(db) {
  const hoy = nowMxStr().fecha;
  const OFFSET = 5;
  const porOrden = {};

  function evalCampo(o, fk, hk) {
    const fecha = o[fk], hora = hk ? o[hk] : '00:00';
    if (!fecha || !hora || fecha <= hoy) return;
    const h = parseInt(hora.slice(0, 2));
    if (h >= OFFSET) return;
    const horaLocal = String(h + (24 - OFFSET)).padStart(2, '0') + hora.slice(2);
    if (!porOrden[o.id]) porOrden[o.id] = { id: o.id, folio: o.folio, equipo: o.equipo_custom || o.equipo_id, campos: [] };
    porOrden[o.id].campos.push({ campo: fk, de_fecha: fecha, de_hora: hk ? o[hk] : '', a_fecha: hoy, a_hora: hk ? horaLocal : '' });
  }

  (db.ordenes_mantenimiento || []).forEach(o => {
    evalCampo(o, 'fecha_cierre', 'hora_cierre');
    evalCampo(o, 'fecha_en_proceso', 'hora_en_proceso');
    evalCampo(o, 'fecha_validacion', 'hora_validacion');
    evalCampo(o, 'fecha_rechazo', null);
    (o.historial || []).forEach((h, i) => {
      if (h.tipo === 'atencion') {
        if (h.fecha_cierre && h.hora_cierre && h.fecha_cierre > hoy && parseInt(h.hora_cierre) < OFFSET) {
          const hl = String(parseInt(h.hora_cierre) + (24 - OFFSET)).padStart(2, '0') + h.hora_cierre.slice(2);
          if (!porOrden[o.id]) porOrden[o.id] = { id: o.id, folio: o.folio, equipo: o.equipo_custom || o.equipo_id, campos: [] };
          porOrden[o.id].campos.push({ campo: `historial[${i}].cierre`, de_fecha: h.fecha_cierre, de_hora: h.hora_cierre, a_fecha: hoy, a_hora: hl });
        }
        if (h.fecha_inicio && h.hora_inicio && h.fecha_inicio > hoy && parseInt(h.hora_inicio) < OFFSET) {
          const hl = String(parseInt(h.hora_inicio) + (24 - OFFSET)).padStart(2, '0') + h.hora_inicio.slice(2);
          if (!porOrden[o.id]) porOrden[o.id] = { id: o.id, folio: o.folio, equipo: o.equipo_custom || o.equipo_id, campos: [] };
          porOrden[o.id].campos.push({ campo: `historial[${i}].inicio`, de_fecha: h.fecha_inicio, de_hora: h.hora_inicio, a_fecha: hoy, a_hora: hl });
        }
      } else if (h.tipo === 'rechazo' && h.fecha && h.hora && h.fecha > hoy && parseInt(h.hora) < OFFSET) {
        const hl = String(parseInt(h.hora) + (24 - OFFSET)).padStart(2, '0') + h.hora.slice(2);
        if (!porOrden[o.id]) porOrden[o.id] = { id: o.id, folio: o.folio, equipo: o.equipo_custom || o.equipo_id, campos: [] };
        porOrden[o.id].campos.push({ campo: `historial[${i}].rechazo`, de_fecha: h.fecha, de_hora: h.hora, a_fecha: hoy, a_hora: hl });
      }
    });
  });
  return Object.values(porOrden);
}

// GET — preview sin cambios
router.get('/admin/fix-fechas-utc', mantAllowRoles('superadmin_mant'), (req, res) => {
  const db = readMant();
  res.json(_detectarFechasUtc(db));
});

// POST — corregir solo las órdenes con los IDs indicados
router.post('/admin/fix-fechas-utc', mantAllowRoles('superadmin_mant'), (req, res) => {
  const ids = new Set((req.body.ids || []).map(Number));
  if (!ids.size) return res.status(400).json({ error: 'Sin IDs seleccionados' });
  const db = readMant();
  const hoy = nowMxStr().fecha;
  const OFFSET = 5;
  let corregidos = 0;

  function aplicar(fecha, hora) {
    if (!fecha || !hora || fecha <= hoy) return null;
    const h = parseInt(hora.slice(0, 2));
    if (h >= OFFSET) return null;
    return { fecha: hoy, hora: String(h + (24 - OFFSET)).padStart(2, '0') + hora.slice(2) };
  }

  (db.ordenes_mantenimiento || []).filter(o => ids.has(o.id)).forEach(o => {
    [['fecha_cierre','hora_cierre'],['fecha_en_proceso','hora_en_proceso'],['fecha_validacion','hora_validacion']].forEach(([fk,hk]) => {
      const r = aplicar(o[fk], o[hk]);
      if (r) { o[fk] = r.fecha; o[hk] = r.hora; corregidos++; }
    });
    if (o.fecha_rechazo > hoy) { o.fecha_rechazo = hoy; corregidos++; }
    (o.historial || []).forEach(h => {
      if (h.tipo === 'atencion') {
        const rc = aplicar(h.fecha_cierre, h.hora_cierre);
        if (rc) { h.fecha_cierre = rc.fecha; h.hora_cierre = rc.hora; corregidos++; }
        const ri = aplicar(h.fecha_inicio, h.hora_inicio);
        if (ri) { h.fecha_inicio = ri.fecha; h.hora_inicio = ri.hora; corregidos++; }
      } else if (h.tipo === 'rechazo') {
        const rr = aplicar(h.fecha, h.hora);
        if (rr) { h.fecha = rr.fecha; h.hora = rr.hora; corregidos++; }
      }
    });
  });

  writeMant(db);
  res.json({ ok: true, ordenes_corregidas: ids.size, campos_corregidos: corregidos });
});

// ── KPIs ──────────────────────────────────────────────────────────────────────

router.get('/kpis', mantAllowRoles('admin'), (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const { desde, hasta } = req.query;
  const hoy = new Date().toISOString().slice(0, 10);
  const ini = desde || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fin = hasta || hoy;

  let ordenes = (db.ordenes_mantenimiento || []).filter(o =>
    o.fecha_solicitud >= ini && o.fecha_solicitud <= fin
  );

  const cerradas  = ordenes.filter(o => o.status === 'cerrada');
  const abiertas  = ordenes.filter(o => o.status !== 'cerrada' && o.status !== 'cancelada');
  const urgentes  = ordenes.filter(o => o.tipo === 'correctivo_urgente');
  const programados = ordenes.filter(o => o.tipo === 'programado');

  // Tiempos (en minutos)
  const tiempos = cerradas.map(o => {
    const ini_ = new Date(`${o.fecha_solicitud}T${o.hora_solicitud || '00:00'}`);
    const fin_ = new Date(`${o.fecha_cierre}T${o.hora_cierre || '00:00'}`);
    return Math.round((fin_ - ini_) / 60000);
  }).filter(t => t > 0);

  const avg = arr => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;

  // Por equipo
  const porEquipo = {};
  ordenes.forEach(o => {
    const eq = (db.equipos_mant || []).find(e => e.id === o.equipo_id);
    const k = eq ? eq.nombre : 'Sin equipo';
    porEquipo[k] = (porEquipo[k] || 0) + 1;
  });

  // Por técnico
  const porTecnico = {};
  cerradas.forEach(o => {
    if (!o.tecnico_asignado_id) return;
    const u = (dbMain.users || []).find(u => u.id === o.tecnico_asignado_id);
    const k = u ? u.full_name : 'Sin asignar';
    if (!porTecnico[k]) porTecnico[k] = { asignadas: 0, cerradas: 0 };
    porTecnico[k].cerradas++;
  });
  ordenes.filter(o => o.tecnico_asignado_id).forEach(o => {
    const u = (dbMain.users || []).find(u => u.id === o.tecnico_asignado_id);
    const k = u ? u.full_name : 'Sin asignar';
    if (!porTecnico[k]) porTecnico[k] = { asignadas: 0, cerradas: 0 };
    porTecnico[k].asignadas++;
  });

  res.json({
    periodo: { desde: ini, hasta: fin },
    totales: { total: ordenes.length, abiertas: abiertas.length, cerradas: cerradas.length, urgentes: urgentes.length, programados: programados.length },
    tiempos: { promedio_cierre_min: avg(tiempos), min: Math.min(...tiempos, 0), max: Math.max(...tiempos, 0) },
    por_equipo: Object.entries(porEquipo).sort((a,b)=>b[1]-a[1]).map(([nombre,total])=>({nombre,total})),
    por_tecnico: Object.entries(porTecnico).map(([nombre,v])=>({ nombre, ...v, pct: v.asignadas ? Math.round(v.cerradas/v.asignadas*100) : 0 })),
  });
});

// ── Departamentos (centros de costo del sistema principal) ────────────────────
router.get('/departamentos', (req, res) => {
  const db = readMain();
  res.json((db.cost_centers || []).filter(c => c.active !== false).map(c => ({ id: c.id, nombre: c.name, codigo: c.code })));
});

// ── Técnicos disponibles (para asignar) ──────────────────────────────────────
router.get('/tecnicos', mantAllowRoles('admin', 'supervisor_mant'), (req, res) => {
  const db = readMain();
  const tecnicos = (db.users || []).filter(u => u.active && u.mant_role === 'tecnico_mant');
  res.json(tecnicos.map(u => ({ id: u.id, full_name: u.full_name, email: u.email, mant_role: u.mant_role })));
});

// GET /tecnicos/:id/carga — cantidad de órdenes por día del técnico en el mes
router.get('/tecnicos/:id/carga', mantAllowRoles('admin'), (req, res) => {
  const tecId = Number(req.params.id);
  const year  = Number(req.query.anio) || new Date().getFullYear();
  const month = Number(req.query.mes)  || (new Date().getMonth() + 1);
  const pad = n => String(n).padStart(2,'0');
  const mStart = `${year}-${pad(month)}-01`;
  const mEnd   = `${year}-${pad(month)}-${new Date(year, month, 0).getDate()}`;
  const db = readMant();
  const carga = {};
  (db.ordenes_mantenimiento || [])
    .filter(o => o.tecnico_asignado_id === tecId && o.status !== 'cancelada' && o.status !== 'cerrada')
    .forEach(o => {
      const f = o.fecha_programada || o.fecha_solicitud;
      if (f >= mStart && f <= mEnd) carga[f] = (carga[f] || 0) + 1;
    });
  res.json(carga);
});

// ── Usuarios del módulo (gestión de roles) ────────────────────────────────────
router.get('/usuarios', mantAllowRoles('admin'), (req, res) => {
  const db = readMain();
  res.json((db.users || []).filter(u => u.active).map(u => ({
    id: u.id, full_name: u.full_name, email: u.email, mant_role: u.mant_role || null
  })));
});

router.patch('/usuarios/:id/rol', mantAllowRoles('admin'), (req, res) => {
  const db = readMain();
  const { write: writeMain } = require('../db');
  const user = (db.users || []).find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { mant_role } = req.body;
  const roles_validos = ['supervisor_mant', 'tecnico_mant', 'admin', null];
  if (!roles_validos.includes(mant_role)) return res.status(400).json({ error: 'Rol inválido' });
  user.mant_role = mant_role || null;
  writeMain(db);
  res.json({ id: user.id, full_name: user.full_name, mant_role: user.mant_role });
});

// ── HELPERS internos ──────────────────────────────────────────────────────────
function calcNextDate(prog) {
  const base = prog.fecha_ultimo_mant || prog.fecha_inicio;
  if (!base) return prog.fecha_inicio || null;
  const d = new Date(base + 'T12:00:00');
  advanceDateMant(d, prog);
  return d.toISOString().slice(0, 10);
}

function advanceDateMant(d, prog) {
  switch (prog.frecuencia) {
    case 'diario':        d.setDate(d.getDate() + 1); break;
    case 'semanal':       d.setDate(d.getDate() + 7); break;
    case 'quincenal':     d.setDate(d.getDate() + 14); break;
    case 'mensual':       d.setMonth(d.getMonth() + 1); break;
    case 'trimestral':    d.setMonth(d.getMonth() + 3); break;
    case 'semestral':     d.setMonth(d.getMonth() + 6); break;
    case 'anual':         d.setFullYear(d.getFullYear() + 1); break;
    case 'personalizado': d.setDate(d.getDate() + (Number(prog.dias_intervalo) || 30)); break;
    default: d.setFullYear(d.getFullYear() + 100); break; // exit guard
  }
}

// Calcula todas las ocurrencias de un programado dentro de un mes dado (0-indexed month)
function getOccurrencesInMonth(prog, year, month) {
  if (!prog.fecha_inicio || prog.status === 'inactivo') return [];
  const pad = n => String(n).padStart(2,'0');
  const mStartStr = `${year}-${pad(month+1)}-01`;
  const mEndStr   = `${year}-${pad(month+1)}-${new Date(year, month+1, 0).getDate()}`;
  if (prog.fecha_inicio > mEndStr) return [];

  // Fast-forward to near mStart
  let cur = new Date(prog.fecha_inicio + 'T12:00:00');
  const mStart = new Date(year, month, 1, 12);
  const DAY = 86400000;
  const stepDays = { diario:1, semanal:7, quincenal:14, personalizado: Number(prog.dias_intervalo)||30 };
  const stepMonths = { mensual:1, trimestral:3, semestral:6, anual:12 };

  if (cur < mStart) {
    if (stepDays[prog.frecuencia]) {
      const s = stepDays[prog.frecuencia];
      const steps = Math.max(0, Math.floor((mStart - cur) / (s * DAY)) - 1);
      if (steps > 0) cur = new Date(cur.getTime() + steps * s * DAY);
    } else if (stepMonths[prog.frecuencia]) {
      const sm = stepMonths[prog.frecuencia];
      const monthsDiff = (year - cur.getFullYear()) * 12 + (month - cur.getMonth());
      const steps = Math.max(0, Math.floor(monthsDiff / sm) - 1);
      if (steps > 0) cur.setMonth(cur.getMonth() + steps * sm);
    }
  }

  const results = [];
  for (let i = 0; i < 300; i++) {
    const s = cur.toISOString().slice(0, 10);
    if (s > mEndStr) break;
    if (s >= mStartStr) results.push(s);
    const prev = cur.getTime();
    advanceDateMant(cur, prog);
    if (cur.getTime() <= prev) break; // stale guard
  }
  return results;
}

function daysDiff(desde, hasta) {
  return Math.round((new Date(hasta) - new Date(desde)) / 86400000);
}

module.exports = router;
