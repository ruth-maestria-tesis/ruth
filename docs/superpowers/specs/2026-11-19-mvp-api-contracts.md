# MVP API contracts — remaining server modules

Date: 2026-11-19. Binding for the server modules still to build and for the Nuxt client.
Base: `docs/superpowers/specs/2026-11-17-server-design.md` (§4 status machine, §4.1 RN-08, §5 data model, §6 rules, §8 API). This file only **narrows and fixes** what the MVP builds; when they disagree, this file wins.

## Conventions (all modules)
- Routes under `/api`. Auth by httpOnly cookies. Lists use `?page=&limit=&sort=&order=` and return `{ items, total, page, limit }` (existing `paginate()`).
- Errors: `{ statusCode, code, message, details? }`, `code` from `ErrorCode` in `@thesis/shared`. 404 also means "not allowed to read".
- Ids are 24-hex strings. Dates are ISO strings. Every document has `id`, `createdAt`, `updatedAt`.
- Thesis status changes only through `WorkflowService.transition` (history and `thesis.status.changed` event).
- Domain events (`@OnEvent`) feed notifications: `assignment.*` (exists), `evaluation.submitted`, `feedback.*`, `defense.*`, `minutes.sealed`, `thesis.status.changed` (exists).

## MVP scope cuts
- **Out:** `reports` (xlsx/pdf export), `GET /audit-logs` and the audit interceptor, the `overdueEvaluations`, `deadlineReminders` and `unseenConceptAlerts` jobs.
- **Simplified:**
  - The scheduler only runs `expirePending` every hour.
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
  verdict: EvaluationVerdict | null, comments: string, correctionFiles: { fileId, fileName, uploadedAt }[],
  status, submittedAt?, studentFirstViewedAt?, studentFirstDownloadedAt? }
```

| Method & route | Roles | Body / notes |
|---|---|---|
| `GET /theses/:id/evaluations` | COORDINATOR, ADMIN, juror on that thesis (only their own draft and all SUBMITTED ones), STUDENT of the thesis (SUBMITTED only) | `EvaluationView[]` |
| `GET /assignments/:id/evaluation` | assignment owner | Their evaluation, or `null` (204 is not used) |
| `PUT /assignments/:id/evaluation` | assignment owner, assignment `ACCEPTED` | Draft upsert `{ rubric?, verdict?, comments? }` → `EvaluationView`. 409 `EVALUATION_LOCKED` after submit; 409 `EVALUATION_NOT_ALLOWED` if not ACCEPTED |
| `POST /assignments/:id/evaluation/submit` | assignment owner | Requires a full rubric (PRIMARY), a verdict and comments of at least 20 chars. Otherwise 400 `EVALUATION_INCOMPLETE`. Then runs RN-08 (below) |
| `POST /evaluations/:id/corrections` | the author, while DRAFT | multipart `file` (pdf/doc/docx, ≤25 MB) → `EvaluationView` |
| `GET /evaluations/:id` | as for the list | Logs `VIEW` when a STUDENT reads it |
| `GET /evaluations/:id/files/:fileId` | as for the list | Download; logs `DOWNLOAD` for a STUDENT |

RN-08 runs after a submit:
- **Both PRIMARY submitted:**
  - one approves and one rejects → `IN_DISPUTE`;
  - both `REJECTED` → `NOT_APPROVED`;
  - both approve → `REVISIONS_IN_PROGRESS` if either verdict is `APPROVED_WITH_CHANGES` or unresolved feedback exists (`FeedbackService.countUnresolved(thesisId) > 0`); otherwise `READY_FOR_DEFENSE`.
- **TIEBREAKER submitted** (thesis `IN_DISPUTE`):
  - `APPROVED` → the same revisions/ready rule;
  - `REJECTED` → `NOT_APPROVED`.

## 2. disputes (CU-05) — inside `assignments` + `evaluations`

| Method & route | Roles | Notes |
|---|---|---|
| `GET /theses/:id/dispute` | COORDINATOR, ADMIN | `{ thesisId, status, primary: EvaluationView[], tiebreaker: { assignment: AssignmentView, evaluation: EvaluationView \| null } \| null }` |
| `POST /theses/:id/assignments/tiebreaker` | COORDINATOR | Same body as one CU-01 juror: `{ jurorId }` or `{ newExternal }`, plus an optional `responseBusinessDays`. Thesis must be `IN_DISPUTE` (else 409 `ASSIGNMENT_THESIS_STATUS`). Creates slot 3 `TIEBREAKER`, `PENDING`. RN-01 applies and the juror must not be a PRIMARY on this thesis. Response `{ assignment: AssignmentView, externalLink? }`. 409 `ASSIGNMENT_CONFLICT` if an active tiebreaker exists |

- The tiebreaker accepts or declines through the existing CU-08 endpoints.
- A decline or expiry leaves the thesis `IN_DISPUTE`, and the coordinator assigns another.
- The tiebreaker evaluates with `{ verdict: 'APPROVED'|'REJECTED', comments }`; the rubric is optional.

## 3. feedback (CU-06, RN-06) — module `feedback`

Enums:
- `FeedbackChapter`: `INTRODUCTION`, `THEORETICAL_FRAMEWORK`, `METHODOLOGY`, `RESULTS`, `CONCLUSIONS`, `OTHER`.
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
| `POST /theses/:id/feedback` | a juror with an ACCEPTED assignment | `{ chapter, reference?, content }` → `PENDING` |
| `POST /feedback/:id/address` | STUDENT of the thesis, item `PENDING` | `{ content }` → `ADDRESSED` |
| `POST /feedback/:id/resolve` | author juror, item `ADDRESSED` | `{ content? }` → `RESOLVED` |
| `POST /feedback/:id/reopen` | author juror, item `ADDRESSED` | `{ content }` → `PENDING` |
| `POST /feedback/:id/comment` | any of the above readers | `{ content }`; the status does not change |

- A wrong-state transition returns 409 `FEEDBACK_INVALID_TRANSITION`.
- Items can only be created while the thesis is `UNDER_EVALUATION`, `IN_DISPUTE` or `REVISIONS_IN_PROGRESS`. Otherwise 409 `FEEDBACK_THESIS_STATUS`.
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

View: `{ id, type, title, body, link?, entityRef?: { kind, id }, readAt?, createdAt }`. The `type` string matches the event name.

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
| thesis status changed | the student, and the advisor if it is a user |
| evaluation submitted | COORDINATORs, the student |
| feedback created | the student |
| feedback addressed | the author juror |
| defense proposed | the jurors and the student |
| defense confirmed | the coordinators and the student |
| minutes sealed | the student and the jurors |

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

## 9. external access (RF-J14) — stage-3 Task 7 (done)

- `POST /assignments/:id/external-link` (COORDINATOR, no body) → `{ assignmentId, url, expiresAt }`; rotates the token. CU-01/replace responses already include the links.
- `POST /auth/external/validate-token` `{ token }` (public) → 200 `{ user, assignmentId }`; sets only `access_token` (4 h); no refresh (401). A scoped session may use `/auth/me`, `/assignments/mine`, `/assignments/:id`, accept/decline, `GET /theses/:id` (PENDING/ACCEPTED) and the manuscript download (ACCEPTED). 401 `AUTH_EXTERNAL_TOKEN_INVALID` otherwise.
- The client route for the link is `/auth/external-access?token=…`.
- Implemented in commit 3a4f649.

## 10. Seed (MVP)

`pnpm --filter server seed -- --reset`. It creates the program, periods, cohorts and known users (documented in `server/README.md`):
- `admin@unicordoba.edu.co`
- `coordinador@unicordoba.edu.co`
- 6 internal jurors, 3 external jurors, 15 students

It also creates theses across every status, with coherent assignments, evaluations, feedback, defenses and minutes. Every document gets `seedTag: 'DEMO'`; `--reset` deletes only `seedTag` documents.
