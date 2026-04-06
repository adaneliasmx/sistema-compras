const express = require('express');
const { read, write } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, getApprovalRule, recalcRequisition, canAuthorize } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

router.get('/pending', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const now = new Date();
  const rows = db.requisition_items
    .filter(i => i.status === 'En autorización')
    // Excluir pausados cuya fecha aún no llegó
    .filter(i => !i.paused_until || new Date(i.paused_until) <= now)
    .map(i => {
      const reqRow = db.requisitions.find(r => r.id === i.requisition_id) || {};
      const rule = getApprovalRule(db, Number(reqRow.total_amount || 0));
      const catItem = db.catalog_items.find(c => c.id === i.catalog_item_id);
      const winnerQuote = i.winning_quote_id ? db.quotations.find(q => q.id === i.winning_quote_id) : null;
      return {
        ...i,
        requisition_folio: reqRow.folio,
        requisition_total: reqRow.total_amount,
        requester_name: (db.users.find(u => u.id === reqRow.requester_user_id) || {}).full_name || '',
        requester_email: (db.users.find(u => u.id === reqRow.requester_user_id) || {}).email || '',
        supplier_name: (db.suppliers.find(s => s.id === i.supplier_id) || {}).business_name || '-',
        item_name: catItem?.name || i.manual_item_name || '',
        approval_rule: rule?.name || null,
        approver_role: rule?.approver_role || null,
        cost_center_name: (db.cost_centers || []).find(c => c.id === i.cost_center_id)?.name || '-',
        sub_cost_center_name: (db.sub_cost_centers || []).find(c => c.id === i.sub_cost_center_id)?.name || null,
        quote_pdf: winnerQuote?.attachment_path || null,
        quote_number: winnerQuote?.quote_number || null,
        quote_unit_cost: winnerQuote?.unit_cost || null
      };
    })
    .filter(r => req.user.role_code === 'admin' || r.approver_role === req.user.role_code);
  res.json(rows);
});

// ── Contexto detallado para el autorizador ────────────────────────────────────
router.get('/items/:id/context', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const item = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

  const reqRow = db.requisitions.find(r => r.id === item.requisition_id) || {};
  const catItem = item.catalog_item_id ? db.catalog_items.find(c => c.id === item.catalog_item_id) : null;
  const supplier = item.supplier_id ? db.suppliers.find(s => s.id === item.supplier_id) : null;
  const costCenter = (db.cost_centers || []).find(c => c.id === item.cost_center_id) || null;
  const subCostCenter = (db.sub_cost_centers || []).find(c => c.id === item.sub_cost_center_id) || null;
  const requester = db.users.find(u => u.id === reqRow.requester_user_id) || null;

  // Cotización ganadora (si existe)
  const winnerQuote = item.winning_quote_id
    ? db.quotations.find(q => q.id === item.winning_quote_id)
    : db.quotations.find(q => q.requisition_item_id === item.id && q.is_winner);

  // Todas las cotizaciones para este ítem
  const allQuotes = db.quotations
    .filter(q => q.requisition_item_id === item.id)
    .map(q => ({
      ...q,
      supplier_name: (db.suppliers.find(s => s.id === q.supplier_id) || {}).business_name || '-'
    }));

  // Historial de compras del mismo ítem de catálogo
  const purchaseHistory = catItem
    ? (db.purchase_order_items || [])
        .filter(poi => poi.catalog_item_id === catItem.id)
        .map(poi => {
          const po = db.purchase_orders.find(p => p.id === poi.purchase_order_id);
          const ri = db.requisition_items.find(r => r.id === poi.requisition_item_id);
          const req2 = ri ? db.requisitions.find(r => r.id === ri.requisition_id) : null;
          return {
            po_folio: po?.folio || '-',
            po_date: po?.created_at || null,
            supplier_name: (db.suppliers.find(s => s.id === po?.supplier_id) || {}).business_name || '-',
            quantity: poi.quantity,
            unit: poi.unit || 'pza',
            unit_cost: poi.unit_cost,
            currency: poi.currency || 'MXN',
            subtotal: Number(poi.quantity || 0) * Number(poi.unit_cost || 0),
            status: po?.status || '-',
            requisition_folio: req2?.folio || '-'
          };
        })
        .sort((a, b) => new Date(b.po_date) - new Date(a.po_date))
        .slice(0, 15)
    : [];

  // Función auxiliar: suma de gasto en un rango de fechas sobre una lista de ítems
  const sumSpend = (items, from, to) =>
    items
      .filter(ri => {
        const d = new Date(ri.updated_at || ri.created_at || 0);
        return d >= from && d < to && Number(ri.unit_cost || 0) > 0;
      })
      .reduce((s, ri) => s + Number(ri.quantity || 0) * Number(ri.unit_cost || 0), 0);

  // Ítems activos (excluir cancelados/rechazados/borrador/etapas sin precio)
  const activeItems = (db.requisition_items || []).filter(ri =>
    !['Cancelado', 'Rechazado', 'Borrador', 'En cotización', 'En autorización'].includes(ri.status) &&
    Number(ri.unit_cost || 0) > 0
  );

  const ccItems = item.cost_center_id
    ? activeItems.filter(ri => ri.cost_center_id === item.cost_center_id)
    : activeItems;

  const subCcItems = item.sub_cost_center_id
    ? activeItems.filter(ri => ri.sub_cost_center_id === item.sub_cost_center_id)
    : [];

  const now = new Date();
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // Semanal — últimas 8 semanas
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const to = new Date(now); to.setDate(to.getDate() - i * 7);
    const from = new Date(to); from.setDate(from.getDate() - 7);
    return {
      label: `S-${i + 1}`,
      from: from.toISOString().slice(0, 10),
      total: sumSpend(activeItems, from, to),
      cost_center: sumSpend(ccItems, from, to),
      sub_cost_center: item.sub_cost_center_id ? sumSpend(subCcItems, from, to) : null
    };
  }).reverse();

  // Mensual — últimos 12 meses
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return {
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      total: sumSpend(activeItems, from, to),
      cost_center: sumSpend(ccItems, from, to),
      sub_cost_center: item.sub_cost_center_id ? sumSpend(subCcItems, from, to) : null
    };
  }).reverse();

  // Anual — últimos 3 años
  const annual = Array.from({ length: 3 }, (_, i) => {
    const year = now.getFullYear() - i;
    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);
    return {
      label: String(year),
      total: sumSpend(activeItems, from, to),
      cost_center: sumSpend(ccItems, from, to),
      sub_cost_center: item.sub_cost_center_id ? sumSpend(subCcItems, from, to) : null
    };
  }).reverse();

  res.json({
    item,
    catalog_item: catItem,
    supplier,
    cost_center: costCenter,
    sub_cost_center: subCostCenter,
    requisition: reqRow,
    requester,
    winning_quote: winnerQuote || null,
    all_quotes: allQuotes,
    purchase_history: purchaseHistory,
    spending: { weekly, monthly, annual }
  });
});

// ── Autorizar ─────────────────────────────────────────────────────────────────
router.post('/items/:id/approve', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (line.status !== 'En autorización')
    return res.status(400).json({ error: `Este ítem no está pendiente de autorización (estado actual: ${line.status})` });
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  const rule = getApprovalRule(db, Number(reqRow?.total_amount || 0));
  if (!canAuthorize(req.user, rule)) return res.status(403).json({ error: 'No tienes permiso para autorizar este ítem. Verifica que tu rol coincida con la regla de autorización asignada.' });
  if (req.user.role_code !== 'admin' && reqRow?.requester_user_id === req.user.id)
    return res.status(403).json({ error: 'No puedes autorizar una requisición que tú mismo solicitaste.' });
  const oldStatus = line.status;
  line.status = 'Autorizado';
  line.paused_until = null;
  line.pause_reason = null;
  line.updated_at = new Date().toISOString();
  addHistory(db, { module: 'approvals', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: 'Autorizado', changed_by_user_id: req.user.id, comment: req.body.comment || 'Autorizado' });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json({ ok: true, status: 'Autorizado' });
});

// ── Rechazar con motivo + mailto a solicitante y comprador ────────────────────
router.post('/items/:id/reject', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  const rule = getApprovalRule(db, Number(reqRow?.total_amount || 0));
  if (!canAuthorize(req.user, rule)) return res.status(403).json({ error: 'No puedes autorizar esta solicitud' });
  if (req.user.role_code !== 'admin' && reqRow?.requester_user_id === req.user.id)
    return res.status(403).json({ error: 'No puedes rechazar una requisición que tú mismo solicitaste.' });

  const reason = (req.body.reason || req.body.comment || '').trim() || 'Sin motivo especificado';
  const oldStatus = line.status;
  line.status = 'Rechazado';
  line.reject_reason = reason;
  line.rejected_by = req.user.id;
  line.rejected_at = new Date().toISOString();
  line.paused_until = null;
  line.updated_at = new Date().toISOString();

  addHistory(db, { module: 'approvals', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: 'Rechazado', changed_by_user_id: req.user.id, comment: reason });
  recalcRequisition(db, line.requisition_id);

  // Notificación por email: solicitante + comprador
  const requester = db.users.find(u => u.id === reqRow?.requester_user_id);
  const buyer = db.users.find(u => u.role_code === 'comprador');
  const catItem = db.catalog_items.find(c => c.id === line.catalog_item_id);
  const itemName = catItem?.name || line.manual_item_name || 'Ítem';
  const emails = [requester?.email, buyer?.email].filter(Boolean).join(';');
  const subject = `Solicitud rechazada · ${reqRow?.folio || ''} · ${itemName}`;
  const body = [
    `Estimado(a) ${requester?.full_name || 'Solicitante'},`,
    ``,
    `El ítem "${itemName}" de la requisición ${reqRow?.folio || ''} ha sido rechazado.`,
    ``,
    `Motivo: ${reason}`,
    ``,
    `Rechazado por: ${req.user.full_name || req.user.email || 'Autorizador'}`,
    ``,
    `Para mayor información contacte al área de compras.`
  ].join('\n');
  const mailto = emails
    ? `mailto:${encodeURIComponent(emails)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  write(db);
  res.json({ ok: true, status: 'Rechazado', mailto, requester_email: requester?.email || null, buyer_email: buyer?.email || null });
});

// ── Pausar ítem (programar al siguiente mes u otra fecha) ─────────────────────
router.post('/items/:id/pause', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (line.status !== 'En autorización') return res.status(400).json({ error: 'Solo se pueden pausar ítems en autorización' });
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  const rule = getApprovalRule(db, Number(reqRow?.total_amount || 0));
  if (!canAuthorize(req.user, rule)) return res.status(403).json({ error: 'No tienes permiso para pausar esta solicitud' });

  const now = new Date();
  let pausedUntil;
  if (req.body.paused_until) {
    pausedUntil = new Date(req.body.paused_until);
    if (isNaN(pausedUntil.getTime())) return res.status(400).json({ error: 'Fecha de pausa inválida' });
  } else {
    // Primer día del siguiente mes por defecto
    pausedUntil = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  line.paused_until = pausedUntil.toISOString();
  line.pause_reason = (req.body.reason || 'Programado para el próximo mes').trim();
  line.paused_by = req.user.id;
  line.updated_at = new Date().toISOString();

  addHistory(db, {
    module: 'approvals',
    requisition_id: line.requisition_id,
    requisition_item_id: line.id,
    old_status: 'En autorización',
    new_status: 'En autorización',
    changed_by_user_id: req.user.id,
    comment: `Pausado hasta ${pausedUntil.toISOString().slice(0, 10)}: ${line.pause_reason}`
  });

  write(db);
  res.json({ ok: true, paused_until: line.paused_until, pause_reason: line.pause_reason });
});

// ── Autorizar todos los ítems de una requisición ─────────────────────────────
router.post('/requisitions/:id/approve-all', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const requisitionId = Number(req.params.id);
  const reqRow = db.requisitions.find(r => r.id === requisitionId);
  if (!reqRow) return res.status(404).json({ error: 'Requisición no encontrada' });
  const rule = getApprovalRule(db, Number(reqRow.total_amount || 0));
  if (!canAuthorize(req.user, rule)) return res.status(403).json({ error: 'No tienes permiso para autorizar esta requisición' });
  if (req.user.role_code !== 'admin' && reqRow.requester_user_id === req.user.id)
    return res.status(403).json({ error: 'No puedes autorizar una requisición que tú mismo solicitaste' });
  const items = db.requisition_items.filter(i => i.requisition_id === requisitionId && i.status === 'En autorización');
  if (!items.length) return res.status(400).json({ error: 'No hay ítems pendientes de autorización en esta requisición' });
  items.forEach(line => {
    const oldStatus = line.status;
    line.status = 'Autorizado';
    line.paused_until = null;
    line.pause_reason = null;
    line.updated_at = new Date().toISOString();
    addHistory(db, { module: 'approvals', requisition_id: requisitionId, requisition_item_id: line.id, old_status: oldStatus, new_status: 'Autorizado', changed_by_user_id: req.user.id, comment: req.body.comment || 'Autorizado (requisición completa)' });
  });
  recalcRequisition(db, requisitionId);
  write(db);
  res.json({ ok: true, authorized: items.length });
});

// ── Rechazar todos los ítems de una requisición ───────────────────────────────
router.post('/requisitions/:id/reject-all', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const requisitionId = Number(req.params.id);
  const reqRow = db.requisitions.find(r => r.id === requisitionId);
  if (!reqRow) return res.status(404).json({ error: 'Requisición no encontrada' });
  const rule = getApprovalRule(db, Number(reqRow.total_amount || 0));
  if (!canAuthorize(req.user, rule)) return res.status(403).json({ error: 'No tienes permiso para rechazar esta requisición' });
  if (req.user.role_code !== 'admin' && reqRow.requester_user_id === req.user.id)
    return res.status(403).json({ error: 'No puedes rechazar una requisición que tú mismo solicitaste' });
  const reason = (req.body.reason || '').trim() || 'Rechazado por el autorizador';
  const items = db.requisition_items.filter(i => i.requisition_id === requisitionId && i.status === 'En autorización');
  if (!items.length) return res.status(400).json({ error: 'No hay ítems pendientes de autorización en esta requisición' });
  const requester = db.users.find(u => u.id === reqRow.requester_user_id);
  const buyer = db.users.find(u => u.role_code === 'comprador');
  items.forEach(line => {
    const oldStatus = line.status;
    line.status = 'Rechazado';
    line.reject_reason = reason;
    line.rejected_by = req.user.id;
    line.rejected_at = new Date().toISOString();
    line.paused_until = null;
    line.updated_at = new Date().toISOString();
    addHistory(db, { module: 'approvals', requisition_id: requisitionId, requisition_item_id: line.id, old_status: oldStatus, new_status: 'Rechazado', changed_by_user_id: req.user.id, comment: reason });
  });
  recalcRequisition(db, requisitionId);
  write(db);
  const emails = [requester?.email, buyer?.email].filter(Boolean).join(';');
  const subject = `Requisición rechazada · ${reqRow.folio}`;
  const body = `Se han rechazado ${items.length} ítem(s) de la requisición ${reqRow.folio}.\n\nMotivo: ${reason}\n\nRechazado por: ${req.user.full_name || req.user.email}`;
  const mailto = emails ? `mailto:${encodeURIComponent(emails)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
  res.json({ ok: true, rejected: items.length, mailto });
});

module.exports = router;
