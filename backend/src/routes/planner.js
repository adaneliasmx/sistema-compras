const express = require('express');
const { read, write, DEPARTAMENTOS } = require('../db-planner');
const { read: readCompras } = require('../db');
const { read: readProd } = require('../db-produccion');
const { read: readMant } = require('../db-mantenimiento');
const { read: readInv } = require('../db-inventarios');
const { read: readVales } = require('../db-vales');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function nowMxTime() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
}

// ── Middleware: verificar acceso planner ──────────────────────────────────────
function plannerRequired(req, res, next) {
  const db = read();
  const asig = (db.asignaciones || []).find(a => a.usuario_id === req.user.id);
  if (!asig) return res.status(403).json({ error: 'No tienes acceso al modulo Planner. Solicita asignacion al administrador.' });
  req.plannerUser = asig;
  next();
}

function plannerAdmin(req, res, next) {
  if (!req.plannerUser || req.plannerUser.planner_role !== 'admin') {
    return res.status(403).json({ error: 'Se requiere rol admin en Planner' });
  }
  next();
}

router.use(authRequired);
router.use(plannerRequired);

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatActId(num) {
  return 'ACT-' + String(num).padStart(4, '0');
}

function formatSubId(num) {
  return 'SUB-' + String(num).padStart(4, '0');
}

function nextActNum(actividades) {
  if (!actividades.length) return 1;
  const nums = actividades.map(a => {
    const m = String(a.id).match(/ACT-(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });
  return Math.max(...nums) + 1;
}

function nextSubNum(subs) {
  if (!subs || !subs.length) return 1;
  const nums = subs.map(s => {
    const m = String(s.id).match(/SUB-(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });
  return Math.max(...nums) + 1;
}

function addTraza(act, userId, userName, accion, detalle) {
  if (!act.trazabilidad) act.trazabilidad = [];
  act.trazabilidad.push({
    fecha: nowMxDate(),
    hora: nowMxTime(),
    usuario_id: userId,
    usuario_nombre: userName,
    accion,
    detalle
  });
}

const VALID_ESTATUS = ['sin_empezar', 'en_proceso', 'cerrada', 'atrasada', 'pospuesta', 'cancelada'];
const VALID_URGENCIA = ['alta', 'media', 'baja'];
const VALID_SUB_ESTATUS = ['sin_empezar', 'en_proceso', 'cerrada', 'atrasada', 'pospuesta'];

// Sanitizar contra prototype pollution
function safeBody(body) {
  const copy = { ...body };
  delete copy.__proto__;
  delete copy.constructor;
  delete copy.prototype;
  return copy;
}

// ── DEPARTAMENTOS ────────────────────────────────────────────────────────────

router.get('/departamentos', (req, res) => {
  res.json(DEPARTAMENTOS);
});

// ── STAFF (usuarios asignados al planner) ────────────────────────────────────

router.get('/staff', (req, res) => {
  const db = read();
  res.json((db.asignaciones || []).map(a => ({
    usuario_id: a.usuario_id,
    nombre: a.nombre,
    email: a.email,
    planner_role: a.planner_role,
    departamentos: a.departamentos || []
  })));
});

// Todos los usuarios internos disponibles (para selector de responsable)
router.get('/staff/disponibles', (req, res) => {
  const comprasDb = readCompras();
  const internos = (comprasDb.users || [])
    .filter(u => u.active !== false && u.role_code !== 'proveedor')
    .map(u => ({ id: u.id, nombre: u.full_name, email: u.email, role: u.role_code }));
  res.json(internos);
});

// Mi perfil planner
router.get('/me', (req, res) => {
  res.json({
    usuario_id: req.user.id,
    nombre: req.user.full_name,
    email: req.user.email,
    planner_role: req.plannerUser.planner_role,
    departamentos: req.plannerUser.departamentos || []
  });
});

// ── ACTIVIDADES CRUD ─────────────────────────────────────────────────────────

router.get('/actividades', (req, res) => {
  const db = read();
  let list = db.actividades || [];

  const { depto, estatus, urgencia, responsable, buscar, desde, hasta } = req.query;
  if (depto) list = list.filter(a => a.departamento === depto);
  if (estatus) list = list.filter(a => a.estatus === estatus);
  if (urgencia) list = list.filter(a => a.urgencia === urgencia);
  if (responsable) list = list.filter(a => a.responsable_id === Number(responsable));
  if (desde) list = list.filter(a => (a.fecha_creacion || '') >= desde);
  if (hasta) list = list.filter(a => (a.fecha_creacion || '') <= hasta);
  if (buscar) {
    const q = buscar.toLowerCase();
    list = list.filter(a =>
      (a.titulo || '').toLowerCase().includes(q) ||
      (a.id || '').toLowerCase().includes(q) ||
      (a.responsable_nombre || '').toLowerCase().includes(q) ||
      (a.descripcion || '').toLowerCase().includes(q)
    );
  }

  // Ordenar: atrasadas primero, luego por fecha creacion desc
  list = list.slice().sort((a, b) => {
    if (a.estatus === 'atrasada' && b.estatus !== 'atrasada') return -1;
    if (b.estatus === 'atrasada' && a.estatus !== 'atrasada') return 1;
    return (b.fecha_creacion || '').localeCompare(a.fecha_creacion || '');
  });

  // Respuesta ligera (sin sub_actividades completas ni trazabilidad)
  res.json(list.map(a => ({
    id: a.id,
    titulo: a.titulo,
    responsable_id: a.responsable_id,
    responsable_nombre: a.responsable_nombre,
    departamento: a.departamento,
    fecha_compromiso: a.fecha_compromiso,
    urgencia: a.urgencia,
    estatus: a.estatus,
    avance: a.avance,
    fecha_creacion: a.fecha_creacion,
    fecha_inicio: a.fecha_inicio,
    fecha_fin: a.fecha_fin,
    correlacion_daily: a.correlacion_daily || null,
    correlacion_compras: a.correlacion_compras || null,
    sub_count: (a.sub_actividades || []).length,
    traza_count: (a.trazabilidad || []).length
  })));
});

router.post('/actividades', (req, res) => {
  const body = safeBody(req.body);
  const { titulo, descripcion, responsable_id, departamento, fecha_compromiso, urgencia, correlacion_daily, correlacion_compras } = body;

  if (!titulo || !responsable_id || !departamento) {
    return res.status(400).json({ error: 'titulo, responsable_id y departamento son requeridos' });
  }
  if (!DEPARTAMENTOS.find(d => d.id === departamento)) {
    return res.status(400).json({ error: 'Departamento invalido' });
  }
  if (urgencia && !VALID_URGENCIA.includes(urgencia)) {
    return res.status(400).json({ error: 'Urgencia invalida. Use: alta, media, baja' });
  }

  // Buscar responsable
  const comprasDb = readCompras();
  const responsable = (comprasDb.users || []).find(u => u.id === Number(responsable_id));
  if (!responsable) return res.status(400).json({ error: 'Responsable no encontrado' });

  const db = read();
  const id = formatActId(nextActNum(db.actividades || []));

  const actividad = {
    id,
    titulo,
    descripcion: descripcion || '',
    responsable_id: responsable.id,
    responsable_nombre: responsable.full_name,
    responsable_email: responsable.email || '',
    departamento,
    fecha_compromiso: fecha_compromiso || null,
    urgencia: urgencia || 'media',
    estatus: 'sin_empezar',
    avance: 0,
    fecha_inicio: null,
    fecha_fin: null,
    correlacion_daily: correlacion_daily || null,
    correlacion_compras: correlacion_compras || null,
    creado_por: req.user.id,
    creado_por_nombre: req.user.full_name,
    fecha_creacion: nowMxDate(),
    hora_creacion: nowMxTime(),
    sub_actividades: [],
    trazabilidad: []
  };

  addTraza(actividad, req.user.id, req.user.full_name, 'creada', 'Actividad creada');

  db.actividades = db.actividades || [];
  db.actividades.push(actividad);
  write(db);

  res.status(201).json(actividad);
});

router.get('/actividades/:id', (req, res) => {
  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });
  res.json(act);
});

router.patch('/actividades/:id', (req, res) => {
  const body = safeBody(req.body);
  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  const cambios = [];
  const prevEstatus = act.estatus;
  const prevUrgencia = act.urgencia;

  if (body.titulo !== undefined && body.titulo !== act.titulo) {
    cambios.push(`Titulo: "${act.titulo}" -> "${body.titulo}"`);
    act.titulo = body.titulo;
  }
  if (body.descripcion !== undefined && body.descripcion !== act.descripcion) {
    act.descripcion = body.descripcion;
    cambios.push('Descripcion actualizada');
  }
  if (body.estatus && body.estatus !== act.estatus) {
    if (!VALID_ESTATUS.includes(body.estatus)) return res.status(400).json({ error: 'Estatus invalido' });
    cambios.push(`${act.estatus} -> ${body.estatus}`);
    act.estatus = body.estatus;
    if (body.estatus === 'en_proceso' && !act.fecha_inicio) act.fecha_inicio = nowMxDate();
    if (body.estatus === 'cerrada' && !act.fecha_fin) act.fecha_fin = nowMxDate();
  }
  if (body.urgencia && body.urgencia !== act.urgencia) {
    if (!VALID_URGENCIA.includes(body.urgencia)) return res.status(400).json({ error: 'Urgencia invalida' });
    cambios.push(`Urgencia: ${act.urgencia} -> ${body.urgencia}`);
    act.urgencia = body.urgencia;
  }
  if (body.avance !== undefined && body.avance !== act.avance) {
    const av = Math.max(0, Math.min(100, Number(body.avance) || 0));
    cambios.push(`Avance: ${act.avance}% -> ${av}%`);
    act.avance = av;
  }
  if (body.fecha_compromiso !== undefined && body.fecha_compromiso !== act.fecha_compromiso) {
    cambios.push(`Fecha compromiso: ${act.fecha_compromiso || 'N/A'} -> ${body.fecha_compromiso || 'N/A'}`);
    act.fecha_compromiso = body.fecha_compromiso || null;
  }
  if (body.fecha_inicio !== undefined) act.fecha_inicio = body.fecha_inicio || null;
  if (body.fecha_fin !== undefined) act.fecha_fin = body.fecha_fin || null;
  if (body.responsable_id && body.responsable_id !== act.responsable_id) {
    const comprasDb = readCompras();
    const resp = (comprasDb.users || []).find(u => u.id === Number(body.responsable_id));
    if (resp) {
      cambios.push(`Responsable: ${act.responsable_nombre} -> ${resp.full_name}`);
      act.responsable_id = resp.id;
      act.responsable_nombre = resp.full_name;
      act.responsable_email = resp.email || '';
    }
  }
  if (body.departamento && body.departamento !== act.departamento && DEPARTAMENTOS.find(d => d.id === body.departamento)) {
    cambios.push(`Departamento: ${act.departamento} -> ${body.departamento}`);
    act.departamento = body.departamento;
  }

  if (cambios.length > 0) {
    addTraza(act, req.user.id, req.user.full_name, 'editada', cambios.join('. '));
  }

  write(db);

  // Generar mailto si cambio estatus o urgencia
  let mailto = null;
  if ((body.estatus && body.estatus !== prevEstatus) || (body.urgencia && body.urgencia !== prevUrgencia)) {
    mailto = buildMailto(act, 'Actualizacion de actividad');
  }

  res.json({ ok: true, actividad: act, mailto });
});

router.delete('/actividades/:id', plannerAdmin, (req, res) => {
  const db = read();
  const idx = (db.actividades || []).findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Actividad no encontrada' });
  const removed = db.actividades.splice(idx, 1)[0];
  write(db);
  res.json({ ok: true, id: removed.id });
});

// ── SUB-ACTIVIDADES ──────────────────────────────────────────────────────────

router.post('/actividades/:id/sub', (req, res) => {
  const body = safeBody(req.body);
  const { nombre, descripcion, responsable_id, fecha_compromiso } = body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  let responsable_nombre = req.user.full_name;
  if (responsable_id) {
    const comprasDb = readCompras();
    const resp = (comprasDb.users || []).find(u => u.id === Number(responsable_id));
    if (resp) responsable_nombre = resp.full_name;
  }

  act.sub_actividades = act.sub_actividades || [];
  const subId = formatSubId(nextSubNum(act.sub_actividades));
  const sub = {
    id: subId,
    nombre,
    descripcion: descripcion || '',
    responsable_id: responsable_id ? Number(responsable_id) : req.user.id,
    responsable_nombre,
    fecha_compromiso: fecha_compromiso || null,
    estatus: 'sin_empezar',
    fecha_inicio: null,
    fecha_fin: null,
    evidencias: '',
    comentarios: []
  };

  act.sub_actividades.push(sub);
  addTraza(act, req.user.id, req.user.full_name, 'sub_creada', `Sub-actividad ${subId}: ${nombre}`);
  write(db);
  res.status(201).json(sub);
});

router.patch('/actividades/:id/sub/:subId', (req, res) => {
  const body = safeBody(req.body);
  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  const sub = (act.sub_actividades || []).find(s => s.id === req.params.subId);
  if (!sub) return res.status(404).json({ error: 'Sub-actividad no encontrada' });

  const cambios = [];
  if (body.nombre !== undefined) { sub.nombre = body.nombre; }
  if (body.descripcion !== undefined) { sub.descripcion = body.descripcion; }
  if (body.estatus && body.estatus !== sub.estatus) {
    if (!VALID_SUB_ESTATUS.includes(body.estatus)) return res.status(400).json({ error: 'Estatus invalido' });
    cambios.push(`${sub.id}: ${sub.estatus} -> ${body.estatus}`);
    sub.estatus = body.estatus;
    if (body.estatus === 'en_proceso' && !sub.fecha_inicio) sub.fecha_inicio = nowMxDate();
    if (body.estatus === 'cerrada' && !sub.fecha_fin) sub.fecha_fin = nowMxDate();
  }
  if (body.fecha_compromiso !== undefined) sub.fecha_compromiso = body.fecha_compromiso || null;
  if (body.fecha_inicio !== undefined) sub.fecha_inicio = body.fecha_inicio || null;
  if (body.fecha_fin !== undefined) sub.fecha_fin = body.fecha_fin || null;
  if (body.evidencias !== undefined) sub.evidencias = body.evidencias;
  if (body.responsable_id) {
    const comprasDb = readCompras();
    const resp = (comprasDb.users || []).find(u => u.id === Number(body.responsable_id));
    if (resp) { sub.responsable_id = resp.id; sub.responsable_nombre = resp.full_name; }
  }

  if (cambios.length > 0) {
    addTraza(act, req.user.id, req.user.full_name, 'sub_editada', cambios.join('. '));
  }
  write(db);
  res.json({ ok: true, sub });
});

router.delete('/actividades/:id/sub/:subId', (req, res) => {
  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  const idx = (act.sub_actividades || []).findIndex(s => s.id === req.params.subId);
  if (idx === -1) return res.status(404).json({ error: 'Sub-actividad no encontrada' });
  const removed = act.sub_actividades.splice(idx, 1)[0];
  addTraza(act, req.user.id, req.user.full_name, 'sub_eliminada', `${removed.id}: ${removed.nombre}`);
  write(db);
  res.json({ ok: true });
});

// ── COMENTARIOS EN SUB-ACTIVIDADES ──────────────────────────────────────────

router.post('/actividades/:id/sub/:subId/comentario', (req, res) => {
  const { texto } = safeBody(req.body);
  if (!texto) return res.status(400).json({ error: 'texto es requerido' });

  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  const sub = (act.sub_actividades || []).find(s => s.id === req.params.subId);
  if (!sub) return res.status(404).json({ error: 'Sub-actividad no encontrada' });

  sub.comentarios = sub.comentarios || [];
  const com = {
    id: sub.comentarios.length + 1,
    fecha: nowMxDate(),
    hora: nowMxTime(),
    usuario_id: req.user.id,
    usuario_nombre: req.user.full_name,
    texto
  };
  sub.comentarios.push(com);
  addTraza(act, req.user.id, req.user.full_name, 'comentario', `${sub.id}: "${texto.slice(0, 60)}"`);
  write(db);
  res.status(201).json(com);
});

// ── CORREO (mailto) ─────────────────────────────────────────────────────────

function buildMailto(act, accion) {
  const urgLabel = { alta: 'ALTA', media: 'MEDIA', baja: 'BAJA' }[act.urgencia] || '';
  const deptoNombre = (DEPARTAMENTOS.find(d => d.id === act.departamento) || {}).nombre || act.departamento;
  const subject = `[CUESTO Planner] ${accion} - ${act.id}: ${act.titulo}`;
  const body = [
    accion === 'Nueva actividad asignada' ? 'Se te ha asignado la siguiente actividad:' : 'Se ha actualizado la siguiente actividad:',
    '',
    `ID: ${act.id}`,
    `Actividad: ${act.titulo}`,
    `Descripcion: ${act.descripcion || 'N/A'}`,
    `Departamento: ${deptoNombre}`,
    `Urgencia: ${urgLabel}`,
    `Estatus: ${act.estatus}`,
    `Avance: ${act.avance}%`,
    `Fecha compromiso: ${act.fecha_compromiso || 'Sin definir'}`,
    `Asignado por: ${act.creado_por_nombre}`,
    '',
    'Accede al sistema para ver detalles:',
    'https://cuestocompras.onrender.com/planner-staff'
  ].join('\n');

  return `mailto:${encodeURIComponent(act.responsable_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

router.get('/actividades/:id/mailto', (req, res) => {
  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  const accion = req.query.accion || 'Nueva actividad asignada';
  const mailto = buildMailto(act, accion);

  addTraza(act, req.user.id, req.user.full_name, 'correo_enviado', `Correo enviado a ${act.responsable_nombre} (${act.responsable_email})`);
  write(db);

  res.json({ mailto, responsable: act.responsable_nombre, email: act.responsable_email });
});

// ── DAILY — formularios por departamento ─────────────────────────────────────

const DAILY_FORMS = {
  smya: ['accidentes', 'condiciones_inseguras', 'epp', 'ptar'],
  rhh: ['ausentismo', 'personal_disponible', 'vacantes_criticas', 'incapacidades', 'horas_extra', 'personal_capacitacion', 'necesidades_personal'],
  produccion: ['piezas_procesadas', 'eficiencias', 'paros_lineas', 'material_pendiente', 'riesgos_incumplimiento'],
  calidad: ['rechazos_internos', 'rechazos_cliente', 'problemas_calidad', 'liberaciones_pendientes', 'reprocesos'],
  mantenimiento: ['paros_falla', 'equipos_fuera', 'disponibilidad', 'correctivos_pendientes', 'preventivo_programado', 'equipos_criticos', 'riesgos_falla'],
  procesos: ['cpk', 'problemas_proceso', 'estudios_pruebas', 'mejoras_implementaciones'],
  compras: ['materias_criticas', 'ordenes_compra', 'refacciones_criticas', 'inventarios_criticos', 'compras_urgentes'],
  sgc: ['no_conformidades', 'documentos_pendientes', 'indicadores_fuera', 'cumplimiento_sgc'],
  operaciones: ['prioridades_dia', 'pedidos_criticos']
};

function formatDlyId(num) {
  return 'DLY-' + String(num).padStart(5, '0');
}

function nextDlyNum(registros) {
  if (!registros.length) return 1;
  const nums = registros.map(r => {
    const m = String(r.id).match(/DLY-(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });
  return Math.max(...nums) + 1;
}

// Resumen: estado de todos los forms de un depto para una fecha
router.get('/daily/:depto/resumen', (req, res) => {
  const { depto } = req.params;
  const forms = DAILY_FORMS[depto];
  if (!forms) return res.status(400).json({ error: 'Departamento invalido' });

  const fecha = req.query.fecha || nowMxDate();
  const db = read();
  const regs = (db.daily_registros || []).filter(r => r.departamento === depto && r.fecha === fecha);

  const formularios = forms.map(f => {
    const reg = regs.find(r => r.formulario === f);
    return {
      id: f,
      llenado: !!reg,
      fecha_llenado: reg ? reg.fecha_llenado : null,
      hora_llenado: reg ? reg.hora_llenado : null,
      llenado_por_nombre: reg ? reg.llenado_por_nombre : null
    };
  });

  res.json({ fecha, departamento: depto, formularios });
});

// Obtener un registro daily especifico
router.get('/daily/:depto/:formulario', (req, res) => {
  const { depto, formulario } = req.params;
  if (!DAILY_FORMS[depto] || !DAILY_FORMS[depto].includes(formulario)) {
    return res.status(400).json({ error: 'Departamento o formulario invalido' });
  }

  const fecha = req.query.fecha || nowMxDate();
  const db = read();
  const reg = (db.daily_registros || []).find(r =>
    r.departamento === depto && r.formulario === formulario && r.fecha === fecha
  );
  res.json({ registro: reg || null, fecha });
});

// Guardar/actualizar registro daily
router.post('/daily/:depto/:formulario', (req, res) => {
  const { depto, formulario } = req.params;
  if (!DAILY_FORMS[depto] || !DAILY_FORMS[depto].includes(formulario)) {
    return res.status(400).json({ error: 'Departamento o formulario invalido' });
  }

  const body = safeBody(req.body);
  const fecha = body.fecha || nowMxDate();
  const datos = body.datos || {};

  const db = read();
  db.daily_registros = db.daily_registros || [];

  const idx = db.daily_registros.findIndex(r =>
    r.departamento === depto && r.formulario === formulario && r.fecha === fecha
  );

  if (idx >= 0) {
    // Actualizar existente
    db.daily_registros[idx].datos = datos;
    db.daily_registros[idx].fecha_llenado = nowMxDate();
    db.daily_registros[idx].hora_llenado = nowMxTime();
    db.daily_registros[idx].llenado_por = req.user.id;
    db.daily_registros[idx].llenado_por_nombre = req.user.full_name;
    write(db);
    res.json({ ok: true, registro: db.daily_registros[idx] });
  } else {
    // Crear nuevo
    const id = formatDlyId(nextDlyNum(db.daily_registros));
    const reg = {
      id,
      departamento: depto,
      formulario,
      fecha,
      llenado_por: req.user.id,
      llenado_por_nombre: req.user.full_name,
      fecha_llenado: nowMxDate(),
      hora_llenado: nowMxTime(),
      datos,
      actividades_creadas: []
    };
    db.daily_registros.push(reg);
    write(db);
    res.status(201).json({ ok: true, registro: reg });
  }
});

// Historial de un formulario
router.get('/daily/:depto/:formulario/historial', (req, res) => {
  const { depto, formulario } = req.params;
  if (!DAILY_FORMS[depto] || !DAILY_FORMS[depto].includes(formulario)) {
    return res.status(400).json({ error: 'Departamento o formulario invalido' });
  }

  const { desde, hasta } = req.query;
  const db = read();
  let regs = (db.daily_registros || []).filter(r =>
    r.departamento === depto && r.formulario === formulario
  );
  if (desde) regs = regs.filter(r => r.fecha >= desde);
  if (hasta) regs = regs.filter(r => r.fecha <= hasta);

  regs.sort((a, b) => b.fecha.localeCompare(a.fecha));
  // Limitar a 90 registros
  res.json(regs.slice(0, 90));
});

// ── CONFIG PTAR ─────────────────────────────────────────────────────────────

router.get('/config/ptar', (req, res) => {
  const db = read();
  res.json(db.config_ptar || { dias_retrolavado: [1, 3, 5] });
});

router.patch('/config/ptar', (req, res) => {
  const body = safeBody(req.body);
  if (!Array.isArray(body.dias_retrolavado)) {
    return res.status(400).json({ error: 'dias_retrolavado debe ser un array de numeros (0-6)' });
  }
  const db = read();
  db.config_ptar = { dias_retrolavado: body.dias_retrolavado.map(Number).filter(n => n >= 0 && n <= 6) };
  write(db);
  res.json({ ok: true, config_ptar: db.config_ptar });
});

// ── PLANTILLA PUESTOS (RHH) ────────────────────────────────────────────────

router.get('/plantilla-puestos', (req, res) => {
  const db = read();
  res.json(db.plantilla_puestos || []);
});

router.post('/plantilla-puestos', (req, res) => {
  const body = safeBody(req.body);
  if (!Array.isArray(body.puestos)) {
    return res.status(400).json({ error: 'puestos debe ser un array' });
  }
  const db = read();
  db.plantilla_puestos = body.puestos.map(p => ({
    puesto_id: p.puesto_id || '',
    puesto_nombre: p.puesto_nombre || '',
    requeridos: Math.max(0, Number(p.requeridos) || 0)
  }));
  write(db);
  res.json({ ok: true, plantilla_puestos: db.plantilla_puestos });
});

router.get('/plantilla-resumen-semanal', (req, res) => {
  const db = read();
  const plantilla = db.plantilla_puestos || [];
  const totalRequeridos = plantilla.reduce((sum, p) => sum + (p.requeridos || 0), 0);
  // Nota: la integracion completa con catalogo RHH se completara en fases posteriores
  res.json({
    plantilla,
    total_requeridos: totalRequeridos,
    mensaje: 'Configurar plantilla de puestos para calcular % de cobertura'
  });
});

// ── DAILY FORMS METADATA ────────────────────────────────────────────────────

router.get('/daily-forms', (req, res) => {
  res.json(DAILY_FORMS);
});

// ── INTEGRACION: datos de otros modulos para daily ──────────────────────────

// KPIs de produccion por linea para una fecha
router.get('/integracion/produccion/kpis', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  const prodDb = readProd();
  const snapshots = prodDb.kpi_snapshots || [];
  const del_dia = snapshots.filter(s => s.fecha === fecha);

  const lineas = ['Baker', 'L1', 'L3', 'L4'];
  const result = {};
  for (const linea of lineas) {
    const snaps = del_dia.filter(s => s.linea === linea);
    if (snaps.length === 0) {
      result[linea] = { eficiencia: null, calidad: null, disponibilidad: null, capacidad: null, rendimiento: null };
    } else {
      // Promediar turnos
      const avg = (field) => {
        const vals = snaps.map(s => s[field]).filter(v => v !== null && v !== undefined);
        return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) : null;
      };
      result[linea] = {
        eficiencia: avg('eficiencia'),
        calidad: avg('calidad'),
        disponibilidad: avg('disponibilidad'),
        capacidad: avg('capacidad'),
        rendimiento: avg('rendimiento'),
        turnos: snaps.length
      };
    }
  }
  res.json({ fecha, kpis: result });
});

// Paros de produccion agrupados por linea
router.get('/integracion/produccion/paros', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  const prodDb = readProd();

  const lineas = [
    { key: 'paros', linea: 'L3' },
    { key: 'paros', linea: 'L4' },
    { key: 'paros_baker', linea: 'Baker' },
    { key: 'paros_l1', linea: 'L1' }
  ];

  const result = {};
  for (const { key, linea } of lineas) {
    const allParos = prodDb[key] || [];
    const del_dia = allParos.filter(p => p.fecha_inicio === fecha);
    result[linea] = {
      total: del_dia.length,
      minutos_total: del_dia.reduce((s, p) => s + (p.duracion_min || 0), 0),
      activos: del_dia.filter(p => p.estado === 'activo').length,
      paros: del_dia.map(p => ({
        id: p.id,
        folio: p.folio,
        motivo: p.motivo,
        sub_motivo: p.sub_motivo,
        hora_inicio: p.hora_inicio,
        hora_fin: p.hora_fin,
        duracion_min: p.duracion_min,
        estado: p.estado,
        ot_folio: p.ot_folio
      }))
    };
  }
  res.json({ fecha, paros: result });
});

// Ordenes de mantenimiento (del dia o dia anterior)
router.get('/integracion/mantenimiento/ordenes', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  const mantDb = readMant();
  const ordenes = mantDb.ordenes_mantenimiento || [];
  const comprasDb = readCompras();
  const users = comprasDb.users || [];
  const equipos = mantDb.equipos_mant || [];

  const del_dia = ordenes.filter(o => o.fecha_solicitud === fecha);

  const enriched = del_dia.map(o => {
    const equipo = equipos.find(e => e.id === o.equipo_id);
    const tecnico = users.find(u => u.id === o.tecnico_asignado_id);
    return {
      id: o.id,
      folio: o.folio,
      tipo: o.tipo,
      status: o.status,
      equipo_nombre: equipo ? equipo.nombre : (o.equipo_custom || 'N/A'),
      equipo_codigo: equipo ? equipo.codigo : '',
      descripcion_falla: o.descripcion_falla,
      nivel_urgencia: o.nivel_urgencia,
      maquina_parada: o.maquina_parada,
      tecnico_nombre: tecnico ? tecnico.full_name : 'Sin asignar',
      solicitante_nombre: o.solicitante_nombre,
      fecha_solicitud: o.fecha_solicitud,
      hora_solicitud: o.hora_solicitud,
      fecha_cierre: o.fecha_cierre,
      hora_cierre: o.hora_cierre
    };
  });

  // Tambien incluir pendientes (abiertas/asignadas/en_proceso)
  const pendientes = ordenes.filter(o =>
    ['abierta', 'asignada', 'en_proceso'].includes(o.status)
  ).length;

  res.json({ fecha, ordenes: enriched, total_dia: enriched.length, pendientes_globales: pendientes });
});

// Inventarios criticos: items fuera de min/max
router.get('/integracion/inventarios/criticos', (req, res) => {
  const invDb = readInv();
  const itemsConfig = invDb.inv_items_config || [];
  const conteos = invDb.inv_conteos || [];
  const conteoItems = invDb.inv_conteo_items || [];

  // Ultimo conteo por tipo
  const ultimoConteoPorTipo = {};
  conteos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  for (const c of conteos) {
    if (!ultimoConteoPorTipo[c.inv_type]) ultimoConteoPorTipo[c.inv_type] = c;
  }

  const result = [];
  for (const item of itemsConfig) {
    if (item.activo === false) continue;
    const ultimoConteo = ultimoConteoPorTipo[item.inv_type];
    let stock = null;
    if (ultimoConteo) {
      const ci = conteoItems.find(x => x.conteo_id === ultimoConteo.id && x.item_key === item.item_key);
      if (ci) stock = ci.cantidad !== undefined ? ci.cantidad : ci.kg;
    }
    const fueraMin = stock !== null && item.min_val != null && stock < item.min_val;
    const fueraMax = stock !== null && item.max_val != null && stock > item.max_val;
    if (fueraMin || fueraMax || stock === null) {
      result.push({
        item_key: item.item_key,
        nombre: item.item_label,
        inv_type: item.inv_type,
        min: item.min_val,
        max: item.max_val,
        stock,
        unidad: item.unidad || 'pz',
        fuera_min: fueraMin,
        fuera_max: fueraMax,
        sin_conteo: stock === null
      });
    }
  }
  res.json({ items: result, total: result.length });
});

// Compras: resumen de items por estatus
router.get('/integracion/compras/resumen', (req, res) => {
  const comprasDb = readCompras();
  const reqItems = comprasDb.requisition_items || [];
  const pos = comprasDb.purchase_orders || [];
  const suppliers = comprasDb.suppliers || [];

  const statusGroups = {};
  for (const ri of reqItems) {
    const st = ri.status || 'Sin estado';
    if (!statusGroups[st]) statusGroups[st] = { count: 0, total_mxn: 0, items: [] };
    statusGroups[st].count++;
    statusGroups[st].total_mxn += (ri.unit_cost || 0) * (ri.quantity || 0);
    if (statusGroups[st].items.length < 20) {
      const po = ri.purchase_order_id ? pos.find(p => p.id === ri.purchase_order_id) : null;
      statusGroups[st].items.push({
        id: ri.id,
        descripcion: ri.manual_item_name || `Item #${ri.id}`,
        cantidad: ri.quantity,
        unidad: ri.unit || 'pz',
        costo_unit: ri.unit_cost,
        moneda: ri.currency || 'MXN',
        po_folio: po ? po.folio : null,
        po_status: po ? po.status : null,
        proveedor: ri.supplier_id ? (suppliers.find(s => s.id === ri.supplier_id) || {}).business_name : null
      });
    }
  }

  // POs urgentes/atrasadas
  const urgentes = pos.filter(p => ['Enviada', 'Aceptada', 'En proceso'].includes(p.status));

  res.json({
    por_estatus: statusGroups,
    total_items: reqItems.length,
    pos_activas: urgentes.length,
    pos_total: pos.length
  });
});

// CPK: ultimas titulaciones con estado
router.get('/integracion/vales/cpk', (req, res) => {
  const valesDb = readVales();
  const headers = valesDb.titulaciones_header || [];
  const detalles = valesDb.titulaciones_detalle || [];
  const params = valesDb.parametros_titulacion || [];

  // Ultimas 4 titulaciones por linea
  const lineas = ['Baker', 'L1', 'L3', 'L4'];
  const result = {};
  for (const linea of lineas) {
    const lineaHeaders = headers.filter(h => h.linea === linea).sort((a, b) => {
      const da = (b.fecha || '') + (b.numero_titulacion || '');
      const db2 = (a.fecha || '') + (a.numero_titulacion || '');
      return da.localeCompare(db2);
    }).slice(0, 4);

    result[linea] = lineaHeaders.map(h => {
      const dets = detalles.filter(d => d.header_id === h.id);
      const fuera = dets.filter(d => d.estado_param === 'fuera' || d.estado_param === 'limite').length;
      const total = dets.length;
      return {
        id: h.id,
        fecha: h.fecha,
        turno: h.turno,
        numero: h.numero_titulacion,
        estado: h.estado,
        parametros_total: total,
        parametros_fuera: fuera,
        analista: h.analista
      };
    });
  }
  res.json({ titulaciones: result });
});

// ── KPIs rapidos ─────────────────────────────────────────────────────────────

router.get('/kpis', (req, res) => {
  const db = read();
  const acts = db.actividades || [];
  const { depto } = req.query;
  const filtered = depto ? acts.filter(a => a.departamento === depto) : acts;

  const kpis = {
    total: filtered.length,
    sin_empezar: filtered.filter(a => a.estatus === 'sin_empezar').length,
    en_proceso: filtered.filter(a => a.estatus === 'en_proceso').length,
    cerrada: filtered.filter(a => a.estatus === 'cerrada').length,
    atrasada: filtered.filter(a => a.estatus === 'atrasada').length,
    pospuesta: filtered.filter(a => a.estatus === 'pospuesta').length,
    cancelada: filtered.filter(a => a.estatus === 'cancelada').length
  };
  res.json(kpis);
});

module.exports = router;
