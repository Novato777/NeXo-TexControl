# Despliegue: Neon + Render + Vercel

Arquitectura en producción:

```
Navegador ──► Vercel (web estática) ──/api/*──► Render (API Express) ──► Neon (PostgreSQL)
```

Vercel reenvía `/api/*` a Render. Para el navegador todo vive en el mismo dominio, así que la cookie de sesión (`httpOnly`, `SameSite=Lax`) funciona sin configurar CORS ni cookies de terceros.

## 1. Neon (base de datos)

1. Crear un proyecto en Neon. Elegir la **misma región** que usarás en Render (por ejemplo, US East / Ohio en ambos) para que la API responda rápido.
2. Copiar la cadena de conexión *pooled* o directa, que se ve así:
   `postgresql://usuario:clave@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

No hay que crear tablas: la API aplica las migraciones de `apps/api/drizzle/` al arrancar.

## 2. Render (API)

Opción A (blueprint): en Render, *New → Blueprint* y seleccionar el repositorio. Toma `render.yaml`.

Opción B (manual): *New → Web Service*:

| Campo | Valor |
|---|---|
| Root directory | (vacío, raíz del repositorio) |
| Runtime | Node 22 |
| Build command | `npm install` |
| Start command | `npm run start:api` |
| Health check | `/api/health` |

Variables de entorno:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | la cadena de Neon |
| `JWT_SECRET` | una cadena larga y aleatoria (Render puede generarla) |
| `DEMO_PASSWORD` | contraseña para las cuentas demo |
| `AUTO_SEED` | `true` (carga datos demo si la base está vacía) |
| `DEMO_MODE` | `true` para la demo; `false` en un piloto real |

Primer arranque: el servidor abre el puerto de inmediato y luego carga los datos demo en segundo plano (uno a tres minutos, según la latencia con Neon). Mientras tanto responde `503` con el mensaje “Estamos preparando el sistema…”, y la pantalla de ingreso se actualiza sola.

> Alternativa para no esperar en Render: cargar los datos desde tu computador apuntando a Neon:
> `DATABASE_URL="postgresql://..." npm run db:seed`

Plan gratuito de Render: el servicio “duerme” tras un rato sin uso y el primer acceso tarda unos segundos en despertar.

## 3. Vercel (web)

1. *Add New → Project* e importar el repositorio. **Root Directory: la raíz del repositorio** (no `apps/web`), para que instale el paquete compartido `packages/shared`.
2. `vercel.json` ya define:
   - Build: `npm run build:web`
   - Salida: `apps/web/dist`
   - Reenvío de `/api/*` a Render y de las demás rutas a `index.html` (navegación de la app).
3. **Antes de desplegar**, editar `vercel.json` y cambiar `https://REEMPLAZAR-CON-TU-API.onrender.com` por la URL real del servicio de Render.

## Verificación después del despliegue

1. Abrir `https://TU-API.onrender.com/api/health`: debe responder `{"ok":true,"ready":true,...}`.
2. Abrir la URL de Vercel, entrar como Administrador y revisar el Inicio.
3. Opcional: `node tests/api-flows.mjs https://TU-APP.vercel.app` ejecuta los 5 flujos del brief (crea datos de prueba; luego se pueden restablecer desde Configuración).

## Seguridad antes de un uso real

- `DEMO_MODE=false` (quita el acceso rápido por rol y el botón de reinicio).
- Cambiar las contraseñas de los usuarios desde Configuración → Usuarios, o crear usuarios reales y desactivar los de demo.
- `JWT_SECRET` propio y largo.
- Revisar respaldos automáticos en Neon.
