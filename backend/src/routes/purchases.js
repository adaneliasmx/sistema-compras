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
      if (!l.unit_cost) warnings.push(`Ítem "${(db.catalog_items.find(c=>c.id===l.catalog_item_id)||{}).name||l.manual_item_name}" tiene precio $0. Debe cotizarse o actualizarse antes de generar la PO.`);
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
      items: groupLines.map(l => {
        const winQuote = l.winning_quote_id ? (db.quotations || []).find(q => q.id === l.winning_quote_id) : null;
        return {
          id: l.id, status: l.status,
          name: (db.catalog_items.find(c => c.id === l.catalog_item_id) || {}).name || l.manual_item_name,
          quantity: l.quantity, unit: l.unit, unit_cost: l.unit_cost,
          currency: l.currency || 'MXN',
          winning_quote_cost: winQuote ? Number(winQuote.unit_cost || 0) : null
        };
      }),
      warnings,
      can_generate: warnings.length === 0
    };
  });
  res.json({ groups: preview, total_pos: preview.length, total_items: lines.length });
});

router.get('/pending-items', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const showCancelled = req.query.show_cancelled === 'true';
  const includeRejected = req.query.include_rejected === 'true';
  const excluded = ['Cerrado'];
  if (!showCancelled) excluded.push('Cancelado');
  if (!includeRejected) excluded.push('Rechazado');
  const rows = db.requisition_items
    .filter(i => !excluded.includes(i.status))
    .map(i => {
      const reqRow = db.requisitions.find(r => r.id === i.requisition_id) || {};
      const requester = reqRow.requester_user_id ? db.users.find(u => u.id === reqRow.requester_user_id) : null;
      const cc = i.cost_center_id ? (db.cost_centers || []).find(c => c.id === i.cost_center_id) : null;
      return {
      ...i,
      requisition_folio: reqRow.folio,
      requester_name: requester ? requester.full_name : '',
      cost_center_name: cc ? cc.name : '',
      request_date: String(reqRow.request_date || reqRow.created_at || '').slice(0, 10),
      supplier_name: (db.suppliers.find(s => s.id === i.supplier_id) || {}).business_name || '-',
      item_name: (db.catalog_items.find(c => c.id === i.catalog_item_id) || {}).name || i.manual_item_name || '',
      po_folio: i.purchase_order_id ? (db.purchase_orders.find(p => p.id === i.purchase_order_id) || {}).folio || '' : '',
      cancelled_by_name: i.cancelled_by ? (db.users.find(u => u.id === i.cancelled_by) || {}).full_name || '' : '',
      is_rejected: i.status === 'Rechazado',
      reject_reason: i.reject_reason || null,
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
      })(),
      quotation_request_supplier_ids: (db.quotation_requests || [])
        .filter(r => r.requisition_item_id === i.id)
        .map(r => r.supplier_id)
    };});
  res.json(rows);
});

router.patch('/items/:id', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });

  // FASE 5: Bloquear edición si la PO está Aceptada o más avanzada
  if (line.purchase_order_id) {
    const po = db.purchase_orders.find(p => p.id === line.purchase_order_id);
    if (po && ['Aceptada', 'En proceso', 'Entregado', 'Facturada', 'Facturación parcial', 'Cerrada'].includes(po.status)) {
      return res.status(400).json({ error: `El ítem pertenece a la PO ${po.folio} (estado: ${po.status}) y ya no puede editarse.` });
    }
  }

  const oldStatus = line.status;
  if (req.body.supplier_id !== undefined) line.supplier_id = req.body.supplier_id ? Number(req.body.supplier_id) : null;
  if (req.body.catalog_item_id !== undefined) line.catalog_item_id = req.body.catalog_item_id ? Number(req.body.catalog_item_id) : null;
  if (req.body.manual_item_name !== undefined) line.manual_item_name = req.body.manual_item_name;
  if (req.body.unit_cost !== undefined) line.unit_cost = Number(req.body.unit_cost || 0);
  if (req.body.quantity !== undefined) line.quantity = Number(req.body.quantity || 0);
  if (req.body.unit !== undefined) line.unit = req.body.unit;
  if (req.body.comments !== undefined) line.comments = req.body.comments;
  if (req.body.currency !== undefined) line.currency = req.body.currency || line.currency || 'MXN';
  if (req.body.cost_center_id !== undefined) line.cost_center_id = req.body.cost_center_id ? Number(req.body.cost_center_id) : null;
  if (req.body.sub_cost_center_id !== undefined) {
    line.sub_cost_center_id = req.body.sub_cost_center_id ? Number(req.body.sub_cost_center_id) : null;
    // Assign removes the pending proposal
    if (line.sub_cost_center_id) line.sub_cost_center_proposed = null;
  }
  if (req.body.sub_cost_center_proposed !== undefined) line.sub_cost_center_proposed = req.body.sub_cost_center_proposed || null;

  // FASE 5: Validar que el SCC pertenezca al CC seleccionado
  if (line.sub_cost_center_id && line.cost_center_id) {
    const scc = (db.sub_cost_centers || []).find(s => s.id === line.sub_cost_center_id);
    if (scc && scc.cost_center_id !== line.cost_center_id) {
      return res.status(400).json({ error: `El subcentro "${scc.name}" no pertenece al centro de costo seleccionado. Verifica la asignación.` });
    }
  }

  const reqRow = db.requisitions.find(r => r.id === line.requisition_id);
  recalcRequisition(db, line.requisition_id);
  // Re-derivar status solo en etapas pre-autorización; no regresar ítems ya Autorizados manualmente
  const EARLY_STATUSES = ['En cotización', 'En autorización'];
  if (EARLY_STATUSES.includes(line.status)) {
    line.status = deriveItemStatus(db, Number(reqRow.total_amount || 0), line);
  } else if (line.status === 'Autorizado' && (!Number(line.unit_cost || 0) || !line.supplier_id)) {
    // Solo regresar a cotización si se quita explícitamente proveedor o costo
    line.status = 'En cotización';
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

  // Detectar ítems con costo = 0 (bloqueante — deben cotizarse o actualizarse)
  const zeroCost = disponibles.filter(x => x.status === 'Autorizado' && x.supplier_id && !x.unit_cost);
  if (zeroCost.length) {
    const names = zeroCost.map(x => (db.catalog_items.find(c=>c.id===x.catalog_item_id)||{}).name||x.manual_item_name||'ítem');
    return res.status(400).json({
      error: 'zero_cost',
      message: `No se puede generar la PO: los siguientes ítems tienen precio $0. Cotíza o actualiza el costo antes de generar la PO.`,
      zero_cost_items: zeroCost.map((x, i) => ({ id: x.id, name: names[i] }))
    });
  }

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

  // Verificar precios desactualizados (sin pedirse en 30+ días)
  if (!req.body.force_stale_confirm) {
    const STALE_DAYS = 30;
    const now = Date.now();
    const staleItems = [];
    aptos.forEach(line => {
      if (!line.catalog_item_id) return; // ítems manuales no aplica
      const itemName = (db.catalog_items.find(c=>c.id===line.catalog_item_id)||{}).name || line.manual_item_name || 'ítem';
      // Buscar la última PO que incluyó este ítem de catálogo
      const lastPo = db.purchase_order_items
        .filter(poi => poi.catalog_item_id === line.catalog_item_id)
        .map(poi => db.purchase_orders.find(po => po.id === poi.purchase_order_id))
        .filter(Boolean)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (!lastPo) {
        staleItems.push({ id: line.id, name: itemName, unit_cost: line.unit_cost, last_ordered: null, days_since: null, reason: 'Nunca pedido antes' });
      } else {
        const daysSince = Math.floor((now - new Date(lastPo.created_at).getTime()) / 86400000);
        if (daysSince >= STALE_DAYS) {
          staleItems.push({ id: line.id, name: itemName, unit_cost: line.unit_cost, last_ordered: lastPo.created_at, days_since: daysSince, reason: `Último pedido hace ${daysSince} días` });
        }
      }
    });
    if (staleItems.length) {
      return res.status(409).json({
        error: 'stale_prices',
        message: 'Algunos ítems no se han pedido en más de 30 días. Confirma o actualiza los precios antes de generar la PO.',
        stale_items: staleItems
      });
    }
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

  // Generar mailto por PO con CC al solicitante y autorizadores
  const { poToken } = require('./public-po');
  const buyers = db.users.filter(u => u.role_code === 'comprador' && u.active !== false);
  const authorizers = db.users.filter(u => u.role_code === 'autorizador' && u.active !== false);
  const ccEmails = [...buyers.map(u => u.email), ...authorizers.map(u => u.email)].filter(Boolean);
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const baseUrl = (process.env.FRONTEND_URL || `${proto}://${host}`).replace(/\/$/, '');
  const poMailtos = purchaseOrders.map(po => {
    const supplier = db.suppliers.find(s => s.id === po.supplier_id) || {};
    const poLines = db.purchase_order_items.filter(x => x.purchase_order_id === po.id);

    // Enriquecer cada línea con código, urgencia, fecha estimada y cotización desde requisición
    const lineDetails = poLines.map(l => {
      const cat = db.catalog_items.find(c => c.id === l.catalog_item_id) || {};
      const name = cat.name || l.description || l.manual_item_name || 'ítem';
      const code = cat.code || '—';
      const reqItem = db.requisition_items.find(ri => ri.id === l.requisition_item_id) || {};
      const req2 = reqItem.requisition_id
        ? db.requisitions.find(r => r.id === reqItem.requisition_id) || {}
        : {};
      const urgency = req2.urgency || '—';
      const estDate = req2.programmed_date || '—';
      const subtotal = (Number(l.quantity||0) * Number(l.unit_cost||0)).toFixed(2);
      const winQuote = reqItem.winning_quote_id ? (db.quotations || []).find(q => q.id === reqItem.winning_quote_id) : null;
      const lines2 = [
        `  ┌─ ${name} [${code}]`,
        `  │  Cantidad: ${l.quantity} ${l.unit || ''}   Precio unit.: $${Number(l.unit_cost||0).toFixed(2)} ${l.currency||po.currency||'MXN'}   Subtotal: $${subtotal}`,
        winQuote ? `  │  Ref. cotización: ${winQuote.folio || ('#' + winQuote.id)}` : null,
        `  └─ Urgencia: ${urgency}   Fecha estimada de entrega: ${estDate}`
      ].filter(Boolean);
      return lines2.join('\n');
    }).join('\n\n');

    // Buscar requisición para obtener solicitante
    const firstLine = poLines[0];
    const firstReqItem = firstLine ? db.requisition_items.find(ri => ri.id === firstLine.requisition_item_id) : null;
    const reqRow = firstReqItem ? db.requisitions.find(r => r.id === firstReqItem.requisition_id) : null;
    const requester = reqRow ? db.users.find(u => u.id === reqRow.requester_user_id) : null;
    const allCc = [...new Set([...ccEmails, requester?.email].filter(Boolean))].join(',');

    const subject = `Orden de Compra ${po.folio} · ${supplier.business_name || ''}`;
    const token = poToken(po);
    const poViewUrl = `${baseUrl}/po-view?token=${token}`;

    const body = [
      `Estimado ${supplier.contact_name || supplier.business_name || 'Proveedor'},`,
      ``,
      `Le enviamos la Orden de Compra ${po.folio}.`,
      ``,
      `Proveedor : ${supplier.business_name || '—'}`,
      `Fecha PO  : ${String(po.created_at||'').slice(0,10)}`,
      ``,
      `── Ítems solicitados ────────────────────────────`,
      ``,
      lineDetails,
      ``,
      `────────────────────────────────────────────────`,
      `Total: $${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}`,
      ``,
      `── Ver y confirmar esta orden ───────────────────`,
      `Puede ver el PDF de esta orden y confirmar su fecha`,
      `compromiso de entrega en el siguiente enlace:`,
      ``,
      `${poViewUrl}`,
      ``,
      `Gracias.`
    ].join('\n');

    return {
      po_id: po.id,
      po_folio: po.folio,
      supplier_id: po.supplier_id,
      supplier_name: supplier.business_name || '',
      supplier_email: supplier.email || '',
      cc: allCc,
      po_view_url: poViewUrl,
      mailto: `mailto:${encodeURIComponent(supplier.email||'')}?cc=${encodeURIComponent(allCc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    };
  });

  const skipped = lines.length - aptos.length;
  res.status(201).json({
    purchase_orders: purchaseOrders,
    po_mailtos: poMailtos,
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

// FASE 3: Reabrir ítem a "En Autorización" (para POs canceladas/rechazadas)
router.post('/items/:id/reopen-to-auth', allowRoles('comprador', 'admin'), (req, res) => {
  const db = read();
  const line = db.requisition_items.find(i => i.id === Number(req.params.id));
  if (!line) return res.status(404).json({ error: 'Ítem no encontrado' });

  // Permitir reabrir si está cancelado o si su PO fue rechazada/cancelada
  let canReopen = line.status === 'Cancelado';
  if (!canReopen && line.purchase_order_id) {
    const po = db.purchase_orders.find(p => p.id === line.purchase_order_id);
    if (po && ['Cancelada', 'Rechazada por proveedor'].includes(po.status)) canReopen = true;
  }
  if (!canReopen) {
    return res.status(400).json({ error: 'Solo se pueden reabrir ítems cancelados o cuya PO fue rechazada/cancelada.' });
  }

  const oldStatus = line.status;
  line.purchase_order_id = null;
  line.status = 'En autorización';
  line.cancel_reason = null;
  line.cancelled_at = null;
  line.cancelled_by = null;
  line.updated_at = new Date().toISOString();

  addHistory(db, { module: 'purchases', requisition_id: line.requisition_id, requisition_item_id: line.id, old_status: oldStatus, new_status: 'En autorización', changed_by_user_id: req.user.id, comment: 'Ítem reabierto a "En Autorización" para re-proceso' });
  recalcRequisition(db, line.requisition_id);
  write(db);
  res.json({ ok: true, item: line });
});

router.get('/purchase-orders', allowRoles('comprador', 'proveedor', 'admin'), (req, res) => {
  const db = read();
  const rows = db.purchase_orders
    .filter(po => req.user.supplier_id ? po.supplier_id === req.user.supplier_id : true)
    .map(po => {
      const poItems = db.purchase_order_items.filter(i => i.purchase_order_id === po.id).map(i => ({
        ...i,
        item_name: (db.catalog_items.find(c => c.id === i.catalog_item_id) || {}).name || i.description || i.manual_item_name || '-'
      }));
      const firstPoItem = db.purchase_order_items.find(i => i.purchase_order_id === po.id);
      const firstReqItem = firstPoItem ? db.requisition_items.find(ri => ri.id === firstPoItem.requisition_item_id) : null;
      const reqRow = firstReqItem ? db.requisitions.find(r => r.id === firstReqItem.requisition_id) : null;
      const requester = reqRow ? db.users.find(u => u.id === reqRow.requester_user_id) : null;
      const cc = firstReqItem?.cost_center_id ? (db.cost_centers || []).find(c => c.id === firstReqItem.cost_center_id) : null;
      return {
        ...po,
        supplier_name: (db.suppliers.find(s => s.id === po.supplier_id) || {}).business_name || '',
        items: poItems.length,
        po_items: poItems,
        requester_name: requester ? requester.full_name : '',
        cost_center_name: cc ? cc.name : '',
        request_date: reqRow ? String(reqRow.request_date || reqRow.created_at || '').slice(0, 10) : ''
      };
    });
  res.json(rows);
});

router.get('/purchase-orders/:id', allowRoles('comprador', 'proveedor', 'admin'), (req, res) => {
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });
  if (req.user.supplier_id && po.supplier_id !== req.user.supplier_id) return res.status(403).json({ error: 'Sin permiso' });
  const items = db.purchase_order_items.filter(i => i.purchase_order_id === po.id).map(i => {
    const cat = db.catalog_items.find(c => c.id === i.catalog_item_id) || {};
    return { ...i, name: cat.name || i.description || i.manual_item_name || '-', code: cat.code || '—' };
  });
  res.json({ po, items });
});

// Regenerar mailto para una PO ya creada (reenvío de correo)
router.get('/purchase-orders/:id/mailto', allowRoles('comprador', 'admin'), (req, res) => {
  const { poToken } = require('./public-po');
  const db = read();
  const po = db.purchase_orders.find(x => x.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'PO no encontrada' });

  const supplier = db.suppliers.find(s => s.id === po.supplier_id) || {};
  const poLines  = db.purchase_order_items.filter(x => x.purchase_order_id === po.id);

  const lineDetails = poLines.map(l => {
    const cat  = db.catalog_items.find(c => c.id === l.catalog_item_id) || {};
    const name = cat.name || l.description || l.manual_item_name || 'ítem';
    const code = cat.code || '—';
    const reqItem = db.requisition_items.find(ri => ri.id === l.requisition_item_id) || {};
    const reqRow  = reqItem.requisition_id ? db.requisitions.find(r => r.id === reqItem.requisition_id) || {} : {};
    const urgency = reqRow.urgency || '—';
    const estDate = reqRow.programmed_date || '—';
    const subtotal = (Number(l.quantity||0) * Number(l.unit_cost||0)).toFixed(2);
    const winQuote = reqItem.winning_quote_id ? (db.quotations || []).find(q => q.id === reqItem.winning_quote_id) : null;
    return [
      `  ┌─ ${name} [${code}]`,
      `  │  Cantidad: ${l.quantity} ${l.unit || ''}   Precio unit.: $${Number(l.unit_cost||0).toFixed(2)} ${l.currency||po.currency||'MXN'}   Subtotal: $${subtotal}`,
      winQuote ? `  │  Ref. cotización: ${winQuote.folio || ('#' + winQuote.id)}` : null,
      `  └─ Urgencia: ${urgency}   Fecha estimada de entrega: ${estDate}`
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const buyers     = db.users.filter(u => u.role_code === 'comprador'   && u.active !== false);
  const authorizers = db.users.filter(u => u.role_code === 'autorizador' && u.active !== false);
  const ccEmails   = [...buyers.map(u => u.email), ...authorizers.map(u => u.email)].filter(Boolean);
  const firstLine    = poLines[0];
  const firstReqItem = firstLine ? db.requisition_items.find(ri => ri.id === firstLine.requisition_item_id) : null;
  const reqRow2      = firstReqItem ? db.requisitions.find(r => r.id === firstReqItem.requisition_id) : null;
  const requester    = reqRow2 ? db.users.find(u => u.id === reqRow2.requester_user_id) : null;
  const allCc = [...new Set([...ccEmails, requester?.email].filter(Boolean))].join(',');

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.get('host');
  const baseUrl  = (process.env.FRONTEND_URL || `${proto}://${host}`).replace(/\/$/, '');
  const token    = poToken(po);
  const poViewUrl = `${baseUrl}/po-view?token=${token}`;
  const subject  = `Orden de Compra ${po.folio} · ${supplier.business_name || ''}`;

  const body = [
    `Estimado ${supplier.contact_name || supplier.business_name || 'Proveedor'},`,
    ``,
    `Le enviamos la Orden de Compra ${po.folio}.`,
    ``,
    `Proveedor : ${supplier.business_name || '—'}`,
    `Fecha PO  : ${String(po.created_at||'').slice(0,10)}`,
    ``,
    `── Ítems solicitados ────────────────────────────`,
    ``,
    lineDetails,
    ``,
    `────────────────────────────────────────────────`,
    `Total: $${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}`,
    ``,
    `── Ver y confirmar esta orden ───────────────────`,
    `Puede ver el PDF de esta orden y confirmar su fecha`,
    `compromiso de entrega en el siguiente enlace:`,
    ``,
    `${poViewUrl}`,
    ``,
    `Gracias.`
  ].join('\n');

  const mailto = `mailto:${encodeURIComponent(supplier.email||'')}?cc=${encodeURIComponent(allCc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  res.json({ mailto, supplier_id: po.supplier_id, supplier_name: supplier.business_name || '', supplier_email: supplier.email || '', cc: allCc, po_view_url: poViewUrl });
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
  // ── Trigger ENTRADA en Vales cuando PO se marca Entregado ─────────────────
  if (newStatus === 'Entregado' && oldStatus !== 'Entregado') {
    try {
      const { read: readVales, write: writeVales, nextId: nextIdVales } = require('../db-vales');
      const dbVales = readVales();
      let valesUpdated = false;
      poItems.forEach(poLine => {
        const reqItem = db.requisition_items.find(i => i.id === poLine.requisition_item_id);
        if (!reqItem) return;
        const catItem = db.catalog_items.find(c => c.id === Number(reqItem.catalog_item_id));
        if (!catItem || !catItem.vales_item) return;
        const valesItem = (dbVales.items_vales || []).find(v => v.item === catItem.vales_item);
        if (!valesItem) return;
        const invItem = (db.inventory_items || []).find(x => Number(x.catalog_item_id) === Number(catItem.id));
        const pesoKg = invItem && invItem.peso_kg_por_unidad ? Number(invItem.peso_kg_por_unidad) : 1;
        const qty = parseFloat(reqItem.quantity) || 1;
        const kg = qty * pesoKg;
        const now = new Date();
        dbVales.kardex_vales = dbVales.kardex_vales || [];
        dbVales.kardex_vales.push({
          id: nextIdVales(dbVales.kardex_vales),
          fecha: now.toISOString().slice(0, 10),
          tipo: 'ENTRADA',
          referencia: po.folio || ('PO-' + po.id),
          item: catItem.vales_item,
          cantidad: qty,
          unidad: reqItem.unit || 'TAMBO',
          kg: Math.round(kg * 1000) / 1000,
          linea: '',
          no_tanque: '',
          nombre_tanque: '',
          comentario: `Recepción PO ${po.folio}`,
          usuario: req.user.full_name || req.user.email,
          detalle_id: null,
          created_at: now.toISOString()
        });
        // Update inventario_vales
        dbVales.inventario_vales = dbVales.inventario_vales || [];
        let inv = dbVales.inventario_vales.find(i => i.item === catItem.vales_item);
        if (!inv) {
          inv = { id: nextIdVales(dbVales.inventario_vales), item: catItem.vales_item, existencia_kg: 0, ultima_actualizacion: now.toISOString() };
          dbVales.inventario_vales.push(inv);
        }
        inv.existencia_kg = Math.round(((parseFloat(inv.existencia_kg) || 0) + kg) * 1000) / 1000;
        inv.ultima_actualizacion = now.toISOString();
        valesUpdated = true;
      });
      if (valesUpdated) writeVales(dbVales);
    } catch (valesErr) {
      console.error('[purchases] Error al sincronizar ENTRADA en Vales:', valesErr.message);
    }
  }
  write(db);
  const response = { ...po };
  if (newStatus === 'Entregado' && Number(po.advance_paid || 0) > 0) {
    response.advance_reminder = `⚠ Recuerda: esta PO tiene un anticipo pagado de $${Number(po.advance_paid).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'} (${po.advance_percentage}%). El saldo pendiente por facturar es $${(Number(po.total_amount||0) - Number(po.advance_paid||0)).toLocaleString('es-MX',{minimumFractionDigits:2})}.`;
  }

  // Correo de entrega con detalles de ítems + link para registrar factura
  if (newStatus === 'Entregado') {
    try {
      const { poToken } = require('./public-po');
      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const baseUrl = (process.env.FRONTEND_URL || `${proto}://${host}`).replace(/\/$/, '');
      const token = poToken(po);
      const poViewUrl = `${baseUrl}/po-view?token=${token}`;

      const supplier = db.suppliers.find(s => s.id === po.supplier_id) || {};
      const lineDetails = poItems.map(poLine => {
        const cat = db.catalog_items.find(c => c.id === poLine.catalog_item_id) || {};
        const name = cat.name || poLine.description || poLine.manual_item_name || 'ítem';
        const code = cat.code || '—';
        const subtotal = (Number(poLine.quantity||0) * Number(poLine.unit_cost||0)).toFixed(2);
        return `  • ${name} [${code}]  ×${poLine.quantity} ${poLine.unit||''}  @$${Number(poLine.unit_cost||0).toFixed(2)} ${poLine.currency||po.currency||'MXN'}  = $${subtotal}`;
      }).join('\n');

      const balancePending = Number(po.total_amount||0) - Number(po.advance_paid||0);
      const subject = `Entrega confirmada — ${po.folio} · Registrar factura`;
      const body = [
        `Estimado ${supplier.contact_name || supplier.business_name || 'Proveedor'},`,
        ``,
        `Le confirmamos la recepción de los materiales/servicios de la Orden de Compra ${po.folio}.`,
        ``,
        `── Ítems entregados ──────────────────────────────`,
        lineDetails,
        ``,
        `Total PO : $${Number(po.total_amount||0).toLocaleString('es-MX',{minimumFractionDigits:2})} ${po.currency||'MXN'}`,
        Number(po.advance_paid||0) > 0 ? `Anticipo pagado: $${Number(po.advance_paid).toLocaleString('es-MX',{minimumFractionDigits:2})}  |  Saldo a facturar: $${balancePending.toLocaleString('es-MX',{minimumFractionDigits:2})}` : null,
        ``,
        `── Registrar factura ────────────────────────────`,
        `Por favor registre su factura en el portal de proveedores:`,
        ``,
        poViewUrl,
        ``,
        `Gracias.`
      ].filter(l => l !== null).join('\n');

      const buyers = db.users.filter(u => u.role_code === 'comprador' && u.active !== false);
      const ccEmails = buyers.map(u => u.email).filter(Boolean).join(',');
      response.delivery_mailto = `mailto:${encodeURIComponent(supplier.email||'')}?cc=${encodeURIComponent(ccEmails)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      response.supplier_email = supplier.email || '';
      response.po_view_url = poViewUrl;
    } catch(emailErr) {
      console.error('[purchases] Error generando correo de entrega:', emailErr.message);
    }
  }

  res.json(response);
});

// FASE 4: KPI de costos por Centro de Costo / Sub-Centro de Costo
router.get('/kpi-costs', allowRoles('comprador', 'autorizador', 'pagos', 'admin'), (req, res) => {
  const db = read();
  const now = new Date();
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  const activeItems = (db.requisition_items || []).filter(ri =>
    !['Cancelado', 'Rechazado', 'Borrador', 'En cotización'].includes(ri.status) &&
    Number(ri.unit_cost || 0) > 0
  );

  const sumSpend = (items, from, to) =>
    items
      .filter(ri => { const d = new Date(ri.updated_at || ri.created_at || 0); return d >= from && d < to; })
      .reduce((s, ri) => s + Number(ri.quantity || 0) * Number(ri.unit_cost || 0), 0);

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
  }).reverse();

  const costCenters = (db.cost_centers || []).filter(cc => cc.active !== false);
  const subCostCenters = (db.sub_cost_centers || []).filter(scc => scc.active !== false);

  const result = costCenters.map(cc => {
    const ccItems = activeItems.filter(ri => ri.cost_center_id === cc.id);
    const ccSccs = subCostCenters.filter(scc => scc.cost_center_id === cc.id);
    return {
      id: cc.id, code: cc.code, name: cc.name,
      total: ccItems.reduce((s, ri) => s + Number(ri.quantity || 0) * Number(ri.unit_cost || 0), 0),
      by_month: months.map(m => ({ label: m.label, amount: sumSpend(ccItems, m.from, m.to) })),
      sub_cost_centers: ccSccs.map(scc => {
        const sccItems = ccItems.filter(ri => ri.sub_cost_center_id === scc.id);
        return {
          id: scc.id, code: scc.code, name: scc.name,
          total: sccItems.reduce((s, ri) => s + Number(ri.quantity || 0) * Number(ri.unit_cost || 0), 0),
          by_month: months.map(m => ({ label: m.label, amount: sumSpend(sccItems, m.from, m.to) })),
          items: sccItems.map(ri => ({
            id: ri.id,
            name: (db.catalog_items.find(c => c.id === ri.catalog_item_id) || {}).name || ri.manual_item_name || '-',
            quantity: ri.quantity, unit: ri.unit, unit_cost: ri.unit_cost,
            currency: ri.currency || 'MXN', status: ri.status,
            total: Number(ri.quantity || 0) * Number(ri.unit_cost || 0)
          }))
        };
      })
    };
  });

  res.json({ cost_centers: result, months_labels: months.map(m => m.label) });
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
