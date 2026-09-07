const fs   = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_FLUJO_PATH || './database/flujo.json');

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
  pool.on('error', err => console.error('[db-flujo] Pool error (idle client):', err.message));
}

let _cache = null;
let _writeQueue = Promise.resolve();

const EMPTY_DB = {
  usuarios_flujo: [],

  // Catalogos Tenneco
  cat_tenneco_proyectos: [],
  cat_tenneco_partes: [],
  cat_tenneco_specs: [],
  cat_tenneco_defectos: [],

  // Catalogos ASM
  cat_asm_partes: [],
  cat_asm_defectos: [],

  // PO Tenneco
  pos_tenneco: [],

  // Lotes Tenneco
  lotes_tenneco: [],
  muestras_tenneco: [],
  remisiones_tenneco: [],

  // Lotes ASM (placeholder)
  lotes_asm: [],
  muestras_asm: [],
  remisiones_asm: [],

  // App Python status
  flujo_app_status: []
};

async function initDb() {
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS flujo_data (id INT PRIMARY KEY DEFAULT 1, data JSONB NOT NULL)`);
    const { rows } = await pool.query('SELECT data FROM flujo_data WHERE id=1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
      }
      _cache = seed;
      await pool.query('INSERT INTO flujo_data(id,data) VALUES(1,$1)', [JSON.stringify(seed)]);
      console.log('[db-flujo] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
      console.log('[db-flujo] Datos cargados desde PostgreSQL.');
    }
  } else {
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    let changed = false;
    for (const [k, v] of Object.entries(EMPTY_DB)) {
      if (!(_cache[k])) { _cache[k] = v; changed = true; }
    }
    if (changed) fs.writeFileSync(dbPath, JSON.stringify(_cache, null, 2));
    console.log('[db-flujo] Datos cargados desde JSON:', dbPath);
  }
}

function read() {
  if (!_cache) {
    if (!fs.existsSync(dbPath)) return { ...EMPTY_DB };
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return _cache;
}

function write(data) {
  _cache = data;
  if (pool) {
    const snapshot = JSON.stringify(data);
    _writeQueue = _writeQueue.then(() =>
      pool.query('UPDATE flujo_data SET data=$1 WHERE id=1', [snapshot])
        .catch(err => console.error('[db-flujo] Error PostgreSQL:', err.message))
    );
  } else {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error('[db-flujo] Error JSON:', err.message); }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || !rows.length) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, nextId, initDb };
