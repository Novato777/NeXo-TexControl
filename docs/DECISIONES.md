# Decisiones técnicas

## Stack

| Capa | Elección | Por qué |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite 8 | Pedido en el brief; build rápido y estático (ideal para Vercel). |
| Estilos | Tailwind CSS 4 con *design tokens* en `apps/web/src/index.css` | Una sola estrategia, consistente en todas las pantallas. |
| Componentes | Radix Dialog (modales accesibles) + componentes propios | Foco atrapado, Escape y lectores de pantalla en modales; el resto se adapta a la UX “a prueba de tontos”. |
| Datos en la web | TanStack Query | Estados de carga, error y reintento uniformes; al guardar se refrescan todas las vistas (un pago cambia caja, cartera y dashboard a la vez). |
| Gráficos | Recharts | Pedido en el brief. Una serie por gráfico, color único, tooltip y tabla al lado. |
| Backend | Node + Express 5 + TypeScript (tsx) | Pedido en el brief. Express 5 maneja errores async sin envoltorios. |
| ORM | **Drizzle** | SQL explícito, migraciones en SQL plano y soporte nativo para PGlite y node-postgres con el mismo esquema. |
| Base local | **PGlite** (PostgreSQL en WebAssembly) | No había PostgreSQL ni Docker en la máquina. Es PostgreSQL real, así que lo que funciona local funciona en Neon. |
| Base producción | Neon (PostgreSQL) vía `pg` | Se activa con solo definir `DATABASE_URL`. |
| Validación | Zod 4 en `packages/shared` | Las mismas reglas y mensajes en la API y los formularios. |
| Sesión | JWT en cookie `httpOnly` + bcrypt | Sin tokens en `localStorage`. El proxy `/api` de Vercel evita cookies de terceros. |
| Pruebas | Vitest (unitarias), script de flujos contra la API, Playwright (interfaz) | Playwright usa Edge/Chrome ya instalado; no descarga navegadores. |

## Reglas de integridad implementadas

- **Dinero en pesos enteros** (`integer`), nunca `float`. Cantidades en `numeric(14,3)` (permite metros de tela).
- **Todo lo que afecta dinero, stock, pedidos o producción ocurre en el backend dentro de una transacción.** Si falla un paso, no queda nada a medias.
- **Inventario:** cada cambio pasa por `moveStock`, que deja un movimiento con tipo, motivo, usuario, referencia y saldo resultante. No se permite stock negativo. Los errores se corrigen con ajustes, nunca borrando movimientos.
- **Disponible = físico − separado.** Al confirmar un pedido se separa el stock disponible de lo no personalizado. Lo personalizado (logo, bordado, nombres) siempre se fabrica.
- **Producción:** los materiales se descuentan solo al registrar el consumo (una vez por orden); al terminar se puede descontar lo que falte según la receta. Terminar exige todas las unidades hechas y el control de calidad aprobado; las unidades entran a bodega ya separadas para el pedido, y si no queda nada pendiente el pedido pasa a “Listo”.
- **Pedidos:** transiciones de estado válidas definidas en `packages/shared/src/constants.ts`. Cancelar exige motivo, libera reservas, cancela producción abierta y opcionalmente reversa los pagos.
- **Pagos:** no pueden superar el saldo; hay protección contra doble registro (mismo pedido, valor y método en 20 segundos). Los reversos son registros negativos con motivo; el pago original queda marcado, no se borra.
- **Caja:** el efectivo exige caja abierta; no se puede sacar más efectivo del que hay. El cierre compara esperado contra contado y exige explicación si hay diferencia.
- **Entregas:** con saldo pendiente solo se entrega si un usuario autorizado lo confirma (queda en auditoría). Se admiten entregas parciales.
- **Compras:** el inventario sube solo al confirmar la recepción, con recepción parcial y cierre con faltantes. Cada compra genera su cuenta por pagar.
- **Auditoría:** cambios de precio, ajustes de stock, reversos, cierres de caja, cancelaciones, entregas con saldo y cambios de usuarios.
- **Consecutivos legibles:** PED-, VEN-, OP-, OC-, REC-, ENT-, CXP-, CAJA-.
- **Permisos** por módulo y por acción (`packages/shared/src/permissions.ts`), validados en la API y reflejados en la interfaz. Producción no ve cifras de dinero (la API las oculta).

## Datos de demostración

`apps/api/src/db/seed.ts` genera **un año de historia** (más de 500 ventas, unos 50 pedidos, compras mensuales, gastos fijos, cajas de los últimos 10 días) pasando por **los mismos servicios que usa la app**. Por eso stock, movimientos, pagos, caja y cartera cuadran entre sí (`npm run db:check` lo verifica).

- Es determinístico (semilla fija) y solo se carga si la base está vacía.
- Antes de ejecutar la historia, simula el stock *disponible* día a día y calcula el inventario inicial necesario para que nunca quede negativo.
- Las fechas son relativas al día en que se carga, así la demo siempre luce actual: hay pedidos atrasados, entregas para hoy, cartera vencida y por vencer, materiales bajo mínimo y una caja abierta.

## Experiencia de uso (“a prueba de tontos”)

- Tipografía **Atkinson Hyperlegible Next** (diseñada para baja visión; distingue 0/O, 1/l/I) con cifras tabulares.
- Una acción principal por pantalla; las secundarias en “Más opciones”.
- Asistente de 4 pasos para pedidos, con resumen siempre visible y validación por paso.
- Menú de 10 secciones; las pantallas hermanas (p. ej. Caja, Por cobrar, Por pagar) se recorren con una sola fila de pestañas.
- Una franja compacta de cifras por pantalla, filtros avanzados ocultos tras “Filtros” y acciones secundarias en el menú “Más”.
- Selector de productos sin escribir códigos: producto → botones grandes de talla y color con existencias visibles.
- Dinero con formato automático mientras se escribe; cantidades con botones − / +.
- Estados siempre con texto, color e ícono. Confirmación con nombre de la acción y su consecuencia.
- Elemento visual propio: la “costura” (línea punteada) en el menú activo, pasos y barras de avance tipo cinta métrica.

## Problemas encontrados y cómo se resolvieron

- **No había PostgreSQL ni Docker** → PGlite local con el mismo esquema que Neon.
- **npm 11 bloquea *install scripts*** → no afecta: esbuild y PGlite funcionan sin ellos.
- **Versiones de Vite 7 y 8 mezcladas** en el monorepo → se alineó todo a Vite 8 y plugin-react 6.
- **Carga demo lenta contra una base remota** → la API abre el puerto primero y carga los datos en segundo plano, respondiendo 503 amable mientras tanto.
- **Bugs encontrados en pruebas y corregidos:** el rol Producción podía consultar la caja; la venta rápida mostraba un mensaje confuso cuando faltaba stock; tras enviar a producción, Ventas era llevado a una pantalla sin permiso; el pedido ofrecía “Enviar a producción” aunque todo ya estaba en una orden.

## Las 10 heurísticas de usabilidad (Nielsen) aplicadas

| Heurística | Cómo se aplica |
|---|---|
| 1. Visibilidad del estado del sistema | Barra de actividad arriba mientras se carga o guarda; botones con “cargando”; avisos de éxito o error; línea de avance del pedido y de producción; estado de la caja siempre visible en la barra superior; aviso cuando no hay internet. |
| 2. Coincidencia con el mundo real | Palabras del taller: “Cotización”, “Por cobrar”, “Le debes”, “Vender”, “Recibir mercancía”; dinero en pesos con puntos de miles; fechas como “hoy”, “mañana”, “en 5 días”. |
| 3. Control y libertad del usuario | Volver atrás en el asistente sin perder datos; Esc cierra ventanas; aviso antes de salir de un pedido o venta sin guardar; reversos y ajustes para corregir sin borrar. |
| 4. Consistencia y estándares | Un solo patrón de encabezado, pestañas, franja de cifras, filtros y menú “Más”; los estados siempre con el mismo color, ícono y texto; la misma acción tiene el mismo nombre en todas partes. |
| 5. Prevención de errores | Confirmación antes de mover dinero o inventario; validación inmediata; no se puede pagar más del saldo, vender sin stock, pagar dos veces ni cerrar la caja descuadrada sin explicación. |
| 6. Reconocer antes que recordar | Buscador global (Ctrl+K) por número, cliente, teléfono o producto; tallas como botones con existencias visibles; resumen del pedido siempre a la vista. |
| 7. Flexibilidad y eficiencia | Atajos: Ctrl+K buscar, Alt+N crear pedido, Alt+V vender, ? ayuda; accesos rápidos en Inicio; botones de valores frecuentes (50%, Todo, 15 días). |
| 8. Diseño estético y minimalista | Menú de 10 secciones, máximo 4 cifras por pantalla, filtros avanzados ocultos, información secundaria plegada. |
| 9. Ayudar a reconocer y recuperarse de errores | Mensajes que dicen qué pasó y cómo corregirlo, junto al campo; botón “Intentar de nuevo” cuando algo no carga. |
| 10. Ayuda y documentación | Botón “Ayuda” (o tecla ?) con los pasos de la pantalla actual y los atajos; explicaciones breves (?) junto a términos poco comunes. |
