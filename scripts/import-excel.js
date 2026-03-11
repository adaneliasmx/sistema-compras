/**
 * Script de importación: Registro requisición de compra Revisión.xlsx
 * Carga: centros de costo, proveedores, catálogo de ítems, usuarios y requisiciones históricas
 */
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const path = require('path');
const { read, write } = require('../backend/src/db');

const FILE = 'C:/Users/proye/OneDrive 2026/OneDrive - Corporativo Cuesto, S de RL de CV/Cuesto Dropbox/Informacion Cuesto/COMPRAS/Registro requisición de compra Revisión.xlsx';

// ─── Helpers ───────────────────────────────────────────────────────────────
function nextId(arr) { return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1; }
function clean(s) { return s ? String(s).trim() : ''; }
function cleanLower(s) { return clean(s).toLowerCase(); }
function excelDateToISO(n) {
  if (!n || typeof n !== 'number') return null;
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return d.toISOString().slice(0, 10);
}

// ─── Leer Excel ─────────────────────────────────────────────────────────────
const wb = XLSX.readFile(FILE);
const ws = wb.Sheets['Solicitudes de Compras'];
const wsRes = wb.Sheets['Gastos Resistencias'];
const rawMain = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }).slice(1); // sin encabezado
const rawRes = XLSX.utils.sheet_to_json(wsRes, { header: 1, defval: null, blankrows: false }).slice(1);

// Combinar ambas hojas (Gastos Resistencias tiene el mismo formato relevante)
// Cols principales: [0]=Semana [1]=Fecha [2]=Urgencia [3]=Solicitante [4]=Depto [5]=Cantidad [6]=Unidad [7]=Descripcion [8]=Proveedor [9]=Factura [10]=Costo [11]=Codigo [12]=Justificacion [13]=PO [19]=Estatus
const allRows = [
  ...rawMain.filter(r => r.some(c => c !== null)),
  ...rawRes.filter(r => r.some(c => c !== null)).map(r => {
    // Gastos Resistencias: Fecha[0] Solicitante[1] Depto[2] Cantidad[3] Unidad[4] Desc[5] Prov[6] CostoUnit[7] CostoTotal[8] Justif[9]
    return [null, r[0], 'Medio (Entrega de 24 a 48 hrs.)', r[1], r[2], r[3], r[4], r[5], r[6], null, r[7], null, r[9], null, null, null, null, 'SI', 'SI', 'PO CERRADA', null];
  })
];

console.log(`Total filas a procesar: ${allRows.length}`);

// ─── 1. CENTROS DE COSTO ─────────────────────────────────────────────────────
const DEPT_MAP = {
  'produccion': { name: 'Producción', code: 'CC-PRD' },
  'calidad':    { name: 'Calidad',    code: 'CC-CAL' },
  'mantenimiento': { name: 'Mantenimiento', code: 'CC-MNT' },
  'procesos':   { name: 'Procesos',   code: 'CC-PRC' },
  'rh':         { name: 'Recursos Humanos', code: 'CC-RH' },
  'sgc':        { name: 'SGC',        code: 'CC-SGC' },
  'syma':       { name: 'SYMA',       code: 'CC-SYM' },
};
// Departamentos válidos (ignorar basura como 10, FEI52773...)
const validDepts = new Set(Object.keys(DEPT_MAP));
function normDept(d) {
  if (!d) return null;
  const k = cleanLower(String(d));
  if (validDepts.has(k)) return k;
  if (k === 'producción') return 'produccion';
  return null;
}

// ─── 2. UNIFICACIÓN DE PROVEEDORES ──────────────────────────────────────────
// Agrupar por nombre normalizado, elegir el más frecuente
const provCounts = {};
allRows.forEach(r => {
  const p = clean(r[8]);
  if (!p) return;
  const k = p.toLowerCase().replace(/\s+/g, ' ');
  if (!provCounts[k]) provCounts[k] = {};
  provCounts[k][p] = (provCounts[k][p] || 0) + 1;
});

// Grupos de duplicados conocidos → clave canónica
const PROV_ALIASES = {
  'disosa': ['disosa', 'Disosa'],
  'bridge': ['bridge', 'Bridge', 'Bridge '],
  'ofi cinco': ['ofi 5', 'ofi cinco', 'oficinco'],
  'abastecedora de aceros inoxidables': ['abastecedora de acero inoxidable', 'abastecedora de aceros inoxidables'],
  'magnipack': ['magnipack'],
  'chemetall': ['chemetall'],
  'ruval': ['ruval'],
  'servicio electrico especializado a montacargas soto': [
    'servicio electrico especializado a montacargas soto',
    'servicio electrico especializado a montacargas soto, s. de r.l. de c.v'
  ],
};

// Crear mapa alias→canonical
const aliasToCanon = {};
Object.entries(PROV_ALIASES).forEach(([canon, aliases]) => {
  aliases.forEach(a => aliasToCanon[a.toLowerCase().replace(/\s+/g,' ')] = canon.toUpperCase() === canon ? canon : aliases.sort((a,b) => (provCounts[b.toLowerCase().replace(/\s+/g,' ')]?.[b]||0) - (provCounts[a.toLowerCase().replace(/\s+/g,' ')]?.[a]||0))[0] );
});

// Para cada proveedor único, obtener el nombre canónico (el más frecuente o el alias definido)
const provNameSet = {};
allRows.forEach(r => {
  const p = clean(r[8]);
  if (!p) return;
  const k = p.toLowerCase().replace(/\s+/g, ' ');
  const canon = aliasToCanon[k] || (() => {
    // elegir variante más frecuente del grupo
    const group = provCounts[k];
    return Object.entries(group || { [p]: 1 }).sort((a,b) => b[1]-a[1])[0][0];
  })();
  provNameSet[k] = canon;
});

// Lista final de proveedores únicos
const uniqueProviders = [...new Set(Object.values(provNameSet))].sort();
console.log(`Proveedores únicos tras deduplicación: ${uniqueProviders.length}`);

// ─── 3. ÍTEMS DEL CATÁLOGO ──────────────────────────────────────────────────
// Agrupar por descripción normalizada, elegir nombre más frecuente y datos más completos
const itemGroups = {};
allRows.forEach(r => {
  const desc = clean(r[7]);
  if (!desc) return;
  const key = desc.toLowerCase().replace(/\s+/g, ' ');
  if (!itemGroups[key]) itemGroups[key] = { variants: {}, codes: {}, provs: {}, units: {}, costs: [] };
  const g = itemGroups[key];
  g.variants[desc] = (g.variants[desc] || 0) + 1;
  if (r[11]) g.codes[clean(r[11])] = (g.codes[clean(r[11])] || 0) + 1;
  const pKey = clean(r[8]).toLowerCase().replace(/\s+/g,' ');
  if (pKey) g.provs[pKey] = (g.provs[pKey] || 0) + 1;
  if (r[6]) g.units[cleanLower(r[6])] = (g.units[cleanLower(r[6])] || 0) + 1;
  const c = r[10];
  if (c && typeof c === 'number' && c > 0) g.costs.push(c);
  else if (c && typeof c === 'string') {
    const n = parseFloat(String(c).replace('USD','').trim());
    if (n > 0) g.costs.push(n);
  }
});

// Normalizar unidades al sistema
const UNIT_NORM = {
  'pz': 'pza', 'pz ': 'pza', 'pieza': 'pza', 'pza  ': 'pza', 'pzs': 'pza',
  'pc': 'pza', 'pzs': 'pza', 'pza': 'pza',
  'kg ': 'kg', 'kilos': 'kg',
  'lt': 'lt', 'lts': 'lt', 'litros': 'lt', 'litros ': 'lt', 'l': 'lt',
  'mtro': 'mtr', 'metro': 'mtr', 'mt': 'mtr', 'mtr': 'mtr', 'mtrs ': 'mtr', 'mtro': 'mtr',
  'caja': 'caja', 'cajas': 'caja',
  'paq': 'paq', 'paq.': 'paq', 'paquete': 'paq', 'paquete ': 'paq', 'paquetes': 'paq', 'paquetes ': 'paq',
  'tambo': 'tambo', 'tambos': 'tambo',
  'rollos': 'rollo', 'royos': 'rollo',
  'servicio': 'servicio', 'evento': 'servicio',
  'gal': 'gal',
  'kit': 'kit', 'set': 'kit',
  'trmo': 'tambo',
  'bidones': 'tambo',
  'sacos': 'costal', 'costal': 'costal', 'costales': 'costal',
  'pares': 'par', 'par': 'par',
  'porron': 'tambo',
};
function normUnit(u) {
  const k = cleanLower(u || '').replace(/\s+/g,' ').trim();
  return UNIT_NORM[k] || k || 'pza';
}

// Detectar si el costo es en USD
function parseCost(raw) {
  if (!raw) return { value: 0, currency: 'MXN' };
  const s = String(raw).trim();
  if (s.toUpperCase().includes('USD')) {
    const n = parseFloat(s.replace(/USD/gi,'').trim());
    return { value: isNaN(n) ? 0 : n, currency: 'USD' };
  }
  const n = parseFloat(s);
  return { value: isNaN(n) ? 0 : n, currency: 'MXN' };
}

const catalogItems = Object.entries(itemGroups).map(([key, g]) => {
  const name = Object.entries(g.variants).sort((a,b) => b[1]-a[1])[0][0];
  const code = g.codes ? Object.entries(g.codes).sort((a,b) => b[1]-a[1])[0]?.[0] || null : null;
  const provKey = g.provs ? Object.entries(g.provs).sort((a,b) => b[1]-a[1])[0]?.[0] || null : null;
  const unitKey = g.units ? Object.entries(g.units).sort((a,b) => b[1]-a[1])[0]?.[0] || 'pza' : 'pza';
  const rawCost = allRows.find(r => {
    const d = clean(r[7]).toLowerCase().replace(/\s+/g,' ');
    const pk = clean(r[8]).toLowerCase().replace(/\s+/g,' ');
    return d === key && pk === provKey && r[10];
  })?.[10] || null;
  const { value: price, currency } = parseCost(rawCost);
  return { _key: key, name, code, provKey, unit: normUnit(unitKey), price, currency };
});

console.log(`Ítems únicos del catálogo: ${catalogItems.length}`);

// ─── CARGAR EN BASE DE DATOS ─────────────────────────────────────────────────
const db = read();
const DEFAULT_PASSWORD = '$2a$10$J2SOwMaQKOJj5IHKrXbtseQCu2lNBuF0P8G1DjTm6OdWBfZG9yyL.'; // Demo123*

// ── A. Centros de costo (preservar los existentes, agregar nuevos) ──
const existingCC = new Set(db.cost_centers.map(c => c.code));
const newCostCenters = Object.values(DEPT_MAP).filter(d => !existingCC.has(d.code));
newCostCenters.forEach(d => {
  db.cost_centers.push({ id: nextId(db.cost_centers), code: d.code, name: d.name, active: true });
});
console.log(`Centros de costo agregados: ${newCostCenters.length}`);

// Mapa deptoNorm → cost_center_id
const ccByCode = {};
db.cost_centers.forEach(c => ccByCode[c.code] = c.id);
const deptToCCId = {};
Object.entries(DEPT_MAP).forEach(([k, d]) => deptToCCId[k] = ccByCode[d.code]);

// ── B. Proveedores ──
const existingProvNames = new Set(db.suppliers.map(s => s.business_name.toLowerCase().trim()));
let provAddCount = 0;
const provNameToId = {};
// Mapear existentes
db.suppliers.forEach(s => provNameToId[s.business_name.toLowerCase().trim()] = s.id);

uniqueProviders.forEach((pName, i) => {
  const k = pName.toLowerCase().trim();
  if (!existingProvNames.has(k)) {
    const num = String(nextId(db.suppliers)).padStart(3, '0');
    const code = 'PRV-' + num;
    db.suppliers.push({ id: nextId(db.suppliers), provider_code: code, business_name: pName, contact_name: '', email: '', phone: '', active: true });
    provAddCount++;
  }
  provNameToId[k] = db.suppliers.find(s => s.business_name.toLowerCase().trim() === k)?.id;
});
console.log(`Proveedores agregados: ${provAddCount}`);

// Función para resolver nombre canónico de proveedor desde raw
function resolveProvId(rawName) {
  if (!rawName) return null;
  const k = clean(rawName).toLowerCase().replace(/\s+/g,' ');
  const canon = provNameSet[k];
  if (!canon) return null;
  return provNameToId[canon.toLowerCase().trim()] || null;
}

// ── C. Ítems del catálogo ──
const existingItemNames = new Set(db.catalog_items.map(i => i.name.toLowerCase().trim()));
let itemAddCount = 0;
const itemNameToId = {};
db.catalog_items.forEach(i => itemNameToId[i.name.toLowerCase().trim()] = i.id);

catalogItems.forEach((item, idx) => {
  const k = item.name.toLowerCase().trim();
  if (existingItemNames.has(k)) {
    itemNameToId[item._key] = db.catalog_items.find(i => i.name.toLowerCase().trim() === k)?.id;
    return;
  }
  const num = String(nextId(db.catalog_items)).padStart(4, '0');
  const code = item.code ? clean(item.code).toUpperCase().substring(0, 20) : `ITM-${num}`;
  const suppId = item.provKey ? resolveProvId(item.provKey + ' dummy') || provNameToId[item.provKey] || null : null;
  // Buscar suppId directamente desde el mapa de aliases
  const suppIdDirect = (() => {
    if (!item.provKey) return null;
    const canonName = provNameSet[item.provKey];
    if (!canonName) return null;
    return provNameToId[canonName.toLowerCase().trim()] || null;
  })();
  const newItem = {
    id: nextId(db.catalog_items),
    code,
    name: item.name,
    item_type: 'uso continuo',
    unit: item.unit,
    supplier_id: suppIdDirect,
    equivalent_code: '',
    unit_price: item.price || 0,
    currency: item.currency || 'MXN',
    quote_validity_days: 30,
    active: true,
    inventoried: false,
    cost_center_id: null,
    sub_cost_center_id: null,
  };
  db.catalog_items.push(newItem);
  itemNameToId[item._key] = newItem.id;
  itemNameToId[k] = newItem.id;
  itemAddCount++;
});
console.log(`Ítems de catálogo agregados: ${itemAddCount}`);

// ── D. Usuarios ──
const USERS_TO_ADD = [
  { full_name: 'Adán Elías',        email: 'aelias@cuesto.com.mx',      role_code: 'cliente_requisicion', department: 'PROCESOS' },
  { full_name: 'Angelica Almaraz',  email: 'jalmaraz@cuesto.com.mx',    role_code: 'cliente_requisicion', department: 'CALIDAD' },
  { full_name: 'Efraín Coronado',   email: 'ecoronado@cuesto.com.mx',   role_code: 'cliente_requisicion', department: 'MANTENIMIENTO' },
  { full_name: 'Francisco Basulto', email: 'fbasulto@cuesto.com.mx',    role_code: 'cliente_requisicion', department: 'PRODUCCION' },
  { full_name: 'Jesús Rodríguez',   email: 'jjrodriguez@cuesto.com.mx', role_code: 'cliente_requisicion', department: 'PRODUCCION' },
  { full_name: 'Luis Ramírez',      email: 'lramirez@cuesto.com.mx',    role_code: 'cliente_requisicion', department: 'SGC' },
  { full_name: 'Ramiro Castañeda',  email: 'rcastaneda@cuesto.com.mx',  role_code: 'autorizador',         department: 'DIRECCION' },
  { full_name: 'Teresa Loera',      email: 'tloera@cuesto.com.mx',      role_code: 'comprador',           department: 'COMPRAS' },
];
const existingEmails = new Set(db.users.map(u => u.email.toLowerCase()));
let userAddCount = 0;
const userNameToId = {};
db.users.forEach(u => userNameToId[u.full_name.toLowerCase().trim()] = u.id);

USERS_TO_ADD.forEach(u => {
  const deptNorm = normDept(u.department);
  const ccId = deptNorm ? deptToCCId[deptNorm] || null : null;
  if (!existingEmails.has(u.email.toLowerCase())) {
    const newUser = {
      id: nextId(db.users),
      full_name: u.full_name,
      email: u.email,
      password_hash: DEFAULT_PASSWORD,
      role_code: u.role_code,
      department: u.department,
      supplier_id: null,
      default_cost_center_id: ccId,
      default_sub_cost_center_id: null,
      active: true,
    };
    db.users.push(newUser);
    userAddCount++;
  }
  const found = db.users.find(usr => usr.email.toLowerCase() === u.email.toLowerCase());
  if (found) userNameToId[u.full_name.toLowerCase().trim()] = found.id;
});
console.log(`Usuarios agregados: ${userAddCount}`);

// Mapas de nombre solicitante → user_id (con variantes ortográficas)
const SOL_NAME_MAP = {
  'adan elías': 'aelias@cuesto.com.mx',
  'adán elías': 'aelias@cuesto.com.mx',
  'angelica almaraz': 'jalmaraz@cuesto.com.mx',
  'efraín coronado': 'ecoronado@cuesto.com.mx',
  'francisco basulto': 'fbasulto@cuesto.com.mx',
  'jesús rodríguez': 'jjrodriguez@cuesto.com.mx',
  'karla g matuz': null,
  'luis ramírez': 'lramirez@cuesto.com.mx',
  'ramiro castañeda': 'rcastaneda@cuesto.com.mx',
  'teresa loera': 'tloera@cuesto.com.mx',
};
function resolveUserId(name) {
  const k = cleanLower(name || '');
  const email = SOL_NAME_MAP[k];
  if (!email) return db.users.find(u => u.role_code === 'cliente_requisicion')?.id || 1;
  return db.users.find(u => u.email.toLowerCase() === email)?.id || null;
}

// ── E. Mapeo de estatus Excel → sistema ──
function mapStatus(excelStatus) {
  const s = cleanLower(excelStatus || '');
  if (s.includes('cerrada') || s.includes('cerrado')) return 'Completada';
  if (s.includes('proceso de entrega') || s.includes('en proceso')) return 'En proceso';
  if (s.includes('cotizacion') || s.includes('cotización')) return 'En cotización';
  if (s.includes('autorizacion') || s.includes('autorización')) return 'En autorización';
  if (s.includes('no autorizada')) return 'Rechazada';
  return 'Enviada';
}

function mapUrgency(excelUrgency) {
  const s = cleanLower(excelUrgency || '');
  if (s.includes('urgente') || s === 'urg') return 'Alto';
  if (s.includes('medio')) return 'Medio';
  if (s.includes('bajo')) return 'Bajo';
  return 'Medio';
}

// ── F. Agrupar filas del Excel por (Semana + Solicitante + Fecha + PO) → 1 requisición ──
// Cada grupo de filas con misma semana+solicitante+fecha = una requisición con múltiples ítems
const reqGroups = {};
allRows.forEach((r, idx) => {
  const semana = r[0] || 0;
  const fecha = r[1];
  const solicitante = clean(r[3]);
  const depto = clean(r[4]);
  const po = clean(r[13]);
  // Clave de agrupación
  const key = `${semana}|${fecha}|${cleanLower(solicitante)}|${cleanLower(depto)}`;
  if (!reqGroups[key]) reqGroups[key] = {
    semana, fecha, solicitante, depto,
    urgency: r[2], status: r[19], po, justificacion: r[12], rows: []
  };
  reqGroups[key].rows.push(r);
  // actualizar status al más "avanzado"
  const cur = mapStatus(reqGroups[key].status);
  const newS = mapStatus(r[19]);
  const order = ['Borrador','Enviada','En cotización','En autorización','En proceso','Completada','Rechazada'];
  if (order.indexOf(newS) > order.indexOf(cur)) reqGroups[key].status = r[19];
});

console.log(`Grupos de requisiciones (históricas): ${Object.keys(reqGroups).length}`);

// ── G. Insertar requisiciones e ítems ──
let reqCount = 0, itemCount = 0;
// Contador de folios por departamento
const folioCounters = {};

Object.values(reqGroups).forEach(g => {
  const deptNorm = normDept(g.depto);
  if (!deptNorm && !g.rows.some(r => clean(r[7]))) return; // skip si no hay depto ni items

  const userId = resolveUserId(g.solicitante);
  const ccId = deptNorm ? deptToCCId[deptNorm] || null : null;
  const status = mapStatus(g.status);
  const urgency = mapUrgency(g.urgency);

  // Generar folio histórico
  const deptCode = DEPT_MAP[deptNorm]?.code?.replace('CC-','') || 'GEN';
  const dateStr = excelDateToISO(g.fecha) || '2025-01-01';
  const year = dateStr.slice(0,4);
  const folioKey = `${deptCode}-${year}`;
  folioCounters[folioKey] = (folioCounters[folioKey] || 0) + 1;
  const folio = `REQ-${deptCode}-${year}-${String(folioCounters[folioKey]).padStart(4,'0')}`;

  const reqId = nextId(db.requisitions);
  const requisition = {
    id: reqId,
    folio,
    requester_user_id: userId,
    request_date: dateStr ? new Date(dateStr + 'T00:00:00.000Z').toISOString() : new Date().toISOString(),
    urgency,
    programmed_date: null,
    department: deptNorm ? DEPT_MAP[deptNorm].name : clean(g.depto),
    cost_center_id: ccId,
    sub_cost_center_id: null,
    status,
    total_amount: 0,
    currency: 'MXN',
    exchange_rate: 1,
    comments: clean(g.justificacion),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.requisitions.push(requisition);
  reqCount++;

  // Ítems de la requisición
  let lineNo = 1;
  let totalAmt = 0;

  g.rows.forEach(r => {
    const desc = clean(r[7]);
    if (!desc) return;
    const descKey = desc.toLowerCase().replace(/\s+/g,' ');
    const quantity = parseFloat(r[5]) || 1;
    const { value: unitCost, currency } = parseCost(r[10]);
    const lineTotal = quantity * unitCost;
    totalAmt += lineTotal;
    const suppId = resolveProvId(r[8]);
    const catItemId = itemNameToId[descKey] || null;
    const unit = normUnit(r[6]);

    // Estatus del ítem según estatus de la requisición
    let itemStatus = status;
    if (status === 'Completada') itemStatus = 'Cerrado';
    else if (status === 'En proceso') itemStatus = 'En proceso';
    else if (status === 'En cotización') itemStatus = 'En cotización';
    else if (status === 'En autorización') itemStatus = 'En autorización';
    else if (status === 'Rechazada') itemStatus = 'Rechazado';
    else itemStatus = 'Enviada';

    const reqItem = {
      id: nextId(db.requisition_items),
      requisition_id: reqId,
      line_no: lineNo++,
      catalog_item_id: catItemId,
      manual_item_name: catItemId ? null : desc,
      supplier_id: suppId,
      quantity,
      unit,
      unit_cost: unitCost,
      currency: currency || 'MXN',
      subtotal: lineTotal,
      cost_center_id: ccId,
      sub_cost_center_id: null,
      status: itemStatus,
      comments: clean(r[12]) || '',
      web_link: null,
      purchase_order_id: null,
      purchase_order_item_id: null,
      cancel_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.requisition_items.push(reqItem);
    itemCount++;
  });

  requisition.total_amount = totalAmt;
});

console.log(`Requisiciones históricas cargadas: ${reqCount}`);
console.log(`Ítems de requisición cargados: ${itemCount}`);

// ── Guardar ──
write(db);
console.log('\n✅ Importación completada exitosamente.');
console.log(`Resumen final:`);
console.log(`  Usuarios:         ${db.users.length}`);
console.log(`  Centros de costo: ${db.cost_centers.length}`);
console.log(`  Proveedores:      ${db.suppliers.length}`);
console.log(`  Ítems catálogo:   ${db.catalog_items.length}`);
console.log(`  Requisiciones:    ${db.requisitions.length}`);
console.log(`  Ítems req:        ${db.requisition_items.length}`);
console.log(`\nContraseña para todos los usuarios nuevos: Demo123*`);
