const fs   = require('fs');
const path = require('path');

const dbPath = path.resolve(process.cwd(), process.env.DB_INVENTARIOS_PATH || './database/inventarios.json');

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
  usuarios_inv: [],
  sesiones_inv: [],
  inv_config: [
    { id:1, inv_type:'quimicos_proceso',    form_code:'4-CA-116', form_rev:'Rev. 0', form_title:'Inventario de Quimicos e Insumos (CONTROL)' },
    { id:2, inv_type:'epp',                  form_code:'4-CA-117', form_rev:'Rev. 0', form_title:'Inventario de EPP' },
    { id:3, inv_type:'insumos_consumibles',  form_code:'4-CA-118', form_rev:'Rev. 0', form_title:'Inventario de Insumos y Consumibles de Proceso' },
    { id:4, inv_type:'quimicos_titulacion',  form_code:'4-CA-119', form_rev:'Rev. 0', form_title:'Inventario de Quimicos e Insumos de Titulacion' }
  ],
  inv_items_config: [],   // { id, inv_type, item_key, item_label, min_val, max_val, compras_item_id, activo }
  inv_conteos: [],        // { id, inv_type, year, week, fecha, usuario_id, usuario_nombre, created_at }
  inv_conteo_items: [],   // { id, conteo_id, item_key, tambos, porrones, cantidad, kg, unidad }
  inv_recepciones: [],    // { id, inv_type, item_key, item_label, cantidad, kg, fecha, factura, usuario_id, usuario_nombre, created_at }
  inv_vales_epp: [],      // { id, folio, empleado_id, empleado_nombre, autorizador_nombre, fecha, notas, usuario_id, usuario_nombre, created_at }
  inv_vales_epp_items: [] // { id, vale_id, item_key, item_label, cantidad, unidad }
};

async function initDb() {
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS inventarios_data (id INT PRIMARY KEY DEFAULT 1, data JSONB NOT NULL)`);
    const { rows } = await pool.query('SELECT data FROM inventarios_data WHERE id=1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
      }
      _cache = seed;
      await pool.query('INSERT INTO inventarios_data(id,data) VALUES(1,$1)', [JSON.stringify(seed)]);
      console.log('[db-inventarios] PostgreSQL inicializado.');
    } else {
      _cache = rows[0].data;
      console.log('[db-inventarios] Datos cargados desde PostgreSQL.');
    }
  } else {
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log('[db-inventarios] Datos cargados desde JSON:', dbPath);
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
      pool.query('UPDATE inventarios_data SET data=$1 WHERE id=1', [snapshot])
        .catch(err => console.error('[db-inventarios] Error PostgreSQL:', err.message))
    );
  } else {
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error('[db-inventarios] Error JSON:', err.message); }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || !rows.length) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, nextId, initDb };
