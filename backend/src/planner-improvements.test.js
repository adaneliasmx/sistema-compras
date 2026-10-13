'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const rules = require('./planner-rules');
const { loadPlanner } = require('./planner-test-harness');
const api = '/api/planner';
const task = extra => ({ id: 'ACT-0001', titulo: 'Prueba', departamento: 'produccion', responsable_id: 1, estatus: 'en_proceso', fecha_compromiso: '2026-10-10', sub_actividades: [], ...extra });

test('piezas: semana calendario, acumulado hasta fecha y ausencia distinta de cero', async () => {
  const h = loadPlanner();
  h.planner.daily_registros = [['2026-10-11', 999], ['2026-10-12', 12000], ['2026-10-13', 0], ['2026-10-14', 3000], ['2026-10-18', 5000]].map(([fecha, piezas]) => ({ departamento: 'produccion', formulario: 'piezas_procesadas', fecha, datos: { clientes: { SKF: { procesadas: piezas } } } }));
  const r = await request(h.app).get(api + '/dashboard/produccion?fecha=2026-10-14').expect(200);
  assert.equal(r.body.piezas_semana.inicio, '2026-10-12');
  assert.equal(r.body.piezas_semana.fin, '2026-10-18');
  assert.equal(r.body.piezas_semana.clientes.SKF.dia, 3000);
  assert.equal(r.body.piezas_semana.clientes.SKF.acumulado, 15000);
  assert.equal(r.body.piezas_semana.clientes.SKF.dias_capturados, 3);
  assert.equal(r.body.piezas_semana.clientes.Amsted.acumulado, null);
  assert.equal(rules.piecesSummary(h.planner.daily_registros, '2026-10-12').clientes.SKF.acumulado, 12000);
  assert.equal(rules.piecesSummary(h.planner.daily_registros, '2026-10-18').clientes.SKF.acumulado, 20000);
});

test('slides: abiertas excluyen cerradas y canceladas e incluyen pospuestas', async () => {
  const h = loadPlanner();
  h.planner.actividades = ['sin_empezar','en_proceso','pospuesta','atrasada','cerrada','cancelada'].map((estatus, i) => task({ id: String(i), estatus }));
  const r = await request(h.app).get(api + '/dashboard/produccion?fecha=2026-10-12').expect(200);
  assert.equal(r.body.actividades.total, 4);
  const visible = [...r.body.actividades.atrasadas, ...r.body.actividades.pendientes];
  assert.equal(visible.length, 4);
  assert.ok(visible.every(a => !['cerrada','cancelada'].includes(a.estatus)));
});

test('periodos: lunes anterior, martes actual, domingo y mes bisiesto', () => {
  assert.equal(rules.period('2026-10-12').inicio, '2026-10-05');
  assert.equal(rules.period('2026-10-13').inicio, '2026-10-12');
  assert.equal(rules.period('2026-10-18').fin, '2026-10-18');
  assert.equal(rules.period('2024-02-12', 'mes').dias.length, 29);
  assert.deepEqual(rules.period('2026-10-12', 'dia').dias, ['2026-10-12']);
  assert.throws(() => rules.period('2026-02-30'));
});
test('dashboard usa fecha elegida y ofrece mes sin datos de otras fechas', async () => {
  const h = loadPlanner();
  h.planner.daily_registros.push({ id: 'DLY-0001', departamento: 'produccion', formulario: 'piezas_procesadas', fecha: '2026-09-10', datos: { clientes: { SKF: { procesadas: 150 } } } });
  const r = await request(h.app).get(api + '/dashboard/produccion/semanal?fecha=2026-09-14').expect(200);
  assert.equal(r.body.semana.inicio, '2026-09-07');
  assert.equal(r.body.integracion.objetivos.L3.eficiencia, 91);
  assert.equal(r.body.integracion.piezas_por_cliente.find(d => d.fecha === '2026-09-10').SKF, 150);
  const m = await request(h.app).get(api + '/dashboard/produccion/semanal?fecha=2026-09-14&periodo=mes').expect(200);
  assert.equal(m.body.semana.dias.length, 30);
  assert.equal(m.body.historico.length, 1);
});
test('solo usuarios activos asignados son responsables; admin sigue pudiendo agregar equipo', async () => {
  const h = loadPlanner();
  const r = await request(h.app).get(api + '/staff/disponibles').expect(200);
  assert.deepEqual(r.body.map(u => u.id), [1, 2]);
  const all = await request(h.app).get(api + '/staff/disponibles?todos=1').expect(200);
  assert.equal(all.body.length, 3);
  await request(h.app).get(api + '/staff/disponibles?todos=1').set('x-user','2').expect(403);
  await request(h.app).post(api + '/actividades').send({ titulo: 'Invalida', departamento: 'produccion', responsable_id: 3 }).expect(400);
  assert.equal(h.planner.actividades.length, 0);
});
test('edicion invalida no cambia titulo ni colaboradores antes de rechazar', async () => {
  const h = loadPlanner(); h.planner.actividades.push(task({}));
  await request(h.app).patch(api + '/actividades/ACT-0001').send({ titulo: 'No guardar', responsable_id: 3 }).expect(400);
  await request(h.app).patch(api + '/actividades/ACT-0001').send({ titulo: 'No guardar', colaboradores: [3] }).expect(400);
  assert.equal(h.planner.actividades[0].titulo, 'Prueba'); assert.equal(h.writes(), 0);
});
test('vinculos Daily y estados vencidos se conservan en slides sin mutar GET', async () => {
  const h = loadPlanner(); h.planner.actividades.push(task({ correlacion_daily: { formulario: 'material_pendiente', departamento: 'produccion' } }));
  const original = JSON.stringify(h.planner);
  const r = await request(h.app).get(api + '/dashboard/produccion?fecha=2026-10-12').expect(200);
  assert.equal(r.body.actividades.atrasadas[0].origen_formulario, 'material_pendiente');
  assert.equal(r.body.actividades.atrasadas[0].estatus, 'atrasada');
  assert.equal(JSON.stringify(h.planner), original); assert.equal(h.writes(), 0);
});
test('Daily conserva versiones y rechaza guardado de una version desactualizada', async () => {
  const h = loadPlanner(); const url = api + '/daily/produccion/material_pendiente';
  await request(h.app).post(url).send({ fecha: '2026-10-12', version: 0, datos: { items: [{ numero_parte: 'P1' }] } }).expect(201);
  await request(h.app).post(url).send({ fecha: '2026-10-12', version: 1, datos: { sin_novedad: true, comentarios: 'Sin pendientes' } }).expect(200);
  await request(h.app).post(url).send({ fecha: '2026-10-12', version: 1, datos: { comentarios: 'Otra captura' } }).expect(409);
  const reg = h.planner.daily_registros[0]; assert.equal(reg.version, 2); assert.equal(reg.revisiones[0].datos.items[0].numero_parte, 'P1'); assert.equal(reg.datos.comentarios, 'Sin pendientes');
});
test('revisar no declara sin pendientes si hay tareas abiertas', async () => {
  const h = loadPlanner(); h.planner.actividades.push(task({ departamento: 'sgc', origen_formulario: 'documentos_pendientes' }));
  const r = await request(h.app).post(api + '/daily/sgc/documentos_pendientes').send({ fecha: '2026-10-12', datos: { sin_novedad: true } }).expect(201);
  assert.equal(r.body.registro.datos.sin_novedad, false);
  assert.equal(r.body.registro.datos.estado_revision, 'revisado_con_pendientes');
});
test('equipo inhabilitado crea una actividad vinculada y no la duplica al guardar', async () => {
  const h = loadPlanner(); const url = api + '/daily/mantenimiento/equipos_fuera';
  const body = { fecha: '2026-10-12', datos: { equipos: [{ nombre: 'Bomba', area: 'PTAR', fecha_inhabilitado: '2026-10-12', diagnostico: 'No arranca' }] } };
  await request(h.app).post(url).send(body).expect(201);
  await request(h.app).post(url).send(body).expect(200);
  assert.equal(h.planner.actividades.length, 1);
  assert.equal(h.planner.actividades[0].origen_formulario, 'equipos_fuera');
  assert.equal(h.planner.daily_registros[0].datos.equipos[0].actividad_id, h.planner.actividades[0].id);
});
test('RHH incluye sin registro pero no labora; conserva vacante y fecha real', async () => {
  const rhh = { rhh_employees: [1,2,3].map(id => ({ id, full_name: 'Empleado ' + id, status:'active', position_id: 1 })), rhh_attendance: [{ employee_id:1, fecha:'2026-10-12', incidencia_type:'labora' }, { employee_id:2, fecha:'2026-10-12', incidencia_type:'falta' }], rhh_positions: [{ id:1, name:'Tecnico', headcount_requerido:4 }], rhh_vacancies: [{ id:1, position_id:1, status:'open', opened_date:'2026-09-10' }] };
  const h = loadPlanner({ rhh });
  const r = await request(h.app).get(api + '/integracion/rhh/ausentismo?fecha=2026-10-12').expect(200);
  assert.deepEqual(r.body.registros.map(r => r.status), ['falta','sin_registro']);
  const p = await request(h.app).get(api + '/integracion/rhh/plantilla').expect(200);
  assert.equal(p.body.vacantes[0].fecha_apertura, '2026-09-10'); assert.equal(p.body.resumen.porcentaje_global, 75);
});
test('capacitaciones vigentes pasan al dia siguiente como sugerencia sin marcar llenado', async () => {
  const h = loadPlanner();
  h.planner.daily_registros.push({ departamento:'rhh', formulario:'personal_capacitacion', fecha:'2026-10-11', datos:{ registros:[{ nombre:'Vigente', fecha_inicio:'2026-10-10', fecha_fin:'2026-10-15' }, {nombre:'Terminada',fecha_fin:'2026-10-11'}] } });
  const r = await request(h.app).get(api + '/daily/rhh/personal_capacitacion?fecha=2026-10-12').expect(200);
  assert.equal(r.body.registro, null); assert.deepEqual(r.body.datos_sugeridos.registros.map(x => x.nombre), ['Vigente']);
});
test('reprocesos se calculan en servidor y no aceptan porcentaje inventado', async () => {
  const h = loadPlanner(); h.planner.daily_registros.push({ departamento:'calidad', formulario:'rechazos_internos', fecha:'2026-10-12', datos:{ L3:{ procesadas:200, rechazadas:5 } } });
  const r = await request(h.app).post(api + '/daily/calidad/reprocesos').send({ fecha:'2026-10-12', datos:{L3:90} }).expect(201);
  assert.equal(r.body.registro.datos.L3, 2.5); assert.equal(r.body.registro.datos.L4, null);
});
test('PTAR exige asignacion SMYA y valida evidencia o plan de accion', async () => {
  const h = loadPlanner(); await request(h.app).patch(api + '/config/ptar').set('x-user','2').send({dias_retrolavado:[1]}).expect(403);
  await request(h.app).patch(api + '/config/ptar').send({dias_retrolavado:[1]}).expect(200);
  await request(h.app).post(api + '/daily/smya/ptar').send({datos:{retrolavado:{aplica:true,realizado:true}}}).expect(400);
  await request(h.app).post(api + '/daily/smya/ptar').send({datos:{retrolavado:{aplica:true,realizado:false,razones:'Falla',plan_accion:'Reparar'}}}).expect(201);
});
test('CPK filtra fosfato y todas las muestras de empaque por el mismo periodo', async () => {
  const h = loadPlanner({ vales: { parametros_titulacion:[{id:700,nombre_parametro:'Peso de fosfato',valor_min:0,valor_max:10}], titulaciones_header:[{id:1,linea:'L3',fecha:'2026-09-01'},{id:2,linea:'L3',fecha:'2026-10-01'}], titulaciones_detalle:[{header_id:1,parametro_id:700,valor_registrado:3},{header_id:2,parametro_id:700,valor_registrado:9}] }, flujo: { muestras_tenneco:[...Array.from({length:12},(_,i)=>({numero_parte:'P1',fecha:'2026-09-01',rugosidad_prom:1+i/100,altura_axial_prom:2+i/100})),{numero_parte:'P1',fecha:'2026-10-01',rugosidad_prom:99}], cat_tenneco_specs:[{numero_parte:'P1',rugosidad_min:0,rugosidad_max:3,altura_axial_min:0,altura_axial_max:4}] } });
  const q = '?desde=2026-09-01&hasta=2026-09-30';
  const p = await request(h.app).get(api + '/integracion/vales/cpk' + q).expect(200);
  assert.equal(p.body.cpk_params[0].id,700); assert.equal(p.body.cpk_params[0].n,1); assert.equal(p.body.titulaciones.L3.length,1);
  const e = await request(h.app).get(api + '/integracion/empaque/cpk' + q).expect(200);
  assert.equal(e.body.partes[0].muestras,12); assert.ok(e.body.partes[0].rugosidad.mean < 2);
  await request(h.app).get(api + '/integracion/vales/cpk?desde=2026-10-01').expect(400);
});
test('menciones preparan correo y la bitacora no registra envio inexistente', async () => {
  const h = loadPlanner(); h.planner.actividades.push(task({responsable_email:'ana@example.test'}));
  const r = await request(h.app).post(api + '/actividades/ACT-0001/comentario').send({texto:'Revisar @[Luis](2)'}).expect(201);
  assert.match(decodeURIComponent(r.body.mailto), /luis@example.test/);
  await request(h.app).get(api + '/actividades/ACT-0001/mailto').expect(200);
  assert.equal(h.planner.actividades[0].trazabilidad.at(-1).accion, 'correo_preparado');
});
test('ordenes cerradas en el periodo cuentan aunque se hayan solicitado antes', async () => {
  const h = loadPlanner({ mantenimiento:{ordenes_mantenimiento:[{fecha_solicitud:'2026-09-01',fecha_cierre:'2026-10-06'},{fecha_solicitud:'2026-10-07'}]} });
  const r = await request(h.app).get(api + '/dashboard/mantenimiento/semanal?fecha=2026-10-12').expect(200);
  assert.equal(r.body.integracion.ots_por_dia.find(d=>d.fecha==='2026-10-06').cerradas,1);
  assert.equal(r.body.integracion.ots_por_dia.find(d=>d.fecha==='2026-10-07').creadas,1);
});
