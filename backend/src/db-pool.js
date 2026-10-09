/**
 * Pool compartido de PostgreSQL.
 * Todos los módulos db-*.js usan este pool en lugar de crear el suyo propio.
 * Reduce conexiones de ~27 (9 módulos × 3) a un máximo de 5.
 */
let pool = null;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 5,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    statement_timeout: 30000,
    query_timeout: 60000
  });
  pool.on('error', err => console.error('[db-pool] Pool error (idle client):', err.message));
  console.log('[db-pool] Pool compartido creado (max=5)');
}

module.exports = pool;
