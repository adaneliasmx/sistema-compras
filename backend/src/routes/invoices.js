const express = require('express');
const path = require('path');
const multer = require('multer');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, recalcRequisition } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

// ── Configuración de subida de archivos ───────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(process.cwd(), 'storage/invoices');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, safe);
  }
});
const fileFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.xml'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, allowed.includes(ext));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Listar facturas ───────────────────────────────────────────────────────────
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

// ── Solicitar factura al proveedor (comprador notifica) ───────────────────────
router.post('/request/:po_id', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.po_id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  const supplier = db.suppliers.find(s => s.id === po.supplier_id);
  if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });
  po.invoice_requested = true;
  po.invoice_requested_at = new Date().toISOString();
  po.invoice_requested_by = req.user.id;
  write(db);
  const subject = `Solicitud de factura · ${po.folio}`;
  const body = `Estimado ${supplier.contact_name || supplier.business_name},\n\nLe solicitamos amablemente registrar la factura correspondiente a la Orden de Compra ${po.folio} en el sistema.\n\nGracias.`;
  const mailto = `mailto:${encodeURIComponent(supplier.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  res.json({ ok: true, mailto, supplier_email: supplier.email });
});

// ── Registrar factura (proveedor o comprador, con archivos adjuntos) ──────────
router.post('/', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'xml', maxCount: 1 }]), (req, res) => {
  const db = read();
  const isSupplier = req.user.role_code === 'proveedor';
  const supplierId = isSupplier ? req.user.supplier_id : Number(req.body.supplier_id || 0);
  const poId = Number(req.body.purchase_order_id);

  if (!poId || !supplierId || !req.body.invoice_number) {
    return res.status(400).json({ error: 'PO, proveedor y número de factura son requeridos' });
  }

  // Proveedor solo puede facturar sus propias POs
  if (isSupplier) {
    const po = db.purchase_orders.find(x => x.id === poId);
    if (!po || po.supplier_id !== req.user.supplier_id) {
      return res.status(403).json({ error: 'Sin permiso para esta PO' });
    }
  }

  const pdfFile = req.files?.pdf?.[0];
  const xmlFile = req.files?.xml?.[0];

  const row = {
    id: nextId(db.invoices),
    purchase_order_id: poId,
    supplier_id: supplierId,
    invoice_number: req.body.invoice_number,
    subtotal: Number(req.body.subtotal || 0),
    taxes: Number(req.body.taxes || 0),
    total: Number(req.body.total || 0) || (Number(req.body.subtotal || 0) + Number(req.body.taxes || 0)),
    status: 'Pendiente de pago',
    pdf_path: pdfFile ? `/storage/invoices/${pdfFile.filename}` : null,
    xml_path: xmlFile ? `/storage/invoices/${xmlFile.filename}` : null,
    pdf_original: pdfFile?.originalname || null,
    xml_original: xmlFile?.originalname || null,
    registered_by_role: req.user.role_code,
    created_at: new Date().toISOString(),
    created_by_user_id: req.user.id
  };

  db.invoices.push(row);

  // Actualizar ítems de la PO a "Facturado"
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
