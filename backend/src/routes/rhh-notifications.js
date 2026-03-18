const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired } = require('../middleware/rhh-auth');
const router = express.Router();

// GET /api/rhh/notifications — notificaciones del empleado logueado
router.get('/', rhhAuthRequired, (req, res) => {
  const db = read();
  let list = db.rhh_notifications || [];

  const empId = req.rhhUser.employee_id;
  if (empId) {
    list = list.filter(n => n.employee_id === empId);
  } else {
    // admin sin employee_id: devuelve notificaciones de tipo admin
    list = list.filter(n => n.type === 'admin' || n.employee_id === null);
  }

  list = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);
  res.json(list);
});

// PATCH /api/rhh/notifications/read-all — marcar todas como leídas
router.patch('/read-all', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = req.rhhUser.employee_id;
  const notifications = db.rhh_notifications || [];

  for (const n of notifications) {
    if (n.employee_id === empId) n.read = true;
  }

  db.rhh_notifications = notifications;
  write(db);
  res.json({ ok: true });
});

// PATCH /api/rhh/notifications/:id — marcar como leída
router.patch('/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const id = Number(req.params.id);
  const notifications = db.rhh_notifications || [];
  const idx = notifications.findIndex(n => n.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Notificación no encontrada' });

  notifications[idx] = { ...notifications[idx], read: true };
  db.rhh_notifications = notifications;
  write(db);
  res.json({ ok: true, notification: notifications[idx] });
});

module.exports = router;
