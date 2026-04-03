const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const db = require('../db');
const dbProd = require('../db-produccion');
const dbRhh = require('../db-rhh');
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
  if (isEarlyT3) {
    const d = new Date(fecha + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return fecha;
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

function catalogCollection(linea, tipo) {
  // tipo: componentes | procesos | acabados | herramentales | defectos | motivos-paro | sub-motivos-paro
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
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Correo y contraseña son requeridos' });

  const mainDb = db.read();
  const user = (mainDb.users || []).find(u =>
    u.active !== false &&
    u.produccion_role &&
    u.email && u.email.toLowerCase() === email.toLowerCase()
  );

  if (!user || !bcrypt.compareSync(String(password), user.password_hash || ''))
    return res.status(401).json({ error: 'Credenciales inválidas o sin acceso a Producción' });

  // Buscar empleado RH por email para vinculación en operadores
  const rhhDb = dbRhh.read();
  const rhhEmp = (rhhDb.rhh_employees || []).find(e =>
    e.status !== 'deleted' && e.email && e.email.toLowerCase() === email.toLowerCase()
  );
  const rhh_employee_id = rhhEmp ? rhhEmp.id : null;

  const token = jwt.sign(
    { module: 'produccion', sub: user.id, nombre: user.full_name, email: user.email, role: user.produccion_role, rhh_employee_id },
    process.env.JWT_SECRET || 'cambia-esta-clave',
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
    .map(u => ({ email: u.email, nombre: u.full_name }))
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
  const l = lineaKey(req.params.linea);
  const pdb = dbProd.read();
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
    operadores
  });
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
  } else if (tipo === 'herramentales') {
    if (!body.numero) return res.status(400).json({ error: 'numero es requerido' });
    item = { ...item, numero: body.numero, descripcion: body.descripcion || '' };
  } else if (tipo === 'sub-motivos-paro') {
    if (!body.nombre || !body.motivo_id) return res.status(400).json({ error: 'nombre y motivo_id son requeridos' });
    item = { ...item, motivo_id: body.motivo_id, nombre: body.nombre };
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
  const allowed = ['nombre', 'activo', 'cliente', 'carga_optima_varillas', 'piezas_objetivo', 'descripcion', 'numero', 'motivo_id'];
  for (const field of allowed) {
    if (body[field] !== undefined) list[idx][field] = body[field];
  }

  dbProd.write(pdb);
  res.json(list[idx]);
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
  let cargas = (pdb.cargas || []).filter(c => c.linea === linea);

  if (fecha_ini) cargas = cargas.filter(c => c.fecha_carga >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => c.fecha_carga <= fecha_fin);
  if (turno) cargas = cargas.filter(c => c.turno === turno);
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
  const fecha_carga = nowDateStr();
  const hora_carga = nowTimeStr();
  const turno = getTurno(hora_carga);
  const semana = getISOWeek(now);
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
  if (original.estado !== 'defecto') {
    return res.status(409).json({ error: 'Solo se puede reprocesar una carga con estado defecto' });
  }

  const now = new Date();
  const fecha_carga = nowDateStr();
  const hora_carga = nowTimeStr();
  const turno = getTurno(hora_carga);
  const semana = getISOWeek(now);

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

// ─── Paros ────────────────────────────────────────────────────────────────────

// Reporte general de paros (admin) — todas las líneas con filtros
router.get('/paros/reporte', produccionAllowRoles('admin'), (req, res) => {
  const { linea, desde, hasta, turno } = req.query;
  const pdb = dbProd.read();
  let paros = pdb.paros || [];
  if (linea && linea !== 'ambas') paros = paros.filter(p => p.linea === linea);
  if (desde) paros = paros.filter(p => p.fecha_inicio >= desde);
  if (hasta) paros = paros.filter(p => p.fecha_inicio <= hasta);
  if (turno) paros = paros.filter(p => p.turno === turno);
  paros = paros.sort((a, b) =>
    (`${b.fecha_inicio}T${b.hora_inicio}`).localeCompare(`${a.fecha_inicio}T${a.hora_inicio}`)
  );
  res.json({ total: paros.length, paros });
});

router.get('/paros/:linea/activo', (req, res) => {
  const { linea } = req.params;
  const pdb = dbProd.read();
  const paro = (pdb.paros || []).find(p => p.linea === linea && p.estado === 'activo') || null;
  res.json({ paro });
});

router.get('/paros/:linea', (req, res) => {
  const { linea } = req.params;
  const { fecha, turno } = req.query;
  const pdb = dbProd.read();
  let paros = (pdb.paros || []).filter(p => p.linea === linea);
  if (fecha) paros = paros.filter(p => p.fecha_inicio === fecha);
  if (turno) paros = paros.filter(p => p.turno === turno);
  res.json(paros);
});

router.post('/paros/:linea', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const { motivo_id, sub_motivo_id } = req.body || {};
  if (!motivo_id) return res.status(400).json({ error: 'motivo_id es requerido' });

  const pdb = dbProd.read();
  const l = lineaKey(linea);

  const motivos = pdb[`motivos_paro_${l}`] || [];
  const motivo = motivos.find(m => String(m.id) === String(motivo_id));
  if (!motivo) return res.status(400).json({ error: 'Motivo de paro no encontrado' });

  let sub_motivo = null;
  if (sub_motivo_id) {
    const sub_motivos = pdb[`sub_motivos_paro_${l}`] || [];
    sub_motivo = sub_motivos.find(s => String(s.id) === String(sub_motivo_id) && String(s.motivo_id) === String(motivo_id));
  }

  const fecha_inicio = nowDateStr();
  const hora_inicio = nowTimeStr();
  const turno = getTurno(hora_inicio);

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
    turno,
    registrado_por: req.prodUser?.nombre || 'Operador',
    created_at: new Date().toISOString()
  };

  if (!pdb.paros) pdb.paros = [];
  pdb.paros.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

// ─── Paro automático por cambio de turno ─────────────────────────────────────

router.post('/paros/:linea/cambio-turno', produccionAllowRoles('produccion'), (req, res) => {
  const { linea } = req.params;
  const pdb = dbProd.read();
  const l = lineaKey(linea);

  // Si ya hay un paro activo, no crear otro
  const yaActivo = (pdb.paros || []).find(p => p.linea === linea && p.estado === 'activo' && !p.fecha_fin);
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
  const turno        = getTurno(hora_inicio);
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

router.patch('/paros/:linea/:id/cerrar', produccionAllowRoles('produccion'), (req, res) => {
  const { linea, id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id) && p.linea === linea);
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const paro = pdb.paros[idx];
  if (paro.fecha_fin) return res.status(409).json({ error: 'El paro ya fue cerrado' });

  const fecha_fin = nowDateStr();
  const hora_fin  = nowTimeStr();
  paro.fecha_fin  = fecha_fin;
  paro.hora_fin   = hora_fin;
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

  const fecha_fin = nowDateStr();
  const hora_fin  = nowTimeStr();
  paro.fecha_fin  = fecha_fin;
  paro.hora_fin   = hora_fin;
  paro.duracion_min = Math.round(
    (new Date(`${fecha_fin}T${hora_fin}:00`) - new Date(`${paro.fecha_inicio}T${paro.hora_inicio}:00`)) / 60000
  );
  paro.cerrado_por_admin = req.prodUser?.nombre || 'Admin';

  dbProd.write(pdb);
  res.json(pdb.paros[idx]);
});

// Admin: editar paro (marca como corregido)
router.patch('/paros/:id/admin-editar', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const paro  = pdb.paros[idx];
  const body  = req.body || {};
  const campos = ['motivo', 'sub_motivo', 'fecha_inicio', 'hora_inicio', 'fecha_fin', 'hora_fin', 'turno'];
  for (const f of campos) {
    if (body[f] !== undefined) paro[f] = body[f] || null;
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
  res.json(pdb.paros[idx]);
});

// Admin: eliminar paro
router.delete('/paros/:id', produccionAllowRoles('admin'), (req, res) => {
  const { id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const [eliminado] = pdb.paros.splice(idx, 1);
  dbProd.write(pdb);
  res.json({ ok: true, eliminado });
});

// ─── Pizarrón helpers (módulo-nivel, reutilizables) ──────────────────────────

const TURNOS_DEF = {
  T1: { start: 6 * 60 + 30,  hours: 8 },  // 06:30–14:30
  T2: { start: 14 * 60 + 30, hours: 7 },  // 14:30–21:30
  T3: { start: 21 * 60 + 30, hours: 9 }   // 21:30–06:30+1
};

function toMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
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
  return Math.max(0, Math.min(se, pe) - Math.max(ss, ps));
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA', { timeZone: MX_TZ });
}

function buildSlotsForLinTur(pdb, config, l, t, targetDate) {
  const ciclos_obj = l === 'L3'
    ? (config.ciclos_objetivo_l3 ?? 2)
    : (config.ciclos_objetivo_l4 ?? 2);
  const tDef    = TURNOS_DEF[t];
  const nextDay = addDays(targetDate, 1);
  const slots   = [];
  let curMins   = tDef.start;

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

    // Solo ciclos COMPLETADOS (descargados) — se asignan por hora_descarga
    const cargasEnSlot = (pdb.cargas || []).filter(c => {
      if (c.linea !== l || !c.fecha_descarga || !c.hora_descarga) return false;
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

    // Ciclos buenos: no vacíos y sin defecto
    const ciclos_buenos   = cargasNoVacias.filter(c => !c.defecto_id).length;

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

    // Disponibilidad: tiempo disponible descontando paros
    let paros_min = 0;
    for (const p of (pdb.paros || []).filter(p => p.linea === l)) {
      paros_min += slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                               p.fecha_inicio, p.fecha_fin, slotDate);
    }

    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;

    // Eficiencia = ciclos_descargados / ciclos_objetivo_por_hora (sin descuento de paros)
    const eficiencia    = ciclos_obj > 0 ? r3(ciclos_totales / ciclos_obj) : 0;
    // Calidad = buenos / no_vacios (null si no hay ciclos con material)
    const calidad       = ciclos_no_vacios > 0 ? r3(ciclos_buenos / ciclos_no_vacios) : null;
    // Capacidad = piezas reales / piezas objetivo (null si sin objetivo en catálogo)
    const capacidad     = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
    // Disponibilidad = (60 - paros) / 60
    const disponibilidad = r3(Math.max(0, 60 - Math.min(paros_min, 60)) / 60);

    slots.push({
      slot: h + 1,
      hora_inicio:      ssStr,
      hora_fin:         seStr,
      ciclos_totales,
      ciclos_no_vacios,
      ciclos_buenos,
      piezas_total,
      piezas_obj_total,
      paros_min:        Math.round(paros_min * 10) / 10,
      eficiencia,
      calidad,
      capacidad,
      disponibilidad
    });
    curMins += 60;
  }
  return slots;
}

function buildPizarronResult(pdb, config, lineas, turnos, targetDate) {
  const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
  const result = {};

  for (const l of lineas) {
    result[l] = {};
    const ciclos_obj = l === 'L3'
      ? (config.ciclos_objetivo_l3 ?? 2)
      : (config.ciclos_objetivo_l4 ?? 2);

    let dayC = 0, dayNV = 0, dayB = 0, dayPz = 0, dayPzObj = 0, dayParos = 0, daySlots = 0;

    for (const t of turnos) {
      const tDef  = TURNOS_DEF[t];
      const slots = buildSlotsForLinTur(pdb, config, l, t, targetDate);

      const tC     = slots.reduce((s, x) => s + x.ciclos_totales,   0);
      const tNV    = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const tB     = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
      const tPz    = slots.reduce((s, x) => s + x.piezas_total,     0);
      const tPzObj = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const tParos = slots.reduce((s, x) => s + x.paros_min,        0);
      const turnoMins = tDef.hours * 60;

      result[l][t] = {
        slots,
        totals: {
          ciclos_totales:   tC,
          ciclos_no_vacios: tNV,
          ciclos_buenos:    tB,
          piezas_total:     tPz,
          piezas_obj_total: tPzObj,
          paros_min:        Math.round(tParos * 10) / 10,
          // Eficiencia turno = ciclos / (ciclos_obj × horas_turno)
          eficiencia:    r3((ciclos_obj * tDef.hours) > 0 ? tC / (ciclos_obj * tDef.hours) : 0),
          // Calidad turno = buenos / no_vacios
          calidad:       tNV > 0 ? r3(tB / tNV) : null,
          // Capacidad turno = piezas_total / piezas_obj_total
          capacidad:     tPzObj > 0 ? r3(tPz / tPzObj) : null,
          // Disponibilidad turno = (turno_min - paros) / turno_min
          disponibilidad: r3((turnoMins - Math.min(tParos, turnoMins)) / turnoMins)
        }
      };

      dayC     += tC;
      dayNV    += tNV;
      dayB     += tB;
      dayPz    += tPz;
      dayPzObj += tPzObj;
      dayParos += tParos;
      daySlots += tDef.hours;
    }

    const totalMins = daySlots * 60;
    result[l].totales_dia = {
      ciclos_totales:   dayC,
      ciclos_no_vacios: dayNV,
      ciclos_buenos:    dayB,
      piezas_total:     dayPz,
      piezas_obj_total: dayPzObj,
      paros_min:        Math.round(dayParos * 10) / 10,
      eficiencia:    r3(daySlots > 0 ? dayC / (ciclos_obj * daySlots) : 0),
      calidad:       dayNV > 0 ? r3(dayB / dayNV) : null,
      capacidad:     dayPzObj > 0 ? r3(dayPz / dayPzObj) : null,
      disponibilidad: totalMins > 0
        ? r3((totalMins - Math.min(dayParos, totalMins)) / totalMins) : 1
    };
  }
  return result;
}

// ─── Pizarrón KPIs ────────────────────────────────────────────────────────────

router.get('/pizarron', (req, res) => {
  const { linea = 'L3', fecha, turno = 'all' } = req.query;
  const targetDate = fecha || nowDateStr();
  const pdb        = dbProd.read();
  const config     = pdb.config || {};
  const lineas     = linea === 'ambas' ? ['L3', 'L4'] : [linea];

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
  res.json({ fecha: targetDate, linea, turno, data });
});

// ─── Reportes ─────────────────────────────────────────────────────────────────

router.get('/reportes', (req, res) => {
  const { linea, desde, hasta } = req.query;
  const pdb = dbProd.read();
  let cargas = pdb.cargas || [];

  if (linea && linea !== 'ambas') cargas = cargas.filter(c => c.linea === linea);
  if (desde) cargas = cargas.filter(c => c.fecha_carga >= desde);
  if (hasta) cargas = cargas.filter(c => c.fecha_carga <= hasta);

  cargas = cargas.sort((a, b) => {
    const ta = `${a.fecha_carga}T${a.hora_carga || '00:00'}`;
    const tb = `${b.fecha_carga}T${b.hora_carga || '00:00'}`;
    return ta > tb ? -1 : ta < tb ? 1 : 0;
  });

  res.json({ total: cargas.length, cargas });
});

// ─── Config ───────────────────────────────────────────────────────────────────

router.get('/config', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  res.json(pdb.config || { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2 });
});

router.patch('/config', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.config) pdb.config = {};
  const campos = [
    'ciclos_objetivo_l3', 'ciclos_objetivo_l4',
    'eficiencia_obj_l3',  'eficiencia_obj_l4',
    'capacidad_obj_l3',   'capacidad_obj_l4',
    'calidad_obj_l3',     'calidad_obj_l4',
    'disponibilidad_obj_l3', 'disponibilidad_obj_l4'
  ];
  const body = req.body || {};
  for (const f of campos) {
    if (body[f] !== undefined) pdb.config[f] = Number(body[f]);
  }
  dbProd.write(pdb);
  res.json(pdb.config);
});

// ─── KPI Snapshots ────────────────────────────────────────────────────────────

router.post('/kpis/guardar', produccionAllowRoles('admin'), (req, res) => {
  const { fecha, linea = 'ambas', turno = 'all' } = req.body || {};
  const targetDate   = fecha || nowDateStr();
  const pdb          = dbProd.read();
  const config       = pdb.config || {};
  if (!pdb.kpi_snapshots) pdb.kpi_snapshots = [];

  const lineas   = linea === 'ambas' ? ['L3', 'L4'] : [linea];
  const turnos   = turno === 'all'   ? ['T1', 'T2', 'T3'] : [turno];
  const guardados = [];

  for (const l of lineas) {
    for (const t of turnos) {
      const slots          = buildSlotsForLinTur(pdb, config, l, t, targetDate);
      const ciclos_totales = slots.reduce((s, x) => s + x.ciclos_totales, 0);
      const ciclos_buenos  = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
      const paros_min_total= slots.reduce((s, x) => s + x.paros_min, 0);
      const avg = k => slots.length ? slots.reduce((s, x) => s + x[k], 0) / slots.length : 0;
      const semana = getISOWeek(new Date(targetDate + 'T12:00:00'));

      const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === l && k.turno === t);
      const snap = {
        id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
        fecha:          targetDate,
        semana,
        turno:          t,
        linea:          l,
        guardado_at:    new Date().toISOString(),
        ciclos_totales,
        ciclos_buenos,
        paros_min_total,
        eficiencia:     Math.round(avg('eficiencia')     * 1000) / 1000,
        capacidad:      Math.round(avg('capacidad')      * 1000) / 1000,
        calidad:        Math.round(avg('calidad')        * 1000) / 1000,
        disponibilidad: Math.round(avg('disponibilidad') * 1000) / 1000,
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
  const { linea, turno, desde, hasta, semana } = req.query;
  const pdb = dbProd.read();
  let snaps = pdb.kpi_snapshots || [];
  if (linea && linea !== 'ambas') snaps = snaps.filter(k => k.linea === linea);
  if (turno)  snaps = snaps.filter(k => k.turno  === turno);
  if (desde)  snaps = snaps.filter(k => k.fecha  >= desde);
  if (hasta)  snaps = snaps.filter(k => k.fecha  <= hasta);
  if (semana) snaps = snaps.filter(k => k.semana === Number(semana));
  snaps = snaps.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.turno.localeCompare(a.turno));
  res.json({ total: snaps.length, snapshots: snaps });
});

// ─── Export ───────────────────────────────────────────────────────────────────

router.get('/export/:linea', produccionAllowRoles('admin'), (req, res) => {
  const { linea } = req.params;
  const { fecha_ini, fecha_fin } = req.query;
  const pdb = dbProd.read();

  let cargas = (pdb.cargas || []).filter(c => c.linea === linea);
  if (fecha_ini) cargas = cargas.filter(c => c.fecha_carga >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => c.fecha_carga <= fecha_fin);

  const rows = cargas.map(c => ({
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

module.exports = router;
