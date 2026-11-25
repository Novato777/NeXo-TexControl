# TexControl — Demo del sistema de gestión de uniformes

Demo funcional (MVP demostrativo) de un sistema para una empresa que **fabrica y vende uniformes**: pedidos personalizados, ventas de mostrador, producción por etapas, inventario de telas e insumos, caja, cartera, proveedores, reportes y estimaciones.

Pensado para personas con poca experiencia en computadores: una acción principal por pantalla, botones con verbos, asistentes paso a paso, validaciones que dicen cómo corregir y confirmación antes de todo lo que mueve dinero o inventario.

> Desarrollado por NeXo Software Solutions. Los datos son de ejemplo (empresa ficticia “Confecciones Horizonte S.A.S.”).

---

## Requisitos

- **Node.js 20 o superior** (probado con Node 24) y npm.
- Nada más. La base de datos local es **PGlite** (PostgreSQL real embebido): no hay que instalar PostgreSQL ni Docker.

## Instalación y ejecución local

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000 (la web la usa a través de `/api`)

La **primera vez** la API crea la base en `apps/api/.data/pglite` y carga un año de datos de ejemplo (tarda entre 30 y 60 segundos). Mientras tanto la pantalla de ingreso muestra “Estamos preparando la demo”.

Si `npm install` avisa de *install scripts* bloqueados (npm 11), no pasa nada: el proyecto funciona igual.

### Cuentas de demostración

En la pantalla de ingreso hay botones para entrar directo con cada rol. También se puede ingresar con correo y contraseña:

| Rol | Correo | Qué puede hacer |
|---|---|---|
| Administrador | admin@demo.co | Todo, incluida la configuración |
| Ventas | ventas@demo.co | Clientes, pedidos, ventas y entregas |
| Producción | produccion@demo.co | Órdenes de producción (no ve dinero) |
| Caja y finanzas | caja@demo.co | Caja, pagos, gastos, cartera, reportes |
| Inventario | inventario@demo.co | Productos, existencias, compras |

Contraseña de todas: **`Demo2026*`** (se cambia con la variable `DEMO_PASSWORD`).

### Scripts útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta API y web en modo desarrollo |
| `npm run db:reset` | Borra todo y vuelve a cargar los datos demo (detén la API antes) |
| `npm run db:seed` | Carga datos demo solo si la base está vacía (nunca duplica) |
| `npm run db:check` | Verifica integridad: stock vs. movimientos, pagos vs. pedidos, reservas, cajas |
| `npm test` | Pruebas unitarias (Vitest) de la lógica compartida |
| `npm run test:flows` | Prueba de extremo a extremo de los 5 flujos del brief contra la API (modifica datos) |
| `node tests/ui-flows.mjs` | Prueba de interfaz: recorre el asistente de pedido y la venta rápida con el navegador |
| `npm run test:security` | Auditoría de seguridad y entradas maliciosas (231 comprobaciones) |
| `npm run test:load` | Carga masiva y ataques de concurrencia; termina con verificación de integridad (modifica datos) |
| `npm run screens` | Toma capturas de pantalla (usa Edge o Chrome instalado) |
| `npm run typecheck` | Revisión de tipos de todo el monorepo |
| `npm run build` | Compila la web para producción |

También se pueden restablecer los datos desde la app: **Configuración → Datos de demostración**.

## Variables de entorno

Archivo `apps/api/.env` (copia de `apps/api/.env.example`):

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto de la API | `4000` |
| `DATABASE_URL` | PostgreSQL (Neon u otro). Vacía = PGlite local | vacía |
| `JWT_SECRET` | Firma de sesiones. **Obligatoria en producción** | valor de desarrollo |
| `CORS_ORIGIN` | Solo si el frontend llama a la API en otro dominio sin proxy | vacía |
| `DEMO_PASSWORD` | Contraseña de las cuentas demo | `Demo2026*` |
| `AUTO_SEED` | Cargar datos demo si la base está vacía | `true` |
| `DEMO_MODE` | `true` activa el acceso rápido por rol y el reinicio de datos. En producción está apagado salvo que se ponga `true` | `true` en local |
| `TRUST_PROXY` | Saltos de proxy de confianza (1 = Render, 2 = Vercel + Render) | `1` |

Frontend (opcional): `VITE_API_URL` si la API no se sirve en el mismo dominio por `/api`.

## Estructura

```
apps/
  api/            Express + TypeScript. Rutas → servicios → Drizzle ORM
    src/db/         esquema, conexión (PGlite o PostgreSQL), seed y verificación
    src/services/   reglas de negocio transaccionales (inventario, pedidos, caja, producción, compras)
    src/routes/     API REST por módulo
    drizzle/        migraciones SQL (se aplican solas al iniciar)
  web/            React 19 + Vite + Tailwind 4 + Radix + Recharts + TanStack Query
    src/components/ sistema de diseño (botones, campos, tablas, modales, estados)
    src/pages/      un directorio por módulo
packages/
  shared/         estados, transiciones, permisos, moneda, fechas y validaciones Zod (los usan API y web)
tests/            unitarias (Vitest), flujos de API y de interfaz (Playwright)
docs/             decisiones, funcionalidades, despliegue y capturas
```

## Despliegue (Neon + Render + Vercel)

Resumen (detalle en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)):

1. **Neon**: crear la base y copiar la cadena de conexión (`...?sslmode=require`).
2. **Render**: crear el servicio con `render.yaml` (o a mano: build `npm install`, start `npm run start:api`), poner `DATABASE_URL`. Las migraciones y los datos demo se aplican solos al primer arranque.
3. **Vercel**: importar el repositorio con la raíz del proyecto en la carpeta principal. `vercel.json` ya define build y salida; cambiar en él la URL de Render. Vercel reenvía `/api` a Render, así la sesión funciona sin problemas de cookies entre dominios.

## Más documentación

- [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md): qué está implementado, qué está simulado y qué queda para después.
- [docs/DECISIONES.md](docs/DECISIONES.md): decisiones técnicas y reglas de integridad.
- [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md): paso a paso del despliegue.
- [docs/SEGURIDAD.md](docs/SEGURIDAD.md): auditoría de seguridad, robustez y carga.
- [docs/capturas/](docs/capturas/): capturas de las pantallas principales.
