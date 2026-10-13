'use strict';

const LINEAS = ['Baker', 'L1', 'L3', 'L4'];
const CLIENTES = ['SKF', 'Amsted', 'Tenneco'];
const clone = value => JSON.parse(JSON.stringify(value));
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
function shiftDate(value, days) {
  if (!validDate(value)) throw new Error('Fecha invalida');
  const d = new Date(value + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function calendarWeek(fecha) {
  const day = new Date(fecha + 'T12:00:00Z').getUTCDay();
  const inicio = shiftDate(fecha, day === 0 ? -6 : 1 - day);
  return { inicio, fin: shiftDate(inicio, 6) };
}
function period(fecha, tipo = 'semana') {
  if (!validDate(fecha)) throw new Error('Fecha invalida');
  if (!['dia', 'semana', 'mes'].includes(tipo)) throw new Error('Periodo invalido');
  const d = new Date(fecha + 'T12:00:00Z');
  const day = d.getUTCDay();
  const inicio = tipo === 'mes' ? fecha.slice(0, 7) + '-01' : tipo === 'dia' ? fecha : shiftDate(fecha, day === 0 ? -6 : day === 1 ? -7 : 1 - day);
  const fin = tipo === 'mes' ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10) : tipo === 'dia' ? fecha : shiftDate(inicio, 6);
  const dias = [];
  for (let f = inicio; f <= fin; f = shiftDate(f, 1)) dias.push(f);
  return { tipo, inicio, fin, dias };
}
function effectiveStatus(act, fecha) {
  if (['sin_empezar', 'en_proceso', 'atrasada'].includes(act.estatus)) {
    if (act.fecha_compromiso && act.fecha_compromiso < fecha) return 'atrasada';
    if (act.estatus === 'atrasada') return act.fecha_inicio ? 'en_proceso' : 'sin_empezar';
  }
  return act.estatus;
}
function activityView(act, fecha) {
  return { ...act, estatus: effectiveStatus(act, fecha), sub_actividades: (act.sub_actividades || []).map(s => ({ ...s, estatus: effectiveStatus(s, fecha) })) };
}
function formOf(act) {
  return act.correlacion_daily?.formulario || (act.origen_formulario === '8d' ? '8ds_abiertos' : act.origen_formulario) || null;
}
function eligibleUsers(planner, compras) {
  const ids = new Set((planner.asignaciones || []).filter(a => ['admin', 'staff'].includes(a.planner_role)).map(a => Number(a.usuario_id)));
  return (compras.users || []).filter(u => u.active !== false && u.role_code !== 'proveedor' && ids.has(Number(u.id)));
}
function assignmentError(body, planner, compras) {
  const ids = new Set(eligibleUsers(planner, compras).map(u => Number(u.id)));
  if (body.responsable_id !== undefined && !ids.has(Number(body.responsable_id))) return 'Selecciona un responsable activo con acceso staff/admin al Planner';
  if (body.colaboradores !== undefined && (!Array.isArray(body.colaboradores) || body.colaboradores.length > 10 || body.colaboradores.some(id => !ids.has(Number(id))))) return 'Los colaboradores deben ser staff/admin activos del Planner (maximo 10)';
  return null;
}
function mentionMail(texto, act, users) {
  const ids = new Set([...String(texto).matchAll(/@\[[^\]]+\]\((\d+)\)/g)].map(m => Number(m[1])));
  const emails = [...new Set(users.filter(u => ids.has(Number(u.id)) && u.email).map(u => u.email))];
  if (!emails.length) return null;
  return 'mailto:' + encodeURIComponent(emails.join(';')) + '?subject=' + encodeURIComponent('[CUESTO Planner] Mencion en ' + act.id) + '&body=' + encodeURIComponent(act.titulo + '\n\n' + texto);
}
function revision(reg) {
  const { revisiones, ...saved } = reg;
  return clone(saved);
}
function dailySuggestions(registros, depto, form, fecha) {
  if (depto !== 'rhh' || !['incapacidades', 'personal_capacitacion'].includes(form)) return null;
  const previous = registros.filter(r => r.departamento === depto && r.formulario === form && r.fecha < fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (!previous) return null;
  return { registros: (previous.datos?.registros || []).filter(r => (!r.fecha_inicio || r.fecha_inicio <= fecha) && (!r.fecha_fin || r.fecha_fin >= fecha)).map(clone), comentarios: '' };
}
function plantilla(rhh) {
  const empleados = (rhh.rhh_employees || []).filter(e => e.status === 'active');
  const puestos = (rhh.rhh_positions || []).map(p => {
    const actual = empleados.filter(e => e.position_id === p.id).length;
    const requerido = Number(p.headcount_requerido) || 0;
    return { id: p.id, puesto: p.name, departamento: (rhh.rhh_departments || []).find(d => d.id === p.department_id)?.name || '', requerido, actual, porcentaje: requerido > 0 ? Math.round(actual / requerido * 100) : null, vacantes_abiertas: Math.max(0, requerido - actual) };
  });
  const total_requerido = puestos.reduce((s, p) => s + p.requerido, 0);
  const total_actual = puestos.reduce((s, p) => s + p.actual, 0);
  const vacantes = (rhh.rhh_vacancies || []).filter(v => ['open', 'in_process'].includes(v.status)).map(v => ({ id: v.id, puesto: puestos.find(p => p.id === v.position_id)?.puesto || '', fecha_apertura: v.opened_date || null, prioridad: v.priority || 'media', status: v.status }));
  return { puestos, vacantes, vacantes_no_cubiertas: puestos.filter(p => p.vacantes_abiertas > 0), resumen: { total_requerido, total_actual, porcentaje_global: total_requerido > 0 ? Math.round(total_actual / total_requerido * 100) : null, vacantes_abiertas: puestos.reduce((s, p) => s + p.vacantes_abiertas, 0) } };
}
function reprocesos(registros, fecha) {
  const datos = registros.find(r => r.departamento === 'calidad' && r.formulario === 'rechazos_internos' && r.fecha === fecha)?.datos || {};
  const piezas = registros.find(r => r.departamento === 'produccion' && r.formulario === 'piezas_procesadas' && r.fecha === fecha)?.datos || {};
  const detalle = {};
  for (const l of LINEAS) {
    const procesadas = datos[l]?.procesadas ?? piezas[l]?.procesadas ?? null;
    const rechazadas = datos[l]?.rechazadas ?? null;
    detalle[l] = { procesadas, rechazadas, porcentaje: procesadas > 0 && rechazadas != null ? Math.round(rechazadas / procesadas * 10000) / 100 : null };
  }
  return detalle;
}
function piecesSummary(registros, fecha) {
  const semana = calendarWeek(fecha);
  const dias = Array.from({length: 7}, (_, i) => shiftDate(semana.inicio, i));
  const rows = registros.filter(r => r.departamento === 'produccion' && r.formulario === 'piezas_procesadas' && r.fecha >= semana.inicio && r.fecha <= semana.fin);
  const clientes = Object.fromEntries(CLIENTES.map(cliente => {
    const diario = dias.map(dia => {
      const value = rows.find(r => r.fecha === dia)?.datos?.clientes?.[cliente]?.procesadas;
      return { fecha: dia, piezas: value == null || value === '' ? null : Number(value) };
    });
    const capturados = diario.filter(d => d.fecha <= fecha && d.piezas != null);
    return [cliente, { diario, dia: diario.find(d => d.fecha === fecha).piezas, acumulado: capturados.length ? capturados.reduce((sum, d) => sum + d.piezas, 0) : null, dias_capturados: capturados.length }];
  }));
  return { ...semana, hasta: fecha, clientes };
}
function scrapSummary(registros, fecha) {
  const semana = calendarWeek(fecha);
  const diario = Array.from({ length: 7 }, (_, i) => {
    const dia = shiftDate(semana.inicio, i);
    const value = registros.find(r => r.departamento === 'smya' && r.formulario === 'scrap' && r.fecha === dia)?.datos?.cantidad_piezas;
    const piezas = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { fecha: dia, piezas };
  });
  let suma = 0, capturados = 0;
  for (const dia of diario) {
    if (dia.piezas != null) { suma += dia.piezas; capturados++; }
    dia.acumulado = capturados ? suma : null;
  }
  const registrados = diario.filter(d => d.fecha <= fecha && d.piezas != null);
  return { ...semana, hasta: fecha, unidad: 'piezas', diario, dia: diario.find(d => d.fecha === fecha).piezas,
    acumulado: registrados.length ? registrados.reduce((sum,d) => sum + d.piezas, 0) : null, dias_capturados: registrados.length };
}
function purchaseActivityAttention(act, fecha) {
  return !['cerrada','cancelada'].includes(act.estatus) && (act.urgencia === 'alta' || (validDate(act.fecha_compromiso) && act.fecha_compromiso < fecha));
}
function purchasesAttention(db, fecha) {
  const terminal = value => /^(cerrad[oa]|cancelad[oa]|rechazad[oa]|entregad[oa]|completad[oa]|facturad[oa]|facturación parcial|pago parcial|pagad[oa]|borrador)$/i.test(value || '');
  const reqs=new Map((db.requisitions||[]).map(r=>[r.id,r])), pos=new Map((db.purchase_orders||[]).map(p=>[p.id,p]));
  const lines=new Map();
  for(const line of db.purchase_order_items||[]) {
    const po=pos.get(line.purchase_order_id);
    if (!po) continue;
    const previous = lines.get(line.requisition_item_id);
    if (!previous || (!terminal(po.status) && !terminal(line.status))) lines.set(line.requisition_item_id,line);
  }
  const groups={}, items=[];
  for(const ri of db.requisition_items||[]) {
    const req=reqs.get(ri.requisition_id)||{}, line=lines.get(ri.id);
    const po=pos.get(line?.purchase_order_id || ri.purchase_order_id);
    if(terminal(ri.status)||terminal(req.status)||terminal(po?.status)) continue;
    const fecha_compromiso=validDate(po?.supplier_commitment_date) ? po.supplier_commitment_date : validDate(req.programmed_date) ? req.programmed_date : null;
    const vencida=!!fecha_compromiso && fecha_compromiso < fecha;
    const urgente=String(req.urgency||'').trim().toLowerCase()==='alto';
    if(!vencida && !urgente)continue;
    const row={id:ri.id,descripcion:(db.catalog_items||[]).find(c=>c.id===ri.catalog_item_id)?.name || ri.manual_item_name || 'Item #'+ri.id,
      cantidad:ri.quantity,unidad:ri.unit||'pz',po_id:po?.id||null,po_folio:po?.folio||null,po_status:po?.status||null,
      proveedor:(db.suppliers||[]).find(p=>p.id===(po?.supplier_id||ri.supplier_id))?.business_name||'',
      fecha_compromiso,urgente,vencida,estatus:ri.status||'Sin estado'};
    items.push(row);
    const group=groups[row.estatus] ||= {count:0,items:[]};group.count++;group.items.push(row);
  }
  return {fecha,criterio:'vencidas_o_urgentes',por_estatus:groups,total_items:items.length,
    pos_activas:new Set(items.map(i=>i.po_id).filter(Boolean)).size,vencidas:items.filter(i=>i.vencida).length,urgentes:items.filter(i=>i.urgente).length};
}
module.exports = { purchasesAttention, purchaseActivityAttention, scrapSummary, piecesSummary, calendarWeek, LINEAS, CLIENTES, clone, validDate, shiftDate, period, effectiveStatus, activityView, formOf, eligibleUsers, assignmentError, mentionMail, revision, dailySuggestions, plantilla, reprocesos };
