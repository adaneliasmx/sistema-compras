const fs   = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_FLUJO_PATH || './database/flujo.json');

// ── PostgreSQL (producción en Render) — pool compartido ──────────────────────
const pool = require('./db-pool');

let _cache = null;
let _writeQueue = Promise.resolve();

// ── Auto-detect: snapshot de longitudes para escritura parcial ────────────────
let _refLengths = null;
function _captureRef(data) {
  const r = {};
  for (const k of Object.keys(data)) {
    if (Array.isArray(data[k])) r[k] = data[k].length;
  }
  return r;
}

// ── Write coalescing ─────────────────────────────────────────────────────────
let _dirty = false;
let _debounceTimer = null;
const DEBOUNCE_MS = 2000;

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
      _refLengths = _captureRef(seed);
      await pool.query('INSERT INTO flujo_data(id,data) VALUES(1,$1)', [JSON.stringify(seed)]);
      console.log('[db-flujo] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
      _refLengths = _captureRef(_cache);
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
    _refLengths = _captureRef(_cache);
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

function _persistNow(changedKeys) {
  if (changedKeys && changedKeys.length > 0) {
    const params = [];
    let expr = 'data';
    for (let i = 0; i < changedKeys.length; i++) {
      const p = i * 2 + 1;
      expr = `jsonb_set(${expr}, $${p}::text[], $${p + 1}::jsonb)`;
      params.push(`{${changedKeys[i]}}`, JSON.stringify(_cache[changedKeys[i]]));
    }
    const sql = `UPDATE flujo_data SET data = ${expr} WHERE id = 1`;
    _writeQueue = _writeQueue.then(() =>
      pool.query(sql, params)
        .catch(err => {
          console.error('[db-flujo] Error persistiendo parcial, reintentando:', err.message);
          return pool.query(sql, params)
            .catch(err2 => console.error('[db-flujo] Reintento parcial fallido:', err2.message));
        })
    );
  } else {
    const snapshot = JSON.stringify(_cache);
    _writeQueue = _writeQueue.then(() =>
      pool.query('UPDATE flujo_data SET data=$1 WHERE id=1', [snapshot])
        .catch(err => {
          console.error('[db-flujo] Error persistiendo, reintentando:', err.message);
          return pool.query('UPDATE flujo_data SET data=$1 WHERE id=1', [snapshot])
            .catch(err2 => console.error('[db-flujo] Reintento fallido:', err2.message));
        })
    );
  }
}

function write(data, ...changedKeys) {
  _cache = data;

  if (!pool) {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error('[db-flujo] Error JSON:', err.message); }
    return;
  }

  // Auto-detect: colecciones cuya longitud cambió
  if (changedKeys.length === 0 && _refLengths) {
    for (const k of Object.keys(data)) {
      if (Array.isArray(data[k]) && _refLengths[k] !== data[k].length) {
        changedKeys.push(k);
      }
    }
  }
  _refLengths = _captureRef(data);

  // Write coalescing
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _dirty = true;
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      if (_dirty) {
        _dirty = false;
        _persistNow(null);
      }
    }, DEBOUNCE_MS);
    return;
  }

  _dirty = false;
  _persistNow(changedKeys.length > 0 ? changedKeys : null);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    if (_dirty) {
      _dirty = false;
      _persistNow(null);
    }
  }, DEBOUNCE_MS);
}

function nextId(rows) {
  if (!Array.isArray(rows) || !rows.length) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

// Escritura solo en memoria (para datos efímeros como heartbeat)
function writeMemoryOnly(data) {
  _cache = data;
}

module.exports = { dbPath, read, write, writeMemoryOnly, nextId, initDb };
