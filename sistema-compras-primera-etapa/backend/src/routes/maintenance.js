const express = require('express');
const { authRequired } = require('../middleware/auth');
const router = express.Router();
router.use(authRequired);

const modules = {
  compras: {
    title: 'Compras',
    status: 'En mantenimiento',
    summary: [
      'Agrupar requisiciones por proveedor',
      'Generar órdenes de compra',
      'Solicitar cotizaciones y anticipos',
      'Reimprimir y dar seguimiento a POs'
    ]
  },
  cotizaciones: {
    title: 'Cotizaciones',
    status: 'En mantenimiento',
    summary: [
      'Portal de respuesta para proveedores',
      'Nombre oficial del ítem y código proveedor',
      'Condiciones de compra, crédito y anticipo',
      'Comparativo y selección de cotización'
    ]
  },
  facturacion: {
    title: 'Facturación y seguimiento',
    status: 'En mantenimiento',
    summary: [
      'Carga de PDF y XML',
      'Recepción de evidencia firmada',
      'Seguimiento por PO e ítem',
      'Validación documental y cierre'
    ]
  },
  pagos: {
    title: 'Pagos',
    status: 'En mantenimiento',
    summary: [
      'Facturas pendientes por pagar',
      'Registro de anticipos y pagos parciales',
      'Comprobantes de pago',
      'Historial y exportación a Excel'
    ]
  },
  inventarios: {
    title: 'Inventarios',
    status: 'En mantenimiento',
    summary: [
      'Conteo semanal de existencias',
      'Impresión de formatos de inventario',
      'Sugerencias de reposición',
      'Requisición de reposición ligada al flujo normal'
    ]
  },
  admin: {
    title: 'Administración',
    status: 'En mantenimiento',
    summary: [
      'Alta y baja de usuarios',
      'Asignación de roles y permisos',
      'Cambio de contraseñas',
      'Auditoría del sistema'
    ]
  }
};

router.get('/:module', (req, res) => {
  const mod = modules[req.params.module];
  if (!mod) return res.status(404).json({ error: 'Módulo no encontrado' });
  res.json(mod);
});

module.exports = router;
