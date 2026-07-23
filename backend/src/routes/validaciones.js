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

module.exports = router;
