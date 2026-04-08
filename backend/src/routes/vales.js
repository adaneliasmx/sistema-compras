const express = require('express');
const fs      = require('fs');
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

// ── REPARACIÓN: normaliza fechas corruptas en vales_header (admin) ────────────
router.post('/repair-fechas', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  let fixed = 0;
  (db.vales_header || []).forEach(h => {
    const orig = h.fecha;
    const norm = toDateStr(orig);
    if (norm && norm !== orig) { h.fecha = norm; fixed++; }
  });
  if (fixed > 0) writeVales(db);
  res.json({ ok: true, fixed, message: `${fixed} fecha(s) normalizadas` });
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

// Editar encabezado de vale (admin)
router.patch('/vales/:folio', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const header = (db.vales_header || []).find(h => h.folio_vale === req.params.folio);
  if (!header) return res.status(404).json({ error: 'Vale no encontrado' });
  const b = req.body;
  const editables = ['fecha','hora','turno','linea','solicita','adiciona','coordinador','comentarios'];
  editables.forEach(f => { if (b[f] !== undefined) header[f] = b[f]; });
  // Si cambia la línea, actualizar kardex relacionados
  if (b.linea !== undefined) {
    (db.kardex_vales || []).filter(k => k.referencia === header.folio_vale).forEach(k => { k.linea = b.linea; });
  }
  header.updated_at = new Date().toISOString();
  header.updated_by = req.valesUser.full_name;
  writeVales(db);
  res.json({ ...header, detalle: (db.vales_detalle || []).filter(d => d.folio_vale === header.folio_vale) });
});

// Eliminar vale (admin) — revierte inventario
router.delete('/vales/:folio', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const folio = req.params.folio;
  const header = (db.vales_header || []).find(h => h.folio_vale === folio);
  if (!header) return res.status(404).json({ error: 'Vale no encontrado' });

  // Revertir efecto en inventario
  const detalles = (db.vales_detalle || []).filter(d => d.folio_vale === folio);
  for (const det of detalles) {
    const inv = (db.inventario_vales || []).find(i => i.item === det.item);
    if (inv) {
      inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) + (det.kg_equivalentes || 0);
      inv.ultima_actualizacion = new Date().toISOString();
    }
  }

  db.vales_header  = db.vales_header.filter(h => h.folio_vale !== folio);
  db.vales_detalle = (db.vales_detalle || []).filter(d => d.folio_vale !== folio);
  db.kardex_vales  = (db.kardex_vales  || []).filter(k => !(k.referencia === folio && k.tipo === 'SALIDA'));

  writeVales(db);
  res.json({ ok: true, folio, eliminado_por: req.valesUser.full_name });
});

// Editar línea de detalle (admin) — recalcula kg y actualiza kardex
router.patch('/vales/:folio/detalle/:id', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const det = (db.vales_detalle || []).find(d => d.folio_vale === req.params.folio && d.id === Number(req.params.id));
  if (!det) return res.status(404).json({ error: 'Línea no encontrada' });
  const b = req.body;
  const oldKg       = det.kg_equivalentes;
  const oldCantidad = det.cantidad;
  const oldTipo     = det.tipo_adicion;

  if (b.titulacion  !== undefined) det.titulacion  = b.titulacion;
  if (b.tipo_adicion !== undefined) det.tipo_adicion = b.tipo_adicion;
  if (b.cantidad    !== undefined) det.cantidad    = parseFloat(b.cantidad) || 0;

  // Recalcular kg si cambió cantidad o tipo
  if (b.cantidad !== undefined || b.tipo_adicion !== undefined) {
    const itemRec = (db.items_vales || []).find(i => i.item === det.item);
    if (itemRec) {
      det.kg_equivalentes = calcKg(det.tipo_adicion, det.cantidad, itemRec);
    }
  }
  const newKg = det.kg_equivalentes;
  det.updated_at = new Date().toISOString();

  // Actualizar kardex: buscar por detalle_id o por referencia+item+oldCantidad+oldTipo
  const kardex = (db.kardex_vales || []).find(k =>
    k.referencia === req.params.folio && k.item === det.item &&
    (k.detalle_id === det.id || (k.cantidad === oldCantidad && k.unidad === oldTipo))
  );
  if (kardex) {
    kardex.cantidad = det.cantidad;
    kardex.unidad   = det.tipo_adicion;
    kardex.kg       = newKg;
    kardex.updated_at = new Date().toISOString();
  }

  // Ajustar inventario con la diferencia de kg
  const diff = newKg - oldKg;
  if (diff !== 0) {
    const inv = (db.inventario_vales || []).find(i => i.item === det.item);
    if (inv) {
      inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) - diff;
      inv.ultima_actualizacion = new Date().toISOString();
    }
  }

  writeVales(db);
  res.json(det);
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
    const detalleId = nextId(db.vales_detalle);

    db.vales_detalle.push({
      id: detalleId,
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
      detalle_id: detalleId,
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

// ── IMPORT EXCEL ──────────────────────────────────────────────────────────────

// Convierte fecha a YYYY-MM-DD — maneja Date object, serial Excel, ISO string, DD/MM/YYYY, etc.
function toDateStr(v) {
  if (v == null || v === '') return '';
  // JS Date object (SheetJS cellDates:true, o JSON.parse de ISO string)
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  // Serial Excel: número entero (e.g. 46114)
  if (typeof v === 'number') {
    if (v < 1) return '';
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // YYYY-MM-DD o ISO "2026-03-15T00:00:00.000Z"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY (formato mexicano)
  const ddmm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
  // Intento genérico (e.g. "Mar 15, 2026")
  const parsed = new Date(s);
  return isNaN(parsed) ? s.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

router.post('/import-excel', valesAllowRoles('admin'), (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'No se recibieron filas' });

  const db = readVales();
  db.vales_header     = db.vales_header     || [];
  db.vales_detalle    = db.vales_detalle    || [];
  db.kardex_vales     = db.kardex_vales     || [];
  db.inventario_vales = db.inventario_vales || [];

  const now = new Date().toISOString();
  let created = 0, updated = 0;
  const errors = [];

  // Normalize rows — soporta formato "Por Vale" (col Folio) y "Por Item" (col Folio Vale)
  const norm = r => ({
    folio:         String(r['Folio'] || r['Folio Vale'] || '').trim(),
    fecha:         toDateStr(r['Fecha']),
    hora:          String(r['Hora']          || '').trim(),
    turno:         String(r['Turno']         || '').trim(),
    linea:         String(r['Línea'] || r['Linea'] || '').trim(),
    solicita:      String(r['Solicita']      || '').trim(),
    adiciona:      String(r['Adiciona']      || '').trim(),
    coordinador:   String(r['Coordinador']   || '').trim(),
    comentarios:   String(r['Comentarios']   || '').trim(),
    no_tanque:     String(r['No. Tanque']    || '').trim(),
    nombre_tanque: String(r['Nombre Tanque'] || '').trim(),
    item:          String(r['Producto']      || '').trim().toUpperCase(),
    tipo_adicion:  String(r['Tipo Adición'] || r['Tipo Adicion'] || '').trim(),
    cantidad:      parseFloat(r['Cantidad'])  || 0,
    titulacion:    String(r['Titulación'] || r['Titulacion'] || '').trim()
  });

  // Agrupar por folio
  const byFolio = {};
  for (const raw of rows) {
    const r = norm(raw);
    if (!r.folio) continue;
    if (!byFolio[r.folio]) byFolio[r.folio] = { header: null, detalles: [] };
    if (!byFolio[r.folio].header) {
      byFolio[r.folio].header = { fecha: r.fecha, hora: r.hora, turno: r.turno, linea: r.linea, solicita: r.solicita, adiciona: r.adiciona, coordinador: r.coordinador, comentarios: r.comentarios };
    }
    if (r.item) byFolio[r.folio].detalles.push(r);
  }

  for (const [folio, data] of Object.entries(byFolio)) {
    try {
      const existingHeader = db.vales_header.find(h => h.folio_vale === folio);

      if (existingHeader) {
        // Actualizar encabezado
        const hdr = data.header;
        if (hdr.fecha)       existingHeader.fecha       = hdr.fecha;
        if (hdr.hora)        existingHeader.hora        = hdr.hora;
        if (hdr.turno)       existingHeader.turno       = hdr.turno;
        if (hdr.linea)       existingHeader.linea       = hdr.linea;
        if (hdr.solicita)    existingHeader.solicita    = hdr.solicita;
        if (hdr.adiciona)    existingHeader.adiciona    = hdr.adiciona;
        if (hdr.coordinador) existingHeader.coordinador = hdr.coordinador;
        if (hdr.comentarios) existingHeader.comentarios = hdr.comentarios;
        existingHeader.updated_at = now;
        existingHeader.updated_by = req.valesUser.full_name + ' (Excel import)';

        if (data.detalles.length > 0) {
          // Revertir efectos en inventario de detalle anterior
          for (const od of db.vales_detalle.filter(d => d.folio_vale === folio)) {
            const inv = db.inventario_vales.find(i => i.item === od.item);
            if (inv) inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) + (od.kg_equivalentes || 0);
          }
          // Eliminar detalle y kardex anterior
          db.vales_detalle = db.vales_detalle.filter(d => d.folio_vale !== folio);
          db.kardex_vales  = db.kardex_vales.filter(k => !(k.referencia === folio && k.tipo === 'SALIDA'));

          // Insertar nuevo detalle
          for (const det of data.detalles) {
            const itemRec = (db.items_vales || []).find(i => i.item === det.item);
            const kg = itemRec ? calcKg(det.tipo_adicion, det.cantidad, itemRec) : (det.cantidad || 0);
            const did = nextId(db.vales_detalle);
            db.vales_detalle.push({ id: did, folio_vale: folio, titulacion: det.titulacion, no_tanque: det.no_tanque, nombre_tanque: det.nombre_tanque, item: det.item, tipo_adicion: det.tipo_adicion, cantidad: det.cantidad, kg_equivalentes: kg, created_at: now });
            db.kardex_vales.push({ id: nextId(db.kardex_vales), tipo: 'SALIDA', referencia: folio, item: det.item, kg, cantidad: det.cantidad, unidad: det.tipo_adicion, linea: existingHeader.linea, no_tanque: det.no_tanque, nombre_tanque: det.nombre_tanque, usuario: req.valesUser.full_name + ' (import)', comentario: 'Importado desde Excel', detalle_id: did, created_at: now });
            let inv = db.inventario_vales.find(i => i.item === det.item);
            if (!inv) { inv = { id: nextId(db.inventario_vales), item: det.item, existencia_kg: 0, ultima_actualizacion: now }; db.inventario_vales.push(inv); }
            inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) - kg;
            inv.ultima_actualizacion = now;
          }
        }
        updated++;
      } else {
        // Crear nuevo vale
        const hdr = {
          id: nextId(db.vales_header), folio_vale: folio,
          fecha: data.header.fecha, hora: data.header.hora, turno: data.header.turno,
          linea: data.header.linea, solicita: data.header.solicita, adiciona: data.header.adiciona,
          coordinador: data.header.coordinador, comentarios: data.header.comentarios,
          usuario: req.valesUser.full_name + ' (import)', usuario_id: req.valesUser.id, created_at: now
        };
        db.vales_header.push(hdr);

        for (const det of data.detalles) {
          const itemRec = (db.items_vales || []).find(i => i.item === det.item);
          if (!itemRec) errors.push(`Producto no en catálogo (se guardó sin kg): ${det.item} (${folio})`);
          const kg = itemRec ? calcKg(det.tipo_adicion, det.cantidad, itemRec) : (det.cantidad || 0);
          const did = nextId(db.vales_detalle);
          db.vales_detalle.push({ id: did, folio_vale: folio, titulacion: det.titulacion, no_tanque: det.no_tanque, nombre_tanque: det.nombre_tanque, item: det.item, tipo_adicion: det.tipo_adicion, cantidad: det.cantidad, kg_equivalentes: kg, created_at: now });
          db.kardex_vales.push({ id: nextId(db.kardex_vales), tipo: 'SALIDA', referencia: folio, item: det.item, kg, cantidad: det.cantidad, unidad: det.tipo_adicion, linea: hdr.linea, no_tanque: det.no_tanque, nombre_tanque: det.nombre_tanque, usuario: req.valesUser.full_name + ' (import)', comentario: 'Importado desde Excel', detalle_id: did, created_at: now });
          let inv = db.inventario_vales.find(i => i.item === det.item);
          if (!inv) { inv = { id: nextId(db.inventario_vales), item: det.item, existencia_kg: 0, ultima_actualizacion: now }; db.inventario_vales.push(inv); }
          inv.existencia_kg = (parseFloat(inv.existencia_kg) || 0) - kg;
          inv.ultima_actualizacion = now;
        }
        created++;
      }
    } catch (e) {
      errors.push(`Error en ${folio}: ${e.message}`);
    }
  }

  // Auto-reparar TODAS las fechas en la BD (incluyendo registros previos con formato incorrecto)
  let fechasReparadas = 0;
  (db.vales_header || []).forEach(h => {
    const norm = toDateStr(h.fecha);
    if (norm && norm !== h.fecha) { h.fecha = norm; fechasReparadas++; }
  });

  writeVales(db);
  res.json({ ok: true, created, updated, fechas_reparadas: fechasReparadas, errors, total_folios: Object.keys(byFolio).length });
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

// ── Detalles aplanados (por item) ─────────────────────────────────────────────
router.get('/detalles', (req, res) => {
  const db = readVales();
  const headers = db.vales_header || [];
  let detalles = db.vales_detalle || [];

  // Construir mapa de headers para lookup rápido
  const hdrMap = {};
  headers.forEach(h => { hdrMap[h.folio_vale] = h; });

  // Join detalle + header
  let rows = detalles.map(d => {
    const h = hdrMap[d.folio_vale] || {};
    return {
      folio_vale:    d.folio_vale,
      fecha:         h.fecha || '',
      hora:          h.hora  || '',
      turno:         h.turno || '',
      linea:         h.linea || '',
      no_tanque:     d.no_tanque    || '',
      nombre_tanque: d.nombre_tanque|| '',
      item:          d.item         || '',
      tipo_adicion:  d.tipo_adicion || '',
      cantidad:      d.cantidad     || 0,
      kg:            d.kg_equivalentes || 0,
      titulacion:    d.titulacion   || '',
      solicita:      h.solicita     || '',
      adiciona:      h.adiciona     || '',
      coordinador:   h.coordinador  || '',
      comentarios:   h.comentarios  || '',
      usuario:       h.usuario      || ''
    };
  });

  // Filtros
  if (req.query.fecha_ini) rows = rows.filter(r => r.fecha >= req.query.fecha_ini);
  if (req.query.fecha_fin) rows = rows.filter(r => r.fecha <= req.query.fecha_fin);
  if (req.query.item)      rows = rows.filter(r => r.item === req.query.item);
  if (req.query.linea)     rows = rows.filter(r => r.linea === req.query.linea);
  if (req.query.turno)     rows = rows.filter(r => r.turno === req.query.turno);

  // Ordenar por fecha desc
  rows.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  res.json(rows);
});

// ── Helpers para reportes de período ─────────────────────────────────────────
const MESES_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS_SHORT  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function getPeriodBounds(tipo, fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  let ini, fin, prevIni, prevFin, label, prevLabel;

  if (tipo === 'semana') {
    const dow = d.getUTCDay(); // 0=Dom
    const toMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() + toMon);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    ini  = mon.toISOString().slice(0, 10);
    fin  = sun.toISOString().slice(0, 10);
    const pMon = new Date(mon); pMon.setUTCDate(mon.getUTCDate() - 7);
    const pSun = new Date(sun); pSun.setUTCDate(sun.getUTCDate() - 7);
    prevIni = pMon.toISOString().slice(0, 10);
    prevFin = pSun.toISOString().slice(0, 10);
    const startOfYear = new Date(Date.UTC(mon.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((mon - startOfYear) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
    const fmt = x => `${x.getUTCDate()} ${MESES_SHORT[x.getUTCMonth()]}`;
    label     = `Semana ${weekNum} · ${fmt(mon)}-${fmt(sun)} ${sun.getUTCFullYear()}`;
    prevLabel = `Semana ${weekNum - 1} · ${fmt(pMon)}-${fmt(pSun)}`;

  } else if (tipo === 'mes') {
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    ini  = `${y}-${String(m + 1).padStart(2,'0')}-01`;
    fin  = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
    prevIni = `${py}-${String(pm + 1).padStart(2,'0')}-01`;
    prevFin = new Date(Date.UTC(py, pm + 1, 0)).toISOString().slice(0, 10);
    label     = `${MESES_FULL[m]} ${y}`;
    prevLabel = `${MESES_FULL[pm]} ${py}`;

  } else { // anio
    const y = d.getUTCFullYear();
    ini = `${y}-01-01`; fin = `${y}-12-31`;
    prevIni = `${y-1}-01-01`; prevFin = `${y-1}-12-31`;
    label = `Año ${y}`; prevLabel = `Año ${y - 1}`;
  }
  return { ini, fin, prevIni, prevFin, label, prevLabel };
}

function generateBuckets(tipo, ini, fin, prevIni) {
  if (tipo === 'semana') {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ini + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
      const ds = d.toISOString().slice(0, 10);
      const pd = new Date(prevIni + 'T12:00:00Z'); pd.setUTCDate(pd.getUTCDate() + i);
      const ps = pd.toISOString().slice(0, 10);
      return { label: `${DIAS_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`, ini: ds, fin: ds, prevIni: ps, prevFin: ps };
    });
  } else if (tipo === 'mes') {
    const buckets = [];
    let cur = new Date(ini + 'T12:00:00Z');
    const end = new Date(fin + 'T12:00:00Z');
    let w = 1;
    while (cur <= end) {
      const ws = cur.toISOString().slice(0, 10);
      const we_d = new Date(cur); we_d.setUTCDate(cur.getUTCDate() + 6);
      if (we_d > end) we_d.setTime(end.getTime());
      const we = we_d.toISOString().slice(0, 10);
      const pc = new Date(prevIni + 'T12:00:00Z'); pc.setUTCDate(pc.getUTCDate() + (w-1)*7);
      const pe = new Date(pc); pe.setUTCDate(pc.getUTCDate() + 6);
      buckets.push({ label: `S${w}`, ini: ws, fin: we, prevIni: pc.toISOString().slice(0,10), prevFin: pe.toISOString().slice(0,10) });
      cur.setUTCDate(cur.getUTCDate() + 7);
      w++;
    }
    return buckets;
  } else { // anio
    const y = parseInt(ini.slice(0, 4));
    return MESES_SHORT.map((m, i) => {
      const mi = String(i+1).padStart(2,'0');
      const ini2 = `${y}-${mi}-01`;
      const fin2 = new Date(Date.UTC(y, i+1, 0)).toISOString().slice(0,10);
      const pIni = `${y-1}-${mi}-01`;
      const pFin = new Date(Date.UTC(y-1, i+1, 0)).toISOString().slice(0,10);
      return { label: m, ini: ini2, fin: fin2, prevIni: pIni, prevFin: pFin };
    });
  }
}

// ── Reporte por período (admin) ───────────────────────────────────────────────
router.get('/reportes/periodo', valesAllowRoles('admin'), (req, res) => {
  const tipo  = req.query.tipo  || 'semana';
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  const filtLinea = req.query.linea || '';

  const db = readVales();
  const headers  = db.vales_header  || [];
  const detalles = db.vales_detalle || [];

  const hdrMap = {};
  headers.forEach(h => { hdrMap[h.folio_vale] = h; });

  const bounds = getPeriodBounds(tipo, fecha);
  const { ini, fin, prevIni, prevFin, label, prevLabel } = bounds;

  // Aplanar detalles con header
  const rows = detalles.map(d => {
    const h = hdrMap[d.folio_vale] || {};
    return {
      folio_vale: d.folio_vale,
      fecha:  h.fecha  || '',
      linea:  h.linea  || '',
      item:   d.item   || '',
      kg:     parseFloat(d.kg_equivalentes) || 0
    };
  }).filter(r => !filtLinea || r.linea === filtLinea);

  const sumKg = arr => arr.reduce((s, r) => s + r.kg, 0);
  const actual   = rows.filter(r => r.fecha >= ini    && r.fecha <= fin);
  const anterior = rows.filter(r => r.fecha >= prevIni && r.fecha <= prevFin);

  // ── Tendencia (buckets)
  const buckets = generateBuckets(tipo, ini, fin, prevIni);
  const tendencia = buckets.map(b => ({
    label:    b.label,
    actual:   sumKg(actual.filter(r => r.fecha >= b.ini && r.fecha <= b.fin)),
    anterior: sumKg(anterior.filter(r => r.fecha >= b.prevIni && r.fecha <= b.prevFin))
  }));

  // ── Por producto
  const acc = (arr) => {
    const m = {};
    arr.forEach(r => { m[r.item] = (m[r.item] || 0) + r.kg; });
    return m;
  };
  const iAct = acc(actual), iAnt = acc(anterior);
  const allItems = [...new Set([...Object.keys(iAct), ...Object.keys(iAnt)])];
  const byProducto = allItems.map(item => {
    const act = iAct[item] || 0, ant = iAnt[item] || 0;
    const delta = act - ant;
    const pct   = ant > 0 ? (delta / ant) * 100 : (act > 0 ? 100 : 0);
    return { item, actual: act, anterior: ant, delta, pct };
  }).sort((a, b) => b.actual - a.actual);

  // ── Por línea
  const lAct = acc(actual.map(r => ({ ...r, item: r.linea })));
  const lAnt = acc(anterior.map(r => ({ ...r, item: r.linea })));
  const allLineas = [...new Set([...Object.keys(lAct), ...Object.keys(lAnt)])];
  const byLinea = allLineas.map(linea => {
    const act = lAct[linea] || 0, ant = lAnt[linea] || 0;
    return { linea, actual: act, anterior: ant, delta: act - ant, pct: ant > 0 ? ((act-ant)/ant)*100 : (act>0?100:0) };
  }).sort((a, b) => b.actual - a.actual);

  // ── Alertas: productos con subida ≥ 20%
  const alertas = byProducto.filter(r => r.pct >= 20 && r.actual > 0 && r.anterior > 0);

  res.json({
    periodoActual:   { label, ini, fin },
    periodoAnterior: { label: prevLabel, ini: prevIni, fin: prevFin },
    tendencia,
    byProducto,
    byLinea,
    totales: {
      actual:          sumKg(actual),
      anterior:        sumKg(anterior),
      vales_actual:    new Set(actual.map(r => r.folio_vale)).size,
      vales_anterior:  new Set(anterior.map(r => r.folio_vale)).size
    },
    alertas
  });
});

// ── Comparativo real vs teórico (admin) ───────────────────────────────────────
router.get('/reportes/comparativo', valesAllowRoles('admin'), (req, res) => {
  const dbVales = readVales();
  const dbMain  = readUsers(); // full Compras DB
  const kardex  = dbVales.kardex_vales  || [];
  const items   = dbVales.items_vales   || [];
  const invItems = dbMain.inventory_items || [];
  const invWeekly = dbMain.inventory_weekly || [];

  const yearQ  = req.query.year  ? Number(req.query.year)  : new Date().getFullYear();
  const wIni   = Math.max(1, req.query.week_ini ? Number(req.query.week_ini) : 1);
  const wFin   = Math.min(53, req.query.week_fin ? Number(req.query.week_fin) : 53);

  // Build map: vales_item name → inventory_item (for peso_kg_por_unidad)
  const invMap = {};
  invItems.forEach(x => { if (x.vales_item) invMap[x.vales_item] = x; });

  // Get week boundaries helper
  function weekBounds(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    return { ini: mon.toISOString().slice(0,10), fin: sun.toISOString().slice(0,10) };
  }

  // For each Vales item that has a linked inventory_item
  const result = items
    .filter(item => invMap[item.item])
    .map(item => {
      const invItem = invMap[item.item];
      const pesoKg  = Number(invItem.peso_kg_por_unidad) || 1;

      const weeks = [];
      for (let w = wIni; w <= wFin; w++) {
        const { ini, fin } = weekBounds(yearQ, w);
        // Real consumption from inventory_weekly
        const curr = invWeekly.find(r => Number(r.inventory_item_id) === invItem.id && Number(r.year) === yearQ && Number(r.week) === w);
        const prevWeek = w > 1 ? w - 1 : 52;
        const prevYear = w > 1 ? yearQ : yearQ - 1;
        const prev = invWeekly.find(r => Number(r.inventory_item_id) === invItem.id && Number(r.year) === prevYear && Number(r.week) === prevWeek);
        const consumoReal = (prev && curr)
          ? (Number(prev.stock_actual) - Number(curr.stock_actual) + Number(curr.pedido_recibido || 0)) * pesoKg
          : null;
        // Theoretical consumption from kardex SALIDA
        const consumoTeorico = kardex
          .filter(k => {
            if (k.item !== item.item || k.tipo !== 'SALIDA') return false;
            const kFecha = k.fecha || (k.created_at ? k.created_at.slice(0, 10) : '');
            return kFecha >= ini && kFecha <= fin;
          })
          .reduce((s, k) => s + (parseFloat(k.kg) || 0), 0);
        if (curr || consumoTeorico > 0) {
          weeks.push({
            week: w, year: yearQ, ini, fin,
            stock_actual: curr ? Number(curr.stock_actual) : null,
            pedido_recibido: curr ? Number(curr.pedido_recibido || 0) : 0,
            consumo_real_kg: consumoReal,
            consumo_teorico_kg: consumoTeorico,
            diferencia: consumoReal !== null ? consumoReal - consumoTeorico : null,
            pct_diferencia: (consumoReal !== null && consumoTeorico > 0) ? ((consumoReal - consumoTeorico) / consumoTeorico) * 100 : null
          });
        }
      }
      return { item: item.item, unidad: invItem.unit || 'TAMBO', peso_kg_por_unidad: pesoKg, weeks };
    })
    .filter(r => r.weeks.length > 0);

  res.json({ year: yearQ, week_ini: wIni, week_fin: wFin, items: result });
});

// ── IMPORTACIÓN DESDE SQLITE (base sistema antiguo) ───────────────────────────

const multer  = require('multer');
const os      = require('os');
const _upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/import-sqlite', valesAllowRoles('admin'), _upload.single('sqlite_file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });

  const mode               = req.body.mode || 'preview';
  const import_items       = req.body.import_items       !== 'false';
  const import_tanques     = req.body.import_tanques     !== 'false';
  const import_vales       = req.body.import_vales       !== 'false';
  const import_kardex      = req.body.import_kardex      !== 'false';
  const import_correcciones= req.body.import_correcciones!== 'false';

  const tmpPath = req.file.path;

  let SqliteDb;
  try {
    SqliteDb = require('better-sqlite3');
  } catch (e) {
    fs.unlink(tmpPath, () => {});
    return res.status(500).json({ error: 'better-sqlite3 no disponible: ' + e.message });
  }

  let src;
  try {
    src = new SqliteDb(tmpPath, { readonly: true });
  } catch (e) {
    fs.unlink(tmpPath, () => {});
    return res.status(400).json({ error: 'No se pudo leer el archivo SQLite: ' + e.message });
  }

  try {
    const db = readVales();

    // ── Leer tablas del SQLite ──────────────────────────────────────────────
    const srcItems      = src.prepare('SELECT * FROM items').all();
    const srcAdiciones  = src.prepare('SELECT * FROM item_adiciones').all();
    const srcTanques    = src.prepare('SELECT * FROM tanques').all();
    const srcHeaders    = src.prepare('SELECT * FROM vales_header').all();
    const srcDetalles   = src.prepare('SELECT * FROM vales_detalle').all();
    const srcKardex     = src.prepare('SELECT * FROM kardex').all();
    const srcCorrec     = src.prepare('SELECT * FROM vales_correccion').all();
    const srcInv        = src.prepare('SELECT * FROM inventario').all();
    src.close();
    fs.unlink(tmpPath, () => {});

    const stats = {
      items:       { total: srcItems.length,   nuevos: 0, actualizados: 0, sin_cambios: 0 },
      tanques:     { total: srcTanques.length,  nuevos: 0, actualizados: 0, sin_cambios: 0 },
      adiciones:   { total: srcAdiciones.length,nuevos: 0, sin_cambios: 0 },
      vales:       { total: srcHeaders.length,  nuevos: 0, omitidos: 0 },
      kardex:      { total: srcKardex.length,   nuevos: 0, omitidos: 0 },
      correcciones:{ total: srcCorrec.length,   nuevos: 0, omitidos: 0 }
    };

    if (mode === 'preview') {
      // Solo contar, no modificar
      if (import_items) {
        srcItems.forEach(si => {
          const exist = (db.items_vales || []).find(i => i.item === si.item);
          if (!exist) stats.items.nuevos++;
          else {
            const changed = exist.peso_kg !== si.peso_kg || exist.densidad !== si.densidad || exist.precio_kg !== si.precio_kg;
            if (changed) stats.items.actualizados++; else stats.items.sin_cambios++;
          }
        });
      }
      if (import_tanques) {
        srcTanques.forEach(st => {
          const exist = (db.tanques_vales || []).find(t => t.linea === st.linea && t.no_tanque === st.no_tanque);
          if (!exist) stats.tanques.nuevos++;
          else stats.tanques.sin_cambios++;
        });
      }
      if (import_items) {
        srcAdiciones.forEach(sa => {
          const destItem = (db.items_vales || []).find(i => i.item === sa.item);
          if (!destItem) return;
          const exist = (db.item_adiciones || []).find(a => a.item_id === destItem.id && a.tipo_adicion === sa.tipo_adicion);
          if (!exist) stats.adiciones.nuevos++; else stats.adiciones.sin_cambios++;
        });
      }
      if (import_vales) {
        srcHeaders.forEach(sh => {
          const exist = (db.vales_header || []).find(h => h.folio_vale === sh.folio_vale);
          if (!exist) stats.vales.nuevos++; else stats.vales.omitidos++;
        });
      }
      if (import_kardex) {
        srcKardex.forEach(sk => {
          // Primero por _sqlite_id (importaciones previas), luego por clave natural + cantidad para evitar falsos positivos
          const exist = (db.kardex_vales || []).find(k =>
            k._sqlite_id === sk.id ||
            (k.fecha === (sk.fecha || '').slice(0, 10) && k.referencia === sk.referencia &&
             k.item === sk.item && k.cantidad === sk.cantidad && k.tipo === sk.tipo));
          if (!exist) stats.kardex.nuevos++; else stats.kardex.omitidos++;
        });
      }
      if (import_correcciones) {
        srcCorrec.forEach(sc => {
          const exist = (db.vales_correccion || []).find(c => c.folio_correccion === sc.folio_correccion);
          if (!exist) stats.correcciones.nuevos++; else stats.correcciones.omitidos++;
        });
      }
      return res.json({ mode: 'preview', stats });
    }

    // ── Modo execute ─────────────────────────────────────────────────────────
    if (!db.items_vales)       db.items_vales = [];
    if (!db.item_adiciones)    db.item_adiciones = [];
    if (!db.tanques_vales)     db.tanques_vales = [];
    if (!db.vales_header)      db.vales_header = [];
    if (!db.vales_detalle)     db.vales_detalle = [];
    if (!db.kardex_vales)      db.kardex_vales = [];
    if (!db.vales_correccion)  db.vales_correccion = [];
    if (!db.inventario_vales)  db.inventario_vales = [];

    // Items
    if (import_items) {
      srcItems.forEach(si => {
        const idx = db.items_vales.findIndex(i => i.item === si.item);
        const mapped = {
          item:            si.item,
          id_proveedor:    si.id_proveedor || '',
          proveedor:       si.proveedor || '',
          codigo:          si.codigo || '',
          presentacion:    si.presentacion || '',
          peso_kg:         si.peso_kg || 0,
          densidad:        si.densidad || 1,
          precio_kg:       si.precio_kg || 0,
          precio_item:     si.precio_item || 0,
          moneda:          si.moneda || 'MXN',
          fecha_cotizacion: si.fecha_cotizacion ? si.fecha_cotizacion.slice(0, 10) : '',
          no_cotizacion:   si.no_cotizacion || '',
          vigencia_dias:   si.vigencia_dias || null,
          vigente:         si.vigente === 1 || si.vigente === true,
          unidad_base:     si.unidad_base || 'kg',
          activo:          si.activo === 1 || si.activo === true,
          updated_at:      new Date().toISOString()
        };
        if (idx === -1) {
          mapped.id = nextId(db.items_vales);
          mapped.created_at = si.created_at || new Date().toISOString();
          db.items_vales.push(mapped);
          stats.items.nuevos++;
        } else {
          const changed = db.items_vales[idx].peso_kg !== mapped.peso_kg ||
                          db.items_vales[idx].densidad !== mapped.densidad ||
                          db.items_vales[idx].precio_kg !== mapped.precio_kg;
          Object.assign(db.items_vales[idx], mapped);
          if (changed) stats.items.actualizados++; else stats.items.sin_cambios++;
        }
      });

      // item_adiciones — después de haber actualizado items para tener los IDs correctos
      srcAdiciones.forEach(sa => {
        const destItem = db.items_vales.find(i => i.item === sa.item);
        if (!destItem) return;
        const exist = db.item_adiciones.find(a => a.item_id === destItem.id && a.tipo_adicion === sa.tipo_adicion);
        if (!exist) {
          db.item_adiciones.push({
            id: nextId(db.item_adiciones),
            item_id: destItem.id,
            tipo_adicion: sa.tipo_adicion,
            activo: sa.activo === 1 || sa.activo === true,
            created_at: sa.created_at || new Date().toISOString()
          });
          stats.adiciones.nuevos++;
        } else {
          stats.adiciones.sin_cambios++;
        }
      });
    }

    // Tanques
    if (import_tanques) {
      srcTanques.forEach(st => {
        const idx = db.tanques_vales.findIndex(t => t.linea === st.linea && t.no_tanque === st.no_tanque);
        const mapped = {
          linea:         st.linea,
          no_tanque:     st.no_tanque,
          nombre_tanque: st.nombre_tanque || '',
          tipo:          st.tipo || '',
          descripcion:   st.descripcion || '',
          item1: st.item1 || '', item2: st.item2 || '', item3: st.item3 || '',
          item4: st.item4 || '', item5: st.item5 || '', item6: st.item6 || '',
          activo: st.activo === 1 || st.activo === true
        };
        if (idx === -1) {
          mapped.id = nextId(db.tanques_vales);
          mapped.created_at = st.created_at || new Date().toISOString();
          db.tanques_vales.push(mapped);
          stats.tanques.nuevos++;
        } else {
          Object.assign(db.tanques_vales[idx], mapped);
          stats.tanques.sin_cambios++;
        }
      });
    }

    // Vales (header + detalle)
    if (import_vales) {
      srcHeaders.forEach(sh => {
        const exist = db.vales_header.find(h => h.folio_vale === sh.folio_vale);
        if (exist) { stats.vales.omitidos++; return; }
        db.vales_header.push({
          id:           nextId(db.vales_header),
          folio_vale:   sh.folio_vale,
          fecha:        sh.fecha ? sh.fecha.slice(0, 10) : '',
          hora:         sh.hora || '',
          turno:        sh.turno || '',
          linea:        sh.linea || '',
          solicita:     sh.solicita || '',
          adiciona:     sh.adiciona || '',
          coordinador:  sh.coordinador || '',
          comentarios:  sh.comentarios || '',
          usuario:      sh.usuario || '',
          created_at:   sh.created_at || new Date().toISOString()
        });
        stats.vales.nuevos++;
        // Detalles de este vale
        srcDetalles.filter(d => d.folio_vale === sh.folio_vale).forEach(sd => {
          db.vales_detalle.push({
            id:             nextId(db.vales_detalle),
            folio_vale:     sd.folio_vale,
            titulacion:     sd.titulacion || '',
            no_tanque:      sd.no_tanque || '',
            nombre_tanque:  sd.nombre_tanque || '',
            item:           sd.item || '',
            tipo_adicion:   sd.tipo_adicion || '',
            cantidad:       sd.cantidad || 0,
            kg_equivalentes: sd.kg_equivalentes || 0,
            created_at:     sd.created_at || new Date().toISOString()
          });
        });
      });
    }

    // Kardex
    if (import_kardex) {
      srcKardex.forEach(sk => {
        const fecha = (sk.fecha || '').slice(0, 10);
        // Usar _sqlite_id como clave exacta si ya fue importado antes;
        // o clave natural ampliada (fecha+ref+item+cantidad+tipo) para registros manuales pre-existentes
        const exist = db.kardex_vales.find(k =>
          k._sqlite_id === sk.id ||
          (k.fecha === fecha && k.referencia === sk.referencia &&
           k.item === sk.item && k.cantidad === sk.cantidad && k.tipo === sk.tipo));
        if (exist) { stats.kardex.omitidos++; return; }
        db.kardex_vales.push({
          id:            nextId(db.kardex_vales),
          _sqlite_id:    sk.id,          // clave de origen para deduplicación exacta
          fecha,
          tipo:          sk.tipo || '',
          referencia:    sk.referencia || '',
          item:          sk.item || '',
          cantidad:      sk.cantidad || 0,
          unidad:        sk.unidad || '',
          kg:            sk.kg || 0,
          linea:         sk.linea || '',
          no_tanque:     sk.no_tanque || '',
          nombre_tanque: sk.nombre_tanque || '',
          comentario:    sk.comentario || '',
          usuario:       sk.usuario || '',
          detalle_id:    sk.detalle_id || null,
          created_at:    sk.created_at || new Date().toISOString()
        });
        stats.kardex.nuevos++;
      });
    }

    // Correcciones
    if (import_correcciones) {
      srcCorrec.forEach(sc => {
        const exist = db.vales_correccion.find(c => c.folio_correccion === sc.folio_correccion);
        if (exist) { stats.correcciones.omitidos++; return; }
        db.vales_correccion.push({
          id:               nextId(db.vales_correccion),
          folio_origen:     sc.folio_origen || '',
          folio_correccion: sc.folio_correccion || '',
          tipo:             sc.tipo || '',
          item:             sc.item || '',
          unidad:           sc.unidad || '',
          cantidad:         sc.cantidad || 0,
          kg:               sc.kg || 0,
          usuario:          sc.usuario || '',
          comentario:       sc.comentario || '',
          created_at:       sc.created_at || new Date().toISOString()
        });
        stats.correcciones.nuevos++;
      });
    }

    // Inventario (sólo si hay datos)
    if (import_items && srcInv.length > 0) {
      srcInv.forEach(si => {
        const idx = db.inventario_vales.findIndex(i => i.item === si.item);
        const mapped = { item: si.item, existencia_kg: si.existencia_kg || 0, ultima_actualizacion: si.ultima_actualizacion || new Date().toISOString() };
        if (idx === -1) { mapped.id = nextId(db.inventario_vales); db.inventario_vales.push(mapped); }
        else Object.assign(db.inventario_vales[idx], mapped);
      });
    }

    writeVales(db);
    return res.json({ mode: 'execute', stats, ok: true });

  } catch (e) {
    try { src.close(); } catch (_) {}
    fs.unlink(tmpPath, () => {});
    return res.status(500).json({ error: 'Error durante importación: ' + e.message });
  }
});

module.exports = router;
