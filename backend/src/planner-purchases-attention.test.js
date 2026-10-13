'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),request=require('supertest'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadPlanner}=require('./planner-test-harness'),rules=require('./planner-rules');
function fixture(){
 const compras={requisitions:[],requisition_items:[],purchase_orders:[],purchase_order_items:[],suppliers:[{id:1,business_name:'Proveedor prueba'}]};
 const add=(id,date,urgency='Medio',status='En proceso',po={})=>{
  compras.requisitions.push({id,programmed_date:date,urgency,status:'En proceso'});
  compras.requisition_items.push({id,requisition_id:id,manual_item_name:'Compra '+id,quantity:2,status,supplier_id:1});
  if(Object.keys(po).length){compras.purchase_orders.push({id,folio:'PO-'+id,status:'Enviada',supplier_id:1,...po});compras.purchase_order_items.push({id,requisition_item_id:id,purchase_order_id:id});}
 };
 add(1,'2026-10-11');add(2,'2026-10-15','Alto');add(3,'2026-10-12');add(4,'2026-10-15');add(5,null,'Alto');add(6,null);add(7,'2026-10-11','Alto','Entregado');add(8,'2026-10-11','Alto','Cancelado');add(9,'2026-10-11','Alto','En proceso',{status:'Entregado'});add(10,'2026-10-11','Medio','En proceso',{supplier_commitment_date:'2026-10-16'});add(11,'2026-10-16','Medio','En proceso',{supplier_commitment_date:'2026-10-11'});add(12,'2026-10-11','Alto');
 return compras;
}
test('compras: vencida O urgente, excluye hoy/no prioritarias/finalizadas; fecha proveedor prevalece',()=>{
 const r=rules.purchasesAttention(fixture(),'2026-10-12');const items=Object.values(r.por_estatus).flatMap(g=>g.items);
 assert.deepEqual(items.map(i=>i.id),[1,2,5,11,12]);assert.equal(r.total_items,5);assert.equal(r.vencidas,3);assert.equal(r.urgentes,3);assert.equal(r.pos_activas,1);assert.equal(items.find(i=>i.id===11).fecha_compromiso,'2026-10-11');
});
test('compras: no recorta a 20 filas y no duplica urgentes que también vencieron',()=>{
 const compras=fixture();for(let i=100;i<135;i++){compras.requisitions.push({id:i,programmed_date:'2026-10-01',urgency:'Alto'});compras.requisition_items.push({id:i,requisition_id:i,status:'En proceso'});}
 const r=rules.purchasesAttention(compras,'2026-10-12');assert.equal(r.total_items,40);assert.equal(Object.values(r.por_estatus).flatMap(g=>g.items).length,40);
});
test('API comparte criterio entre captura y dashboard; actividades de otros departamentos se conservan',async()=>{
 const h=loadPlanner();Object.assign(h.compras,fixture());
 h.planner.actividades=[{id:'LATE',departamento:'compras',estatus:'en_proceso',fecha_compromiso:'2026-10-11',urgencia:'media'},{id:'URGENT',departamento:'compras',estatus:'sin_empezar',urgencia:'alta'},{id:'NORMAL',departamento:'compras',estatus:'en_proceso',fecha_compromiso:'2026-10-20',urgencia:'media'},{id:'CLOSED',departamento:'compras',estatus:'cerrada',urgencia:'alta'},{id:'OTHER',departamento:'smya',estatus:'en_proceso',urgencia:'media'}];
 const a=await request(h.app).get('/api/planner/integracion/compras/resumen').expect(200);
 const b=await request(h.app).get('/api/planner/dashboard/compras?fecha=2026-10-12').expect(200);
 assert.deepEqual(b.body.compras_pendientes,a.body);assert.equal(b.body.actividades.total,2);assert.deepEqual(b.body.actividades.atrasadas.map(a=>a.id),['LATE']);assert.deepEqual(b.body.actividades.pendientes.map(a=>a.id),['URGENT']);
 const other=await request(h.app).get('/api/planner/dashboard/smya?fecha=2026-10-12').expect(200);assert.equal(other.body.actividades.total,1);
});
test('slide y panel filtran también capturas antiguas; una nueva actividad normal no aparece',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../frontend/public/planner-staff/index.html'),'utf8');
 const c=vm.createContext({console,Intl,Date,localStorage:{getItem:()=>null},document:{addEventListener(){},getElementById:()=>null}});
 for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())vm.runInContext(m[1].replace(/initApp\(\);\s*$/,''),c);
 c.esc=s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;');c.todayMx=()=>'2026-10-12';
 const html=c.plannerPurchasesHtml({fecha:'2026-10-12',por_estatus:[{estatus:'En proceso',items:[{descripcion:'Normal'},{descripcion:'Urgente <ejemplo>',urgente:true}]}]});
 assert.ok(!html.includes('Normal'));assert.ok(html.includes('Urgente &lt;ejemplo&gt;'));
 c._ds.deptoId='compras';c._ds.activities=[{id:'N',titulo:'NO MOSTRAR',estatus:'sin_empezar',urgencia:'media'},{id:'U',titulo:'URGENTE',estatus:'sin_empezar',urgencia:'alta'}];
 assert.ok(!c.plannerPendingPanel().includes('NO MOSTRAR'));assert.ok(c.plannerPendingPanel().includes('URGENTE'));
 c._ds.deptoId='smya';assert.ok(c.plannerPendingPanel().includes('NO MOSTRAR'));
});
