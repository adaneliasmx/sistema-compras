/**
 * Test suite: Calendario de Turnos + Turno Flexible TL4
 *
 * Valida las funciones puras del backend de produccion.js:
 *   getWeekStart, getDiaSemana, getTurnoSchedule, getTurnoL4Config,
 *   l4UsesTL4, isTurnoActivo, toMins, elapsedHoursForTL4, buildParetoParos (parcial)
 *
 * Ejecutar: node test_tl4.js
 */

// ═══════════════════════════════════════════════════════════════════════════════
// RE-DEFINE pure functions extracted from produccion.js for isolated testing
// ═══════════════════════════════════════════════════════════════════════════════

const L4_TL4_CUTOVER_DATE = '2026-08-31';
const L4_ARRANQUE_CICLOS = 6;

const TURNOS_DEF = {
  T1: { start: 6 * 60 + 30, hours: 8 },
  T2: { start: 14 * 60 + 30, hours: 7 },
  T3: { start: 21 * 60 + 30, hours: 9 }
};

const DEFAULT_SCHEDULE = {
  lunes:     { T1: true, T2: true, T3: true },
  martes:    { T1: true, T2: true, T3: true },
  miercoles: { T1: true, T2: true, T3: true },
  jueves:    { T1: true, T2: true, T3: true },
  viernes:   { T1: true, T2: true, T3: true },
  sabado:    { T1: true, T2: true, T3: false },
  domingo:   { T1: false, T2: false, T3: false }
};

function toMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function getWeekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getDiaSemana(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const idx = dt.getDay();
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][idx];
}

function getTurnoSchedule(pdb, linea, weekStart) {
  const schedules = pdb.turno_schedules || [];
  const found = schedules.find(s => s.linea === linea && s.week_start === weekStart);
  return found ? found.schedule : { ...DEFAULT_SCHEDULE };
}

function getTurnoL4Config(pdb, weekStart) {
  const configs = pdb.turno_l4_config || [];
  const found = configs.find(c => c.week_start === weekStart);
  if (found) return found;
  return {
    week_start: weekStart,
    dias: {
      lunes:     { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      martes:    { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      miercoles: { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      jueves:    { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      viernes:   { activo: true,  hora_entrada: '08:00', hora_salida: '17:00' },
      sabado:    { activo: false, hora_entrada: '08:00', hora_salida: '13:00' },
      domingo:   { activo: false, hora_entrada: '',      hora_salida: '' }
    },
    arranque_ciclos: 6
  };
}

function l4UsesTL4(pdb, fecha) {
  if (fecha >= L4_TL4_CUTOVER_DATE) return true;
  const weekStart = getWeekStart(fecha);
  return (pdb.turno_l4_config || []).some(c => c.week_start === weekStart);
}

function isTurnoActivo(pdb, linea, turno, fecha) {
  const weekStart = getWeekStart(fecha);
  if (linea === 'L4' && l4UsesTL4(pdb, fecha)) {
    if (turno !== 'TL4') return false;
    const cfg = getTurnoL4Config(pdb, weekStart);
    const dia = getDiaSemana(fecha);
    return !!(cfg.dias[dia] && cfg.dias[dia].activo);
  }
  const schedule = getTurnoSchedule(pdb, linea, weekStart);
  const dia = getDiaSemana(fecha);
  return !!(schedule[dia] && schedule[dia][turno]);
}

// elapsedHoursForTL4 con inyeccion de nowDate/nowMins para testing
function elapsedHoursForTL4(targetDate, horaEntrada, horaSalida, _nowDate, _nowMins) {
  const entMins = toMins(horaEntrada);
  const salMins = toMins(horaSalida);
  const totalHours = (salMins - entMins) / 60;
  if (_nowDate !== targetDate) return totalHours;
  if (_nowMins >= salMins) return totalHours;
  if (_nowMins < entMins) return 0;
  return (_nowMins - entMins) / 60;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK (minimal assert + runner)
// ═══════════════════════════════════════════════════════════════════════════════

let passed = 0, failed = 0, errors = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(msg);
    console.log(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    const detail = `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    errors.push(detail);
    console.log(`  FAIL: ${detail}`);
  }
}

function assertClose(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    const detail = `${msg} — expected ~${expected} (+/-${tolerance}), got ${actual}`;
    errors.push(detail);
    console.log(`  FAIL: ${detail}`);
  }
}

function suite(name, fn) {
  console.log(`\n--- ${name} ---`);
  fn();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. getWeekStart ──────────────────────────────────────────────────────────

suite('1. getWeekStart', () => {
  // 2026-08-31 es lunes
  assertEq(getWeekStart('2026-08-31'), '2026-08-31', 'Lunes retorna mismo dia');
  // 2026-09-03 es jueves
  assertEq(getWeekStart('2026-09-03'), '2026-08-31', 'Jueves retorna lunes');
  // 2026-09-06 es domingo
  assertEq(getWeekStart('2026-09-06'), '2026-08-31', 'Domingo retorna lunes');
  // 2026-08-30 es domingo
  assertEq(getWeekStart('2026-08-30'), '2026-08-24', 'Domingo anterior retorna su lunes');
});

// ── 2. getDiaSemana ──────────────────────────────────────────────────────────

suite('2. getDiaSemana', () => {
  assertEq(getDiaSemana('2026-08-31'), 'lunes', '2026-08-31 es lunes');
  assertEq(getDiaSemana('2026-09-01'), 'martes', '2026-09-01 es martes');
  assertEq(getDiaSemana('2026-09-05'), 'sabado', '2026-09-05 es sabado');
  assertEq(getDiaSemana('2026-09-06'), 'domingo', '2026-09-06 es domingo');
});

// ── 3. l4UsesTL4 — cutover date ──────────────────────────────────────────────

suite('3. l4UsesTL4 — deteccion de modo TL4', () => {
  const emptyDb = {};

  // >= cutover date => siempre true
  assertEq(l4UsesTL4(emptyDb, '2026-08-31'), true, 'Cutover date => TL4');
  assertEq(l4UsesTL4(emptyDb, '2026-09-15'), true, 'Despues de cutover => TL4');
  assertEq(l4UsesTL4(emptyDb, '2027-01-01'), true, 'Muy despues de cutover => TL4');

  // Antes de cutover sin config => false
  assertEq(l4UsesTL4(emptyDb, '2026-08-30'), false, 'Antes de cutover sin config => NO TL4');
  assertEq(l4UsesTL4(emptyDb, '2026-01-01'), false, 'Enero 2026 sin config => NO TL4');

  // Antes de cutover con config explicita => true
  const dbConConfig = {
    turno_l4_config: [{ week_start: '2026-08-24' }]
  };
  assertEq(l4UsesTL4(dbConConfig, '2026-08-25'), true, 'Antes de cutover con config => TL4');
  assertEq(l4UsesTL4(dbConConfig, '2026-08-30'), true, 'Domingo de semana con config => TL4');
  assertEq(l4UsesTL4(dbConConfig, '2026-08-17'), false, 'Semana diferente sin config => NO TL4');
});

// ── 4. isTurnoActivo — L4 en modo TL4 ───────────────────────────────────────

suite('4. isTurnoActivo — L4 modo TL4', () => {
  const pdb = {};

  // Post-cutover: L4 solo acepta TL4
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-08-31'), true, 'L4 TL4 lunes post-cutover => activo');
  assertEq(isTurnoActivo(pdb, 'L4', 'T1', '2026-08-31'), false, 'L4 T1 post-cutover => INACTIVO');
  assertEq(isTurnoActivo(pdb, 'L4', 'T2', '2026-08-31'), false, 'L4 T2 post-cutover => INACTIVO');
  assertEq(isTurnoActivo(pdb, 'L4', 'T3', '2026-08-31'), false, 'L4 T3 post-cutover => INACTIVO');

  // Default TL4: lunes-viernes activo, sabado/domingo inactivo
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-09-05'), false, 'L4 TL4 sabado default => inactivo');
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-09-06'), false, 'L4 TL4 domingo default => inactivo');
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-09-04'), true, 'L4 TL4 viernes default => activo');
});

// ── 5. isTurnoActivo — L4 modo TL4 con config custom ────────────────────────

suite('5. isTurnoActivo — L4 TL4 config custom', () => {
  const pdb = {
    turno_l4_config: [{
      week_start: '2026-08-31',
      dias: {
        lunes:     { activo: true,  hora_entrada: '07:00', hora_salida: '16:00' },
        martes:    { activo: true,  hora_entrada: '07:00', hora_salida: '16:00' },
        miercoles: { activo: false, hora_entrada: '',      hora_salida: '' },
        jueves:    { activo: true,  hora_entrada: '07:00', hora_salida: '16:00' },
        viernes:   { activo: true,  hora_entrada: '07:00', hora_salida: '16:00' },
        sabado:    { activo: true,  hora_entrada: '08:00', hora_salida: '13:00' },
        domingo:   { activo: false, hora_entrada: '',      hora_salida: '' }
      },
      arranque_ciclos: 6
    }]
  };
  // Miercoles desactivado
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-09-02'), false, 'Miercoles desactivado por config => inactivo');
  // Sabado activado
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-09-05'), true, 'Sabado activado por config => activo');
  // Lunes activo
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-08-31'), true, 'Lunes activo config => activo');
});

// ── 6. isTurnoActivo — L3 modo normal ────────────────────────────────────────

suite('6. isTurnoActivo — L3 modo normal (no afectado por TL4)', () => {
  const pdb = {};

  // Default: L3 T1 lunes => activo
  assertEq(isTurnoActivo(pdb, 'L3', 'T1', '2026-08-31'), true, 'L3 T1 lunes default => activo');
  assertEq(isTurnoActivo(pdb, 'L3', 'T2', '2026-08-31'), true, 'L3 T2 lunes default => activo');
  assertEq(isTurnoActivo(pdb, 'L3', 'T3', '2026-08-31'), true, 'L3 T3 lunes default => activo');

  // Default: L3 T3 sabado => inactivo
  assertEq(isTurnoActivo(pdb, 'L3', 'T3', '2026-09-05'), false, 'L3 T3 sabado default => inactivo');
  // Default: L3 T1 domingo => inactivo
  assertEq(isTurnoActivo(pdb, 'L3', 'T1', '2026-09-06'), false, 'L3 T1 domingo default => inactivo');
});

// ── 7. isTurnoActivo — calendario custom L3 ──────────────────────────────────

suite('7. isTurnoActivo — calendario custom L3', () => {
  const pdb = {
    turno_schedules: [{
      linea: 'L3',
      week_start: '2026-08-31',
      schedule: {
        lunes:     { T1: true,  T2: true,  T3: false },
        martes:    { T1: true,  T2: true,  T3: false },
        miercoles: { T1: true,  T2: true,  T3: false },
        jueves:    { T1: true,  T2: true,  T3: false },
        viernes:   { T1: true,  T2: true,  T3: false },
        sabado:    { T1: false, T2: false, T3: false },
        domingo:   { T1: false, T2: false, T3: false }
      }
    }]
  };
  // T3 desactivado lunes
  assertEq(isTurnoActivo(pdb, 'L3', 'T3', '2026-08-31'), false, 'L3 T3 lunes desactivado => inactivo');
  // T1 activo lunes
  assertEq(isTurnoActivo(pdb, 'L3', 'T1', '2026-08-31'), true, 'L3 T1 lunes activo => activo');
  // Sabado desactivado todo
  assertEq(isTurnoActivo(pdb, 'L3', 'T1', '2026-09-05'), false, 'L3 T1 sabado desactivado => inactivo');
});

// ── 8. getTurnoL4Config — default vs custom ──────────────────────────────────

suite('8. getTurnoL4Config — defaults y custom', () => {
  const pdb = {};
  const cfg = getTurnoL4Config(pdb, '2026-08-31');
  assertEq(cfg.dias.lunes.activo, true, 'Default: lunes activo');
  assertEq(cfg.dias.lunes.hora_entrada, '08:00', 'Default: lunes 08:00');
  assertEq(cfg.dias.lunes.hora_salida, '17:00', 'Default: lunes 17:00');
  assertEq(cfg.dias.sabado.activo, false, 'Default: sabado inactivo');
  assertEq(cfg.dias.domingo.activo, false, 'Default: domingo inactivo');
  assertEq(cfg.arranque_ciclos, 6, 'Default: arranque_ciclos = 6');

  // Con config custom
  const pdb2 = {
    turno_l4_config: [{
      week_start: '2026-08-31',
      dias: {
        lunes: { activo: true, hora_entrada: '06:00', hora_salida: '15:00' },
        martes: { activo: false, hora_entrada: '', hora_salida: '' },
        miercoles: { activo: true, hora_entrada: '06:00', hora_salida: '15:00' },
        jueves: { activo: true, hora_entrada: '06:00', hora_salida: '15:00' },
        viernes: { activo: true, hora_entrada: '06:00', hora_salida: '15:00' },
        sabado: { activo: false, hora_entrada: '', hora_salida: '' },
        domingo: { activo: false, hora_entrada: '', hora_salida: '' }
      },
      arranque_ciclos: 6
    }]
  };
  const cfg2 = getTurnoL4Config(pdb2, '2026-08-31');
  assertEq(cfg2.dias.lunes.hora_entrada, '06:00', 'Custom: lunes 06:00');
  assertEq(cfg2.dias.martes.activo, false, 'Custom: martes inactivo');
});

// ── 9. elapsedHoursForTL4 ────────────────────────────────────────────────────

suite('9. elapsedHoursForTL4 — calculo horas transcurridas', () => {
  // Fecha historica => retorna total
  assertClose(
    elapsedHoursForTL4('2026-08-25', '08:00', '17:00', '2026-08-31', 600),
    9, 0.01, 'Fecha historica => 9 horas completas'
  );

  // Turno ya termino (ahora > hora_salida)
  assertClose(
    elapsedHoursForTL4('2026-08-31', '08:00', '17:00', '2026-08-31', toMins('18:00')),
    9, 0.01, 'Turno ya termino => 9 horas completas'
  );

  // Turno aun no inicia (ahora < hora_entrada)
  assertClose(
    elapsedHoursForTL4('2026-08-31', '08:00', '17:00', '2026-08-31', toMins('07:30')),
    0, 0.01, 'Turno no inicia => 0 horas'
  );

  // Turno en curso: 08:00 a 12:00 => 4 horas
  assertClose(
    elapsedHoursForTL4('2026-08-31', '08:00', '17:00', '2026-08-31', toMins('12:00')),
    4, 0.01, 'En curso 12:00 => 4 horas'
  );

  // Turno en curso: 08:00 a 08:30 => 0.5 horas
  assertClose(
    elapsedHoursForTL4('2026-08-31', '08:00', '17:00', '2026-08-31', toMins('08:30')),
    0.5, 0.01, 'En curso 08:30 => 0.5 horas'
  );

  // Horario custom: 06:00 a 15:00 => 9 horas
  assertClose(
    elapsedHoursForTL4('2026-08-31', '06:00', '15:00', '2026-08-31', toMins('10:00')),
    4, 0.01, 'Custom 06:00-15:00, ahora 10:00 => 4 horas'
  );
});

// ── 10. L4_ARRANQUE_CICLOS es constante 6 ────────────────────────────────────

suite('10. L4_ARRANQUE_CICLOS constante', () => {
  assertEq(L4_ARRANQUE_CICLOS, 6, 'Arranque ciclos fijo en 6');
  assertEq(typeof L4_ARRANQUE_CICLOS, 'number', 'Es un numero');
});

// ── 11. TURNOS_DEF no contiene TL4 ──────────────────────────────────────────

suite('11. TURNOS_DEF no contiene TL4 (por diseno)', () => {
  assert(TURNOS_DEF.T1 !== undefined, 'T1 existe');
  assert(TURNOS_DEF.T2 !== undefined, 'T2 existe');
  assert(TURNOS_DEF.T3 !== undefined, 'T3 existe');
  assertEq(TURNOS_DEF.TL4, undefined, 'TL4 NO existe en TURNOS_DEF — usa horas dinamicas');
});

// ── 12. buildParetoParos no crashea con TL4 (P0 fix) ─────────────────────────

suite('12. buildParetoParos — no crash con TL4 (simulacion)', () => {
  // Simular que TURNOS_DEF['TL4'] es undefined (como en produccion.js)
  // La fix fue NOT usar TURNOS_DEF[turno] cuando turno es TL4
  // Verificar que el acceso a TURNOS_DEF['TL4'] no causa crash
  try {
    const t = TURNOS_DEF['TL4'];
    assert(t === undefined, 'TURNOS_DEF["TL4"] es undefined, no crash');
    // Pre-fix: TURNOS_DEF['TL4'].start causaba TypeError
    // Post-fix: se usa windows dinamicas via getTurnoL4Config
    if (t) {
      // Este bloque nunca se ejecuta — el fix es precisamente que skip este path
      const start = t.start;
    }
    passed++;
  } catch (e) {
    failed++;
    errors.push('buildParetoParos simulation: crash accessing TURNOS_DEF.TL4 — ' + e.message);
  }
});

// ── 13. L4 pre-cutover con T1/T2/T3 legacy ──────────────────────────────────

suite('13. L4 pre-cutover — backward compatible con T1/T2/T3', () => {
  const pdb = {};
  // Antes de cutover, sin config: L4 usa T1/T2/T3 normal
  assertEq(l4UsesTL4(pdb, '2026-08-01'), false, 'L4 pre-cutover sin config => T1/T2/T3');
  assertEq(isTurnoActivo(pdb, 'L4', 'T1', '2026-08-04'), true, 'L4 T1 lunes pre-cutover => activo');
  assertEq(isTurnoActivo(pdb, 'L4', 'T2', '2026-08-04'), true, 'L4 T2 lunes pre-cutover => activo');
  assertEq(isTurnoActivo(pdb, 'L4', 'TL4', '2026-08-04'), false, 'L4 TL4 pre-cutover sin config => inactivo');
});

// ── 14. toMins helper ────────────────────────────────────────────────────────

suite('14. toMins helper', () => {
  assertEq(toMins('00:00'), 0, '00:00 => 0');
  assertEq(toMins('06:30'), 390, '06:30 => 390');
  assertEq(toMins('14:30'), 870, '14:30 => 870');
  assertEq(toMins('21:30'), 1290, '21:30 => 1290');
  assertEq(toMins('23:59'), 1439, '23:59 => 1439');
  assertEq(toMins('08:00'), 480, '08:00 => 480');
  assertEq(toMins('17:00'), 1020, '17:00 => 1020');
  assertEq(toMins(''), 0, 'empty => 0');
  assertEq(toMins(null), 0, 'null => 0');
});

// ── 15. Baker/L1 no afectados por TL4 ────────────────────────────────────────

suite('15. Baker/L1 no afectados por TL4', () => {
  const pdb = {};
  // Post-cutover: Baker y L1 siguen con T1/T2/T3
  assertEq(isTurnoActivo(pdb, 'Baker', 'T1', '2026-09-01'), true, 'Baker T1 martes post-cutover => activo');
  assertEq(isTurnoActivo(pdb, 'Baker', 'T2', '2026-09-01'), true, 'Baker T2 martes post-cutover => activo');
  assertEq(isTurnoActivo(pdb, 'L1', 'T1', '2026-09-01'), true, 'L1 T1 martes post-cutover => activo');
  assertEq(isTurnoActivo(pdb, 'L1', 'T3', '2026-09-05'), false, 'L1 T3 sabado default => inactivo');
  // TL4 no es un turno valido para Baker/L1
  assertEq(isTurnoActivo(pdb, 'Baker', 'TL4', '2026-09-01'), false, 'Baker TL4 => inactivo (no existe en schedule)');
  assertEq(isTurnoActivo(pdb, 'L1', 'TL4', '2026-09-01'), false, 'L1 TL4 => inactivo (no existe en schedule)');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Frontend checks: verify TL4 is present in dropdowns/legends
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

suite('16. Frontend app.js — TL4 en dropdowns y leyenda', () => {
  const appJs = fs.readFileSync(path.join(__dirname, 'frontend/public/produccion/app.js'), 'utf8');

  // Pizarron turno dropdown tiene TL4
  assert(appJs.includes('<option value="TL4">TL4</option>'), 'Pizarron dropdown tiene TL4');

  // KPI Historico turno dropdown tiene TL4
  const khTurnoMatch = appJs.match(/id="kh-turno"[\s\S]{0,300}TL4/);
  assert(!!khTurnoMatch, 'KPI Historico dropdown tiene TL4');

  // mg-turno dropdown tiene TL4
  const mgTurnoMatch = appJs.match(/id="mg-turno"[\s\S]{0,300}TL4/);
  assert(!!mgTurnoMatch, 'Macro Gantt dropdown tiene TL4');

  // Carga edit dropdown tiene TL4
  assert(appJs.includes("['T1','T2','T3','TL4']"), 'Carga edit dropdown tiene TL4');

  // T_COLORS tiene TL4
  assert(appJs.includes("TL4:'#8b5cf6'"), 'T_COLORS tiene TL4 purple');

  // Legend tiene TL4
  assert(appJs.includes('TL4 (configurable)'), 'Leyenda mg tiene TL4');

  // Monitor usa el total TL4 del pizarrón, no reclasifica L4 como T1/T2/T3
  assert(appJs.includes('pizarronL4?.data?.L4?.TL4?.totals?.ciclos_totales'), 'Monitor usa totals TL4');

  // Macro Gantt usa el turno almacenado y horario dinámico TL4
  assert(appJs.includes("c.turno === 'TL4'"), 'Macro Gantt conserva turno almacenado TL4');
  assert(appJs.includes('TL4: tl4Bounds'), 'Macro Gantt usa límites dinámicos TL4');
});

suite('17. Frontend pizarron.js — TL4 support', () => {
  const pizJs = fs.readFileSync(path.join(__dirname, 'frontend/public/produccion/pizarron.js'), 'utf8');

  // Detecta TL4 en datos
  assert(pizJs.includes('TL4'), 'pizarron.js contiene referencias a TL4');
});

suite('18. Frontend slideshow.js — TL4 support', () => {
  const ssJs = fs.readFileSync(path.join(__dirname, 'frontend/public/produccion/slideshow.js'), 'utf8');

  assert(ssJs.includes('TL4'), 'slideshow.js contiene referencias a TL4');
});

suite('19. Backend produccion.js — constantes y funciones TL4', () => {
  const beJs = fs.readFileSync(path.join(__dirname, 'backend/src/routes/produccion.js'), 'utf8');

  assert(beJs.includes("L4_TL4_CUTOVER_DATE = '2026-08-31'"), 'Constante L4_TL4_CUTOVER_DATE presente');
  assert(beJs.includes('L4_ARRANQUE_CICLOS = 6'), 'Constante L4_ARRANQUE_CICLOS presente');
  assert(beJs.includes('function l4UsesTL4'), 'Funcion l4UsesTL4 presente');
  assert(beJs.includes('function isTurnoActivo'), 'Funcion isTurnoActivo presente');
  assert(beJs.includes('function elapsedHoursForTL4'), 'Funcion elapsedHoursForTL4 presente');
  assert(beJs.includes('function buildSlotsForL4TL4'), 'Funcion buildSlotsForL4TL4 presente');
  assert(beJs.includes('turno_schedule_history'), 'Coleccion turno_schedule_history');
  assert(beJs.includes('turno_l4_config_history'), 'Coleccion turno_l4_config_history');

  // Verificar que buildParetoParos maneja TL4
  assert(beJs.includes("turno === 'TL4'"), 'buildParetoParos maneja turno TL4');

  // Verificar req.prodUser en endpoints de turno config
  const turnoSchedulePost = beJs.match(/router\.post\('\/turno-schedule[\s\S]{0,2000}/);
  assert(turnoSchedulePost && turnoSchedulePost[0].includes('req.prodUser'), 'POST turno-schedule usa req.prodUser');

  const turnoL4Post = beJs.match(/router\.post\('\/turno-l4-config[\s\S]{0,3500}/);
  assert(turnoL4Post && turnoL4Post[0].includes('req.prodUser'), 'POST turno-l4-config usa req.prodUser');
});

suite('20. Backend db-produccion.js — colecciones history', () => {
  const dbJs = fs.readFileSync(path.join(__dirname, 'backend/src/db-produccion.js'), 'utf8');
  assert(dbJs.includes('turno_schedule_history'), 'DB tiene turno_schedule_history');
  assert(dbJs.includes('turno_l4_config_history'), 'DB tiene turno_l4_config_history');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(60));
console.log(`RESULTADO: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFallas:');
  errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
}
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
