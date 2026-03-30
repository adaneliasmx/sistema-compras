const express = require('express');
const { read } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const db = read();
  if (!db.requisition_items) db.requisition_items = [];
  if (!db.requisitions) db.requisitions = [];
  if (!db.invoices) db.invoices = [];
  if (!db.payments) db.payments = [];
  if (!db.purchase_orders) db.purchase_orders = [];
  if (!db.users) db.users = [];
  const user = req.user;
  const role = user.role_code;
  const notes = [];

  // ── Autorizador ────────────────────────────────────────────────────────────
  if (role === 'autorizador' || role === 'admin') {
    const pending = db.requisition_items.filter(i => i.status === 'En autorización');
    if (pending.length) notes.push({
      id: 'auth_pending',
      priority: 'high',
      icon: '✅',
      title: `${pending.length} ítem(s) pendientes de autorización`,
      body: 'Hay ítems esperando tu aprobación.',
      route: '#/autorizaciones',
      count: pending.length
    });
  }

  // ── Comprador ──────────────────────────────────────────────────────────────
  if (role === 'comprador' || role === 'admin') {
    const newReqs = db.requisitions.filter(r => r.status === 'Enviada');
    if (newReqs.length) notes.push({
      id: 'new_requisitions',
      priority: 'medium',
      icon: '📋',
      title: `${newReqs.length} requisición(es) nuevas por atender`,
      body: newReqs.map(r => r.folio).join(', '),
      route: '#/requisiciones',
      count: newReqs.length
    });

    const readyForPO = db.requisition_items.filter(i =>
      i.status === 'Autorizado' && i.supplier_id && Number(i.unit_cost || 0) > 0 && !i.purchase_order_id
    );
    if (readyForPO.length) notes.push({
      id: 'ready_for_po',
      priority: 'medium',
      icon: '🛒',
      title: `${readyForPO.length} ítem(s) listos para generar PO`,
      body: 'Tienen proveedor y precio asignados.',
      route: '#/compras',
      count: readyForPO.length
    });

    const needsQuote = db.requisition_items.filter(i => i.status === 'Autorizado' && (!i.supplier_id || !Number(i.unit_cost || 0)));
    if (needsQuote.length) notes.push({
      id: 'needs_quote',
      priority: 'low',
      icon: '📩',
      title: `${needsQuote.length} ítem(s) autorizados sin proveedor/precio`,
      body: 'Requieren cotización antes de generar PO.',
      route: '#/cotizaciones',
      count: needsQuote.length
    });
  }

  // ── Pagos ──────────────────────────────────────────────────────────────────
  if (role === 'pagos' || role === 'comprador' || role === 'admin') {
    const now = new Date();
    const pending = db.invoices.filter(i => i.status !== 'Pagada');
    const overdue = pending.filter(inv => {
      if (!inv.credit_days || !inv.created_at) return false;
      const due = new Date(inv.created_at);
      due.setDate(due.getDate() + Number(inv.credit_days));
      return now > due;
    });
    if (overdue.length) notes.push({
      id: 'overdue_invoices',
      priority: 'urgent',
      icon: '🚨',
      title: `${overdue.length} factura(s) vencida(s) sin pagar`,
      body: overdue.map(i => i.invoice_number).join(', '),
      route: '#/pagos',
      count: overdue.length
    });

    const urgent = pending.filter(i => i.urgent && !overdue.find(o => o.id === i.id));
    if (urgent.length) notes.push({
      id: 'urgent_invoices',
      priority: 'high',
      icon: '⚠️',
      title: `${urgent.length} factura(s) marcada(s) como urgente`,
      body: urgent.map(i => i.invoice_number).join(', '),
      route: '#/pagos',
      count: urgent.length
    });

    const pendingPayment = pending.filter(i => !overdue.find(o => o.id === i.id) && !urgent.find(u => u.id === i.id));
    if (pendingPayment.length) notes.push({
      id: 'pending_payment',
      priority: 'low',
      icon: '💳',
      title: `${pendingPayment.length} factura(s) pendiente(s) de pago`,
      body: 'Sin vencer aún.',
      route: '#/pagos',
      count: pendingPayment.length
    });
  }

  // ── Proveedor ──────────────────────────────────────────────────────────────
  if (role === 'proveedor') {
    const myPOs = db.purchase_orders.filter(p => p.supplier_id === user.supplier_id);

    // POs con solicitud de factura pendiente
    const invoiceRequested = myPOs.filter(po => po.invoice_requested);
    const invoiceRequestedNoInvoice = invoiceRequested.filter(po => {
      const hasInvoice = db.invoices.some(inv => inv.purchase_order_id === po.id && inv.supplier_id === user.supplier_id && inv.invoice_type !== 'anticipo');
      return !hasInvoice;
    });
    if (invoiceRequestedNoInvoice.length) notes.push({
      id: 'invoice_requested',
      priority: 'high',
      icon: '📄',
      title: `${invoiceRequestedNoInvoice.length} PO(s) esperan tu factura`,
      body: invoiceRequestedNoInvoice.map(p => p.folio).join(', '),
      route: '#/cotizaciones',
      count: invoiceRequestedNoInvoice.length
    });

    // Pagos recientes recibidos (últimos 7 días)
    const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const myInvIds = new Set(db.invoices.filter(i => i.supplier_id === user.supplier_id).map(i => i.id));
    const recentPayments = db.payments.filter(p => myInvIds.has(p.invoice_id) && p.created_at >= since7);
    if (recentPayments.length) notes.push({
      id: 'recent_payments',
      priority: 'low',
      icon: '✅',
      title: `${recentPayments.length} pago(s) registrado(s) esta semana`,
      body: `Monto total: $${recentPayments.reduce((s, p) => s + Number(p.amount || 0), 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
      route: '#/cotizaciones',
      count: recentPayments.length
    });
  }

  // ── Cliente requisición ────────────────────────────────────────────────────
  if (role === 'cliente_requisicion') {
    const myReqs = db.requisitions.filter(r => r.created_by_user_id === user.id);
    const myReqIds = new Set(myReqs.map(r => r.id));
    const rejectedItems = db.requisition_items.filter(i => myReqIds.has(i.requisition_id) && i.status === 'Rechazado');
    if (rejectedItems.length) notes.push({
      id: 'rejected_items',
      priority: 'medium',
      icon: '❌',
      title: `${rejectedItems.length} ítem(s) rechazado(s) en tus requisiciones`,
      body: 'Revisa el motivo de rechazo.',
      route: '#/requisiciones',
      count: rejectedItems.length
    });

    const inProgress = myReqs.filter(r => ['En cotización', 'En autorización', 'En proceso'].includes(r.status));
    if (inProgress.length) notes.push({
      id: 'in_progress',
      priority: 'low',
      icon: '🔄',
      title: `${inProgress.length} requisición(es) en proceso`,
      body: inProgress.map(r => `${r.folio}: ${r.status}`).join(' | '),
      route: '#/requisiciones',
      count: inProgress.length
    });
  }

  // ── Admin ──────────────────────────────────────────────────────────────────
  if (role === 'admin') {
    const pendingPwReqs = (db.password_reset_requests || []).filter(r => r.status === 'pending');
    if (pendingPwReqs.length) notes.push({
      id: 'pw_requests',
      priority: 'medium',
      icon: '🔑',
      title: `${pendingPwReqs.length} solicitud(es) de cambio de contraseña`,
      body: pendingPwReqs.map(r => r.user_name).join(', '),
      route: '#/admin',
      count: pendingPwReqs.length
    });
  }

  const order = { urgent: 0, high: 1, medium: 2, low: 3 };
  notes.sort((a, b) => (order[a.priority] || 3) - (order[b.priority] || 3));
  res.json(notes);
});

module.exports = router;
