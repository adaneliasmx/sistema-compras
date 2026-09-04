const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const { read, write, nextId } = require('../db-validaciones');
const { valAuthRequired, valAllowRoles, syncKeyRequired } = require('../middleware/validaciones-auth');
const JWT_SECRET = require('../jwt-secret');
const { createRateLimiter } = require('../rate-limit');
const {
  buildConsolidatedSummary,
  buildConsolidatedWorkbookBuffer,
} = require('../utils/validaciones-consolidado');
const _rl = createRateLimiter();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
    return res.status(400).json({ error: 'Email y contrasena requeridos' });
  const rlKey = `val|${email.toLowerCase()}|${_rl.getIp(req)}`;
  const lim = _rl.check(rlKey);
  if (lim.blocked) return res.status(429).json({ error: `Demasiados intentos. Intenta en ${lim.wait} min.` });
  const db = read();
  const user = (db.usuarios_val || []).find(u =>
    u.email?.toLowerCase() === email.toLowerCase() && u.activo !== false
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    _rl.recordFail(rlKey);
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }
  const token = jwt.sign(
    { sub: user.id, module: 'validaciones', role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role } });
});

router.post('/auth/change-password', valAuthRequired, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Contrasenas requeridas' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Minimo 6 caracteres' });
  const db = read();
  const user = (db.usuarios_val || []).find(u => u.id === req.valUser.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Contrasena actual incorrecta' });
  }
  user.password_hash = bcrypt.hashSync(new_password, 10);
  write(db);
  res.json({ ok: true });
});

// Nota: la gestion de usuarios de este modulo se realiza
// desde el Super Admin (/api/super-admin/unified-users/val-role)

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC — endpoint para la app Python (API key, no JWT)
// ═══════════════════════════════════════════════════════════════════════════════

// Recibe lotes de registros: { side: 'skf'|'cuesto', table: string, records: [...] }
router.post('/sync', syncKeyRequired, (req, res) => {
  const { side, table, records } = req.body;
  if (!side || !table || !Array.isArray(records)) {
    return res.status(400).json({ error: 'side, table y records[] son requeridos' });
  }

  const map = {
    skf_envios:          'val_skf_envios',
    skf_recepcion:       'val_skf_recepciones',
    skf_pendientes:      'val_skf_pendientes',
    cuesto_envios:       'val_cuesto_envios',
    cuesto_ingreso:      'val_cuesto_ingresos',
    cuesto_pendientes:   'val_cuesto_pendientes',
  };

  const collectionKey = map[`${side}_${table}`];
  if (!collectionKey) return res.status(400).json({ error: `Combinacion side/table no reconocida: ${side}/${table}` });

  const db = read();
  db[collectionKey] = db[collectionKey] || [];

  let inserted = 0;
  let updated  = 0;
  for (const rec of records) {
    const src_id = rec.id;
    const existing = db[collectionKey].find(r => r.src_id === src_id && r.side === side);
    if (existing) {
      const safeRec = {};
      for (const k of Object.keys(rec)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        safeRec[k] = rec[k];
      }
      Object.assign(existing, safeRec, { src_id, side, synced_at: nowMxDate() });
      updated++;
    } else {
      const safeRec = {};
      for (const k of Object.keys(rec)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        safeRec[k] = rec[k];
      }
      db[collectionKey].push({ ...safeRec, src_id, side, synced_at: nowMxDate() });
      inserted++;
    }
  }
  write(db);
  res.json({ ok: true, inserted, updated });
});

// Estado de sync (cuantos registros hay por coleccion)
router.get('/sync/status', valAuthRequired, valAllowRoles('admin'), (req, res) => {
  const db = read();
  res.json({
    val_skf_envios:        (db.val_skf_envios || []).length,
    val_skf_recepciones:   (db.val_skf_recepciones || []).length,
    val_skf_pendientes:    (db.val_skf_pendientes || []).length,
    val_cuesto_envios:     (db.val_cuesto_envios || []).length,
    val_cuesto_ingresos:   (db.val_cuesto_ingresos || []).length,
    val_cuesto_pendientes: (db.val_cuesto_pendientes || []).length,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMBARQUES — consulta de movimientos
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/embarques', valAuthRequired, (req, res) => {
  const { side, tipo, desde, hasta, operador, embarque, page = 1, limit = 100 } = req.query;
  const db = read();

  // Construir lista unificada segun filtros
  let rows = [];

  if (!side || side === 'skf') {
    if (!tipo || tipo === 'envios') {
      (db.val_skf_envios || []).forEach(r => rows.push({
        ...r, _side: 'SKF', _tipo: 'Envio almacen SKF → CUESTO'
      }));
    }
    if (!tipo || tipo === 'recepciones') {
      (db.val_skf_recepciones || []).forEach(r => rows.push({
        ...r, _side: 'SKF', _tipo: 'Recepcion PT en SKF'
      }));
    }
  }

  if (!side || side === 'cuesto') {
    if (!tipo || tipo === 'envios') {
      (db.val_cuesto_envios || []).forEach(r => rows.push({
        ...r, _side: 'CUESTO', _tipo: 'Envio PT CUESTO → SKF'
      }));
    }
    if (!tipo || tipo === 'recepciones') {
      (db.val_cuesto_ingresos || []).forEach(r => rows.push({
        ...r, _side: 'CUESTO', _tipo: 'Ingreso SKF en CUESTO'
      }));
    }
  }

  // Filtros
  if (desde)    rows = rows.filter(r => (r['FECHA ENVIO'] || r.fecha_envio || r.fecha || '') >= desde);
  if (hasta)    rows = rows.filter(r => (r['FECHA ENVIO'] || r.fecha_envio || r.fecha || '') <= hasta);
  if (operador) rows = rows.filter(r =>
    (r.OPERADOR || r.operador_envio || r.operador_recepcion || '').toLowerCase().includes(operador.toLowerCase())
  );
  if (embarque) rows = rows.filter(r =>
    (r['NUMERO EMBARQUE'] || r.numero_embarque || r.codigo_envio || '').toLowerCase().includes(embarque.toLowerCase())
  );

  // Ordenar mas reciente primero
  rows.sort((a, b) => {
    const da = a['FECHA ENVIO'] || a.fecha_envio || a.fecha || '';
    const db2 = b['FECHA ENVIO'] || b.fecha_envio || b.fecha || '';
    return db2.localeCompare(da);
  });

  const total = rows.length;
  const start = (Number(page) - 1) * Number(limit);
  const items = rows.slice(start, start + Number(limit));

  res.json({ total, page: Number(page), limit: Number(limit), items });
});

// Detalle de un embarque especifico
router.get('/embarques/:numero', valAuthRequired, (req, res) => {
  const num = req.params.numero.toLowerCase();
  const db = read();
  const result = {
    skf_envios:        (db.val_skf_envios || []).filter(r => (r['NUMERO EMBARQUE'] || r['CODIGO ENVIO'] || '').toLowerCase() === num),
    skf_recepciones:   (db.val_skf_recepciones || []).filter(r => (r.numero_embarque || '').toLowerCase() === num),
    cuesto_envios:     (db.val_cuesto_envios || []).filter(r => (r.codigo_envio || '').toLowerCase() === num),
    cuesto_ingresos:   (db.val_cuesto_ingresos || []).filter(r => (r['DISPACH'] || '').toLowerCase() === num),
  };
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PENDIENTES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/pendientes', valAuthRequired, (req, res) => {
  const { side, tipo, estado, desde, hasta } = req.query;
  const db = read();

  let rows = [];

  if (!side || side === 'skf') {
    (db.val_skf_pendientes || []).forEach(r => rows.push({ ...r, _side: 'SKF' }));
  }
  if (!side || side === 'cuesto') {
    (db.val_cuesto_pendientes || []).forEach(r => rows.push({ ...r, _side: 'CUESTO' }));
  }

  if (tipo)   rows = rows.filter(r => r.tipo === tipo);
  if (estado) rows = rows.filter(r => r.estado === estado);
  if (desde)  rows = rows.filter(r => (r.fecha_deteccion || '') >= desde);
  if (hasta)  rows = rows.filter(r => (r.fecha_deteccion || '') <= hasta);

  rows.sort((a, b) => (b.fecha_deteccion || '').localeCompare(a.fecha_deteccion || ''));

  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESUMEN — KPIs y totales
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/resumen', valAuthRequired, (req, res) => {
  const { periodo } = req.query; // 'hoy' | 'semana' | undefined (todo)
  const db = read();
  const embarques = db.val_embarques || [];

  // Rango de fechas segun periodo
  const hoy = nowMxDate();
  let desde = '', hasta = '';
  if (periodo === 'hoy') {
    desde = hasta = hoy;
  } else if (periodo === 'semana') {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    desde = monday.toISOString().slice(0, 10);
    hasta = hoy;
  }

  let filtered = embarques;
  if (desde) filtered = filtered.filter(e => (e.fecha_envio || '') >= desde);
  if (hasta) filtered = filtered.filter(e => (e.fecha_envio || '') <= hasta);

  const skfACuesto = filtered.filter(e => e.flujo === 'skf_a_cuesto');
  const cuestoASkf = filtered.filter(e => e.flujo === 'cuesto_a_skf');

  function flowStats(list, esSKF) {
    const enviados = list.filter(e => e.estado === 'ENVIADO');
    const validados = list.filter(e => e.estado === 'VALIDADO');
    const pzasEnviadas = list.reduce((s, e) => s + (e.total_piezas || 0), 0);
    let pzasRecibidas = 0;
    for (const emb of validados) {
      const coincidenSet = new Set(emb.validacion_detalle?.coinciden || []);
      for (const it of (emb.items || [])) {
        const itemId = String(esSKF ? (it.DISPACH || '') : (it.codigo || ''));
        if (coincidenSet.has(itemId)) {
          pzasRecibidas += Number(esSKF ? (it.QTY || 0) : (it.cantidad || 0)) || 0;
        }
      }
    }
    return {
      embarques: list.length,
      en_transito: enviados.length,
      validados: validados.length,
      pzas_enviadas: pzasEnviadas,
      pzas_recibidas: pzasRecibidas,
      diferencia: pzasRecibidas - pzasEnviadas,
    };
  }

  const skfPend    = (db.val_skf_pendientes    || []).filter(r => r.estado === 'PENDIENTE');
  const cuestoPend = (db.val_cuesto_pendientes || []).filter(r => r.estado === 'PENDIENTE');

  res.json({
    periodo: periodo || 'todo',
    desde: desde || null,
    hasta: hasta || null,
    skf_a_cuesto: flowStats(skfACuesto, true),
    cuesto_a_skf: flowStats(cuestoASkf, false),
    pendientes: {
      skf_faltante:    skfPend.filter(r => r.tipo === 'FALTANTE').length,
      skf_sin_qry:     skfPend.filter(r => r.tipo === 'SIN_QRY').length,
      cuesto_faltante: cuestoPend.filter(r => r.tipo === 'FALTANTE').length,
      cuesto_sin_qry:  cuestoPend.filter(r => r.tipo === 'SIN_QRY').length,
    },
  });
});

// Resumen bidireccional agrupado por numero de parte, sin separar por embarque.
// Disponible para todos los usuarios autenticados, incluido el perfil SKF.
router.get('/resumen-consolidado/excel', valAuthRequired, (req, res) => {
  try {
    const summary = buildConsolidatedSummary(read(), req.query);
    const direction = req.query.direccion || 'ambas';
    const workbook = buildConsolidatedWorkbookBuffer(summary, direction);
    const period = summary.desde || summary.hasta
      ? `${summary.desde || 'inicio'}_${summary.hasta || 'hoy'}`
      : 'todas-las-fechas';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="resumen-skf-cuesto_${period}.xlsx"`);
    res.send(workbook);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/resumen-consolidado', valAuthRequired, (req, res) => {
  try {
    res.json(buildConsolidatedSummary(read(), req.query));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Detalle de diferencias de un componente, desglosado por fecha/embarque
router.get('/resumen-consolidado/detalle', valAuthRequired, (req, res) => {
  try {
    const { componente, flujo, desde, hasta } = req.query;
    if (!componente || !flujo) return res.status(400).json({ error: 'componente y flujo requeridos' });
    if (!['skf_a_cuesto', 'cuesto_a_skf'].includes(flujo)) return res.status(400).json({ error: 'flujo invalido' });

    const db = read();
    const embarques = db.val_embarques || [];
    const esSKF = flujo === 'skf_a_cuesto';
    const compKey = String(componente).trim().toLocaleUpperCase('es-MX');

    const relevant = embarques.filter(e => {
      if (e.flujo !== flujo) return false;
      const f = e.fecha_envio || '';
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      // Check if this embarque has items of the requested component
      return (e.items || []).some(it => {
        const c = String((esSKF ? it.COMPONENTE : it.componente) || '').trim().toLocaleUpperCase('es-MX');
        return c === compKey;
      });
    });

    const rows = [];
    for (const emb of relevant) {
      const isValidado = emb.estado === 'VALIDADO';
      const coincidenSet = isValidado ? new Set(emb.validacion_detalle?.coinciden || []) : new Set();
      for (const it of (emb.items || [])) {
        const c = String((esSKF ? it.COMPONENTE : it.componente) || '').trim().toLocaleUpperCase('es-MX');
        if (c !== compKey) continue;
        const itemId = String(esSKF ? (it.DISPACH || '') : (it.codigo || ''));
        const qty = Number(esSKF ? (it.QTY || 0) : (it.cantidad || 0)) || 0;
        const recibida = isValidado && coincidenSet.has(itemId) ? qty : 0;
        rows.push({
          fecha: emb.fecha_envio || '',
          embarque: emb.numero_embarque || emb.uuid,
          uuid: emb.uuid,
          estado: emb.estado,
          dispatch: itemId,
          pzas_enviadas: qty,
          pzas_recibidas: recibida,
          diferencia: recibida - qty,
        });
      }
    }

    // Solo devolver filas con diferencia
    const conDiff = rows.filter(r => r.diferencia !== 0);
    conDiff.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.embarque || '').localeCompare(b.embarque || ''));

    res.json({ componente, flujo, items: conDiff });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTES — exportacion de datos filtrados (para descarga CSV/Excel desde UI)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/reporte/embarque/:numero', valAuthRequired, (req, res) => {
  const num = req.params.numero;
  const db = read();

  // Buscar todas las piezas de ese embarque en ambos lados
  const skfE  = (db.val_skf_envios || []).filter(r => r['NUMERO EMBARQUE'] === num || r['CODIGO ENVIO'] === num);
  const skfR  = (db.val_skf_recepciones || []).filter(r => r.numero_embarque === num);
  const cuE   = (db.val_cuesto_envios || []).filter(r => r.codigo_envio === num);
  const cuI   = (db.val_cuesto_ingresos || []).filter(r => r.codigo_envio === num);
  const skfP  = (db.val_skf_pendientes || []).filter(r => r.embarque === num);
  const cuP   = (db.val_cuesto_pendientes || []).filter(r => r.embarque === num);

  const total_enviado_skf  = skfE.reduce((s, r) => s + (Number(r.QTY) || 0), 0);
  const total_recibido_cu  = cuI.reduce((s, r) => s + (Number(r.QTY) || 0), 0);
  const total_enviado_cu   = cuE.reduce((s, r) => s + (Number(r.cantidad) || 0), 0);
  const total_recibido_skf = skfR.reduce((s, r) => s + (Number(r.cantidad) || 0), 0);

  res.json({
    numero_embarque: num,
    flujo_skf_a_cuesto: {
      enviado_skf:    { piezas: total_enviado_skf, registros: skfE },
      recibido_cuesto:{ piezas: total_recibido_cu, registros: cuI  },
      diferencia:     total_enviado_skf - total_recibido_cu,
      pendientes:     cuP
    },
    flujo_cuesto_a_skf: {
      enviado_cuesto: { piezas: total_enviado_cu, registros: cuE  },
      recibido_skf:   { piezas: total_recibido_skf, registros: skfR },
      diferencia:     total_enviado_cu - total_recibido_skf,
      pendientes:     skfP
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMBARQUES ONLINE — registro bidireccional con UUID de trazabilidad
// ═══════════════════════════════════════════════════════════════════════════════

function generarUUID(side, db) {
  const prefix = side === 'cuesto' ? 'EMB-CUE' : 'EMB-SKF';
  const hoy = nowMxDate().replace(/-/g, '');
  const embarques = db.val_embarques || [];
  const hoyPrefix = `${prefix}-${hoy}-`;
  const existentes = embarques.filter(e => e.uuid && e.uuid.startsWith(hoyPrefix));
  const consecutivo = existentes.length + 1;
  return `${hoyPrefix}${String(consecutivo).padStart(3, '0')}`;
}

// Registrar un nuevo embarque (desde app Python al enviar)
router.post('/embarque/registrar', syncKeyRequired, (req, res) => {
  const { side_origen, side_destino, flujo, numero_embarque, operador_envio, items, total_piezas } = req.body;
  if (!side_origen || !side_destino || !numero_embarque || !operador_envio || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Campos requeridos: side_origen, side_destino, numero_embarque, operador_envio, items[]' });
  }

  const db = read();
  db.val_embarques = db.val_embarques || [];
  const id = nextId(db.val_embarques);
  const uuid = generarUUID(side_origen, db);
  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Mexico_City', hour12: false });
  const [fecha, hora] = now.split(', ');

  const embarque = {
    id,
    uuid,
    side_origen,
    side_destino,
    flujo: flujo || `${side_origen}_a_${side_destino}`,
    numero_embarque,
    operador_envio,
    fecha_envio: fecha,
    hora_envio: hora,
    items,
    total_piezas: total_piezas || items.length,
    total_items: items.length,
    estado: 'ENVIADO',
    fecha_recepcion: null,
    operador_recepcion: null,
    resultado_validacion: null,
    anomalias: [],
    created_at: `${fecha}T${hora}`
  };

  db.val_embarques.push(embarque);
  write(db);
  res.json({ ok: true, uuid, id });
});

// Registrar embarque desde dashboard admin (recuperacion manual con Excel)
router.post('/embarque/registrar-admin', valAuthRequired, valAllowRoles('admin'), (req, res) => {
  const { side_origen, side_destino, flujo, numero_embarque, operador_envio, items, total_piezas,
          fecha_original, hora_original } = req.body;
  if (!side_origen || !side_destino || !numero_embarque || !operador_envio || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Campos requeridos: side_origen, side_destino, numero_embarque, operador_envio, items[]' });
  }

  const db = read();
  db.val_embarques = db.val_embarques || [];
  const id = nextId(db.val_embarques);
  const uuid = generarUUID(side_origen, db);
  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Mexico_City', hour12: false });
  const [fechaNow, horaNow] = now.split(', ');
  // Usar fecha/hora original del correo si se proporcionan
  const fecha = fecha_original || fechaNow;
  const hora = hora_original || horaNow;

  const embarque = {
    id,
    uuid,
    side_origen,
    side_destino,
    flujo: flujo || `${side_origen}_a_${side_destino}`,
    numero_embarque,
    operador_envio,
    fecha_envio: fecha,
    hora_envio: hora,
    items,
    total_piezas: total_piezas || items.length,
    total_items: items.length,
    estado: 'ENVIADO',
    fecha_recepcion: null,
    operador_recepcion: null,
    resultado_validacion: null,
    anomalias: [],
    created_at: `${fecha}T${hora}`,
    recuperado_por: req.valUser.nombre || req.valUser.email,
    recuperado_en: `${fechaNow}T${horaNow}`
  };

  db.val_embarques.push(embarque);
  write(db);
  res.json({ ok: true, uuid, id, mensaje: 'Embarque recuperado exitosamente' });
});

// Listar embarques pendientes de recibir (filtrado por side_destino)
router.get('/embarque/pendientes', syncKeyRequired, (req, res) => {
  const { side_destino } = req.query;
  if (!side_destino) return res.status(400).json({ error: 'side_destino requerido (skf|cuesto)' });

  const db = read();
  const pendientes = (db.val_embarques || [])
    .filter(e => e.side_destino === side_destino && e.estado === 'ENVIADO')
    .map(e => ({
      uuid: e.uuid,
      numero_embarque: e.numero_embarque,
      operador_envio: e.operador_envio,
      fecha_envio: e.fecha_envio,
      hora_envio: e.hora_envio,
      total_piezas: e.total_piezas,
      total_items: e.total_items,
      side_origen: e.side_origen
    }))
    .sort((a, b) => (b.fecha_envio || '').localeCompare(a.fecha_envio || ''));

  res.json(pendientes);
});

// Detalle completo de un embarque por UUID
router.get('/embarque/:uuid', syncKeyRequired, (req, res) => {
  const db = read();
  const emb = (db.val_embarques || []).find(e => e.uuid === req.params.uuid);
  if (!emb) return res.status(404).json({ error: 'Embarque no encontrado' });
  res.json(emb);
});

// Consulta rapida de estado (para polling desde el lado emisor)
router.get('/embarque/:uuid/estado', syncKeyRequired, (req, res) => {
  const db = read();
  const emb = (db.val_embarques || []).find(e => e.uuid === req.params.uuid);
  if (!emb) return res.status(404).json({ error: 'Embarque no encontrado' });
  res.json({
    uuid: emb.uuid,
    estado: emb.estado,
    fecha_recepcion: emb.fecha_recepcion,
    operador_recepcion: emb.operador_recepcion,
    resultado_validacion: emb.resultado_validacion,
    anomalias: emb.anomalias || []
  });
});

// Validar/confirmar recepcion de un embarque
router.post('/embarque/:uuid/validar', syncKeyRequired, (req, res) => {
  const { operador_recepcion, resultado, coinciden, faltantes, sobrantes, resueltos_historicos } = req.body;
  if (!operador_recepcion || !resultado) {
    return res.status(400).json({ error: 'operador_recepcion y resultado son requeridos' });
  }

  const db = read();
  const emb = (db.val_embarques || []).find(e => e.uuid === req.params.uuid);
  if (!emb) return res.status(404).json({ error: 'Embarque no encontrado' });

  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Mexico_City', hour12: false });
  const [fecha, hora] = now.split(', ');

  emb.estado = 'VALIDADO';
  emb.fecha_recepcion = fecha;
  emb.hora_recepcion = hora;
  emb.operador_recepcion = operador_recepcion;
  emb.resultado_validacion = resultado;
  emb.validacion_detalle = {
    coinciden: coinciden || [],
    faltantes: faltantes || [],
    sobrantes: sobrantes || [],
    resueltos_historicos: resueltos_historicos || []
  };
  emb.anomalias = (faltantes || []).concat(sobrantes || []);

  write(db);
  res.json({ ok: true, estado: 'VALIDADO' });
});

// ── Embarques online — vista web (JWT auth) ─────────────────────────────────
router.get('/embarques-online', valAuthRequired, (req, res) => {
  const db = read();
  const embarques = (db.val_embarques || []).slice().reverse(); // mas recientes primero
  const { flujo, estado } = req.query;
  let filtered = embarques;
  if (flujo)  filtered = filtered.filter(e => e.flujo === flujo);
  if (estado) filtered = filtered.filter(e => e.estado === estado);
  res.json(filtered.map(e => ({
    uuid: e.uuid, flujo: e.flujo, side_origen: e.side_origen, side_destino: e.side_destino,
    numero_embarque: e.numero_embarque, operador_envio: e.operador_envio,
    fecha_envio: e.fecha_envio, hora_envio: e.hora_envio,
    total_piezas: e.total_piezas, total_items: e.total_items || (e.items||[]).length,
    estado: e.estado,
    operador_recepcion: e.operador_recepcion || null,
    fecha_recepcion: e.fecha_recepcion || null,
    resultado_validacion: e.resultado_validacion || null,
    anomalias_count: (e.anomalias || []).length
  })));
});

router.get('/embarques-online/:uuid', valAuthRequired, (req, res) => {
  const db = read();
  const emb = (db.val_embarques || []).find(e => e.uuid === req.params.uuid);
  if (!emb) return res.status(404).json({ error: 'Embarque no encontrado' });
  res.json(emb);
});

// Eliminar un embarque online (solo admin)
router.delete('/embarques-online/:uuid', valAuthRequired, valAllowRoles('admin'), (req, res) => {
  const db = read();
  const idx = (db.val_embarques || []).findIndex(e => e.uuid === req.params.uuid);
  if (idx === -1) return res.status(404).json({ error: 'Embarque no encontrado' });
  const removed = db.val_embarques.splice(idx, 1)[0];
  write(db);
  res.json({ ok: true, uuid: removed.uuid, mensaje: 'Embarque eliminado' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PENDIENTES — sincronizacion de pendientes desde las apps de escritorio
// ═══════════════════════════════════════════════════════════════════════════════

// Recibe la lista completa de pendientes activos desde una app
router.post('/pendientes/sync', syncKeyRequired, (req, res) => {
  const { side, pendientes } = req.body;
  if (!side || !Array.isArray(pendientes)) {
    return res.status(400).json({ error: 'side y pendientes[] son requeridos' });
  }
  if (!['skf', 'cuesto'].includes(side)) {
    return res.status(400).json({ error: 'side debe ser skf o cuesto' });
  }

  const db = read();
  const key = side === 'skf' ? 'val_skf_pendientes' : 'val_cuesto_pendientes';
  db[key] = pendientes.map(p => ({
    ...p,
    side,
    synced_at: new Date().toISOString()
  }));
  write(db);
  res.json({ ok: true, count: pendientes.length });
});

// Consulta pendientes (para dashboard web)
router.get('/pendientes', valAuthRequired, (req, res) => {
  const db = read();
  const { side } = req.query;
  let result = [];
  if (!side || side === 'skf') {
    result = result.concat((db.val_skf_pendientes || []).map(p => ({ ...p, side: 'skf' })));
  }
  if (!side || side === 'cuesto') {
    result = result.concat((db.val_cuesto_pendientes || []).map(p => ({ ...p, side: 'cuesto' })));
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT — las apps de escritorio reportan que estan en linea
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/app/heartbeat', syncKeyRequired, (req, res) => {
  const { side, version, operador, hostname } = req.body;
  if (!side || !version) {
    return res.status(400).json({ error: 'side y version son requeridos' });
  }

  const db = read();
  db.val_app_status = db.val_app_status || [];

  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Mexico_City', hour12: false });
  const [fecha, hora] = now.split(', ');

  const existing = db.val_app_status.find(a => a.side === side);
  const entry = {
    side,
    version,
    operador: operador || '',
    hostname: hostname || '',
    last_seen: `${fecha}T${hora}`,
    last_seen_date: fecha,
    last_seen_time: hora
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    db.val_app_status.push(entry);
  }

  write(db);
  res.json({ ok: true, server_time: `${fecha} ${hora}` });
});

// Estado de apps conectadas (para dashboard web)
router.get('/app/status', valAuthRequired, (req, res) => {
  const db = read();
  const apps = db.val_app_status || [];

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));

  const result = apps.map(a => {
    const lastSeen = new Date(a.last_seen);
    const diffMs = now - lastSeen;
    const diffMin = Math.floor(diffMs / 60000);
    const online = diffMin < 2;  // online si heartbeat hace menos de 2 min
    return {
      ...a,
      online,
      hace: diffMin < 1 ? 'ahora' : diffMin < 60 ? `hace ${diffMin} min` : `hace ${Math.floor(diffMin/60)}h ${diffMin%60}m`
    };
  });

  res.json(result);
});

// Estado de apps (acceso con API key, para que las apps se vean entre si)
router.get('/app/peers', syncKeyRequired, (req, res) => {
  const db = read();
  const apps = db.val_app_status || [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const result = apps.map(a => {
    const diffMs = now - new Date(a.last_seen);
    return { side: a.side, version: a.version, operador: a.operador, online: diffMs < 120000 };
  });
  res.json(result);
});

// Version de la app (para auto-update)
router.get('/app/version', (req, res) => {
  res.json({
    version: '4.4.0',
    version_skf: '4.4.0',
    version_cuesto: '4.4.0',
    min_version: '4.2.0',
    url_cuesto: 'https://drive.google.com/uc?export=download&id=1s19Mlqo2L6vUXVd43yAuxW3nRLyTN6TZ',
    url_skf: 'https://drive.google.com/uc?export=download&id=1PztrUGrbFQYLFftRqAYpmvuo2YVjPXQG',
    changelog: 'v4.4.0: Boton Reenviar correo en todos los modulos. Dispatch valida 7 digitos con 0 inicial. Fix bug borrar fila individual (re-escaneo bloqueado). Sobrantes enriquecidos al servidor. Sync pendientes automatico. Limpieza tabla QRY al finalizar conciliacion.'
  });
});

module.exports = router;
