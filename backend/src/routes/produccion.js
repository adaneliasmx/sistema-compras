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
  const { linea } = req.params;
  const pdb = dbProd.read();

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
      operadores
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
  const allowed = ['nombre', 'activo', 'cliente', 'carga_optima_varillas', 'piezas_objetivo', 'piezas_por_varilla', 'descripcion', 'numero', 'motivo_id', 'proceso_id', 'no_skf', 'tipo', 'cavidades', 'varillas_totales', 'excluir_calidad'];
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

  // Usar fecha_turno si existe (fecha del turno), sino fecha_carga (retrocompat)
  const ft = c => c.fecha_turno || c.fecha_carga;
  if (fecha_ini) cargas = cargas.filter(c => ft(c) >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => ft(c) <= fecha_fin);
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
  const hora_carga  = nowTimeStr();
  const fecha_carga = nowDateStr();                          // fecha real del calendario
  const fecha_turno = getShiftDate(fecha_carga, hora_carga); // fecha del turno (T3 nocturno → día anterior)
  const turno = getTurno(hora_carga);
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
  const fecha_turno = getShiftDate(fecha_carga, hora_carga);
  const turno = getTurno(hora_carga);
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

  const collections = [
    { key: 'cargas',       arr: pdb.cargas       || [] },
    { key: 'cargas_baker', arr: pdb.cargas_baker  || [] },
    { key: 'cargas_l1',   arr: pdb.cargas_l1     || [] },
  ];

  let found = null;
  for (const col of collections) {
    const idx = col.arr.findIndex(c => String(c.id) === String(id));
    if (idx !== -1) { found = { ...col, idx }; break; }
  }
  if (!found) return res.status(404).json({ error: 'Carga no encontrada' });

  const carga  = found.arr[found.idx];
  const campos = [
    'turno', 'fecha_carga', 'hora_carga', 'fecha_descarga', 'hora_descarga',
    'herramental_no', 'componente', 'proceso', 'sub_proceso', 'operador',
    'cantidad', 'varillas', 'piezas_por_varilla',
    'estado', 'resultado', 'defecto', 'defecto_id'
  ];
  for (const f of campos) {
    if (body[f] !== undefined) carga[f] = body[f] !== '' ? body[f] : null;
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
  const campos = ['estado', 'resultado', 'defecto', 'defecto_id', 'cantidad', 'operador', 'proceso', 'sub_proceso'];
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
    paros = [...(pdb.paros || []), ...bakerParos];
  } else if (linea === 'Baker') {
    paros = (pdb.paros_baker || []).map(p => ({ ...p, linea: 'Baker' }));
  } else {
    paros = (pdb.paros || []).filter(p => p.linea === linea);
  }

  if (desde) paros = paros.filter(p => p.fecha_inicio >= desde);
  if (hasta) paros = paros.filter(p => p.fecha_inicio <= hasta);
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
  if (desde) paros = paros.filter(p => p.fecha_inicio >= desde);
  if (hasta) paros = paros.filter(p => p.fecha_inicio <= hasta);
  if (turno) paros = paros.filter(p => p.turno === turno);
  paros = paros.filter(p => Number(p.duracion_min || 0) > 0);
  res.json({ total: paros.length, paros });
});

// GET /resumen/defectos?desde=&hasta=&linea=&turno= — ciclos/cavidades con defecto (todos los roles)
router.get('/resumen/defectos', (req, res) => {
  const { desde, hasta, linea, turno } = req.query;
  const pdb = dbProd.read();
  const lineasReq = linea ? linea.split(',').map(s => s.trim()) : ['L3', 'L4', 'Baker', 'L1'];
  const result = [];
  // Usar fecha de DESCARGA (mismo criterio que el KPI) para coherencia con los snapshots de turno
  const ftD   = c => c.fecha_descarga || c.fecha_turno || c.fecha_carga;
  const turnoD = c => getTurno(c.hora_descarga || c.hora_carga || '06:30');
  for (const l of lineasReq) {
    if (l === 'Baker' || l === 'L1') {
      const src = l === 'Baker' ? 'cargas_baker' : 'cargas_l1';
      let cargas = (pdb[src] || []).filter(c => !!c.fecha_descarga);
      if (desde) cargas = cargas.filter(c => ftD(c) >= desde);
      if (hasta) cargas = cargas.filter(c => ftD(c) <= hasta);
      if (turno) cargas = cargas.filter(c => turnoD(c) === turno);
      for (const carga of cargas) {
        if (carga.herramental_tipo === 'barril') {
          const cavsMalas = (carga.cavidades || []).filter(cv => cv.estado === 'defecto');
          for (const cav of cavsMalas) {
            result.push({ linea: l, fecha: ftD(carga), turno: turnoD(carga),
              herramental: carga.herramental_no || String(carga.herramental_id || ''),
              operador: carga.operador || '', defecto: cav.defecto || 'Sin motivo',
              detalle: `Cavidad ${cav.num}`, folio: carga.folio });
          }
        } else if (carga.estado === 'defecto' || carga.defecto_id) {
          result.push({ linea: l, fecha: ftD(carga), turno: turnoD(carga),
            herramental: carga.herramental_no || String(carga.herramental_id || ''),
            operador: carga.operador || '', defecto: carga.defecto || 'Sin motivo',
            detalle: `Ciclo ${carga.folio}`, folio: carga.folio });
        }
      }
    } else {
      let cargas = (pdb.cargas || []).filter(c => c.linea === l && !!c.fecha_descarga);
      if (desde) cargas = cargas.filter(c => ftD(c) >= desde);
      if (hasta) cargas = cargas.filter(c => ftD(c) <= hasta);
      if (turno) cargas = cargas.filter(c => turnoD(c) === turno);
      for (const c of cargas.filter(x => x.estado === 'defecto' || x.defecto_id)) {
        result.push({ linea: l, fecha: ftD(c), turno: turnoD(c),
          herramental: c.herramental_no || '', operador: c.operador || '',
          defecto: c.defecto || 'Sin motivo', detalle: `Ciclo ${c.folio}`, folio: c.folio });
      }
    }
  }
  result.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.turno.localeCompare(b.turno));
  res.json({ total: result.length, defectos: result });
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

  const fecha_inicio = req.body.fecha_inicio || nowDateStr();
  const hora_inicio  = req.body.hora_inicio  || nowTimeStr();
  const turno        = getTurno(hora_inicio);

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

  // Horarios fijos por turno
  const SHIFT_TIMES = {
    T1: { h_ini: '06:30', h_fin: '14:30', dur: 480 },
    T2: { h_ini: '14:30', h_fin: '21:30', dur: 420 },
    T3: { h_ini: '21:30', h_fin: '06:30', dur: 540 }
  };
  const st = SHIFT_TIMES[turno];
  if (!st) return res.status(400).json({ error: 'Turno inválido' });

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

  const fecha_fin = nowDateStr();
  const hora_fin  = nowTimeStr();
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

  const fecha_fin = nowDateStr();
  const hora_fin  = nowTimeStr();
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
  if (idx === -1) return res.status(404).json({ error: 'Paro no encontrado' });

  const [eliminado] = pdb.paros_baker.splice(idx, 1);
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

    // Disponibilidad: tiempo disponible descontando paros
    let paros_min = 0;
    for (const p of (pdb.paros || []).filter(p => p.linea === l)) {
      paros_min += slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                               p.fecha_inicio, p.fecha_fin, slotDate);
    }

    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    const slotObj = slotCiclosObj(ciclos_obj, h);

    // Eficiencia = ciclos_descargados / ciclos_objetivo_por_hora (sin descuento de paros)
    const eficiencia    = slotObj > 0 ? r3(ciclos_totales / slotObj) : 0;
    // Calidad = buenos / no_vacios — excluye herramentales con defecto contemplado
    const calidad       = cargasCalidad.length > 0 ? r3(ciclos_buenos_calidad / cargasCalidad.length) : null;
    // Capacidad = piezas reales / piezas objetivo (null si sin objetivo en catálogo)
    const capacidad     = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
    // Disponibilidad = (60 - paros) / 60
    const disponibilidad = r3(Math.max(0, 60 - Math.min(paros_min, 60)) / 60);

    slots.push({
      slot: h + 1,
      hora_inicio:      ssStr,
      hora_fin:         seStr,
      ciclos_totales,
      ciclos_obj:       slotObj,
      ciclos_no_vacios,
      ciclos_buenos,
      // Conteos filtrados para calidad (excluye herramentales con defecto contemplado)
      ciclos_no_vacios_calidad: cargasCalidad.length,
      ciclos_buenos_calidad,
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

    let dayC = 0, dayNV = 0, dayB = 0, dayPz = 0, dayPzObj = 0, dayParos = 0, daySlots = 0, dayElapHours = 0;

    for (const t of turnos) {
      const tDef  = TURNOS_DEF[t];
      const slots = buildSlotsForLinTur(pdb, config, l, t, targetDate);

      const tC     = slots.reduce((s, x) => s + x.ciclos_totales,   0);
      const tNV    = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const tB     = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
      const tPz    = slots.reduce((s, x) => s + x.piezas_total,     0);
      const tPzObj = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const tParos = slots.reduce((s, x) => s + x.paros_min,        0);
      const turnoMins  = tDef.hours * 60;
      const tElap      = elapsedHoursForTurno(t, targetDate); // horas reales transcurridas

      result[l][t] = {
        slots,
        totals: {
          ciclos_totales:   tC,
          ciclos_no_vacios: tNV,
          ciclos_buenos:    tB,
          piezas_total:     tPz,
          piezas_obj_total: tPzObj,
          paros_min:        Math.round(tParos * 10) / 10,
          // Eficiencia dinámica: usa horas transcurridas (no horas totales del turno)
          eficiencia:    r3(tElap > 0 ? tC / (ciclos_obj * tElap) : 0),
          calidad:       tNV > 0 ? r3(tB / tNV) : null,
          capacidad:     tPzObj > 0 ? r3(tPz / tPzObj) : null,
          disponibilidad: r3((turnoMins - Math.min(tParos, turnoMins)) / turnoMins)
        }
      };

      dayC          += tC;
      dayNV         += tNV;
      dayB          += tB;
      dayPz         += tPz;
      dayPzObj      += tPzObj;
      dayParos      += tParos;
      daySlots      += tDef.hours;   // horas totales planeadas (para disponibilidad)
      dayElapHours  += tElap;        // horas reales transcurridas (para eficiencia)
    }

    const totalMins = daySlots * 60;
    result[l].totales_dia = {
      ciclos_totales:   dayC,
      ciclos_no_vacios: dayNV,
      ciclos_buenos:    dayB,
      piezas_total:     dayPz,
      piezas_obj_total: dayPzObj,
      paros_min:        Math.round(dayParos * 10) / 10,
      eficiencia:    r3(dayElapHours > 0 ? dayC / (ciclos_obj * dayElapHours) : 0),
      calidad:       dayNV > 0 ? r3(dayB / dayNV) : null,
      capacidad:     dayPzObj > 0 ? r3(dayPz / dayPzObj) : null,
      disponibilidad: totalMins > 0
        ? r3((totalMins - Math.min(dayParos, totalMins)) / totalMins) : 1
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
  paros = paros.filter(p => p.fecha_inicio === fecha && Number(p.duracion_min || 0) > 0);
  if (turno) paros = paros.filter(p => p.turno === turno);
  const agg = {};
  for (const p of paros) {
    const key = p.motivo || 'Sin motivo';
    agg[key] = (agg[key] || 0) + Number(p.duracion_min || 0);
  }
  return Object.entries(agg)
    .map(([motivo, duracion_min]) => ({ motivo, duracion_min: Math.round(duracion_min) }))
    .sort((a, b) => b.duracion_min - a.duracion_min);
}

function buildParetoDefectos(pdb, lineaLabel, fecha, turno) {
  const agg = {};
  const ftD  = c => c.fecha_descarga || c.fecha_carga;
  const tnoD = c => getTurno(c.hora_descarga || c.hora_carga || '06:30');
  if (lineaLabel === 'Baker' || lineaLabel === 'L1') {
    const src = lineaLabel === 'Baker' ? 'cargas_baker' : 'cargas_l1';
    let cargas = (pdb[src] || []).filter(c => !!c.fecha_descarga && ftD(c) === fecha);
    if (turno) cargas = cargas.filter(c => tnoD(c) === turno);
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
    if (turno) cargas = cargas.filter(c => tnoD(c) === turno);
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

  // Helper para agregar línea tipo Baker al pizarrón
  function addBakerLike(lineaLabel, buildFn, ciclosObjKey) {
    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    const turnData = {};
    let dC = 0, dNV = 0, dB = 0, dPz = 0, dPzO = 0, dParos = 0, dSlots = 0, dElapHours = 0;
    for (const t of targetTurnos) {
      const tDef  = TURNOS_DEF[t];
      const slots = buildFn(pdb, config, t, targetDate);
      const tC   = slots.reduce((s, x) => s + x.ciclos_totales,   0);
      const tNV  = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
      const tB   = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
      const tPz  = slots.reduce((s, x) => s + x.piezas_total,     0);
      const tPzO = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
      const tParos = slots.reduce((s, x) => s + x.paros_min,      0);
      const turnoMins  = tDef.hours * 60;
      const tElap      = elapsedHoursForTurno(t, targetDate);
      const ciclos_obj = config[ciclosObjKey] ?? 2;
      turnData[t] = {
        slots,
        totals: {
          ciclos_totales:   tC,
          ciclos_no_vacios: tNV,
          ciclos_buenos:    tB,
          // Eficiencia dinámica: usa horas transcurridas (no horas totales del turno)
          eficiencia:    tElap > 0 ? r3(tC / (ciclos_obj * tElap)) : 0,
          calidad:       tNV > 0 ? r3(tB / tNV) : null,
          capacidad:     tPzO > 0 ? r3(tPz / tPzO) : null,
          disponibilidad: r3(Math.max(0, turnoMins - Math.min(tParos, turnoMins)) / turnoMins)
        }
      };
      dC += tC; dNV += tNV; dB += tB; dPz += tPz; dPzO += tPzO;
      dParos += tParos;
      dSlots     += tDef.hours;  // horas totales planeadas (para disponibilidad)
      dElapHours += tElap;       // horas reales transcurridas (para eficiencia)
    }
    const ciclos_obj = config[ciclosObjKey] ?? 2;
    data[lineaLabel] = {
      ...turnData,
      totales_dia: {
        eficiencia:    dElapHours > 0 ? (v => Math.round(v * 1000) / 1000)(dC / (ciclos_obj * dElapHours)) : 0,
        calidad:       dNV > 0 ? (v => Math.round(v * 1000) / 1000)(dB / dNV) : null,
        capacidad:     dPzO > 0 ? (v => Math.round(v * 1000) / 1000)(dPz / dPzO) : null,
        disponibilidad: dSlots > 0 ? (v => Math.round(v * 1000) / 1000)(Math.max(0, dSlots * 60 - Math.min(dParos, dSlots * 60)) / (dSlots * 60)) : null
      }
    };
  }

  if (linea === 'ambas' || linea === 'baker') addBakerLike('Baker', buildSlotsForBaker, 'ciclos_objetivo_baker');
  if (linea === 'ambas' || linea === 'L1')    addBakerLike('L1',    buildSlotsForL1,    'ciclos_objetivo_l1');

  // Añadir datos pareto del día y por turno a cada línea
  for (const l of Object.keys(data)) {
    data[l].pareto_paros    = buildParetoParos(pdb, l, targetDate);
    data[l].pareto_defectos = buildParetoDefectos(pdb, l, targetDate);
    for (const t of ['T1', 'T2', 'T3']) {
      if (data[l][t]) {
        data[l][t].pareto_paros    = buildParetoParos(pdb, l, targetDate, t);
        data[l][t].pareto_defectos = buildParetoDefectos(pdb, l, targetDate, t);
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

  const ftR = c => c.fecha_turno || c.fecha_carga;
  if (desde) cargas = cargas.filter(c => ftR(c) >= desde);
  if (hasta) cargas = cargas.filter(c => ftR(c) <= hasta);

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

  // Cargas activas por línea
  const activas_l3 = (pdb.cargas || []).filter(c => c.linea === 'L3' && c.estado === 'activo').length;
  const activas_l4 = (pdb.cargas || []).filter(c => c.linea === 'L4' && c.estado === 'activo').length;
  const activas_baker = (pdb.cargas_baker || []).filter(c => c.estado === 'activo').length;
  const activas_l1    = (pdb.cargas_l1    || []).filter(c => c.estado === 'activo').length;

  // Canastas completadas hoy — por fecha de DESCARGA
  const completadasHoy = [
    ...(pdb.cargas       || []),
    ...(pdb.cargas_baker || []),
    ...(pdb.cargas_l1    || [])
  ].filter(c => c.fecha_descarga === hoy).length;

  // Canastas completadas en el turno actual — por hora de descarga
  const turnoActual = getTurno(nowTimeStr());
  const completadasTurno = [
    ...(pdb.cargas       || []),
    ...(pdb.cargas_baker || []),
    ...(pdb.cargas_l1    || [])
  ].filter(c => c.fecha_descarga === hoy && getTurno(c.hora_descarga) === turnoActual).length;

  // Mini pizarron: últimas 3 horas L3 y L4
  const now   = nowTimeStr();
  const nowM  = now.split(':').map(Number).reduce((h, m) => h * 60 + m);
  const mini_pizarron = [];
  for (let delta = 2; delta >= 0; delta--) {
    const slotM = nowM - delta * 60;
    if (slotM < 0) continue;
    const h = Math.floor(slotM / 60);
    const slotHora = String(h).padStart(2, '0') + ':00';
    const slotFin  = String(h + 1).padStart(2, '0') + ':00';
    for (const linea of ['L3', 'L4']) {
      const slot = (pdb.cargas || []).filter(c =>
        c.linea === linea &&
        c.fecha_descarga === hoy &&
        c.hora_descarga >= slotHora && c.hora_descarga < slotFin
      );
      if (slot.length === 0) continue;
      const buenos = slot.filter(c => !c.defecto_id && !c.es_vacia).length;
      mini_pizarron.push({
        hora:          slotHora,
        linea,
        ciclos:        slot.length,
        eficiencia:    null,
        calidad:       slot.length > 0 ? buenos / slot.length : null,
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
    'disponibilidad_obj_l3', 'disponibilidad_obj_l4', 'disponibilidad_obj_baker', 'disponibilidad_obj_l1'
  ];
  const camposStr = ['planes_control_baker_url', 'planes_control_l1_url'];
  const body = req.body || {};
  for (const f of camposNum) {
    if (body[f] !== undefined) pdb.config[f] = Number(body[f]);
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
    {id:8, type:'kpi', scope:'dia',   linea:'Baker', duracion_seg:null, activo:true}
  ]
};

router.get('/slideshow-config', (req, res) => {
  const pdb = dbProd.read();
  const slideshow = pdb.config?.slideshow || DEFAULT_SLIDESHOW;
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

router.post('/kpis/guardar', produccionAllowRoles('admin'), (req, res) => {
  const { fecha, linea = 'ambas', turno = 'all' } = req.body || {};
  const targetDate   = fecha || nowDateStr();
  const pdb          = dbProd.read();
  const config       = pdb.config || {};
  if (!pdb.kpi_snapshots) pdb.kpi_snapshots = [];

  const lineasL3L4 = linea === 'ambas' ? ['L3', 'L4'] : (['Baker','L1'].includes(linea) ? [] : [linea]);
  const includeBakerG = linea === 'ambas' || linea === 'Baker';
  const includeL1G    = linea === 'ambas' || linea === 'L1';
  const turnos   = turno === 'all'   ? ['T1', 'T2', 'T3'] : [turno];
  const guardados = [];
  const semana = getISOWeek(new Date(targetDate + 'T12:00:00'));

  for (const l of lineasL3L4) {
    for (const t of turnos) {
      const slots          = buildSlotsForLinTur(pdb, config, l, t, targetDate);
      const ciclos_totales = slots.reduce((s, x) => s + x.ciclos_totales, 0);
      const ciclos_buenos  = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
      const paros_min_total= slots.reduce((s, x) => s + x.paros_min, 0);
      const avg = k => slots.length ? slots.reduce((s, x) => s + x[k], 0) / slots.length : 0;

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

  if (includeBakerG) {
    for (const t of turnos) {
      const slots          = buildSlotsForBaker(pdb, config, t, targetDate);
      const ciclos_totales = slots.reduce((s, x) => s + x.ciclos_totales, 0);
      const ciclos_buenos  = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
      const paros_min_total= slots.reduce((s, x) => s + x.paros_min, 0);
      const avg = k => slots.length ? slots.reduce((s, x) => s + x[k], 0) / slots.length : 0;

      const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === 'Baker' && k.turno === t);
      const snap = {
        id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
        fecha:          targetDate,
        semana,
        turno:          t,
        linea:          'Baker',
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

  if (includeL1G) {
    for (const t of turnos) {
      const slots          = buildSlotsForL1(pdb, config, t, targetDate);
      const ciclos_totales = slots.reduce((s, x) => s + x.ciclos_totales, 0);
      const ciclos_buenos  = slots.reduce((s, x) => s + x.ciclos_buenos, 0);
      const paros_min_total= slots.reduce((s, x) => s + x.paros_min, 0);
      const avg = k => slots.length ? slots.reduce((s, x) => s + x[k], 0) / slots.length : 0;

      const existIdx = pdb.kpi_snapshots.findIndex(k => k.fecha === targetDate && k.linea === 'L1' && k.turno === t);
      const snap = {
        id:             existIdx >= 0 ? pdb.kpi_snapshots[existIdx].id : dbProd.nextId(pdb.kpi_snapshots),
        fecha:          targetDate,
        semana,
        turno:          t,
        linea:          'L1',
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

  const lineasL3L4 = (!linea || linea === 'ambas') ? ['L3', 'L4'] : (['Baker','L1'].includes(linea) ? [] : [linea]);
  const includeBaker = !linea || linea === 'ambas' || linea === 'Baker';
  const includeL1    = !linea || linea === 'ambas' || linea === 'L1';
  const turnos  = turno ? [turno] : ['T1', 'T2', 'T3'];
  const r3      = v => v != null ? Math.round(v * 1000) / 1000 : null;

  const snapshots = [];

  for (const date of dates) {
    // L3 / L4
    for (const l of lineasL3L4) {
      const ciclos_obj = l === 'L3'
        ? (config.ciclos_objetivo_l3 ?? 2)
        : (config.ciclos_objetivo_l4 ?? 2);

      for (const t of turnos) {
        const tDef  = TURNOS_DEF[t];
        const slots = buildSlotsForLinTur(pdb, config, l, t, date);

        const ciclos_totales   = slots.reduce((s, x) => s + x.ciclos_totales,   0);
        const ciclos_no_vacios = slots.reduce((s, x) => s + x.ciclos_no_vacios, 0);
        const ciclos_buenos    = slots.reduce((s, x) => s + x.ciclos_buenos,    0);
        const piezas_total     = slots.reduce((s, x) => s + x.piezas_total,     0);
        const piezas_obj_total = slots.reduce((s, x) => s + x.piezas_obj_total, 0);
        const paros_min_total  = slots.reduce((s, x) => s + x.paros_min,        0);
        // Para calidad: usar conteos filtrados (excluyen herramentales con defecto contemplado)
        const nv_calidad = slots.reduce((s, x) => s + (x.ciclos_no_vacios_calidad ?? x.ciclos_no_vacios), 0);
        const bq_calidad = slots.reduce((s, x) => s + (x.ciclos_buenos_calidad    ?? x.ciclos_buenos),    0);

        if (ciclos_totales === 0 && paros_min_total === 0) continue;

        const turnoMins      = tDef.hours * 60;
        const elapHours      = elapsedHoursForTurno(t, date);
        const eficiencia     = ciclos_totales > 0 ? ciclos_totales / (ciclos_obj * elapHours) : null;
        const calidad        = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
        const capacidad      = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
        const disponibilidad = (turnoMins - Math.min(paros_min_total, turnoMins)) / turnoMins;
        const semana         = getISOWeek(new Date(date + 'T12:00:00'));

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
          slots
        });
      }
    }

    // Baker
    if (includeBaker) {
      const ciclos_obj_baker = config.ciclos_objetivo_baker ?? 2;
      for (const t of turnos) {
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
        const eficiencia     = ciclos_totales > 0 ? ciclos_totales / (ciclos_obj_baker * elapHours) : null;
        const calidad        = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
        const capacidad      = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
        const disponibilidad = (turnoMins - Math.min(paros_min_total, turnoMins)) / turnoMins;
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
          slots
        });
      }
    }

    // L1
    if (includeL1) {
      const ciclos_obj_l1 = config.ciclos_objetivo_l1 ?? 2;
      for (const t of turnos) {
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
        const eficiencia     = ciclos_totales > 0 ? ciclos_totales / (ciclos_obj_l1 * elapHours) : null;
        const calidad        = nv_calidad > 0 ? bq_calidad / nv_calidad : null;
        const capacidad      = piezas_obj_total > 0 ? piezas_total / piezas_obj_total : null;
        const disponibilidad = (turnoMins - Math.min(paros_min_total, turnoMins)) / turnoMins;
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
        piezas_obj_total += Number(c.herramental_cavidades || 0);
      } else {
        // rack
        if (!c.es_vacia) {
          ciclos_no_vacios++;
          if (!c.defecto_id) ciclos_buenos++;
          if (!excluir) {
            ciclos_no_vacios_calidad++;
            if (!c.defecto_id) ciclos_buenos_calidad++;
          }
          piezas_total     += Number(c.cantidad || 0);
          // For capacity: if herramental has piezas config, use it (stored on carga)
          piezas_obj_total += Number(c.piezas_objetivo_carga || 0);
        }
      }
    }

    let paros_min = 0;
    for (const p of (pdb.paros_baker || [])) {
      paros_min += slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                               p.fecha_inicio, p.fecha_fin, slotDate);
    }

    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    const slotObj = slotCiclosObj(ciclos_obj, h);
    const eficiencia    = slotObj > 0 ? r3(ciclos_totales / slotObj) : 0;
    const calidad       = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
    const capacidad     = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
    const disponibilidad = r3(Math.max(0, 60 - Math.min(paros_min, 60)) / 60);

    slots.push({
      slot: h + 1, hora_inicio: ssStr, hora_fin: seStr,
      ciclos_totales, ciclos_obj: slotObj, ciclos_no_vacios, ciclos_buenos,
      ciclos_no_vacios_calidad, ciclos_buenos_calidad,
      piezas_total, piezas_obj_total,
      paros_min: Math.round(paros_min * 10) / 10,
      eficiencia, calidad, capacidad, disponibilidad
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

    let paros_min = 0;
    for (const p of (pdb.paros_l1 || [])) {
      paros_min += slotOverlap(ssR, seR, p.hora_inicio, p.hora_fin || nowTimeStr(),
                               p.fecha_inicio, p.fecha_fin, slotDate);
    }

    const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
    const slotObj = slotCiclosObj(ciclos_obj, h);
    const eficiencia    = slotObj > 0 ? r3(ciclos_totales / slotObj) : 0;
    const calidad       = ciclos_no_vacios_calidad > 0 ? r3(ciclos_buenos_calidad / ciclos_no_vacios_calidad) : null;
    const capacidad     = piezas_obj_total > 0 ? r3(piezas_total / piezas_obj_total) : null;
    const disponibilidad = r3(Math.max(0, 60 - Math.min(paros_min, 60)) / 60);

    slots.push({
      slot: h + 1, hora_inicio: ssStr, hora_fin: seStr,
      ciclos_totales, ciclos_obj: slotObj, ciclos_no_vacios, ciclos_buenos,
      ciclos_no_vacios_calidad, ciclos_buenos_calidad,
      piezas_total, piezas_obj_total,
      paros_min: Math.round(paros_min * 10) / 10,
      eficiencia, calidad, capacidad, disponibilidad
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
  let cargas = pdb.cargas_l1 || [];
  const ft = c => c.fecha_turno || c.fecha_carga;
  if (fecha_ini) cargas = cargas.filter(c => ft(c) >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => ft(c) <= fecha_fin);
  if (turno)  cargas = cargas.filter(c => c.turno === turno);
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
  let cavs = pdb.cavidades_l1 || [];
  if (fecha_ini)    cavs = cavs.filter(c => c.fecha_carga >= fecha_ini);
  if (fecha_fin)    cavs = cavs.filter(c => c.fecha_carga <= fecha_fin);
  if (turno)        cavs = cavs.filter(c => c.turno === turno);
  if (folio_barril) cavs = cavs.filter(c => c.folio_barril === folio_barril);
  res.json(cavs);
});

// POST /l1/cargas — registrar nueva carga L1 (rack o barril); máx 8 herramentales activos
router.post('/l1/cargas', (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.cargas_l1) pdb.cargas_l1 = [];
  if (!pdb.herramentales_l1) pdb.herramentales_l1 = [];

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
  const fecha_turno_l1 = getShiftDate(fecha, hora);
  const turno         = getTurno(hora);
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
  const turno = getTurno(hora);

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

  if (original.estado === 'activo') {
    original.estado = 'defecto';
    original.fecha_descarga = nowDateStr();
    original.hora_descarga  = nowTimeStr();
  }

  const activos = pdb.cargas_l1.filter(c => c.estado === 'activo');
  if (activos.length >= 8) return res.status(409).json({ error: 'Máximo de 8 herramentales activos en L1' });

  const folio = nextFolio('L1', pdb.cargas_l1, 'folio');
  const nueva = {
    ...original,
    id: dbProd.nextId(pdb.cargas_l1),
    folio,
    estado: 'activo',
    fecha_carga: nowDateStr(), fecha_turno: getShiftDate(nowDateStr(), nowTimeStr()), hora_carga: nowTimeStr(),
    turno: getTurno(nowTimeStr()),
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
  const turno        = getTurno(hora_inicio);

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

  const turno = getTurno(hora_inicio);
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
  let cargas = pdb.cargas_baker || [];
  const ft = c => c.fecha_turno || c.fecha_carga;
  if (fecha_ini) cargas = cargas.filter(c => ft(c) >= fecha_ini);
  if (fecha_fin) cargas = cargas.filter(c => ft(c) <= fecha_fin);
  if (turno)  cargas = cargas.filter(c => c.turno === turno);
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
  let cavs = pdb.cavidades_baker || [];
  if (fecha_ini)    cavs = cavs.filter(c => c.fecha_carga >= fecha_ini);
  if (fecha_fin)    cavs = cavs.filter(c => c.fecha_carga <= fecha_fin);
  if (turno)        cavs = cavs.filter(c => c.turno === turno);
  if (folio_barril) cavs = cavs.filter(c => c.folio_barril === folio_barril);
  res.json(cavs);
});

// POST /baker/cargas — registrar nueva carga Baker (rack o barril)
router.post('/baker/cargas', (req, res) => {
  const pdb = dbProd.read();
  if (!pdb.cargas_baker) pdb.cargas_baker = [];
  if (!pdb.herramentales_baker) pdb.herramentales_baker = [];

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
  const fecha      = nowDateStr();                     // fecha real del calendario
  const fecha_turno_b = getShiftDate(fecha, hora);    // fecha del turno
  const turno      = getTurno(hora);
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

    // Para KPI capacidad: objetivo = varillas_totales * piezas_por_varilla del componente
    const ppvObj = ppvComp || 0;
    carga.piezas_objetivo_carga = herr.varillas_totales && ppvObj ? Number(herr.varillas_totales) * ppvObj : 0;
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
  const turno = getTurno(hora);

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

  if (original.estado === 'activo') {
    original.estado = 'defecto';
    original.fecha_descarga = nowDateStr();
    original.hora_descarga  = nowTimeStr();
    original.turno          = getTurno(nowTimeStr());
  }

  const activos = pdb.cargas_baker.filter(c => c.estado === 'activo');
  if (activos.length >= 7) return res.status(409).json({ error: 'Máximo 7 herramentales activos' });

  const folio = nextFolio('BKR', pdb.cargas_baker, 'folio');
  const nueva = {
    ...original,
    id: dbProd.nextId(pdb.cargas_baker),
    folio,
    estado: 'activo',
    fecha_carga: nowDateStr(), fecha_turno: getShiftDate(nowDateStr(), nowTimeStr()), hora_carga: nowTimeStr(),
    turno: getTurno(nowTimeStr()),
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
  const turno        = getTurno(hora_inicio);

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
  // Usa fecha_turno (campo canónico para T3) con fallback a fecha_carga para registros anteriores
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

  const turno = getTurno(hora_inicio);
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

  const turno = getTurno(hora_inicio);
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

module.exports = router;
