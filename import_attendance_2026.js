/**
 * Importa semanas 01-13 de 2026 al rhh.json
 * Usa número ISO de semana (no el título del Excel que tiene años erróneos)
 */
const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const DB_PATH    = path.resolve(__dirname, 'database/rhh.json');
const MAIN_EXCEL = 'C:/Users/proye/OneDrive 2026/OneDrive - Corporativo Cuesto, S de RL de CV/Cuesto Dropbox/Informacion Cuesto/RRHH/Asistencia y Roles/LISTA DE ASISTENCIA SEMANAL.xlsx';
const S12_EXCEL  = path.resolve(__dirname, 'lista asistencia semana 12.xlsx');

// ── Cálculo ISO de lunes de una semana ────────────────────────────────────────
function getWeekMonday(year, weekNum) {
  const jan4 = new Date(year, 0, 4);
  const startW1 = new Date(jan4);
  startW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const monday = new Date(startW1);
  monday.setDate(startW1.getDate() + (weekNum - 1) * 7);
  const y = monday.getFullYear();
  const m = String(monday.getMonth()+1).padStart(2,'0');
  const d = String(monday.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

// ── Mapeo de status ────────────────────────────────────────────────────────────
const STATUS_MAP = {
  'labora':'labora','falta':'falta','descanso':'descanso','festivo':'festivo',
  'incapacidad':'incapacidad','vacaciones':'vacaciones','permiso':'permiso',
  'retardo':'retardo','cumpleaños':'cumpleanos','cumpleanos':'cumpleanos',
  't3':'labora','turno 3':'labora','t3/festivo':'festivo','t3 festivo':'festivo',
  'retardo/labora':'retardo','retardo labora':'retardo',
  'labora/retardo':'retardo','permiso/retardo':'retardo',
  'dia de descanso laborado':'labora',
};

function mapStatus(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === ' ') return null;
  if (STATUS_MAP[s] !== undefined) return STATUS_MAP[s];
  // Coincidencia parcial
  if (s.includes('labora')) return 'labora';
  if (s.includes('falta'))  return 'falta';
  if (s.includes('descanso')) return 'descanso';
  if (s.includes('festivo')) return 'festivo';
  if (s.includes('incapacidad')) return 'incapacidad';
  if (s.includes('vacacion')) return 'vacaciones';
  if (s.includes('permiso')) return 'permiso';
  if (s.includes('retardo')) return 'retardo';
  return null; // desconocido → saltar
}

// ── Mapeos manuales (typos o nombres cortos en el Excel) ─────────────────────
const MANUAL_MATCHES = {
  'andrea domignuez carreon':           'Andrea Dominguez Carreón',      // typo "domignuez"
  'gael hernandez campos':              'Gael Isaí Hernandez',           // apellido diferente en DB
  'isabel':                             'Maria isabel Velazquez',        // nombre corto
  'jonathan alejandro duenas sandoval': 'Jonathan Alejandro Garcia Mora',// mismo nombre, apellido diferente
  'brayan fernando':                    'Brayan Garcia Peralta',         // nombre incompleto
  'brayan fernando romero':             'Brayan Garcia Peralta',         // apellido diferente
  'miguel angel hernandez cervantes':   'Miguel Angel Villanueva Ortiz', // mismo nombre, apellido diferente
};

// ── Normalización y matching de nombres ───────────────────────────────────────
function normName(n) {
  return String(n||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z\s]/g,'').replace(/\s+/g,' ').trim();
}

function findEmployee(excelName, employees) {
  const en = normName(excelName);
  if (!en) return null;
  // 0. Mapeo manual
  if (MANUAL_MATCHES[en]) {
    return employees.find(e => e.full_name === MANUAL_MATCHES[en]) || null;
  }
  // 1. Coincidencia exacta normalizada
  let found = employees.find(e => normName(e.full_name) === en);
  if (found) return found;
  // 2. Todas las palabras del Excel están en el nombre del DB (≥3 chars)
  const words = en.split(' ').filter(w => w.length >= 3);
  if (words.length >= 2) {
    found = employees.find(e => {
      const dn = normName(e.full_name);
      return words.every(w => dn.includes(w));
    });
    if (found) return found;
  }
  // 3. Palabras del DB en el nombre del Excel (útil si Excel tiene nombre abreviado)
  found = employees.find(e => {
    const dbWords = normName(e.full_name).split(' ').filter(w => w.length >= 4);
    if (dbWords.length < 2) return false;
    return dbWords.every(w => en.includes(w));
  });
  return found || null;
}

// ── Columnas de días ───────────────────────────────────────────────────────────
const DAY_COLS = [
  { status:6,  te:8  }, // Lunes
  { status:10, te:12 }, // Martes
  { status:14, te:16 }, // Miércoles
  { status:18, te:20 }, // Jueves
  { status:22, te:24 }, // Viernes
  { status:26, te:28 }, // Sábado
  { status:30, te:32 }, // Domingo
];

function parseSheet(ws, weekStart) {
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
  if (!rows || rows.length < 5) return [];
  const empRows = rows.filter(r => typeof r[0] === 'number' && r[0] > 0 && r[1]);
  const records = [];
  for (const row of empRows) {
    const excelName = String(row[1]||'').trim();
    if (!excelName) continue;
    for (let di = 0; di < 7; di++) {
      const date     = addDays(weekStart, di);
      const rawSt    = row[DAY_COLS[di].status];
      const rawTE    = row[DAY_COLS[di].te];
      const status   = mapStatus(rawSt);
      if (!status) continue;
      const teHours  = (rawTE !== '' && !isNaN(Number(rawTE))) ? Number(rawTE) : 0;
      records.push({ excelName, date, status, te_hours: teHours });
    }
  }
  return records;
}

// ── Cargar DB ──────────────────────────────────────────────────────────────────
const db        = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const employees = (db.rhh_employees||[]).filter(e => e.status === 'active');

// Limpiar registros previos de 2025/2026 que puedan tener fechas incorrectas
// (solo borra los del rango 2025-01-01 a 2026-03-22 para reimportar limpio)
const CLEAR_FROM = '2025-01-01';
const CLEAR_TO   = '2026-03-29'; // cubre hasta fin de semana 13
const preserved  = (db.rhh_attendance||[]).filter(a => a.date < CLEAR_FROM || a.date > CLEAR_TO);
const cleared    = (db.rhh_attendance||[]).length - preserved.length;
db.rhh_attendance = preserved;
console.log(`🗑  Limpiados ${cleared} registros previos del rango (se reimportarán limpios)`);

// ── Contadores ─────────────────────────────────────────────────────────────────
let totalInserted = 0;
const unmatched   = new Map(); // name → count
const incCount    = {};
const weekSummary = [];

function upsert(empId, date, status, teHours) {
  const idx = db.rhh_attendance.findIndex(a => a.employee_id === empId && a.date === date);
  const entry = { employee_id: empId, date, status, te_hours: teHours,
                  notes: null, cost_center: null, project_id: null,
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (idx !== -1) {
    db.rhh_attendance[idx] = { ...db.rhh_attendance[idx], ...entry };
  } else {
    db.rhh_attendance.push(entry);
    totalInserted++;
  }
  incCount[status] = (incCount[status]||0) + 1;
}

function processRecords(records, label) {
  let matched = 0, skipped = 0;
  for (const rec of records) {
    const emp = findEmployee(rec.excelName, employees);
    if (!emp) {
      unmatched.set(rec.excelName, (unmatched.get(rec.excelName)||0) + 1);
      skipped++;
    } else {
      upsert(emp.id, rec.date, rec.status, rec.te_hours);
      matched++;
    }
  }
  weekSummary.push({ label, total: records.length, matched, skipped });
}

// ── Nombres exactos de hojas por semana ───────────────────────────────────────
// Semanas 01-08 usan el formato "SEMANA XX - 2026"; semanas 09-13 van sin año
const SHEETS_2026 = [
  { name:'SEMANA 01 - 2026',   week:1  },
  { name:'SEMANA 02 - 2026',   week:2  },
  { name:'SEMANA 03 - 2026',   week:3  },
  { name:'SEMANA 04 - 2026',   week:4  },
  { name:'SEMANA 05 - 2026',   week:5  },
  { name:'SEMANA 06 - 2026',   week:6  },
  { name:'SEMANA 07 - 2026 ',  week:7  },
  { name:'SEMANA 08 - 2026 ',  week:8  },
  { name:'SEMANA 09 ',         week:9  }, // trailing space en el Excel
  { name:'SEMANA 10',          week:10 },
  { name:'SEMANA 11',          week:11 },
  { name:'SEMANA 12',          week:12 },
  { name:'SEMANA 13',          week:13 },
];

// Rastrear nombres del Excel en semanas recientes (09-13) para detectar bajas
const recentExcelNames = new Set(); // empleados vistos en semanas 09-13

console.log('\n📂 LISTA DE ASISTENCIA SEMANAL.xlsx');
for (const { name, week } of SHEETS_2026) {
  const weekStart = getWeekMonday(2026, week);
  process.stdout.write(`  Semana ${String(week).padStart(2,'0')} (${weekStart})... `);
  try {
    const wb = XLSX.readFile(MAIN_EXCEL, { sheets: name, sheetRows: 200 });
    const ws = wb.Sheets[name];
    if (!ws) { console.log('NO ENCONTRADA'); continue; }
    const records = parseSheet(ws, weekStart);
    // Registrar nombres de semanas recientes para detección de bajas
    if (week >= 9) {
      for (const r of records) recentExcelNames.add(normName(r.excelName));
    }
    processRecords(records, `S${String(week).padStart(2,'0')} ${weekStart}`);
    console.log(`${records.length} registros`);
  } catch(e) { console.log('ERROR: '+e.message); }
}

// ── Detectar y marcar bajas ────────────────────────────────────────────────────
// Un empleado activo que NO apareció en ninguna de las semanas 09-13 del Excel
// se considera baja (confirmado por el usuario).
const bajas = [];
for (const emp of employees) {
  const empNorm = normName(emp.full_name);
  // Verificar match directo o por MANUAL_MATCHES inverso
  const appearsInRecent = recentExcelNames.has(empNorm)
    || Object.entries(MANUAL_MATCHES).some(([excelNorm, dbName]) =>
        dbName === emp.full_name && recentExcelNames.has(excelNorm)
      )
    || [...recentExcelNames].some(rn => {
        // misma lógica de findEmployee: palabras del DB en el nombre reciente
        const dbWords = empNorm.split(' ').filter(w => w.length >= 3);
        return dbWords.length >= 2 && dbWords.every(w => rn.includes(w));
      });

  if (!appearsInRecent) {
    bajas.push(emp);
    // Marcar como inactivo
    const idx = db.rhh_employees.findIndex(e => e.id === emp.id);
    if (idx !== -1) {
      db.rhh_employees[idx].status = 'inactive';
      db.rhh_employees[idx].termination_date = db.rhh_employees[idx].termination_date || '2026-03-23';
      db.rhh_employees[idx].updated_at = new Date().toISOString();
    }
  }
}

// ── Re-asignar IDs ─────────────────────────────────────────────────────────────
db.rhh_attendance = db.rhh_attendance.map((a,i) => ({ ...a, id: i+1 }));

// ── Guardar ────────────────────────────────────────────────────────────────────
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// ── Reporte final ──────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('✅  IMPORTACIÓN COMPLETADA');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`   Total registros en DB: ${db.rhh_attendance.length}`);

console.log('\n📅 DETALLE POR SEMANA:');
console.log('   Semana       | Lunes inicio | Excel | Importados | Omitidos');
console.log('   -------------|--------------|-------|------------|----------');
for (const s of weekSummary) {
  console.log(`   ${s.label.padEnd(13)}|              | ${String(s.total).padStart(5)} | ${String(s.matched).padStart(10)} | ${s.skipped}`);
}

console.log('\n📊 INCIDENCIAS (semanas 01-13 de 2026):');
console.log('   ─────────────────────────────────');
const sortedInc = Object.entries(incCount).sort((a,b)=>b[1]-a[1]);
let grandTotal = 0;
for (const [st, cnt] of sortedInc) {
  console.log(`   ${String(st).padEnd(15)}: ${String(cnt).padStart(5)}`);
  grandTotal += cnt;
}
console.log(`   ${'─'.repeat(25)}`);
console.log(`   ${'TOTAL'.padEnd(15)}: ${String(grandTotal).padStart(5)}`);

// Semanas con datos
const semanas = {};
for (const a of db.rhh_attendance) {
  const d = new Date(a.date + 'T12:00:00');
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const ws = mon.toISOString().slice(0,10);
  semanas[ws] = (semanas[ws]||0) + 1;
}
console.log('\n📅 SEMANAS EN BASE DE DATOS:');
for (const [ws, cnt] of Object.entries(semanas).sort()) {
  const bar = '█'.repeat(Math.round(cnt/20));
  console.log(`   ${ws}  ${String(cnt).padStart(4)} registros  ${bar}`);
}

if (unmatched.size > 0) {
  console.log(`\n⚠  EMPLEADOS DEL EXCEL SIN MATCH EN DB (${unmatched.size}):`);
  console.log('   (sus registros NO fueron importados)');
  for (const [name, cnt] of [...unmatched.entries()].sort()) {
    console.log(`   - "${name}"  (${cnt} registros omitidos)`);
  }
  console.log('\n   → Revisa si estos empleados existen en el sistema con nombre diferente');
  console.log('     o si deben ser dados de alta.');
}

if (bajas.length > 0) {
  console.log(`\n🔴 EMPLEADOS MARCADOS COMO BAJA (${bajas.length}):`);
  console.log('   (no aparecieron en ninguna de las semanas 09-13)');
  for (const e of bajas) {
    console.log(`   - [${e.id}] ${e.full_name}`);
  }
  console.log('\n   → Se marcaron como status=inactive con termination_date=2026-03-23');
  console.log('     Si alguno fue error, edítalos manualmente en el sistema.');
}

console.log('\n✔ rhh.json actualizado.');
