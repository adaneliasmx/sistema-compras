# Contexto de rendimiento de Producción — 2026-10-10

Estado de esta entrega: optimización implementada y validada sobre 9f63252. El usuario autorizó su publicación el 2026-10-10. La confirmación y el identificador del despliegue se registran en la memoria de Claude y la bitácora del chat.

## Objetivo acordado

Conservar la vista, imágenes, menús, porcentajes y fórmulas actuales; permitir el pizarrón abierto en varias PCs. Compartir cálculos en el servidor y reutilizar información histórica, actualizando las fechas afectadas por registros nuevos, correcciones, cancelaciones, borrados, catálogos y configuración. También cubrir /produccion: Baker, L1, L3 y L4, estadísticas semanales por línea y operador.

## Diagnóstico incorporado

El usuario observó CPU baja por la noche cuando no está abierto el pizarrón. Su prueba de abrirlo varias veces coincidió con picos de hasta 1 CPU. Esto refuerza al pizarrón como prioridad; la menor cantidad de PCs del día impide atribuir toda la mejora observada al cambio anterior.

El refresco del slideshow ocurre cada cinco minutos y solicita KPIs, semanas, SCRAP, reconocimientos y configuración. Coincide con la periodicidad de los picos, aunque los logs aportados no identifican cada petición en su minuto exacto.

Causa localizada en código: getStoredOperationalContext y getParoOperationalContext llamaban a resolveTurnoContext solo para conocer fecha/turno. En L4, ese helper recalculaba la ventana TL4 recorriendo las cargas del historial para cada registro. Los slots también recorrían cargas y paros históricos por cada hora y cada lector.

Los errores PostgreSQL ECONNREFUSED/connection terminated son otro problema. Este cambio no demuestra que la persistencia se haya recuperado.

## Implementación

- backend/src/production-metrics-cache.js: caché compartida por proceso, LRU con máximo de 512 entradas y 32 MiB de JSON calculado. Ese límite no incluye la base en RAM ni los índices/huellas. Los resultados se entregan como copias para que la anotación de slots no modifique entradas compartidas.
- backend/src/db-produccion.js: read() inicializa índices y huellas; write() actualiza versiones antes de persistir. Las huellas anteriores se conservan independientemente del objeto mutable que devuelve read(). Una edición sin cambiar la longitud se detecta.
- Cargas: índices por colección, línea y fecha; una edición invalida fechas anteriores y nuevas. Los builders reciben solo cargas que pueden afectar al día/turno, preservando el orden original y las descargas T3 del día siguiente.
- Paros: selección por intervalo de fechas. Sus cambios invalidan las fechas consultadas que intersectan el intervalo anterior o nuevo, incluida la extensión de paros abiertos; registros sin fecha de inicio usan invalidación conservadora de la línea.
- Catálogos, objetivos, calendarios y horarios invalidan sus dependencias. Reemplazar la raíz por un restore/import reinicia índices y resultados.
- backend/src/routes/produccion.js: clasificación barata de fecha/turno, sin calcular la ventana TL4. resolveTurnoContext sigue validando capturas y ventanas completas. Se reutilizan ventana TL4, slots, snapshots y Pareto de defectos, también desde Planner Staff.
- Respuestas compartidas para /pizarron, /kpis, /stats/semana-linea, /stats/operador-semana, /scrap/resumen, /reconocimientos, /config y /slideshow-config. Query completa en la clave; JWT y permisos se ejecutan antes de consultar la caché.
- El avance de hora, eficiencia en curso, paros abiertos, medianoche T3 y tiempo adicional TL4 sigue usando el reloj de America/Mexico_City. Los slots estáticos se reutilizan; el componente temporal se actualiza por minuto, dentro de los refrescos existentes.
- GET /config?resumen=1 devuelve la misma configuración de métricas sin slideshow. app.js y la comprobación de sesión del slideshow usan esta variante. GET /config original sigue siendo compatible.
- Slideshow conserva imagen_b64 y el aspecto actual. ETag + If-None-Match permiten responder 304 sin volver a transferir ni comprimir las imágenes sin cambios. La primera carga, una recarga de página y una modificación de imágenes todavía reciben la configuración completa (~8.35 MB en el respaldo).
- index.html y slideshow.html usan v=20261010perf1 para obtener el JS nuevo al recargar, evitando reutilizar la versión anterior en caché.
- slideshow.js conserva la frecuencia de cinco minutos; evita refrescos solapados, reemplaza intervalos existentes de datos/reloj/urgencias y los elimina al salir. No se cambiaron HTML, CSS ni fórmulas.

Las versiones se comprueban al escribir; no se comparan historiales en cada GET. La actualización de índices/huellas recorre las colecciones indicadas por changedKeys, o todas si write() no especifica claves. Esto sigue siendo trabajo de lectura de registros en una escritura; los KPIs históricos ajenos al cambio se conservan.

## Validación

Prueba local aislada, sin red ni base de producción, con produccion-backup-2026-10-10.json (~69.9 MB). Se ejecutaron los handlers reales del código anterior y del nuevo con fecha/hora fija; las 15 respuestas comparadas tienen SHA-256 idéntico.

| Consulta | Antes | Después | Repetida |
| --- | ---: | ---: | ---: |
| Pizarrón, ambas líneas | 10,923 ms | 205 ms | 0.82 ms |
| KPI semanal L3 | 4,717 ms | 130 ms | 1.05 ms |
| KPI semanal L4 | 827 ms | 60 ms | 1.23 ms |
| KPI semanal Baker | 2,621 ms | 104 ms | 0.97 ms |
| Reconocimientos | 9,947 ms | 274 ms | 1.28 ms |
| Estadísticas semanales L3 | 4,080 ms | 238 ms | 0.94 ms |
| Estadísticas semanales L4 | 13,145 ms | 95 ms | 0.72 ms |
| Estadísticas semanales Baker | 2,666 ms | 122 ms | 1.13 ms |
| Estadísticas del operador con datos | 16,541 ms | 342 ms | 1.15 ms |

La inicialización de índices tardó ~609 ms una vez. Detectar una corrección en cargas tardó ~173 ms en esta ejecución. Los JSON almacenados ocuparon ~18.2 MB con 15 consultas. Los tiempos son mediciones locales, no garantías de CPU o latencia en Render. L1 no tiene cargas en este respaldo; se probó con datos sintéticos.

Orden reproducible: npm run test:produccion-rendimiento.

- 29 pruebas nuevas pasan: caché, objeto mutable, fechas, colecciones/IDs, paros, objetivos, horarios, restore, JWT/roles, 20 solicitudes HTTP concurrentes, 304/imágenes e intervalos.
- test_tl4.js: 99 comprobaciones pasan.
- test_tl4_supertest.js existente: 41 de 44 pasan. Los mismos tres fallos se reprodujeron con los archivos originales anteriores al cambio: #10 omitir T3 desactivado de L3, #11 expectativa antigua de numerador TL4 con arranque, #13 omitir T2 desactivado de Baker. Se mantienen las reglas actuales; no se alteraron fórmulas ni el archivo de prueba que ya estaba modificado por otro trabajo.
- Sintaxis y git diff --check de los archivos cambiados pasan.
- Runtime local Node v24.14.0; package.json declara Node 20 para Render. No se agregaron dependencias. La verificación de publicación se registra por separado.

## Publicación y seguimiento

Verificar la publicación de este cambio y observar CPU/latencia con uso comparable. Las PCs con la página ya abierta deberán recargarla para obtener el nuevo JS. No es necesario repetir como requisito la prueba manual de cerrar el pizarrón que el usuario descartó.

La caché es compartida entre PCs conectadas a la misma instancia Node. Una futura escala horizontal requeriría sincronizar tanto los datos fuente como las versiones; el sistema ya usa bases en memoria por instancia. La caché no se persiste ni introduce escrituras de snapshots en GET.

Confirmar por separado la recuperación PostgreSQL y revisar las tres expectativas antiguas de pruebas con el dueño funcional antes de modificar reglas.

## Evidencia y cuidado del trabajo existente

Los scripts, baseline del código y JSON de medición están en el workspace del chat: outputs/diagnostico-picos-2026-10-10/. Evidencia final: validacion-implementacion-final.json. No se modificaron backups, bases reales, test_tl4_supertest.js, .claude/settings.local.json ni archivos ajenos al cambio.
