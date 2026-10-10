const fs   = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_PLANNER_PATH || './database/plan.json');

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

// ── Write coalescing: evita writes redundantes ───────────────────────────────
let _dirty = false;
let _debounceTimer = null;
const DEBOUNCE_MS = 1500;

const DEPARTAMENTOS = [
  { id: 'smya',          nombre: 'SMYA' },
  { id: 'rhh',           nombre: 'RHH' },
  { id: 'produccion',    nombre: 'Produccion' },
  { id: 'calidad',       nombre: 'Calidad' },
  { id: 'mantenimiento', nombre: 'Mantenimiento' },
  { id: 'procesos',      nombre: 'Procesos/Ingenierias' },
  { id: 'compras',       nombre: 'Compras' },
  { id: 'sgc',           nombre: 'SGC' },
  { id: 'operaciones',   nombre: 'Operaciones' }
];

const EMPTY_DB = {
  departamentos: DEPARTAMENTOS,
  asignaciones: [],
  actividades: [],
  daily_registros: [],
  config_ptar: { dias_retrolavado: [1, 3, 5] },
  plantilla_puestos: [],
  plantilla_historico: []
};

async function initDb() {
  if (pool) {
    await pool.query('CREATE TABLE IF NOT EXISTS planner_data (id INT PRIMARY KEY DEFAULT 1, data JSONB NOT NULL)');
    const { rows } = await pool.query('SELECT data FROM planner_data WHERE id=1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
      }
      _cache = seed;
      _refLengths = _captureRef(seed);
      await pool.query('INSERT INTO planner_data(id,data) VALUES(1,$1)', [JSON.stringify(seed)]);
      console.log('[db-planner] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
      _refLengths = _captureRef(_cache);
      console.log('[db-planner] Datos cargados desde PostgreSQL.');
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
    console.log('[db-planner] Datos cargados desde JSON:', dbPath);
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
    const sql = `UPDATE planner_data SET data = ${expr} WHERE id = 1`;
    _writeQueue = _writeQueue.then(() =>
      pool.query(sql, params)
        .catch(err => {
          console.error('[db-planner] Error persistiendo parcial, reintentando:', err.message);
          return pool.query(sql, params)
            .catch(err2 => console.error('[db-planner] Reintento parcial fallido:', err2.message));
        })
    );
  } else {
    const snapshot = JSON.stringify(_cache);
    _writeQueue = _writeQueue.then(() =>
      pool.query('UPDATE planner_data SET data=$1 WHERE id=1', [snapshot])
        .catch(err => {
          console.error('[db-planner] Error persistiendo, reintentando:', err.message);
          return pool.query('UPDATE planner_data SET data=$1 WHERE id=1', [snapshot])
            .catch(err2 => console.error('[db-planner] Reintento fallido:', err2.message));
        })
    );
  }
}

function write(data, ...changedKeys) {
  _cache = data;

  if (!pool) {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error('[db-planner] Error JSON:', err.message); }
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

  // Write coalescing: si ya hay un write pendiente en debounce, solo actualizar cache
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _dirty = true;
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      if (_dirty) {
        _dirty = false;
        // Re-detect changes from latest cache
        const keys = [];
        const refNow = _captureRef(_cache);
        for (const k of Object.keys(_cache)) {
          if (Array.isArray(_cache[k])) keys.push(k);
        }
        _persistNow(keys.length > 0 && keys.length < Object.keys(_cache).length ? keys : null);
      }
    }, DEBOUNCE_MS);
    return;
  }

  // First write: persist immediately, start debounce window
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

module.exports = { dbPath, read, write, nextId, initDb, DEPARTAMENTOS };
