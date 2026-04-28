const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const { read: readInv, write: writeInv, nextId } = require('../db-inventarios');
const { read: readVales }   = require('../db-vales');
const { read: readCompras, write: writeCompras, nextId: nextIdCompras } = require('../db');
const { read: readRhh }     = require('../db-rhh');
const { invAuthRequired, invAllowRoles, invCanAccessType } = require('../middleware/inventarios-auth');

const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esta-clave';

// ── ISO week helpers ──────────────────────────────────────────────────────────
function isoWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
function isoYear(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  return d.getFullYear();
}
function isoWeekStart(year, week) {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  return monday;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const db = readInv();
  const user = (db.usuarios_inv || []).find(u =>
    u.email.toLowerCase() === email.toLowerCase() && u.activo !== false
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const token = jwt.sign(
    { sub: user.id, module: 'inventarios', role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({
    token,
    user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role, permisos_inv: user.permisos_inv || [] }
  });
});

router.post('/auth/change-password', invAuthRequired, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Contraseñas requeridas' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
  const db = readInv();
  const user = (db.usuarios_inv || []).find(u => u.id === req.invUser.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  }
  user.password_hash = bcrypt.hashSync(new_password, 10);
  writeInv(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USUARIOS (admin)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/users', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const db = readInv();
  const users = (db.usuarios_inv || []).map(u => ({
    id: u.id, nombre: u.nombre, email: u.email,
    role: u.role, permisos_inv: u.permisos_inv || [], activo: u.activo !== false
  }));
  res.json(users);
});

router.post('/users', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const { nombre, email, password, role, permisos_inv } = req.body;
  if (!nombre || !email || !password || !role) return res.status(400).json({ error: 'Campos requeridos: nombre, email, password, role' });
  const db = readInv();
  db.usuarios_inv = db.usuarios_inv || [];
  if (db.usuarios_inv.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'El email ya existe' });
  }
  const user = {
    id: nextId(db.usuarios_inv),
    nombre, email: email.toLowerCase(),
    password_hash: bcrypt.hashSync(password, 10),
    role,
    permisos_inv: role === 'inventarios' ? (permisos_inv || []) : [],
    activo: true,
    created_at: new Date().toISOString()
  };
  db.usuarios_inv.push(user);
  writeInv(db);
  res.json({ id: user.id, nombre: user.nombre, email: user.email, role: user.role, permisos_inv: user.permisos_inv });
});

router.put('/users/:id', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const id = Number(req.params.id);
  const { nombre, email, password, role, permisos_inv, activo } = req.body;
  const db = readInv();
  const user = (db.usuarios_inv || []).find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (nombre !== undefined) user.nombre = nombre;
  if (email !== undefined) user.email = email.toLowerCase();
  if (password) user.password_hash = bcrypt.hashSync(password, 10);
  if (role !== undefined) { user.role = role; user.permisos_inv = role === 'inventarios' ? (permisos_inv || user.permisos_inv || []) : []; }
  if (permisos_inv !== undefined && user.role === 'inventarios') user.permisos_inv = permisos_inv;
  if (activo !== undefined) user.activo = activo;
  writeInv(db);
  res.json({ ok: true });
});

router.delete('/users/:id', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.invUser.id) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  const db = readInv();
  db.usuarios_inv = (db.usuarios_inv || []).filter(u => u.id !== id);
  writeInv(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG (form names/codes)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/config', invAuthRequired, (req, res) => {
  const db = readInv();
  res.json(db.inv_config || []);
});

router.put('/config/:inv_type', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const { inv_type } = req.params;
  const { form_code, form_rev, form_title } = req.body;
  const db = readInv();
  const cfg = (db.inv_config || []).find(c => c.inv_type === inv_type);
  if (!cfg) return res.status(404).json({ error: 'Tipo de inventario no encontrado' });
  if (form_code !== undefined) cfg.form_code  = form_code;
  if (form_rev  !== undefined) cfg.form_rev   = form_rev;
  if (form_title !== undefined) cfg.form_title = form_title;
  writeInv(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ITEMS CONFIG (catálogo de ítems por inventario)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/items-config', invAuthRequired, (req, res) => {
  const { inv_type } = req.query;
  const db = readInv();
  let items = db.inv_items_config || [];
  if (inv_type) items = items.filter(i => i.inv_type === inv_type);
  res.json(items);
});

router.post('/items-config', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const { inv_type, item_key, item_label, min_val, max_val, compras_item_id, unidad, peso_kg, activo } = req.body;
  if (!inv_type || !item_key || !item_label) return res.status(400).json({ error: 'inv_type, item_key e item_label son requeridos' });
  const db = readInv();
  db.inv_items_config = db.inv_items_config || [];
  if (db.inv_items_config.find(i => i.inv_type === inv_type && i.item_key === item_key)) {
    return res.status(400).json({ error: 'item_key ya existe para este inventario' });
  }
  const item = {
    id: nextId(db.inv_items_config),
    inv_type, item_key, item_label,
    min_val: min_val ?? null, max_val: max_val ?? null,
    compras_item_id: compras_item_id || null,
    unidad: unidad || null,
    peso_kg: peso_kg || null,
    activo: activo !== false
  };
  db.inv_items_config.push(item);
  writeInv(db);
  res.json(item);
});

router.put('/items-config/:id', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const id = Number(req.params.id);
  const db = readInv();
  const item = (db.inv_items_config || []).find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });
  const fields = ['item_label','min_val','max_val','compras_item_id','unidad','peso_kg','activo'];
  for (const f of fields) if (req.body[f] !== undefined) item[f] = req.body[f];
  writeInv(db);
  res.json({ ok: true });
});

router.delete('/items-config/:id', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const id = Number(req.params.id);
  const db = readInv();
  db.inv_items_config = (db.inv_items_config || []).filter(i => i.id !== id);
  writeInv(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATÁLOGO EXTERNO (read-only: items de vales y compras)
// ═══════════════════════════════════════════════════════════════════════════════

// Items de Vales (quimicos_proceso source)
router.get('/catalog/vales-items', invAuthRequired, (req, res) => {
  try {
    const db = readVales();
    const items = (db.items_vales || []).filter(i => i.activo !== false).map(i => ({
      id: i.id, nombre: i.nombre, clave: i.clave,
      unidad: i.unidad, peso_kg: i.peso_kg || null, densidad: i.densidad || null
    }));
    res.json(items);
  } catch { res.json([]); }
});

// Catalog items de Compras (EPP, insumos, titulacion)
router.get('/catalog/compras-items', invAuthRequired, (req, res) => {
  try {
    const db = readCompras();
    const items = (db.catalog_items || []).filter(i => i.active !== false).map(i => ({
      id: i.id, name: i.name, sku: i.sku, unit: i.unit,
      category: i.category, supplier_id: i.supplier_id
    }));
    res.json(items);
  } catch { res.json([]); }
});

// Empleados de RHH (para vales EPP)
router.get('/catalog/employees', invAuthRequired, (req, res) => {
  try {
    const db = readRhh();
    const emps = (db.rhh_employees || [])
      .filter(e => e.status === 'active' || e.status === 'activo' || !e.status)
      .map(e => ({ id: e.id, nombre: e.full_name || e.nombre, puesto: e.position || e.puesto || '' }));
    res.json(emps);
  } catch { res.json([]); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RECEPCIONES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/recepciones', invAuthRequired, (req, res) => {
  const { inv_type, item_key, desde, hasta } = req.query;
  const db = readInv();
  let rows = db.inv_recepciones || [];
  if (inv_type) rows = rows.filter(r => r.inv_type === inv_type);
  if (item_key) rows = rows.filter(r => r.item_key === item_key);
  if (desde)    rows = rows.filter(r => r.fecha >= desde);
  if (hasta)    rows = rows.filter(r => r.fecha <= hasta);
  res.json(rows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

router.post('/recepciones', invAuthRequired, invAllowRoles('recepcion', 'admin'), (req, res) => {
  const { inv_type, item_key, item_label, cantidad, kg, fecha, factura } = req.body;
  if (!inv_type || !item_key || !fecha) return res.status(400).json({ error: 'inv_type, item_key y fecha son requeridos' });
  const db = readInv();
  db.inv_recepciones = db.inv_recepciones || [];
  const rec = {
    id: nextId(db.inv_recepciones),
    inv_type, item_key, item_label: item_label || item_key,
    cantidad: cantidad || null, kg: kg || null,
    fecha, factura: factura || null,
    usuario_id: req.invUser.id, usuario_nombre: req.invUser.nombre,
    created_at: new Date().toISOString()
  };
  db.inv_recepciones.push(rec);
  writeInv(db);
  res.json(rec);
});

router.delete('/recepciones/:id', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const id = Number(req.params.id);
  const db = readInv();
  db.inv_recepciones = (db.inv_recepciones || []).filter(r => r.id !== id);
  writeInv(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEOS SEMANALES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/conteos', invAuthRequired, (req, res) => {
  const { inv_type, year, week } = req.query;
  const db = readInv();
  let rows = db.inv_conteos || [];
  if (inv_type) rows = rows.filter(c => c.inv_type === inv_type);
  if (year)     rows = rows.filter(c => c.year === Number(year));
  if (week)     rows = rows.filter(c => c.week === Number(week));
  // Return with items
  const itemsAll = db.inv_conteo_items || [];
  const result = rows.map(c => ({
    ...c,
    items: itemsAll.filter(i => i.conteo_id === c.id)
  }));
  res.json(result.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

router.post('/conteos', invAuthRequired, invAllowRoles('inventarios', 'admin'), (req, res) => {
  const { inv_type, fecha, items } = req.body;
  if (!inv_type || !fecha || !Array.isArray(items)) {
    return res.status(400).json({ error: 'inv_type, fecha e items son requeridos' });
  }
  const db = readInv();

  // Verificar permisos de tipo
  const { role, permisos_inv } = req.invUser;
  if (role === 'inventarios' && !permisos_inv.includes(inv_type)) {
    return res.status(403).json({ error: 'Sin acceso a este inventario' });
  }

  db.inv_conteos      = db.inv_conteos || [];
  db.inv_conteo_items = db.inv_conteo_items || [];

  const d    = new Date(fecha);
  const year = isoYear(d);
  const week = isoWeek(d);

  // Solo un conteo por tipo/semana
  const existing = db.inv_conteos.find(c => c.inv_type === inv_type && c.year === year && c.week === week);
  if (existing) {
    // Actualizar items del conteo existente
    db.inv_conteo_items = db.inv_conteo_items.filter(i => i.conteo_id !== existing.id);
    existing.fecha    = fecha;
    existing.usuario_id     = req.invUser.id;
    existing.usuario_nombre = req.invUser.nombre;
    existing.updated_at     = new Date().toISOString();
    const newItems = items.map(it => ({
      id: nextId(db.inv_conteo_items),
      conteo_id: existing.id,
      item_key: it.item_key,
      tambos: it.tambos ?? null, porrones: it.porrones ?? null,
      cantidad: it.cantidad ?? null, kg: it.kg ?? null, unidad: it.unidad || null
    }));
    db.inv_conteo_items.push(...newItems);
    writeInv(db);
    return res.json({ id: existing.id, items: newItems });
  }

  const conteo = {
    id: nextId(db.inv_conteos),
    inv_type, year, week, fecha,
    usuario_id: req.invUser.id, usuario_nombre: req.invUser.nombre,
    created_at: new Date().toISOString()
  };
  db.inv_conteos.push(conteo);

  const newItems = items.map(it => ({
    id: nextId(db.inv_conteo_items),
    conteo_id: conteo.id,
    item_key: it.item_key,
    tambos: it.tambos ?? null, porrones: it.porrones ?? null,
    cantidad: it.cantidad ?? null, kg: it.kg ?? null, unidad: it.unidad || null
  }));
  db.inv_conteo_items.push(...newItems);
  writeInv(db);
  res.json({ id: conteo.id, items: newItems });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPORTAMIENTOS (histórico semanal del año)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/comportamientos/:inv_type', invAuthRequired, (req, res) => {
  const { inv_type } = req.params;
  const { year, month } = req.query;
  const targetYear = Number(year) || new Date().getFullYear();

  const db = readInv();
  let conteos = (db.inv_conteos || []).filter(c => c.inv_type === inv_type && c.year === targetYear);
  if (month) conteos = conteos.filter(c => {
    const ws = isoWeekStart(c.year, c.week);
    return ws.getMonth() + 1 === Number(month);
  });

  const items = db.inv_items_config || [];
  const tipoItems = items.filter(i => i.inv_type === inv_type && i.activo !== false);
  const conteoItems = db.inv_conteo_items || [];

  const result = conteos.map(c => ({
    ...c,
    week_start: isoWeekStart(c.year, c.week).toISOString().slice(0, 10),
    items: conteoItems.filter(i => i.conteo_id === c.id)
  })).sort((a, b) => a.week - b.week);

  res.json({ conteos: result, items_config: tipoItems });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONSUMO SEMANAL (semana actual vs anterior)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/consumo-semanal/:inv_type', invAuthRequired, (req, res) => {
  const { inv_type } = req.params;
  const now = new Date();
  const curYear = isoYear(now);
  const curWeek = isoWeek(now);
  const prevWeek = curWeek > 1 ? curWeek - 1 : 52;
  const prevYear = curWeek > 1 ? curYear : curYear - 1;

  const db = readInv();
  const allConteos = db.inv_conteos || [];
  const allItems   = db.inv_conteo_items || [];
  const cfg        = (db.inv_items_config || []).filter(i => i.inv_type === inv_type && i.activo !== false);

  const cCur  = allConteos.find(c => c.inv_type === inv_type && c.year === curYear  && c.week === curWeek);
  const cPrev = allConteos.find(c => c.inv_type === inv_type && c.year === prevYear && c.week === prevWeek);

  const itemsCur  = cCur  ? allItems.filter(i => i.conteo_id === cCur.id)  : [];
  const itemsPrev = cPrev ? allItems.filter(i => i.conteo_id === cPrev.id) : [];

  // Calcular consumo = semana_anterior - semana_actual (si ambas existen)
  const rows = cfg.map(item => {
    const cur  = itemsCur.find(i  => i.item_key === item.item_key);
    const prev = itemsPrev.find(i => i.item_key === item.item_key);
    const curKg   = cur?.kg  ?? null;
    const prevKg  = prev?.kg ?? null;
    const consumo = (prevKg !== null && curKg !== null) ? Math.max(0, prevKg - curKg) : null;
    // tambos = kg / peso_kg
    const pesoKg = item.peso_kg || null;
    return {
      item_key:   item.item_key,
      item_label: item.item_label,
      unidad:     item.unidad || 'kg',
      min_val:    item.min_val,
      max_val:    item.max_val,
      peso_kg:    pesoKg,
      // semana actual
      cur_kg:     curKg,
      cur_tambos: (pesoKg && curKg !== null) ? Math.round((curKg / pesoKg) * 100) / 100 : null,
      cur_tambos_raw: cur?.tambos ?? null,
      cur_porrones:   cur?.porrones ?? null,
      // semana anterior
      prev_kg:    prevKg,
      prev_tambos: (pesoKg && prevKg !== null) ? Math.round((prevKg / pesoKg) * 100) / 100 : null,
      // consumo
      consumo_kg:     consumo,
      consumo_tambos: (pesoKg && consumo !== null) ? Math.round((consumo / pesoKg) * 100) / 100 : null
    };
  });

  res.json({
    inv_type,
    cur_year: curYear, cur_week: curWeek,
    cur_fecha: cCur?.fecha || null,
    prev_year: prevYear, prev_week: prevWeek,
    prev_fecha: cPrev?.fecha || null,
    rows
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALES EPP
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/vales-epp', invAuthRequired, invAllowRoles('inventarios', 'admin', 'comprador'), (req, res) => {
  const { desde, hasta } = req.query;
  const db = readInv();
  let vales = db.inv_vales_epp || [];
  if (desde) vales = vales.filter(v => v.fecha >= desde);
  if (hasta) vales = vales.filter(v => v.fecha <= hasta);
  const allItems = db.inv_vales_epp_items || [];
  const result = vales.map(v => ({ ...v, items: allItems.filter(i => i.vale_id === v.id) }));
  res.json(result.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

router.post('/vales-epp', invAuthRequired, invAllowRoles('inventarios', 'admin'), (req, res) => {
  const { empleado_id, empleado_nombre, autorizador_nombre, fecha, notas, items } = req.body;
  if (!empleado_nombre || !autorizador_nombre || !fecha || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'empleado_nombre, autorizador_nombre, fecha e items son requeridos' });
  }
  const db = readInv();
  db.inv_vales_epp       = db.inv_vales_epp || [];
  db.inv_vales_epp_items = db.inv_vales_epp_items || [];

  // Folio auto-incremental formateado
  const maxFolio = (db.inv_vales_epp || []).reduce((m, v) => Math.max(m, Number(v.folio_num) || 0), 0);
  const folio_num = maxFolio + 1;
  const folio = `EPP-${String(folio_num).padStart(4, '0')}`;

  const vale = {
    id: nextId(db.inv_vales_epp),
    folio, folio_num,
    empleado_id: empleado_id || null, empleado_nombre,
    autorizador_nombre, fecha,
    notas: notas || null,
    usuario_id: req.invUser.id, usuario_nombre: req.invUser.nombre,
    created_at: new Date().toISOString()
  };
  db.inv_vales_epp.push(vale);

  const newItems = items.map(it => ({
    id: nextId(db.inv_vales_epp_items),
    vale_id: vale.id,
    item_key: it.item_key, item_label: it.item_label || it.item_key,
    cantidad: it.cantidad, unidad: it.unidad || ''
  }));
  db.inv_vales_epp_items.push(...newItems);
  writeInv(db);
  res.json({ ...vale, items: newItems });
});

router.delete('/vales-epp/:id', invAuthRequired, invAllowRoles('admin'), (req, res) => {
  const id = Number(req.params.id);
  const db = readInv();
  db.inv_vales_epp = (db.inv_vales_epp || []).filter(v => v.id !== id);
  db.inv_vales_epp_items = (db.inv_vales_epp_items || []).filter(i => i.vale_id !== id);
  writeInv(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REQUISICIÓN → crea en módulo Compras
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/requisicion', invAuthRequired, invAllowRoles('comprador', 'admin'), (req, res) => {
  const { items, notas, area } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Se requiere al menos un ítem' });

  const db = readCompras();
  db.requisitions = db.requisitions || [];

  const folio = `INV-${Date.now()}`;
  const req_items = items.map(it => ({
    catalog_item_id: it.catalog_item_id || null,
    description: it.description || it.item_label || '',
    quantity: it.quantity || 1,
    unit: it.unit || 'pieza',
    estimated_price: it.estimated_price || null,
    notes: it.notes || ''
  }));

  const requisicion = {
    id: nextIdCompras(db.requisitions),
    folio,
    requester_name: req.invUser.nombre,
    requester_email: req.invUser.email,
    department: area || 'Inventarios',
    status: 'pending',
    priority: 'normal',
    notes: notas || '',
    items: req_items,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.requisitions.push(requisicion);
  writeCompras(db);
  res.json({ id: requisicion.id, folio });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OC PENDIENTES para un item (vista comprador)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/pending-po', invAuthRequired, invAllowRoles('comprador', 'admin'), (req, res) => {
  try {
    const db = readCompras();
    const pending = (db.purchase_orders || [])
      .filter(po => po.status !== 'received' && po.status !== 'cancelled')
      .map(po => ({
        id: po.id, folio: po.folio, supplier: po.supplier_name || po.supplier_id,
        fecha: po.created_at?.slice(0, 10), status: po.status,
        items: (po.items || []).map(it => ({
          catalog_item_id: it.catalog_item_id,
          description: it.description,
          quantity: it.quantity, unit: it.unit
        }))
      }));
    res.json(pending);
  } catch { res.json([]); }
});

module.exports = router;
