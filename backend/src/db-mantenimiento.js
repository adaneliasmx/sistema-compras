const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_MANT_PATH || './database/mantenimiento.json');

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

let _cache = null;
let _writeQueue = Promise.resolve();

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
      await pool.query('INSERT INTO mantenimiento_data(id, data) VALUES(1, $1)', [JSON.stringify(seed)]);
      console.log('[db-mant] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
      console.log('[db-mant] Datos cargados desde PostgreSQL.');
    }
  } else {
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
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

function write(data) {
  _cache = data;
  if (pool) {
    _writeQueue = _writeQueue.then(() => {
      const snapshot = JSON.stringify(data);
      return pool.query('UPDATE mantenimiento_data SET data = $1 WHERE id = 1', [snapshot])
        .catch(err => console.error('[db-mant] Error PostgreSQL:', err.message));
    });
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
