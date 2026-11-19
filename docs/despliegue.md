# Despliegue — Vercel (API y cliente)

## Arquitectura

```
Navegador ──► https://<cliente>.vercel.app        (proyecto "ruth": Nuxt estático, raíz del repo)
                 │  /api/*  (rewrite en vercel.json de la raíz)
                 ▼
              https://ruth-api.vercel.app/api   (proyecto "ruth-api": NestJS serverless, carpeta server/) ──► MongoDB Atlas
                                                                                                   └─► Vercel Blob (privado)
Navegador ◄──────────────────────────────► Vercel Blob   (bytes de manuscritos y correcciones, con URL firmadas)
```

El cliente reenvía `/api/*` al proyecto de la API. Para el navegador, las cookies httpOnly son del **mismo sitio** (el dominio del cliente), así que basta con `COOKIE_SAME_SITE=lax`.

## Proyecto `ruth-api`

- **Root Directory:** `server`. Su configuración está en `server/vercel.json`.
- **Función:** `server/api/index.js` envuelve `dist/serverless.js`, que arranca Nest una vez por instancia y la reutiliza.
- **Tareas programadas:** en Vercel no hay temporizadores en proceso. Vercel Cron llama a `GET /api/admin/jobs/cron` a diario a las 12:00 UTC (07:00 en Bogotá), con `Authorization: Bearer $CRON_SECRET`. Esa llamada ejecuta todos los trabajos.
- **Variables:**

| Variable | Valor |
|---|---|
| `MONGODB_URI` | Cadena de Atlas (la escribe el usuario) |
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 48 bytes aleatorios cada uno, distintos |
| `CRON_SECRET` | Aleatorio |
| `CLIENT_URL` | URL del proyecto cliente (se usa en CORS y en los enlaces de jurado externo) |
| `TRUST_PROXY` | `true` |
| `COOKIE_SAME_SITE` | `lax` |
| `STORAGE_DRIVER` | `vercel-blob` (sin ella se usa `gridfs` y las subidas siguen limitadas a 4,5 MB) |
| `BLOB_READ_WRITE_TOKEN` | La crea Vercel al conectar el Blob store al proyecto (obligatoria con `vercel-blob`) |

En **Atlas → Network Access** debe permitir `0.0.0.0/0`, porque Vercel no tiene IP fija.

### Almacenamiento de archivos (Vercel Blob)

- **Store:** un Blob store **privado** conectado al proyecto `ruth-api` (Storage → Blob → Connect). Al conectarlo, Vercel define `BLOB_READ_WRITE_TOKEN` en el entorno.
- **Activar:** `STORAGE_DRIVER=vercel-blob` en Production y volver a desplegar.
- **Subida:** el navegador pide un permiso a la API (`POST …/uploads`), sube el archivo directo al Blob store con un token válido 10 minutos, limitado a una ruta aleatoria, al tipo y al tamaño declarados, y luego confirma (`POST …/uploads/complete`). La API comprueba el tamaño y la firma `%PDF-` (o Word en las correcciones) y registra el archivo en Mongo. Así se pueden subir archivos de hasta 25 MB.
- **Descarga:** las rutas de siempre responden con una URL firmada de 5 minutos (`302`, o `{ url }` con `?as=url`, que es lo que usa el cliente) y `Cache-Control: no-store`.
- Los metadatos siguen en Mongo (`files.files`). Los archivos ya guardados en GridFS (el seed de demostración, las actas) se siguen descargando como antes.
- Si `STORAGE_DRIVER` no está definida (`gridfs`), todo funciona como antes, con el límite de 4,5 MB por petición en Vercel.

## Proyecto `ruth` (cliente)

- **Root Directory:** raíz del repo. Su configuración está en `vercel.json`: genera el sitio estático con `NUXT_PUBLIC_API_BASE=/api`, reenvía `/api/*` a `https://ruth-api.vercel.app` y usa `200.html` como respaldo de la SPA.
- Si la API queda con otra URL, cambie el `destination` en `vercel.json`.

## Limitaciones (plan Hobby)

- **Subida de archivos:** las funciones de Vercel admiten como máximo 4,5 MB por petición, pero con `STORAGE_DRIVER=vercel-blob` los manuscritos y las correcciones viajan directo entre el navegador y el Blob store, así que el límite es el de la aplicación: 25 MB. Un archivo subido al Blob store cuya confirmación nunca llega queda huérfano (no hay limpieza automática).
- **Cron:** corre una vez al día. Los vencimientos de asignaciones se revisan a diario, no cada hora. Para una demostración se puede forzar con `POST /api/admin/jobs/run` (ADMIN).
- **Arranque en frío:** la primera petición tras un tiempo sin uso tarda unos segundos.
