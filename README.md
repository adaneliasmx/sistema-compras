# Sistema de Compras - Base funcional ampliada

Incluye funcional hoy:
- login con roles demo
- dashboard
- catálogos con altas rápidas
- captura de requisiciones con múltiples ítems
- seguimiento y detalle de requisiciones
- compras con generación de PO por proveedor
- cotizaciones básicas
- facturación básica
- pagos básicos
- inventarios básicos
- administración de usuarios

## Usuarios demo
- cliente@demo.com / Demo123*
- comprador@demo.com / Demo123*
- admin@demo.com / Demo123*
- pagos@demo.com / Demo123*

## Instalación rápida
1. Instala Node.js 20 o superior.
2. Ejecuta `npm install`
3. Inicializa la base con `npm run init-db`
4. Inicia con `npm start`
5. Abre `http://localhost:3000`

## Base de datos
Esta versión usa JSON local en `database/app.json` para facilitar pruebas y despliegue rápido.
