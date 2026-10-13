'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const request=require('supertest'),{loadPlanner}=require('./planner-test-harness'),rules=require('./planner-rules');
function client(){
  const nodes=new Map([['mainContent',{innerHTML:'',scrollTop:210}],['plannerPendingPanel',{outerHTML:''}]]),listeners={};
  const document={getElementById:id=>nodes.get(id)||null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,cb)=>listeners[name]=cb,body:{classList:{contains:()=>false}}};
  const c=vm.createContext({document,localStorage:{getItem:()=>null},window:{},console,Intl,Date,alert:()=>{}});
  const source=fs.readFileSync(path.join(__dirname,'../../frontend/public/planner-staff/index.html'),'utf8');
  for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())vm.runInContext(m[1].replace(/initApp\(\);\s*$/,''),c);
  c.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  c.plannerFormatVisibleNumbers=()=>{};
  return {c,nodes,listeners,run:code=>vm.runInContext(code,c)};
}
test('panel incluye todas las abiertas, sin duplicados, y excluye cerradas/canceladas',()=>{
  const x=client();const rows=x.c.plannerPendingActivities({atrasadas:[{id:'A',estatus:'atrasada',fecha_compromiso:'2026-10-01'}],pendientes:[{id:'B',estatus:'pospuesta'},{id:'C',estatus:'cerrada'},{id:'D',estatus:'cancelada'}],sin_fecha:[{id:'B',estatus:'pospuesta'}]});
  assert.deepEqual(Array.from(rows,a=>a.id),['A','B']);
  x.run("_ds.deptoId='produccion'");x.c._ds.activities=rows;
  const html=x.c.plannerPendingPanel();assert.match(html,/Agregar actividad a Producción/);assert.match(html,/Sin fecha/);
});
test('cada slide conserva panel; cambiar de departamento cambia sus pendientes',async()=>{
  const x=client();x.c.apiFetch=async url=>({fecha:'2026-10-13',formularios:[],actividades:{pendientes:[{id:url.includes('smya')?'SMYA':'PROD',titulo:'Prueba <segura>',estatus:'sin_empezar'}]}});
  await x.c.openDeptoSlides('produccion');
  for(let i=0;i<x.c._ds.slides.length;i++){x.c._ds.idx=i;x.c.paintSlide();assert.match(x.nodes.get('mainContent').innerHTML,/plannerPendingPanel/);assert.match(x.nodes.get('mainContent').innerHTML,/PROD/);}
  await x.c.openDeptoSlides('smya');assert.equal(x.c._ds.activities[0].id,'SMYA');assert.match(x.c.plannerPendingPanel(),/Prueba &lt;segura&gt;/);
});
test('alta aparece antes de recargar y preserva índice, scroll y rango CPK',async()=>{
  const x=client();x.c.apiFetch=async()=>({fecha:'2026-10-13',formularios:[{id:'cpk',llenado:true,datos:{}}],actividades:{pendientes:[{id:'NEW',titulo:'Nueva',estatus:'sin_empezar'}]}});
  await x.c.openDeptoSlides('procesos');x.c._ds.idx=1;
  x.c._ds.slides[1].cpk={range:{ini:'2026-09-01',fin:'2026-09-30'},loaded:true,data:{cpk_params:[],empaque_partes:[],titulaciones:{}},notesHtml:'',tasksHtml:''};
  x.c.showCreatedPresentationActivity({id:'NEW',titulo:'Nueva',departamento:'procesos',estatus:'sin_empezar'});
  assert.match(x.nodes.get('plannerPendingPanel').outerHTML,/Nueva/);
  await x.c.refreshPresentationActivities();assert.equal(x.c._ds.idx,1);assert.equal(x.c._ds.slides[1].cpk.range.ini,'2026-09-01');assert.equal(x.nodes.get('mainContent').scrollTop,210);assert.equal(x.c._ds.activities.length,1);assert.doesNotMatch(x.c._ds.pendingMessage,/No se pudo/);assert.match(x.nodes.get('mainContent').innerHTML,/Periodo consultado/);
});
test('guardar no duplica solicitudes y no pierde datos cuando falla el POST',async()=>{
  const x=client();for(const [id,value] of Object.entries({naTitle:'Actividad',naDesc:'',naResp:'1',naDepto:'smya',naFecha:'',naUrg:'media'}))x.nodes.set(id,{value});x.nodes.set('naErr',{});
  let reject,calls=0;x.c.apiFetch=()=>{calls++;return new Promise((_,r)=>reject=r)};
  const saving=x.c.saveNewAct(false);await x.c.saveNewAct(false);assert.equal(calls,1);reject(Error('Sin conexión'));await saving;
  assert.equal(x.nodes.get('naTitle').value,'Actividad');assert.equal(x.nodes.get('naErr').textContent,'Sin conexión');assert.equal(x.run('_savingNewActivity'),false);
});
test('fallo al actualizar después del alta conserva actividad visible',async()=>{
  const x=client();x.c._ds.deptoId='smya';x.c._ds.slides=[{titulo:'Resumen',html:''}];
  x.c.showCreatedPresentationActivity({id:'A',departamento:'smya',titulo:'Guardada',estatus:'sin_empezar'});x.c.apiFetch=async()=>{throw Error('Sin conexión')};
  await x.c.refreshPresentationActivities();assert.match(x.nodes.get('plannerPendingPanel').outerHTML,/Guardada/);assert.match(x.nodes.get('plannerPendingPanel').outerHTML,/Actividad guardada/);
});
test('teclado no cambia diapositiva mientras se edita una actividad',()=>{
  const x=client();x.run("_currentView='dashboard';_ds.slides=[{},{}];_ds.idx=0");x.c.document.querySelector=()=>({});
  x.listeners.keydown({key:'ArrowRight',target:{tagName:'DIV'},preventDefault(){throw Error('No debe interceptar')}});assert.equal(x.c._ds.idx,0);
});
test('scrap lunes-domingo: cero, faltantes, acumulado al corte, cambio de semana',()=>{
  const rows=[['2026-10-11',999],['2026-10-12',1200],['2026-10-13',0],['2026-10-15',300],['2026-10-18',100],['2026-10-19',50]].map(([fecha,n])=>({departamento:'smya',formulario:'scrap',fecha,datos:{cantidad_piezas:n}}));
  const r=rules.scrapSummary(rows,'2026-10-14');assert.equal(r.inicio,'2026-10-12');assert.equal(r.fin,'2026-10-18');assert.equal(r.dia,null);assert.equal(r.diario[1].piezas,0);assert.equal(r.acumulado,1200);assert.equal(r.dias_capturados,2);assert.equal(r.diario.length,7);
  assert.equal(rules.scrapSummary(rows,'2026-10-18').acumulado,1600);assert.equal(rules.scrapSummary(rows,'2026-10-19').acumulado,50);assert.equal(rules.scrapSummary([],'2026-10-14').acumulado,null);
});
test('API guarda lodos decimales kg; rechaza negativos y scrap fraccionario',async()=>{
  const h=loadPlanner();const endpoint='/api/planner/daily/smya/';
  for(const [form,datos] of [['ptar',{cantidad_lodos_kg:-1}],['ptar',{cantidad_lodos_kg:'2'}],['scrap',{cantidad_piezas:-1}],['scrap',{cantidad_piezas:1.5}],['scrap',{cantidad_piezas:'10'}]])await request(h.app).post(endpoint+form).send({fecha:'2026-10-13',datos}).expect(400);
  await request(h.app).post(endpoint+'ptar').send({fecha:'2026-10-13',datos:{cantidad_lodos_kg:12.75}}).expect(201);
  const r=await request(h.app).get(endpoint+'ptar?fecha=2026-10-13').expect(200);assert.equal(r.body.registro.datos.cantidad_lodos_kg,12.75);
});
test('editar scrap reemplaza el total del día sin duplicar y conserva historial/comentarios',async()=>{
  const h=loadPlanner(),url='/api/planner/daily/smya/scrap';
  await request(h.app).post(url).send({fecha:'2026-10-12',version:0,datos:{cantidad_piezas:1000,comentarios:'Inicial'}}).expect(201);
  const update=await request(h.app).post(url).send({fecha:'2026-10-12',version:1,datos:{cantidad_piezas:1500,comentarios:'Ajustado'}}).expect(200);
  assert.equal(update.body.registro.revisiones.length,1);
  await request(h.app).post(url).send({fecha:'2026-10-13',datos:{cantidad_piezas:0}}).expect(201);
  const r=await request(h.app).get('/api/planner/dashboard/smya?fecha=2026-10-13').expect(200);assert.equal(r.body.scrap_semana.acumulado,1500);assert.equal(r.body.scrap_semana.dia,0);assert.ok(r.body.formularios.some(f=>f.id==='scrap'));
});
test('presentación de scrap muestra comas, piezas, faltantes y semana; PTAR conserva históricos sin lodos',()=>{
  const x=client();const week=rules.scrapSummary([{departamento:'smya',formulario:'scrap',fecha:'2026-10-12',datos:{cantidad_piezas:12345}}],'2026-10-13');
  const html=x.c.plannerScrapSummary(week);assert.match(html,/12,345/);assert.match(html,/piezas/);assert.match(html,/lunes a domingo/);assert.match(html,/Sin captura/);
  const ptar=x.c.dsCustomRender('ptar',{litros_ingresados_ptar:10});assert.match(ptar,/Sin captura de lodos/);assert.match(x.c.dsCustomRender('ptar',{litros_ingresados_ptar:10,cantidad_lodos_kg:12.75}),/12.75/);
});
