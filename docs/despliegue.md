# Despliegue — Render (API) + Vercel (cliente)

## Arquitectura

```
Navegador ──► https://<app>.vercel.app             (cliente Nuxt estático)
                 │  /api/*  (rewrite en vercel.json)
                 ▼
              https://ruth-api.onrender.com/api   (NestJS) ──► MongoDB Atlas
```

Vercel reenvía `/api/*` a Render. Para el navegador, las cookies httpOnly son del **mismo sitio** (el dominio de Vercel), así que basta con `COOKIE_SAME_SITE=lax` y ningún navegador las bloquea como cookies de terceros.

## 1. MongoDB Atlas

En **Network Access**, permita `0.0.0.0/0`, porque el plan gratuito de Render no tiene IP fija.

Base de datos: puede usar la misma URI de `server/.env`, que ya tiene el seed `DEMO`, o crear otra base para producción.

## 2. API en Render

1. Cree una cuenta en render.com y conecte GitHub con acceso al repositorio `ruth`.
2. **New → Blueprint** y elija el repositorio: Render lee `render.yaml` y crea el servicio `ruth-api`.
3. Render pide dos variables:
   - `MONGODB_URI`: su cadena de Atlas (péguela usted, nunca se versiona).
   - `CLIENT_URL`: la URL final de Vercel (paso 3). Al principio puede poner `https://ruth.vercel.app` y corregirla después.

   `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` se generan solos.
4. Si Render le asigna una URL distinta de `https://ruth-api.onrender.com`, actualice el `destination` en `vercel.json`.
5. Compruebe que la API responde:
   ```bash
   curl https://ruth-api.onrender.com/api/health
   ```

## 3. Cliente en Vercel

1. En vercel.com, **Add New → Project** e importe el repositorio `ruth`, con Root Directory = raíz del repositorio. `vercel.json` ya define la instalación, el build (`nuxt generate` con `NUXT_PUBLIC_API_BASE=/api`) y los rewrites.
2. Copie la URL asignada (por ejemplo `https://ruth-xyz.vercel.app`) en `CLIENT_URL` de Render y vuelva a desplegar la API. Esa URL se usa en CORS y en los enlaces de jurado externo.

## 4. Datos y verificación

- Si usa una base nueva, cargue el seed desde su equipo con `server/.env` apuntando a esa base:
  ```bash
  pnpm --filter server seed -- --reset
  ```
  El enlace externo que imprime el seed usa `localhost`; en producción, genere uno nuevo desde la tesis 3 (**Enlace externo**).
- Ingrese con `coordinador@unicordoba.edu.co` / `Coord2026!`. Recuerde que son credenciales de demostración públicas en el README: cámbielas antes de usar datos reales.

## Limitaciones del plan gratuito

- Render apaga la API tras 15 minutos sin tráfico, y el primer acceso tarda unos 50 segundos. Abra la página 1 o 2 minutos antes de la demo.
- Mientras la API está dormida, las tareas programadas (vencimientos cada hora, alertas a las 07:00) no corren. Para la demo puede ejecutarlas como ADMIN con `POST /api/admin/jobs/run`.
