const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const { read, write, nextId } = require('../db-validaciones');
const { valAuthRequired, valAllowRoles, syncKeyRequired } = require('../middleware/validaciones-auth');

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contrasena requeridos' });
  const db = read();
  const user = (db.usuarios_val || []).find(u =>
    u.email.toLowerCase() === email.toLowerCase() && u.activo !== false
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }
  const token = jwt.sign(
    { sub: user.id, module: 'validaciones', role: user.role },
    process.env.JWT_SECRET || 'cambia-esta-clave',
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
      Object.assign(existing, rec, { src_id, side, synced_at: nowMxDate() });
      updated++;
    } else {
      db[collectionKey].push({ ...rec, src_id, side, synced_at: nowMxDate() });
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
  const { desde, hasta } = req.query;
  const db = read();

  const filtrarFecha = (arr, campoFecha) => {
    let rows = arr || [];
    if (desde) rows = rows.filter(r => (r[campoFecha] || '') >= desde);
    if (hasta) rows = rows.filter(r => (r[campoFecha] || '') <= hasta);
    return rows;
  };

  const skfEnvios     = filtrarFecha(db.val_skf_envios,      'FECHA ENVIO');
  const skfRecep      = filtrarFecha(db.val_skf_recepciones,  'fecha_recepcion');
  const cuestoEnvios  = filtrarFecha(db.val_cuesto_envios,    'fecha_envio');
  const cuestoIngreso = filtrarFecha(db.val_cuesto_ingresos,  'FECHA DE ESCANEO');

  const skfPend   = (db.val_skf_pendientes   || []).filter(r => r.estado === 'PENDIENTE');
  const cuestoPend = (db.val_cuesto_pendientes || []).filter(r => r.estado === 'PENDIENTE');

  // Piezas enviadas por SKF al almacen CUESTO
  const pzas_skf_enviadas = skfEnvios.reduce((s, r) => s + (Number(r.QTY) || 0), 0);
  const peso_skf_enviado  = skfEnvios.reduce((s, r) => s + (Number(r.PESO) || 0), 0);

  // Piezas PT recibidas en SKF de CUESTO
  const pzas_skf_recibidas = skfRecep.reduce((s, r) => s + (Number(r.cantidad) || 0), 0);

  // Piezas PT enviadas de CUESTO a SKF
  const pzas_cuesto_enviadas = cuestoEnvios.reduce((s, r) => s + (Number(r.cantidad) || 0), 0);

  // Piezas SKF ingresadas en CUESTO
  const pzas_cuesto_ingresadas = cuestoIngreso.reduce((s, r) => s + (Number(r.QTY) || 0), 0);

  // Embarques unicos
  const embarques_skf = new Set(skfEnvios.map(r => r['NUMERO EMBARQUE']).filter(Boolean)).size;
  const embarques_cuesto = new Set(cuestoEnvios.map(r => r.codigo_envio).filter(Boolean)).size;

  res.json({
    skf: {
      pzas_enviadas:   pzas_skf_enviadas,
      peso_enviado_kg: Math.round(peso_skf_enviado * 100) / 100,
      pzas_recibidas:  pzas_skf_recibidas,
      embarques:       embarques_skf,
      pendientes_faltante: skfPend.filter(r => r.tipo === 'FALTANTE').length,
      pendientes_sin_qry:  skfPend.filter(r => r.tipo === 'SIN_QRY').length,
    },
    cuesto: {
      pzas_enviadas:   pzas_cuesto_enviadas,
      pzas_ingresadas: pzas_cuesto_ingresadas,
      embarques:       embarques_cuesto,
      pendientes_faltante: cuestoPend.filter(r => r.tipo === 'FALTANTE').length,
      pendientes_sin_qry:  cuestoPend.filter(r => r.tipo === 'SIN_QRY').length,
    }
  });
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
    version: '4.3.8',
    version_skf: '4.3.8',
    version_cuesto: '4.3.6',
    min_version: '4.2.0',
    url_cuesto: 'https://drive.google.com/uc?export=download&id=1s19Mlqo2L6vUXVd43yAuxW3nRLyTN6TZ',
    url_skf: 'https://drive.google.com/uc?export=download&id=1PztrUGrbFQYLFftRqAYpmvuo2YVjPXQG',
    changelog: 'v4.3.8: Fix layout botones (side=bottom). Barra de progreso en descarga. Ventana maximizada, footer visible. Recepcion PT: Generar Informe, Limpiar Todo, Cambiar embarque, contador N/M, resumen por componente.'
  });
});

module.exports = router;
