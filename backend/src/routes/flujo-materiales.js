const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const { read, write, nextId } = require('../db-flujo');
const { flujoAuthRequired, flujoAllowRoles, flujoSyncKeyRequired } = require('../middleware/flujo-auth');
const JWT_SECRET = require('../jwt-secret');
const { createRateLimiter } = require('../rate-limit');
const _rl = createRateLimiter();

// ── Helpers ──────────────────────────────────────────────────────────────────
const MX_TZ = 'America/Mexico_City';
function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: MX_TZ });
}
function nowMxTime() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: MX_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  delete obj.__proto__;
  delete obj.constructor;
  delete obj.prototype;
  return obj;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
    return res.status(400).json({ error: 'Email y contrasena requeridos' });
  const rlKey = `flujo|${email.toLowerCase()}|${_rl.getIp(req)}`;
  const lim = _rl.check(rlKey);
  if (lim.blocked) return res.status(429).json({ error: `Demasiados intentos. Intenta en ${lim.wait} min.` });
  const db = read();
  const user = (db.usuarios_flujo || []).find(u =>
    u.email?.toLowerCase() === email.toLowerCase() && u.activo !== false
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    _rl.recordFail(rlKey);
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }
  const token = jwt.sign(
    { sub: user.id, module: 'flujo', role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role } });
});

router.post('/auth/change-password', flujoAuthRequired, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Contrasenas requeridas' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Minimo 6 caracteres' });
  const db = read();
  const user = (db.usuarios_flujo || []).find(u => u.id === req.flujoUser.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Contrasena actual incorrecta' });
  }
  user.password_hash = bcrypt.hashSync(new_password, 10);
  write(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGOS TENNECO — PARTES
// ═══════════════════════════════════════════════════════════════════════════════

router.use(flujoAuthRequired);

router.get('/cat/tenneco/partes', (req, res) => {
  res.json(read().cat_tenneco_partes || []);
});

router.post('/cat/tenneco/partes', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const b = sanitize(req.body);
  if (!b.diametro_mm || !b.numero_parte) return res.status(400).json({ error: 'Diametro y numero de parte requeridos' });
  const dup = (db.cat_tenneco_partes || []).find(p =>
    String(p.numero_parte).trim() === String(b.numero_parte).trim()
  );
  if (dup) return res.status(409).json({ error: 'Ya existe ese numero de parte' });
  const row = {
    id: nextId(db.cat_tenneco_partes),
    diametro_mm: String(b.diametro_mm).trim(),
    numero_parte: String(b.numero_parte).trim(),
    proyecto: (b.proyecto || '').trim(),
    tamano_muestra: parseInt(b.tamano_muestra) || 100,
    created_at: nowMxDate()
  };
  db.cat_tenneco_partes.push(row);
  write(db);
  res.status(201).json(row);
});

router.patch('/cat/tenneco/partes/:id', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const row = (db.cat_tenneco_partes || []).find(p => p.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  const b = sanitize(req.body);
  if (b.diametro_mm !== undefined) row.diametro_mm = String(b.diametro_mm).trim();
  if (b.numero_parte !== undefined) row.numero_parte = String(b.numero_parte).trim();
  if (b.proyecto !== undefined) row.proyecto = (b.proyecto || '').trim();
  if (b.tamano_muestra !== undefined) row.tamano_muestra = parseInt(b.tamano_muestra) || 100;
  write(db);
  res.json(row);
});

router.delete('/cat/tenneco/partes/:id', flujoAllowRoles('admin'), (req, res) => {
  const db = read();
  const idx = (db.cat_tenneco_partes || []).findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.cat_tenneco_partes.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGOS TENNECO — ESPECIFICACIONES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/cat/tenneco/specs', (req, res) => {
  res.json(read().cat_tenneco_specs || []);
});

router.post('/cat/tenneco/specs', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const b = sanitize(req.body);
  if (!b.numero_parte) return res.status(400).json({ error: 'Numero de parte requerido' });
  const row = {
    id: nextId(db.cat_tenneco_specs),
    numero_parte: String(b.numero_parte).trim(),
    proyecto: (b.proyecto || '').trim(),
    rugosidad_min: parseFloat(b.rugosidad_min) || 0,
    rugosidad_max: parseFloat(b.rugosidad_max) || 0,
    altura_axial_min: parseFloat(b.altura_axial_min) || 0,
    altura_axial_max: parseFloat(b.altura_axial_max) || 0,
    created_at: nowMxDate()
  };
  db.cat_tenneco_specs.push(row);
  write(db);
  res.status(201).json(row);
});

router.patch('/cat/tenneco/specs/:id', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const row = (db.cat_tenneco_specs || []).find(s => s.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  const b = sanitize(req.body);
  if (b.numero_parte !== undefined) row.numero_parte = String(b.numero_parte).trim();
  if (b.proyecto !== undefined) row.proyecto = (b.proyecto || '').trim();
  if (b.rugosidad_min !== undefined) row.rugosidad_min = parseFloat(b.rugosidad_min) || 0;
  if (b.rugosidad_max !== undefined) row.rugosidad_max = parseFloat(b.rugosidad_max) || 0;
  if (b.altura_axial_min !== undefined) row.altura_axial_min = parseFloat(b.altura_axial_min) || 0;
  if (b.altura_axial_max !== undefined) row.altura_axial_max = parseFloat(b.altura_axial_max) || 0;
  write(db);
  res.json(row);
});

router.delete('/cat/tenneco/specs/:id', flujoAllowRoles('admin'), (req, res) => {
  const db = read();
  const idx = (db.cat_tenneco_specs || []).findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.cat_tenneco_specs.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGOS TENNECO — DEFECTOS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/cat/tenneco/defectos', (req, res) => {
  res.json(read().cat_tenneco_defectos || []);
});

router.post('/cat/tenneco/defectos', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const b = sanitize(req.body);
  if (!b.defecto) return res.status(400).json({ error: 'Nombre de defecto requerido' });
  const row = {
    id: nextId(db.cat_tenneco_defectos),
    defecto: String(b.defecto).trim(),
    descripcion: (b.descripcion || '').trim(),
    imagen_b64: b.imagen_b64 || null,
    created_at: nowMxDate()
  };
  db.cat_tenneco_defectos.push(row);
  write(db);
  res.status(201).json(row);
});

router.patch('/cat/tenneco/defectos/:id', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const row = (db.cat_tenneco_defectos || []).find(d => d.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  const b = sanitize(req.body);
  if (b.defecto !== undefined) row.defecto = String(b.defecto).trim();
  if (b.descripcion !== undefined) row.descripcion = (b.descripcion || '').trim();
  if (b.imagen_b64 !== undefined) row.imagen_b64 = b.imagen_b64 || null;
  write(db);
  res.json(row);
});

router.delete('/cat/tenneco/defectos/:id', flujoAllowRoles('admin'), (req, res) => {
  const db = read();
  const idx = (db.cat_tenneco_defectos || []).findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.cat_tenneco_defectos.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGOS ASM — PARTES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/cat/asm/partes', (req, res) => {
  res.json(read().cat_asm_partes || []);
});

router.post('/cat/asm/partes', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const b = sanitize(req.body);
  if (!b.numero_parte) return res.status(400).json({ error: 'Numero de parte requerido' });
  const row = {
    id: nextId(db.cat_asm_partes),
    numero_parte: String(b.numero_parte).trim(),
    piezas_por_caja: parseInt(b.piezas_por_caja) || 0,
    piezas_por_cama: parseInt(b.piezas_por_cama) || 0,
    created_at: nowMxDate()
  };
  db.cat_asm_partes.push(row);
  write(db);
  res.status(201).json(row);
});

router.patch('/cat/asm/partes/:id', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const row = (db.cat_asm_partes || []).find(p => p.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  const b = sanitize(req.body);
  if (b.numero_parte !== undefined) row.numero_parte = String(b.numero_parte).trim();
  if (b.piezas_por_caja !== undefined) row.piezas_por_caja = parseInt(b.piezas_por_caja) || 0;
  if (b.piezas_por_cama !== undefined) row.piezas_por_cama = parseInt(b.piezas_por_cama) || 0;
  write(db);
  res.json(row);
});

router.delete('/cat/asm/partes/:id', flujoAllowRoles('admin'), (req, res) => {
  const db = read();
  const idx = (db.cat_asm_partes || []).findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.cat_asm_partes.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOGOS ASM — DEFECTOS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/cat/asm/defectos', (req, res) => {
  res.json(read().cat_asm_defectos || []);
});

router.post('/cat/asm/defectos', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const b = sanitize(req.body);
  if (!b.defecto) return res.status(400).json({ error: 'Nombre de defecto requerido' });
  const row = {
    id: nextId(db.cat_asm_defectos),
    defecto: String(b.defecto).trim(),
    descripcion: (b.descripcion || '').trim(),
    imagen_b64: b.imagen_b64 || null,
    created_at: nowMxDate()
  };
  db.cat_asm_defectos.push(row);
  write(db);
  res.status(201).json(row);
});

router.patch('/cat/asm/defectos/:id', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  const row = (db.cat_asm_defectos || []).find(d => d.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  const b = sanitize(req.body);
  if (b.defecto !== undefined) row.defecto = String(b.defecto).trim();
  if (b.descripcion !== undefined) row.descripcion = (b.descripcion || '').trim();
  if (b.imagen_b64 !== undefined) row.imagen_b64 = b.imagen_b64 || null;
  write(db);
  res.json(row);
});

router.delete('/cat/asm/defectos/:id', flujoAllowRoles('admin'), (req, res) => {
  const db = read();
  const idx = (db.cat_asm_defectos || []).findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.cat_asm_defectos.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOTES TENNECO — INGRESO
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/tenneco/lotes', (req, res) => {
  const db = read();
  let lotes = db.lotes_tenneco || [];
  const { estado, desde, hasta, semana } = req.query;
  if (estado) lotes = lotes.filter(l => l.estado === estado);
  if (desde) lotes = lotes.filter(l => l.fecha_recepcion >= desde);
  if (hasta) lotes = lotes.filter(l => l.fecha_recepcion <= hasta);
  if (semana) lotes = lotes.filter(l => String(l.semana) === String(semana));
  res.json(lotes);
});

router.post('/tenneco/lotes', flujoAllowRoles('supervisor'), (req, res) => {
  const db = read();
  const b = sanitize(req.body);
  if (!b.diametro || !b.lote || !b.cantidad_recibida)
    return res.status(400).json({ error: 'Diametro, lote y cantidad requeridos' });

  const cantidad = parseInt(b.cantidad_recibida) || 0;
  if (cantidad <= 0) return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });

  const fecha = nowMxDate();
  const sem = isoWeek(fecha);

  // Autocompletar desde catalogo
  const parte = (db.cat_tenneco_partes || []).find(p =>
    String(p.diametro_mm).trim() === String(b.diametro).trim()
  );

  const row = {
    id: nextId(db.lotes_tenneco),
    fecha_recepcion: fecha,
    semana: sem,
    folio_salida_tenneco: String(b.folio_salida_tenneco || '').trim(),
    enviado_por: (b.enviado_por || '').trim(),
    numero_parte: parte ? parte.numero_parte : (b.numero_parte || '').trim(),
    diametro: String(b.diametro).trim(),
    cliente_int: parte ? parte.proyecto : (b.cliente_int || '').trim(),
    lote: String(b.lote).trim(),
    cantidad_recibida: cantidad,
    material_por_procesar: cantidad,
    material_procesando: 0,
    por_inspeccionar: 0,
    material_terminado: 0,
    scrap_total: 0,
    enviado: 0,
    progreso: 0,
    pct_scrap: 0,
    estado: 'abierto',
    remision_id: null,
    fecha_envio: null,
    created_at: fecha,
    created_by: req.flujoUser.nombre
  };
  db.lotes_tenneco.push(row);
  write(db);
  res.status(201).json(row);
});

router.patch('/tenneco/lotes/:id', flujoAllowRoles('supervisor'), (req, res) => {
  const db = read();
  const row = (db.lotes_tenneco || []).find(l => l.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Lote no encontrado' });
  if (row.estado === 'enviado') return res.status(400).json({ error: 'Lote ya enviado, no editable' });
  const b = sanitize(req.body);
  const editable = ['folio_salida_tenneco', 'enviado_por', 'numero_parte', 'diametro', 'cliente_int', 'lote'];
  for (const k of editable) {
    if (b[k] !== undefined) row[k] = String(b[k]).trim();
  }
  if (b.cantidad_recibida !== undefined) {
    const c = parseInt(b.cantidad_recibida) || 0;
    if (c > 0) {
      row.cantidad_recibida = c;
      recalcLote(row, db);
    }
  }
  write(db);
  res.json(row);
});

function recalcLote(lote, db) {
  const muestras = (db.muestras_tenneco || []).filter(m => m.lote_id === lote.id);
  let terminado = 0, scrap = 0, rechazos = 0;
  for (const m of muestras) {
    terminado += (m.piezas_aceptadas || 0);
    scrap += (m.scrap || 0);
    rechazos += (m.rechazos || []).reduce((s, r) => s + (r.cantidad || 0), 0);
  }
  lote.material_terminado = terminado;
  lote.scrap_total = scrap;
  const procesado = terminado + scrap;
  lote.material_por_procesar = Math.max(0, lote.cantidad_recibida - procesado - rechazos);
  lote.material_procesando = rechazos;
  lote.progreso = lote.cantidad_recibida > 0 ? Math.round((procesado / lote.cantidad_recibida) * 100) / 100 : 0;
  lote.pct_scrap = lote.cantidad_recibida > 0 ? Math.round((scrap / lote.cantidad_recibida) * 10000) / 100 : 0;
  if (procesado >= lote.cantidad_recibida && lote.estado === 'abierto') {
    lote.estado = 'cerrado';
  }
}

router.get('/tenneco/lotes/export', flujoAllowRoles('supervisor'), (req, res) => {
  const db = read();
  let lotes = db.lotes_tenneco || [];
  const { desde, hasta } = req.query;
  if (desde) lotes = lotes.filter(l => l.fecha_recepcion >= desde);
  if (hasta) lotes = lotes.filter(l => l.fecha_recepcion <= hasta);

  const rows = lotes.map(l => ({
    'Fecha Recepcion': l.fecha_recepcion,
    'Semana': l.semana,
    'Folio Salida Tenneco': l.folio_salida_tenneco,
    'Enviado por': l.enviado_por,
    'Numero de Parte': l.numero_parte,
    'Diametro': l.diametro,
    'Cliente (int)': l.cliente_int,
    'Lote': l.lote,
    'Recepcion': l.cantidad_recibida,
    'Material por Procesar': l.material_por_procesar,
    'Material Procesando': l.material_procesando,
    'Material terminado': l.material_terminado,
    'SCRAP': l.scrap_total,
    'Enviado': l.enviado,
    'Progreso': l.progreso,
    '% SCRAP': l.pct_scrap
  }));
  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOTES TENNECO — SALIDA
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/tenneco/lotes-listos', flujoAllowRoles('supervisor'), (req, res) => {
  const db = read();
  const lotes = (db.lotes_tenneco || []).filter(l => {
    if (l.estado === 'enviado') return false;
    const muestras = (db.muestras_tenneco || []).filter(m => m.lote_id === l.id);
    if (muestras.length === 0) return false;
    const allQC = muestras.every(m => m.qc_liberado === true);
    const procesado = l.material_terminado + l.scrap_total;
    const completo = procesado >= l.cantidad_recibida;
    return allQC && completo;
  });
  res.json(lotes);
});

router.get('/tenneco/remisiones', (req, res) => {
  res.json(read().remisiones_tenneco || []);
});

router.get('/tenneco/remisiones/:id', (req, res) => {
  const rem = (read().remisiones_tenneco || []).find(r => r.id === Number(req.params.id));
  if (!rem) return res.status(404).json({ error: 'Remision no encontrada' });
  res.json(rem);
});

router.post('/tenneco/remisiones', flujoAllowRoles('supervisor'), (req, res) => {
  const db = read();
  const b = sanitize(req.body);
  const loteIds = b.lote_ids;
  if (!Array.isArray(loteIds) || loteIds.length === 0)
    return res.status(400).json({ error: 'Selecciona al menos un lote' });

  const fecha = nowMxDate();
  const lotesData = [];
  for (const lid of loteIds) {
    const lote = (db.lotes_tenneco || []).find(l => l.id === Number(lid));
    if (!lote) return res.status(404).json({ error: `Lote ID ${lid} no encontrado` });
    if (lote.estado === 'enviado') return res.status(400).json({ error: `Lote ${lote.lote} ya fue enviado` });
    lotesData.push({
      lote_id: lote.id,
      lote: lote.lote,
      numero_parte: lote.numero_parte,
      diametro: lote.diametro,
      cliente_int: lote.cliente_int,
      cantidad: lote.material_terminado,
      caja_id: `TEN${lote.lote}.1`
    });
  }

  // Generar folio remision
  const count = (db.remisiones_tenneco || []).length;
  const folio = `REM-${fecha.replace(/-/g, '')}-${String(count + 1).padStart(3, '0')}`;

  const remision = {
    id: nextId(db.remisiones_tenneco),
    folio,
    fecha,
    lotes: lotesData,
    observaciones: (b.observaciones || '').trim(),
    created_by: req.flujoUser.nombre,
    created_at: fecha
  };
  db.remisiones_tenneco.push(remision);

  // Marcar lotes como enviados
  for (const lid of loteIds) {
    const lote = db.lotes_tenneco.find(l => l.id === Number(lid));
    if (lote) {
      lote.estado = 'enviado';
      lote.enviado = lote.material_terminado;
      lote.remision_id = remision.id;
      lote.fecha_envio = fecha;
    }
  }
  write(db);
  res.status(201).json(remision);
});

// Datos para generar certificado de un lote
router.get('/tenneco/certificado/:loteId', (req, res) => {
  const db = read();
  const lote = (db.lotes_tenneco || []).find(l => l.id === Number(req.params.loteId));
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
  const muestras = (db.muestras_tenneco || []).filter(m => m.lote_id === lote.id);

  // Calcular promedios generales
  let rugVals = [], altVals = [];
  for (const m of muestras) {
    if (m.rugosidad_prom != null) rugVals.push(m.rugosidad_prom);
    if (m.altura_axial_prom != null) altVals.push(m.altura_axial_prom);
  }
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const std = arr => {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };

  const specs = (db.cat_tenneco_specs || []).find(s =>
    String(s.numero_parte).trim() === String(lote.numero_parte).trim()
  );

  res.json({
    lote,
    muestras_count: muestras.length,
    rugosidad: { avg: Math.round(avg(rugVals) * 100) / 100, std: Math.round(std(rugVals) * 100) / 100, n: rugVals.length },
    altura_axial: { avg: Math.round(avg(altVals) * 100) / 100, std: Math.round(std(altVals) * 100) / 100, n: altVals.length },
    specs: specs || null
  });
});

// Datos para etiqueta
router.get('/tenneco/etiqueta/:loteId', (req, res) => {
  const db = read();
  const lote = (db.lotes_tenneco || []).find(l => l.id === Number(req.params.loteId));
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
  res.json({
    numero_parte: lote.numero_parte,
    diametro: lote.diametro,
    cliente_int: lote.cliente_int,
    lote: lote.lote,
    cantidad: lote.material_terminado,
    fecha_empaque: lote.fecha_envio || nowMxDate(),
    qr_code: `TEN${lote.lote}-${lote.id}`
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// KPI TENNECO
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/tenneco/kpi', (req, res) => {
  const db = read();
  const lotes = db.lotes_tenneco || [];
  const agrupacion = req.query.agrupacion || 'semana';
  const anio = req.query.anio ? parseInt(req.query.anio) : new Date().getFullYear();

  const result = {};
  for (const l of lotes) {
    if (!l.fecha_recepcion) continue;
    const y = parseInt(l.fecha_recepcion.slice(0, 4));
    if (y !== anio) continue;

    const key = agrupacion === 'mes'
      ? l.fecha_recepcion.slice(0, 7)
      : `S${String(l.semana).padStart(2, '0')}`;
    const comp = l.numero_parte || 'Sin N/P';
    if (!result[comp]) result[comp] = {};
    if (!result[comp][key]) result[comp][key] = 0;
    result[comp][key] += (l.material_terminado || 0);
  }
  res.json({ anio, agrupacion, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMPAQUE / MUESTRAS — CONSULTA
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/tenneco/muestras', flujoAllowRoles('calidad'), (req, res) => {
  const db = read();
  let muestras = db.muestras_tenneco || [];
  if (req.query.lote_id) {
    muestras = muestras.filter(m => m.lote_id === Number(req.query.lote_id));
  }
  res.json(muestras);
});

router.get('/tenneco/muestras/:id', flujoAllowRoles('calidad'), (req, res) => {
  const m = (read().muestras_tenneco || []).find(m => m.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Muestra no encontrada' });
  res.json(m);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC — APP PYTHON (API key, no JWT)
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/sync/heartbeat', flujoSyncKeyRequired, (req, res) => {
  const db = read();
  const b = req.body || {};
  const side = b.side || 'tenneco';
  db.flujo_app_status = db.flujo_app_status || [];
  const existing = db.flujo_app_status.find(s => s.side === side && s.hostname === (b.hostname || ''));
  const entry = {
    side,
    version: b.version || '',
    operador: b.operador || '',
    hostname: b.hostname || '',
    last_seen: new Date().toISOString()
  };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    db.flujo_app_status.push(entry);
  }
  write(db);
  res.json({ ok: true });
});

router.get('/sync/lotes-pendientes', flujoSyncKeyRequired, (req, res) => {
  const db = read();
  const lotes = (db.lotes_tenneco || []).filter(l => l.estado === 'abierto');
  res.json(lotes);
});

router.get('/sync/catalogos', flujoSyncKeyRequired, (req, res) => {
  const db = read();
  res.json({
    partes: db.cat_tenneco_partes || [],
    specs: db.cat_tenneco_specs || [],
    defectos: db.cat_tenneco_defectos || []
  });
});

router.post('/sync/muestras', flujoSyncKeyRequired, (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records[] requerido' });

  const db = read();
  let added = 0, updated = 0;

  for (const rec of records) {
    if (!rec.lote_id || rec.num_muestra == null) continue;

    // Buscar lote
    const lote = (db.lotes_tenneco || []).find(l => l.id === Number(rec.lote_id));
    if (!lote) continue;

    // Buscar specs para validar
    const specs = (db.cat_tenneco_specs || []).find(s =>
      String(s.numero_parte).trim() === String(lote.numero_parte).trim()
    );

    const rugProm = Array.isArray(rec.rugosidad) && rec.rugosidad.length === 3
      ? rec.rugosidad.reduce((a, b) => a + b, 0) / 3 : null;
    const altProm = Array.isArray(rec.altura_axial) && rec.altura_axial.length === 3
      ? rec.altura_axial.reduce((a, b) => a + b, 0) / 3 : null;

    let rugOk = true, altOk = true;
    if (specs && rugProm != null) {
      rugOk = rugProm >= specs.rugosidad_min && rugProm <= specs.rugosidad_max;
    }
    if (specs && altProm != null) {
      altOk = altProm >= specs.altura_axial_min && altProm <= specs.altura_axial_max;
    }

    // Validar empaque: a+b+c = tamano_muestra
    const parte = (db.cat_tenneco_partes || []).find(p =>
      String(p.numero_parte).trim() === String(lote.numero_parte).trim()
    );
    const tamMuestra = parte ? parte.tamano_muestra : 100;
    const rechazosTotal = Array.isArray(rec.rechazos)
      ? rec.rechazos.reduce((s, r) => s + (r.cantidad || 0), 0) : 0;
    const scrap = parseInt(rec.scrap) || 0;
    const aceptadas = parseInt(rec.piezas_aceptadas) || 0;
    const totalMuestra = aceptadas + rechazosTotal + scrap;

    // Scrap <= 3% del tamano de muestra
    const scrapMaxPct = tamMuestra * 0.03;

    const muestra = {
      lote_id: Number(rec.lote_id),
      num_muestra: parseInt(rec.num_muestra),
      rugosidad: rec.rugosidad || [],
      rugosidad_prom: rugProm != null ? Math.round(rugProm * 100) / 100 : null,
      rugosidad_ok: rugOk,
      altura_axial: rec.altura_axial || [],
      altura_axial_prom: altProm != null ? Math.round(altProm * 100) / 100 : null,
      altura_axial_ok: altOk,
      piezas_aceptadas: aceptadas,
      rechazos: rec.rechazos || [],
      scrap,
      total_muestra: totalMuestra,
      tamano_muestra: tamMuestra,
      scrap_excedido: scrap > scrapMaxPct,
      qc_liberado: rugOk && altOk && !rec.hold,
      synced_at: new Date().toISOString()
    };

    // Upsert
    const existing = (db.muestras_tenneco || []).find(m =>
      m.lote_id === muestra.lote_id && m.num_muestra === muestra.num_muestra
    );
    if (existing) {
      Object.assign(existing, muestra);
      updated++;
    } else {
      muestra.id = nextId(db.muestras_tenneco);
      muestra.created_at = new Date().toISOString();
      db.muestras_tenneco.push(muestra);
      added++;
    }

    // Recalc lote
    recalcLote(lote, db);
  }

  write(db);
  res.json({ ok: true, added, updated });
});

// ═══════════════════════════════════════════════════════════════════════════════
// APP STATUS (consulta desde web)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/app-status', flujoAllowRoles('supervisor', 'calidad'), (req, res) => {
  res.json(read().flujo_app_status || []);
});

// ═══════════════════════════════════════════════════════════════════════════════
// APP VERSION (auto-update check desde Python app)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/sync/app-version', flujoSyncKeyRequired, (req, res) => {
  res.json({
    version: '1.0.0',
    download_url: '',
    changelog: 'Release inicial'
  });
});

module.exports = router;
