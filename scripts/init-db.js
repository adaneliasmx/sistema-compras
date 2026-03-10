const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './database/app.json');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const hash = bcrypt.hashSync('Demo123*', 10);
const data = {
  users: [
    { id: 1, full_name: 'Cliente Demo', email: 'cliente@demo.com', password_hash: hash, role_code: 'cliente_requisicion', department: 'MANT', supplier_id: null, default_cost_center_id: 2, default_sub_cost_center_id: 3, active: true },
    { id: 2, full_name: 'Comprador Demo', email: 'comprador@demo.com', password_hash: hash, role_code: 'comprador', department: 'COMPRAS', supplier_id: null, default_cost_center_id: 1, default_sub_cost_center_id: 1, active: true },
    { id: 3, full_name: 'Admin Demo', email: 'admin@demo.com', password_hash: hash, role_code: 'admin', department: 'SISTEMAS', supplier_id: null, default_cost_center_id: 1, default_sub_cost_center_id: 1, active: true },
    { id: 4, full_name: 'Pagos Demo', email: 'pagos@demo.com', password_hash: hash, role_code: 'pagos', department: 'FINANZAS', supplier_id: null, default_cost_center_id: 3, default_sub_cost_center_id: 4, active: true },
    { id: 5, full_name: 'Proveedor Demo', email: 'proveedor@demo.com', password_hash: hash, role_code: 'proveedor', department: 'EXTERNO', supplier_id: 1, active: true },
    { id: 6, full_name: 'Autorizador Demo', email: 'autorizador@demo.com', password_hash: hash, role_code: 'autorizador', department: 'GERENCIA', supplier_id: null, default_cost_center_id: 1, default_sub_cost_center_id: 2, active: true }
  ],
  units: ['pza','kg','litro','tambor','serv','caja','juego'],
  suppliers: [
    { id: 1, provider_code: 'QNO-001', business_name: 'Químicos del Norte', contact_name: 'Ana López', email: 'ana@quimicos.com', phone: '5550001111', active: true },
    { id: 2, provider_code: 'RIN-002', business_name: 'Refacciones Industriales', contact_name: 'Carlos Díaz', email: 'ventas@refacciones.com', phone: '5550002222', active: true },
    { id: 3, provider_code: 'STM-003', business_name: 'Servicios Técnicos MX', contact_name: 'Laura Pérez', email: 'cotizaciones@serviciosmx.com', phone: '5550003333', active: true }
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
    { id: 1, code: 'ITM-001', name: 'Sosa cáustica', item_type: 'uso continuo', unit: 'kg', supplier_id: 1, equivalent_code: '', unit_price: 45, currency: 'MXN', quote_validity_days: 30, active: true, inventoried: true, cost_center_id: 2, sub_cost_center_id: 3 },
    { id: 2, code: 'ITM-002', name: 'Tambor plástico 200L', item_type: 'provisional', unit: 'pza', supplier_id: 1, equivalent_code: '', unit_price: 420, currency: 'MXN', quote_validity_days: 30, active: true, inventoried: false, cost_center_id: 1, sub_cost_center_id: 1 },
    { id: 3, code: 'ITM-003', name: 'Bomba de recirculación', item_type: 'refacción', unit: 'pza', supplier_id: 2, equivalent_code: '', unit_price: 6500, currency: 'USD', quote_validity_days: 15, active: true, inventoried: false, cost_center_id: 2, sub_cost_center_id: 3 },
    { id: 4, code: 'ITM-004', name: 'Servicio de calibración', item_type: 'servicio', unit: 'serv', supplier_id: 3, equivalent_code: '', unit_price: 3800, currency: 'MXN', quote_validity_days: 10, active: true, inventoried: false, cost_center_id: 3, sub_cost_center_id: 4 }
  ],
  inventory_catalogs: [
    { id: 1, name: 'Inventario PTAR', description: '', active: true },
    { id: 2, name: 'Inventario Químicos', description: '', active: true },
    { id: 3, name: 'Inventario Mantenimiento', description: '', active: true }
  ],
  inventory_items: [
    { id: 1, inventory_catalog_id: 2, catalog_item_id: 1, unit: 'kg', min_stock: 100, max_stock: 500, current_stock: 180, active: true }
  ],
  requisitions: [],
  requisition_items: [],
  quotations: [],
  purchase_orders: [],
  purchase_order_items: [],
  invoices: [],
  invoice_items: [],
  payments: [],
  status_history: [],
  settings: { buyer_email: 'compras@demo.com' },
  quotation_requests: [],
  approval_rules: [
    { id: 1, name: 'Auto autorización', min_amount: 0, max_amount: 1000, auto_approve: true, approver_role: null, active: true },
    { id: 2, name: 'Gerencia', min_amount: 1000.01, max_amount: 5000, auto_approve: false, approver_role: 'comprador', active: true },
    { id: 3, name: 'Dirección / pagos', min_amount: 5000.01, max_amount: 999999999, auto_approve: false, approver_role: 'pagos', active: true }
  ]
};

fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
console.log('Base inicial creada en', dbPath);
