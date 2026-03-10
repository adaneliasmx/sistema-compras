const express = require('express');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, recalcRequisition } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

router.get('/pending-invoices', allowRoles('pagos', 'comprador', 'admin'), (req, res) => {
  const db = read();
  const rows = db.invoices.filter(i => i.status !== 'Pagada').map(i => ({
    ...i,
    supplier_name: (db.suppliers.find(s => s.id === i.supplier_id) || {}).business_name || ''
  }));
  res.json(rows);
});

router.get('/', allowRoles('pagos', 'comprador', 'admin'), (req, res) => {
  const db = read();
  res.json(db.payments.map(p => ({
    ...p,
    supplier_name: (db.suppliers.find(s => s.id === p.supplier_id) || {}).business_name || '',
    invoice_number: (db.invoices.find(i => i.id === p.invoice_id) || {}).invoice_number || ''
  })));
});

router.post('/', allowRoles('pagos', 'admin'), (req, res) => {
  const db = read();
  const row = {
    id: nextId(db.payments),
    invoice_id: Number(req.body.invoice_id),
    supplier_id: Number(req.body.supplier_id),
    payment_type: req.body.payment_type || 'Pago',
    amount: Number(req.body.amount || 0),
    reference: req.body.reference || '',
    comment: req.body.comment || '',
    created_by_user_id: req.user.id,
    created_at: new Date().toISOString()
  };
  if (!row.invoice_id || !row.supplier_id || !row.amount) return res.status(400).json({ error: 'Factura, proveedor y monto requeridos' });
  db.payments.push(row);
  const invoice = db.invoices.find(i => i.id === row.invoice_id);
  if (invoice) {
    const paid = db.payments.filter(p => p.invoice_id === invoice.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    invoice.paid_amount = paid;
    invoice.balance = Number(invoice.total || 0) - paid;
    invoice.status = paid >= Number(invoice.total || 0) ? 'Pagada' : 'Pago parcial';
    const po = db.purchase_orders.find(x => x.id === invoice.purchase_order_id);
    if (po) {
      po.paid_amount = (db.invoices.filter(i => i.purchase_order_id === po.id).reduce((sum, inv) => sum + Number(inv.paid_amount || 0), 0));
      const poTotal = Number(po.total_amount || 0);
      po.status = po.paid_amount >= poTotal && poTotal > 0 ? 'Pagada' : 'Pago parcial';
    }
    const poItems = db.purchase_order_items.filter(x => x.purchase_order_id === invoice.purchase_order_id);
    poItems.forEach(poLine => {
      poLine.status = invoice.status === 'Pagada' ? 'Cerrado' : 'Pago parcial';
      const reqItem = db.requisition_items.find(i => i.id === poLine.requisition_item_id);
      if (!reqItem) return;
      const oldStatus = reqItem.status;
      reqItem.status = invoice.status === 'Pagada' ? 'Cerrado' : 'Pago parcial';
      reqItem.updated_at = new Date().toISOString();
      addHistory(db, { module: 'payments', requisition_id: reqItem.requisition_id, requisition_item_id: reqItem.id, invoice_id: invoice.id, old_status: oldStatus, new_status: reqItem.status, changed_by_user_id: req.user.id, comment: `Pago ${row.reference}` });
      recalcRequisition(db, reqItem.requisition_id);
    });
  }
  write(db);
  res.status(201).json(row);
});

module.exports = router;
