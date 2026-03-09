const express = require('express');
const { read } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);
router.get('/', (req, res) => {
  const db = read();
  const totalReq = db.requisitions.length;
  const totalItems = db.requisition_items.length;
  const pending = db.requisition_items.filter(x => ['Enviada','En cotización','En autorización','Autorizado','PO generada'].includes(x.status)).length;
  const completed = db.requisition_items.filter(x => x.status === 'Cerrado').length;
  const recent = db.requisitions.slice().sort((a,b)=>b.id-a.id).slice(0,5).map(r => ({
    ...r,
    requester: (db.users.find(u=>u.id===r.requester_user_id)||{}).full_name || '',
    items: db.requisition_items.filter(i=>i.requisition_id===r.id).length
  }));
  res.json({ totalReq, totalItems, pending, completed, recent });
});
module.exports = router;
