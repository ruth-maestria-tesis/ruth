# Thesis Repository — Server (NestJS)

## Requisitos
- Node 22, pnpm 11
- Un cluster de MongoDB Atlas (o un MongoDB local)

## Configuración
1. `cp .env.example .env` (dentro de `server/`) y escribir `MONGODB_URI` (cadena de Atlas) y dos secretos JWT de al menos 32 caracteres:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Desde la raíz del monorepo: `pnpm install`

`NODE_ENV` es obligatoria y no tiene valor por defecto: si falta, el servidor (y el CLI de administrador) no arranca. En local la aporta `server/.env` (`.env.example` trae `NODE_ENV=development`). En un despliegue hay que definir `NODE_ENV=production` explícitamente en las variables de entorno.

## Comandos (desde la raíz)
| Comando | Descripción |
|---|---|
| `pnpm dev:server` | API en modo watch en `http://localhost:3001/api` |
| `pnpm --filter server test` | Pruebas unitarias |
| `pnpm --filter server test:e2e` | Pruebas e2e (MongoDB en memoria, nunca Atlas) |
| `pnpm test:server` | Unitarias y e2e |
| `pnpm lint:server` | ESLint |
| `ADMIN_EMAIL=admin@unicordoba.edu.co ADMIN_PASSWORD='***' pnpm --filter server admin:create` | Crea el primer administrador (usa `server/.env`; si el usuario ya existe no hace nada) |

El comando de administrador compila `@thesis/shared` y el servidor, y luego ejecuta `dist/cli/create-admin.js` con `server/` como directorio de trabajo, así que lee `server/.env` (incluida `NODE_ENV`). Fuera de local, define `NODE_ENV=production`, `MONGODB_URI` y los secretos JWT en el entorno antes de ejecutarlo.

Swagger: `http://localhost:3001/api/docs`, disponible solo cuando `NODE_ENV=development`.

## Autenticación
- `POST /api/auth/login` deja las cookies httpOnly `access_token` (15 min) y `refresh_token` (7 días, path `/api/auth`).
- `POST /api/auth/refresh` rota el refresh token. Si se reutiliza un token viejo, se revoca toda la sesión.
- El cliente debe enviar las llamadas a `refresh` de una en una ("single-flight"): si dos peticiones usan a la vez el mismo refresh token, la segunda cuenta como reutilización de un token ya rotado y se revoca toda la sesión.
- Al desactivar un usuario o cambiar sus roles, sus refresh tokens se revocan de inmediato, pero el access token ya emitido sigue siendo válido hasta 15 minutos (`JWT_ACCESS_TTL_SECONDS`, 900 por defecto; no se consulta la base de datos en cada petición).
- Errores: `{ statusCode, code, message, details? }`; los códigos están en `@thesis/shared` (`ErrorCode`).
