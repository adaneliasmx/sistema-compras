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
  return {
    ...o,
    equipo_nombre: equipo.nombre || '-',
    equipo_codigo: equipo.codigo || '-',
    parte_nombre: parte.nombre || '-',
    tecnico_nombre: tecnico.full_name || null,
    cerrada_por_nombre: cerradoPor.full_name || null,
    solicitante_nombre: solicitanteNombre,
  };
}

// ── ÓRDENES ───────────────────────────────────────────────────────────────────

// GET /api/mant/ordenes
router.get('/ordenes', (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const { status, tipo, equipo_id, fecha_ini, fecha_fin, tecnico_id, solicitante_id } = req.query;

  let ordenes = db.ordenes_mantenimiento || [];

  // Técnico ve sus órdenes + órdenes sin asignar
  if (req.mantUser.mant_role === 'tecnico_mant') {
    ordenes = ordenes.filter(o => o.tecnico_asignado_id === req.mantUser.id || !o.tecnico_asignado_id);
  }
  // Supervisor solo ve sus propias solicitudes
  if (req.mantUser.mant_role === 'supervisor_mant') {
    ordenes = ordenes.filter(o => o.solicitante_user_id === req.mantUser.id);
  }

  if (status)        ordenes = ordenes.filter(o => o.status === status);
  if (tipo)          ordenes = ordenes.filter(o => o.tipo === tipo);
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
  // Técnico solo ve sus órdenes o las sin asignar
  if (req.mantUser.mant_role === 'tecnico_mant' && o.tecnico_asignado_id && o.tecnico_asignado_id !== req.mantUser.id) {
    return res.status(403).json({ error: 'Sin acceso a esta orden' });
  }
  res.json(enrichOrden(o, db, dbMain));
});

// POST /api/mant/ordenes — crear solicitud (supervisor o admin)
router.post('/ordenes', mantAllowRoles('supervisor_mant'), (req, res) => {
  const db = readMant();
  const now = new Date().toISOString();
  const folio = nextFolio(db);
  // Resolver nombre del departamento
  const dbMainLocal = readMain();
  const dpto = req.body.departamento_id
    ? (dbMainLocal.cost_centers || []).find(c => c.id === Number(req.body.departamento_id))
    : null;

  const orden = {
    id: nextId(db.ordenes_mantenimiento),
    folio,
    tipo: 'correctivo_solicitud',
    origen: 'mantenimiento',
    paro_id: null,
    equipo_id: Number(req.body.equipo_id) || null,
    parte_equipo_id: req.body.parte_equipo_id ? Number(req.body.parte_equipo_id) : null,
    solicitante_nombre: req.mantUser.full_name,
    solicitante_user_id: req.mantUser.id,
    departamento_id: dpto ? dpto.id : null,
    departamento_nombre: dpto ? dpto.name : null,
    fecha_solicitud: req.body.fecha_solicitud || now.slice(0, 10),
    hora_solicitud: req.body.hora_solicitud || now.slice(11, 16),
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
  if (!orden.equipo_id) return res.status(400).json({ error: 'Equipo requerido' });
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
  if (status && ['abierta','asignada','en_proceso','cancelada'].includes(status)) orden.status = status;
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

// POST /api/mant/ordenes/:id/cerrar — cierre con firma
router.post('/ordenes/:id/cerrar', (req, res) => {
  const db = readMant();
  const dbMain = readMain();
  const orden = (db.ordenes_mantenimiento || []).find(o => o.id === Number(req.params.id));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (orden.status === 'cerrada') return res.status(400).json({ error: 'La orden ya está cerrada' });

  // Técnico solo puede cerrar sus propias órdenes
  if (req.mantUser.mant_role === 'tecnico_mant' && orden.tecnico_asignado_id !== req.mantUser.id) {
    return res.status(403).json({ error: 'Solo el técnico asignado puede cerrar esta orden' });
  }

  const { descripcion_trabajo, refaccion_utilizada, parte_danada } = req.body;
  if (!descripcion_trabajo) return res.status(400).json({ error: 'Descripción del trabajo requerida' });

  const now = new Date().toISOString();
  orden.status = 'cerrada';
  orden.fecha_cierre = now.slice(0, 10);
  orden.hora_cierre = now.slice(11, 16);
  orden.cerrada_por_user_id = req.mantUser.id;
  orden.descripcion_trabajo = descripcion_trabajo;
  orden.refaccion_utilizada = refaccion_utilizada || null;
  orden.parte_danada = parte_danada || null;
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
