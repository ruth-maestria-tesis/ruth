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
| `pnpm --filter server seed -- --reset` | Borra y vuelve a crear los datos de demostración (`seedTag: 'DEMO'`); ver [Datos de demostración](#datos-de-demostración-seed) |

El comando de administrador compila `@thesis/shared` y el servidor, y luego ejecuta `dist/cli/create-admin.js` con `server/` como directorio de trabajo, así que lee `server/.env` (incluida `NODE_ENV`). Fuera de local, define `NODE_ENV=production`, `MONGODB_URI` y los secretos JWT en el entorno antes de ejecutarlo.

Swagger: `http://localhost:3001/api/docs`, disponible solo cuando `NODE_ENV=development`.

## Autenticación
- `POST /api/auth/login` deja las cookies httpOnly `access_token` (15 min) y `refresh_token` (7 días, path `/api/auth`).
- `POST /api/auth/refresh` rota el refresh token. Si se reutiliza un token viejo, se revoca toda la sesión.
- El cliente debe enviar las llamadas a `refresh` de una en una ("single-flight"): si dos peticiones usan a la vez el mismo refresh token, la segunda cuenta como reutilización de un token ya rotado y se revoca toda la sesión.
- Al desactivar un usuario o cambiar sus roles, sus refresh tokens se revocan de inmediato, pero el access token ya emitido sigue siendo válido hasta 15 minutos (`JWT_ACCESS_TTL_SECONDS`, 900 por defecto; no se consulta la base de datos en cada petición).
- Errores: `{ statusCode, code, message, details? }`; los códigos están en `@thesis/shared` (`ErrorCode`).

## Catálogos, tesis y archivos (sub-etapa 2)
- `GET|POST|PATCH /api/programs`, `/api/periods`, `/api/cohorts` (lectura para cualquier usuario autenticado; escritura ADMIN y COORDINATOR).
- `GET /api/theses` con filtros `programId, periodId, cohortId, status, q, codePrefix, seedTag`, paginación `page, limit` y orden `sort=code|title|student|status|progress|createdAt&order=asc|desc`.
  - La búsqueda `q` es insensible a tildes y mayúsculas (por ejemplo, `garcia` encuentra "García").
  - El orden usa las reglas del español (collation), de modo que "Ángel" se ordena junto a "Angel" y la "ñ" va después de la "n".
- `POST /api/theses` (COORDINATOR) y el formato de código `MIETIA-2026-II-001` (`PROGRAMCODE-PERIODCODE-NNN`, con `seedTag` opcional como prefijo).
- `GET /api/theses/mine` (STUDENT), `GET /api/theses/:id`, `PATCH /api/theses/:id`.
- `POST /api/theses/:id/manuscripts` (multipart, campo `file`, solo PDF, máx. 25 MB; lo pueden subir COORDINATOR y el STUDENT dueño de la tesis) y `GET /api/theses/:id/manuscripts/:fileId` (ADMIN, COORDINATOR y STUDENT dueño). El nombre de archivo admite caracteres no ASCII (tildes, ñ).
- Nota: los cambios de estado solo ocurren mediante `WorkflowService` (sub-etapas siguientes); se emite el evento `thesis.status.changed`.

## Asignación de jurados (sub-etapa 3)
- Configuración: `GET|PATCH /api/settings` (plazos en días hábiles y festivos `YYYY-MM-DD`; el administrador carga el calendario de festivos de Colombia). Los días hábiles se calculan con la hora de Bogotá; el plazo vence al final del último día hábil.
- CU-01: `POST /api/theses/:id/assignments` con `jurors: [{ jurorId } | { newExternal }]` (exactamente 2, al menos uno de Unicórdoba, sin conflicto de interés) y `responseBusinessDays` opcional; `POST /api/assignments/validate` para la validación en vivo; `GET /api/theses/:id/assignments`.
- CU-08: `GET /api/assignments/mine`, `GET /api/assignments/:id`, `POST /api/assignments/:id/accept`, `POST /api/assignments/:id/decline` (`reason` obligatorio). Campos de cuenta regresiva: `daysSinceAssigned`, `responseDaysRemaining`, `evaluationDaysRemaining`, `isResponseOverdue`.
- Reemplazo: `POST /api/theses/:id/assignments/replace`.
- Acceso del jurado a la tesis: con una asignación `PENDING` o `ACCEPTED` ve `GET /api/theses/:id`; el manuscrito solo después de aceptar. En otro caso, 404.
- Jurado externo: el coordinador obtiene el enlace con `POST /api/assignments/:id/external-link` (también viene en la respuesta de la asignación) y lo envía por su cuenta; `POST /api/auth/external/validate-token` con `{ token }` abre una sesión limitada a esa asignación (solo cookie `access_token`, sin contraseña, sin refresh). Variables `EXTERNAL_TOKEN_TTL_DAYS` y `EXTERNAL_SESSION_TTL_SECONDS`.
- Los jurados externos nunca tienen contraseña.
- El vencimiento automático de asignaciones (`expirePending`) se programará en la sub-etapa 8.

## Datos de demostración (seed)

```bash
pnpm --filter server seed -- --reset          # borra lo etiquetado DEMO y lo vuelve a crear
pnpm --filter server seed -- --reset --tag=QA # otra etiqueta (se normaliza a mayúsculas)
```

- Usa `server/.env` como `admin:create`. **Nunca lo ejecutes contra la base de producción.**
- Sin `--reset`, el comando se niega a correr si ya existen los datos de esa etiqueta.
- `--reset` borra solo documentos con `seedTag: 'DEMO'`: usuarios, catálogos creados por el seed, tesis, asignaciones, evaluaciones, observaciones, sustentaciones, actas, notificaciones, archivos GridFS (`metadata.seedTag`) y los contadores de códigos `DEMO-…`. El contador de actas solo se borra si ya no lo usa ninguna acta.
- Todo se construye llamando a los servicios reales como los usuarios sembrados, así que el historial, los eventos, los plazos y los hashes son coherentes. Cada tesis tiene un manuscrito PDF.
- Al final imprime las credenciales, las tesis por estado y un enlace de acceso para un jurado externo con asignación pendiente.

| Rol | Correo | Contraseña |
|---|---|---|
| ADMIN | `admin@unicordoba.edu.co` | `Admin2026!` |
| COORDINATOR | `coordinador@unicordoba.edu.co` | `Coord2026!` |
| INTERNAL_JUROR (6) | `jurado1@unicordoba.edu.co` … `jurado6@unicordoba.edu.co` | `Jurado2026!` |
| STUDENT (15) | `estudiante1@correo.unicordoba.edu.co` … `estudiante15@correo.unicordoba.edu.co` | `Estudiante2026!` |
| EXTERNAL_JUROR (3) | `diego.quintero@externo.example.org`, `mariajose.fernandez@externo.example.org`, `ricardo.salazar@externo.example.org` | sin contraseña (enlace externo) |

Programa MIETIA, periodos 2025-II y 2026-I, dos cohortes y 15 tesis (`DEMO-MIETIA-…`) con al menos una en cada estado. Para el portal del jurado, `jurado1` tiene una asignación PENDIENTE por aceptar (tesis 2025-II-003) y otra ACEPTADA en evaluación con un borrador (2025-II-005).

## Reportes y bitácora de auditoría

- `GET /api/reports/theses.xlsx`, `GET /api/reports/theses.pdf` y `GET /api/reports/summary` (COORDINATOR, ADMIN): usan los mismos filtros que `GET /api/theses` (sin paginación, máximo 2000 filas). Excel con `exceljs` y PDF con `pdfkit` (A4 horizontal). Ver sección 11 del contrato de la API.
- `GET /api/audit-logs` (ADMIN, COORDINATOR): bitácora de solo inserción (`auditLogs`). Un interceptor global registra toda petición POST/PUT/PATCH/DELETE exitosa de un usuario autenticado, más inicio de sesión (éxito y fallo) y cierre de sesión. Nunca guarda cuerpos de petición, solo campos permitidos en `meta`. Ver sección 12.

## Tareas programadas y alertas

- `expirePending` corre cada hora (vence asignaciones `PENDING` y reconcilia RN-08). Las alertas corren a diario a las 07:00 America/Bogota. Todo está desactivado con `NODE_ENV=test`.
- Trabajos de alerta (idempotentes; cada uno marca lo ya enviado):
  - `overdueEvaluations`: concepto vencido, avisa al jurado y a los coordinadores (`overdueNotifiedAt`; se repite cada `overdueRenotifyBusinessDays` días hábiles, 0 = una vez).
  - `deadlineReminders`: recordatorio al jurado cuando faltan `reminderBusinessDaysBefore` días hábiles o menos para responder o evaluar (`responseReminderSentAt`, `evaluationReminderSentAt`).
  - `unseenConceptAlerts`: el estudiante no vio ni descargó el concepto tras `unseenConceptAlertDays` días hábiles; avisa a los coordinadores (`unseenAlertSentAt`).
- Ajustes en `PATCH /api/settings`: `reminderBusinessDaysBefore` (2), `overdueRenotifyBusinessDays` (5), `unseenConceptAlertDays` (3).
- Ejecución manual para la demo (ADMIN): `POST /api/admin/jobs/run` con `{ "job": "all" }` (o `expirePending`, `reconcile`, `overdueEvaluations`, `deadlineReminders`, `unseenConceptAlerts`); responde los conteos por trabajo.
- Detalle en `docs/superpowers/specs/2026-11-19-mvp-api-contracts.md` §13.

