/**
 * Backfill: sincroniza todas las incidencias 'aprobadas' existentes → rhh_attendance
 * Ejecutar UNA vez: node backfill_incidences_attendance.js
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'database/rhh.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

const INC_TO_ATT_STATUS = {
  falta:             'falta',
  vacacion:          'vacaciones',
  incapacidad:       'incapacidad',
  permiso:           'permiso',
  permiso_con_goce:  'permiso',
  permiso_sin_goce:  'permiso',
  retardo:           'retardo',
  cumpleanos:        'cumpleanos',
};

function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(a => a.id || 0)) + 1;
}

if (!db.rhh_attendance) db.rhh_attendance = [];

const approved = (db.rhh_incidences || []).filter(i => i.status === 'aprobada');
console.log(`Incidencias aprobadas encontradas: ${approved.length}`);

let created = 0, updated = 0, skipped = 0;

for (const inc of approved) {
  const attStatus   = INC_TO_ATT_STATUS[inc.type];
  const isTiempoExtra = inc.type === 'tiempo_extra';
  if (!attStatus && !isTiempoExtra) { skipped++; continue; }

  const cur = new Date(inc.date + 'T12:00:00');
  const end = new Date((inc.date_end || inc.date) + 'T12:00:00');

  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    const idx = db.rhh_attendance.findIndex(
      a => a.employee_id === inc.employee_id && a.date === dateStr
    );

    if (isTiempoExtra) {
      if (idx !== -1) {
        db.rhh_attendance[idx].te_hours = inc.hours || 0;
        db.rhh_attendance[idx].updated_at = new Date().toISOString();
        updated++;
      }
    } else {
      const now = new Date().toISOString();
      if (idx !== -1) {
        // Solo sobreescribir si no tiene incidence_id ya (no queremos pisar otro backfill)
        if (!db.rhh_attendance[idx].incidence_id) {
          db.rhh_attendance[idx].status = attStatus;
          db.rhh_attendance[idx].incidence_id = inc.id;
          db.rhh_attendance[idx].updated_at = now;
          updated++;
        }
      } else {
        db.rhh_attendance.push({
          id: nextId(db.rhh_attendance),
          employee_id: inc.employee_id,
          date: dateStr,
          status: attStatus,
          te_hours: 0,
          incidence_id: inc.id,
          notes: inc.notes || null,
          cost_center: null,
          project_id: null,
          created_at: now,
          updated_at: now,
        });
        created++;
      }
    }

    cur.setDate(cur.getDate() + 1);
  }
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`✅ Backfill completado:`);
console.log(`   Registros creados:      ${created}`);
console.log(`   Registros actualizados: ${updated}`);
console.log(`   Tipos sin mapeo (skip): ${skipped}`);
console.log(`   Total en rhh_attendance: ${db.rhh_attendance.length}`);
