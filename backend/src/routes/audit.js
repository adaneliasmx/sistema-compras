const express = require('express');
const router = express.Router();
const { read, write } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { recalcRequisition } = require('../utils/workflow');

router.use(authRequired);

// GET /api/audit/items — todos los ítems con datos enriquecidos, ordenables y filtrables
router.get('/items', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const { sort = 'created_at', order = 'desc', search = '', status = '', cc_id = '' } = req.query;

  let items = (db.requisition_items || []).map(i => {
    const reqRow = (db.requisitions || []).find(r => r.id === i.requisition_id) || {};
    const user   = (db.users || []).find(u => u.id === reqRow.requester_user_id) || {};
    const supp   = (db.suppliers || []).find(s => s.id === i.supplier_id) || {};
    const cc     = (db.cost_centers || []).find(c => c.id === i.cost_center_id) || {};
    const scc    = (db.sub_cost_centers || []).find(c => c.id === i.sub_cost_center_id) || {};
    const cat    = (db.catalog_items || []).find(c => c.id === i.catalog_item_id) || {};
    const po     = (db.purchase_orders || []).find(p => p.id === i.purchase_order_id) || {};
    return {
      id: i.id,
      requisition_id: i.requisition_id,
      catalog_item_id: i.catalog_item_id,
      manual_item_name: i.manual_item_name,
      item_name: i.manual_item_name || cat.name || '-',
      supplier_id: i.supplier_id,
      supplier_name: supp.business_name || '-',
      cost_center_id: i.cost_center_id,
      cost_center_name: cc.name || '-',
      sub_cost_center_id: i.sub_cost_center_id,
      sub_cost_center_name: scc.name || '',
      quantity: i.quantity,
      unit: i.unit,
      unit_cost: i.unit_cost,
      currency: i.currency || 'MXN',
      total: Number(i.quantity || 0) * Number(i.unit_cost || 0),
      status: i.status,
      comments: i.comments || '',
      purchase_order_id: i.purchase_order_id,
      req_folio: reqRow.folio || '-',
      req_date: (reqRow.request_date || reqRow.created_at || '').slice(0, 10),
      requester_name: user.full_name || '-',
      po_folio: po.folio || '',
      po_status: po.status || '',
      created_at: i.created_at || '',
      updated_at: i.updated_at || ''
    };
  });

  // Filtros
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(i =>
      i.item_name.toLowerCase().includes(q) ||
      i.req_folio.toLowerCase().includes(q) ||
      i.supplier_name.toLowerCase().includes(q) ||
      i.requester_name.toLowerCase().includes(q) ||
      (i.po_folio || '').toLowerCase().includes(q) ||
      i.cost_center_name.toLowerCase().includes(q)
    );
  }
  if (status) items = items.filter(i => i.status === status);
  if (cc_id)  items = items.filter(i => i.cost_center_id === Number(cc_id));

  // Ordenamiento
  const dir = order === 'asc' ? 1 : -1;
  const cmp = {
    cost_center_name: (a, b) => (a.cost_center_name || '').localeCompare(b.cost_center_name || ''),
    requester_name:   (a, b) => (a.requester_name || '').localeCompare(b.requester_name || ''),
    supplier_name:    (a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || ''),
    item_name:        (a, b) => (a.item_name || '').localeCompare(b.item_name || ''),
    status:           (a, b) => (a.status || '').localeCompare(b.status || ''),
    req_folio:        (a, b) => (a.req_folio || '').localeCompare(b.req_folio || ''),
    total:            (a, b) => a.total - b.total,
    unit_cost:        (a, b) => a.unit_cost - b.unit_cost,
    req_date:         (a, b) => (a.req_date || '').localeCompare(b.req_date || ''),
    created_at:       (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
  };
  items.sort((a, b) => dir * (cmp[sort] ? cmp[sort](a, b) : (a.created_at || '').localeCompare(b.created_at || '')));

  res.json(items);
});

// PATCH /api/audit/items/:id — edición de auditoría (sin restricción de estado PO)
router.patch('/items/:id', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const item = (db.requisition_items || []).find(i => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

  if (req.body.manual_item_name !== undefined) item.manual_item_name = req.body.manual_item_name;
  if (req.body.supplier_id      !== undefined) item.supplier_id      = req.body.supplier_id ? Number(req.body.supplier_id) : null;
  if (req.body.unit_cost        !== undefined) item.unit_cost        = Number(req.body.unit_cost || 0);
  if (req.body.quantity         !== undefined) item.quantity         = Number(req.body.quantity || 0);
  if (req.body.unit             !== undefined) item.unit             = req.body.unit;
  if (req.body.currency         !== undefined) item.currency         = req.body.currency || 'MXN';
  if (req.body.cost_center_id   !== undefined) item.cost_center_id   = req.body.cost_center_id ? Number(req.body.cost_center_id) : null;
  if (req.body.sub_cost_center_id !== undefined) item.sub_cost_center_id = req.body.sub_cost_center_id ? Number(req.body.sub_cost_center_id) : null;
  if (req.body.comments         !== undefined) item.comments         = req.body.comments;

  // Validar que SCC pertenezca al CC
  if (item.sub_cost_center_id && item.cost_center_id) {
    const scc = (db.sub_cost_centers || []).find(s => s.id === item.sub_cost_center_id);
    if (scc && scc.cost_center_id !== item.cost_center_id) {
      return res.status(400).json({ error: `El subcentro "${scc.name}" no pertenece al centro de costo seleccionado.` });
    }
  }

  item.updated_at = new Date().toISOString();
  recalcRequisition(db, item.requisition_id);
  write(db);
  res.json({ ok: true });
});

module.exports = router;
