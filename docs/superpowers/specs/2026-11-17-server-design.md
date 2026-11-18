# Diseño del Server — Repositorio de Tesis de Posgrado (Fase 1)

**Fecha:** 2026-11-17
**Programa:** Maestría en Innovación Educativa con Tecnología e Inteligencia Artificial (MIETIA) — Universidad de Córdoba
**Fuentes:** `dds3/documentacion/*` (casos de uso, mapa RBAC, especificación de mockups, plan de trabajo) y `dds3/2 sugerencias.docx` (recomendaciones del docente asesor).
**Fase 2 (fuera de este documento):** cliente Nuxt 4 + Pinia + Vuetify 3, siguiendo `dds3/documentacion/mockups/index.html`.

---

## 0. Convención de idioma

- **Todo el código, la base de datos y la API van en inglés:** nombres de carpetas, módulos, clases, variables, colecciones, campos, enums, rutas REST, códigos de error y mensajes de log.
- **Solo la interfaz va en español.** El server devuelve códigos de error estables (`code: "JUROR_CONFLICT_OF_INTEREST"`) y el cliente los traduce. El campo `message` puede venir en inglés porque es para depuración.
- Los códigos de requisitos de la documentación (RF-C13, RN-01, CU-01…) se conservan como referencia en comentarios y pruebas.

Glosario de dominio:

| Documento (ES) | Código (EN) |
|---|---|
| Tesis | `Thesis` |
| Jurado interno / externo / dirimente | `INTERNAL_JUROR` / `EXTERNAL_JUROR` / asignación `TIEBREAKER` |
| Asignación de jurado | `Assignment` |
| Concepto / Evaluación | `Evaluation` (`verdict`) |
| Observación por capítulo | `FeedbackItem` |
| Discrepancia | `Dispute` (estado `IN_DISPUTE`) |
| Sustentación | `Defense` |
| Acta | `Minutes` |
| Corte (cohorte) / Periodo | `Cohort` / `Period` |
| Programa | `Program` |
| Bitácora de auditoría | `AuditLog` |
| Trazabilidad | `Traceability` |

---

## 1. Arquitectura

Monorepo con **pnpm workspaces**:

```
/server   NestJS 11 + Mongoose + MongoDB Atlas (GridFS para archivos)
/client   Nuxt 4 + Pinia + Vuetify 3            (fase 2)
/shared   enums y tipos TypeScript compartidos (roles, estados, veredictos, códigos de error)
```

Enfoque: **NestJS modular por dominio con una máquina de estados central** (`WorkflowService`). Cualquier cambio de estado de una tesis pasa por ese servicio, que:
1. valida que la transición esté permitida,
2. persiste el nuevo estado y el avance %,
3. añade un registro a `thesis.history[]`, que alimenta el grafo de trazabilidad,
4. emite un evento interno (`@nestjs/event-emitter`) que consumen `notifications` y `audit`.

Las reglas de negocio (RN-01, RF-C13, RN-06, RN-08) son funciones puras en un archivo `*.rules.ts` dentro de cada módulo, para poder probarlas unitariamente.

Prefijo global de la API: `/api`. Documentación con Swagger en `/api/docs`.

---

## 2. Seguridad y autenticación

### 2.1 Login institucional
- Email y contraseña, con hash **bcrypt** (cost 12).
- **Access JWT** (15 min) y **refresh JWT** (7 días), ambos en cookies `httpOnly`, `SameSite=Lax` y `Secure` en producción.
- El refresh token se **rota** en cada uso. Su hash se guarda en la colección `refreshTokens`; el logout y la reutilización de un token ya rotado revocan toda la familia.
- Endpoints: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/password`.

### 2.2 Acceso de jurado externo (RF-J14)
- Al asignar un jurado externo se genera un token aleatorio de 32 bytes (base64url). Se guarda **solo su hash SHA-256**, con `expiresAt` y vinculado a `assignmentId`.
- Como no hay envío de correo, el coordinador obtiene el enlace (`{CLIENT_URL}/auth/external-access?token=…`) desde `GET /assignments/:id/external-link` (lo regenera e invalida el anterior) y se lo envía por su cuenta.
- `POST /auth/external/validate-token` cambia el token por una sesión JWT con rol `EXTERNAL_JUROR` y el claim `scope: { assignmentIds: [...] }`. Esa sesión solo puede operar sobre la tesis asignada.

### 2.3 Autorización
- Roles: `ADMIN`, `COORDINATOR`, `INTERNAL_JUROR`, `EXTERNAL_JUROR`, `STUDENT`.
- Guards globales `JwtAuthGuard` y `RolesGuard`, con los decoradores `@Public()` y `@Roles(...)`.
- **Políticas de propiedad** en los servicios:
  - un jurado solo accede a sus `Assignment`,
  - un estudiante solo a su `Thesis`,
  - el manuscrito solo es visible para el jurado después de aceptar la designación.
- La matriz RBAC de `mapa-navegacion-rbac.md §3` se traduce a pruebas e2e de permisos.

### 2.4 Protección general
- `helmet`, CORS restringido a `CLIENT_URL` con credenciales, `@nestjs/throttler` (límite estricto en login y validación de token).
- `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`; DTOs con `class-validator`.
- Filtro global de excepciones con respuesta uniforme: `{ statusCode, code, message, details? }`.
- Configuración validada al arranque (`@nestjs/config` + Joi): `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL`, `PORT`, `NODE_ENV`. Se entrega un `server/.env.example`; el usuario escribe la URI de Atlas en `server/.env`, que queda en `.gitignore`.

---

## 3. Módulos

| Módulo | Responsabilidad | CU / Req. |
|---|---|---|
| `auth` | login, refresh, logout, me, token de jurado externo | RF-J14 |
| `users` | CRUD de usuarios (ADMIN) y búsqueda de docentes para el autocompletado (`GET /users/faculty?q=`). Perfil de jurado: `institution`, `isUnicordoba`, `highestDegree`, `country`, `expertise` | RF-C14 |
| `catalogs` | `Program`, `Period` (`2026-II`), `Cohort` (corte, número y periodo de ingreso) | Sugerencia 4 |
| `theses` | radicación, código, listado paginado con orden y filtros, detalle, manuscrito y versiones | RF-C01, sug. 5–6 |
| `workflow` | máquina de estados, `history[]`, cálculo de avance % | RF-P02/P03 |
| `assignments` | CU-01 asignar (RF-C13, RN-01, plazo), CU-08 aceptar o declinar, reemplazo, vencimiento, cuenta regresiva | CU-01, CU-08, sug. 8 |
| `evaluations` | CU-02: rúbrica, veredicto, comentarios, archivo de corrección (PDF o Word), sin edición tras emitir. Registro de vista y descarga del concepto por el estudiante | CU-02, sug. 8–9 |
| `feedback` | CU-06: observaciones por capítulo, transiciones de RN-06 por rol, vista consolidada | CU-06, RF-R04 |
| `disputes` | CU-05: comparativo de conceptos y designación del jurado dirimente | CU-05, RN-08 |
| `defenses` | CU-03: programación, modalidad, confirmación de asistencia de los jurados | CU-03 |
| `minutes` | CU-04: calificación, veredicto, firmas, hash SHA-256, cierre inmutable, PDF sellado | CU-04, RF-J10, RNF-04 |
| `files` | subida y descarga en GridFS; tipos permitidos `pdf`, `doc`, `docx`; máximo 25 MB | — |
| `notifications` | notificaciones internas (campana): listar, contar no leídas, marcar leída | — |
| `audit` | interceptor `@Auditable('ACTION')` que guarda actor, rol, IP, user-agent, entidad, antes y después. Colección de solo inserción | CU-09, RNF-04 |
| `traceability` | `GET /theses/:id/graph` → nodos y aristas a partir de `history[]` y las evidencias | CU-07, RF-C16 |
| `dashboard` | KPIs por periodo, corte y programa, y totales; alertas activas | Sugerencia 4 |
| `reports` | exportación a Excel (`exceljs`) y PDF (`pdfkit`) con los mismos filtros del listado | CU-09, RF-C09/RF-S05 |
| `scheduler` | tareas `@nestjs/schedule` (ver §7) | CU-08 FA-02, sug. 10 |
| `settings` | plazos globales, festivos para el cálculo de días hábiles, prefijo de código | — |
| `seed` | comando CLI para generar datos masivos de prueba | Sugerencia 7 |

---

## 4. Máquina de estados de la tesis (`ThesisStatus`)

| Estado | Avance % | Significado |
|---|---|---|
| `SUBMITTED` | 10 | Radicada, lista para asignar jurados |
| `JURORS_ASSIGNED` | 25 | 2 jurados asignados, esperando aceptación |
| `PENDING_JUROR_REPLACEMENT` | 25 | Un jurado declinó o venció su plazo |
| `UNDER_EVALUATION` | 45 | Ambos aceptaron y están evaluando |
| `IN_DISPUTE` | 50 | Conceptos contradictorios; requiere dirimente (RN-08) |
| `REVISIONS_IN_PROGRESS` | 60 | Observaciones en subsanación |
| `READY_FOR_DEFENSE` | 75 | Aprobada y con observaciones resueltas |
| `DEFENSE_SCHEDULED` | 85 | Sustentación programada y confirmada |
| `NOT_APPROVED` | 100 | Rechazada en la evaluación (cierre) |
| `COMPLETED_APPROVED` | 100 | Acta sellada, aprobada |
| `COMPLETED_FAILED` | 100 | Acta sellada, reprobada |

Transiciones permitidas:

```
SUBMITTED                 → JURORS_ASSIGNED
JURORS_ASSIGNED           → UNDER_EVALUATION | PENDING_JUROR_REPLACEMENT
PENDING_JUROR_REPLACEMENT → JURORS_ASSIGNED | UNDER_EVALUATION
UNDER_EVALUATION          → REVISIONS_IN_PROGRESS | READY_FOR_DEFENSE | IN_DISPUTE | NOT_APPROVED
IN_DISPUTE                → REVISIONS_IN_PROGRESS | READY_FOR_DEFENSE | NOT_APPROVED
REVISIONS_IN_PROGRESS     → READY_FOR_DEFENSE
READY_FOR_DEFENSE         → DEFENSE_SCHEDULED
DEFENSE_SCHEDULED         → COMPLETED_APPROVED | COMPLETED_FAILED
```

`PENDING_JUROR_REPLACEMENT → UNDER_EVALUATION` aplica cuando el reemplazo acepta y el otro jurado ya había aceptado.

### 4.1 Resolución de conceptos (RN-08)
Se ejecuta cuando ambos jurados principales han emitido su `Evaluation`. "Aprueba" significa `APPROVED_FOR_DEFENSE` o `APPROVED_WITH_CHANGES`.

| Jurado A | Jurado B | Resultado |
|---|---|---|
| aprueba | rechaza (o al revés) | `IN_DISPUTE` |
| `REJECTED` | `REJECTED` | `NOT_APPROVED` |
| aprueba | aprueba | `REVISIONS_IN_PROGRESS` si algún veredicto es `APPROVED_WITH_CHANGES` o existen `FeedbackItem` sin resolver; si no, `READY_FOR_DEFENSE` |

El jurado dirimente emite `APPROVED` o `REJECTED`, y eso define el resultado:
- `APPROVED`: se aplica la misma regla de observaciones pendientes y pasa a `REVISIONS_IN_PROGRESS` o a `READY_FOR_DEFENSE`.
- `REJECTED`: pasa a `NOT_APPROVED`.

`REVISIONS_IN_PROGRESS → READY_FOR_DEFENSE` ocurre automáticamente cuando el último `FeedbackItem` queda `RESOLVED`.

---

## 5. Modelo de datos (colecciones MongoDB)

Todas las colecciones tienen `createdAt` y `updatedAt` (timestamps de Mongoose). Los datos de prueba llevan `seedTag?: string`.

- **users**: `email` (único), `passwordHash`, `firstName`, `lastName`, `documentId`, `roles: Role[]`, `isActive`, `jurorProfile?: { institution, isUnicordoba, highestDegree, country, expertise[] }`, `studentProfile?: { studentCode, programId, cohortId }`.
- **programs**: `code` (p. ej. `MIETIA`), `name`, `level` (`MASTER` | `DOCTORATE`), `isActive`.
- **periods**: `code` (`2026-II`), `year`, `term` (`I` | `II`), `startsAt`, `endsAt`.
- **cohorts**: `programId`, `number` (corte 1..n), `periodId` (periodo de ingreso), `name`.
- **theses**:
  - `code` (único, p. ej. `MIETIA-2026-II-001`; con datos de prueba `TEST-MIETIA-2026-II-001`), `title`, `abstract`, `keywords[]`.
  - `studentId`, `advisorId`, `coAdvisorIds[]`, `programId`, `cohortId`, `periodId`.
  - `status`, `progress`.
  - `manuscripts[]: { fileId, version, fileName, uploadedAt, uploadedBy }`, `currentManuscriptId`, `manuscriptSeq` (último número de versión; control optimista de subidas concurrentes, `409 MANUSCRIPT_CONFLICT`).
  - Índice de texto sobre `title`/`code` reservado; `q` usa regex insensible a mayúsculas y acentos.
  - `conflictOfInterestUserIds[]` (conflictos documentados adicionales, RN-01).
  - `history[]: { from, to, at, actorId, actorRole, reason?, evidenceFileIds[] }`.
  - `seedTag?`.
- **assignments**:
  - `thesisId`, `jurorId`, `type` (`PRIMARY` | `TIEBREAKER`), `slot` (1 | 2 | 3).
  - `status` (`PENDING` | `ACCEPTED` | `DECLINED` | `EXPIRED` | `REPLACED`).
  - `assignedAt`, `assignedBy`, `responseDeadline`, `respondedAt?`, `declineReason?` (máximo 500 caracteres).
  - `evaluationDeadline?` (se calcula al aceptar), `externalTokenHash?`, `externalTokenExpiresAt?`.
- **evaluations**:
  - `assignmentId`, `thesisId`, `jurorId`.
  - `rubric: { methodology, relevance, writingQuality }` (enteros 1–5), `score` (promedio).
  - `verdict` (`APPROVED_FOR_DEFENSE` | `APPROVED_WITH_CHANGES` | `REJECTED`; dirimente: `APPROVED` | `REJECTED`).
  - `comments`, `correctionFileIds[]` (PDF o Word con correcciones del jurado).
  - `status` (`DRAFT` | `SUBMITTED`), `submittedAt?`.
  - `studentFirstViewedAt?`, `studentFirstDownloadedAt?`, `studentAccessLog[]: { type: 'VIEW' | 'DOWNLOAD', at, ip }` (sugerencia 9), `unseenAlertSentAt?`.
- **feedbackItems**:
  - `thesisId`, `jurorId`, `chapter` (`INTRODUCTION` | `THEORETICAL_FRAMEWORK` | `METHODOLOGY` | `RESULTS` | `CONCLUSIONS` | `OTHER`), `reference?` (página o párrafo), `content`.
  - `status` (`PENDING` | `ADDRESSED` | `RESOLVED`).
  - `replies[]: { authorId, authorRole, content, fileIds[], at, action: 'ADDRESS' | 'RESOLVE' | 'REOPEN' | 'COMMENT' }`.
- **defenses**:
  - `thesisId`, `scheduledAt`, `modality` (`IN_PERSON` | `VIRTUAL` | `HYBRID`), `location?`, `meetingUrl?`.
  - `confirmations[]: { userId, confirmedAt }`, `status` (`PROPOSED` | `CONFIRMED` | `HELD` | `CANCELLED`).
- **minutes**:
  - `thesisId`, `defenseId`, `number` (consecutivo por programa y año), `finalGrade` (0.0–5.0).
  - `verdict` (`APPROVED` | `APPROVED_MERITORIOUS` | `APPROVED_LAUREATE` | `FAILED`), `remarks`.
  - `signatures[]: { userId, role, signedAt, ip, userAgent }`, `contentHash` (SHA-256).
  - `status` (`DRAFT` | `SEALED`), `sealedAt?`, `pdfFileId?`.
- **notifications**: `userId`, `type`, `title`, `body`, `link?`, `entityRef?: { kind, id }`, `readAt?`.
- **auditLogs**: `actorId?`, `actorRole?`, `action`, `entity: { kind, id }`, `before?`, `after?`, `ip`, `userAgent`, `at`. No tiene endpoints de update ni delete, y el esquema bloquea `updateOne` y `deleteOne`.
- **refreshTokens**: `userId`, `tokenHash`, `familyId`, `expiresAt`, `revokedAt?`, `replacedBy?`.
- **settings** (un solo documento): `acceptanceBusinessDays` (8), `evaluationBusinessDays` (20), `unseenConceptAlertDays` (3), `holidays: Date[]`, `thesisCodePrefix` (`MIETIA`) (el código de tesis usa `program.code` como prefijo; este valor queda como respaldo).
- **GridFS bucket `files`**: el `metadata` guarda `ownerId`, `thesisId?`, `kind` (`MANUSCRIPT` | `CORRECTION` | `FEEDBACK_EVIDENCE` | `MINUTES_PDF`), `mimeType`, `sha256`.

Índices:
- `theses`: `{code:1}` único, `{status:1}`, `{periodId:1, cohortId:1}`, `{programId:1}`, `{studentId:1}`, `{seedTag:1}`, y un índice de texto en `title` y `code`.
- `assignments`: `{jurorId:1, status:1}`, `{thesisId:1}`.
- `evaluations`: `{thesisId:1}`.
- `feedbackItems`: `{thesisId:1, status:1}`.
- `auditLogs`: `{at:-1}`, `{'entity.id':1}`.
- `notifications`: `{userId:1, readAt:1}`.

---

## 6. Reglas de negocio clave

- **RF-C13 / RN-01 (asignación):** exactamente 2 jurados `PRIMARY` activos y al menos uno con `jurorProfile.isUnicordoba = true`. Ningún jurado puede ser `advisorId`, estar en `coAdvisorIds`, estar en `conflictOfInterestUserIds` ni ser el estudiante. Además existe `POST /assignments/validate`, que valida sin guardar y que el cliente usa para la validación en vivo.
- **Jurado externo nuevo (RF-C14):** se puede crear en línea durante la asignación (`institution`, `highestDegree`, `country`, `email`). Se crea un usuario con rol `EXTERNAL_JUROR` y sin contraseña.
- **CU-08:** aceptar o declinar solo mientras la asignación esté `PENDING` y antes de `responseDeadline`. Para declinar el motivo es obligatorio. Al declinar, la asignación pasa a `DECLINED`, la tesis a `PENDING_JUROR_REPLACEMENT` y el coordinador recibe una alerta. Al aceptar se calcula `evaluationDeadline` en días hábiles.
- **Cuenta regresiva (sugerencia 8):** las respuestas de asignaciones incluyen campos calculados: `assignedAt`, `daysSinceAssigned`, `responseDaysRemaining` y `evaluationDaysRemaining` (días hábiles, descontando `settings.holidays`).
- **CU-02:** una evaluación solo se puede emitir si la asignación está `ACCEPTED`. Después de `SUBMITTED` no se puede editar (409 `EVALUATION_LOCKED`).
- **RN-06:**
  - solo el jurado autor crea observaciones (quedan `PENDING`),
  - solo el estudiante de la tesis pasa `PENDING → ADDRESSED`,
  - solo el jurado autor pasa `ADDRESSED → RESOLVED` o `ADDRESSED → PENDING` (reabrir).
- **Visibilidad del concepto para el estudiante:** el estudiante ve las evaluaciones con estado `SUBMITTED` de su tesis. `GET /evaluations/:id` registra `VIEW` y la descarga del archivo de corrección registra `DOWNLOAD` (sugerencia 9).
- **CU-03:**
  - solo se programa desde `READY_FOR_DEFENSE`,
  - al confirmar todos los jurados activos, la sustentación pasa a `CONFIRMED` y la tesis a `DEFENSE_SCHEDULED`.
- **CU-04 / RNF-04 (acta):**
  - el acta se crea desde `DEFENSE_SCHEDULED` y es editable mientras esté `DRAFT`,
  - el `contentHash` es SHA-256 del JSON canónico del contenido (orden de claves estable),
  - los jurados firman primero y el coordinador al final,
  - con 3 firmas (2 jurados y coordinador; con dirimente, los jurados activos y el coordinador), el acta pasa a `SEALED`, se genera el PDF con el hash y se guarda en GridFS,
  - la tesis pasa a `COMPLETED_APPROVED` o `COMPLETED_FAILED`,
  - cualquier modificación posterior responde 409 `MINUTES_SEALED`.

---

## 7. Tareas programadas (`scheduler`)

| Tarea | Frecuencia | Acción |
|---|---|---|
| `expireAssignments` | cada hora | Asignación `PENDING` con `responseDeadline` vencido: pasa a `EXPIRED`, la tesis a `PENDING_JUROR_REPLACEMENT` y se notifica al coordinador (CU-08 FA-02) |
| `overdueEvaluations` | diaria 07:00 | Asignación `ACCEPTED` sin evaluación emitida y con `evaluationDeadline` vencido: notifica al coordinador y al jurado |
| `deadlineReminders` | diaria 07:00 | Recordatorio al jurado cuando falten 2 días hábiles para responder o evaluar |
| `unseenConceptAlerts` | diaria 07:00 | Evaluación `SUBMITTED` hace más de `unseenConceptAlertDays` sin `studentFirstViewedAt` o sin `studentFirstDownloadedAt`: notifica al coordinador una sola vez (`unseenAlertSentAt`) (sugerencia 10) |

---

## 8. API (resumen de endpoints)

Todas las rutas van bajo `/api`. Los listados usan paginación con `?page=&limit=&sort=field&order=asc|desc` (sugerencia 6).

- `auth`: `POST login | refresh | logout | external/validate-token`, `GET me`, `PATCH password`
- `users`: `GET / | /:id | /faculty?q=`, `POST /`, `PATCH /:id`, `PATCH /:id/status`
- `catalogs`: `GET|POST|PATCH /programs | /periods | /cohorts` (rutas de primer nivel; lectura para cualquier usuario autenticado)
- `theses`:
  - `GET /` con filtros `programId, periodId, cohortId, status, q, codePrefix, seedTag` y sort por `code | title | student | status | progress | createdAt`
  - `POST /`, `GET /:id`, `PATCH /:id`
  - `POST /:id/manuscripts`, `GET /:id/manuscripts/:fileId`
  - `GET /:id/graph`, `GET /:id/feedback/summary`
  - `GET /mine` (estudiante)
- `assignments`:
  - `POST /theses/:id/assignments` (CU-01), `POST /assignments/validate`
  - `GET /assignments/mine` (jurado)
  - `POST /assignments/:id/accept | decline`
  - `POST /theses/:id/assignments/replace`, `POST /theses/:id/assignments/tiebreaker` (CU-05)
  - `GET /assignments/:id/external-link`
- `evaluations`: `GET /theses/:id/evaluations`, `PUT /assignments/:id/evaluation` (borrador), `POST /assignments/:id/evaluation/submit`, `POST /evaluations/:id/corrections`, `GET /evaluations/:id`, `GET /evaluations/:id/files/:fileId`
- `feedback`: `GET /theses/:id/feedback?chapter=`, `POST /theses/:id/feedback`, `POST /feedback/:id/address | resolve | reopen | comment`
- `disputes`: `GET /theses/:id/dispute` (comparativo)
- `defenses`: `GET /defenses`, `POST /theses/:id/defense`, `PATCH /defenses/:id`, `POST /defenses/:id/confirm`
- `minutes`: `POST /theses/:id/minutes`, `GET /minutes/:id`, `PATCH /minutes/:id`, `POST /minutes/:id/sign`, `GET /minutes/:id/pdf`
- `notifications`: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`
- `dashboard`: `GET /dashboard/coordinator?periodId=&cohortId=&programId=` → `{ totals, byStatus, byPeriod[], byCohort[], alerts[] }`
- `reports`: `GET /reports/theses.xlsx | theses.pdf` (mismos filtros del listado)
- `audit`: `GET /audit-logs?entityId=&actorId=&action=&from=&to=`
- `settings`: `GET /settings`, `PATCH /settings` (ADMIN)

---

## 9. Seed de datos (sugerencia 7)

`pnpm --filter server seed -- --tag=TEST --cohorts=10 --students=30 --jurors=40 --reset`

- Crea el programa MIETIA, los periodos y N cortes, un ADMIN y un COORDINATOR con credenciales conocidas (documentadas en `server/README.md`), jurados internos y externos, y estudiantes con su tesis.
- Distribuye las tesis por todos los estados de la máquina, con historial, asignaciones, evaluaciones, observaciones, sustentaciones y actas coherentes con cada estado.
- Todo documento generado lleva `seedTag = TEST` y el código de tesis lleva el prefijo (`TEST-MIETIA-…`), para poder filtrarlos y borrarlos con `--reset`.
- Con los parámetros por defecto se generan 300 tesis, lo que permite probar paginación, orden y reportes con volumen.

---

## 10. Pruebas

- **Unitarias (Jest):**
  - transiciones de `WorkflowService` y tabla de avance,
  - reglas de asignación (RF-C13, RN-01),
  - RN-06, resolución RN-08,
  - cálculo de días hábiles con festivos,
  - hash canónico del acta.
- **e2e (supertest + `mongodb-memory-server`):**
  - flujo completo CU-01 → CU-08 → CU-02 → CU-06 → CU-03 → CU-04,
  - flujo de discrepancia CU-05,
  - acceso con token externo,
  - matriz RBAC (403 esperados),
  - inmutabilidad (409).
- Las pruebas nunca usan Atlas.
- Criterio de cada sub-etapa: `pnpm --filter server test` y `test:e2e` en verde, y `lint` y `build` sin errores.

---

## 11. Sub-etapas de construcción (fase 1)

1. Monorepo, base del server, config, filtro de errores, Swagger, `shared`; módulos `auth` y `users`
2. `catalogs`, `theses`, `files` (GridFS), `workflow`
3. `assignments` (CU-01, CU-08, token externo, cuenta regresiva)
4. `evaluations` y `feedback` (CU-02, CU-06, registro de vista y descarga)
5. `disputes` (CU-05, RN-08)
6. `defenses` y `minutes` (CU-03, CU-04)
7. `audit`, `notifications`, `traceability`, `dashboard`, `reports`
8. `scheduler`, `settings`, `seed`, README final

## 12. Fuera de alcance (fase 1)

- Envío de correo electrónico: solo notificaciones internas.
- SSO o LDAP institucional.
- Firma digital criptográfica con certificado: se usa confirmación electrónica simple con hash.
- Cliente Nuxt: fase 2.
- Despliegue (Railway/Render y Vercel): al cierre del proyecto.
