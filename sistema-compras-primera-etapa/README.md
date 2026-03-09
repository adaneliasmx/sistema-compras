# Sistema de Compras - Primera etapa

Proyecto entregable con:
- primera etapa funcional
- esqueleto completo de módulos
- rutas visibles desde el inicio
- módulos pendientes mostrando "En mantenimiento"

## Incluye funcional hoy
- login con roles demo
- dashboard
- catálogos base de consulta
- captura de requisiciones con múltiples ítems
- seguimiento y detalle de requisiciones
- estructura visible para compras, cotizaciones, facturación, pagos, inventarios y admin

## Usuarios demo
- cliente@demo.com / Demo123*
- comprador@demo.com / Demo123*
- admin@demo.com / Demo123*

## Instalación rápida
1. Instala Node.js 20 o superior.
2. Abre terminal en esta carpeta.
3. Ejecuta:
   npm install
4. Inicializa la base:
   npm run init-db
5. Inicia el sistema:
   npm start
6. Abre en navegador:
   http://localhost:3000

## Estructura
- frontend/public: HTML, CSS y JS
- backend/src: servidor Express y rutas API
- database: base SQLite
- storage: archivos y adjuntos
- scripts/init-db.js: crea la base demo

## Nota
Este entregable está pensado para instalarse fácil, entender la arquitectura y crecer por etapas.
