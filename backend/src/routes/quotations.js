const express = require('express');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, deriveItemStatus, recalcRequisition } = require('../utils/workflow');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const quotationsUploadDir = path.join(__dirname, '../../../storage/quotations');
fs.mkdirSync(quotationsUploadDir, { recursive: true });
const quotationStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, quotationsUploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
});
const quotationUpload = multer({ storage: quotationStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();
router.use(authRequired);

router.get('/', allowRoles('proveedor', 'comprador', 'admin'), (req, res) => {
  const db = read();
  const rows = db.quotations
    .filter(q => req.user.supplier_id ? q.supplier_id === req.user.supplier_id : true)
    .map(q => ({
      ...q,
      supplier_name: (db.suppliers.find(s => s.id === q.supplier_id) || {}).business_name || '',
      item_name: (db.catalog_items.find(i => i.id === q.catalog_item_id) || {}).name || q.official_item_name || '',
      requisition_folio: (() => {
        const ri = db.requisition_items.find(i => i.id === q.requisition_item_id);
        return ri ? (db.requisitions.find(r => r.id === ri.requisition_id) || {}).folio || '' : '';
      })()
    }));
  res.json(rows);
});

// Solicitudes de cotización pendientes para el proveedor logueado
router.get('/my-requests', allowRoles('proveedor'), (req, res) => {
  const db = read();
  const supplierId = req.user.supplier_id;
  if (!supplierId) return res.status(400).json({ error: 'Sin proveedor asignado al usuario' });
  const requests = (db.quotation_requests || [])
    .filter(r => r.supplier_id === supplierId)
    .map(r => {
      const item = db.requisition_items.find(i => i.id === r.requisition_item_id);
      const reqRow = item ? db.requisitions.find(re => re.id === item.requisition_id) : null;
      const catItem = item?.catalog_item_id ? db.catalog_items.find(c => c.id === item.catalog_item_id) : null;
      const existingQuote = db.quotations.find(q => q.requisition_item_id === r.requisition_item_id && q.supplier_id === supplierId);
      return {
        ...r,
        item_name: catItem?.name || item?.manual_item_name || '-',
        item_description: catItem?.description || '',
        requisition_folio: reqRow?.folio || '-',
        quantity: item?.quantity || 0,
        unit: item?.unit || 'pza',
        currency: item?.currency || 'MXN',
        has_quote: !!existingQuote,
        quote_status: existingQuote?.status || null
      };
    });
  res.json(requests);
});

router.get('/by-item/:itemId', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const itemId = Number(req.params.itemId);
  const quotes = db.quotations
    .filter(q => q.requisition_item_id === itemId)
    .map(q => ({
      ...q,
      supplier_name: (db.suppliers.find(s => s.id === q.supplier_id) || {}).business_name || '',
      is_winner: q.is_winner === true
    }))
    .sort((a, b) => Number(a.unit_cost || 0) - Number(b.unit_cost || 0));
  res.json(quotes);
});

router.post('/', allowRoles('proveedor', 'comprador', 'admin'), quotationUpload.single('attachment'), (req, res) => {
  const db = read();
  const supplierId = req.user.supplier_id || Number(req.body.supplier_id);
  if (!supplierId) return res.status(400).json({ error: 'Proveedor requerido' });

  if (req.user.role_code === 'proveedor') {
    const requests = db.quotation_requests || [];
    const hasRequest = requests.some(r =>
      r.requisition_item_id === Number(req.body.requisition_item_id) &&
      r.supplier_id === supplierId
    );
    if (!hasRequest) return res.status(403).json({ error: 'No tienes una solicitud de cotización para este ítem' });
  }

  const row = {
    id: nextId(db.quotations),
    requisition_item_id: Number(req.body.requisition_item_id),
    supplier_id: supplierId,
    catalog_item_id: req.body.catalog_item_id ? Number(req.body.catalog_item_id) : null,
    official_item_name: req.body.official_item_name || '',
    provider_code: req.body.provider_code || '',
    delivery_days: Number(req.body.delivery_days || 0),
    quote_number: req.body.quote_number || '',
    has_credit: !!req.body.has_credit,
    credit_days: Number(req.body.credit_days || 0),
    advance_percentage: Number(req.body.advance_percentage || 0),
    payment_terms: req.body.payment_terms || '',
    unit_cost: Number(req.body.unit_cost || 0),
    currency: req.body.currency || 'MXN',
    is_winner: false,
    status: 'Cotizada',
    created_at: new Date().toISOString(),
    created_by_user_id: req.user.id,
    attachment_path: req.file ? `/storage/quotations/${req.file.filename}` : null
  };

  if (!row.requisition_item_id || !row.supplier_id) {
    return res.status(400).json({ error: 'Ítem y proveedor requeridos' });
  }
  if (Number(row.unit_cost) <= 0) {
    return res.status(400).json({ error: 'El costo unitario debe ser mayor a cero.' });
  }
  if (Number(row.delivery_days) < 0) {
    return res.status(400).json({ error: 'Los días de entrega no pueden ser negativos.' });
  }

  db.quotation_requests = db.quotation_requests || [];
  const qr = db.quotation_requests.find(r =>
    r.requisition_item_id === row.requisition_item_id && r.supplier_id === supplierId
  );
  if (qr) qr.status = 'Recibida';

  db.quotations.push(row);

  const reqItem = db.requisition_items.find(i => i.id === row.requisition_item_id);
  if (reqItem) {
    const oldStatus = reqItem.status;
    reqItem.updated_at = new Date().toISOString();
    addHistory(db, {
      module: 'quotations',
      requisition_id: reqItem.requisition_id,
      requisition_item_id: reqItem.id,
      old_status: oldStatus,
      new_status: reqItem.status,
      changed_by_user_id: req.user.id,
      comment: `Cotización registrada por ${(db.suppliers.find(s=>s.id===supplierId)||{}).business_name||supplierId}`
    });
    recalcRequisition(db, reqItem.requisition_id);
  }

  write(db);
  res.status(201).json(row);
});

// Seleccionar cotización ganadora
router.post('/:id/select-winner', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const quoteId = Number(req.params.id);
  const winner = db.quotations.find(q => q.id === quoteId);
  if (!winner) return res.status(404).json({ error: 'Cotización no encontrada' });

  db.quotations
    .filter(q => q.requisition_item_id === winner.requisition_item_id)
    .forEach(q => { q.is_winner = false; });

  winner.is_winner = true;
  winner.selected_at = new Date().toISOString();
  winner.selected_by_user_id = req.user.id;

  const reqItem = db.requisition_items.find(i => i.id === winner.requisition_item_id);
  if (reqItem) {
    const oldStatus = reqItem.status;
    reqItem.supplier_id = winner.supplier_id;
    reqItem.unit_cost = winner.unit_cost;
    reqItem.currency = winner.currency || reqItem.currency || 'MXN';
    if (!reqItem.catalog_item_id && winner.catalog_item_id) reqItem.catalog_item_id = winner.catalog_item_id;
    reqItem.winning_quote_id = winner.id;
    reqItem.delivery_days = winner.delivery_days;
    reqItem.payment_terms = winner.payment_terms;

    // 1. Recalcular total de la requisición con el nuevo unit_cost ya asignado
    recalcRequisition(db, reqItem.requisition_id);
    const reqRow = db.requisitions.find(r => r.id === reqItem.requisition_id);
    // 2. Derivar status con el total correcto
    reqItem.status = deriveItemStatus(db, Number(reqRow?.total_amount || 0), reqItem);
    reqItem.updated_at = new Date().toISOString();

    addHistory(db, {
      module: 'quotations',
      requisition_id: reqItem.requisition_id,
      requisition_item_id: reqItem.id,
      old_status: oldStatus,
      new_status: reqItem.status,
      changed_by_user_id: req.user.id,
      comment: `Cotización ganadora: ${(db.suppliers.find(s=>s.id===winner.supplier_id)||{}).business_name||''} · $${winner.unit_cost} · Entrega: ${winner.delivery_days} días`
    });
    // 3. Recalcular de nuevo para que el status de la requisición refleje el nuevo status del ítem
    recalcRequisition(db, reqItem.requisition_id);

    // Cancelar solicitudes pendientes de otros proveedores para este ítem
    (db.quotation_requests || [])
      .filter(r => r.requisition_item_id === winner.requisition_item_id && r.supplier_id !== winner.supplier_id && r.status === 'Pendiente')
      .forEach(r => { r.status = 'Cancelada'; r.cancelled_at = new Date().toISOString(); });

    // Auto-registrar en catálogo si no tiene código de ítem
    if (!reqItem.catalog_item_id && winner.unit_cost) {
      const existingName = (winner.official_item_name || reqItem.manual_item_name || '').toLowerCase().trim();
      const alreadyInCatalog = existingName && db.catalog_items.find(c => (c.name || '').toLowerCase().trim() === existingName);
      if (!alreadyInCatalog && existingName) {
        const maxCode = db.catalog_items.reduce((max, c) => {
          const n = parseInt((c.code || '').replace(/^ITM-/i, ''), 10);
          return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newCode = `ITM-${String(maxCode + 1).padStart(4, '0')}`;
        const newItem = {
          id: nextId(db.catalog_items),
          code: newCode,
          name: winner.official_item_name || reqItem.manual_item_name || '',
          item_type: 'uso continuo',
          unit: reqItem.unit || 'pza',
          supplier_id: winner.supplier_id,
          equivalent_code: winner.provider_code || '',
          unit_price: winner.unit_cost,
          currency: winner.currency || 'MXN',
          quote_validity_days: 30,
          active: true,
          inventoried: false,
          cost_center_id: reqItem.cost_center_id || null,
          sub_cost_center_id: reqItem.sub_cost_center_id || null,
          created_from_quotation: winner.id
        };
        db.catalog_items.push(newItem);
        reqItem.catalog_item_id = newItem.id;
        winner.catalog_item_id = newItem.id;
      } else if (alreadyInCatalog) {
        reqItem.catalog_item_id = alreadyInCatalog.id;
        winner.catalog_item_id = alreadyInCatalog.id;
      }
    }
  }

  write(db);
  res.json({
    winner,
    requisition_item: reqItem,
    message: `Cotización de ${(db.suppliers.find(s=>s.id===winner.supplier_id)||{}).business_name||''} seleccionada como ganadora`
  });
});

// Dar de alta ítem a catálogo desde cotización ganadora
router.post('/:id/register-catalog-from-winner', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const winner = db.quotations.find(q => q.id === Number(req.params.id));
  if (!winner || !winner.is_winner) return res.status(400).json({ error: 'Solo desde cotización ganadora' });

  const reqItem = db.requisition_items.find(i => i.id === winner.requisition_item_id);
  if (!reqItem) return res.status(404).json({ error: 'Ítem de requisición no encontrado' });
  if (!req.body.code || !req.body.name) return res.status(400).json({ error: 'Código y nombre requeridos' });

  const item = {
    id: nextId(db.catalog_items),
    code: req.body.code,
    name: req.body.name,
    item_type: req.body.item_type || 'uso continuo',
    unit: req.body.unit || reqItem.unit || 'pza',
    supplier_id: winner.supplier_id,
    equivalent_code: req.body.equivalent_code || winner.provider_code || '',
    unit_price: winner.unit_cost,
    currency: winner.currency || 'MXN',
    quote_validity_days: Number(req.body.quote_validity_days || 30),
    active: true,
    inventoried: !!req.body.inventoried,
    cost_center_id: reqItem.cost_center_id || null,
    sub_cost_center_id: reqItem.sub_cost_center_id || null,
    created_from_quotation: winner.id
  };

  db.catalog_items.push(item);
  reqItem.catalog_item_id = item.id;
  winner.catalog_item_id = item.id;

  const reqRow = db.requisitions.find(r => r.id === reqItem.requisition_id);
  const oldStatus = reqItem.status;
  recalcRequisition(db, reqItem.requisition_id);
  reqItem.status = deriveItemStatus(db, Number(reqRow?.total_amount || 0), reqItem);

  addHistory(db, {
    module: 'catalogs',
    requisition_id: reqItem.requisition_id,
    requisition_item_id: reqItem.id,
    old_status: oldStatus,
    new_status: reqItem.status,
    changed_by_user_id: req.user.id,
    comment: `Ítem ${item.code} dado de alta en catálogo desde cotización ganadora`
  });

  write(db);
  res.status(201).json({ catalog_item: item, requisition_item: reqItem });
});

// Proveedor declina solicitud de cotización
router.post('/requests/:id/decline', allowRoles('proveedor', 'comprador', 'admin'), (req, res) => {
  const db = read();
  const qr = (db.quotation_requests || []).find(r => r.id === Number(req.params.id));
  if (!qr) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (req.user.role_code === 'proveedor' && qr.supplier_id !== req.user.supplier_id) {
    return res.status(403).json({ error: 'Sin permiso' });
  }
  qr.status = 'Rechazada';
  qr.declined_at = new Date().toISOString();
  qr.decline_reason = req.body.reason || 'Sin motivo';
  write(db);
  res.json({ ok: true });
});

// Detalle de cotización por ítem: solicitudes + cotizaciones recibidas
router.get('/item-detail/:itemId', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const itemId = Number(req.params.itemId);
  const requests = (db.quotation_requests || [])
    .filter(r => r.requisition_item_id === itemId)
    .map(r => ({
      ...r,
      supplier_name: (db.suppliers.find(s => s.id === r.supplier_id) || {}).business_name || '-',
      supplier_email: (db.suppliers.find(s => s.id === r.supplier_id) || {}).email || '',
      quote: db.quotations.find(q => q.requisition_item_id === itemId && q.supplier_id === r.supplier_id) || null
    }));
  res.json(requests);
});

module.exports = router;
