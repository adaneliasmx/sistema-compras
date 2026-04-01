const fs = require('fs');
const path = require('path');

// ── JSON fallback (desarrollo local) ──────────────────────────────────────────
const dbPath = path.resolve(process.cwd(), process.env.DB_VALES_PATH || './database/vales.json');

// ── PostgreSQL (producción en Render) ─────────────────────────────────────────
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// ── Caché en memoria ──────────────────────────────────────────────────────────
let _cache = null;
let _writeQueue = Promise.resolve();

const EMPTY_DB = {
  items_vales: [],        // Catálogo de productos químicos
  item_adiciones: [],     // Tipos de adición permitidos por item
  tanques_vales: [],      // Catálogo de tanques/líneas
  vales_header: [],       // Encabezados de vales
  vales_detalle: [],      // Detalles (líneas) de vales
  vales_correccion: [],   // Correcciones de vales
  kardex_vales: [],       // Libro de kardex (inventario)
  inventario_vales: []    // Stock actual por item
};

async function initDb() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vales_data (
        id   INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL
      )
    `);
    const { rows } = await pool.query('SELECT data FROM vales_data WHERE id = 1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
        console.log('[db-vales] Migrando datos de JSON a PostgreSQL...');
      }
      _cache = seed;
      await pool.query('INSERT INTO vales_data(id, data) VALUES(1, $1)', [JSON.stringify(seed)]);
      console.log('[db-vales] PostgreSQL inicializado con datos seed.');
    } else {
      _cache = rows[0].data;
      console.log('[db-vales] Datos cargados desde PostgreSQL.');
    }
  } else {
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log('[db-vales] Datos cargados desde JSON local:', dbPath);
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
      pool.query('UPDATE vales_data SET data = $1 WHERE id = 1', [snapshot])
        .catch(err => console.error('[db-vales] Error persistiendo en PostgreSQL:', err.message))
    );
  } else {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[db-vales] Error escribiendo JSON:', err.message);
    }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, nextId, initDb };
