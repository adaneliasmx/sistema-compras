const express = require('express');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, recalcRequisition, deriveItemStatus } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

function nextPOFolio(db, providerCode) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `PO-${providerCode}-${y}${m}`;
  const count = db.purchase_orders.filter(x => String(x.folio).startsWith(prefix)).length + 1;
  return `${prefix}-${String(count).padStart(4, '0')}`;
}

// Preview: agrupa ítems seleccionados por proveedor antes de generar POs
router.post('/preview-po', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.map(Number) : [];
  const lines = db.requisition_items.filter(i => itemIds.includes(i.id));
  const grupos = {};
  lines.forEach(line => {
    const sid = line.supplier_id || 0;
    if (!grupos[sid]) grupos[sid] = [];
    grupos[sid].push(line);
  });
  const preview = Object.entries(grupos).map(([supplierId, groupLines]) => {
    const supplier = db.suppliers.find(s => s.id === Number(supplierId));
    const total = groupLines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
    const warnings = [];
    groupLines.forEach(l => {
      if (l.status !== 'Autorizado') warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" no está Autorizado (${l.status})`);
      if (!l.unit_cost) warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" sin costo`);
      if (!l.supplier_id) warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" sin proveedor`);
    });
    return {
      supplier_id: Number(supplierId),
      supplier_name: supplier?.business_name || '⚠ Sin proveedor asignado',
      supplier_email: supplier?.email || '',
      item_count: groupLines.length,
      total,
      currency: groupLines[0].currency || 'MXN',
      items: groupLines.map(l => ({
        id: l.id, status: l.status,
        name: (db.catalog_items.find(c => c.id === l.catalog_item_id) || {}).name || l.manual_item_name,
        quantity: l.quantity, unit: l.unit, unit_cost: l.unit_cost
      })),
      warnings,
      can_generate: warnings.length === 0
    };
  });
  res.json({ groups: preview, total_pos: preview.length, total_items: lines.length });
});

router.get('/pending-items', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const rows = db.requisition_items
    .filter(i => !['Cerrado', 'Rechazado'].includes(i.status))
    .map(i => ({
      ...i,
      requisition_folio: (db.requisitions.find(r => r.id === i.requisition_id) || {}).folio,
      supplier_name: (db.suppliers.find(s => s.id === i.supplier_id) || {}).business_name || '-',
      item_name: (db.catalog_items.find(c => c.id === i.catalog_item_id) || {}).name || i.manual_item_name || '',
      po_folio: i.purchase_order_id ? (db.purchase_orders.find(p => p.id === i.purchase_order_id) || {}).folio || '' : ''
    }));
  res.json(rows);
});

router.patch('/items/:id', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  const oldStatus = line.status;
  if (req.body.supplier_id !== undefined) line.supplier_id = req.body.supplier_id ? Number(req.body.supplier_id) : null;
  if (req.body.catalog_item_id !== undefined) line.catalog_item_id = req.body.catalog_item_id ? Number(req.body.catalog_item_id) : null;
  if (req.body.manual_item_name !== undefined) line.manual_item_name = req.body.manual_item_name;
  if (req.body.unit_cost !== undefined) line.unit_cost = Number(req.body.unit_cost || 0);
  if (req.body.comments !== undefined) line.comments = req.body.comments;
  if (req.body.currency !== undefined) line.currency = req.body.currency || line.currency || 'MXN';
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  recalcRequisition(db, line.requisition_id);
  line.status = deriveItemStatus(db, Number(reqRow.total_amount || 0), line);
  line.updated_at = new Date().toISOString();
  addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: line.status, changed_by_user_id: req.user.id, comment: 'Edición de ítem por compras' });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json(line);
});

router.post('/items/:id/register-catalog-item', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (!req.body.supplier_id || !req.body.code || !req.body.name) return res.status(400).json({ error: 'Proveedor, código y nombre requeridos' });
  const item = {
    id: nextId(db.catalog_items),
    code: req.body.code,
    name: req.body.name,
    item_type: req.body.item_type || 'uso continuo',
    unit: req.body.unit || line.unit || 'pza',
    supplier_id: Number(req.body.supplier_id),
    equivalent_code: '',
    unit_price: Number(req.body.unit_price || line.unit_cost || 0),
    currency: req.body.currency || line.currency || 'MXN',
    quote_validity_days: Number(req.body.quote_validity_days || 30),
    active: true,
    inventoried: !!req.body.inventoried,
    cost_center_id: line.cost_center_id || null,
    sub_cost_center_id: line.sub_cost_center_id || null
  };
  db.catalog_items.push(item);
  line.catalog_item_id = item.id;
  line.supplier_id = item.supplier_id;
  line.unit_cost = item.unit_price;
  line.currency = item.currency;
  line.manual_item_name = line.manual_item_name || item.name;
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  const oldStatus = line.status;
  recalcRequisition(db, line.requisition_id);
  line.status = deriveItemStatus(db, Number(reqRow.total_amount || 0), line);
  addHistory(db, { module: 'catalogs', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: line.status, changed_by_user_id: req.user.id, comment: `Ítem ${item.code} dado de alta en catálogo` });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.status(201).json({ item, requisition_item: line });
});

router.post('/items/:id/request-quotation', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  const supplierIds = Array.isArray(req.body.supplier_ids) ? req.body.supplier_ids.map(Number).filter(Boolean) : [];
  if (!supplierIds.length) return res.status(400).json({ error: 'Selecciona al menos un proveedor para cotizar' });
  line.status = 'En cotización';
  line.currency = req.body.currency || line.currency || 'MXN';
  line.updated_at = new Date().toISOString();
  db.quotation_requests = db.quotation_requests || [];
  supplierIds.forEach(supplier_id => db.quotation_requests.push({ id: nextId(db.quotation_requests), requisition_item_id: line.id, supplier_id, created_at: new Date().toISOString(), created_by_user_id: req.user.id, status: 'Pendiente' }));
  const emails = supplierIds.map(id => (db.suppliers.find(s => s.id === id) || {}).email).filter(Boolean);
  addHistory(db, { module: 'quotations', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: null, new_status: 'En cotización', changed_by_user_id: req.user.id, comment: 'Solicitud de cotización enviada' });
  recalcRequisition(db, line.requisition_id);
  write(db);
  const subject = `Solicitud de cotización · ${(db.requisitions.find(r => r.id === line.requisition_id) || {}).folio || ''}`;
  const body = `Favor de registrar cotización para el ítem: ${(db.catalog_items.find(c => c.id === line.catalog_item_id) || {}).name || line.manual_item_name}.`;
  res.json({ ok: true, mailto: `mailto:${encodeURIComponent(emails.join(';'))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` });
});

// Motor único de generación de PO — agrupa por proveedor automáticamente
function createPOForGroup(db, lines, supplierId, buyerUserId, currency) {
  const supplier = db.suppliers.find(s => s.id === supplierId);
  const po = {
    id: nextId(db.purchase_orders),
    folio: nextPOFolio(db, supplier?.provider_code || 'GEN'),
    supplier_id: supplierId,
    buyer_user_id: buyerUserId,
    status: 'En proceso',
    currency: currency || lines[0].currency || 'MXN',
    created_at: new Date().toISOString(),
    total_amount: 0,
    supplier_response: 'Pendiente',
    supplier_email: supplier?.email || '',
    supplier_contact: supplier?.contact_name || ''
  };
  db.purchase_orders.push(po);
  let total = 0;
  lines.forEach(line => {
    const subtotal = Number(line.quantity || 0) * Number(line.unit_cost || 0);
    total += subtotal;
    db.purchase_order_items.push({
      id: nextId(db.purchase_order_items),
      purchase_order_id: po.id,
      requisition_item_id: line.id,
      catalog_item_id: line.catalog_item_id,
      description: (db.catalog_items.find(c => c.id === line.catalog_item_id) || {}).name || line.manual_item_name,
      quantity: line.quantity,
      unit: line.unit,
      unit_cost: line.unit_cost,
      currency: line.currency || 'MXN',
      subtotal,
      status: 'En proceso'
    });
    const oldStatus = line.status;
    line.status = 'En proceso';
    line.purchase_order_id = po.id;
    line.updated_at = new Date().toISOString();
    addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, purchase_order_id: po.id, old_status: oldStatus, new_status: 'En proceso', changed_by_user_id: buyerUserId, comment: `PO ${po.folio} generada` });
    recalcRequisition(db, line.requisition_id);
  });
  po.total_amount = total;
  return po;
}

router.post('/generate-po', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.map(Number) : [];
  if (!itemIds.length) return res.status(400).json({ error: 'Selecciona al menos un ítem' });

  const lines = db.requisition_items.filter(i => itemIds.includes(i.id));
  if (!lines.length) return res.status(404).json({ error: 'Ítems no encontrados' });

  // Excluir ítems ya cancelados o ya con PO
  const disponibles = lines.filter(x => !['Cancelado', 'Rechazado', 'Cerrado'].includes(x.status) && !x.purchase_order_id);

  // Validar que tengan proveedor y costo (requisito mínimo para PO parcial)
  const incompletos = disponibles.filter(x => !x.supplier_id || !x.unit_cost);
  if (incompletos.length && incompletos.length === disponibles.length) {
    return res.status(400).json({
      error: `Los ítems seleccionados no tienen proveedor o costo asignado. Asigna proveedor y costo antes de generar la PO.`,
      items: incompletos.map(x => x.id)
    });
  }

  // Usar los que sí tienen proveedor+costo (PO parcial si los demás están incompletos)
  const aptos = disponibles.filter(x => x.supplier_id && x.unit_cost);
  if (!aptos.length) return res.status(400).json({ error: 'No hay ítems listos para PO. Asigna proveedor y costo.' });

  // Agrupar por proveedor
  const grupos = {};
  aptos.forEach(line => {
    const sid = line.supplier_id;
    if (!grupos[sid]) grupos[sid] = [];
    grupos[sid].push(line);
  });

  const currency = req.body.currency || 'MXN';
  const purchaseOrders = [];

  for (const [supplierId, groupLines] of Object.entries(grupos)) {
    const po = createPOForGroup(db, groupLines, Number(supplierId), req.user.id, currency);
    purchaseOrders.push(po);
  }

  write(db);

  const skipped = lines.length - aptos.length;
  res.status(201).json({
    purchase_orders: purchaseOrders,
    po_count: purchaseOrders.length,
    item_count: aptos.length,
    skipped_count: skipped,
    message: purchaseOrders.length === 1
      ? `PO generada: ${purchaseOrders[0].folio}${skipped ? ` (${skipped} ítem(s) omitidos por falta de proveedor/costo)` : ''}`
      : `${purchaseOrders.length} POs generadas: ${purchaseOrders.map(p => p.folio).join(', ')}${skipped ? ` (${skipped} ítem(s) omitidos)` : ''}`
  });
});

// Cancelar ítem desde compras
router.post('/items/:id/cancel', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (['Cancelado', 'Cerrado'].includes(line.status)) return res.status(400).json({ error: `El ítem ya está ${line.status}` });
  const reason = req.body.reason || 'Sin justificación';
  const oldStatus = line.status;
  line.status = 'Cancelado';
  line.cancel_reason = reason;
  line.cancelled_at = new Date().toISOString();
  line.cancelled_by = req.user.id;
  line.updated_at = new Date().toISOString();
  addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: 'Cancelado', changed_by_user_id: req.user.id, comment: `Cancelado: ${reason}` });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json({ ok: true, item: line });
});

router.get('/purchase-orders', allowRoles('comprador', 'proveedor', 'admin'), (req, res) => {
  const db = read();
  const rows = db.purchase_orders
    .filter(po => req.user.supplier_id ? po.supplier_id === req.user.supplier_id : true)
    .map(po => ({
      ...po,
      supplier_name: (db.suppliers.find(s => s.id === po.supplier_id) || {}).business_name || '',
      items: db.purchase_order_items.filter(i => i.purchase_order_id === po.id).length
    }));
  res.json(rows);
});

router.get('/purchase-orders/:id', allowRoles('comprador', 'proveedor', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  if (req.user.supplier_id && po.supplier_id !== req.user.supplier_id) return res.status(403).json({ error: 'Sin permiso' });
  const items = db.purchase_order_items.filter(i => i.purchase_order_id === po.id);
  res.json({ po, items });
});

router.post('/purchase-orders/:id/respond', allowRoles('proveedor', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  if (req.user.supplier_id && po.supplier_id !== req.user.supplier_id) return res.status(403).json({ error: 'Sin permiso' });
  po.supplier_response = req.body.response || 'Aceptada';
  po.supplier_comment = req.body.comment || '';
  po.status = po.supplier_response === 'Rechazada' ? 'Rechazada por proveedor' : po.status;
  write(db);
  res.json(po);
});

module.exports = router;
