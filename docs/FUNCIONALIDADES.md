# Estado de funcionalidades de la demo

Leyenda: **Implementado** = funciona de punta a punta con datos reales de la base. **Simulado (demo)** = etiquetado como tal en la interfaz. **Futuro** = fuera del alcance de la demo.

## P0 — Demo imprescindible

| Módulo | Estado | Detalle |
|---|---|---|
| Login y roles | Implementado | Correo y contraseña o acceso rápido por rol (modo demo). 5 roles con permisos por módulo y acción. |
| Navegación y diseño | Implementado | Menú por grupos, responsive (escritorio, tablet, móvil), foco visible, etiquetas visibles, estados vacíos, carga y error. |
| Dashboard | Implementado | 6 indicadores, alertas priorizadas con acción, accesos rápidos, ventas por día, pedidos por estado, producción y actividad reciente. Selector de periodo. |
| Clientes | Implementado | Lista con búsqueda (nombre, documento, teléfono), filtros, ficha con resumen, pedidos, historial y saldos. Crear desde el pedido sin salir. Consentimiento para campañas. |
| Productos | Implementado | Terminados, materias primas, insumos y servicios. Tallas × colores → variantes con precio y mínimo propios. Margen, duplicar, archivar, receta de materiales, exportar CSV. |
| Pedidos | Implementado | Asistente de 4 pasos (cliente, productos con personalización, entrega y pago, confirmar), lista y tablero por estado, detalle con línea de tiempo, pagos parciales y varios métodos, reversos, edición, notas, duplicar, cancelar con motivo, comprobante imprimible. |
| Venta rápida | Implementado | Punto de venta: productos disponibles, cálculo de cambio, dos métodos de pago, venta a crédito con cliente, comprobante. |
| Inventario | Implementado | Terminado vs. materiales, físico, separado y disponible, movimientos con filtros, ajustes con motivo, conteo físico con diferencias, lista de reposición. |
| Producción | Implementado | Tablero por etapas, detalle con materiales vs. disponible, consumo y merma, avance por talla, incidencias, control de calidad, entrada a bodega y pedido listo. |
| Caja básica | Implementado | Abrir, ingresos, gastos, reversos, cierre con conteo y diferencia, historial y reporte imprimible. |
| Datos demo | Implementado | Un año de historia coherente; reinicio desde Configuración o `npm run db:reset`. |

## P1 — Completar experiencia

| Módulo | Estado | Detalle |
|---|---|---|
| Entregas | Implementado | Agenda (atrasados, hoy, próximos días), entrega total o parcial, quién recibe, bloqueo por saldo con autorización, comprobante. |
| Cartera | Implementado | Por pedido y por cliente; al día, vence pronto y vencida; abonos; recordatorio por WhatsApp (abre el chat). |
| Cuentas por pagar y gastos | Implementado | Gasto inmediato (caja) u obligación con vencimiento; abonos; estados pendiente, abonada, pagada y vencida. |
| Proveedores y compras | Implementado | Ficha, compras, recepción parcial o con faltantes, cuenta por pagar automática, historial de precios. |
| Reportes | Implementado | 13 reportes con periodo, gráfico, tabla con totales, CSV e impresión a PDF desde el navegador. Indicadores: ticket promedio, resultado aproximado, margen, entregas a tiempo y tiempo de producción. |
| Comprobantes | Implementado | Pedido o venta, recibo de pago, entrega y reporte de caja (imprimir o guardar PDF). Indican que no son facturas. |
| Permisos | Implementado | Validados en la API; Producción no ve dinero; acciones sensibles (descuentos de más del 10%, reversos, entregas con saldo, cierre de caja) restringidas. |
| Auditoría | Implementado | Consulta con búsqueda y filtro de acciones sensibles. |

## P2 — Preparación futura

| Módulo | Estado | Detalle |
|---|---|---|
| Estimaciones | Implementado con reglas | Temporadas, ventas de los próximos 3 meses con escenarios, compras de materiales recomendadas con explicación y flujo de dinero de 4 semanas. **No hay IA conectada** y así se indica. |
| Marketing | Simulado (demo) | Campañas, grupos de clientes, plantillas y biblioteca. Los mensajes se copian o se abren en WhatsApp; **no se envían solos**. |
| Mensajes a clientes | Simulado (demo) | Plantillas rellenadas con datos del pedido; botón “Abrir WhatsApp”. |
| Configuración | Implementado | Empresa, tallas, colores, categorías, unidades, etapas de producción, métodos de pago, usuarios. |
| Impuestos y facturación electrónica | Futuro | Marcado en la interfaz como pendiente de definición contable y legal (DIAN). |
| Integración WhatsApp Business, redes y POS | Futuro | La estructura de plantillas y segmentos está lista para conectarse. |
| Roles personalizados | Futuro | Hoy hay 5 roles fijos; la matriz de permisos está en un solo archivo. |
| Carga de archivos (fotos, logos, evidencias de entrega) | Futuro | En la demo se guarda un enlace. |
| Importar catálogo desde CSV | Futuro | Exportar sí está disponible. |
| Varias bodegas y transferencias | Futuro | Hay una ubicación por producto. |

## Limitaciones conocidas

- Una sola caja abierta a la vez (un punto de venta).
- Los precios no incluyen IVA.
- El reinicio de datos demo tarda uno o dos minutos y bloquea la app mientras tanto (con aviso).
- Las estimaciones usan un año de historia: la confianza es baja a media y así se muestra.
