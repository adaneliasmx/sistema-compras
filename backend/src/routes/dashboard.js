const express = require('express');
const { read } = require('../db');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);

// ── KPIs básicos ──────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = read();
  const role = req.user.role_code;
  const isClient = role === 'cliente_requisicion';
  const isSupplier = role === 'proveedor';
  const isAuthorizer = role === 'autorizador';

  const visibleReqs = isClient
    ? db.requisitions.filter(r => r.requester_user_id === req.user.id)
    : isSupplier ? []
    : isAuthorizer
    ? db.requisitions.filter(r => db.requisition_items.some(i => i.requisition_id === r.id && i.status === 'En autorización'))
    : db.requisitions;

  const visibleItems = isClient
    ? db.requisition_items.filter(i => visibleReqs.some(r => r.id === i.requisition_id))
    : isSupplier
    ? db.purchase_order_items.filter(i => {
        const po = db.purchase_orders.find(p => p.id === i.purchase_order_id);
        return po && po.supplier_id === req.user.supplier_id;
      })
    : db.requisition_items;

  const visiblePOs = isSupplier
    ? db.purchase_orders.filter(po => po.supplier_id === req.user.supplier_id)
    : db.purchase_orders;

  const EXCLUDED = ['Rechazado', 'Cancelado'];
  const activeItems = visibleItems.filter(x => !EXCLUDED.includes(x.status));

  const pending = isSupplier
    ? activeItems.filter(x => x.status === 'En proceso').length
    : isAuthorizer
    ? db.requisition_items.filter(x => x.status === 'En autorización').length
    : activeItems.filter(x => ['En cotización','En autorización','Autorizado','En proceso','Entregado','Facturado','Pago parcial','Enviada'].includes(x.status)).length;

  const recent = visibleReqs.slice().sort((a, b) => b.id - a.id).slice(0, 5).map(r => ({
    ...r,
    requester: (db.users.find(u => u.id === r.requester_user_id) || {}).full_name || '',
    items: db.requisition_items.filter(i => i.requisition_id === r.id).length
  }));

  res.json({
    totalReq: visibleReqs.length,
    totalItems: activeItems.length,
    pending,
    completed: activeItems.filter(x => x.status === 'Cerrado').length,
    poCount: visiblePOs.length,
    recent
  });
});

// ── Datos para gráficas (solo comprador/pagos/admin) ─────────────────────────
router.get('/charts', (req, res) => {
  const db = read();
  const { period = 'month', from, to } = req.query;

  const now = new Date();
  let startDate;
  if (from) {
    startDate = new Date(from);
  } else {
    startDate = new Date(now);
    if (period === 'week') startDate.setDate(now.getDate() - 7 * 12);        // 12 semanas
    else if (period === 'month') startDate.setMonth(now.getMonth() - 11);    // 12 meses
    else startDate.setFullYear(now.getFullYear() - 4);                        // 5 años
  }
  const endDate = to ? new Date(to) : now;

  // Bucket key según período
  const bucketKey = (dateStr) => {
    const d = new Date(dateStr);
    if (isNaN(d) || d < startDate || d > endDate) return null;
    if (period === 'week') {
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const wk = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
    }
    if (period === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return String(d.getFullYear());
  };

  // ── 1. Gasto por centro de costo en el tiempo ────────────────────────────
  const ccMap = {};
  db.requisition_items.forEach(ri => {
    const req = db.requisitions.find(r => r.id === ri.requisition_id);
    if (!req || !req.created_at) return;
    const bk = bucketKey(req.created_at);
    if (!bk) return;
    const cc = db.cost_centers.find(c => c.id === ri.cost_center_id);
    const ccName = cc ? cc.name : 'Sin CC';
    const amount = Number(ri.quantity || 0) * Number(ri.unit_cost || 0);
    if (!ccMap[ccName]) ccMap[ccName] = {};
    ccMap[ccName][bk] = (ccMap[ccName][bk] || 0) + amount;
  });

  // ── 2. Gasto por proveedor en el tiempo ─────────────────────────────────
  const supplierMap = {};
  db.purchase_orders.forEach(po => {
    const bk = bucketKey(po.created_at);
    if (!bk) return;
    const sup = db.suppliers.find(s => s.id === po.supplier_id);
    const supName = sup ? sup.business_name : 'Sin proveedor';
    const amount = Number(po.total_amount || 0);
    if (!supplierMap[supName]) supplierMap[supName] = {};
    supplierMap[supName][bk] = (supplierMap[supName][bk] || 0) + amount;
  });

  // ── 3. Top ítems por gasto ───────────────────────────────────────────────
  const itemTotals = {};
  db.requisition_items.forEach(ri => {
    const req = db.requisitions.find(r => r.id === ri.requisition_id);
    if (!req?.created_at) return;
    const bk = bucketKey(req.created_at);
    if (!bk) return;
    const ci = db.catalog_items.find(c => c.id === ri.catalog_item_id);
    const name = ci ? ci.name : (ri.manual_item_name || 'Sin nombre');
    const amount = Number(ri.quantity || 0) * Number(ri.unit_cost || 0);
    itemTotals[name] = (itemTotals[name] || 0) + amount;
  });
  const topItems = Object.entries(itemTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, total]) => ({ name, total }));

  // ── 4. Órdenes recibidas por semana/período ──────────────────────────────
  const ordersPerPeriod = {};
  db.purchase_orders.forEach(po => {
    const bk = bucketKey(po.created_at);
    if (!bk) return;
    ordersPerPeriod[bk] = (ordersPerPeriod[bk] || 0) + 1;
  });

  // ── 5. Eficiencia por proveedor ──────────────────────────────────────────
  const supplierEfficiency = db.suppliers.map(sup => {
    const supPOs = db.purchase_orders.filter(po => {
      const bk = bucketKey(po.created_at);
      return po.supplier_id === sup.id && bk;
    });
    const total = supPOs.length;
    if (total === 0) return null;

    const delivered = supPOs.filter(po => ['Entregado','Facturada','Cerrada','Pago parcial'].includes(po.status)).length;
    const closed = supPOs.filter(po => po.status === 'Cerrada').length;

    // Tiempo de entrega promedio (días entre created_at y updated_at en POs entregadas)
    const deliveryTimes = supPOs
      .filter(po => ['Entregado','Facturada','Cerrada'].includes(po.status) && po.updated_at && po.created_at)
      .map(po => Math.round((new Date(po.updated_at) - new Date(po.created_at)) / 86400000));

    const avgDeliveryDays = deliveryTimes.length
      ? Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length)
      : null;

    return {
      supplier: sup.business_name,
      total_orders: total,
      pct_delivery: total ? Math.round((delivered / total) * 100) : 0,
      pct_closed: total ? Math.round((closed / total) * 100) : 0,
      avg_delivery_days: avgDeliveryDays
    };
  }).filter(Boolean);

  // ── 6. Seguimiento (%enviadas, %autorizadas, %en PO, %cerradas) ──────────
  const allItems = db.requisition_items;
  const trackTotal = allItems.length || 1;
  const tracking = {
    pct_sent: Math.round(allItems.filter(i => i.status !== 'Borrador').length / trackTotal * 100),
    pct_authorized: Math.round(allItems.filter(i => !['Borrador','En cotización','En autorización'].includes(i.status)).length / trackTotal * 100),
    pct_in_po: Math.round(allItems.filter(i => i.purchase_order_id).length / trackTotal * 100),
    pct_closed: Math.round(allItems.filter(i => i.status === 'Cerrado').length / trackTotal * 100)
  };

  res.json({
    cost_centers: ccMap,
    suppliers: supplierMap,
    top_items: topItems,
    orders_per_period: ordersPerPeriod,
    supplier_efficiency: supplierEfficiency,
    tracking,
    period,
    buckets: generateBuckets(startDate, endDate, period)
  });
});

function generateBuckets(start, end, period) {
  const buckets = [];
  const d = new Date(start);
  while (d <= end) {
    if (period === 'week') {
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const wk = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      buckets.push(`${d.getFullYear()}-W${String(wk).padStart(2, '0')}`);
      d.setDate(d.getDate() + 7);
    } else if (period === 'month') {
      buckets.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      d.setMonth(d.getMonth() + 1);
    } else {
      buckets.push(String(d.getFullYear()));
      d.setFullYear(d.getFullYear() + 1);
    }
  }
  return [...new Set(buckets)];
}

// ── KPI Eficiencia de Compras ─────────────────────────────────────────────────
router.get('/kpi-eficiencia', (req, res) => {
  const db = read();
  const now = new Date();
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function isoWeekNum(date) {
    const d = new Date(date); d.setHours(0,0,0,0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  }
  function isoWeekYearOf(date) {
    const d = new Date(date); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    return d.getFullYear();
  }
  function isoWeekMonday(year, week) {
    const jan4 = new Date(year, 0, 4);
    const dow = (jan4.getDay() + 6) % 7;
    const mon = new Date(jan4); mon.setDate(jan4.getDate() - dow + (week - 1) * 7); mon.setHours(0,0,0,0);
    return mon;
  }

  const curWk = isoWeekNum(now);
  const curWkYear = isoWeekYearOf(now);

  const weeks = Array.from({ length: 8 }, (_, i) => {
    let wk = curWk - i, yr = curWkYear;
    if (wk <= 0) { yr--; wk += isoWeekNum(new Date(yr, 11, 28)); }
    const from = isoWeekMonday(yr, wk);
    const to = new Date(from); to.setDate(to.getDate() + 6); to.setHours(23,59,59,999);
    return { label: `Sem ${wk}`, from, to };
  }).reverse();

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return {
      label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      from: new Date(d.getFullYear(), d.getMonth(), 1),
      to: new Date(d.getFullYear(), d.getMonth() + 1, 1)
    };
  }).reverse();

  const allItems = db.requisition_items || [];
  const allReqs  = db.requisitions || [];

  function buildPeriodData(periods) {
    return periods.map(p => {
      const periodReqs = allReqs.filter(r => {
        if (!r.created_at) return false;
        const d = new Date(r.created_at);
        return d >= p.from && d <= p.to;
      });
      const reqIds = new Set(periodReqs.map(r => r.id));
      const periodItems = allItems.filter(i => reqIds.has(i.requisition_id));

      const solicitados  = periodItems.filter(i => i.status !== 'Borrador').length;
      const cotizacion   = periodItems.filter(i => i.status === 'En cotización').length;
      const autorizacion = periodItems.filter(i => ['Pendiente','En autorización'].includes(i.status)).length;
      const asignados_po = periodItems.filter(i => i.status === 'Autorizado').length;
      const en_entrega   = periodItems.filter(i => i.status === 'Enviada').length;
      const entregados   = periodItems.filter(i => i.status === 'Cerrado').length;
      const rechazados   = periodItems.filter(i => ['Rechazado','Cancelado'].includes(i.status)).length;

      const con_po = asignados_po + en_entrega + entregados;
      const pct_cumplimiento = solicitados > 0 ? Math.round((con_po / solicitados) * 100) : null;

      const FINCADO_ST  = new Set(['Autorizado','Enviada','Cerrado','Rechazado','Cancelado']);
      const ENTREGADO_ST = new Set(['Cerrado','Rechazado','Cancelado']);
      const fincadas = periodReqs.filter(r => {
        const ri = allItems.filter(i => i.requisition_id === r.id);
        return ri.length > 0 && ri.every(i => FINCADO_ST.has(i.status));
      });
      const entregadasReq = fincadas.filter(r => {
        const ri = allItems.filter(i => i.requisition_id === r.id);
        return ri.every(i => ENTREGADO_ST.has(i.status));
      });
      const pct_entregado = fincadas.length > 0 ? Math.round((entregadasReq.length / fincadas.length) * 100) : null;

      return {
        label: p.label,
        pct_entregado, pct_cumplimiento,
        solicitados, cotizacion, autorizacion,
        asignados_po, en_entrega, entregados, rechazados,
        req_fincadas: fincadas.length, req_entregadas: entregadasReq.length
      };
    });
  }

  res.json({
    weeks_labels:  weeks.map(p => p.label),
    months_labels: months.map(p => p.label),
    by_week:  buildPeriodData(weeks),
    by_month: buildPeriodData(months)
  });
});

module.exports = router;
