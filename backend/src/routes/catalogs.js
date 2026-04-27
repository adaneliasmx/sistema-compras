const express = require('express');
const bcrypt = require('bcryptjs');
const { read, write, nextId } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);

const canManageCatalogs = user => ['admin', 'comprador'].includes(user.role_code);
const canManageRules = user => ['admin', 'comprador'].includes(user.role_code);
const canAccessInventory = user => ['admin', 'comprador', 'inventarios'].includes(user.role_code);

function providerCodeFromName(name = '', existing = []) {
  const letters = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 3).map(x => x[0]).join('') || 'PRV';
  const count = existing.filter(x => String(x.provider_code || '').startsWith(letters)).length + 1;
  return `${letters}-${String(count).padStart(3, '0')}`;
}

function itemCodeFromName(name = '', existing = []) {
  const letters = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 3).map(x => x[0]).join('') || 'ITM';
  const count = existing.filter(x => String(x.code || '').startsWith(letters)).length + 1;
  return `${letters}-${String(count).padStart(3, '0')}`;
}

function parseCsv(text = '') {
  const lines = String(text).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(x => x.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => row[h] = (cols[i] || '').trim());
    return row;
  });
}

router.get('/summary', (req, res) => {
  const db = read();
  res.json({ items: db.catalog_items.length, suppliers: db.suppliers.length, cost_centers: db.cost_centers.length, sub_cost_centers: db.sub_cost_centers.length, inventory_catalogs: db.inventory_catalogs.length, inventory_items: db.inventory_items.length, approval_rules: db.approval_rules.length });
});

// Sugerir código único de ítem basado en nombre
router.get('/items/suggest-code', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const name = String(req.query.name || '');
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const suggested = itemCodeFromName(name, db.catalog_items);
  const exists = db.catalog_items.some(x => x.code === suggested);
  res.json({ suggested, exists });
});

// Verificar si un código de ítem ya existe
router.get('/items/check-code', (req, res) => {
  const db = read();
  const code = String(req.query.code || '').trim();
  const excludeId = req.query.exclude_id ? Number(req.query.exclude_id) : null;
  const exists = db.catalog_items.some(x => x.code === code && x.id !== excludeId);
  const nameLike = req.query.name ? db.catalog_items.filter(x => String(x.name).toLowerCase().includes(String(req.query.name).toLowerCase())).slice(0, 5) : [];
  res.json({ code_exists: exists, name_matches: nameLike });
});

router.get('/units', (req, res) => res.json(read().units || ['pza', 'kg', 'litro', 'tambor', 'serv']));

router.get('/items', (req, res) => {
  const db = read();
  let rows = db.catalog_items.filter(x => x.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (req.query.supplier_id) rows = rows.filter(x => Number(x.supplier_id) === Number(req.query.supplier_id));
  res.json(rows.map(i => ({ ...i, supplier_name: (db.suppliers.find(s => s.id === i.supplier_id) || {}).business_name || '-' })));
});

router.post('/items', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  if (!req.body.name) return res.status(400).json({ error: 'Nombre requerido' });

  const suggestedCode = req.body.code || itemCodeFromName(req.body.name, db.catalog_items);

  // Validar código único
  if (db.catalog_items.some(x => x.code === suggestedCode)) {
    return res.status(400).json({ error: `El código "${suggestedCode}" ya existe. Usa uno diferente.`, suggested_code: suggestedCode + '-' + String(Date.now()).slice(-3) });
  }

  // Advertir si hay nombre muy similar (no bloquear, solo devolver warnings)
  const nameLower = String(req.body.name).toLowerCase().trim();
  const similar = db.catalog_items.filter(x => String(x.name).toLowerCase().trim() === nameLower);
  if (similar.length && !req.body.force_duplicate) {
    return res.status(409).json({ error: `Ya existe un ítem con nombre similar: "${similar[0].name}" (código: ${similar[0].code}). Envía force_duplicate=true para registrar de todas formas.`, existing: similar[0] });
  }

  const row = {
    id: nextId(db.catalog_items),
    code: suggestedCode,
    name: req.body.name,
    item_type: req.body.item_type || 'uso continuo',
    unit: req.body.unit || 'pza',
    supplier_id: req.body.supplier_id ? Number(req.body.supplier_id) : null,
    equivalent_code: req.body.equivalent_code || '',
    unit_price: Number(req.body.unit_price || 0),
    currency: req.body.currency || 'MXN',
    quote_validity_days: Number(req.body.quote_validity_days || 30),
    active: true,
    inventoried: !!req.body.inventoried,
    created_at: new Date().toISOString()
  };
  db.catalog_items.push(row);
  write(db);
  res.status(201).json(row);
});

router.patch('/items/:id', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const row = db.catalog_items.find(x => x.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Ítem no encontrado' });

  if (req.body.code && req.body.code !== row.code) {
    if (db.catalog_items.some(x => x.code === req.body.code && x.id !== row.id)) {
      return res.status(400).json({ error: `El código "${req.body.code}" ya está en uso` });
    }
    row.code = req.body.code;
  }
  if (req.body.name !== undefined) row.name = req.body.name;
  if (req.body.unit !== undefined) row.unit = req.body.unit;
  if (req.body.supplier_id !== undefined) row.supplier_id = req.body.supplier_id ? Number(req.body.supplier_id) : null;
  if (req.body.unit_price !== undefined) row.unit_price = Number(req.body.unit_price);
  if (req.body.currency !== undefined) row.currency = req.body.currency;
  if (req.body.item_type !== undefined) row.item_type = req.body.item_type;
  if (req.body.inventoried !== undefined) row.inventoried = !!req.body.inventoried;
  if (req.body.active !== undefined) row.active = !!req.body.active;
  row.updated_at = new Date().toISOString();
  write(db);
  res.json(row);
});

router.delete('/items/:id', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const idx = db.catalog_items.findIndex(x => x.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado' });
  // Soft delete
  db.catalog_items[idx].active = false;
  db.catalog_items[idx].deleted_at = new Date().toISOString();
  write(db);
  res.json({ ok: true });
});

// Sugerir código de proveedor
router.get('/suppliers/suggest-code', (req, res) => {
  const db = read();
  const name = String(req.query.name || '');
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const suggested = providerCodeFromName(name, db.suppliers);
  res.json({ suggested });
});

router.get('/suppliers', (req, res) => res.json(read().suppliers.sort((a,b)=>String(a.business_name).localeCompare(String(b.business_name)))));

router.post('/suppliers', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const suggested_code = req.body.provider_code || providerCodeFromName(req.body.business_name, db.suppliers);
  if (db.suppliers.some(x => x.provider_code === suggested_code)) {
    return res.status(400).json({ error: `El código "${suggested_code}" ya existe`, suggested_code });
  }
  const row = {
    id: nextId(db.suppliers),
    provider_code: suggested_code,
    business_name: req.body.business_name,
    contact_name: req.body.contact_name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    rfc: req.body.rfc || '',
    address: req.body.address || '',
    active: req.body.active !== false,
    created_at: new Date().toISOString()
  };
  if (!row.business_name) return res.status(400).json({ error: 'Nombre de proveedor requerido' });
  db.suppliers.push(row);

  let userCreated = null;
  if (req.body.user_email && req.body.user_full_name) {
    const user = { id: nextId(db.users), full_name: req.body.user_full_name, email: req.body.user_email, password_hash: bcrypt.hashSync(req.body.user_password || 'Demo123*', 10), role_code: 'proveedor', supplier_id: row.id, department: 'EXTERNO', active: true, created_at: new Date().toISOString() };
    db.users.push(user);
    userCreated = { ...user, password_hash: undefined };
  }
  write(db);
  res.status(201).json({ supplier: row, user: userCreated });
});

router.get('/suppliers/export-csv', (req, res) => {
  const db = read();
  const headers = ['provider_code', 'business_name', 'contact_name', 'email', 'phone', 'rfc', 'address'];
  const lines = [headers.join(',')];
  db.suppliers.forEach(s => {
    lines.push(headers.map(h => `"${String(s[h] || '').replace(/"/g, '""')}"`).join(','));
  });
  const csv = '\uFEFF' + lines.join('\r\n'); // BOM para Excel
  const filename = `proveedores-${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

router.post('/suppliers/import', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const rows = parseCsv(req.body.csv || '');
  let inserted = 0;
  rows.forEach(r => {
    if (!r.business_name) return;
    db.suppliers.push({ id: nextId(db.suppliers), provider_code: r.provider_code || providerCodeFromName(r.business_name, db.suppliers), business_name: r.business_name, contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '', rfc: r.rfc || '', address: r.address || '', active: true, created_at: new Date().toISOString() });
    inserted += 1;
  });
  write(db);
  res.json({ inserted });
});

router.patch('/suppliers/:id', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const row = db.suppliers.find(x => x.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Proveedor no encontrado' });
  if (req.body.provider_code && req.body.provider_code !== row.provider_code) {
    if (db.suppliers.some(x => x.provider_code === req.body.provider_code && x.id !== row.id)) {
      return res.status(400).json({ error: `El código "${req.body.provider_code}" ya está en uso` });
    }
  }
  Object.assign(row, { provider_code: req.body.provider_code || row.provider_code, business_name: req.body.business_name || row.business_name, contact_name: req.body.contact_name ?? row.contact_name, email: req.body.email ?? row.email, phone: req.body.phone ?? row.phone, rfc: req.body.rfc ?? row.rfc, address: req.body.address ?? row.address, active: req.body.active ?? row.active });
  write(db);
  res.json(row);
});

router.delete('/suppliers/:id', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const idx = db.suppliers.findIndex(x => x.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Proveedor no encontrado' });
  db.suppliers.splice(idx, 1);
  write(db);
  res.json({ ok: true });
});

// ── Asignaciones de subcentros por usuario ────────────────────────────────
router.get('/user-scc-assignments', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const assignableRoles = ['cliente_requisicion', 'comprador', 'autorizador', 'pagos', 'admin'];
  const users = db.users.filter(u => assignableRoles.includes(u.role_code) && u.active !== false).map(u => ({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    role_code: u.role_code,
    department: u.department || '',
    default_cost_center_id: u.default_cost_center_id || null,
    default_sub_cost_center_id: u.default_sub_cost_center_id || null,
    allowed_scc_ids: u.allowed_scc_ids || []
  }));
  res.json(users);
});

router.patch('/user-scc-assignments/:user_id', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const u = db.users.find(x => x.id === Number(req.params.user_id));
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (req.body.allowed_scc_ids !== undefined) u.allowed_scc_ids = Array.isArray(req.body.allowed_scc_ids) ? req.body.allowed_scc_ids.map(Number).filter(Boolean) : [];
  if (req.body.default_sub_cost_center_id !== undefined) u.default_sub_cost_center_id = req.body.default_sub_cost_center_id ? Number(req.body.default_sub_cost_center_id) : null;
  write(db);
  res.json({ ok: true, allowed_scc_ids: u.allowed_scc_ids, default_sub_cost_center_id: u.default_sub_cost_center_id });
});

router.get('/cost-centers', (req, res) => res.json(read().cost_centers.sort((a,b)=>String(a.code).localeCompare(String(b.code)))));
router.get('/sub-cost-centers', (req, res) => { const rows = read().sub_cost_centers.sort((a,b)=>String(a.code).localeCompare(String(b.code))); if (req.query.cost_center_id) return res.json(rows.filter(x => Number(x.cost_center_id) === Number(req.query.cost_center_id))); res.json(rows); });
router.get('/inventory-catalogs', (req, res) => res.json(read().inventory_catalogs.sort((a,b)=>String(a.name).localeCompare(String(b.name)))));
router.get('/inventory-items', (req, res) => { const db = read(); res.json(db.inventory_items.map(x => ({ ...x, item_name: (db.catalog_items.find(i => i.id === x.catalog_item_id) || {}).name || '', inventory_name: (db.inventory_catalogs.find(i => i.id === x.inventory_catalog_id) || {}).name || '' }))); });
router.get('/approval-rules', (req, res) => res.json(read().approval_rules.sort((a,b)=>Number(a.min_amount)-Number(b.min_amount))));

router.post('/cost-centers', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = { id: nextId(db.cost_centers), code: req.body.code, name: req.body.name, active: req.body.active !== false }; if (!row.code || !row.name) return res.status(400).json({ error: 'Código y nombre requeridos' }); db.cost_centers.push(row); write(db); res.status(201).json(row); });
router.patch('/cost-centers/:id', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = db.cost_centers.find(x => x.id === Number(req.params.id)); if (!row) return res.status(404).json({ error: 'Centro no encontrado' }); row.code = req.body.code || row.code; row.name = req.body.name || row.name; row.active = req.body.active ?? row.active; write(db); res.json(row); });
router.post('/sub-cost-centers', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = { id: nextId(db.sub_cost_centers), cost_center_id: Number(req.body.cost_center_id), code: req.body.code, name: req.body.name, active: req.body.active !== false }; if (!row.cost_center_id || !row.code || !row.name) return res.status(400).json({ error: 'Centro, código y nombre requeridos' }); db.sub_cost_centers.push(row); write(db); res.status(201).json(row); });
router.patch('/sub-cost-centers/:id', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = db.sub_cost_centers.find(x => x.id === Number(req.params.id)); if (!row) return res.status(404).json({ error: 'Subcentro no encontrado' }); row.cost_center_id = Number(req.body.cost_center_id || row.cost_center_id); row.code = req.body.code || row.code; row.name = req.body.name || row.name; row.active = req.body.active ?? row.active; write(db); res.json(row); });
router.post('/inventory-catalogs', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = { id: nextId(db.inventory_catalogs), name: req.body.name, description: req.body.description || '', active: true }; if (!row.name) return res.status(400).json({ error: 'Nombre requerido' }); db.inventory_catalogs.push(row); write(db); res.status(201).json(row); });
router.patch('/inventory-catalogs/:id', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = db.inventory_catalogs.find(x => x.id === Number(req.params.id)); if (!row) return res.status(404).json({ error: 'Inventario no encontrado' }); if (req.body.name !== undefined) row.name = req.body.name || row.name; if (req.body.description !== undefined) row.description = req.body.description; write(db); res.json(row); });
router.delete('/inventory-catalogs/:id', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = db.inventory_catalogs.find(x => x.id === Number(req.params.id)); if (!row) return res.status(404).json({ error: 'Inventario no encontrado' }); const hasItems = db.inventory_items.some(x => x.inventory_catalog_id === row.id); if (hasItems && !req.query.force) return res.status(409).json({ error: 'El inventario tiene ítems asociados. Usa force=1 para eliminar todo.', hasItems: true }); db.inventory_items = db.inventory_items.filter(x => x.inventory_catalog_id !== row.id); db.inventory_catalogs = db.inventory_catalogs.filter(x => x.id !== row.id); write(db); res.json({ ok: true }); });
router.post('/inventory-items', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = { id: nextId(db.inventory_items), inventory_catalog_id: Number(req.body.inventory_catalog_id), catalog_item_id: Number(req.body.catalog_item_id), unit: req.body.unit || 'pza', min_stock: Number(req.body.min_stock || 0), max_stock: Number(req.body.max_stock || 0), current_stock: Number(req.body.current_stock || 0), vales_item: req.body.vales_item || '', peso_kg_por_unidad: Number(req.body.peso_kg_por_unidad || 0), active: true }; if (!row.inventory_catalog_id || !row.catalog_item_id) return res.status(400).json({ error: 'Inventario e ítem requeridos' }); db.inventory_items.push(row); write(db); res.status(201).json(row); });
router.patch('/inventory-items/:id', (req, res) => {
  if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const row = db.inventory_items.find(x => x.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Ítem de inventario no encontrado' });
  if (req.body.current_stock !== undefined) row.current_stock = Number(req.body.current_stock);
  if (req.body.min_stock !== undefined) row.min_stock = Number(req.body.min_stock);
  if (req.body.max_stock !== undefined) row.max_stock = Number(req.body.max_stock);
  if (req.body.reorder_point !== undefined) row.reorder_point = Number(req.body.reorder_point);
  if (req.body.unit !== undefined) row.unit = req.body.unit || 'pza';
  if (req.body.catalog_item_id !== undefined) row.catalog_item_id = Number(req.body.catalog_item_id);
  if (req.body.active !== undefined) row.active = !!req.body.active;
  if (req.body.vales_item !== undefined) row.vales_item = req.body.vales_item || '';
  if (req.body.peso_kg_por_unidad !== undefined) row.peso_kg_por_unidad = Number(req.body.peso_kg_por_unidad || 0);
  row.updated_at = new Date().toISOString();
  write(db);
  res.json(row);
});

// Devuelve los items_vales para poder vincularlos desde inventario
router.get('/vales-items', (req, res) => {
  if (!canAccessInventory(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { read: readVales } = require('../db-vales');
    const vdb = readVales();
    res.json((vdb.items_vales || []).map(v => ({ item: v.item, unidad_base: v.unidad_base })));
  } catch (e) {
    res.json([]);
  }
});

router.delete('/cost-centers/:id', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const idx = db.cost_centers.findIndex(x => x.id === Number(req.params.id)); if (idx < 0) return res.status(404).json({ error: 'No encontrado' }); db.cost_centers.splice(idx, 1); write(db); res.json({ ok: true }); });
router.delete('/sub-cost-centers/:id', (req, res) => { if (!canManageCatalogs(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const idx = db.sub_cost_centers.findIndex(x => x.id === Number(req.params.id)); if (idx < 0) return res.status(404).json({ error: 'No encontrado' }); db.sub_cost_centers.splice(idx, 1); write(db); res.json({ ok: true }); });

router.post('/approval-rules', (req, res) => { if (!canManageRules(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = { id: nextId(db.approval_rules), name: req.body.name, min_amount: Number(req.body.min_amount || 0), max_amount: Number(req.body.max_amount || 0), auto_approve: !!req.body.auto_approve, approver_role: req.body.approver_role || null, active: req.body.active !== false }; if (!row.name) return res.status(400).json({ error: 'Nombre requerido' }); db.approval_rules.push(row); write(db); res.status(201).json(row); });
router.patch('/approval-rules/:id', (req, res) => { if (!canManageRules(req.user)) return res.status(403).json({ error: 'Sin permiso' }); const db = read(); const row = db.approval_rules.find(x => x.id === Number(req.params.id)); if (!row) return res.status(404).json({ error: 'Regla no encontrada' }); Object.assign(row, { name: req.body.name || row.name, min_amount: req.body.min_amount !== undefined ? Number(req.body.min_amount) : row.min_amount, max_amount: req.body.max_amount !== undefined ? Number(req.body.max_amount) : row.max_amount, auto_approve: req.body.auto_approve !== undefined ? !!req.body.auto_approve : row.auto_approve, approver_role: req.body.approver_role !== undefined ? req.body.approver_role : row.approver_role, active: req.body.active !== undefined ? !!req.body.active : row.active }); write(db); res.json(row); });

// ── Inventario semanal ─────────────────────────────────────────────────────
router.get('/inventory-weekly', (req, res) => {
  if (!canAccessInventory(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  let rows = db.inventory_weekly || [];
  if (req.query.catalog_id) rows = rows.filter(r => Number(r.inventory_catalog_id) === Number(req.query.catalog_id));
  if (req.query.item_id)    rows = rows.filter(r => Number(r.inventory_item_id) === Number(req.query.item_id));
  if (req.query.year)       rows = rows.filter(r => Number(r.year) === Number(req.query.year));
  if (req.query.week)       rows = rows.filter(r => Number(r.week) === Number(req.query.week));
  res.json(rows);
});

router.post('/inventory-weekly', (req, res) => {
  if (!canAccessInventory(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const db = read();
  const { year, week, entries } = req.body; // entries = [{ inventory_item_id, stock_actual, pedido_recibido }]
  if (!year || !week || !Array.isArray(entries)) return res.status(400).json({ error: 'year, week y entries requeridos' });
  db.inventory_weekly = db.inventory_weekly || [];
  const saved = [];
  entries.forEach(e => {
    const existing = db.inventory_weekly.find(r =>
      Number(r.year) === Number(year) &&
      Number(r.week) === Number(week) &&
      Number(r.inventory_item_id) === Number(e.inventory_item_id)
    );
    const invItem = (db.inventory_items || []).find(x => x.id === Number(e.inventory_item_id));
    if (existing) {
      existing.stock_actual = Number(e.stock_actual);
      existing.pedido_recibido = Number(e.pedido_recibido || 0);
      existing.capturado_por = req.user.full_name || req.user.email;
      existing.fecha_captura = new Date().toISOString();
      saved.push(existing);
    } else {
      const row = {
        id: nextId(db.inventory_weekly),
        inventory_catalog_id: invItem ? invItem.inventory_catalog_id : null,
        inventory_item_id: Number(e.inventory_item_id),
        year: Number(year),
        week: Number(week),
        stock_actual: Number(e.stock_actual),
        pedido_recibido: Number(e.pedido_recibido || 0),
        capturado_por: req.user.full_name || req.user.email,
        fecha_captura: new Date().toISOString()
      };
      db.inventory_weekly.push(row);
      saved.push(row);
    }
    // Update current_stock on inventory_item
    if (invItem) {
      invItem.current_stock = Number(e.stock_actual);
      invItem.updated_at = new Date().toISOString();
    }
  });
  write(db);
  res.json({ ok: true, saved: saved.length });
});

module.exports = router;
