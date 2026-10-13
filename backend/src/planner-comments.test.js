'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadPlanner } = require('./planner-test-harness');
const htmlEscape = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function client() {
  const source = fs.readFileSync(path.join(__dirname,'../../frontend/public/planner-staff/index.html'),'utf8');
  const nodes = new Map([['mainContent',{innerHTML:''}]]);
  const context = vm.createContext({ localStorage: {getItem:()=>null}, document: {addEventListener(){}, getElementById:id=>nodes.get(id) || null}, console, Intl, Date });
  for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if(match[1].trim()) vm.runInContext(match[1].replace(/initApp\(\);\s*$/,''),context);
  context.esc = htmlEscape;
  context.paintSlide = () => {};
  return { context, nodes, run: code=>vm.runInContext(code,context) };
}
test('los 45 slides incluyen comentarios, notas por registro y saltos de linea sin duplicar ni interpretar HTML', async () => {
  const c=client(); const all=c.run('DAILY_FORMS_META'); let count=0;
  for(const [depto,forms] of Object.entries(all)) {
    c.context.apiFetch=async()=>({fecha:'2026-10-13', formularios:forms.map(f=>({id:f.id,llenado:true,datos:{comentarios:'Comentario '+f.id+'\n<script>ejemplo</script>',observaciones:'Observación '+f.id,issues:[{problema:'Pieza',comentario:'Detalle '+f.id}]}})), actividades:{}});
    await c.context.openDeptoSlides(depto);
    const slides=c.run('_ds.slides');
    forms.forEach((f,i)=>{
      const html=slides[i+1].html;
      assert.equal(html.split('Comentario '+f.id).length-1,1,f.id);
      assert.ok(html.includes('Observación '+f.id),f.id);
      assert.ok(html.includes('Detalle '+f.id),f.id);
      assert.ok(html.includes('\n&lt;script&gt;ejemplo&lt;/script&gt;'),f.id);
      assert.ok(!html.includes('<script>ejemplo</script>'),f.id);
      count++;
    });
  }
  assert.equal(count,45);
});
test('formulario comun conserva y guarda el comentario general', () => {
  const c=client(); c.run("_dailyRegistro={datos:{comentarios:'Guardado'}}");
  const html=c.context.dailyFormWrap('Prueba','',()=>({cantidad:5}));
  assert.match(html, /for="df_wrap_comments"/); assert.match(html,/>Guardado<\/textarea>/);
  c.nodes.set('df_wrap_comments',{value:'Nuevo\ncomentario'});
  assert.equal(c.run('_currentDailyGetData().comentarios'),'Nuevo\ncomentario');
  assert.equal(c.run('_currentDailyGetData().cantidad'),5);
});
test('formularios de tareas permiten comentarios aunque no haya pendientes', async () => {
  const c=client(); c.context.apiFetch=async()=>[]; c.run("_dailyRegistro={datos:{comentarios:'Seguimiento'}}");
  const container={}; await c.context.renderTaskFormDaily(container,'sgc','no_conformidades','Prueba');
  assert.match(container.innerHTML,/for="df_task_comments"/);
  c.nodes.set('df_task_comments',{value:'Revisado sin pendientes'});
  assert.equal(c.run('_currentDailyGetData().comentarios'),'Revisado sin pendientes');
  assert.equal(c.run('_currentDailyGetData().sin_novedad'),true);
});
test('8D usa guardado Daily propio y conserva comentarios sin heredar el formulario anterior', async () => {
  const c=client(); c.context.apiFetch=async()=>[];
  c.run("_dailyRegistro={datos:{comentarios:'Revisión 8D'}}; _currentDailyGetData=()=>({accidente:true})");
  const container={}; await c.context.render8DForm(container);
  assert.match(container.innerHTML,/for="df_wrap_comments"/); assert.match(container.innerHTML,/saveDailyForm\(\)/);
  c.nodes.set('df_wrap_comments',{value:'Acción para el cliente'});
  const data=c.run('_currentDailyGetData()');
  assert.equal(data.comentarios,'Acción para el cliente'); assert.equal(data.accidente,undefined);
  assert.equal(data.actividades_abiertas,0);
});
test('comentarios de actividad y subtarea se muestran completos con autor y fecha', () => {
  const c=client(); const long='Seguimiento '.repeat(80);
  const html=c.context.dsActRow({id:'ACT-1',titulo:'A',estatus:'en_proceso',comentarios:[{texto:long,usuario_nombre:'Ana',fecha:'2026-10-13',hora:'09:00'}],sub_actividades:[{nombre:'Verificar <pieza>',comentarios:[{texto:'Primer renglón\nSegundo renglón',usuario_nombre:'Luis',fecha:'2026-10-12'}]}]});
  assert.ok(html.includes(long)); assert.ok(html.includes('Ana')); assert.ok(html.includes('13 oct 2026'));
  assert.ok(html.includes('Verificar &lt;pieza&gt;')); assert.ok(html.includes('Primer renglón\nSegundo renglón'));
});
test('resumen del periodo incluye comentarios de cualquier formulario y distingue la fecha', () => {
  const c=client(); const html=c.context.plannerPeriodComments({depto:'smya',historico:[{fecha:'2026-10-12',formulario:'epp',datos:{comentarios:'Verificar gafas'}},{fecha:'2026-10-13',formulario:'ptar',datos:{notas:'Retrolavado completado'}}]});
  assert.ok(html.includes('Verificar gafas'));assert.ok(html.includes('Retrolavado completado'));assert.ok(html.includes('12 oct 2026'));assert.ok(html.includes('13 oct 2026'));
});
test('API guarda comentarios en cada uno de los 45 formularios y los entrega al dashboard', async () => {
  const h=loadPlanner(); const c=client(); const all=c.run('DAILY_FORMS_META'); let count=0;
  for(const [depto,forms] of Object.entries(all)) {
    for(const f of forms) {
      const comentario='Reunión: '+depto+'/'+f.id+'\nSiguiente acción.';
      await request(h.app).post('/api/planner/daily/'+depto+'/'+f.id).send({fecha:'2026-10-13',version:0,datos:{comentarios:comentario}}).expect(201);
      const read=await request(h.app).get('/api/planner/daily/'+depto+'/'+f.id+'?fecha=2026-10-13').expect(200);
      assert.equal(read.body.registro.datos.comentarios,comentario);count++;
    }
    const dashboard=await request(h.app).get('/api/planner/dashboard/'+depto+'?fecha=2026-10-13').expect(200);
    assert.ok(dashboard.body.formularios.every(f=>f.datos.comentarios.includes(depto+'/'+f.id)));
  }
  assert.equal(count,45);
});
test('dashboard incluye comentarios y subtareas en todos los grupos de actividades abiertas',async()=>{
  const h=loadPlanner();
  h.planner.actividades=[{id:'ACT-1',departamento:'produccion',estatus:'en_proceso',fecha_compromiso:'2026-10-14',comentarios:[{texto:'Comentario principal',usuario_nombre:'Ana'}],sub_actividades:[{id:'S1',nombre:'Revisar',comentarios:[{texto:'Comentario subtarea',usuario_nombre:'Luis'}]}]},{id:'ACT-2',departamento:'produccion',estatus:'sin_empezar',comentarios:[{texto:'Sin fecha'}]}];
  const r=await request(h.app).get('/api/planner/dashboard/produccion?fecha=2026-10-13').expect(200);
  for(const key of ['pendientes','por_cerrar_semana']) {
    const a=r.body.actividades[key].find(a=>a.id==='ACT-1');
    assert.equal(a.comentarios[0].texto,'Comentario principal');assert.equal(a.sub_actividades[0].comentarios[0].texto,'Comentario subtarea');
  }
  assert.equal(r.body.actividades.sin_fecha[0].comentarios[0].texto,'Sin fecha');
});

function cpkClient() {
  const c=client();
  c.run("_ds.slides=[{cpk:{range:{ini:'2026-10-01',fin:'2026-10-13'},loaded:false,notesHtml:'Comentario conservado',tasksHtml:''}}]; _ds.idx=0");
  c.nodes.set('slide_cpk_desde',{value:'2026-10-01'});c.nodes.set('slide_cpk_hasta',{value:'2026-10-13'});
  return c;
}
function cpkResponse(url) {
  const q=new URL(url,'http://test').searchParams;
  const semana={ini:q.get('desde'),fin:q.get('hasta')};
  return url.includes('/vales/') ? {semana,titulaciones:{},cpk_params:[{tanque:'Fosfato',n:12,cp:1.8,cpk:1.4}]} : {semana,partes:[{numero_parte:'TEN-1',muestras:10,rugosidad:{cpk:1.2},altura_axial:{cpk:1.6}}]};
}
test('slide CPK aplica un solo rango a fosfato y ambos indicadores de empaque',async()=>{
  const c=cpkClient(),calls=[]; c.context.apiFetch=async url=>{calls.push(url);return cpkResponse(url)};
  await c.context.refreshPlannerCpkSlide();
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.endsWith('?desde=2026-10-01&hasta=2026-10-13')));
  const s=c.run('_ds.slides[0]');assert.ok(s.html.includes('Fosfato'));assert.ok(s.html.includes('TEN-1'));assert.ok(s.html.includes('1 oct 2026 al 13 oct 2026'));assert.ok(s.html.includes('Comentario conservado'));
  assert.equal(s.cpk.data.empaque_partes[0].rug_cpk,1.2);assert.equal(s.cpk.data.empaque_partes[0].alt_cpk,1.6);
});
test('CPK no mezcla un resultado parcial con otro periodo cuando una consulta falla',async()=>{
  const c=cpkClient();c.context.apiFetch=async url=>{if(url.includes('/empaque/'))throw Error('Empaque no disponible');return cpkResponse(url)};
  await c.context.refreshPlannerCpkSlide();
  const s=c.run('_ds.slides[0]');assert.ok(s.html.includes('Empaque no disponible'));assert.ok(!s.html.includes('Fosfato</b>'));assert.ok(s.html.includes('Comentario conservado'));assert.equal(s.cpk.loading,false);
});
test('CPK rechaza respuestas cuyos periodos no coinciden',async()=>{
  const c=cpkClient();c.context.apiFetch=async url=>{const r=cpkResponse(url);if(url.includes('/empaque/'))r.semana.ini='2026-09-01';return r};
  await c.context.refreshPlannerCpkSlide();assert.match(c.run('_ds.slides[0].cpk.error'),/periodos recibidos no coinciden/);
});
test('una respuesta CPK tardia no sustituye la ultima consulta',async()=>{
  const c=cpkClient(),pending=[];
  c.context.apiFetch=url=>url.includes('desde=2026-10-01')?new Promise(resolve=>pending.push(()=>resolve(cpkResponse(url)))):Promise.resolve(cpkResponse(url));
  const old=c.context.refreshPlannerCpkSlide();
  c.nodes.get('slide_cpk_desde').value='2026-10-12';
  await c.context.refreshPlannerCpkSlide();pending.forEach(resolve=>resolve());await old;
  assert.equal(c.run('_ds.slides[0].cpk.range.ini'),'2026-10-12');assert.ok(c.run('_ds.slides[0].html').includes('12 oct 2026 al 13 oct 2026'));
});
test('rango CPK incompleto o invertido no borra resultados ni consulta',async()=>{
  const c=cpkClient(),alerts=[];c.context.alert=t=>alerts.push(t);c.context.apiFetch=()=>assert.fail('No consultar');
  c.nodes.get('slide_cpk_desde').value='';await c.context.refreshPlannerCpkSlide();
  c.nodes.get('slide_cpk_desde').value='2026-10-14';await c.context.refreshPlannerCpkSlide();
  assert.equal(alerts.length,2);assert.equal(c.run('_ds.slides[0].cpk.range.ini'),'2026-10-01');
});

test('cambiar rango CP/CPK conserva comentarios y observaciones aun sin guardar',async()=>{
  const c=client();c.run("_dailyRegistro={datos:{comentarios:'Anterior',observaciones:'Antes'}}");
  for(const [id,value] of Object.entries({cpk_desde:'2026-10-01',cpk_hasta:'2026-10-13',df_wrap_comments:'Comentario nuevo\nSegunda línea',df_obs_cpk:'Observación nueva'}))c.nodes.set(id,{value});
  c.context.apiFetch=async url=>cpkResponse(url);
  const container={};await c.context.renderCpkForm(container);
  assert.ok(container.innerHTML.includes('Comentario nuevo\nSegunda línea'));
  assert.ok(container.innerHTML.includes('Observación nueva'));
  assert.equal(c.run('_dailyRegistro.datos.comentarios'),'Anterior');
});
