const express = require('express');
const { read: readVales, write: writeVales, nextId } = require('../db-vales');
const { read: readUsers, write: writeUsers } = require('../db');
const { valesAuthRequired, valesAllowRoles } = require('../middleware/vales-auth');
const router = express.Router();

router.use(valesAuthRequired);

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateFolio(prefix, collection) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix_date = `${prefix}-${today}-`;
  const count = (collection || []).filter(h => {
    const f = h.folio_vale || h.folio_correccion || '';
    return f.startsWith(prefix_date);
  }).length;
  return `${prefix_date}${String(count + 1).padStart(3, '0')}`;
}

function calcKg(tipo_adicion, cantidad, item) {
  const c = parseFloat(cantidad) || 0;
  switch (tipo_adicion) {
    case 'KG':        return c;
    case 'TAMBO':     return c * (parseFloat(item.peso_kg) || 0);
    case 'PORRON_15L': return c * 15 * (parseFloat(item.densidad) || 0);
    case 'LITRO':     return c * (parseFloat(item.densidad) || 0);
    default:          return c;
  }
}

// ── CATÁLOGOS: Items ──────────────────────────────────────────────────────────

router.get('/items', (req, res) => {
  const db = readVales();
  let items = db.items_vales || [];
  if (req.query.vigente !== undefined) {
    const v = req.query.vigente === 'true' || req.query.vigente === '1';
    items = items.filter(i => Boolean(i.vigente) === v);
  }
  res.json(items);
});

router.post('/items', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const body = req.body;
  if (!body.item || !body.presentacion) return res.status(400).json({ error: 'Código y presentación requeridos' });
  if ((db.items_vales || []).find(i => i.item === body.item.toUpperCase().trim())) {
    return res.status(409).json({ error: 'Ya existe un item con ese código' });
  }
  const row = {
    id: nextId(db.items_vales),
    item: body.item.toUpperCase().trim(),
    proveedor: body.proveedor || '',
    presentacion: body.presentacion || '',
    peso_kg: parseFloat(body.peso_kg) || 0,
    densidad: parseFloat(body.densidad) || 0,
    precio_kg: parseFloat(body.precio_kg) || 0,
    precio_item: parseFloat(body.precio_item) || 0,
    moneda: body.moneda || 'MXN',
    fecha_cotizacion: body.fecha_cotizacion || '',
    vigente: body.vigente !== false,
    created_at: new Date().toISOString()
  };
  db.items_vales.push(row);
  writeVales(db);
  res.status(201).json(row);
});

router.patch('/items/:id', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const item = (db.items_vales || []).find(i => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  const b = req.body;
  if (b.proveedor !== undefined)       item.proveedor = b.proveedor;
  if (b.presentacion !== undefined)    item.presentacion = b.presentacion;
  if (b.peso_kg !== undefined)         item.peso_kg = parseFloat(b.peso_kg) || 0;
  if (b.densidad !== undefined)        item.densidad = parseFloat(b.densidad) || 0;
  if (b.precio_kg !== undefined)       item.precio_kg = parseFloat(b.precio_kg) || 0;
  if (b.precio_item !== undefined)     item.precio_item = parseFloat(b.precio_item) || 0;
  if (b.moneda !== undefined)          item.moneda = b.moneda;
  if (b.fecha_cotizacion !== undefined) item.fecha_cotizacion = b.fecha_cotizacion;
  if (b.vigente !== undefined)         item.vigente = b.vigente;
  writeVales(db);
  res.json(item);
});

// Tipos de adición autorizados por item
router.get('/item-adiciones/:item_id', (req, res) => {
  const db = readVales();
  res.json((db.item_adiciones || []).filter(a => a.item_id === Number(req.params.item_id)));
});

router.put('/item-adiciones/:item_id', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const item_id = Number(req.params.item_id);
  db.item_adiciones = (db.item_adiciones || []).filter(a => a.item_id !== item_id);
  (req.body.tipos || []).forEach(tipo => {
    db.item_adiciones.push({ id: nextId(db.item_adiciones), item_id, tipo_adicion: tipo, activo: true });
  });
  writeVales(db);
  res.json(db.item_adiciones.filter(a => a.item_id === item_id));
});

// ── CATÁLOGOS: Tanques ────────────────────────────────────────────────────────

router.get('/lineas', (req, res) => {
  const db = readVales();
  const lineas = [...new Set((db.tanques_vales || []).map(t => t.linea))].filter(Boolean).sort();
  res.json(lineas);
});

router.get('/tanques', (req, res) => {
  const db = readVales();
  let tanques = db.tanques_vales || [];
  if (req.query.linea) tanques = tanques.filter(t => t.linea === req.query.linea);
  res.json(tanques);
});

router.post('/tanques', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const body = req.body;
  if (!body.linea || !body.no_tanque) return res.status(400).json({ error: 'Línea y número de tanque requeridos' });
  if ((db.tanques_vales || []).find(t => t.linea === body.linea && t.no_tanque === body.no_tanque)) {
    return res.status(409).json({ error: 'Ya existe este tanque en esa línea' });
  }
  const row = {
    id: nextId(db.tanques_vales),
    linea: body.linea,
    no_tanque: body.no_tanque,
    nombre_tanque: body.nombre_tanque || '',
    tipo: body.tipo || '',
    items_autorizados: body.items_autorizados || [],
    activo: true,
    created_at: new Date().toISOString()
  };
  db.tanques_vales.push(row);
  writeVales(db);
  res.status(201).json(row);
});

router.patch('/tanques/:id', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const tanque = (db.tanques_vales || []).find(t => t.id === Number(req.params.id));
  if (!tanque) return res.status(404).json({ error: 'Tanque no encontrado' });
  const b = req.body;
  if (b.nombre_tanque !== undefined)    tanque.nombre_tanque = b.nombre_tanque;
  if (b.tipo !== undefined)             tanque.tipo = b.tipo;
  if (b.items_autorizados !== undefined) tanque.items_autorizados = b.items_autorizados;
  if (b.activo !== undefined)           tanque.activo = b.activo;
  writeVales(db);
  res.json(tanque);
});

// ── VALES ─────────────────────────────────────────────────────────────────────

router.get('/vales', (req, res) => {
  const db = readVales();
  let headers = db.vales_header || [];
  if (req.query.fecha_ini) headers = headers.filter(h => h.fecha >= req.query.fecha_ini);
  if (req.query.fecha_fin) headers = headers.filter(h => h.fecha <= req.query.fecha_fin);
  if (req.query.folio)     headers = headers.filter(h => h.folio_vale.includes(req.query.folio.toUpperCase()));
  if (req.query.linea)     headers = headers.filter(h => h.linea === req.query.linea);
  const detalles = db.vales_detalle || [];
  const result = [...headers].reverse().map(h => ({
    ...h,
    detalle: detalles.filter(d => d.folio_vale === h.folio_vale)
  }));
  res.json(result);
});

router.get('/vales/:folio', (req, res) => {
  const db = readVales();
  const header = (db.vales_header || []).find(h => h.folio_vale === req.params.folio);
  if (!header) return res.status(404).json({ error: 'Vale no encontrado' });
  res.json({
    ...header,
    detalle: (db.vales_detalle || []).filter(d => d.folio_vale === header.folio_vale),
    correcciones: (db.vales_correccion || []).filter(c => c.folio_origen === header.folio_vale)
  });
});

router.post('/vales', valesAllowRoles('admin', 'operador'), (req, res) => {
  const db = readVales();
  const body = req.body;

  if (!body.linea) return res.status(400).json({ error: 'Línea requerida' });
  if (!Array.isArray(body.detalle) || body.detalle.length === 0) {
    return res.status(400).json({ error: 'El vale debe tener al menos una línea de detalle' });
  }

  const folio_vale = generateFolio('VA', db.vales_header);
  const now = new Date();

  const header = {
    id: nextId(db.vales_header),
    folio_vale,
    fecha: body.fecha || now.toISOString().slice(0, 10),
    hora: body.hora || now.toTimeString().slice(0, 5),
    turno: body.turno || '',
    linea: body.linea,
    solicita: body.solicita || '',
    adiciona: body.adiciona || '',
    coordinador: body.coordinador || '',
    comentarios: body.comentarios || '',
    usuario: req.valesUser.full_name,
    usuario_id: req.valesUser.id,
    created_at: now.toISOString()
  };
  db.vales_header.push(header);
  db.vales_detalle = db.vales_detalle || [];
  db.kardex_vales = db.kardex_vales || [];
  db.inventario_vales = db.inventario_vales || [];

  for (const det of body.detalle) {
    const itemRec = (db.items_vales || []).find(i => i.item === det.item);
    if (!itemRec) return res.status(400).json({ error: `Item no encontrado: ${det.item}` });

    const kg = calcKg(det.tipo_adicion, det.cantidad, itemRec);

    db.vales_detalle.push({
      id: nextId(db.vales_detalle),
      folio_vale,
      titulacion: det.titulacion || '',
      no_tanque: det.no_tanque || '',
      nombre_tanque: det.nombre_tanque || '',
      item: det.item,
      tipo_adicion: det.tipo_adicion,
      cantidad: parseFloat(det.cantidad) || 0,
      kg_equivalentes: kg,
      created_at: now.toISOString()
    });

    db.kardex_vales.push({
      id: nextId(db.kardex_vales),
      tipo: 'SALIDA',
      referencia: folio_vale,
      item: det.item,
      kg,
      cantidad: parseFloat(det.cantidad) || 0,
      unidad: det.tipo_adicion,
      linea: body.linea,
      no_tanque: det.no_tanque || '',
      nombre_tanque: det.nombre_tanque || '',
      usuario: req.valesUser.full_name,
      comentario: '',
      created_at: now.toISOString()
    });

    let inv = db.inventario_vales.find(i => i.item === det.item);
    if (!inv) {
      inv = { id: nextId(db.inventario_vales), item: det.item, existencia_kg: 0, ultima_actualizacion: now.toISOString() };
      db.inventario_vales.push(inv);
    }
    inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) - kg;
    inv.ultima_actualizacion = now.toISOString();
  }

  writeVales(db);
  res.status(201).json({
    ...header,
    detalle: db.vales_detalle.filter(d => d.folio_vale === folio_vale)
  });
});

// ── CORRECCIONES ──────────────────────────────────────────────────────────────

router.get('/correcciones', (req, res) => {
  const db = readVales();
  let corr = db.vales_correccion || [];
  if (req.query.folio_origen) corr = corr.filter(c => c.folio_origen === req.query.folio_origen);
  res.json([...corr].reverse());
});

router.post('/correcciones', valesAllowRoles('admin', 'operador'), (req, res) => {
  const db = readVales();
  const body = req.body;

  if (!body.folio_origen) return res.status(400).json({ error: 'Folio de origen requerido' });
  if (!body.item) return res.status(400).json({ error: 'Item requerido' });
  if (!body.tipo || !['DEVOLVER', 'DESCONTAR'].includes(body.tipo)) {
    return res.status(400).json({ error: 'Tipo debe ser DEVOLVER o DESCONTAR' });
  }

  const originalHeader = (db.vales_header || []).find(h => h.folio_vale === body.folio_origen);
  if (!originalHeader) return res.status(404).json({ error: 'Vale de origen no encontrado' });

  const itemRec = (db.items_vales || []).find(i => i.item === body.item);
  if (!itemRec) return res.status(400).json({ error: 'Item no encontrado' });

  const folio_correccion = generateFolio('VC', db.vales_correccion);
  const kg = calcKg(body.unidad || 'KG', body.cantidad, itemRec);
  const now = new Date();

  db.vales_correccion = db.vales_correccion || [];
  const corrRow = {
    id: nextId(db.vales_correccion),
    folio_origen: body.folio_origen,
    folio_correccion,
    tipo: body.tipo,
    item: body.item,
    unidad: body.unidad || 'KG',
    cantidad: parseFloat(body.cantidad) || 0,
    kg,
    usuario: req.valesUser.full_name,
    usuario_id: req.valesUser.id,
    comentario: body.comentario || '',
    created_at: now.toISOString()
  };
  db.vales_correccion.push(corrRow);

  db.kardex_vales = db.kardex_vales || [];
  db.kardex_vales.push({
    id: nextId(db.kardex_vales),
    tipo: body.tipo === 'DEVOLVER' ? 'CORRECCION_ENTRADA' : 'CORRECCION_SALIDA',
    referencia: folio_correccion,
    item: body.item,
    kg,
    cantidad: parseFloat(body.cantidad) || 0,
    unidad: body.unidad || 'KG',
    linea: originalHeader.linea,
    no_tanque: body.no_tanque || '',
    nombre_tanque: body.nombre_tanque || '',
    usuario: req.valesUser.full_name,
    comentario: body.comentario || '',
    created_at: now.toISOString()
  });

  db.inventario_vales = db.inventario_vales || [];
  let inv = db.inventario_vales.find(i => i.item === body.item);
  if (!inv) {
    inv = { id: nextId(db.inventario_vales), item: body.item, existencia_kg: 0, ultima_actualizacion: now.toISOString() };
    db.inventario_vales.push(inv);
  }
  inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) + (body.tipo === 'DEVOLVER' ? kg : -kg);
  inv.ultima_actualizacion = now.toISOString();

  writeVales(db);
  res.status(201).json(corrRow);
});

// ── INVENTARIO ────────────────────────────────────────────────────────────────

router.get('/inventario', (req, res) => {
  const db = readVales();
  const result = (db.inventario_vales || []).map(i => {
    const itemRec = (db.items_vales || []).find(it => it.item === i.item);
    return {
      ...i,
      presentacion: itemRec?.presentacion || '',
      proveedor: itemRec?.proveedor || '',
      precio_kg: itemRec?.precio_kg || 0,
      moneda: itemRec?.moneda || 'MXN'
    };
  });
  res.json(result);
});

router.get('/kardex', (req, res) => {
  const db = readVales();
  let kardex = db.kardex_vales || [];
  if (req.query.item) kardex = kardex.filter(k => k.item === req.query.item);
  if (req.query.fecha_ini) kardex = kardex.filter(k => k.created_at >= req.query.fecha_ini);
  if (req.query.fecha_fin) kardex = kardex.filter(k => k.created_at <= req.query.fecha_fin + 'T23:59:59');
  res.json([...kardex].reverse());
});

// Ajuste de inventario físico (admin)
router.post('/inventario/ajuste', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const body = req.body;
  if (!body.item || body.existencia_kg === undefined) {
    return res.status(400).json({ error: 'Item y existencia_kg requeridos' });
  }
  const now = new Date();
  db.inventario_vales = db.inventario_vales || [];
  let inv = db.inventario_vales.find(i => i.item === body.item);
  const anterior = inv ? (parseFloat(inv.existencia_kg) || 0) : 0;
  const nueva = parseFloat(body.existencia_kg);
  const diff = nueva - anterior;

  if (!inv) {
    inv = { id: nextId(db.inventario_vales), item: body.item, existencia_kg: nueva, ultima_actualizacion: now.toISOString() };
    db.inventario_vales.push(inv);
  } else {
    inv.existencia_kg = nueva;
    inv.ultima_actualizacion = now.toISOString();
  }

  db.kardex_vales = db.kardex_vales || [];
  db.kardex_vales.push({
    id: nextId(db.kardex_vales),
    tipo: 'AJUSTE',
    referencia: `AJU-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`,
    item: body.item,
    kg: Math.abs(diff),
    cantidad: Math.abs(diff),
    unidad: 'KG',
    linea: '',
    no_tanque: '',
    nombre_tanque: '',
    usuario: req.valesUser.full_name,
    comentario: body.comentario || `Ajuste físico: anterior ${anterior.toFixed(3)} → nueva ${nueva.toFixed(3)} kg`,
    created_at: now.toISOString()
  });

  writeVales(db);
  res.json(inv);
});

// Entrada de inventario (recepción de material)
router.post('/inventario/entrada', valesAllowRoles('admin', 'operador'), (req, res) => {
  const db = readVales();
  const body = req.body;
  if (!body.item || !body.cantidad || !body.unidad) {
    return res.status(400).json({ error: 'Item, cantidad y unidad requeridos' });
  }
  const itemRec = (db.items_vales || []).find(i => i.item === body.item);
  if (!itemRec) return res.status(400).json({ error: 'Item no encontrado' });

  const kg = calcKg(body.unidad, body.cantidad, itemRec);
  const now = new Date();
  const ref = `ENT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;

  db.inventario_vales = db.inventario_vales || [];
  let inv = db.inventario_vales.find(i => i.item === body.item);
  if (!inv) {
    inv = { id: nextId(db.inventario_vales), item: body.item, existencia_kg: 0, ultima_actualizacion: now.toISOString() };
    db.inventario_vales.push(inv);
  }
  inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) + kg;
  inv.ultima_actualizacion = now.toISOString();

  db.kardex_vales = db.kardex_vales || [];
  db.kardex_vales.push({
    id: nextId(db.kardex_vales),
    tipo: 'ENTRADA',
    referencia: ref,
    item: body.item,
    kg,
    cantidad: parseFloat(body.cantidad) || 0,
    unidad: body.unidad,
    linea: '',
    no_tanque: '',
    nombre_tanque: '',
    usuario: req.valesUser.full_name,
    comentario: body.comentario || '',
    created_at: now.toISOString()
  });

  writeVales(db);
  res.status(201).json(inv);
});

// ── USUARIOS (gestión de acceso al módulo) ───────────────────────────────────

router.get('/usuarios', valesAllowRoles('admin'), (req, res) => {
  const dbMain = readUsers();
  res.json(dbMain.users.map(u => ({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    role_code: u.role_code,
    vales_role: u.vales_role || null,
    active: u.active
  })));
});

router.patch('/usuarios/:id/vales-role', valesAllowRoles('admin'), (req, res) => {
  const dbMain = readUsers();
  const user = dbMain.users.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { vales_role } = req.body;
  if (vales_role !== null && vales_role !== undefined && !['admin', 'operador', 'consulta'].includes(vales_role)) {
    return res.status(400).json({ error: 'Rol inválido. Use: admin, operador, consulta, o null' });
  }
  user.vales_role = vales_role || null;
  writeUsers(dbMain);
  res.json({ id: user.id, full_name: user.full_name, email: user.email, vales_role: user.vales_role });
});

module.exports = router;
