const XLSX = require('xlsx');

const SIN_PARTE = 'SIN NÚMERO DE PARTE';
const SEARCH_FIELDS = [
  'NO. SKF', 'NO_SKF', 'skf', 'SKF', 'QR SKF', 'QR_SKF', 'qr_skf',
  'DISPACH', 'DISPATCH', 'dispatch', 'dispach',
  'NUMERO EMBARQUE', 'numero_embarque', 'CODIGO ENVIO', 'codigo_envio',
];

const FLUJOS = {
  skf_a_cuesto: {
    titulo: 'SKF a CUESTO',
    enviados: 'val_skf_envios',
    recibidos: 'val_cuesto_ingresos',
    camposEnvio: {
      parte: ['NO. SKF', 'NO_SKF', 'skf', 'SKF'],
      componente: ['COMPONENTE', 'componente'],
      cantidad: ['QTY', 'cantidad'],
      fecha: ['FECHA ENVIO', 'fecha_envio', 'fecha'],
    },
    camposRecepcion: {
      parte: ['NO. SKF', 'NO_SKF', 'skf', 'SKF'],
      componente: ['COMPONENTE', 'componente'],
      cantidad: ['QTY', 'cantidad'],
      fecha: ['FECHA DE ESCANEO', 'fecha_recepcion', 'fecha'],
    },
  },
  cuesto_a_skf: {
    titulo: 'CUESTO a SKF',
    enviados: 'val_cuesto_envios',
    recibidos: 'val_skf_recepciones',
    camposEnvio: {
      parte: ['skf', 'SKF', 'NO. SKF', 'NO_SKF'],
      componente: ['componente', 'COMPONENTE'],
      cantidad: ['cantidad', 'QTY'],
      fecha: ['fecha_envio', 'FECHA ENVIO', 'fecha'],
    },
    camposRecepcion: {
      parte: ['skf', 'SKF', 'NO. SKF', 'NO_SKF'],
      componente: ['componente', 'COMPONENTE'],
      cantidad: ['cantidad', 'QTY'],
      fecha: ['fecha_recepcion', 'FECHA DE ESCANEO', 'fecha'],
    },
  },
};

function firstValue(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function normalizeDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;

  match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;

  if (/^\d{10,13}$/.test(raw)) {
    const millis = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

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
  if (start && !isValidIsoDate(start)) throw new Error('La fecha inicial no es válida (AAAA-MM-DD)');
  if (end && !isValidIsoDate(end)) throw new Error('La fecha final no es válida (AAAA-MM-DD)');
  if (start && end && start > end) throw new Error('La fecha inicial no puede ser posterior a la fecha final');
  return { desde: start, hasta: end };
}

function normalizeQuantity(value) {
  if (typeof value === 'string') value = value.trim().replace(/,/g, '');
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isWithinRange(row, fields, desde, hasta) {
  if (!desde && !hasta) return true;
  const date = normalizeDate(firstValue(row, fields));
  if (!date) return false;
  if (desde && date < desde) return false;
  if (hasta && date > hasta) return false;
  return true;
}

function matchesSearch(row, search) {
  if (!search) return true;
  const term = search.toLocaleUpperCase('es-MX');
  return SEARCH_FIELDS.some(field => {
    const value = row?.[field];
    return value !== undefined && value !== null
      && String(value).toLocaleUpperCase('es-MX').includes(term);
  });
}

function aggregateFlow(db, config, desde, hasta, search) {
  const grouped = new Map();

  const addRows = (rows, fields, quantityField) => {
    for (const row of rows || []) {
      if (!isWithinRange(row, fields.fecha, desde, hasta)) continue;
      if (!matchesSearch(row, search)) continue;

      const rawPart = String(firstValue(row, fields.parte) || SIN_PARTE).trim() || SIN_PARTE;
      const key = rawPart.toLocaleUpperCase('es-MX');
      if (!grouped.has(key)) {
        grouped.set(key, {
          numero_parte: rawPart,
          _componentes: new Set(),
          cantidad_enviada: 0,
          cantidad_recibida: 0,
        });
      }

      const item = grouped.get(key);
      const component = String(firstValue(row, fields.componente) || '').trim();
      if (component) item._componentes.add(component);
      item[quantityField] += normalizeQuantity(firstValue(row, fields.cantidad));
    }
  };

  addRows(db?.[config.enviados], config.camposEnvio, 'cantidad_enviada');
  addRows(db?.[config.recibidos], config.camposRecepcion, 'cantidad_recibida');

  const items = Array.from(grouped.values()).map(item => ({
    numero_parte: item.numero_parte,
    componente: Array.from(item._componentes).sort((a, b) => a.localeCompare(b, 'es-MX', { numeric: true })).join(' / '),
    cantidad_enviada: item.cantidad_enviada,
    cantidad_recibida: item.cantidad_recibida,
    diferencia: item.cantidad_recibida - item.cantidad_enviada,
  })).sort((a, b) => a.numero_parte.localeCompare(b.numero_parte, 'es-MX', { numeric: true }));

  const totals = items.reduce((acc, item) => {
    acc.cantidad_enviada += item.cantidad_enviada;
    acc.cantidad_recibida += item.cantidad_recibida;
    return acc;
  }, { numeros_parte: items.length, cantidad_enviada: 0, cantidad_recibida: 0, diferencia: 0 });
  totals.diferencia = totals.cantidad_recibida - totals.cantidad_enviada;

  return { titulo: config.titulo, items, totals };
}

function buildConsolidatedSummary(db, range = {}) {
  const { desde, hasta } = validateDateRange(range.desde, range.hasta);
  const busqueda = String(range.busqueda || '').trim();
  if (busqueda.length > 120) throw new Error('El filtro de búsqueda no puede exceder 120 caracteres');
  return {
    desde: desde || null,
    hasta: hasta || null,
    busqueda: busqueda || null,
    criterio_fecha: 'Cada movimiento se filtra por su propia fecha de envío o recepción.',
    flujos: {
      skf_a_cuesto: aggregateFlow(db, FLUJOS.skf_a_cuesto, desde, hasta, busqueda),
      cuesto_a_skf: aggregateFlow(db, FLUJOS.cuesto_a_skf, desde, hasta, busqueda),
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
    ['Número de parte', 'Componente', 'Cantidad enviada', 'Cantidad recibida', 'Diferencia (recibida - enviada)'],
    ...flow.items.map(item => [
      item.numero_parte,
      item.componente,
      item.cantidad_enviada,
      item.cantidad_recibida,
      item.diferencia,
    ]),
    ['TOTAL', `${flow.totals.numeros_parte} números de parte`, flow.totals.cantidad_enviada, flow.totals.cantidad_recibida, flow.totals.diferencia],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 22 }, { wch: 38 }, { wch: 19 }, { wch: 19 }, { wch: 31 }];
  const lastDataRow = Math.max(5, 5 + flow.items.length);
  worksheet['!autofilter'] = { ref: `A5:E${lastDataRow}` };
  XLSX.utils.book_append_sheet(workbook, worksheet, flow.titulo);
}

function buildConsolidatedWorkbookBuffer(summary, direction = 'ambas') {
  const validDirections = ['ambas', 'skf_a_cuesto', 'cuesto_a_skf'];
  if (!validDirections.includes(direction)) throw new Error('Dirección de reporte no válida');
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Resumen consolidado SKF - CUESTO',
    Subject: 'Cantidades enviadas y recibidas por número de parte',
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
  normalizeDate,
  validateDateRange,
};
