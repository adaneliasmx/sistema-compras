const express = require('express');
const path = require('path');
const multer = require('multer');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, recalcRequisition } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

// ── Upload de comprobantes de pago ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(process.cwd(), 'storage/payments');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ── Helper: días de crédito y vencimiento ─────────────────────────────────────
function enrichInvoice(inv, db) {
  const supplier = db.suppliers.find(s => s.id === inv.supplier_id) || {};
  const po = db.purchase_orders.find(p => p.id === inv.purchase_order_id) || {};
  const creditDays = Number(inv.credit_days || 0);
  const invoiceDate = inv.created_at ? new Date(inv.created_at) : null;
  let dueDate = null;
  let daysOverdue = null;
  if (invoiceDate && creditDays > 0) {
    dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + creditDays);
    daysOverdue = Math.floor((new Date() - dueDate) / (1000 * 60 * 60 * 24));
  }
  return {
    ...inv,
    supplier_name: supplier.business_name || '',
    supplier_email: supplier.email || '',
    po_folio: po.folio || '',
    due_date: dueDate ? dueDate.toISOString().slice(0, 10) : null,
    days_overdue: daysOverdue,
    balance: Number(inv.total || 0) - Number(inv.paid_amount || 0)
  };
}

// ── Facturas pendientes de pago (pagos / comprador) ───────────────────────────
router.get('/pending-invoices', allowRoles('pagos', 'comprador', 'admin'), (req, res) => {
  const db = read();
  const rows = db.invoices
    .filter(i => i.status !== 'Pagada')
    .map(i => enrichInvoice(i, db))
    .sort((a, b) => (b.days_overdue || -999) - (a.days_overdue || -999)); // más vencidas primero
  res.json(rows);
});

// ── Facturas del proveedor (seguimiento) ──────────────────────────────────────
router.get('/my-invoices', (req, res) => {
  const db = read();
  if (!req.user.supplier_id) return res.status(403).json({ error: 'Solo proveedores' });
  const rows = db.invoices
    .filter(i => i.supplier_id === req.user.supplier_id)
    .map(i => enrichInvoice(i, db));
  res.json(rows);
});

// ── Proveedor marca factura como urgente ──────────────────────────────────────
router.patch('/invoices/:id/urgent', (req, res) => {
  const db = read();
  const inv = db.invoices.find(i => i.id === Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (req.user.supplier_id && inv.supplier_id !== req.user.supplier_id) return res.status(403).json({ error: 'Sin permiso' });
  inv.urgent = true;
  inv.urgent_note = req.body.note || '';
  inv.urgent_at = new Date().toISOString();
  write(db);
  res.json(inv);
});

// ── Historial de pagos ────────────────────────────────────────────────────────
router.get('/', allowRoles('pagos', 'comprador', 'admin'), (req, res) => {
  const db = read();
  const rows = db.payments.map(p => {
    const inv = db.invoices.find(i => i.id === p.invoice_id) || {};
    const supplier = db.suppliers.find(s => s.id === p.supplier_id) || {};
    return {
      ...p,
      supplier_name: supplier.business_name || '',
      supplier_email: supplier.email || '',
      invoice_number: inv.invoice_number || '',
      po_folio: (db.purchase_orders.find(po => po.id === inv.purchase_order_id) || {}).folio || ''
    };
  });
  res.json(rows);
});

// ── Registrar pago (con comprobante adjunto) ──────────────────────────────────
router.post('/', allowRoles('pagos', 'admin'), upload.single('proof'), (req, res) => {
  const db = read();
  const proofFile = req.file;
  const row = {
    id: nextId(db.payments),
    invoice_id: Number(req.body.invoice_id),
    supplier_id: Number(req.body.supplier_id),
    payment_type: req.body.payment_type || 'Transferencia',
    amount: Number(req.body.amount || 0),
    reference: req.body.reference || '',
    comment: req.body.comment || '',
    delivery_date: req.body.delivery_date || null,
    credit_days: Number(req.body.credit_days || 0),
    proof_path: proofFile ? `/storage/payments/${proofFile.filename}` : null,
    proof_original: proofFile?.originalname || null,
    created_by_user_id: req.user.id,
    created_at: new Date().toISOString()
  };

  if (!row.invoice_id || !row.supplier_id || !row.amount) {
    return res.status(400).json({ error: 'Factura, proveedor y monto son requeridos' });
  }

  db.payments.push(row);

  // Actualizar factura
  const invoice = db.invoices.find(i => i.id === row.invoice_id);
  if (invoice) {
    if (row.delivery_date) invoice.delivery_date = row.delivery_date;
    if (row.credit_days) invoice.credit_days = row.credit_days;

    const paid = db.payments.filter(p => p.invoice_id === invoice.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    invoice.paid_amount = paid;
    invoice.balance = Number(invoice.total || 0) - paid;
    invoice.status = paid >= Number(invoice.total || 0) ? 'Pagada' : 'Pago parcial';

    // Actualizar PO y sus ítems
    const po = db.purchase_orders.find(x => x.id === invoice.purchase_order_id);
    if (po) {
      po.paid_amount = db.invoices.filter(i => i.purchase_order_id === po.id).reduce((sum, inv) => sum + Number(inv.paid_amount || 0), 0);
      po.status = po.paid_amount >= Number(po.total_amount || 0) && Number(po.total_amount || 0) > 0 ? 'Cerrada' : 'Pago parcial';
    }

    const poItems = db.purchase_order_items.filter(x => x.purchase_order_id === invoice.purchase_order_id);
    poItems.forEach(poLine => {
      poLine.status = invoice.status === 'Pagada' ? 'Cerrado' : 'Pago parcial';
      const reqItem = db.requisition_items.find(i => i.id === poLine.requisition_item_id);
      if (!reqItem) return;
      const oldStatus = reqItem.status;
      reqItem.status = poLine.status;
      reqItem.updated_at = new Date().toISOString();
      addHistory(db, { module: 'payments', requisition_id: reqItem.requisition_id, requisition_item_id: reqItem.id, invoice_id: invoice.id, old_status: oldStatus, new_status: reqItem.status, changed_by_user_id: req.user.id, comment: `Pago ${row.reference || row.id}` });
      recalcRequisition(db, reqItem.requisition_id);
    });
  }

  write(db);

  // Devolver mailto para notificar al proveedor
  const supplier = db.suppliers.find(s => s.id === row.supplier_id) || {};
  const inv2 = db.invoices.find(i => i.id === row.invoice_id) || {};
  const subject = `Pago registrado · Factura ${inv2.invoice_number || row.invoice_id}`;
  const body = `Estimado ${supplier.contact_name || supplier.business_name},\n\nLe informamos que se ha registrado el pago correspondiente a la factura ${inv2.invoice_number || ''}.\n\nMonto pagado: $${row.amount.toFixed(2)}\nReferencia: ${row.reference || '-'}\n\nPuede consultar el comprobante en el sistema.\n\nGracias.`;
  const mailto = `mailto:${encodeURIComponent(supplier.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  res.status(201).json({ ...row, mailto, supplier_email: supplier.email });
});

module.exports = router;
