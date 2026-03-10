const express = require('express');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { addHistory, recalcRequisition } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const db = read();
  const rows = db.invoices
    .filter(inv => req.user.supplier_id ? inv.supplier_id === req.user.supplier_id : true)
    .map(inv => ({
      ...inv,
      supplier_name: (db.suppliers.find(s => s.id === inv.supplier_id) || {}).business_name || '',
      po_folio: (db.purchase_orders.find(po => po.id === inv.purchase_order_id) || {}).folio || ''
    }));
  res.json(rows);
});

router.post('/', (req, res) => {
  const db = read();
  const supplierId = req.user.supplier_id || Number(req.body.supplier_id);
  const row = {
    id: nextId(db.invoices),
    purchase_order_id: Number(req.body.purchase_order_id),
    supplier_id: supplierId,
    invoice_number: req.body.invoice_number,
    subtotal: Number(req.body.subtotal || 0),
    taxes: Number(req.body.taxes || 0),
    total: Number(req.body.total || 0),
    status: 'Pendiente de pago',
    xml_attached: !!req.body.xml_attached,
    pdf_attached: !!req.body.pdf_attached,
    created_at: new Date().toISOString(),
    created_by_user_id: req.user.id
  };
  if (!row.purchase_order_id || !row.supplier_id || !row.invoice_number) return res.status(400).json({ error: 'PO, proveedor y factura requeridos' });
  db.invoices.push(row);
  const poItems = db.purchase_order_items.filter(i => i.purchase_order_id === row.purchase_order_id);
  poItems.forEach(poLine => {
    poLine.status = 'Facturado';
    const reqItem = db.requisition_items.find(i => i.id === poLine.requisition_item_id);
    if (reqItem) {
      const oldStatus = reqItem.status;
      reqItem.status = 'Facturado';
      reqItem.updated_at = new Date().toISOString();
      addHistory(db, { module: 'invoices', requisition_id: reqItem.requisition_id, requisition_item_id: reqItem.id, invoice_id: row.id, old_status: oldStatus, new_status: 'Facturado', changed_by_user_id: req.user.id, comment: `Factura ${row.invoice_number}` });
      recalcRequisition(db, reqItem.requisition_id);
    }
  });
  const po = db.purchase_orders.find(x => x.id === row.purchase_order_id);
  if (po) po.status = 'Facturada';
  write(db);
  res.status(201).json(row);
});

module.exports = router;
