const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const router = express.Router();
router.use(authRequired);
router.use(allowRoles('admin'));

router.get('/users', (req, res) => res.json(read().users.map(u => ({ ...u, password_hash: undefined }))));

router.post('/users', (req, res) => {
  const db = read();
  const row = {
    id: nextId(db.users),
    full_name: req.body.full_name,
    email: req.body.email,
    password_hash: bcrypt.hashSync(req.body.password || 'Demo123*', 10),
    role_code: req.body.role_code || 'cliente_requisicion',
    supplier_id: req.body.supplier_id ? Number(req.body.supplier_id) : null,
    default_cost_center_id: req.body.default_cost_center_id ? Number(req.body.default_cost_center_id) : null,
    department: req.body.department || 'GENERAL',
    active: req.body.active !== false
  };
  if (!row.full_name || !row.email) return res.status(400).json({ error: 'Nombre y correo requeridos' });
  if (row.role_code === 'proveedor' && !row.supplier_id) {
    return res.status(400).json({ error: 'Los usuarios de tipo proveedor deben tener un proveedor asignado' });
  }
  db.users.push(row);
  write(db);
  res.status(201).json({ ...row, password_hash: undefined });
});

router.patch('/users/:id', (req, res) => {
  const db = read();
  const u = db.users.find(x => x.id === Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (req.body.full_name !== undefined) u.full_name = req.body.full_name;
  if (req.body.email !== undefined) u.email = req.body.email;
  if (req.body.role_code !== undefined) u.role_code = req.body.role_code;
  if (req.body.supplier_id !== undefined) u.supplier_id = req.body.supplier_id ? Number(req.body.supplier_id) : null;
  if (req.body.default_cost_center_id !== undefined) u.default_cost_center_id = req.body.default_cost_center_id ? Number(req.body.default_cost_center_id) : null;
  if (req.body.default_sub_cost_center_id !== undefined) u.default_sub_cost_center_id = req.body.default_sub_cost_center_id ? Number(req.body.default_sub_cost_center_id) : null;
  if (req.body.allowed_scc_ids !== undefined) u.allowed_scc_ids = Array.isArray(req.body.allowed_scc_ids) ? req.body.allowed_scc_ids.map(Number).filter(Boolean) : [];
  if (req.body.department !== undefined) u.department = req.body.department;
  if (req.body.active !== undefined) u.active = req.body.active;
  if (req.body.password) u.password_hash = bcrypt.hashSync(req.body.password, 10);
  if (u.role_code === 'proveedor' && !u.supplier_id) {
    return res.status(400).json({ error: 'Los usuarios de tipo proveedor deben tener un proveedor asignado' });
  }
  write(db);
  res.json({ ...u, password_hash: undefined });
});

// Crear proveedor + usuario proveedor en una sola operación
router.post('/suppliers-with-user', (req, res) => {
  const db = read();
  if (!req.body.business_name) return res.status(400).json({ error: 'Nombre del proveedor requerido' });
  if (!req.body.user_email) return res.status(400).json({ error: 'Correo del usuario proveedor requerido' });
  if (!req.body.user_full_name) return res.status(400).json({ error: 'Nombre del usuario proveedor requerido' });

  // Crear proveedor
  const supplier = {
    id: nextId(db.suppliers),
    provider_code: req.body.provider_code || req.body.business_name.substring(0, 3).toUpperCase() + '-' + String(nextId(db.suppliers)).padStart(3, '0'),
    business_name: req.body.business_name,
    contact_name: req.body.contact_name || req.body.user_full_name,
    email: req.body.email || req.body.user_email,
    phone: req.body.phone || '',
    rfc: req.body.rfc || '',
    address: req.body.address || '',
    active: true,
    created_at: new Date().toISOString()
  };
  db.suppliers.push(supplier);

  // Crear usuario proveedor principal
  const user = {
    id: nextId(db.users),
    full_name: req.body.user_full_name,
    email: req.body.user_email,
    password_hash: bcrypt.hashSync(req.body.user_password || 'Demo123*', 10),
    role_code: 'proveedor',
    supplier_id: supplier.id,
    department: 'EXTERNO',
    active: true,
    created_at: new Date().toISOString()
  };
  db.users.push(user);

  write(db);
  res.status(201).json({
    supplier,
    user: { ...user, password_hash: undefined },
    message: `Proveedor "${supplier.business_name}" creado con usuario "${user.email}"`
  });
});

// ── Solicitudes de recuperación de contraseña ─────────────────────────────────
router.get('/password-requests', (req, res) => {
  const db = read();
  const pending = (db.password_reset_requests || []).filter(r => r.status === 'pending');
  res.json(pending);
});

router.post('/password-requests/:id/approve', (req, res) => {
  const db = read();
  if (!db.password_reset_requests) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const request = db.password_reset_requests.find(r => r.id === Number(req.params.id) && r.status === 'pending');
  if (!request) return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada' });

  if (!db.password_reset_tokens) db.password_reset_tokens = [];
  // Invalidar tokens previos del usuario
  db.password_reset_tokens.forEach(t => { if (t.user_id === request.user_id && t.status === 'active') t.status = 'replaced'; });

  const token = crypto.randomBytes(32).toString('hex');
  db.password_reset_tokens.push({
    id: nextId(db.password_reset_tokens),
    user_id: request.user_id,
    token,
    created_at: new Date().toISOString(),
    status: 'active'
  });

  request.status = 'approved';
  request.approved_at = new Date().toISOString();
  request.approved_by = req.user.id;
  write(db);

  // Construir URL del sistema (prioridad: var de entorno > origin header > host con protocolo)
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const baseUrl = (process.env.FRONTEND_URL || `${proto}://${req.get('host')}/compras`).replace(/\/$/, '');
  const resetUrl = `${baseUrl}#/reset-password?token=${token}`;

  const subject = `Cambio de contraseña autorizado · Sistema de Compras`;
  const body = `Hola ${request.user_name},\n\nTu solicitud de cambio de contraseña ha sido autorizada.\n\nHaz clic en el siguiente enlace para crear tu nueva contraseña:\n${resetUrl}\n\nEste enlace expira en 24 horas.\nSi no solicitaste este cambio, ignora este mensaje.`;
  const mailto = `mailto:${encodeURIComponent(request.user_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  res.json({ ok: true, mailto, reset_url: resetUrl, message: `Enlace generado para ${request.user_name}` });
});

router.delete('/password-requests/:id', (req, res) => {
  const db = read();
  if (!db.password_reset_requests) return res.status(404).json({ error: 'No encontrado' });
  const r = db.password_reset_requests.find(x => x.id === Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  r.status = 'rejected';
  r.rejected_at = new Date().toISOString();
  write(db);
  res.json({ ok: true });
});

// ── Exportar base de datos completa ───────────────────────────────────────────
router.get('/export-db', (req, res) => {
  const db = read();
  // Ocultar hashes de contraseñas por seguridad
  const safe = {
    ...db,
    users: (db.users || []).map(u => ({ ...u, password_hash: undefined }))
  };
  const json = JSON.stringify(safe, null, 2);
  const filename = `backup-db-${new Date().toISOString().slice(0,10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(json);
});

// ── Importar / reemplazar base de datos completa ──────────────────────────────
router.post('/import-db', (req, res) => {
  if (req.body.confirm !== 'IMPORT_CONFIRMAR') {
    return res.status(400).json({ error: 'Debes enviar { confirm: "IMPORT_CONFIRMAR", data: {...} }' });
  }
  const incoming = req.body.data;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Se requiere el campo "data" con el JSON de la base de datos' });
  }
  // Conservar password_hashes de usuarios existentes y mezclar con los importados
  const currentDb = read();
  const merged = { ...currentDb, ...incoming };
  // Re-mapear contraseñas: si el usuario importado no trae hash, conservar el actual
  merged.users = (incoming.users || []).map(u => {
    if (u.password_hash) return u;
    const existing = currentDb.users.find(x => x.id === u.id || x.email === u.email);
    return { ...u, password_hash: existing?.password_hash || bcrypt.hashSync('Demo123*', 10) };
  });
  write(merged);
  res.json({
    ok: true,
    message: `Base de datos importada correctamente. ${merged.users?.length || 0} usuarios, ${merged.suppliers?.length || 0} proveedores, ${merged.catalog_items?.length || 0} ítems de catálogo.`
  });
});

// ── Reset de base de datos de pruebas (conserva catálogos y usuarios) ─────────
// ⚠ SOLO PARA ENTORNOS DE PRUEBA — eliminar antes de producción final
router.post('/reset-db', (req, res) => {
  const db = read();
  if (req.body.confirm !== 'RESET_CONFIRMAR') {
    return res.status(400).json({ error: 'Debes enviar { confirm: "RESET_CONFIRMAR" }' });
  }
  db.requisitions = [];
  db.requisition_items = [];
  db.quotation_requests = [];
  db.quotations = [];
  db.purchase_orders = [];
  db.purchase_order_items = [];
  db.invoices = [];
  db.invoice_items = [];
  db.payments = [];
  db.status_history = [];
  write(db);
  res.json({ ok: true, message: 'Base de datos de transacciones reiniciada. Catálogos, usuarios, proveedores, reglas e inventario conservados.' });
});

// ── Información del sistema ────────────────────────────────────────────────
router.get('/system-info', (req, res) => {
  const db = read();
  const mem = process.memoryUsage();

  // Tamaño del archivo de base de datos
  let dbSize = 0;
  try {
    const dbPath = path.resolve(process.cwd(), 'database/app.json');
    dbSize = fs.statSync(dbPath).size;
  } catch (e) {}

  // Tamaño total de la carpeta storage (archivos PDF/XML/imágenes)
  let storageSize = 0;
  let invoiceFileCount = 0;
  let paymentFileCount = 0;
  const walkDir = dir => {
    try {
      fs.readdirSync(dir).forEach(f => {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) walkDir(fp);
        else {
          storageSize += stat.size;
          if (fp.includes('invoices')) invoiceFileCount++;
          if (fp.includes('payments')) paymentFileCount++;
        }
      });
    } catch (e) {}
  };
  walkDir(path.resolve(process.cwd(), 'storage'));

  // Rango de fechas de transacciones
  const allDates = [
    ...(db.requisitions || []).map(r => r.request_date || r.created_at),
    ...(db.purchase_orders || []).map(p => p.created_at),
    ...(db.payments || []).map(p => p.created_at)
  ].filter(Boolean).sort();
  const oldest = allDates[0] || null;
  const newest = allDates[allDates.length - 1] || null;
  const monthsCovered = oldest
    ? Math.floor((Date.now() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
    : 0;

  res.json({
    memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
    db: {
      size: dbSize,
      requisitions: db.requisitions?.length || 0,
      purchase_orders: db.purchase_orders?.length || 0,
      invoices: db.invoices?.length || 0,
      payments: db.payments?.length || 0,
      history: db.status_history?.length || 0
    },
    storage: { size: storageSize, invoiceFiles: invoiceFileCount, paymentFiles: paymentFileCount },
    timeline: { oldest, newest, monthsCovered }
  });
});

// ── Archivar y eliminar datos antiguos ────────────────────────────────────
router.post('/archive-old-data', (req, res) => {
  if (req.body.confirm !== 'ARCHIVE_CONFIRMAR') {
    return res.status(400).json({ error: 'Debes enviar { confirm: "ARCHIVE_CONFIRMAR", cutoff_date: "YYYY-MM-DD" }' });
  }
  if (!req.body.cutoff_date) return res.status(400).json({ error: 'Se requiere cutoff_date (YYYY-MM-DD)' });

  const db = read();
  const cutoff = new Date(req.body.cutoff_date);

  const oldReqs = db.requisitions.filter(r => new Date(r.request_date || r.created_at) < cutoff);
  const oldReqIds = new Set(oldReqs.map(r => r.id));
  const oldItems = db.requisition_items.filter(i => oldReqIds.has(i.requisition_id));
  const oldItemIds = new Set(oldItems.map(i => i.id));
  const oldPOs = db.purchase_orders.filter(p => {
    if (new Date(p.created_at) < cutoff) return true;
    return (p.requisition_ids || []).every(rid => oldReqIds.has(rid));
  });
  const oldPOIds = new Set(oldPOs.map(p => p.id));
  const oldPOItems = db.purchase_order_items.filter(i => oldPOIds.has(i.purchase_order_id));
  const oldInvoices = db.invoices.filter(i => oldPOIds.has(i.purchase_order_id));
  const oldInvoiceIds = new Set(oldInvoices.map(i => i.id));
  const oldPayments = db.payments.filter(p => oldInvoiceIds.has(p.invoice_id));
  const oldHistory = (db.status_history || []).filter(h => oldReqIds.has(h.requisition_id));
  const oldQuotationReqs = (db.quotation_requests || []).filter(q => oldItemIds.has(q.requisition_item_id));
  const oldQuotations = (db.quotations || []).filter(q => oldItemIds.has(q.requisition_item_id));

  if (!oldReqs.length && !oldPOs.length) {
    return res.status(400).json({ error: 'No hay datos anteriores a esa fecha para archivar.' });
  }

  const archived = {
    archived_at: new Date().toISOString(),
    cutoff_date: req.body.cutoff_date,
    requisitions: oldReqs,
    requisition_items: oldItems,
    purchase_orders: oldPOs,
    purchase_order_items: oldPOItems,
    invoices: oldInvoices,
    payments: oldPayments,
    status_history: oldHistory,
    quotation_requests: oldQuotationReqs,
    quotations: oldQuotations
  };

  // Remover de la DB
  db.requisitions = db.requisitions.filter(r => !oldReqIds.has(r.id));
  db.requisition_items = db.requisition_items.filter(i => !oldItemIds.has(i.id));
  db.purchase_orders = db.purchase_orders.filter(p => !oldPOIds.has(p.id));
  db.purchase_order_items = db.purchase_order_items.filter(i => !oldPOIds.has(i.purchase_order_id));
  db.invoices = db.invoices.filter(i => !oldInvoiceIds.has(i.id));
  db.payments = db.payments.filter(p => !oldInvoiceIds.has(p.invoice_id));
  if (db.status_history) db.status_history = db.status_history.filter(h => !oldReqIds.has(h.requisition_id));
  if (db.quotation_requests) db.quotation_requests = db.quotation_requests.filter(q => !oldItemIds.has(q.requisition_item_id));
  if (db.quotations) db.quotations = db.quotations.filter(q => !oldItemIds.has(q.requisition_item_id));
  write(db);

  const summary = {
    requisitions: oldReqs.length,
    purchase_orders: oldPOs.length,
    invoices: oldInvoices.length,
    payments: oldPayments.length
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="archivo-${req.body.cutoff_date}.json"`);
  res.json({ ...archived, _summary: summary });
});

// ── Reparar ítems atascados en 'En cotización' con cotización ganadora sin sincronizar ──
router.post('/repair-stuck-items', (req, res) => {
  const { deriveItemStatus, recalcRequisition, addHistory } = require('../utils/workflow');
  const db = read();
  const report = [];

  (db.requisition_items || []).forEach(item => {
    if (item.status !== 'En cotización') return;

    // Buscar cotización ganadora para este ítem
    const winner = (db.quotations || []).find(q => q.requisition_item_id === item.id && q.is_winner);
    if (!winner) return; // sin ganadora → no reparar

    const before = { supplier_id: item.supplier_id, unit_cost: item.unit_cost, winning_quote_id: item.winning_quote_id, status: item.status };

    // Sincronizar campos del ítem desde la cotización ganadora
    item.supplier_id    = winner.supplier_id;
    item.unit_cost      = winner.unit_cost;
    item.currency       = winner.currency || item.currency || 'MXN';
    item.winning_quote_id = winner.id;
    if (!item.catalog_item_id && winner.catalog_item_id) item.catalog_item_id = winner.catalog_item_id;
    item.updated_at     = new Date().toISOString();

    // Re-derivar status
    recalcRequisition(db, item.requisition_id);
    const req2 = db.requisitions.find(r => r.id === item.requisition_id);
    item.status = deriveItemStatus(db, Number(req2?.total_amount || 0), item);

    // Si sigue en 'En autorización', auto-autorizar (comprador/admin eligió la cotización)
    if (item.status === 'En autorización') item.status = 'Autorizado';

    addHistory(db, {
      module: 'purchases',
      requisition_id: item.requisition_id,
      requisition_item_id: item.id,
      old_status: before.status,
      new_status: item.status,
      changed_by_user_id: req.user.id,
      comment: `Reparación automática: cotización ganadora sincronizada (quote #${winner.id})`
    });

    recalcRequisition(db, item.requisition_id);

    const req3 = db.requisitions.find(r => r.id === item.requisition_id);
    report.push({
      item_id: item.id,
      item_name: (db.catalog_items.find(c => c.id === item.catalog_item_id) || {}).name || item.manual_item_name || '—',
      requisition_folio: req3?.folio || '—',
      before,
      after: { supplier_id: item.supplier_id, unit_cost: item.unit_cost, winning_quote_id: item.winning_quote_id, status: item.status },
      winner_supplier: (db.suppliers.find(s => s.id === winner.supplier_id) || {}).business_name || '—'
    });
  });

  if (report.length > 0) write(db);

  res.json({ fixed: report.length, items: report });
});

// ── Migración: reparar IDs duplicados en requisition_items ──────────────────
// Bug: buildItems llamaba nextId() dentro del .map() sin pushear al array,
// causando que todos los ítems de un mismo lote recibieran el mismo ID.
//
// IMPORTANTE: Solo repara grupos donde NINGÚN ítem tiene purchase_order_id.
// Los ítems que ya tienen PO generada se dejan intactos — sus referencias en
// purchase_order_items ya están establecidas y cambiarlas sería arriesgado.
// (Esos ítems están en estado Enviada/En proceso/Entregado y no necesitan PO nueva.)
router.post('/migrate-fix-item-ids', (req, res) => {
  const db = read();
  const items = db.requisition_items;

  // Encontrar IDs duplicados
  const idCount = {};
  items.forEach(i => { idCount[i.id] = (idCount[i.id] || 0) + 1; });
  const duplicateIds = Object.keys(idCount).filter(id => idCount[id] > 1).map(Number);

  if (!duplicateIds.length) {
    return res.json({ fixed: 0, message: 'No se encontraron IDs duplicados.' });
  }

  let maxId = Math.max(...items.map(i => Number(i.id) || 0));
  const fixed = [];
  const skipped = [];

  duplicateIds.forEach(dupId => {
    const group = items.filter(i => i.id === dupId);

    // Si CUALQUIER ítem del grupo ya tiene PO → no tocar (datos históricos seguros)
    const anyHasPO = group.some(i => i.purchase_order_id);
    if (anyHasPO) {
      skipped.push({ id: dupId, reason: 'Tiene PO generada — no se modifica', count: group.length });
      return;
    }

    // Todos sin PO → asignar IDs únicos. El primero conserva su ID original.
    group.slice(1).forEach(item => {
      const oldId = item.id;
      const newId = ++maxId;
      // Solo actualizar quotations y quotation_requests (no hay purchase_order_items para estos)
      (db.quotations || []).forEach(q => {
        if (q.requisition_item_id === oldId) q.requisition_item_id = newId;
      });
      (db.quotation_requests || []).forEach(qr => {
        if (qr.requisition_item_id === oldId) qr.requisition_item_id = newId;
      });
      const cat = db.catalog_items.find(c => c.id === item.catalog_item_id);
      fixed.push({
        requisition_id: item.requisition_id,
        name: cat?.name || item.manual_item_name || '?',
        old_id: oldId,
        new_id: newId
      });
      item.id = newId;
    });
  });

  if (fixed.length > 0) write(db);

  res.json({
    fixed: fixed.length,
    skipped: skipped.length,
    message: `${fixed.length} ítems reparados. ${skipped.length} grupos omitidos (ya tienen PO).`,
    items_fixed: fixed,
    groups_skipped: skipped
  });
});

module.exports = router;
