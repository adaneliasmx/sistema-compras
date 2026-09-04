const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const db = require('../db');
const JWT_SECRET = require('../jwt-secret');
const { createRateLimiter } = require('../rate-limit');
const _rl = createRateLimiter();
const dbProd = require('../db-produccion');
const dbRhh = require('../db-rhh');
const { read: readMant, write: writeMant, nextId: nextMantId, nextFolio: nextMantFolio } = require('../db-mantenimiento');
const { produccionAuthRequired, produccionAllowRoles } = require('../middleware/produccion-auth');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTurno(hora) {
  // hora = "HH:MM"
  // T1: 06:30–14:29, T2: 14:30–21:29, T3: 21:30–23:59 / 00:00–06:29
  const [hh, mm] = hora.split(':').map(Number);
  const mins = hh * 60 + mm;
  if (mins >= 6 * 60 + 30 && mins <= 14 * 60 + 29) return 'T1';
  if (mins >= 14 * 60 + 30 && mins <= 21 * 60 + 29) return 'T2';
  return 'T3';
}

function getISOWeek(date) {
  // Returns ISO week number for a Date object
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getShiftDate(fecha, hora) {
  // For T3 between 00:00-06:29 the shift date is the previous day
  const [hh, mm] = hora.split(':').map(Number);
  const mins = hh * 60 + mm;
  const isEarlyT3 = mins < 6 * 60 + 30;
  if (isEarlyT3) return addDays(fecha, -1);
  return fecha;
}

// Contexto operativo de un registro completado. La descarga manda sobre el
// turno en el que se creó la carga; TL4 conserva su fecha calendario porque su
// ventana configurada no cruza medianoche.
function getStoredOperationalContext(carga, pdb) {
  const linea = carga.linea || carga._linea || '';
  if (carga.fecha_descarga && carga.hora_descarga) {
    const ctx = resolveTurnoContext(pdb, linea, carga.fecha_descarga, carga.hora_descarga);
    return {
      // La descarga es siempre la fuente de verdad. Los campos persistidos se
      // conservan para auditoría, pero nunca sustituyen fecha/hora de descarga.
      turno: ctx.turno,
      fecha_operativa: ctx.fecha_turno
    };
  }
  const fecha = carga.fecha_turno || carga.fecha_carga || carga.fecha || nowDateStr();
  const hora = carga.hora_carga || carga.hora || '06:30';
  const turno = carga.turno_descarga || carga.turno || getTurno(hora);
  const fecha_operativa = carga.fecha_operativa_descarga ||
    (turno === 'TL4' ? fecha : getShiftDate(fecha, hora));
  return { turno, fecha_operativa };
}

function getParoOperationalContext(paro, pdb) {
  const linea = paro.linea || paro._linea || '';
  const fecha = paro.fecha_inicio || nowDateStr();
  const hora = paro.hora_inicio || '06:30';
  const ctx = resolveTurnoContext(pdb, linea, fecha, hora);
  return {
    turno: paro.turno_operativo || ctx.turno,
    fecha_operativa: paro.fecha_operativa || ctx.fecha_turno
  };
}

function isValidDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

const MX_TZ = 'America/Mexico_City';

function nowDateStr() {
  // YYYY-MM-DD en hora de México (el servidor puede correr en UTC)
  return new Date().toLocaleDateString('en-CA', { timeZone: MX_TZ });
}

function nowTimeStr() {
  // HH:MM en hora de México
  return new Date().toLocaleTimeString('en-GB', { timeZone: MX_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
}

function padNum(n, len = 3) {
  return String(n).padStart(len, '0');
}

function lineaKey(linea) {
  // 'L3' -> 'l3', 'L4' -> 'l4'
  return linea.toLowerCase();
}

function getKpiObjectives(config, linea) {
  const suffix = linea === 'Baker' ? 'baker' : String(linea || '').toLowerCase();
  return {
    eficiencia: Number(config[`eficiencia_obj_${suffix}`] ?? 85),
    rendimiento: Number(config[`rendimiento_obj_${suffix}`] ?? 90),
    capacidad: Number(config[`capacidad_obj_${suffix}`] ?? 90),
    calidad: Number(config[`calidad_obj_${suffix}`] ?? 95),
    disponibilidad: Number(config[`disponibilidad_obj_${suffix}`] ?? 90)
  };
}

function catalogCollection(linea, tipo) {
  // tipo: componentes | procesos | acabados | herramentales | defectos | motivos-paro | sub-motivos-paro
  // linea: L3 | L4 | baker | l1
  if (linea === 'baker' || linea === 'l1') {
    const suffix = linea === 'baker' ? 'baker' : 'l1';
    const bakerLikeMap = {
      componentes:           `componentes_${suffix}`,
      herramentales:         `herramentales_${suffix}`,
      procesos:              `procesos_${suffix}`,
      'sub-procesos':        `sub_procesos_${suffix}`,
      defectos:              `defectos_${suffix}`,
      clientes:              `clientes_${suffix}`,
      'motivos-cavidad-vacia':`motivos_cavidad_vacia_${suffix}`,
      'motivos-paro':        `motivos_paro_${suffix}`,
      'sub-motivos-paro':    `sub_motivos_paro_${suffix}`
    };
    return bakerLikeMap[tipo] || null;
  }
  const l = lineaKey(linea);
  const map = {
    componentes: `componentes_${l}`,
    procesos: `procesos_${l}`,
    acabados: `acabados_${l}`,
    herramentales: `herramentales_${l}`,
    defectos: `defectos_${l}`,
    'motivos-paro': `motivos_paro_${l}`,
    'sub-motivos-paro': `sub_motivos_paro_${l}`
  };
  return map[tipo] || null;
}

function nextFolio(prefix, list, field = 'folio') {
  // prefix e.g. 'L3-20260331'
  const today = nowDateStr().replace(/-/g, '');
  const fullPrefix = `${prefix}-${today}-`;
  const nums = list
    .filter(x => x[field] && x[field].startsWith(fullPrefix))
    .map(x => parseInt(x[field].slice(fullPrefix.length), 10) || 0);
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${fullPrefix}${padNum(next)}`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.post('/auth/login', (req, res) => {
  const { email, user_id, password } = req.body || {};
  if (typeof password !== 'string' || (!email && !user_id))
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  if (email && typeof email !== 'string')
    return res.status(400).json({ error: 'Credenciales inválidas' });

  const rlKey = `prod|${user_id || email}|${_rl.getIp(req)}`;
  const lim = _rl.check(rlKey);
  if (lim.blocked) return res.status(429).json({ error: `Demasiados intentos. Intenta en ${lim.wait} min.` });

  const mainDb = db.read();
  const user = (mainDb.users || []).find(u => {
    if (u.active === false || !u.produccion_role) return false;
    if (user_id) return u.id === Number(user_id);
    return u.email && u.email.toLowerCase() === String(email).toLowerCase();
  });

  if (!user || !bcrypt.compareSync(String(password), user.password_hash || '')) {
    _rl.recordFail(rlKey);
    return res.status(401).json({ error: 'Credenciales inválidas o sin acceso a Producción' });
  }

  // Buscar empleado RH por email para vinculación en operadores
  const rhhDb = dbRhh.read();
  const userEmail = user.email || email || '';
  const rhhEmp = userEmail ? (rhhDb.rhh_employees || []).find(e =>
    e.status !== 'deleted' && e.email && e.email.toLowerCase() === userEmail.toLowerCase()
  ) : null;
  const rhh_employee_id = rhhEmp ? rhhEmp.id : null;

  const token = jwt.sign(
    { module: 'produccion', sub: user.id, nombre: user.full_name, email: user.email, role: user.produccion_role, rhh_employee_id },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  return res.json({
    token,
    user: { id: user.id, nombre: user.full_name, email: user.email, role: user.produccion_role, rhh_employee_id }
  });
});

// ─── Lista pública de usuarios con acceso a producción (para login dropdown) ──

router.get('/auth/usuarios', (req, res) => {
  const mainDb = db.read();
  const users = (mainDb.users || [])
    .filter(u => u.active !== false && u.produccion_role)
    .map(u => ({ id: u.id, nombre: u.full_name }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  res.json(users);
});

// ─── Cambio de contraseña (requiere token propio) ─────────────────────────────

router.patch('/auth/change-password', produccionAuthRequired, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
  if (String(new_password).length < 4)
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });

  const mainDb = db.read();
  const user = (mainDb.users || []).find(u => u.id === req.prodUser.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (!bcrypt.compareSync(String(current_password), user.password_hash || ''))
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  user.password_hash = bcrypt.hashSync(String(new_password), 10);
  user.updated_at = new Date().toISOString();
  db.write(mainDb);

  res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
});

// ─── Apply auth to all subsequent routes ─────────────────────────────────────

router.use(produccionAuthRequired);

// ─── Catálogos ────────────────────────────────────────────────────────────────

// GET bulk — devuelve todos los catálogos de una línea en un solo objeto
router.get('/catalogos/:linea', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const pdb = dbProd.read();

  // Integración con mantenimiento
  const mdb = readMant();
  const integracion_mant_activa = !!(mdb.settings?.integracion_produccion_activa);
  const equipos_mant = integracion_mant_activa
    ? (mdb.equipos_mant || []).filter(e => e.activo !== false)
    : [];
  const mainDb = db.read();
  const tecnicos_mant = integracion_mant_activa
    ? (mainDb.users || [])
        .filter(u => u.mant_role === 'tecnico_mant' && u.active)
        .map(u => ({ id: u.id, nombre: u.full_name || u.email }))
    : [];

  // Baker / L1 tienen su propio conjunto de catálogos (misma estructura)
  if (linea === 'baker' || linea === 'l1') {
    const s = linea === 'baker' ? 'baker' : 'l1';
    const operadores = (pdb[`operadores_${s}`] || [])
      .filter(o => o.activo !== false)
      .map(o => { const { pin_hash, ...rest } = o; return rest; });
    return res.json({
      clientes:             (pdb[`clientes_${s}`]             || []).filter(x => x.activo !== false),
      componentes:          (pdb[`componentes_${s}`]          || []).filter(x => x.activo !== false),
      herramentales:        (pdb[`herramentales_${s}`]        || []).filter(x => x.activo !== false),
      procesos:             (pdb[`procesos_${s}`]             || []).filter(x => x.activo !== false),
      sub_procesos:         (pdb[`sub_procesos_${s}`]         || []).filter(x => x.activo !== false),
      defectos:             (pdb[`defectos_${s}`]             || []).filter(x => x.activo !== false),
      motivos_cavidad_vacia:(pdb[`motivos_cavidad_vacia_${s}`]|| []).filter(x => x.activo !== false),
      motivos_paro:         (pdb[`motivos_paro_${s}`]         || []).filter(x => x.activo !== false),
      sub_motivos:          (pdb[`sub_motivos_paro_${s}`]     || []).filter(x => x.activo !== false),
      operadores,
      integracion_mant_activa,
      equipos_mant,
      tecnicos_mant
    });
  }

  const l = lineaKey(linea);
  const operadores = (pdb[`operadores_${l}`] || [])
    .filter(o => o.activo !== false)
    .map(o => {
      const { pin_hash, ...rest } = o;
      return rest;
    });
  res.json({
    componentes:  pdb[`componentes_${l}`]     || [],
    procesos:     pdb[`procesos_${l}`]         || [],
    acabados:     pdb[`acabados_${l}`]         || [],
    herramentales:pdb[`herramentales_${l}`]    || [],
    defectos:     pdb[`defectos_${l}`]         || [],
    motivos_paro: pdb[`motivos_paro_${l}`]     || [],
    sub_motivos:  pdb[`sub_motivos_paro_${l}`] || [],
    operadores,
    integracion_mant_activa,
    equipos_mant,
    tecnicos_mant
  });
});

// GET /urgencias-mant — OTs urgentes para alerta en pizarrón (usa token producción)
// ?activas=1  → todas las OTs urgentes actualmente abiertas (para carga inicial del pizarrón)
// ?desde=ISO  → solo las nuevas desde ese timestamp
// ?ids=1,2,3  → verifica cuáles de esos IDs siguen abiertas
router.get('/urgencias-mant', produccionAllowRoles('produccion'), (req, res) => {
  const mdb = readMant();
  if (!mdb.settings?.alerta_pizarron_activa || !mdb.settings?.integracion_produccion_activa) {
    return res.json([]);
  }
  const ordenes = mdb.ordenes_mantenimiento || [];
  const toDto = o => ({ id: o.id, folio: o.folio, descripcion: o.descripcion, departamento_nombre: o.departamento_nombre, created_at: o.created_at });
  // Modo activas: OTs urgentes abiertas en las últimas 8 h (carga inicial pizarrón — omite históricas no cerradas)
  if (req.query.activas) {
    const hace8h = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    return res.json(ordenes.filter(o => o.tipo === 'correctivo_urgente' && o.status === 'abierta' && o.created_at >= hace8h).map(toDto));
  }
  // Modo check: ¿siguen abiertas estas IDs?
  if (req.query.ids) {
    const ids = req.query.ids.split(',').map(Number).filter(Boolean);
    return res.json(ordenes.filter(o => ids.includes(o.id) && o.status === 'abierta').map(toDto));
  }
  // Modo normal: nuevas desde timestamp
  const desde = req.query.desde || new Date(Date.now() - 60 * 1000).toISOString();
  res.json(ordenes.filter(o => o.tipo === 'correctivo_urgente' && o.status === 'abierta' && o.created_at >= desde).map(toDto));
});

// PATCH /ot/:id/asignar-tecnico — asigna técnico a OT existente sin cerrarla
router.patch('/ot/:id/asignar-tecnico', produccionAllowRoles('produccion'), (req, res) => {
  const { tecnico_id } = req.body || {};
  const mdb = readMant();
  if (!mdb.settings?.integracion_produccion_activa) {
    return res.status(400).json({ error: 'Integración no activa' });
  }
  const ot = (mdb.ordenes_mantenimiento || []).find(o => String(o.id) === String(req.params.id));
  if (!ot) return res.status(404).json({ error: 'OT no encontrada' });
  if (tecnico_id) {
    ot.tecnico_asignado_id = Number(tecnico_id);
    ot.status = 'asignada';
  }
  ot.updated_at = new Date().toISOString();
  writeMant(mdb);
  res.json(ot);
});

router.get('/catalogos/:linea/:tipo', produccionAllowRoles('admin'), (req, res) => {
  const { linea, tipo } = req.params;
  const key = catalogCollection(linea, tipo);
  if (!key) return res.status(400).json({ error: 'Tipo de catálogo inválido' });
  const pdb = dbProd.read();
  const list = pdb[key] || [];
  res.json(list);
});

router.post('/catalogos/:linea/:tipo', produccionAllowRoles('admin'), (req, res) => {
  const { linea, tipo } = req.params;
  const key = catalogCollection(linea, tipo);
  if (!key) return res.status(400).json({ error: 'Tipo de catálogo inválido' });

  const pdb = dbProd.read();
  if (!pdb[key]) pdb[key] = [];

  const body = req.body || {};
  const now = new Date().toISOString();
  const id = dbProd.nextId(pdb[key]);

  let item = { id, activo: true, created_at: now };

  if (tipo === 'componentes') {
    if (!body.nombre) return res.status(400).json({ error: 'nombre es requerido' });
    item = { ...item, nombre: body.nombre, cliente: body.cliente || '', carga_optima_varillas: body.carga_optima_varillas || 0, piezas_objetivo: body.piezas_objetivo || 0 };
    if (linea === 'baker' || linea === 'l1') {
      item.no_skf = body.no_skf || '';
      if (body.piezas_por_varilla !== undefined) item.piezas_por_varilla = Number(body.piezas_por_varilla) || 0;
    }
  } else if (tipo === 'herramentales') {
    if (!body.numero) return res.status(400).json({ error: 'numero es requerido' });
    item = { ...item, numero: body.numero, nombre: body.nombre || '', descripcion: body.descripcion || '' };
    if (linea === 'baker' || linea === 'l1') {
      item.tipo = body.tipo || 'rack'; // 'rack' | 'barril'
      item.cavidades = body.cavidades ? Number(body.cavidades) : null;
      item.varillas_totales = body.varillas_totales ? Number(body.varillas_totales) : null;
    }
    // Guardar flag de defecto contemplado (todas las líneas)
    if (body.excluir_calidad !== undefined) item.excluir_calidad = !!body.excluir_calidad;
  } else if (tipo === 'sub-motivos-paro' || tipo === 'sub-procesos') {
    const parentField = tipo === 'sub-procesos' ? 'proceso_id' : 'motivo_id';
    if (!body.nombre || !body[parentField]) return res.status(400).json({ error: `nombre y ${parentField} son requeridos` });
    item = { ...item, [parentField]: body[parentField], nombre: body.nombre };
  } else {
    if (!body.nombre) return res.status(400).json({ error: 'nombre es requerido' });
    item = { ...item, nombre: body.nombre };
  }

  pdb[key].push(item);
  dbProd.write(pdb);
  res.status(201).json(item);
});

router.patch('/catalogos/:linea/:tipo/:id', produccionAllowRoles('admin'), (req, res) => {
  const { linea, tipo, id } = req.params;
  const key = catalogCollection(linea, tipo);
  if (!key) return res.status(400).json({ error: 'Tipo de catálogo inválido' });

  const pdb = dbProd.read();
  const list = pdb[key] || [];
  const idx = list.findIndex(x => String(x.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Registro no encontrado' });

  const body = req.body || {};
  const allowed = ['nombre', 'activo', 'cliente', 'carga_optima_varillas', 'piezas_objetivo', 'piezas_por_varilla', 'descripcion', 'numero', 'motivo_id', 'proceso_id', 'no_skf', 'tipo', 'cavidades', 'varillas_totales', 'excluir_calidad', 'afecta_eficiencia', 'afecta_disponibilidad', 'afecta_rendimiento', 'es_tiempo_maquina'];
  for (const field of allowed) {
    if (body[field] !== undefined) list[idx][field] = body[field];
  }

  dbProd.write(pdb);
  res.json(list[idx]);
});

// PATCH batch — aplicar cambios a múltiples items del catálogo en 1 solo write
router.patch('/catalogos/:linea/:tipo', produccionAllowRoles('admin'), (req, res) => {
  const { linea, tipo } = req.params;
  const key = catalogCollection(linea, tipo);
  if (!key) return res.status(400).json({ error: 'Tipo de catálogo inválido' });

  const updates = req.body; // [{id, campo, valor}, ...]
  if (!Array.isArray(updates) || updates.length === 0) return res.status(400).json({ error: 'Se requiere un array de cambios' });

  const pdb = dbProd.read();
  const list = pdb[key] || [];
  const allowed = new Set(['nombre', 'activo', 'cliente', 'carga_optima_varillas', 'piezas_objetivo', 'piezas_por_varilla', 'descripcion', 'numero', 'motivo_id', 'proceso_id', 'no_skf', 'tipo', 'cavidades', 'varillas_totales', 'excluir_calidad', 'afecta_eficiencia', 'afecta_disponibilidad', 'afecta_rendimiento', 'es_tiempo_maquina']);

  let applied = 0;
  for (const u of updates) {
    if (!u.id) continue;
    const item = list.find(x => String(x.id) === String(u.id));
    if (!item) continue;
    for (const [field, val] of Object.entries(u)) {
      if (field === 'id') continue;
      if (allowed.has(field)) { item[field] = val; applied++; }
    }
  }

  dbProd.write(pdb);
  res.json({ ok: true, applied });
});

router.delete('/catalogos/:linea/:tipo/:id', produccionAllowRoles('admin'), (req, res) => {
  const { linea, tipo, id } = req.params;
  const key = catalogCollection(linea, tipo);
  if (!key) return res.status(400).json({ error: 'Tipo de catálogo inválido' });
  const pdb = dbProd.read();
  const idx = (pdb[key] || []).findIndex(x => String(x.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Registro no encontrado' });
  pdb[key].splice(idx, 1);
  dbProd.write(pdb);
  res.json({ ok: true });
});

// ─── Operadores ───────────────────────────────────────────────────────────────

router.get('/operadores/:linea', produccionAllowRoles('admin'), (req, res) => {
  const { linea } = req.params;
  const key = `operadores_${lineaKey(linea)}`;
  const pdb = dbProd.read();
  const rhhDb = dbRhh.read();
  const rhhEmpMap = {};
  (rhhDb.rhh_employees || []).forEach(e => { rhhEmpMap[e.id] = e; });
  // fallback: compras users
  const mainDb = db.read();
  const usersMap = {};
  (mainDb.users || []).forEach(u => { usersMap[u.id] = u; });
  const list = (pdb[key] || []).map(o => {
    const { pin_hash, ...rest } = o;
    if (rest.rhh_employee_id && rhhEmpMap[rest.rhh_employee_id]) {
      rest.email = rhhEmpMap[rest.rhh_employee_id].email || null;
    } else if (rest.compras_user_id && usersMap[rest.compras_user_id]) {
      rest.email = usersMap[rest.compras_user_id].email || null;
    }
    return rest;
  });
  res.json(list);
});

router.post('/operadores/:linea', produccionAllowRoles('admin'), (req, res) => {
  const { linea } = req.params;
  const key = `operadores_${lineaKey(linea)}`;
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

  const pdb = dbProd.read();
  if (!pdb[key]) pdb[key] = [];

  const op = { id: dbProd.nextId(pdb[key]), nombre, rhh_employee_id: req.body.rhh_employee_id || null, compras_user_id: req.body.compras_user_id || null, activo: true, created_at: new Date().toISOString() };
  pdb[key].push(op);
  dbProd.write(pdb);

  const safe = op;
  res.status(201).json(safe);
});

router.patch('/operadores/:linea/:id', produccionAllowRoles('admin'), (req, res) => {
  const { linea, id } = req.params;
  const key = `operadores_${lineaKey(linea)}`;
  const pdb = dbProd.read();
  const list = pdb[key] || [];
  const idx = list.findIndex(x => String(x.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Operador no encontrado' });

  const body = req.body || {};
  if (body.nombre !== undefined) list[idx].nombre = body.nombre;
  if (body.activo !== undefined) list[idx].activo = body.activo;
  if (body.rhh_employee_id !== undefined) list[idx].rhh_employee_id = body.rhh_employee_id;
  if (body.compras_user_id !== undefined) list[idx].compras_user_id = body.compras_user_id;

  dbProd.write(pdb);
  const safe = list[idx];
  res.json(safe);
});

// ─── Empleados RH disponibles como operadores ────────────────────────────────
router.get('/usuarios-sistema', produccionAllowRoles('produccion'), (req, res) => {
  const rhhDb = dbRhh.read();
  const employees = (rhhDb.rhh_employees || [])
    .filter(e => e.status !== 'deleted' && e.status !== 'inactivo')
    .map(e => ({ id: e.id, full_name: e.full_name, email: e.email || '', employee_number: e.employee_number || '' }));
  res.json(employees);
});

// ─── Cargas ───────────────────────────────────────────────────────────────────

router.get('/cargas/:linea/activas', (req, res) => {
  const { linea } = req.params;
  const pdb = dbProd.read();
  let cargas = (pdb.cargas || []).filter(c => c.linea === linea && c.estado === 'activo');
  cargas.sort((a, b) => {
    const ta = `${a.fecha_carga}T${a.hora_carga}`;
    const tb = `${b.fecha_carga}T${b.hora_carga}`;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  res.json(cargas);
});

router.get('/cargas/:linea', (req, res) => {
  const { linea } = req.params;
  const { fecha_ini, fecha_fin, turno, estado, operador } = req.query;
  const pdb = dbProd.read();
  let cargas = (pdb.cargas || []).filter(c => c.linea === linea).map(c => {
    const ctx = getStoredOperationalContext(c, pdb);
    return {
      ...c,
      turno_captura: c.turno,
      turno: ctx.turno,
      turno_operativo: ctx.turno,
      fecha_operativa: ctx.fecha_operativa
    };
  });

  if (fecha_ini) cargas = cargas.filter(c => c.fecha_operativa >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => c.fecha_operativa <= fecha_fin);
  if (turno) cargas = cargas.filter(c => c.turno_operativo === turno);
  if (estado) cargas = cargas.filter(c => c.estado === estado);
  if (operador) cargas = cargas.filter(c => String(c.operador_id) === String(operador));

  res.json(cargas);
});

router.post('/cargas/:linea', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const body = req.body || {};
  const { herramental_id, componente_id, proceso_id, acabado_id, varillas, piezas_por_varilla, operador_id, es_vacia } = body;

  if (!herramental_id || !proceso_id || !acabado_id || varillas === undefined || piezas_por_varilla === undefined || !operador_id) {
    return res.status(400).json({ error: 'herramental_id, proceso_id, acabado_id, varillas, piezas_por_varilla y operador_id son requeridos' });
  }

  const pdb = dbProd.read();
  const l = lineaKey(linea);

  // Candado: no permitir carga si hay paro activo en esta línea
  const paroActivo = (pdb.paros || []).find(p => p.linea === linea && !p.fecha_fin && p.estado !== 'cerrado');
  if (paroActivo) return res.status(409).json({ error: `Hay un paro activo en ${linea} (${paroActivo.motivo || 'sin motivo'}). Ciérralo antes de registrar una carga.`, paro: paroActivo });

  // Get herramental
  const herramentales = pdb[`herramentales_${l}`] || [];
  const herramental = herramentales.find(h => String(h.id) === String(herramental_id));
  if (!herramental) return res.status(400).json({ error: 'Herramental no encontrado' });

  // Block if same herramental_no already active on this linea
  const yaActivo = (pdb.cargas || []).find(c =>
    c.linea === linea &&
    c.herramental_no === herramental.numero &&
    c.estado === 'activo'
  );
  if (yaActivo) {
    return res.status(409).json({ error: `El herramental ${herramental.numero} ya tiene una carga activa en ${linea}` });
  }

  // Get proceso
  const procesos = pdb[`procesos_${l}`] || [];
  const proceso = procesos.find(p => String(p.id) === String(proceso_id));
  if (!proceso) return res.status(400).json({ error: 'Proceso no encontrado' });

  // Get acabado
  const acabados = pdb[`acabados_${l}`] || [];
  const acabado = acabados.find(a => String(a.id) === String(acabado_id));
  if (!acabado) return res.status(400).json({ error: 'Acabado no encontrado' });

  // Get operador
  const operadores = pdb[`operadores_${l}`] || [];
  const operador = operadores.find(o => String(o.id) === String(operador_id) && o.activo !== false);
  if (!operador) return res.status(400).json({ error: 'Operador no encontrado' });

  // Get componente (optional for empty loads)
  let componente = null;
  let cliente = '';
  if (!es_vacia && componente_id) {
    const componentes = pdb[`componentes_${l}`] || [];
    componente = componentes.find(c => String(c.id) === String(componente_id));
    if (!componente) return res.status(400).json({ error: 'Componente no encontrado' });
    cliente = componente.cliente || '';
  }

  const now = new Date();
  const hora_carga  = nowTimeStr();
  const fecha_carga = nowDateStr();

  // Resolver turno con validación completa (TL4 ventana, calendario)
  const ctx = resolveTurnoContext(pdb, linea, fecha_carga, hora_carga);
  if (!ctx.activo) return res.status(409).json({ error: `El turno ${ctx.turno} no está activo para ${linea} en esta fecha` });
  if (!(ctx.en_ventana_programada ?? ctx.en_ventana)) return res.status(409).json({ error: `Fuera del horario de ${ctx.turno} (${ctx.hora_entrada}–${ctx.hora_salida})` });
  const fecha_turno = ctx.fecha_turno;
  const turno = ctx.turno;

  const semana = getISOWeek(new Date(fecha_turno + 'T12:00:00'));
  const cantidad = es_vacia ? 0 : Number(varillas) * Number(piezas_por_varilla);

  const id = dbProd.nextId(pdb.cargas || []);
  const prefix = linea.toUpperCase();
  const folio = nextFolio(prefix, pdb.cargas || []);

  const carga = {
    id,
    folio,
    linea,
    herramental_id: Number(herramental_id),
    herramental_no: herramental.numero,
    componente_id: componente ? Number(componente_id) : null,
    componente: componente ? componente.nombre : null,
    cliente,
    proceso_id: Number(proceso_id),
    proceso: proceso.nombre,
    acabado_id: Number(acabado_id),
    acabado: acabado.nombre,
    varillas: Number(varillas),
    piezas_por_varilla: Number(piezas_por_varilla),
    cantidad,
    es_vacia: !!es_vacia,
    operador_id: Number(operador_id),
    operador: operador.nombre,
    fecha_carga,
    fecha_turno,
    hora_carga,
    semana,
    fecha_descarga: null,
    hora_descarga: null,
    turno,
    estado: 'activo',
    defecto_id: null,
    defecto: null,
    folio_origen: null,
    es_reproceso: false,
    reprocesado: false,
    created_at: now.toISOString()
  };

  if (!pdb.cargas) pdb.cargas = [];
  pdb.cargas.push(carga);
  dbProd.write(pdb);
  res.status(201).json(carga);
});

router.post('/cargas/:linea/:id/descargar', produccionAllowRoles('produccion'), (req, res) => {
  const { linea, id } = req.params;
  const { salio_bien, defecto_id, defecto } = req.body || {};

  const pdb = dbProd.read();
  const idx = (pdb.cargas || []).findIndex(c => String(c.id) === String(id) && c.linea === linea);
  if (idx === -1) return res.status(404).json({ error: 'Carga no encontrada' });

  const carga = pdb.cargas[idx];
  if (carga.estado !== 'activo') return res.status(409).json({ error: 'La carga no está activa' });

  carga.fecha_descarga = nowDateStr();
  carga.hora_descarga = nowTimeStr();
  const descargaCtx = resolveTurnoContext(pdb, linea, carga.fecha_descarga, carga.hora_descarga);
  carga.turno_descarga = descargaCtx.turno;
  carga.fecha_operativa_descarga = descargaCtx.fecha_turno;

  if (salio_bien) {
    carga.estado = 'procesado';
    carga.defecto_id = null;
    carga.defecto = null;
  } else {
    carga.estado = 'defecto';
    if (defecto_id !== undefined) carga.defecto_id = defecto_id;
    if (defecto !== undefined) carga.defecto = defecto;
    // If defecto_id provided, lookup name
    if (defecto_id && !defecto) {
      const l = lineaKey(linea);
      const defectos = pdb[`defectos_${l}`] || [];
      const def = defectos.find(d => String(d.id) === String(defecto_id));
      if (def) carga.defecto = def.nombre;
    }
  }

  dbProd.write(pdb);
  res.json(pdb.cargas[idx]);
});

router.post('/cargas/:linea/:id/reprocesar', produccionAllowRoles('produccion'), (req, res) => {
  const { linea, id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.cargas || []).findIndex(c => String(c.id) === String(id) && c.linea === linea);
  if (idx === -1) return res.status(404).json({ error: 'Carga no encontrada' });

  const original = pdb.cargas[idx];
  const { defecto_id, defecto } = req.body || {};
  if (!['activo', 'defecto'].includes(original.estado)) {
    return res.status(409).json({ error: 'Solo se puede reprocesar una carga activa o con defecto' });
  }
  // Si la carga está activa, marcarla como defecto de forma atómica
  if (original.estado === 'activo') {
    original.estado = 'defecto';
    original.fecha_descarga = nowDateStr();
    original.hora_descarga = nowTimeStr();
    const descargaCtx = resolveTurnoContext(pdb, linea, original.fecha_descarga, original.hora_descarga);
    original.turno_descarga = descargaCtx.turno;
    original.fecha_operativa_descarga = descargaCtx.fecha_turno;
    if (defecto_id !== undefined) original.defecto_id = defecto_id;
    if (defecto !== undefined) original.defecto = defecto;
    if (defecto_id && !defecto) {
      const l2 = lineaKey(linea);
      const defs = pdb[`defectos_${l2}`] || [];
      const def = defs.find(d => String(d.id) === String(defecto_id));
      if (def) original.defecto = def.nombre;
    }
  }

  const now = new Date();
  const hora_carga  = nowTimeStr();
  const fecha_carga = nowDateStr();

  // Resolver turno correctamente: L4 post-cutover → TL4
  const ctx = resolveTurnoContext(pdb, linea, fecha_carga, hora_carga);
  if (!ctx.activo) return res.status(409).json({ error: `El turno ${ctx.turno} no está activo para ${linea} en esta fecha` });
  if (!(ctx.en_ventana_programada ?? ctx.en_ventana)) return res.status(409).json({ error: `Fuera del horario de ${ctx.turno} (${ctx.hora_entrada}–${ctx.hora_salida})` });

  const fecha_turno = ctx.fecha_turno;
  const turno = ctx.turno;
  const semana = getISOWeek(new Date(fecha_turno + 'T12:00:00'));

  const newId = dbProd.nextId(pdb.cargas);
  const prefix = linea.toUpperCase();
  const folio = nextFolio(prefix, pdb.cargas);

  const nuevaCarga = {
    id: newId,
    folio,
    linea: original.linea,
    herramental_id: original.herramental_id,
    herramental_no: original.herramental_no,
    componente_id: original.componente_id,
    componente: original.componente,
    cliente: original.cliente,
    proceso_id: original.proceso_id,
    proceso: original.proceso,
    acabado_id: original.acabado_id,
    acabado: original.acabado,
    varillas: original.varillas,
    piezas_por_varilla: original.piezas_por_varilla,
    cantidad: original.cantidad,
    es_vacia: original.es_vacia,
    operador_id: original.operador_id,
    operador: original.operador,
    fecha_carga,
    fecha_turno,
    hora_carga,
    semana,
    fecha_descarga: null,
    hora_descarga: null,
    turno,
    estado: 'activo',
    defecto_id: null,
    defecto: null,
    folio_origen: original.folio,
    es_reproceso: true,
    reprocesado: false,
    created_at: now.toISOString()
  };

  // Mark original as reprocesado
  pdb.cargas[idx].reprocesado = true;

  pdb.cargas.push(nuevaCarga);
  dbProd.write(pdb);
  res.status(201).json(nuevaCarga);
});

// ─── Admin: editar / eliminar cargas ──────────────────────────────────────────

router.patch('/cargas/:id/admin-editar', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb  = dbProd.read();
  const body = req.body || {};

  // _linea_hint permite identificar la colección correcta cuando el id puede coincidir
  // entre cargas (L3/L4) y cargas_baker / cargas_l1 (IDs secuenciales independientes)
  const hint = (body._linea_hint || '').toString().toLowerCase();
  let collections;
  if (hint === 'baker') {
    collections = [
      { key: 'cargas_baker', arr: pdb.cargas_baker || [] },
      { key: 'cargas',       arr: pdb.cargas       || [] },
      { key: 'cargas_l1',   arr: pdb.cargas_l1    || [] },
    ];
  } else if (hint === 'l1') {
    collections = [
      { key: 'cargas_l1',   arr: pdb.cargas_l1    || [] },
      { key: 'cargas',      arr: pdb.cargas        || [] },
      { key: 'cargas_baker',arr: pdb.cargas_baker  || [] },
    ];
  } else {
    collections = [
      { key: 'cargas',       arr: pdb.cargas       || [] },
      { key: 'cargas_baker', arr: pdb.cargas_baker  || [] },
      { key: 'cargas_l1',   arr: pdb.cargas_l1     || [] },
    ];
  }

  let found = null;
  for (const col of collections) {
    const idx = col.arr.findIndex(c => String(c.id) === String(id));
    if (idx !== -1) { found = { ...col, idx }; break; }
  }
  if (!found) return res.status(404).json({ error: 'Carga no encontrada' });

  const carga  = found.arr[found.idx];
  const campos = [
    'turno', 'fecha_carga', 'hora_carga', 'fecha_descarga', 'hora_descarga',
    'herramental_id', 'herramental_no',
    'componente_id', 'componente', 'cliente',
    'proceso_id', 'proceso', 'sub_proceso_id', 'sub_proceso',
    'acabado_id', 'acabado',
    'operador_id', 'operador',
    'no_skf', 'no_orden', 'lote',
    'cantidad', 'varillas', 'piezas_por_varilla',
    'estado', 'resultado', 'defecto', 'defecto_id'
  ];
  for (const f of campos) {
    if (body[f] !== undefined) carga[f] = body[f] !== '' ? body[f] : null;
  }
  // Una edición de la descarga puede mover la carga a otro turno operativo
  // (en especial T3 después de medianoche). No conservar el turno capturado
  // por el formulario como fuente de verdad.
  const lineaCarga = found.key === 'cargas_baker'
    ? 'Baker'
    : found.key === 'cargas_l1'
      ? 'L1'
      : carga.linea;
  if (carga.fecha_descarga && carga.hora_descarga && lineaCarga) {
    const descargaCtx = resolveTurnoContext(pdb, lineaCarga, carga.fecha_descarga, carga.hora_descarga);
    carga.turno = descargaCtx.turno;
    carga.turno_descarga = descargaCtx.turno;
    carga.fecha_operativa_descarga = descargaCtx.fecha_turno;
  } else {
    carga.turno_descarga = null;
    carga.fecha_operativa_descarga = null;
    if (carga.fecha_carga && carga.hora_carga && lineaCarga) {
      const cargaCtx = resolveTurnoContext(pdb, lineaCarga, carga.fecha_carga, carga.hora_carga);
      carga.turno = cargaCtx.turno;
      carga.fecha_turno = cargaCtx.fecha_turno;
    }
  }
  carga.editado_por = req.prodUser?.nombre || 'Admin';
  carga.editado_at  = new Date().toISOString();

  pdb[found.key] = found.arr;
  dbProd.write(pdb);
  res.json(carga);
});

router.delete('/cargas/:id', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();

  const collections = [
    { key: 'cargas',       arr: pdb.cargas       || [] },
    { key: 'cargas_baker', arr: pdb.cargas_baker  || [] },
    { key: 'cargas_l1',   arr: pdb.cargas_l1     || [] },
  ];

  for (const col of collections) {
    const idx = col.arr.findIndex(c => String(c.id) === String(id));
    if (idx !== -1) {
      const [eliminado] = col.arr.splice(idx, 1);
      pdb[col.key] = col.arr;
      dbProd.write(pdb);
      return res.json({ ok: true, eliminado });
    }
  }
  return res.status(404).json({ error: 'Carga no encontrada' });
});

// Admin: editar / eliminar cavidades Baker/L1
router.patch('/cavidades/:id/admin-editar', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb  = dbProd.read();
  const body = req.body || {};

  const collections = [
    { key: 'cavidades_baker', arr: pdb.cavidades_baker || [] },
    { key: 'cavidades_l1',   arr: pdb.cavidades_l1    || [] },
  ];

  let found = null;
  for (const col of collections) {
    const idx = col.arr.findIndex(c => String(c.id) === String(id));
    if (idx !== -1) { found = { ...col, idx }; break; }
  }
  if (!found) return res.status(404).json({ error: 'Cavidad no encontrada' });

  const cav    = found.arr[found.idx];
  const campos = ['estado', 'resultado', 'defecto', 'defecto_id', 'cantidad', 'operador', 'operador_id',
                   'proceso', 'proceso_id', 'sub_proceso', 'sub_proceso_id',
                   'cliente', 'componente', 'componente_id', 'no_skf', 'no_orden', 'lote'];
  for (const f of campos) {
    if (body[f] !== undefined) cav[f] = body[f] !== '' ? body[f] : null;
  }
  cav.editado_por = req.prodUser?.nombre || 'Admin';
  cav.editado_at  = new Date().toISOString();

  pdb[found.key] = found.arr;
  dbProd.write(pdb);
  res.json(cav);
});

router.delete('/cavidades/:id', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();

  const collections = [
    { key: 'cavidades_baker', arr: pdb.cavidades_baker || [] },
    { key: 'cavidades_l1',   arr: pdb.cavidades_l1    || [] },
  ];

  for (const col of collections) {
    const idx = col.arr.findIndex(c => String(c.id) === String(id));
    if (idx !== -1) {
      const [eliminado] = col.arr.splice(idx, 1);
      pdb[col.key] = col.arr;
      dbProd.write(pdb);
      return res.json({ ok: true, eliminado });
    }
  }
  return res.status(404).json({ error: 'Cavidad no encontrada' });
});

// ─── Paros ────────────────────────────────────────────────────────────────────

// Reporte general de paros (admin) — todas las líneas con filtros
router.get('/paros/reporte', produccionAllowRoles('admin'), (req, res) => {
  const { linea, desde, hasta, turno } = req.query;
  const pdb = dbProd.read();
  let paros = [];

  if (!linea || linea === 'ambas') {
    const bakerParos = (pdb.paros_baker || []).map(p => ({ ...p, linea: 'Baker' }));
    const l1Paros    = (pdb.paros_l1    || []).map(p => ({ ...p, linea: 'L1'    }));
    paros = [...(pdb.paros || []), ...bakerParos, ...l1Paros];
  } else if (linea === 'Baker') {
    paros = (pdb.paros_baker || []).map(p => ({ ...p, linea: 'Baker' }));
  } else if (linea === 'L1') {
    paros = (pdb.paros_l1 || []).map(p => ({ ...p, linea: 'L1' }));
  } else {
    paros = (pdb.paros || []).filter(p => p.linea === linea);
  }

  paros = paros.map(p => {
    const ctx = getParoOperationalContext(p, pdb);
    return { ...p, turno: ctx.turno, fecha_operativa: ctx.fecha_operativa };
  });
  if (desde) paros = paros.filter(p => p.fecha_operativa >= desde);
  if (hasta) paros = paros.filter(p => p.fecha_operativa <= hasta);
  if (turno) paros = paros.filter(p => p.turno === turno);
  paros = paros.sort((a, b) =>
    (`${b.fecha_inicio}T${b.hora_inicio}`).localeCompare(`${a.fecha_inicio}T${a.hora_inicio}`)
  );
  res.json({ total: paros.length, paros });
});

// GET /resumen/paros?desde=&hasta=&linea=&turno= — paros en rango (todos los roles)
router.get('/resumen/paros', (req, res) => {
  const { desde, hasta, linea, turno } = req.query;
  const pdb = dbProd.read();
  const lineasReq = linea ? linea.split(',').map(s => s.trim()) : ['L3', 'L4', 'Baker', 'L1'];
  let paros = [];
  for (const l of lineasReq) {
    if (l === 'Baker') paros.push(...(pdb.paros_baker || []).map(p => ({ ...p, linea: 'Baker' })));
    else if (l === 'L1') paros.push(...(pdb.paros_l1 || []).map(p => ({ ...p, linea: 'L1' })));
    else paros.push(...(pdb.paros || []).filter(p => p.linea === l));
  }
  paros = paros.map(p => {
    const ctx = getParoOperationalContext(p, pdb);
    return { ...p, turno: ctx.turno, fecha_operativa: ctx.fecha_operativa };
  });
  if (desde) paros = paros.filter(p => p.fecha_operativa >= desde);
  if (hasta) paros = paros.filter(p => p.fecha_operativa <= hasta);
  if (turno) paros = paros.filter(p => p.turno === turno);
  paros = paros.filter(p => Number(p.duracion_min || 0) > 0);
  res.json({ total: paros.length, paros });
});

// GET /stats/operador-semana?operador_id=X&fecha_ini=Y&fecha_fin=Z
// Retorna per-dia los ciclos, eficiencia y minutos de paro (rend) del operador en todas las líneas
router.get('/stats/operador-semana', produccionAllowRoles('produccion', 'admin'), (req, res) => {
  const { operador_id, fecha_ini, fecha_fin } = req.query;
  if (!operador_id || !fecha_ini) {
    return res.status(400).json({ error: 'operador_id y fecha_ini son requeridos' });
  }
  const pdb = dbProd.read();
  const cfg = pdb.config || {};

  // Todas las cargas procesadas del operador en el rango
  // L3/L4 en pdb.cargas (con campo linea), Baker/L1 en colecciones separadas
  const allCargas = [
    ...(pdb.cargas || []).filter(c => c.linea === 'L3' || c.linea === 'L4').map(c => ({ ...c, _linea: c.linea })),
    ...(pdb.cargas_baker || []).map(c => ({ ...c, _linea: 'Baker' })),
    ...(pdb.cargas_l1    || []).map(c => ({ ...c, _linea: 'L1' })),
  ];

  const opCargas = allCargas.map(c => {
    const ctx = getStoredOperationalContext(c, pdb);
    return { ...c, _fecha_operativa: ctx.fecha_operativa, _turno_descarga: ctx.turno };
  }).filter(c => {
    if (!c.fecha_descarga) return false;
    if (c.estado === 'activo' || c.estado === 'cancelado') return false;
    if (String(c.operador_id) !== String(operador_id)) return false;
    const f = c._fecha_operativa;
    if (f < fecha_ini) return false;
    if (fecha_fin && f > fecha_fin) return false;
    return true;
  });

  // Agrupar por fecha operativa, línea y turno de descarga.
  const groups = {};
  for (const c of opCargas) {
    const turnoDesc = c._turno_descarga;
    const key = `${c._fecha_operativa}|${c._linea}|${turnoDesc}`;
    if (!groups[key]) {
      groups[key] = { fecha: c._fecha_operativa, linea: c._linea, turno: turnoDesc, ciclos: 0, cargas: [] };
    }
    groups[key].ciclos++;
    groups[key].cargas.push(c);
  }

  // Todos los paros
  const allParos = [
    ...(pdb.paros         || []),                                         // L3 y L4 ya tienen linea
    ...(pdb.paros_baker   || []).map(p => ({ ...p, linea: 'Baker' })),
    ...(pdb.paros_l1      || []).map(p => ({ ...p, linea: 'L1' })),
  ];

  const result = [];
  for (const g of Object.values(groups)) {
    const { fecha, linea, turno } = g;
    const kpiTurno = calculateKpiSnapshot(pdb, cfg, linea, turno, fecha);
    let objetivo = kpiTurno?.objetivo_eficiencia || 0;
    let ciclosEficiencia = g.ciclos;
    if (linea === 'L4' && turno === 'TL4') {
      const tl4 = getTL4EfficiencySummary(pdb, cfg, fecha, operador_id);
      objetivo = tl4.objetivo;
      ciclosEficiencia = tl4.ciclos_eficiencia;
    } else if (kpiTurno?.slots) {
      // Igual que el KPI en vivo: las descargas de la hora abierta se muestran,
      // pero no entran todavía en la eficiencia semanal del operador.
      const completedSlots = kpiTurno.slots.filter(slot => slot.estado_slot === 'completado');
      ciclosEficiencia = g.cargas.filter(c => {
        const eventDay = Math.round((
          new Date(`${c.fecha_descarga}T00:00:00Z`) - new Date(`${fecha}T00:00:00Z`)
        ) / 86400000);
        const eventMinute = eventDay * 1440 + toMins(c.hora_descarga);
        return completedSlots.some(slot => {
          let start = toMins(slot.hora_inicio);
          if (turno === 'T3' && start < TURNOS_DEF.T3.start) start += 1440;
          const duration = Number(slot.slotDuration || 60);
          return eventMinute >= start && eventMinute < start + duration;
        });
      }).length;
    }
    const eficiencia = objetivo > 0 ? ciclosEficiencia / objetivo : (ciclosEficiencia === 0 ? 1 : null);

    // Paros que afectan rendimiento en este (linea, turno, fecha)
    const motivosLinea = pdb[`motivos_paro_${linea.toLowerCase()}`] || [];
    const parosFiltrados = allParos.filter(p => {
      const ctx = getParoOperationalContext(p, pdb);
      if (p.linea !== linea || ctx.turno !== turno || ctx.fecha_operativa !== fecha) return false;
      const motivo = motivosLinea.find(m => String(m.id) === String(p.motivo_id));
      return motivo?.afecta_rendimiento !== false;
    });
    const paros_min_rend = kpiTurno?.paros_min_rend ??
      parosFiltrados.reduce((s, p) => s + Math.max(0, (p.duracion_min || 0) - (p.deduccion_min || 0)), 0);

    result.push({
      fecha, linea, turno, ciclos: g.ciclos, ciclos_eficiencia: ciclosEficiencia,
      objetivo, eficiencia, paros_min_rend
    });
  }

  result.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.linea.localeCompare(b.linea));
  res.json(result);
});

// GET /stats/semana-linea?linea=L3&fecha_ini=Y&fecha_fin=Z
// Para admin/supervisor: resumen semanal por (fecha, turno) con operador principal de cada turno
router.get('/stats/semana-linea', produccionAllowRoles('produccion', 'admin'), (req, res) => {
  const { linea, fecha_ini, fecha_fin } = req.query;
  if (!linea || !fecha_ini) return res.status(400).json({ error: 'linea y fecha_ini son requeridos' });

  const pdb = dbProd.read();
  const cfg = pdb.config || {};

  if (!['L3', 'L4', 'Baker', 'L1'].includes(linea)) return res.status(400).json({ error: 'Línea no válida' });

  const motivosKey = { L3: 'motivos_paro_l3', L4: 'motivos_paro_l4', Baker: 'motivos_paro_baker', L1: 'motivos_paro_l1' }[linea];
  const motivos = pdb[motivosKey] || [];

  const parosSrc = linea === 'Baker'
    ? (pdb.paros_baker || []).map(p => ({ ...p, linea: 'Baker' }))
    : linea === 'L1'
      ? (pdb.paros_l1 || []).map(p => ({ ...p, linea: 'L1' }))
      : (pdb.paros || []).filter(p => p.linea === linea);

  // L3/L4 en pdb.cargas, Baker/L1 en sus propias colecciones
  const cargasSrc = (linea === 'Baker' || linea === 'L1')
    ? (pdb[`cargas_${linea.toLowerCase()}`] || [])
    : (pdb.cargas || []).filter(c => c.linea === linea);

  const cargas = cargasSrc.map(c => {
    const ctx = getStoredOperationalContext({ ...c, _linea: linea }, pdb);
    return { ...c, _fecha_operativa: ctx.fecha_operativa, _turno_descarga: ctx.turno };
  }).filter(c => {
    if (!c.fecha_descarga) return false;
    if (c.estado === 'activo' || c.estado === 'cancelado') return false;
    if (c._fecha_operativa < fecha_ini) return false;
    if (fecha_fin && c._fecha_operativa > fecha_fin) return false;
    return true;
  });

  // Agrupar por fecha operativa y turno de descarga.
  const groups = {};
  for (const c of cargas) {
    const turnoDesc = c._turno_descarga;
    const key = `${c._fecha_operativa}|${turnoDesc}`;
    if (!groups[key]) groups[key] = { fecha: c._fecha_operativa, turno: turnoDesc, ops: {} };
    const opNom = c.operador || '—';
    groups[key].ops[opNom] = (groups[key].ops[opNom] || 0) + 1;
  }

  const result = Object.values(groups).map(g => {
    const { fecha, turno } = g;
    const ciclos  = Object.values(g.ops).reduce((s, n) => s + n, 0);
    const operador = Object.entries(g.ops).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const kpiTurno = calculateKpiSnapshot(pdb, cfg, linea, turno, fecha);
    const objetivo = kpiTurno?.objetivo_eficiencia || 0;
    const ciclosEficiencia = kpiTurno?.ciclos_eficiencia ?? ciclos;
    const eficiencia = kpiTurno?.eficiencia ?? (objetivo > 0 ? ciclosEficiencia / objetivo : null);

    const parosFiltrados = parosSrc.filter(p => {
      const ctx = getParoOperationalContext({ ...p, _linea: linea }, pdb);
      if (ctx.turno !== turno || ctx.fecha_operativa !== fecha) return false;
      const mot = motivos.find(m => String(m.id) === String(p.motivo_id));
      return mot?.afecta_rendimiento !== false;
    });
    const paros_min_rend = kpiTurno?.paros_min_rend ??
      parosFiltrados.reduce((s, p) => s + Math.max(0, (p.duracion_min || 0) - (p.deduccion_min || 0)), 0);

    return { fecha, turno, operador, ciclos, objetivo, eficiencia, paros_min_rend };
  });

  result.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.turno.localeCompare(b.turno));
  res.json(result);
});

// GET /resumen/defectos?desde=&hasta=&linea=&turno= — ciclos/cavidades con defecto (todos los roles)
router.get('/resumen/defectos', (req, res) => {
  const { desde, hasta, linea, turno } = req.query;
  const pdb = dbProd.read();
  const lineasReq = linea ? linea.split(',').map(s => s.trim()) : ['L3', 'L4', 'Baker', 'L1'];
  const result = [];
  const ftD   = (c, l) => getStoredOperationalContext({ ...c, _linea: l }, pdb).fecha_operativa;
  const turnoD = (c, l) => resolveStoredTurno({ ...c, _linea: l }, pdb);
  for (const l of lineasReq) {
    if (l === 'Baker' || l === 'L1') {
      const src = l === 'Baker' ? 'cargas_baker' : 'cargas_l1';
      const herrKey = l === 'Baker' ? 'herramentales_baker' : 'herramentales_l1';
      const excluirIds = new Set((pdb[herrKey] || []).filter(h => h.excluir_calidad).map(h => String(h.id)));
      let cargas = (pdb[src] || []).filter(c => !!c.fecha_descarga);
      if (desde) cargas = cargas.filter(c => ftD(c, l) >= desde);
      if (hasta) cargas = cargas.filter(c => ftD(c, l) <= hasta);
      if (turno) cargas = cargas.filter(c => turnoD(c, l) === turno);
      for (const carga of cargas) {
        const excluido = excluirIds.has(String(carga.herramental_id));
        if (carga.herramental_tipo === 'barril') {
          const cavsMalas = (carga.cavidades || []).filter(cv => cv.estado === 'defecto');
          for (const cav of cavsMalas) {
            result.push({ linea: l, fecha: ftD(carga, l), turno: turnoD(carga, l),
              herramental: carga.herramental_no || String(carga.herramental_id || ''),
              operador: carga.operador || '', defecto: cav.defecto || 'Sin motivo',
              detalle: `Cavidad ${cav.num}`, folio: carga.folio, afecta_calidad: !excluido });
          }
        } else if (carga.estado === 'defecto' || carga.defecto_id) {
          result.push({ linea: l, fecha: ftD(carga, l), turno: turnoD(carga, l),
            herramental: carga.herramental_no || String(carga.herramental_id || ''),
            operador: carga.operador || '', defecto: carga.defecto || 'Sin motivo',
            detalle: carga.es_vacia ? `Ciclo vacío ${carga.folio}` : `Ciclo ${carga.folio}`,
            folio: carga.folio, afecta_calidad: !excluido && !carga.es_vacia });
        }
      }
    } else {
      const herrKey = `herramentales_${l.toLowerCase()}`;
      const excluirIds = new Set((pdb[herrKey] || []).filter(h => h.excluir_calidad).map(h => String(h.id)));
      let cargas = (pdb.cargas || []).filter(c => c.linea === l && !!c.fecha_descarga);
      if (desde) cargas = cargas.filter(c => ftD(c, l) >= desde);
      if (hasta) cargas = cargas.filter(c => ftD(c, l) <= hasta);
      if (turno) cargas = cargas.filter(c => turnoD(c, l) === turno);
      for (const c of cargas.filter(x => x.estado === 'defecto' || x.defecto_id)) {
        const excluido = excluirIds.has(String(c.herramental_id));
        result.push({ linea: l, fecha: ftD(c, l), turno: turnoD(c, l),
          herramental: c.herramental_no || '', operador: c.operador || '',
          defecto: c.defecto || 'Sin motivo', detalle: `Ciclo ${c.folio}`, folio: c.folio,
          afecta_calidad: !excluido && !c.es_vacia });
      }
    }
  }
  result.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.turno.localeCompare(b.turno));
  res.json({ total: result.length, defectos: result });
});

// Admin: crear paro manual con fechas/horas personalizadas (cualquier línea)
router.post('/paros/admin-crear', produccionAllowRoles('admin'), (req, res) => {
  const body = req.body || {};
  const {
    linea, motivo_id, sub_motivo_id, fecha_inicio, hora_inicio, fecha_fin, hora_fin,
    override_turno, override_motivo
  } = body;
  if (!linea || !motivo_id || !fecha_inicio || !hora_inicio) {
    return res.status(400).json({ error: 'linea, motivo_id, fecha_inicio y hora_inicio son requeridos' });
  }
  const l = lineaKey(linea);
  const pdb = dbProd.read();

  // Lookup motivo name según línea
  const motivosKey = `motivos_paro_${linea === 'Baker' ? 'baker' : linea === 'L1' ? 'l1' : l}`;
  const motivos = pdb[motivosKey] || [];
  const motivoObj = motivos.find(m => String(m.id) === String(motivo_id));
  if (!motivoObj) return res.status(400).json({ error: 'Motivo de paro no encontrado' });

  let sub_motivo = null;
  if (sub_motivo_id) {
    const subKey = `sub_motivos_paro_${linea === 'Baker' ? 'baker' : linea === 'L1' ? 'l1' : l}`;
    const found = (pdb[subKey] || []).find(s => String(s.id) === String(sub_motivo_id));
    if (found) sub_motivo = found;
  }

  // Resolver turno: L4 post-cutover → TL4
  const ctx = resolveTurnoContext(pdb, linea, fecha_inicio, hora_inicio);
  const turno = ctx.turno;
  const fueraDeTurno = !ctx.activo || !ctx.en_ventana;
  if (fueraDeTurno && override_turno !== true) {
    return res.status(409).json({
      error: ctx.activo
        ? `Fuera del horario de ${ctx.turno} (${ctx.hora_entrada}–${ctx.hora_salida})`
        : `El turno ${ctx.turno} no está activo para ${linea} en esta fecha`,
      requiere_override: true
    });
  }
  if (fueraDeTurno && (typeof override_motivo !== 'string' || !override_motivo.trim())) {
    return res.status(400).json({ error: 'override_motivo es requerido para registrar un paro fuera de turno' });
  }
  const duracion_min = (fecha_fin && hora_fin)
    ? Math.round((new Date(`${fecha_fin}T${hora_fin}:00`) - new Date(`${fecha_inicio}T${hora_inicio}:00`)) / 60000)
    : null;

  const dateStr = fecha_inicio.replace(/-/g, '');
  let parosList, folio, id;
  if (linea === 'Baker') {
    if (!pdb.paros_baker) pdb.paros_baker = [];
    parosList = pdb.paros_baker;
    const prefix = `BKRP-${dateStr}-`;
    const existing = parosList.filter(p => p.folio && p.folio.startsWith(prefix));
    const nextNum = existing.length ? Math.max(...existing.map(p => parseInt(p.folio.slice(prefix.length), 10) || 0)) + 1 : 1;
    folio = `${prefix}${padNum(nextNum)}`;
    id = dbProd.nextId(parosList);
  } else if (linea === 'L1') {
    if (!pdb.paros_l1) pdb.paros_l1 = [];
    parosList = pdb.paros_l1;
    const prefix = `L1P-${dateStr}-`;
    const existing = parosList.filter(p => p.folio && p.folio.startsWith(prefix));
    const nextNum = existing.length ? Math.max(...existing.map(p => parseInt(p.folio.slice(prefix.length), 10) || 0)) + 1 : 1;
    folio = `${prefix}${padNum(nextNum)}`;
    id = dbProd.nextId(parosList);
  } else {
    if (!pdb.paros) pdb.paros = [];
    parosList = pdb.paros;
    const prefix = `PR-${linea.toUpperCase()}-${dateStr}-`;
    const existing = parosList.filter(p => p.folio && p.folio.startsWith(prefix));
    const nextNum = existing.length ? Math.max(...existing.map(p => parseInt(p.folio.slice(prefix.length), 10) || 0)) + 1 : 1;
    folio = `${prefix}${padNum(nextNum)}`;
    id = dbProd.nextId(parosList);
  }

  const paro = {
    id, folio, linea,
    motivo_id: Number(motivo_id),
    motivo: motivoObj.nombre,
    sub_motivo_id: sub_motivo ? Number(sub_motivo_id) : null,
    sub_motivo: sub_motivo ? sub_motivo.nombre : null,
    fecha_inicio, hora_inicio, turno,
    fecha_fin: fecha_fin || null,
    hora_fin:  hora_fin  || null,
    duracion_min,
    estado: fecha_fin ? 'cerrado' : 'activo',
    registrado_por: req.prodUser?.nombre || 'Admin',
    override_turno: fueraDeTurno,
    override_motivo: fueraDeTurno ? override_motivo.trim() : null,
    override_por: fueraDeTurno ? (req.prodUser?.nombre || 'Admin') : null,
    creado_admin: true,
    corregido: false,
    created_at: new Date().toISOString()
  };

  parosList.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

router.get('/paros/:linea/activo', (req, res) => {
  const { linea } = req.params;
  const pdb = dbProd.read();
  // Un paro es activo si tiene estado='activo' O simplemente no tiene fecha_fin
  const paro = (pdb.paros || []).find(p =>
    p.linea === linea && !p.fecha_fin && p.estado !== 'cerrado'
  ) || null;
  res.json({ paro });
});

router.get('/paros/:linea', (req, res) => {
  const { linea } = req.params;
  const { fecha, turno } = req.query;
  const pdb = dbProd.read();
  let paros = (pdb.paros || []).filter(p => p.linea === linea);
  paros = paros.map(p => {
    const ctx = getParoOperationalContext(p, pdb);
    return { ...p, turno: ctx.turno, fecha_operativa: ctx.fecha_operativa };
  });
  if (fecha) paros = paros.filter(p => p.fecha_operativa === fecha);
  if (turno) paros = paros.filter(p => p.turno === turno);
  res.json(paros);
});

// POST /paros/recalcular-deduccion — admin: aplica deduccion_min a paros "tiempo de máquina" sin deducción previa
router.post('/paros/recalcular-deduccion', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  const FIJOS = { L3: 15, L4: 5, L1: 13.5, Baker: 13.5 };
  const normText = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Construir set de motivo_id marcados como es_tiempo_maquina en el catálogo
  const tmIds = new Set();
  for (const col of ['l3','l4','baker','l1']) {
    for (const m of (pdb[`motivos_paro_${col}`] || [])) {
      if (m.es_tiempo_maquina) tmIds.add(String(m.id));
    }
  }
  const esTM = p => tmIds.has(String(p.motivo_id)) || normText(p.motivo).includes('maquina');

  let count = 0;

  // paros L3/L4 — siempre sobreescribe deduccion_min para corregir datos con fórmula anterior
  for (let i = 0; i < (pdb.paros || []).length; i++) {
    const p = pdb.paros[i];
    if (!p.fecha_fin || !p.duracion_min) continue;
    if (!esTM(p)) continue;
    const fijo = FIJOS[p.linea] ?? 0;
    const deduccion = Math.min(fijo, p.duracion_min);
    if (deduccion > 0) { pdb.paros[i] = { ...p, deduccion_min: deduccion, tolerancia_tiempo_maquina: true }; count++; }
  }
  // paros Baker
  for (let i = 0; i < (pdb.paros_baker || []).length; i++) {
    const p = pdb.paros_baker[i];
    if (!p.fecha_fin || !p.duracion_min) continue;
    if (!esTM(p)) continue;
    const deduccion = Math.min(13.5, p.duracion_min);
    if (deduccion > 0) { pdb.paros_baker[i] = { ...p, deduccion_min: deduccion, tolerancia_tiempo_maquina: true }; count++; }
  }
  // paros L1
  for (let i = 0; i < (pdb.paros_l1 || []).length; i++) {
    const p = pdb.paros_l1[i];
    if (!p.fecha_fin || !p.duracion_min) continue;
    if (!esTM(p)) continue;
    const deduccion = Math.min(13.5, p.duracion_min);
    if (deduccion > 0) { pdb.paros_l1[i] = { ...p, deduccion_min: deduccion, tolerancia_tiempo_maquina: true }; count++; }
  }

  if (count > 0) dbProd.write(pdb);
  res.json({ updated: count });
});

// POST /vincular-ot — vincula un paro existente con una OT de mantenimiento nueva
router.post('/vincular-ot', produccionAllowRoles('produccion'), (req, res) => {
  const { linea, paro_id, equipo_id, descripcion_falla, prioridad = 'alta' } = req.body || {};
  if (!linea || !paro_id) return res.status(400).json({ error: 'linea y paro_id requeridos' });

  const mdb = readMant();
  if (!mdb.settings?.integracion_produccion_activa) {
    return res.status(400).json({ error: 'Integración producción-mantenimiento no activa' });
  }

  // Localizar paro
  const pdb = dbProd.read();
  const parosKey = linea === 'baker' ? 'paros_baker' : linea === 'l1' ? 'paros_l1' : 'paros';
  const arr = pdb[parosKey] || [];
  const paroIdx = arr.findIndex(p => String(p.id) === String(paro_id));
  if (paroIdx === -1) return res.status(404).json({ error: 'Paro no encontrado' });
  const paro = arr[paroIdx];

  // Crear OT en mantenimiento
  const now = new Date().toISOString();
  const folio = nextMantFolio(mdb);
  const ot = {
    id: nextMantId(mdb.ordenes_mantenimiento || []),
    folio,
    tipo: 'correctivo_urgente',
    status: 'abierta',
    prioridad: prioridad || 'alta',
    equipo_id: equipo_id ? Number(equipo_id) : null,
    parte_equipo_id: null,
    descripcion: descripcion_falla || `Paro en ${linea.toUpperCase()}: ${paro.motivo}`,
    descripcion_falla: descripcion_falla || '',
    motivo_paro: paro.motivo || null,
    departamento_nombre: linea.toUpperCase(),
    departamento_id: null,
    solicitante_user_id: req.prodUser?.id || null,
    solicitante_nombre: req.prodUser?.nombre || null,
    tecnico_asignado_id: null,
    fecha_solicitud: nowDateStr(),
    fecha_requerida: null,
    programado_id: null,
    origen_produccion: { linea, paro_id: Number(paro_id), folio_paro: paro.folio || null },
    created_at: now,
    updated_at: now,
  };
  if (!mdb.ordenes_mantenimiento) mdb.ordenes_mantenimiento = [];
  mdb.ordenes_mantenimiento.push(ot);
  writeMant(mdb);

  // Marcar paro como vinculado a OT
  paro.ot_mantenimiento_id = ot.id;
  paro.ot_folio = ot.folio;
  pdb[parosKey][paroIdx] = paro;
  dbProd.write(pdb);

  res.status(201).json({ ot, paro });
});

router.post('/paros/:linea', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const { motivo_id, sub_motivo_id } = req.body || {};
  if (!motivo_id) return res.status(400).json({ error: 'motivo_id es requerido' });

  const pdb = dbProd.read();
  const l = lineaKey(linea);

  // Candado: no permitir dos paros activos simultáneos para la misma línea
  const openParo = (pdb.paros || []).find(p => p.linea === linea && !p.fecha_fin && p.estado !== 'cerrado');
  if (openParo) {
    return res.status(409).json({
      error: `Ya hay un paro activo en ${linea}: "${openParo.motivo}" (desde ${openParo.hora_inicio}). Ciérralo antes de registrar uno nuevo.`
    });
  }

  const motivos = pdb[`motivos_paro_${l}`] || [];
  const motivo = motivos.find(m => String(m.id) === String(motivo_id));
  if (!motivo) return res.status(400).json({ error: 'Motivo de paro no encontrado' });

  let sub_motivo = null;
  if (sub_motivo_id) {
    const sub_motivos = pdb[`sub_motivos_paro_${l}`] || [];
    sub_motivo = sub_motivos.find(s => String(s.id) === String(sub_motivo_id) && String(s.motivo_id) === String(motivo_id));
  }

  const fecha_inicio = req.body.fecha_inicio || nowDateStr();
  const hora_inicio  = req.body.hora_inicio  || nowTimeStr();
  const ctxParo = resolveTurnoContext(pdb, linea, fecha_inicio, hora_inicio);
  const fecha_turno_paro = ctxParo.fecha_turno;
  const turno = ctxParo.turno;

  // Validar que el turno/día está activo en el calendario
  if (!ctxParo.activo) {
    return res.status(409).json({ error: `El turno ${turno} no está activo para ${linea} en esta fecha` });
  }
  if (!ctxParo.en_ventana) {
    return res.status(409).json({ error: `Fuera del horario de ${turno} (${ctxParo.hora_entrada}–${ctxParo.hora_salida})` });
  }

  const id = dbProd.nextId(pdb.paros || []);
  const dateStr = fecha_inicio.replace(/-/g, '');
  const prefix = `PR-${linea.toUpperCase()}-${dateStr}-`;
  const existing = (pdb.paros || []).filter(p => p.folio && p.folio.startsWith(prefix));
  const nextNum = existing.length > 0 ? Math.max(...existing.map(p => parseInt(p.folio.slice(prefix.length), 10) || 0)) + 1 : 1;
  const folio = `${prefix}${padNum(nextNum)}`;

  const paro = {
    id,
    folio,
    linea,
    motivo_id: Number(motivo_id),
    motivo: motivo.nombre,
    sub_motivo_id: sub_motivo ? Number(sub_motivo_id) : null,
    sub_motivo: sub_motivo ? sub_motivo.nombre : null,
    fecha_inicio,
    hora_inicio,
    fecha_fin: null,
    hora_fin: null,
    duracion_min: null,
    estado: 'activo',
    turno,
    registrado_por: req.prodUser?.nombre || 'Operador',
    created_at: new Date().toISOString()
  };

  if (!pdb.paros) pdb.paros = [];
  pdb.paros.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// POST /paros/:linea/pendiente-motivo — crea paro automático sin motivo (15 min inactividad)
router.post('/paros/:linea/pendiente-motivo', produccionAuthRequired, (req, res) => {
  const { linea } = req.params;
  const { hora_inicio, fecha_inicio } = req.body || {};
  const pdb = dbProd.read();

  // Candado 1: si ya hay paro activo, devolver 409 con el paro existente
  const openParo = (pdb.paros || []).find(p => p.linea === linea && !p.fecha_fin && p.estado !== 'cerrado');
  if (openParo) return res.status(409).json({ error: 'Ya hay un paro activo', paro: openParo });

  let _fecha = fecha_inicio || nowDateStr();
  let _hora  = hora_inicio  || nowTimeStr();

  // Candado 2: ajustar hora_inicio al fin del paro cerrado más reciente en este período.
  // Evita solapamientos cuando el pendiente_motivo se crea retroactivo a la última carga
  // y ya existe uno o más paros cerrados que cubren parte de ese tiempo.
  const _toMs = (f, h) => new Date(`${f}T${h}:00`).getTime();
  const _cerradosPosterior = (pdb.paros || []).filter(p =>
    p.linea === linea && p.fecha_fin && p.hora_fin &&
    _toMs(p.fecha_fin, p.hora_fin) > _toMs(_fecha, _hora)
  );
  if (_cerradosPosterior.length > 0) {
    const _masReciente = _cerradosPosterior.reduce((max, p) =>
      _toMs(p.fecha_fin, p.hora_fin) > _toMs(max.fecha_fin, max.hora_fin) ? p : max
    );
    _fecha = _masReciente.fecha_fin;
    _hora  = _masReciente.hora_fin;
  }

  // Candado 3: si el inicio ajustado tiene más de 2 horas, ya no corresponde al turno actual
  if ((Date.now() - _toMs(_fecha, _hora)) / 60000 > 120) {
    return res.json({ skipped: true, reason: 'Última actividad fuera del turno actual' });
  }

  // L4 post-cutover: usar TL4
  const ctx = resolveTurnoContext(pdb, linea, _fecha, _hora);
  const turno = ctx.turno;
  if (!ctx.activo || !ctx.en_ventana) {
    return res.json({ skipped: true, reason: ctx.activo ? 'fuera_horario' : 'turno_inactivo' });
  }
  const currentCtx = resolveTurnoContext(pdb, linea, nowDateStr(), nowTimeStr());
  if (!currentCtx.activo || !currentCtx.en_ventana ||
      currentCtx.fecha_turno !== ctx.fecha_turno || currentCtx.turno !== ctx.turno) {
    return res.json({ skipped: true, reason: 'fuera_turno_actual' });
  }

  if (!pdb.paros) pdb.paros = [];
  const id = dbProd.nextId(pdb.paros);
  const dateStr = _fecha.replace(/-/g, '');
  const prefix = `PR-${linea.toUpperCase()}-${dateStr}-`;
  const existing = pdb.paros.filter(p => p.folio && p.folio.startsWith(prefix));
  const nextNum = existing.length > 0 ? Math.max(...existing.map(p => parseInt(p.folio.slice(prefix.length), 10) || 0)) + 1 : 1;

  const paro = {
    id, folio: `${prefix}${padNum(nextNum)}`, linea,
    motivo_id: null, motivo: 'Paro automático abierto',
    sub_motivo_id: null, sub_motivo: null,
    fecha_inicio: _fecha, hora_inicio: _hora,
    fecha_fin: null, hora_fin: null, duracion_min: null, deduccion_min: null,
    tipo: 'pendiente_motivo', estado: 'activo', turno,
    registrado_por: req.prodUser?.nombre || 'Sistema',
    created_at: new Date().toISOString()
  };
  pdb.paros.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// PATCH /paros/:linea/:id/definir-motivo — define motivo en paro pendiente_motivo y lo cierra
router.patch('/paros/:linea/:id/definir-motivo', produccionAuthRequired, (req, res) => {
  const { linea, id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id) && p.linea === linea);
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const paro = pdb.paros[idx];
  if (paro.tipo !== 'pendiente_motivo') return res.status(400).json({ error: 'Solo aplica a paros pendiente_motivo' });
  if (paro.fecha_fin) return res.status(409).json({ error: 'El paro ya está cerrado' });

  const { motivo_id, sub_motivo_id } = req.body || {};
  if (!motivo_id) return res.status(400).json({ error: 'motivo_id es requerido' });

  const l = lineaKey(linea);
  const motivos = pdb[`motivos_paro_${l}`] || [];
  const motivo = motivos.find(m => String(m.id) === String(motivo_id));
  if (!motivo) return res.status(400).json({ error: 'Motivo no encontrado' });

  let sub_motivo = null;
  if (sub_motivo_id) {
    const subs = pdb[`sub_motivos_paro_${l}`] || [];
    sub_motivo = subs.find(s => String(s.id) === String(sub_motivo_id) && String(s.motivo_id) === String(motivo_id));
  }

  const fecha_fin = req.body.fecha_fin || nowDateStr();
  const hora_fin  = req.body.hora_fin  || nowTimeStr();
  const duracion_min = Math.round(
    (new Date(`${fecha_fin}T${hora_fin}:00`) - new Date(`${paro.fecha_inicio}T${paro.hora_inicio}:00`)) / 60000
  );

  // Calcular deduccion_min si el usuario activó la tolerancia de tiempo de máquina
  let deduccion_min = null;
  let tolerancia_tiempo_maquina = false;
  if (req.body.aplicar_tolerancia === true) {
    const fijo = { L3: 15, L4: 5, L1: 13.5, Baker: 13.5 }[linea] ?? 0;
    const val = Math.min(fijo, duracion_min);
    if (val > 0) { deduccion_min = val; tolerancia_tiempo_maquina = true; }
  }

  pdb.paros[idx] = {
    ...paro,
    motivo_id: Number(motivo_id), motivo: motivo.nombre,
    sub_motivo_id: sub_motivo ? Number(sub_motivo_id) : null,
    sub_motivo: sub_motivo ? sub_motivo.nombre : null,
    fecha_fin, hora_fin, duracion_min, deduccion_min,
    tolerancia_tiempo_maquina,
    estado: 'cerrado'
  };
  dbProd.write(pdb);
  res.json(pdb.paros[idx]);
});

// ─── Paro automático por cambio de turno ─────────────────────────────────────

router.post('/paros/:linea/cambio-turno', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const pdb = dbProd.read();
  const l = lineaKey(linea);

  // Si ya hay un paro activo, no crear otro
  const yaActivo = (pdb.paros || []).find(p => p.linea === linea && !p.fecha_fin && p.estado !== 'cerrado');
  if (yaActivo) return res.status(409).json({ error: 'Ya hay un paro activo', paro: yaActivo });

  // Buscar o crear el motivo "Cambio de turno" en el catálogo de la línea
  const motivoKey = `motivos_paro_${l}`;
  pdb[motivoKey] = pdb[motivoKey] || [];
  let motivo = pdb[motivoKey].find(m => m.nombre === 'Cambio de turno');
  if (!motivo) {
    motivo = {
      id: dbProd.nextId(pdb[motivoKey]),
      nombre: 'Cambio de turno',
      descripcion: 'Paro automático generado al cerrar sesión por fin de turno',
      activo: true,
      created_at: new Date().toISOString()
    };
    pdb[motivoKey].push(motivo);
  }

  const fecha_inicio = nowDateStr();
  const hora_inicio  = nowTimeStr();
  const ctxCT = resolveTurnoContext(pdb, linea, fecha_inicio, hora_inicio);
  const fecha_turno_ct = ctxCT.fecha_turno;
  const turno        = ctxCT.turno;
  if (linea === 'L4' && l4UsesTL4(pdb, fecha_inicio)) {
    if (!ctxCT.activo) return res.status(409).json({ error: 'TL4 no está activo en esta fecha' });
    const diffSalida = Math.abs(toMins(hora_inicio) - toMins(ctxCT.hora_salida));
    if (diffSalida > 2) {
      return res.status(409).json({
        error: `El cambio de turno TL4 solo puede registrarse al cierre (${ctxCT.hora_salida})`
      });
    }
  }
  pdb.paros          = pdb.paros || [];
  const id           = dbProd.nextId(pdb.paros);
  const dateStr      = fecha_inicio.replace(/-/g, '');
  const prefix       = `PR-${linea.toUpperCase()}-${dateStr}-`;
  const existentes   = pdb.paros.filter(p => p.folio && p.folio.startsWith(prefix));
  const nextNum      = existentes.length > 0 ? Math.max(...existentes.map(p => parseInt(p.folio.slice(prefix.length), 10) || 0)) + 1 : 1;
  const folio        = `${prefix}${padNum(nextNum)}`;

  const paro = {
    id, folio, linea,
    motivo_id: motivo.id,
    motivo: motivo.nombre,
    sub_motivo_id: null,
    sub_motivo: null,
    tipo: 'cambio_turno',
    estado: 'activo',
    fecha_inicio, hora_inicio,
    fecha_fin: null, hora_fin: null,
    duracion_min: null,
    turno,
    registrado_por: req.prodUser?.nombre || 'Sistema',
    created_at: new Date().toISOString()
  };

  pdb.paros.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// ─── Paro automático por turno sin actividad ─────────────────────────────────
router.post('/paros/:linea/auto-sin-actividad', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const { fecha, turno } = req.body || {};
  if (!fecha || !turno) return res.status(400).json({ error: 'fecha y turno requeridos' });

  const pdb = dbProd.read();

  // L4 en modo TL4: solo acepta turno 'TL4', no T1/T2/T3
  if (linea === 'L4' && l4UsesTL4(pdb, fecha)) {
    if (turno !== 'TL4') return res.json({ skipped: true, reason: 'l4_usa_tl4' });
  }
  // L4 en modo legacy: no acepta TL4
  if (linea === 'L4' && !l4UsesTL4(pdb, fecha) && turno === 'TL4') {
    return res.json({ skipped: true, reason: 'l4_no_usa_tl4' });
  }

  // Verificar que el turno está activo en el calendario
  if (!isTurnoActivo(pdb, linea, turno, fecha)) {
    return res.json({ skipped: true, reason: 'turno_inactivo' });
  }

  // Verificar que no hay cargas en ese turno/fecha/línea
  // Usa fecha_turno (campo canónico para T3) con fallback a fecha_carga para registros anteriores
  const cargasEnTurno = (pdb.cargas || []).filter(c =>
    c.linea === linea && c.turno === turno &&
    ((c.fecha_turno || c.fecha_carga) === fecha)
  );
  if (cargasEnTurno.length > 0) return res.json({ skipped: true, reason: 'hay_cargas' });

  // Verificar que no hay paros ya registrados para ese turno/fecha/línea
  const parosEnTurno = (pdb.paros || []).filter(p =>
    p.linea === linea && p.turno === turno && p.fecha_inicio === fecha
  );
  if (parosEnTurno.length > 0) return res.json({ skipped: true, reason: 'hay_paros' });

  // Horarios: para TL4 usar config dinámica, para T1/T2/T3 usar fijos
  let st;
  if (turno === 'TL4') {
    const weekStart = getWeekStart(fecha);
    const l4cfg = getTurnoL4Config(pdb, weekStart);
    const dia = getDiaSemana(fecha);
    const diaConf = l4cfg.dias[dia];
    if (!diaConf || !diaConf.activo) return res.json({ skipped: true, reason: 'dia_inactivo_tl4' });
    const durMin = toMins(diaConf.hora_salida) - toMins(diaConf.hora_entrada);
    st = { h_ini: diaConf.hora_entrada, h_fin: diaConf.hora_salida, dur: durMin };
  } else {
    const SHIFT_TIMES = {
      T1: { h_ini: '06:30', h_fin: '14:30', dur: 480 },
      T2: { h_ini: '14:30', h_fin: '21:30', dur: 420 },
      T3: { h_ini: '21:30', h_fin: '06:30', dur: 540 }
    };
    st = SHIFT_TIMES[turno];
    if (!st) return res.status(400).json({ error: 'Turno inválido' });
  }

  // T3 termina al día siguiente
  let fecha_fin = fecha;
  if (turno === 'T3') {
    const d = new Date(fecha + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    fecha_fin = d.toISOString().slice(0, 10);
  }

  // Buscar o crear motivo "Turno no trabajado" en el catálogo de la línea
  const l = lineaKey(linea);
  const motivoKey = `motivos_paro_${l}`;
  pdb[motivoKey] = pdb[motivoKey] || [];
  let motivo = pdb[motivoKey].find(m => m.nombre === 'Turno no trabajado');
  if (!motivo) {
    motivo = {
      id: dbProd.nextId(pdb[motivoKey]),
      nombre: 'Turno no trabajado',
      descripcion: 'Paro automático — turno completo sin registros de producción',
      activo: true,
      created_at: new Date().toISOString()
    };
    pdb[motivoKey].push(motivo);
  }

  pdb.paros = pdb.paros || [];
  const id = dbProd.nextId(pdb.paros);
  const dateStr = fecha.replace(/-/g, '');
  const prefix = `PR-${linea.toUpperCase()}-${dateStr}-`;
  const existentes = pdb.paros.filter(p => p.folio && p.folio.startsWith(prefix));
  const nextNum = existentes.length > 0 ? Math.max(...existentes.map(p => parseInt(p.folio.slice(prefix.length), 10) || 0)) + 1 : 1;
  const folio = `${prefix}${padNum(nextNum)}`;

  const paro = {
    id, folio, linea,
    motivo_id: motivo.id,
    motivo: motivo.nombre,
    sub_motivo_id: null, sub_motivo: null,
    tipo: 'automatico',
    estado: 'cerrado',
    fecha_inicio: fecha, hora_inicio: st.h_ini,
    fecha_fin, hora_fin: st.h_fin,
    duracion_min: st.dur,
    turno,
    registrado_por: 'Sistema',
    created_at: new Date().toISOString()
  };

  pdb.paros.push(paro);
  dbProd.write(pdb);
  res.status(201).json({ created: true, paro });
});

router.patch('/paros/:linea/:id/cerrar', produccionAllowRoles('produccion'), (req, res) => {
  const { linea, id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id) && p.linea === linea);
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const paro = pdb.paros[idx];
  if (paro.fecha_fin) return res.status(409).json({ error: 'El paro ya fue cerrado' });

  const fecha_fin = req.body?.fecha_fin || nowDateStr();
  const hora_fin  = req.body?.hora_fin  || nowTimeStr();
  paro.fecha_fin  = fecha_fin;
  paro.hora_fin   = hora_fin;
  paro.estado     = 'cerrado';
  paro.duracion_min = Math.round(
    (new Date(`${fecha_fin}T${hora_fin}:00`) - new Date(`${paro.fecha_inicio}T${paro.hora_inicio}:00`)) / 60000
  );

  dbProd.write(pdb);
  res.json(pdb.paros[idx]);
});

// Admin: cerrar paro por id (sin requerir linea en params)
router.patch('/paros/:id/admin-cerrar', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const paro = pdb.paros[idx];
  if (paro.fecha_fin) return res.status(409).json({ error: 'El paro ya fue cerrado' });

  const fecha_fin = req.body?.fecha_fin || nowDateStr();
  const hora_fin  = req.body?.hora_fin  || nowTimeStr();
  paro.fecha_fin  = fecha_fin;
  paro.hora_fin   = hora_fin;
  paro.estado     = 'cerrado';
  paro.duracion_min = Math.round(
    (new Date(`${fecha_fin}T${hora_fin}:00`) - new Date(`${paro.fecha_inicio}T${paro.hora_inicio}:00`)) / 60000
  );
  paro.cerrado_por_admin = req.prodUser?.nombre || 'Admin';

  dbProd.write(pdb);
  res.json(pdb.paros[idx]);
});

// Admin: editar paro (marca como corregido) — busca en L3/L4, Baker y L1
router.patch('/paros/:id/admin-editar', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb  = dbProd.read();
  const body = req.body || {};

  // Localizar el paro en cualquiera de las 3 colecciones
  let collection = null, idx = -1;
  const hint = (body._linea || '').toLowerCase();
  const searchOrder = hint === 'baker' ? ['paros_baker', 'paros', 'paros_l1']
    : hint === 'l1'   ? ['paros_l1',    'paros', 'paros_baker']
    : ['paros', 'paros_baker', 'paros_l1'];

  for (const col of searchOrder) {
    const i = (pdb[col] || []).findIndex(p => String(p.id) === String(id));
    if (i !== -1) { collection = col; idx = i; break; }
  }
  if (!collection) return res.status(404).json({ error: 'Paro no encontrado' });

  const paro   = pdb[collection][idx];
  const campos = ['motivo', 'sub_motivo', 'motivo_id', 'sub_motivo_id', 'fecha_inicio', 'hora_inicio', 'fecha_fin', 'hora_fin', 'turno'];
  for (const f of campos) {
    if (body[f] !== undefined) paro[f] = body[f] || null;
  }
  // La fecha/turno operativos se derivan siempre de la hora de inicio. Así un
  // paro de T3 registrado después de medianoche sigue perteneciendo al día en
  // que comenzó el turno.
  const lineaParo = collection === 'paros_baker'
    ? 'Baker'
    : collection === 'paros_l1'
      ? 'L1'
      : paro.linea;
  if (paro.fecha_inicio && paro.hora_inicio && lineaParo) {
    const paroCtx = resolveTurnoContext(pdb, lineaParo, paro.fecha_inicio, paro.hora_inicio);
    paro.turno = paroCtx.turno;
    paro.turno_operativo = paroCtx.turno;
    paro.fecha_operativa = paroCtx.fecha_turno;
  }
  // Recalcular duración si hay fecha_fin
  if (paro.fecha_fin && paro.hora_fin && paro.fecha_inicio && paro.hora_inicio) {
    paro.duracion_min = Math.round(
      (new Date(`${paro.fecha_fin}T${paro.hora_fin}:00`) - new Date(`${paro.fecha_inicio}T${paro.hora_inicio}:00`)) / 60000
    );
  }
  paro.corregido      = true;
  paro.corregido_por  = req.prodUser?.nombre || 'Admin';
  paro.corregido_at   = new Date().toISOString();

  dbProd.write(pdb);
  res.json(pdb[collection][idx]);
});

// Admin: eliminar paro (L3/L4 en pdb.paros, Baker en pdb.paros_baker)
router.delete('/paros/:id', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();

  // Buscar en paros regulares (L3/L4)
  let idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id));
  if (idx !== -1) {
    const [eliminado] = pdb.paros.splice(idx, 1);
    dbProd.write(pdb);
    return res.json({ ok: true, eliminado });
  }

  // Buscar en paros Baker
  idx = (pdb.paros_baker || []).findIndex(p => String(p.id) === String(id));
  if (idx !== -1) {
    const [eliminado] = pdb.paros_baker.splice(idx, 1);
    dbProd.write(pdb);
    return res.json({ ok: true, eliminado });
  }

  // Buscar en paros L1
  idx = (pdb.paros_l1 || []).findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const [eliminado] = pdb.paros_l1.splice(idx, 1);
  dbProd.write(pdb);
  res.json({ ok: true, eliminado });
});

// ─── Pizarrón helpers (módulo-nivel, reutilizables) ──────────────────────────

const TURNOS_DEF = {
  T1: { start: 6 * 60 + 30,  hours: 8 },  // 06:30–14:30
  T2: { start: 14 * 60 + 30, hours: 7 },  // 14:30–21:30
  T3: { start: 21 * 60 + 30, hours: 9 }   // 21:30–06:30+1
};

// ── Arranque de lunes: herramentales cargados que no descargan en T1 del lunes ─
// Estos ciclos se descuentan del objetivo para no penalizar la eficiencia del arranque.
const ARRANQUE_LUNES = { L3: 5, L4: 6, Baker: 7, L1: 7 };

// ── Constantes TL4 ───────────────────────────────────────────────────────────
// Fecha de corte: desde esta fecha en adelante, L4 siempre usa TL4.
// Antes de esta fecha: L4 usa TL4 solo si hay config explicita para la semana.
const L4_TL4_CUTOVER_DATE = '2026-08-31';
// Ciclos de arranque diario para L4 en modo TL4 (fijo, no configurable via UI)
const L4_ARRANQUE_CICLOS = 6;
// Las primeras nueve horas de TL4 son tiempo base. Cualquier minuto posterior
// es tiempo adicional y permanece dentro del KPI del mismo dia hasta que la
// ultima carga activa de L4 sea descargada.
const L4_TIEMPO_BASE_MIN = 9 * 60;

// Retorna true si la fecha YYYY-MM-DD es lunes
function isLunes(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 1;
}

// Calcula el objetivo acumulado hasta tElap horas del turno usando los ciclos_obj
// ajustados por slot (ya incluyen el descuento de arranque de lunes).
// Para turnos sin descuento: resultado ≈ ciclos_obj_rate * tElap.
function computeObjElapsed(slots, tElap) {
  const fullSlots = Math.floor(tElap);
  const frac = tElap - fullSlots;
  let obj = 0;
  for (let i = 0; i < Math.min(fullSlots, slots.length); i++) obj += slots[i].ciclos_obj;
  if (frac > 0 && fullSlots < slots.length) obj += slots[fullSlots].ciclos_obj * frac;
  return obj;
}

// Como computeObjElapsed pero usa ciclos_obj_adj (ajustado por paros no-eficiencia).
function computeObjElapsedAdj(slots, tElap) {
  const fullSlots = Math.floor(tElap);
  const frac = tElap - fullSlots;
  let obj = 0;
  for (let i = 0; i < Math.min(fullSlots, slots.length); i++) {
    obj += (slots[i].ciclos_obj_adj != null ? slots[i].ciclos_obj_adj : slots[i].ciclos_obj);
  }
  if (frac > 0 && fullSlots < slots.length) {
    const adjObj = slots[fullSlots].ciclos_obj_adj != null ? slots[fullSlots].ciclos_obj_adj : slots[fullSlots].ciclos_obj;
    obj += adjObj * frac;
  }
  return obj;
}

function toMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minsToTime(totalMins) {
  const mins = Math.max(0, Math.min(1440, Math.round(Number(totalMins) || 0)));
  if (mins === 1440) return '24:00';
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// Fuente unica de la ventana operativa TL4. La salida configurada conserva la
// ventana para iniciar cargas; la ventana KPI puede extenderse cuando existen
// cargas activas o cuando la ultima descarga ocurrio despues de esa salida.
// La extension nunca cambia la fecha operativa ni permite cruzar medianoche.
function getTL4EffectiveWindow(pdb, targetDate) {
  const cfg = getTurnoL4Config(pdb, getWeekStart(targetDate));
  const diaConf = cfg.dias[getDiaSemana(targetDate)];
  if (!diaConf || !diaConf.activo || !diaConf.hora_entrada || !diaConf.hora_salida) {
    return { activo: false, targetDate, cargas_activas: 0, tiempo_extra_activo: false };
  }

  const startMins = toMins(diaConf.hora_entrada);
  const scheduledEndMins = toMins(diaConf.hora_salida);
  if (scheduledEndMins <= startMins) {
    return { activo: false, targetDate, cargas_activas: 0, tiempo_extra_activo: false };
  }

  const baseEndMins = Math.min(1440, startMins + L4_TIEMPO_BASE_MIN);
  const completed = (pdb.cargas || []).filter(c => {
    if (c.linea !== 'L4' || c.estado === 'cancelado' || !c.fecha_descarga || !c.hora_descarga) return false;
    const descargaMins = toMins(c.hora_descarga);
    return c.fecha_descarga === targetDate && descargaMins >= startMins && descargaMins <= 1440;
  });
  const lastDischargeMins = completed.reduce(
    (max, c) => Math.max(max, toMins(c.hora_descarga)),
    startMins
  );

  const today = nowDateStr();
  const nowMins = toMins(nowTimeStr());
  const activeLoads = targetDate === today
    ? (pdb.cargas || []).filter(c => {
        if (c.linea !== 'L4' || c.estado !== 'activo') return false;
        const fechaCarga = c.fecha_turno || c.fecha_carga;
        const cargaMins = toMins(c.hora_carga || '00:00');
        return fechaCarga === targetDate && cargaMins >= startMins && cargaMins < scheduledEndMins;
      })
    : [];
  const operatingLive = targetDate === today && activeLoads.length > 0 && nowMins >= startMins;

  // minutos_calculo es la duracion que entra a disponibilidad/rendimiento.
  // minutos_render puede completar visualmente la hora abierta para mostrar su
  // avance sin incluirla aun en la eficiencia acumulada.
  let effectiveEndMins = Math.max(scheduledEndMins, lastDischargeMins, operatingLive ? nowMins : 0);
  effectiveEndMins = Math.min(1440, effectiveEndMins);
  let renderEndMins = effectiveEndMins;
  if (operatingLive && nowMins >= scheduledEndMins && nowMins < 1440) {
    const elapsed = Math.max(0, nowMins - startMins);
    renderEndMins = Math.max(
      renderEndMins,
      Math.min(1440, startMins + (Math.floor(elapsed / 60) + 1) * 60)
    );
  }

  const overtimeMins = Math.max(0, effectiveEndMins - baseEndMins);
  return {
    activo: true,
    targetDate,
    hora_entrada: diaConf.hora_entrada,
    hora_salida_programada: diaConf.hora_salida,
    hora_fin_efectiva: minsToTime(effectiveEndMins),
    hora_fin_render: minsToTime(renderEndMins),
    inicio_min: startMins,
    salida_programada_min: scheduledEndMins,
    fin_base_min: baseEndMins,
    fin_efectivo_min: effectiveEndMins,
    fin_render_min: renderEndMins,
    minutos_calculo: Math.max(0, effectiveEndMins - startMins),
    minutos_adicionales: overtimeMins,
    cargas_activas: activeLoads.length,
    operando_en_vivo: operatingLive,
    tiempo_extra_activo: operatingLive && nowMins >= baseEndMins,
    ultima_descarga: completed.length ? minsToTime(lastDischargeMins) : null
  };
}

function slotOverlap(ss, se, paroStart, paroEnd, paroFechaInicio, paroFechaFin, slotDate) {
  function abs(dateStr, t) {
    const d = (new Date(dateStr) - new Date(slotDate)) / 86400000;
    return d * 1440 + toMins(t);
  }
  const ps = abs(paroFechaInicio, paroStart);
  // Paro abierto: usar fecha+hora actual como fin, NO el límite del slot
  const pe = paroFechaFin
    ? abs(paroFechaFin, paroEnd)
    : abs(nowDateStr(), paroEnd);   // paroEnd ya trae nowTimeStr() desde el caller
  // Los callers normalizan las horas a 0..1439. Un slot 23:30–00:30
  // llega como 1410–30 y su final pertenece al día siguiente.
  const slotStart = ss;
  const slotEnd = se <= ss ? se + 1440 : se;
  return Math.max(0, Math.min(slotEnd, pe) - Math.max(slotStart, ps));
}

function addDays(dateStr, n) {
  // Usar mediodía UTC para evitar que la conversión de zona horaria
  // cambie el día calendario (servidor en UTC, clientes en México CDT/CST)
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD estable al mediodía UTC
}

// Objetivo de ciclos por slot con distribución Bresenham.
// Detecta automáticamente el período de la fracción decimal y distribuye
// los ciclos extra al final de cada período.
// Ejemplos:
//   4.5   → período 2 → patrón 4,5,4,5,...
//   4.33  → período 3 → patrón 4,4,5,4,4,5,...  (hora1=4, hora2=4, hora3=5)
//   4.25  → período 4 → patrón 4,4,4,5,...
function slotCiclosObj(ciclos_obj, h) {
  if (Number.isInteger(ciclos_obj)) return ciclos_obj;
  const base = Math.floor(ciclos_obj);
  const frac = ciclos_obj - base;
  // Encontrar período mínimo n (2..12) tal que frac*n ≈ entero (tolerancia 0.015)
  let period = 2;
  for (let n = 2; n <= 12; n++) {
    if (Math.abs(Math.round(frac * n) - frac * n) < 0.015) { period = n; break; }
  }
  const ceilsPerPeriod = Math.round(frac * period);
  // Los slots "ceil" se ubican al final de cada período (ej. posición 2 de 3 para 4.33)
  return (h % period) >= period - ceilsPerPeriod ? Math.ceil(ciclos_obj) : base;
}

// Horas realmente transcurridas en un turno.
// Si el turno está en curso HOY devuelve las horas parciales; si ya terminó o es
// un día histórico devuelve las horas totales del turno (para no distorsionar históricos).
function elapsedHoursForTurno(t, targetDate) {
  const tDef    = TURNOS_DEF[t];
  const nowDate = nowDateStr();
  const nowMins = toMins(nowTimeStr());
  const nextDay = addDays(targetDate, 1);
  const T3_END  = 6 * 60 + 30; // 06:30 — fin del T3 en el día siguiente

  if (t === 'T3') {
    if (nowDate === targetDate && nowMins >= tDef.start) {
      // Primera mitad del T3 (21:30 → 23:59)
      return Math.min(tDef.hours, (nowMins - tDef.start) / 60);
    }
    if (nowDate === nextDay && nowMins < T3_END) {
      // Segunda mitad del T3 (00:00 → 06:30)
      return Math.min(tDef.hours, (1440 - tDef.start + nowMins) / 60);
    }
    return tDef.hours; // T3 ya terminó o es fecha histórica
  }

  // T1 y T2
  if (nowDate !== targetDate) return tDef.hours; // fecha histórica → completo
  const turnoEnd = tDef.start + tDef.hours * 60;
  if (nowMins >= turnoEnd) return tDef.hours;    // turno ya terminó hoy
  if (nowMins <= tDef.start) return tDef.hours;  // aún no inicia (no debería llegar aquí)
  return (nowMins - tDef.start) / 60;            // turno en curso → horas parciales
}

function buildSlotsForLinTur(pdb, config, l, t, targetDate) {
  const ciclos_obj = l === 'L3'
    ? (config.ciclos_objetivo_l3 ?? 2)
    : (config.ciclos_objetivo_l4 ?? 2);
  const tDef    = TURNOS_DEF[t];
  const nextDay = addDays(targetDate, 1);
  const slots   = [];
  let curMins   = tDef.start;

  // Arranque de lunes: descuento de N primeros ciclos del objetivo en T1
  const esLunesT1 = t === 'T1' && isLunes(targetDate);
  let arranqueRestante = esLunesT1 ? (ARRANQUE_LUNES[l] || 0) : 0;
  // patternIdx reinicia el patrón 4,4,5… desde posición 0 tras consumir el descuento
  let patternIdx = 0;

  // Mapa de componentes para calcular piezas_objetivo por ciclo
  const compMap = {};
  for (const c of (pdb[`componentes_${l.toLowerCase()}`] || [])) {
    compMap[String(c.id)] = c;
  }

  for (let h = 0; h < tDef.hours; h++) {
    const ss    = curMins;
    const se    = curMins + 60;
    const ssStr = `${String(Math.floor(ss/60)%24).padStart(2,'0')}:${String(ss%60).padStart(2,'0')}`;
    const seStr = `${String(Math.floor(se/60)%24).padStart(2,'0')}:${String(se%60).padStart(2,'0')}`;

    const slotDate   = (t === 'T3' && ss >= 1440) ? nextDay : targetDate;
    const ssR        = ss % 1440;
    const seR        = se % 1440;
    const crossesMid = ssR > seR; // slot cruza la medianoche

    // Ciclos COMPLETADOS — se cuentan por cuándo se descargan, sin importar cuándo se cargaron
    // Se excluyen registros marcados como cancelados por admin
    const cargasEnSlot = (pdb.cargas || []).filter(c => {
      if (c.linea !== l || !c.fecha_descarga || !c.hora_descarga) return false;
      if (c.estado === 'cancelado') return false;
      const dm = toMins(c.hora_descarga);
      if (crossesMid) {
        return (c.fecha_descarga === slotDate && dm >= ssR) ||
               (c.fecha_descarga === nextDay  && dm <  seR);
      }
      return c.fecha_descarga === slotDate && dm >= ssR && dm < seR;
    });

    // Ciclos contados: todos los descargados (incl. vacios)
    const ciclos_totales  = cargasEnSlot.length;

    // Para calidad y capacidad: solo ciclos con material (no vacíos)
    const cargasNoVacias  = cargasEnSlot.filter(c => !c.es_vacia);
    const ciclos_no_vacios = cargasNoVacias.length;

    // Ciclos buenos: no vacíos y sin defecto (para display)
    const ciclos_buenos   = cargasNoVacias.filter(c => !c.defecto_id).length;

    // Para calidad: excluir herramentales marcados con defecto contemplado (excluir_calidad)
    const herramentalesLinea = pdb[`herramentales_${l.toLowerCase()}`] || [];
    const excluirCalidadIds = new Set(
      herramentalesLinea.filter(h => h.excluir_calidad).map(h => String(h.id))
    );
    const cargasCalidad = cargasNoVacias.filter(c => !excluirCalidadIds.has(String(c.herramental_id)));
    const ciclos_buenos_calidad = cargasCalidad.filter(c => !c.defecto_id).length;

    // Capacidad: piezas reales vs objetivo del catálogo
    let piezas_total     = 0;
    let piezas_obj_total = 0;
    for (const c of cargasNoVacias) {
      piezas_total += (c.cantidad || (Number(c.varillas || 0) * Number(c.piezas_por_varilla || 0)));
      const comp    = c.componente_id ? compMap[String(c.componente_id)] : null;
      piezas_obj_total += comp
        ? (Number(comp.carga_optima_varillas || 0) * Number(comp.piezas_objetivo || 0))
        : 0;
    }
    // Cargas vacías: cuentan en el objetivo pero aportan 0 piezas reales → reducen capacidad
    for (const c of cargasEnSlot.filter(c => c.es_vacia && c.varillas && c.piezas_por_varilla)) {
      piezas_obj_total += Number(c.varillas) * Number(c.piezas_por_varilla);
    }

    // Motivos de paro de esta línea para consultar flags de impacto
    const motivosParoLinea = pdb[`motivos_paro_${l.toLowerCase()}`] || [];
    const motivosParoMap   = {};
    for (const m of motivosParoLinea) motivosParoMap[String(m.id)] = m;

    // Separar paros según su impacto en eficiencia, disponibilidad y rendimiento
    // afecta_eficiencia=Sí → paro PROGRAMADO → reduce el objetivo (ciclos_obj_adj)
    // afecta_eficiencia=No → paro NO programado → objetivo completo, eficiencia penalizada
    let paros_min      = 0; // total de todos los paros
    let paros_min_prog = 0; // paros programados (afecta_eficiencia=Sí) → reducen objetivo
    let paros_min_disp = 0; // paros que afectan disponibilidad
    let paros_min_rend = 0; // paros que afectan rendimiento pero NO disponibilidad
    for (const p of (pdb.paros || []).filter(p => p.linea === l)) {
      const overlap = slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                                  p.fecha_inicio, p.fecha_fin, slotDate);
      if (overlap <= 0) continue;
      const motivo   = motivosParoMap[String(p.motivo_id)];
      const afecEf   = motivo?.afecta_eficiencia    !== false;
      const afecDisp = motivo?.afecta_disponibilidad !== false;
      const afecRend = motivo?.afecta_rendimiento    !== false;
      const efectividad = (p.duracion_min > 0 && p.deduccion_min > 0)
        ? Math.max(0, p.duracion_min - p.deduccion_min) / p.duracion_min : 1;
      const overlapEf = Math.round(overlap * efectividad * 10) / 10;
      paros_min += overlapEf;
      if (afecEf)   paros_min_prog += overlapEf; // programado → reduce objetivo
      if (afecDisp) paros_min_disp += overlapEf;
      if (afecRend) paros_min_rend += overlapEf;
    }
    // Cap: paros no pueden exceder la duración del slot (60 min) — evita inflación por registros solapados
    paros_min      = Math.min(paros_min,      60);
    paros_min_prog = Math.min(paros_min_prog, 60);
    paros_min_disp = Math.min(paros_min_disp, 60);
    paros_min_rend = Math.min(paros_min_rend, 60);

    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    // Arranque lunes T1: reducir objetivo de los primeros slots;
    // al terminar el descuento, el patrón 4,4,5… reinicia desde posición 0.
    let slotObj;
    if (arranqueRestante > 0) {
      const slotObjBase = slotCiclosObj(ciclos_obj, h);
      slotObj = Math.max(0, slotObjBase - arranqueRestante);
      arranqueRestante = Math.max(0, arranqueRestante - slotObjBase);
    } else {
      slotObj = slotCiclosObj(ciclos_obj, esLunesT1 ? patternIdx : h);
      patternIdx++;
    }

    // Ajustar objetivo por paros programados (afecta_eficiencia=Sí)
    const efectivoMin  = Math.max(0, 60 - paros_min_prog);
    const ciclos_obj_adj = r3(slotObj * (efectivoMin / 60));

    // Eficiencia = ciclos / objetivo ajustado; si obj=0 y real=0 → 100%
    const eficiencia    = ciclos_obj_adj > 0 ? r3(ciclos_totales / ciclos_obj_adj) : (ciclos_totales === 0 ? 1 : null);
    // Calidad = buenos / no_vacios — excluye herramentales con defecto contemplado
    const calidad       = cargasCalidad.length > 0 ? r3(ciclos_buenos_calidad / cargasCalidad.length) : null;
    // Capacidad = piezas reales / piezas objetivo (null si sin objetivo en catálogo)
    const capacidad     = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
    // Disponibilidad = (60 - paros_disp) / 60
    const disponibilidad = r3(Math.max(0, 60 - Math.min(paros_min_disp, 60)) / 60);
    // Rendimiento = (tiempo_disponible - paros_rend_dentro_disponible) / tiempo_disponible
    // El tiempo disponible ya excluye paros de disponibilidad; rendimiento mide el uso de ese tiempo
    const tDisp_slot  = Math.max(0, 60 - paros_min_disp);
    const rendimiento = tDisp_slot > 0
      ? r3(Math.max(0, tDisp_slot - Math.min(paros_min_rend, tDisp_slot)) / tDisp_slot)
      : 1;

    slots.push({
      slot: h + 1,
      hora_inicio:      ssStr,
      hora_fin:         seStr,
      ciclos_totales,
      ciclos_obj:       slotObj,
      ciclos_obj_adj,
      ciclos_no_vacios,
      ciclos_buenos,
      // Conteos filtrados para calidad (excluye herramentales con defecto contemplado)
      ciclos_no_vacios_calidad: cargasCalidad.length,
      ciclos_buenos_calidad,
      piezas_total,
      piezas_obj_total,
      paros_min:        Math.round(paros_min      * 10) / 10,
      paros_min_prog:   Math.round(paros_min_prog * 10) / 10,
      paros_min_disp:   Math.round(paros_min_disp * 10) / 10,
      paros_min_rend:   Math.round(paros_min_rend * 10) / 10,
      eficiencia,
      calidad,
      capacidad,
      disponibilidad,
      rendimiento
    });
    curMins += 60;
  }
  return slots;
}

// Horas transcurridas para TL4 (turno dinámico L4)
function elapsedHoursForTL4(targetDate, horaEntrada, horaSalida) {
  const nowDate = nowDateStr();
  const nowMins = toMins(nowTimeStr());
  const entMins = toMins(horaEntrada);
  const salMins = toMins(horaSalida);
  const totalHours = (salMins - entMins) / 60;
  if (nowDate !== targetDate) return totalHours; // fecha historica
  if (nowMins >= salMins) return totalHours;     // turno ya termino
  if (nowMins < entMins) return 0;               // aun no inicia
  return (nowMins - entMins) / 60;               // en curso
}

function getShiftProgress(pdb, linea, turno, targetDate, slots) {
  const today = nowDateStr();
  const nowMins = toMins(nowTimeStr());
  let status = 'completado';
  let elapsedMins = slots.reduce((s, slot) => s + Number(slot.slotDuration || 60), 0);

  if (turno === 'TL4') {
    const window = getTL4EffectiveWindow(pdb, targetDate);
    if (!window.activo) return { status: 'inactivo', elapsedMins: 0 };
    if (targetDate > today) {
      status = 'futuro'; elapsedMins = 0;
    } else if (targetDate === today) {
      const start = window.inicio_min;
      const end = window.fin_efectivo_min;
      if (nowMins < start) { status = 'futuro'; elapsedMins = 0; }
      else if (window.operando_en_vivo || nowMins < end) {
        status = 'en_curso'; elapsedMins = nowMins - start;
      }
    }
  } else {
    const currentOperationalDate = getShiftDate(today, nowTimeStr());
    if (targetDate > currentOperationalDate) {
      status = 'futuro'; elapsedMins = 0;
    } else if (targetDate === today && targetDate !== currentOperationalDate) {
      status = 'futuro'; elapsedMins = 0;
    } else if (targetDate === currentOperationalDate) {
      const order = { T1: 0, T2: 1, T3: 2 };
      const currentTurno = getTurno(nowTimeStr());
      if (order[turno] > order[currentTurno]) { status = 'futuro'; elapsedMins = 0; }
      else if (turno === currentTurno) {
        status = 'en_curso';
        const start = TURNOS_DEF[turno].start;
        elapsedMins = turno === 'T3' && nowMins < start
          ? 1440 - start + nowMins
          : Math.max(0, nowMins - start);
      }
    }
  }

  return { status, elapsedMins: Math.max(0, elapsedMins) };
}

// La hora abierta se reporta como avance, pero no entra al acumulado de
// eficiencia hasta quedar completada.
function annotateLiveSlots(pdb, linea, turno, targetDate, slots) {
  const progress = getShiftProgress(pdb, linea, turno, targetDate, slots);
  let consumed = 0;
  let current = null;
  const completed = [];

  for (const slot of slots) {
    const duration = Number(slot.slotDuration || 60);
    const slotElapsed = Math.max(0, Math.min(duration, progress.elapsedMins - consumed));
    let estado = 'futuro';
    if (progress.status === 'completado' || slotElapsed >= duration) estado = 'completado';
    else if (progress.status === 'en_curso' && progress.elapsedMins >= consumed && progress.elapsedMins < consumed + duration) estado = 'en_curso';

    const progreso = duration > 0 ? slotElapsed / duration : 0;
    const objetivoCompleto = Number(slot.ciclos_obj_adj ?? slot.ciclos_obj ?? 0);
    const objetivoBase = Number(slot.ciclos_obj ?? objetivoCompleto);
    // Para la hora abierta se descuenta del tiempo ya transcurrido únicamente
    // el paro programado ocurrido hasta ahora. Multiplicar otra vez el objetivo
    // ya ajustado por el progreso descontaría el mismo paro dos veces.
    const objetivoTranscurrido = estado === 'en_curso'
      ? objetivoBase * (Math.max(0, slotElapsed - Number(slot.paros_min_prog || 0)) / duration)
      : objetivoCompleto * progreso;
    const ciclosEficiencia = Number(slot.ciclos_eficiencia ?? slot.ciclos_totales ?? 0);
    const eficienciaAvance = objetivoTranscurrido > 0
      ? ciclosEficiencia / objetivoTranscurrido
      : (ciclosEficiencia === 0 && estado === 'en_curso' ? null : slot.eficiencia);

    slot.estado_slot = estado;
    slot.es_hora_en_curso = estado === 'en_curso';
    slot.progreso_pct = Math.round(progreso * 1000) / 10;
    slot.objetivo_transcurrido = Math.round(objetivoTranscurrido * 1000) / 1000;
    slot.eficiencia_avance = eficienciaAvance == null ? null : Math.round(eficienciaAvance * 1000) / 1000;

    if (estado === 'completado') completed.push(slot);
    if (estado === 'en_curso') {
      current = {
        slot: slot.slot,
        hora_inicio: slot.hora_inicio,
        hora_fin: slot.hora_fin,
        es_tiempo_adicional: !!slot.es_tiempo_adicional,
        minutos_tiempo_adicional: Number(slot.minutos_tiempo_adicional || 0),
        progreso_pct: slot.progreso_pct,
        ciclos: Number(slot.ciclos_totales || 0),
        ciclos_eficiencia: ciclosEficiencia,
        objetivo_hora: objetivoCompleto,
        objetivo_transcurrido: slot.objetivo_transcurrido,
        eficiencia_avance: slot.eficiencia_avance
      };
    }
    consumed += duration;
  }

  const ciclos = completed.reduce((s, slot) => s + Number(slot.ciclos_eficiencia ?? slot.ciclos_totales ?? 0), 0);
  const objetivo = completed.reduce((s, slot) => s + Number(slot.ciclos_obj_adj ?? slot.ciclos_obj ?? 0), 0);
  let eficiencia = null;
  if (objetivo > 0) eficiencia = ciclos / objetivo;
  else if (ciclos === 0) eficiencia = 1; // obj=0 y ciclos=0 → 100%

  return {
    status: progress.status,
    slots_completados: completed.length,
    ciclos_eficiencia: ciclos,
    objetivo_eficiencia: objetivo,
    eficiencia,
    hora_en_curso: current
  };
}

// Construir slots hora x hora para L4 con TL4 (turno configurable)
function buildSlotsForL4TL4(pdb, config, targetDate) {
  const window = getTL4EffectiveWindow(pdb, targetDate);
  if (!window.activo) return [];

  const entMins = window.inicio_min;
  const salMins = window.fin_render_min;
  if (salMins <= entMins) return []; // config invalida

  const totalHours = Math.ceil((salMins - entMins) / 60);
  const ciclos_obj = config.ciclos_objetivo_l4 ?? 2;
  const arranqueCiclos = L4_ARRANQUE_CICLOS;

  // Mapa de componentes para piezas_objetivo
  const compMap = {};
  for (const c of (pdb.componentes_l4 || [])) compMap[String(c.id)] = c;

  // Motivos de paro
  const motivosParoLinea = pdb.motivos_paro_l4 || [];
  const motivosParoMap = {};
  for (const m of motivosParoLinea) motivosParoMap[String(m.id)] = m;

  // Herramentales para excluir_calidad
  const herramentalesLinea = pdb.herramentales_l4 || [];
  const excluirCalidadIds = new Set(
    herramentalesLinea.filter(h => h.excluir_calidad).map(h => String(h.id))
  );

  const slots = [];
  let curMins = entMins;

  // ── Fase 1: construir slots con objetivo COMPLETO (sin arranque) ──
  for (let h = 0; h < totalHours; h++) {
    const ss = curMins;
    const se = Math.min(curMins + 60, salMins); // ultimo slot puede ser parcial
    const slotDuration = se - ss; // minutos reales del slot (60 o menos)
    const ssStr = `${String(Math.floor(ss/60)%24).padStart(2,'0')}:${String(ss%60).padStart(2,'0')}`;
    const seStr = `${String(Math.floor(se/60)%24).padStart(2,'0')}:${String(se%60).padStart(2,'0')}`;

    const ssR = ss;
    const seR = se;

    // Cargas descargadas en este slot
    const isLastSlot = h === totalHours - 1;
    const cargasEnSlot = (pdb.cargas || []).filter(c => {
      if (c.linea !== 'L4' || !c.fecha_descarga || !c.hora_descarga) return false;
      if (c.estado === 'cancelado') return false;
      const dm = toMins(c.hora_descarga);
      return c.fecha_descarga === targetDate && dm >= ssR && (dm < seR || (isLastSlot && dm === seR));
    });

    const ciclos_totales = cargasEnSlot.length;
    const cargasNoVacias = cargasEnSlot.filter(c => !c.es_vacia);
    const ciclos_no_vacios = cargasNoVacias.length;
    const ciclos_buenos = cargasNoVacias.filter(c => !c.defecto_id).length;

    const cargasCalidad = cargasNoVacias.filter(c => !excluirCalidadIds.has(String(c.herramental_id)));
    const ciclos_buenos_calidad = cargasCalidad.filter(c => !c.defecto_id).length;

    let piezas_total = 0, piezas_obj_total = 0;
    for (const c of cargasNoVacias) {
      piezas_total += (c.cantidad || (Number(c.varillas || 0) * Number(c.piezas_por_varilla || 0)));
      const comp = c.componente_id ? compMap[String(c.componente_id)] : null;
      piezas_obj_total += comp
        ? (Number(comp.carga_optima_varillas || 0) * Number(comp.piezas_objetivo || 0))
        : 0;
    }
    for (const c of cargasEnSlot.filter(c => c.es_vacia && c.varillas && c.piezas_por_varilla)) {
      piezas_obj_total += Number(c.varillas) * Number(c.piezas_por_varilla);
    }

    // Paros de L4
    let paros_min = 0, paros_min_prog = 0, paros_min_disp = 0, paros_min_rend = 0;
    for (const p of (pdb.paros || []).filter(p => p.linea === 'L4')) {
      const overlap = slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                                  p.fecha_inicio, p.fecha_fin, targetDate);
      if (overlap <= 0) continue;
      const motivo = motivosParoMap[String(p.motivo_id)];
      const afecEf   = motivo?.afecta_eficiencia    !== false;
      const afecDisp = motivo?.afecta_disponibilidad !== false;
      const afecRend = motivo?.afecta_rendimiento    !== false;
      const efectividad = (p.duracion_min > 0 && p.deduccion_min > 0)
        ? Math.max(0, p.duracion_min - p.deduccion_min) / p.duracion_min : 1;
      const overlapEf = Math.round(overlap * efectividad * 10) / 10;
      paros_min += overlapEf;
      if (afecEf)   paros_min_prog += overlapEf;
      if (afecDisp) paros_min_disp += overlapEf;
      if (afecRend) paros_min_rend += overlapEf;
    }
    paros_min      = Math.min(paros_min,      slotDuration);
    paros_min_prog = Math.min(paros_min_prog, slotDuration);
    paros_min_disp = Math.min(paros_min_disp, slotDuration);
    paros_min_rend = Math.min(paros_min_rend, slotDuration);

    // Objetivo base (sin arranque) para este slot
    const slotObjBase = slotCiclosObj(ciclos_obj, h) * (slotDuration / 60);
    const minutosTiempoAdicional = Math.max(0, se - Math.max(ss, window.fin_base_min));

    slots.push({
      slot: h + 1, hora_inicio: ssStr, hora_fin: seStr, slotDuration,
      es_tiempo_adicional: minutosTiempoAdicional > 0,
      minutos_tiempo_adicional: minutosTiempoAdicional,
      ciclos_totales, ciclos_no_vacios, ciclos_buenos,
      ciclos_no_vacios_calidad: cargasCalidad.length, ciclos_buenos_calidad,
      piezas_total, piezas_obj_total,
      paros_min, paros_min_prog, paros_min_disp, paros_min_rend,
      ciclos_obj_base: slotObjBase
    });
    curMins += 60;
  }

  // ── Fase 2: arranque diario — tolerancia en el objetivo del PRIMER slot ──
  // La tolerancia de arranque (6 ciclos) solo reduce el OBJETIVO del primer slot.
  // Todos los ciclos reales siempre cuentan para eficiencia (no se restan del numerador).
  // Calidad y capacidad incluyen TODOS los ciclos.
  const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];

    // Todos los ciclos reales cuentan para eficiencia
    s.ciclos_eficiencia = s.ciclos_totales;

    // Solo el primer slot tiene reduccion de objetivo por tolerancia de arranque
    s.ciclos_obj = i === 0
      ? Math.max(0, s.ciclos_obj_base - arranqueCiclos)
      : s.ciclos_obj_base;

    // Ajustar objetivo por paros programados
    const efectivoMin = Math.max(0, s.slotDuration - s.paros_min_prog);
    s.ciclos_obj_adj = r3(s.ciclos_obj * (efectivoMin / s.slotDuration));

    // Eficiencia = ciclos_eficiencia / ciclos_obj_adj
    // Si objetivo=0 y ciclos=0 → eficiencia = 1 (no penaliza)
    s.eficiencia = s.ciclos_obj_adj > 0
      ? r3(s.ciclos_eficiencia / s.ciclos_obj_adj)
      : (s.ciclos_eficiencia === 0 ? 1 : null);

    // Calidad y capacidad usan TODOS los ciclos
    s.calidad = s.ciclos_no_vacios_calidad > 0 ? r3(s.ciclos_buenos_calidad / s.ciclos_no_vacios_calidad) : null;
    s.capacidad = s.piezas_obj_total > 0 ? r3(s.piezas_total / s.piezas_obj_total) : null;
    s.disponibilidad = r3(Math.max(0, s.slotDuration - Math.min(s.paros_min_disp, s.slotDuration)) / s.slotDuration);
    const tDisp = Math.max(0, s.slotDuration - s.paros_min_disp);
    s.rendimiento = tDisp > 0
      ? r3(Math.max(0, tDisp - Math.min(s.paros_min_rend, tDisp)) / tDisp) : 1;

    // Limpiar campos internos y redondear paros
    s.paros_min      = Math.round(s.paros_min      * 10) / 10;
    s.paros_min_prog = Math.round(s.paros_min_prog * 10) / 10;
    s.paros_min_disp = Math.round(s.paros_min_disp * 10) / 10;
    s.paros_min_rend = Math.round(s.paros_min_rend * 10) / 10;
    delete s.ciclos_obj_base;
  }
  return slots;
}

// Fuente común para la eficiencia TL4 usada por pizarrón, KPI y estadísticas.
// La tolerancia de arranque solo reduce el objetivo del primer slot;
// todos los ciclos reales cuentan para eficiencia.
function getTL4EfficiencySummary(pdb, config, targetDate, operadorId = null) {
  const slots = buildSlotsForL4TL4(pdb, config, targetDate);
  const window = getTL4EffectiveWindow(pdb, targetDate);
  if (!window.activo || slots.length === 0) {
    return { ciclos_eficiencia: 0, objetivo: 0, eficiencia: null };
  }

  const live = annotateLiveSlots(pdb, 'L4', 'TL4', targetDate, slots);
  const objetivo = live.objetivo_eficiencia;

  // Sin filtro de operador: usar totales de slots ya anotados
  if (operadorId == null) {
    return {
      ciclos_eficiencia: live.ciclos_eficiencia,
      objetivo,
      eficiencia: objetivo > 0 ? live.ciclos_eficiencia / objetivo : (live.ciclos_eficiencia === 0 ? 1 : null)
    };
  }

  // Con filtro de operador: contar cargas individuales en ventanas completadas
  const entMins = window.inicio_min;
  const salMins = window.fin_render_min;
  const completedWindows = slots.filter(s => s.estado_slot === 'completado');
  const cargasEnCompletadas = (pdb.cargas || []).filter(c => {
    if (c.linea !== 'L4' || !c.fecha_descarga || !c.hora_descarga) return false;
    if (c.estado === 'cancelado' || c.fecha_descarga !== targetDate) return false;
    if (String(c.operador_id) !== String(operadorId)) return false;
    const mins = toMins(c.hora_descarga);
    if (mins < entMins || mins > salMins) return false;
    return completedWindows.some((s, index) => {
      const end = toMins(s.hora_fin);
      return mins >= toMins(s.hora_inicio) && (mins < end || (index === completedWindows.length - 1 && mins === end));
    });
  });
  const ciclosEficiencia = cargasEnCompletadas.length;

  return {
    ciclos_eficiencia: ciclosEficiencia,
    objetivo,
    eficiencia: objetivo > 0 ? ciclosEficiencia / objetivo : (ciclosEficiencia === 0 ? 1 : null)
  };
}

function buildPizarronResult(pdb, config, lineas, turnos, targetDate) {
  const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
  const result = {};

  for (const l of lineas) {
    // Si L4 usa TL4 para esta fecha, no procesar aquí (se agrega aparte)
    if (l === 'L4' && l4UsesTL4(pdb, targetDate)) continue;

    result[l] = {};
    const ciclos_obj = l === 'L3'
      ? (config.ciclos_objetivo_l3 ?? 2)
      : (config.ciclos_objetivo_l4 ?? 2);

    let dayC = 0, dayCEff = 0, dayNV = 0, dayB = 0, dayNVQ = 0, dayBQ = 0, dayPz = 0, dayPzObj = 0, dayParos = 0, dayParosDisp = 0, dayParosRend = 0, daySlots = 0, dayCompletedSlots = 0, dayElapHours = 0, dayObjElap = 0, dayCurrentHour = null;

    for (const t of turnos) {
      // Filtrar turnos desactivados en el calendario
      if (!isTurnoActivo(pdb, l, t, targetDate)) continue;

      const tDef  = TURNOS_DEF[t];
      const slots = buildSlotsForLinTur(pdb, config, l, t, targetDate);
      const liveEfficiency = annotateLiveSlots(pdb, l, t, targetDate, slots);

      const tC        = slots.reduce((s, x) => s + x.ciclos_totales,   0);
      const tNV       = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const tB        = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
      const tNVQ      = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
      const tBQ       = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
      const tPz       = slots.reduce((s, x) => s + x.piezas_total,     0);
      const tPzObj    = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const tParos    = slots.reduce((s, x) => s + x.paros_min,        0);
      const tParosDisp= slots.reduce((s, x) => s + (x.paros_min_disp ?? x.paros_min), 0);
      const tParosRend= slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
      const turnoMins  = tDef.hours * 60;
      const tElap      = elapsedHoursForTurno(t, targetDate); // horas reales transcurridas
      // Usa objetivo ajustado por arranque de lunes Y por paros no-eficiencia
      const tObjElap   = liveEfficiency.objetivo_eficiencia;
      // Rendimiento: base = tiempo disponible (excluye paros de disponibilidad)
      const tDispMins  = Math.max(0, turnoMins - tParosDisp);

      result[l][t] = {
        slots,
        totals: {
          ciclos_totales:   tC,
          ciclos_no_vacios: tNV,
          ciclos_buenos:    tB,
          piezas_total:     tPz,
          piezas_obj_total: tPzObj,
          paros_min:        Math.round(tParos * 10) / 10,
          paros_min_disp:   Math.round(tParosDisp * 10) / 10,
          paros_min_rend:   Math.round(tParosRend * 10) / 10,
          ciclos_eficiencia: liveEfficiency.ciclos_eficiencia,
          objetivo_eficiencia: r3(tObjElap),
          slots_completados: liveEfficiency.slots_completados,
          estado_turno: liveEfficiency.status,
          hora_en_curso: liveEfficiency.hora_en_curso,
          eficiencia:    r3(liveEfficiency.eficiencia),
          calidad:       tNVQ > 0 ? r3(tBQ / tNVQ) : null,
          capacidad:     tPzObj > 0 ? r3(tPz / tPzObj) : null,
          disponibilidad: r3((turnoMins - Math.min(tParosDisp, turnoMins)) / turnoMins),
          rendimiento:    tDispMins > 0
            ? r3((tDispMins - Math.min(tParosRend, tDispMins)) / tDispMins)
            : 1
        }
      };

      dayC          += tC;
      dayCEff       += liveEfficiency.ciclos_eficiencia;
      dayNV         += tNV;
      dayB          += tB;
      dayNVQ        += tNVQ;
      dayBQ         += tBQ;
      dayPz         += tPz;
      dayPzObj      += tPzObj;
      dayParos      += tParos;
      dayParosDisp  += tParosDisp;
      dayParosRend  += tParosRend;
      daySlots      += tDef.hours;   // horas totales planeadas (para disponibilidad)
      dayCompletedSlots += liveEfficiency.slots_completados;
      dayElapHours  += tElap;        // horas reales transcurridas
      dayObjElap    += tObjElap;     // objetivo acumulado ajustado (incluye descuento arranque lunes)
      if (liveEfficiency.hora_en_curso) dayCurrentHour = { turno: t, ...liveEfficiency.hora_en_curso };
    }

    const totalMins = daySlots * 60;
    result[l].totales_dia = {
      ciclos_totales:   dayC,
      ciclos_no_vacios: dayNV,
      ciclos_buenos:    dayB,
      piezas_total:     dayPz,
      piezas_obj_total: dayPzObj,
      paros_min:        Math.round(dayParos * 10) / 10,
      ciclos_eficiencia: dayCEff,
      objetivo_eficiencia: r3(dayObjElap),
      hora_en_curso: dayCurrentHour,
      eficiencia:    r3(dayObjElap > 0
        ? dayCEff / dayObjElap
        : (dayCompletedSlots > 0 && dayCEff === 0 ? 1 : null)),
      calidad:       dayNVQ > 0 ? r3(dayBQ / dayNVQ) : null,
      capacidad:     dayPzObj > 0 ? r3(dayPz / dayPzObj) : null,
      disponibilidad: totalMins > 0
        ? r3((totalMins - Math.min(dayParosDisp, totalMins)) / totalMins) : 1,
      rendimiento: (() => {
        const dayDispMins = Math.max(0, totalMins - dayParosDisp);
        return dayDispMins > 0
          ? r3((dayDispMins - Math.min(dayParosRend, dayDispMins)) / dayDispMins)
          : 1;
      })()
    };
  }
  return result;
}

// ─── Pareto helpers ───────────────────────────────────────────────────────────

function buildParetoParos(pdb, lineaLabel, fecha, turno) {
  let paros = [];
  if (lineaLabel === 'Baker') {
    paros = (pdb.paros_baker || []).slice();
  } else if (lineaLabel === 'L1') {
    paros = (pdb.paros_l1 || []).slice();
  } else {
    paros = (pdb.paros || []).filter(p => p.linea === lineaLabel);
  }

  // Construir ventanas de turno: para TL4 usar horas dinámicas de la config
  const windows = [];
  if (turno === 'TL4' || (!turno && lineaLabel === 'L4' && l4UsesTL4(pdb, fecha))) {
    const tl4Window = getTL4EffectiveWindow(pdb, fecha);
    if (tl4Window.activo) {
      windows.push({ start: tl4Window.inicio_min, end: tl4Window.fin_render_min });
    }
  } else {
    const targetTurnos = turno ? [turno] : ['T1', 'T2', 'T3'];
    for (const t of targetTurnos) {
      const tDef = TURNOS_DEF[t];
      if (!tDef) continue; // safety: skip unknown turnos
      windows.push({ start: tDef.start, end: tDef.start + tDef.hours * 60 });
    }
  }

  const agg = {};
  for (const p of paros) {
    const paroFechaFin = p.fecha_fin   || nowDateStr();
    const paroHoraFin  = p.hora_fin    || nowTimeStr();

    let totalOverlap = 0;
    for (const w of windows) {
      totalOverlap += slotOverlap(w.start, w.end, p.hora_inicio, paroHoraFin, p.fecha_inicio, paroFechaFin, fecha);
    }

    if (totalOverlap <= 0) continue;
    const key = p.motivo || 'Sin motivo';
    agg[key] = (agg[key] || 0) + totalOverlap;
  }

  return Object.entries(agg)
    .map(([motivo, duracion_min]) => ({ motivo, duracion_min: Math.round(duracion_min) }))
    .sort((a, b) => b.duracion_min - a.duracion_min);
}

function buildParetoDefectos(pdb, lineaLabel, fecha, turno) {
  const agg = {};
  const ftD  = c => getStoredOperationalContext({ ...c, _linea: lineaLabel }, pdb).fecha_operativa;
  const tnoD = (c, linea) => resolveStoredTurno({ ...c, _linea: linea }, pdb);
  if (lineaLabel === 'Baker' || lineaLabel === 'L1') {
    const src = lineaLabel === 'Baker' ? 'cargas_baker' : 'cargas_l1';
    let cargas = (pdb[src] || []).filter(c => !!c.fecha_descarga && ftD(c) === fecha);
    if (turno) cargas = cargas.filter(c => tnoD(c, lineaLabel) === turno);
    for (const carga of cargas) {
      if (carga.herramental_tipo === 'barril') {
        for (const cav of (carga.cavidades || []).filter(cv => cv.estado === 'defecto')) {
          const key = cav.defecto || 'Sin motivo';
          agg[key] = (agg[key] || 0) + 1;
        }
      } else if (carga.estado === 'defecto' || carga.defecto_id) {
        const key = carga.defecto || 'Sin motivo';
        agg[key] = (agg[key] || 0) + 1;
      }
    }
  } else {
    let cargas = (pdb.cargas || []).filter(c =>
      c.linea === lineaLabel && !!c.fecha_descarga && ftD(c) === fecha &&
      (c.estado === 'defecto' || c.defecto_id)
    );
    if (turno) cargas = cargas.filter(c => tnoD(c, lineaLabel) === turno);
    for (const c of cargas) {
      const key = c.defecto || 'Sin motivo';
      agg[key] = (agg[key] || 0) + 1;
    }
  }
  return Object.entries(agg)
    .map(([defecto, cantidad]) => ({ defecto, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

// ─── Pizarrón KPIs ────────────────────────────────────────────────────────────

router.get('/pizarron', (req, res) => {
  const { linea = 'L3', fecha, turno = 'all' } = req.query;
  // Si no viene fecha, usar shift date (T3 nocturno 00:00-06:29 pertenece al día anterior)
  const targetDate = fecha || getShiftDate(nowDateStr(), nowTimeStr());
  const pdb        = dbProd.read();
  const config     = pdb.config || {};
  // Solo pasar L3/L4 a buildPizarronResult; Baker y L1 usan su propia lógica (addBakerLike)
  const lineas     = linea === 'ambas' ? ['L3', 'L4'] : [linea].filter(l => l === 'L3' || l === 'L4');

  let targetTurnos = turno === 'all' ? ['T1', 'T2', 'T3'] : [turno];

  // No incluir turnos que aún no han iniciado cuando se consulta el día de hoy.
  // Regla T3: pertenece completamente al día en que inició (21:30).
  // Si T3 no ha iniciado hoy, no se muestra aunque sean las 00:00-06:30
  // (esas horas corresponden al T3 del día anterior).
  if (targetDate === nowDateStr()) {
    const nowMins = toMins(nowTimeStr());
    const TURNO_INICIO = { T1: 6*60+30, T2: 14*60+30, T3: 21*60+30 };
    targetTurnos = targetTurnos.filter(t => nowMins >= TURNO_INICIO[t]);
  }

  const data = buildPizarronResult(pdb, config, lineas, targetTurnos, targetDate);

  // Helper para agregar línea tipo Baker al pizarrón
  function addBakerLike(lineaLabel, buildFn, ciclosObjKey) {
    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    const turnData = {};
    let dC = 0, dCEff = 0, dNV = 0, dB = 0, dNVQ = 0, dBQ = 0, dPz = 0, dPzO = 0, dParos = 0, dParosDisp = 0, dParosRend = 0, dSlots = 0, dCompletedSlots = 0, dElapHours = 0, dObjElap = 0, dCurrentHour = null;
    for (const t of targetTurnos) {
      // Filtrar turnos desactivados en el calendario
      if (!isTurnoActivo(pdb, lineaLabel, t, targetDate)) continue;

      const tDef  = TURNOS_DEF[t];
      const slots = buildFn(pdb, config, t, targetDate);
      const liveEfficiency = annotateLiveSlots(pdb, lineaLabel, t, targetDate, slots);
      const tC    = slots.reduce((s, x) => s + x.ciclos_totales,   0);
      const tNV   = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const tB    = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
      const tNVQ  = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
      const tBQ   = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
      const tPz   = slots.reduce((s, x) => s + x.piezas_total,     0);
      const tPzO  = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const tParos     = slots.reduce((s, x) => s + x.paros_min,            0);
      const tParosDisp = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
      const tParosRend = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
      const turnoMins  = tDef.hours * 60;
      const tElap      = elapsedHoursForTurno(t, targetDate);
      const tObjElap   = liveEfficiency.objetivo_eficiencia;
      const tDispMins  = Math.max(0, turnoMins - tParosDisp);
      turnData[t] = {
        slots,
        totals: {
          ciclos_totales:   tC,
          ciclos_no_vacios: tNV,
          ciclos_buenos:    tB,
          piezas_total: tPz,
          piezas_obj_total: tPzO,
          paros_min: Math.round(tParos * 10) / 10,
          paros_min_disp: Math.round(tParosDisp * 10) / 10,
          paros_min_rend: Math.round(tParosRend * 10) / 10,
          ciclos_eficiencia: liveEfficiency.ciclos_eficiencia,
          objetivo_eficiencia: r3(tObjElap),
          slots_completados: liveEfficiency.slots_completados,
          estado_turno: liveEfficiency.status,
          hora_en_curso: liveEfficiency.hora_en_curso,
          eficiencia:    r3(liveEfficiency.eficiencia),
          calidad:       tNVQ > 0 ? r3(tBQ / tNVQ) : null,
          capacidad:     tPzO > 0 ? r3(tPz / tPzO) : null,
          disponibilidad: r3(Math.max(0, turnoMins - Math.min(tParosDisp, turnoMins)) / turnoMins),
          rendimiento:    tDispMins > 0
            ? r3((tDispMins - Math.min(tParosRend, tDispMins)) / tDispMins)
            : 1
        }
      };
      dC += tC; dCEff += liveEfficiency.ciclos_eficiencia; dNV += tNV; dB += tB; dNVQ += tNVQ; dBQ += tBQ; dPz += tPz; dPzO += tPzO;
      dParos     += tParos;
      dParosDisp += tParosDisp;
      dParosRend += tParosRend;
      dSlots     += tDef.hours;
      dCompletedSlots += liveEfficiency.slots_completados;
      dElapHours += tElap;
      dObjElap   += tObjElap;
      if (liveEfficiency.hora_en_curso) dCurrentHour = { turno: t, ...liveEfficiency.hora_en_curso };
    }
    const dTotalMins = dSlots * 60;
    const dDispMins  = Math.max(0, dTotalMins - dParosDisp);
    data[lineaLabel] = {
      ...turnData,
      totales_dia: {
        ciclos_totales: dC,
        ciclos_no_vacios: dNV,
        ciclos_buenos: dB,
        piezas_total: dPz,
        piezas_obj_total: dPzO,
        paros_min: Math.round(dParos * 10) / 10,
        ciclos_eficiencia: dCEff,
        objetivo_eficiencia: r3(dObjElap),
        hora_en_curso: dCurrentHour,
        eficiencia:    r3(dObjElap > 0
          ? dCEff / dObjElap
          : (dCompletedSlots > 0 && dCEff === 0 ? 1 : null)),
        calidad:       dNVQ > 0 ? r3(dBQ / dNVQ) : null,
        capacidad:     dPzO > 0 ? r3(dPz / dPzO) : null,
        disponibilidad: dTotalMins > 0
          ? r3((dTotalMins - Math.min(dParosDisp, dTotalMins)) / dTotalMins)
          : 1,
        rendimiento: dDispMins > 0
          ? r3((dDispMins - Math.min(dParosRend, dDispMins)) / dDispMins)
          : 1
      }
    };
  }

  // L4 en modo TL4: agregar con slot builder dinámico
  function addL4TL4() {
    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    const weekStart = getWeekStart(targetDate);
    const l4cfg = getTurnoL4Config(pdb, weekStart);
    const dia = getDiaSemana(targetDate);
    const diaConf = l4cfg.dias[dia];

    if (!diaConf || !diaConf.activo) {
      // Dia no activo: incluir L4 vacio para que el frontend sepa que existe
      data['L4'] = { totales_dia: { eficiencia: null, calidad: null, capacidad: null, disponibilidad: null, rendimiento: null } };
      return;
    }

    const slots = buildSlotsForL4TL4(pdb, config, targetDate);
    const window = getTL4EffectiveWindow(pdb, targetDate);
    // Filtrar slots que aun no inician (si es hoy)
    let filteredSlots = slots;
    if (targetDate === nowDateStr()) {
      const nowMins = toMins(nowTimeStr());
      const entMins = toMins(diaConf.hora_entrada);
      if (nowMins < entMins) filteredSlots = [];
    }
    const liveEfficiency = annotateLiveSlots(pdb, 'L4', 'TL4', targetDate, filteredSlots);

    const tC         = filteredSlots.reduce((s, x) => s + x.ciclos_totales, 0);
    const tCEff      = filteredSlots.reduce((s, x) => s + (x.ciclos_eficiencia ?? x.ciclos_totales), 0);
    const tNV        = filteredSlots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
    const tB         = filteredSlots.reduce((s, x) => s + x.ciclos_buenos, 0);
    const tNVQ       = filteredSlots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
    const tBQ        = filteredSlots.reduce((s, x) => s + (x.ciclos_buenos_calidad ?? x.ciclos_buenos), 0);
    const tPz        = filteredSlots.reduce((s, x) => s + x.piezas_total, 0);
    const tPzO       = filteredSlots.reduce((s, x) => s + x.piezas_obj_total, 0);
    const tParos     = filteredSlots.reduce((s, x) => s + (x.paros_min ?? 0), 0);
    const tParosDisp = filteredSlots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
    const tParosRend = filteredSlots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
    const tElap      = elapsedHoursForTL4(targetDate, diaConf.hora_entrada, window.hora_fin_efectiva || diaConf.hora_salida);
    const tObjElap   = liveEfficiency.objetivo_eficiencia;
    const totalMins  = window.minutos_calculo;
    const tDispMins  = Math.max(0, totalMins - tParosDisp);

    data['L4'] = {
      TL4: {
        slots: filteredSlots,
        hora_entrada: diaConf.hora_entrada,
        hora_salida:  diaConf.hora_salida,
        hora_salida_programada: diaConf.hora_salida,
        hora_fin_efectiva: window.hora_fin_efectiva,
        minutos_adicionales: window.minutos_adicionales,
        tiempo_extra_activo: window.tiempo_extra_activo,
        cargas_activas: window.cargas_activas,
        ultima_descarga: window.ultima_descarga,
        totals: {
          ciclos_totales: tC, ciclos_no_vacios: tNV, ciclos_buenos: tB,
          piezas_total: tPz, piezas_obj_total: tPzO,
          paros_min: Math.round(tParos * 10) / 10,
          paros_min_disp: Math.round(tParosDisp * 10) / 10,
          paros_min_rend: Math.round(tParosRend * 10) / 10,
          ciclos_eficiencia: liveEfficiency.ciclos_eficiencia,
          objetivo_eficiencia: r3(tObjElap),
          slots_completados: liveEfficiency.slots_completados,
          estado_turno: liveEfficiency.status,
          hora_en_curso: liveEfficiency.hora_en_curso,
          minutos_adicionales: window.minutos_adicionales,
          tiempo_extra_activo: window.tiempo_extra_activo,
          cargas_activas: window.cargas_activas,
          eficiencia:    r3(liveEfficiency.eficiencia),
          calidad:       tNVQ > 0 ? r3(tBQ / tNVQ) : null,
          capacidad:     tPzO > 0 ? r3(tPz / tPzO) : null,
          disponibilidad: totalMins > 0 ? r3(Math.max(0, totalMins - Math.min(tParosDisp, totalMins)) / totalMins) : 1,
          rendimiento:    tDispMins > 0 ? r3((tDispMins - Math.min(tParosRend, tDispMins)) / tDispMins) : 1
        }
      },
      totales_dia: {
        ciclos_totales: tC, ciclos_no_vacios: tNV, ciclos_buenos: tB,
        piezas_total: tPz, piezas_obj_total: tPzO,
        paros_min: Math.round(tParos * 10) / 10,
        ciclos_eficiencia: liveEfficiency.ciclos_eficiencia,
        objetivo_eficiencia: r3(tObjElap),
        hora_en_curso: liveEfficiency.hora_en_curso,
        minutos_adicionales: window.minutos_adicionales,
        tiempo_extra_activo: window.tiempo_extra_activo,
        cargas_activas: window.cargas_activas,
        eficiencia:    r3(liveEfficiency.eficiencia),
        calidad:       tNVQ > 0 ? r3(tBQ / tNVQ) : null,
        capacidad:     tPzO > 0 ? r3(tPz / tPzO) : null,
        disponibilidad: totalMins > 0 ? r3(Math.max(0, totalMins - Math.min(tParosDisp, totalMins)) / totalMins) : 1,
        rendimiento:    tDispMins > 0 ? r3((tDispMins - Math.min(tParosRend, tDispMins)) / tDispMins) : 1
      }
    };
  }

  if (linea === 'ambas' || linea.toLowerCase() === 'baker') addBakerLike('Baker', buildSlotsForBaker, 'ciclos_objetivo_baker');
  if (linea === 'ambas' || linea === 'L1')                  addBakerLike('L1',    buildSlotsForL1,    'ciclos_objetivo_l1');

  // Si L4 usa TL4 y fue solicitada, agregarla
  if ((linea === 'ambas' || linea === 'L4') &&
      (turno === 'all' || turno === 'TL4') &&
      l4UsesTL4(pdb, targetDate)) {
    addL4TL4();
  }

  // Añadir datos pareto del día y por turno a cada línea
  for (const l of Object.keys(data)) {
    data[l].objetivos = getKpiObjectives(config, l);
    data[l].pareto_paros    = buildParetoParos(pdb, l, targetDate);
    data[l].pareto_defectos = buildParetoDefectos(pdb, l, targetDate);
    // Pareto por turno (T1/T2/T3 o TL4)
    const turnosToCheck = data[l].TL4 ? ['TL4'] : ['T1', 'T2', 'T3'];
    for (const t of turnosToCheck) {
      if (data[l][t]) {
        const pp = buildParetoParos(pdb, l, targetDate, t);
        data[l][t].pareto_paros    = pp;
        data[l][t].pareto_defectos = buildParetoDefectos(pdb, l, targetDate, t);
        data[l][t].turno_no_trabajado = pp.some(p => /turno\s*no\s*trabajado/i.test(p.motivo));
      }
    }
  }

  res.json({ fecha: targetDate, linea, turno, data });
});

// ─── Reportes ─────────────────────────────────────────────────────────────────

router.get('/reportes', (req, res) => {
  const { linea, desde, hasta } = req.query;
  const pdb = dbProd.read();
  let cargas = [];

  if (!linea || linea === 'ambas') {
    // L3 + L4 + Baker + L1
    const bakerCargas = (pdb.cargas_baker || []).map(c => ({ ...c, linea: 'Baker' }));
    const l1Cargas    = (pdb.cargas_l1    || []).map(c => ({ ...c, linea: 'L1' }));
    cargas = [...(pdb.cargas || []), ...bakerCargas, ...l1Cargas];
  } else if (linea === 'Baker') {
    cargas = (pdb.cargas_baker || []).map(c => ({ ...c, linea: 'Baker' }));
  } else if (linea === 'L1') {
    cargas = (pdb.cargas_l1 || []).map(c => ({ ...c, linea: 'L1' }));
  } else {
    cargas = (pdb.cargas || []).filter(c => c.linea === linea);
  }

  cargas = cargas.map(c => {
    const ctx = getStoredOperationalContext(c, pdb);
    return {
      ...c, turno_captura: c.turno, turno: ctx.turno,
      turno_operativo: ctx.turno, fecha_operativa: ctx.fecha_operativa
    };
  });
  if (desde) cargas = cargas.filter(c => c.fecha_operativa >= desde);
  if (hasta) cargas = cargas.filter(c => c.fecha_operativa <= hasta);

  cargas = cargas.sort((a, b) => {
    const ta = `${a.fecha_carga}T${a.hora_carga || '00:00'}`;
    const tb = `${b.fecha_carga}T${b.hora_carga || '00:00'}`;
    return ta > tb ? -1 : ta < tb ? 1 : 0;
  });

  res.json({ total: cargas.length, cargas });
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', produccionAllowRoles('produccion'), (req, res) => {
  const pdb  = dbProd.read();
  const hoy  = nowDateStr();
  const fechaOperativaActual = getShiftDate(hoy, nowTimeStr());

  // Cargas activas por línea
  const activas_l3 = (pdb.cargas || []).filter(c => c.linea === 'L3' && c.estado === 'activo').length;
  const activas_l4 = (pdb.cargas || []).filter(c => c.linea === 'L4' && c.estado === 'activo').length;
  const activas_baker = (pdb.cargas_baker || []).filter(c => c.estado === 'activo').length;
  const activas_l1    = (pdb.cargas_l1    || []).filter(c => c.estado === 'activo').length;

  const allCargasDescargadas = [
    ...(pdb.cargas       || []).map(c => ({ ...c, _linea: c.linea })),
    ...(pdb.cargas_baker || []).map(c => ({ ...c, _linea: 'Baker' })),
    ...(pdb.cargas_l1    || []).map(c => ({ ...c, _linea: 'L1' }))
  ].filter(c => c.fecha_descarga).map(c => {
    const ctx = getStoredOperationalContext(c, pdb);
    return { ...c, _fecha_operativa: ctx.fecha_operativa, _turno_descarga: ctx.turno };
  });
  const completadasHoy = allCargasDescargadas.filter(c => c._fecha_operativa === fechaOperativaActual).length;

  // Canastas completadas en el turno actual — por hora de descarga
  const turnoActual = getTurno(nowTimeStr());
  const l4TL4Hoy    = l4UsesTL4(pdb, hoy);
  const completadasTurno = allCargasDescargadas.filter(c => {
    if (c._fecha_operativa !== fechaOperativaActual) return false;
    const t = c._turno_descarga;
    // TL4 es turno único del día para L4; cuenta como "turno actual" si TL4 activo
    if (t === 'TL4') return l4TL4Hoy;
    return t === turnoActual;
  }).length;

  // Mini pizarron: últimas 3 horas L3 y L4
  const now   = nowTimeStr();
  const nowM  = toMins(now);
  const ordinal = date => Math.floor(Date.parse(date + 'T00:00:00Z') / 60000);
  const nowAbs = ordinal(hoy) + nowM;
  const hourStartAbs = Math.floor(nowAbs / 60) * 60;
  const mini_pizarron = [];
  for (let delta = 2; delta >= 0; delta--) {
    const slotAbs = hourStartAbs - delta * 60;
    const slotDay = Math.floor(slotAbs / 1440) * 1440;
    const slotDate = new Date(slotDay * 60000).toISOString().slice(0, 10);
    const h = Math.floor((slotAbs - slotDay) / 60);
    const slotHora = String(h).padStart(2, '0') + ':00';
    const slotFinAbs = slotAbs + 60;
    for (const linea of ['L3', 'L4']) {
      const slot = (pdb.cargas || []).filter(c =>
        c.linea === linea &&
        c.fecha_descarga && c.hora_descarga &&
        ordinal(c.fecha_descarga) + toMins(c.hora_descarga) >= slotAbs &&
        ordinal(c.fecha_descarga) + toMins(c.hora_descarga) < slotFinAbs
      );
      if (slot.length === 0) continue;
      const excluirIds = new Set((pdb[`herramentales_${linea.toLowerCase()}`] || [])
        .filter(herr => herr.excluir_calidad).map(herr => String(herr.id)));
      const elegibles = slot.filter(c => !c.es_vacia && !excluirIds.has(String(c.herramental_id)));
      const buenos = elegibles.filter(c => !c.defecto_id).length;
      mini_pizarron.push({
        fecha:         slotDate,
        hora:          slotHora,
        linea,
        ciclos:        slot.length,
        eficiencia:    null,
        calidad:       elegibles.length > 0 ? buenos / elegibles.length : null,
        disponibilidad: null
      });
    }
  }

  res.json({
    activas_l3,
    activas_l4,
    activas_baker,
    activas_l1,
    cargas_hoy:     completadasHoy,
    cargas_turno:   completadasTurno,
    fecha_operativa: fechaOperativaActual,
    turno_actual:   turnoActual,
    mini_pizarron
  });
});

// ─── Backup ───────────────────────────────────────────────────────────────────

router.get('/backup', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="produccion-backup-${fecha}.json"`);
  res.send(JSON.stringify(pdb, null, 2));
});

// ─── Config ───────────────────────────────────────────────────────────────────

router.get('/config', produccionAllowRoles('produccion'), (req, res) => {
  const pdb = dbProd.read();
  res.json(pdb.config || { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2 });
});

router.patch('/config', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.config) pdb.config = {};
  const camposNum = [
    'ciclos_objetivo_l3', 'ciclos_objetivo_l4', 'ciclos_objetivo_baker', 'ciclos_objetivo_l1',
    'eficiencia_obj_l3',  'eficiencia_obj_l4',  'eficiencia_obj_baker',  'eficiencia_obj_l1',
    'capacidad_obj_l3',   'capacidad_obj_l4',   'capacidad_obj_baker',   'capacidad_obj_l1',
    'calidad_obj_l3',     'calidad_obj_l4',     'calidad_obj_baker',     'calidad_obj_l1',
    'disponibilidad_obj_l3', 'disponibilidad_obj_l4', 'disponibilidad_obj_baker', 'disponibilidad_obj_l1',
    'rendimiento_obj_l3', 'rendimiento_obj_l4', 'rendimiento_obj_baker', 'rendimiento_obj_l1'
  ];
  const camposStr = ['planes_control_baker_url', 'planes_control_l1_url'];
  const body = req.body || {};
  for (const f of camposNum) {
    if (body[f] === undefined) continue;
    const value = Number(body[f]);
    if (!Number.isFinite(value)) return res.status(400).json({ error: `${f} debe ser numerico` });
    if (f.startsWith('ciclos_objetivo_') && value <= 0) {
      return res.status(400).json({ error: `${f} debe ser mayor que cero` });
    }
    if (!f.startsWith('ciclos_objetivo_') && (value < 0 || value > 100)) {
      return res.status(400).json({ error: `${f} debe estar entre 0 y 100` });
    }
    pdb.config[f] = value;
  }
  for (const f of camposStr) {
    if (body[f] !== undefined) pdb.config[f] = String(body[f] || '');
  }
  dbProd.write(pdb);
  res.json(pdb.config);
});

// ─── Slideshow config ─────────────────────────────────────────────────────────

const DEFAULT_SLIDESHOW = {
  default_duracion_seg: 120,
  slides: [
    {id:1, type:'kpi', scope:'turno', linea:'L3',    duracion_seg:null, activo:true},
    {id:2, type:'kpi', scope:'turno', linea:'L4',    duracion_seg:null, activo:true},
    {id:3, type:'kpi', scope:'turno', linea:'ambas', duracion_seg:null, activo:true},
    {id:4, type:'kpi', scope:'dia',   linea:'L3',    duracion_seg:null, activo:true},
    {id:5, type:'kpi', scope:'dia',   linea:'L4',    duracion_seg:null, activo:true},
    {id:6, type:'kpi', scope:'dia',   linea:'ambas', duracion_seg:null, activo:true},
    {id:7, type:'kpi', scope:'turno', linea:'Baker', duracion_seg:null, activo:true},
    {id:8, type:'kpi', scope:'dia',   linea:'Baker', duracion_seg:null, activo:true},
    {id:9, type:'kpi', scope:'trend_semana', linea:'ambas', duracion_seg:null, activo:true},
    {id:10,type:'kpi', scope:'reconocimientos', linea:'ambas', duracion_seg:null, activo:true},
    {id:11,type:'kpi', scope:'turno', linea:'L1', duracion_seg:null, activo:true},
    {id:12,type:'kpi', scope:'dia',   linea:'L1', duracion_seg:null, activo:true}
  ]
};

router.get('/slideshow-config', (req, res) => {
  const pdb = dbProd.read();
  const stored = pdb.config?.slideshow;
  const storedSlides = Array.isArray(stored?.slides) ? stored.slides : [];
  const ids = new Set(storedSlides.map(slide => `${slide.type}:${slide.id}`));
  // Incorporar definiciones agregadas por versiones nuevas (por ejemplo L1)
  // sin alterar orden, duración o estado de las ya configuradas.
  const slideshow = stored
    ? {
        ...stored,
        slides: [
          ...storedSlides,
          ...DEFAULT_SLIDESHOW.slides.filter(slide => !ids.has(`${slide.type}:${slide.id}`))
        ]
      }
    : DEFAULT_SLIDESHOW;
  res.json({ slideshow });
});

router.patch('/slideshow-config', produccionAllowRoles('admin'), (req, res) => {
  const pdb  = dbProd.read();
  if (!pdb.config) pdb.config = {};
  const body = req.body || {};
  pdb.config.slideshow = {
    default_duracion_seg: Number(body.default_duracion_seg) || 120,
    slides: Array.isArray(body.slides) ? body.slides : (pdb.config.slideshow?.slides || DEFAULT_SLIDESHOW.slides)
  };
  dbProd.write(pdb);
  res.json({ slideshow: pdb.config.slideshow });
});

// ─── KPI Snapshots ────────────────────────────────────────────────────────────

function calculateKpiSnapshot(pdb, config, linea, turno, targetDate) {
  const isTL4 = linea === 'L4' && l4UsesTL4(pdb, targetDate);
  if (isTL4 && turno !== 'TL4') return null;
  if (!isTL4 && !TURNOS_DEF[turno]) return null;
  if (!isTurnoActivo(pdb, linea, turno, targetDate)) return null;

  let slots;
  let plannedMinutes;
  let tl4Window = null;
  if (isTL4) {
    slots = buildSlotsForL4TL4(pdb, config, targetDate);
    const cfg = getTurnoL4Config(pdb, getWeekStart(targetDate));
    const diaConf = cfg.dias[getDiaSemana(targetDate)];
    if (!diaConf || !diaConf.activo || slots.length === 0) return null;
    tl4Window = getTL4EffectiveWindow(pdb, targetDate);
    plannedMinutes = tl4Window.minutos_calculo;
  } else {
    slots = linea === 'Baker'
      ? buildSlotsForBaker(pdb, config, turno, targetDate)
      : linea === 'L1'
        ? buildSlotsForL1(pdb, config, turno, targetDate)
        : buildSlotsForLinTur(pdb, config, linea, turno, targetDate);
    plannedMinutes = TURNOS_DEF[turno].hours * 60;
  }

  const live = annotateLiveSlots(pdb, linea, turno, targetDate, slots);
  const sum = (key, fallback) => slots.reduce((total, slot) =>
    total + Number(slot[key] ?? (fallback ? slot[fallback] : 0) ?? 0), 0);
  const ciclosTotales = sum('ciclos_totales');
  const ciclosNoVacios = sum('ciclos_no_vacios');
  const ciclosBuenos = sum('ciclos_buenos');
  const ciclosNoVaciosCalidad = sum('ciclos_no_vacios_calidad', 'ciclos_no_vacios');
  const ciclosBuenosCalidad = sum('ciclos_buenos_calidad', 'ciclos_buenos');
  const piezasTotal = sum('piezas_total');
  const piezasObjTotal = sum('piezas_obj_total');
  const parosMinTotal = sum('paros_min');
  const parosMinDisp = sum('paros_min_disp');
  const parosMinRend = sum('paros_min_rend');
  const availableMinutes = Math.max(0, plannedMinutes - parosMinDisp);
  const completedMinutes = slots
    .filter(slot => slot.estado_slot === 'completado')
    .reduce((total, slot) => total + Number(slot.slotDuration || 60), 0);
  const r3 = value => value == null ? null : Math.round(value * 1000) / 1000;

  return {
    id: `${targetDate}-${linea}-${turno}`,
    fecha: targetDate,
    semana: getISOWeek(new Date(targetDate + 'T12:00:00')),
    turno,
    linea,
    estado_turno: live.status,
    ciclos_totales: ciclosTotales,
    ciclos_eficiencia: live.ciclos_eficiencia,
    ciclos_no_vacios: ciclosNoVacios,
    ciclos_buenos: ciclosBuenos,
    ciclos_no_vacios_calidad: ciclosNoVaciosCalidad,
    ciclos_buenos_calidad: ciclosBuenosCalidad,
    piezas_total: piezasTotal,
    piezas_obj_total: piezasObjTotal,
    paros_min_total: r3(parosMinTotal),
    paros_min_disp: r3(parosMinDisp),
    paros_min_rend: r3(parosMinRend),
    minutos_planificados: plannedMinutes,
    horas_eficiencia: r3(completedMinutes / 60),
    objetivo_eficiencia: r3(live.objetivo_eficiencia),
    slots_completados: live.slots_completados,
    hora_en_curso: live.hora_en_curso,
    ...(tl4Window ? {
      hora_salida_programada: tl4Window.hora_salida_programada,
      hora_fin_efectiva: tl4Window.hora_fin_efectiva,
      minutos_adicionales: tl4Window.minutos_adicionales,
      tiempo_extra_activo: tl4Window.tiempo_extra_activo,
      cargas_activas: tl4Window.cargas_activas,
      ultima_descarga: tl4Window.ultima_descarga
    } : {}),
    eficiencia: r3(live.eficiencia),
    calidad: ciclosNoVaciosCalidad > 0 ? r3(ciclosBuenosCalidad / ciclosNoVaciosCalidad) : null,
    capacidad: piezasObjTotal > 0 ? r3(piezasTotal / piezasObjTotal) : null,
    disponibilidad: plannedMinutes > 0
      ? r3((plannedMinutes - Math.min(parosMinDisp, plannedMinutes)) / plannedMinutes)
      : null,
    rendimiento: availableMinutes > 0
      ? r3((availableMinutes - Math.min(parosMinRend, availableMinutes)) / availableMinutes)
      : 1,
    slots
  };
}

router.post('/kpis/guardar', produccionAllowRoles('admin'), (req, res) => {
  const { fecha, linea = 'ambas', turno = 'all' } = req.body || {};
  const targetDate = fecha || getShiftDate(nowDateStr(), nowTimeStr());
  if (!isValidDateStr(targetDate)) return res.status(400).json({ error: 'fecha debe tener formato YYYY-MM-DD válido' });

  const pdb = dbProd.read();
  const config = pdb.config || {};
  if (!pdb.kpi_snapshots) pdb.kpi_snapshots = [];
  const lineas = linea === 'ambas' ? ['L3', 'L4', 'Baker', 'L1'] : [linea];
  const requestedTurnos = turno === 'all' ? ['T1', 'T2', 'T3'] : [turno];
  const guardados = [];

  for (const currentLine of lineas) {
    const turnos = currentLine === 'L4' && l4UsesTL4(pdb, targetDate)
      ? ((turno === 'all' || turno === 'TL4') ? ['TL4'] : [])
      : requestedTurnos.filter(t => TURNOS_DEF[t]);
    for (const currentTurno of turnos) {
      const calculated = calculateKpiSnapshot(pdb, config, currentLine, currentTurno, targetDate);
      // Los snapshots son cierres históricos. Guardar un turno abierto fijaría
      // para siempre una eficiencia parcial; la vista en vivo ya se recalcula.
      if (!calculated || calculated.estado_turno !== 'completado') continue;
      const existIdx = pdb.kpi_snapshots.findIndex(k =>
        k.fecha === targetDate && k.linea === currentLine && k.turno === currentTurno);
      const snap = {
        ...calculated,
        id: existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
        guardado_at: new Date().toISOString(),
        guardado_por: req.prodUser?.nombre || 'admin',
        fuente: 'guardado'
      };
      if (existIdx >= 0) pdb.kpi_snapshots[existIdx] = snap;
      else pdb.kpi_snapshots.push(snap);
      guardados.push(snap);
    }
  }

  dbProd.write(pdb);
  res.json({ guardados: guardados.length, snapshots: guardados });
});

// Conservado temporalmente para facilitar la comparación durante la migración;
// no es consumido por ninguna vista.
router.post('/kpis/guardar-legacy-disabled', produccionAllowRoles('admin'), (req, res) => {
  const { fecha, linea = 'ambas', turno = 'all' } = req.body || {};
  const targetDate   = fecha || nowDateStr();
  const pdb          = dbProd.read();
  const config       = pdb.config || {};
  if (!pdb.kpi_snapshots) pdb.kpi_snapshots = [];

  // Separar L3 de L4 para manejar TL4 correctamente
  const lineasL3Only = linea === 'ambas' ? ['L3'] : (linea === 'L3' ? ['L3'] : []);
  const includeL4G   = linea === 'ambas' || linea === 'L4';
  const includeBakerG = linea === 'ambas' || linea === 'Baker';
  const includeL1G    = linea === 'ambas' || linea === 'L1';
  const turnos   = turno === 'all'   ? ['T1', 'T2', 'T3'] : [turno];
  const guardados = [];
  const semana = getISOWeek(new Date(targetDate + 'T12:00:00'));

  // L3 (siempre usa T1/T2/T3)
  for (const l of lineasL3Only) {
    for (const t of turnos) {
      if (!isTurnoActivo(pdb, l, t, targetDate)) continue; // No guardar snapshot de turno desactivado
      const slots                    = buildSlotsForLinTur(pdb, config, l, t, targetDate);
      const r3                       = v => v != null ? Math.round(v * 1000) / 1000 : null;
      const ciclos_totales           = slots.reduce((s, x) => s + x.ciclos_totales, 0);
      const ciclos_no_vacios         = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const ciclos_buenos            = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
      const ciclos_no_vacios_calidad = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
      const ciclos_buenos_calidad    = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
      const piezas_total             = slots.reduce((s, x) => s + x.piezas_total, 0);
      const piezas_obj_total         = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const paros_min_total          = slots.reduce((s, x) => s + x.paros_min, 0);
      const paros_min_disp           = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
      const paros_min_rend           = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
      const tObjElap                 = computeObjElapsedAdj(slots, TURNOS_DEF[t].hours);
      const turnoMins                = TURNOS_DEF[t].hours * 60;
      const tDispMins                = Math.max(0, turnoMins - paros_min_disp);
      const eficiencia               = r3(tObjElap > 0 ? ciclos_totales / tObjElap : (ciclos_totales === 0 ? 1 : null));
      const calidad                  = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
      const capacidad                = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
      const disponibilidad           = r3((turnoMins - Math.min(paros_min_disp, turnoMins)) / turnoMins);
      const rendimiento              = tDispMins > 0 ? r3((tDispMins - Math.min(paros_min_rend, tDispMins)) / tDispMins) : 1;

      const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === l && k.turno === t);
      const snap = {
        id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
        fecha:          targetDate,
        semana,
        turno:          t,
        linea:          l,
        guardado_at:    new Date().toISOString(),
        ciclos_totales,
        ciclos_no_vacios,
        ciclos_buenos,
        piezas_total,
        paros_min_total,
        paros_min_disp,
        eficiencia,
        capacidad,
        calidad,
        disponibilidad,
        rendimiento,
        slots
      };
      if (existIdx >= 0) pdb.kpi_snapshots[existIdx] = snap;
      else pdb.kpi_snapshots.push(snap);
      guardados.push(snap);
    }
  }

  // L4: puede usar TL4 o T1/T2/T3 dependiendo de la fecha
  if (includeL4G) {
    if (l4UsesTL4(pdb, targetDate)) {
      // L4 en modo TL4: un solo snapshot con turno 'TL4'
      const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
      const slots = buildSlotsForL4TL4(pdb, config, targetDate);
      const weekStart = getWeekStart(targetDate);
      const l4cfg = getTurnoL4Config(pdb, weekStart);
      const dia = getDiaSemana(targetDate);
      const diaConf = l4cfg.dias[dia];
      if (diaConf && diaConf.activo && slots.length > 0) {
        const ciclos_totales           = slots.reduce((s, x) => s + x.ciclos_totales, 0);
        const ciclos_eficiencia_total  = slots.reduce((s, x) => s + (x.ciclos_eficiencia ?? x.ciclos_totales), 0);
        const ciclos_no_vacios         = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
        const ciclos_buenos            = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
        const ciclos_no_vacios_calidad = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
        const ciclos_buenos_calidad    = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
        const piezas_total             = slots.reduce((s, x) => s + x.piezas_total, 0);
        const piezas_obj_total         = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
        const paros_min_total          = slots.reduce((s, x) => s + x.paros_min, 0);
        const paros_min_disp           = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
        const paros_min_rend           = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
        const totalMins                = toMins(diaConf.hora_salida) - toMins(diaConf.hora_entrada);
        const tElap                    = elapsedHoursForTL4(targetDate, diaConf.hora_entrada, diaConf.hora_salida);
        const tObjElap                 = computeObjElapsedAdj(slots, tElap);
        const tDispMins                = Math.max(0, totalMins - paros_min_disp);
        const eficiencia               = r3(tObjElap > 0 ? ciclos_eficiencia_total / tObjElap : (ciclos_eficiencia_total === 0 ? 1 : null));
        const calidad                  = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
        const capacidad                = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
        const disponibilidad           = totalMins > 0 ? r3((totalMins - Math.min(paros_min_disp, totalMins)) / totalMins) : 1;
        const rendimiento              = tDispMins > 0 ? r3((tDispMins - Math.min(paros_min_rend, tDispMins)) / tDispMins) : 1;

        const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === 'L4' && k.turno === 'TL4');
        const snap = {
          id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
          fecha:          targetDate,
          semana,
          turno:          'TL4',
          linea:          'L4',
          guardado_at:    new Date().toISOString(),
          ciclos_totales,
          ciclos_no_vacios,
          ciclos_buenos,
          piezas_total,
          paros_min_total,
          paros_min_disp,
          eficiencia,
          capacidad,
          calidad,
          disponibilidad,
          rendimiento,
          slots
        };
        if (existIdx >= 0) pdb.kpi_snapshots[existIdx] = snap;
        else pdb.kpi_snapshots.push(snap);
        guardados.push(snap);
      }
    } else {
      // L4 en modo legacy T1/T2/T3
      for (const t of turnos) {
        if (!isTurnoActivo(pdb, 'L4', t, targetDate)) continue;
        const slots                    = buildSlotsForLinTur(pdb, config, 'L4', t, targetDate);
        const r3                       = v => v != null ? Math.round(v * 1000) / 1000 : null;
        const ciclos_totales           = slots.reduce((s, x) => s + x.ciclos_totales, 0);
        const ciclos_no_vacios         = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
        const ciclos_buenos            = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
        const ciclos_no_vacios_calidad = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
        const ciclos_buenos_calidad    = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
        const piezas_total             = slots.reduce((s, x) => s + x.piezas_total, 0);
        const piezas_obj_total         = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
        const paros_min_total          = slots.reduce((s, x) => s + x.paros_min, 0);
        const paros_min_disp           = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
        const paros_min_rend           = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
        const tObjElap                 = computeObjElapsedAdj(slots, TURNOS_DEF[t].hours);
        const turnoMins                = TURNOS_DEF[t].hours * 60;
        const tDispMins                = Math.max(0, turnoMins - paros_min_disp);
        const eficiencia               = r3(tObjElap > 0 ? ciclos_totales / tObjElap : (ciclos_totales === 0 ? 1 : null));
        const calidad                  = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
        const capacidad                = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
        const disponibilidad           = r3((turnoMins - Math.min(paros_min_disp, turnoMins)) / turnoMins);
        const rendimiento              = tDispMins > 0 ? r3((tDispMins - Math.min(paros_min_rend, tDispMins)) / tDispMins) : 1;

        const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === 'L4' && k.turno === t);
        const snap = {
          id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
          fecha:          targetDate,
          semana,
          turno:          t,
          linea:          'L4',
          guardado_at:    new Date().toISOString(),
          ciclos_totales,
          ciclos_no_vacios,
          ciclos_buenos,
          piezas_total,
          paros_min_total,
          paros_min_disp,
          eficiencia,
          capacidad,
          calidad,
          disponibilidad,
          rendimiento,
          slots
        };
        if (existIdx >= 0) pdb.kpi_snapshots[existIdx] = snap;
        else pdb.kpi_snapshots.push(snap);
        guardados.push(snap);
      }
    }
  }

  if (includeBakerG) {
    for (const t of turnos) {
      if (!isTurnoActivo(pdb, 'Baker', t, targetDate)) continue;
      const slots                    = buildSlotsForBaker(pdb, config, t, targetDate);
      const r3                       = v => v != null ? Math.round(v * 1000) / 1000 : null;
      const ciclos_totales           = slots.reduce((s, x) => s + x.ciclos_totales, 0);
      const ciclos_no_vacios         = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const ciclos_buenos            = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
      const ciclos_no_vacios_calidad = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
      const ciclos_buenos_calidad    = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
      const piezas_total             = slots.reduce((s, x) => s + x.piezas_total, 0);
      const piezas_obj_total         = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const paros_min_total          = slots.reduce((s, x) => s + x.paros_min, 0);
      const paros_min_disp           = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
      const paros_min_rend           = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
      const tObjElap                 = computeObjElapsedAdj(slots, TURNOS_DEF[t].hours);
      const turnoMins                = TURNOS_DEF[t].hours * 60;
      const tDispMins                = Math.max(0, turnoMins - paros_min_disp);
      const eficiencia               = r3(tObjElap > 0 ? ciclos_totales / tObjElap : (ciclos_totales === 0 ? 1 : null));
      const calidad                  = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
      const capacidad                = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
      const disponibilidad           = r3((turnoMins - Math.min(paros_min_disp, turnoMins)) / turnoMins);
      const rendimiento              = tDispMins > 0 ? r3((tDispMins - Math.min(paros_min_rend, tDispMins)) / tDispMins) : 1;

      const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === 'Baker' && k.turno === t);
      const snap = {
        id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
        fecha:          targetDate,
        semana,
        turno:          t,
        linea:          'Baker',
        guardado_at:    new Date().toISOString(),
        ciclos_totales,
        ciclos_no_vacios,
        ciclos_buenos,
        piezas_total,
        paros_min_total,
        paros_min_disp,
        eficiencia,
        capacidad,
        calidad,
        disponibilidad,
        rendimiento,
        slots
      };
      if (existIdx >= 0) pdb.kpi_snapshots[existIdx] = snap;
      else pdb.kpi_snapshots.push(snap);
      guardados.push(snap);
    }
  }

  if (includeL1G) {
    for (const t of turnos) {
      if (!isTurnoActivo(pdb, 'L1', t, targetDate)) continue;
      const slots                    = buildSlotsForL1(pdb, config, t, targetDate);
      const r3                       = v => v != null ? Math.round(v * 1000) / 1000 : null;
      const ciclos_totales           = slots.reduce((s, x) => s + x.ciclos_totales, 0);
      const ciclos_no_vacios         = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const ciclos_buenos            = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
      const ciclos_no_vacios_calidad = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
      const ciclos_buenos_calidad    = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
      const piezas_total             = slots.reduce((s, x) => s + x.piezas_total, 0);
      const piezas_obj_total         = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const paros_min_total          = slots.reduce((s, x) => s + x.paros_min, 0);
      const paros_min_disp           = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
      const paros_min_rend           = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
      const tObjElap                 = computeObjElapsedAdj(slots, TURNOS_DEF[t].hours);
      const turnoMins                = TURNOS_DEF[t].hours * 60;
      const tDispMins                = Math.max(0, turnoMins - paros_min_disp);
      const eficiencia               = r3(tObjElap > 0 ? ciclos_totales / tObjElap : (ciclos_totales === 0 ? 1 : null));
      const calidad                  = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
      const capacidad                = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
      const disponibilidad           = r3((turnoMins - Math.min(paros_min_disp, turnoMins)) / turnoMins);
      const rendimiento              = tDispMins > 0 ? r3((tDispMins - Math.min(paros_min_rend, tDispMins)) / tDispMins) : 1;

      const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === 'L1' && k.turno === t);
      const snap = {
        id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
        fecha:          targetDate,
        semana,
        turno:          t,
        linea:          'L1',
        guardado_at:    new Date().toISOString(),
        ciclos_totales,
        ciclos_no_vacios,
        ciclos_buenos,
        piezas_total,
        paros_min_total,
        paros_min_disp,
        eficiencia,
        capacidad,
        calidad,
        disponibilidad,
        rendimiento,
        slots
      };
      if (existIdx >= 0) pdb.kpi_snapshots[existIdx] = snap;
      else pdb.kpi_snapshots.push(snap);
      guardados.push(snap);
    }
  }
  dbProd.write(pdb);
  res.json({ guardados: guardados.length, snapshots: guardados });
});

router.get('/kpis', (req, res) => {
  const { linea, turno, desde, hasta } = req.query;
  const pdb = dbProd.read();
  const config = pdb.config || {};
  const endDate = hasta || getShiftDate(nowDateStr(), nowTimeStr());
  const startDate = desde || addDays(endDate, -6);
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate) || startDate > endDate) {
    return res.status(400).json({ error: 'Rango de fechas inválido' });
  }

  const dates = [];
  for (let date = startDate; date <= endDate && dates.length < 90; date = addDays(date, 1)) dates.push(date);
  const lineas = (!linea || linea === 'ambas') ? ['L3', 'L4', 'Baker', 'L1'] : [linea];
  const snapshots = [];

  for (const date of dates) {
    for (const currentLine of lineas) {
      const usesTL4 = currentLine === 'L4' && l4UsesTL4(pdb, date);
      const turnos = usesTL4
        ? ((!turno || turno === 'TL4') ? ['TL4'] : [])
        : (turno ? (TURNOS_DEF[turno] ? [turno] : []) : ['T1', 'T2', 'T3']);

      for (const currentTurno of turnos) {
        const calculated = calculateKpiSnapshot(pdb, config, currentLine, currentTurno, date);
        if (!calculated || calculated.estado_turno === 'futuro' || calculated.estado_turno === 'inactivo') continue;
        const saved = (pdb.kpi_snapshots || []).find(k =>
          k.fecha === date && k.linea === currentLine && k.turno === currentTurno);
        // Un turno cerrado usa el valor persistido. El turno en vivo siempre se
        // recalcula para exponer el avance de la hora abierta.
        const snap = saved && calculated.estado_turno === 'completado' && saved.estado_turno !== 'en_curso'
          ? { ...calculated, ...saved, fuente: 'guardado' }
          : { ...calculated, fuente: 'calculado' };
        snapshots.push(snap);
      }
    }
  }

  snapshots.sort((a, b) =>
    b.fecha.localeCompare(a.fecha) || a.linea.localeCompare(b.linea) || a.turno.localeCompare(b.turno));
  res.json({ total: snapshots.length, snapshots });
});

router.get('/kpis-legacy-disabled', (req, res) => {
  const { linea, turno, desde, hasta } = req.query;
  const pdb    = dbProd.read();
  const config = pdb.config || {};

  // Rango de fechas (máx. 90 días para no sobrecargar)
  const endDate   = hasta || nowDateStr();
  const startDate = desde || (() => {
    const d = new Date(endDate + 'T12:00:00');
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  })();

  const dates = [];
  let cur = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate   + 'T12:00:00');
  const maxDays = 90;
  while (cur <= end && dates.length < maxDays) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  // Separar L3 de L4 para manejar TL4 por fecha
  const lineasL3Only = (!linea || linea === 'ambas') ? ['L3'] : (linea === 'L3' ? ['L3'] : []);
  const includeL4    = !linea || linea === 'ambas' || linea === 'L4';
  const includeBaker = !linea || linea === 'ambas' || linea === 'Baker';
  const includeL1    = !linea || linea === 'ambas' || linea === 'L1';
  const turnos  = turno ? [turno] : ['T1', 'T2', 'T3'];
  const r3      = v => v != null ? Math.round(v * 1000) / 1000 : null;

  const snapshots = [];

  for (const date of dates) {
    const semana = getISOWeek(new Date(date + 'T12:00:00'));

    // L3 (siempre T1/T2/T3)
    for (const l of lineasL3Only) {
      const ciclos_obj = config.ciclos_objetivo_l3 ?? 2;

      for (const t of turnos) {
        if (!isTurnoActivo(pdb, l, t, date)) continue;
        const tDef  = TURNOS_DEF[t];
        const slots = buildSlotsForLinTur(pdb, config, l, t, date);

        const ciclos_totales   = slots.reduce((s, x) => s + x.ciclos_totales,   0);
        const ciclos_no_vacios = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
        const ciclos_buenos    = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
        const piezas_total     = slots.reduce((s, x) => s + x.piezas_total,     0);
        const piezas_obj_total = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
        const paros_min_total  = slots.reduce((s, x) => s + x.paros_min,        0);
        const nv_calidad = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
        const bq_calidad = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);

        if (ciclos_totales === 0 && paros_min_total === 0) continue;

        const turnoMins      = tDef.hours * 60;
        const elapHours      = elapsedHoursForTurno(t, date);
        const esT1Lunes      = t === 'T1' && isLunes(date);
        const objElap        = esT1Lunes ? computeObjElapsed(slots, elapHours) : ciclos_obj * elapHours;
        const paros_min_disp_t = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
        const paros_min_rend_t = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
        const eficiencia     = ciclos_totales > 0 && objElap > 0 ? ciclos_totales / objElap : null;
        const calidad        = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
        const capacidad      = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
        const disponibilidad = (turnoMins - Math.min(paros_min_total, turnoMins)) / turnoMins;
        const tDisp_turno    = Math.max(0, turnoMins - paros_min_disp_t);
        const rendimiento    = tDisp_turno > 0
          ? (tDisp_turno - Math.min(paros_min_rend_t, tDisp_turno)) / tDisp_turno
          : 1;

        snapshots.push({
          id:              `${date}-${l}-${t}`,
          fecha:           date,
          semana,
          turno:           t,
          linea:           l,
          ciclos_totales,
          ciclos_no_vacios,
          ciclos_buenos,
          ciclos_no_vacios_calidad: nv_calidad,
          ciclos_buenos_calidad:    bq_calidad,
          piezas_total,
          piezas_obj_total,
          paros_min_total:    Math.round(paros_min_total * 10) / 10,
          horas_eficiencia:   Math.round(elapHours * 1000) / 1000,
          eficiencia:         r3(eficiencia),
          calidad:            r3(calidad),
          capacidad:          r3(capacidad),
          disponibilidad:     r3(disponibilidad),
          rendimiento:        r3(rendimiento),
          slots
        });
      }
    }

    // L4: TL4 o T1/T2/T3 según la fecha
    if (includeL4) {
      const ciclos_obj_l4 = config.ciclos_objetivo_l4 ?? 2;
      if (l4UsesTL4(pdb, date)) {
        // L4 en modo TL4
        const slots = buildSlotsForL4TL4(pdb, config, date);
        const ciclos_totales           = slots.reduce((s, x) => s + x.ciclos_totales,   0);
        const ciclos_eficiencia_total  = slots.reduce((s, x) => s + (x.ciclos_eficiencia ?? x.ciclos_totales), 0);
        const paros_min_total  = slots.reduce((s, x) => s + x.paros_min,        0);
        if (ciclos_totales > 0 || paros_min_total > 0) {
          const ciclos_no_vacios = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
          const ciclos_buenos    = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
          const piezas_total     = slots.reduce((s, x) => s + x.piezas_total,     0);
          const piezas_obj_total = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
          const nv_calidad       = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
          const bq_calidad       = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);
          const paros_min_disp_t = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
          const paros_min_rend_t = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
          const weekStart        = getWeekStart(date);
          const l4cfg            = getTurnoL4Config(pdb, weekStart);
          const dia              = getDiaSemana(date);
          const diaConf          = l4cfg.dias[dia];
          const totalMins        = diaConf && diaConf.activo ? (toMins(diaConf.hora_salida) - toMins(diaConf.hora_entrada)) : 0;
          const elapHours        = diaConf && diaConf.activo ? elapsedHoursForTL4(date, diaConf.hora_entrada, diaConf.hora_salida) : 0;
          const objElap          = computeObjElapsedAdj(slots, elapHours);
          const eficiencia       = objElap > 0 ? ciclos_eficiencia_total / objElap : (ciclos_eficiencia_total === 0 ? 1 : null);
          const calidad          = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
          const capacidad        = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
          const disponibilidad   = totalMins > 0 ? (totalMins - Math.min(paros_min_disp_t, totalMins)) / totalMins : 1;
          const tDisp_turno      = Math.max(0, totalMins - paros_min_disp_t);
          const rendimiento      = tDisp_turno > 0
            ? (tDisp_turno - Math.min(paros_min_rend_t, tDisp_turno)) / tDisp_turno
            : 1;

          snapshots.push({
            id:              `${date}-L4-TL4`,
            fecha:           date,
            semana,
            turno:           'TL4',
            linea:           'L4',
            ciclos_totales,
            ciclos_no_vacios,
            ciclos_buenos,
            ciclos_no_vacios_calidad: nv_calidad,
            ciclos_buenos_calidad:    bq_calidad,
            piezas_total,
            piezas_obj_total,
            paros_min_total:    Math.round(paros_min_total * 10) / 10,
            horas_eficiencia:   Math.round(elapHours * 1000) / 1000,
            eficiencia:         r3(eficiencia),
            calidad:            r3(calidad),
            capacidad:          r3(capacidad),
            disponibilidad:     r3(disponibilidad),
            rendimiento:        r3(rendimiento),
            slots
          });
        }
      } else {
        // L4 en modo legacy T1/T2/T3
        for (const t of turnos) {
          if (!isTurnoActivo(pdb, 'L4', t, date)) continue;
          const tDef  = TURNOS_DEF[t];
          const slots = buildSlotsForLinTur(pdb, config, 'L4', t, date);
          const ciclos_totales   = slots.reduce((s, x) => s + x.ciclos_totales,   0);
          const ciclos_no_vacios = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
          const ciclos_buenos    = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
          const piezas_total     = slots.reduce((s, x) => s + x.piezas_total,     0);
          const piezas_obj_total = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
          const paros_min_total  = slots.reduce((s, x) => s + x.paros_min,        0);
          const nv_calidad       = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
          const bq_calidad       = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);

          if (ciclos_totales === 0 && paros_min_total === 0) continue;

          const turnoMins      = tDef.hours * 60;
          const elapHours      = elapsedHoursForTurno(t, date);
          const esT1Lunes      = t === 'T1' && isLunes(date);
          const objElap        = esT1Lunes ? computeObjElapsed(slots, elapHours) : ciclos_obj_l4 * elapHours;
          const paros_min_disp_t = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
          const paros_min_rend_t = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
          const eficiencia     = ciclos_totales > 0 && objElap > 0 ? ciclos_totales / objElap : null;
          const calidad        = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
          const capacidad      = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
          const disponibilidad = (turnoMins - Math.min(paros_min_total, turnoMins)) / turnoMins;
          const tDisp_turno    = Math.max(0, turnoMins - paros_min_disp_t);
          const rendimiento    = tDisp_turno > 0
            ? (tDisp_turno - Math.min(paros_min_rend_t, tDisp_turno)) / tDisp_turno
            : 1;

          snapshots.push({
            id:              `${date}-L4-${t}`,
            fecha:           date,
            semana,
            turno:           t,
            linea:           'L4',
            ciclos_totales,
            ciclos_no_vacios,
            ciclos_buenos,
            ciclos_no_vacios_calidad: nv_calidad,
            ciclos_buenos_calidad:    bq_calidad,
            piezas_total,
            piezas_obj_total,
            paros_min_total:    Math.round(paros_min_total * 10) / 10,
            horas_eficiencia:   Math.round(elapHours * 1000) / 1000,
            eficiencia:         r3(eficiencia),
            calidad:            r3(calidad),
            capacidad:          r3(capacidad),
            disponibilidad:     r3(disponibilidad),
            rendimiento:        r3(rendimiento),
            slots
          });
        }
      }
    }

    // Baker
    if (includeBaker) {
      const ciclos_obj_baker = config.ciclos_objetivo_baker ?? 2;
      for (const t of turnos) {
        if (!isTurnoActivo(pdb, 'Baker', t, date)) continue;
        const tDef  = TURNOS_DEF[t];
        const slots = buildSlotsForBaker(pdb, config, t, date);

        const ciclos_totales   = slots.reduce((s, x) => s + x.ciclos_totales,   0);
        const ciclos_no_vacios = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
        const ciclos_buenos    = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
        const piezas_total     = slots.reduce((s, x) => s + x.piezas_total,     0);
        const piezas_obj_total = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
        const paros_min_total  = slots.reduce((s, x) => s + x.paros_min,        0);
        const nv_calidad       = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
        const bq_calidad       = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);

        if (ciclos_totales === 0 && paros_min_total === 0) continue;

        const turnoMins      = tDef.hours * 60;
        const elapHours      = elapsedHoursForTurno(t, date);
        const esT1Lunes      = t === 'T1' && isLunes(date);
        const objElap          = esT1Lunes ? computeObjElapsed(slots, elapHours) : ciclos_obj_baker * elapHours;
        const paros_min_disp_t = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
        const paros_min_rend_t = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
        const eficiencia     = ciclos_totales > 0 && objElap > 0 ? ciclos_totales / objElap : null;
        const calidad        = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
        const capacidad      = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
        const disponibilidad = (turnoMins - Math.min(paros_min_total, turnoMins)) / turnoMins;
        const tDisp_turno    = Math.max(0, turnoMins - paros_min_disp_t);
        const rendimiento    = tDisp_turno > 0
          ? (tDisp_turno - Math.min(paros_min_rend_t, tDisp_turno)) / tDisp_turno
          : 1;
        const semana         = getISOWeek(new Date(date + 'T12:00:00'));

        snapshots.push({
          id:              `${date}-Baker-${t}`,
          fecha:           date,
          semana,
          turno:           t,
          linea:           'Baker',
          ciclos_totales,
          ciclos_no_vacios,
          ciclos_buenos,
          ciclos_no_vacios_calidad: nv_calidad,
          ciclos_buenos_calidad:    bq_calidad,
          piezas_total,
          piezas_obj_total,
          paros_min_total:    Math.round(paros_min_total * 10) / 10,
          horas_eficiencia:   Math.round(elapHours * 1000) / 1000,
          eficiencia:         r3(eficiencia),
          calidad:            r3(calidad),
          capacidad:          r3(capacidad),
          disponibilidad:     r3(disponibilidad),
          rendimiento:        r3(rendimiento),
          slots
        });
      }
    }

    // L1
    if (includeL1) {
      const ciclos_obj_l1 = config.ciclos_objetivo_l1 ?? 2;
      for (const t of turnos) {
        if (!isTurnoActivo(pdb, 'L1', t, date)) continue;
        const tDef  = TURNOS_DEF[t];
        const slots = buildSlotsForL1(pdb, config, t, date);

        const ciclos_totales   = slots.reduce((s, x) => s + x.ciclos_totales,   0);
        const ciclos_no_vacios = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
        const ciclos_buenos    = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
        const piezas_total     = slots.reduce((s, x) => s + x.piezas_total,     0);
        const piezas_obj_total = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
        const paros_min_total  = slots.reduce((s, x) => s + x.paros_min,        0);
        const nv_calidad       = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
        const bq_calidad       = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);

        if (ciclos_totales === 0 && paros_min_total === 0) continue;

        const turnoMins      = tDef.hours * 60;
        const elapHours      = elapsedHoursForTurno(t, date);
        const esT1Lunes      = t === 'T1' && isLunes(date);
        const objElap          = esT1Lunes ? computeObjElapsed(slots, elapHours) : ciclos_obj_l1 * elapHours;
        const paros_min_disp_t = slots.reduce((s, x) => s + (x.paros_min_disp ?? 0), 0);
        const paros_min_rend_t = slots.reduce((s, x) => s + (x.paros_min_rend ?? 0), 0);
        const eficiencia     = ciclos_totales > 0 && objElap > 0 ? ciclos_totales / objElap : null;
        const calidad        = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
        const capacidad      = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
        const disponibilidad = (turnoMins - Math.min(paros_min_total, turnoMins)) / turnoMins;
        const tDisp_turno    = Math.max(0, turnoMins - paros_min_disp_t);
        const rendimiento    = tDisp_turno > 0
          ? (tDisp_turno - Math.min(paros_min_rend_t, tDisp_turno)) / tDisp_turno
          : 1;
        const semana         = getISOWeek(new Date(date + 'T12:00:00'));

        snapshots.push({
          id:              `${date}-L1-${t}`,
          fecha:           date,
          semana,
          turno:           t,
          linea:           'L1',
          ciclos_totales,
          ciclos_no_vacios,
          ciclos_buenos,
          ciclos_no_vacios_calidad: nv_calidad,
          ciclos_buenos_calidad:    bq_calidad,
          piezas_total,
          piezas_obj_total,
          paros_min_total:    Math.round(paros_min_total * 10) / 10,
          horas_eficiencia:   Math.round(elapHours * 1000) / 1000,
          eficiencia:         r3(eficiencia),
          calidad:            r3(calidad),
          capacidad:          r3(capacidad),
          disponibilidad:     r3(disponibilidad),
          rendimiento:        r3(rendimiento),
          slots
        });
      }
    }
  }

  // Ordenar: fecha desc, linea asc, turno asc
  snapshots.sort((a, b) =>
    b.fecha.localeCompare(a.fecha) ||
    a.linea.localeCompare(b.linea) ||
    a.turno.localeCompare(b.turno)
  );

  res.json({ total: snapshots.length, snapshots });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LÍNEA BAKER ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// KPI slots para Baker (análogo a buildSlotsForLinTur pero usa cargas_baker y paros_baker)
function buildSlotsForBaker(pdb, config, t, targetDate) {
  const ciclos_obj = config.ciclos_objetivo_baker ?? 2;
  const tDef    = TURNOS_DEF[t];
  const nextDay = addDays(targetDate, 1);
  const slots   = [];
  let curMins   = tDef.start;

  const esLunesT1 = t === 'T1' && isLunes(targetDate);
  let arranqueRestante = esLunesT1 ? (ARRANQUE_LUNES['Baker'] || 0) : 0;
  let patternIdx = 0;

  for (let h = 0; h < tDef.hours; h++) {
    const ss    = curMins;
    const se    = curMins + 60;
    const ssStr = `${String(Math.floor(ss/60)%24).padStart(2,'0')}:${String(ss%60).padStart(2,'0')}`;
    const seStr = `${String(Math.floor(se/60)%24).padStart(2,'0')}:${String(se%60).padStart(2,'0')}`;

    const slotDate   = (t === 'T3' && ss >= 1440) ? nextDay : targetDate;
    const ssR        = ss % 1440;
    const seR        = se % 1440;
    const crossesMid = ssR > seR;

    // Ciclos COMPLETADOS — se cuentan por cuándo se descargan; se excluyen cancelados
    const cargasEnSlot = (pdb.cargas_baker || []).filter(c => {
      if (!c.fecha_descarga || !c.hora_descarga) return false;
      if (c.estado === 'cancelado') return false;
      const dm = toMins(c.hora_descarga);
      if (crossesMid) {
        return (c.fecha_descarga === slotDate && dm >= ssR) ||
               (c.fecha_descarga === nextDay  && dm <  seR);
      }
      return c.fecha_descarga === slotDate && dm >= ssR && dm < seR;
    });

    const ciclos_totales = cargasEnSlot.length;

    // Rack: calidad = buenos / no_vacios; Barril: sum cavidades_buenas / sum cavidades_cargadas
    // Para calidad: excluir herramentales marcados con excluir_calidad
    const herramentalesBaker = pdb.herramentales_baker || [];
    const excluirCalidadIdsBaker = new Set(
      herramentalesBaker.filter(h => h.excluir_calidad).map(h => String(h.id))
    );
    const herrBakerMap = {};
    for (const h of herramentalesBaker) herrBakerMap[String(h.id)] = h;
    const compBakerMap = {};
    for (const c of (pdb.componentes_baker || [])) compBakerMap[String(c.id)] = c;

    let ciclos_buenos = 0, ciclos_no_vacios = 0;
    let ciclos_buenos_calidad = 0, ciclos_no_vacios_calidad = 0;
    let piezas_total = 0, piezas_obj_total = 0;
    for (const c of cargasEnSlot) {
      const excluir = excluirCalidadIdsBaker.has(String(c.herramental_id));
      if (c.herramental_tipo === 'barril') {
        const carg = Number(c.cavidades_cargadas || 0);
        const buen = Number(c.cavidades_buenas   || 0);
        ciclos_no_vacios += carg;
        ciclos_buenos    += buen;
        if (!excluir) { ciclos_no_vacios_calidad += carg; ciclos_buenos_calidad += buen; }
        piezas_total     += buen; // piezas = cavidades buenas (1 pieza por cavidad)
        piezas_obj_total += Number(c.herramental_cavidades || 0); // sin cambio para barriles
      } else {
        // rack
        if (!c.es_vacia) {
          ciclos_no_vacios++;
          if (!c.defecto_id) ciclos_buenos++;
          if (!excluir) {
            ciclos_no_vacios_calidad++;
            if (!c.defecto_id) ciclos_buenos_calidad++;
          }
          piezas_total += Number(c.cantidad || 0);
          // Capacidad rack:
          // - Con componente_id: objetivo = carga_optima_varillas × piezas_objetivo (como L3/L4)
          // - Sin componente_id: objetivo = varillas_totales del herramental × ppv (siempre 24 varillas)
          if (c.componente_id) {
            const comp = compBakerMap[String(c.componente_id)];
            piezas_obj_total += comp
              ? Number(comp.carga_optima_varillas || 0) * Number(comp.piezas_objetivo || 0)
              : Number(c.piezas_objetivo_carga || 0);
          } else {
            const herr = herrBakerMap[String(c.herramental_id)];
            const ppv  = Number(c.piezas_por_varilla || 0);
            piezas_obj_total += herr && ppv
              ? Number(herr.varillas_totales || 0) * ppv
              : Number(c.piezas_objetivo_carga || 0);
          }
        }
      }
    }

    const motivosParoBaker = pdb.motivos_paro_baker || [];
    const motivosBakerMap  = {};
    for (const m of motivosParoBaker) motivosBakerMap[String(m.id)] = m;

    let paros_min = 0, paros_min_prog = 0, paros_min_disp = 0, paros_min_rend = 0;
    for (const p of (pdb.paros_baker || [])) {
      const overlap = slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                                  p.fecha_inicio, p.fecha_fin, slotDate);
      if (overlap <= 0) continue;
      const motivo   = motivosBakerMap[String(p.motivo_id)];
      const afecEf   = motivo?.afecta_eficiencia    !== false;
      const afecDisp = motivo?.afecta_disponibilidad !== false;
      const afecRend = motivo?.afecta_rendimiento    !== false;
      const efectividad = (p.duracion_min > 0 && p.deduccion_min > 0)
        ? Math.max(0, p.duracion_min - p.deduccion_min) / p.duracion_min : 1;
      const overlapEf = Math.round(overlap * efectividad * 10) / 10;
      paros_min += overlapEf;
      if (afecEf)   paros_min_prog += overlapEf; // programado → reduce objetivo
      if (afecDisp) paros_min_disp += overlapEf;
      if (afecRend) paros_min_rend += overlapEf;
    }
    paros_min      = Math.min(paros_min,      60);
    paros_min_prog = Math.min(paros_min_prog, 60);
    paros_min_disp = Math.min(paros_min_disp, 60);
    paros_min_rend = Math.min(paros_min_rend, 60);

    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    let slotObj;
    if (arranqueRestante > 0) {
      const slotObjBase = slotCiclosObj(ciclos_obj, h);
      slotObj = Math.max(0, slotObjBase - arranqueRestante);
      arranqueRestante = Math.max(0, arranqueRestante - slotObjBase);
    } else {
      slotObj = slotCiclosObj(ciclos_obj, esLunesT1 ? patternIdx : h);
      patternIdx++;
    }
    const efectivoMin    = Math.max(0, 60 - paros_min_prog);
    const ciclos_obj_adj = r3(slotObj * (efectivoMin / 60));
    const eficiencia     = ciclos_obj_adj > 0 ? r3(ciclos_totales / ciclos_obj_adj) : (ciclos_totales === 0 ? 1 : null);
    const calidad        = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
    const capacidad      = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
    const disponibilidad = r3(Math.max(0, 60 - Math.min(paros_min_disp, 60)) / 60);
    const tDisp_slot     = Math.max(0, 60 - paros_min_disp);
    const rendimiento    = tDisp_slot > 0
      ? r3(Math.max(0, tDisp_slot - Math.min(paros_min_rend, tDisp_slot)) / tDisp_slot)
      : 1;

    slots.push({
      slot: h + 1, hora_inicio: ssStr, hora_fin: seStr,
      ciclos_totales, ciclos_obj: slotObj, ciclos_obj_adj, ciclos_no_vacios, ciclos_buenos,
      ciclos_no_vacios_calidad, ciclos_buenos_calidad,
      piezas_total, piezas_obj_total,
      paros_min:      Math.round(paros_min      * 10) / 10,
      paros_min_prog: Math.round(paros_min_prog * 10) / 10,
      paros_min_disp: Math.round(paros_min_disp * 10) / 10,
      paros_min_rend: Math.round(paros_min_rend * 10) / 10,
      eficiencia, calidad, capacidad, disponibilidad, rendimiento
    });
    curMins += 60;
  }
  return slots;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LÍNEA 1 (L1) ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// KPI slots para L1 — idéntico a Baker pero usa cargas_l1 y paros_l1
function buildSlotsForL1(pdb, config, t, targetDate) {
  const ciclos_obj = config.ciclos_objetivo_l1 ?? 2;
  const tDef    = TURNOS_DEF[t];
  const nextDay = addDays(targetDate, 1);
  const slots   = [];
  let curMins   = tDef.start;

  const esLunesT1 = t === 'T1' && isLunes(targetDate);
  let arranqueRestante = esLunesT1 ? (ARRANQUE_LUNES['L1'] || 0) : 0;
  let patternIdx = 0;

  for (let h = 0; h < tDef.hours; h++) {
    const ss    = curMins;
    const se    = curMins + 60;
    const ssStr = `${String(Math.floor(ss/60)%24).padStart(2,'0')}:${String(ss%60).padStart(2,'0')}`;
    const seStr = `${String(Math.floor(se/60)%24).padStart(2,'0')}:${String(se%60).padStart(2,'0')}`;

    const slotDate   = (t === 'T3' && ss >= 1440) ? nextDay : targetDate;
    const ssR        = ss % 1440;
    const seR        = se % 1440;
    const crossesMid = ssR > seR;

    // Ciclos COMPLETADOS — se cuentan por cuándo se descargan; se excluyen cancelados
    const cargasEnSlot = (pdb.cargas_l1 || []).filter(c => {
      if (!c.fecha_descarga || !c.hora_descarga) return false;
      if (c.estado === 'cancelado') return false;
      const dm = toMins(c.hora_descarga);
      if (crossesMid) {
        return (c.fecha_descarga === slotDate && dm >= ssR) ||
               (c.fecha_descarga === nextDay  && dm <  seR);
      }
      return c.fecha_descarga === slotDate && dm >= ssR && dm < seR;
    });

    const ciclos_totales = cargasEnSlot.length;

    // Para calidad: excluir herramentales marcados con excluir_calidad
    const herramentalesL1 = pdb.herramentales_l1 || [];
    const excluirCalidadIdsL1 = new Set(
      herramentalesL1.filter(h => h.excluir_calidad).map(h => String(h.id))
    );
    let ciclos_buenos = 0, ciclos_no_vacios = 0;
    let ciclos_buenos_calidad = 0, ciclos_no_vacios_calidad = 0;
    let piezas_total = 0, piezas_obj_total = 0;
    for (const c of cargasEnSlot) {
      const excluir = excluirCalidadIdsL1.has(String(c.herramental_id));
      if (c.herramental_tipo === 'barril') {
        const carg = Number(c.cavidades_cargadas || 0);
        const buen = Number(c.cavidades_buenas   || 0);
        ciclos_no_vacios += carg;
        ciclos_buenos    += buen;
        if (!excluir) { ciclos_no_vacios_calidad += carg; ciclos_buenos_calidad += buen; }
        piezas_total     += buen;
        piezas_obj_total += Number(c.herramental_cavidades || 0);
      } else {
        if (!c.es_vacia) {
          ciclos_no_vacios++;
          if (!c.defecto_id) ciclos_buenos++;
          if (!excluir) {
            ciclos_no_vacios_calidad++;
            if (!c.defecto_id) ciclos_buenos_calidad++;
          }
          piezas_total     += Number(c.cantidad || 0);
          piezas_obj_total += Number(c.piezas_objetivo_carga || 0);
        }
      }
    }

    const motivosParo_l1 = pdb.motivos_paro_l1 || [];
    const motivosL1Map   = {};
    for (const m of motivosParo_l1) motivosL1Map[String(m.id)] = m;

    let paros_min = 0, paros_min_prog = 0, paros_min_disp = 0, paros_min_rend = 0;
    for (const p of (pdb.paros_l1 || [])) {
      const overlap = slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                                  p.fecha_inicio, p.fecha_fin, slotDate);
      if (overlap <= 0) continue;
      const motivo   = motivosL1Map[String(p.motivo_id)];
      const afecEf   = motivo?.afecta_eficiencia    !== false;
      const afecDisp = motivo?.afecta_disponibilidad !== false;
      const afecRend = motivo?.afecta_rendimiento    !== false;
      const efectividad = (p.duracion_min > 0 && p.deduccion_min > 0)
        ? Math.max(0, p.duracion_min - p.deduccion_min) / p.duracion_min : 1;
      const overlapEf = Math.round(overlap * efectividad * 10) / 10;
      paros_min += overlapEf;
      if (afecEf)   paros_min_prog += overlapEf; // programado → reduce objetivo
      if (afecDisp) paros_min_disp += overlapEf;
      if (afecRend) paros_min_rend += overlapEf;
    }
    paros_min      = Math.min(paros_min,      60);
    paros_min_prog = Math.min(paros_min_prog, 60);
    paros_min_disp = Math.min(paros_min_disp, 60);
    paros_min_rend = Math.min(paros_min_rend, 60);

    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    let slotObj;
    if (arranqueRestante > 0) {
      const slotObjBase = slotCiclosObj(ciclos_obj, h);
      slotObj = Math.max(0, slotObjBase - arranqueRestante);
      arranqueRestante = Math.max(0, arranqueRestante - slotObjBase);
    } else {
      slotObj = slotCiclosObj(ciclos_obj, esLunesT1 ? patternIdx : h);
      patternIdx++;
    }
    const efectivoMin    = Math.max(0, 60 - paros_min_prog);
    const ciclos_obj_adj = r3(slotObj * (efectivoMin / 60));
    const eficiencia     = ciclos_obj_adj > 0 ? r3(ciclos_totales / ciclos_obj_adj) : (ciclos_totales === 0 ? 1 : null);
    const calidad        = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
    const capacidad      = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
    const disponibilidad = r3(Math.max(0, 60 - Math.min(paros_min_disp, 60)) / 60);
    const tDisp_slot_l1  = Math.max(0, 60 - paros_min_disp);
    const rendimiento    = tDisp_slot_l1 > 0
      ? r3(Math.max(0, tDisp_slot_l1 - Math.min(paros_min_rend, tDisp_slot_l1)) / tDisp_slot_l1)
      : 1;

    slots.push({
      slot: h + 1, hora_inicio: ssStr, hora_fin: seStr,
      ciclos_totales, ciclos_obj: slotObj, ciclos_obj_adj, ciclos_no_vacios, ciclos_buenos,
      ciclos_no_vacios_calidad, ciclos_buenos_calidad,
      piezas_total, piezas_obj_total,
      paros_min:      Math.round(paros_min      * 10) / 10,
      paros_min_prog: Math.round(paros_min_prog * 10) / 10,
      paros_min_disp: Math.round(paros_min_disp * 10) / 10,
      paros_min_rend: Math.round(paros_min_rend * 10) / 10,
      eficiencia, calidad, capacidad, disponibilidad, rendimiento
    });
    curMins += 60;
  }
  return slots;
}

// GET /l1/cargas/activas
router.get('/l1/cargas/activas', (req, res) => {
  const pdb = dbProd.read();
  const cargas = (pdb.cargas_l1 || []).filter(c => c.estado === 'activo');
  cargas.sort((a, b) => {
    const ta = `${a.fecha_carga}T${a.hora_carga}`;
    const tb = `${b.fecha_carga}T${b.hora_carga}`;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  res.json(cargas);
});

// GET /l1/cargas
router.get('/l1/cargas', (req, res) => {
  const { fecha_ini, fecha_fin, turno, estado } = req.query;
  const pdb = dbProd.read();
  let cargas = (pdb.cargas_l1 || []).map(c => {
    const ctx = getStoredOperationalContext({ ...c, _linea: 'L1' }, pdb);
    return {
      ...c, turno_captura: c.turno, turno: ctx.turno,
      turno_operativo: ctx.turno, fecha_operativa: ctx.fecha_operativa
    };
  });
  if (fecha_ini) cargas = cargas.filter(c => c.fecha_operativa >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => c.fecha_operativa <= fecha_fin);
  if (turno)  cargas = cargas.filter(c => c.turno_operativo === turno);
  if (estado) cargas = cargas.filter(c => c.estado === estado);
  cargas = cargas.sort((a, b) => {
    const ta = `${a.fecha_carga}T${a.hora_carga}`;
    const tb = `${b.fecha_carga}T${b.hora_carga}`;
    return ta > tb ? -1 : ta < tb ? 1 : 0;
  });
  res.json(cargas);
});

// GET /l1/cavidades — registros individuales de cavidades de barril
router.get('/l1/cavidades', (req, res) => {
  const { fecha_ini, fecha_fin, turno, folio_barril } = req.query;
  const pdb = dbProd.read();
  const cargasById = new Map((pdb.cargas_l1 || []).map(c => [String(c.id), c]));
  let cavs = (pdb.cavidades_l1 || []).map(c => {
    const parent = cargasById.get(String(c.carga_id));
    const ctx = getStoredOperationalContext({ ...(parent || c), _linea: 'L1' }, pdb);
    return { ...c, turno_captura: c.turno, turno: ctx.turno, turno_operativo: ctx.turno, fecha_operativa: ctx.fecha_operativa };
  });
  if (fecha_ini)    cavs = cavs.filter(c => c.fecha_operativa >= fecha_ini);
  if (fecha_fin)    cavs = cavs.filter(c => c.fecha_operativa <= fecha_fin);
  if (turno)        cavs = cavs.filter(c => c.turno_operativo === turno);
  if (folio_barril) cavs = cavs.filter(c => c.folio_barril === folio_barril);
  res.json(cavs);
});

// POST /l1/cargas — registrar nueva carga L1 (rack o barril); máx 8 herramentales activos
router.post('/l1/cargas', (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.cargas_l1) pdb.cargas_l1 = [];
  if (!pdb.herramentales_l1) pdb.herramentales_l1 = [];

  // Candado: no permitir carga si hay paro activo en L1
  const paroActivoL1 = (pdb.paros_l1 || []).find(p => !p.fecha_fin);
  if (paroActivoL1) return res.status(409).json({ error: `Hay un paro activo en L1 (${paroActivoL1.motivo || 'sin motivo'}). Ciérralo antes de registrar una carga.`, paro: paroActivoL1 });

  const body = req.body || {};
  const { herramental_id, proceso_id, sub_proceso_id, operador_id } = body;
  if (!herramental_id) return res.status(400).json({ error: 'herramental_id es requerido' });

  // Máximo 8 herramentales activos simultáneos (diferencia clave respecto a Baker=7)
  const activos = (pdb.cargas_l1 || []).filter(c => c.estado === 'activo');
  if (activos.length >= 8) return res.status(409).json({ error: 'Máximo de 8 herramentales activos alcanzado en L1' });

  const dupActivo = activos.find(c => String(c.herramental_id) === String(herramental_id));
  if (dupActivo) return res.status(409).json({ error: `El herramental ya está activo (folio ${dupActivo.folio})` });

  const herr = (pdb.herramentales_l1 || []).find(h => String(h.id) === String(herramental_id));
  if (!herr) return res.status(404).json({ error: 'Herramental no encontrado' });

  if (!proceso_id)     return res.status(400).json({ error: 'proceso_id es requerido' });
  if (!sub_proceso_id) return res.status(400).json({ error: 'sub_proceso_id es requerido' });
  if (!operador_id)    return res.status(400).json({ error: 'operador_id es requerido' });

  const esVacioRack = (herr.tipo !== 'barril') && (body.es_vacia === true);

  if (herr.tipo !== 'barril' && !esVacioRack) {
    if (!body.cliente)                           return res.status(400).json({ error: 'cliente es requerido' });
    if (!body.componente_id && !body.componente) return res.status(400).json({ error: 'componente es requerido' });
    if (!body.no_skf)                           return res.status(400).json({ error: 'no_skf es requerido' });
    if (!body.no_orden)                         return res.status(400).json({ error: 'no_orden es requerido' });
    if (!body.varillas)                         return res.status(400).json({ error: 'varillas es requerido' });
  }

  if (herr.tipo === 'barril') {
    const cavidades = Array.isArray(body.cavidades) ? body.cavidades : [];
    const errCav = [];
    cavidades.forEach((cv, i) => {
      if (!cv.es_vacia) {
        if (!cv.cliente)    errCav.push(`Cavidad ${i+1}: cliente`);
        if (!cv.componente) errCav.push(`Cavidad ${i+1}: componente`);
        if (!cv.no_skf)    errCav.push(`Cavidad ${i+1}: no_skf`);
        if (!cv.no_orden)  errCav.push(`Cavidad ${i+1}: no_orden`);
        if (!cv.cantidad)  errCav.push(`Cavidad ${i+1}: cantidad`);
      }
    });
    if (errCav.length) return res.status(400).json({ error: `Campos requeridos: ${errCav.join(', ')}` });
  }

  const proceso    = (pdb.procesos_l1      || []).find(p => String(p.id) === String(proceso_id));
  const subProceso = (pdb.sub_procesos_l1  || []).find(s => String(s.id) === String(sub_proceso_id));
  const operador   = (pdb.operadores_l1    || []).find(o => String(o.id) === String(operador_id));

  const now           = new Date().toISOString();
  const hora          = nowTimeStr();
  const fecha         = nowDateStr();
  const _l1Ctx        = resolveTurnoContext(pdb, 'L1', fecha, hora);
  if (!_l1Ctx.activo) return res.status(409).json({ error: `El turno ${_l1Ctx.turno} no está activo para L1 en esta fecha` });
  const fecha_turno_l1 = _l1Ctx.fecha_turno;
  const turno         = _l1Ctx.turno;
  const semana        = getISOWeek(new Date(fecha_turno_l1 + 'T12:00:00'));
  const folio = nextFolio('L1', pdb.cargas_l1, 'folio');

  let carga = {
    id: dbProd.nextId(pdb.cargas_l1),
    folio,
    herramental_id: herr.id,
    herramental_no: herr.numero,
    herramental_tipo: herr.tipo || 'rack',
    proceso_id:     proceso?.id    || null,
    proceso:        proceso?.nombre || body.proceso || null,
    sub_proceso_id: subProceso?.id    || null,
    sub_proceso:    subProceso?.nombre || body.sub_proceso || null,
    operador_id:    operador?.id    || null,
    operador:       operador?.nombre || body.operador || null,
    fecha_carga: fecha, fecha_turno: fecha_turno_l1, hora_carga: hora, semana, turno,
    fecha_descarga: null, hora_descarga: null,
    estado: 'activo',
    es_reproceso: body.es_reproceso || false,
    folio_origen: body.folio_origen || null,
    created_at: now
  };

  if (herr.tipo === 'barril') {
    const cavidades = Array.isArray(body.cavidades) ? body.cavidades : [];
    const cavTotales = herr.cavidades || cavidades.length;
    carga.herramental_cavidades = cavTotales;
    carga.cavidades = cavidades.map((cv, i) => ({
      num: i + 1,
      es_vacia: cv.es_vacia || false,
      motivo_vacia_id: cv.motivo_vacia_id || null,
      motivo_vacia: cv.motivo_vacia || null,
      cliente: cv.cliente || null,
      componente_id: cv.componente_id || null,
      componente: cv.componente || null,
      no_skf: cv.no_skf || null,
      no_orden: cv.no_orden || null,
      lote: cv.lote || null,
      cantidad: cv.cantidad ? Number(cv.cantidad) : null,
      estado: null
    }));
    carga.cavidades_totales  = cavTotales;
    carga.cavidades_cargadas = cavidades.filter(cv => !cv.es_vacia).length;
    carga.cavidades_buenas   = 0;
    carga.cavidades_defecto  = 0;
    carga.cavidades_vacias   = cavidades.filter(cv => cv.es_vacia).length;

    if (!pdb.cavidades_l1) pdb.cavidades_l1 = [];
    cavidades.forEach((cv, i) => {
      pdb.cavidades_l1.push({
        id:              dbProd.nextId(pdb.cavidades_l1),
        folio_barril:    folio,
        carga_id:        carga.id,
        herramental_no:  herr.numero,
        herramental_id:  herr.id,
        cavidad_num:     i + 1,
        es_vacia:        cv.es_vacia || false,
        cliente:         cv.cliente   || null,
        componente:      cv.componente || null,
        no_skf:          cv.no_skf    || null,
        no_orden:        cv.no_orden  || null,
        lote:            cv.lote      || null,
        cantidad:        cv.cantidad  ? Number(cv.cantidad) : null,
        proceso:         proceso?.nombre    || null,
        sub_proceso:     subProceso?.nombre || null,
        operador:        operador?.nombre   || null,
        fecha_carga:     fecha,
        hora_carga:      hora,
        turno,
        semana,
        estado:          cv.es_vacia ? 'vacia' : 'activo',
        resultado:       null,
        defecto_id:      null,
        defecto:         null,
        fecha_descarga:  null,
        hora_descarga:   null,
        created_at:      now
      });
    });
  } else {
    const comp = (pdb.componentes_l1 || []).find(c => String(c.id) === String(body.componente_id));
    const ppvComp = comp ? (Number(comp.piezas_por_varilla) || Number(comp.piezas_objetivo) || null) : null;
    carga.cliente       = body.cliente || comp?.cliente || null;
    carga.componente_id = comp?.id     || null;
    carga.componente    = comp?.nombre || body.componente || null;
    carga.no_skf        = body.no_skf  || comp?.no_skf  || null;
    carga.no_orden      = body.no_orden || null;
    carga.lote          = body.lote     || null;

    const varillasDefault = comp ? (Number(comp.carga_optima_varillas) || null) : (Number(herr.varillas_totales) || null);
    carga.varillas = body.varillas ? Number(body.varillas) : varillasDefault;
    carga.piezas_por_varilla = body.piezas_por_varilla ? Number(body.piezas_por_varilla) : ppvComp;
    carga.cantidad = carga.varillas && carga.piezas_por_varilla
      ? carga.varillas * carga.piezas_por_varilla
      : (body.cantidad ? Number(body.cantidad) : null);

    const ppvObj = ppvComp || 0;
    carga.piezas_objetivo_carga = herr.varillas_totales && ppvObj ? Number(herr.varillas_totales) * ppvObj : 0;
    carga.es_vacia = body.es_vacia || false;
  }

  pdb.cargas_l1.push(carga);
  dbProd.write(pdb);
  res.status(201).json(carga);
});

// POST /l1/cargas/:id/descargar
router.post('/l1/cargas/:id/descargar', (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  if (!pdb.cargas_l1) return res.status(404).json({ error: 'No encontrado' });
  const idx = pdb.cargas_l1.findIndex(c => String(c.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Carga L1 no encontrada' });
  const carga = pdb.cargas_l1[idx];
  if (carga.estado !== 'activo') return res.status(409).json({ error: 'La carga no está activa' });

  const body = req.body || {};
  const fecha = nowDateStr();
  const hora  = nowTimeStr();
  const descargaCtx = resolveTurnoContext(pdb, 'L1', fecha, hora);
  const turno = descargaCtx.turno;

  if (carga.herramental_tipo === 'barril') {
    const cavResultados = Array.isArray(body.cavidades) ? body.cavidades : [];
    carga.cavidades = (carga.cavidades || []).map(cv => {
      const r = cavResultados.find(r => r.num === cv.num) || {};
      return { ...cv, estado: r.estado || cv.estado || 'vacia', defecto_id: r.defecto_id || null, defecto: r.defecto || null };
    });
    carga.cavidades_buenas  = carga.cavidades.filter(cv => cv.estado === 'buena').length;
    carga.cavidades_defecto = carga.cavidades.filter(cv => cv.estado === 'defecto').length;
    carga.cavidades_vacias  = carga.cavidades.filter(cv => cv.estado === 'vacia' || cv.es_vacia).length;

    if (pdb.cavidades_l1) {
      pdb.cavidades_l1 = pdb.cavidades_l1.map(cav => {
        if (String(cav.carga_id) !== String(carga.id)) return cav;
        const r = cavResultados.find(r => r.num === cav.cavidad_num) || {};
        return {
          ...cav,
          estado:        r.estado     || cav.estado     || (cav.es_vacia ? 'vacia' : 'descargado'),
          resultado:     r.estado     || null,
          defecto_id:    r.defecto_id || null,
          defecto:       r.defecto    || null,
          fecha_descarga: fecha,
          hora_descarga:  hora
        };
      });
    }
  } else {
    if (body.defecto_id) {
      carga.defecto_id = body.defecto_id;
      const def = (pdb.defectos_l1 || []).find(d => String(d.id) === String(body.defecto_id));
      carga.defecto = def?.nombre || body.defecto || null;
      carga.estado  = 'defecto';
    } else {
      carga.estado = 'descargado';
    }
  }

  if (carga.herramental_tipo === 'barril') carga.estado = 'descargado';

  carga.fecha_descarga = fecha;
  carga.hora_descarga  = hora;
  carga.turno          = turno;
  carga.turno_descarga = turno;
  carga.fecha_operativa_descarga = descargaCtx.fecha_turno;
  pdb.cargas_l1[idx] = carga;
  dbProd.write(pdb);
  res.json(carga);
});

// POST /l1/cargas/:id/reprocesar
router.post('/l1/cargas/:id/reprocesar', (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  if (!pdb.cargas_l1) return res.status(404).json({ error: 'No encontrado' });
  const idx = pdb.cargas_l1.findIndex(c => String(c.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Carga L1 no encontrada' });
  const original = pdb.cargas_l1[idx];

  if (!['activo', 'defecto'].includes(original.estado)) return res.status(409).json({ error: 'Solo se pueden reprocesar cargas activas o con defecto' });

  const _l1rCtx = resolveTurnoContext(pdb, 'L1', nowDateStr(), nowTimeStr());
  if (!_l1rCtx.activo) return res.status(409).json({ error: `El turno ${_l1rCtx.turno} no está activo para L1 en esta fecha` });

  if (original.estado === 'activo') {
    original.estado = 'defecto';
    original.fecha_descarga = nowDateStr();
    original.hora_descarga  = nowTimeStr();
    original.turno_descarga = _l1rCtx.turno;
    original.fecha_operativa_descarga = _l1rCtx.fecha_turno;
  }

  const activos = pdb.cargas_l1.filter(c => c.estado === 'activo');
  if (activos.length >= 8) return res.status(409).json({ error: 'Máximo de 8 herramentales activos en L1' });

  const folio = nextFolio('L1', pdb.cargas_l1, 'folio');
  const nueva = {
    ...original,
    id: dbProd.nextId(pdb.cargas_l1),
    folio,
    estado: 'activo',
    fecha_carga: nowDateStr(), fecha_turno: _l1rCtx.fecha_turno, hora_carga: nowTimeStr(),
    turno: _l1rCtx.turno,
    fecha_descarga: null, hora_descarga: null,
    defecto_id: null, defecto: null,
    es_reproceso: true, folio_origen: original.folio,
    created_at: new Date().toISOString()
  };
  if (original.herramental_tipo === 'barril') {
    nueva.cavidades = (original.cavidades || []).map(cv => ({ ...cv, estado: null }));
    nueva.cavidades_buenas = 0; nueva.cavidades_defecto = 0;
  }

  original.reprocesado = true;
  pdb.cargas_l1[idx] = original;
  pdb.cargas_l1.push(nueva);
  dbProd.write(pdb);
  res.status(201).json(nueva);
});

// GET /l1/paros/activo
router.get('/l1/paros/activo', (req, res) => {
  const pdb = dbProd.read();
  const paro = (pdb.paros_l1 || []).find(p => !p.fecha_fin);
  res.json({ paro: paro || null });
});

// POST /l1/paros
router.post('/l1/paros', (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.paros_l1) pdb.paros_l1 = [];

  const abierto = pdb.paros_l1.find(p => !p.fecha_fin);
  if (abierto) return res.status(409).json({ error: 'Ya existe un paro activo en L1' });

  const body = req.body || {};
  const fecha_inicio = body.fecha_inicio || nowDateStr();
  const hora_inicio  = body.hora_inicio  || nowTimeStr();
  const _l1PCtx = resolveTurnoContext(pdb, 'L1', fecha_inicio, hora_inicio);
  if (!_l1PCtx.activo) return res.status(409).json({ error: `El turno ${_l1PCtx.turno} no está activo para L1 en esta fecha` });
  const turno        = _l1PCtx.turno;

  let motivo_id = body.motivo_id, motivo = body.motivo;
  if (!motivo_id && motivo) {
    const existente = (pdb.motivos_paro_l1 || []).find(m => m.nombre === motivo);
    if (existente) { motivo_id = existente.id; }
    else {
      if (!pdb.motivos_paro_l1) pdb.motivos_paro_l1 = [];
      const newM = { id: dbProd.nextId(pdb.motivos_paro_l1), nombre: motivo, activo: true, created_at: new Date().toISOString() };
      pdb.motivos_paro_l1.push(newM);
      motivo_id = newM.id;
    }
  }

  const folio = nextFolio('L1P', pdb.paros_l1, 'folio');
  const paro = {
    id: dbProd.nextId(pdb.paros_l1), folio,
    motivo_id, motivo,
    sub_motivo_id: body.sub_motivo_id || null,
    sub_motivo: body.sub_motivo || null,
    fecha_inicio, hora_inicio, turno,
    fecha_fin: null, hora_fin: null, duracion_min: null,
    tipo: body.tipo || null,
    created_at: new Date().toISOString()
  };
  pdb.paros_l1.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// PATCH /l1/paros/:id/cerrar
router.patch('/l1/paros/:id/cerrar', (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  if (!pdb.paros_l1) return res.status(404).json({ error: 'No encontrado' });
  const idx = pdb.paros_l1.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });
  const paro = pdb.paros_l1[idx];
  if (paro.fecha_fin) return res.status(409).json({ error: 'El paro ya está cerrado' });

  const fecha_fin = nowDateStr();
  const hora_fin  = nowTimeStr();
  const ini  = toMins(paro.hora_inicio);
  const fin  = toMins(hora_fin);
  const duracion_min = fin >= ini ? fin - ini : 1440 - ini + fin;

  paro.fecha_fin = fecha_fin; paro.hora_fin = hora_fin; paro.duracion_min = duracion_min;
  pdb.paros_l1[idx] = paro;
  dbProd.write(pdb);
  res.json(paro);
});

// POST /l1/paros/auto-sin-actividad (idempotente)
router.post('/l1/paros/auto-sin-actividad', (req, res) => {
  const { fecha, turno } = req.body || {};
  if (!fecha || !turno) return res.status(400).json({ error: 'fecha y turno requeridos' });

  const pdb = dbProd.read();

  // Verificar que el turno está activo en el calendario
  if (!isTurnoActivo(pdb, 'L1', turno, fecha)) {
    return res.json({ skipped: true, reason: 'turno_inactivo' });
  }

  const cargas = (pdb.cargas_l1 || []).filter(c =>
    ((c.fecha_turno || c.fecha_carga) === fecha) && c.turno === turno
  );
  if (cargas.length > 0) return res.json({ skipped: true, reason: 'Hay cargas en el turno' });

  const paros = (pdb.paros_l1 || []).filter(p => p.fecha_inicio === fecha && p.turno === turno);
  if (paros.length > 0) return res.json({ skipped: true, reason: 'Ya hay paros en el turno' });

  if (!pdb.motivos_paro_l1) pdb.motivos_paro_l1 = [];
  let motivoAuto = pdb.motivos_paro_l1.find(m => m.nombre === 'Turno no trabajado');
  if (!motivoAuto) {
    motivoAuto = { id: dbProd.nextId(pdb.motivos_paro_l1), nombre: 'Turno no trabajado', activo: true, created_at: new Date().toISOString() };
    pdb.motivos_paro_l1.push(motivoAuto);
  }

  const SHIFT_TIMES = { T1: { hi:'06:30', hf:'14:30', dur:480 }, T2: { hi:'14:30', hf:'21:30', dur:420 }, T3: { hi:'21:30', hf:'06:30', dur:540 } };
  const st = SHIFT_TIMES[turno] || SHIFT_TIMES.T1;
  if (!pdb.paros_l1) pdb.paros_l1 = [];
  const folio = nextFolio('L1P', pdb.paros_l1, 'folio');
  const paro = {
    id: dbProd.nextId(pdb.paros_l1), folio,
    motivo_id: motivoAuto.id, motivo: motivoAuto.nombre,
    sub_motivo_id: null, sub_motivo: null,
    fecha_inicio: fecha, hora_inicio: st.hi, turno,
    fecha_fin: turno === 'T3' ? addDays(fecha, 1) : fecha,
    hora_fin: st.hf, duracion_min: st.dur,
    tipo: 'auto', created_at: new Date().toISOString()
  };
  pdb.paros_l1.push(paro);
  dbProd.write(pdb);
  res.json({ created: true, paro });
});

// POST /l1/paros/antes-de-tiempo
router.post('/l1/paros/antes-de-tiempo', produccionAllowRoles('produccion'), (req, res) => {
  const { hora_inicio, fecha_inicio, hora_fin } = req.body || {};
  if (!hora_inicio || !fecha_inicio || !hora_fin) return res.status(400).json({ error: 'hora_inicio, fecha_inicio y hora_fin requeridos' });

  const pdb    = dbProd.read();
  const motivo = ensureMotivoParo(pdb, 'motivos_paro_l1', 'Paro antes de tiempo');

  const ini = toMins(hora_inicio);
  const fin = toMins(hora_fin);
  const duracion_min = fin >= ini ? fin - ini : 1440 - ini + fin;
  if (duracion_min <= 0) return res.json({ skipped: true, reason: 'duracion_cero' });

  const yaExiste = (pdb.paros_l1 || []).find(p =>
    p.tipo === 'antes_de_tiempo' &&
    p.fecha_inicio === fecha_inicio && p.hora_inicio === hora_inicio);
  if (yaExiste) return res.json({ skipped: true, paro: yaExiste });

  const _l1atCtx = resolveTurnoContext(pdb, 'L1', fecha_inicio, hora_inicio);
  if (!_l1atCtx.activo) return res.status(409).json({ error: `El turno ${_l1atCtx.turno} no está activo para L1 en esta fecha` });
  const turno = _l1atCtx.turno;
  const id    = dbProd.nextId(pdb.paros_l1 || []);
  const paro  = {
    id, folio: `L1PAT-${nowDateStr().replace(/-/g,'')}-${id}`,
    motivo_id: motivo.id, motivo: motivo.nombre,
    sub_motivo_id: null, sub_motivo: null,
    fecha_inicio, hora_inicio, fecha_fin: fecha_inicio, hora_fin,
    duracion_min, turno, tipo: 'antes_de_tiempo',
    created_at: new Date().toISOString()
  };
  if (!pdb.paros_l1) pdb.paros_l1 = [];
  pdb.paros_l1.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LÍNEA BAKER ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /baker/cargas/activas
router.get('/baker/cargas/activas', (req, res) => {
  const pdb = dbProd.read();
  const cargas = (pdb.cargas_baker || []).filter(c => c.estado === 'activo');
  cargas.sort((a, b) => {
    const ta = `${a.fecha_carga}T${a.hora_carga}`;
    const tb = `${b.fecha_carga}T${b.hora_carga}`;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  res.json(cargas);
});

// GET /baker/cargas
router.get('/baker/cargas', (req, res) => {
  const { fecha_ini, fecha_fin, turno, estado } = req.query;
  const pdb = dbProd.read();
  let cargas = (pdb.cargas_baker || []).map(c => {
    const ctx = getStoredOperationalContext({ ...c, _linea: 'Baker' }, pdb);
    return {
      ...c, turno_captura: c.turno, turno: ctx.turno,
      turno_operativo: ctx.turno, fecha_operativa: ctx.fecha_operativa
    };
  });
  if (fecha_ini) cargas = cargas.filter(c => c.fecha_operativa >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => c.fecha_operativa <= fecha_fin);
  if (turno)  cargas = cargas.filter(c => c.turno_operativo === turno);
  if (estado) cargas = cargas.filter(c => c.estado === estado);
  cargas = cargas.sort((a, b) => {
    const ta = `${a.fecha_carga}T${a.hora_carga}`;
    const tb = `${b.fecha_carga}T${b.hora_carga}`;
    return ta > tb ? -1 : ta < tb ? 1 : 0;
  });
  res.json(cargas);
});

// GET /baker/cavidades — registros individuales de cavidades de barril
router.get('/baker/cavidades', (req, res) => {
  const { fecha_ini, fecha_fin, turno, folio_barril } = req.query;
  const pdb = dbProd.read();
  const cargasById = new Map((pdb.cargas_baker || []).map(c => [String(c.id), c]));
  let cavs = (pdb.cavidades_baker || []).map(c => {
    const parent = cargasById.get(String(c.carga_id));
    const ctx = getStoredOperationalContext({ ...(parent || c), _linea: 'Baker' }, pdb);
    return { ...c, turno_captura: c.turno, turno: ctx.turno, turno_operativo: ctx.turno, fecha_operativa: ctx.fecha_operativa };
  });
  if (fecha_ini)    cavs = cavs.filter(c => c.fecha_operativa >= fecha_ini);
  if (fecha_fin)    cavs = cavs.filter(c => c.fecha_operativa <= fecha_fin);
  if (turno)        cavs = cavs.filter(c => c.turno_operativo === turno);
  if (folio_barril) cavs = cavs.filter(c => c.folio_barril === folio_barril);
  res.json(cavs);
});

// POST /baker/cargas — registrar nueva carga Baker (rack o barril)
router.post('/baker/cargas', (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.cargas_baker) pdb.cargas_baker = [];
  if (!pdb.herramentales_baker) pdb.herramentales_baker = [];

  // Candado: no permitir carga si hay paro activo en Baker
  const paroActivoBaker = (pdb.paros_baker || []).find(p => !p.fecha_fin);
  if (paroActivoBaker) return res.status(409).json({ error: `Hay un paro activo en Baker (${paroActivoBaker.motivo || 'sin motivo'}). Ciérralo antes de registrar una carga.`, paro: paroActivoBaker });

  const body = req.body || {};
  const { herramental_id, proceso_id, sub_proceso_id, operador_id } = body;
  if (!herramental_id) return res.status(400).json({ error: 'herramental_id es requerido' });

  // Validar máximo 7 herramentales activos simultáneos
  const activos = (pdb.cargas_baker || []).filter(c => c.estado === 'activo');
  if (activos.length >= 7) return res.status(409).json({ error: 'Máximo 7 herramentales activos simultáneamente en Baker' });

  // Validar no duplicar herramental activo
  const dupActivo = activos.find(c => String(c.herramental_id) === String(herramental_id));
  if (dupActivo) return res.status(409).json({ error: `El herramental ya está activo (folio ${dupActivo.folio})` });

  const herr = (pdb.herramentales_baker || []).find(h => String(h.id) === String(herramental_id));
  if (!herr) return res.status(404).json({ error: 'Herramental no encontrado' });

  // Validaciones obligatorias siempre (con o sin material)
  if (!proceso_id)    return res.status(400).json({ error: 'proceso_id es requerido' });
  if (!sub_proceso_id) return res.status(400).json({ error: 'sub_proceso_id es requerido' });
  if (!operador_id)   return res.status(400).json({ error: 'operador_id es requerido' });

  const esVacioRack = (herr.tipo !== 'barril') && (body.es_vacia === true);

  // Validaciones de material (rack no vacío)
  if (herr.tipo !== 'barril' && !esVacioRack) {
    if (!body.cliente)                               return res.status(400).json({ error: 'cliente es requerido' });
    if (!body.componente_id && !body.componente)     return res.status(400).json({ error: 'componente es requerido' });
    if (!body.no_skf)                               return res.status(400).json({ error: 'no_skf es requerido' });
    if (!body.no_orden)                             return res.status(400).json({ error: 'no_orden es requerido' });
    if (!body.varillas)                             return res.status(400).json({ error: 'varillas es requerido' });
  }

  // Validaciones por cavidad (barril)
  if (herr.tipo === 'barril') {
    const cavidades = Array.isArray(body.cavidades) ? body.cavidades : [];
    const errCav = [];
    cavidades.forEach((cv, i) => {
      if (!cv.es_vacia) {
        if (!cv.cliente)    errCav.push(`Cavidad ${i+1}: cliente`);
        if (!cv.componente) errCav.push(`Cavidad ${i+1}: componente`);
        if (!cv.no_skf)    errCav.push(`Cavidad ${i+1}: no_skf`);
        if (!cv.no_orden)  errCav.push(`Cavidad ${i+1}: no_orden`);
        if (!cv.cantidad)  errCav.push(`Cavidad ${i+1}: cantidad`);
      }
    });
    if (errCav.length) return res.status(400).json({ error: `Campos requeridos: ${errCav.join(', ')}` });
    // Bloquear barril con todas las cavidades vacías (ciclo en blanco)
    if (cavidades.filter(cv => !cv.es_vacia).length === 0) {
      return res.status(400).json({ error: 'El barril debe tener al menos una cavidad con material' });
    }
  }

  const proceso    = (pdb.procesos_baker      || []).find(p => String(p.id) === String(proceso_id));
  const subProceso = (pdb.sub_procesos_baker  || []).find(s => String(s.id) === String(sub_proceso_id));
  const operador   = (pdb.operadores_baker    || []).find(o => String(o.id) === String(operador_id));

  const now        = new Date().toISOString();
  const hora       = nowTimeStr();
  const fecha      = nowDateStr();
  const ctx        = resolveTurnoContext(pdb, 'Baker', fecha, hora);
  if (!ctx.activo) return res.status(409).json({ error: `El turno ${ctx.turno} no está activo para Baker en esta fecha` });
  const fecha_turno_b = ctx.fecha_turno;
  const turno      = ctx.turno;
  const semana     = getISOWeek(new Date(fecha_turno_b + 'T12:00:00'));
  const folio = nextFolio('BKR', pdb.cargas_baker, 'folio');

  let carga = {
    id: dbProd.nextId(pdb.cargas_baker),
    folio,
    herramental_id: herr.id,
    herramental_no: herr.numero,
    herramental_tipo: herr.tipo || 'rack',
    proceso_id:     proceso?.id    || null,
    proceso:        proceso?.nombre || body.proceso || null,
    sub_proceso_id: subProceso?.id    || null,
    sub_proceso:    subProceso?.nombre || body.sub_proceso || null,
    operador_id:    operador?.id    || null,
    operador:       operador?.nombre || body.operador || null,
    fecha_carga: fecha, fecha_turno: fecha_turno_b, hora_carga: hora, semana, turno,
    fecha_descarga: null, hora_descarga: null,
    estado: 'activo',
    es_reproceso: body.es_reproceso || false,
    folio_origen: body.folio_origen || null,
    created_at: now
  };

  if (herr.tipo === 'barril') {
    const cavidades = Array.isArray(body.cavidades) ? body.cavidades : [];
    const cavTotales = herr.cavidades || cavidades.length;
    carga.herramental_cavidades = cavTotales;
    carga.cavidades = cavidades.map((cv, i) => ({
      num: i + 1,
      es_vacia: cv.es_vacia || false,
      motivo_vacia_id: cv.motivo_vacia_id || null,
      motivo_vacia: cv.motivo_vacia || null,
      cliente: cv.cliente || null,
      componente_id: cv.componente_id || null,
      componente: cv.componente || null,
      no_skf: cv.no_skf || null,
      no_orden: cv.no_orden || null,
      lote: cv.lote || null,
      cantidad: cv.cantidad ? Number(cv.cantidad) : null,
      estado: null // se asigna al descargar
    }));
    carga.cavidades_totales  = cavTotales;
    carga.cavidades_cargadas = cavidades.filter(cv => !cv.es_vacia).length;
    carga.cavidades_buenas   = 0;
    carga.cavidades_defecto  = 0;
    carga.cavidades_vacias   = cavidades.filter(cv => cv.es_vacia).length;

    // ── Registros individuales por cavidad (un registro = una cavidad, folio_barril agrupa el ciclo)
    if (!pdb.cavidades_baker) pdb.cavidades_baker = [];
    cavidades.forEach((cv, i) => {
      pdb.cavidades_baker.push({
        id:              dbProd.nextId(pdb.cavidades_baker),
        folio_barril:    folio,          // clave que une todas las cavidades del mismo ciclo
        carga_id:        carga.id,
        herramental_no:  herr.numero,
        herramental_id:  herr.id,
        cavidad_num:     i + 1,
        es_vacia:        cv.es_vacia || false,
        cliente:         cv.cliente   || null,
        componente:      cv.componente || null,
        no_skf:          cv.no_skf    || null,
        no_orden:        cv.no_orden  || null,
        lote:            cv.lote      || null,
        cantidad:        cv.cantidad  ? Number(cv.cantidad) : null,
        proceso:         proceso?.nombre    || null,
        sub_proceso:     subProceso?.nombre || null,
        operador:        operador?.nombre   || null,
        fecha_carga:     fecha,
        hora_carga:      hora,
        turno,
        semana,
        estado:          cv.es_vacia ? 'vacia' : 'activo',
        resultado:       null,
        defecto_id:      null,
        defecto:         null,
        fecha_descarga:  null,
        hora_descarga:   null,
        created_at:      now
      });
    });
  } else {
    // rack
    const comp = (pdb.componentes_baker || []).find(c => String(c.id) === String(body.componente_id));
    const compObj = comp?.piezas_objetivo || 0;
    const compOptima = comp?.carga_optima_varillas || 0;
    carga.cliente       = body.cliente || comp?.cliente || null;
    carga.componente_id = comp?.id     || null;
    carga.componente    = comp?.nombre || body.componente || null;
    carga.no_skf        = body.no_skf  || comp?.no_skf  || null;
    carga.no_orden      = body.no_orden || null;
    carga.lote          = body.lote     || null;

    // Varillas: si hay componente usa carga_optima_varillas del componente;
    // si no hay componente, usa varillas_totales del herramental (capacidad total del rack)
    const varillasDefault = comp ? (Number(comp.carga_optima_varillas) || null) : (Number(herr.varillas_totales) || null);
    carga.varillas = body.varillas ? Number(body.varillas) : varillasDefault;

    // piezas_por_varilla: del cuerpo del request, o del componente (piezas_por_varilla > piezas_objetivo)
    const ppvComp = comp ? (Number(comp.piezas_por_varilla) || Number(comp.piezas_objetivo) || null) : null;
    carga.piezas_por_varilla = body.piezas_por_varilla ? Number(body.piezas_por_varilla) : ppvComp;

    carga.cantidad = carga.varillas && carga.piezas_por_varilla
      ? carga.varillas * carga.piezas_por_varilla
      : (body.cantidad ? Number(body.cantidad) : null);

    // Para KPI capacidad:
    // - Con componente: objetivo = carga_optima_varillas × piezas_objetivo (como L3/L4)
    // - Sin componente: objetivo = varillas_totales (24) × ppv capturado por el operador
    const ppvForObj = ppvComp || Number(body.piezas_por_varilla || 0);
    carga.piezas_objetivo_carga = comp
      ? Number(comp.carga_optima_varillas || 0) * Number(comp.piezas_objetivo || 0)
      : (herr.varillas_totales && ppvForObj ? Number(herr.varillas_totales) * ppvForObj : 0);
    carga.es_vacia = body.es_vacia || false;
  }

  pdb.cargas_baker.push(carga);
  dbProd.write(pdb);
  res.status(201).json(carga);
});

// POST /baker/cargas/:id/descargar
router.post('/baker/cargas/:id/descargar', (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  if (!pdb.cargas_baker) return res.status(404).json({ error: 'No encontrado' });
  const idx = pdb.cargas_baker.findIndex(c => String(c.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Carga Baker no encontrada' });
  const carga = pdb.cargas_baker[idx];
  if (carga.estado !== 'activo') return res.status(409).json({ error: 'La carga no está activa' });

  const body = req.body || {};
  const fecha = nowDateStr();
  const hora  = nowTimeStr();
  const descargaCtx = resolveTurnoContext(pdb, 'Baker', fecha, hora);
  const turno = descargaCtx.turno;

  if (carga.herramental_tipo === 'barril') {
    // body.cavidades: [{num, estado:'buena'|'defecto'|'vacia', defecto_id, defecto}]
    const cavResultados = Array.isArray(body.cavidades) ? body.cavidades : [];
    carga.cavidades = (carga.cavidades || []).map(cv => {
      const r = cavResultados.find(r => r.num === cv.num) || {};
      return { ...cv, estado: r.estado || cv.estado || 'vacia', defecto_id: r.defecto_id || null, defecto: r.defecto || null };
    });
    carga.cavidades_buenas  = carga.cavidades.filter(cv => cv.estado === 'buena').length;
    carga.cavidades_defecto = carga.cavidades.filter(cv => cv.estado === 'defecto').length;
    carga.cavidades_vacias  = carga.cavidades.filter(cv => cv.estado === 'vacia' || cv.es_vacia).length;

    // Actualizar registros individuales de cavidades_baker
    if (pdb.cavidades_baker) {
      pdb.cavidades_baker = pdb.cavidades_baker.map(cav => {
        if (String(cav.carga_id) !== String(carga.id)) return cav;
        const r = cavResultados.find(r => r.num === cav.cavidad_num) || {};
        return {
          ...cav,
          estado:        r.estado     || cav.estado     || (cav.es_vacia ? 'vacia' : 'descargado'),
          resultado:     r.estado     || null,
          defecto_id:    r.defecto_id || null,
          defecto:       r.defecto    || null,
          fecha_descarga: fecha,
          hora_descarga:  hora
        };
      });
    }
  } else {
    // rack
    if (body.defecto_id) {
      carga.defecto_id = body.defecto_id;
      const def = (pdb.defectos_baker || []).find(d => String(d.id) === String(body.defecto_id));
      carga.defecto = def?.nombre || body.defecto || null;
      carga.estado  = 'defecto';
    } else {
      carga.estado = 'descargado';
    }
  }

  if (carga.herramental_tipo === 'barril') {
    carga.estado = 'descargado';
  }

  carga.fecha_descarga = fecha;
  carga.hora_descarga  = hora;
  carga.turno          = turno;
  carga.turno_descarga = turno;
  carga.fecha_operativa_descarga = descargaCtx.fecha_turno;
  pdb.cargas_baker[idx] = carga;
  dbProd.write(pdb);
  res.json(carga);
});

// POST /baker/cargas/:id/reprocesar — crear nueva carga de reproceso para rack Baker
router.post('/baker/cargas/:id/reprocesar', (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  if (!pdb.cargas_baker) return res.status(404).json({ error: 'No encontrado' });
  const idx = pdb.cargas_baker.findIndex(c => String(c.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Carga Baker no encontrada' });
  const original = pdb.cargas_baker[idx];

  if (!['activo', 'defecto'].includes(original.estado)) return res.status(409).json({ error: 'Solo se pueden reprocesar cargas activas o con defecto' });

  const _bkrCtx = resolveTurnoContext(pdb, 'Baker', nowDateStr(), nowTimeStr());
  if (!_bkrCtx.activo) return res.status(409).json({ error: `El turno ${_bkrCtx.turno} no está activo para Baker en esta fecha` });

  if (original.estado === 'activo') {
    original.estado = 'defecto';
    original.fecha_descarga = nowDateStr();
    original.hora_descarga  = nowTimeStr();
    original.turno          = _bkrCtx.turno;
    original.turno_descarga = _bkrCtx.turno;
    original.fecha_operativa_descarga = _bkrCtx.fecha_turno;
  }

  const activos = pdb.cargas_baker.filter(c => c.estado === 'activo');
  if (activos.length >= 7) return res.status(409).json({ error: 'Máximo 7 herramentales activos' });

  const folio = nextFolio('BKR', pdb.cargas_baker, 'folio');
  const nueva = {
    ...original,
    id: dbProd.nextId(pdb.cargas_baker),
    folio,
    estado: 'activo',
    fecha_carga: nowDateStr(), fecha_turno: _bkrCtx.fecha_turno, hora_carga: nowTimeStr(),
    turno: _bkrCtx.turno,
    fecha_descarga: null, hora_descarga: null,
    defecto_id: null, defecto: null,
    es_reproceso: true, folio_origen: original.folio,
    created_at: new Date().toISOString()
  };
  if (original.herramental_tipo === 'barril') {
    nueva.cavidades = (original.cavidades || []).map(cv => ({ ...cv, estado: null }));
    nueva.cavidades_buenas = 0; nueva.cavidades_defecto = 0;
  }

  original.reprocesado = true;
  pdb.cargas_baker[idx] = original;
  pdb.cargas_baker.push(nueva);
  dbProd.write(pdb);
  res.status(201).json(nueva);
});

// GET /baker/paros/activo
router.get('/baker/paros/activo', (req, res) => {
  const pdb = dbProd.read();
  const paro = (pdb.paros_baker || []).find(p => !p.fecha_fin);
  res.json({ paro: paro || null });
});

// POST /baker/paros
router.post('/baker/paros', (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.paros_baker) pdb.paros_baker = [];

  const abierto = pdb.paros_baker.find(p => !p.fecha_fin);
  if (abierto) return res.status(409).json({ error: 'Ya existe un paro activo en Baker' });

  const body = req.body || {};
  const fecha_inicio = body.fecha_inicio || nowDateStr();
  const hora_inicio  = body.hora_inicio  || nowTimeStr();
  const _bkrPCtx = resolveTurnoContext(pdb, 'Baker', fecha_inicio, hora_inicio);
  if (!_bkrPCtx.activo) return res.status(409).json({ error: `El turno ${_bkrPCtx.turno} no está activo para Baker en esta fecha` });
  const turno        = _bkrPCtx.turno;

  let motivo_id = body.motivo_id, motivo = body.motivo;
  if (!motivo_id && motivo) {
    const existente = (pdb.motivos_paro_baker || []).find(m => m.nombre === motivo);
    if (existente) { motivo_id = existente.id; }
    else {
      if (!pdb.motivos_paro_baker) pdb.motivos_paro_baker = [];
      const newM = { id: dbProd.nextId(pdb.motivos_paro_baker), nombre: motivo, activo: true, created_at: new Date().toISOString() };
      pdb.motivos_paro_baker.push(newM);
      motivo_id = newM.id;
    }
  }

  const folio = nextFolio('BKRP', pdb.paros_baker, 'folio');
  const paro = {
    id: dbProd.nextId(pdb.paros_baker), folio,
    motivo_id, motivo,
    sub_motivo_id: body.sub_motivo_id || null,
    sub_motivo: body.sub_motivo || null,
    fecha_inicio, hora_inicio, turno,
    fecha_fin: null, hora_fin: null, duracion_min: null,
    tipo: body.tipo || null,
    created_at: new Date().toISOString()
  };
  pdb.paros_baker.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// PATCH /baker/paros/:id/cerrar
router.patch('/baker/paros/:id/cerrar', (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  if (!pdb.paros_baker) return res.status(404).json({ error: 'No encontrado' });
  const idx = pdb.paros_baker.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });
  const paro = pdb.paros_baker[idx];
  if (paro.fecha_fin) return res.status(409).json({ error: 'El paro ya está cerrado' });

  const fecha_fin = nowDateStr();
  const hora_fin  = nowTimeStr();
  const ini  = toMins(paro.hora_inicio);
  const fin  = toMins(hora_fin);
  const duracion_min = fin >= ini ? fin - ini : 1440 - ini + fin;

  paro.fecha_fin = fecha_fin; paro.hora_fin = hora_fin; paro.duracion_min = duracion_min;
  pdb.paros_baker[idx] = paro;
  dbProd.write(pdb);
  res.json(paro);
});

// POST /baker/paros/auto-sin-actividad (idempotente)
router.post('/baker/paros/auto-sin-actividad', (req, res) => {
  const { fecha, turno } = req.body || {};
  if (!fecha || !turno) return res.status(400).json({ error: 'fecha y turno requeridos' });

  const pdb = dbProd.read();

  // Verificar que el turno está activo en el calendario
  if (!isTurnoActivo(pdb, 'Baker', turno, fecha)) {
    return res.json({ skipped: true, reason: 'turno_inactivo' });
  }

  const cargas = (pdb.cargas_baker || []).filter(c =>
    ((c.fecha_turno || c.fecha_carga) === fecha) && c.turno === turno
  );
  if (cargas.length > 0) return res.json({ skipped: true, reason: 'Hay cargas en el turno' });

  const paros = (pdb.paros_baker || []).filter(p => p.fecha_inicio === fecha && p.turno === turno);
  if (paros.length > 0) return res.json({ skipped: true, reason: 'Ya hay paros en el turno' });

  if (!pdb.motivos_paro_baker) pdb.motivos_paro_baker = [];
  let motivoAuto = pdb.motivos_paro_baker.find(m => m.nombre === 'Turno no trabajado');
  if (!motivoAuto) {
    motivoAuto = { id: dbProd.nextId(pdb.motivos_paro_baker), nombre: 'Turno no trabajado', activo: true, created_at: new Date().toISOString() };
    pdb.motivos_paro_baker.push(motivoAuto);
  }

  const SHIFT_TIMES = { T1: { hi:'06:30', hf:'14:30', dur:480 }, T2: { hi:'14:30', hf:'21:30', dur:420 }, T3: { hi:'21:30', hf:'06:30', dur:540 } };
  const st = SHIFT_TIMES[turno] || SHIFT_TIMES.T1;
  if (!pdb.paros_baker) pdb.paros_baker = [];
  const folio = nextFolio('BKRP', pdb.paros_baker, 'folio');
  const paro = {
    id: dbProd.nextId(pdb.paros_baker), folio,
    motivo_id: motivoAuto.id, motivo: motivoAuto.nombre,
    sub_motivo_id: null, sub_motivo: null,
    fecha_inicio: fecha, hora_inicio: st.hi, turno,
    fecha_fin: turno === 'T3' ? addDays(fecha, 1) : fecha,
    hora_fin: st.hf, duracion_min: st.dur,
    tipo: 'auto', created_at: new Date().toISOString()
  };
  pdb.paros_baker.push(paro);
  dbProd.write(pdb);
  res.json({ created: true, paro });
});

// ─── Export ───────────────────────────────────────────────────────────────────

router.get('/export/:linea', produccionAllowRoles('admin'), (req, res) => {
  const { linea } = req.params;
  const { fecha_ini, fecha_fin } = req.query;
  const pdb = dbProd.read();

  let cargas = (pdb.cargas || []).filter(c => c.linea === linea).map(c => {
    const ctx = getStoredOperationalContext(c, pdb);
    return { ...c, turno_operativo: ctx.turno, fecha_operativa: ctx.fecha_operativa };
  });
  if (fecha_ini) cargas = cargas.filter(c => c.fecha_operativa >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => c.fecha_operativa <= fecha_fin);

  const rows = cargas.map(c => ({
    fecha_operativa: c.fecha_operativa,
    turno_operativo: c.turno_operativo,
    fecha_carga: c.fecha_carga,
    hora_carga: c.hora_carga,
    semana: c.semana,
    componente: c.componente,
    cantidad: c.cantidad,
    varillas: c.varillas,
    piezas_por_varilla: c.piezas_por_varilla,
    estado: c.estado,
    defecto: c.defecto,
    proceso: c.proceso,
    acabado: c.acabado,
    herramental_no: c.herramental_no,
    linea: c.linea,
    operador: c.operador,
    fecha_descarga: c.fecha_descarga,
    hora_descarga: c.hora_descarga
  }));

  res.json({ linea, total: rows.length, rows });
});

// ─── Paro "Antes de tiempo" ────────────────────────────────────────────────────
// Se registra cuando el operador no justificó la inactividad antes del cambio de turno.
// Crea automáticamente el motivo "Paro antes de tiempo" en el catálogo si no existe.
function ensureMotivoParo(pdb, motivoKey, nombre) {
  if (!pdb[motivoKey]) pdb[motivoKey] = [];
  let m = pdb[motivoKey].find(x => x.nombre === nombre);
  if (!m) {
    m = { id: pdb[motivoKey].length > 0 ? Math.max(...pdb[motivoKey].map(x => x.id)) + 1 : 1,
          nombre, activo: true, created_at: new Date().toISOString() };
    pdb[motivoKey].push(m);
  }
  return m;
}

router.post('/paros/:linea/antes-de-tiempo', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const { hora_inicio, fecha_inicio, hora_fin } = req.body || {};
  if (!hora_inicio || !fecha_inicio || !hora_fin) return res.status(400).json({ error: 'hora_inicio, fecha_inicio y hora_fin requeridos' });

  const pdb = dbProd.read();
  const l   = lineaKey(linea);
  const motivo = ensureMotivoParo(pdb, `motivos_paro_${l}`, 'Paro antes de tiempo');

  const ini = toMins(hora_inicio);
  const fin = toMins(hora_fin);
  const duracion_min = fin >= ini ? fin - ini : 1440 - ini + fin;
  if (duracion_min <= 0) return res.json({ skipped: true, reason: 'duracion_cero' });

  // Idempotente: no duplicar
  const yaExiste = (pdb.paros || []).find(p =>
    p.linea === linea && p.tipo === 'antes_de_tiempo' &&
    p.fecha_inicio === fecha_inicio && p.hora_inicio === hora_inicio);
  if (yaExiste) return res.json({ skipped: true, paro: yaExiste });

  const ctxPAT = resolveTurnoContext(pdb, linea, fecha_inicio, hora_inicio);
  if (!ctxPAT.activo) {
    return res.status(409).json({ error: `El turno ${ctxPAT.turno} no está activo para ${linea} en esta fecha` });
  }
  if (!ctxPAT.en_ventana) {
    return res.status(409).json({ error: `Fuera del horario de ${ctxPAT.turno} (${ctxPAT.hora_entrada}–${ctxPAT.hora_salida})` });
  }
  if (ctxPAT.turno === 'TL4' && toMins(hora_fin) > toMins(ctxPAT.hora_salida)) {
    return res.status(409).json({ error: `hora_fin excede la salida de TL4 (${ctxPAT.hora_salida})` });
  }
  const turno = ctxPAT.turno;
  const id    = dbProd.nextId(pdb.paros || []);
  const paro  = {
    id, folio: `PAT-${nowDateStr().replace(/-/g,'')}-${id}`, linea,
    motivo_id: motivo.id, motivo: motivo.nombre,
    sub_motivo_id: null, sub_motivo: null,
    fecha_inicio, hora_inicio, fecha_fin: fecha_inicio, hora_fin,
    duracion_min, turno, tipo: 'antes_de_tiempo',
    created_at: new Date().toISOString()
  };
  if (!pdb.paros) pdb.paros = [];
  pdb.paros.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

router.post('/baker/paros/antes-de-tiempo', produccionAllowRoles('produccion'), (req, res) => {
  const { hora_inicio, fecha_inicio, hora_fin } = req.body || {};
  if (!hora_inicio || !fecha_inicio || !hora_fin) return res.status(400).json({ error: 'hora_inicio, fecha_inicio y hora_fin requeridos' });

  const pdb    = dbProd.read();
  const motivo = ensureMotivoParo(pdb, 'motivos_paro_baker', 'Paro antes de tiempo');

  const ini = toMins(hora_inicio);
  const fin = toMins(hora_fin);
  const duracion_min = fin >= ini ? fin - ini : 1440 - ini + fin;
  if (duracion_min <= 0) return res.json({ skipped: true, reason: 'duracion_cero' });

  const yaExiste = (pdb.paros_baker || []).find(p =>
    p.tipo === 'antes_de_tiempo' &&
    p.fecha_inicio === fecha_inicio && p.hora_inicio === hora_inicio);
  if (yaExiste) return res.json({ skipped: true, paro: yaExiste });

  const _bkratCtx = resolveTurnoContext(pdb, 'Baker', fecha_inicio, hora_inicio);
  if (!_bkratCtx.activo) return res.status(409).json({ error: `El turno ${_bkratCtx.turno} no está activo para Baker en esta fecha` });
  const turno = _bkratCtx.turno;
  const id    = dbProd.nextId(pdb.paros_baker || []);
  const paro  = {
    id, folio: `BKPAT-${nowDateStr().replace(/-/g,'')}-${id}`,
    motivo_id: motivo.id, motivo: motivo.nombre,
    sub_motivo_id: null, sub_motivo: null,
    fecha_inicio, hora_inicio, fecha_fin: fecha_inicio, hora_fin,
    duracion_min, turno, tipo: 'antes_de_tiempo',
    created_at: new Date().toISOString()
  };
  if (!pdb.paros_baker) pdb.paros_baker = [];
  pdb.paros_baker.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// ─── Migración T3: agregar fecha_turno a todos los registros ─────────────────
// Idempotente: sólo agrega/corrige fecha_turno; nunca modifica fecha_carga.
// Usa created_at para recuperar la fecha real del calendario (por si fecha_carga
// fue modificada por el fix anterior), luego calcula fecha_turno = getShiftDate(real, hora).
router.post('/admin/migrate-t3-dates', produccionAllowRoles('admin'), (req, res) => {
  const pdb    = dbProd.read();
  const dryRun = req.query.dry !== 'false'; // dry run por defecto

  // YYYY-MM-DD en hora México a partir de un timestamp ISO
  function isoDateMx(isoStr) {
    return new Date(isoStr).toLocaleDateString('en-CA', { timeZone: MX_TZ });
  }

  const changes = [];

  function procesaColeccion(lista, tabla) {
    for (const c of (lista || [])) {
      if (!c.hora_carga) continue;

      // Fecha real del calendario: preferimos created_at sobre fecha_carga
      // (por si fecha_carga fue cambiada erróneamente en un fix anterior)
      const realDate    = c.created_at ? isoDateMx(c.created_at) : c.fecha_carga;
      const correctFT   = getShiftDate(realDate, c.hora_carga);
      const correctFC   = realDate; // fecha_carga debe ser la fecha real siempre
      const correctSem  = getISOWeek(new Date(correctFT + 'T12:00:00'));

      const needsFT  = c.fecha_turno !== correctFT;
      const needsFC  = c.fecha_carga !== correctFC;  // restaurar si fue cambiada
      const needsSem = needsFT && c.semana !== correctSem;

      if (needsFT || needsFC) {
        changes.push({
          tabla, id: c.id, folio: c.folio || c.id,
          hora_carga: c.hora_carga,
          fecha_carga_antes: c.fecha_carga,  fecha_carga_despues: correctFC,
          fecha_turno_antes: c.fecha_turno,  fecha_turno_despues: correctFT
        });
        if (!dryRun) {
          if (needsFC)  c.fecha_carga = correctFC;
          if (needsFT)  c.fecha_turno = correctFT;
          if (needsSem) c.semana      = correctSem;
        }
      }
    }
  }

  procesaColeccion(pdb.cargas,       'cargas');
  procesaColeccion(pdb.cargas_baker, 'cargas_baker');
  procesaColeccion(pdb.cargas_l1,    'cargas_l1');

  if (!dryRun && changes.length > 0) dbProd.write(pdb);

  res.json({ dryRun, total_cambios: changes.length, changes });
});

// ─── SCRAP ────────────────────────────────────────────────────────────────────

// GET /scrap — lista registros (filtros: linea, fecha_ini, fecha_fin)
router.get('/scrap', produccionAllowRoles('admin', 'produccion', 'pizarron'), (req, res) => {
  const { linea, fecha_ini, fecha_fin } = req.query;
  const pdb = dbProd.read();
  let records = (pdb.registros_scrap || []).map(r => {
    const ctx = resolveTurnoContext(pdb, r.linea || '', r.fecha || nowDateStr(), r.hora || '06:30');
    return { ...r, fecha_operativa: r.fecha_operativa || ctx.fecha_turno, turno: r.turno || ctx.turno };
  });
  if (linea)     records = records.filter(r => r.linea === linea);
  if (fecha_ini) records = records.filter(r => r.fecha_operativa >= fecha_ini);
  if (fecha_fin) records = records.filter(r => r.fecha_operativa <= fecha_fin);
  res.json({ records: records.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)) });
});

// POST /scrap — crear registro
router.post('/scrap', produccionAllowRoles('admin', 'produccion'), (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.registros_scrap) pdb.registros_scrap = [];
  const fechaRegistro = req.body.fecha || nowDateStr();
  const horaRegistro = req.body.hora || nowTimeStr();
  const scrapCtx = resolveTurnoContext(pdb, req.body.linea || '', fechaRegistro, horaRegistro);
  const folio = `SCRAP-${(req.body.linea || 'X').replace(/\s/g,'')}-${nowDateStr().replace(/-/g,'')}-${dbProd.nextId(pdb.registros_scrap)}`;
  const rec = {
    id:         dbProd.nextId(pdb.registros_scrap),
    folio,
    linea:      req.body.linea      || '',
    fecha:      fechaRegistro,
    fecha_operativa: scrapCtx.fecha_turno,
    hora:       horaRegistro,
    turno:      scrapCtx.turno,
    operador:   req.body.operador   || '',
    componente: req.body.componente || '',
    no_skf:     req.body.no_skf     || null,
    herramental:req.body.herramental|| '',
    proceso:    req.body.proceso    || '',
    piezas_scrap: Number(req.body.piezas_scrap) || 0,
    observaciones: req.body.observaciones || null,
    created_at: new Date().toISOString()
  };
  pdb.registros_scrap.push(rec);
  dbProd.write(pdb);
  res.json(rec);
});

// GET /scrap/resumen — % SCRAP por línea y día (público — usado por pizarrón sin auth)
router.get('/scrap/resumen', (req, res) => {
  const { linea, fecha_ini, fecha_fin } = req.query;
  const pdb = dbProd.read();

  let scrapRecs = (pdb.registros_scrap || []).map(r => {
    const ctx = resolveTurnoContext(pdb, r.linea || '', r.fecha || nowDateStr(), r.hora || '06:30');
    return { ...r, fecha_operativa: r.fecha_operativa || ctx.fecha_turno, turno: r.turno || ctx.turno };
  });
  if (linea)     scrapRecs = scrapRecs.filter(r => r.linea === linea);
  if (fecha_ini) scrapRecs = scrapRecs.filter(r => r.fecha_operativa >= fecha_ini);
  if (fecha_fin) scrapRecs = scrapRecs.filter(r => r.fecha_operativa <= fecha_fin);

  // Agrupar scrap por linea+fecha
  const scrapByDay = {};
  for (const r of scrapRecs) {
    const key = `${r.linea}|${r.fecha_operativa}`;
    scrapByDay[key] = (scrapByDay[key] || 0) + (Number(r.piezas_scrap) || 0);
  }

  const resumen = Object.entries(scrapByDay).map(([key, scrap]) => {
    const [l, fecha] = key.split('|');
    const isShiftCarga = (c, cargaLinea) => c.fecha_descarga && c.estado !== 'cancelado' &&
      getStoredOperationalContext({ ...c, _linea: cargaLinea }, pdb).fecha_operativa === fecha;
    // Calcular piezas totales producidas en ese día desde cargas descargadas
    let cargas = [];
    if (l === 'Baker') {
      cargas = (pdb.cargas_baker || []).filter(c => isShiftCarga(c, 'Baker'));
    } else if (l === 'L1') {
      cargas = (pdb.cargas_l1 || []).filter(c => isShiftCarga(c, 'L1'));
    } else {
      cargas = (pdb.cargas || []).filter(c => c.linea === l && isShiftCarga(c, l));
    }
    let piezas_buenas = 0;
    for (const c of cargas) {
      if (l === 'Baker' || l === 'L1') {
        if (c.herramental_tipo === 'barril') {
          piezas_buenas += Number(c.cavidades_buenas || 0);
        } else {
          piezas_buenas += Number(c.cantidad || 0);
        }
      } else {
        piezas_buenas += Number(c.cantidad || (Number(c.varillas || 0) * Number(c.piezas_por_varilla || 0)));
      }
    }
    // Scrap se expresa sobre el total fabricado: piezas buenas registradas +
    // piezas declaradas como scrap. Evita usar solo producto bueno como
    // denominador, que sobrestimaba el porcentaje.
    const piezas_total = piezas_buenas + scrap;
    const pct_scrap = piezas_total > 0 ? Math.round((scrap / piezas_total) * 10000) / 100 : null;
    return { linea: l, fecha, piezas_scrap: scrap, piezas_buenas, piezas_total, pct_scrap };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.linea.localeCompare(b.linea));

  res.json({ resumen });
});


// ─── Operadores activos por línea/turno hoy (para reconocimientos) ───────────
router.get('/reconocimientos', produccionAllowRoles('produccion'), (req, res) => {
  const pdb = dbProd.read();
  const fecha = req.query.fecha || getShiftDate(nowDateStr(), nowTimeStr());
  const cargas = [
    ...(pdb.cargas || []).map(c => ({ ...c, _linea: c.linea })),
    ...(pdb.cargas_baker || []).map(c => ({ ...c, _linea: 'Baker' })),
    ...(pdb.cargas_l1 || []).map(c => ({ ...c, _linea: 'L1' }))
  ].filter(c => c.estado !== 'cancelado').map(c => {
    const ctx = c.fecha_descarga
      ? getStoredOperationalContext(c, pdb)
      : { fecha_operativa: c.fecha_turno || c.fecha_carga, turno: c.turno };
    return { ...c, linea: c._linea, turno: ctx.turno, fecha_operativa: ctx.fecha_operativa };
  }).filter(c => c.fecha_operativa === fecha);
  // Agrupar operadores únicos por linea → turno
  const operadores = {};
  for (const c of cargas) {
    if (!c.operador || !c.linea || !c.turno) continue;
    if (!operadores[c.linea]) operadores[c.linea] = {};
    if (!operadores[c.linea][c.turno]) operadores[c.linea][c.turno] = new Set();
    operadores[c.linea][c.turno].add(c.operador);
  }
  // Convertir Sets a arrays
  const result = {};
  for (const [linea, turnos] of Object.entries(operadores)) {
    result[linea] = {};
    for (const [turno, names] of Object.entries(turnos)) {
      result[linea][turno] = [...names];
    }
  }
  res.json({ fecha, operadores: result });
});

// ─── Calendario de turnos por línea ────────────────────────────────────────

const LINEAS_VALIDAS = ['L3', 'L4', 'Baker', 'L1'];
const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

const DEFAULT_SCHEDULE = {
  lunes:     { T1: true, T2: true, T3: true },
  martes:    { T1: true, T2: true, T3: true },
  miercoles: { T1: true, T2: true, T3: true },
  jueves:    { T1: true, T2: true, T3: true },
  viernes:   { T1: true, T2: true, T3: true },
  sabado:    { T1: true, T2: true, T3: false },
  domingo:   { T1: false, T2: false, T3: false }
};

// Obtener el lunes de la semana para una fecha dada
function getWeekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0=dom, 1=lun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Helper: nombre del día de la semana para una fecha YYYY-MM-DD
function getDiaSemana(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const idx = dt.getDay(); // 0=dom
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][idx];
}

// Obtener calendario semanal para una línea; retorna default si no existe
function getTurnoSchedule(pdb, linea, weekStart) {
  const schedules = pdb.turno_schedules || [];
  const found = schedules.find(s => s.linea === linea && s.week_start === weekStart);
  return found ? found.schedule : { ...DEFAULT_SCHEDULE };
}

// Obtener config L4 para una semana; retorna default si no existe
function getTurnoL4Config(pdb, weekStart) {
  const configs = pdb.turno_l4_config || [];
  const found = configs.find(c => c.week_start === weekStart);
  if (found) return found;
  return {
    week_start: weekStart,
    dias: {
      lunes:     { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      martes:    { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      miercoles: { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      jueves:    { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      viernes:   { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      sabado:    { activo: false, hora_entrada: '08:00', hora_salida: '13:00' },
      domingo:   { activo: false, hora_entrada: '',      hora_salida: '' }
    },
    arranque_ciclos: 6
  };
}

// L4 usa TL4 si:
//   1. La fecha >= L4_TL4_CUTOVER_DATE, O
//   2. Existe un registro explícito en turno_l4_config para esa semana.
// Antes del cutover: backward compatible con T1/T2/T3 (datos históricos intactos).
function l4UsesTL4(pdb, fecha) {
  if (fecha >= L4_TL4_CUTOVER_DATE) return true;
  const weekStart = getWeekStart(fecha);
  return (pdb.turno_l4_config || []).some(c => c.week_start === weekStart);
}

// Saber si un turno está activo para una línea/fecha dada
function isTurnoActivo(pdb, linea, turno, fecha) {
  const weekStart = getWeekStart(fecha);
  if (linea === 'L4' && l4UsesTL4(pdb, fecha)) {
    // L4 en modo TL4: solo acepta turno 'TL4'
    if (turno !== 'TL4') return false;
    const cfg = getTurnoL4Config(pdb, weekStart);
    const dia = getDiaSemana(fecha);
    return !!(cfg.dias[dia] && cfg.dias[dia].activo);
  }
  // Modo normal (T1/T2/T3) — L3, L4 legacy, Baker, L1
  const schedule = getTurnoSchedule(pdb, linea, weekStart);
  const dia = getDiaSemana(fecha);
  return !!(schedule[dia] && schedule[dia][turno]);
}

// ── Helper central: resolver contexto de turno ──────────────────────────────
// Devuelve toda la info necesaria para determinar turno, validación de ventana,
// y fecha_turno correcta para cualquier línea.
// Usar para capturas, paros, reprocesos, stats.
function resolveTurnoContext(pdb, linea, fecha, hora) {
  if (linea === 'L4' && l4UsesTL4(pdb, fecha)) {
    const weekStart = getWeekStart(fecha);
    const cfg = getTurnoL4Config(pdb, weekStart);
    const dia = getDiaSemana(fecha);
    const diaConf = cfg.dias[dia] || { activo: false };
    const activo = !!diaConf.activo;
    const hora_entrada = diaConf.hora_entrada || '08:00';
    const hora_salida = diaConf.hora_salida || '17:00';
    const mins = toMins(hora);
    const entMins = toMins(hora_entrada);
    const salMins = toMins(hora_salida);
    const window = getTL4EffectiveWindow(pdb, fecha);
    // TL4 no admite horarios que crucen medianoche (salida > entrada validado en POST /turno-l4-config)
    const en_ventana_programada = activo && mins >= entMins && mins < salMins;
    const en_ventana = activo && mins >= entMins && mins <= (window.fin_efectivo_min ?? salMins);
    return {
      fecha_turno: fecha,    // TL4 no pasa por regla nocturna T3
      turno: 'TL4',
      activo,
      en_ventana,
      en_ventana_programada,
      es_tiempo_adicional: activo && mins >= (window.fin_base_min ?? entMins + L4_TIEMPO_BASE_MIN),
      hora_entrada,
      hora_salida,
      hora_fin_efectiva: window.hora_fin_efectiva || hora_salida,
      cargas_activas: window.cargas_activas || 0,
      week_start: weekStart,
      dia
    };
  }
  // T1/T2/T3 normal
  const turno = getTurno(hora);
  const fecha_turno = getShiftDate(fecha, hora);
  const activo = isTurnoActivo(pdb, linea, turno, fecha_turno);
  return {
    fecha_turno,
    turno,
    activo,
    en_ventana: activo,  // T1/T2/T3 siempre "en ventana" si el turno es detectado
    hora_entrada: null,
    hora_salida: null,
    week_start: getWeekStart(fecha_turno),
    dia: getDiaSemana(fecha_turno)
  };
}

// Resolver turno de una carga ya guardada (para stats/resumen).
// La descarga manda; el turno almacenado al crear la carga puede pertenecer a
// otro turno si el proceso terminó después de un cambio de turno.
function resolveStoredTurno(carga, pdb) {
  return getStoredOperationalContext(carga, pdb).turno;
}

// Horas de un turno: para TL4 usa config dinámica, para T1/T2/T3 usa TURNOS_DEF
function horasDelTurno(turno, pdb, fecha) {
  if (turno === 'TL4' && pdb && fecha) {
    const window = getTL4EffectiveWindow(pdb, fecha);
    if (window.activo) return window.minutos_calculo / 60;
    return 9; // fallback
  }
  return TURNOS_DEF[turno]?.hours || 8;
}

router.get('/turno-schedule/:linea', produccionAllowRoles('produccion'), (req, res) => {
  const linea = req.params.linea;
  if (!LINEAS_VALIDAS.includes(linea)) return res.status(400).json({ error: 'Línea inválida' });
  const pdb = dbProd.read();
  const week = req.query.week || getWeekStart(nowDateStr());
  if (!isValidDateStr(week)) return res.status(400).json({ error: 'week debe ser una fecha YYYY-MM-DD válida' });
  const weekStart = getWeekStart(week); // normalizar
  const schedule = getTurnoSchedule(pdb, linea, weekStart);
  res.json({ linea, week_start: weekStart, schedule });
});

router.post('/turno-schedule/:linea', produccionAllowRoles('admin'), (req, res) => {
  const linea = req.params.linea;
  if (!LINEAS_VALIDAS.includes(linea)) return res.status(400).json({ error: 'Línea inválida' });
  const { week_start, schedule } = req.body || {};
  if (!week_start || !schedule) return res.status(400).json({ error: 'week_start y schedule requeridos' });
  if (!isValidDateStr(week_start)) return res.status(400).json({ error: 'week_start debe ser una fecha YYYY-MM-DD válida' });
  const weekStart = getWeekStart(week_start);
  // Validar estructura del schedule — normalizar solo campos esperados
  const normalizedSchedule = {};
  for (const dia of DIAS_SEMANA) {
    if (!schedule[dia] || typeof schedule[dia] !== 'object') {
      return res.status(400).json({ error: `Falta config para ${dia}` });
    }
    for (const turno of ['T1', 'T2', 'T3']) {
      if (typeof schedule[dia][turno] !== 'boolean') {
        return res.status(400).json({ error: `${dia}.${turno} debe ser booleano` });
      }
    }
    normalizedSchedule[dia] = {
      T1: schedule[dia].T1,
      T2: schedule[dia].T2,
      T3: schedule[dia].T3
    };
  }
  const pdb = dbProd.read();
  if (!pdb.turno_schedules) pdb.turno_schedules = [];
  const existing = pdb.turno_schedules.findIndex(s => s.linea === linea && s.week_start === weekStart);
  const record = {
    id: existing >= 0 ? pdb.turno_schedules[existing].id : dbProd.nextId(pdb.turno_schedules),
    linea,
    week_start: weekStart,
    schedule: normalizedSchedule,
    created_by: req.prodUser?.nombre || 'admin',
    created_at: nowDateStr() + ' ' + nowTimeStr(),
    updated_by: req.prodUser?.nombre || 'admin',
    updated_at: nowDateStr() + ' ' + nowTimeStr()
  };
  // Guardar historial antes de sobrescribir
  if (existing >= 0) {
    if (!pdb.turno_schedule_history) pdb.turno_schedule_history = [];
    pdb.turno_schedule_history.push({
      ...pdb.turno_schedules[existing],
      replaced_at: nowDateStr() + ' ' + nowTimeStr(),
      replaced_by: req.prodUser?.nombre || 'admin'
    });
    record.created_by = pdb.turno_schedules[existing].created_by;
    record.created_at = pdb.turno_schedules[existing].created_at;
    pdb.turno_schedules[existing] = record;
  } else {
    pdb.turno_schedules.push(record);
  }
  dbProd.write(pdb);
  res.json({ ok: true, record });
});

// ─── Config Turno L4 ──────────────────────────────────────────────────────────

router.get('/turno-l4-config', produccionAllowRoles('produccion'), (req, res) => {
  const pdb = dbProd.read();
  const week = req.query.week || getWeekStart(nowDateStr());
  if (!isValidDateStr(week)) return res.status(400).json({ error: 'week debe ser una fecha YYYY-MM-DD válida' });
  const weekStart = getWeekStart(week);
  const config = getTurnoL4Config(pdb, weekStart);
  res.json({ week_start: weekStart, config });
});

router.post('/turno-l4-config', produccionAllowRoles('admin'), (req, res) => {
  const { week_start, dias } = req.body || {};
  if (!week_start || !dias) return res.status(400).json({ error: 'week_start y dias requeridos' });
  if (!isValidDateStr(week_start)) return res.status(400).json({ error: 'week_start debe ser una fecha YYYY-MM-DD válida' });
  const weekStart = getWeekStart(week_start);
  // Validar y normalizar estructura
  const normalizedDias = {};
  for (const dia of DIAS_SEMANA) {
    if (!dias[dia] || typeof dias[dia] !== 'object') {
      return res.status(400).json({ error: `Falta config para ${dia}` });
    }
    if (typeof dias[dia].activo !== 'boolean') {
      return res.status(400).json({ error: `${dia}.activo debe ser booleano` });
    }
    const activo = dias[dia].activo;
    if (activo) {
      if (!dias[dia].hora_entrada || !dias[dia].hora_salida) {
        return res.status(400).json({ error: `${dia} activo requiere hora_entrada y hora_salida` });
      }
      // Validar formato HH:MM con rango 00:00-23:59
      const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!hhmmRegex.test(dias[dia].hora_entrada) || !hhmmRegex.test(dias[dia].hora_salida)) {
        return res.status(400).json({ error: `${dia}: horas deben ser HH:MM (00:00-23:59)` });
      }
      // Validar que hora_salida > hora_entrada (no cross-midnight)
      if (toMins(dias[dia].hora_salida) <= toMins(dias[dia].hora_entrada)) {
        return res.status(400).json({ error: `${dia}: hora_salida debe ser mayor que hora_entrada` });
      }
      normalizedDias[dia] = {
        activo: true,
        hora_entrada: dias[dia].hora_entrada,
        hora_salida: dias[dia].hora_salida
      };
    } else {
      normalizedDias[dia] = { activo: false };
    }
  }
  const pdb = dbProd.read();
  if (!pdb.turno_l4_config) pdb.turno_l4_config = [];
  const existing = pdb.turno_l4_config.findIndex(c => c.week_start === weekStart);
  const record = {
    id: existing >= 0 ? pdb.turno_l4_config[existing].id : dbProd.nextId(pdb.turno_l4_config),
    week_start: weekStart,
    dias: normalizedDias,
    arranque_ciclos: L4_ARRANQUE_CICLOS,
    created_by: req.prodUser?.nombre || 'admin',
    created_at: nowDateStr() + ' ' + nowTimeStr(),
    updated_by: req.prodUser?.nombre || 'admin',
    updated_at: nowDateStr() + ' ' + nowTimeStr()
  };
  // Guardar historial antes de sobrescribir
  if (existing >= 0) {
    if (!pdb.turno_l4_config_history) pdb.turno_l4_config_history = [];
    pdb.turno_l4_config_history.push({
      ...pdb.turno_l4_config[existing],
      replaced_at: nowDateStr() + ' ' + nowTimeStr(),
      replaced_by: req.prodUser?.nombre || 'admin'
    });
    record.created_by = pdb.turno_l4_config[existing].created_by;
    record.created_at = pdb.turno_l4_config[existing].created_at;
    pdb.turno_l4_config[existing] = record;
  } else {
    pdb.turno_l4_config.push(record);
  }
  dbProd.write(pdb);
  res.json({ ok: true, record });
});

// ─── History endpoints (admin) ────────────────────────────────────────────────

router.get('/turno-schedule-history/:linea', produccionAllowRoles('admin'), (req, res) => {
  const linea = req.params.linea;
  if (!LINEAS_VALIDAS.includes(linea)) return res.status(400).json({ error: 'Línea inválida' });
  const pdb = dbProd.read();
  const history = (pdb.turno_schedule_history || [])
    .filter(h => h.linea === linea)
    .sort((a, b) => (b.replaced_at || '').localeCompare(a.replaced_at || ''));
  res.json({ linea, history });
});

router.get('/turno-l4-config-history', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  const history = (pdb.turno_l4_config_history || [])
    .sort((a, b) => (b.replaced_at || '').localeCompare(a.replaced_at || ''));
  res.json({ history });
});

module.exports = router;
