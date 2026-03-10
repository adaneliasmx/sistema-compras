const express = require('express');
const { read } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const db = read();
  const role = req.user.role_code;
  const isClient = role === 'cliente_requisicion';
  const isSupplier = role === 'proveedor';
  const isAuthorizer = role === 'autorizador';

  const visibleReqs = isClient
    ? db.requisitions.filter(r => r.requester_user_id === req.user.id)
    : isSupplier
    ? []
    : isAuthorizer
    ? db.requisitions.filter(r => db.requisition_items.some(i => i.requisition_id === r.id && i.status === 'En autorización'))
    : db.requisitions;

  const visibleItems = isClient
    ? db.requisition_items.filter(i => visibleReqs.some(r => r.id === i.requisition_id))
    : isSupplier
    ? db.purchase_order_items.filter(i => {
        const po = db.purchase_orders.find(p => p.id === i.purchase_order_id);
        return po && po.supplier_id === req.user.supplier_id;
      })
    : db.requisition_items;

  const visiblePOs = isSupplier
    ? db.purchase_orders.filter(po => po.supplier_id === req.user.supplier_id)
    : db.purchase_orders;

  const totalReq = visibleReqs.length;
  const totalItems = visibleItems.length;
  const pending = isSupplier
    ? visibleItems.filter(x => x.status === 'En proceso').length
    : isAuthorizer
    ? db.requisition_items.filter(x => x.status === 'En autorización').length
    : visibleItems.filter(x => ['En cotización','En autorización','Autorizado','En proceso','Entregado','Facturado','Pago parcial'].includes(x.status)).length;
  const completed = visibleItems.filter(x => ['Cerrado','Rechazado'].includes(x.status)).length;

  const recent = visibleReqs.slice().sort((a,b)=>b.id-a.id).slice(0,5).map(r => ({
    ...r,
    requester: (db.users.find(u=>u.id===r.requester_user_id)||{}).full_name || '',
    items: db.requisition_items.filter(i=>i.requisition_id===r.id).length
  }));

  res.json({ totalReq, totalItems, pending, completed, poCount: visiblePOs.length, recent });
});

module.exports = router;
