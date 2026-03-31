const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const db = require('../db');
const dbProd = require('../db-produccion');
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

function nowDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr() {
  return new Date().toTimeString().slice(0, 5);
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
  const { nombre_o_email, password, linea } = req.body || {};
  if (!nombre_o_email || !password) {
    return res.status(400).json({ error: 'nombre_o_email y password son requeridos' });
  }

  const pdb = dbProd.read();

  // Check operadores in L3 and L4
  const lineas = ['l3', 'l4'];
  for (const l of lineas) {
    if (linea && linea.toLowerCase() !== l) continue;
    const operadores = pdb[`operadores_${l}`] || [];
    const op = operadores.find(o =>
      o.activo !== false &&
      o.nombre.toLowerCase() === nombre_o_email.toLowerCase()
    );
    if (op && bcrypt.compareSync(password, op.pin_hash)) {
      const token = jwt.sign(
        {
          module: 'produccion',
          sub: op.id,
          nombre: op.nombre,
          role: 'operador',
          linea: l === 'l3' ? 'L3' : 'L4',
          user_type: 'operador'
        },
        process.env.JWT_SECRET || 'cambia-esta-clave',
        { expiresIn: '12h' }
      );
      return res.json({
        token,
        user: { id: op.id, nombre: op.nombre, role: 'operador', linea: l === 'l3' ? 'L3' : 'L4', user_type: 'operador' }
      });
    }
  }

  // Check compras users with produccion_role = 'admin'
  const mainDb = db.read();
  const user = (mainDb.users || []).find(u =>
    u.active &&
    u.produccion_role === 'admin' &&
    (
      (u.email && u.email.toLowerCase() === nombre_o_email.toLowerCase()) ||
      (u.full_name && u.full_name.toLowerCase() === nombre_o_email.toLowerCase())
    )
  );
  if (user) {
    const validPass = bcrypt.compareSync(password, user.password_hash || user.password || '');
    if (validPass) {
      const token = jwt.sign(
        {
          module: 'produccion',
          sub: user.id,
          nombre: user.full_name,
          role: 'admin',
          linea: 'ambas',
          user_type: 'admin'
        },
        process.env.JWT_SECRET || 'cambia-esta-clave',
        { expiresIn: '12h' }
      );
      return res.json({
        token,
        user: { id: user.id, nombre: user.full_name, role: 'admin', linea: 'ambas', user_type: 'admin' }
      });
    }
  }

  return res.status(401).json({ error: 'Credenciales inválidas' });
});

// ─── Apply auth to all subsequent routes ─────────────────────────────────────

router.use(produccionAuthRequired);

// ─── Catálogos ────────────────────────────────────────────────────────────────

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

// ─── Operadores ───────────────────────────────────────────────────────────────

router.get('/operadores/:linea', produccionAllowRoles('admin'), (req, res) => {
  const { linea } = req.params;
  const key = `operadores_${lineaKey(linea)}`;
  const pdb = dbProd.read();
  const list = (pdb[key] || []).map(o => {
    const { pin_hash, ...rest } = o;
    return rest;
  });
  res.json(list);
});

router.post('/operadores/:linea', produccionAllowRoles('admin'), (req, res) => {
  const { linea } = req.params;
  const key = `operadores_${lineaKey(linea)}`;
  const { nombre, pin } = req.body || {};
  if (!nombre || !pin) return res.status(400).json({ error: 'nombre y pin son requeridos' });

  const pdb = dbProd.read();
  if (!pdb[key]) pdb[key] = [];

  const pin_hash = bcrypt.hashSync(String(pin), 10);
  const id = dbProd.nextId(pdb[key]);
  const item = { id, nombre, pin_hash, activo: true, created_at: new Date().toISOString() };
  pdb[key].push(item);
  dbProd.write(pdb);

  const { pin_hash: _, ...safe } = item;
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
  if (body.pin) list[idx].pin_hash = bcrypt.hashSync(String(body.pin), 10);

  dbProd.write(pdb);
  const { pin_hash, ...safe } = list[idx];
  res.json(safe);
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

router.post('/cargas/:linea', (req, res) => {
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

router.post('/cargas/:linea/:id/descargar', (req, res) => {
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

router.post('/cargas/:linea/:id/reprocesar', (req, res) => {
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

router.get('/paros/:linea', (req, res) => {
  const { linea } = req.params;
  const { fecha, turno } = req.query;
  const pdb = dbProd.read();
  let paros = (pdb.paros || []).filter(p => p.linea === linea);
  if (fecha) paros = paros.filter(p => p.fecha_inicio === fecha);
  if (turno) paros = paros.filter(p => p.turno === turno);
  res.json(paros);
});

router.post('/paros/:linea', (req, res) => {
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
    created_at: new Date().toISOString()
  };

  if (!pdb.paros) pdb.paros = [];
  pdb.paros.push(paro);
  dbProd.write(pdb);
  res.status(201).json(paro);
});

router.patch('/paros/:linea/:id/cerrar', (req, res) => {
  const { linea, id } = req.params;
  const pdb = dbProd.read();
  const idx = (pdb.paros || []).findIndex(p => String(p.id) === String(id) && p.linea === linea);
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const paro = pdb.paros[idx];
  if (paro.fecha_fin) return res.status(409).json({ error: 'El paro ya fue cerrado' });

  const fecha_fin = nowDateStr();
  const hora_fin = nowTimeStr();
  paro.fecha_fin = fecha_fin;
  paro.hora_fin = hora_fin;

  // Calculate duration in minutes
  const inicio = new Date(`${paro.fecha_inicio}T${paro.hora_inicio}:00`);
  const fin = new Date(`${fecha_fin}T${hora_fin}:00`);
  paro.duracion_min = Math.round((fin - inicio) / 60000);

  dbProd.write(pdb);
  res.json(pdb.paros[idx]);
});

// ─── Pizarrón KPIs ────────────────────────────────────────────────────────────

router.get('/pizarron', (req, res) => {
  const { linea = 'L3', fecha, turno = 'all' } = req.query;
  const targetDate = fecha || nowDateStr();

  const pdb = dbProd.read();
  const config = pdb.config || { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2 };

  // Determine which lineas to include
  let lineas = [];
  if (linea === 'ambas') {
    lineas = ['L3', 'L4'];
  } else {
    lineas = [linea];
  }

  // Turno definitions in minutes from midnight
  const TURNOS = {
    T1: { start: 6 * 60 + 30, end: 14 * 60 + 30, hours: 8 },   // 06:30 – 14:30
    T2: { start: 14 * 60 + 30, end: 21 * 60 + 30, hours: 7 },   // 14:30 – 21:30
    T3: { start: 21 * 60 + 30, end: 6 * 60 + 30, hours: 9 }     // 21:30 – 06:30+1
  };

  function toMins(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function slotOverlap(slotStartMins, slotEndMins, paroStart, paroEnd, paroFechaInicio, paroFechaFin, slotDate) {
    // Convert paro times to absolute minutes relative to slotDate midnight
    function absMinutes(dateStr, timeStr) {
      const diffDays = (new Date(dateStr) - new Date(slotDate)) / 86400000;
      return diffDays * 24 * 60 + toMins(timeStr);
    }
    const ps = absMinutes(paroFechaInicio, paroStart);
    const pe = paroFechaFin ? absMinutes(paroFechaFin, paroEnd) : slotEndMins;
    const overlap = Math.max(0, Math.min(slotEndMins, pe) - Math.max(slotStartMins, ps));
    return overlap;
  }

  // Build hourly slots for a given linea and turno on targetDate
  function buildSlotsForLineaTurno(l, t) {
    const ciclos_obj = l === 'L3' ? config.ciclos_objetivo_l3 : config.ciclos_objetivo_l4;
    const tDef = TURNOS[t];

    // Build list of 1-hour slots
    const slots = [];
    let curMins = tDef.start;
    const totalHours = tDef.hours;

    for (let h = 0; h < totalHours; h++) {
      const slotStartMins = curMins;
      const slotEndMins = curMins + 60;
      const slotStartStr = `${String(Math.floor(slotStartMins / 60) % 24).padStart(2, '0')}:${String(slotStartMins % 60).padStart(2, '0')}`;
      const slotEndStr = `${String(Math.floor(slotEndMins / 60) % 24).padStart(2, '0')}:${String(slotEndMins % 60).padStart(2, '0')}`;

      // Determine the actual calendar date for this slot
      // T3 early hours (after midnight) belong to the next calendar day
      const slotActualDate = (t === 'T3' && slotStartMins >= 24 * 60)
        ? (() => { const d = new Date(targetDate + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })()
        : targetDate;

      const slotStartReal = slotStartMins % (24 * 60);
      const slotEndReal = slotEndMins % (24 * 60);

      // Cargas discharged during this slot
      const cargasEnSlot = (pdb.cargas || []).filter(c => {
        if (c.linea !== l) return false;
        if (!c.fecha_descarga || !c.hora_descarga) return false;
        const descDate = c.fecha_descarga;
        const descMins = toMins(c.hora_descarga);
        // Check if discharge falls in this slot
        if (descDate !== slotActualDate) return false;
        return descMins >= slotStartReal && descMins < slotEndReal;
      });

      const ciclos_totales = cargasEnSlot.length;
      const ciclos_buenos = cargasEnSlot.filter(c => c.estado === 'procesado').length;
      const cargasPiezas = cargasEnSlot.filter(c => !c.es_vacia);
      const cantidad_total = cargasPiezas.reduce((sum, c) => sum + (c.cantidad || 0), 0);
      const piezas_obj_avg = cargasPiezas.length > 0
        ? cargasPiezas.reduce((sum, c) => sum + (c.piezas_por_varilla || 0) * (c.varillas || 0), 0) / cargasPiezas.length
        : 0;
      const ciclos_en_hora = ciclos_totales; // including empty for cycle count

      // Paros overlap in this slot (minutes)
      const parosLinea = (pdb.paros || []).filter(p => p.linea === l);
      let paros_min = 0;
      for (const paro of parosLinea) {
        const overlap = slotOverlap(
          slotStartReal,
          slotEndReal,
          paro.hora_inicio,
          paro.hora_fin || nowTimeStr(),
          paro.fecha_inicio,
          paro.fecha_fin,
          slotActualDate
        );
        paros_min += overlap;
      }

      const slot_min = 60;
      const disponibilidad = (slot_min - Math.min(paros_min, slot_min)) / slot_min;
      const eficiencia = ciclos_obj > 0 ? ciclos_en_hora / ciclos_obj : 0;
      const capacidad = (ciclos_en_hora > 0 && piezas_obj_avg > 0)
        ? cantidad_total / (ciclos_en_hora * piezas_obj_avg)
        : 0;
      const calidad = ciclos_buenos > 0 || cargasPiezas.length > 0
        ? (cargasPiezas.length > 0 ? cargasPiezas.filter(c => c.estado === 'procesado').length / cargasPiezas.length : 0)
        : 0;

      slots.push({
        slot: h + 1,
        hora_inicio: slotStartStr,
        hora_fin: slotEndStr,
        ciclos_totales,
        ciclos_buenos,
        cantidad_total,
        paros_min,
        eficiencia: Math.round(eficiencia * 1000) / 1000,
        capacidad: Math.round(capacidad * 1000) / 1000,
        calidad: Math.round(calidad * 1000) / 1000,
        disponibilidad: Math.round(disponibilidad * 1000) / 1000
      });

      curMins += 60;
    }

    return slots;
  }

  const result = {};
  const targetTurnos = turno === 'all' ? ['T1', 'T2', 'T3'] : [turno];

  for (const l of lineas) {
    result[l] = {};
    let dayTotals = { ciclos_totales: 0, ciclos_buenos: 0, cantidad_total: 0 };
    for (const t of targetTurnos) {
      const slots = buildSlotsForLineaTurno(l, t);
      const totals = {
        ciclos_totales: slots.reduce((s, x) => s + x.ciclos_totales, 0),
        ciclos_buenos: slots.reduce((s, x) => s + x.ciclos_buenos, 0),
        cantidad_total: slots.reduce((s, x) => s + x.cantidad_total, 0),
        eficiencia_avg: slots.length > 0 ? slots.reduce((s, x) => s + x.eficiencia, 0) / slots.length : 0,
        disponibilidad_avg: slots.length > 0 ? slots.reduce((s, x) => s + x.disponibilidad, 0) / slots.length : 0
      };
      result[l][t] = { slots, totals };
      dayTotals.ciclos_totales += totals.ciclos_totales;
      dayTotals.ciclos_buenos += totals.ciclos_buenos;
      dayTotals.cantidad_total += totals.cantidad_total;
    }
    result[l].totales_dia = dayTotals;
  }

  res.json({ fecha: targetDate, linea, turno, data: result });
});

// ─── Config ───────────────────────────────────────────────────────────────────

router.get('/config', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  res.json(pdb.config || { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2 });
});

router.patch('/config', produccionAllowRoles('admin'), (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.config) pdb.config = { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2 };
  const { ciclos_objetivo_l3, ciclos_objetivo_l4 } = req.body || {};
  if (ciclos_objetivo_l3 !== undefined) pdb.config.ciclos_objetivo_l3 = Number(ciclos_objetivo_l3);
  if (ciclos_objetivo_l4 !== undefined) pdb.config.ciclos_objetivo_l4 = Number(ciclos_objetivo_l4);
  dbProd.write(pdb);
  res.json(pdb.config);
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
