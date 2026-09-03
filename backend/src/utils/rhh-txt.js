function getTxtPendingHours(db, employeeId) {
  return (db.rhh_txt_deudas || [])
    .filter(d => Number(d.employee_id) === Number(employeeId) && d.status === 'pendiente_pago')
    .reduce((sum, d) => sum + (Number(d.horas_pendientes) || 0), 0);
}

function assertNoTxtDebt(db, employeeId) {
  const pendingHours = getTxtPendingHours(db, employeeId);
  return pendingHours > 0
    ? { ok: false, pendingHours, error: `No puede registrar tiempo extra: debe ${pendingHours} h de Tiempo por Tiempo` }
    : { ok: true, pendingHours: 0 };
}

module.exports = { getTxtPendingHours, assertNoTxtDebt };
