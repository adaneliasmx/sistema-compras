const express = require('express');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const { addHistory, recalcRequisition, deriveItemStatus } = require('../utils/workflow');
const router = express.Router();
router.use(authRequired);

function nextPOFolio(db, providerCode) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `PO-${providerCode}-${y}${m}`;
  // Usar el mayor sufijo numérico existente para evitar duplicados si se borran POs
  const maxSuffix = db.purchase_orders
    .filter(x => String(x.folio).startsWith(prefix))
    .reduce((max, x) => {
      const n = parseInt(String(x.folio).slice(prefix.length + 1), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
  return `${prefix}-${String(maxSuffix + 1).padStart(4, '0')}`;
}

// Preview: agrupa ítems seleccionados por proveedor antes de generar POs
router.post('/preview-po', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.map(Number) : [];
  const lines = db.requisition_items.filter(i => itemIds.includes(i.id));
  const grupos = {};
  lines.forEach(line => {
    const sid = line.supplier_id || 0;
    if (!grupos[sid]) grupos[sid] = [];
    grupos[sid].push(line);
  });
  const preview = Object.entries(grupos).map(([supplierId, groupLines]) => {
    const supplier = db.suppliers.find(s => s.id === Number(supplierId));
    const total = groupLines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
    const warnings = [];
    groupLines.forEach(l => {
      if (l.status !== 'Autorizado') warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" no está Autorizado (${l.status})`);
      if (!l.unit_cost) warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" sin costo`);
      if (!l.supplier_id) warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" sin proveedor`);
      if (l.sub_cost_center_proposed && !l.sub_cost_center_id) warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" tiene subcentro propuesto ("${l.sub_cost_center_proposed}") pendiente de asignación por Compras`);
    });
    const currencies = [...new Set(groupLines.map(l => l.currency || 'MXN'))];
    if (currencies.length > 1) warnings.push(`Ítems con monedas mixtas (${currencies.join(', ')}). Se usará MXN como moneda de la PO.`);
    return {
      supplier_id: Number(supplierId),
      supplier_name: supplier?.business_name || '⚠ Sin proveedor asignado',
      supplier_email: supplier?.email || '',
      item_count: groupLines.length,
      total,
      currency: currencies.length === 1 ? currencies[0] : 'MXN',
      items: groupLines.map(l => ({
        id: l.id, status: l.status,
        name: (db.catalog_items.find(c => c.id === l.catalog_item_id) || {}).name || l.manual_item_name,
        quantity: l.quantity, unit: l.unit, unit_cost: l.unit_cost
      })),
      warnings,
      can_generate: warnings.length === 0
    };
  });
  res.json({ groups: preview, total_pos: preview.length, total_items: lines.length });
});

router.get('/pending-items', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const showCancelled = req.query.show_cancelled === 'true';
  const excluded = showCancelled ? ['Cerrado', 'Rechazado'] : ['Cerrado', 'Rechazado', 'Cancelado'];
  const rows = db.requisition_items
    .filter(i => !excluded.includes(i.status))
    .map(i => ({
      ...i,
      requisition_folio: (db.requisitions.find(r => r.id === i.requisition_id) || {}).folio,
      supplier_name: (db.suppliers.find(s => s.id === i.supplier_id) || {}).business_name || '-',
      item_name: (db.catalog_items.find(c => c.id === i.catalog_item_id) || {}).name || i.manual_item_name || '',
      po_folio: i.purchase_order_id ? (db.purchase_orders.find(p => p.id === i.purchase_order_id) || {}).folio || '' : '',
      cancelled_by_name: i.cancelled_by ? (db.users.find(u => u.id === i.cancelled_by) || {}).full_name || '' : '',
      quote_sub_status: (() => {
        // Solo aplica para ítems que aún están en etapa de cotización
        if (i.status !== 'En cotización') return null;
        const reqs = (db.quotation_requests || []).filter(r => r.requisition_item_id === i.id);
        if (!reqs.length) return 'por_solicitar';
        const quotes = db.quotations.filter(q => q.requisition_item_id === i.id);
        if (quotes.length) return 'cotizado';
        const allRejected = reqs.length > 0 && reqs.every(r => r.status === 'Rechazada');
        if (allRejected) return 'rechazado_proveedor';
        return 'solicitada';
      })()
    }));
  res.json(rows);
});

router.patch('/items/:id', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  const oldStatus = line.status;
  if (req.body.supplier_id !== undefined) line.supplier_id = req.body.supplier_id ? Number(req.body.supplier_id) : null;
  if (req.body.catalog_item_id !== undefined) line.catalog_item_id = req.body.catalog_item_id ? Number(req.body.catalog_item_id) : null;
  if (req.body.manual_item_name !== undefined) line.manual_item_name = req.body.manual_item_name;
  if (req.body.unit_cost !== undefined) line.unit_cost = Number(req.body.unit_cost || 0);
  if (req.body.comments !== undefined) line.comments = req.body.comments;
  if (req.body.currency !== undefined) line.currency = req.body.currency || line.currency || 'MXN';
  if (req.body.sub_cost_center_id !== undefined) {
    line.sub_cost_center_id = req.body.sub_cost_center_id ? Number(req.body.sub_cost_center_id) : null;
    // Assign removes the pending proposal
    if (line.sub_cost_center_id) line.sub_cost_center_proposed = null;
  }
  if (req.body.sub_cost_center_proposed !== undefined) line.sub_cost_center_proposed = req.body.sub_cost_center_proposed || null;
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  recalcRequisition(db, line.requisition_id);
  // Solo re-derivar status en etapas tempranas; no regresar ítems que ya avanzaron en el flujo
  const EARLY_STATUSES = ['En cotización', 'En autorización', 'Autorizado'];
  if (EARLY_STATUSES.includes(line.status)) {
    line.status = deriveItemStatus(db, Number(reqRow.total_amount || 0), line);
  }
  line.updated_at = new Date().toISOString();
  addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: line.status, changed_by_user_id: req.user.id, comment: 'Edición de ítem por compras' });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json(line);
});

router.post('/items/:id/register-catalog-item', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (!req.body.supplier_id || !req.body.code || !req.body.name) return res.status(400).json({ error: 'Proveedor, código y nombre requeridos' });
  const item = {
    id: nextId(db.catalog_items),
    code: req.body.code,
    name: req.body.name,
    item_type: req.body.item_type || 'uso continuo',
    unit: req.body.unit || line.unit || 'pza',
    supplier_id: Number(req.body.supplier_id),
    equivalent_code: '',
    unit_price: Number(req.body.unit_price || line.unit_cost || 0),
    currency: req.body.currency || line.currency || 'MXN',
    quote_validity_days: Number(req.body.quote_validity_days || 30),
    active: true,
    inventoried: !!req.body.inventoried,
    cost_center_id: line.cost_center_id || null,
    sub_cost_center_id: line.sub_cost_center_id || null
  };
  db.catalog_items.push(item);

  // Función para ligar un requisition_item al nuevo ítem de catálogo
  const linkItemToNew = (ri) => {
    ri.catalog_item_id = item.id;
    ri.supplier_id = item.supplier_id;
    ri.unit_cost = item.unit_price;
    ri.currency = item.currency;
    ri.updated_at = new Date().toISOString();
    const reqRow2 = db.requisitions.find(r => r.id === ri.requisition_id);
    const old = ri.status;
    recalcRequisition(db, ri.requisition_id);
    ri.status = deriveItemStatus(db, Number(reqRow2?.total_amount || 0), ri);
    addHistory(db, { module: 'catalogs', requisition_id: ri.requisition_id, requisition_item_id: ri.id, old_status: old, new_status: ri.status, changed_by_user_id: req.user.id, comment: `Ligado al nuevo ítem de catálogo ${item.code}` });
    recalcRequisition(db, ri.requisition_id);
  };

  // Ligar el ítem original
  linkItemToNew(line);

  // Buscar otros ítems con el mismo nombre y ligarlos también
  const normalizedName = (line.manual_item_name || item.name).toLowerCase().trim();
  const matches = db.requisition_items.filter(ri =>
    ri.id !== line.id &&
    !ri.catalog_item_id &&
    (ri.manual_item_name || '').toLowerCase().trim() === normalizedName
  );
  matches.forEach(ri => linkItemToNew(ri));

  write(db);
  res.status(201).json({ item, requisition_item: line, matched_count: matches.length });
});

router.post('/items/:id/request-quotation', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  const supplierIds = Array.isArray(req.body.supplier_ids) ? req.body.supplier_ids.map(Number).filter(Boolean) : [];
  if (!supplierIds.length) return res.status(400).json({ error: 'Selecciona al menos un proveedor para cotizar' });
  line.status = 'En cotización';
  line.currency = req.body.currency || line.currency || 'MXN';
  line.updated_at = new Date().toISOString();
  db.quotation_requests = db.quotation_requests || [];
  // Deduplicar: no crear solicitud si ya existe una activa para ese proveedor+ítem
  supplierIds.forEach(supplier_id => {
    const existing = db.quotation_requests.find(r =>
      r.requisition_item_id === line.id &&
      r.supplier_id === supplier_id &&
      r.status === 'Pendiente'
    );
    if (!existing) {
      db.quotation_requests.push({ id: nextId(db.quotation_requests), requisition_item_id: line.id, supplier_id, created_at: new Date().toISOString(), created_by_user_id: req.user.id, status: 'Pendiente' });
    }
  });
  const emails = supplierIds.map(id => (db.suppliers.find(s => s.id === id) || {}).email).filter(Boolean);
  addHistory(db, { module: 'quotations', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: null, new_status: 'En cotización', changed_by_user_id: req.user.id, comment: 'Solicitud de cotización enviada' });
  recalcRequisition(db, line.requisition_id);
  write(db);
  const subject = `Solicitud de cotización · ${(db.requisitions.find(r => r.id === line.requisition_id) || {}).folio || ''}`;
  const body = `Favor de registrar cotización para el ítem: ${(db.catalog_items.find(c => c.id === line.catalog_item_id) || {}).name || line.manual_item_name}.`;
  res.json({ ok: true, mailto: `mailto:${encodeURIComponent(emails.join(';'))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` });
});

// Motor único de generación de PO — agrupa por proveedor automáticamente
function createPOForGroup(db, lines, supplierId, buyerUserId, currency) {
  const supplier = db.suppliers.find(s => s.id === supplierId);
  // Tomar el porcentaje de anticipo del mayor winning_quote de los ítems del grupo
  const advancePct = lines.reduce((max, line) => {
    const q = line.winning_quote_id ? db.quotations.find(q => q.id === line.winning_quote_id) : null;
    return Math.max(max, Number(q?.advance_percentage || 0));
  }, 0);
  const po = {
    id: nextId(db.purchase_orders),
    folio: nextPOFolio(db, supplier?.provider_code || 'GEN'),
    supplier_id: supplierId,
    buyer_user_id: buyerUserId,
    status: 'Enviada',
    currency: currency || lines[0].currency || 'MXN',
    created_at: new Date().toISOString(),
    total_amount: 0,
    supplier_response: 'Pendiente',
    supplier_email: supplier?.email || '',
    supplier_contact: supplier?.contact_name || '',
    advance_percentage: advancePct,
    advance_amount: 0,       // se calcula al fijar total_amount
    advance_status: advancePct > 0 ? 'Pendiente' : 'N/A',
    advance_paid: 0
  };
  db.purchase_orders.push(po);
  let total = 0;
  lines.forEach(line => {
    const subtotal = Number(line.quantity || 0) * Number(line.unit_cost || 0);
    total += subtotal;
    db.purchase_order_items.push({
      id: nextId(db.purchase_order_items),
      purchase_order_id: po.id,
      requisition_item_id: line.id,
      catalog_item_id: line.catalog_item_id,
      description: (db.catalog_items.find(c => c.id === line.catalog_item_id) || {}).name || line.manual_item_name,
      quantity: line.quantity,
      unit: line.unit,
      unit_cost: line.unit_cost,
      currency: line.currency || 'MXN',
      subtotal,
      status: 'En proceso'
    });
    const oldStatus = line.status;
    line.status = 'Enviada';
    line.purchase_order_id = po.id;
    line.updated_at = new Date().toISOString();
    addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, purchase_order_id: po.id, old_status: oldStatus, new_status: 'Enviada', changed_by_user_id: buyerUserId, comment: `PO ${po.folio} generada` });
    recalcRequisition(db, line.requisition_id);
    // Si el ítem es manual (sin catalog_item_id), guardarlo en catálogo con el precio
    if (!line.catalog_item_id && line.manual_item_name) {
      const normalizedName = line.manual_item_name.trim().toLowerCase();
      const exists = db.catalog_items.find(c => c.name.toLowerCase().trim() === normalizedName);
      if (!exists) {
        const maxCatNum = db.catalog_items.reduce((max, c) => {
          const n = parseInt((c.code || '').replace(/^ITM-/i, ''), 10);
          return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newCode = 'ITM-' + String(maxCatNum + 1).padStart(4, '0');
        const newItem = {
          id: nextId(db.catalog_items),
          code: newCode,
          name: line.manual_item_name.trim(),
          item_type: 'uso continuo',
          unit: line.unit || 'pza',
          supplier_id: line.supplier_id || null,
          equivalent_code: '',
          unit_price: line.unit_cost || 0,
          currency: line.currency || 'MXN',
          quote_validity_days: 30,
          active: true,
          inventoried: false,
          cost_center_id: line.cost_center_id || null,
          sub_cost_center_id: line.sub_cost_center_id || null,
        };
        db.catalog_items.push(newItem);
        line.catalog_item_id = newItem.id;
      } else {
        // Si existe pero no tiene precio, actualizar precio
        if (!exists.unit_price && line.unit_cost) {
          exists.unit_price = line.unit_cost;
          exists.currency = line.currency || 'MXN';
        }
        line.catalog_item_id = exists.id;
      }
    }
  });
  po.total_amount = total;
  po.advance_amount = advancePct > 0 ? Math.round(total * advancePct / 100 * 100) / 100 : 0;
  return po;
}

// Solicitar anticipo de una PO (comprador genera la solicitud al proveedor)
router.post('/purchase-orders/:id/request-advance', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  if (!Number(po.advance_percentage || 0) && !req.body.advance_percentage) {
    return res.status(400).json({ error: 'La PO no tiene porcentaje de anticipo definido' });
  }
  if (po.advance_status === 'Pagado') return res.status(400).json({ error: 'El anticipo ya fue pagado' });

  if (req.body.advance_percentage) po.advance_percentage = Number(req.body.advance_percentage);
  po.advance_amount = Math.round(Number(po.total_amount || 0) * Number(po.advance_percentage) / 100 * 100) / 100;
  po.advance_status = 'Solicitado';
  po.advance_requested_at = new Date().toISOString();
  po.advance_requested_by = req.user.id;
  po.updated_at = new Date().toISOString();

  const supplier = db.suppliers.find(s => s.id === po.supplier_id) || {};
  const subject = `Anticipo requerido · ${po.folio} · ${po.advance_percentage}%`;
  const body = [
    `Estimado ${supplier.contact_name || supplier.business_name},`,
    ``,
    `Le informamos que la Orden de Compra ${po.folio} requiere un anticipo del ${po.advance_percentage}%.`,
    ``,
    `Monto del anticipo: $${po.advance_amount.toFixed(2)} ${po.currency || 'MXN'}`,
    `Total de la orden: $${Number(po.total_amount || 0).toFixed(2)} ${po.currency || 'MXN'}`,
    ``,
    `Por favor registre la factura de anticipo en el portal para proceder con el pago.`,
    ``,
    `Gracias.`
  ].join('\n');
  const mailto = `mailto:${encodeURIComponent(supplier.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  write(db);
  res.json({ ok: true, po, mailto, advance_amount: po.advance_amount });
});

router.post('/generate-po', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.map(Number) : [];
  if (!itemIds.length) return res.status(400).json({ error: 'Selecciona al menos un ítem' });

  const lines = db.requisition_items.filter(i => itemIds.includes(i.id));
  if (!lines.length) return res.status(404).json({ error: 'Ítems no encontrados' });

  // Excluir ítems ya cancelados o ya con PO
  const disponibles = lines.filter(x => !['Cancelado', 'Rechazado', 'Cerrado'].includes(x.status) && !x.purchase_order_id);

  // Solo ítems Autorizados con proveedor y costo pueden generar PO
  const aptos = disponibles.filter(x => x.status === 'Autorizado' && x.supplier_id && x.unit_cost);

  // Bloquear ítems con subcentro de costo pendiente de asignación
  const pendingScc = aptos.filter(x => x.sub_cost_center_proposed && !x.sub_cost_center_id);
  if (pendingScc.length) {
    const names = pendingScc.map(x => (db.catalog_items.find(c=>c.id===x.catalog_item_id)||{}).name||x.manual_item_name||'ítem').join(', ');
    return res.status(400).json({ error: `Los siguientes ítems tienen subcentro de costo propuesto pendiente de asignación por Compras: ${names}. Asigna el subcentro antes de generar la PO.` });
  }

  if (!aptos.length) {
    const noAutorizados = disponibles.filter(x => x.status !== 'Autorizado');
    const sinDatos = disponibles.filter(x => x.status === 'Autorizado' && (!x.supplier_id || !x.unit_cost));
    if (noAutorizados.length === disponibles.length) {
      return res.status(400).json({ error: 'Los ítems seleccionados no están Autorizados. Solo se pueden generar POs para ítems Autorizados.', items: noAutorizados.map(x => x.id) });
    }
    if (sinDatos.length) {
      return res.status(400).json({ error: 'Hay ítems Autorizados sin proveedor o costo asignado.', items: sinDatos.map(x => x.id) });
    }
    return res.status(400).json({ error: 'No hay ítems listos para PO.' });
  }

  // Agrupar por proveedor
  const grupos = {};
  aptos.forEach(line => {
    const sid = line.supplier_id;
    if (!grupos[sid]) grupos[sid] = [];
    grupos[sid].push(line);
  });

  const purchaseOrders = [];

  for (const [supplierId, groupLines] of Object.entries(grupos)) {
    // Respetar la moneda del grupo: si todos los ítems coinciden en moneda, usarla; si hay mix, MXN por defecto
    const currencies = [...new Set(groupLines.map(l => l.currency || 'MXN'))];
    const groupCurrency = currencies.length === 1 ? currencies[0] : (req.body.currency || 'MXN');
    const po = createPOForGroup(db, groupLines, Number(supplierId), req.user.id, groupCurrency);
    purchaseOrders.push(po);
  }

  write(db);

  const skipped = lines.length - aptos.length;
  res.status(201).json({
    purchase_orders: purchaseOrders,
    po_count: purchaseOrders.length,
    item_count: aptos.length,
    skipped_count: skipped,
    message: purchaseOrders.length === 1
      ? `PO generada: ${purchaseOrders[0].folio}${skipped ? ` (${skipped} ítem(s) omitidos por falta de proveedor/costo)` : ''}`
      : `${purchaseOrders.length} POs generadas: ${purchaseOrders.map(p => p.folio).join(', ')}${skipped ? ` (${skipped} ítem(s) omitidos)` : ''}`
  });
});

// Cancelar ítem desde compras
router.post('/items/:id/cancel', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (['Cancelado', 'Cerrado'].includes(line.status)) return res.status(400).json({ error: `El ítem ya está ${line.status}` });
  if (line.purchase_order_id) {
    const po = db.purchase_orders.find(p => p.id === line.purchase_order_id);
    if (po && !['Cancelada', 'Rechazada por proveedor'].includes(po.status)) {
      return res.status(400).json({ error: `El ítem está asignado a la PO ${po.folio} (${po.status}). Cancela primero la PO para poder cancelar este ítem.` });
    }
  }
  const reason = req.body.reason || 'Sin justificación';
  const oldStatus = line.status;
  line.status = 'Cancelado';
  line.cancel_reason = reason;
  line.cancelled_at = new Date().toISOString();
  line.cancelled_by = req.user.id;
  line.updated_at = new Date().toISOString();
  // Cancelar solicitudes de cotización pendientes del ítem
  (db.quotation_requests || [])
    .filter(r => r.requisition_item_id === line.id && r.status === 'Pendiente')
    .forEach(r => { r.status = 'Cancelada'; r.cancelled_at = new Date().toISOString(); });
  addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: 'Cancelado', changed_by_user_id: req.user.id, comment: `Cancelado: ${reason}` });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json({ ok: true, item: line });
});

// Restaurar ítem cancelado (por error) → regresa al estado correcto según reglas
router.post('/items/:id/restore', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (line.status !== 'Cancelado') return res.status(400).json({ error: 'Solo se pueden restaurar ítems cancelados' });
  if (line.purchase_order_id) {
    const po = db.purchase_orders.find(p => p.id === line.purchase_order_id);
    if (po && !['Cancelada', 'Rechazada por proveedor'].includes(po.status)) {
      return res.status(400).json({ error: `El ítem sigue asignado a la PO ${po.folio} que no está cancelada` });
    }
    line.purchase_order_id = null;
  }
  const oldStatus = line.status;
  line.cancel_reason = null;
  line.cancelled_at = null;
  line.cancelled_by = null;
  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  recalcRequisition(db, line.requisition_id);
  line.status = deriveItemStatus(db, Number(reqRow?.total_amount || 0), line);
  line.updated_at = new Date().toISOString();
  addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: line.status, changed_by_user_id: req.user.id, comment: 'Ítem restaurado manualmente' });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json({ ok: true, item: line });
});

router.get('/purchase-orders', allowRoles('comprador', 'proveedor', 'admin'), (req, res) => {
  const db = read();
  const rows = db.purchase_orders
    .filter(po => req.user.supplier_id ? po.supplier_id === req.user.supplier_id : true)
    .map(po => {
      const poItems = db.purchase_order_items.filter(i => i.purchase_order_id === po.id);
      return {
        ...po,
        supplier_name: (db.suppliers.find(s => s.id === po.supplier_id) || {}).business_name || '',
        items: poItems.length,
        po_items: poItems
      };
    });
  res.json(rows);
});

router.get('/purchase-orders/:id', allowRoles('comprador', 'proveedor', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  if (req.user.supplier_id && po.supplier_id !== req.user.supplier_id) return res.status(403).json({ error: 'Sin permiso' });
  const items = db.purchase_order_items.filter(i => i.purchase_order_id === po.id);
  res.json({ po, items });
});

// Proveedor acepta o rechaza la PO
router.post('/purchase-orders/:id/respond', allowRoles('proveedor', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  if (req.user.supplier_id && po.supplier_id !== req.user.supplier_id) return res.status(403).json({ error: 'Sin permiso' });
  const decision = (req.body.decision || req.body.response || 'aceptada').toLowerCase();
  po.supplier_response = decision === 'rechazada' ? 'Rechazada' : 'Aceptada';
  po.supplier_note = req.body.supplier_note || req.body.comment || '';
  po.status = decision === 'rechazada' ? 'Rechazada por proveedor' : 'Aceptada';
  po.responded_at = new Date().toISOString();
  write(db);
  res.json(po);
});

// Comprador avanza el status de la PO: Aceptada → En proceso → Entregado
router.patch('/purchase-orders/:id/status', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  const ALLOWED = ['Enviada', 'Aceptada', 'En proceso', 'Entregado'];
  const newStatus = req.body.status;
  if (!ALLOWED.includes(newStatus)) return res.status(400).json({ error: `Estatus no válido. Use: ${ALLOWED.join(', ')}` });
  const oldStatus = po.status;
  po.status = newStatus;
  po.updated_at = new Date().toISOString();
  // Propagar status a los ítems de la PO
  const poItems = db.purchase_order_items.filter(i => i.purchase_order_id === po.id);
  poItems.forEach(poLine => {
    poLine.status = newStatus;
    const reqItem = db.requisition_items.find(i => i.id === poLine.requisition_item_id);
    if (reqItem) {
      const oldItemStatus = reqItem.status;
      reqItem.status = newStatus;
      reqItem.updated_at = new Date().toISOString();
      addHistory(db, { module: 'purchases', requisition_id: reqItem.requisition_id, requisition_item_id: reqItem.id, purchase_order_id: po.id, old_status: oldItemStatus, new_status: newStatus, changed_by_user_id: req.user.id, comment: `PO ${po.folio}: ${oldStatus} → ${newStatus}` });
      recalcRequisition(db, reqItem.requisition_id);
    }
  });
  write(db);
  res.json(po);
});

// Cancelar PO completa (comprador/admin) — libera los ítems para re-proceso
router.post('/purchase-orders/:id/cancel', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  if (['Cancelada', 'Cerrada', 'Facturada'].includes(po.status)) {
    return res.status(400).json({ error: `No se puede cancelar una PO en estado "${po.status}"` });
  }
  const reason = req.body.reason || 'Sin justificación';
  const oldStatus = po.status;
  po.status = 'Cancelada';
  po.cancel_reason = reason;
  po.cancelled_at = new Date().toISOString();
  po.cancelled_by = req.user.id;
  po.updated_at = new Date().toISOString();

  // Liberar los ítems de la requisición (quitar purchase_order_id y re-derivar status)
  const poItems = db.purchase_order_items.filter(i => i.purchase_order_id === po.id);
  poItems.forEach(poLine => {
    poLine.status = 'Cancelada';
    const reqItem = db.requisition_items.find(i => i.id === poLine.requisition_item_id);
    if (reqItem) {
      const oldItemStatus = reqItem.status;
      reqItem.purchase_order_id = null;
      // Re-derivar status real en lugar de hardcodear 'Autorizado'
      recalcRequisition(db, reqItem.requisition_id);
      const reqRow2 = db.requisitions.find(r => r.id === reqItem.requisition_id);
      reqItem.status = deriveItemStatus(db, Number(reqRow2?.total_amount || 0), reqItem);
      reqItem.updated_at = new Date().toISOString();
      addHistory(db, { module: 'purchases', requisition_id: reqItem.requisition_id, requisition_item_id: reqItem.id, purchase_order_id: po.id, old_status: oldItemStatus, new_status: reqItem.status, changed_by_user_id: req.user.id, comment: `PO ${po.folio} cancelada: ${reason}` });
      recalcRequisition(db, reqItem.requisition_id);
    }
  });

  addHistory(db, { module: 'purchases', requisition_id: null, purchase_order_id: po.id, old_status: oldStatus, new_status: 'Cancelada', changed_by_user_id: req.user.id, comment: `PO cancelada: ${reason}` });
  write(db);
  res.json({ ok: true, po });
});

module.exports = router;
