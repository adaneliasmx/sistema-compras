const fs = require('fs');
const path = require('path');

// ── JSON fallback (desarrollo local) ──────────────────────────────────────────
const dbPath = path.resolve(process.cwd(), process.env.DB_PRODUCCION_PATH || './database/produccion.json');

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

const EMPTY_DB = {
  // Catálogos por línea (cada línea es independiente)
  componentes_l3: [],    // {id, nombre, cliente, carga_optima_varillas, piezas_objetivo, activo, created_at}
  componentes_l4: [],
  procesos_l3: [],       // {id, nombre, activo, created_at}
  procesos_l4: [],
  acabados_l3: [],       // {id, nombre, activo, created_at}
  acabados_l4: [],
  herramentales_l3: [],  // {id, numero, descripcion, activo, created_at}
  herramentales_l4: [],
  defectos_l3: [],       // {id, nombre, activo, created_at}
  defectos_l4: [],
  motivos_paro_l3: [],   // {id, nombre, activo, created_at}
  motivos_paro_l4: [],
  sub_motivos_paro_l3: [],// {id, motivo_id, nombre, activo, created_at}
  sub_motivos_paro_l4: [],
  // Operadores independientes por línea
  operadores_l3: [],     // {id, nombre, pin_hash, activo, created_at}
  operadores_l4: [],
  // Registros de cargas de producción (ambas líneas)
  cargas: [],            // {id, folio, linea, herramental_id, herramental_no, componente_id, componente, cliente, proceso_id, proceso, acabado_id, acabado, varillas, piezas_por_varilla, cantidad, es_vacia, operador_id, operador, fecha_carga, hora_carga, semana, fecha_descarga, hora_descarga, turno, estado, defecto_id, defecto, folio_origen, es_reproceso, reprocesado, created_at}
  // Registros de paros
  paros: [],             // {id, folio, linea, motivo_id, motivo, sub_motivo_id, sub_motivo, fecha_inicio, hora_inicio, fecha_fin, hora_fin, duracion_min, turno, created_at}
  // Configuración
  config: { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2 },
  // KPI histórico (snapshots guardados por turno)
  kpi_snapshots: []
};

async function initDb() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS produccion_data (
        id   INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL
      )
    `);
    const { rows } = await pool.query('SELECT data FROM produccion_data WHERE id = 1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
        console.log('[db-produccion] Migrando datos de JSON a PostgreSQL...');
      }
      _cache = seed;
      await pool.query('INSERT INTO produccion_data(id, data) VALUES(1, $1)', [JSON.stringify(seed)]);
      console.log('[db-produccion] PostgreSQL inicializado con datos seed.');
    } else {
      _cache = rows[0].data;
      console.log('[db-produccion] Datos cargados desde PostgreSQL.');
    }
  } else {
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log('[db-produccion] Datos cargados desde JSON local:', dbPath);
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
    pool.query('UPDATE produccion_data SET data = $1 WHERE id = 1', [JSON.stringify(data)])
      .catch(err => console.error('[db-produccion] Error persistiendo en PostgreSQL:', err.message));
  } else {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[db-produccion] Error escribiendo JSON:', err.message);
    }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

module.exports = { dbPath, read, write, nextId, initDb };
