const fs   = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_VALIDACIONES_PATH || './database/validaciones.json');

// ── PostgreSQL (producción en Render) — pool compartido ──────────────────────
const pool = require('./db-pool');

let _cache = null;
let _writeQueue = Promise.resolve();

// ── Write coalescing con max wait fijo ───────────────────────────────────────
let _coalesceTimer = null;
let _lastPersistTime = 0;
let _retryTimer = null;
const COALESCE_MS = 2000;

const EMPTY_DB = {
  usuarios_val: [],
  val_skf_envios: [],
  val_skf_recepciones: [],
  val_skf_pendientes: [],
  val_cuesto_envios: [],
  val_cuesto_ingresos: [],
  val_cuesto_pendientes: [],
  val_embarques: [],
  val_app_status: []
};

async function initDb() {
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS validaciones_data (id INT PRIMARY KEY DEFAULT 1, data JSONB NOT NULL)`);
    const { rows } = await pool.query('SELECT data FROM validaciones_data WHERE id=1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
      }
      _cache = seed;
      await pool.query('INSERT INTO validaciones_data(id,data) VALUES(1,$1)', [JSON.stringify(seed)]);
      console.log('[db-validaciones] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
      console.log('[db-validaciones] Datos cargados desde PostgreSQL.');
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
    console.log('[db-validaciones] Datos cargados desde JSON:', dbPath);
  }
}

function read() {
  if (!_cache) {
    if (!fs.existsSync(dbPath)) return { ...EMPTY_DB };
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return _cache;
}

function _persistFull() {
  const snapshot = JSON.stringify(_cache);
  _writeQueue = _writeQueue.then(() =>
    pool.query('UPDATE validaciones_data SET data=$1 WHERE id=1', [snapshot])
      .catch(err => {
        console.error('[db-validaciones] Error persistiendo, reintentando:', err.message);
        return pool.query('UPDATE validaciones_data SET data=$1 WHERE id=1', [snapshot])
          .catch(err2 => {
            console.error('[db-validaciones] Reintento fallido:', err2.message);
            if (!_retryTimer) {
              _retryTimer = setTimeout(() => {
                _retryTimer = null;
                _persistFull();
              }, 30000);
            }
          });
      })
  );
}

function write(data) {
  _cache = data;

  if (!pool) {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error('[db-validaciones] Error JSON:', err.message); }
    return;
  }

  const now = Date.now();
  if (now - _lastPersistTime >= COALESCE_MS) {
    _lastPersistTime = now;
    if (_coalesceTimer) { clearTimeout(_coalesceTimer); _coalesceTimer = null; }
    _persistFull();
  } else if (!_coalesceTimer) {
    const remaining = COALESCE_MS - (now - _lastPersistTime);
    _coalesceTimer = setTimeout(() => {
      _coalesceTimer = null;
      _lastPersistTime = Date.now();
      _persistFull();
    }, remaining);
  }
}

// Escritura solo en memoria (para datos efímeros como heartbeat)
function writeMemoryOnly(data) {
  _cache = data;
}

function flush() {
  if (_coalesceTimer) { clearTimeout(_coalesceTimer); _coalesceTimer = null; }
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  if (_cache && pool) _persistFull();
  return _writeQueue;
}

process.once('SIGTERM', () => flush());

function nextId(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, writeMemoryOnly, nextId, initDb, flush };
