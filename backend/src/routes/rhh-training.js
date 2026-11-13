const express = require('express');
const { createHash } = require('crypto');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function nowMxTime() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
}

// Normalizar nombre de puesto (sin acentos, minusculas, espacios simples)
function normPos(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// Extraer codigo base sin revision: "2-PR-08 Rev. 2" → "2-PR-08"
function baseCode(codigo) {
  return (codigo || '').replace(/\s+Rev\.\s*\d+/i, '').trim();
}

// Ignore database IDs when comparing the question bank installed from the seed.
function questionBankHash(questions) {
  const content = questions.map(question => [
    question.texto,
    question.imagen_url || '',
    (question.opciones || []).map(option => [option.texto, option.correcta])
  ]);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

// Buscar quiz por codigo (primero exacto, luego por codigo base)
function findQuizByCode(quizzes, docCodigo) {
  return quizzes.find(q => q.doc_codigo === docCodigo)
    || quizzes.find(q => baseCode(q.doc_codigo) === baseCode(docCodigo));
}

// ── Documentos generales (aplican a TODOS los puestos) ────────────────────────
const DOCS_GENERALES = [
  { codigo: '1-GC-02 Rev. 7', nombre: 'Manual de Calidad Corp. Cuesto', tipo: 'Manual' },
  { codigo: '2-GC-07 Rev. 2', nombre: 'Procedimiento para la medicion del Sistema 5S', tipo: 'Procedimiento' },
  { codigo: '2-RH-01 Rev. 5', nombre: 'Procedimiento de Comunicacion Organizacional', tipo: 'Procedimiento' },
  { codigo: '2-SE-06 Rev. 0', nombre: 'Plan de Atencion a Emergencias de Incendio', tipo: 'Procedimiento' },
  { codigo: '2-SE-08 Rev. 0', nombre: 'Procedimiento de Ingreso para Visitantes y Contratistas', tipo: 'Procedimiento' },
  { codigo: '2-SE-10 Rev. 0', nombre: 'Protocolo de Atencion de Accidentes Laborales', tipo: 'Procedimiento' },
  { codigo: '2-SE-11 Rev. 0', nombre: 'Plan Atencion a Emergencias Electricas', tipo: 'Procedimiento' },
  { codigo: 'LSA 52/53', nombre: 'Ubicacion, Activacion Alarmas y Paros de Emergencia', tipo: 'LSA' },
  { codigo: 'LSA 72', nombre: 'Uso de Tapones Auditivos', tipo: 'LSA' },
  { codigo: '4-SE-06 Rev. 0', nombre: 'Curso de Induccion Seguridad en el Trabajo', tipo: 'Formato' }
];

// ── Seed: Planes de capacitacion por puesto (22 puestos de la matriz SGC) ─────
const TRAINING_PLANS_SEED = [
  {
    puesto_sgc: 'Director General',
    position_names: ['Director General'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-15 Rev. 3', nombre: 'D.P. Director General', tipo: 'DP' },
      { codigo: '2-DG-01 Rev. 4', nombre: 'Procedimiento de Revisiones Directivas', tipo: 'Procedimiento' },
      { codigo: '2-DG-02 Rev. 6', nombre: 'Mapa General de Procesos', tipo: 'Mapa' },
      { codigo: '2-DG-11 Rev. 1', nombre: 'Procedimiento para procesos relacionados con el cliente', tipo: 'Procedimiento' },
      { codigo: '2-DG-12 Rev. 1', nombre: 'Procedimiento Determinacion del Contexto Organizacional', tipo: 'Procedimiento' },
      { codigo: '2-GC-01 Rev. 5', nombre: 'Procedimiento de Informacion Documentada', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-08 Rev. 1', nombre: 'Procedimiento de Gestion de Riesgos', tipo: 'Procedimiento' },
      { codigo: '2-GC-09 Rev. 2', nombre: 'Procedimiento para la Mejora Continua', tipo: 'Procedimiento' },
      { codigo: '2-GC-10 Rev. 2', nombre: 'Procedimiento para la planificacion de los cambios', tipo: 'Procedimiento' }
    ]
  },
  {
    puesto_sgc: 'Gerente de Operaciones',
    position_names: ['Gerente de Operaciones'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-28 Rev. 3', nombre: 'D.P. Gerente de Operaciones', tipo: 'DP' },
      { codigo: '2-DG-01 Rev. 4', nombre: 'Procedimiento de Revisiones Directivas', tipo: 'Procedimiento' },
      { codigo: '2-DG-02 Rev. 6', nombre: 'Mapa General de Procesos', tipo: 'Mapa' },
      { codigo: '2-DG-11 Rev. 1', nombre: 'Procedimiento para procesos relacionados con el cliente', tipo: 'Procedimiento' },
      { codigo: '2-DG-12 Rev. 1', nombre: 'Procedimiento Determinacion del Contexto Organizacional', tipo: 'Procedimiento' },
      { codigo: '2-GC-01 Rev. 5', nombre: 'Procedimiento de Informacion Documentada', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-03 Rev. 3', nombre: 'Procedimiento de Auditorias Internas y de Clientes', tipo: 'Procedimiento' },
      { codigo: '2-GC-06 Rev. 1', nombre: 'Procedimiento de las 8Ds', tipo: 'Procedimiento' },
      { codigo: '2-GC-08 Rev. 1', nombre: 'Procedimiento de Gestion de Riesgos', tipo: 'Procedimiento' },
      { codigo: '2-GC-09 Rev. 2', nombre: 'Procedimiento para la Mejora Continua', tipo: 'Procedimiento' },
      { codigo: '2-GC-10 Rev. 2', nombre: 'Procedimiento para la planificacion de los cambios', tipo: 'Procedimiento' },
      { codigo: '2-CA-07 Rev. 3', nombre: 'Procedimiento de Auditorias LPA', tipo: 'Procedimiento' },
      { codigo: '2-CA-25 Rev. 7', nombre: 'Procedimiento de Producto No Conforme', tipo: 'Procedimiento' }
    ]
  },
  {
    puesto_sgc: 'Ingeniero de Mantenimiento',
    position_names: ['Ingeniero de Mantenimiento'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-23 Rev. 2', nombre: 'D.P. Ingeniero de Mantenimiento', tipo: 'DP' },
      { codigo: '2-MA-01 Rev. 7', nombre: 'Procedimiento de Mantenimiento a Infraestructura y Maquinaria', tipo: 'Procedimiento' },
      { codigo: '2-DG-04 Rev. 6', nombre: 'Mapa del Proceso de Mantenimiento', tipo: 'Mapa' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-08 Rev. 1', nombre: 'Procedimiento de Gestion de Riesgos', tipo: 'Procedimiento' },
      { codigo: '2-GC-10 Rev. 2', nombre: 'Procedimiento para la planificacion de los cambios', tipo: 'Procedimiento' },
      { codigo: '2-SE-01 Rev. 0', nombre: 'Procedimiento Seguridad Investigacion de Accidentes', tipo: 'Procedimiento' },
      { codigo: '2-SE-05 Rev. 0', nombre: 'Procedimiento Seguridad Revision y Mtto. Maquinaria', tipo: 'Procedimiento' },
      { codigo: '4-MA-49 Rev. 0', nombre: 'POE Registro Ordenes Mtto. en Modulo', tipo: 'POE' },
      { codigo: '4-MA-50 Rev. 0', nombre: 'POE Flujo Paros Produccion-Mantenimiento', tipo: 'POE' },
      { codigo: 'LSA 11', nombre: 'Falla de Energia Electrica', tipo: 'LSA' },
      { codigo: 'LSA 76', nombre: 'Deshabilitado de Fusibles', tipo: 'LSA' },
      { codigo: 'LSA 79', nombre: 'Uso de Compresores', tipo: 'LSA' },
      { codigo: 'LSA 94', nombre: 'Encendido de Resistencias', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Ingeniero de Procesos',
    position_names: ['Ingeniero de Procesos'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-08 Rev. 5', nombre: 'D.P. Ingeniero de Procesos', tipo: 'DP' },
      { codigo: '2-DG-09 Rev. 5', nombre: 'Mapa del Proceso de Produccion Diaria y Kanban', tipo: 'Mapa' },
      { codigo: '2-PR-03 Rev. 7', nombre: 'Procedimiento del Proceso de Fosfatado', tipo: 'Procedimiento' },
      { codigo: '2-PR-06 Rev. 2', nombre: 'Procedimiento de Carga y Descarga Linea Baker', tipo: 'Procedimiento' },
      { codigo: '2-PR-08 Rev. 2', nombre: 'Procedimiento de Preparacion y Recuperacion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-PR-11 Rev. 4', nombre: 'Procedimiento de Titulaciones de Soluciones de Fosfato', tipo: 'Procedimiento' },
      { codigo: '2-CA-33 Rev. 0', nombre: 'Procedimiento de Nuevos Modelos', tipo: 'Procedimiento' },
      { codigo: '2-CA-36 Rev. 4', nombre: 'Procedimiento de Ajuste y Concentracion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-06 Rev. 1', nombre: 'Procedimiento de las 8Ds', tipo: 'Procedimiento' },
      { codigo: '2-GC-10 Rev. 2', nombre: 'Procedimiento para la planificacion de los cambios', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' },
      { codigo: '1-CA-03 Rev. 2', nombre: 'Manual de Fallas Visuales Fosfato de Manganeso', tipo: 'Manual' },
      { codigo: '1-CA-04 Rev. 1', nombre: 'Manual de Fallas Visuales Amsted', tipo: 'Manual' },
      { codigo: 'LSA 86', nombre: 'Soluciones de Problemas de Fosfatado', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Administrador de Recursos Humanos',
    position_names: ['Recursos Humanos', 'Administrador de Recursos Humanos'],
    position_ids: [16],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-24 Rev. 0', nombre: 'D.P. Administrador de Recursos Humanos', tipo: 'DP' },
      { codigo: '2-DG-03 Rev. 6', nombre: 'Mapa del Proceso de Recursos Humanos', tipo: 'Mapa' },
      { codigo: '2-RH-01 Rev. 5', nombre: 'Procedimiento de Comunicacion Organizacional', tipo: 'Procedimiento' },
      { codigo: '2-RH-02 Rev. 3', nombre: 'Procedimiento de Capacitacion y Entrenamiento', tipo: 'Procedimiento' },
      { codigo: '2-RH-03 Rev. 2', nombre: 'Procedimiento de Evaluacion del Desempeno', tipo: 'Procedimiento' },
      { codigo: '2-RH-04 Rev. 2', nombre: 'Procedimiento de Medicion del Clima Laboral', tipo: 'Procedimiento' },
      { codigo: '2-RH-05 Rev. 2', nombre: 'Procedimiento de Reclutamiento, Seleccion y Contratacion', tipo: 'Procedimiento' },
      { codigo: '2-RH-42 Rev. 1', nombre: 'Procedimiento de Onboarding y Entrenamiento Inicial', tipo: 'Procedimiento' },
      { codigo: '2-RH-43 Rev. 0', nombre: 'Procedimiento de Renuncias y Bajas de Personal', tipo: 'Procedimiento' },
      { codigo: '2-GC-01 Rev. 5', nombre: 'Procedimiento de Informacion Documentada', tipo: 'Procedimiento' }
    ]
  },
  {
    puesto_sgc: 'Ingeniero de Calidad',
    position_names: ['Ingeniero de Calidad'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-11 Rev. 0', nombre: 'D.P. Ingeniero de Calidad', tipo: 'DP' },
      { codigo: '2-DG-13 Rev. 4', nombre: 'Mapa del Proceso de Calidad', tipo: 'Mapa' },
      { codigo: '2-DG-07 Rev. 5', nombre: 'Mapa del Proceso de Inspeccion Recibo', tipo: 'Mapa' },
      { codigo: '2-CA-05 Rev. 5', nombre: 'Procedimiento de Retrabajos y Rechazos', tipo: 'Procedimiento' },
      { codigo: '2-CA-06 Rev. 9', nombre: 'Procedimiento de Recibo de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-CA-07 Rev. 3', nombre: 'Procedimiento de Auditorias LPA', tipo: 'Procedimiento' },
      { codigo: '2-CA-25 Rev. 7', nombre: 'Procedimiento de Producto No Conforme', tipo: 'Procedimiento' },
      { codigo: '2-CA-33 Rev. 0', nombre: 'Procedimiento de Nuevos Modelos', tipo: 'Procedimiento' },
      { codigo: '2-CA-36 Rev. 4', nombre: 'Procedimiento de Ajuste y Concentracion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-CA-40 Rev. 0', nombre: 'Procedimiento de Liberacion e Inspeccion de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-CA-41 Rev. 0', nombre: 'Procedimiento para el Manejo de Sustancias Quimicas', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-03 Rev. 3', nombre: 'Procedimiento de Auditorias Internas y de Clientes', tipo: 'Procedimiento' },
      { codigo: '2-GC-06 Rev. 1', nombre: 'Procedimiento de las 8Ds', tipo: 'Procedimiento' },
      { codigo: '2-GC-08 Rev. 1', nombre: 'Procedimiento de Gestion de Riesgos', tipo: 'Procedimiento' },
      { codigo: '2-GC-09 Rev. 2', nombre: 'Procedimiento para la Mejora Continua', tipo: 'Procedimiento' },
      { codigo: '2-GC-10 Rev. 2', nombre: 'Procedimiento para la planificacion de los cambios', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' },
      { codigo: '1-CA-02 Rev. 1', nombre: 'Cero Defectos', tipo: 'Manual' },
      { codigo: '1-CA-03 Rev. 2', nombre: 'Manual de Fallas Visuales Fosfato de Manganeso', tipo: 'Manual' },
      { codigo: '1-CA-04 Rev. 1', nombre: 'Manual de Fallas Visuales Amsted', tipo: 'Manual' }
    ]
  },
  {
    puesto_sgc: 'Administrador de SGC',
    position_names: ['Administrador SGC', 'Administrador de Sistema de Gestion de Calidad'],
    position_ids: [15],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-17 Rev. 2', nombre: 'D.P. Administrador SGC', tipo: 'DP' },
      { codigo: '2-DG-05 Rev. 6', nombre: 'Mapa del Proceso de Gestion de Calidad', tipo: 'Mapa' },
      { codigo: '2-DG-02 Rev. 6', nombre: 'Mapa General de Procesos', tipo: 'Mapa' },
      { codigo: '2-GC-01 Rev. 5', nombre: 'Procedimiento de Informacion Documentada', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-03 Rev. 3', nombre: 'Procedimiento de Auditorias Internas y de Clientes', tipo: 'Procedimiento' },
      { codigo: '2-GC-06 Rev. 1', nombre: 'Procedimiento de las 8Ds', tipo: 'Procedimiento' },
      { codigo: '2-GC-07 Rev. 2', nombre: 'Procedimiento para la medicion del Sistema 5S', tipo: 'Procedimiento' },
      { codigo: '2-GC-08 Rev. 1', nombre: 'Procedimiento de Gestion de Riesgos', tipo: 'Procedimiento' },
      { codigo: '2-GC-09 Rev. 2', nombre: 'Procedimiento para la Mejora Continua', tipo: 'Procedimiento' },
      { codigo: '2-GC-10 Rev. 2', nombre: 'Procedimiento para la planificacion de los cambios', tipo: 'Procedimiento' },
      { codigo: '2-CA-07 Rev. 3', nombre: 'Procedimiento de Auditorias LPA', tipo: 'Procedimiento' },
      { codigo: '2-DG-01 Rev. 4', nombre: 'Procedimiento de Revisiones Directivas', tipo: 'Procedimiento' },
      { codigo: '2-DG-12 Rev. 1', nombre: 'Determinacion del Contexto Organizacional', tipo: 'Procedimiento' }
    ]
  },
  {
    puesto_sgc: 'Administrador de Compras',
    position_names: ['Administrador de Compras'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-46 Rev. 0', nombre: 'D.P. Administrador de Compras', tipo: 'DP' },
      { codigo: '2-DG-17 Rev. 1', nombre: 'Mapa del Proceso de Compras', tipo: 'Mapa' },
      { codigo: '2-CO-01 Rev. 6', nombre: 'Procedimiento de Compras', tipo: 'Procedimiento' },
      { codigo: '2-RH-18 Rev. 5', nombre: 'Procedimiento de Seleccion y Evaluacion de Proveedores', tipo: 'Procedimiento' },
      { codigo: '2-GC-01 Rev. 5', nombre: 'Procedimiento de Informacion Documentada', tipo: 'Procedimiento' },
      { codigo: '4-CO-07 Rev. 0', nombre: 'POE Llenado y Seguimiento de Requisiciones de Compras', tipo: 'POE' },
      { codigo: '4-PR-38 Rev. 0', nombre: 'POE Resumen de Quimicos e Insumos Inventariados', tipo: 'POE' }
    ]
  },
  {
    puesto_sgc: 'Administrador de Seguridad y Medio Ambiente',
    position_names: ['Coordinador de Seguridad', 'Administrador de Seguridad y Medio Ambiente'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-31 Rev. 2', nombre: 'D.P. Coordinador de Seguridad, Higiene y Medio Ambiente', tipo: 'DP' },
      { codigo: '2-DG-16 Rev. 2', nombre: 'Mapa del Proceso de Seguridad y MA', tipo: 'Mapa' },
      { codigo: '2-SE-01 Rev. 0', nombre: 'Procedimiento Seguridad Investigacion de Accidentes', tipo: 'Procedimiento' },
      { codigo: '2-SE-02 Rev. 0', nombre: 'Procedimiento de Residuos de Manejo Especial y Peligrosos', tipo: 'Procedimiento' },
      { codigo: '2-SE-03 Rev. 0', nombre: 'Procedimiento de Manejo y Control de Scrap', tipo: 'Procedimiento' },
      { codigo: '2-SE-04 Rev. 0', nombre: 'Procedimiento de Planta de Tratamiento de Agua Residual', tipo: 'Procedimiento' },
      { codigo: '2-SE-05 Rev. 0', nombre: 'Procedimiento Seguridad Revision y Mtto. Maquinaria', tipo: 'Procedimiento' },
      { codigo: '2-SE-06 Rev. 0', nombre: 'Plan de Atencion a Emergencias de Incendio', tipo: 'Procedimiento' },
      { codigo: '2-SE-08 Rev. 0', nombre: 'Procedimiento de Ingreso para Visitantes y Contratistas', tipo: 'Procedimiento' },
      { codigo: '2-SE-10 Rev. 0', nombre: 'Protocolo de Atencion de Accidentes Laborales', tipo: 'Procedimiento' },
      { codigo: '2-SE-11 Rev. 0', nombre: 'Plan Atencion a Emergencias Electricas', tipo: 'Procedimiento' },
      { codigo: '2-CA-41 Rev. 0', nombre: 'Procedimiento para el Manejo de Sustancias Quimicas', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-08 Rev. 1', nombre: 'Procedimiento de Gestion de Riesgos', tipo: 'Procedimiento' },
      { codigo: 'LSA 42', nombre: 'Tarimas de Quimicos', tipo: 'LSA' },
      { codigo: 'LSA 44', nombre: 'Preparacion de Polimeros para PTAR', tipo: 'LSA' },
      { codigo: 'LSA 47', nombre: 'Identificacion de Tambos de Lodos', tipo: 'LSA' },
      { codigo: 'LSA 61', nombre: 'Registro SCRAP', tipo: 'LSA' },
      { codigo: 'LSA 64', nombre: 'PTAR', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Coordinador de Produccion',
    position_names: ['Jefe de area', 'Jefe de área', 'Coordinador de Produccion', 'Coordinador de Producción'],
    position_ids: [17],
    eval_group: 'Coordinador de Produccion',
    documentos: [
      { codigo: '2-RH-26 Rev. 4', nombre: 'D.P. Coordinador de Produccion', tipo: 'DP' },
      { codigo: '2-DG-09 Rev. 5', nombre: 'Mapa del Proceso de Produccion Diaria y Kanban', tipo: 'Mapa' },
      { codigo: '2-PR-01 Rev. 1', nombre: 'Procedimiento de Flujo de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-PR-02 Rev. 1', nombre: 'Procedimiento de Preservacion de Producto', tipo: 'Procedimiento' },
      { codigo: '2-PR-03 Rev. 7', nombre: 'Procedimiento del Proceso de Fosfatado', tipo: 'Procedimiento' },
      { codigo: '2-PR-04 Rev. 1', nombre: 'Procedimiento de Equipo Vacio', tipo: 'Procedimiento' },
      { codigo: '2-PR-06 Rev. 2', nombre: 'Procedimiento de Carga y Descarga Linea Baker', tipo: 'Procedimiento' },
      { codigo: '2-PR-07 Rev. 0', nombre: 'Procedimiento de Entrega de Material a Biblioteca', tipo: 'Procedimiento' },
      { codigo: '2-PR-08 Rev. 2', nombre: 'Procedimiento de Preparacion y Recuperacion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-PR-09 Rev. 1', nombre: 'Procedimiento de Empaque', tipo: 'Procedimiento' },
      { codigo: '2-PR-11 Rev. 4', nombre: 'Procedimiento de Titulaciones de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-CA-05 Rev. 5', nombre: 'Procedimiento de Retrabajos y Rechazos', tipo: 'Procedimiento' },
      { codigo: '2-CA-25 Rev. 7', nombre: 'Procedimiento de Producto No Conforme', tipo: 'Procedimiento' },
      { codigo: '2-CA-36 Rev. 4', nombre: 'Procedimiento de Ajuste y Concentracion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' }
    ]
  },
  {
    puesto_sgc: 'Coordinador de Inventarios',
    position_names: ['Coordinador de Inventarios'],
    position_ids: [],
    eval_group: 'Auxiliar de Almacen',
    documentos: [
      { codigo: '2-RH-45 Rev. 0', nombre: 'D.P. Coordinador de Inventarios', tipo: 'DP' },
      { codigo: '2-DG-08 Rev. 4', nombre: 'Mapa del Proceso de Kanban y Entregas al Cliente', tipo: 'Mapa' },
      { codigo: '2-PR-01 Rev. 1', nombre: 'Procedimiento de Flujo de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-PR-02 Rev. 1', nombre: 'Procedimiento de Preservacion de Producto', tipo: 'Procedimiento' },
      { codigo: '2-CA-06 Rev. 9', nombre: 'Procedimiento de Recibo de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-CA-19 Rev. 2', nombre: 'Procedimiento de Entrega al Cliente', tipo: 'Procedimiento' },
      { codigo: '4-PR-28 Rev. 2', nombre: 'POE Recepcion y Registro Mat. SKF en LOLA', tipo: 'POE' },
      { codigo: '4-PR-29 Rev. 0', nombre: 'POE Flujo de Materiales TENNECO', tipo: 'POE' },
      { codigo: '4-PR-32 Rev. 0', nombre: 'POE Registro de Material Proceso AMSTED', tipo: 'POE' },
      { codigo: '4-PR-43 Rev. 0', nombre: 'POE Consolidacion y Envio Embarques SKF', tipo: 'POE' },
      { codigo: 'LSA 18', nombre: 'Ubicacion Material Sleeve en Almacen', tipo: 'LSA' },
      { codigo: 'LSA 22', nombre: 'Uso de Montacargas', tipo: 'LSA' },
      { codigo: 'LSA 48', nombre: 'Identificacion de FIFO Etiquetas', tipo: 'LSA' },
      { codigo: 'LSA 50', nombre: 'Recibo de Materiales Amsted', tipo: 'LSA' },
      { codigo: 'LSA 51', nombre: 'Impresion Query Almacen', tipo: 'LSA' },
      { codigo: 'LSA 60', nombre: 'Flujo de Materiales Amsted', tipo: 'LSA' },
      { codigo: 'LSA 75', nombre: 'Estibado de Material Terminado Almacen', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Coordinador de SGC',
    position_names: ['Coordinador SGC', 'Coordinador de SGC'],
    position_ids: [],
    eval_group: 'STAFF',
    documentos: [
      { codigo: '2-RH-37 Rev. 0', nombre: 'D.P. Coordinador de SGC', tipo: 'DP' },
      { codigo: '2-DG-05 Rev. 6', nombre: 'Mapa del Proceso de Gestion de Calidad', tipo: 'Mapa' },
      { codigo: '2-GC-01 Rev. 5', nombre: 'Procedimiento de Informacion Documentada', tipo: 'Procedimiento' },
      { codigo: '2-GC-02 Rev. 6', nombre: 'Procedimiento de Acciones Correctivas y de Mejora', tipo: 'Procedimiento' },
      { codigo: '2-GC-03 Rev. 3', nombre: 'Procedimiento de Auditorias Internas y de Clientes', tipo: 'Procedimiento' },
      { codigo: '2-GC-06 Rev. 1', nombre: 'Procedimiento de las 8Ds', tipo: 'Procedimiento' },
      { codigo: '2-GC-07 Rev. 2', nombre: 'Procedimiento para la medicion del Sistema 5S', tipo: 'Procedimiento' },
      { codigo: '2-GC-08 Rev. 1', nombre: 'Procedimiento de Gestion de Riesgos', tipo: 'Procedimiento' },
      { codigo: '2-GC-09 Rev. 2', nombre: 'Procedimiento para la Mejora Continua', tipo: 'Procedimiento' },
      { codigo: '2-GC-10 Rev. 2', nombre: 'Procedimiento para la planificacion de los cambios', tipo: 'Procedimiento' },
      { codigo: '2-CA-07 Rev. 3', nombre: 'Procedimiento de Auditorias LPA', tipo: 'Procedimiento' },
      { codigo: '2-CA-25 Rev. 7', nombre: 'Procedimiento de Producto No Conforme', tipo: 'Procedimiento' }
    ]
  },
  {
    puesto_sgc: 'Supervisor de Produccion',
    position_names: ['Supervisor', 'Supervisor de Produccion', 'Supervisor de Produccion AMSTED'],
    position_ids: [11, 30, 31],
    eval_group: 'Supervisor de Turno',
    documentos: [
      { codigo: '2-PR-01 Rev. 1', nombre: 'Procedimiento de Flujo de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-PR-02 Rev. 1', nombre: 'Procedimiento de Preservacion de Producto', tipo: 'Procedimiento' },
      { codigo: '2-PR-03 Rev. 7', nombre: 'Procedimiento del Proceso de Fosfatado', tipo: 'Procedimiento' },
      { codigo: '2-PR-06 Rev. 2', nombre: 'Procedimiento de Carga y Descarga Linea Baker', tipo: 'Procedimiento' },
      { codigo: '2-PR-07 Rev. 0', nombre: 'Procedimiento de Entrega de Material a Biblioteca', tipo: 'Procedimiento' },
      { codigo: '2-PR-09 Rev. 1', nombre: 'Procedimiento de Empaque', tipo: 'Procedimiento' },
      { codigo: '2-CA-05 Rev. 5', nombre: 'Procedimiento de Retrabajos y Rechazos', tipo: 'Procedimiento' },
      { codigo: '2-CA-25 Rev. 7', nombre: 'Procedimiento de Producto No Conforme', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' },
      { codigo: '1-CA-04 Rev. 1', nombre: 'Manual de Fallas Visuales Amsted', tipo: 'Manual' }
    ]
  },
  {
    puesto_sgc: 'Tecnico de Mantenimiento',
    position_names: ['Tecnico de mantenimiento', 'Técnico de mantenimiento'],
    position_ids: [13],
    eval_group: 'Tecnico de Mantenimiento',
    documentos: [
      { codigo: '2-RH-12 Rev. 4', nombre: 'D.P. Tecnico de Mantenimiento', tipo: 'DP' },
      { codigo: '2-MA-01 Rev. 7', nombre: 'Procedimiento de Mantenimiento a Infraestructura y Maquinaria', tipo: 'Procedimiento' },
      { codigo: '2-SE-05 Rev. 0', nombre: 'Procedimiento Seguridad Revision y Mtto. Maquinaria', tipo: 'Procedimiento' },
      { codigo: '4-MA-49 Rev. 0', nombre: 'POE Registro Ordenes Mtto. en Modulo', tipo: 'POE' },
      { codigo: '4-MA-50 Rev. 0', nombre: 'POE Flujo Paros Produccion-Mantenimiento', tipo: 'POE' },
      { codigo: '3-PR-35 Rev. 0', nombre: 'IT Llenado de Solicitud de Mtto', tipo: 'IT' },
      { codigo: 'LSA 11', nombre: 'Falla de Energia Electrica', tipo: 'LSA' },
      { codigo: 'LSA 65', nombre: 'Llenado Correcto de Solicitud de Mantenimiento', tipo: 'LSA' },
      { codigo: 'LSA 76', nombre: 'Deshabilitado de Fusibles', tipo: 'LSA' },
      { codigo: 'LSA 79', nombre: 'Uso de Compresores', tipo: 'LSA' },
      { codigo: 'LSA 94', nombre: 'Encendido de Resistencias', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Operador de Fosfatado',
    position_names: [
      'Operador de Fosfatado', 'Operador de fosfatado', 'Fosfatador',
      'Fosfatador 1', 'Fosfatador 2', 'Fosfatador 3', 'Fosfatador Baker',
      'Operador Linea 1', 'Operador Linea 3', 'Operador linea BAKER',
      'Operador Linea Baker', 'Operador', 'operador Capacitador',
      'Entrenamiento operador Linea 4'
    ],
    position_ids: [4, 5, 6, 7, 18, 19, 20, 21, 24, 26, 29],
    eval_group: 'Fosfatador',
    documentos: [
      { codigo: '2-RH-10 Rev. 2', nombre: 'D.P. Operador de Fosfatado', tipo: 'DP' },
      { codigo: '2-PR-03 Rev. 7', nombre: 'Procedimiento del Proceso de Fosfatado', tipo: 'Procedimiento' },
      { codigo: '2-PR-06 Rev. 2', nombre: 'Procedimiento de Carga y Descarga Linea Baker', tipo: 'Procedimiento' },
      { codigo: '2-PR-08 Rev. 2', nombre: 'Procedimiento de Preparacion y Recuperacion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-CA-36 Rev. 4', nombre: 'Procedimiento de Ajuste y Concentracion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-CA-41 Rev. 0', nombre: 'Procedimiento para el Manejo de Sustancias Quimicas', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' },
      { codigo: '1-CA-03 Rev. 2', nombre: 'Manual de Fallas Visuales Fosfato de Manganeso', tipo: 'Manual' },
      { codigo: '3-PR-02 Rev. 1', nombre: 'Instructivo de Operacion Linea Baker', tipo: 'Instructivo' },
      { codigo: '3-PR-04 Rev. 2', nombre: 'Instructivo de Operacion Linea 1', tipo: 'Instructivo' },
      { codigo: '3-PR-44 Rev. 0', nombre: 'IT Fosfatado Linea 3', tipo: 'IT' },
      { codigo: '3-PR-45 Rev. 0', nombre: 'Instructivo de Operacion Linea 3', tipo: 'Instructivo' },
      { codigo: '4-CA-163 Rev. 0', nombre: 'POE Arranque Linea 4', tipo: 'POE' },
      { codigo: '4-CA-164 Rev. 0', nombre: 'POE Encendido Resistencias L4', tipo: 'POE' },
      { codigo: '4-CA-165 Rev. 0', nombre: 'POE Encendido de Linea 4', tipo: 'POE' },
      { codigo: '4-CA-166 Rev. 0', nombre: 'POE Operacion Linea 3', tipo: 'POE' },
      { codigo: 'LSA 04', nombre: 'Recuperacion Desengrase Baker', tipo: 'LSA' },
      { codigo: 'LSA 07', nombre: 'Concentracion de Sello', tipo: 'LSA' },
      { codigo: 'LSA 10', nombre: 'Bombas Dosificadoras', tipo: 'LSA' },
      { codigo: 'LSA 13', nombre: 'Concentracion de Tanques', tipo: 'LSA' },
      { codigo: 'LSA 16', nombre: 'Recirculacion de Solucion', tipo: 'LSA' },
      { codigo: 'LSA 55', nombre: 'Carga Componente Amsted', tipo: 'LSA' },
      { codigo: 'LSA 58', nombre: 'Operacion Linea 1 y Manejo de Gruas', tipo: 'LSA' },
      { codigo: 'LSA 62', nombre: 'Llenado de Porrones para Adicion', tipo: 'LSA' },
      { codigo: 'LSA 73', nombre: 'Cambio de Canastas Linea Baker', tipo: 'LSA' },
      { codigo: 'LSA 86', nombre: 'Soluciones de Problemas de Fosfatado', tipo: 'LSA' },
      { codigo: 'LSA 94', nombre: 'Encendido de Resistencias', tipo: 'LSA' },
      { codigo: 'LSA 96', nombre: 'Operacion Secadores Automaticos', tipo: 'LSA' },
      { codigo: '3-PR-32 Rev. 0', nombre: 'Programacion de Canastas en Linea Baker', tipo: 'IT' }
    ]
  },
  {
    puesto_sgc: 'Inspector de Calidad',
    position_names: ['Inspector de calidad', 'Inspector de Calidad'],
    position_ids: [10],
    eval_group: 'Inspector de Calidad',
    documentos: [
      { codigo: '2-RH-47 Rev. 0', nombre: 'D.P. Inspector de Calidad', tipo: 'DP' },
      { codigo: '2-CA-05 Rev. 5', nombre: 'Procedimiento de Retrabajos y Rechazos', tipo: 'Procedimiento' },
      { codigo: '2-CA-25 Rev. 7', nombre: 'Procedimiento de Producto No Conforme', tipo: 'Procedimiento' },
      { codigo: '2-CA-36 Rev. 4', nombre: 'Procedimiento de Ajuste y Concentracion de Soluciones', tipo: 'Procedimiento' },
      { codigo: '2-CA-40 Rev. 0', nombre: 'Procedimiento de Liberacion e Inspeccion de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-PR-11 Rev. 4', nombre: 'Procedimiento de Titulaciones de Soluciones', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' },
      { codigo: '1-CA-02 Rev. 1', nombre: 'Cero Defectos', tipo: 'Manual' },
      { codigo: '1-CA-03 Rev. 2', nombre: 'Manual de Fallas Visuales Fosfato de Manganeso', tipo: 'Manual' },
      { codigo: '1-CA-04 Rev. 1', nombre: 'Manual de Fallas Visuales Amsted', tipo: 'Manual' },
      { codigo: '4-CA-162 Rev. 0', nombre: 'POE Inspeccion Piezas Amsted', tipo: 'POE' },
      { codigo: '3-PR-16 Rev. 0', nombre: 'IT Rugosimetro', tipo: 'IT' },
      { codigo: '3-PR-17 Rev. 0', nombre: 'IT Analizador de Humedad', tipo: 'IT' },
      { codigo: 'LSA 01', nombre: 'Rugosimetro', tipo: 'LSA' },
      { codigo: 'LSA 03', nombre: 'Identificacion de Muestra de Grasa', tipo: 'LSA' },
      { codigo: 'LSA 17', nombre: 'Revision de Material Sandblasteado', tipo: 'LSA' },
      { codigo: 'LSA 23', nombre: 'Revision de Plan de Control', tipo: 'LSA' },
      { codigo: 'LSA 39', nombre: 'Termobalanza', tipo: 'LSA' },
      { codigo: 'LSA 57', nombre: 'Empaque e Inspeccion Amsted', tipo: 'LSA' },
      { codigo: 'LSA 92', nombre: 'Criterios Inspeccion Pitting Material AMSTED', tipo: 'LSA' },
      { codigo: 'LSA 97', nombre: 'Validacion de Material Terminado AMSTED', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Auxiliar de Empaque',
    position_names: ['Aux. Empaque', 'Empacador', 'Auxiliar de Empaque'],
    position_ids: [3, 27],
    eval_group: 'Operador de Empaque',
    documentos: [
      { codigo: '2-RH-09 Rev. 2', nombre: 'D.P. Auxiliar de Empaque', tipo: 'DP' },
      { codigo: '2-PR-09 Rev. 1', nombre: 'Procedimiento de Empaque', tipo: 'Procedimiento' },
      { codigo: '2-PR-07 Rev. 0', nombre: 'Procedimiento de Entrega de Material a Biblioteca', tipo: 'Procedimiento' },
      { codigo: '2-CA-19 Rev. 2', nombre: 'Procedimiento de Entrega al Cliente', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' },
      { codigo: '1-CA-04 Rev. 1', nombre: 'Manual de Fallas Visuales Amsted', tipo: 'Manual' },
      { codigo: 'LSA 08', nombre: 'Identificaciones de Material en Proceso', tipo: 'LSA' },
      { codigo: 'LSA 46', nombre: 'Restricciones Control Cajas de Carton', tipo: 'LSA' },
      { codigo: 'LSA 57', nombre: 'Empaque e Inspeccion Amsted', tipo: 'LSA' },
      { codigo: 'LSA 67', nombre: 'Flujo de Material Terminado AMSTED', tipo: 'LSA' },
      { codigo: 'LSA 70', nombre: 'Acomodo de Piezas en Cajas y Camas', tipo: 'LSA' },
      { codigo: 'LSA 85', nombre: 'Empaque Provisional ASM Caja', tipo: 'LSA' },
      { codigo: 'LSA 91', nombre: 'Sujecion en Transporte', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Auxiliar de Almacen',
    position_names: [
      'Aux. de almacen SKF', 'Aux. de almacen Amsted', 'Auxiliar de almacen AMSTED',
      'Auxiliar almacen capacitacion', 'Auxiliar de almacen', 'Auxiliar Almacen',
      'Auxiliar de Almacen'
    ],
    position_ids: [1, 2, 22, 23, 25, 28],
    eval_group: 'Auxiliar de Almacen',
    documentos: [
      { codigo: '2-RH-07 Rev. 2', nombre: 'D.P. Auxiliar de Almacen', tipo: 'DP' },
      { codigo: '2-CA-06 Rev. 9', nombre: 'Procedimiento de Recibo de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-CA-19 Rev. 2', nombre: 'Procedimiento de Entrega al Cliente', tipo: 'Procedimiento' },
      { codigo: '2-PR-01 Rev. 1', nombre: 'Procedimiento de Flujo de Materiales', tipo: 'Procedimiento' },
      { codigo: '2-PR-02 Rev. 1', nombre: 'Procedimiento de Preservacion de Producto', tipo: 'Procedimiento' },
      { codigo: '3-PR-34 Rev. 0', nombre: 'IT Recibo y Envio de Materiales en Almacen (MES)', tipo: 'IT' },
      { codigo: '3-PR-48 Rev. 0', nombre: 'IT Recibo y Validacion Materiales AMSTED', tipo: 'IT' },
      { codigo: '4-PR-28 Rev. 2', nombre: 'POE Recepcion y Registro Mat. SKF en LOLA', tipo: 'POE' },
      { codigo: '4-PR-29 Rev. 0', nombre: 'POE Flujo de Materiales TENNECO', tipo: 'POE' },
      { codigo: '4-PR-43 Rev. 0', nombre: 'POE Consolidacion y Envio Embarques SKF', tipo: 'POE' },
      { codigo: 'LSA 18', nombre: 'Ubicacion Material Sleeve en Almacen', tipo: 'LSA' },
      { codigo: 'LSA 22', nombre: 'Uso de Montacargas', tipo: 'LSA' },
      { codigo: 'LSA 48', nombre: 'Identificacion de FIFO Etiquetas', tipo: 'LSA' },
      { codigo: 'LSA 50', nombre: 'Recibo de Materiales Amsted', tipo: 'LSA' },
      { codigo: 'LSA 51', nombre: 'Impresion Query Almacen', tipo: 'LSA' },
      { codigo: 'LSA 75', nombre: 'Estibado de Material Terminado Almacen', tipo: 'LSA' },
      { codigo: 'LSA 77', nombre: 'Apagado de Luces', tipo: 'LSA' },
      { codigo: 'LSA 80', nombre: 'Ingreso y Registro de Gondola', tipo: 'LSA' },
      { codigo: 'LSA 84', nombre: 'Carga Montacargas', tipo: 'LSA' },
      { codigo: 'LSA 93', nombre: 'Rechazo de Contenedores', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Auxiliar de Equipo Vacio',
    position_names: ['Aux. de equipo vacio', 'Aux. de equipo vacío', 'Auxiliar de Equipo Vacio'],
    position_ids: [8],
    eval_group: 'Equipo Vacio',
    documentos: [
      { codigo: '2-RH-21 Rev. 4', nombre: 'D.P. Auxiliar de Equipo Vacio', tipo: 'DP' },
      { codigo: '2-PR-04 Rev. 1', nombre: 'Procedimiento de Equipo Vacio', tipo: 'Procedimiento' },
      { codigo: '2-PR-01 Rev. 1', nombre: 'Procedimiento de Flujo de Materiales', tipo: 'Procedimiento' },
      { codigo: '3-CA-08 Rev. 1', nombre: 'IT Retirar Etiquetas y Limpieza de Cunetes', tipo: 'IT' },
      { codigo: '3-CA-09 Rev. 0', nombre: 'IT Limpieza de Cajas Kan Ban', tipo: 'IT' },
      { codigo: '3-CA-10 Rev. 0', nombre: 'IT Limpieza de Tinas Azules', tipo: 'IT' },
      { codigo: '3-CA-15 Rev. 0', nombre: 'IT Limpieza Carros de Cabina', tipo: 'IT' },
      { codigo: 'LSA 00', nombre: 'Limpieza de Tinas Azules', tipo: 'LSA' },
      { codigo: 'LSA 21', nombre: 'Modelos de Tinas', tipo: 'LSA' },
      { codigo: 'LSA 59', nombre: 'Etiquetado Area de Limpieza y Equipo Vacio', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Auxiliar de Calidad',
    position_names: ['Aux. de calidad', 'Auxiliar de Calidad'],
    position_ids: [9],
    eval_group: 'Auxiliar de Calidad',
    documentos: [
      { codigo: '2-RH-14 Rev. 6', nombre: 'D.P. Auxiliar de Calidad', tipo: 'DP' },
      { codigo: '2-CA-05 Rev. 5', nombre: 'Procedimiento de Retrabajos y Rechazos', tipo: 'Procedimiento' },
      { codigo: '2-CA-25 Rev. 7', nombre: 'Procedimiento de Producto No Conforme', tipo: 'Procedimiento' },
      { codigo: '2-CA-40 Rev. 0', nombre: 'Procedimiento de Liberacion e Inspeccion de Materiales', tipo: 'Procedimiento' },
      { codigo: '1-CA-01 Rev. 3', nombre: 'Manual de Fallas Visuales', tipo: 'Manual' },
      { codigo: '1-CA-02 Rev. 1', nombre: 'Cero Defectos', tipo: 'Manual' },
      { codigo: '1-CA-03 Rev. 2', nombre: 'Manual de Fallas Visuales Fosfato de Manganeso', tipo: 'Manual' },
      { codigo: '1-CA-04 Rev. 1', nombre: 'Manual de Fallas Visuales Amsted', tipo: 'Manual' },
      { codigo: '3-PR-16 Rev. 0', nombre: 'IT Rugosimetro', tipo: 'IT' },
      { codigo: '3-PR-17 Rev. 0', nombre: 'IT Analizador de Humedad', tipo: 'IT' },
      { codigo: 'LSA 01', nombre: 'Rugosimetro', tipo: 'LSA' },
      { codigo: 'LSA 03', nombre: 'Identificacion de Muestra de Grasa', tipo: 'LSA' },
      { codigo: 'LSA 17', nombre: 'Revision de Material Sandblasteado', tipo: 'LSA' },
      { codigo: 'LSA 23', nombre: 'Revision de Plan de Control', tipo: 'LSA' },
      { codigo: 'LSA 39', nombre: 'Termobalanza', tipo: 'LSA' },
      { codigo: 'LSA 92', nombre: 'Criterios Inspeccion Pitting', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Operador de PTAR',
    position_names: ['Operador PTAR', 'Operador de PTAR'],
    position_ids: [12],
    eval_group: 'Operador PTAR',
    documentos: [
      { codigo: '2-RH-13 Rev. 6', nombre: 'D.P. Operador Planta de Tratamiento', tipo: 'DP' },
      { codigo: '2-SE-04 Rev. 0', nombre: 'Procedimiento de Planta de Tratamiento de Agua Residual', tipo: 'Procedimiento' },
      { codigo: '2-SE-02 Rev. 0', nombre: 'Procedimiento de Residuos de Manejo Especial y Peligrosos', tipo: 'Procedimiento' },
      { codigo: '3-PR-01 Rev. 3', nombre: 'Instructivo de Planta de Tratamiento', tipo: 'Instructivo' },
      { codigo: '3-PR-39 Rev. 0', nombre: 'Instructivo Manual de Usuario Control pH en PTA', tipo: 'Instructivo' },
      { codigo: '3-SE-02 Rev. 0', nombre: 'IT Retrolavado Filtros PTAR', tipo: 'IT' },
      { codigo: 'LSA 44', nombre: 'Preparacion de Polimeros para PTAR', tipo: 'LSA' },
      { codigo: 'LSA 47', nombre: 'Identificacion de Tambos de Lodos', tipo: 'LSA' },
      { codigo: 'LSA 64', nombre: 'PTAR', tipo: 'LSA' }
    ]
  },
  {
    puesto_sgc: 'Auxiliar de Limpieza',
    position_names: ['Aux. limpieza', 'Auxiliar de Limpieza', 'Auxiliar de Intendencia'],
    position_ids: [14],
    eval_group: 'Intendencia',
    documentos: [
      { codigo: '2-RH-22 Rev. 4', nombre: 'D.P. Auxiliar de Intendencia', tipo: 'DP' },
      { codigo: '2-SE-02 Rev. 0', nombre: 'Procedimiento de Residuos de Manejo Especial y Peligrosos', tipo: 'Procedimiento' },
      { codigo: 'LSA 42', nombre: 'Tarimas de Quimicos', tipo: 'LSA' },
      { codigo: 'LSA 59', nombre: 'Etiquetado Area de Limpieza y Equipo Vacio', tipo: 'LSA' },
      { codigo: 'LSA 77', nombre: 'Apagado de Luces en Produccion y Almacen', tipo: 'LSA' }
    ]
  }
];

// ── Helper: Encontrar plan de capacitacion para un empleado ──────────────────
function findPlanForEmp(plans, emp, positions) {
  if (!emp) return null;
  const pos = positions.find(p => p.id === emp.position_id);
  const empPosName = pos ? normPos(pos.name) : '';
  for (const plan of plans) {
    if (plan.position_ids.includes(emp.position_id)) return plan;
    for (const pn of (plan.position_names || [])) {
      if (normPos(pn) === empPosName) return plan;
    }
  }
  return null;
}

// ── Middleware ────────────────────────────────────────────────────────────────
router.use(rhhAuthRequired);

// ══════════════════════════════════════════════════════════════════════════════
// PLANES DE CAPACITACION
// ══════════════════════════════════════════════════════════════════════════════

// GET /plans — listar planes
router.get('/plans', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const plans = db.rhh_training_plans || [];
  res.json(plans);
});

// POST /plans/seed — cargar planes semilla desde la matriz SGC
router.post('/plans/seed', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  if (!db.rhh_training_plans) db.rhh_training_plans = [];
  let added = 0, updated = 0;
  const revisionUpdates = new Map([
    ['2-GC-07 Rev. 1', '2-GC-07 Rev. 2'],
    ['2-GC-08 Rev. 0', '2-GC-08 Rev. 1'],
    ['2-RH-18 Rev. 4', '2-RH-18 Rev. 5'],
    ['2-MA-01 Rev. 6', '2-MA-01 Rev. 7'],
    ['2-RH-02 Rev. 2', '2-RH-02 Rev. 3'],
    ['2-RH-03 Rev. 1', '2-RH-03 Rev. 2'],
    ['2-RH-42 Rev. 0', '2-RH-42 Rev. 1'],
    ['3-PR-04 Rev. 1', '3-PR-04 Rev. 2']
  ]);
  // Update only the specified document revisions; preserve other plan edits.
  for (const plan of db.rhh_training_plans) {
    let changed = false;
    for (const docs of [plan.documentos, plan.docs_generales]) {
      if (!Array.isArray(docs)) continue;
      for (const doc of docs) {
        const revision = revisionUpdates.get(doc.codigo);
        if (revision) { doc.codigo = revision; changed = true; }
      }
    }
    if (changed) updated++;
  }
  for (const seed of TRAINING_PLANS_SEED) {
    const exists = db.rhh_training_plans.find(p => normPos(p.puesto_sgc) === normPos(seed.puesto_sgc));
    if (!exists) {
      db.rhh_training_plans.push({
        id: nextId(db.rhh_training_plans),
        ...seed,
        docs_generales: DOCS_GENERALES,
        created_at: nowMxDate()
      });
      added++;
    }
  }
  if (added > 0 || updated > 0) await write(db);
  res.json({ ok: true, added, updated, total: db.rhh_training_plans.length });
});

// GET /plans/:id — detalle de un plan
router.get('/plans/:id', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const plan = (db.rhh_training_plans || []).find(p => p.id === Number(req.params.id));
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
  res.json(plan);
});

// ══════════════════════════════════════════════════════════════════════════════
// CUESTIONARIOS (BANCO DE PREGUNTAS)
// ══════════════════════════════════════════════════════════════════════════════

// GET /quizzes — listar cuestionarios (resumen)
router.get('/quizzes', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const quizzes = (db.rhh_training_quizzes || []).map(q => ({
    id: q.id,
    doc_codigo: q.doc_codigo,
    doc_nombre: q.doc_nombre,
    doc_tipo: q.doc_tipo,
    total_preguntas: (q.preguntas || []).length,
    created_at: q.created_at
  }));
  res.json(quizzes);
});

// GET /quizzes/excel-all — Descargar TODOS los cuestionarios en un ZIP
router.get('/quizzes/excel-all', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const XLSX = require('xlsx');
  const { ZipArchive } = require('archiver');
  const db = await read();
  const quizzes = db.rhh_training_quizzes || [];
  if (quizzes.length === 0) return res.status(404).json({ error: 'No hay cuestionarios' });

  res.setHeader('Content-Disposition', 'attachment; filename="cuestionarios_capacitacion.zip"');
  res.setHeader('Content-Type', 'application/zip');

  const archive = new ZipArchive({ zlib: { level: 5 } });
  archive.pipe(res);

  for (const quiz of quizzes) {
    const rows = (quiz.preguntas || []).map((p, i) => {
      const correcta = (p.opciones || []).find(o => o.correcta);
      const incorrectas = (p.opciones || []).filter(o => !o.correcta);
      return {
        '#': i + 1,
        'Pregunta': p.texto,
        'Respuesta Correcta': correcta ? correcta.texto : '',
        'Validacion (SI/NO)': '',
        'Correccion': '',
        'Imagen URL': p.imagen_url || '',
        'Incorrecta 1': incorrectas[0] ? incorrectas[0].texto : '',
        'Incorrecta 2': incorrectas[1] ? incorrectas[1].texto : '',
        'Incorrecta 3': incorrectas[2] ? incorrectas[2].texto : '',
        'Incorrecta 4': incorrectas[3] ? incorrectas[3].texto : '',
        'Incorrecta 5': incorrectas[4] ? incorrectas[4].texto : ''
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 4 }, { wch: 60 }, { wch: 50 }, { wch: 14 }, { wch: 50 }, { wch: 30 },
      { wch: 45 }, { wch: 45 }, { wch: 45 }, { wch: 45 }, { wch: 45 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cuestionario');
    const meta = XLSX.utils.json_to_sheet([{
      doc_codigo: quiz.doc_codigo, doc_nombre: quiz.doc_nombre,
      doc_tipo: quiz.doc_tipo || '', quiz_id: quiz.id,
      total_preguntas: (quiz.preguntas || []).length
    }]);
    XLSX.utils.book_append_sheet(wb, meta, 'Info');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    wb.Sheets = {};
    const safeName = (quiz.doc_nombre || '').replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').substring(0, 80);
    const safeCode = quiz.doc_codigo.replace(/\s+/g, '_').replace(/[\/\\:*?"<>|]/g, '-');
    const fname = `${safeCode}_${safeName}.xlsx`;
    archive.append(buf, { name: fname });
  }

  archive.finalize();
});

// GET /quizzes/:id — cuestionario completo (con preguntas)
router.get('/quizzes/:id', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const quiz = (db.rhh_training_quizzes || []).find(q => q.id === Number(req.params.id));
  if (!quiz) return res.status(404).json({ error: 'Cuestionario no encontrado' });
  res.json(quiz);
});

// POST /quizzes — crear/importar cuestionario
router.post('/quizzes', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  if (!db.rhh_training_quizzes) db.rhh_training_quizzes = [];
  const { doc_codigo, doc_nombre, doc_tipo, preguntas } = req.body;
  if (!doc_codigo || !doc_nombre || !preguntas || !Array.isArray(preguntas)) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  // Asignar IDs a preguntas
  const numbered = preguntas.map((p, i) => ({ ...p, id: i + 1 }));
  const quiz = {
    id: nextId(db.rhh_training_quizzes),
    doc_codigo,
    doc_nombre,
    doc_tipo: doc_tipo || 'Procedimiento',
    preguntas: numbered,
    created_at: nowMxDate()
  };
  db.rhh_training_quizzes.push(quiz);
  await write(db);
  res.json({ ok: true, id: quiz.id, total_preguntas: numbered.length });
});

// POST /quizzes/bulk — importar multiples cuestionarios de golpe
router.post('/quizzes/bulk', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  if (!db.rhh_training_quizzes) db.rhh_training_quizzes = [];
  const { quizzes } = req.body;
  if (!Array.isArray(quizzes)) return res.status(400).json({ error: 'Se espera array quizzes' });
  let added = 0;
  for (const q of quizzes) {
    if (!q.doc_codigo || !q.preguntas) continue;
    const exists = db.rhh_training_quizzes.find(x => x.doc_codigo === q.doc_codigo);
    if (exists) continue;
    const numbered = (q.preguntas || []).map((p, i) => ({ ...p, id: i + 1 }));
    db.rhh_training_quizzes.push({
      id: nextId(db.rhh_training_quizzes),
      doc_codigo: q.doc_codigo,
      doc_nombre: q.doc_nombre || q.doc_codigo,
      doc_tipo: q.doc_tipo || 'Procedimiento',
      preguntas: numbered,
      created_at: nowMxDate()
    });
    added++;
  }
  if (added > 0) await write(db);
  res.json({ ok: true, added, total: db.rhh_training_quizzes.length });
});

// POST /quizzes/seed — cargar cuestionarios semilla desde archivo
router.post('/quizzes/seed', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  if (!db.rhh_training_quizzes) db.rhh_training_quizzes = [];
  let seedData;
  try {
    const seedPath = require('path').join(__dirname, '../../data/quizzes-seed.json');
    seedData = JSON.parse(require('fs').readFileSync(seedPath, 'utf8'));
  } catch (e) {
    return res.status(500).json({ error: 'No se encontro archivo quizzes-seed.json' });
  }
  const quizzes = Array.isArray(seedData) ? seedData : seedData.quizzes || [];
  let added = 0, updated = 0;
  for (const q of quizzes) {
    if (!q.doc_codigo || !q.preguntas) continue;
    const exists = db.rhh_training_quizzes.find(x => x.doc_codigo === q.doc_codigo)
      || db.rhh_training_quizzes.find(x => baseCode(x.doc_codigo) === baseCode(q.doc_codigo));
    if (exists) {
      const installed = exists.preguntas || [];
      const previousHashes = [
        ...(q.revisiones_anteriores_sha256 || []),
        q.revision_anterior_sha256
      ].filter(Boolean);
      const replacesPreviousText = previousHashes.length > 0
        && baseCode(exists.doc_codigo) === baseCode(q.doc_codigo)
        && installed.length === q.preguntas.length
        && previousHashes.includes(questionBankHash(installed));
      const expandsSameRevision = exists.doc_codigo === q.doc_codigo && q.preguntas.length > installed.length;
      const seedHash = questionBankHash(q.preguntas);
      const contentChanged = seedHash !== questionBankHash(installed);
      const forceSync = req.body.force === true && contentChanged;
      if (expandsSameRevision || replacesPreviousText || forceSync) {
        exists.preguntas = q.preguntas.map((p, i) => ({ ...p, id: i + 1 }));
        if (replacesPreviousText) exists.doc_codigo = q.doc_codigo;
        exists.doc_nombre = q.doc_nombre || exists.doc_nombre;
        exists.doc_tipo = q.doc_tipo || exists.doc_tipo;
        updated++;
      }
      continue;
    }
    const numbered = (q.preguntas || []).map((p, i) => ({ ...p, id: i + 1 }));
    db.rhh_training_quizzes.push({
      id: nextId(db.rhh_training_quizzes),
      doc_codigo: q.doc_codigo,
      doc_nombre: q.doc_nombre || q.doc_codigo,
      doc_tipo: q.doc_tipo || 'Procedimiento',
      preguntas: numbered,
      created_at: nowMxDate()
    });
    added++;
  }
  if (added > 0 || updated > 0) await write(db);
  res.json({ ok: true, added, updated, total: db.rhh_training_quizzes.length });
});

// PATCH /quizzes/:id — editar preguntas de un cuestionario
router.patch('/quizzes/:id', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  const quiz = (db.rhh_training_quizzes || []).find(q => q.id === Number(req.params.id));
  if (!quiz) return res.status(404).json({ error: 'Cuestionario no encontrado' });
  if (req.body.preguntas) {
    quiz.preguntas = req.body.preguntas.map((p, i) => ({ ...p, id: i + 1 }));
  }
  if (req.body.doc_nombre) quiz.doc_nombre = req.body.doc_nombre;
  if (req.body.doc_tipo) quiz.doc_tipo = req.body.doc_tipo;
  await write(db);
  res.json({ ok: true, total_preguntas: quiz.preguntas.length });
});

// GET /quizzes/:id/excel — Exportar cuestionario a Excel
router.get('/quizzes/:id/excel', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const XLSX = require('xlsx');
  const db = await read();
  const quiz = (db.rhh_training_quizzes || []).find(q => q.id === Number(req.params.id));
  if (!quiz) return res.status(404).json({ error: 'Cuestionario no encontrado' });

  const rows = (quiz.preguntas || []).map((p, i) => {
    const correcta = (p.opciones || []).find(o => o.correcta);
    const incorrectas = (p.opciones || []).filter(o => !o.correcta);
    return {
      '#': i + 1,
      'Pregunta': p.texto,
      'Respuesta Correcta': correcta ? correcta.texto : '',
      'Validacion (SI/NO)': '',
      'Correccion': '',
      'Imagen URL': p.imagen_url || '',
      'Incorrecta 1': incorrectas[0] ? incorrectas[0].texto : '',
      'Incorrecta 2': incorrectas[1] ? incorrectas[1].texto : '',
      'Incorrecta 3': incorrectas[2] ? incorrectas[2].texto : '',
      'Incorrecta 4': incorrectas[3] ? incorrectas[3].texto : '',
      'Incorrecta 5': incorrectas[4] ? incorrectas[4].texto : ''
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  // Anchos de columna
  ws['!cols'] = [
    { wch: 4 }, { wch: 60 }, { wch: 50 }, { wch: 14 }, { wch: 50 }, { wch: 30 },
    { wch: 45 }, { wch: 45 }, { wch: 45 }, { wch: 45 }, { wch: 45 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cuestionario');

  // Hoja metadata
  const meta = XLSX.utils.json_to_sheet([{
    doc_codigo: quiz.doc_codigo,
    doc_nombre: quiz.doc_nombre,
    doc_tipo: quiz.doc_tipo || '',
    quiz_id: quiz.id,
    total_preguntas: (quiz.preguntas || []).length
  }]);
  XLSX.utils.book_append_sheet(wb, meta, 'Info');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  wb.Sheets = {};
  const safeName = (quiz.doc_nombre || '').replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').substring(0, 80);
  const safeCode = quiz.doc_codigo.replace(/\s+/g, '_').replace(/[\/\\:*?"<>|]/g, '-');
  const filename = `${safeCode}_${safeName}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /quizzes/:id/excel — Importar/actualizar cuestionario desde Excel
router.post('/quizzes/:id/excel', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const XLSX = require('xlsx');
  const db = await read();
  const quiz = (db.rhh_training_quizzes || []).find(q => q.id === Number(req.params.id));
  if (!quiz) return res.status(404).json({ error: 'Cuestionario no encontrado' });

  // Recibir archivo como base64 en body
  const { file_base64 } = req.body;
  if (!file_base64) return res.status(400).json({ error: 'Falta file_base64' });

  let wb;
  try {
    const buf = Buffer.from(file_base64, 'base64');
    wb = XLSX.read(buf, { type: 'buffer' });
  } catch (e) {
    return res.status(400).json({ error: 'Archivo Excel invalido' });
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return res.status(400).json({ error: 'Hoja vacia' });
  const rows = XLSX.utils.sheet_to_json(ws);
  wb.Sheets = {};

  const preguntas = [];
  for (const row of rows) {
    const texto = (row['Pregunta'] || '').trim();
    if (!texto) continue;
    const correcta = (row['Respuesta Correcta'] || row['Correccion'] || '').trim();
    const validacion = (row['Validacion (SI/NO)'] || '').trim().toUpperCase();
    // Si validacion=NO y hay correccion, usar la correccion como respuesta correcta
    let respCorrecta = correcta;
    if (validacion === 'NO' && (row['Correccion'] || '').trim()) {
      respCorrecta = (row['Correccion'] || '').trim();
    }
    if (!respCorrecta) continue;

    const opciones = [{ texto: respCorrecta, correcta: true }];
    for (let i = 1; i <= 5; i++) {
      const inc = (row[`Incorrecta ${i}`] || '').trim();
      if (inc) opciones.push({ texto: inc, correcta: false });
    }

    preguntas.push({
      texto,
      imagen_url: (row['Imagen URL'] || '').trim() || undefined,
      opciones
    });
  }

  if (preguntas.length === 0) return res.status(400).json({ error: 'No se encontraron preguntas validas' });

  quiz.preguntas = preguntas.map((p, i) => ({ ...p, id: i + 1 }));
  quiz.updated_at = nowMxDate();
  await write(db);
  res.json({ ok: true, total_preguntas: quiz.preguntas.length });
});

// ══════════════════════════════════════════════════════════════════════════════
// ASIGNACIONES (HOJA DE EVALUACION POR EMPLEADO)
// ══════════════════════════════════════════════════════════════════════════════

// POST /assign — asignar plan a empleados (masivo por puesto o individual)
router.post('/assign', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  if (!db.rhh_training_assignments) db.rhh_training_assignments = [];
  const plans = db.rhh_training_plans || [];
  const positions = db.rhh_positions || [];
  const emps = (db.rhh_employees || []).filter(e => e.status === 'active');
  const quizzes = db.rhh_training_quizzes || [];

  // Filtrar: solo employee_ids enviados, o todos si no se especifican
  let target = emps;
  if (req.body.employee_ids && Array.isArray(req.body.employee_ids)) {
    const ids = new Set(req.body.employee_ids);
    target = emps.filter(e => ids.has(e.id));
  }

  let assigned = 0;
  for (const emp of target) {
    // Ya tiene asignacion?
    const existing = db.rhh_training_assignments.find(a => a.employee_id === emp.id);
    if (existing) continue;

    const plan = findPlanForEmp(plans, emp, positions);
    if (!plan) continue;

    // Construir lista de documentos (generales + mandatorios)
    const allDocs = [...(plan.docs_generales || DOCS_GENERALES), ...plan.documentos];
    const documentos = allDocs.map(d => {
      const quiz = findQuizByCode(quizzes, d.codigo);
      return {
        doc_codigo: d.codigo,
        doc_nombre: d.nombre,
        doc_tipo: d.tipo,
        quiz_id: quiz ? quiz.id : null,
        responsables: [],
        status: 'pendiente',
        mejor_calificacion: null,
        intentos: 0,
        ultimo_intento: null,
        firma_empleado: { fecha: null, hora: null, firmado: false },
        firma_instructor: { nombre: null, fecha: null, hora: null, comentarios: null, firmado: false },
        firma_rh: { nombre: null, fecha: null, hora: null, comentarios: null, firmado: false }
      };
    });

    db.rhh_training_assignments.push({
      id: nextId(db.rhh_training_assignments),
      employee_id: emp.id,
      employee_name: emp.full_name,
      employee_number: emp.employee_number,
      plan_id: plan.id,
      position_name: plan.puesto_sgc,
      eval_group: plan.eval_group,
      status: 'pendiente',
      documentos,
      progreso_pct: 0,
      created_at: nowMxDate()
    });
    assigned++;
  }
  if (assigned > 0) await write(db);
  res.json({ ok: true, assigned, total: db.rhh_training_assignments.length });
});

// GET /assignments — listar asignaciones (resumen)
router.get('/assignments', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const assignments = (db.rhh_training_assignments || []).map(a => ({
    id: a.id,
    employee_id: a.employee_id,
    employee_name: a.employee_name,
    employee_number: a.employee_number,
    position_name: a.position_name,
    eval_group: a.eval_group,
    status: a.status,
    progreso_pct: a.progreso_pct,
    total_docs: (a.documentos || []).length,
    docs_aprobados: (a.documentos || []).filter(d => d.status === 'aprobado').length,
    created_at: a.created_at
  }));
  res.json(assignments);
});

// GET /assignments/:empId — hoja de evaluacion de un empleado
router.get('/assignments/:empId', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const a = (db.rhh_training_assignments || []).find(x => x.employee_id === Number(req.params.empId));
  if (!a) return res.status(404).json({ error: 'Asignacion no encontrada' });
  res.json(a);
});

// PATCH /assignments/:id/firma — registrar firma de instructor o RH (con comentarios y hora)
router.patch('/assignments/:id/firma', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  const a = (db.rhh_training_assignments || []).find(x => x.id === Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Asignacion no encontrada' });
  const { doc_codigo, tipo_firma, nombre_firmante, comentarios } = req.body;
  if (!doc_codigo || !tipo_firma) return res.status(400).json({ error: 'Faltan campos' });
  const doc = (a.documentos || []).find(d => d.doc_codigo === doc_codigo);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado en asignacion' });

  const firmaData = {
    nombre: nombre_firmante || req.user.name,
    fecha: nowMxDate(),
    hora: nowMxTime(),
    comentarios: comentarios || null,
    firmado: true
  };
  if (tipo_firma === 'instructor') {
    doc.firma_instructor = firmaData;
  } else if (tipo_firma === 'rh') {
    doc.firma_rh = firmaData;
  }
  await write(db);
  res.json({ ok: true });
});

// POST /assignments/refresh-quizzes — revincular quiz_id en asignaciones existentes
router.post('/assignments/refresh-quizzes', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  const quizzes = db.rhh_training_quizzes || [];
  const assignments = db.rhh_training_assignments || [];
  if (quizzes.length === 0) return res.json({ ok: true, updated: 0, msg: 'No hay quizzes importados' });
  let updated = 0;
  for (const a of assignments) {
    for (const d of (a.documentos || [])) {
      const quiz = findQuizByCode(quizzes, d.doc_codigo);
      if (quiz && d.quiz_id !== quiz.id) {
        d.quiz_id = quiz.id;
        updated++;
      }
    }
  }
  if (updated > 0) await write(db);
  res.json({ ok: true, updated });
});

// PATCH /assignments/:id/responsables — asignar responsables (supervisores) a un documento
router.patch('/assignments/:id/responsables', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  const a = (db.rhh_training_assignments || []).find(x => x.id === Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Asignacion no encontrada' });
  const { doc_codigo, responsables } = req.body;
  if (!doc_codigo) return res.status(400).json({ error: 'Falta doc_codigo' });
  const doc = (a.documentos || []).find(d => d.doc_codigo === doc_codigo);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
  doc.responsables = Array.isArray(responsables) ? responsables : [];
  await write(db);
  res.json({ ok: true });
});

// POST /assignments/bulk-responsables — asignar responsables masivo por doc_codigo
router.post('/assignments/bulk-responsables', rhhRequireRole('admin', 'rh'), async (req, res) => {
  const db = await read();
  const { doc_codigo, responsables } = req.body;
  if (!doc_codigo || !Array.isArray(responsables)) return res.status(400).json({ error: 'Faltan campos' });
  const assignments = db.rhh_training_assignments || [];
  let updated = 0;
  for (const a of assignments) {
    const doc = (a.documentos || []).find(d => d.doc_codigo === doc_codigo);
    if (doc) {
      doc.responsables = responsables;
      updated++;
    }
  }
  if (updated > 0) await write(db);
  res.json({ ok: true, updated });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESULTADOS (EXAMENES)
// ══════════════════════════════════════════════════════════════════════════════

// GET /results — listar resultados
router.get('/results', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const results = (db.rhh_training_results || []).map(r => ({
    id: r.id,
    employee_id: r.employee_id,
    employee_name: r.employee_name,
    quiz_id: r.quiz_id,
    doc_codigo: r.doc_codigo,
    calificacion: r.calificacion,
    aprobado: r.aprobado,
    created_at: r.created_at
  }));
  res.json(results);
});

// GET /results/:empId — resultados de un empleado
router.get('/results/:empId', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const results = (db.rhh_training_results || []).filter(r => r.employee_id === Number(req.params.empId));
  res.json(results);
});

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD / RESUMEN
// ══════════════════════════════════════════════════════════════════════════════

router.get('/dashboard', rhhRequireRole('admin', 'rh', 'muestra'), async (req, res) => {
  const db = await read();
  const assignments = db.rhh_training_assignments || [];
  const quizzes = db.rhh_training_quizzes || [];
  const plans = db.rhh_training_plans || [];

  const totalEmps = assignments.length;
  const completados = assignments.filter(a => a.status === 'completado').length;
  const enProgreso = assignments.filter(a => a.status === 'en_progreso').length;
  const pendientes = assignments.filter(a => a.status === 'pendiente').length;

  // Progreso promedio
  const avgProgreso = totalEmps > 0
    ? Math.round(assignments.reduce((s, a) => s + (a.progreso_pct || 0), 0) / totalEmps)
    : 0;

  // Resumen por puesto
  const porPuesto = {};
  for (const a of assignments) {
    if (!porPuesto[a.position_name]) {
      porPuesto[a.position_name] = { total: 0, completados: 0, progreso_sum: 0 };
    }
    porPuesto[a.position_name].total++;
    if (a.status === 'completado') porPuesto[a.position_name].completados++;
    porPuesto[a.position_name].progreso_sum += (a.progreso_pct || 0);
  }

  res.json({
    totalEmps, completados, enProgreso, pendientes, avgProgreso,
    totalPlanes: plans.length,
    totalQuizzes: quizzes.length,
    porPuesto
  });
});

module.exports = router;
