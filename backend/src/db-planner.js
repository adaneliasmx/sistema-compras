const fs   = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_PLANNER_PATH || './database/plan.json');

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
  pool.on('error', err => console.error('[db-planner] Pool error (idle client):', err.message));
}

let _cache = null;
let _writeQueue = Promise.resolve();

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
      await pool.query('INSERT INTO planner_data(id,data) VALUES(1,$1)', [JSON.stringify(seed)]);
      console.log('[db-planner] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
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

function write(data) {
  _cache = data;
  if (pool) {
    const snapshot = JSON.stringify(data);
    _writeQueue = _writeQueue.then(() =>
      pool.query('UPDATE planner_data SET data=$1 WHERE id=1', [snapshot])
        .catch(err => console.error('[db-planner] Error PostgreSQL:', err.message))
    );
  } else {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error('[db-planner] Error JSON:', err.message); }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || !rows.length) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, nextId, initDb, DEPARTAMENTOS };
