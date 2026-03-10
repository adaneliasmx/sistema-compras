const express = require('express');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { deriveItemStatus, recalcRequisition, addHistory } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

function nextFolio(db, department) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `REQ-${String(department || 'GEN').slice(0,4).toUpperCase()}-${y}${m}${d}`;
  const matches = db.requisitions.filter(r => String(r.folio).startsWith(prefix));
  return `${prefix}-${String(matches.length + 1).padStart(4, '0')}`;
}

function findPoFolioForReqItem(db, reqItemId) {
  const poItem = db.purchase_order_items.find(x => x.requisition_item_id === reqItemId);
  if (!poItem) return null;
  return (db.purchase_orders.find(x => x.id === poItem.purchase_order_id) || {}).folio || null;
}

function canEditReq(user, reqRow, db) {
  if (!reqRow) return false;
  if (!['cliente_requisicion', 'admin', 'comprador'].includes(user.role_code)) return false;
  if (user.role_code === 'cliente_requisicion' && reqRow.requester_user_id !== user.id) return false;
  const hasPO = db.requisition_items.some(i => i.requisition_id === reqRow.id && db.purchase_order_items.some(p => p.requisition_item_id === i.id));
  return !hasPO;
}

function validateItems(requisition, payloadItems = []) {
  if (!Array.isArray(payloadItems) || !payloadItems.length) return 'Debes capturar al menos un ítem';
  const hasManualWithoutCC = payloadItems.some(item => !item.catalog_item_id && !(item.cost_center_id || requisition.cost_center_id));
  if (hasManualWithoutCC) return 'Los ítems manuales requieren centro de costo';
  return null;
}

function buildItems(db, requisition, payloadItems = [], changedByUserId, isDraft) {
  return payloadItems.map((item, index) => {
    const cat = item.catalog_item_id ? db.catalog_items.find(c => c.id === Number(item.catalog_item_id)) : null;
    const unitCost = cat && Number(cat.unit_price || 0) ? Number(cat.unit_price) : Number(item.unit_cost || 0);
    const supplierId = item.supplier_id ? Number(item.supplier_id) : (cat?.supplier_id || null);
    const currency = item.currency || cat?.currency || requisition.currency || 'MXN';
    const itemCC = item.cost_center_id ? Number(item.cost_center_id) : (cat?.cost_center_id || requisition.cost_center_id || null);
    const itemSCC = item.sub_cost_center_id ? Number(item.sub_cost_center_id) : (cat?.sub_cost_center_id || requisition.sub_cost_center_id || null);
    const status = isDraft ? 'Borrador' : deriveItemStatus(db, 0, { ...item, catalog_item_id: cat?.id || null, supplier_id: supplierId, unit_cost: unitCost });
    return {
      id: nextId(db.requisition_items),
      requisition_id: requisition.id,
      line_no: index + 1,
      catalog_item_id: cat?.id || null,
      manual_item_name: item.manual_item_name || '',
      quantity: Number(item.quantity || 0),
      unit: item.unit || cat?.unit || 'pza',
      supplier_id: supplierId,
      unit_cost: unitCost,
      cost_center_id: itemCC,
      sub_cost_center_id: itemSCC,
      comments: item.comments || '',
      web_link: item.web_link || '',
      image_url: item.image_url || '',
      currency,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  });
}

router.get('/', (req, res) => {
  const db = read();
  const rows = db.requisitions
    .filter(r => req.user.role_code === 'cliente_requisicion' ? r.requester_user_id === req.user.id : true)
    .sort((a,b)=>b.id-a.id)
    .map(r => ({
      ...r,
      requester: (db.users.find(u => u.id === r.requester_user_id) || {}).full_name || '',
      po_folio: (db.requisition_items.filter(i => i.requisition_id === r.id).map(i => findPoFolioForReqItem(db, i.id)).find(Boolean)) || null
    }));
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = read();
  const reqRow = db.requisitions.find(r => r.id === Number(req.params.id));
  if (!reqRow) return res.status(404).json({ error: 'No encontrada' });
  if (req.user.role_code === 'cliente_requisicion' && reqRow.requester_user_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
  const items = db.requisition_items.filter(i => i.requisition_id === reqRow.id).map(i => ({
    ...i,
    catalog_name: (db.catalog_items.find(c=>c.id===i.catalog_item_id)||{}).name || null,
    supplier_name: (db.suppliers.find(s=>s.id===i.supplier_id)||{}).business_name || null,
    po_folio: findPoFolioForReqItem(db, i.id)
  }));
  const history = db.status_history.filter(h => h.requisition_id === reqRow.id).sort((a,b)=>b.id-a.id);
  res.json({ requisition: reqRow, items, history, can_edit: canEditReq(req.user, reqRow, db) });
});

router.post('/', (req, res) => {
  const payload = req.body || {};
  const db = read();
  const isDraft = payload.status === 'Borrador';
  const requisition = {
    id: nextId(db.requisitions),
    folio: nextFolio(db, req.user.department),
    requester_user_id: req.user.id,
    request_date: new Date().toISOString(),
    urgency: payload.urgency || 'Medio',
    programmed_date: payload.programmed_date || null,
    department: req.user.department,
    cost_center_id: payload.cost_center_id ? Number(payload.cost_center_id) : (req.user.default_cost_center_id || null),
    sub_cost_center_id: payload.sub_cost_center_id ? Number(payload.sub_cost_center_id) : (req.user.default_sub_cost_center_id || null),
    status: isDraft ? 'Borrador' : 'Enviada',
    total_amount: 0,
    currency: payload.currency || 'MXN',
    exchange_rate: Number(payload.exchange_rate || 1),
    comments: payload.comments || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const validation = validateItems(requisition, payload.items);
  if (validation) return res.status(400).json({ error: validation });
  db.requisitions.push(requisition);
  const lines = buildItems(db, requisition, payload.items, req.user.id, isDraft);
  db.requisition_items.push(...lines);
  recalcRequisition(db, requisition.id);
  if (isDraft) requisition.status = 'Borrador';
  addHistory(db, { module: 'requisitions', requisition_id: requisition.id, old_status: null, new_status: requisition.status, changed_by_user_id: req.user.id, comment: isDraft ? 'Requisición guardada como borrador' : 'Requisición creada' });
  write(db);
  res.status(201).json({ requisition });
});

router.patch('/:id', (req, res) => {
  const db = read();
  const reqRow = db.requisitions.find(r => r.id === Number(req.params.id));
  if (!reqRow) return res.status(404).json({ error: 'No encontrada' });
  if (!canEditReq(req.user, reqRow, db)) return res.status(403).json({ error: 'No se puede editar esta requisición' });
  const payload = req.body || {};
  reqRow.urgency = payload.urgency || reqRow.urgency;
  reqRow.programmed_date = payload.programmed_date || null;
  reqRow.cost_center_id = payload.cost_center_id ? Number(payload.cost_center_id) : (reqRow.cost_center_id || req.user.default_cost_center_id || null);
  reqRow.sub_cost_center_id = payload.sub_cost_center_id ? Number(payload.sub_cost_center_id) : (reqRow.sub_cost_center_id || req.user.default_sub_cost_center_id || null);
  reqRow.currency = payload.currency || reqRow.currency;
  reqRow.comments = payload.comments ?? reqRow.comments;
  reqRow.updated_at = new Date().toISOString();
  if (Array.isArray(payload.items)) {
    const validation = validateItems(reqRow, payload.items);
    if (validation) return res.status(400).json({ error: validation });
    db.requisition_items = db.requisition_items.filter(i => i.requisition_id !== reqRow.id);
    const isDraft = payload.status === 'Borrador' || reqRow.status === 'Borrador';
    const lines = buildItems(db, reqRow, payload.items, req.user.id, isDraft);
    db.requisition_items.push(...lines);
    recalcRequisition(db, reqRow.id);
    if (isDraft) reqRow.status = 'Borrador';
  }
  addHistory(db, { module: 'requisitions', requisition_id: reqRow.id, old_status: reqRow.status, new_status: reqRow.status, changed_by_user_id: req.user.id, comment: 'Requisición actualizada' });
  write(db);
  res.json({ requisition: reqRow });
});

router.delete('/:id', (req, res) => {
  const db = read();
  const reqRow = db.requisitions.find(r => r.id === Number(req.params.id));
  if (!reqRow) return res.status(404).json({ error: 'No encontrada' });
  if (!canEditReq(req.user, reqRow, db)) return res.status(403).json({ error: 'No se puede eliminar esta requisición' });
  db.requisitions = db.requisitions.filter(r => r.id !== reqRow.id);
  db.requisition_items = db.requisition_items.filter(i => i.requisition_id !== reqRow.id);
  db.status_history = db.status_history.filter(h => h.requisition_id !== reqRow.id);
  write(db);
  res.json({ ok: true });
});

router.post('/:id/send', (req, res) => {
  const db = read();
  const reqRow = db.requisitions.find(r => r.id === Number(req.params.id));
  if (!reqRow) return res.status(404).json({ error: 'No encontrada' });
  if (!canEditReq(req.user, reqRow, db)) return res.status(403).json({ error: 'No se puede enviar esta requisición' });
  const lines = db.requisition_items.filter(i => i.requisition_id === reqRow.id);
  lines.forEach(line => {
    const oldStatus = line.status;
    line.status = deriveItemStatus(db, Number(reqRow.total_amount || 0), line);
    line.updated_at = new Date().toISOString();
    addHistory(db, { module: 'requisitions', requisition_id: reqRow.id, requisition_item_id: line.id, old_status: oldStatus, new_status: line.status, changed_by_user_id: req.user.id, comment: 'Requisición enviada' });
  });
  recalcRequisition(db, reqRow.id);
  if (reqRow.status === 'Borrador') reqRow.status = 'Enviada';
  reqRow.sent_at = new Date().toISOString();
  const buyerEmail = req.body.email_to || db.settings?.buyer_email || 'compras@demo.com';
  const requesterEmail = (db.users.find(u => u.id === reqRow.requester_user_id) || {}).email || req.user.email || '';
  const subject = req.body.email_subject || `Requisición ${reqRow.folio}`;
  const previewUrl = `${req.protocol}://${req.get('host')}/#/requisiciones/${reqRow.id}`;
  const body = [
    `Se generó la requisición ${reqRow.folio}.`,
    `Solicitante: ${req.user.name || req.user.full_name || ''}`,
    `Departamento: ${reqRow.department}`,
    `Total: ${Number(reqRow.total_amount || 0).toFixed(2)} ${reqRow.currency || 'MXN'}`,
    `Vista previa / PDF: ${previewUrl}`
  ].join('\n');
  reqRow.email_to = buyerEmail;
  reqRow.email_subject = subject;
  addHistory(db, { module: 'requisitions', requisition_id: reqRow.id, old_status: 'Borrador', new_status: reqRow.status, changed_by_user_id: req.user.id, comment: 'Requisición enviada por correo' });
  write(db);
  res.json({ requisition: reqRow, mailto_buyer: `mailto:${encodeURIComponent(buyerEmail)}?cc=${encodeURIComponent(requesterEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, mailto_requester: requesterEmail ? `mailto:${encodeURIComponent(requesterEmail)}?subject=${encodeURIComponent(`Confirmación ${reqRow.folio}`)}&body=${encodeURIComponent(`Tu requisición ${reqRow.folio} fue enviada a compras.\n\nPuedes verla aquí: ${previewUrl}`)}` : null });
});

module.exports = router;
