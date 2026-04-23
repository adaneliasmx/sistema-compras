const fs = require('fs');
const path = require('path');

// ── JSON fallback (desarrollo local) ──────────────────────────────────────────
const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './database/app.json');

// ── PostgreSQL (producción en Render) ─────────────────────────────────────────
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 3
  });
}

// ── Caché en memoria ──────────────────────────────────────────────────────────
let _cache = null;
let _writeQueue = Promise.resolve(); // Serializa escrituras a PostgreSQL para evitar race conditions

const EMPTY_DB = {
  users: [], suppliers: [], cost_centers: [], sub_cost_centers: [],
  catalog_items: [], inventory_catalogs: [], inventory_items: [], inventory_weekly: [],
  requisitions: [], requisition_items: [], quotations: [],
  purchase_orders: [], purchase_order_items: [],
  invoices: [], invoice_items: [], payments: [],
  status_history: [], approval_rules: [], quotation_requests: [],
  password_reset_requests: [], password_reset_tokens: [],
  settings: {}
};

// Repara IDs duplicados en requisition_items (solo items sin PO generada)
function fixDuplicateItemIds(data) {
  const items = data.requisition_items || [];
  const idCount = {};
  items.forEach(i => { idCount[i.id] = (idCount[i.id] || 0) + 1; });
  const duplicateIds = Object.keys(idCount).filter(id => idCount[id] > 1).map(Number);
  if (!duplicateIds.length) return false;

  let maxId = Math.max(...items.map(i => Number(i.id) || 0));
  let fixed = 0;

  duplicateIds.forEach(dupId => {
    const group = items.filter(i => i.id === dupId);
    if (group.some(i => i.purchase_order_id)) return; // ya tiene PO → no tocar
    group.slice(1).forEach(item => {
      const newId = ++maxId;
      (data.quotations || []).forEach(q => { if (q.requisition_item_id === item.id) q.requisition_item_id = newId; });
      (data.quotation_requests || []).forEach(qr => { if (qr.requisition_item_id === item.id) qr.requisition_item_id = newId; });
      item.id = newId;
      fixed++;
    });
  });

  if (fixed > 0) console.log(`[db] Auto-migración: ${fixed} IDs duplicados de requisition_items reparados.`);
  return fixed > 0;
}

// Inicializa la base de datos (llamar una vez al arrancar el servidor)
async function initDb() {
  if (pool) {
    // ── Modo PostgreSQL ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_data (
        id   INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL
      )
    `);
    const { rows } = await pool.query('SELECT data FROM app_data WHERE id = 1');
    if (rows.length === 0) {
      // Primera vez: intentar migrar desde JSON local si existe
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
        console.log('[db] Migrando datos de JSON a PostgreSQL...');
      }
      _cache = seed;
      await pool.query(
        'INSERT INTO app_data(id, data) VALUES(1, $1)',
        [JSON.stringify(seed)]
      );
      console.log('[db] PostgreSQL inicializado con datos seed.');
    } else {
      _cache = rows[0].data;
      // Aplicar auto-migración de IDs duplicados si es necesario
      if (fixDuplicateItemIds(_cache)) {
        await pool.query('UPDATE app_data SET data = $1 WHERE id = 1', [JSON.stringify(_cache)]);
        console.log('[db] Auto-migración persistida en PostgreSQL.');
      }
      console.log('[db] Datos cargados desde PostgreSQL.');
    }
  } else {
    // ── Modo JSON local ──────────────────────────────────────────────────────
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    if (fixDuplicateItemIds(_cache)) {
      fs.writeFileSync(dbPath, JSON.stringify(_cache, null, 2));
    }
    console.log('[db] Datos cargados desde JSON local:', dbPath);
  }
}

// Lee el estado actual (síncrono, usa caché)
function read() {
  if (!_cache) {
    // Fallback de emergencia si initDb no se llamó todavía
    if (!fs.existsSync(dbPath)) return { ...EMPTY_DB };
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return _cache;
}

// Escribe y persiste (actualiza caché + persiste en cola para evitar race conditions)
function write(data) {
  _cache = data;
  if (pool) {
    const snapshot = JSON.stringify(data);
    _writeQueue = _writeQueue.then(() =>
      pool.query('UPDATE app_data SET data = $1 WHERE id = 1', [snapshot])
        .catch(err => console.error('[db] Error persistiendo en PostgreSQL:', err.message))
    );
  } else {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[db] Error escribiendo JSON:', err.message);
    }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, nextId, initDb };
