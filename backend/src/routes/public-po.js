/**
 * Rutas públicas de Orden de Compra (sin autenticación)
 * Permite al proveedor:
 *   GET  /api/public/po/:token  → datos de la PO
 *   POST /api/public/po/:token/confirm-date  → confirmar fecha compromiso
 */
const express = require('express');
const crypto = require('crypto');
const { read, write } = require('../db');

const router = express.Router();

// ─── Token helpers ────────────────────────────────────────────────────────────

function poToken(po) {
  const secret = process.env.JWT_SECRET || 'cambia-esta-clave';
  return crypto
    .createHmac('sha256', secret)
    .update(`po:${po.id}:${po.folio}`)
    .digest('hex')
    .slice(0, 32);
}

function verifyToken(token, po) {
  const expected = poToken(po);
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Resolver PO desde token (usado en ambos endpoints) ──────────────────────

function resolvePO(token, db) {
  // Buscar la PO cuyo token HMAC coincida
  return (db.purchase_orders || []).find(po => verifyToken(token, po)) || null;
}

// ─── Enriquecer ítems de la PO con datos de requisición ──────────────────────

function enrichItems(db, po) {
  const poItems = (db.purchase_order_items || []).filter(i => i.purchase_order_id === po.id);
  return poItems.map(item => {
    const cat = (db.catalog_items || []).find(c => c.id === item.catalog_item_id) || {};
    const reqItem = (db.requisition_items || []).find(ri => ri.id === item.requisition_item_id) || {};
    const req = reqItem.requisition_id
      ? (db.requisitions || []).find(r => r.id === reqItem.requisition_id) || {}
      : {};
    return {
      id: item.id,
      code: cat.code || '—',
      name: cat.name || item.description || item.manual_item_name || '—',
      quantity: item.quantity,
      unit: item.unit || '',
      unit_cost: item.unit_cost,
      subtotal: item.subtotal,
      currency: item.currency || po.currency || 'MXN',
      urgency: req.urgency || '—',
      estimated_date: req.programmed_date || '—'
    };
  });
}

// ─── GET /api/public/po/:token ────────────────────────────────────────────────

router.get('/:token', (req, res) => {
  const db = read();
  const po = resolvePO(req.params.token, db);

  // Devolver 404 tanto si token inválido como si PO no existe (no revelar info)
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada o enlace inválido' });

  const supplier = (db.suppliers || []).find(s => s.id === po.supplier_id) || {};
  const items = enrichItems(db, po);

  const CLOSED_STATUSES = ['Cancelada', 'Entregado', 'Facturada'];
  const can_confirm = !CLOSED_STATUSES.includes(po.status);

  res.json({
    po: {
      folio: po.folio,
      status: po.status,
      currency: po.currency || 'MXN',
      total_amount: po.total_amount,
      created_at: String(po.created_at || '').slice(0, 10),
      supplier_commitment_date: po.supplier_commitment_date || null,
      supplier_note: po.supplier_note || null
    },
    supplier: {
      business_name: supplier.business_name || '',
      contact_name: supplier.contact_name || '',
      email: supplier.email || ''
    },
    items,
    can_confirm
  });
});

// ─── POST /api/public/po/:token/confirm-date ──────────────────────────────────

router.post('/:token/confirm-date', (req, res) => {
  const { commitment_date } = req.body || {};

  // Validar formato YYYY-MM-DD
  if (!commitment_date || !/^\d{4}-\d{2}-\d{2}$/.test(commitment_date)) {
    return res.status(400).json({ error: 'Fecha inválida. Formato requerido: YYYY-MM-DD' });
  }

  // Validar que la fecha sea hoy o futura
  const today = new Date().toISOString().slice(0, 10);
  if (commitment_date < today) {
    return res.status(400).json({ error: 'La fecha compromiso debe ser hoy o una fecha futura' });
  }

  const db = read();
  const po = resolvePO(req.params.token, db);
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada o enlace inválido' });

  const CLOSED_STATUSES = ['Cancelada', 'Entregado', 'Facturada'];
  if (CLOSED_STATUSES.includes(po.status)) {
    return res.status(400).json({ error: `No se puede confirmar fecha en una PO con estado "${po.status}"` });
  }

  po.supplier_commitment_date = commitment_date;
  po.updated_at = new Date().toISOString();
  write(db);

  res.json({ ok: true, commitment_date, message: 'Fecha compromiso registrada correctamente' });
});

module.exports = router;
module.exports.poToken = poToken; // Exportar para usar en purchases.js
