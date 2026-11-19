# Despliegue — Vercel (API y cliente)

## Arquitectura

```
Navegador ──► https://<cliente>.vercel.app        (proyecto "ruth": Nuxt estático, raíz del repo)
                 │  /api/*  (rewrite en vercel.json de la raíz)
                 ▼
              https://ruth-api.vercel.app/api   (proyecto "ruth-api": NestJS serverless, carpeta server/) ──► MongoDB Atlas
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

En **Atlas → Network Access** debe permitir `0.0.0.0/0`, porque Vercel no tiene IP fija.

## Proyecto `ruth` (cliente)

- **Root Directory:** raíz del repo. Su configuración está en `vercel.json`: genera el sitio estático con `NUXT_PUBLIC_API_BASE=/api`, reenvía `/api/*` a `https://ruth-api.vercel.app` y usa `200.html` como respaldo de la SPA.
- Si la API queda con otra URL, cambie el `destination` en `vercel.json`.

## Limitaciones (plan Hobby)

- **Subida de manuscritos:** cada petición admite como máximo 4,5 MB, así que no se pueden subir PDF más grandes (localmente el límite es 25 MB).
- **Cron:** corre una vez al día. Los vencimientos de asignaciones se revisan a diario, no cada hora. Para una demostración se puede forzar con `POST /api/admin/jobs/run` (ADMIN).
- **Arranque en frío:** la primera petición tras un tiempo sin uso tarda unos segundos.
