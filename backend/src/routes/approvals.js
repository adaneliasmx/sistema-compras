const express = require('express');
const { read, write } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, getApprovalRule, recalcRequisition, canAuthorize } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

router.get('/pending', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const rows = db.requisition_items
    .filter(i => i.status === 'En autorización')
    .map(i => {
      const reqRow = db.requisitions.find(r => r.id === i.requisition_id) || {};
      const rule = getApprovalRule(db, Number(reqRow.total_amount || 0));
      return {
        ...i,
        requisition_folio: reqRow.folio,
        requisition_total: reqRow.total_amount,
        requester_name: (db.users.find(u => u.id === reqRow.requester_user_id) || {}).full_name || '',
        supplier_name: (db.suppliers.find(s => s.id === i.supplier_id) || {}).business_name || '-',
        item_name: (db.catalog_items.find(c => c.id === i.catalog_item_id) || {}).name || i.manual_item_name || '',
        approval_rule: rule?.name || null,
        approver_role: rule?.approver_role || null
      };
    })
    .filter(r => req.user.role_code === 'admin' || !r.approver_role || r.approver_role === req.user.role_code);
  res.json(rows);
});

function updateDecision(req, res, status) {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  const rule = getApprovalRule(db, Number(reqRow?.total_amount || 0));
  if (!canAuthorize(req.user, rule)) return res.status(403).json({ error: 'No puedes autorizar esta solicitud' });
  // Un usuario no puede aprobar su propia requisición (conflicto de interés)
  if (req.user.role_code !== 'admin' && reqRow?.requester_user_id === req.user.id) {
    return res.status(403).json({ error: 'No puedes autorizar una requisición que tú mismo solicitaste.' });
  }
  const oldStatus = line.status;
  line.status = status;
  line.updated_at = new Date().toISOString();
  addHistory(db, {
    module: 'approvals',
    requisition_id: line.requisition_id,
    requisition_item_id: line.id,
    old_status: oldStatus,
    new_status: status,
    changed_by_user_id: req.user.id,
    comment: req.body.comment || ''
  });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json({ ok: true, status });
}

router.post('/items/:id/approve', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => updateDecision(req, res, 'Autorizado'));
router.post('/items/:id/reject', allowRoles('autorizador', 'comprador', 'pagos', 'admin'), (req, res) => updateDecision(req, res, 'Rechazado'));

module.exports = router;
