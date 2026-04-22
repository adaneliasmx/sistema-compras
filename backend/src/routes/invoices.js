const express = require('express');
const path = require('path');
const crypto = require('crypto');
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

  const baseUrl = process.env.APP_URL || 'https://sistema-compras.onrender.com';
  const secret = process.env.JWT_SECRET || 'cambia-esta-clave';
  const token = crypto.createHmac('sha256', secret).update(`po:${po.id}:${po.folio}`).digest('hex').slice(0, 32);

  // Ítems de la PO
  const poItems = (db.purchase_order_items || []).filter(i => i.purchase_order_id === po.id);
  const itemLines = poItems.map((item, idx) => {
    const name = item.description || (db.catalog_items.find(c => c.id === item.catalog_item_id) || {}).name || item.manual_item_name || 'Artículo';
    const subtotal = (Number(item.quantity || 0) * Number(item.unit_cost || 0)).toFixed(2);
    return `  ${idx + 1}. ${name}\n     Cant: ${item.quantity} ${item.unit || ''}   P.U.: $${Number(item.unit_cost || 0).toFixed(2)} ${po.currency || 'MXN'}   Subtotal: $${subtotal}`;
  }).join('\n\n');

  const subject = `Solicitud de factura · ${po.folio}`;
  const body = [
    `Estimado(a) ${supplier.contact_name || supplier.business_name},`,
    ``,
    `Le solicitamos amablemente emitir la factura correspondiente a la siguiente Orden de Compra:`,
    ``,
    `── Datos de la Orden de Compra ──────────────────────────`,
    `Folio:   ${po.folio}`,
    `Fecha:   ${String(po.created_at || '').slice(0, 10)}`,
    `Moneda:  ${po.currency || 'MXN'}`,
    ``,
    `── Ítems a facturar (${poItems.length}) ──────────────────────────────`,
    itemLines || '  (Ver detalle en el sistema)',
    ``,
    `────────────────────────────────────────────────────────`,
    `Total de la orden: $${Number(po.total_amount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${po.currency || 'MXN'}`,
    ``,
    `► Para cargar su factura (PDF y XML) ingrese al sistema:`,
    `${baseUrl}/#/cotizaciones`,
    ``,
    `► Ver detalle de esta orden:`,
    `${baseUrl}/api/public/po/${token}`,
    ``,
    `Por favor incluya el folio ${po.folio} en su factura.`,
    ``,
    `Gracias por su atención.`
  ].join('\n');

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

  // Si el proveedor sube la factura, generar mailto de notificación al área de compras
  let mailto_comprador = null;
  if (req.user.role_code === 'proveedor') {
    const buyers = (db.users || []).filter(u => (u.role_code === 'comprador' || u.role_code === 'pagos') && u.active !== false);
    const buyerEmails = buyers.map(u => u.email).filter(Boolean).join(',');
    if (buyerEmails && po) {
      const supplier2 = (db.suppliers || []).find(s => s.id === po.supplier_id) || {};
      const baseUrl = process.env.APP_URL || 'https://sistema-compras.onrender.com';
      const notifSubject = `Factura registrada · ${po.folio} · ${row.invoice_number}`;
      const notifBody = [
        `Estimado(a) equipo de compras,`,
        ``,
        `El proveedor ${supplier2.business_name || ''} ha registrado una factura en el sistema.`,
        ``,
        `── Datos ────────────────────────────────────────────`,
        `PO:          ${po.folio}`,
        `Factura:     ${row.invoice_number}`,
        `Tipo:        ${invoiceType === 'anticipo' ? 'Anticipo' : 'Normal'}`,
        `Subtotal:    $${Number(row.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
        `IVA:         $${Number(row.taxes || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
        `Total:       $${Number(row.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
        `PDF:         ${row.pdf_original || 'No adjunto'}`,
        `XML:         ${row.xml_original || 'No adjunto'}`,
        ``,
        `► Revisar en el sistema:`,
        `${baseUrl}/#/facturacion`,
        `────────────────────────────────────────────────────`
      ].join('\n');
      mailto_comprador = `mailto:${encodeURIComponent(buyerEmails)}?subject=${encodeURIComponent(notifSubject)}&body=${encodeURIComponent(notifBody)}`;
    }
  }

  res.status(201).json({ ...row, mailto_comprador });
});

// ── Factura mensual agrupada (múltiples POs del mismo proveedor) ──────────────
router.post('/monthly', allowRoles('comprador', 'proveedor', 'admin'), upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'xml', maxCount: 1 }]), (req, res) => {
  const db = read();
  const isSupplier = req.user.role_code === 'proveedor';
  const supplierId = isSupplier ? req.user.supplier_id : Number(req.body.supplier_id || 0);
  const poIds = JSON.parse(req.body.po_ids || '[]').map(Number).filter(Boolean);

  if (!poIds.length) return res.status(400).json({ error: 'Selecciona al menos una PO' });
  if (!supplierId) return res.status(400).json({ error: 'Proveedor requerido' });
  if (!req.body.invoice_number) return res.status(400).json({ error: 'Número de factura requerido' });

  // Validar que todas las POs pertenezcan al proveedor
  const selectedPOs = poIds.map(id => db.purchase_orders.find(p => p.id === id)).filter(Boolean);
  if (isSupplier && selectedPOs.some(p => p.supplier_id !== supplierId)) {
    return res.status(403).json({ error: 'Solo puedes facturar tus propias órdenes' });
  }

  const pdfFile = req.files?.pdf?.[0];
  const xmlFile = req.files?.xml?.[0];

  const row = {
    id: nextId(db.invoices),
    purchase_order_id: poIds[0],
    grouped_po_ids: poIds,
    supplier_id: supplierId,
    invoice_number: req.body.invoice_number,
    invoice_type: 'mensual',
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

  // Actualizar todas las POs y sus ítems a Facturado
  selectedPOs.forEach(po => {
    const poItems = db.purchase_order_items.filter(i => i.purchase_order_id === po.id);
    poItems.forEach(poLine => {
      poLine.status = 'Facturado';
      const reqItem = db.requisition_items.find(i => i.id === poLine.requisition_item_id);
      if (reqItem) {
        reqItem.status = 'Facturado';
        reqItem.updated_at = new Date().toISOString();
        addHistory(db, { module: 'invoices', requisition_id: reqItem.requisition_id, requisition_item_id: reqItem.id, invoice_id: row.id, old_status: reqItem.status, new_status: 'Facturado', changed_by_user_id: req.user.id, comment: `Factura mensual ${row.invoice_number}` });
        recalcRequisition(db, reqItem.requisition_id);
      }
    });
    po.status = 'Facturada';
    po.updated_at = new Date().toISOString();
  });

  write(db);

  // Notificación al área de compras si lo sube el proveedor
  let mailto_comprador = null;
  if (isSupplier) {
    const buyers = (db.users || []).filter(u => (u.role_code === 'comprador' || u.role_code === 'pagos') && u.active !== false);
    const buyerEmails = buyers.map(u => u.email).filter(Boolean).join(',');
    if (buyerEmails) {
      const supplier2 = (db.suppliers || []).find(s => s.id === supplierId) || {};
      const baseUrl = process.env.APP_URL || 'https://sistema-compras.onrender.com';
      const poFolios = selectedPOs.map(p => p.folio).join(', ');
      const notifSubject = `Factura mensual registrada · ${row.invoice_number} · ${supplier2.business_name || ''}`;
      const notifBody = [
        `Estimado(a) equipo de compras,`,
        ``,
        `El proveedor ${supplier2.business_name || ''} ha registrado una factura mensual en el sistema.`,
        ``,
        `Factura: ${row.invoice_number}`,
        `POs cubiertas: ${poFolios}`,
        `Total: $${Number(row.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
        ``,
        `► Revisar en el sistema: ${baseUrl}/#/facturacion`
      ].join('\n');
      mailto_comprador = `mailto:${encodeURIComponent(buyerEmails)}?subject=${encodeURIComponent(notifSubject)}&body=${encodeURIComponent(notifBody)}`;
    }
  }

  res.status(201).json({ ...row, mailto_comprador });
});

// ── Detalle de factura con ítems de PO y trazabilidad ────────────────────────
router.get('/:id', (req, res) => {
  const db = read();
  const inv = db.invoices.find(i => i.id === Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (req.user.supplier_id && inv.supplier_id !== req.user.supplier_id)
    return res.status(403).json({ error: 'Sin permiso' });

  const po = db.purchase_orders.find(p => p.id === inv.purchase_order_id) || {};
  const supplier = db.suppliers.find(s => s.id === inv.supplier_id) || {};

  const poItems = db.purchase_order_items
    .filter(i => i.purchase_order_id === inv.purchase_order_id)
    .map(item => {
      const reqItem = db.requisition_items.find(r => r.id === item.requisition_item_id) || {};
      return {
        id: item.id,
        description: reqItem.description || item.description || '-',
        quantity: item.quantity,
        unit: item.unit || reqItem.unit || '',
        unit_cost: item.unit_cost,
        subtotal: Number(item.quantity || 0) * Number(item.unit_cost || 0)
      };
    });

  const creditDays = Number(inv.credit_days || 0);
  const invoiceDate = inv.created_at ? new Date(inv.created_at) : null;
  let dueDate = null;
  let daysRemaining = null;
  if (invoiceDate && creditDays > 0) {
    dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + creditDays);
    daysRemaining = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
  }

  const payments = db.payments
    .filter(p => p.invoice_id === inv.id)
    .map(p => ({ id: p.id, amount: p.amount, payment_type: p.payment_type, reference: p.reference, created_at: p.created_at, proof_path: p.proof_path }));

  res.json({
    ...inv,
    supplier_name: supplier.business_name || '',
    supplier_email: supplier.email || '',
    po_folio: po.folio || '',
    po_items: poItems,
    due_date: dueDate ? dueDate.toISOString().slice(0, 10) : null,
    days_remaining: daysRemaining,
    payments
  });
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
