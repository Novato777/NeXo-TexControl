# Auditoría de seguridad, robustez y carga

Fecha: noviembre de 2026. Alcance: API (Express + Drizzle), frontend (React) y base de datos (PGlite local / PostgreSQL).

## Cómo se probó

| Prueba | Comando | Resultado final |
|---|---|---|
| Seguridad y entradas maliciosas | `npm run test:security` | 231 / 231 comprobaciones |
| Carga masiva y concurrencia | `npm run test:load` (`-- --scale=2` para el doble) | Sin errores 500; integridad 11/11 |
| Flujos del negocio (API) | `npm run test:flows` | 48 / 48 |
| Flujos en pantalla | `node tests/ui-flows.mjs` | 10 / 10 |
| Lógica compartida | `npm test` | 12 / 12 |
| Integridad de datos en vivo | Admin: `GET /api/audit/integrity` | 0 problemas |

Carga aplicada en total: ~9.000 pedidos y ventas, ~4.500 clientes, ~720 variantes, 180 compras, 600 abonos, a 20 operaciones simultáneas.

## Fallas encontradas y corregidas

| # | Falla | Severidad | Corrección |
|---|---|---|---|
| 1 | Un pedido con miles de renglones (40.000 parámetros) rompía el canal con la base: todo el sistema empezaba a responder vacío. Denegación de servicio con una sola petición. | Crítica | Máximo 300 renglones por pedido, venta, compra u orden; límites en todas las listas. |
| 2 | El acceso rápido por rol (sin contraseña) quedaba activo en producción por defecto. | Crítica | Desactivado en producción salvo `DEMO_MODE=true` explícito. |
| 3 | Sin límite de intentos de ingreso (fuerza bruta). | Alta | 10 fallos por IP+correo bloquean 10 minutos (429). Tiempo de respuesta constante para no revelar qué correos existen. |
| 4 | Un usuario desactivado o con el rol cambiado seguía operando hasta 12 h (token vigente). | Alta | La sesión se valida contra la base en cada petición (caché de 5 s). |
| 5 | Montos y cantidades enormes desbordaban los enteros de la base (error 500). | Alta | Topes: dinero 2.000 millones, cantidades 1 millón; verificación de totales calculados. |
| 6 | Caracteres nulos en búsquedas o textos producían error 500. | Alta | Limpieza de caracteres de control en cuerpo y parámetros. |
| 7 | La biblioteca de marketing aceptaba enlaces `javascript:` (XSS al hacer clic). | Alta | Solo `http(s)://`, validado en la API y en la pantalla. |
| 8 | Formularios de otros sitios (text/plain) llegaban a la API (CSRF). | Media | Toda acción que modifica datos exige JSON (415 si no). Cookie `HttpOnly` + `SameSite=Lax`. |
| 9 | Fechas, límites e ids inválidos en los filtros causaban error 500. | Media | Lectura segura de filtros con valores por defecto. |
| 10 | Exportaciones CSV permitían fórmulas maliciosas al abrirse en Excel. | Media | Los textos que empiezan por `= + - @` se neutralizan. |
| 11 | Dos personas podían abrir caja al mismo tiempo. | Media | Índice único en la base: solo una caja abierta. |
| 12 | Faltaban cabeceras de seguridad. | Media | `nosniff`, `X-Frame-Options: DENY`, `CSP`, `Referrer-Policy`, `no-store` y `HSTS` en producción. |
| 13 | El Inicio tardaba 1,2 s con mucha data (una consulta por material y orden). | Media | Una sola consulta; ahora ~0,5 s con 9.000 operaciones. |
| 14 | La lista y el selector de clientes devolvían todos los registros. | Baja | Tope de 500 en la lista (con aviso) y 8 en el selector. |
| 15 | JSON mal formado o demasiado grande se registraba como error interno. | Baja | Respuestas 400 y 413 con mensaje claro. |

## Controles que ya estaban bien

- Inyección SQL: todas las consultas son parametrizadas (Drizzle). Probado con `' OR 1=1 --`, `DROP TABLE`, comodines LIKE, etc.
- Tokens falsificados (`alg: none`): rechazados; algoritmo fijo `HS256`.
- Permisos por rol validados en la API (14 combinaciones prohibidas devuelven 403). Producción no recibe cifras de dinero.
- Concurrencia: 40 ventas simultáneas con 10 unidades venden exactamente 10; 25 pagos simultáneos del mismo saldo aceptan 1; 20 ajustes simultáneos sobre 5 unidades aplican 5; confirmaciones repetidas no duplican reservas.
- Transacciones: ninguna operación queda a medias; dinero en enteros; nada se borra (reversos y ajustes auditados).
- Errores: nunca se muestran trazas, nombres de tablas ni detalles internos al usuario.

## Recomendaciones antes de un uso real

1. `DEMO_MODE=false`, `JWT_SECRET` propio y largo, y cambiar o desactivar los usuarios demo.
2. `TRUST_PROXY=2` cuando la web va por Vercel y la API por Render (para conocer la IP real).
3. Activar respaldos automáticos y *point-in-time recovery* en Neon.
4. Revisar `GET /api/audit/integrity` periódicamente (se puede automatizar como alerta).
5. Si varias sedes operan en paralelo, considerar un límite general de peticiones por usuario.
