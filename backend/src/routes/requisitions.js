const express = require('express');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);

function nextFolio(db, department) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `REQ-${(department || 'GEN').slice(0,4).toUpperCase()}-${y}${m}${d}`;
  const matches = db.requisitions.filter(r => r.folio.startsWith(prefix));
  const seq = matches.length + 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

router.get('/', (req, res) => {
  const db = read();
  const rows = db.requisitions
    .filter(r => req.user.role_code === 'cliente_requisicion' ? r.requester_user_id === req.user.id : true)
    .sort((a,b)=>b.id-a.id)
    .map(r => ({ ...r, requester: (db.users.find(u => u.id === r.requester_user_id) || {}).full_name || '' }));
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = read();
  const reqRow = db.requisitions.find(r => r.id === Number(req.params.id));
  if (!reqRow) return res.status(404).json({ error: 'No encontrada' });
  const requisition = { ...reqRow, requester: (db.users.find(u=>u.id===reqRow.requester_user_id)||{}).full_name || '' };
  const items = db.requisition_items.filter(i => i.requisition_id === requisition.id).map(i => ({
    ...i,
    catalog_name: (db.catalog_items.find(c=>c.id===i.catalog_item_id)||{}).name || null,
    supplier_name: (db.suppliers.find(s=>s.id===i.supplier_id)||{}).business_name || null
  }));
  const history = db.status_history.filter(h => h.requisition_id === requisition.id).sort((a,b)=>b.id-a.id);
  res.json({ requisition, items, history });
});

router.post('/', (req, res) => {
  const payload = req.body;
  if (!Array.isArray(payload.items) || payload.items.length === 0) return res.status(400).json({ error: 'Debes capturar al menos un ítem' });
  const db = read();
  const folio = nextFolio(db, req.user.department);
  const reqId = nextId(db.requisitions);
  const total = payload.items.reduce((sum, i) => sum + ((Number(i.quantity) || 0) * (Number(i.unit_cost) || 0)), 0);
  const requisition = {
    id: reqId,
    folio,
    requester_user_id: req.user.id,
    request_date: new Date().toISOString(),
    urgency: payload.urgency,
    department: req.user.department,
    cost_center_id: payload.cost_center_id ? Number(payload.cost_center_id) : null,
    sub_cost_center_id: payload.sub_cost_center_id ? Number(payload.sub_cost_center_id) : null,
    status: 'Enviada',
    total_amount: total,
    currency: payload.currency || 'MXN',
    exchange_rate: Number(payload.exchange_rate || 1),
    origin: payload.origin || 'manual',
    comments: payload.comments || '',
    created_at: new Date().toISOString()
  };
  db.requisitions.push(requisition);
  payload.items.forEach((item, index) => {
    db.requisition_items.push({
      id: nextId(db.requisition_items),
      requisition_id: reqId,
      line_no: index + 1,
      catalog_item_id: item.catalog_item_id ? Number(item.catalog_item_id) : null,
      manual_item_name: item.manual_item_name || '',
      quantity: Number(item.quantity || 0),
      unit: item.unit || 'pza',
      supplier_id: item.supplier_id ? Number(item.supplier_id) : null,
      unit_cost: Number(item.unit_cost || 0),
      cost_center_id: item.cost_center_id ? Number(item.cost_center_id) : requisition.cost_center_id,
      sub_cost_center_id: item.sub_cost_center_id ? Number(item.sub_cost_center_id) : requisition.sub_cost_center_id,
      comments: item.comments || '',
      web_link: item.web_link || '',
      image_path: item.image_path || '',
      status: 'Enviada',
      created_at: new Date().toISOString()
    });
    db.status_history.push({
      id: nextId(db.status_history),
      requisition_id: reqId,
      item_line_no: index + 1,
      old_status: null,
      new_status: 'Enviada',
      changed_by_user_id: req.user.id,
      changed_at: new Date().toISOString(),
      comment: 'Creación de ítem'
    });
  });
  write(db);
  res.status(201).json({ reqId, folio });
});

module.exports = router;
