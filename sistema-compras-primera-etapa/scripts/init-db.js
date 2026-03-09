const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './database/app.json');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const hash = bcrypt.hashSync('Demo123*', 10);
const data = {
  users: [
    { id: 1, full_name: 'Cliente Demo', email: 'cliente@demo.com', password_hash: hash, role_code: 'cliente_requisicion', department: 'MANT', active: true },
    { id: 2, full_name: 'Comprador Demo', email: 'comprador@demo.com', password_hash: hash, role_code: 'comprador', department: 'COMPRAS', active: true },
    { id: 3, full_name: 'Admin Demo', email: 'admin@demo.com', password_hash: hash, role_code: 'admin', department: 'SISTEMAS', active: true }
  ],
  suppliers: [
    { id: 1, provider_code: 'PRV-001', business_name: 'Químicos del Norte', contact_name: 'Ana López', email: 'ana@quimicos.com', phone: '5550001111', active: true },
    { id: 2, provider_code: 'PRV-002', business_name: 'Refacciones Industriales', contact_name: 'Carlos Díaz', email: 'ventas@refacciones.com', phone: '5550002222', active: true },
    { id: 3, provider_code: 'PRV-003', business_name: 'Servicios Técnicos MX', contact_name: 'Laura Pérez', email: 'cotizaciones@serviciosmx.com', phone: '5550003333', active: true }
  ],
  cost_centers: [
    { id: 1, code: 'CC-100', name: 'Producción', active: true },
    { id: 2, code: 'CC-200', name: 'Mantenimiento', active: true },
    { id: 3, code: 'CC-300', name: 'Calidad', active: true }
  ],
  sub_cost_centers: [
    { id: 1, cost_center_id: 1, code: 'SC-101', name: 'Línea 1', active: true },
    { id: 2, cost_center_id: 1, code: 'SC-102', name: 'Línea 2', active: true },
    { id: 3, cost_center_id: 2, code: 'SC-201', name: 'Herramientas', active: true },
    { id: 4, cost_center_id: 3, code: 'SC-301', name: 'Laboratorio', active: true }
  ],
  catalog_items: [
    { id: 1, code: 'ITM-001', name: 'Sosa cáustica', item_type: 'uso continuo', unit: 'kg', active: true },
    { id: 2, code: 'ITM-002', name: 'Tambor plástico 200L', item_type: 'provisional', unit: 'pza', active: true },
    { id: 3, code: 'ITM-003', name: 'Bomba de recirculación', item_type: 'refacción', unit: 'pza', active: true },
    { id: 4, code: 'ITM-004', name: 'Servicio de calibración', item_type: 'servicio', unit: 'serv', active: true }
  ],
  requisitions: [],
  requisition_items: [],
  status_history: []
};

fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
console.log('Base inicial creada en', dbPath);
