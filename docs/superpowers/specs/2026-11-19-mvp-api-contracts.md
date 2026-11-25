# MVP API contracts — remaining server modules

Date: 2026-11-19 (updated 2026-11-23 with the tutor's adjustments, §15). Binding for the server modules still to build and for the Nuxt client.
Base: `docs/superpowers/specs/2026-11-17-server-design.md` (§4 status machine, §4.1 RN-08, §5 data model, §6 rules, §8 API). This file only **narrows and fixes** what the MVP builds; when they disagree, this file wins.

## Conventions (all modules)
- Routes under `/api`. Auth by httpOnly cookies. Lists use `?page=&limit=&sort=&order=` and return `{ items, total, page, limit }` (existing `paginate()`).
- Errors: `{ statusCode, code, message, details? }`, `code` from `ErrorCode` in `@thesis/shared`. 404 also means "not allowed to read".
- Ids are 24-hex strings. Dates are ISO strings. Every document has `id`, `createdAt`, `updatedAt`.
- Thesis status changes only through `WorkflowService.transition` (history and `thesis.status.changed` event).
- Domain events (`@OnEvent`) feed notifications: `assignment.*` (exists), `evaluation.submitted`, `feedback.*`, `defense.*`, `minutes.sealed`, `thesis.status.changed` (exists).

## MVP scope cuts
- **Originally cut, now built:** `reports` (§11), `GET /audit-logs` and the audit interceptor (§12), and the `overdueEvaluations`, `deadlineReminders` and `unseenConceptAlerts` jobs (§13).
- **Simplified:**
  - The scheduler runs `expirePending` every hour (the alert jobs of §13 were added later).
  - The seed is small (1 program, 2 periods, 2 cohorts, about 20 theses across the states, known users).
  - Minutes PDF: a simple `pdfkit` page with the data and the hash.

---

## 1. evaluations (CU-02) — module `evaluations`

Enums (`@thesis/shared`):
- `EvaluationVerdict`: `APPROVED_FOR_DEFENSE`, `APPROVED_WITH_CHANGES`, `REJECTED`, plus for the tiebreaker `APPROVED`, `REJECTED`.
- `EvaluationStatus`: `DRAFT`, `SUBMITTED`.

View `EvaluationView`:
```ts
{ id, assignmentId, thesisId, jurorId, juror: { id, firstName, lastName, isUnicordoba },
  assignmentType: 'PRIMARY'|'TIEBREAKER',
  rubric: { methodology: 1-5, relevance: 1-5, writingQuality: 1-5 } | null, score: number | null,
  verdict: EvaluationVerdict | null, comments: string, correctionFiles: { fileId, fileName, uploadedAt, manuscriptVersion? }[],
  status, submittedAt?, studentFirstViewedAt?, studentFirstDownloadedAt? }
```

| Method & route | Roles | Body / notes |
|---|---|---|
| `GET /theses/:id/evaluations` | COORDINATOR, ADMIN, juror on that thesis (only their own draft and all SUBMITTED ones), STUDENT of the thesis (SUBMITTED only) | `EvaluationView[]` |
| `GET /assignments/:id/evaluation` | assignment owner | Their evaluation, or `null` (204 is not used) |
| `PUT /assignments/:id/evaluation` | assignment owner, assignment `ACCEPTED` | Draft upsert `{ rubric?, verdict?, comments? }` → `EvaluationView`. 409 `EVALUATION_LOCKED` after submit; 409 `EVALUATION_NOT_ALLOWED` if not ACCEPTED |
| `POST /assignments/:id/evaluation/submit` | assignment owner | Requires a full rubric (PRIMARY), a verdict and comments of at least 20 chars. Otherwise 400 `EVALUATION_INCOMPLETE`. Then runs RN-08 (below) |
| `POST /evaluations/:id/corrections` | the author, while DRAFT, or after submit while the thesis is `UNDER_EVALUATION`, `IN_DISPUTE` or `REVISIONS_IN_PROGRESS` (else 409 `EVALUATION_LOCKED`) | The corrected document: multipart `file` (pdf/doc/docx, ≤25 MB) → `EvaluationView`. Each file records `manuscriptVersion`, the thesis' current manuscript version at upload time. Large files: the direct upload of §14 (`/corrections/uploads`, `/corrections/uploads/complete`) |
| `GET /evaluations/:id` | as for the list | Logs `VIEW` when a STUDENT reads it |
| `GET /evaluations/:id/files/:fileId` | as for the list | Download; logs `DOWNLOAD` for a STUDENT |
| `POST /theses/:id/evaluation-outcome/reconcile` | COORDINATOR, ADMIN | No body. Re-applies RN-08 from the stored evaluations (retry after a failed transition). Idempotent. 200 `{ thesisId, status, changed }`, where `changed` is true when this call moved the thesis. 409 `EVALUATION_NOT_COMPLETE` while neither both PRIMARY nor the TIEBREAKER evaluation is SUBMITTED |

Draft body: `comments: null` is stored as `''`; `rubric: null` clears the rubric and score; `verdict: null` clears the verdict.

RN-08 runs after a submit:
- **Both PRIMARY submitted:**
  - one approves and one rejects → `IN_DISPUTE`;
  - both `REJECTED` → `NOT_APPROVED`;
  - both approve → `REVISIONS_IN_PROGRESS` if either verdict is `APPROVED_WITH_CHANGES` or unresolved feedback exists (`FeedbackService.countUnresolved(thesisId) > 0`); otherwise `READY_FOR_DEFENSE`.
- **TIEBREAKER submitted** (thesis `IN_DISPUTE`):
  - `APPROVED` → the same revisions/ready rule;
  - `REJECTED` → `NOT_APPROVED`.
- Any `APPROVED_WITH_CHANGES` among the PRIMARY verdicts leads to `REVISIONS_IN_PROGRESS` even when there are no feedback items; the coordinator then uses `POST /theses/:id/ready-for-defense` (section 3).
- RN-08 is applied by `reconcileOutcome` (same code as the endpoint). If the transition fails after a submit, the evaluation stays stored and the error is only logged; the hourly scheduler pass reconciles every thesis in `UNDER_EVALUATION` or `IN_DISPUTE` whose required evaluations are all `SUBMITTED` (system actor).
- Event `evaluation.submitted` is emitted after RN-08 ran. Payload `{ thesisId, evaluationId, jurorId, verdict, resultingStatus?, actor }`; `resultingStatus` is the thesis status after RN-08.

## 2. disputes (CU-05) — inside `assignments` + `evaluations`

| Method & route | Roles | Notes |
|---|---|---|
| `GET /theses/:id/dispute` | COORDINATOR, ADMIN | `{ thesisId, status, primary: EvaluationView[], tiebreaker: { assignment: AssignmentView, evaluation: EvaluationView \| null } \| null }` |
| `POST /theses/:id/assignments/tiebreaker` | COORDINATOR | Same body as one CU-01 juror: `{ jurorId }` or `{ newExternal }`, plus an optional `responseBusinessDays`. Thesis must be `IN_DISPUTE` (else 409 `ASSIGNMENT_THESIS_STATUS`). Creates slot 3 `TIEBREAKER`, `PENDING`. RN-01 applies and the juror must not be a PRIMARY on this thesis. Response `{ assignment: AssignmentView, externalLink? }`. 409 `ASSIGNMENT_CONFLICT` if an active tiebreaker exists |
| `POST /theses/:id/assignments/replace` (thesis `IN_DISPUTE`) | COORDINATOR | `{ assignmentId, juror, responseBusinessDays? }` where `assignmentId` is the TIEBREAKER. Replaceable: `PENDING`, `DECLINED`/`EXPIRED` (not yet replaced), or `ACCEPTED` whose evaluation is not SUBMITTED (a stuck tiebreaker). The new assignment is a `TIEBREAKER` in slot 3, `PENDING`; the old one becomes `REPLACED` (inactive) and its DRAFT evaluation is deleted. Response as for the tiebreaker designation. 409 `ASSIGNMENT_NOT_REPLACEABLE` if the tiebreaker already submitted; a PRIMARY in this status gives 409 `ASSIGNMENT_THESIS_STATUS`. The thesis status does not change |

- The tiebreaker accepts or declines through the existing CU-08 endpoints.
- A decline or expiry leaves the thesis `IN_DISPUTE`, and the coordinator assigns another.
- The tiebreaker evaluates with `{ verdict: 'APPROVED'|'REJECTED', comments }`; the rubric is optional.

## 3. feedback (CU-06, RN-06) — module `feedback`

Enums:
- `FeedbackChapter`: `GENERAL`, plus the legacy `INTRODUCTION`, `THEORETICAL_FRAMEWORK`, `METHODOLOGY`, `RESULTS`, `CONCLUSIONS`, `OTHER`. Since 2026-11-23 feedback covers the whole document in one section: new items are `GENERAL` and the client no longer asks for or shows a chapter. The legacy values remain only so older items stay valid.
- `FeedbackStatus`: `PENDING`, `ADDRESSED`, `RESOLVED`.
- `FeedbackAction`: `ADDRESS`, `RESOLVE`, `REOPEN`, `COMMENT`.

View `FeedbackItemView`:
```ts
{ id, thesisId, jurorId, juror: { id, firstName, lastName }, chapter, reference?, content, status,
  replies: { authorId, authorName, authorRole, content, fileIds: string[], action, at }[] }
```

| Method & route | Roles | Notes |
|---|---|---|
| `GET /theses/:id/feedback?chapter=&status=` | COORDINATOR, ADMIN, an active juror of the thesis (ACCEPTED), STUDENT of the thesis | `FeedbackItemView[]`, ordered by chapter and then createdAt |
| `GET /theses/:id/feedback/summary` | same | `{ total, byStatus: {PENDING,ADDRESSED,RESOLVED}, byChapter: { [chapter]: {total, resolved} } }` |
| `POST /theses/:id/feedback` | a juror with an ACCEPTED assignment | `{ content, chapter?, reference? }` → `PENDING`. `chapter` defaults to `GENERAL`; `content` up to 20,000 characters (a whole-document observation) |
| `POST /feedback/:id/address` | STUDENT of the thesis, item `PENDING` | `{ content }` → `ADDRESSED` |
| `POST /feedback/:id/resolve` | author juror, item `ADDRESSED` | `{ content? }` → `RESOLVED` |
| `POST /feedback/:id/reopen` | author juror, item `ADDRESSED` | `{ content }` → `PENDING` |
| `POST /feedback/:id/comment` | any of the above readers | `{ content }`; the status does not change |

- A wrong-state transition returns 409 `FEEDBACK_INVALID_TRANSITION`.
- Items can only be created while the thesis is `UNDER_EVALUATION`, `IN_DISPUTE` or `REVISIONS_IN_PROGRESS`. Otherwise 409 `FEEDBACK_THESIS_STATUS`.
- Address, resolve, reopen and comment return 409 `FEEDBACK_THESIS_STATUS` when the thesis is `DEFENSE_SCHEDULED`, `NOT_APPROVED`, `COMPLETED_APPROVED` or `COMPLETED_FAILED`.
- `POST /theses/:id/ready-for-defense` (COORDINATOR, no body): `REVISIONS_IN_PROGRESS` → `READY_FOR_DEFENSE` when no feedback item is unresolved (e.g. RN-08 sent the thesis to revisions because of `APPROVED_WITH_CHANGES` with no items). Returns the thesis. 409 `WORKFLOW_INVALID_TRANSITION` if the thesis is not in `REVISIONS_IN_PROGRESS`; 409 `FEEDBACK_INVALID_TRANSITION` (`details.unresolved`) while items remain unresolved.
- **Auto:** when the thesis is `REVISIONS_IN_PROGRESS` and `countUnresolved` reaches 0 after a resolve → `READY_FOR_DEFENSE`.
- `FeedbackService.countUnresolved(thesisId)` is exported for evaluations.

## 4. defenses (CU-03) — module `defenses`

Enums:
- `DefenseModality`: `IN_PERSON`, `VIRTUAL`, `HYBRID`.
- `DefenseStatus`: `PROPOSED`, `CONFIRMED`, `HELD`, `CANCELLED`.

View `DefenseView`:
```ts
{ id, thesisId, thesis: { id, code, title, studentName }, scheduledAt, modality, location?, meetingUrl?,
  status, jurors: { userId, name, confirmedAt? }[] }
```

| Method & route | Roles | Notes |
|---|---|---|
| `GET /defenses?from=&to=&status=` | COORDINATOR, ADMIN; a juror sees only their own | paginated `DefenseView` |
| `GET /theses/:id/defense` | thesis readers (including the student) | `DefenseView \| null` (the current non-cancelled one) |
| `POST /theses/:id/defense` | COORDINATOR | `{ scheduledAt (future), modality, location?, meetingUrl? }`. VIRTUAL/HYBRID require `meetingUrl`; IN_PERSON/HYBRID require `location`. Thesis must be `READY_FOR_DEFENSE` (409 `DEFENSE_THESIS_STATUS`). 409 `DEFENSE_EXISTS` if one is open |
| `PATCH /defenses/:id` | COORDINATOR, while `PROPOSED` | Same fields; clears the confirmations |
| `POST /defenses/:id/confirm` | an active juror of the thesis (the PRIMARY ones with ACCEPTED, plus the tiebreaker if there is one) | When all of them confirmed: the defense becomes `CONFIRMED` and the thesis `DEFENSE_SCHEDULED` |
| `POST /defenses/:id/cancel` | COORDINATOR, `PROPOSED` | → `CANCELLED` |

## 5. minutes (CU-04, RNF-04) — module `minutes`

Enums:
- `MinutesVerdict`: `APPROVED`, `APPROVED_MERITORIOUS`, `APPROVED_LAUREATE`, `FAILED`.
- `MinutesStatus`: `DRAFT`, `SEALED`.

View `MinutesView`:
```ts
{ id, thesisId, defenseId, number: string /* e.g. "MIETIA-2026-001" */, finalGrade, verdict, remarks,
  contentHash, status, signatures: { userId, name, role, signedAt }[], requiredSigners: { userId, name, role }[],
  sealedAt?, pdfAvailable: boolean }
```

| Method & route | Roles | Notes |
|---|---|---|
| `POST /theses/:id/minutes` | COORDINATOR | `{ finalGrade 0.0-5.0, verdict, remarks }`. Thesis `DEFENSE_SCHEDULED`; the defense becomes `HELD`. A grade below 3.0 requires `FAILED` (400 `MINUTES_INVALID_GRADE`). 409 `MINUTES_EXISTS` |
| `GET /theses/:id/minutes` | thesis readers | `MinutesView \| null` |
| `GET /minutes/:id` | thesis readers | `MinutesView` |
| `PATCH /minutes/:id` | COORDINATOR, while DRAFT with no signatures | Same fields. 409 `MINUTES_SEALED` / `MINUTES_SIGNED` |
| `POST /minutes/:id/sign` | each required signer | Jurors first, the coordinator last (409 `MINUTES_SIGN_ORDER`). Records ip and userAgent. `contentHash` = SHA-256 of the canonical JSON (`{thesisId, number, finalGrade, verdict, remarks}`, sorted keys), recomputed on sign |
| `GET /minutes/:id/pdf` | thesis readers, SEALED only | `application/pdf` |

- Required signers: the active jurors (2 PRIMARY, plus the tiebreaker if it evaluated) and the COORDINATOR who created the minutes.
- When the last one signs: the minutes become `SEALED`, the PDF goes to GridFS (`MINUTES_PDF`), and the thesis becomes `COMPLETED_APPROVED` or `COMPLETED_FAILED` (FAILED → failed).
- After sealing, every write returns 409 `MINUTES_SEALED`.

## 6. notifications — module `notifications`

View: `{ id, type, title, body, link?, entityRef?: { kind, id }, thesisId?, readAt?, createdAt }`. The `type` string matches the event name; `thesisId` is the thesis it is about (stored by every listener). A scoped external session (§9) only sees, counts and marks notifications about its assigned thesis (`thesisId`, or an `entityRef` to that thesis or assignment).

| Route | Notes |
|---|---|
| `GET /notifications?unread=true` | own, paginated, newest first |
| `GET /notifications/unread-count` | `{ count }` |
| `POST /notifications/:id/read` | own |
| `POST /notifications/read-all` | own |

Listeners (Spanish title and body; `link` is a client route):

| Event | Recipients |
|---|---|
| assignment created | the juror |
| declined, expired | every COORDINATOR |
| accepted | COORDINATORs |
| thesis status changed | the student and the advisor (`advisorId`) |
| evaluation submitted | COORDINATORs, the student |
| feedback created, reopened | the student |
| feedback addressed | the author juror |
| defense proposed | the active jurors and the student |
| defense updated `{ thesisId, defenseId, actor }` | the active jurors and the student ("la sustentación fue reprogramada, confirme de nuevo") |
| defense cancelled | the active jurors and the student |
| defense confirmed | the coordinators and the student |
| minutes sealed | the student and the active jurors |

"Active jurors" use the defenses rule (`defenses/active-jurors.ts`): ACCEPTED active primaries, plus the tiebreaker only if it SUBMITTED.

## 7. dashboard — module `dashboard`

`GET /dashboard/coordinator?periodId=&cohortId=&programId=` (COORDINATOR, ADMIN):
```ts
{ totals: { theses, active, completed, notApproved },
  byStatus: { [ThesisStatus]: number },
  byCohort: { cohortId, name, count }[],
  alerts: { kind: 'PENDING_REPLACEMENT'|'IN_DISPUTE'|'RESPONSE_DUE_SOON'|'EVALUATION_OVERDUE', thesisId, code, title, message }[] }
```

## 8. traceability (CU-07) — inside `theses`

`GET /theses/:id/graph` (thesis readers):
```ts
{ thesisId, status, progress,
  nodes: { id, kind: 'STATUS'|'ASSIGNMENT'|'EVALUATION'|'DEFENSE'|'MINUTES', label, at, status?, current?: boolean }[],
  edges: { from, to, label? }[] }
```
- The STATUS nodes come from `history[]` in order: one node per entered status, plus the initial SUBMITTED.
- The other entities link to the STATUS node during which they happened.
- EVALUATION nodes: only SUBMITTED evaluations, except that staff (COORDINATOR/ADMIN) and the draft's own juror also see DRAFT ones. A draft label never includes the verdict.

## 9. external access (RF-J14) — stage-3 Task 7 (done)

- `POST /assignments/:id/external-link` (COORDINATOR, no body) → `{ assignmentId, url, expiresAt }`; rotates the token. CU-01/replace responses already include the links.
- `POST /auth/external/validate-token` `{ token }` (public) → 200 `{ user, assignmentId }`; sets only `access_token`, valid for `min(EXTERNAL_SESSION_TTL_SECONDS (4 h), link expiry - now)`; no refresh (401).
- **Deny by default.** A scoped session (`scope.assignmentIds` in the JWT) gets 401 `AUTH_EXTERNAL_TOKEN_INVALID` on every route not marked `@AllowScoped()` (`ScopedSessionGuard`, after JwtAuthGuard and RolesGuard; a route whose `@Roles` excludes EXTERNAL_JUROR still answers 403 first). Allowed routes, all limited to the assignment in scope and its thesis (404 for any other thesis):
  - `GET /auth/me`, `POST /auth/logout`
  - `GET /assignments/mine`, `GET /assignments/:id`, `POST /assignments/:id/accept`, `POST /assignments/:id/decline`
  - `GET /theses/:id` (PENDING: metadata, `manuscripts: []`; ACCEPTED: with manuscripts), `GET /theses/:id/manuscripts/:fileId` (ACCEPTED)
  - `GET /theses/:id/evaluations`, `GET`/`PUT /assignments/:id/evaluation`, `POST /assignments/:id/evaluation/submit`, `POST /evaluations/:id/corrections` (and its `/uploads`, `/uploads/complete`, §14), `GET /evaluations/:id`, `GET /evaluations/:id/files/:fileId`
  - `GET /theses/:id/feedback`, `GET /theses/:id/feedback/summary`, `POST /theses/:id/feedback`, `POST /feedback/:id/resolve`, `POST /feedback/:id/reopen`, `POST /feedback/:id/comment`
  - `GET /theses/:id/defense`, `GET /defenses/:id`, `POST /defenses/:id/confirm`
  - `GET /theses/:id/minutes`, `GET /minutes/:id`, `POST /minutes/:id/sign`, `GET /minutes/:id/pdf`
  - `GET /theses/:id/graph`
  - `/notifications/*` (filtered to the assigned thesis, §6)
- Everything else is 401, including `GET /defenses`, the catalogs (`/programs`, `/periods`, `/cohorts`) and `PATCH /auth/password`.
- Every authenticated request also checks that the user still exists and is active (401 `AUTH_UNAUTHENTICATED` otherwise).
- The client route for the link is `/auth/external-access?token=…`.

## 9.1 Thesis view (privacy)

`GET /theses/:id`, `GET /theses/mine` and the manuscript upload response are role-specific:
- COORDINATOR/ADMIN (unscoped): the whole document (`GET /theses` is staff-only and unchanged).
- STUDENT (owner) and jurors: no `conflictOfInterestUserIds`, no `seedTag`; `history[]` entries keep only `from`, `to`, `at`, `actorRole`, `reason?` (no `actorId`, no `evidenceFileIds`). Advisor ids (`advisorId`, `coAdvisorIds`) stay.
- Jurors see `manuscripts` (and `currentManuscriptId`) only with an ACCEPTED assignment; with PENDING, `manuscripts: []` and no `currentManuscriptId`.

## 10. Seed (MVP)

`pnpm --filter server seed -- --reset`. It creates the program, periods, cohorts and known users (documented in `server/README.md`):
- `admin@unicordoba.edu.co`
- `coordinador@unicordoba.edu.co`
- 6 internal jurors, 3 external jurors, 15 students

It also creates theses across every status, with coherent assignments, evaluations, feedback, defenses and minutes. Every document gets `seedTag: 'DEMO'`; `--reset` deletes only `seedTag` documents.

## 11. reports (CU-09) — module `reports`

All three endpoints: COORDINATOR, ADMIN (403 for others). Filters are the same as `GET /theses`, **without pagination** (`page` and `limit` are rejected with 400): `programId`, `periodId`, `cohortId`, `status`, `q`, `codePrefix`, `seedTag`, `sort` (`code|title|student|status|progress|createdAt`), `order` (`asc|desc`). Capped at 2000 rows.

- `GET /reports/theses.xlsx` → binary, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="tesis-YYYYMMDD.xlsx"` (date in America/Bogota). Sheet `Tesis`; bold header, frozen first row, autofilter.
- `GET /reports/theses.pdf` → `application/pdf`, `attachment; filename="tesis-YYYYMMDD.pdf"`. A4 landscape, with title, generation date, applied filters and a table with page breaks.
- Columns in both: Código, Título, Estudiante, Director(a), Programa (code), Periodo (code), Estado (Spanish label), Jurados (active assignments, comma separated), Fecha de radicación, Última actualización (`dd/mm/yyyy` in the PDF, plus `hh:mm` in the xlsx, America/Bogota).
- The client downloads with a plain link or `window.location` to `/api/reports/theses.xlsx?…` (the auth cookie is sent), not with `fetch` and JSON.
- `GET /reports/summary` (same filters) →
```ts
{ total: number,
  byStatus:  { status: ThesisStatus, label: string /* Spanish */, count: number }[],
  byProgram: { id, code?, name?, count }[],
  byPeriod:  { id, code?, count }[] }   // each list sorted by count desc
```

## 12. audit (CU-09, RNF-04) — module `audit`

`GET /audit-logs` (ADMIN, COORDINATOR). Query: `page`, `limit` (max 100), `actorId` (ObjectId), `entityType`, `entityId`, `action` (exact), `from`, `to` (ISO 8601, inclusive, on `at`). Always newest first (`sort`/`order` are ignored). Response `{ items, total, page, limit }`:
```ts
AuditLog = { id, at, actorId?, actorRoles: Role[], action: string, method?, path?,
             entityType?, entityId?, statusCode?, ip?, userAgent?, meta?: Record<string, string|number|boolean|string[]> }
```
- Recorded by a global interceptor for every **successful** POST/PUT/PATCH/DELETE by an authenticated user. `action` is `"<METHOD> <route pattern without /api>"`, e.g. `PATCH /theses/:id`, `POST /theses/:id/assignments`. `path` is the concrete path.
- `entityType` is the first static segment of the route (`theses`, `assignments`, `minutes`…); `entityId` is the route `:id` (on a create, the `id` of the response).
- Explicit events: `AUTH_LOGIN_SUCCESS` (actor set), `AUTH_LOGIN_FAILURE` (`meta.email` = attempted e-mail, `statusCode` 401/403), `AUTH_LOGOUT`. All have `entityType: 'auth'`.
- `meta` only holds allow-listed body fields (`to`, `verdict`, `status`, `decision`, `modality`, `type`, `isActive`, `role`, `roles`). Passwords, tokens and free text are never stored.
- Writes are fire-and-forget (a failure is logged, never fails the request), so an entry may take a few ms to appear. The collection is insert-only: no update/delete endpoints, and the schema throws on any update or delete.

## 13. Alert jobs and `POST /admin/jobs/run` (suggestions 8 and 10)

Module `scheduler`. `expirePending` (which also runs the RN-08 reconcile passes) stays hourly. The three alert jobs run **daily at 07:00 America/Bogota** (`daily-alert-jobs`). All crons are disabled under `NODE_ENV=test`.

Every job is idempotent and takes `now` (`AlertJobsService.<job>(now)`), so tests control the clock. A marker is claimed with a compare-and-set update *before* notifying; if notifying fails the marker is restored and the next run retries. Each item runs in its own try/catch and is logged. Business days use the Bogotá calendar and `settings.holidays`.

| Job | Selects | Notifies | Marker |
|---|---|---|---|
| `overdueEvaluations` | Assignment `ACCEPTED`, active, `evaluationDeadline < now`, no `SUBMITTED` evaluation, thesis `UNDER_EVALUATION` or `IN_DISPUTE` | The juror and all active coordinators. Re-notifies every `overdueRenotifyBusinessDays` business days (0 = never) | `assignment.overdueNotifiedAt` (updated on each re-notification) |
| `deadlineReminders` (response) | Assignment `PENDING`, active, `responseDeadline >= now` with at most `reminderBusinessDaysBefore` business days left, thesis not `SUBMITTED` | The juror, once | `assignment.responseReminderSentAt` |
| `deadlineReminders` (evaluation) | Assignment `ACCEPTED`, active, `evaluationDeadline >= now` with at most `reminderBusinessDaysBefore` business days left, no `SUBMITTED` evaluation, thesis `UNDER_EVALUATION` or `IN_DISPUTE` | The juror, once | `assignment.evaluationReminderSentAt` |
| `unseenConceptAlerts` | Evaluation `SUBMITTED` with neither `studentFirstViewedAt` nor `studentFirstDownloadedAt` (the student never opened or downloaded it, as in suggestion 10), and at least `unseenConceptAlertDays` business days since `submittedAt` | All active coordinators, once | `evaluation.unseenAlertSentAt` |

The "seen" timestamps already existed (suggestion 9): `studentFirstViewedAt` is set when a STUDENT reads `GET /evaluations/:id`, `studentFirstDownloadedAt` on a correction download. Suggestion 8 (countdown column) is already served by `responseDaysRemaining` and `evaluationDaysRemaining` in `AssignmentView`.

### Notification types and links

| `type` | Recipients | Title | Link |
|---|---|---|---|
| `evaluation.overdue` | Juror | Tu concepto está vencido | `/juror/evaluation/:assignmentId` |
| `evaluation.overdue` | Coordinators | Concepto de jurado vencido | `/coordinator/theses/:thesisId` |
| `assignment.response.reminder` | Juror | Recordatorio: responde tu asignación | `/juror` |
| `evaluation.deadline.reminder` | Juror | Recordatorio: plazo de evaluación | `/juror/evaluation/:assignmentId` |
| `evaluation.unseen` | Coordinators | El estudiante no ha consultado el concepto | `/coordinator/theses/:thesisId` |

`entityRef` is `{ kind: 'assignment', id }` for the first three types and `{ kind: 'evaluation', id }` for `evaluation.unseen`.

### Settings (`GET|PATCH /api/settings`)

| Key | Default | Range | Meaning |
|---|---|---|---|
| `reminderBusinessDaysBefore` | 2 | 1-10 | Reminders go out when this many business days or fewer remain |
| `overdueRenotifyBusinessDays` | 5 | 0-60 | Business days between overdue re-notifications; 0 = once only |
| `unseenConceptAlertDays` | 3 | 1-60 | (existing) business days before the unseen-concept alert |

### `POST /api/admin/jobs/run`

ADMIN only (not `@AllowScoped`; scoped external sessions cannot reach it). For the demo and the e2e tests.
- Body: `{ job: 'expirePending' | 'reconcile' | 'overdueEvaluations' | 'deadlineReminders' | 'unseenConceptAlerts' | 'all' }`. Anything else is 400.
- Response 200: counts per job that ran, e.g. `{ "overdueEvaluations": 2 }`, or all five keys for `all`.
  - `expirePending`: assignments expired.
  - `reconcile`: theses processed by the assignment and RN-08 (evaluation outcome) reconcile passes.
  - The other three: notification batches sent (assignments or evaluations notified).
- It runs with the real clock; jobs are idempotent, so repeating it returns 0 for what was already sent.

## 14. File storage and direct uploads (Vercel Blob)

Vercel functions cap request and response bodies at 4.5 MB, so in production the bytes of manuscripts and correction files move directly between the browser and a **private** Vercel Blob store. The API only authorizes, verifies and registers them.

**Driver.** `STORAGE_DRIVER` = `gridfs` (default: local work and every test) or `vercel-blob` (production; needs `BLOB_READ_WRITE_TOKEN`).
- File metadata always stays in Mongo, in `files.files` (the GridFS files collection): `filename`, `length`, `metadata.{ ownerId, thesisId, kind, mimeType, sha256, seedTag? }`, plus `metadata.storage: 'gridfs' | 'blob'` (missing = `gridfs`) and `metadata.blobPathname` for blob files. A unique partial index on `metadata.blobPathname` allows one registration per blob.
- Buffer uploads (the multipart routes, the sealed minutes PDF, the seed) always go to GridFS, in both modes. Only direct uploads go to Blob. Files already in GridFS (the demo seed) keep working after the switch.

**Direct upload** (manuscripts: `base = /theses/:id/manuscripts`, COORDINATOR or the owner STUDENT, thesis not closed; corrections: `base = /evaluations/:id/corrections`, the author juror within the session scope, evaluation DRAFT or submitted while the thesis is under evaluation, in dispute or in revisions — see §1). Each step runs the same authorization as the multipart `POST base`.

| Step | Request | Response |
|---|---|---|
| 1 | `POST base/uploads` `{ fileName, size, contentType }` | 200 `{ strategy: 'DIRECT', clientToken, pathname, expiresAt }`, or `{ strategy: 'MULTIPART' }` with the gridfs driver (the client then uses `POST base` unchanged) |
| 2 | browser → Blob: `put(pathname, file, { access: 'private', token: clientToken, contentType })` from `@vercel/blob/client` | the blob |
| 3 | `POST base/uploads/complete` `{ pathname, fileName }` | 201, same body as `POST base` (`Thesis` view after upload / `EvaluationView`) |

- Step 1 validates `size ≤ 25 MB` (413 `FILE_TOO_LARGE`) and `contentType` (manuscripts: PDF; corrections: PDF, DOC, DOCX; else 415 `FILE_TYPE_NOT_ALLOWED`). `size` must be an integer ≥ 1 (400).
- `pathname` = `manuscripts/<thesisId>/<uuid>-<size>.pdf` or `corrections/<evaluationId>/<uuid>-<size>.<pdf|doc|docx>`: random, unguessable, and it carries the declared size so step 3 needs no server state.
- `clientToken` is valid for 10 minutes and limited to that pathname, that content type and `maximumSizeInBytes = size`; no overwrite, no random suffix.
- Step 3 refuses with 400 `FILE_UPLOAD_INVALID`, without touching the blob: the gridfs driver, a pathname outside this resource's prefix or not of the shape above, or a blob already registered. Then it checks the blob:
  - missing → 400 `FILE_REQUIRED`;
  - larger than 25 MB → 413 `FILE_TOO_LARGE`; another size than declared → 400 `FILE_UPLOAD_INVALID`;
  - type by magic bytes (`%PDF-`; OLE; ZIP with the Word parts, read from the first and last 64 KB) not allowed → 415 `FILE_TYPE_NOT_ALLOWED`.
  - On these three the blob is deleted. The server reads the blob once to compute `sha256` (as GridFS uploads do).
- Then the same domain logic as the multipart route: a new manuscript version (`manuscriptSeq`, `currentManuscriptId`, 409 `MANUSCRIPT_CONFLICT`) or a new correction file. If that fails, the file (blob and metadata) is deleted.
- A blob uploaded but never completed stays orphaned in the store (no cleanup job in the MVP).

**Downloads.** `GET /theses/:id/manuscripts/:fileId`, `GET /evaluations/:id/files/:fileId` and `GET /minutes/:id/pdf` keep their URL and authorization.
- GridFS file: streamed as an attachment, as before (`?as=url` is ignored).
- Blob file: `302` to a presigned GET URL valid 5 minutes and limited to that pathname, with `Cache-Control: no-store`. The Blob host sends `Content-Disposition: inline; filename="<uuid>.<ext>"` (the SDK cannot set it per URL).
- Blob file with `?as=url`: 200 `{ url, expiresAt }`, `Cache-Control: no-store`. The SPA uses this: a `fetch` with `credentials: 'include'` cannot follow a redirect to the Blob host (it answers `Access-Control-Allow-Origin: *`), so the client fetches the URL with `credentials: 'omit'` and keeps showing the PDF from an object URL and saving with the real file name.

## 15. Tutor's adjustments (2026-11-23)

### Juror search per thesis (CU-01)
| Method & route | Roles | Notes |
|---|---|---|
| `GET /theses/:id/juror-candidates?q=` | COORDINATOR | Active faculty (internal and external jurors), filtered by `q` like `GET /users/faculty` (name, email, institution). Returns up to 30 `JurorCandidate`, ranked for this thesis. 404 for an unknown thesis |

`JurorCandidate` = the faculty user fields (`id, firstName, lastName, email, roles, isActive, jurorProfile`) plus:
- `affinity: string[]`: the juror's `jurorProfile.expertise` terms that match the thesis `keywords`. The match ignores case and accents, and a term matches when it contains, or is contained in, a keyword.
- `activeAssignments: number`: the juror's active assignments (`isActive`) on any thesis.
- `conflict: 'PARTY' | 'PREVIOUS_JUROR' | null` (RN-01):
  - `PARTY`: the juror is the student, advisor or co-advisor of the thesis, or is in `conflictOfInterestUserIds`;
  - `PREVIOUS_JUROR`: the juror already had an assignment on this thesis.

Order: candidates without a conflict first, then more `affinity`, then fewer `activeAssignments`, then last name and first name. Conflicted candidates stay in the list so the client can show them disabled with the reason. Assigning one is still refused by the CU-01 validation.

### New jurors not yet registered (RF-C14)
- `newExternal` (CU-01 jurors, replacement and tiebreaker) accepts an optional `isUnicordoba: boolean` for a Universidad de Córdoba professor who is not yet registered. Default `false`.
- The user is created as today (`EXTERNAL_JUROR`, no password, token access link in `externalLinks`) with `jurorProfile.isUnicordoba` set from the flag.
- An inline juror with `isUnicordoba: true` counts for RF-C13 (`JUROR_UNICORDOBA_REQUIRED`).
- The client offers "Registrar jurado nuevo" in both slots.

### Client behaviour tied to these contracts
- The juror evaluation page does not display the manuscript. It offers "Descargar documento completo (PDF)" (`GET /theses/:id/manuscripts/:fileId`) and the upload of the corrected document (`POST /evaluations/:id/corrections`), with the upload history and the reviewed version.
- The student sees each juror's corrected documents under the submitted concept, the current one marked, and uploads a new manuscript version through the existing manuscript route.

## 16. Joint theses and invitation links (2026-11-25)

- **Joint theses:** `POST /theses` takes optional `coStudentIds` (up to 2 more STUDENT ids, distinct from `studentId`). `PATCH /theses/:id` can change `coStudentIds` while the thesis is `SUBMITTED`. `studentId` stays the main student. `studentName` lists every student, comma separated (`"Ana Ruiz, Beto Díaz"`).
  - Every co-student has the same access as the main student: `GET /theses/mine`, read, manuscript upload, feedback and evaluations.
  - Every co-student gets the student notifications.
  - No student can be on two active theses, whether as main student or as co-student: `409 THESIS_STUDENT_HAS_ACTIVE`.
  - A co-student that is not an active STUDENT, or that repeats the main student, gets `400 THESIS_INVALID_REFERENCE` with `details.field = "coStudentIds"`.
- **Invitation links (client only):** each EXTERNAL_JUROR card on the thesis page shows whether its link is active and when it expires (`hasExternalLink`, `externalLinkExpiresAt`), with **Generar enlace** / **Generar nuevo enlace**. Both call `POST /assignments/:id/external-link`. A new link stops the previous one from working, because only a hash of the token is stored.
