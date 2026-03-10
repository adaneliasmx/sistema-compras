const express = require('express');
const { read } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);

function toCsv(rows) {
  if (!rows.length) return 'sin_datos\n';
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

function isoWeek(dateStr) {
  const d = new Date(dateStr); if (isNaN(d)) return '';
  d.setHours(0,0,0,0); d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(),0,1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function buildSeguimiento(db) {
  return db.requisition_items.map(i => {
    const req = db.requisitions.find(r => r.id === i.requisition_id) || {};
    const user = db.users.find(u => u.id === req.requester_user_id) || {};
    const supplier = db.suppliers.find(s => s.id === i.supplier_id) || {};
    const cc = db.cost_centers.find(c => c.id === i.cost_center_id) || {};
    const scc = db.sub_cost_centers.find(c => c.id === i.sub_cost_center_id) || {};
    const poItem = db.purchase_order_items.find(p => p.requisition_item_id === i.id) || {};
    const po = db.purchase_orders.find(p => p.id === poItem.purchase_order_id) || {};
    return {
      fecha: String(req.request_date || '').slice(0,10),
      semana: isoWeek(req.request_date),
      usuario: user.full_name || '',
      folio_requisicion: req.folio || '',
      folio_po: po.folio || '',
      item: (db.catalog_items.find(c => c.id === i.catalog_item_id) || {}).name || i.manual_item_name || '',
      costo: Number(i.unit_cost || 0),
      moneda: i.currency || req.currency || 'MXN',
      cantidad: Number(i.quantity || 0),
      precio_unitario: Number(i.unit_cost || 0),
      precio_total: Number(i.quantity || 0) * Number(i.unit_cost || 0),
      centro_costo: cc.name || '',
      subcentro_costo: scc.name || '',
      proveedor: supplier.business_name || '',
      estatus: i.status || ''
    };
  });
}

function buildCompras(db) {
  return db.requisition_items.map(i => {
    const req = db.requisitions.find(r => r.id === i.requisition_id) || {};
    const user = db.users.find(u => u.id === req.requester_user_id) || {};
    const supplier = db.suppliers.find(s => s.id === i.supplier_id) || {};
    const cc = db.cost_centers.find(c => c.id === i.cost_center_id) || {};
    const scc = db.sub_cost_centers.find(c => c.id === i.sub_cost_center_id) || {};
    const poItem = db.purchase_order_items.find(p => p.requisition_item_id === i.id) || {};
    const po = db.purchase_orders.find(p => p.id === poItem.purchase_order_id) || {};
    return {
      fecha: String(req.request_date || '').slice(0,10),
      semana: isoWeek(req.request_date),
      usuario: user.full_name || '',
      folio_requisicion: req.folio || '',
      folio_remision: po.folio || '',
      item: (db.catalog_items.find(c => c.id === i.catalog_item_id) || {}).name || i.manual_item_name || '',
      costo: Number(i.unit_cost || 0),
      moneda: i.currency || req.currency || 'MXN',
      cantidad: Number(i.quantity || 0),
      precio_unitario: Number(i.unit_cost || 0),
      precio_total: Number(i.quantity || 0) * Number(i.unit_cost || 0),
      centro_costo: cc.name || '',
      subcentro_costo: scc.name || '',
      proveedor: supplier.business_name || '',
      estatus: i.status || ''
    };
  });
}

router.get('/:entity.csv', (req, res) => {
  const db = read();
  let rows;
  const entity = req.params.entity;
  if (entity === 'seguimiento') rows = buildSeguimiento(db);
  else if (entity === 'compras_db') rows = buildCompras(db);
  else if (entity === 'requisiciones_estado') rows = db.requisitions.map(r => ({ fecha: String(r.request_date||'').slice(0,10), semana: isoWeek(r.request_date), usuario: (db.users.find(u=>u.id===r.requester_user_id)||{}).full_name||'', folio_requisicion: r.folio, estatus: r.status, completa: r.status === 'Completada' ? 'Sí' : 'No', total: r.total_amount, moneda: r.currency }));
  else {
    const map = {
      requisitions: db.requisitions,
      requisition_items: db.requisition_items,
      suppliers: db.suppliers,
      items: db.catalog_items,
      quotations: db.quotations,
      purchase_orders: db.purchase_orders,
      invoices: db.invoices,
      payments: db.payments,
      inventory_items: db.inventory_items,
      users: db.users.map(u => ({ ...u, password_hash: undefined }))
    };
    rows = map[entity];
  }
  if (!rows) return res.status(404).json({ error: 'Exportación no disponible' });
  const q = req.query || {};
  if (q.fecha_inicio) rows = rows.filter(r => !r.fecha || r.fecha >= q.fecha_inicio);
  if (q.fecha_fin) rows = rows.filter(r => !r.fecha || r.fecha <= q.fecha_fin);
  if (q.usuario) rows = rows.filter(r => String(r.usuario || '').toLowerCase().includes(String(q.usuario).toLowerCase()));
  if (q.centro_costo) rows = rows.filter(r => String(r.centro_costo || '').toLowerCase().includes(String(q.centro_costo).toLowerCase()));
  if (q.proveedor) rows = rows.filter(r => String(r.proveedor || '').toLowerCase().includes(String(q.proveedor).toLowerCase()));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${entity}.csv`);
  res.send(toCsv(rows));
});

module.exports = router;
