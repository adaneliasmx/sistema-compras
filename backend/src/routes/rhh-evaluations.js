const express = require('express');
const { read, write, nextId } = require('../db-rhh');
const { rhhAuthRequired, rhhRequireRole } = require('../middleware/rhh-auth');
const router = express.Router();

function nowMxDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ── Backward-compat: max puntos por item ──────────────────────────────────────
// Items nuevos usan ponderacion (1|2|3); items viejos usaban valor (alto|medio|bajo)
const VALOR_PTS_LEGACY = { alto: 5, medio: 3, bajo: 1 };
function maxPtsByItem(it) {
  return it.ponderacion || VALOR_PTS_LEGACY[it.valor] || 0;
}

// ── Normalización de nombre de puesto (sin acentos, minúsculas, espacios simples) ──
function normPos(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// ── Plantillas 2026 (una por grupo de puestos) ────────────────────────────────
// position_names: lista de nombres de puestos (tal como aparecen en rhh_positions)
// que usan este formulario. Permite matching por nombre en lugar de solo por ID.
const EVAL_TEMPLATES_2026 = [
  {
    group_name: 'Fosfatador',
    position_ids: [4, 5, 6, 7, 18, 19, 20, 21, 24, 26],
    position_names: [
      'Operador de Fosfatado', 'Operador de fosfatado',
      'Fosfatador',
      'Operador Lider', 'Operador líder', 'Operador Líder',
      'Operador Línea 1', 'Operador Linea 1',
    ],
    items: [
      { name: 'Registros de producción en tiempo y forma (Software)', ponderacion: 3 },
      { name: 'Registros de paros y justificación de los mismos', ponderacion: 3 },
      { name: 'Flujo de material como corresponde primeras entradas primeras salidas', ponderacion: 2 },
      { name: 'Levantamientos de solicitud de mantenimiento autorizados por jefe directo', ponderacion: 2 },
      { name: 'Llenado de TPM Mantenimiento autónomo correspondiente a operador de línea', ponderacion: 2 },
      { name: 'Cumplimiento de indicaciones de jefe directo y superiores', ponderacion: 3 },
      { name: 'Reportes a tiempo de fallas visuales en línea, canastas mal posicionadas, desconfiguración de línea y fallas de canastas', ponderacion: 2 },
      { name: 'Lograr los objetivos de eficiencia y rendimiento no menos a 90% (personal)', ponderacion: 2 },
      { name: 'Cuidar fallas visuales de todo material por procesar o procesado', ponderacion: 2 },
      { name: 'Verificar planes de control, enviar material como corresponde el plan de control, no modificar datos', ponderacion: 3 },
      { name: 'Cuidado a insumos y herramientas de trabajo', ponderacion: 2 },
      { name: 'Entrega de turno (status, incidencias y urgencias a turno entrante)', ponderacion: 1 },
      { name: 'Presentarse puntual para recepción de turno', ponderacion: 2 },
      { name: 'No consumir alimentos en áreas de trabajo', ponderacion: 2 },
      { name: 'Tiempos muertos justificados, cumplir horarios de acuerdo a turno asignado. Justificarlo siempre o jefe directo', ponderacion: 3 },
      { name: 'Respetar prioridades del material a fosfatar', ponderacion: 2 },
      { name: 'Equipo de seguridad (botas, faja, tapones de oídos y lentes de seguridad)', ponderacion: 3 },
      { name: 'Área libre de material en piso', ponderacion: 2 },
      { name: 'Correcta identificación y disposición de Scrap', ponderacion: 2 },
      { name: 'Apoyo en limpieza de tanques', ponderacion: 1 },
      { name: 'Apoyo en ajustes de soluciones', ponderacion: 1 },
      { name: 'Llega a tiempo y se va a tiempo', ponderacion: 2 },
      { name: 'Respeta tiempos de comedor', ponderacion: 1 },
      { name: 'El operador no pierde tiempo en actividades que no aportan a su trabajo', ponderacion: 2 },
      { name: 'Se dirige con respeto a sus compañeros, supervisores y personal externo', ponderacion: 2 },
      { name: 'Aprovechamiento de tiempos muertos en actividades relacionadas con sus labores', ponderacion: 2 },
      { name: 'Disponibilidad para tiempo extra', ponderacion: 1 },
      { name: 'Asiste a juntas, capacitaciones, simulacros y otros eventos realizados por la empresa', ponderacion: 1 }
    ]
  },
  {
    group_name: 'Auxiliar de Almacén',
    position_ids: [1, 2, 22, 23, 25, 28],
    position_names: [
      'Auxiliar de Almacén', 'Auxiliar de Almacen', 'Auxiliar Almacen', 'Auxiliar almacén',
    ],
    items: [
      { name: 'Registra el material de ingreso a Cuesto de manera adecuada', ponderacion: 3 },
      { name: 'Validar los datos de material (cliente, componente, #piezas) sean correctos', ponderacion: 1 },
      { name: 'Mantiene surtida la línea de producción de manera autónoma', ponderacion: 2 },
      { name: 'Mantiene ordenados los carriles del almacén y acomodo de los racks (según sistema)', ponderacion: 3 },
      { name: 'Se enfoca en cubrir sus actividades en tiempo y forma', ponderacion: 2 },
      { name: 'Cuidado a insumos y herramientas de trabajo', ponderacion: 2 },
      { name: 'Respeta primeras entradas primeras salidas, rotación de todo material', ponderacion: 2 },
      { name: 'Mantiene el montacargas en su área', ponderacion: 1 },
      { name: 'Alertar a calidad si llega un material con posible daño', ponderacion: 1 },
      { name: 'Conecta la batería del montacargas, llena su bitácora y lo mantiene limpio', ponderacion: 3 },
      { name: 'Cumple con listado de materiales a surtir (listados)', ponderacion: 2 },
      { name: 'Asegurarse de surtir material procesado según FIFO', ponderacion: 2 },
      { name: 'Cumple con las indicaciones asignadas por el supervisor de turno', ponderacion: 2 },
      { name: 'Cargar y descargar camiones con lo que se le indique', ponderacion: 2 },
      { name: 'Entrega de turno (status, incidencias y urgencias a turno entrante)', ponderacion: 1 },
      { name: 'Presentarse puntual para recepción de turno', ponderacion: 2 },
      { name: 'No consumir alimentos en áreas de trabajo', ponderacion: 2 },
      { name: 'Cuando se le solicita apoya a otras áreas', ponderacion: 1 },
      { name: 'Entrega de área limpia y ordenada (Almacén)', ponderacion: 2 },
      { name: 'Uso de guantes de seguridad, botas, faja y tapones', ponderacion: 3 },
      { name: 'Orden y acomodo escritorio (documentos)', ponderacion: 1 },
      { name: 'Maneja el montacargas de una manera segura', ponderacion: 2 },
      { name: 'Cuidado y limpieza de equipo de cómputo asignado', ponderacion: 2 },
      { name: 'Se dirige con respeto a sus compañeros, supervisores y personal externo', ponderacion: 3 },
      { name: 'Se presenta aseado y con su uniforme de trabajo', ponderacion: 1 },
      { name: 'Llega a tiempo y se va a tiempo', ponderacion: 2 },
      { name: 'Respeta tiempos de comedor', ponderacion: 2 },
      { name: 'Disponibilidad para tiempo extra', ponderacion: 1 }
    ]
  },
  {
    group_name: 'Operador de Empaque',
    position_ids: [3, 27],
    position_names: [
      'Operador de Empaque', 'Operador de empaque',
      'Empacador',
      'Auxiliar de un Empaque', 'Auxiliar de Empaque', 'Auxiliar de empaque',
    ],
    items: [
      { name: 'No exceder los pesos de báscula ya asignados en sistema', ponderacion: 1 },
      { name: 'Acomodo de material empacado en biblioteca de acuerdo a FIFOs', ponderacion: 3 },
      { name: 'Empaca material con datos correctos', ponderacion: 1 },
      { name: 'Tipo de empacado de material como lo solicita sistema', ponderacion: 1 },
      { name: 'Mantiene área libre de tarimas, exceso de cajas y cuñetes', ponderacion: 3 },
      { name: 'Área libre de estampas tiradas en piso, clasificación de scrap', ponderacion: 2 },
      { name: 'Respetar ubicaciones asignadas de material terminado, solo colocar el material de resguardo si tiene ubicación asignada números Kanban (con FIFO)', ponderacion: 2 },
      { name: 'Colocación de etiquetas de identificación correspondientes al mes, colocarlas correctamente, una en contenedor y otra en material', ponderacion: 1 },
      { name: 'Cuidado a insumos y herramientas de trabajo', ponderacion: 1 },
      { name: 'Entrega de turno (status, incidencias y urgencias a turno entrante)', ponderacion: 2 },
      { name: 'Presentarse puntual para recepción de turno', ponderacion: 2 },
      { name: "Limpieza de área, 5's y clasificación de residuos", ponderacion: 3 },
      { name: 'No consumir alimentos en áreas de trabajo', ponderacion: 2 },
      { name: 'Correcta utilización de nuevos programas', ponderacion: 2 },
      { name: 'Correcta disposición e identificación de scrap', ponderacion: 2 },
      { name: 'Cumplimiento a alertas de calidad', ponderacion: 3 },
      { name: 'Reporte de fallas visuales (material mal identificado, dañado, puntos sin fosfato, mal desengrase, deformado, oxidado, sin tarjeta de medición de rugosidad cuando aplique)', ponderacion: 2 },
      { name: 'Equipo de seguridad (botas, faja, tapones de oídos y lentes de seguridad)', ponderacion: 3 },
      { name: 'No tener tinas por empacar en exceso', ponderacion: 1 },
      { name: 'El operador no pierde tiempo en actividades que no aportan a su trabajo', ponderacion: 2 },
      { name: 'Guarda sus herramientas de trabajo', ponderacion: 2 },
      { name: 'Se dirige con respeto a sus compañeros, supervisores y personal externo', ponderacion: 2 },
      { name: 'Llega a tiempo y se va a tiempo', ponderacion: 2 },
      { name: 'Respeta tiempos de comedor', ponderacion: 1 },
      { name: 'Disponibilidad para tiempo extra', ponderacion: 1 },
      { name: 'Asiste a juntas, capacitaciones, simulacros y otros eventos realizados por la empresa', ponderacion: 1 }
    ]
  },
  {
    group_name: 'Auxiliar de Calidad',
    position_ids: [9],
    position_names: ['Auxiliar de Calidad', 'Auxiliar de calidad'],
    items: [
      { name: 'El operador realiza inspección apegándose a criterios de calidad', ponderacion: 2 },
      { name: 'El operador realiza acomodo de piezas según instructivo de trabajo', ponderacion: 2 },
      { name: 'El operador realiza validación por componente y lo anota', ponderacion: 2 },
      { name: 'El operador se asegura de la correcta identificación de cada carro (envarillado)', ponderacion: 3 },
      { name: 'El operador se asegura de la correcta identificación de cada empaque final', ponderacion: 2 },
      { name: 'El operador registra en la base de datos', ponderacion: 3 },
      { name: 'El operador realiza el envarillado en tiempo y forma', ponderacion: 2 },
      { name: 'El operador identifica y separa rechazos', ponderacion: 2 },
      { name: 'Cuidado de piezas en proceso, herramientas e insumos de trabajo', ponderacion: 2 },
      { name: 'Correcta disposición de scrap en el área asignada (por modelo)', ponderacion: 3 },
      { name: 'El operador no deja pendientes por inspeccionar y/o limpiar', ponderacion: 1 },
      { name: 'El operador mantiene el área limpia y ordenada', ponderacion: 3 },
      { name: 'El operador resguarda identificaciones de almacén', ponderacion: 1 },
      { name: 'Equipo de seguridad (guantes, botas, faja, tapones de oídos y lentes de seguridad)', ponderacion: 3 },
      { name: 'El operador llega a tiempo y se va a tiempo', ponderacion: 2 },
      { name: 'El operador no pierde tiempo en actividades que no aportan a su trabajo', ponderacion: 2 },
      { name: 'Separación y disposición de residuos', ponderacion: 2 },
      { name: 'Cumplimiento de KPI de área (% de calidad, Rechazos)', ponderacion: 2 },
      { name: 'Respeta tiempos de comedor', ponderacion: 1 },
      { name: 'Asiste a juntas, capacitaciones, simulacros y otros eventos realizados por la empresa', ponderacion: 1 },
      { name: 'Disponibilidad para tiempo extra', ponderacion: 2 }
    ]
  },
  {
    group_name: 'Inspector de Calidad',
    position_ids: [10],
    position_names: ['Inspector de Calidad', 'Inspector Calidad', 'Inspector de calidad'],
    items: [
      { name: 'Apoyo en otras áreas', ponderacion: 2 },
      { name: 'Mantener pasillos sin obstruir', ponderacion: 1 },
      { name: 'Dejar área limpia y ordenada', ponderacion: 2 },
      { name: 'Informar a jefe inmediato sobre temas críticos en área', ponderacion: 2 },
      { name: 'Mantener el proceso en control (Titulaciones y Cpk)', ponderacion: 2 },
      { name: 'Realización y registro del Peso de Fosfato, Adhesivo y/o Grasa Disuelta', ponderacion: 3 },
      { name: 'Reporte y escalamiento de línea fuera de especificaciones', ponderacion: 2 },
      { name: 'Reportar Registros de Titulación', ponderacion: 2 },
      { name: 'Validación de ajustes de soluciones', ponderacion: 3 },
      { name: 'Entrega de resultados en tiempo y forma', ponderacion: 2 },
      { name: 'Registra y genera los vales de adición de todos los químicos utilizados en la empresa', ponderacion: 3 },
      { name: 'Seguimiento a validaciones internas (Embarques, producto terminado, medición de temperatura manual)', ponderacion: 2 },
      { name: 'Registro de rechazos realizados y/o hechos del cliente', ponderacion: 2 },
      { name: 'Registros de Inspecciones (Rugosidad, Carros desengrase, Material con óxido)', ponderacion: 2 },
      { name: "5's en gabinetes de titulación e insumos (limpieza, orden e identificación)", ponderacion: 3 },
      { name: 'Cumplimiento de indicaciones de superiores', ponderacion: 2 },
      { name: 'Realiza actividades sin esperar indicación', ponderacion: 2 },
      { name: 'Usa su EPP en todo momento', ponderacion: 3 },
      { name: 'El operador no pierde tiempo en actividades que no aportan a su trabajo', ponderacion: 2 },
      { name: 'Realización de inventario de químicos', ponderacion: 2 },
      { name: 'Aprovechamiento de tiempos muertos en actividades relacionadas con sus labores', ponderacion: 2 }
    ]
  },
  {
    group_name: 'Supervisor de Turno',
    position_ids: [11],
    position_names: ['Supervisor de Turno', 'Supervisor de turno', 'Supervisor'],
    items: [
      { name: 'Llenado puntual archivos y bases de datos', ponderacion: 3 },
      { name: 'Reportes a tiempo de incidencias en lista de asistencia y con superiores', ponderacion: 2 },
      { name: 'Comunicar oportunamente incidencias que afecten la operación (Escalaciones)', ponderacion: 2 },
      { name: 'Manejo de inventarios y flujo de materiales', ponderacion: 3 },
      { name: 'Solicitud de material en tiempo y forma', ponderacion: 2 },
      { name: 'Llenado de TPM & validación de Check list de arranque', ponderacion: 2 },
      { name: 'Ajustes de tanques de manera adecuada', ponderacion: 1 },
      { name: 'Vigilar el cumplimiento a Reglamento Interior de Trabajo (personal a cargo)', ponderacion: 2 },
      { name: 'Aplicar amonestaciones a subordinados cuando sea su responsabilidad y derivar a RH cuando sea necesario', ponderacion: 2 },
      { name: 'Manejo y gestión del personal a su cargo', ponderacion: 1 },
      { name: 'Planeación de proyectos y actividades', ponderacion: 2 },
      { name: 'Acatar indicaciones directas de jefe inmediato y superiores', ponderacion: 2 },
      { name: 'Asegurar el llenado de Base de Datos de personal a su cargo', ponderacion: 3 },
      { name: 'Dirigirse con respeto a superiores y personal a cargo', ponderacion: 2 },
      { name: 'Seguimiento a paros de línea y escalar cuando sea necesario', ponderacion: 2 },
      { name: 'Asegurar el correcto reporte y disposición del scrap del personal a su cargo', ponderacion: 2 },
      { name: 'Mantener acomodados los materiales e insumos después de realizar limpieza de tanques para su correcta disposición', ponderacion: 1 },
      { name: 'Resolución de problemas', ponderacion: 1 },
      { name: 'Uso personal de EPP', ponderacion: 1 },
      { name: 'Uso de EPP del personal a su cargo', ponderacion: 3 },
      { name: 'Mantener pasillos libres, extintores y señalética despejados', ponderacion: 1 },
      { name: 'Cumplimiento de metas de turno (KPIs: Disponibilidad, Eficiencia, Capacidad)', ponderacion: 3 },
      { name: 'Gestión de actividades, tiempos y distribución del personal a su cargo', ponderacion: 3 },
      { name: 'Mantener su área limpia y ordenada', ponderacion: 2 },
      { name: 'Cuidado de los equipos de cómputo de las áreas de operación', ponderacion: 2 },
      { name: 'Asegurar que el personal a su cargo realice 5s en sus respectivas áreas', ponderacion: 2 },
      { name: 'Escalación de problemas de manera óptima', ponderacion: 2 },
      { name: 'Reporte de fin de turno (en correo y en WhatsApp)', ponderacion: 2 },
      { name: 'Apoyo en tiempo extra', ponderacion: 1 }
    ]
  },
  {
    group_name: 'Técnico de Mantenimiento',
    position_ids: [13],
    position_names: [
      'Técnico de Mantenimiento', 'Tecnico de Mantenimiento', 'Técnico de mantenimiento',
      'Técnico en Mantenimiento', 'Tecnico en Mantenimiento',
      'Tecnico en Mantemiento', // typo frecuente en CONTPAQ i
    ],
    items: [
      { name: 'Realiza el mantenimiento preventivo mensual y entrega órdenes a tiempo', ponderacion: 2 },
      { name: 'Cuidado de herramientas y equipo (Daño o pérdida)', ponderacion: 2 },
      { name: 'Dejar área limpia y ordenada (Taller, cuarto de mtto, líneas donde se trabajó)', ponderacion: 3 },
      { name: 'Da seguimiento a órdenes correctivas en plataforma y reporta a jefe inmediato', ponderacion: 3 },
      { name: 'Uso adecuado de EPP correspondiente', ponderacion: 3 },
      { name: 'Reporta el status de refacciones a jefe inmediato', ponderacion: 2 },
      { name: 'Porta su equipo de comunicación durante todo el turno y da respuesta de manera oportuna (atención a radio)', ponderacion: 3 },
      { name: 'Realizar el TPM del área a tiempo', ponderacion: 2 },
      { name: 'Se dirige con respeto a supervisores y líderes de área', ponderacion: 2 },
      { name: 'El operador no pierde tiempo en actividades que no aportan a su trabajo', ponderacion: 2 },
      { name: 'Sigue indicaciones de jefe directo y líderes de área', ponderacion: 3 },
      { name: 'Atiende paros, urgencias y solicitudes en tiempo y forma', ponderacion: 2 },
      { name: 'Cumplimiento de rol de encendido de resistencia', ponderacion: 2 },
      { name: 'Cumplimiento KPI de Área (Disponibilidad y Tiempo de paro)', ponderacion: 2 }
    ]
  },
  {
    group_name: 'Equipo Vacío',
    position_ids: [8],
    position_names: ['Equipo Vacío', 'Equipo Vacio', 'equipo vacio'],
    items: [
      { name: 'Limpieza de equipo vacío (tinas, cajas 05, 07, 09, carros cabina)', ponderacion: 2 },
      { name: 'Asignación de necesidades para el área de fosfatado, carros limpios, cuñetes sin doble identificación', ponderacion: 1 },
      { name: 'Apoyo a distintas áreas de acuerdo a necesidades', ponderacion: 3 },
      { name: 'Cumple con las indicaciones asignadas por su jefe directo', ponderacion: 3 },
      { name: 'Acomodo de carros siempre en lugar correspondiente', ponderacion: 2 },
      { name: 'Identificación de material limpio o por limpiar', ponderacion: 3 },
      { name: 'Toma de iniciativa en sus actividades (no espera indicaciones para comenzar sus actividades)', ponderacion: 1 },
      { name: 'Calidad de limpieza de cajas', ponderacion: 1 },
      { name: 'Calidad de limpieza de carros', ponderacion: 1 },
      { name: 'Eficiencia en realización de collares', ponderacion: 1 },
      { name: 'Eficiencia en embarillado', ponderacion: 1 },
      { name: 'Comunica necesidades de área y reporta pendientes', ponderacion: 2 },
      { name: 'Llega a tiempo y se va a tiempo', ponderacion: 2 },
      { name: 'Respeta tiempos de comedor', ponderacion: 2 },
      { name: 'Clasificación y ubicaciones asignadas', ponderacion: 1 },
      { name: 'Equipo de seguridad (guantes, botas, faja, tapones de oídos y lentes de seguridad)', ponderacion: 3 },
      { name: "Área ordenada libre de etiquetas tiradas (5's y clasificación de residuos)", ponderacion: 3 },
      { name: 'El operador no pierde tiempo en actividades que no aportan a su trabajo', ponderacion: 2 },
      { name: 'Guardar sus herramientas de trabajo (Thinner, espátula, guantes, trapos)', ponderacion: 2 },
      { name: 'Disponibilidad para tiempo extra', ponderacion: 1 },
      { name: 'Dirigirse con respeto a sus compañeros y jefes inmediatos', ponderacion: 2 },
      { name: 'Cumple con objetivos establecidos de limpieza de caja', ponderacion: 2 },
      { name: 'Asiste a juntas, capacitaciones, simulacros y otros eventos realizados por la empresa', ponderacion: 1 }
    ]
  },
  {
    group_name: 'Intendencia',
    position_ids: [14],
    position_names: [
      'Intendencia',
      'Limpieza',
      'Auxiliar de Limpieza', 'Auxiliar de limpieza',
      'Ayudante General', 'Ayudante general',
    ],
    items: [
      { name: 'Mantener pasillos sin obstruir', ponderacion: 2 },
      { name: 'Mantener pasillos libre de derrames en planta', ponderacion: 3 },
      { name: 'Check List: Baños Hombres y Mujeres', ponderacion: 2 },
      { name: 'Check List: Lockers Hombres y Mujeres', ponderacion: 2 },
      { name: 'Check List: Oficinas Jesús/Ramiro, Manuel', ponderacion: 1 },
      { name: 'Solo usa recipientes identificados, reporta y separa frascos, cubetas y botes (sin identificar o etiquetar)', ponderacion: 3 },
      { name: 'Dirigirse con respeto y acatar indicaciones de superiores', ponderacion: 2 },
      { name: 'Apoyar a las áreas de producción (envarillar, trasvasar estampa)', ponderacion: 2 },
      { name: 'Recolección Check List: Basura, plástico, cartón. Llenar correctamente las bolsas de basura', ponderacion: 3 },
      { name: 'Check List: Sala de Juntas, Oficina Mtto./Mat. Limpieza / Almacén recibo y Almacén Kan Ban', ponderacion: 2 },
      { name: 'Reportar Inventario semanal papel higiénico y Material de Limpieza', ponderacion: 3 },
      { name: 'Uso de Lentes y Equipo de Seguridad (No audífonos)', ponderacion: 3 }
    ]
  },
  {
    group_name: 'Operador PTAR',
    position_ids: [12],
    position_names: ['Operador PTAR'],
    items: [
      { name: 'Llenado de documentos en área', ponderacion: 2 },
      { name: 'Apoyo a otras áreas', ponderacion: 1 },
      { name: "Dejar área limpia y ordenada 5's", ponderacion: 3 },
      { name: 'Reportar a jefe inmediato temas críticos en área', ponderacion: 3 },
      { name: 'Operación PTAR', ponderacion: 2 },
      { name: 'Llenado de porrones y mantener stock', ponderacion: 3 },
      { name: 'Uso de Lentes y Equipo de Seguridad', ponderacion: 3 },
      { name: 'Inventario de químicos y subirlo en sistema', ponderacion: 2 },
      { name: 'El operador realiza retrolavados', ponderacion: 3 },
      { name: 'Llenado de TPM', ponderacion: 2 },
      { name: 'Manejo de SCRAP', ponderacion: 2 },
      { name: 'Sin reincidencia en hallazgo encontrado con anterioridad', ponderacion: 2 },
      { name: 'Cierre de hallazgos en fecha compromiso', ponderacion: 2 },
      { name: 'Menos de 2 hallazgos en auditoría', ponderacion: 2 },
      { name: 'Filtrado y disposición de Lodos', ponderacion: 2 },
      { name: 'Mantener limpia, ordenada e identificada el área de químicos de acuerdo a compatibilidad', ponderacion: 3 },
      { name: 'Recepción, identificación y almacenamiento de químicos (en el embarque)', ponderacion: 3 },
      { name: 'Apoyo en surtido y adición de químicos en proceso', ponderacion: 2 },
      { name: 'El operador no pierde tiempo en actividades que no aportan a su trabajo', ponderacion: 2 },
      { name: 'Aprovechamiento de tiempos muertos en actividades relacionadas con sus labores', ponderacion: 2 }
    ]
  },
  {
    group_name: 'Coordinador de Producción',
    position_ids: [17],
    position_names: [
      'Coordinador de Producción', 'Coordinador de Produccion', 'Coordinador de producción',
      'Cordinador de produccion', // typo frecuente
    ],
    items: [
      { name: 'Llenado puntual archivos y bases de datos', ponderacion: 2 },
      { name: 'Reportes a tiempo de incidencias (4 cuadrantes Semanal y Pareto día anterior)', ponderacion: 3 },
      { name: 'Manejo de inventarios en Almacén y flujo de materiales (identificación y FIFO)', ponderacion: 2 },
      { name: 'Solicitud de material en tiempo y forma (seguimiento a fallas y Pareto)', ponderacion: 2 },
      { name: 'Llenado de TPM & Check list de arranque (evidencia de cierre semanal en reunión)', ponderacion: 2 },
      { name: 'Ajustes de tanques de manera adecuada (vales de adición, captura en plataforma)', ponderacion: 3 },
      { name: 'Manejo y gestión del personal a su cargo (reportes, comprobantes de faltas y amonestaciones)', ponderacion: 2 },
      { name: 'Planeación de proyectos y actividades (seguimiento semanal a proyectos asignados)', ponderacion: 2 },
      { name: 'Resolución de problemas y escalación de problemas a tiempo', ponderacion: 3 },
      { name: 'Uso personal de EPP', ponderacion: 3 },
      { name: 'Uso de EPP del personal a su cargo (correcto uso de EPP de personal a su cargo)', ponderacion: 2 },
      { name: 'Gestión de actividades, tiempos y distribución del personal a su cargo', ponderacion: 2 },
      { name: 'Identificación, estandarización y marcado de áreas (identificación de áreas)', ponderacion: 3 },
      { name: 'Reporte de fin de turno (en correo y en WhatsApp)', ponderacion: 2 },
      { name: 'Cumplimiento y seguimiento semanal de KPI de área (Eficiencia)', ponderacion: 2 },
      { name: 'Análisis y cierre oportuno de Acciones correctivas por incumplimiento de KPIs', ponderacion: 2 },
      { name: 'Correcta gestión de roles de personal de producción', ponderacion: 2 },
      { name: 'Seguimiento en actividades en planes de acción', ponderacion: 2 },
      { name: 'Entregas de turnos con áreas ordenadas y sin basura de personal a su cargo', ponderacion: 2 }
    ]
  },
  {
    group_name: 'STAFF',
    position_ids: [15, 16],
    position_names: [
      'STAFF',
      'Administrador SGC', 'Administrador Sgc',
      'Gerente de operaciones', 'Gerente de Operaciones',
      'Ingeniero de Procesos', 'Ingeniero de procesos',
      'Ingeniero de Calidad', 'Ingeniero de calidad',
      'Ingeniero de Mantenimiento', 'Ingeniero de mantenimiento',
      'SYMACompras',
      'Administradora RRHH', 'Administradora Rrhh',
      'Coordinador de Seguridad y Medio Ambiente',
    ],
    items: [
      { name: 'Llenado puntual archivos y bases de datos (del líder y del personal a cargo)', ponderacion: 3 },
      { name: 'Reportes a tiempo de incidencias en planta (atención y seguimiento contingencias)', ponderacion: 3 },
      { name: 'Llenado y Seguimiento a H.K (convocando a reuniones mensuales o semanales si está fuera)', ponderacion: 2 },
      { name: 'Seguimiento a indicaciones de Jefe directo (toma de acciones a problemas reportados)', ponderacion: 3 },
      { name: 'Puntualidad y asistencia a reuniones convocadas', ponderacion: 2 },
      { name: 'Seguimiento y cierre de acciones tanto a reportes semanales como a planes de acción de HK', ponderacion: 3 },
      { name: 'Seguimiento y cierre de actividades pendientes en Planner (utilización de herramienta)', ponderacion: 2 },
      { name: 'Resolución de problemas y escalación de problemas a tiempo (atender escalaciones y escalar)', ponderacion: 3 },
      { name: 'Seguimiento a reportes de su área (reportes de no conformidades realizadas)', ponderacion: 2 },
      { name: 'Uso personal de EPP', ponderacion: 3 },
      { name: 'Uso de EPP del personal a su cargo (correcto uso de EPP de personal a su cargo)', ponderacion: 2 },
      { name: 'Gestión de actividades, tiempos y personal a su cargo (asegurar cubrir actividades críticas)', ponderacion: 3 },
      { name: 'Identificación, estandarización y marcado de áreas a su cargo (identificación de áreas)', ponderacion: 2 },
      { name: 'Cumplimiento y seguimiento semanal de KPI Mensual', ponderacion: 2 },
      { name: 'Apoyo en actividades extras del personal a su cargo', ponderacion: 2 }
    ]
  }
];

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIOS POR PUESTO
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rhh/evaluations/forms
router.get('/forms', rhhAuthRequired, (req, res) => {
  const db = read();
  const forms = (db.rhh_eval_forms || []).map(f => ({
    ...f,
    total_points: (f.items || []).reduce((s, it) => s + maxPtsByItem(it), 0)
  }));
  res.json(forms);
});

// POST /api/rhh/evaluations/seed-forms  — carga las 12 plantillas 2026
router.post('/seed-forms', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  let id = 1;
  db.rhh_eval_forms = EVAL_TEMPLATES_2026.map(tpl => ({
    id: id++,
    group_name: tpl.group_name,
    position_ids: tpl.position_ids || [],
    position_names: tpl.position_names || [],
    items: tpl.items.map((it, i) => ({ id: i + 1, name: it.name, ponderacion: it.ponderacion })),
    created_at: nowMxDate(),
    updated_at: nowMxDate()
  }));
  write(db);
  res.json({ ok: true, total: db.rhh_eval_forms.length });
});

// POST /api/rhh/evaluations/sync-position-names
// Lee rhh_positions y actualiza position_ids en los forms según position_names
router.post('/sync-position-names', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const positions = db.rhh_positions || [];
  const forms = db.rhh_eval_forms || [];
  const log = [];

  // Si los forms no tienen position_names, agregarlos desde el template
  for (const form of forms) {
    if (!form.position_names || form.position_names.length === 0) {
      const tpl = EVAL_TEMPLATES_2026.find(t => t.group_name === form.group_name);
      if (tpl) form.position_names = tpl.position_names || [];
    }
  }

  for (const form of forms) {
    const pnames = form.position_names || [];
    const matchedIds = positions
      .filter(p => pnames.some(pn => normPos(pn) === normPos(p.name)))
      .map(p => p.id);
    const prev = JSON.stringify(form.position_ids);
    form.position_ids = matchedIds;
    if (JSON.stringify(matchedIds) !== prev) {
      log.push(`${form.group_name}: position_ids → [${matchedIds.join(', ')}]`);
    }
  }

  db.rhh_eval_forms = forms;
  write(db);
  res.json({ ok: true, log });
});

// POST /api/rhh/evaluations/forms  — crear form vacío para un grupo
router.post('/forms', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { group_name, position_ids } = req.body || {};
  if (!group_name) return res.status(400).json({ error: 'group_name requerido' });

  const forms = db.rhh_eval_forms || [];
  const existing = forms.find(f => f.group_name === group_name);
  if (existing) return res.status(409).json({ error: 'Ya existe un formulario para ese grupo', form: existing });

  const form = {
    id: nextId(forms),
    group_name,
    position_ids: Array.isArray(position_ids) ? position_ids : [],
    items: [],
    created_at: nowMxDate(),
    updated_at: nowMxDate()
  };
  forms.push(form);
  db.rhh_eval_forms = forms;
  write(db);
  res.status(201).json(form);
});

// PATCH /api/rhh/evaluations/forms/:id — actualizar ítems
router.patch('/forms/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const forms = db.rhh_eval_forms || [];
  const idx = forms.findIndex(f => f.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Formulario no encontrado' });

  const { items, position_ids, group_name } = req.body || {};

  if (items !== undefined) {
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items debe ser un array' });
    for (const it of items) {
      if (!String(it.name || '').trim()) return res.status(400).json({ error: 'Cada ítem debe tener nombre' });
      if (!it.ponderacion || ![1, 2, 3].includes(Number(it.ponderacion)))
        return res.status(400).json({ error: 'ponderacion debe ser 1, 2 o 3' });
    }
    let maxId = Math.max(0, ...(forms[idx].items || []).map(i => i.id || 0));
    forms[idx].items = items.map(it => ({
      id: it.id || ++maxId,
      name: String(it.name).trim(),
      ponderacion: Number(it.ponderacion)
    }));
  }
  if (position_ids !== undefined) forms[idx].position_ids = position_ids;
  if (group_name !== undefined) forms[idx].group_name = group_name;
  forms[idx].updated_at = nowMxDate();

  db.rhh_eval_forms = forms;
  write(db);
  res.json({ ...forms[idx], total_points: (forms[idx].items || []).reduce((s, it) => s + maxPtsByItem(it), 0) });
});

// DELETE /api/rhh/evaluations/forms/:form_id/items/:item_id
router.delete('/forms/:form_id/items/:item_id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const forms = db.rhh_eval_forms || [];
  const idx = forms.findIndex(f => f.id === Number(req.params.form_id));
  if (idx === -1) return res.status(404).json({ error: 'Formulario no encontrado' });

  forms[idx].items = (forms[idx].items || []).filter(i => i.id !== Number(req.params.item_id));
  forms[idx].updated_at = nowMxDate();
  db.rhh_eval_forms = forms;
  write(db);
  res.json({ ok: true });
});

// ── Helper: encontrar formulario para un empleado ─────────────────────────────
// Orden de matching:
//   1. position_ids en el form de DB (legacy)
//   2. position_names en el form de DB
//   3. position_names en el TEMPLATE (fallback cuando DB no fue re-seeded)
function findFormForEmp(emp, forms, positions) {
  if (!emp || !emp.position_id) return null;

  // Resolver nombre de puesto del empleado
  const pos = positions ? positions.find(p => p.id === emp.position_id) : null;
  const normEmpPos = pos ? normPos(pos.name) : null;

  for (const form of forms) {
    // 1. Por position_id
    if ((form.position_ids || []).includes(emp.position_id)) return form;
    if (form.position_id === emp.position_id) return form;

    if (!normEmpPos) continue;

    // 2. Por position_names en el form guardado en DB
    if ((form.position_names || []).some(pn => normPos(pn) === normEmpPos)) return form;

    // 3. Fallback: por position_names en el template (si la DB no tiene position_names)
    const tpl = EVAL_TEMPLATES_2026.find(t => t.group_name === form.group_name);
    if (tpl && (tpl.position_names || []).some(pn => normPos(pn) === normEmpPos)) return form;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SESIONES DE EVALUACIÓN
// ══════════════════════════════════════════════════════════════════════════════

router.get('/sessions', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  res.json(db.rhh_eval_sessions || []);
});

router.post('/sessions', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { name, month, year } = req.body || {};
  if (!name || !month || !year) return res.status(400).json({ error: 'name, month y year requeridos' });

  const sessions = db.rhh_eval_sessions || [];
  const session = {
    id: nextId(sessions),
    name: String(name),
    month: Number(month),
    year: Number(year),
    status: 'open',
    entries: [],
    created_at: nowMxDate()
  };
  sessions.push(session);
  db.rhh_eval_sessions = sessions;
  write(db);
  res.status(201).json(session);
});

// GET /api/rhh/evaluations/sessions/my-pending  ← debe ir ANTES de /:id
router.get('/sessions/my-pending', rhhAuthRequired, (req, res) => {
  const db = read();
  const userId = req.rhhUser.id;
  const forms = db.rhh_eval_forms || [];
  const sessions = (db.rhh_eval_sessions || []).filter(s => s.status === 'open');
  const results = db.rhh_eval_results || [];
  const pending = [];

  for (const session of sessions) {
    for (const entry of (session.entries || [])) {
      if (entry.evaluador_id !== userId) continue;
      const alreadyDone = results.some(
        r => r.session_id === session.id && r.employee_id === entry.employee_id
      );
      const emp = (db.rhh_employees || []).find(e => e.id === entry.employee_id);
      const pos = emp ? (db.rhh_positions || []).find(p => p.id === emp.position_id) : null;
      // Prioridad: form_id guardado en entry > búsqueda dinámica por position_id
      const entryFormId = entry.form_id || null;
      const form = entryFormId
        ? (forms.find(f => f.id === entryFormId) || findFormForEmp(emp, forms, db.rhh_positions))
        : findFormForEmp(emp, forms, db.rhh_positions);
      pending.push({
        session_id: session.id,
        session_name: session.name,
        employee_id: entry.employee_id,
        employee_name: emp?.full_name || '—',
        position_name: pos?.name || '—',
        asistencias: entry.asistencias,
        faltas: entry.faltas,
        retardos: entry.retardos,
        actas: entry.actas,
        amonestaciones: entry.amonestaciones,
        form_id: form?.id || null,
        form_group: form?.group_name || null,
        form_items: form?.items || [],
        form_total_points: (form?.items || []).reduce((s, it) => s + maxPtsByItem(it), 0),
        completed: alreadyDone
      });
    }
  }

  res.json(pending);
});

router.get('/sessions/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const session = (db.rhh_eval_sessions || []).find(s => s.id === Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json(session);
});

router.patch('/sessions/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessions = db.rhh_eval_sessions || [];
  const idx = sessions.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });

  const { status } = req.body || {};
  if (status) sessions[idx] = { ...sessions[idx], status };
  db.rhh_eval_sessions = sessions;
  write(db);
  res.json(sessions[idx]);
});

// DELETE /api/rhh/evaluations/sessions/:id — borrar sesión y sus resultados
router.delete('/sessions/:id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessions = db.rhh_eval_sessions || [];
  const sid = Number(req.params.id);
  const idx = sessions.findIndex(s => s.id === sid);
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });
  sessions.splice(idx, 1);
  db.rhh_eval_sessions = sessions;
  db.rhh_eval_results = (db.rhh_eval_results || []).filter(r => r.session_id !== sid);
  write(db);
  res.json({ ok: true });
});

// POST /api/rhh/evaluations/sessions/:id/reset — vaciar entries y resultados, reabrir sesión
router.post('/sessions/:id/reset', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessions = db.rhh_eval_sessions || [];
  const sid = Number(req.params.id);
  const idx = sessions.findIndex(s => s.id === sid);
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });
  sessions[idx] = { ...sessions[idx], entries: [], status: 'open', updated_at: nowMxDate() };
  db.rhh_eval_sessions = sessions;
  db.rhh_eval_results = (db.rhh_eval_results || []).filter(r => r.session_id !== sid);
  write(db);
  res.json(sessions[idx]);
});

router.patch('/sessions/:id/entries', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessions = db.rhh_eval_sessions || [];
  const idx = sessions.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });

  const { employee_id, evaluador_id, asistencias, faltas, retardos, actas, amonestaciones } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id requerido' });

  const session = { ...sessions[idx], entries: [...(sessions[idx].entries || [])] };
  const entryIdx = session.entries.findIndex(e => e.employee_id === Number(employee_id));
  const entry = {
    employee_id: Number(employee_id),
    evaluador_id: evaluador_id ? Number(evaluador_id) : null,
    asistencias: asistencias !== undefined ? Number(asistencias) : null,
    faltas: faltas !== undefined ? Number(faltas) : null,
    retardos: retardos !== undefined ? Number(retardos) : null,
    actas: actas !== undefined ? Number(actas) : null,
    amonestaciones: amonestaciones !== undefined ? Number(amonestaciones) : null,
    saved: true
  };

  if (entryIdx >= 0) session.entries[entryIdx] = { ...session.entries[entryIdx], ...entry };
  else session.entries.push(entry);

  sessions[idx] = session;
  db.rhh_eval_sessions = sessions;
  write(db);
  res.json(session);
});

// POST /api/rhh/evaluations/sessions/:id/assign — asignación masiva de evaluador
router.post('/sessions/:id/assign', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const { evaluador_id, employee_ids } = req.body || {};
  if (!evaluador_id || !Array.isArray(employee_ids) || employee_ids.length === 0) {
    return res.status(400).json({ error: 'evaluador_id y employee_ids requeridos' });
  }
  const sessions = db.rhh_eval_sessions || [];
  const idx = sessions.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });

  const forms    = db.rhh_eval_forms || [];
  const session = { ...sessions[idx], entries: [...(sessions[idx].entries || [])] };
  for (const empId of employee_ids) {
    const emp  = (db.rhh_employees || []).find(e => e.id === Number(empId));
    const form = findFormForEmp(emp, forms, db.rhh_positions);
    const eIdx = session.entries.findIndex(e => e.employee_id === Number(empId));
    if (eIdx >= 0) {
      session.entries[eIdx] = {
        ...session.entries[eIdx],
        evaluador_id: Number(evaluador_id),
        // Guardar form_id en la entry para que my-pending lo use aunque position_id cambie
        form_id: form?.id ?? session.entries[eIdx].form_id ?? null,
      };
    } else {
      session.entries.push({
        employee_id: Number(empId),
        evaluador_id: Number(evaluador_id),
        form_id: form?.id || null,
        asistencias: null, faltas: null, retardos: null, actas: null, amonestaciones: null,
        saved: false
      });
    }
  }
  sessions[idx] = session;
  db.rhh_eval_sessions = sessions;
  write(db);
  res.json({ ok: true, assigned: employee_ids.length });
});

// POST /api/rhh/evaluations/sessions/:id/relink-forms
// Recalcula y guarda form_id en todas las entries de la sesión (útil tras re-importar CONTPAQ i)
router.post('/sessions/:id/relink-forms', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessions = db.rhh_eval_sessions || [];
  const idx = sessions.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Sesión no encontrada' });
  const forms = db.rhh_eval_forms || [];
  const session = { ...sessions[idx], entries: [...(sessions[idx].entries || [])] };
  let linked = 0;
  for (let i = 0; i < session.entries.length; i++) {
    const entry = session.entries[i];
    const emp  = (db.rhh_employees || []).find(e => e.id === entry.employee_id);
    const form = findFormForEmp(emp, forms, db.rhh_positions);
    if (form && form.id !== entry.form_id) {
      session.entries[i] = { ...entry, form_id: form.id };
      linked++;
    }
  }
  sessions[idx] = session;
  db.rhh_eval_sessions = sessions;
  write(db);
  res.json({ ok: true, linked, total: session.entries.length });
});

// GET /api/rhh/evaluations/sessions/:id/progress — progreso agrupado por evaluador
router.get('/sessions/:id/progress', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const session = (db.rhh_eval_sessions || []).find(s => s.id === Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  const results = db.rhh_eval_results || [];
  const allUsers = db.rhh_users || [];
  const allEmployees = db.rhh_employees || [];

  const byEvaluador = {};
  for (const entry of (session.entries || [])) {
    if (!entry.evaluador_id) continue;
    const eid = entry.evaluador_id;
    if (!byEvaluador[eid]) {
      const u = allUsers.find(u => u.id === eid);
      byEvaluador[eid] = {
        evaluador_id: eid,
        evaluador_nombre: u?.full_name || `ID ${eid}`,
        employees: []
      };
    }
    const done = results.some(r => r.session_id === session.id && r.employee_id === entry.employee_id);
    const emp = allEmployees.find(e => e.id === entry.employee_id);
    byEvaluador[eid].employees.push({
      employee_id: entry.employee_id,
      employee_name: emp?.full_name || '—',
      evaluated: done
    });
  }

  res.json(Object.values(byEvaluador).map(g => ({
    ...g,
    total: g.employees.length,
    evaluated: g.employees.filter(e => e.evaluated).length
  })));
});

// ══════════════════════════════════════════════════════════════════════════════
// RESULTADOS DE EVALUACIÓN
// ══════════════════════════════════════════════════════════════════════════════

router.get('/eval-results/employee/:id', rhhAuthRequired, (req, res) => {
  const db = read();
  const empId = Number(req.params.id);
  const user = req.rhhUser;

  if (!['rh', 'admin'].includes(user.role) && user.employee_id !== empId) {
    return res.status(403).json({ error: 'Sin acceso' });
  }

  const results = (db.rhh_eval_results || [])
    .filter(r => r.employee_id === empId)
    .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));

  const sessions = db.rhh_eval_sessions || [];
  const enriched = results.map(r => {
    const session = sessions.find(s => s.id === r.session_id);
    const entry = (session?.entries || []).find(e => e.employee_id === empId);
    return {
      ...r,
      session_name: session?.name || '—',
      asistencias: entry?.asistencias ?? null,
      faltas: entry?.faltas ?? null,
      retardos: entry?.retardos ?? null,
      actas: entry?.actas ?? null,
      amonestaciones: entry?.amonestaciones ?? null
    };
  });

  res.json(enriched);
});

router.get('/eval-results/session/:session_id', rhhAuthRequired, rhhRequireRole('rh', 'admin'), (req, res) => {
  const db = read();
  const sessionId = Number(req.params.session_id);
  const results = (db.rhh_eval_results || []).filter(r => r.session_id === sessionId);
  const employees = db.rhh_employees || [];
  const enriched = results.map(r => {
    const emp = employees.find(e => e.id === r.employee_id);
    return { ...r, employee_name: emp?.full_name || '—' };
  });
  res.json(enriched);
});

// POST /api/rhh/evaluations/eval-results
// Fórmula: pts_item = (calificacion × ponderacion) / 5 ; score_pct = Σpts / Σmax × 100
router.post('/eval-results', rhhAuthRequired, (req, res) => {
  const db = read();
  const { session_id, employee_id, form_id, item_scores } = req.body || {};
  if (!session_id || !employee_id || !form_id || !Array.isArray(item_scores)) {
    return res.status(400).json({ error: 'session_id, employee_id, form_id e item_scores requeridos' });
  }

  const form = (db.rhh_eval_forms || []).find(f => f.id === Number(form_id));
  if (!form) return res.status(404).json({ error: 'Formulario no encontrado' });

  const session = (db.rhh_eval_sessions || []).find(s => s.id === Number(session_id));
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  const isAdminOrRh = ['rh', 'admin'].includes(req.rhhUser.role);
  if (!isAdminOrRh) {
    const uid = req.rhhUser.id;
    const entry = (session.entries || []).find(
      e => e.employee_id === Number(employee_id) &&
           (e.evaluador_id === uid || Number(e.evaluador_id) === Number(uid))
    );
    if (!entry) return res.status(403).json({ error: 'No tienes asignada esta evaluación' });
  }

  const already = (db.rhh_eval_results || []).find(
    r => r.session_id === Number(session_id) && r.employee_id === Number(employee_id)
  );
  if (already) return res.status(409).json({ error: 'Esta evaluación ya fue enviada' });

  let pointsObtained = 0;
  let totalPoints = 0;
  const scoredItems = [];

  for (const it of (form.items || [])) {
    const maxPts = maxPtsByItem(it);
    const score = item_scores.find(s => s.item_id === it.id);
    const cal = score ? Math.min(5, Math.max(1, Number(score.stars))) : 0;
    // pts = (calificacion × ponderacion) / 5
    const pts = Math.round((cal * maxPts / 5) * 100) / 100;
    scoredItems.push({ item_id: it.id, item_name: it.name, stars: cal, ponderacion: maxPts, max_points: maxPts, points: pts });
    pointsObtained += pts;
    totalPoints += maxPts;
  }

  const score_pct = totalPoints > 0 ? Math.round((pointsObtained / totalPoints) * 10000) / 100 : 0;

  const results = db.rhh_eval_results || [];
  const result = {
    id: nextId(results),
    session_id: Number(session_id),
    employee_id: Number(employee_id),
    evaluador_id: req.rhhUser.id,
    form_id: Number(form_id),
    form_group: form.group_name || null,
    month: session.month,
    year: session.year,
    item_scores: scoredItems,
    points_obtained: Math.round(pointsObtained * 100) / 100,
    total_points: Math.round(totalPoints * 100) / 100,
    score_pct,
    submitted_at: nowMxDate()
  };
  results.push(result);
  db.rhh_eval_results = results;
  write(db);

  res.status(201).json(result);
});

module.exports = router;
