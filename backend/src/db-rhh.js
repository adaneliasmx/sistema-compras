const fs = require('fs');
const path = require('path');

// ── JSON fallback (desarrollo local) ──────────────────────────────────────────
const dbPath = path.resolve(process.cwd(), process.env.DB_RHH_PATH || './database/rhh.json');

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
  rhh_users: [],
  rhh_employees: [],
  rhh_departments: [],
  rhh_positions: [],
  rhh_shifts: [],
  rhh_schedule: [],
  rhh_incidences: [],
  rhh_overtime: [],
  rhh_vacation_requests: [],
  rhh_documents: [],
  rhh_trainings: [],
  rhh_training_records: [],
  rhh_evaluations: [],
  rhh_evaluation_templates: [],
  rhh_evaluation_periods: [],
  rhh_uniforms: [],
  rhh_uniform_assignments: [],
  rhh_te_authorizations: [],
  rhh_anonymous_complaints: [],
  rhh_payroll_clarifications: [],
  rhh_vacancies: [],
  rhh_doc_templates: [],
  rhh_attendance: [],
  rhh_holidays: [],
  rhh_attendance_log: [],
  rhh_vacation_rules: [],
  rhh_te_applications: [],
  rhh_notifications: [],
  rhh_weekly_rol: [],
  rhh_rol_slots: [],
  rhh_rol_assignments: []
};

// Inicializa la base de datos (llamar una vez al arrancar el servidor)
async function initDb() {
  if (pool) {
    // ── Modo PostgreSQL ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rhh_data (
        id   INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL
      )
    `);
    const { rows } = await pool.query('SELECT data FROM rhh_data WHERE id = 1');
    if (rows.length === 0) {
      let seed = { ...EMPTY_DB };
      if (fs.existsSync(dbPath)) {
        try { seed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (_) {}
        console.log('[db-rhh] Migrando datos de JSON a PostgreSQL...');
      }
      _cache = seed;
      await pool.query(
        'INSERT INTO rhh_data(id, data) VALUES(1, $1)',
        [JSON.stringify(seed)]
      );
      console.log('[db-rhh] PostgreSQL inicializado con datos seed.');
    } else {
      _cache = rows[0].data;
      console.log('[db-rhh] Datos cargados desde PostgreSQL.');
    }
  } else {
    // ── Modo JSON local ──────────────────────────────────────────────────────
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(EMPTY_DB, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log('[db-rhh] Datos cargados desde JSON local:', dbPath);
  }
}

// Lee el estado actual (síncrono, usa caché)
function read() {
  if (!_cache) {
    if (!fs.existsSync(dbPath)) return { ...EMPTY_DB };
    _cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return _cache;
}

// Escribe y persiste (actualiza caché + persiste en background)
function write(data) {
  _cache = data;
  if (pool) {
    pool.query('UPDATE rhh_data SET data = $1 WHERE id = 1', [JSON.stringify(data)])
      .catch(err => console.error('[db-rhh] Error persistiendo en PostgreSQL:', err.message));
  } else {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[db-rhh] Error escribiendo JSON:', err.message);
    }
  }
}

function nextId(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 1;
  return Math.max(...rows.map(x => Number(x.id) || 0)) + 1;
}

/**
 * Calcula el balance de vacaciones de un empleado para un año dado.
 * Fuente única: rhh_incidences (type='vacacion').
 * Usado por: /schedule/weekly-attendance y /employees/vacation-balance/:id
 */
function calcVacBalance(db, empId, year) {
  const emp = (db.rhh_employees || []).find(e => e.id === empId);
  if (!emp) return null;
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;
  // Normalizar nombre del campo (puede ser total_vacation_days o vacation_days_per_year)
  const totalDays = emp.total_vacation_days || emp.vacation_days_per_year || 15;

  const vacIncs = (db.rhh_incidences || []).filter(i =>
    i.employee_id === empId &&
    i.type === 'vacacion' &&
    i.date >= yearStart && i.date <= yearEnd
  );

  function countDays(inc) {
    const end = inc.date_end || inc.date;
    if (end !== inc.date) {
      const s = new Date(inc.date + 'T12:00:00');
      const e = new Date(end + 'T12:00:00');
      return Math.round((e - s) / (24 * 60 * 60 * 1000)) + 1;
    }
    return 1;
  }

  const used    = vacIncs.filter(i => i.status === 'aprobada').reduce((a, i) => a + countDays(i), 0);
  const pending = vacIncs.filter(i => i.status === 'pendiente').reduce((a, i) => a + countDays(i), 0);
  return {
    employee_id: empId,
    employee_name: emp.full_name,
    year,
    total_vacation_days: totalDays,
    vacation_used: used,
    vacation_pending: pending,
    vacation_remaining: Math.max(0, totalDays - used),
    detail: vacIncs.map(i => ({ start_date: i.date, end_date: i.date_end || i.date, days: countDays(i), status: i.status }))
  };
}

// Fuerza la carga del JSON seed al PostgreSQL (para sincronizar datos locales al servidor)
async function forceSeedFromJson() {
  if (!pool) throw new Error('Solo disponible en modo PostgreSQL');
  if (!fs.existsSync(dbPath)) throw new Error('Archivo JSON seed no encontrado: ' + dbPath);
  const seed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  _cache = seed;
  await pool.query('INSERT INTO rhh_data(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=$1', [JSON.stringify(seed)]);
  return seed;
}

module.exports = { dbPath, read, write, nextId, initDb, forceSeedFromJson, calcVacBalance };
