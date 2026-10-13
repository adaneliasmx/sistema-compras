const express = require('express');
const { read, write, DEPARTAMENTOS } = require('../db-planner');
const { read: readCompras } = require('../db');
const { read: readProd } = require('../db-produccion');
const prodRouter = require('./produccion');
const { read: readMant } = require('../db-mantenimiento');
const { read: readInv } = require('../db-inventarios');
const { read: readVales } = require('../db-vales');
const { read: readRhh } = require('../db-rhh');
const { read: readFlujo } = require('../db-flujo');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
const rules = require('../planner-rules');

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
// Validate before any handler changes cached objects.
router.use((req, res, next) => {
  for (const key of ['fecha', 'desde', 'hasta']) {
    if (req.query[key] && !rules.validDate(req.query[key])) return res.status(400).json({ error: 'Fecha invalida: ' + key });
  }
  if (req.query.desde && req.query.hasta && req.query.desde > req.query.hasta) return res.status(400).json({ error: 'Rango de fechas invertido' });
  if (req.path.startsWith('/integracion/') && req.path.endsWith('/cpk') && !!req.query.desde !== !!req.query.hasta) return res.status(400).json({ error: 'Indica desde y hasta' });
  if (['POST', 'PATCH'].includes(req.method) && req.path.startsWith('/actividades')) {
    const b = req.body || {};
    const err = rules.assignmentError(b, read(), readCompras());
    if (err) return res.status(400).json({ error: err });
    for (const field of ['fecha_compromiso', 'fecha_inicio', 'fecha_fin', 'fecha_reclamo']) {
      if (b[field] && !rules.validDate(b[field])) return res.status(400).json({ error: 'Fecha invalida: ' + field });
    }
    if (b.estatus && !(req.path.includes('/sub/') ? VALID_SUB_ESTATUS : VALID_ESTATUS).includes(b.estatus)) return res.status(400).json({ error: 'Estatus invalido' });
    if (b.urgencia && !VALID_URGENCIA.includes(b.urgencia)) return res.status(400).json({ error: 'Urgencia invalida' });
  }
  next();
});

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
  if (req.query.todos && req.plannerUser.planner_role !== 'admin') return res.status(403).json({ error: 'Solo admin puede consultar usuarios sin acceso' });
  const usuarios = req.query.todos ? (readCompras().users || []).filter(u => u.active !== false && u.role_code !== 'proveedor') : rules.eligibleUsers(read(), readCompras());
  res.json(usuarios.map(u => ({ id: u.id, nombre: u.full_name, email: u.email, role: u.role_code })));
});

// Asignar/revocar acceso planner (solo admin planner)
router.patch('/staff/asignar', plannerAdmin, (req, res) => {
  const { usuario_id, planner_role, departamentos } = safeBody(req.body);
  if (!usuario_id) return res.status(400).json({ error: 'usuario_id requerido' });
  if (planner_role && !['admin', 'staff'].includes(planner_role)) {
    return res.status(400).json({ error: 'planner_role invalido. Use: admin, staff o null' });
  }
  if (departamentos && !Array.isArray(departamentos)) {
    return res.status(400).json({ error: 'departamentos debe ser un array' });
  }

  const comprasDb = readCompras();
  const user = (comprasDb.users || []).find(u => u.id === Number(usuario_id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const db = read();
  db.asignaciones = db.asignaciones || [];
  const idx = db.asignaciones.findIndex(a => a.usuario_id === user.id);

  if (!planner_role) {
    if (idx !== -1) db.asignaciones.splice(idx, 1);
    write(db);
    return res.json({ ok: true, accion: 'revocado' });
  }

  const validDeptos = (departamentos || []).filter(d => DEPARTAMENTOS.find(dp => dp.id === d));
  if (idx !== -1) {
    db.asignaciones[idx].planner_role = planner_role;
    db.asignaciones[idx].departamentos = validDeptos;
    db.asignaciones[idx].nombre = user.full_name;
    db.asignaciones[idx].email = user.email;
  } else {
    db.asignaciones.push({
      usuario_id: user.id,
      nombre: user.full_name,
      email: user.email,
      planner_role,
      departamentos: validDeptos
    });
  }

  write(db);
  res.json({ ok: true, accion: 'asignado', planner_role, departamentos: validDeptos });
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
  const hoy = nowMxDate();
  let list = (db.actividades || []).map(a => rules.activityView(a, hoy));

  const { depto, estatus, urgencia, responsable, buscar, desde, hasta, mis, creadas_por } = req.query;
  if (depto) list = list.filter(a => a.departamento === depto);
  if (estatus) list = list.filter(a => a.estatus === estatus);
  if (urgencia) list = list.filter(a => a.urgencia === urgencia);
  if (responsable) list = list.filter(a => a.responsable_id === Number(responsable));
  // "Mis tareas": tareas donde soy responsable O tengo sub-actividades asignadas
  if (mis) {
    const uid = Number(mis);
    list = list.filter(a =>
      a.responsable_id === uid ||
      (a.sub_actividades || []).some(s => s.responsable_id === uid) || (a.colaboradores || []).some(c => c.id === uid)
    );
  }
  if (creadas_por) list = list.filter(a => a.creado_por === Number(creadas_por));
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
    creado_por: a.creado_por,
    correlacion_daily: a.correlacion_daily || null,
    correlacion_compras: a.correlacion_compras || null,
    origen_formulario: rules.formOf(a),
    colaboradores: a.colaboradores || [],
    comentarios_count: (a.comentarios || []).length,
    mis_subactividades: (a.sub_actividades || []).filter(s => s.responsable_id === req.user.id).map(s => ({ id: s.id, nombre: s.nombre, estatus: s.estatus, fecha_compromiso: s.fecha_compromiso, responsable_nombre: s.responsable_nombre })),
    sub_count: (a.sub_actividades || []).length,
    sub_responsables: (a.sub_actividades || []).filter(s => s.responsable_id).map(s => ({ id: s.responsable_id, nombre: s.responsable_nombre, sub_id: s.id })),
    traza_count: (a.trazabilidad || []).length
  })));
});

router.post('/actividades', (req, res) => {
  const body = safeBody(req.body);
  const { titulo, descripcion, responsable_id, departamento, fecha_compromiso, urgencia, correlacion_daily, correlacion_compras, origen_formulario } = body;

  if (!titulo || !departamento) {
    return res.status(400).json({ error: 'titulo y departamento son requeridos' });
  }
  if (!DEPARTAMENTOS.find(d => d.id === departamento)) {
    return res.status(400).json({ error: 'Departamento invalido' });
  }
  if (urgencia && !VALID_URGENCIA.includes(urgencia)) {
    return res.status(400).json({ error: 'Urgencia invalida. Use: alta, media, baja' });
  }

  // Buscar responsable (si no se proporciona, usar el creador)
  const comprasDb = readCompras();
  const effectiveRespId = responsable_id ? Number(responsable_id) : req.user.id;
  const responsable = (comprasDb.users || []).find(u => u.id === effectiveRespId);
  if (!responsable) return res.status(400).json({ error: 'Responsable no encontrado' });

  const db = read();
  const id = formatActId(nextActNum((db.actividades || []).concat(db.actividades_eliminadas || [])));

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
    origen_formulario: correlacion_daily?.formulario || origen_formulario || null,
    creado_por: req.user.id,
    creado_por_nombre: req.user.full_name,
    fecha_creacion: nowMxDate(),
    hora_creacion: nowMxTime(),
    colaboradores: [],
    comentarios: [],
    sub_actividades: [],
    trazabilidad: []
  };

  // Colaboradores (array de user IDs)
  if (Array.isArray(body.colaboradores)) {
    const compUsers = comprasDb.users || [];
    actividad.colaboradores = body.colaboradores.slice(0, 10).map(uid => {
      const u = compUsers.find(x => x.id === Number(uid));
      return u ? { id: u.id, nombre: u.full_name } : null;
    }).filter(Boolean);
  }

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
  res.json(rules.activityView(act, nowMxDate()));
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
    if (body.estatus === 'cerrada') { act.fecha_fin = act.fecha_fin || nowMxDate(); act.avance = 100; }
    else if (prevEstatus === 'cerrada') act.fecha_fin = null;
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
  if (body.fecha_inicio !== undefined && body.fecha_inicio !== act.fecha_inicio) {
    cambios.push(`Fecha inicio: ${act.fecha_inicio || 'N/A'} -> ${body.fecha_inicio || 'N/A'}`);
    act.fecha_inicio = body.fecha_inicio || null;
  }
  if (body.fecha_fin !== undefined && body.fecha_fin !== act.fecha_fin) {
    cambios.push(`Fecha fin: ${act.fecha_fin || 'N/A'} -> ${body.fecha_fin || 'N/A'}`);
    act.fecha_fin = body.fecha_fin || null;
  }
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
  if (Array.isArray(body.colaboradores)) {
    const comprasDb = readCompras();
    const compUsers = comprasDb.users || [];
    act.colaboradores = body.colaboradores.slice(0, 10).map(uid => {
      const u = compUsers.find(x => x.id === Number(uid));
      return u ? { id: u.id, nombre: u.full_name } : null;
    }).filter(Boolean);
    cambios.push(`Colaboradores: ${act.colaboradores.map(c => c.nombre).join(', ') || 'ninguno'}`);
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
  addTraza(removed, req.user.id, req.user.full_name, 'eliminada', 'Actividad eliminada');
  removed.eliminada_por = req.user.full_name;
  removed.fecha_eliminacion = nowMxDate();
  db.actividades_eliminadas = db.actividades_eliminadas || [];
  db.actividades_eliminadas.push(removed);
  write(db);
  res.json({ ok: true, id: removed.id });
});

// ── 8D CREATION ─────────────────────────────────────────────────────────────

const SUB_8D = [
  { nombre: 'Contencion', dias: 1 },
  { nombre: 'Identificacion Causa Raiz', dias: 7 },
  { nombre: 'Implementar Accion Correctiva/Deteccion', dias: 14 },
  { nombre: 'Validacion de Acciones Correctivas', dias: 34 },
  { nombre: 'AMEF/PC Actualizados Actualizacion de Trabajo Estandar. Ingreso a LPA.', dias: 35 },
  { nombre: 'Lecciones Aprendidas', dias: 40 }
];

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Editar campos 8D (cliente, componente, problema, fecha_reclamo)
router.patch('/actividades/:id/8d', plannerAdmin, (req, res) => {
  const body = safeBody(req.body);
  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });
  if (act.origen_formulario !== '8d') return res.status(400).json({ error: 'Esta actividad no es un 8D' });

  // Parse current 8D fields from descripcion
  const descMatch = (act.descripcion || '').match(/Cliente: (.+?) \| Componente: (.+?) \| Problema: (.+?) \| Fecha reclamo: (.+)/);
  const prev = {
    cliente: descMatch ? descMatch[1] : '',
    componente: descMatch ? descMatch[2] : '',
    problema: descMatch ? descMatch[3] : '',
    fecha_reclamo: descMatch ? descMatch[4] : ''
  };

  const cambios = [];
  const cliente = body.cliente !== undefined ? body.cliente : prev.cliente;
  const componente = body.componente !== undefined ? body.componente : prev.componente;
  const problema = body.problema !== undefined ? body.problema : prev.problema;
  const fecha_reclamo = body.fecha_reclamo !== undefined ? body.fecha_reclamo : prev.fecha_reclamo;

  if (body.cliente !== undefined && body.cliente !== prev.cliente) cambios.push(`Cliente: "${prev.cliente}" -> "${body.cliente}"`);
  if (body.componente !== undefined && body.componente !== prev.componente) cambios.push(`Componente: "${prev.componente}" -> "${body.componente}"`);
  if (body.problema !== undefined && body.problema !== prev.problema) cambios.push(`Problema: "${prev.problema}" -> "${body.problema}"`);
  if (body.fecha_reclamo !== undefined && body.fecha_reclamo !== prev.fecha_reclamo) cambios.push(`Fecha reclamo: ${prev.fecha_reclamo} -> ${body.fecha_reclamo}`);

  if (cambios.length === 0) return res.json(act);

  // Update titulo and descripcion
  act.titulo = `"${problema}" de ${cliente} en componente ${componente}`;
  act.descripcion = `8D — Cliente: ${cliente} | Componente: ${componente} | Problema: ${problema} | Fecha reclamo: ${fecha_reclamo}`;

  // Recalculate main fecha_compromiso and sub dates if fecha_reclamo changed
  if (body.fecha_reclamo !== undefined && body.fecha_reclamo !== prev.fecha_reclamo) {
    act.fecha_compromiso = addDays(fecha_reclamo, 40);
    const subDias = [1, 7, 14, 34, 35, 40];
    (act.sub_actividades || []).forEach((sub, i) => {
      if (i < subDias.length) sub.fecha_compromiso = addDays(fecha_reclamo, subDias[i]);
    });
    cambios.push('Fechas de sub-actividades recalculadas');
  }

  addTraza(act, req.user.id, req.user.full_name, '8d_editada', cambios.join('; '));
  write(db);
  res.json(act);
});

router.post('/actividades/8d', (req, res) => {
  const body = safeBody(req.body);
  const { cliente, componente, problema, fecha_reclamo, responsable_id } = body;

  if (!cliente || !componente || !problema || !fecha_reclamo) {
    return res.status(400).json({ error: 'cliente, componente, problema y fecha_reclamo son requeridos' });
  }

  const titulo = `"${problema}" de ${cliente} en componente ${componente}`;
  const fecha_compromiso = addDays(fecha_reclamo, 40);

  const comprasDb = readCompras();
  const effectiveRespId = responsable_id ? Number(responsable_id) : req.user.id;
  const responsable = (comprasDb.users || []).find(u => u.id === effectiveRespId);
  if (!responsable) return res.status(400).json({ error: 'Responsable no encontrado' });

  const db = read();
  const id = formatActId(nextActNum((db.actividades || []).concat(db.actividades_eliminadas || [])));

  const actividad = {
    id,
    titulo,
    descripcion: `8D — Cliente: ${cliente} | Componente: ${componente} | Problema: ${problema} | Fecha reclamo: ${fecha_reclamo}`,
    responsable_id: responsable.id,
    responsable_nombre: responsable.full_name,
    responsable_email: responsable.email || '',
    departamento: 'sgc',
    fecha_compromiso,
    urgencia: 'alta',
    estatus: 'sin_empezar',
    avance: 0,
    fecha_inicio: null,
    fecha_fin: null,
    correlacion_daily: { departamento: 'sgc', formulario: '8ds_abiertos', fecha: fecha_reclamo },
    correlacion_compras: null,
    origen_formulario: '8d',
    creado_por: req.user.id,
    creado_por_nombre: req.user.full_name,
    fecha_creacion: nowMxDate(),
    hora_creacion: nowMxTime(),
    sub_actividades: [],
    trazabilidad: []
  };

  // Crear sub-actividades 8D
  for (const step of SUB_8D) {
    const subId = formatSubId(nextSubNum(actividad.sub_actividades));
    actividad.sub_actividades.push({
      id: subId,
      nombre: step.nombre,
      descripcion: '',
      responsable_id: responsable.id,
      responsable_nombre: responsable.full_name,
      fecha_compromiso: addDays(fecha_reclamo, step.dias),
      estatus: 'sin_empezar',
      fecha_inicio: null,
      fecha_fin: null,
      evidencias: '',
      comentarios: []
    });
  }

  addTraza(actividad, req.user.id, req.user.full_name, 'creada', `8D creada: ${titulo}`);

  db.actividades = db.actividades || [];
  db.actividades.push(actividad);
  write(db);

  res.status(201).json(actividad);
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

  const beforeSub = JSON.stringify(sub);
  const cambios = [];
  if (body.nombre !== undefined) { sub.nombre = body.nombre; }
  if (body.descripcion !== undefined) { sub.descripcion = body.descripcion; }
  if (body.estatus && body.estatus !== sub.estatus) {
    if (!VALID_SUB_ESTATUS.includes(body.estatus)) return res.status(400).json({ error: 'Estatus invalido' });
    cambios.push(`${sub.id}: ${sub.estatus} -> ${body.estatus}`);
    sub.estatus = body.estatus;
    if (body.estatus === 'en_proceso' && !sub.fecha_inicio) sub.fecha_inicio = nowMxDate();
    if (body.estatus === 'cerrada' && !sub.fecha_fin) sub.fecha_fin = nowMxDate();
    else if (body.estatus !== 'cerrada') sub.fecha_fin = null;
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

  if (JSON.stringify(sub) !== beforeSub) {
    addTraza(act, req.user.id, req.user.full_name, 'sub_editada', cambios.join('. ') || sub.id + ': responsable, fechas, descripcion o evidencia actualizados');
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

// ── COMENTARIOS EN ACTIVIDAD PRINCIPAL ──────────────────────────────────────
router.post('/actividades/:id/comentario', (req, res) => {
  const { texto } = safeBody(req.body);
  if (!texto) return res.status(400).json({ error: 'texto es requerido' });

  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  act.comentarios = act.comentarios || [];
  const com = {
    id: act.comentarios.length + 1,
    fecha: nowMxDate(),
    hora: nowMxTime(),
    usuario_id: req.user.id,
    usuario_nombre: req.user.full_name,
    texto
  };
  act.comentarios.push(com);
  addTraza(act, req.user.id, req.user.full_name, 'comentario', `"${texto.slice(0, 60)}"`);
  write(db);
  res.status(201).json({ ...com, mailto: rules.mentionMail(texto, act, rules.eligibleUsers(db, readCompras())) });
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
  res.status(201).json({ ...com, mailto: rules.mentionMail(texto, act, rules.eligibleUsers(db, readCompras())) });
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
    (process.env.APP_URL || 'https://www.erp-cuesto.com') + (process.env.OPAQUE_ROUTES ? '/m/p4s6j8/planner-staff' : '/planner-staff')
  ].join('\n');

  return `mailto:${encodeURIComponent(act.responsable_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

router.get('/actividades/:id/mailto', (req, res) => {
  const db = read();
  const act = (db.actividades || []).find(a => a.id === req.params.id);
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });

  const accion = req.query.accion || 'Nueva actividad asignada';
  const mailto = buildMailto(act, accion);

  addTraza(act, req.user.id, req.user.full_name, 'correo_preparado', `Correo preparado para ${act.responsable_nombre} (${act.responsable_email})`);
  write(db);

  res.json({ mailto, responsable: act.responsable_nombre, email: act.responsable_email });
});

// ── DAILY — formularios por departamento ─────────────────────────────────────

const DAILY_FORMS = {
  smya: ['accidentes', 'condiciones_inseguras', 'epp', 'ptar', 'scrap'],
  rhh: ['ausentismo', 'personal_disponible', 'vacantes_criticas', 'incapacidades', 'horas_extra', 'personal_capacitacion', 'necesidades_personal'],
  produccion: ['piezas_procesadas', 'eficiencias', 'paros_lineas', 'material_pendiente', 'riesgos_incumplimiento'],
  calidad: ['rechazos_internos', 'rechazos_cliente', 'problemas_calidad', 'liberaciones_pendientes', 'reprocesos'],
  mantenimiento: ['paros_falla', 'equipos_fuera', 'disponibilidad', 'correctivos_pendientes', 'preventivo_programado', 'equipos_criticos', 'riesgos_falla'],
  procesos: ['cpk', 'problemas_proceso', 'estudios_pruebas', 'mejoras_implementaciones'],
  compras: ['materias_criticas', 'ordenes_compra', 'refacciones_criticas', 'inventarios_criticos', 'compras_urgentes'],
  sgc: ['no_conformidades', '8ds_abiertos', 'documentos_pendientes', 'indicadores_fuera', 'cumplimiento_sgc'],
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
  res.json({ registro: reg || null, fecha, datos_sugeridos: !reg ? rules.dailySuggestions(db.daily_registros || [], depto, formulario, fecha) : null });
});

// Guardar/actualizar registro daily
router.post('/daily/:depto/:formulario', (req, res) => {
  const { depto, formulario } = req.params;
  if (!DAILY_FORMS[depto]?.includes(formulario)) return res.status(400).json({ error: 'Departamento o formulario invalido' });
  const body = safeBody(req.body);
  const fecha = body.fecha || nowMxDate();
  if (!rules.validDate(fecha)) return res.status(400).json({ error: 'Fecha invalida' });
  if (!body.datos || typeof body.datos !== 'object' || Array.isArray(body.datos)) return res.status(400).json({ error: 'Datos invalidos' });
  const db = read();
  db.daily_registros ||= [];
  const reg = db.daily_registros.find(r => r.departamento === depto && r.formulario === formulario && r.fecha === fecha);
  if (body.version !== undefined && Number(body.version) !== Number(reg?.version || 0)) return res.status(409).json({ error: 'Otra persona modifico este formulario. Recarga antes de guardar.' });
  const datos = rules.clone(body.datos);
  const openLinked = (db.actividades || []).filter(a => a.departamento === depto && rules.formOf(a) === formulario && !['cerrada', 'cancelada'].includes(a.estatus));
  if (datos.sin_novedad && openLinked.length) { datos.sin_novedad = false; datos.estado_revision = 'revisado_con_pendientes'; }
  else datos.estado_revision = datos.sin_novedad ? 'sin_incidencias' : 'revisado';
  if (formulario === 'ptar' && datos.cantidad_lodos_kg != null && (typeof datos.cantidad_lodos_kg !== 'number' || !Number.isFinite(datos.cantidad_lodos_kg) || datos.cantidad_lodos_kg < 0)) {
    return res.status(400).json({ error: 'La cantidad de lodos debe ser un número no negativo en kg' });
  }
  if (formulario === 'scrap' && datos.cantidad_piezas != null && (typeof datos.cantidad_piezas !== 'number' || !Number.isSafeInteger(datos.cantidad_piezas) || datos.cantidad_piezas < 0)) {
    return res.status(400).json({ error: 'El scrap debe ser una cantidad entera no negativa de piezas' });
  }
  if (formulario === 'ptar' && datos.retrolavado?.aplica) {
    const retro = datos.retrolavado;
    if (retro.realizado && !retro.evidencia_url?.trim()) return res.status(400).json({ error: 'Agrega la URL de evidencia del retrolavado' });
    if (!retro.realizado && (!retro.razones?.trim() || !retro.plan_accion?.trim())) return res.status(400).json({ error: 'Indica razones y plan de accion del retrolavado pendiente' });
  }
  if (formulario === 'piezas_procesadas' && datos.clientes) {
    for (const cliente of rules.CLIENTES) for (const campo of ['procesadas', 'objetivo']) {
      const value = datos.clientes[cliente]?.[campo];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value))) return res.status(400).json({ error: cliente + ': las piezas deben ser enteros no negativos' });
    }
  }
  if (formulario === 'rechazos_internos') {
    for (const l of rules.LINEAS) if (datos[l]?.procesadas != null && Number(datos[l].rechazadas) > Number(datos[l].procesadas)) return res.status(400).json({ error: l + ': rechazadas no puede superar procesadas' });
  }
  if (formulario === 'reprocesos') {
    const detalle = rules.reprocesos(db.daily_registros, fecha);
    datos.detalle = detalle;
    for (const l of rules.LINEAS) datos[l] = detalle[l].porcentaje;
  }
  // Equipment keys persist in the Daily: saving twice updates the same task.
  const linkedIds = [];
  if (depto === 'mantenimiento' && formulario === 'equipos_fuera' && !datos.sin_novedad) {
    for (const eq of datos.equipos || []) {
      if (!eq.nombre?.trim()) continue;
      const key = [eq.nombre.trim().toLowerCase(), (eq.area || '').trim().toLowerCase(), eq.fecha_inhabilitado || fecha].join('|');
      let act = (db.actividades || []).find(a => a.equipo_clave === key);
      if (!act) {
        db.actividades ||= [];
        act = { id: formatActId(nextActNum(db.actividades.concat(db.actividades_eliminadas || []))), titulo: 'Recuperar equipo: ' + eq.nombre, descripcion: eq.diagnostico || '', departamento: depto,
          responsable_id: req.user.id, responsable_nombre: req.user.full_name, responsable_email: req.user.email || '', urgencia: 'alta', estatus: 'sin_empezar', avance: 0,
          fecha_compromiso: null, fecha_inicio: null, fecha_fin: null, fecha_creacion: nowMxDate(), hora_creacion: nowMxTime(), creado_por: req.user.id, creado_por_nombre: req.user.full_name,
          correlacion_daily: { departamento: depto, formulario, fecha }, origen_formulario: formulario, equipo_clave: key, colaboradores: [], comentarios: [], sub_actividades: [], trazabilidad: [] };
        addTraza(act, req.user.id, req.user.full_name, 'creada', 'Creada automaticamente desde equipo fuera de operacion');
        db.actividades.push(act);
      }
      eq.actividad_id = act.id;
      linkedIds.push(act.id);
    }
  }
  const target = reg || { id: formatDlyId(nextDlyNum(db.daily_registros)), departamento: depto, formulario, fecha, revisiones: [] };
  if (reg) { target.revisiones ||= []; target.revisiones.push(rules.revision(reg)); }
  Object.assign(target, { datos, version: Number(target.version || 0) + 1, fecha_llenado: nowMxDate(), hora_llenado: nowMxTime(), llenado_por: req.user.id, llenado_por_nombre: req.user.full_name, actividades_creadas: [...new Set([...(target.actividades_creadas || []), ...linkedIds])] });
  if (!reg) db.daily_registros.push(target);
  if (depto === 'rhh' && formulario === 'personal_disponible') {
    db.plantilla_historico ||= [];
    db.plantilla_historico.push({ fecha, fecha_captura: nowMxDate(), version: target.version, usuario_id: req.user.id, datos: rules.clone(datos) });
  }
  write(db);
  res.status(reg ? 200 : 201).json({ ok: true, registro: target });
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
  if (!(req.plannerUser.departamentos || []).includes('smya')) return res.status(403).json({ error: 'Solo usuarios asignados a SMYA pueden configurar PTAR' });
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

// KPIs de produccion por linea — calculo live (misma logica que pizarron produccion)
router.get('/integracion/produccion/kpis', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  const data = prodRouter._getDailyKpis(fecha);
  // Convertir decimales (0-1) a porcentaje entero para el frontend
  const kpis = {};
  for (const [linea, vals] of Object.entries(data.kpis)) {
    kpis[linea] = {
      eficiencia: vals.eficiencia != null ? Math.round(vals.eficiencia * 100) : null,
      calidad: vals.calidad != null ? Math.round(vals.calidad * 100) : null,
      disponibilidad: vals.disponibilidad != null ? Math.round(vals.disponibilidad * 100) : null,
      capacidad: vals.capacidad != null ? Math.round(vals.capacidad * 100) : null,
      rendimiento: vals.rendimiento != null ? Math.round(vals.rendimiento * 100) : null
    };
  }
  res.json({ fecha: data.fecha, kpis, objetivos: prodRouter._getPlannerObjectives(), piezas: data.piezas || {} });
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
    // L3 y L4 comparten paros; Baker y L1 tienen arreglos propios.
    const del_dia = allParos.filter(p =>
      p.fecha_inicio === fecha && (key !== 'paros' || p.linea === linea)
    );
    result[linea] = {
      total: del_dia.length,
      minutos_total: del_dia.reduce((s, p) => s + (p.duracion_min || 0), 0),
      por_turno: Object.entries(del_dia.reduce((acc, p) => { const t = p.turno || 'Sin turno'; acc[t] = (acc[t] || 0) + (Number(p.duracion_min) || 0); return acc; }, {})).map(([turno, minutos]) => ({ turno, minutos })),
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
        ot_folio: p.ot_folio,
        turno: p.turno || 'Sin turno'
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
  res.json(rules.purchasesAttention(readCompras(), nowMxDate()));
});

// RHH: Ausentismo del dia (incidencias, excluyendo "labora")
// Fuentes: rhh_attendance (captura diaria: campos fecha/incidencia_type)
//          rhh_incidences (incidencias aprobadas/pendientes que cubren la fecha)
router.get('/integracion/rhh/ausentismo', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  const rhhDb = readRhh();
  const employees = rhhDb.rhh_employees || [];
  const positions = rhhDb.rhh_positions || [];
  const seen = new Set(); // evitar duplicados por employee_id

  // Normalizar incidencia_type del modulo asistencia al formato del frontend
  const TIPO_MAP = {
    falta: 'falta', retardo: 'retardo', vacacion: 'vacaciones',
    incapacidad: 'incapacidad', permiso_cg: 'permiso_con_goce',
    permiso_sg: 'permiso_sin_goce', baja: 'falta',
    paro_tecnico: 'permiso', descanso: 'permiso',
    festivo: 'festivo', turno_incompleto: 'retardo'
  };

  const result = [];

  // 1) rhh_attendance — captura diaria (campo "fecha" + "incidencia_type")
  const attendance = rhhDb.rhh_attendance || [];
  for (const a of attendance) {
    const d = a.fecha || a.date;
    const tipo = a.incidencia_type || a.status;
    if (d !== fecha) continue;
    seen.add(Number(a.employee_id));
    if (tipo === 'labora') continue;
    const emp = employees.find(e => e.id === Number(a.employee_id));
    const mapped = TIPO_MAP[tipo] || tipo;
    const pos = emp ? positions.find(p => p.id === emp.position_id) : null;
    result.push({
      employee_id: Number(a.employee_id),
      nombre: emp ? emp.full_name : `Emp #${a.employee_id}`,
      puesto: emp ? emp.position_id : null,
      puesto_nombre: pos ? pos.name : '',
      status: mapped,
      notes: a.notas || a.notes || ''
    });
  }

  // 2) rhh_incidences — incidencias (aprobadas/pendientes) que cubren la fecha
  const incidences = rhhDb.rhh_incidences || [];
  for (const inc of incidences) {
    if (inc.status === 'rechazada') continue;
    const start = inc.date;
    const end = inc.date_end || inc.date;
    if (!start || fecha < start || fecha > end) continue;
    if (seen.has(Number(inc.employee_id))) continue;
    seen.add(Number(inc.employee_id));
    const emp = employees.find(e => e.id === Number(inc.employee_id));
    const mapped = TIPO_MAP[inc.type] || inc.type;
    const pos = emp ? positions.find(p => p.id === emp.position_id) : null;
    result.push({
      employee_id: Number(inc.employee_id),
      nombre: emp ? emp.full_name : `Emp #${inc.employee_id}`,
      puesto: emp ? emp.position_id : null,
      puesto_nombre: pos ? pos.name : '',
      status: mapped,
      notes: inc.notes || ''
    });
  }

  for (const emp of employees.filter(e => e.status === 'active' && !seen.has(Number(e.id)))) {
    result.push({ employee_id: emp.id, nombre: emp.full_name, puesto: emp.position_id, puesto_nombre: positions.find(p => p.id === emp.position_id)?.name || '', status: 'sin_registro', notes: 'Sin incidencia registrada para la fecha' });
  }
  // Contar por tipo
  const resumen = {};
  for (const r of result) {
    resumen[r.status] = (resumen[r.status] || 0) + 1;
  }

  res.json({ fecha, registros: result, resumen, total: result.length });
});

// RHH: Horas extra (vales TE de la semana)
router.get('/integracion/rhh/horas-extra', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  const rhhDb = readRhh();
  const vales = rhhDb.rhh_overtime_vales || [];
  const employees = rhhDb.rhh_employees || [];

  // Calcular rango de la semana (lun-dom) que contiene la fecha
  const d = new Date(fecha + 'T12:00:00');
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = sunday.toISOString().slice(0, 10);

  const de_semana = vales.filter(v => v.fecha >= weekStart && v.fecha <= weekEnd);

  const result = de_semana.map(v => {
    const emp = employees.find(e => e.id === v.employee_id);
    return {
      id: v.id,
      employee_id: v.employee_id,
      nombre: emp ? emp.full_name : `Emp #${v.employee_id}`,
      fecha: v.fecha,
      horas: v.te_horas || 0,
      razon: v.te_razon || '',
      proyecto: v.te_proyecto || '',
      status: v.status
    };
  });

  const autorizados = result.filter(r => r.status === 'autorizado');
  const pendientes = result.filter(r => r.status === 'pendiente');

  res.json({
    semana: { inicio: weekStart, fin: weekEnd },
    registros: result,
    resumen: {
      total: result.length,
      autorizados: autorizados.length,
      pendientes: pendientes.length,
      horas_autorizadas: autorizados.reduce((s, r) => s + r.horas, 0),
      horas_pendientes: pendientes.reduce((s, r) => s + r.horas, 0)
    }
  });
});

// RHH: Plantilla de puestos (headcount requerido vs actual)
router.get('/integracion/rhh/plantilla', (req, res) => {
  res.json({ ...rules.plantilla(readRhh()), fecha_datos: nowMxDate() });
});

router.get('/integracion/calidad/reprocesos', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  res.json({ fecha, detalle: rules.reprocesos(read().daily_registros || [], fecha) });
});

// CPK: ultimas

// CPK: ultimas titulaciones con estado
router.get('/integracion/vales/cpk', (req, res) => {
  const valesDb = readVales();
  const headers = valesDb.titulaciones_header || [];
  const detalles = valesDb.titulaciones_detalle || [];
  const params = valesDb.parametros_titulacion || [];
  const rango = req.query.desde ? { inicio: req.query.desde, fin: req.query.hasta } : rules.calendarWeek(nowMxDate());

  // Ultimas 4 titulaciones por linea
  const lineas = ['Baker', 'L1', 'L3', 'L4'];
  const result = {};
  for (const linea of lineas) {
    const lineaHeaders = headers.filter(h => h.linea === linea && h.fecha >= rango.inicio && h.fecha <= rango.fin).sort((a, b) => {
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

  // CPK Peso Fosfato — mismos IDs que pizarron CPK de /vales/
  // 85: T16: MACRO (Baker), 92: T18: MICRO (Baker), 52: T16: MICRO 2 (L3)
  const PESO_FOSFATO_IDS = params.filter(p => /peso.*fosfato|fosfato.*peso/i.test(p.nombre_parametro || '') && p.activo !== false).map(p => p.id);
  const cpkParams = [];

  // Rango de fechas: si se proporcionan desde/hasta usar esos, sino semana en curso
  const semIni = rango.inicio, semFin = rango.fin;

  // Filtrar headers de la semana (excluir paro_linea)
  const weekHeaders = headers.filter(h => h.fecha >= semIni && h.fecha <= semFin && h.estado !== 'paro_linea');
  const weekHeaderIds = new Set(weekHeaders.map(h => h.id));

  for (const pid of PESO_FOSFATO_IDS) {
    const p = params.find(x => x.id === pid);
    if (!p) continue;
    const vals = detalles
      .filter(d => d.parametro_id === p.id && weekHeaderIds.has(d.header_id) && d.valor_registrado != null)
      .map(d => Number(d.valor_registrado))
      .filter(v => !isNaN(v));
    const n = vals.length;
    const lsl = p.valor_min;
    const usl = p.valor_max;
    if (n < 2 || lsl == null || usl == null) {
      cpkParams.push({ id: p.id, nombre: p.nombre_parametro, tanque: p.no_tanque || p.nombre_tanque, unidad: p.unidad, n, mean: null, sigma: null, lsl, usl, cp: null, cpk: null });
      continue;
    }
    const mean = vals.reduce((s, v) => s + v, 0) / n;
    const sigma = Math.sqrt(vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1));
    const cp = sigma > 0 ? (usl - lsl) / (6 * sigma) : null;
    const cpkU = sigma > 0 ? (usl - mean) / (3 * sigma) : null;
    const cpkL = sigma > 0 ? (mean - lsl) / (3 * sigma) : null;
    const cpkVal = cpkU != null && cpkL != null ? Math.min(cpkU, cpkL) : null;
    cpkParams.push({
      id: p.id, nombre: p.nombre_parametro, tanque: p.no_tanque || p.nombre_tanque, unidad: p.unidad,
      n, mean: Math.round(mean * 1000) / 1000, sigma: Math.round(sigma * 1000) / 1000,
      lsl, usl,
      cp: cp != null ? Math.round(cp * 100) / 100 : null,
      cpk: cpkVal != null ? Math.round(cpkVal * 100) / 100 : null
    });
  }

  res.json({ titulaciones: result, cpk_params: cpkParams, semana: { ini: semIni, fin: semFin } });
});

// CPK Empaque: datos de muestras Tenneco (altura_axial, rugosidad)
router.get('/integracion/empaque/cpk', (req, res) => {
  const flujoDb = readFlujo();
  const rango = req.query.desde ? { inicio: req.query.desde, fin: req.query.hasta } : rules.calendarWeek(nowMxDate());
  const muestras = (flujoDb.muestras_tenneco || []).filter(m => m.fecha >= rango.inicio && m.fecha <= rango.fin);
  const specs = flujoDb.cat_tenneco_specs || [];

  // Get unique numero_parte with data
  const npSet = new Set(muestras.map(m => String(m.numero_parte).trim()).filter(Boolean));
  const partes = [...npSet].sort();

  const result = partes.map(np => {
    const spec = specs.find(s => String(s.numero_parte).trim() === np);
    const npMuestras = muestras.filter(m => String(m.numero_parte).trim() === np)
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const rugVals = npMuestras.filter(m => m.rugosidad_prom != null).map(m => m.rugosidad_prom);
    const altVals = npMuestras.filter(m => m.altura_axial_prom != null).map(m => m.altura_axial_prom);

    const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const stddev = arr => {
      if (arr.length < 2) return null;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (arr.length - 1));
    };
    const cpk = (m, s, lsl, usl) => {
      if (!s || s === 0 || (lsl == null && usl == null)) return null;
      const cpkU = usl != null ? (usl - m) / (3 * s) : null;
      const cpkL = lsl != null ? (m - lsl) / (3 * s) : null;
      return cpkU != null && cpkL != null ? Math.min(cpkU, cpkL) : (cpkU ?? cpkL);
    };

    const rugMean = mean(rugVals);
    const rugStd = stddev(rugVals);
    const rugNA = spec ? spec.rugosidad_min === 0 && spec.rugosidad_max === 0 : false;
    const altMean = mean(altVals);
    const altStd = stddev(altVals);

    return {
      numero_parte: np,
      muestras: npMuestras.length,
      rugosidad: {
        n: rugVals.length, mean: rugMean != null ? Math.round(rugMean * 100) / 100 : null,
        sigma: rugStd != null ? Math.round(rugStd * 1000) / 1000 : null,
        lsl: rugNA ? null : (spec?.rugosidad_min ?? null),
        usl: rugNA ? null : (spec?.rugosidad_max ?? null),
        na: rugNA,
        cpk: rugNA ? null : cpk(rugMean, rugStd, spec?.rugosidad_min, spec?.rugosidad_max)
      },
      altura_axial: {
        n: altVals.length, mean: altMean != null ? Math.round(altMean * 100) / 100 : null,
        sigma: altStd != null ? Math.round(altStd * 1000) / 1000 : null,
        lsl: spec?.altura_axial_min ?? null,
        usl: spec?.altura_axial_max ?? null,
        cpk: cpk(altMean, altStd, spec?.altura_axial_min, spec?.altura_axial_max)
      }
    };
  });

  res.json({ partes: result, total: partes.length, semana: { ini: rango.inicio, fin: rango.fin } });
});

// ── KPIs rapidos ─────────────────────────────────────────────────────────────

router.get('/kpis', (req, res) => {
  const db = read();
  const acts = (db.actividades || []).map(a => rules.activityView(a, nowMxDate()));
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

// ── DASHBOARD ejecutivo ──────────────────────────────────────────────────────

router.get('/dashboard/resumen', (req, res) => {
  const fecha = req.query.fecha || nowMxDate();
  const db = read();
  const acts = (db.actividades || []).map(a => rules.activityView(a, nowMxDate()));
  const dailyRegs = db.daily_registros || [];

  const deptos = DEPARTAMENTOS.map(d => {
    const deptoActs = acts.filter(a => a.departamento === d.id);
    const forms = DAILY_FORMS[d.id] || [];
    const dailyHoy = dailyRegs.filter(r => r.departamento === d.id && r.fecha === fecha);
    const llenados = forms.filter(f => dailyHoy.some(r => r.formulario === f)).length;

    // Actividades por cerrar esta semana
    const hoy = new Date(fecha + 'T12:00:00');
    const finSemStr = rules.calendarWeek(fecha).fin;
    const porCerrar = deptoActs.filter(a =>
      a.fecha_compromiso && a.fecha_compromiso >= fecha && a.fecha_compromiso <= finSemStr &&
      !['cerrada', 'cancelada'].includes(a.estatus)
    ).length;

    const sinFecha = deptoActs.filter(a => !a.fecha_compromiso && !['cerrada', 'cancelada'].includes(a.estatus)).length;

    return {
      id: d.id,
      nombre: d.nombre,
      actividades: {
        total: deptoActs.length,
        sin_empezar: deptoActs.filter(a => a.estatus === 'sin_empezar').length,
        en_proceso: deptoActs.filter(a => a.estatus === 'en_proceso').length,
        cerrada: deptoActs.filter(a => a.estatus === 'cerrada').length,
        atrasada: deptoActs.filter(a => a.estatus === 'atrasada').length,
        pospuesta: deptoActs.filter(a => a.estatus === 'pospuesta').length,
        cancelada: deptoActs.filter(a => a.estatus === 'cancelada').length,
        por_cerrar_semana: porCerrar,
        sin_fecha: sinFecha
      },
      daily: {
        total_forms: forms.length,
        llenados,
        pendientes: forms.length - llenados
      }
    };
  });

  // Global
  const totalActs = acts.length;
  const globalKpis = {
    total: totalActs,
    sin_empezar: acts.filter(a => a.estatus === 'sin_empezar').length,
    en_proceso: acts.filter(a => a.estatus === 'en_proceso').length,
    cerrada: acts.filter(a => a.estatus === 'cerrada').length,
    atrasada: acts.filter(a => a.estatus === 'atrasada').length,
    pospuesta: acts.filter(a => a.estatus === 'pospuesta').length,
    cancelada: acts.filter(a => a.estatus === 'cancelada').length
  };

  // Tendencia: ultimos 7 dias
  const tendencia = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(new Date(fecha + 'T12:00:00').getTime() - i * 86400000);
    const ds = d.toISOString().slice(0, 10);
    const creadas = acts.filter(a => a.fecha_creacion === ds).length;
    const cerradas = acts.filter(a => a.fecha_fin === ds).length;
    const dailyDia = dailyRegs.filter(r => r.fecha === ds);
    const formsTotal = Object.values(DAILY_FORMS).reduce((s, f) => s + f.length, 0);
    const formsLlenados = dailyDia.length;
    tendencia.push({ fecha: ds, creadas, cerradas, daily_llenados: formsLlenados, daily_total: formsTotal });
  }

  res.json({ fecha, global: globalKpis, departamentos: deptos, tendencia });
});

router.get('/dashboard/:depto', (req, res) => {
  const { depto } = req.params;
  const fecha = req.query.fecha || nowMxDate();
  const db = read();
  const acts = (db.actividades || []).filter(a => a.departamento === depto).map(a => rules.activityView(a, nowMxDate())).filter(a => depto !== 'compras' || rules.purchaseActivityAttention(a, nowMxDate()));
  const dailyRegs = db.daily_registros || [];
  const forms = DAILY_FORMS[depto] || [];
  const dailyHoy = dailyRegs.filter(r => r.departamento === depto && r.fecha === fecha);

  // Formularios con resumen y datos
  const formularios = forms.map(f => {
    const reg = dailyHoy.find(r => r.formulario === f);
    return {
      id: f,
      llenado: !!reg,
      llenado_por: reg ? reg.llenado_por_nombre : null,
      hora: reg ? reg.hora_llenado : null,
      datos_resumen: reg ? Object.keys(reg.datos || {}).length + ' campos' : null,
      datos: reg ? reg.datos : null
    };
  });

  // Actividades agrupadas
  const hoy = new Date(fecha + 'T12:00:00');
  const finSemStr = rules.calendarWeek(fecha).fin;

  const atrasadas = acts.filter(a => a.estatus === 'atrasada');
  const pendientes = acts.filter(a => ['sin_empezar', 'en_proceso', 'pospuesta'].includes(a.estatus));
  const porCerrar = acts.filter(a =>
    a.fecha_compromiso && a.fecha_compromiso >= fecha && a.fecha_compromiso <= finSemStr &&
    !['cerrada', 'cancelada'].includes(a.estatus)
  );
  const sinFecha = acts.filter(a => !a.fecha_compromiso && !['cerrada', 'cancelada'].includes(a.estatus));
  const recientes = acts.filter(a => a.fecha_creacion >= fecha).slice(0, 10);

  // Tendencia semanal
  const tendencia = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoy.getTime() - i * 86400000);
    const ds = d.toISOString().slice(0, 10);
    const dailyDia = dailyRegs.filter(r => r.departamento === depto && r.fecha === ds);
    tendencia.push({
      fecha: ds,
      creadas: acts.filter(a => a.fecha_creacion === ds).length,
      cerradas: acts.filter(a => a.fecha_fin === ds).length,
      daily_llenados: dailyDia.length,
      daily_total: forms.length
    });
  }

  const slideComments = act => ({
    comentarios: (act.comentarios || []).map(c => ({ usuario_nombre: c.usuario_nombre, fecha: c.fecha, hora: c.hora, texto: c.texto })),
    sub_actividades: (act.sub_actividades || []).filter(s => s.comentarios?.length).map(s => ({ id: s.id, nombre: s.nombre, comentarios: s.comentarios.map(c => ({ usuario_nombre: c.usuario_nombre, fecha: c.fecha, hora: c.hora, texto: c.texto })) }))
  });
  res.json({
    depto,
    fecha,
    objetivos: prodRouter._getPlannerObjectives(),
    piezas_semana: depto === 'produccion' ? rules.piecesSummary(dailyRegs, fecha) : null,
    scrap_semana: depto === 'smya' ? rules.scrapSummary(dailyRegs, fecha) : null,
    compras_pendientes: depto === 'compras' ? rules.purchasesAttention(readCompras(), nowMxDate()) : null,
    formularios,
    actividades: {
      total: acts.filter(a => !['cerrada', 'cancelada'].includes(a.estatus)).length,
      atrasadas: atrasadas.slice().sort((a, b) => (a.fecha_compromiso || '').localeCompare(b.fecha_compromiso || '')).map(a => ({ ...slideComments(a), origen_formulario: rules.formOf(a), correlacion_daily: a.correlacion_daily || null, estatus: a.estatus, id: a.id, titulo: a.titulo, responsable: a.responsable_nombre, fecha_compromiso: a.fecha_compromiso, urgencia: a.urgencia })),
      pendientes: pendientes.slice().sort((a, b) => (a.fecha_compromiso || 'z').localeCompare(b.fecha_compromiso || 'z')).map(a => ({ ...slideComments(a), origen_formulario: rules.formOf(a), correlacion_daily: a.correlacion_daily || null, estatus: a.estatus, id: a.id, titulo: a.titulo, responsable: a.responsable_nombre, fecha_compromiso: a.fecha_compromiso, estatus: a.estatus, urgencia: a.urgencia })),
      por_cerrar_semana: porCerrar.map(a => ({ ...slideComments(a), origen_formulario: rules.formOf(a), correlacion_daily: a.correlacion_daily || null, estatus: a.estatus, id: a.id, titulo: a.titulo, responsable: a.responsable_nombre, fecha_compromiso: a.fecha_compromiso, estatus: a.estatus })),
      sin_fecha: sinFecha.map(a => ({ ...slideComments(a), origen_formulario: rules.formOf(a), correlacion_daily: a.correlacion_daily || null, estatus: a.estatus, id: a.id, titulo: a.titulo, responsable: a.responsable_nombre, urgencia: a.urgencia })),
      recientes: recientes.map(a => ({ ...slideComments(a), origen_formulario: rules.formOf(a), correlacion_daily: a.correlacion_daily || null, estatus: a.estatus, id: a.id, titulo: a.titulo, responsable: a.responsable_nombre, estatus: a.estatus, fecha_creacion: a.fecha_creacion }))
    },
    tendencia
  });
});

// ── DASHBOARD SEMANAL — datos para gráficas por departamento ────────────────
router.get('/dashboard/:depto/semanal', (req, res) => {
  const { depto } = req.params;
  if (!DAILY_FORMS[depto]) return res.status(400).json({ error: 'Departamento invalido' });
  const fecha = req.query.fecha || nowMxDate();
  let selectedPeriod;
  try { selectedPeriod = rules.period(fecha, req.query.periodo || 'semana'); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  const { inicio: weekStart, fin: weekEnd, dias: weekDays } = selectedPeriod;

  const db = read();
  const acts = (db.actividades || []).filter(a => a.departamento === depto).map(a => rules.activityView(a, nowMxDate()));
  const dailyRegs = db.daily_registros || [];
  const forms = DAILY_FORMS[depto] || [];

  // Daily compliance por dia
  const dailyCompliance = weekDays.map(d => {
    const regs = dailyRegs.filter(r => r.departamento === depto && r.fecha === d);
    return { fecha: d, llenados: regs.length, total: forms.length };
  });

  // Actividades creadas/cerradas por dia
  const actTrend = weekDays.map(d => ({
    fecha: d,
    creadas: acts.filter(a => a.fecha_creacion === d).length,
    cerradas: acts.filter(a => a.fecha_fin === d).length
  }));

  // Datos de integración según departamento
  let integracion = {};
  try {
    if (depto === 'produccion' || depto === 'calidad' || depto === 'mantenimiento') {
      // KPIs de produccion por dia (eficiencia, calidad, disponibilidad por linea)
      const kpisPorDia = weekDays.map(d => {
        const raw = prodRouter._getDailyKpis(d);
        const kpis = {};
        for (const [linea, vals] of Object.entries(raw.kpis)) {
          kpis[linea] = {
            eficiencia: vals.eficiencia != null ? Math.round(vals.eficiencia * 100) : null,
            calidad: vals.calidad != null ? Math.round(vals.calidad * 100) : null,
            disponibilidad: vals.disponibilidad != null ? Math.round(vals.disponibilidad * 100) : null
          };
        }
        return { fecha: d, kpis };
      });
      integracion.kpis_por_dia = kpisPorDia;
      integracion.objetivos = prodRouter._getPlannerObjectives();

      // Paros de produccion por dia + causas para pareto
      const pdb = readProd();
      const allParos = (pdb.paros || []).concat(pdb.paros_baker || [], pdb.paros_l1 || []);
      const parosWeek = allParos.filter(p => p.fecha_inicio >= weekStart && p.fecha_inicio <= weekEnd);
      integracion.paros_por_dia = weekDays.map(d => ({
        fecha: d,
        count: parosWeek.filter(p => p.fecha_inicio === d).length,
        min_total: parosWeek.filter(p => p.fecha_inicio === d).reduce((s, p) => s + (p.duracion_min || 0), 0)
      }));
      // Pareto de causas de paro
      const causas = {};
      parosWeek.forEach(p => {
        const mot = p.motivo || 'Sin clasificar';
        if (!causas[mot]) causas[mot] = { motivo: mot, count: 0, min_total: 0 };
        causas[mot].count++;
        causas[mot].min_total += (p.duracion_min || 0);
      });
      integracion.pareto_paros = Object.values(causas).sort((a, b) => b.min_total - a.min_total).slice(0, 10);

      // Piezas procesadas por dia (del daily planner)
      const piezasDailys = dailyRegs.filter(r => r.departamento === 'produccion' && r.formulario === 'piezas_procesadas' && weekDays.includes(r.fecha));
      if (piezasDailys.some(r => rules.LINEAS.some(l => r.datos?.[l]?.procesadas != null))) {
        integracion.piezas_por_dia = weekDays.map(d => {
          const reg = piezasDailys.find(r => r.fecha === d);
          if (!reg || !reg.datos) return { fecha: d, Baker: null, L1: null, L3: null, L4: null };
          return {
            fecha: d,
            Baker: reg.datos.Baker?.procesadas ?? null,
            L1: reg.datos.L1?.procesadas ?? null,
            L3: reg.datos.L3?.procesadas ?? null,
            L4: reg.datos.L4?.procesadas ?? null
          };
        });
      }
    }
    if (depto === 'mantenimiento') {
      const mdb = readMant();
      const ots = mdb.ordenes_mantenimiento || [];
      const otsWeek = ots;
      integracion.ots_por_dia = weekDays.map(d => ({
        fecha: d,
        creadas: otsWeek.filter(o => (o.fecha_solicitud || o.fecha_creacion) === d).length,
        cerradas: otsWeek.filter(o => o.fecha_cierre === d).length
      }));
    }
    if (depto === 'compras') {
      const cdb = readCompras();
      const reqsWeek = (cdb.requisitions || []).filter(r => r.created_at && r.created_at.slice(0, 10) >= weekStart && r.created_at.slice(0, 10) <= weekEnd);
      integracion.reqs_por_dia = weekDays.map(d => ({
        fecha: d,
        creadas: reqsWeek.filter(r => r.created_at && r.created_at.slice(0, 10) === d).length
      }));
    }
    if (depto === 'calidad') {
      const vdb = readVales();
      const titsWeek = (vdb.titulaciones_header || []).filter(h => h.fecha >= weekStart && h.fecha <= weekEnd);
      integracion.titulaciones_por_dia = weekDays.map(d => ({
        fecha: d,
        count: titsWeek.filter(h => h.fecha === d).length,
        fuera: titsWeek.filter(h => h.fecha === d && h.estado === 'fuera_de_rango').length
      }));
      integracion.calidad_por_dia = integracion.kpis_por_dia.map(row => ({ fecha: row.fecha, ...Object.fromEntries(rules.LINEAS.map(l => [l, row.kpis[l]?.calidad ?? null])) }));
      const causas = {};
      for (const d of weekDays) for (const row of prodRouter._getPlannerDefects(d)) causas[row.defecto] = (causas[row.defecto] || 0) + row.cantidad;
      integracion.pareto_rechazos = Object.entries(causas).map(([motivo, cantidad]) => ({ motivo, cantidad })).sort((a, b) => b.cantidad - a.cantidad);


    }
  } catch (err) { return res.status(500).json({ error: 'No fue posible consultar las integraciones del periodo' }); }

  const piezasCliente = dailyRegs.filter(r => r.departamento === 'produccion' && r.formulario === 'piezas_procesadas' && r.fecha >= weekStart && r.fecha <= weekEnd);
  if (depto === 'produccion') integracion.piezas_por_cliente = weekDays.map(fecha => {
    const reg = piezasCliente.find(r => r.fecha === fecha);
    return { fecha, ...Object.fromEntries(rules.CLIENTES.map(c => [c, reg?.datos?.clientes?.[c]?.procesadas ?? null])) };
  });
  const historico = dailyRegs.filter(r => r.departamento === depto && r.fecha >= weekStart && r.fecha <= weekEnd).map(r => ({ id: r.id, fecha: r.fecha, formulario: r.formulario, datos: r.datos, llenado_por_nombre: r.llenado_por_nombre }));
  res.json({
    depto,
    periodo: selectedPeriod,
    historico,
    semana: { inicio: weekStart, fin: weekEnd, dias: weekDays },
    daily_compliance: dailyCompliance,
    actividades_trend: actTrend,
    integracion
  });
});

module.exports = router;
