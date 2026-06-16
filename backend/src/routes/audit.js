const express = require('express');
const router = express.Router();
const { read, write } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, recalcRequisition } = require('../utils/workflow');

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

// GET /api/audit/items/:id — detalle completo con trazabilidad
router.get('/items/:id', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const itemId = Number(req.params.id);
  const i = (db.requisition_items || []).find(x => x.id === itemId);
  if (!i) return res.status(404).json({ error: 'Ítem no encontrado' });

  const reqRow  = (db.requisitions     || []).find(r => r.id === i.requisition_id)   || {};
  const user    = (db.users            || []).find(u => u.id === reqRow.requester_user_id) || {};
  const supp    = (db.suppliers        || []).find(s => s.id === i.supplier_id)       || {};
  const cc      = (db.cost_centers     || []).find(c => c.id === i.cost_center_id)    || {};
  const scc     = (db.sub_cost_centers || []).find(c => c.id === i.sub_cost_center_id)|| {};
  const cat     = (db.catalog_items    || []).find(c => c.id === i.catalog_item_id)   || {};
  const po      = i.purchase_order_id ? (db.purchase_orders || []).find(p => p.id === i.purchase_order_id) || null : null;
  const poSupp  = po ? (db.suppliers   || []).find(s => s.id === po.supplier_id) || {} : {};

  const invoices = po ? (db.invoices || []).filter(inv => inv.purchase_order_id === po.id) : [];
  const invIds   = new Set(invoices.map(inv => inv.id));
  const payments = (db.payments || []).filter(pay => invIds.has(pay.invoice_id));

  // Historial del ítem ordenado cronológicamente
  const history = (db.status_history || [])
    .filter(h => h.requisition_item_id === itemId)
    .sort((a, b) => (a.changed_at || '').localeCompare(b.changed_at || ''))
    .map(h => {
      const who = (db.users || []).find(u => u.id === h.changed_by_user_id) || {};
      return { ...h, changed_by_name: who.full_name || '-' };
    });

  // Fecha de entrega: buscar en el historial cuándo la PO pasó a Entregado
  const entregadoH = [...history].reverse().find(h => h.new_status === 'Entregado' || h.comment?.includes('Entregado'));

  res.json({
    item: {
      id: i.id,
      item_name: i.manual_item_name || cat.name || '-',
      quantity: i.quantity,
      unit: i.unit || '',
      unit_cost: i.unit_cost,
      currency: i.currency || 'MXN',
      total: Number(i.quantity || 0) * Number(i.unit_cost || 0),
      status: i.status,
      comments: i.comments || '',
      reject_reason: i.reject_reason || null,
      created_at: i.created_at || '',
    },
    requisition: {
      id: reqRow.id,
      folio: reqRow.folio || '-',
      request_date: (reqRow.request_date || reqRow.created_at || '').slice(0, 10),
      urgency: reqRow.urgency || '-',
      requester_name: user.full_name || '-',
      cost_center_name: cc.name || '-',
      sub_cost_center_name: scc.name || '',
    },
    supplier: { name: supp.business_name || '-' },
    po: po ? {
      id: po.id,
      folio: po.folio || '-',
      status: po.status || '-',
      supplier_name: poSupp.business_name || '-',
      created_at: (po.created_at || '').slice(0, 10),
      total_amount: po.total_amount,
      currency: po.currency || 'MXN',
      entregado_at: entregadoH ? (entregadoH.changed_at || '').slice(0, 10) : null,
    } : null,
    invoices: invoices.map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number || '-',
      created_at: (inv.created_at || '').slice(0, 10),
      status: inv.status || '-',
      total: inv.total || 0,
      has_pdf: !!inv.pdf_data,
      has_xml: !!inv.xml_data,
    })),
    payments: payments.map(pay => ({
      id: pay.id,
      amount: pay.amount || 0,
      payment_type: pay.payment_type || '-',
      reference: pay.reference || '-',
      created_at: (pay.created_at || '').slice(0, 10),
    })),
    history,
  });
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

  // Propagar unit_cost y quantity a purchase_order_items vinculados
  const poItemsLinked = (db.purchase_order_items || []).filter(pi => pi.requisition_item_id === item.id);
  if (poItemsLinked.length) {
    const costChanged = req.body.unit_cost !== undefined;
    const qtyChanged  = req.body.quantity  !== undefined;
    poItemsLinked.forEach(pi => {
      if (costChanged) pi.unit_cost = item.unit_cost;
      if (qtyChanged)  pi.quantity  = item.quantity;
    });
    // Recalcular total de cada PO afectada
    const poIds = [...new Set(poItemsLinked.map(pi => pi.purchase_order_id))];
    poIds.forEach(poId => {
      const po = (db.purchase_orders || []).find(p => p.id === poId);
      if (!po) return;
      const lines = (db.purchase_order_items || []).filter(pi => pi.purchase_order_id === poId);
      po.total_amount = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
    });
    addHistory(db, { module: 'audit', requisition_id: item.requisition_id, requisition_item_id: item.id, old_status: null, new_status: item.status, changed_by_user_id: req.user.id, comment: `Actualizado desde auditoría: costo/cantidad propagado a ${poItemsLinked.length} ítem(s) de PO` });
  }

  recalcRequisition(db, item.requisition_id);
  write(db);
  res.json({ ok: true });
});

module.exports = router;
