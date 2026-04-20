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
  if (b.nombre_tanque !== undefined)     tanque.nombre_tanque = b.nombre_tanque;
  if (b.tipo !== undefined)              tanque.tipo = b.tipo;
  if (b.items_autorizados !== undefined) tanque.items_autorizados = b.items_autorizados;
  if (b.activo !== undefined)            tanque.activo = b.activo;
  if (b.quimico_activo !== undefined)    tanque.quimico_activo = b.quimico_activo || null;
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
  const itemsCat = db.items_vales   || [];

  const hdrMap = {};
  headers.forEach(h => { hdrMap[h.folio_vale] = h; });
  const itemPrecioMap = {};
  itemsCat.forEach(i => { itemPrecioMap[i.item] = parseFloat(i.precio_kg) || 0; });

  const bounds = getPeriodBounds(tipo, fecha);
  const { ini, fin, prevIni, prevFin, label, prevLabel } = bounds;

  // Aplanar detalles con header
  const rows = detalles.map(d => {
    const h = hdrMap[d.folio_vale] || {};
    const kg = parseFloat(d.kg_equivalentes) || 0;
    const precio_kg = itemPrecioMap[d.item] || 0;
    return {
      folio_vale: d.folio_vale,
      fecha:  h.fecha  || '',
      linea:  h.linea  || '',
      item:   d.item   || '',
      kg,
      dinero: kg * precio_kg,
      precio_kg
    };
  }).filter(r => !filtLinea || r.linea === filtLinea);

  const sumKg     = arr => arr.reduce((s, r) => s + r.kg, 0);
  const sumDinero = arr => arr.reduce((s, r) => s + r.dinero, 0);
  const actual   = rows.filter(r => r.fecha >= ini    && r.fecha <= fin);
  const anterior = rows.filter(r => r.fecha >= prevIni && r.fecha <= prevFin);

  // ── Tendencia (buckets)
  const buckets = generateBuckets(tipo, ini, fin, prevIni);
  const tendencia = buckets.map(b => ({
    label:    b.label,
    actual:   sumKg(actual.filter(r => r.fecha >= b.ini && r.fecha <= b.fin)),
    anterior: sumKg(anterior.filter(r => r.fecha >= b.prevIni && r.fecha <= b.prevFin))
  }));

  // ── Por producto (con dinero)
  const accKgDin = (arr) => {
    const m = {};
    arr.forEach(r => {
      if (!m[r.item]) m[r.item] = { kg: 0, dinero: 0, precio_kg: r.precio_kg };
      m[r.item].kg += r.kg;
      m[r.item].dinero += r.dinero;
    });
    return m;
  };
  const iAct = accKgDin(actual), iAnt = accKgDin(anterior);
  const allItems = [...new Set([...Object.keys(iAct), ...Object.keys(iAnt)])];
  const byProducto = allItems.map(item => {
    const a = iAct[item] || { kg: 0, dinero: 0, precio_kg: 0 };
    const b = iAnt[item] || { kg: 0, dinero: 0, precio_kg: 0 };
    const delta = a.kg - b.kg;
    const pct   = b.kg > 0 ? (delta / b.kg) * 100 : (a.kg > 0 ? 100 : 0);
    return { item, actual: a.kg, anterior: b.kg, delta, pct,
             dinero_actual: a.dinero, dinero_anterior: b.dinero,
             dinero_delta: a.dinero - b.dinero,
             precio_kg: a.precio_kg || b.precio_kg || 0 };
  }).sort((a, b) => b.actual - a.actual);

  // ── Por línea con desglose de productos
  const accLinea = (arr) => {
    const m = {};
    arr.forEach(r => {
      if (!m[r.linea]) m[r.linea] = { kg: 0, dinero: 0, productos: {} };
      m[r.linea].kg += r.kg;
      m[r.linea].dinero += r.dinero;
      if (!m[r.linea].productos[r.item]) m[r.linea].productos[r.item] = { kg: 0, dinero: 0 };
      m[r.linea].productos[r.item].kg += r.kg;
      m[r.linea].productos[r.item].dinero += r.dinero;
    });
    return m;
  };
  const lAct = accLinea(actual), lAnt = accLinea(anterior);
  const allLineas = [...new Set([...Object.keys(lAct), ...Object.keys(lAnt)])];
  const byLinea = allLineas.map(linea => {
    const a = lAct[linea] || { kg: 0, dinero: 0, productos: {} };
    const b = lAnt[linea] || { kg: 0, dinero: 0, productos: {} };
    const allProds = [...new Set([...Object.keys(a.productos), ...Object.keys(b.productos)])];
    const productos = allProds.map(item => ({
      item,
      actual:           (a.productos[item] || { kg: 0 }).kg,
      anterior:         (b.productos[item] || { kg: 0 }).kg,
      dinero_actual:    (a.productos[item] || { dinero: 0 }).dinero,
      dinero_anterior:  (b.productos[item] || { dinero: 0 }).dinero
    })).sort((x, y) => y.actual - x.actual);
    return { linea, actual: a.kg, anterior: b.kg, delta: a.kg - b.kg,
             pct: b.kg > 0 ? ((a.kg - b.kg) / b.kg) * 100 : (a.kg > 0 ? 100 : 0),
             dinero_actual: a.dinero, dinero_anterior: b.dinero,
             dinero_delta: a.dinero - b.dinero,
             productos };
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
      actual:           sumKg(actual),
      anterior:         sumKg(anterior),
      dinero_actual:    sumDinero(actual),
      dinero_anterior:  sumDinero(anterior),
      vales_actual:     new Set(actual.map(r => r.folio_vale)).size,
      vales_anterior:   new Set(anterior.map(r => r.folio_vale)).size
    },
    alertas
  });
});

// ── Reporte para Procesos (admin) ─────────────────────────────────────────────
router.get('/reportes/procesos', valesAllowRoles('admin'), (req, res) => {
  const year = req.query.year ? Number(req.query.year) : new Date().getUTCFullYear();

  const db = readVales();
  const headers  = db.vales_header  || [];
  const detalles = db.vales_detalle || [];
  const tanques  = db.tanques_vales || [];
  const itemsCat = db.items_vales   || [];

  // Lookup maps
  const hdrMap = {};
  headers.forEach(h => { hdrMap[h.folio_vale] = h; });
  const tanqueMap = {}; // "linea|no_tanque" -> tipo
  tanques.forEach(t => { tanqueMap[`${t.linea}|${t.no_tanque}`] = t.tipo || 'Sin tipo'; });
  const precioMap = {};
  itemsCat.forEach(i => { precioMap[i.item] = parseFloat(i.precio_kg) || 0; });

  // ISO week number for a date string
  function dateToISOWeek(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    return { week, month: d.getUTCMonth() + 1 };
  }

  // Flatten and filter by calendar year
  const yStr = String(year);
  const flatRows = [];
  detalles.forEach(det => {
    const h = hdrMap[det.folio_vale] || {};
    if (!h.fecha || !h.fecha.startsWith(yStr)) return;
    const kg = parseFloat(det.kg_equivalentes) || 0;
    if (!kg) return;
    const tipo = tanqueMap[`${h.linea}|${det.no_tanque}`] || 'Sin tipo';
    const precio_kg = precioMap[det.item] || 0;
    const { week, month } = dateToISOWeek(h.fecha);
    flatRows.push({ linea: h.linea || 'Sin línea', tipo, item: det.item || '', kg, dinero: kg * precio_kg, week, month });
  });

  // Unique weeks and months present in data
  const allWeeks  = [...new Set(flatRows.map(r => r.week))].sort((a, b) => a - b);
  const allMonths = [...new Set(flatRows.map(r => r.month))].sort((a, b) => a - b);

  // Build nested accumulator: linea → tipo → item → {weeks, months}
  const lineaMap = {};
  flatRows.forEach(r => {
    if (!lineaMap[r.linea]) lineaMap[r.linea] = {};
    if (!lineaMap[r.linea][r.tipo]) lineaMap[r.linea][r.tipo] = {};
    if (!lineaMap[r.linea][r.tipo][r.item]) lineaMap[r.linea][r.tipo][r.item] = { weeks: {}, months: {} };
    const cell = lineaMap[r.linea][r.tipo][r.item];
    if (!cell.weeks[r.week])   cell.weeks[r.week]   = { kg: 0, mxn: 0 };
    if (!cell.months[r.month]) cell.months[r.month] = { kg: 0, mxn: 0 };
    cell.weeks[r.week].kg    += r.kg;   cell.weeks[r.week].mxn   += r.dinero;
    cell.months[r.month].kg  += r.kg;   cell.months[r.month].mxn += r.dinero;
  });

  // Sort lineas: numbers first in order, then baker last
  const sortLineas = (keys) => keys.sort((a, b) => {
    const isBakerA = /baker/i.test(a), isBakerB = /baker/i.test(b);
    if (isBakerA && !isBakerB) return 1;
    if (!isBakerA && isBakerB) return -1;
    const numA = parseInt(a.match(/\d+/)?.[0] ?? '999');
    const numB = parseInt(b.match(/\d+/)?.[0] ?? '999');
    return numA !== numB ? numA - numB : a.localeCompare(b);
  });

  const lineas = sortLineas(Object.keys(lineaMap)).map(linea => {
    const tipoObj = lineaMap[linea];
    const tipos = Object.keys(tipoObj).sort().map(tipo => {
      const itemObj = tipoObj[tipo];
      const items = Object.keys(itemObj).sort().map(item => {
        const d = itemObj[item];
        const totalKg  = Object.values(d.weeks).reduce((s, c) => s + c.kg, 0);
        const totalMxn = Object.values(d.weeks).reduce((s, c) => s + c.mxn, 0);
        return { item, weeks: d.weeks, months: d.months, total: { kg: totalKg, mxn: totalMxn } };
      }).sort((a, b) => b.total.kg - a.total.kg);

      // Subtotals por tipo
      const tipoWeeks = {}, tipoMonths = {};
      items.forEach(it => {
        Object.entries(it.weeks).forEach(([w, c]) => {
          if (!tipoWeeks[w])  tipoWeeks[w]  = { kg: 0, mxn: 0 };
          tipoWeeks[w].kg  += c.kg; tipoWeeks[w].mxn  += c.mxn;
        });
        Object.entries(it.months).forEach(([m, c]) => {
          if (!tipoMonths[m]) tipoMonths[m] = { kg: 0, mxn: 0 };
          tipoMonths[m].kg += c.kg; tipoMonths[m].mxn += c.mxn;
        });
      });
      const tipoTotal = { kg: items.reduce((s, i) => s + i.total.kg, 0), mxn: items.reduce((s, i) => s + i.total.mxn, 0) };
      return { tipo, items, weeks: tipoWeeks, months: tipoMonths, total: tipoTotal };
    }).sort((a, b) => b.total.kg - a.total.kg);

    // Totals por línea
    const lineaWeeks = {}, lineaMonths = {};
    tipos.forEach(t => {
      Object.entries(t.weeks).forEach(([w, c]) => {
        if (!lineaWeeks[w])  lineaWeeks[w]  = { kg: 0, mxn: 0 };
        lineaWeeks[w].kg  += c.kg; lineaWeeks[w].mxn  += c.mxn;
      });
      Object.entries(t.months).forEach(([m, c]) => {
        if (!lineaMonths[m]) lineaMonths[m] = { kg: 0, mxn: 0 };
        lineaMonths[m].kg += c.kg; lineaMonths[m].mxn += c.mxn;
      });
    });
    const lineaTotal = { kg: tipos.reduce((s, t) => s + t.total.kg, 0), mxn: tipos.reduce((s, t) => s + t.total.mxn, 0) };
    return { linea, tipos, weeks: lineaWeeks, months: lineaMonths, total: lineaTotal };
  });

  res.json({ year, weeks: allWeeks, months: allMonths, lineas });
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

// ── TITULACIONES: helpers ─────────────────────────────────────────────────────
function calcEstadoParam(valor, param) {
  const v = parseFloat(valor);
  if (isNaN(v)) return 'sin_dato';
  if (param.tipo_rango === 'maximo') {
    return v > parseFloat(param.valor_max) ? 'fuera' : 'ok';
  }
  if (param.tipo_rango === 'minimo') {
    return v < parseFloat(param.valor_min) ? 'fuera' : 'ok';
  }
  if (param.tipo_rango === 'entre') {
    if (v < parseFloat(param.valor_min) || v > parseFloat(param.valor_max)) return 'fuera';
    // Límite: dentro del 5% del objetivo, o dentro de un margen de los extremos
    if (param.objetivo != null) {
      const obj = parseFloat(param.objetivo);
      const rango = parseFloat(param.valor_max) - parseFloat(param.valor_min);
      if (Math.abs(v - obj) > rango * 0.35) return 'limite';
    }
    return 'ok';
  }
  return 'ok'; // tipo ninguno
}

function seedParametrosTitulacion(db) {
  if ((db.parametros_titulacion || []).length > 0) return;
  db.parametros_titulacion = db.parametros_titulacion || [];
  const tanques = db.tanques_vales || [];
  const findT = (linea, no) => tanques.find(t => t.linea === linea && t.no_tanque === no);

  let id = 1;
  let _currentLinea = '';
  function p(tanque_id, no_tanque, nombre_tanque, nombre_parametro, tipo_rango, valor_min, valor_max, objetivo, unidad, frecuencia, activo, quimico, orden) {
    db.parametros_titulacion.push({ id: id++, linea: _currentLinea, tanque_id, no_tanque, nombre_tanque, nombre_parametro, quimico: quimico || null, tipo_rango, valor_min: valor_min != null ? parseFloat(valor_min) : null, valor_max: valor_max != null ? parseFloat(valor_max) : null, objetivo: objetivo != null ? parseFloat(objetivo) : null, unidad: unidad || '', frecuencia: frecuencia || 2, activo: activo !== false, orden: orden || 0 });
  }

  // ── LINEA 1 ──
  _currentLinea = 'LINEA 1';
  const L1 = (no) => { const t = findT('LINEA 1', no); return t ? { id: t.id, no: t.no_tanque, nom: t.nombre_tanque } : { id: null, no, nom: no }; };
  // Adhesivo 1753 (T2)
  let tk = L1('T2: ADEHESIVO 1753'); p(tk.id,tk.no,tk.nom, '% Sólidos', 'entre', 5.2, 5.55, null, '%', 1, true, null, 1);
  // Desengrase 1 (T8)
  tk = L1('T8: DESENGRASE 1'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 5, 10, 7, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 61, 71, null, '°C', 2, true, null, 2);
  // Desengrase 2 (T9)
  tk = L1('T9: DESENGRASE 2'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 5, 10, 7, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 61, 71, null, '°C', 2, true, null, 2);
  // Desengrase 3 (T10 — activo=false, se activa si la línea lo usa)
  tk = L1('T10: 1ER ENJUAGUE DESENGRASE'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 5, 10, 7, 'pts', 2, false, null, 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 61, 71, null, '°C', 2, false, null, 2);
  // Piclado (T12)
  tk = L1('T12: PICLADO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 4, 8, 6, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 10, null, 'ppm', 2, true, null, 2);
  // Fosfato Micro (T14 = AMSTED / T15 = SKF)
  tk = L1('T14: FOSFATO MACRO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 23, 33, 28, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 3, 5.5, null, 'pts', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 9.5, null, 'ppm', 2, true, null, 3);
  p(tk.id,tk.no,tk.nom, 'RA', 'entre', 5.5, 6.5, 5.5, 'pts', 2, true, null, 4);
  p(tk.id,tk.no,tk.nom, 'Peso Fosfato', 'ninguno', null, null, null, 'g/m²', 2, true, null, 5);

  tk = L1('T15: FOSFATO MICRO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 38, 48, 42, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 5, 10, null, 'pts', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 18, null, 'ppm', 2, true, null, 3);
  p(tk.id,tk.no,tk.nom, 'RA', 'entre', 4, 10, 5.5, 'pts', 2, true, null, 4);
  p(tk.id,tk.no,tk.nom, 'CA', 'entre', 15, 40, 27, 'pts', 2, true, null, 5);
  // Sello (T18)
  tk = L1('T18: SELLO'); p(tk.id,tk.no,tk.nom, 'Concentración', 'entre', 3, 4, 3, 'g/L', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'pH', 'ninguno', null, null, null, '', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'PPMs', 'ninguno', null, null, null, 'ppm', 2, true, null, 3);

  // ── LINEA 3 ──
  _currentLinea = 'LINEA 3';
  const L3 = (no) => { const t = findT('LINEA 3', no); return t ? { id: t.id, no: t.no_tanque, nom: t.nombre_tanque } : { id: null, no, nom: no }; };
  // Sello (T3)
  tk = L3('T3: SELLO'); p(tk.id,tk.no,tk.nom, 'Concentración', 'entre', 2, 4, 3, 'g/L', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'pH', 'ninguno', null, null, null, '', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'PPMs', 'maximo', null, 500, null, 'ppm', 2, true, null, 3);
  // Desengrase 1 (T6) — soporta 907 y 1207
  tk = L3('T6: DESENGRASE 1');
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 12, 22, 16, 'pts', 2, true, '907', 1);
  p(tk.id,tk.no,tk.nom, 'pH', 'entre', 11, 13, null, '', 2, true, '907', 2);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 60, 70, 68, '°C', 2, true, '907', 3);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 8, 18, 13, 'pts', 2, false, '1207', 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 60, 70, 65, '°C', 2, false, '1207', 2);
  // Desengrase 2 (T7)
  tk = L3('T7: DESENGRASE 2');
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 12, 22, 16, 'pts', 2, true, '907', 1);
  p(tk.id,tk.no,tk.nom, 'pH', 'entre', 11, 13, null, '', 2, true, '907', 2);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 60, 70, 68, '°C', 2, true, '907', 3);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 8, 18, 13, 'pts', 2, false, '1207', 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 60, 70, 65, '°C', 2, false, '1207', 2);
  // Desengrase 3 (T8)
  tk = L3('T8: DESENGRASE 3');
  p(tk.id,tk.no,tk.nom, 'AT', 'entre', 12, 22, 16, 'pts', 2, true, '907', 1);
  p(tk.id,tk.no,tk.nom, 'pH', 'entre', 11, 13, null, '', 2, true, '907', 2);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 61, 71, 68, '°C', 2, true, '907', 3);
  // Piclado (T11)
  tk = L3('T11: PICLADO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 4, 8, null, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 10, null, 'ppm', 2, true, null, 2);
  // Fosfato Micro 1 (T14)
  tk = L3('T14: MICRO 1'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 23, 33, 28, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 3, 5.5, null, 'pts', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 9.5, null, 'ppm', 2, true, null, 3);
  p(tk.id,tk.no,tk.nom, 'RA', 'entre', 5.5, 6.5, 5.5, 'pts', 2, true, null, 4);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 80, 90, null, '°C', 2, true, null, 5);
  p(tk.id,tk.no,tk.nom, 'Peso Fosfato', 'ninguno', null, null, null, 'g/m²', 2, true, null, 6);
  // Fosfato Micro 2 (T16)
  tk = L3('T16: MICRO 2'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 23, 33, 23, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 3, 5.5, null, 'pts', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 9.5, null, 'ppm', 2, true, null, 3);
  p(tk.id,tk.no,tk.nom, 'RA', 'entre', 5.5, 6.5, null, 'pts', 2, true, null, 4);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 75, 85, null, '°C', 2, true, null, 5);
  p(tk.id,tk.no,tk.nom, 'Peso Fosfato', 'ninguno', null, null, null, 'g/m²', 2, true, null, 6);

  // ── LINEA 4 ──
  _currentLinea = 'LINEA 4';
  const L4 = (no) => { const t = findT('LINEA 4', no); return t ? { id: t.id, no: t.no_tanque, nom: t.nombre_tanque } : { id: null, no, nom: no }; };
  // Sello (T2)
  tk = L4('T2: SELLO'); p(tk.id,tk.no,tk.nom, 'Concentración', 'entre', 2, 4, 3, 'g/L', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'pH', 'ninguno', null, null, null, '', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'PPMs', 'ninguno', null, null, null, 'ppm', 2, true, null, 3);
  // Desengrase 1 (T4)
  tk = L4('T4: DESENGRASE 1'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 12, 22, 16, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 60, 70, 65, '°C', 2, true, null, 2);
  // Desengrase 2 (T5)
  tk = L4('T5: DESENGRASE 2'); p(tk.id,tk.no,tk.nom, 'AL', 'entre', 8, 18, 13, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 60, 70, 65, '°C', 2, true, null, 2);
  // Piclado (T7)
  tk = L4('T7: PICLADO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 3, 8, 6, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 10, null, 'ppm', 2, true, null, 2);
  // Sales/Refinador (T9)
  tk = L4('T9: SALES'); p(tk.id,tk.no,tk.nom, 'pH', 'entre', 8, 10.5, 10, '', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'PPMs', 'ninguno', null, null, null, 'ppm', 2, true, null, 2);
  // Fosfato Manganeso (T10)
  tk = L4('T10: FOSFATO MANGANESO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 100, 135, 120, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 10, 22, 15, 'pts', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 20, null, 'ppm', 2, true, null, 3);
  p(tk.id,tk.no,tk.nom, 'RA', 'entre', 5, 10, 7, 'pts', 2, true, null, 4);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 80, 90, 85, '°C', 2, true, null, 5);
  p(tk.id,tk.no,tk.nom, 'Peso Fosfato', 'ninguno', null, null, null, 'g/m²', 2, true, null, 6);

  // ── BAKER ──
  _currentLinea = 'BAKER';
  const BK = (no) => { const t = findT('BAKER', no); return t ? { id: t.id, no: t.no_tanque, nom: t.nombre_tanque } : { id: null, no, nom: no }; };
  // Adhesivo (T02)
  tk = BK('T02: ADH 1753'); p(tk.id,tk.no,tk.nom, '% Sólidos', 'entre', 5.2, 5.55, null, '%', 1, true, null, 1);
  // Sello (T04)
  tk = BK('T04: SELLO'); p(tk.id,tk.no,tk.nom, 'Concentración', 'entre', 2, 4, 3, 'g/L', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'pH', 'ninguno', null, null, null, '', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'PPMs', 'maximo', null, 500, null, 'ppm', 2, true, null, 3);
  // Desengrase 1 (T07)
  tk = BK('T07: D1');
  p(tk.id,tk.no,tk.nom, 'AT', 'entre', 10, 12, 11, 'pts', 2, true, '1207', 1);
  // Desengrase 2 (T10)
  tk = BK('T10: D2');
  p(tk.id,tk.no,tk.nom, 'AT', 'entre', 10, 12, 11, 'pts', 2, true, '1207', 1);
  // Stripper (T08)
  tk = BK('T08: STRP'); p(tk.id,tk.no,tk.nom, 'AL', 'entre', 10, 13, 11.5, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'ninguno', null, null, null, '°C', 2, true, null, 2);
  // Piclado (T13)
  tk = BK('T13: PICLADO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 12, 18, null, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 6, null, 'ppm', 2, true, null, 2);
  // Fosfato Macro (T16)
  tk = BK('T16: MACRO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 28, 38, 32, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 4, 8, 5.5, 'pts', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 18, null, 'ppm', 2, true, null, 3);
  p(tk.id,tk.no,tk.nom, 'RA', 'entre', 4, 10, 5, 'pts', 2, true, null, 4);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 80, 90, null, '°C', 2, true, null, 5);
  p(tk.id,tk.no,tk.nom, 'Peso Fosfato', 'ninguno', null, null, null, 'g/m²', 2, true, null, 6);
  // Fosfato Micro (T18)
  tk = BK('T18: MICRO'); p(tk.id,tk.no,tk.nom, 'AT', 'entre', 38, 48, 42, 'pts', 2, true, null, 1);
  p(tk.id,tk.no,tk.nom, 'AL', 'entre', 5, 10, null, 'pts', 2, true, null, 2);
  p(tk.id,tk.no,tk.nom, 'Fe', 'maximo', null, 18, null, 'ppm', 2, true, null, 3);
  p(tk.id,tk.no,tk.nom, 'RA', 'entre', 4, 10, null, 'pts', 2, true, null, 4);
  p(tk.id,tk.no,tk.nom, 'CA', 'entre', 15, 40, 27, 'pts', 2, true, null, 5);
  p(tk.id,tk.no,tk.nom, 'Temperatura', 'entre', 75, 85, null, '°C', 2, true, null, 6);
  p(tk.id,tk.no,tk.nom, 'Peso Fosfato', 'ninguno', null, null, null, 'g/m²', 2, true, null, 7);
}

// ── PARÁMETROS TITULACIÓN ─────────────────────────────────────────────────────
router.get('/parametros-titulacion', (req, res) => {
  const db = readVales();
  seedParametrosTitulacion(db);
  let params = db.parametros_titulacion || [];
  if (req.query.linea) params = params.filter(p => p.no_tanque && (db.tanques_vales || []).find(t => t.id === p.tanque_id)?.linea === req.query.linea);
  if (req.query.tanque_id) params = params.filter(p => p.tanque_id === Number(req.query.tanque_id));
  if (req.query.activo !== undefined) { const a = req.query.activo === 'true'; params = params.filter(p => p.activo === a); }
  res.json(params);
});

router.post('/parametros-titulacion', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  seedParametrosTitulacion(db);
  const b = req.body;
  if (!b.tanque_id || !b.nombre_parametro) return res.status(400).json({ error: 'tanque_id y nombre_parametro requeridos' });
  const tanque = (db.tanques_vales || []).find(t => t.id === Number(b.tanque_id));
  if (!tanque) return res.status(404).json({ error: 'Tanque no encontrado' });
  const row = {
    id: nextId(db.parametros_titulacion),
    tanque_id: tanque.id,
    no_tanque: tanque.no_tanque,
    nombre_tanque: tanque.nombre_tanque,
    nombre_parametro: b.nombre_parametro,
    quimico: b.quimico || null,
    tipo_rango: b.tipo_rango || 'ninguno',
    valor_min: b.valor_min != null ? parseFloat(b.valor_min) : null,
    valor_max: b.valor_max != null ? parseFloat(b.valor_max) : null,
    objetivo: b.objetivo != null ? parseFloat(b.objetivo) : null,
    unidad: b.unidad || '',
    frecuencia: Number(b.frecuencia) || 2,
    activo: b.activo !== false,
    orden: Number(b.orden) || 0
  };
  db.parametros_titulacion.push(row);
  writeVales(db);
  res.status(201).json(row);
});

router.patch('/parametros-titulacion/:id', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  const param = (db.parametros_titulacion || []).find(p => p.id === Number(req.params.id));
  if (!param) return res.status(404).json({ error: 'Parámetro no encontrado' });
  const b = req.body;
  const fields = ['nombre_parametro','quimico','tipo_rango','valor_min','valor_max','objetivo','unidad','frecuencia','activo','orden'];
  fields.forEach(f => { if (b[f] !== undefined) param[f] = ['valor_min','valor_max','objetivo'].includes(f) ? (b[f] != null ? parseFloat(b[f]) : null) : ['frecuencia','orden'].includes(f) ? Number(b[f]) : b[f]; });
  writeVales(db);
  res.json(param);
});

// Seed manual (admin) — re-genera el catálogo desde cero si está vacío, o fuerza reset
router.post('/parametros-titulacion/seed', valesAllowRoles('admin'), (req, res) => {
  const db = readVales();
  if (req.body.reset) db.parametros_titulacion = [];
  seedParametrosTitulacion(db);
  writeVales(db);
  res.json({ ok: true, total: (db.parametros_titulacion || []).length });
});

// ── TITULACIONES ──────────────────────────────────────────────────────────────
router.get('/titulaciones', (req, res) => {
  const db = readVales();
  let headers = db.titulaciones_header || [];
  if (req.query.linea)      headers = headers.filter(h => h.linea === req.query.linea);
  if (req.query.fecha_ini)  headers = headers.filter(h => h.fecha >= req.query.fecha_ini);
  if (req.query.fecha_fin)  headers = headers.filter(h => h.fecha <= req.query.fecha_fin);
  if (req.query.turno)      headers = headers.filter(h => String(h.turno) === req.query.turno);
  if (req.query.estado)     headers = headers.filter(h => h.estado === req.query.estado);
  const detalles = db.titulaciones_detalle || [];
  const params   = db.parametros_titulacion || [];
  const result = [...headers].reverse().map(h => ({
    ...h,
    detalle: detalles.filter(d => d.header_id === h.id).map(d => ({
      ...d,
      param: params.find(p => p.id === d.parametro_id) || null
    }))
  }));
  res.json(result);
});

router.get('/titulaciones/:id', (req, res) => {
  const db = readVales();
  const header = (db.titulaciones_header || []).find(h => h.id === Number(req.params.id));
  if (!header) return res.status(404).json({ error: 'Titulación no encontrada' });
  const detalles = (db.titulaciones_detalle || []).filter(d => d.header_id === header.id);
  const params = db.parametros_titulacion || [];
  res.json({ ...header, detalle: detalles.map(d => ({ ...d, param: params.find(p => p.id === d.parametro_id) || null })) });
});

router.post('/titulaciones', valesAllowRoles('admin', 'operador'), (req, res) => {
  const db = readVales();
  seedParametrosTitulacion(db);
  const b = req.body;
  if (!b.linea || !b.fecha || !b.turno || !b.numero_titulacion) {
    return res.status(400).json({ error: 'linea, fecha, turno y numero_titulacion requeridos' });
  }
  const clave = `${b.turno}.${b.numero_titulacion}`;
  // Evitar duplicados
  const existing = (db.titulaciones_header || []).find(h =>
    h.linea === b.linea && h.fecha === b.fecha &&
    h.turno === Number(b.turno) && h.numero_titulacion === Number(b.numero_titulacion));
  if (existing) return res.status(409).json({ error: 'Ya existe esta titulación', id: existing.id });

  const now = new Date();
  const tanques = db.tanques_vales || [];
  // Snapshot de químicos activos en este momento
  const quimico_snapshot = {};
  tanques.filter(t => t.linea === b.linea && t.quimico_activo).forEach(t => {
    quimico_snapshot[t.id] = t.quimico_activo;
  });

  db.titulaciones_header = db.titulaciones_header || [];
  db.titulaciones_detalle = db.titulaciones_detalle || [];
  const header = {
    id: nextId(db.titulaciones_header),
    linea: b.linea,
    fecha: b.fecha,
    turno: Number(b.turno),
    numero_titulacion: Number(b.numero_titulacion),
    clave_titulacion: clave,
    analista: req.valesUser.full_name,
    semana: b.semana || null,
    año: b.año || null,
    estado: 'pendiente',
    quimico_snapshot,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  db.titulaciones_header.push(header);

  // Insertar detalles
  const params = (db.parametros_titulacion || []).filter(p => {
    const tanque = tanques.find(t => t.id === p.tanque_id);
    if (!tanque || tanque.linea !== b.linea) return false;
    if (!p.activo) return false;
    // Filtro por químico
    if (p.quimico) {
      const quActivo = quimico_snapshot[p.tanque_id] || tanque.quimico_activo;
      if (quActivo && quActivo !== p.quimico) return false;
    }
    // Parámetros frecuencia=1 solo en numero_titulacion=1
    if (p.frecuencia === 1 && Number(b.numero_titulacion) !== 1) return false;
    return true;
  });

  const valores = b.valores || {};
  let hayFuera = false;
  params.forEach(p => {
    const valor = valores[p.id] != null ? parseFloat(valores[p.id]) : null;
    const estado_param = valor != null ? calcEstadoParam(valor, p) : 'sin_dato';
    if (estado_param === 'fuera') hayFuera = true;
    db.titulaciones_detalle.push({
      id: nextId(db.titulaciones_detalle),
      header_id: header.id,
      parametro_id: p.id,
      valor_registrado: valor,
      estado_param,
      corregido: false,
      valor_corregido: null,
      valor_original: null,
      observaciones: (b.observaciones || {})[p.id] || ''
    });
  });

  // Calcular estado del header
  const detalles = db.titulaciones_detalle.filter(d => d.header_id === header.id);
  const todosSinDato = detalles.every(d => d.estado_param === 'sin_dato');
  header.estado = todosSinDato ? 'pendiente' : hayFuera ? 'fuera_de_rango' : 'completo';

  writeVales(db);
  res.status(201).json({ ...header, detalle: detalles.map(d => ({ ...d, param: params.find(p => p.id === d.parametro_id) || null })) });
});

// Corrección / actualización de titulación
router.patch('/titulaciones/:id', valesAllowRoles('admin', 'operador'), (req, res) => {
  const db = readVales();
  const header = (db.titulaciones_header || []).find(h => h.id === Number(req.params.id));
  if (!header) return res.status(404).json({ error: 'Titulación no encontrada' });
  const b = req.body;
  const now = new Date();

  if (b.valores) {
    const detalles = (db.titulaciones_detalle || []).filter(d => d.header_id === header.id);
    const params = db.parametros_titulacion || [];
    let hayFuera = false;
    detalles.forEach(d => {
      if (b.valores[d.parametro_id] == null) return;
      const nuevoValor = parseFloat(b.valores[d.parametro_id]);
      const param = params.find(p => p.id === d.parametro_id);
      const nuevoEstado = param ? calcEstadoParam(nuevoValor, param) : 'sin_dato';
      if (nuevoEstado === 'fuera') hayFuera = true;
      if (d.valor_registrado !== null && !d.corregido) d.valor_original = d.valor_registrado;
      d.valor_corregido = nuevoValor;
      d.valor_registrado = nuevoValor;
      d.estado_param = nuevoEstado;
      d.corregido = true;
      if ((b.observaciones || {})[d.parametro_id]) d.observaciones = b.observaciones[d.parametro_id];
    });
    header.estado = hayFuera ? 'fuera_de_rango' : 'corregido';
  }
  if (b.analista !== undefined) header.analista = b.analista;
  header.updated_at = now.toISOString();
  header.updated_by = req.valesUser.full_name;
  writeVales(db);
  const detalles = (db.titulaciones_detalle || []).filter(d => d.header_id === header.id);
  res.json({ ...header, detalle: detalles });
});

// Estadísticas para SPC
router.get('/titulaciones/estadisticas/valores', (req, res) => {
  const db = readVales();
  const { parametro_id, fecha_ini, fecha_fin } = req.query;
  if (!parametro_id) return res.status(400).json({ error: 'parametro_id requerido' });
  const param = (db.parametros_titulacion || []).find(p => p.id === Number(parametro_id));
  if (!param) return res.status(404).json({ error: 'Parámetro no encontrado' });

  let headers = db.titulaciones_header || [];
  if (fecha_ini) headers = headers.filter(h => h.fecha >= fecha_ini);
  if (fecha_fin) headers = headers.filter(h => h.fecha <= fecha_fin);

  const headerIds = new Set(headers.map(h => h.id));
  const detalles = (db.titulaciones_detalle || []).filter(d =>
    d.parametro_id === Number(parametro_id) && headerIds.has(d.header_id) && d.valor_registrado != null
  );
  const result = detalles.map(d => {
    const h = headers.find(x => x.id === d.header_id);
    return { fecha: h?.fecha, clave: h?.clave_titulacion, turno: h?.turno, valor: d.valor_registrado, estado: d.estado_param };
  }).sort((a, b) => a.fecha?.localeCompare(b.fecha) || 0);

  res.json({ param, valores: result });
});

// ── POST /admin/import-historial ─────────────────────────────────────────────
// Importa el seed de titulaciones 2026 (params + headers + detalles) al DB.
// Solo se ejecuta si los arrays están vacíos, para evitar duplicados.
router.post('/admin/import-historial', valesAuthRequired, valesAllowRoles('admin'), async (req, res) => {
  try {
    const db    = readVales();
    const force = req.body?.force === true;
    const yaHeaders = (db.titulaciones_header || []).length;

    if (yaHeaders > 0 && !force) {
      return res.json({
        ok: false,
        mensaje: `Ya existe historial (${yaHeaders} titulaciones). Usa force:true para sobreescribir.`,
        parametros: (db.parametros_titulacion || []).length,
        headers: yaHeaders,
        detalles: (db.titulaciones_detalle || []).length
      });
    }

    // ── Flujo A: datos cargados desde Excel en el navegador ───────────────────
    if (req.body?.headers && req.body?.detalles) {
      // El frontend ya hizo el mapeo con param IDs reales del servidor
      // Solo actualizamos headers y detalles; los parámetros ya están en DB
      db.titulaciones_header  = req.body.headers;
      db.titulaciones_detalle = req.body.detalles;
      writeVales(db);
      console.log('[import-historial] Excel directo — headers:', db.titulaciones_header.length,
        'detalles:', db.titulaciones_detalle.length);
      return res.json({
        ok: true,
        mensaje: `Historial importado desde Excel (${req.body.headers.length} titulaciones).`,
        parametros: (db.parametros_titulacion || []).length,
        headers: db.titulaciones_header.length,
        detalles: db.titulaciones_detalle.length
      });
    }

    // ── Flujo B: seed preconstruido (botón clásico) ───────────────────────────
    const nodePath = require('path');
    const nodeFs   = require('fs');
    const seedPath = nodePath.resolve(__dirname, '../data/tit_2026_seed.json');
    if (!nodeFs.existsSync(seedPath)) {
      return res.status(404).json({ error: 'Archivo seed no encontrado en servidor.' });
    }
    let seed;
    try { seed = JSON.parse(nodeFs.readFileSync(seedPath, 'utf8')); }
    catch (e) { return res.status(500).json({ error: 'Error leyendo seed: ' + e.message }); }

    // Generar parámetros con tanque_ids reales de producción
    db.parametros_titulacion = [];
    seedParametrosTitulacion(db);

    // Mapear seedParamId → prodParamId por firma
    const firmaParam = (p, tanques) => {
      const t = tanques.find(x => x.id === p.tanque_id);
      return `${t?.linea}|${t?.no_tanque}|${p.nombre_parametro}|${p.quimico||''}|${p.orden||0}`;
    };
    const seedTanques = db.tanques_vales || [];
    const firmasProd = {};
    db.parametros_titulacion.forEach(p => { firmasProd[firmaParam(p, seedTanques)] = p.id; });
    const paramIdMap = {};
    (seed.parametros_titulacion || []).forEach(sp => {
      const firma = firmaParam(sp, seedTanques);
      if (firmasProd[firma]) paramIdMap[sp.id] = firmasProd[firma];
    });

    db.titulaciones_header  = seed.titulaciones_header || [];
    db.titulaciones_detalle = (seed.titulaciones_detalle || []).map(d => ({
      ...d, parametro_id: paramIdMap[d.parametro_id] ?? d.parametro_id
    }));
    writeVales(db);

    console.log('[import-historial] Seed — params:', db.parametros_titulacion.length,
      'headers:', db.titulaciones_header.length);
    res.json({
      ok: true,
      mensaje: 'Historial 2026 importado correctamente.',
      parametros: db.parametros_titulacion.length,
      headers: db.titulaciones_header.length,
      detalles: db.titulaciones_detalle.length
    });
  } catch (err) {
    console.error('[import-historial] Error inesperado:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/import-excel — recibe el .xlsx y lo procesa en el servidor ────
const multer  = require('multer');
const _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const IMPORT_EXACT_COLS = {
  'LINEA 1': [
    { no:'T2: ADEHESIVO 1753',     nom:'% Sólidos',    qui:null,   col:3  },
    { no:'T18: SELLO',             nom:'Concentración', qui:null,   col:4  },
    { no:'T18: SELLO',             nom:'pH',            qui:null,   col:5  },
    { no:'T18: SELLO',             nom:'PPMs',          qui:null,   col:6  },
    { no:'T8: DESENGRASE 1',       nom:'AT',            qui:null,   col:10 },
    { no:'T8: DESENGRASE 1',       nom:'Temperatura',   qui:null,   col:13 },
    { no:'T9: DESENGRASE 2',       nom:'AT',            qui:null,   col:14 },
    { no:'T9: DESENGRASE 2',       nom:'Temperatura',   qui:null,   col:15 },
    { no:'T12: PICLADO',           nom:'AT',            qui:null,   col:30 },
    { no:'T12: PICLADO',           nom:'Fe',            qui:null,   col:31 },
    { no:'T14: FOSFATO MACRO',     nom:'AT',            qui:null,   col:39 },
    { no:'T14: FOSFATO MACRO',     nom:'AL',            qui:null,   col:40 },
    { no:'T14: FOSFATO MACRO',     nom:'Fe',            qui:null,   col:41 },
    { no:'T14: FOSFATO MACRO',     nom:'Peso Fosfato',  qui:null,   col:42 },
    { no:'T14: FOSFATO MACRO',     nom:'RA',            qui:null,   col:43 },
    { no:'T15: FOSFATO MICRO',     nom:'AT',            qui:null,   col:48 },
    { no:'T15: FOSFATO MICRO',     nom:'AL',            qui:null,   col:49 },
    { no:'T15: FOSFATO MICRO',     nom:'Fe',            qui:null,   col:50 },
    { no:'T15: FOSFATO MICRO',     nom:'CA',            qui:null,   col:51 },
    { no:'T15: FOSFATO MICRO',     nom:'Peso Fosfato',  qui:null,   col:52 },
    { no:'T15: FOSFATO MICRO',     nom:'RA',            qui:null,   col:53 },
  ],
  'LINEA 3': [
    { no:'T3: SELLO',              nom:'Concentración', qui:null,   col:6  },
    { no:'T3: SELLO',              nom:'pH',            qui:null,   col:7  },
    { no:'T3: SELLO',              nom:'PPMs',          qui:null,   col:8  },
    { no:'T6: DESENGRASE 1',       nom:'AL',            qui:'907',  col:11 },
    { no:'T6: DESENGRASE 1',       nom:'pH',            qui:'907',  col:12 },
    { no:'T6: DESENGRASE 1',       nom:'Temperatura',   qui:'907',  col:13 },
    { no:'T6: DESENGRASE 1',       nom:'AL',            qui:'1207', col:11 },
    { no:'T6: DESENGRASE 1',       nom:'Temperatura',   qui:'1207', col:13 },
    { no:'T7: DESENGRASE 2',       nom:'AL',            qui:'907',  col:15 },
    { no:'T7: DESENGRASE 2',       nom:'pH',            qui:'907',  col:16 },
    { no:'T7: DESENGRASE 2',       nom:'Temperatura',   qui:'907',  col:18 },
    { no:'T7: DESENGRASE 2',       nom:'AL',            qui:'1207', col:15 },
    { no:'T7: DESENGRASE 2',       nom:'Temperatura',   qui:'1207', col:18 },
    { no:'T8: DESENGRASE 3',       nom:'AT',            qui:'907',  col:19 },
    { no:'T8: DESENGRASE 3',       nom:'pH',            qui:'907',  col:20 },
    { no:'T8: DESENGRASE 3',       nom:'Temperatura',   qui:'907',  col:22 },
    { no:'T11: PICLADO',           nom:'AT',            qui:null,   col:27 },
    { no:'T11: PICLADO',           nom:'Fe',            qui:null,   col:28 },
    { no:'T14: MICRO 1',           nom:'AT',            qui:null,   col:33 },
    { no:'T14: MICRO 1',           nom:'AL',            qui:null,   col:34 },
    { no:'T14: MICRO 1',           nom:'RA',            qui:null,   col:35 },
    { no:'T14: MICRO 1',           nom:'Fe',            qui:null,   col:36 },
    { no:'T14: MICRO 1',           nom:'Peso Fosfato',  qui:null,   col:37 },
    { no:'T14: MICRO 1',           nom:'Temperatura',   qui:null,   col:39 },
    { no:'T16: MICRO 2',           nom:'AT',            qui:null,   col:42 },
    { no:'T16: MICRO 2',           nom:'AL',            qui:null,   col:43 },
    { no:'T16: MICRO 2',           nom:'RA',            qui:null,   col:44 },
    { no:'T16: MICRO 2',           nom:'Fe',            qui:null,   col:45 },
    { no:'T16: MICRO 2',           nom:'Peso Fosfato',  qui:null,   col:46 },
    { no:'T16: MICRO 2',           nom:'Temperatura',   qui:null,   col:48 },
  ],
  'LINEA 4': [
    { no:'T2: SELLO',              nom:'Concentración', qui:null,   col:3  },
    { no:'T2: SELLO',              nom:'pH',            qui:null,   col:4  },
    { no:'T2: SELLO',              nom:'PPMs',          qui:null,   col:5  },
    { no:'T4: DESENGRASE 1',       nom:'AT',            qui:null,   col:9  },
    { no:'T4: DESENGRASE 1',       nom:'Temperatura',   qui:null,   col:12 },
    { no:'T5: DESENGRASE 2',       nom:'AL',            qui:null,   col:13 },
    { no:'T5: DESENGRASE 2',       nom:'Temperatura',   qui:null,   col:17 },
    { no:'T7: PICLADO',            nom:'AT',            qui:null,   col:21 },
    { no:'T7: PICLADO',            nom:'Fe',            qui:null,   col:22 },
    { no:'T9: SALES',              nom:'pH',            qui:null,   col:26 },
    { no:'T9: SALES',              nom:'PPMs',          qui:null,   col:27 },
    { no:'T10: FOSFATO MANGANESO', nom:'AT',            qui:null,   col:28 },
    { no:'T10: FOSFATO MANGANESO', nom:'AL',            qui:null,   col:29 },
    { no:'T10: FOSFATO MANGANESO', nom:'Fe',            qui:null,   col:30 },
    { no:'T10: FOSFATO MANGANESO', nom:'Peso Fosfato',  qui:null,   col:31 },
    { no:'T10: FOSFATO MANGANESO', nom:'RA',            qui:null,   col:32 },
    { no:'T10: FOSFATO MANGANESO', nom:'Temperatura',   qui:null,   col:33 },
  ],
  'BAKER': [
    { no:'T02: ADH 1753',          nom:'% Sólidos',    qui:null,   col:3  },
    { no:'T04: SELLO',             nom:'Concentración', qui:null,   col:4  },
    { no:'T04: SELLO',             nom:'pH',            qui:null,   col:5  },
    { no:'T04: SELLO',             nom:'PPMs',          qui:null,   col:6  },
    { no:'T07: D1',                nom:'AT',            qui:'1207', col:10 },
    { no:'T08: STRP',              nom:'AL',            qui:null,   col:14 },
    { no:'T08: STRP',              nom:'Temperatura',   qui:null,   col:15 },
    { no:'T10: D2',                nom:'AT',            qui:'1207', col:20 },
    { no:'T13: PICLADO',           nom:'AT',            qui:null,   col:30 },
    { no:'T13: PICLADO',           nom:'Fe',            qui:null,   col:31 },
    { no:'T16: MACRO',             nom:'AT',            qui:null,   col:39 },
    { no:'T16: MACRO',             nom:'AL',            qui:null,   col:40 },
    { no:'T16: MACRO',             nom:'Fe',            qui:null,   col:41 },
    { no:'T16: MACRO',             nom:'Peso Fosfato',  qui:null,   col:42 },
    { no:'T16: MACRO',             nom:'RA',            qui:null,   col:43 },
    { no:'T16: MACRO',             nom:'Temperatura',   qui:null,   col:44 },
    { no:'T18: MICRO',             nom:'AT',            qui:null,   col:48 },
    { no:'T18: MICRO',             nom:'AL',            qui:null,   col:49 },
    { no:'T18: MICRO',             nom:'Fe',            qui:null,   col:50 },
    { no:'T18: MICRO',             nom:'CA',            qui:null,   col:51 },
    { no:'T18: MICRO',             nom:'Peso Fosfato',  qui:null,   col:52 },
    { no:'T18: MICRO',             nom:'RA',            qui:null,   col:53 },
    { no:'T18: MICRO',             nom:'Temperatura',   qui:null,   col:54 },
  ]
};

const IMPORT_HOJAS = [
  { linea:'LINEA 1', hoja:'Titulacion linea 1', skipRows:3 },
  { linea:'LINEA 3', hoja:'Titulación L3',      skipRows:1 },
  { linea:'LINEA 4', hoja:'Titulación L4',      skipRows:1 },
  { linea:'BAKER',   hoja:'Titulacion Baker',   skipRows:1 },
];

router.post('/admin/import-excel', valesAuthRequired, valesAllowRoles('admin'),
  _upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });

      const XLSX = require('xlsx');
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });

      const db = readVales();
      const force = req.body?.force === 'true' || req.body?.force === true;
      const yaHeaders = (db.titulaciones_header || []).length;

      if (yaHeaders > 0 && !force) {
        return res.json({
          ok: false,
          mensaje: `Ya existe historial (${yaHeaders} titulaciones). Usa force:true para sobreescribir.`
        });
      }

      // Asegurarse que los parámetros están cargados
      if ((db.parametros_titulacion || []).length === 0) {
        seedParametrosTitulacion(db);
      }

      // Lookup param por (no_tanque, nombre_param, quimico) → param
      const paramLookup = {};
      (db.parametros_titulacion || []).forEach(p => {
        const no = p.no_tanque || '';
        const key = `${no}||${p.nombre_parametro}||${p.quimico||''}`;
        paramLookup[key] = p;
      });

      const excelDateToISO = (v) => {
        if (!v) return null;
        if (typeof v === 'number') {
          const d = new Date(Math.round((v - 25569) * 86400000));
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        }
        const s = String(v).trim();
        return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
      };

      const calcEstadoV = (valor, param) => {
        if (valor == null) return 'sin_dato';
        if (param.tipo_rango === 'maximo') return valor > param.valor_max ? 'fuera' : 'ok';
        if (param.tipo_rango === 'minimo') return valor < param.valor_min ? 'fuera' : 'ok';
        if (param.tipo_rango === 'entre')  return (valor < param.valor_min || valor > param.valor_max) ? 'fuera' : 'ok';
        return 'ok';
      };

      const SERIAL_2026 = 46023;
      let hId = 1, dId = 1;
      const headers = [], detalles = [];
      const resumen = {};

      IMPORT_HOJAS.forEach(({ linea, hoja, skipRows }) => {
        const ws = wb.Sheets[hoja];
        if (!ws) { console.warn('[import-excel] Hoja no encontrada:', hoja); return; }

        // Limitar columnas a 70 (Baker tiene rango enorme)
        if (ws['!ref']) {
          const m = ws['!ref'].match(/^([A-Z]+\d+):([A-Z]+)(\d+)$/);
          if (m) {
            const colN = m[2].split('').reduce((n,c) => n*26 + c.charCodeAt(0)-64, 0);
            if (colN > 70) {
              const lim = (n => { let s=''; while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-(n%26||26))/26);} return s; })(70);
              ws['!ref'] = `${m[1]}:${lim}${m[3]}`;
            }
          }
        }

        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const rows = data.slice(skipRows).filter(r => {
          if (!r[0]) return false;
          if (typeof r[0] === 'number') return r[0] >= SERIAL_2026;
          return String(r[0]).startsWith('2026');
        });

        // paramColMap: param.id → colIndex
        const paramColMap = {};
        (IMPORT_EXACT_COLS[linea] || []).forEach(entry => {
          const key = `${entry.no}||${entry.nom}||${entry.qui||''}`;
          const param = paramLookup[key];
          if (param) paramColMap[param.id] = entry.col;
        });

        const lineaParams = (db.parametros_titulacion || []).filter(p => {
          const no = p.no_tanque || '';
          return (IMPORT_EXACT_COLS[linea] || []).some(e => e.no === no);
        });

        let titCount = 0;
        rows.forEach(row => {
          const fecha = excelDateToISO(row[0]);
          if (!fecha) return;
          const parts = String(row[1]||'').trim().split('.');
          const turno = parseInt(parts[0]), numTit = parseInt(parts[1]);
          if (isNaN(turno)||isNaN(numTit)||turno<1||turno>3||numTit<1||numTit>2) return;

          const analista = row[2] && typeof row[2] === 'string' ? row[2].trim() : 'Importado Excel';
          const header = {
            id: hId++, linea, fecha, turno, numero_titulacion: numTit,
            clave_titulacion: `${turno}.${numTit}`, analista,
            semana: null, estado: 'completo', quimico_snapshot: {}, importado: true,
            created_at: fecha + 'T00:00:00.000Z', updated_at: fecha + 'T00:00:00.000Z'
          };

          let hayFuera = false, hayValor = false;
          const rowDets = [];
          lineaParams.forEach(param => {
            if (param.frecuencia === 1 && numTit !== 1) return;
            const colIdx = paramColMap[param.id];
            let valor = null;
            if (colIdx != null && row[colIdx] != null) {
              const v = parseFloat(row[colIdx]);
              if (!isNaN(v)) { valor = v; hayValor = true; }
            }
            const estadoP = calcEstadoV(valor, param);
            if (estadoP === 'fuera') hayFuera = true;
            rowDets.push({
              id: dId++, header_id: header.id, parametro_id: param.id,
              valor_registrado: valor, estado_param: estadoP,
              corregido: false, valor_corregido: null, valor_original: null, observaciones: ''
            });
          });

          if (hayValor || rowDets.length > 0) {
            header.estado = hayFuera ? 'fuera_de_rango' : 'completo';
            headers.push(header);
            detalles.push(...rowDets);
            titCount++;
          }
        });
        resumen[linea] = titCount;
      });

      if (!headers.length) {
        return res.status(400).json({ error: 'No se encontraron titulaciones 2026 en el archivo. Verifica que sea el archivo correcto.' });
      }

      db.titulaciones_header  = headers;
      db.titulaciones_detalle = detalles;
      writeVales(db);

      console.log('[import-excel] OK —', JSON.stringify(resumen), '| total headers:', headers.length, 'detalles:', detalles.length);
      res.json({
        ok: true,
        mensaje: `Excel importado: ${headers.length} titulaciones, ${detalles.length} lecturas.`,
        resumen,
        parametros: (db.parametros_titulacion || []).length,
        headers: headers.length,
        detalles: detalles.length
      });
    } catch (err) {
      console.error('[import-excel] Error:', err.message, err.stack);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
