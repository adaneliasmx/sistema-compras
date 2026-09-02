const XLSX = require('xlsx');

const SIN_PARTE = 'SIN NUMERO DE PARTE';

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validateDateRange(desde = '', hasta = '') {
  const start = String(desde || '').trim();
  const end = String(hasta || '').trim();
  if (start && !isValidIsoDate(start)) throw new Error('La fecha inicial no es valida (AAAA-MM-DD)');
  if (end && !isValidIsoDate(end)) throw new Error('La fecha final no es valida (AAAA-MM-DD)');
  if (start && end && start > end) throw new Error('La fecha inicial no puede ser posterior a la fecha final');
  return { desde: start, hasta: end };
}

function normalizeQuantity(value) {
  if (typeof value === 'string') value = value.trim().replace(/,/g, '');
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Item field accessors per direction
function getPartNumber(item, esSKF) {
  if (esSKF) return item['NO. SKF'] || item['NO_SKF'] || item.skf || item.SKF || '';
  return item.skf || item.SKF || item['NO. SKF'] || item['NO_SKF'] || '';
}

function getComponente(item, esSKF) {
  return String((esSKF ? item.COMPONENTE : item.componente) || '').trim();
}

function getQty(item, esSKF) {
  return normalizeQuantity(esSKF ? (item.QTY ?? item.cantidad) : (item.cantidad ?? item.QTY));
}

function getItemId(item, esSKF) {
  return String(esSKF ? (item.DISPACH || '') : (item.codigo || '')).trim();
}

function embarqueMatchesDate(embarque, desde, hasta) {
  const fecha = embarque.fecha_envio || '';
  if (!fecha) return !desde && !hasta;
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function embarqueMatchesSearch(embarque, search) {
  if (!search) return true;
  const term = search.toLocaleUpperCase('es-MX');
  const fields = [
    embarque.numero_embarque, embarque.uuid,
    embarque.operador_envio, embarque.operador_recepcion,
  ];
  if (fields.some(f => f && String(f).toLocaleUpperCase('es-MX').includes(term))) return true;
  // Search in items
  const items = embarque.items || [];
  const esSKF = embarque.flujo === 'skf_a_cuesto';
  return items.some(it => {
    const part = getPartNumber(it, esSKF);
    const comp = getComponente(it, esSKF);
    const id = getItemId(it, esSKF);
    return [part, comp, id].some(v => v && String(v).toLocaleUpperCase('es-MX').includes(term));
  });
}

function aggregateFromEmbarques(embarques, flujo, desde, hasta, search) {
  const esSKF = flujo === 'skf_a_cuesto';
  const titulo = esSKF ? 'SKF a CUESTO' : 'CUESTO a SKF';
  const grouped = new Map();

  const relevant = (embarques || []).filter(e =>
    e.flujo === flujo
    && embarqueMatchesDate(e, desde, hasta)
    && embarqueMatchesSearch(e, search)
  );

  for (const emb of relevant) {
    const items = emb.items || [];
    const isValidado = emb.estado === 'VALIDADO';
    const coincidenSet = isValidado
      ? new Set((emb.validacion_detalle?.coinciden || []))
      : new Set();

    for (const it of items) {
      const rawPart = String(getPartNumber(it, esSKF) || SIN_PARTE).trim() || SIN_PARTE;
      const key = rawPart.toLocaleUpperCase('es-MX');
      if (!grouped.has(key)) {
        grouped.set(key, {
          numero_parte: rawPart,
          _componentes: new Set(),
          cantidad_enviada: 0,
          cantidad_recibida: 0,
        });
      }

      const entry = grouped.get(key);
      const comp = getComponente(it, esSKF);
      if (comp) entry._componentes.add(comp);

      const qty = getQty(it, esSKF);
      entry.cantidad_enviada += qty;

      // Recibido = item confirmed in validacion coinciden
      if (isValidado) {
        const itemId = getItemId(it, esSKF);
        if (coincidenSet.has(itemId)) {
          entry.cantidad_recibida += qty;
        }
      }
    }
  }

  const items = Array.from(grouped.values()).map(entry => ({
    numero_parte: entry.numero_parte,
    componente: Array.from(entry._componentes).sort((a, b) => a.localeCompare(b, 'es-MX', { numeric: true })).join(' / '),
    cantidad_enviada: entry.cantidad_enviada,
    cantidad_recibida: entry.cantidad_recibida,
    diferencia: entry.cantidad_recibida - entry.cantidad_enviada,
  })).sort((a, b) => a.numero_parte.localeCompare(b.numero_parte, 'es-MX', { numeric: true }));

  const totals = items.reduce((acc, item) => {
    acc.cantidad_enviada += item.cantidad_enviada;
    acc.cantidad_recibida += item.cantidad_recibida;
    return acc;
  }, { numeros_parte: items.length, cantidad_enviada: 0, cantidad_recibida: 0, diferencia: 0 });
  totals.diferencia = totals.cantidad_recibida - totals.cantidad_enviada;

  return { titulo, items, totals };
}

function buildConsolidatedSummary(db, range = {}) {
  const { desde, hasta } = validateDateRange(range.desde, range.hasta);
  const busqueda = String(range.busqueda || '').trim();
  if (busqueda.length > 120) throw new Error('El filtro de busqueda no puede exceder 120 caracteres');

  const embarques = db.val_embarques || [];

  return {
    desde: desde || null,
    hasta: hasta || null,
    busqueda: busqueda || null,
    criterio_fecha: 'Cada embarque se filtra por su fecha de envio.',
    flujos: {
      skf_a_cuesto: aggregateFromEmbarques(embarques, 'skf_a_cuesto', desde, hasta, busqueda),
      cuesto_a_skf: aggregateFromEmbarques(embarques, 'cuesto_a_skf', desde, hasta, busqueda),
    },
  };
}

function appendFlowSheet(workbook, flow, summary) {
  const period = summary.desde || summary.hasta
    ? `${summary.desde || 'Inicio'} a ${summary.hasta || 'Hoy'}`
    : 'Todas las fechas';
  const rows = [
    [`Resumen consolidado ${flow.titulo}`],
    [`Periodo: ${period}${summary.busqueda ? ` | Filtro: ${summary.busqueda}` : ''}`],
    [`Criterio: ${summary.criterio_fecha}`],
    [],
    ['Numero de parte', 'Componente', 'Cantidad enviada', 'Cantidad recibida', 'Diferencia (recibida - enviada)'],
    ...flow.items.map(item => [
      item.numero_parte,
      item.componente,
      item.cantidad_enviada,
      item.cantidad_recibida,
      item.diferencia,
    ]),
    ['TOTAL', `${flow.totals.numeros_parte} numeros de parte`, flow.totals.cantidad_enviada, flow.totals.cantidad_recibida, flow.totals.diferencia],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 22 }, { wch: 38 }, { wch: 19 }, { wch: 19 }, { wch: 31 }];
  const lastDataRow = Math.max(5, 5 + flow.items.length);
  worksheet['!autofilter'] = { ref: `A5:E${lastDataRow}` };
  XLSX.utils.book_append_sheet(workbook, worksheet, flow.titulo);
}

function buildConsolidatedWorkbookBuffer(summary, direction = 'ambas') {
  const validDirections = ['ambas', 'skf_a_cuesto', 'cuesto_a_skf'];
  if (!validDirections.includes(direction)) throw new Error('Direccion de reporte no valida');
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Resumen consolidado SKF - CUESTO',
    Subject: 'Cantidades enviadas y recibidas por numero de parte',
    Company: 'Corporativo Cuesto',
    CreatedDate: new Date(),
  };
  if (direction === 'ambas' || direction === 'skf_a_cuesto') {
    appendFlowSheet(workbook, summary.flujos.skf_a_cuesto, summary);
  }
  if (direction === 'ambas' || direction === 'cuesto_a_skf') {
    appendFlowSheet(workbook, summary.flujos.cuesto_a_skf, summary);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

module.exports = {
  buildConsolidatedSummary,
  buildConsolidatedWorkbookBuffer,
  validateDateRange,
};
