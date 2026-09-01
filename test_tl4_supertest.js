/**
 * Comprehensive Supertest-based tests for Calendario de Turnos + Turno Flexible TL4
 *
 * Run: node test_tl4_supertest.js
 *
 * Tests use a temporary in-memory DB and real Express router.
 * 14+ test cases covering all P1/P2 requirements.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Setup: temp DB before requiring any app modules ──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl4-test-'));
const tmpDbPath = path.join(tmpDir, 'produccion-test.json');
process.env.DB_PRODUCCION_PATH = tmpDbPath;
// Ensure no PG connection
delete process.env.DATABASE_URL;

// Seed DB with required catalogs
const SEED_DB = {
  config: { ciclos_objetivo_l3: 2, ciclos_objetivo_l4: 2, ciclos_objetivo_baker: 2, ciclos_objetivo_l1: 2 },
  // L3 catalogs
  componentes_l3: [{ id: 1, nombre: 'Comp-L3', cliente: 'Test', carga_optima_varillas: 10, piezas_objetivo: 50, activo: true }],
  procesos_l3: [{ id: 1, nombre: 'Proc-L3', activo: true }],
  acabados_l3: [{ id: 1, nombre: 'Acab-L3', activo: true }],
  herramentales_l3: [{ id: 1, numero: 'H-L3-001', descripcion: 'Herr L3', activo: true }],
  defectos_l3: [{ id: 1, nombre: 'Def-L3', activo: true }],
  motivos_paro_l3: [{ id: 1, nombre: 'Paro-L3', activo: true, afecta_eficiencia: true, afecta_disponibilidad: true, afecta_rendimiento: false }],
  sub_motivos_paro_l3: [],
  operadores_l3: [{ id: 1, nombre: 'Op-L3', activo: true }],
  // L4 catalogs
  componentes_l4: [{ id: 1, nombre: 'Comp-L4', cliente: 'Test', carga_optima_varillas: 10, piezas_objetivo: 50, activo: true }],
  procesos_l4: [{ id: 1, nombre: 'Proc-L4', activo: true }],
  acabados_l4: [{ id: 1, nombre: 'Acab-L4', activo: true }],
  herramentales_l4: [{ id: 1, numero: 'H-L4-001', descripcion: 'Herr L4', activo: true }],
  defectos_l4: [{ id: 1, nombre: 'Def-L4', activo: true }],
  motivos_paro_l4: [{ id: 1, nombre: 'Paro-L4', activo: true, afecta_eficiencia: true, afecta_disponibilidad: true, afecta_rendimiento: false }],
  sub_motivos_paro_l4: [],
  operadores_l4: [{ id: 1, nombre: 'Op-L4', activo: true }],
  // Baker catalogs
  componentes_baker: [{ id: 1, nombre: 'Comp-Bk', cliente: 'Test', carga_optima_varillas: 10, piezas_objetivo: 50, activo: true }],
  procesos_baker: [{ id: 1, nombre: 'Proc-Bk', activo: true }],
  herramentales_baker: [{ id: 1, numero: 'H-BK-001', descripcion: 'Herr Bk', tipo: 'rack', activo: true }],
  defectos_baker: [{ id: 1, nombre: 'Def-Bk', activo: true }],
  motivos_paro_baker: [{ id: 1, nombre: 'Paro-Bk', activo: true, afecta_eficiencia: true, afecta_disponibilidad: true, afecta_rendimiento: false }],
  sub_motivos_paro_baker: [],
  operadores_baker: [{ id: 1, nombre: 'Op-Bk', activo: true }],
  clientes_baker: [{ id: 1, nombre: 'Client-Bk', activo: true }],
  sub_procesos_baker: [],
  motivos_cavidad_vacia_baker: [],
  // L1 catalogs
  componentes_l1: [{ id: 1, nombre: 'Comp-L1', cliente: 'Test', carga_optima_varillas: 10, piezas_objetivo: 50, activo: true }],
  procesos_l1: [{ id: 1, nombre: 'Proc-L1', activo: true }],
  herramentales_l1: [{ id: 1, numero: 'H-L1-001', descripcion: 'Herr L1', tipo: 'rack', activo: true }],
  defectos_l1: [{ id: 1, nombre: 'Def-L1', activo: true }],
  motivos_paro_l1: [{ id: 1, nombre: 'Paro-L1', activo: true, afecta_eficiencia: true, afecta_disponibilidad: true, afecta_rendimiento: false }],
  sub_motivos_paro_l1: [],
  operadores_l1: [{ id: 1, nombre: 'Op-L1', activo: true }],
  clientes_l1: [{ id: 1, nombre: 'Client-L1', activo: true }],
  sub_procesos_l1: [],
  motivos_cavidad_vacia_l1: [],
  // Empty arrays
  cargas: [], paros: [],
  cargas_baker: [], paros_baker: [],
  cargas_l1: [], paros_l1: [],
  kpi_snapshots: [],
  registros_scrap: [],
  turno_schedules: [],
  turno_l4_config: [],
  turno_schedule_history: [],
  turno_l4_config_history: [],
  // Users for auth
  users: [{ id: 1, username: 'admin', password_hash: '$2a$10$fake', nombre: 'Admin Test', role: 'admin', activo: true }]
};

function resetDb(extra = {}) {
  const db = JSON.parse(JSON.stringify({ ...SEED_DB, ...extra }));
  fs.writeFileSync(tmpDbPath, JSON.stringify(db, null, 2));
  // Force dbProd to re-read
  delete require.cache[require.resolve('./backend/src/db-produccion')];
}

// ── Express app setup ──
resetDb();
const express = require('express');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'cambia-esta-clave';

// Generate a valid JWT token for admin user
const ADMIN_TOKEN = jwt.sign(
  { sub: 1, nombre: 'Admin Test', role: 'admin', module: 'produccion', linea: null, user_type: 'admin' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

function createApp() {
  // Clear cached router (has state from dbProd)
  delete require.cache[require.resolve('./backend/src/routes/produccion')];
  delete require.cache[require.resolve('./backend/src/db-produccion')];
  // Re-read fresh DB
  const app = express();
  app.use(express.json());
  const router = require('./backend/src/routes/produccion');
  app.use('/api/produccion', router);
  return app;
}

// Helper: supertest agent with auth header
function req(app) {
  const agent = supertest(app);
  const wrap = (method) => (...args) => agent[method](...args).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), delete: wrap('delete') };
}

// ── Test runner ──
let passed = 0, failed = 0, total = 0;
const results = [];

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    process.stdout.write(`  FAIL  ${name}\n    ${err.message}\n`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];

function makeTL4Dias(entrada = '08:00', salida = '17:00') {
  const dias = {};
  for (const dia of DIAS) {
    dias[dia] = {
      activo: dia !== 'sabado' && dia !== 'domingo',
      hora_entrada: entrada,
      hora_salida: salida
    };
  }
  return dias;
}

function getMonday(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return date.toLocaleDateString('en-CA');
}

// ── Tests ──
async function runTests() {
  console.log('\n=== Supertest TL4 Tests ===\n');

  // ────────────────────────────────────────────────────────────────────────────
  // 1. POST turno-l4-config: validate HH:MM range
  // ────────────────────────────────────────────────────────────────────────────
  await test('1. turno-l4-config rejects invalid HH:MM (25:00)', async () => {
    resetDb();
    const app = createApp();
    const dias = {};
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    for (const d of DIAS) dias[d] = { activo: d !== 'sabado' && d !== 'domingo', hora_entrada: '08:00', hora_salida: '17:00' };
    dias.lunes.hora_entrada = '25:00'; // invalid
    const res = await req(app)
      .post('/api/produccion/turno-l4-config')
      .send({ week_start: '2026-09-07', dias });
    assertEqual(res.status, 400, 'Should reject invalid hour');
    assert(res.body.error.includes('HH:MM'), 'Error should mention HH:MM');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. POST turno-l4-config: reject cross-midnight (hora_salida <= hora_entrada)
  // ────────────────────────────────────────────────────────────────────────────
  await test('2. turno-l4-config rejects cross-midnight', async () => {
    resetDb();
    const app = createApp();
    const dias = {};
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    for (const d of DIAS) dias[d] = { activo: d !== 'sabado' && d !== 'domingo', hora_entrada: '08:00', hora_salida: '17:00' };
    dias.martes = { activo: true, hora_entrada: '22:00', hora_salida: '06:00' };
    const res = await req(app)
      .post('/api/produccion/turno-l4-config')
      .send({ week_start: '2026-09-07', dias });
    assertEqual(res.status, 400, 'Should reject cross-midnight');
    assert(res.body.error.includes('hora_salida'), 'Error about hora_salida');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. POST turno-l4-config: valid config saves + normalizes
  // ────────────────────────────────────────────────────────────────────────────
  await test('3. turno-l4-config saves valid config with normalized fields', async () => {
    resetDb();
    const app = createApp();
    const dias = {};
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    for (const d of DIAS) {
      dias[d] = {
        activo: d !== 'sabado' && d !== 'domingo',
        hora_entrada: '08:00',
        hora_salida: '17:00',
        extra_field: 'should be stripped' // unexpected field
      };
    }
    const res = await req(app)
      .post('/api/produccion/turno-l4-config')
      .send({ week_start: '2026-09-07', dias });
    assertEqual(res.status, 200, 'Should accept valid config');
    assert(res.body.ok === true, 'Should return ok');
    // Check normalization: extra_field should be stripped
    const savedDias = res.body.record.dias;
    assert(!savedDias.lunes.extra_field, 'Extra field should be stripped');
    assert(savedDias.lunes.activo === true, 'activo should be true');
    assert(savedDias.sabado.activo === false, 'sabado should be inactive');
    // arranque_ciclos fixed at 6
    assertEqual(res.body.record.arranque_ciclos, 6, 'arranque_ciclos should be fixed at 6');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. POST turno-schedule: validate YYYY-MM-DD + normalize booleans
  // ────────────────────────────────────────────────────────────────────────────
  await test('4. turno-schedule rejects bad date format', async () => {
    resetDb();
    const app = createApp();
    const schedule = {};
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    for (const d of DIAS) schedule[d] = { T1: true, T2: true, T3: d !== 'domingo' };
    const res = await req(app)
      .post('/api/produccion/turno-schedule/L3')
      .send({ week_start: '09/07/2026', schedule }); // invalid format
    assertEqual(res.status, 400, 'Should reject bad date');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. turno-schedule rejects non-boolean values
  // ────────────────────────────────────────────────────────────────────────────
  await test('5. turno-schedule rejects non-boolean values', async () => {
    resetDb();
    const app = createApp();
    const schedule = {};
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    for (const d of DIAS) schedule[d] = { T1: 1, T2: 'yes', T3: 0 }; // truthy/falsy values
    const res = await req(app)
      .post('/api/produccion/turno-schedule/L3')
      .send({ week_start: '2026-09-07', schedule });
    assertEqual(res.status, 400, 'Should reject non-boolean values');
    assert(res.body.error.includes('booleano'), 'Error should mention boolean type');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. History: replaced_by is recorded on overwrite
  // ────────────────────────────────────────────────────────────────────────────
  await test('6. turno-l4-config history records replaced_by', async () => {
    resetDb();
    const app = createApp();
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const makeDias = () => {
      const d = {};
      for (const dia of DIAS) d[dia] = { activo: dia !== 'sabado' && dia !== 'domingo', hora_entrada: '08:00', hora_salida: '17:00' };
      return d;
    };
    // First save
    await req(app).post('/api/produccion/turno-l4-config')
      .send({ week_start: '2026-09-07', dias: makeDias() });
    // Overwrite
    const res2 = await req(app).post('/api/produccion/turno-l4-config')
      .send({ week_start: '2026-09-07', dias: makeDias() });
    assertEqual(res2.status, 200, 'Overwrite should succeed');
    // Check history
    const histRes = await req(app).get('/api/produccion/turno-l4-config-history');
    assertEqual(histRes.status, 200);
    assert(histRes.body.history.length >= 1, 'Should have at least 1 history entry');
    assert(histRes.body.history[0].replaced_by, 'History should have replaced_by');
    assert(histRes.body.history[0].replaced_at, 'History should have replaced_at');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. admin-crear: L4 post-cutover assigns TL4
  // ────────────────────────────────────────────────────────────────────────────
  await test('7. admin-crear assigns TL4 for L4 post-cutover', async () => {
    // Set up L4 TL4 config for the week of 2026-09-07
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const dias = {};
    for (const d of DIAS) dias[d] = { activo: d !== 'sabado' && d !== 'domingo', hora_entrada: '08:00', hora_salida: '17:00' };
    resetDb({
      turno_l4_config: [{
        id: 1, week_start: '2026-09-07', dias, arranque_ciclos: 6,
        created_by: 'test', created_at: '2026-09-01'
      }]
    });
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/paros/admin-crear')
      .send({
        linea: 'L4',
        motivo_id: 1,
        fecha_inicio: '2026-09-08', // Tuesday post-cutover
        hora_inicio: '10:00',
        fecha_fin: '2026-09-08',
        hora_fin: '10:30'
      });
    assertEqual(res.status, 201, 'Should create paro');
    assertEqual(res.body.turno, 'TL4', 'Turno should be TL4 for L4 post-cutover');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 8. admin-crear: L3 gets T1/T2/T3 (not TL4)
  // ────────────────────────────────────────────────────────────────────────────
  await test('8. admin-crear assigns T1 for L3 at 10:00', async () => {
    resetDb();
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/paros/admin-crear')
      .send({
        linea: 'L3',
        motivo_id: 1,
        fecha_inicio: '2026-09-08',
        hora_inicio: '10:00',
        fecha_fin: '2026-09-08',
        hora_fin: '10:30'
      });
    assertEqual(res.status, 201, 'Should create paro');
    assertEqual(res.body.turno, 'T1', 'L3 at 10:00 should be T1');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 9. admin-crear: L4 before cutover uses T1/T2/T3
  // ────────────────────────────────────────────────────────────────────────────
  await test('9. admin-crear: L4 pre-cutover uses T1 (backward compat)', async () => {
    resetDb(); // No turno_l4_config → pre-cutover behavior
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/paros/admin-crear')
      .send({
        linea: 'L4',
        motivo_id: 1,
        fecha_inicio: '2026-08-01', // before cutover date
        hora_inicio: '10:00',
        fecha_fin: '2026-08-01',
        hora_fin: '10:30'
      });
    assertEqual(res.status, 201, 'Should create paro');
    assertEqual(res.body.turno, 'T1', 'L4 pre-cutover at 10:00 should be T1');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 10. KPI guardar: omits disabled turnos for L3
  // ────────────────────────────────────────────────────────────────────────────
  await test('10. KPI guardar omits disabled turno T3 for L3', async () => {
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const schedule = {};
    for (const d of DIAS) schedule[d] = { T1: true, T2: true, T3: false }; // T3 disabled all week
    resetDb({
      turno_schedules: [{
        id: 1, linea: 'L3', week_start: '2026-09-07', schedule,
        created_by: 'test', created_at: '2026-09-01'
      }]
    });
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/kpis/guardar')
      .send({ fecha: '2026-09-08', linea: 'L3', turno: 'all' });
    assertEqual(res.status, 200, 'Should succeed');
    const snaps = res.body.snapshots || [];
    const turnos = snaps.map(s => s.turno);
    assert(!turnos.includes('T3'), 'T3 should be omitted (disabled in calendar)');
    assert(turnos.includes('T1'), 'T1 should be present');
    assert(turnos.includes('T2'), 'T2 should be present');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 11. KPI guardar: TL4 eficiencia uses arranque-adjusted cycles
  // ────────────────────────────────────────────────────────────────────────────
  await test('11. KPI guardar TL4 eficiencia uses arranque-adjusted numerator', async () => {
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const dias = {};
    for (const d of DIAS) dias[d] = { activo: d !== 'sabado' && d !== 'domingo', hora_entrada: '08:00', hora_salida: '17:00' };
    // Create 10 cargas for L4 on 2026-09-08 (Tuesday), descargadas at different hours
    // First 6 are arranque, last 4 count for efficiency
    const cargas = [];
    for (let i = 0; i < 10; i++) {
      const hora = `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '15' : '45'}`;
      cargas.push({
        id: i + 1, folio: `L4-${i + 1}`, linea: 'L4',
        herramental_id: 1, herramental_no: `H-${i}`, componente_id: 1, componente: 'Comp',
        proceso_id: 1, acabado_id: 1, varillas: 10, piezas_por_varilla: 5,
        cantidad: 50, operador_id: 1, operador: 'Op',
        fecha_carga: '2026-09-08', hora_carga: hora,
        fecha_descarga: '2026-09-08', hora_descarga: hora,
        turno: 'TL4', estado: 'descargado', es_vacia: false,
        semana: 37
      });
    }
    resetDb({
      cargas,
      turno_l4_config: [{
        id: 1, week_start: '2026-09-07', dias, arranque_ciclos: 6,
        created_by: 'test', created_at: '2026-09-01'
      }]
    });
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/kpis/guardar')
      .send({ fecha: '2026-09-08', linea: 'L4' });
    assertEqual(res.status, 200, 'Should succeed');
    const snap = (res.body.snapshots || []).find(s => s.turno === 'TL4');
    assert(snap, 'Should have TL4 snapshot');
    assertEqual(snap.ciclos_totales, 10, 'Total cycles should be 10');
    // Efficiency should use (10-6) / adjusted_obj, not 10 / adjusted_obj
    // With 9 hours (08:00-17:00) and obj=2/hr, full obj = 18
    // Arranque removes 6 from both sides → eff = 4 / (18-6 adj) = 4/12 adj
    // The exact value depends on elapsed hours computation, but key test:
    // If efficiency used all 10 cycles, it would be ~10/18 = 0.556
    // With arranque, numerator is 4, so eff < 0.5
    assert(snap.eficiencia < 0.5, `Eficiencia should be < 0.5 (arranque adjusted), got ${snap.eficiencia}`);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 12. GET /kpis: L4 TL4 returns turno='TL4' in snapshot
  // ────────────────────────────────────────────────────────────────────────────
  await test('12. GET /kpis returns TL4 turno for L4 post-cutover', async () => {
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const dias = {};
    for (const d of DIAS) dias[d] = { activo: d !== 'sabado' && d !== 'domingo', hora_entrada: '08:00', hora_salida: '17:00' };
    resetDb({
      cargas: [{
        id: 1, folio: 'L4-1', linea: 'L4', herramental_id: 1, componente_id: 1,
        proceso_id: 1, acabado_id: 1, varillas: 10, piezas_por_varilla: 5,
        cantidad: 50, operador_id: 1, fecha_carga: '2026-09-08', hora_carga: '10:00',
        fecha_descarga: '2026-09-08', hora_descarga: '10:30', turno: 'TL4',
        estado: 'descargado', es_vacia: false, semana: 37
      }],
      turno_l4_config: [{
        id: 1, week_start: '2026-09-07', dias, arranque_ciclos: 6,
        created_by: 'test', created_at: '2026-09-01'
      }]
    });
    const app = createApp();
    const res = await req(app)
      .get('/api/produccion/kpis?linea=L4&desde=2026-09-08&hasta=2026-09-08');
    assertEqual(res.status, 200);
    const snaps = res.body.snapshots || [];
    const tl4Snap = snaps.find(s => s.turno === 'TL4');
    assert(tl4Snap, 'Should find TL4 snapshot');
    assertEqual(tl4Snap.linea, 'L4');
    // Should NOT have T1/T2/T3 for this date (post-cutover)
    const t1Snap = snaps.find(s => s.turno === 'T1' && s.linea === 'L4');
    assert(!t1Snap, 'L4 post-cutover should not have T1 snapshot');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 13. GET /kpis: isTurnoActivo filters disabled turnos
  // ────────────────────────────────────────────────────────────────────────────
  await test('13. GET /kpis omits disabled turno for Baker', async () => {
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const schedule = {};
    for (const d of DIAS) schedule[d] = { T1: true, T2: false, T3: false }; // Only T1 active
    resetDb({
      turno_schedules: [{
        id: 1, linea: 'Baker', week_start: '2026-09-07', schedule,
        created_by: 'test', created_at: '2026-09-01'
      }],
      cargas_baker: [{
        id: 1, folio: 'BK-1', herramental_id: 1, componente_id: 1,
        proceso_id: 1, varillas: 10, piezas_por_varilla: 5, cantidad: 50,
        operador_id: 1, fecha_carga: '2026-09-08', hora_carga: '10:00',
        fecha_descarga: '2026-09-08', hora_descarga: '10:30', turno: 'T1',
        estado: 'descargado', es_vacia: false, semana: 37
      }]
    });
    const app = createApp();
    const res = await req(app)
      .get('/api/produccion/kpis?linea=Baker&desde=2026-09-08&hasta=2026-09-08');
    assertEqual(res.status, 200);
    const snaps = res.body.snapshots || [];
    const bakerTurnos = snaps.filter(s => s.linea === 'Baker').map(s => s.turno);
    assert(!bakerTurnos.includes('T2'), 'T2 should be omitted for Baker');
    assert(!bakerTurnos.includes('T3'), 'T3 should be omitted for Baker');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 14. turno-schedule history endpoint works
  // ────────────────────────────────────────────────────────────────────────────
  await test('14. turno-schedule history endpoint returns data', async () => {
    resetDb();
    const app = createApp();
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const makeSchedule = (t3val) => {
      const s = {};
      for (const d of DIAS) s[d] = { T1: true, T2: true, T3: t3val };
      return s;
    };
    // Save first
    await req(app).post('/api/produccion/turno-schedule/L3')
      .send({ week_start: '2026-09-07', schedule: makeSchedule(true) });
    // Overwrite
    await req(app).post('/api/produccion/turno-schedule/L3')
      .send({ week_start: '2026-09-07', schedule: makeSchedule(false) });
    // Query history
    const res = await req(app).get('/api/produccion/turno-schedule-history/L3');
    assertEqual(res.status, 200);
    assert(res.body.history.length >= 1, 'Should have history');
    assert(res.body.history[0].replaced_by, 'Should have replaced_by');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 15. buildParetoDefectos: L4 TL4 defectos are not empty
  // ────────────────────────────────────────────────────────────────────────────
  await test('15. pizarron pareto defectos includes TL4 L4 data', async () => {
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const dias = {};
    for (const d of DIAS) dias[d] = { activo: d !== 'sabado' && d !== 'domingo', hora_entrada: '08:00', hora_salida: '17:00' };
    resetDb({
      cargas: [{
        id: 1, folio: 'L4-1', linea: 'L4', herramental_id: 1, componente_id: 1,
        proceso_id: 1, acabado_id: 1, varillas: 10, piezas_por_varilla: 5,
        cantidad: 50, operador_id: 1, fecha_carga: '2026-09-08', hora_carga: '10:00',
        fecha_descarga: '2026-09-08', hora_descarga: '10:30', turno: 'TL4',
        estado: 'defecto', defecto_id: 1, defecto: 'Def-L4', es_vacia: false, semana: 37
      }],
      turno_l4_config: [{
        id: 1, week_start: '2026-09-07', dias, arranque_ciclos: 6,
        created_by: 'test', created_at: '2026-09-01'
      }]
    });
    const app = createApp();
    // GET /pizarron?linea=L4&fecha=2026-09-08&turno=TL4
    const res = await req(app)
      .get('/api/produccion/pizarron?linea=L4&fecha=2026-09-08&turno=TL4');
    assertEqual(res.status, 200);
    // Response: { data: { L4: { TL4: {...}, pareto_defectos: [...] } } }
    const l4Data = res.body.data && res.body.data.L4;
    assert(l4Data, 'Should have L4 data in pizarron');
    assert(l4Data.TL4, 'Should have TL4 key in L4 data');
    // Should have defectos
    const defectos = l4Data.pareto_defectos || [];
    assert(defectos.length > 0, 'L4 TL4 pareto_defectos should not be empty');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 16. L4 before 06:30: TL4 does NOT use T3 overnight date rule
  // ────────────────────────────────────────────────────────────────────────────
  await test('16. L4 post-cutover at 05:00 uses same date (no T3 overnight)', async () => {
    const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
    const dias = {};
    for (const d of DIAS) dias[d] = { activo: true, hora_entrada: '04:00', hora_salida: '20:00' };
    resetDb({
      turno_l4_config: [{
        id: 1, week_start: '2026-09-07', dias, arranque_ciclos: 6,
        created_by: 'test', created_at: '2026-09-01'
      }]
    });
    const app = createApp();
    // Create paro at 05:00 on Tuesday — should NOT shift date to Monday
    const res = await req(app)
      .post('/api/produccion/paros/admin-crear')
      .send({
        linea: 'L4',
        motivo_id: 1,
        fecha_inicio: '2026-09-08', // Tuesday
        hora_inicio: '05:00',       // Before 06:30
        fecha_fin: '2026-09-08',
        hora_fin: '05:30'
      });
    assertEqual(res.status, 201);
    assertEqual(res.body.turno, 'TL4', 'Should be TL4');
    // fecha_turno should still be 2026-09-08, NOT 2026-09-07 (no T3 overnight rule)
    // The paro fecha_inicio is 2026-09-08
    assertEqual(res.body.fecha_inicio, '2026-09-08', 'Date should not shift for TL4');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 17. L3 at 05:00 uses T3 overnight rule (fecha shifts to previous day)
  // ────────────────────────────────────────────────────────────────────────────
  await test('17. L3 at 05:00 uses T3 overnight rule', async () => {
    resetDb();
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/paros/admin-crear')
      .send({
        linea: 'L3',
        motivo_id: 1,
        fecha_inicio: '2026-09-08',
        hora_inicio: '05:00',
        fecha_fin: '2026-09-08',
        hora_fin: '05:30'
      });
    assertEqual(res.status, 201);
    assertEqual(res.body.turno, 'T3', 'L3 at 05:00 should be T3');
  });

  await test('18. turno config rejects an impossible calendar date', async () => {
    resetDb();
    const app = createApp();
    const schedule = {};
    for (const dia of DIAS) schedule[dia] = { T1: true, T2: true, T3: false };
    const res = await req(app)
      .post('/api/produccion/turno-schedule/L3')
      .send({ week_start: '2026-99-99', schedule });
    assertEqual(res.status, 400, 'Impossible date must be rejected');
  });

  await test('19. turno-l4-config rejects string activo values', async () => {
    resetDb();
    const app = createApp();
    const dias = makeTL4Dias();
    dias.lunes.activo = 'false';
    const res = await req(app)
      .post('/api/produccion/turno-l4-config')
      .send({ week_start: '2026-09-07', dias });
    assertEqual(res.status, 400, 'String boolean must be rejected');
    assert(res.body.error.includes('booleano'), 'Error should mention boolean type');
  });

  await test('20. regular L4 paro is rejected outside TL4 window', async () => {
    resetDb({
      turno_l4_config: [{
        id: 1, week_start: '2026-09-07', dias: makeTL4Dias(), arranque_ciclos: 6
      }]
    });
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/paros/L4')
      .send({ motivo_id: 1, fecha_inicio: '2026-09-08', hora_inicio: '07:00' });
    assertEqual(res.status, 409, 'Outside-window L4 paro must be rejected');
    assert(res.body.error.includes('Fuera del horario'), 'Error should explain TL4 window');
  });

  await test('21. admin paro outside TL4 requires audited override', async () => {
    resetDb({
      turno_l4_config: [{
        id: 1, week_start: '2026-09-07', dias: makeTL4Dias(), arranque_ciclos: 6
      }]
    });
    const app = createApp();
    const body = {
      linea: 'L4', motivo_id: 1,
      fecha_inicio: '2026-09-08', hora_inicio: '07:00',
      fecha_fin: '2026-09-08', hora_fin: '07:30'
    };
    const blocked = await req(app).post('/api/produccion/paros/admin-crear').send(body);
    assertEqual(blocked.status, 409, 'Admin override must be explicit');
    const missingReason = await req(app).post('/api/produccion/paros/admin-crear')
      .send({ ...body, override_turno: true });
    assertEqual(missingReason.status, 400, 'Override reason is required');
    const allowed = await req(app).post('/api/produccion/paros/admin-crear')
      .send({ ...body, override_turno: true, override_motivo: 'Corrección histórica autorizada' });
    assertEqual(allowed.status, 201, 'Audited override should be allowed');
    assertEqual(allowed.body.override_turno, true);
    assertEqual(allowed.body.override_motivo, 'Corrección histórica autorizada');
    assert(allowed.body.override_por, 'Override actor must be recorded');
  });

  await test('22. pendiente-motivo skips when current time is outside TL4', async () => {
    const fechaMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const horaMx = new Date().toLocaleTimeString('en-GB', {
      timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false
    }).slice(0, 5);
    const currentMins = Number(horaMx.slice(0, 2)) * 60 + Number(horaMx.slice(3, 5));
    const entrada = currentMins < 12 * 60 ? '20:00' : '01:00';
    const salida = currentMins < 12 * 60 ? '21:00' : '02:00';
    const dias = {};
    for (const dia of DIAS) dias[dia] = { activo: false };
    const dayNames = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
    const dayName = dayNames[new Date(fechaMx + 'T12:00:00').getDay()];
    dias[dayName] = { activo: true, hora_entrada: entrada, hora_salida: salida };
    resetDb({
      turno_l4_config: [{ id: 1, week_start: getMonday(fechaMx), dias, arranque_ciclos: 6 }]
    });
    const app = createApp();
    const res = await req(app)
      .post('/api/produccion/paros/L4/pendiente-motivo')
      .send({ fecha_inicio: fechaMx, hora_inicio: horaMx });
    assertEqual(res.status, 200);
    assertEqual(res.body.skipped, true, 'Automatic pending stop must be skipped');
    assert(['fuera_horario', 'fuera_turno_actual'].includes(res.body.reason), 'Expected outside-shift reason');
  });

  await test('23. cambio-turno TL4 rejects calls away from configured end', async () => {
    const fechaMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const horaMx = new Date().toLocaleTimeString('en-GB', {
      timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false
    }).slice(0, 5);
    const currentMins = Number(horaMx.slice(0, 2)) * 60 + Number(horaMx.slice(3, 5));
    let endMins = (currentMins + 360) % 1440;
    if (endMins === 0) endMins = 1;
    const salida = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
    const dias = {};
    for (const dia of DIAS) dias[dia] = { activo: false };
    const dayNames = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
    const dayName = dayNames[new Date(fechaMx + 'T12:00:00').getDay()];
    dias[dayName] = { activo: true, hora_entrada: '00:00', hora_salida: salida };
    resetDb({
      turno_l4_config: [{ id: 1, week_start: getMonday(fechaMx), dias, arranque_ciclos: 6 }]
    });
    const app = createApp();
    const res = await req(app).post('/api/produccion/paros/L4/cambio-turno').send({});
    assertEqual(res.status, 409, 'Arbitrary cambio-turno call must be rejected');
  });

  await test('24. KPI and linea stats return the same TL4 efficiency', async () => {
    const dias = makeTL4Dias();
    const cargas = [];
    for (let i = 0; i < 10; i++) {
      const hora = `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '15' : '45'}`;
      cargas.push({
        id: i + 1, folio: `L4-EQ-${i + 1}`, linea: 'L4',
        herramental_id: 1, componente_id: 1, varillas: 10, piezas_por_varilla: 5,
        cantidad: 50, operador_id: 1, operador: 'Op-L4',
        fecha_carga: '2026-09-08', hora_carga: hora,
        fecha_descarga: '2026-09-08', hora_descarga: hora,
        turno: 'TL4', estado: 'descargado', es_vacia: false, semana: 37
      });
    }
    resetDb({
      cargas,
      turno_l4_config: [{ id: 1, week_start: '2026-09-07', dias, arranque_ciclos: 6 }]
    });
    const app = createApp();
    const kpiRes = await req(app)
      .get('/api/produccion/kpis?linea=L4&desde=2026-09-08&hasta=2026-09-08');
    const statsRes = await req(app)
      .get('/api/produccion/stats/semana-linea?linea=L4&fecha_ini=2026-09-08&fecha_fin=2026-09-08');
    const operatorRes = await req(app)
      .get('/api/produccion/stats/operador-semana?operador_id=1&fecha_ini=2026-09-08&fecha_fin=2026-09-08');
    assertEqual(kpiRes.status, 200);
    assertEqual(statsRes.status, 200);
    assertEqual(operatorRes.status, 200);
    const kpi = kpiRes.body.snapshots.find(s => s.linea === 'L4' && s.turno === 'TL4');
    const stats = statsRes.body.find(s => s.turno === 'TL4');
    const operator = operatorRes.body.find(s => s.linea === 'L4' && s.turno === 'TL4');
    assert(kpi && stats && operator, 'All KPI/stat endpoints should return TL4 data');
    assert(Math.abs(kpi.eficiencia - stats.eficiencia) < 0.0005,
      `Expected matching efficiency, KPI=${kpi.eficiencia}, stats=${stats.eficiencia}`);
    assert(Math.abs(kpi.eficiencia - operator.eficiencia) < 0.0005,
      `Expected operator efficiency to match, KPI=${kpi.eficiencia}, operator=${operator.eficiencia}`);
  });

  await test('25. Baker and L1 auto stops skip disabled shifts', async () => {
    const schedule = {};
    for (const dia of DIAS) schedule[dia] = { T1: false, T2: false, T3: false };
    resetDb({
      turno_schedules: [
        { id: 1, linea: 'Baker', week_start: '2026-09-07', schedule },
        { id: 2, linea: 'L1', week_start: '2026-09-07', schedule }
      ]
    });
    const app = createApp();
    const baker = await req(app).post('/api/produccion/baker/paros/auto-sin-actividad')
      .send({ fecha: '2026-09-08', turno: 'T1' });
    const l1 = await req(app).post('/api/produccion/l1/paros/auto-sin-actividad')
      .send({ fecha: '2026-09-08', turno: 'T1' });
    assertEqual(baker.status, 200);
    assertEqual(l1.status, 200);
    assertEqual(baker.body.reason, 'turno_inactivo');
    assertEqual(l1.body.reason, 'turno_inactivo');
    const dbAfter = JSON.parse(fs.readFileSync(tmpDbPath, 'utf8'));
    assertEqual(dbAfter.paros_baker.length, 0, 'Baker should not create a stop');
    assertEqual(dbAfter.paros_l1.length, 0, 'L1 should not create a stop');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${total}  |  PASS: ${passed}  |  FAIL: ${failed}`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }

  // Cleanup
  try {
    fs.unlinkSync(tmpDbPath);
    fs.rmdirSync(tmpDir);
  } catch (_) {}

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
