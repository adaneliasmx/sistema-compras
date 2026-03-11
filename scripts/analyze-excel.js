const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/proye/OneDrive 2026/OneDrive - Corporativo Cuesto, S de RL de CV/Cuesto Dropbox/Informacion Cuesto/COMPRAS/Registro requisición de compra Revisión.xlsx');
const ws = wb.Sheets['Solicitudes de Compras'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

// Items únicos (descripcion + codigo + proveedor)
const items = {};
data.slice(1).forEach(r => {
  const desc = r[7]; const code = r[11]; const prov = r[8]; const unit = r[6]; const cost = r[10];
  if (!desc) return;
  const key = String(desc).trim().toLowerCase();
  if (!items[key]) items[key] = { desc: String(desc).trim(), code: code, prov: prov, unit: unit, cost: cost, count: 0 };
  items[key].count++;
});
const sorted = Object.values(items).sort((a,b) => b.count - a.count);
console.log('Items únicos:', sorted.length);
console.log('Top 30:');
sorted.slice(0,30).forEach(i => console.log(' ', i.count, 'x', JSON.stringify(i.desc), '| cod:', i.code, '| prov:', i.prov, '| unit:', i.unit, '| costo:', i.cost));

// Solicitantes únicos
const soli = [...new Set(data.slice(1).map(r => r[3]).filter(Boolean))].sort();
console.log('\nSOLICITANTES:', soli);

// Otras hojas
['Gastos Resistencias','FECHAS COMPROMISO','VALORES'].forEach(name => {
  const ws2 = wb.Sheets[name];
  if (!ws2) return;
  const d2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: null, blankrows: false });
  console.log('\n=== HOJA:', name, '=== (', d2.length, 'filas)');
  d2.slice(0,8).forEach((row,i) => { if(row.some(c => c !== null)) console.log('Fila',i+1,':',JSON.stringify(row.slice(0,10))); });
});
