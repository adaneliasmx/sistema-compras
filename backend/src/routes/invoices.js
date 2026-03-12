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
    .map(inv => {
      const po = db.purchase_orders.find(p => p.id === inv.purchase_order_id) || {};
      // Sumar anticipos pagados para esta PO (facturas tipo anticipo ya pagadas)
      const advancePaid = db.invoices
        .filter(i => i.purchase_order_id === inv.purchase_order_id && i.invoice_type === 'anticipo' && i.status === 'Pagada')
        .reduce((s, i) => s + Number(i.paid_amount || i.total || 0), 0);
      return {
        ...inv,
        supplier_name: (db.suppliers.find(s => s.id === inv.supplier_id) || {}).business_name || '',
        po_folio: po.folio || '',
        po_advance_percentage: po.advance_percentage || 0,
        advance_paid_on_po: advancePaid
      };
    });
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

  // Validar número de factura único por proveedor
  const dupInvoice = db.invoices.find(i =>
    i.supplier_id === supplierId &&
    i.invoice_number.trim().toLowerCase() === req.body.invoice_number.trim().toLowerCase()
  );
  if (dupInvoice) {
    return res.status(409).json({ error: `La factura "${req.body.invoice_number}" ya fue registrada anteriormente para este proveedor.` });
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

  const invoiceType = req.body.invoice_type || 'normal'; // 'normal' | 'anticipo'
  const row = {
    id: nextId(db.invoices),
    purchase_order_id: poId,
    supplier_id: supplierId,
    invoice_number: req.body.invoice_number,
    invoice_type: invoiceType,
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

  const po = db.purchase_orders.find(x => x.id === row.purchase_order_id);

  if (invoiceType === 'anticipo') {
    // Factura de anticipo: actualizar advance_status de la PO
    if (po) {
      po.advance_status = 'Facturado';
      po.advance_invoice_id = row.id;
    }
  } else {
    // Factura normal: actualizar ítems de la PO a "Facturado"
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

    if (po) {
      // Sumar subtotales de facturas normales (excluir anticipos del cálculo de cobertura)
      const totalFacturado = db.invoices
        .filter(i => i.purchase_order_id === po.id && i.invoice_type !== 'anticipo')
        .reduce((s, i) => s + Number(i.subtotal || 0), 0);
      const poSubtotal = Number(po.total_amount || 0);
      po.status = (poSubtotal > 0 && totalFacturado >= poSubtotal * 0.95) ? 'Facturada' : 'Facturación parcial';
    }
  }

  write(db);
  res.status(201).json(row);
});

// ── Recordatorio de pago (proveedor, máx 1 por semana) ────────────────────────
router.post('/:id/reminder', allowRoles('proveedor'), (req, res) => {
  const db = read();
  const inv = db.invoices.find(i => i.id === Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (inv.supplier_id !== req.user.supplier_id) return res.status(403).json({ error: 'Sin permiso' });
  if (inv.status === 'Pagada') return res.status(400).json({ error: 'La factura ya está pagada' });

  // Regla: máximo 1 recordatorio cada 7 días
  if (inv.last_reminder_at) {
    const daysSince = Math.floor((Date.now() - new Date(inv.last_reminder_at).getTime()) / 86400000);
    if (daysSince < 7) {
      return res.status(429).json({ error: `Ya enviaste un recordatorio hace ${daysSince} día(s). Puedes volver a enviar en ${7 - daysSince} día(s).` });
    }
  }

  inv.last_reminder_at = new Date().toISOString();
  inv.reminder_count = (inv.reminder_count || 0) + 1;
  write(db);

  // Generar mailto para notificar al comprador
  const db2 = read();
  const buyer = db2.users.find(u => u.role_code === 'comprador' || u.role_code === 'pagos');
  const buyerEmail = buyer?.email || '';
  const po = db2.purchase_orders.find(p => p.id === inv.purchase_order_id);
  const subject = `Recordatorio de pago · Factura ${inv.invoice_number}`;
  const body = `Estimado equipo de finanzas,\n\nLe recordamos que la factura ${inv.invoice_number} de la PO ${po?.folio||'-'} por $${Number(inv.total||0).toFixed(2)} está pendiente de pago.\n\nAgradecemos su atención.\n\nSaludos.`;
  const mailto = `mailto:${encodeURIComponent(buyerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  res.json({ ok: true, mailto, reminder_count: inv.reminder_count, message: `Recordatorio #${inv.reminder_count} enviado` });
});

module.exports = router;
