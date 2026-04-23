function getApprovalRule(db, total) {
  const active = (db.approval_rules || [])
    .filter(r => r.active)
    .sort((a, b) => Number(a.min_amount || 0) - Number(b.min_amount || 0));
  // Retorna null si ninguna regla cubre el total — NO hay fallback a la primera regla
  // (el fallback anterior podía auto-aprobar totales fuera de rango)
  return active.find(r => total >= Number(r.min_amount || 0) && total <= Number(r.max_amount || 0))
    || null;
}

function addHistory(db, { module, requisition_id, requisition_item_id = null, purchase_order_id = null, invoice_id = null, old_status = null, new_status, changed_by_user_id = null, comment = '' }) {
  const nextId = (rows) => rows.length ? Math.max(...rows.map(x => Number(x.id) || 0)) + 1 : 1;
  db.status_history.push({
    id: nextId(db.status_history),
    module,
    requisition_id,
    requisition_item_id,
    purchase_order_id,
    invoice_id,
    old_status,
    new_status,
    changed_by_user_id,
    changed_at: new Date().toISOString(),
    comment
  });
}

function isInventoryAutoApproved(db, item) {
  if (!item.catalog_item_id) return false;
  const cat = (db.catalog_items || []).find(x => x.id === item.catalog_item_id);
  if (!cat?.inventoried) return false;
  const inv = (db.inventory_items || []).find(x => x.catalog_item_id === item.catalog_item_id && x.active !== false);
  if (!inv) return false;
  const maxAllowed = Number(inv.max_stock || 0) * 1.3;
  return Number(item.quantity || 0) <= maxAllowed;
}

function deriveItemStatus(db, requisitionTotal, item) {
  if (!Number(item.unit_cost || 0) || !item.supplier_id) return 'En cotización';
  if (isInventoryAutoApproved(db, item)) return 'Autorizado';
  const rule = getApprovalRule(db, requisitionTotal);
  if (rule?.auto_approve) return 'Autorizado';
  return 'En autorización';
}

function aggregateRequisitionStatus(items) {
  if (!items.length) return 'Enviada';
  const statuses = items.map(i => i.status);
  if (statuses.every(s => s === 'Cancelado')) return 'Cancelada';
  if (statuses.every(s => ['Rechazado','Cancelado'].includes(s))) return 'Rechazada';
  if (statuses.every(s => ['Cerrado', 'Rechazado', 'Cancelado'].includes(s))) return 'Completada';
  if (statuses.some(s => ['En proceso', 'Entregado', 'Facturado', 'Pago parcial', 'Pagada', 'Cerrado'].includes(s))) return 'En proceso';
  if (statuses.some(s => s === 'En autorización')) return 'En autorización';
  if (statuses.some(s => s === 'En cotización')) return 'En cotización';
  if (statuses.some(s => s === 'Autorizado')) return 'En proceso';
  return 'Enviada';
}

function recalcRequisition(db, requisitionId) {
  const req = (db.requisitions || []).find(r => r.id === requisitionId);
  if (!req) return null;
  const items = (db.requisition_items || []).filter(i => i.requisition_id === requisitionId);
  // Excluir ítems cancelados o rechazados del total (no representan gasto real)
  req.total_amount = items
    .filter(i => !['Cancelado', 'Rechazado'].includes(i.status))
    .reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0);
  req.status = aggregateRequisitionStatus(items);
  req.updated_at = new Date().toISOString();
  return req;
}

function canAuthorize(user, rule) {
  if (!user) return false;
  if (user.role_code === 'admin') return true;
  if (!rule) return false;
  return user.role_code === rule.approver_role;
}

module.exports = {
  getApprovalRule,
  addHistory,
  isInventoryAutoApproved,
  deriveItemStatus,
  aggregateRequisitionStatus,
  recalcRequisition,
  canAuthorize
};
