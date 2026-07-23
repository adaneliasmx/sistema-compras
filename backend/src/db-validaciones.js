const fs   = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_VALIDACIONES_PATH || './database/validaciones.json');

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
  usuarios_val: [],
  // Registros sincronizados desde la app Python (lado SKF)
  val_skf_envios: [],        // envios de almacen SKF → CUESTO
  val_skf_recepciones: [],   // recepcion PT en SKF (de CUESTO)
  val_skf_pendientes: [],    // pendientes lado SKF (FALTANTE / SIN_QRY)
  // Registros sincronizados desde la app Python (lado CUESTO)
  val_cuesto_envios: [],     // envios PT CUESTO → SKF
  val_cuesto_ingresos: [],   // ingreso SKF en CUESTO
  val_cuesto_pendientes: []  // pendientes lado CUESTO
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
    // Asegurar colecciones nuevas si el archivo ya existia
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

function write(data) {
  _cache = data;
  if (pool) {
    const snapshot = JSON.stringify(data);
    _writeQueue = _writeQueue.then(() =>
      pool.query('UPDATE validaciones_data SET data=$1 WHERE id=1', [snapshot])
        .catch(err => console.error('[db-validaciones] Error PostgreSQL:', err.message))
    );
  } else {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error('[db-validaciones] Error JSON:', err.message); }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || !rows.length) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, nextId, initDb };
