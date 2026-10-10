const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_MANT_PATH || './database/mantenimiento.json');

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

const EMPTY_DB = {
  equipos_mant: [
    { id: 1, nombre: 'Línea Baker', codigo: 'BAKER', tipo: 'linea', linea_produccion: 'Baker', activo: true },
    { id: 2, nombre: 'Línea 1',    codigo: 'L1',    tipo: 'linea', linea_produccion: 'L1',    activo: true },
    { id: 3, nombre: 'Línea 3',    codigo: 'L3',    tipo: 'linea', linea_produccion: 'L3',    activo: true },
    { id: 4, nombre: 'Línea 4',    codigo: 'L4',    tipo: 'linea', linea_produccion: 'L4',    activo: true }
  ],
  partes_equipo: [],
  ordenes_mantenimiento: [],
  mantenimientos_programados: [],
  mant_ejecuciones: [],
  settings: {
    integracion_produccion_activa: false,
    alerta_pizarron_activa: false,
    folio_counter: 0
  }
};

async function initDb() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mantenimiento_data (
        id   INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL
      )
    `);
    const { rows } = await pool.query('SELECT data FROM mantenimiento_data WHERE id = 1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
        console.log('[db-mant] Migrando datos de JSON a PostgreSQL...');
      }
      _cache = seed;
      _refLengths = _captureRef(seed);
      await pool.query('INSERT INTO mantenimiento_data(id, data) VALUES(1, $1)', [JSON.stringify(seed)]);
      console.log('[db-mant] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
      _refLengths = _captureRef(_cache);
      console.log('[db-mant] Datos cargados desde PostgreSQL.');
    }
  } else {
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    _refLengths = _captureRef(_cache);
    console.log('[db-mant] Datos cargados desde JSON local:', dbPath);
  }
}

function read() {
  if (!_cache) {
    if (!fs.existsSync(dbPath)) return { ...EMPTY_DB };
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return _cache;
}

function write(data, ...changedKeys) {
  _cache = data;
  if (pool) {
    // Auto-detect: colecciones cuya longitud cambió
    if (changedKeys.length === 0 && _refLengths) {
      for (const k of Object.keys(data)) {
        if (Array.isArray(data[k]) && _refLengths[k] !== data[k].length) {
          changedKeys.push(k);
        }
      }
    }
    _refLengths = _captureRef(data);

    if (changedKeys.length > 0) {
      const params = [];
      let expr = 'data';
      for (let i = 0; i < changedKeys.length; i++) {
        const p = i * 2 + 1;
        expr = `jsonb_set(${expr}, $${p}::text[], $${p + 1}::jsonb)`;
        params.push(`{${changedKeys[i]}}`, JSON.stringify(data[changedKeys[i]]));
      }
      const sql = `UPDATE mantenimiento_data SET data = ${expr} WHERE id = 1`;
      _writeQueue = _writeQueue.then(() =>
        pool.query(sql, params)
          .catch(err => {
            console.error('[db-mant] Error persistiendo parcial, reintentando:', err.message);
            return pool.query(sql, params)
              .catch(err2 => console.error('[db-mant] Reintento parcial fallido:', err2.message));
          })
      );
    } else {
      _writeQueue = _writeQueue.then(() => {
        const snapshot = JSON.stringify(_cache);
        return pool.query('UPDATE mantenimiento_data SET data = $1 WHERE id = 1', [snapshot])
          .catch(err => {
            console.error('[db-mant] Error persistiendo, reintentando:', err.message);
            return pool.query('UPDATE mantenimiento_data SET data = $1 WHERE id = 1', [snapshot])
              .catch(err2 => console.error('[db-mant] Reintento fallido:', err2.message));
          });
      });
    }
  } else {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[db-mant] Error JSON:', err.message);
    }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

function nextFolio(db) {
  const s = db.settings || {};
  s.folio_counter = (s.folio_counter || 0) + 1;
  const year = new Date().getFullYear();
  return `MT-${year}-${String(s.folio_counter).padStart(4, '0')}`;
}

module.exports = { read, write, nextId, nextFolio, initDb };
