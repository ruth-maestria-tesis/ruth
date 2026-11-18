# Server Stage 3 — Juror Assignments (CU-01, CU-08, RF-J14) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the coordinator assign two jurors to a submitted thesis (CU-01, RF-C13, RN-01, inline external jurors RF-C14), let jurors accept or decline with business-day deadlines and a countdown (CU-08, sugerencia 8), replace jurors who decline or expire, and give external jurors token-based access limited to their assignment (RF-J14).

**Architecture:** New `settings` module (business-day settings and holidays) and `assignments` module. Pure units: business-day calendar (`common/time/business-days.ts`), jury composition rules (`jury.rules.ts`), assignment view/countdown (`assignment-view.ts`), access policies. `AssignmentsService` (CU-01, validate, replace, lists, external links) and `AssignmentResponsesService` (CU-08 accept/decline/expire). Every thesis status change goes through `WorkflowService.transition`. External jurors exchange a hashed one-time-generated token for a scoped access JWT in a new `ExternalAuthService`.

**Tech Stack:** NestJS 11, Mongoose 8, `@nestjs/event-emitter` 3, Jest 30 + supertest + mongodb-memory-server. No new packages.

**Spec:** `docs/superpowers/specs/2026-11-17-server-design.md` §2.2, §2.3, §4, §5 (assignments, settings), §6 (RF-C13/RN-01, RF-C14, CU-08, countdown), §8 (assignments, auth). Use cases: `dds3/documentacion/casos-de-uso.md` CU-01, CU-08. Code in English; only UI text is Spanish.

---

## Decisions taken in this plan (spec gaps)

| Topic | Decision |
|---|---|
| Settings now | A `settings` singleton (`_id: 'global'`) is created in this stage because deadlines need it: `acceptanceBusinessDays` 8, `evaluationBusinessDays` 20, `unseenConceptAlertDays` 3, `holidays: 'YYYY-MM-DD'[]` (empty by default; admin loads the Colombian calendar), `thesisCodePrefix` `MIETIA`. `GET /settings` (ADMIN, COORDINATOR), `PATCH /settings` (ADMIN). |
| Time zone | Business days are computed on the America/Bogotá calendar (UTC−5, no DST). A deadline of N business days is the **end (23:59:59.999 Bogotá) of the N-th business day after the assignment day**. |
| Countdown | `daysSinceAssigned` (calendar days), `responseDaysRemaining` (business days in (today, deadline day]; only while `PENDING`), `evaluationDaysRemaining` (same, only while `ACCEPTED`; stage 4 nulls it once the evaluation is submitted), `isResponseOverdue`. The client derives hours from `responseDeadline`. |
| CU-01 preconditions | Thesis must be `SUBMITTED` (409 `ASSIGNMENT_THESIS_STATUS`) and have a manuscript (409 `THESIS_MANUSCRIPT_REQUIRED`). |
| Composition errors | 400 `ASSIGNMENT_INVALID_COMPOSITION` with `details.violations: [{ code: JuryViolation, slot? }]`; `POST /assignments/validate` returns the same list with 200 and saves nothing. |
| Inline external juror (RF-C14) | `newExternal: { email, firstName, lastName, institution, highestDegree, country }` creates an `EXTERNAL_JUROR` without password, `isUnicordoba: false`. An email that already exists is a violation (`JUROR_EMAIL_TAKEN`): the coordinator must pick the existing user. |
| External passwords | An external-only user can never have a password: create rejects it (400 `USER_PASSWORD_NOT_ALLOWED`), changing roles to external-only removes it, and password login is refused for them. |
| External link | `POST /assignments/:id/external-link` (not GET: it rotates the token). Token = 32 random bytes base64url; only its SHA-256 is stored, valid `EXTERNAL_TOKEN_TTL_DAYS` (60) and only while the assignment is `PENDING`/`ACCEPTED`. Regenerating invalidates the previous link. CU-01 and replace return the links for external jurors directly. |
| External session | `POST /auth/external/validate-token` (public, 10/min) issues only an access cookie: roles `[EXTERNAL_JUROR]`, `scope.assignmentIds: [id]`, TTL `EXTERNAL_SESSION_TTL_SECONDS` (14400). No refresh token: the juror reopens the link. |
| Juror access to theses | Thesis metadata: juror with a `PENDING` or `ACCEPTED` assignment on it. Manuscript: `ACCEPTED` only (RBAC "Si Aceptó"). Scoped sessions only count assignments in their scope. Otherwise 404. |
| Slots and concurrency | `isActive` (true while `PENDING`/`ACCEPTED`) backs two partial unique indexes: one active assignment per `(thesisId, slot)` and per `(thesisId, jurorId)`. Concurrent CU-01 calls cannot create a second jury; the loser is compensated (its assignments and inline users deleted) and gets 409. |
| Decline / expire | Assignment → `DECLINED`/`EXPIRED`, `isActive: false`; thesis `JURORS_ASSIGNED → PENDING_JUROR_REPLACEMENT` (no-op if it is already there). `expirePending(now)` is a service method; the hourly cron is wired in stage 8. |
| Replace | `POST /theses/:id/assignments/replace` with `{ assignmentId, juror }` while the thesis is `JURORS_ASSIGNED` or `PENDING_JUROR_REPLACEMENT`. Replaceable: `PENDING` (→ `REPLACED`) or `DECLINED`/`EXPIRED` not yet replaced (keeps its status, gets `replacedById`). `ACCEPTED` → 409 `ASSIGNMENT_NOT_REPLACEABLE`. Jurors who were ever on the thesis cannot return (`JUROR_PREVIOUSLY_ASSIGNED`). RF-C13 is checked when the replacement completes a 2-juror jury. When both slots are active again the thesis goes back to `JURORS_ASSIGNED`. |
| Moving to evaluation | After an accept, if both active `PRIMARY` assignments are `ACCEPTED` the thesis moves to `UNDER_EVALUATION` (from `JURORS_ASSIGNED` or `PENDING_JUROR_REPLACEMENT`); a concurrent second accept that loses the transition race is ignored. |
| Events | `assignment.created|accepted|declined|expired|replaced` with `{ assignmentId, thesisId, jurorId, actorId?, actorRole, reason?, at }` for stage 7 (notify coordinator on decline/expire). |
| Tiebreaker | `type: TIEBREAKER`, slot 3 exist in the schema; the endpoint is stage 5 (CU-05). |

## File map

```
shared/src/
  assignments.ts                       NEW  AssignmentStatus, AssignmentType, ACTIVE_ASSIGNMENT_STATUSES, JuryViolation
  roles.ts                             MOD  isExternalOnly()
  error-codes.ts                       MOD  + assignment/auth/user/thesis codes
  index.ts                             MOD

server/src/
  config/env.validation.ts             MOD  EXTERNAL_TOKEN_TTL_DAYS, EXTERNAL_SESSION_TTL_SECONDS
  common/time/business-days.ts         NEW  (+ spec)
  users/users.service.ts               MOD  external password rules, createExternalJuror, findManyByEmails, deleteByIds
  users/dto/external-juror.dto.ts      NEW  NewExternalJurorDto
  auth/auth.service.ts                 MOD  refuse password login for external-only users
  auth/external-auth.service.ts        NEW  token → scoped access JWT
  auth/dto/validate-external-token.dto.ts NEW
  auth/auth.controller.ts / auth.module.ts MOD
  settings/                            NEW  schema, dto, service, controller, module
  assignments/
    schemas/assignment.schema.ts       NEW
    jury.rules.ts                      NEW  (+ spec)
    assignment-view.ts                 NEW  (+ spec)
    assignment-access.policy.ts        NEW  (+ spec)
    external-token.ts                  NEW  (+ spec)
    assignment.events.ts               NEW
    dto/*.ts                           NEW
    assignments.service.ts             NEW  CU-01, validate, replace, lists, external links
    assignment-responses.service.ts    NEW  CU-08 accept/decline, expirePending
    assignments.controller.ts / assignments.module.ts NEW
  theses/thesis-access.policy.ts       MOD  jurorAccessLevel()
  theses/theses.service.ts             MOD  juror access, findManyByIds
  theses/theses.controller.ts          MOD  juror roles on GET :id and manuscript download
  theses/theses.module.ts              MOD  registers Assignment model
  app.module.ts                        MOD

server/test/
  utils/test-app.ts                    MOD  external-only users without password, signedAgent, createExternalJuror, createAssignableThesis, assignJury
  settings / assignments / responses / replace / external-access e2e specs NEW
  rbac.e2e-spec.ts, manuscripts.e2e-spec.ts, users.e2e-spec.ts MOD
```

Commands (from `server/`): `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm build`, `pnpm format`.

---

### Task 1: Shared enums, error codes and external-juror password rules

**Files:**
- Create: `shared/src/assignments.ts`
- Modify: `shared/src/roles.ts`, `shared/src/error-codes.ts`, `shared/src/index.ts`
- Modify: `server/src/config/env.validation.ts`, `server/.env.example`
- Create: `server/src/users/dto/external-juror.dto.ts`
- Modify: `server/src/users/users.service.ts`, `server/src/auth/auth.service.ts`
- Modify: `server/test/utils/test-app.ts`, `server/test/users.e2e-spec.ts`, `server/test/auth.e2e-spec.ts`, `server/test/rbac.e2e-spec.ts`

- [ ] **Step 1: Shared additions**

`shared/src/assignments.ts`:
```ts
export enum AssignmentStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  REPLACED = 'REPLACED',
}

export enum AssignmentType {
  PRIMARY = 'PRIMARY',
  TIEBREAKER = 'TIEBREAKER',
}

/** Statuses that occupy a jury slot. */
export const ACTIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  AssignmentStatus.PENDING,
  AssignmentStatus.ACCEPTED,
];

/** Reasons a proposed jury is rejected (RF-C13, RN-01, RF-C14). Sent in details.violations. */
export enum JuryViolation {
  JUROR_COUNT = 'JUROR_COUNT',
  JUROR_DUPLICATE = 'JUROR_DUPLICATE',
  JUROR_NOT_FOUND = 'JUROR_NOT_FOUND',
  JUROR_INACTIVE = 'JUROR_INACTIVE',
  JUROR_NOT_FACULTY = 'JUROR_NOT_FACULTY',
  JUROR_CONFLICT_OF_INTEREST = 'JUROR_CONFLICT_OF_INTEREST',
  JUROR_PREVIOUSLY_ASSIGNED = 'JUROR_PREVIOUSLY_ASSIGNED',
  JUROR_EMAIL_TAKEN = 'JUROR_EMAIL_TAKEN',
  JUROR_UNICORDOBA_REQUIRED = 'JUROR_UNICORDOBA_REQUIRED',
}
```

Append to `shared/src/roles.ts`:
```ts
/** External jurors authenticate only with the RF-J14 token, never with a password. */
export const isExternalOnly = (roles: readonly Role[]): boolean =>
  roles.length > 0 && roles.every((r) => r === Role.EXTERNAL_JUROR);
```

Add to `ErrorCode` in `shared/src/error-codes.ts`:
- in the auth block: `AUTH_EXTERNAL_TOKEN_INVALID = 'AUTH_EXTERNAL_TOKEN_INVALID',`
- in the users block: `USER_PASSWORD_NOT_ALLOWED = 'USER_PASSWORD_NOT_ALLOWED',`
- in the theses block: `THESIS_MANUSCRIPT_REQUIRED = 'THESIS_MANUSCRIPT_REQUIRED',`
- a new block:
```ts
  // assignments
  ASSIGNMENT_NOT_FOUND = 'ASSIGNMENT_NOT_FOUND',
  ASSIGNMENT_INVALID_COMPOSITION = 'ASSIGNMENT_INVALID_COMPOSITION',
  ASSIGNMENT_THESIS_STATUS = 'ASSIGNMENT_THESIS_STATUS',
  ASSIGNMENT_CONFLICT = 'ASSIGNMENT_CONFLICT',
  ASSIGNMENT_NOT_PENDING = 'ASSIGNMENT_NOT_PENDING',
  ASSIGNMENT_DEADLINE_PASSED = 'ASSIGNMENT_DEADLINE_PASSED',
  ASSIGNMENT_NOT_REPLACEABLE = 'ASSIGNMENT_NOT_REPLACEABLE',
  ASSIGNMENT_NOT_EXTERNAL = 'ASSIGNMENT_NOT_EXTERNAL',
```
Add `export * from './assignments';` to `shared/src/index.ts`. Run `pnpm --filter @thesis/shared build`.

- [ ] **Step 2: Env vars**

In `server/src/config/env.validation.ts` add:
```ts
  /** RF-J14 link lifetime. */
  EXTERNAL_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(365).default(60),
  /** Access-cookie lifetime of an external-juror session (no refresh token). */
  EXTERNAL_SESSION_TTL_SECONDS: Joi.number().integer().min(300).max(86_400).default(14_400),
```
Add both keys with those defaults to `server/.env.example` (never touch `server/.env`). Add a case to `server/src/config/env.validation.spec.ts` asserting the defaults (60 and 14400) when absent.

- [ ] **Step 3: Failing e2e tests for the password rules**

Append to `server/test/users.e2e-spec.ts` (inside the top-level `describe`):
```ts
  it('rejects a password for an external-only juror', async () => {
    const res = await admin
      .post('/api/users')
      .send({
        email: 'ext.pass@uni.example.org',
        password: TEST_PASSWORD,
        firstName: 'Eva',
        lastName: 'Rojas',
        roles: [Role.EXTERNAL_JUROR],
        jurorProfile: { institution: 'Universidad de Chile', isUnicordoba: false },
      })
      .expect(400);
    expect(res.body.code).toBe('USER_PASSWORD_NOT_ALLOWED');
  });

  it('removes the password when a user becomes external-only', async () => {
    const juror = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    await admin
      .patch(`/api/users/${juror.id as string}`)
      .send({ roles: [Role.EXTERNAL_JUROR] })
      .expect(200);
    await request(http(app))
      .post('/api/auth/login')
      .send({ email: juror.email, password: TEST_PASSWORD })
      .expect(401);
  });
```

Append to `server/test/auth.e2e-spec.ts`:
```ts
  it('refuses password login for an external-only user even with a legacy hash', async () => {
    const ext = await createUser(app, { roles: [Role.EXTERNAL_JUROR] });
    // Simulate data created before the rule existed.
    await app
      .get<Model<User>>(getModelToken(User.name))
      .updateOne({ _id: ext._id }, { passwordHash: await hashPassword(TEST_PASSWORD) });
    const res = await request(http(app))
      .post('/api/auth/login')
      .send({ email: ext.email, password: TEST_PASSWORD })
      .expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
```
(imports as needed: `getModelToken` from `@nestjs/mongoose`, `Model` from `mongoose`, `User` from `../src/users/schemas/user.schema`, `hashPassword` from `../src/common/security/password`.)

Run: `pnpm test:e2e -- users auth` → the new tests FAIL.

- [ ] **Step 4: External juror DTO and UsersService changes**

`server/src/users/dto/external-juror.dto.ts`:
```ts
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** RF-C14: external juror created inline during assignment (no password, token access). */
export class NewExternalJurorDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  institution!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  highestDegree!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country!: string;
}
```

In `server/src/users/users.service.ts` (import `isExternalOnly` from `@thesis/shared`, `NewExternalJurorDto`):
1. In `create()`, before the email check:
```ts
    if (dto.password && isExternalOnly(dto.roles)) {
      throw new AppException(
        ErrorCode.USER_PASSWORD_NOT_ALLOWED,
        HttpStatus.BAD_REQUEST,
        'External jurors use token access and cannot have a password',
      );
    }
```
2. In `assertRoleInvariants`, replace the local `isExternalOnly` computation with the shared `isExternalOnly(roles)`.
3. In `update()`, replace the `findByIdAndUpdate(id, dto, …)` call's update argument with
```ts
      isExternalOnly(roles)
        ? { $set: dto, $unset: { passwordHash: 1 } }
        : dto,
```
   and add a comment: `// A user turned external-only loses password login (RF-J14 token access only).`
4. Add:
```ts
  /** RF-C14: external juror created during CU-01 or a replacement. */
  createExternalJuror(dto: NewExternalJurorDto): Promise<UserDocument> {
    return this.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roles: [Role.EXTERNAL_JUROR],
      jurorProfile: {
        institution: dto.institution,
        isUnicordoba: false,
        highestDegree: dto.highestDegree,
        country: dto.country,
      },
    });
  }

  findManyByEmails(emails: readonly string[]): Promise<UserDocument[]> {
    return this.model
      .find({ email: { $in: emails.map((e) => e.toLowerCase()) } })
      .exec();
  }

  /** Only for compensating a failed multi-step write (e.g. CU-01 inline jurors). */
  async deleteByIds(ids: readonly string[]): Promise<void> {
    await this.model.deleteMany({ _id: { $in: ids } }).exec();
  }
```

In `server/src/auth/auth.service.ts` `login()`, change the credential check to
```ts
    // External-only users never log in with a password (RF-J14), even with a legacy hash.
    if (!user || !valid || isExternalOnly(user.roles)) {
```
(import `isExternalOnly` from `@thesis/shared`).

- [ ] **Step 5: Test helpers**

In `server/test/utils/test-app.ts`:
- `createUser`: use `password: isExternalOnly(data.roles) ? undefined : TEST_PASSWORD,` (import `isExternalOnly`).
- Add (imports: `JwtService` from `@nestjs/jwt`, `ConfigService` from `@nestjs/config`, `Role` from `@thesis/shared`, `NewExternalJurorDto`):
```ts
/** Agent authenticated with a directly signed access token (e.g. external jurors, scoped sessions). */
export async function signedAgent(
  app: INestApplication,
  user: { id: unknown; email: string; roles: Role[] },
  scope?: { assignmentIds: string[] },
): Promise<TestAgent> {
  const token = await app.get(JwtService).signAsync(
    { sub: String(user.id), email: user.email, roles: user.roles, scope },
    { secret: app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: 900 },
  );
  return request.agent(http(app)).set('Authorization', `Bearer ${token}`) as unknown as TestAgent;
}

export function createExternalJuror(
  app: INestApplication,
  data: Partial<NewExternalJurorDto> = {},
): Promise<UserDocument> {
  return app.get(UsersService).createExternalJuror({
    email: `ext.${randomUUID().slice(0, 8)}@uni.example.org`,
    firstName: 'Elena',
    lastName: 'Externa',
    institution: 'Universidad Nacional de La Plata',
    highestDegree: 'Doctorado',
    country: 'Argentina',
    ...data,
  });
}
```
- In `server/test/rbac.e2e-spec.ts`, build the `EXTERNAL_JUROR` agent with `signedAgent(app, user)` instead of `loginAgent` (keep `loginAgent` for the other roles).
- Check every other `EXTERNAL_JUROR` usage in `server/test/*.ts` (`grep -n EXTERNAL_JUROR server/test`) and adjust any test that sends a password for an external-only user or logs one in with a password.

- [ ] **Step 6: Verify and commit**

Run `pnpm test && pnpm test:e2e && pnpm lint && pnpm build` → green.
```bash
git add shared server
git commit -m "feat: assignment enums and codes; external jurors never have a password

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Business-day calendar and settings module

**Files:**
- Create: `server/src/common/time/business-days.ts` (+ `.spec.ts`)
- Create: `server/src/settings/schemas/settings.schema.ts`, `server/src/settings/dto/update-settings.dto.ts`, `settings.service.ts`, `settings.controller.ts`, `settings.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/settings.e2e-spec.ts`

- [ ] **Step 1: Failing unit tests**

`server/src/common/time/business-days.spec.ts`:
```ts
import {
  addBusinessDays,
  businessDaysRemaining,
  calendarDaysBetween,
  isBusinessDay,
  localDateKey,
} from './business-days';

const NONE = new Set<string>();
// 2026-11-18 is a Wednesday; 12:00 in Bogotá is 17:00Z.
const WED_NOON = new Date('2026-11-18T17:00:00Z');

describe('business days (America/Bogotá, UTC−5)', () => {
  it('uses the Bogotá calendar date, not the UTC one', () => {
    expect(localDateKey(new Date('2026-11-19T03:00:00Z'))).toBe('2026-11-18');
    expect(localDateKey(new Date('2026-11-19T05:00:00Z'))).toBe('2026-11-19');
  });

  it('weekends and holidays are not business days', () => {
    expect(isBusinessDay('2026-11-21', NONE)).toBe(false); // Saturday
    expect(isBusinessDay('2026-11-22', NONE)).toBe(false); // Sunday
    expect(isBusinessDay('2026-11-23', new Set(['2026-11-23']))).toBe(false);
    expect(isBusinessDay('2026-11-23', NONE)).toBe(true);
  });

  it('deadline = end of the N-th business day after the start day', () => {
    // Thu 19, Fri 20, Mon 23 … Mon 30 → end of Mon 30 Bogotá.
    expect(addBusinessDays(WED_NOON, 8, NONE).toISOString()).toBe('2026-12-01T04:59:59.999Z');
    expect(addBusinessDays(WED_NOON, 8, new Set(['2026-11-23'])).toISOString()).toBe(
      '2026-12-02T04:59:59.999Z',
    );
    // Late Wednesday evening in Bogotá is already Thursday in UTC.
    expect(addBusinessDays(new Date('2026-11-19T03:00:00Z'), 1, NONE).toISOString()).toBe(
      '2026-11-20T04:59:59.999Z',
    );
    // From a Friday, one business day is the next Monday.
    expect(addBusinessDays(new Date('2026-11-20T15:00:00Z'), 1, NONE).toISOString()).toBe(
      '2026-11-24T04:59:59.999Z',
    );
  });

  it('counts remaining business days in (today, deadline day]', () => {
    const deadline = addBusinessDays(WED_NOON, 8, NONE);
    expect(businessDaysRemaining(WED_NOON, deadline, NONE)).toBe(8);
    expect(businessDaysRemaining(new Date('2026-11-27T15:00:00Z'), deadline, NONE)).toBe(1);
    expect(businessDaysRemaining(new Date('2026-11-30T15:00:00Z'), deadline, NONE)).toBe(0);
    expect(businessDaysRemaining(new Date('2026-12-01T05:00:00Z'), deadline, NONE)).toBe(0);
  });

  it('counts calendar days between Bogotá dates', () => {
    expect(calendarDaysBetween(WED_NOON, new Date('2026-11-21T02:00:00Z'))).toBe(2);
    expect(calendarDaysBetween(WED_NOON, WED_NOON)).toBe(0);
  });
});
```
Run `pnpm test -- business-days` → FAIL.

- [ ] **Step 2: Implementation**

`server/src/common/time/business-days.ts`:
```ts
/**
 * Business-day calendar on America/Bogotá time (UTC−5, no daylight saving).
 * Dates are handled as 'YYYY-MM-DD' keys of the Bogotá calendar.
 */
export type DateKey = string;

const OFFSET_MS = -5 * 3_600_000;
const DAY_MS = 86_400_000;

const keyToUtcMidnight = (key: DateKey): number => Date.parse(`${key}T00:00:00.000Z`);
const nextKey = (key: DateKey): DateKey =>
  new Date(keyToUtcMidnight(key) + DAY_MS).toISOString().slice(0, 10);

export function localDateKey(date: Date): DateKey {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function isBusinessDay(key: DateKey, holidays: ReadonlySet<string>): boolean {
  const weekday = new Date(keyToUtcMidnight(key)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(key);
}

/** 23:59:59.999 Bogotá of the given local date. */
export function endOfLocalDay(key: DateKey): Date {
  return new Date(keyToUtcMidnight(key) + DAY_MS - 1 - OFFSET_MS);
}

/** End of the n-th business day after `from`'s local date (the start day itself never counts). */
export function addBusinessDays(from: Date, n: number, holidays: ReadonlySet<string>): Date {
  let key = localDateKey(from);
  let counted = 0;
  while (counted < n) {
    key = nextKey(key);
    if (isBusinessDay(key, holidays)) counted++;
  }
  return endOfLocalDay(key);
}

/** Business days in (today, deadline day]; 0 on the deadline day and after it. */
export function businessDaysRemaining(now: Date, deadline: Date, holidays: ReadonlySet<string>): number {
  if (deadline.getTime() < now.getTime()) return 0;
  const end = localDateKey(deadline);
  let key = localDateKey(now);
  let count = 0;
  while (key < end) {
    key = nextKey(key);
    if (isBusinessDay(key, holidays)) count++;
  }
  return count;
}

export function calendarDaysBetween(from: Date, to: Date): number {
  const diff = keyToUtcMidnight(localDateKey(to)) - keyToUtcMidnight(localDateKey(from));
  return Math.max(0, Math.round(diff / DAY_MS));
}
```
Run `pnpm test -- business-days` → PASS.

- [ ] **Step 3: Failing settings e2e**

`server/test/settings.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import { closeTestApp, createTestApp, createUser, loginAgent, TestAgent } from './utils/test-app';

describe('Settings (e2e)', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAgent(app, (await createUser(app, { roles: [Role.ADMIN] })).email);
    coordinator = await loginAgent(app, (await createUser(app, { roles: [Role.COORDINATOR] })).email);
  });
  afterAll(() => closeTestApp(app));

  it('returns the defaults to admin and coordinator', async () => {
    const res = await coordinator.get('/api/settings').expect(200);
    expect(res.body).toMatchObject({
      acceptanceBusinessDays: 8,
      evaluationBusinessDays: 20,
      unseenConceptAlertDays: 3,
      holidays: [],
      thesisCodePrefix: 'MIETIA',
    });
    await admin.get('/api/settings').expect(200);
  });

  it('admin updates deadlines and holidays; coordinator cannot', async () => {
    const res = await admin
      .patch('/api/settings')
      .send({ acceptanceBusinessDays: 5, holidays: ['2026-12-08', '2026-12-25'] })
      .expect(200);
    expect(res.body).toMatchObject({ acceptanceBusinessDays: 5, evaluationBusinessDays: 20, holidays: ['2026-12-08', '2026-12-25'] });
    await coordinator.patch('/api/settings').send({ acceptanceBusinessDays: 3 }).expect(403);
  });

  it.each([
    [{ acceptanceBusinessDays: 0 }],
    [{ evaluationBusinessDays: 500 }],
    [{ holidays: ['08/12/2026'] }],
    [{ holidays: ['2026-12-08', '2026-12-08'] }],
    [{ acceptanceBusinessDays: null }],
  ])('rejects invalid input %j', async (body) => {
    await admin.patch('/api/settings').send(body).expect(400);
  });
});
```
Run → FAIL.

- [ ] **Step 4: Settings module**

`server/src/settings/schemas/settings.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

export const SETTINGS_ID = 'global';

/** Singleton document with global deadlines and the holiday calendar (spec §5). */
@Schema({ collection: 'settings', timestamps: true })
export class Settings {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 8, min: 1, max: 60 })
  acceptanceBusinessDays!: number;

  @Prop({ required: true, default: 20, min: 1, max: 120 })
  evaluationBusinessDays!: number;

  @Prop({ required: true, default: 3, min: 1, max: 60 })
  unseenConceptAlertDays!: number;

  /** 'YYYY-MM-DD' dates of the Bogotá calendar excluded from business days. */
  @Prop({ type: [String], default: [] })
  holidays!: string[];

  @Prop({ required: true, default: 'MIETIA', maxlength: 20 })
  thesisCodePrefix!: string;
}

export type SettingsDocument = HydratedDocument<Settings>;
export const SettingsSchema = applyJsonTransform(SchemaFactory.createForClass(Settings));
```

`server/src/settings/dto/update-settings.dto.ts`:
```ts
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, Matches, Max, Min } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class UpdateSettingsDto {
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(60)
  acceptanceBusinessDays?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(120)
  evaluationBusinessDays?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(60)
  unseenConceptAlertDays?: number;

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { each: true })
  holidays?: string[];
}
```

`server/src/settings/settings.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Settings, SETTINGS_ID, SettingsDocument } from './schemas/settings.schema';

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

@Injectable()
export class SettingsService {
  constructor(@InjectModel(Settings.name) private readonly model: Model<Settings>) {}

  /** The singleton, created with schema defaults on first use. */
  async get(): Promise<SettingsDocument> {
    const existing = await this.model.findById(SETTINGS_ID).exec();
    if (existing) return existing;
    try {
      return await this.model.create({ _id: SETTINGS_ID });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      return (await this.model.findById(SETTINGS_ID).exec())!;
    }
  }

  async holidaySet(): Promise<Set<string>> {
    return new Set((await this.get()).holidays);
  }

  async update(dto: UpdateSettingsDto): Promise<SettingsDocument> {
    await this.get();
    const $set = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    return (await this.model
      .findByIdAndUpdate(SETTINGS_ID, { $set }, { new: true, runValidators: true })
      .exec())!;
  }
}
```

`server/src/settings/settings.controller.ts`:
```ts
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.COORDINATOR)
  get() {
    return this.settings.get();
  }

  @Patch()
  @Roles(Role.ADMIN)
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }
}
```

`server/src/settings/settings.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Settings, SettingsSchema } from './schemas/settings.schema';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Settings.name, schema: SettingsSchema }])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
```
Add `SettingsModule` to `server/src/app.module.ts`.

- [ ] **Step 5: Verify and commit**

`pnpm test:e2e -- settings` → PASS; full suite + lint + build green.
```bash
git add server
git commit -m "feat(server): Bogotá business-day calendar and settings module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Assignment schema and pure rules (jury, view, access, token)

**Files:**
- Create: `server/src/assignments/schemas/assignment.schema.ts`
- Create: `server/src/assignments/jury.rules.ts` (+ spec), `assignment-view.ts` (+ spec), `assignment-access.policy.ts` (+ spec), `external-token.ts` (+ spec), `assignment.events.ts`
- Modify: `server/src/theses/thesis-access.policy.ts` (+ spec)

- [ ] **Step 1: Schema**

`server/src/assignments/schemas/assignment.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AssignmentStatus, AssignmentType } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ timestamps: true })
export class Assignment {
  @Prop({ type: ObjectId, ref: 'Thesis', required: true })
  thesisId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  jurorId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AssignmentType), required: true, default: AssignmentType.PRIMARY })
  type!: AssignmentType;

  /** 1 and 2 = primary jurors, 3 = tiebreaker (stage 5). */
  @Prop({ required: true, min: 1, max: 3 })
  slot!: number;

  @Prop({ type: String, enum: Object.values(AssignmentStatus), required: true, default: AssignmentStatus.PENDING })
  status!: AssignmentStatus;

  /** true while PENDING or ACCEPTED; backs the partial unique indexes below. */
  @Prop({ required: true, default: true })
  isActive!: boolean;

  @Prop({ required: true })
  assignedAt!: Date;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  assignedBy!: Types.ObjectId;

  @Prop({ required: true })
  responseDeadline!: Date;

  @Prop()
  respondedAt?: Date;

  @Prop({ maxlength: 500 })
  declineReason?: string;

  /** Set when the juror accepts (evaluationBusinessDays). */
  @Prop()
  evaluationDeadline?: Date;

  /** The assignment that took this slot after a decline, expiry or replacement. */
  @Prop({ type: ObjectId, ref: 'Assignment' })
  replacedById?: Types.ObjectId;

  /** SHA-256 of the RF-J14 token; the token itself is never stored. */
  @Prop({ select: false })
  externalTokenHash?: string;

  @Prop()
  externalTokenExpiresAt?: Date;

  @Prop()
  seedTag?: string;
}

export type AssignmentDocument = HydratedDocument<Assignment>;
export const AssignmentSchema = applyJsonTransform(SchemaFactory.createForClass(Assignment), ['externalTokenHash']);
AssignmentSchema.index({ thesisId: 1, slot: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
AssignmentSchema.index({ thesisId: 1, jurorId: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
AssignmentSchema.index({ jurorId: 1, status: 1 });
AssignmentSchema.index({ status: 1, responseDeadline: 1 });
AssignmentSchema.index(
  { externalTokenHash: 1 },
  { unique: true, partialFilterExpression: { externalTokenHash: { $exists: true } } },
);
AssignmentSchema.index({ seedTag: 1 });
```
(`{thesisId:1}` queries are served by the two compound indexes that start with `thesisId`.)

- [ ] **Step 2: Failing unit tests**

`server/src/assignments/jury.rules.spec.ts`:
```ts
import { JuryViolation as V, Role } from '@thesis/shared';
import { JurorCandidate, validateJury } from './jury.rules';

const parties = {
  studentId: 's1',
  advisorId: 'adv',
  coAdvisorIds: ['co1'],
  conflictOfInterestUserIds: ['coi'],
};
const internal = (slot: number, userId: string, isUnicordoba = true): JurorCandidate => ({
  slot,
  key: userId,
  userId,
  user: { isActive: true, roles: [Role.INTERNAL_JUROR], isUnicordoba },
});
const newExternal = (slot: number, email: string, emailTaken = false): JurorCandidate => ({
  slot,
  key: `new:${email}`,
  newExternal: { emailTaken },
});
const check = (candidates: JurorCandidate[], extra: Partial<Parameters<typeof validateJury>[0]> = {}) =>
  validateJury({ candidates, parties, previousJurorIds: new Set(), required: 2, requireUnicordoba: true, ...extra });

describe('validateJury (RF-C13, RN-01, RF-C14)', () => {
  it('accepts one Unicórdoba juror plus a new external juror', () => {
    expect(check([internal(1, 'j1'), newExternal(2, 'x@uni.org')])).toEqual([]);
  });

  it('requires exactly the expected number of jurors', () => {
    expect(check([internal(1, 'j1')])).toEqual([{ code: V.JUROR_COUNT }]);
  });

  it('rejects duplicates by user and by new email', () => {
    expect(check([internal(1, 'j1'), internal(2, 'j1')])).toContainEqual({ code: V.JUROR_DUPLICATE, slot: 2 });
    expect(check([internal(1, 'j1'), newExternal(2, 'a@b.co'), newExternal(3, 'a@b.co')], { required: 3 })).toContainEqual({
      code: V.JUROR_DUPLICATE,
      slot: 3,
    });
  });

  it.each(['s1', 'adv', 'co1', 'coi'])('flags %s as a conflict of interest (RN-01)', (id) => {
    expect(check([internal(1, 'j1'), internal(2, id)])).toContainEqual({ code: V.JUROR_CONFLICT_OF_INTEREST, slot: 2 });
  });

  it('flags missing, inactive and non-faculty users', () => {
    const missing: JurorCandidate = { slot: 2, key: 'gone', userId: 'gone' };
    expect(check([internal(1, 'j1'), missing])).toContainEqual({ code: V.JUROR_NOT_FOUND, slot: 2 });
    const inactive = { ...internal(2, 'j2'), user: { isActive: false, roles: [Role.INTERNAL_JUROR], isUnicordoba: false } };
    expect(check([internal(1, 'j1'), inactive])).toContainEqual({ code: V.JUROR_INACTIVE, slot: 2 });
    const student = { ...internal(2, 'st'), user: { isActive: true, roles: [Role.STUDENT], isUnicordoba: false } };
    expect(check([internal(1, 'j1'), student])).toContainEqual({ code: V.JUROR_NOT_FACULTY, slot: 2 });
  });

  it('requires at least one Unicórdoba juror (RF-C13)', () => {
    expect(check([internal(1, 'j1', false), newExternal(2, 'x@uni.org')])).toEqual([{ code: V.JUROR_UNICORDOBA_REQUIRED }]);
  });

  it('flags previously assigned jurors and taken emails', () => {
    expect(check([internal(1, 'j1'), internal(2, 'j2')], { previousJurorIds: new Set(['j2']) })).toContainEqual({
      code: V.JUROR_PREVIOUSLY_ASSIGNED,
      slot: 2,
    });
    expect(check([internal(1, 'j1'), newExternal(2, 'x@uni.org', true)])).toContainEqual({ code: V.JUROR_EMAIL_TAKEN, slot: 2 });
  });

  it('kept jurors skip per-juror checks but count for composition', () => {
    const kept = { ...internal(1, 'j1'), keep: true };
    expect(check([kept, internal(2, 'j2', false)], { previousJurorIds: new Set(['j1']) })).toEqual([]);
    const keptExternal = { ...internal(1, 'e1', false), keep: true };
    expect(check([keptExternal, newExternal(2, 'n@uni.org')])).toEqual([{ code: V.JUROR_UNICORDOBA_REQUIRED }]);
  });

  it('skips RF-C13 when the jury is still incomplete (replacement of one slot)', () => {
    expect(check([newExternal(1, 'n@uni.org')], { required: 1, requireUnicordoba: false })).toEqual([]);
  });
});
```

`server/src/assignments/assignment-view.spec.ts`:
```ts
import { AssignmentStatus, AssignmentType } from '@thesis/shared';
import { Types } from 'mongoose';
import { addBusinessDays } from '../common/time/business-days';
import { toAssignmentView } from './assignment-view';

const NONE = new Set<string>();
const assignedAt = new Date('2026-11-18T17:00:00Z');
const base = {
  id: new Types.ObjectId().toHexString(),
  thesisId: new Types.ObjectId(),
  jurorId: new Types.ObjectId(),
  type: AssignmentType.PRIMARY,
  slot: 1,
  status: AssignmentStatus.PENDING,
  assignedAt,
  responseDeadline: addBusinessDays(assignedAt, 8, NONE),
};

describe('toAssignmentView (sugerencia 8 countdown)', () => {
  it('shows the response countdown while pending', () => {
    const now = new Date('2026-11-20T15:00:00Z');
    expect(toAssignmentView(base, now, NONE)).toMatchObject({
      id: base.id,
      thesisId: base.thesisId.toHexString(),
      jurorId: base.jurorId.toHexString(),
      daysSinceAssigned: 2,
      responseDaysRemaining: 6,
      evaluationDaysRemaining: null,
      isResponseOverdue: false,
      hasExternalLink: false,
    });
  });

  it('marks an overdue pending response', () => {
    const view = toAssignmentView(base, new Date('2026-12-02T15:00:00Z'), NONE);
    expect(view).toMatchObject({ responseDaysRemaining: 0, isResponseOverdue: true });
  });

  it('switches to the evaluation countdown once accepted', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    const view = toAssignmentView(
      { ...base, status: AssignmentStatus.ACCEPTED, respondedAt: now, evaluationDeadline: addBusinessDays(now, 20, NONE) },
      now,
      NONE,
    );
    expect(view).toMatchObject({ responseDaysRemaining: null, evaluationDaysRemaining: 20, isResponseOverdue: false });
  });

  it('reports a live external link only before it expires', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    expect(toAssignmentView({ ...base, externalTokenExpiresAt: new Date('2027-01-01') }, now, NONE).hasExternalLink).toBe(true);
    expect(toAssignmentView({ ...base, externalTokenExpiresAt: new Date('2026-11-01') }, now, NONE).hasExternalLink).toBe(false);
  });
});
```

`server/src/assignments/assignment-access.policy.spec.ts`:
```ts
import { Role } from '@thesis/shared';
import { Types } from 'mongoose';
import { canViewAssignment, isAssignmentOwner } from './assignment-access.policy';

describe('assignment access', () => {
  const jurorId = new Types.ObjectId();
  const a = { id: new Types.ObjectId().toHexString(), jurorId };
  const juror = { id: jurorId.toHexString(), email: 'j@x.co', roles: [Role.INTERNAL_JUROR] };

  it('the assigned juror owns it; others do not', () => {
    expect(isAssignmentOwner(juror, a)).toBe(true);
    expect(isAssignmentOwner({ ...juror, id: new Types.ObjectId().toHexString() }, a)).toBe(false);
  });

  it('a scoped session owns only assignments in its scope', () => {
    expect(isAssignmentOwner({ ...juror, scope: { assignmentIds: [a.id] } }, a)).toBe(true);
    expect(isAssignmentOwner({ ...juror, scope: { assignmentIds: ['other'] } }, a)).toBe(false);
  });

  it('coordinators and admins can view any assignment', () => {
    const coordinator = { id: 'c', email: 'c@x.co', roles: [Role.COORDINATOR] };
    expect(canViewAssignment(coordinator, a)).toBe(true);
    expect(canViewAssignment({ ...coordinator, roles: [Role.ADMIN] }, a)).toBe(true);
    expect(canViewAssignment({ ...coordinator, roles: [Role.STUDENT] }, a)).toBe(false);
  });
});
```

`server/src/assignments/external-token.spec.ts`:
```ts
import { sha256 } from '../common/security/hash';
import { externalAccessUrl, newExternalToken } from './external-token';

describe('external token (RF-J14)', () => {
  it('creates a 32-byte base64url token and returns only its hash for storage', () => {
    const { token, hash } = newExternalToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(sha256(token));
    expect(newExternalToken().token).not.toBe(token);
  });

  it('builds the client link', () => {
    expect(externalAccessUrl('http://localhost:3000', 'abc_-1')).toBe(
      'http://localhost:3000/auth/external-access?token=abc_-1',
    );
  });
});
```

Append to `server/src/theses/thesis-access.policy.spec.ts`:
```ts
describe('jurorAccessLevel', () => {
  it('pending gives metadata, accepted gives the manuscript, others nothing', () => {
    expect(jurorAccessLevel([])).toBe('NONE');
    expect(jurorAccessLevel([AssignmentStatus.DECLINED, AssignmentStatus.REPLACED])).toBe('NONE');
    expect(jurorAccessLevel([AssignmentStatus.PENDING])).toBe('METADATA');
    expect(jurorAccessLevel([AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED])).toBe('MANUSCRIPT');
  });
});
```
(import `jurorAccessLevel` and `AssignmentStatus`.)

Run `pnpm test -- jury.rules assignment-view assignment-access external-token thesis-access` → FAIL.

- [ ] **Step 3: Implement the pure modules**

`server/src/assignments/jury.rules.ts`:
```ts
import { JUROR_ROLES, JuryViolation, Role } from '@thesis/shared';

export interface CandidateUser {
  isActive: boolean;
  roles: readonly Role[];
  isUnicordoba: boolean;
}

export interface JurorCandidate {
  slot: number;
  /** Lowercase user id, or `new:<email>` for a juror created inline. */
  key: string;
  userId?: string;
  /** Undefined when userId does not exist. */
  user?: CandidateUser;
  newExternal?: { emailTaken: boolean };
  /** Already on the jury (kept during a replacement): only composition rules apply. */
  keep?: boolean;
}

export interface ThesisParties {
  studentId: string;
  advisorId: string;
  coAdvisorIds: readonly string[];
  conflictOfInterestUserIds: readonly string[];
}

export interface JuryViolationItem {
  code: JuryViolation;
  slot?: number;
}

export interface JuryCheck {
  candidates: readonly JurorCandidate[];
  parties: ThesisParties;
  /** Every juror ever assigned to this thesis (declined, expired, replaced included). */
  previousJurorIds: ReadonlySet<string>;
  required: number;
  /** RF-C13 applies once the 2-juror jury is complete. */
  requireUnicordoba: boolean;
}

export function validateJury(check: JuryCheck): JuryViolationItem[] {
  const { candidates, parties, previousJurorIds, required, requireUnicordoba } = check;
  const violations: JuryViolationItem[] = [];
  if (candidates.length !== required) violations.push({ code: JuryViolation.JUROR_COUNT });

  const conflicted = new Set([
    parties.studentId,
    parties.advisorId,
    ...parties.coAdvisorIds,
    ...parties.conflictOfInterestUserIds,
  ]);
  const seen = new Set<string>();
  for (const c of candidates) {
    const flag = (code: JuryViolation) => violations.push({ code, slot: c.slot });
    if (seen.has(c.key)) {
      flag(JuryViolation.JUROR_DUPLICATE);
      continue;
    }
    seen.add(c.key);
    if (c.keep) continue;
    if (c.newExternal) {
      if (c.newExternal.emailTaken) flag(JuryViolation.JUROR_EMAIL_TAKEN);
      continue;
    }
    if (!c.user || !c.userId) {
      flag(JuryViolation.JUROR_NOT_FOUND);
      continue;
    }
    if (!c.user.isActive) flag(JuryViolation.JUROR_INACTIVE);
    if (!c.user.roles.some((r) => JUROR_ROLES.includes(r))) flag(JuryViolation.JUROR_NOT_FACULTY);
    if (conflicted.has(c.userId)) flag(JuryViolation.JUROR_CONFLICT_OF_INTEREST);
    if (previousJurorIds.has(c.userId)) flag(JuryViolation.JUROR_PREVIOUSLY_ASSIGNED);
  }

  const hasUnicordoba = candidates.some((c) => !c.newExternal && c.user?.isUnicordoba);
  if (requireUnicordoba && candidates.length === required && !hasUnicordoba) {
    violations.push({ code: JuryViolation.JUROR_UNICORDOBA_REQUIRED });
  }
  return violations;
}
```

`server/src/assignments/assignment-view.ts`:
```ts
import { AssignmentStatus, AssignmentType } from '@thesis/shared';
import type { Types } from 'mongoose';
import { businessDaysRemaining, calendarDaysBetween } from '../common/time/business-days';

export interface AssignmentLike {
  id: string;
  thesisId: Types.ObjectId;
  jurorId: Types.ObjectId;
  type: AssignmentType;
  slot: number;
  status: AssignmentStatus;
  assignedAt: Date;
  responseDeadline: Date;
  respondedAt?: Date;
  declineReason?: string;
  evaluationDeadline?: Date;
  replacedById?: Types.ObjectId;
  externalTokenExpiresAt?: Date;
}

export interface JurorSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  institution?: string;
  isUnicordoba?: boolean;
}

export interface ThesisSummary {
  id: string;
  code: string;
  title: string;
  abstract?: string;
  studentName: string;
  advisorName?: string;
  programId: string;
  status: string;
  progress: number;
}

export interface AssignmentView {
  id: string;
  thesisId: string;
  jurorId: string;
  type: AssignmentType;
  slot: number;
  status: AssignmentStatus;
  assignedAt: Date;
  responseDeadline: Date;
  respondedAt?: Date;
  declineReason?: string;
  evaluationDeadline?: Date;
  replacedById?: string;
  hasExternalLink: boolean;
  externalLinkExpiresAt?: Date;
  /** Sugerencia 8 countdown. */
  daysSinceAssigned: number;
  responseDaysRemaining: number | null;
  evaluationDaysRemaining: number | null;
  isResponseOverdue: boolean;
  juror?: JurorSummary;
  thesis?: ThesisSummary;
}

export function toAssignmentView(a: AssignmentLike, now: Date, holidays: ReadonlySet<string>): AssignmentView {
  const pending = a.status === AssignmentStatus.PENDING;
  const accepted = a.status === AssignmentStatus.ACCEPTED;
  return {
    id: a.id,
    thesisId: a.thesisId.toHexString(),
    jurorId: a.jurorId.toHexString(),
    type: a.type,
    slot: a.slot,
    status: a.status,
    assignedAt: a.assignedAt,
    responseDeadline: a.responseDeadline,
    respondedAt: a.respondedAt,
    declineReason: a.declineReason,
    evaluationDeadline: a.evaluationDeadline,
    replacedById: a.replacedById?.toHexString(),
    hasExternalLink: !!a.externalTokenExpiresAt && a.externalTokenExpiresAt > now,
    externalLinkExpiresAt: a.externalTokenExpiresAt,
    daysSinceAssigned: calendarDaysBetween(a.assignedAt, now),
    responseDaysRemaining: pending ? businessDaysRemaining(now, a.responseDeadline, holidays) : null,
    evaluationDaysRemaining:
      accepted && a.evaluationDeadline ? businessDaysRemaining(now, a.evaluationDeadline, holidays) : null,
    isResponseOverdue: pending && a.responseDeadline < now,
  };
}
```

`server/src/assignments/assignment-access.policy.ts`:
```ts
import { Role } from '@thesis/shared';
import type { Types } from 'mongoose';
import type { AuthUser } from '../common/types/auth-user';

/** The assigned juror; a scoped (external) session only for assignments in its scope. */
export function isAssignmentOwner(user: AuthUser, a: { id: string; jurorId: Types.ObjectId }): boolean {
  if (!a.jurorId.equals(user.id)) return false;
  return !user.scope || user.scope.assignmentIds.includes(a.id);
}

export function canViewAssignment(user: AuthUser, a: { id: string; jurorId: Types.ObjectId }): boolean {
  if (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.COORDINATOR)) return true;
  return isAssignmentOwner(user, a);
}
```

`server/src/assignments/external-token.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { sha256 } from '../common/security/hash';

/** RF-J14: random token for the link; only the hash is persisted. */
export function newExternalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function externalAccessUrl(clientUrl: string, token: string): string {
  const url = new URL('/auth/external-access', clientUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
```

`server/src/assignments/assignment.events.ts`:
```ts
export const ASSIGNMENT_EVENTS = {
  CREATED: 'assignment.created',
  ACCEPTED: 'assignment.accepted',
  DECLINED: 'assignment.declined',
  EXPIRED: 'assignment.expired',
  REPLACED: 'assignment.replaced',
} as const;

/** Consumed by notifications and audit (stage 7) — e.g. alert the coordinator on decline/expiry. */
export interface AssignmentEvent {
  assignmentId: string;
  thesisId: string;
  jurorId: string;
  actorId?: string;
  actorRole: string;
  reason?: string;
  at: Date;
}
```

Append to `server/src/theses/thesis-access.policy.ts`:
```ts
export type JurorAccess = 'NONE' | 'METADATA' | 'MANUSCRIPT';

/** RBAC: a juror sees the thesis once assigned and the manuscript only after accepting. */
export function jurorAccessLevel(statuses: readonly AssignmentStatus[]): JurorAccess {
  if (statuses.includes(AssignmentStatus.ACCEPTED)) return 'MANUSCRIPT';
  return statuses.includes(AssignmentStatus.PENDING) ? 'METADATA' : 'NONE';
}
```
(import `AssignmentStatus` from `@thesis/shared`.)

- [ ] **Step 4: Verify and commit**

`pnpm test` → PASS; lint + build green.
```bash
git add server
git commit -m "feat(server): assignment schema and pure jury, countdown, access and token rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CU-01 — assign the jury, live validation, list per thesis

**Files:**
- Create: `server/src/assignments/dto/juror-input.dto.ts`, `create-assignments.dto.ts`
- Create: `server/src/assignments/assignments.service.ts`, `assignments.controller.ts`, `assignments.module.ts`
- Modify: `server/src/theses/theses.service.ts` (add `findManyByIds`), `server/src/app.module.ts`
- Modify: `server/test/utils/test-app.ts`
- Test: `server/test/assignments.e2e-spec.ts`

- [ ] **Step 1: DTOs**

`server/src/assignments/dto/juror-input.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { NewExternalJurorDto } from '../../users/dto/external-juror.dto';

/** Exactly one of jurorId (existing faculty) or newExternal (RF-C14) — enforced in the service. */
export class JurorInputDto {
  @IsOptional()
  @IsMongoId()
  jurorId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewExternalJurorDto)
  newExternal?: NewExternalJurorDto;
}
```

`server/src/assignments/dto/create-assignments.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsMongoId, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { JurorInputDto } from './juror-input.dto';

export class CreateAssignmentsDto {
  /** Slot = position + 1. Exactly 2 are required (reported as JUROR_COUNT otherwise). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => JurorInputDto)
  jurors!: JurorInputDto[];

  /** Defaults to settings.acceptanceBusinessDays. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  responseBusinessDays?: number;
}

export class ValidateAssignmentsDto extends CreateAssignmentsDto {
  @IsMongoId()
  thesisId!: string;
}
```

- [ ] **Step 2: Test helpers**

Add to `server/test/utils/test-app.ts` (imports: `AssignmentsService` from `../../src/assignments/assignments.service`, `Types` from `mongoose`):
```ts
const SYSTEM_COORDINATOR = { id: new Types.ObjectId().toHexString(), email: 'coord@test.edu.co', roles: [Role.COORDINATOR] };

/** A SUBMITTED thesis with a manuscript (CU-01 preconditions). */
export async function createAssignableThesis(
  app: INestApplication,
  catalog?: CatalogFixture,
  data: { studentId?: string; advisorId?: string } = {},
): Promise<ThesisDocument> {
  const thesis = await createThesis(app, catalog ?? (await createCatalog(app)), data);
  return app.get(ThesesService).addManuscript(
    thesis.id as string,
    { buffer: PDF_BYTES, originalname: 'tesis.pdf', size: PDF_BYTES.length },
    SYSTEM_COORDINATOR,
  );
}

/** CU-01 through the service with existing jurors (slot = position + 1). */
export function assignJury(app: INestApplication, thesisId: string, jurorIds: string[]) {
  return app.get(AssignmentsService).assignJury(
    thesisId,
    { jurors: jurorIds.map((jurorId) => ({ jurorId })) },
    { id: SYSTEM_COORDINATOR.id, role: Role.COORDINATOR },
  );
}
```
(`PDF_BYTES` is declared earlier in the file; move these helpers below it.)

- [ ] **Step 3: Failing e2e test**

`server/test/assignments.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role, ThesisStatus } from '@thesis/shared';
import { Model } from 'mongoose';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import {
  CatalogFixture,
  closeTestApp,
  createAssignableThesis,
  createCatalog,
  createExternalJuror,
  createTestApp,
  createThesis,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Assignments — CU-01 (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let admin: TestAgent;
  let catalog: CatalogFixture;
  let unicor: UserDocument;
  let unicor2: UserDocument;
  let external: UserDocument;
  let assignments: Model<Assignment>;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(app, (await createUser(app, { roles: [Role.COORDINATOR] })).email);
    admin = await loginAgent(app, (await createUser(app, { roles: [Role.ADMIN] })).email);
    catalog = await createCatalog(app);
    unicor = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    unicor2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    external = await createExternalJuror(app);
    assignments = app.get(getModelToken(Assignment.name));
  });
  afterAll(() => closeTestApp(app));

  const assign = (thesisId: string, body: object) =>
    coordinator.post(`/api/theses/${thesisId}/assignments`).send(body);

  it('assigns a Unicórdoba juror and an external juror; thesis → JURORS_ASSIGNED', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const res = await assign(thesis.id as string, {
      jurors: [{ jurorId: unicor.id }, { jurorId: external.id }],
    }).expect(201);

    expect(res.body.assignments).toHaveLength(2);
    expect(res.body.assignments[0]).toMatchObject({
      slot: 1,
      jurorId: unicor.id,
      status: AssignmentStatus.PENDING,
      responseDaysRemaining: 8,
      daysSinceAssigned: 0,
      isResponseOverdue: false,
    });
    expect(res.body.externalLinks).toEqual([
      expect.objectContaining({
        assignmentId: res.body.assignments[1].id,
        url: expect.stringMatching(/\/auth\/external-access\?token=[A-Za-z0-9_-]{43}$/),
      }),
    ]);
    const after = await coordinator.get(`/api/theses/${thesis.id as string}`).expect(200);
    expect(after.body).toMatchObject({ status: ThesisStatus.JURORS_ASSIGNED, progress: 25 });
    expect(after.body.history.at(-1)).toMatchObject({ from: 'SUBMITTED', to: 'JURORS_ASSIGNED', reason: 'CU-01' });
  });

  it('creates an external juror inline without a password (RF-C14)', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const res = await assign(thesis.id as string, {
      jurors: [
        { jurorId: unicor.id },
        {
          newExternal: {
            email: 'Nuevo.Externo@uni.example.org',
            firstName: 'Nuevo',
            lastName: 'Externo',
            institution: 'Universidad de Chile',
            highestDegree: 'Doctorado',
            country: 'Chile',
          },
        },
      ],
    }).expect(201);
    const created = await app.get(UsersService).findByEmailWithPassword('nuevo.externo@uni.example.org');
    expect(created).toMatchObject({ roles: [Role.EXTERNAL_JUROR], jurorProfile: { isUnicordoba: false } });
    expect(created?.passwordHash).toBeUndefined();
    expect(res.body.assignments[1].jurorId).toBe(created?.id);
    expect(res.body.externalLinks).toHaveLength(1);
  });

  it.each([
    ['advisor as juror', (t: { advisorId: string }) => [{ jurorId: t.advisorId }, { jurorId: 'U' }], 'JUROR_CONFLICT_OF_INTEREST', 1],
    ['two non-Unicórdoba jurors', () => [{ jurorId: 'E' }, { newExternal: newExt('x1@uni.example.org') }], 'JUROR_UNICORDOBA_REQUIRED', undefined],
    ['a single juror', () => [{ jurorId: 'U' }], 'JUROR_COUNT', undefined],
    ['the same juror twice', () => [{ jurorId: 'U' }, { jurorId: 'U' }], 'JUROR_DUPLICATE', 2],
    ['an existing email as new external', () => [{ jurorId: 'U' }, { newExternal: newExt('EMAIL') }], 'JUROR_EMAIL_TAKEN', 2],
  ])('rejects %s with ASSIGNMENT_INVALID_COMPOSITION', async (_name, build, code, slot) => {
    const thesis = await createAssignableThesis(app, catalog);
    const jurors = build({ advisorId: thesis.advisorId.toHexString() }).map((j) => resolve(j));
    const res = await assign(thesis.id as string, { jurors }).expect(400);
    expect(res.body.code).toBe('ASSIGNMENT_INVALID_COMPOSITION');
    expect(res.body.details.violations).toContainEqual(slot ? { code, slot } : { code });
    expect(await assignments.countDocuments({ thesisId: thesis._id })).toBe(0);
  });

  it('rejects a juror who is a student (not faculty) and an inactive juror', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const student = await createUser(app, { roles: [Role.STUDENT] });
    const inactive = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    await app.get(UsersService).setActive(inactive.id as string, false, unicor.id as string);
    const res = await assign(thesis.id as string, { jurors: [{ jurorId: student.id }, { jurorId: inactive.id }] }).expect(400);
    expect(res.body.details.violations).toEqual(
      expect.arrayContaining([
        { code: 'JUROR_NOT_FACULTY', slot: 1 },
        { code: 'JUROR_INACTIVE', slot: 2 },
      ]),
    );
  });

  it('requires exactly one of jurorId or newExternal per entry', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    await assign(thesis.id as string, { jurors: [{}, { jurorId: unicor.id }] }).expect(400);
  });

  it('requires SUBMITTED and a manuscript', async () => {
    const noManuscript = await createThesis(app, catalog);
    const a = await assign(noManuscript.id as string, { jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }] }).expect(409);
    expect(a.body.code).toBe('THESIS_MANUSCRIPT_REQUIRED');

    const thesis = await createAssignableThesis(app, catalog);
    await assign(thesis.id as string, { jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }] }).expect(201);
    const b = await assign(thesis.id as string, { jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }] }).expect(409);
    expect(b.body.code).toBe('ASSIGNMENT_THESIS_STATUS');
  });

  it('honours a custom response window', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const res = await assign(thesis.id as string, {
      jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }],
      responseBusinessDays: 3,
    }).expect(201);
    expect(res.body.assignments[0].responseDaysRemaining).toBe(3);
  });

  it('two concurrent CU-01 requests create a single jury', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const body = { jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }] };
    const results = await Promise.all([assign(thesis.id as string, body), assign(thesis.id as string, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await assignments.countDocuments({ thesisId: thesis._id, isActive: true })).toBe(2);
  });

  describe('POST /assignments/validate', () => {
    it('reports violations without saving and valid=true for a correct jury', async () => {
      const thesis = await createAssignableThesis(app, catalog);
      const bad = await coordinator
        .post('/api/assignments/validate')
        .send({ thesisId: thesis.id, jurors: [{ jurorId: thesis.advisorId.toHexString() }, { jurorId: external.id }] })
        .expect(200);
      expect(bad.body.valid).toBe(false);
      expect(bad.body.violations).toEqual(
        expect.arrayContaining([{ code: 'JUROR_CONFLICT_OF_INTEREST', slot: 1 }, { code: 'JUROR_UNICORDOBA_REQUIRED' }]),
      );
      const good = await coordinator
        .post('/api/assignments/validate')
        .send({ thesisId: thesis.id, jurors: [{ jurorId: unicor.id }, { jurorId: external.id }] })
        .expect(200);
      expect(good.body).toEqual({ valid: true, violations: [] });
      expect(await assignments.countDocuments({ thesisId: thesis._id })).toBe(0);
    });
  });

  describe('GET /theses/:id/assignments', () => {
    it('lists the jury with juror summaries for coordinator and admin', async () => {
      const thesis = await createAssignableThesis(app, catalog);
      await assign(thesis.id as string, { jurors: [{ jurorId: unicor.id }, { jurorId: external.id }] }).expect(201);
      const res = await admin.get(`/api/theses/${thesis.id as string}/assignments`).expect(200);
      expect(res.body.map((a: { slot: number }) => a.slot)).toEqual([1, 2]);
      expect(res.body[0].juror).toMatchObject({ id: unicor.id, isUnicordoba: true });
      expect(res.body[1].juror).toMatchObject({ id: external.id, isUnicordoba: false });
      expect(res.body[1].hasExternalLink).toBe(true);
      expect(res.body[1].externalTokenHash).toBeUndefined();
    });
  });

  // ---- helpers for the table-driven cases ----
  function newExt(email: string) {
    return {
      email: email === 'EMAIL' ? unicor.email : email,
      firstName: 'X',
      lastName: 'Y',
      institution: 'Otra U',
      highestDegree: 'Maestría',
      country: 'Perú',
    };
  }
  function resolve(j: { jurorId?: string; newExternal?: object }) {
    if (j.jurorId === 'U') return { jurorId: unicor.id };
    if (j.jurorId === 'E') return { jurorId: external.id };
    return j;
  }
});
```
Run `pnpm test:e2e -- assignments` → FAIL.

- [ ] **Step 4: ThesesService.findManyByIds**

Add to `server/src/theses/theses.service.ts`:
```ts
  findManyByIds(ids: readonly string[]): Promise<ThesisDocument[]> {
    return this.model.find({ _id: { $in: ids.filter((id) => isValidObjectId(id)) } }).exec();
  }
```

- [ ] **Step 5: AssignmentsService (CU-01 part)**

`server/src/assignments/assignments.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  AssignmentStatus,
  AssignmentType,
  ErrorCode,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { isObjectIdOrHexString, Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { addBusinessDays } from '../common/time/business-days';
import type { Actor } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { SettingsService } from '../settings/settings.service';
import { ThesisDocument } from '../theses/schemas/thesis.schema';
import { ThesesService } from '../theses/theses.service';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { WorkflowService } from '../workflow/workflow.service';
import { canViewAssignment, isAssignmentOwner } from './assignment-access.policy';
import { AssignmentEvent, ASSIGNMENT_EVENTS } from './assignment.events';
import { AssignmentView, JurorSummary, ThesisSummary, toAssignmentView } from './assignment-view';
import { CreateAssignmentsDto, ValidateAssignmentsDto } from './dto/create-assignments.dto';
import { JurorInputDto } from './dto/juror-input.dto';
import { externalAccessUrl, newExternalToken } from './external-token';
import { CandidateUser, JurorCandidate, JuryViolationItem, ThesisParties, validateJury } from './jury.rules';
import { Assignment, AssignmentDocument } from './schemas/assignment.schema';

export interface ExternalLink {
  assignmentId: string;
  url: string;
  expiresAt: Date;
}

export interface JuryResult {
  assignments: AssignmentView[];
  externalLinks: ExternalLink[];
}

interface Created {
  assignmentIds: Types.ObjectId[];
  createdUserIds: string[];
}

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

export const assignmentNotFound = () =>
  new AppException(ErrorCode.ASSIGNMENT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Assignment not found');

const thesisStatusError = (status: ThesisStatus) =>
  new AppException(ErrorCode.ASSIGNMENT_THESIS_STATUS, HttpStatus.CONFLICT, `Not allowed while the thesis is ${status}`, {
    status,
  });

const partiesOf = (t: ThesisDocument): ThesisParties => ({
  studentId: t.studentId.toHexString(),
  advisorId: t.advisorId.toHexString(),
  coAdvisorIds: t.coAdvisorIds.map((x) => x.toHexString()),
  conflictOfInterestUserIds: t.conflictOfInterestUserIds.map((x) => x.toHexString()),
});

const candidateUser = (u: UserDocument): CandidateUser => ({
  isActive: u.isActive,
  roles: u.roles,
  isUnicordoba: !!u.jurorProfile?.isUnicordoba,
});

const jurorSummary = (u: UserDocument): JurorSummary => ({
  id: u.id as string,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  roles: u.roles,
  institution: u.jurorProfile?.institution,
  isUnicordoba: u.jurorProfile?.isUnicordoba,
});

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectModel(Assignment.name) private readonly model: Model<Assignment>,
    private readonly theses: ThesesService,
    private readonly users: UsersService,
    private readonly workflow: WorkflowService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- CU-01

  /** Live validation for the assignment form; saves nothing. */
  async validate(dto: ValidateAssignmentsDto): Promise<{ valid: boolean; violations: JuryViolationItem[] }> {
    const thesis = await this.theses.findById(dto.thesisId);
    const candidates = await this.resolveCandidates(dto.jurors, (i) => i + 1);
    const violations = validateJury({
      candidates,
      parties: partiesOf(thesis),
      previousJurorIds: await this.previousJurorIds(thesis._id),
      required: 2,
      requireUnicordoba: true,
    });
    return { valid: violations.length === 0, violations };
  }

  async assignJury(thesisId: string, dto: CreateAssignmentsDto, actor: Actor): Promise<JuryResult> {
    const thesis = await this.theses.findById(thesisId);
    if (thesis.status !== ThesisStatus.SUBMITTED) throw thesisStatusError(thesis.status);
    if (!thesis.currentManuscriptId) {
      throw new AppException(
        ErrorCode.THESIS_MANUSCRIPT_REQUIRED,
        HttpStatus.CONFLICT,
        'Upload the manuscript before assigning jurors',
      );
    }
    const candidates = await this.resolveCandidates(dto.jurors, (i) => i + 1);
    this.assertValid(
      validateJury({
        candidates,
        parties: partiesOf(thesis),
        previousJurorIds: await this.previousJurorIds(thesis._id),
        required: 2,
        requireUnicordoba: true,
      }),
    );

    const settings = await this.settings.get();
    const days = dto.responseBusinessDays ?? settings.acceptanceBusinessDays;
    const { docs, created } = await this.persist(
      thesis._id,
      dto.jurors.map((input, i) => ({ slot: i + 1, input })),
      days,
      new Set(settings.holidays),
      actor,
    );
    try {
      await this.workflow.transition({
        thesisId,
        expectedFrom: [ThesisStatus.SUBMITTED],
        to: ThesisStatus.JURORS_ASSIGNED,
        actor,
        reason: 'CU-01',
      });
    } catch (err) {
      await this.compensate(created);
      throw err;
    }
    for (const d of docs) this.emit(ASSIGNMENT_EVENTS.CREATED, d, actor);
    return {
      assignments: await this.views(docs, { withJuror: true }),
      externalLinks: await this.linksForExternalJurors(docs),
    };
  }

  async listForThesis(thesisId: string): Promise<AssignmentView[]> {
    const thesis = await this.theses.findById(thesisId);
    const docs = await this.model.find({ thesisId: thesis._id }).sort({ slot: 1, assignedAt: 1 }).exec();
    return this.views(docs, { withJuror: true });
  }

  // ---------------------------------------------------------------- shared helpers

  async findById(id: string): Promise<AssignmentDocument> {
    const doc = isObjectIdOrHexString(id) ? await this.model.findById(id).exec() : null;
    if (!doc) throw assignmentNotFound();
    return doc;
  }

  /** The assigned juror (and, for scoped sessions, only assignments in scope); 404 otherwise. */
  async findOwnedByJuror(id: string, user: AuthUser): Promise<AssignmentDocument> {
    const doc = await this.findById(id);
    if (!isAssignmentOwner(user, doc)) throw assignmentNotFound();
    return doc;
  }

  async findViewable(id: string, user: AuthUser): Promise<AssignmentDocument> {
    const doc = await this.findById(id);
    if (!canViewAssignment(user, doc)) throw assignmentNotFound();
    return doc;
  }

  async views(
    docs: readonly AssignmentDocument[],
    opts: { withJuror?: boolean; withThesis?: boolean } = {},
  ): Promise<AssignmentView[]> {
    const now = new Date();
    const holidays = await this.settings.holidaySet();
    const jurors = opts.withJuror
      ? new Map((await this.users.findManyByIds(docs.map((d) => d.jurorId.toHexString()))).map((u) => [u.id as string, jurorSummary(u)]))
      : undefined;
    const theses = opts.withThesis ? await this.thesisSummaries(docs.map((d) => d.thesisId.toHexString())) : undefined;
    return docs.map((d) => ({
      ...toAssignmentView(d, now, holidays),
      juror: jurors?.get(d.jurorId.toHexString()),
      thesis: theses?.get(d.thesisId.toHexString()),
    }));
  }

  emit(event: string, a: AssignmentDocument, actor: Actor, reason?: string): void {
    const payload: AssignmentEvent = {
      assignmentId: a.id as string,
      thesisId: a.thesisId.toHexString(),
      jurorId: a.jurorId.toHexString(),
      actorId: actor.id,
      actorRole: actor.role,
      reason,
      at: new Date(),
    };
    this.events.emit(event, payload);
  }

  private assertValid(violations: JuryViolationItem[]): void {
    if (violations.length) {
      throw new AppException(
        ErrorCode.ASSIGNMENT_INVALID_COMPOSITION,
        HttpStatus.BAD_REQUEST,
        'The proposed jury breaks the assignment rules',
        { violations },
      );
    }
  }

  /** Loads users and taken emails in two queries; position i gets slot slotOf(i). */
  private async resolveCandidates(
    inputs: readonly JurorInputDto[],
    slotOf: (i: number) => number,
  ): Promise<JurorCandidate[]> {
    if (inputs.some((input) => !!input.jurorId === !!input.newExternal)) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Each juror needs exactly one of jurorId or newExternal',
      );
    }
    const ids = inputs.flatMap((i) => (i.jurorId ? [i.jurorId.toLowerCase()] : []));
    const emails = inputs.flatMap((i) => (i.newExternal ? [i.newExternal.email.toLowerCase()] : []));
    const [users, taken] = await Promise.all([this.users.findManyByIds(ids), this.users.findManyByEmails(emails)]);
    const byId = new Map(users.map((u) => [u.id as string, u]));
    const takenEmails = new Set(taken.map((u) => u.email));
    return inputs.map((input, i): JurorCandidate => {
      const slot = slotOf(i);
      if (input.newExternal) {
        const email = input.newExternal.email.toLowerCase();
        return { slot, key: `new:${email}`, newExternal: { emailTaken: takenEmails.has(email) } };
      }
      const userId = input.jurorId!.toLowerCase();
      const user = byId.get(userId);
      return { slot, key: userId, userId, user: user ? candidateUser(user) : undefined };
    });
  }

  private async previousJurorIds(thesisId: Types.ObjectId): Promise<Set<string>> {
    const ids = await this.model.distinct('jurorId', { thesisId }).exec();
    return new Set(ids.map((id) => String(id)));
  }

  /**
   * Creates inline external jurors, then the assignments. The partial unique indexes make a
   * concurrent second jury fail here; everything this call created is then removed.
   */
  private async persist(
    thesisId: Types.ObjectId,
    slots: readonly { slot: number; input: JurorInputDto }[],
    days: number,
    holidays: ReadonlySet<string>,
    actor: Actor,
    /** Pre-generated id for a single-slot insert (replacement marks the old assignment first). */
    firstId?: Types.ObjectId,
  ): Promise<{ docs: AssignmentDocument[]; created: Created }> {
    const created: Created = {
      assignmentIds: slots.map((_, i) => (i === 0 && firstId ? firstId : new Types.ObjectId())),
      createdUserIds: [],
    };
    try {
      const jurorIds: string[] = [];
      for (const { input } of slots) {
        if (input.newExternal) {
          const user = await this.users.createExternalJuror(input.newExternal);
          created.createdUserIds.push(user.id as string);
          jurorIds.push(user.id as string);
        } else {
          jurorIds.push(input.jurorId!.toLowerCase());
        }
      }
      const now = new Date();
      const responseDeadline = addBusinessDays(now, days, holidays);
      const docs = await this.model.insertMany(
        slots.map(({ slot }, i) => ({
          _id: created.assignmentIds[i],
          thesisId,
          jurorId: new Types.ObjectId(jurorIds[i]),
          type: AssignmentType.PRIMARY,
          slot,
          status: AssignmentStatus.PENDING,
          isActive: true,
          assignedAt: now,
          assignedBy: new Types.ObjectId(actor.id),
          responseDeadline,
        })),
      );
      return { docs: docs as AssignmentDocument[], created };
    } catch (err) {
      await this.compensate(created);
      if (isDuplicateKey(err)) {
        throw new AppException(ErrorCode.ASSIGNMENT_CONFLICT, HttpStatus.CONFLICT, 'The jury changed concurrently');
      }
      throw err;
    }
  }

  private async compensate(created: Created): Promise<void> {
    await this.model.deleteMany({ _id: { $in: created.assignmentIds } }).catch(() => undefined);
    if (created.createdUserIds.length) await this.users.deleteByIds(created.createdUserIds).catch(() => undefined);
  }

  private async thesisSummaries(ids: readonly string[]): Promise<Map<string, ThesisSummary>> {
    const theses = await this.theses.findManyByIds([...new Set(ids)]);
    const advisors = new Map(
      (await this.users.findManyByIds(theses.map((t) => t.advisorId.toHexString()))).map((u) => [
        u.id as string,
        `${u.firstName} ${u.lastName}`,
      ]),
    );
    return new Map(
      theses.map((t) => [
        t.id as string,
        {
          id: t.id as string,
          code: t.code,
          title: t.title,
          abstract: t.abstract,
          studentName: t.studentName,
          advisorName: advisors.get(t.advisorId.toHexString()),
          programId: t.programId.toHexString(),
          status: t.status,
          progress: t.progress,
        },
      ]),
    );
  }

  // ---------------------------------------------------------------- RF-J14 links (used by Task 7)

  private async linksForExternalJurors(docs: readonly AssignmentDocument[]): Promise<ExternalLink[]> {
    const jurors = await this.users.findManyByIds(docs.map((d) => d.jurorId.toHexString()));
    const external = new Set(jurors.filter((u) => u.roles.includes(Role.EXTERNAL_JUROR)).map((u) => u.id as string));
    const links: ExternalLink[] = [];
    for (const d of docs) if (external.has(d.jurorId.toHexString())) links.push(await this.rotateLink(d));
    return links;
  }

  /** New token for an active assignment; the previous link stops working. */
  async rotateLink(a: AssignmentDocument): Promise<ExternalLink> {
    const { token, hash } = newExternalToken();
    const days = Number(this.config.get('EXTERNAL_TOKEN_TTL_DAYS', 60));
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const res = await this.model
      .updateOne(
        { _id: a._id, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } },
        { $set: { externalTokenHash: hash, externalTokenExpiresAt: expiresAt } },
      )
      .exec();
    if (res.matchedCount === 0) {
      throw new AppException(ErrorCode.ASSIGNMENT_NOT_PENDING, HttpStatus.CONFLICT, 'Assignment is no longer active');
    }
    return {
      assignmentId: a.id as string,
      url: externalAccessUrl(this.config.get<string>('CLIENT_URL', 'http://localhost:3000'), token),
      expiresAt,
    };
  }
}
```
Add `Role` to the `@thesis/shared` import.

- [ ] **Step 6: Controller and module**

`server/src/assignments/assignments.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentsDto, ValidateAssignmentsDto } from './dto/create-assignments.dto';

@ApiTags('assignments')
@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post('theses/:id/assignments')
  @Roles(Role.COORDINATOR)
  assign(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateAssignmentsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.assignJury(id, dto, actorFrom(user, Role.COORDINATOR));
  }

  @Get('theses/:id/assignments')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  listForThesis(@Param('id', ParseObjectIdPipe) id: string) {
    return this.assignments.listForThesis(id);
  }

  @Post('assignments/validate')
  @HttpCode(200)
  @Roles(Role.COORDINATOR)
  validate(@Body() dto: ValidateAssignmentsDto) {
    return this.assignments.validate(dto);
  }
}
```

`server/src/assignments/assignments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SettingsModule } from '../settings/settings.module';
import { ThesesModule } from '../theses/theses.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { Assignment, AssignmentSchema } from './schemas/assignment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Assignment.name, schema: AssignmentSchema }]),
    ThesesModule,
    UsersModule,
    WorkflowModule,
    SettingsModule,
  ],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
```
Add `AssignmentsModule` to `server/src/app.module.ts`.

- [ ] **Step 7: Verify and commit**

`pnpm test:e2e -- assignments` → PASS; full suite + lint + build green.
```bash
git add server
git commit -m "feat(server): CU-01 jury assignment with RF-C13/RN-01 checks and live validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: CU-08 — accept, decline, expire; my assignments and detail

**Files:**
- Create: `server/src/assignments/dto/respond.dto.ts`
- Create: `server/src/assignments/assignment-responses.service.ts`, `server/src/assignments/workflow-race.ts`
- Modify: `server/src/assignments/assignments.service.ts` (add `findMine`, `findOneView`), `assignments.controller.ts`, `assignments.module.ts`
- Test: `server/test/responses.e2e-spec.ts`

- [ ] **Step 1: DTOs**

`server/src/assignments/dto/respond.dto.ts`:
```ts
import { AssignmentStatus } from '@thesis/shared';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** CU-08 FA-01: the reason is mandatory (max 500 characters). */
export class DeclineAssignmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class QueryMyAssignmentsDto {
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;
}
```

- [ ] **Step 2: Failing e2e test**

`server/test/responses.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role, ThesisStatus } from '@thesis/shared';
import { Model } from 'mongoose';
import { AssignmentResponsesService } from '../src/assignments/assignment-responses.service';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import { UserDocument } from '../src/users/schemas/user.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createTestApp,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Assignments — CU-08 (e2e)', () => {
  let app: INestApplication;
  let assignments: Model<Assignment>;
  let theses: Model<Thesis>;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    assignments = app.get(getModelToken(Assignment.name));
    theses = app.get(getModelToken(Thesis.name));
    coordinator = await loginAgent(app, (await createUser(app, { roles: [Role.COORDINATOR] })).email);
  });
  afterAll(() => closeTestApp(app));

  /** Fresh thesis with two internal jurors; returns their agents and assignment ids. */
  async function setup() {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    const { assignments: views } = await assignJury(app, thesis.id as string, [j1.id as string, j2.id as string]);
    return {
      thesis,
      a1: views[0].id,
      a2: views[1].id,
      juror1: await loginAgent(app, j1.email),
      juror2: await loginAgent(app, j2.email),
      j1: j1 as UserDocument,
    };
  }
  const status = async (id: unknown) => (await theses.findById(id))?.status;

  it('both acceptances move the thesis to UNDER_EVALUATION (45%) and set evaluation deadlines', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    const r1 = await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
    expect(r1.body).toMatchObject({ status: AssignmentStatus.ACCEPTED, responseDaysRemaining: null, evaluationDaysRemaining: 20 });
    expect(await status(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
    await juror2.post(`/api/assignments/${a2}/accept`).expect(200);
    const t = await theses.findById(thesis._id);
    expect(t).toMatchObject({ status: ThesisStatus.UNDER_EVALUATION, progress: 45 });
    expect(t?.history.at(-1)).toMatchObject({ from: 'JURORS_ASSIGNED', to: 'UNDER_EVALUATION', actorRole: Role.INTERNAL_JUROR });
  });

  it('concurrent acceptances advance the thesis exactly once', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await Promise.all([juror1.post(`/api/assignments/${a1}/accept`).expect(200), juror2.post(`/api/assignments/${a2}/accept`).expect(200)]);
    const t = await theses.findById(thesis._id);
    expect(t?.status).toBe(ThesisStatus.UNDER_EVALUATION);
    expect(t?.history.filter((h) => h.to === ThesisStatus.UNDER_EVALUATION)).toHaveLength(1);
  });

  it('only the assigned juror can respond; a second response is rejected', async () => {
    const { a1, juror1, juror2 } = await setup();
    await juror2.post(`/api/assignments/${a1}/accept`).expect(404);
    await coordinator.post(`/api/assignments/${a1}/accept`).expect(403);
    await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
    const again = await juror1.post(`/api/assignments/${a1}/decline`).send({ reason: 'x' }).expect(409);
    expect(again.body.code).toBe('ASSIGNMENT_NOT_PENDING');
  });

  it('declining requires a reason and sends the thesis to PENDING_JUROR_REPLACEMENT', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await juror1.post(`/api/assignments/${a1}/decline`).send({}).expect(400);
    await juror1.post(`/api/assignments/${a1}/decline`).send({ reason: 'x'.repeat(501) }).expect(400);
    const res = await juror1.post(`/api/assignments/${a1}/decline`).send({ reason: 'Conflicto de agenda' }).expect(200);
    expect(res.body).toMatchObject({ status: AssignmentStatus.DECLINED, declineReason: 'Conflicto de agenda' });
    expect(await status(thesis._id)).toBe(ThesisStatus.PENDING_JUROR_REPLACEMENT);
    // The second juror can still decline; the thesis stays in PENDING_JUROR_REPLACEMENT.
    await juror2.post(`/api/assignments/${a2}/decline`).send({ reason: 'Viaje' }).expect(200);
    expect(await status(thesis._id)).toBe(ThesisStatus.PENDING_JUROR_REPLACEMENT);
  });

  it('responses after the deadline are rejected', async () => {
    const { a1, juror1 } = await setup();
    await assignments.updateOne({ _id: a1 }, { responseDeadline: new Date(Date.now() - 1000) });
    const res = await juror1.post(`/api/assignments/${a1}/accept`).expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_DEADLINE_PASSED');
  });

  it('expirePending marks overdue assignments EXPIRED and records a SYSTEM transition', async () => {
    const { thesis, a1, a2 } = await setup();
    await assignments.updateOne({ _id: a1 }, { responseDeadline: new Date(Date.now() - 1000) });
    const count = await app.get(AssignmentResponsesService).expirePending(new Date());
    expect(count).toBeGreaterThanOrEqual(1);
    expect((await assignments.findById(a1))?.status).toBe(AssignmentStatus.EXPIRED);
    expect((await assignments.findById(a2))?.status).toBe(AssignmentStatus.PENDING);
    const t = await theses.findById(thesis._id);
    expect(t?.history.at(-1)).toMatchObject({ to: ThesisStatus.PENDING_JUROR_REPLACEMENT, actorRole: 'SYSTEM' });
  });

  it('GET /assignments/mine lists my assignments with countdown and thesis summary', async () => {
    const { thesis, a1, juror1 } = await setup();
    const res = await juror1.get('/api/assignments/mine').expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: a1,
        responseDaysRemaining: 8,
        thesis: expect.objectContaining({ id: thesis.id, code: thesis.code, studentName: thesis.studentName, advisorName: expect.any(String) }),
      }),
    ]);
    const accepted = await juror1.get('/api/assignments/mine?status=ACCEPTED').expect(200);
    expect(accepted.body).toEqual([]);
    await juror1.get('/api/assignments/mine?status=NOPE').expect(400);
  });

  it('GET /assignments/:id: owner, coordinator and admin see it; other jurors get 404', async () => {
    const { a1, juror1, juror2 } = await setup();
    await juror1.get(`/api/assignments/${a1}`).expect(200);
    await coordinator.get(`/api/assignments/${a1}`).expect(200);
    await juror2.get(`/api/assignments/${a1}`).expect(404);
    await coordinator.get('/api/assignments/nope').expect(400);
  });
});
```
Run `pnpm test:e2e -- responses` → FAIL.

- [ ] **Step 3: AssignmentsService additions**

Add to `AssignmentsService` (import `FilterQuery` from mongoose, `QueryMyAssignmentsDto`):
```ts
  async findMine(user: AuthUser, query: QueryMyAssignmentsDto): Promise<AssignmentView[]> {
    const filter: FilterQuery<Assignment> = { jurorId: user.id };
    if (query.status) filter.status = query.status;
    if (user.scope) filter._id = { $in: user.scope.assignmentIds };
    const docs = await this.model.find(filter).sort({ assignedAt: -1, _id: -1 }).exec();
    return this.views(docs, { withThesis: true });
  }

  async findOneView(id: string, user: AuthUser): Promise<AssignmentView> {
    const doc = await this.findViewable(id, user);
    const [view] = await this.views([doc], { withThesis: true, withJuror: true });
    return view;
  }
```

- [ ] **Step 4: AssignmentResponsesService**

`server/src/assignments/workflow-race.ts` (also used by `replace` in Task 6):
```ts
import { ErrorCode } from '@thesis/shared';
import { AppException } from '../common/errors/app.exception';

/** Another request already moved the thesis: expected under concurrency, safe to ignore. */
export const isWorkflowRace = (e: unknown): boolean =>
  e instanceof AppException &&
  (e.code === ErrorCode.WORKFLOW_INVALID_TRANSITION || e.code === ErrorCode.WORKFLOW_STATUS_CONFLICT);
```

`server/src/assignments/assignment-responses.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AssignmentStatus, AssignmentType, ErrorCode, Role, ThesisStatus } from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { addBusinessDays } from '../common/time/business-days';
import { Actor, actorFrom, SYSTEM_ACTOR } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { SettingsService } from '../settings/settings.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ASSIGNMENT_EVENTS } from './assignment.events';
import { AssignmentView } from './assignment-view';
import { AssignmentsService } from './assignments.service';
import { Assignment, AssignmentDocument } from './schemas/assignment.schema';
import { isWorkflowRace } from './workflow-race';

const notPending = () =>
  new AppException(ErrorCode.ASSIGNMENT_NOT_PENDING, HttpStatus.CONFLICT, 'The assignment was already answered');

@Injectable()
export class AssignmentResponsesService {
  constructor(
    @InjectModel(Assignment.name) private readonly model: Model<Assignment>,
    private readonly assignments: AssignmentsService,
    private readonly workflow: WorkflowService,
    private readonly settings: SettingsService,
  ) {}

  /** CU-08 main flow. */
  async accept(id: string, user: AuthUser): Promise<AssignmentView> {
    const actor = actorFrom(user, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR);
    const current = await this.assignments.findOwnedByJuror(id, user);
    const now = new Date();
    this.assertRespondable(current, now);
    const settings = await this.settings.get();
    const updated = await this.model
      .findOneAndUpdate(
        { _id: current._id, status: AssignmentStatus.PENDING, responseDeadline: { $gte: now } },
        {
          $set: {
            status: AssignmentStatus.ACCEPTED,
            respondedAt: now,
            evaluationDeadline: addBusinessDays(now, settings.evaluationBusinessDays, new Set(settings.holidays)),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw notPending();
    this.assignments.emit(ASSIGNMENT_EVENTS.ACCEPTED, updated, actor);
    await this.advanceIfJuryAccepted(updated.thesisId, actor);
    const [view] = await this.assignments.views([updated]);
    return view;
  }

  /** CU-08 FA-01. */
  async decline(id: string, user: AuthUser, reason: string): Promise<AssignmentView> {
    const actor = actorFrom(user, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR);
    const current = await this.assignments.findOwnedByJuror(id, user);
    const now = new Date();
    this.assertRespondable(current, now);
    const updated = await this.model
      .findOneAndUpdate(
        { _id: current._id, status: AssignmentStatus.PENDING, responseDeadline: { $gte: now } },
        { $set: { status: AssignmentStatus.DECLINED, isActive: false, respondedAt: now, declineReason: reason } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw notPending();
    this.assignments.emit(ASSIGNMENT_EVENTS.DECLINED, updated, actor, reason);
    await this.markNeedsReplacement(updated.thesisId, actor, 'CU-08 FA-01: juror declined');
    const [view] = await this.assignments.views([updated]);
    return view;
  }

  /** CU-08 FA-02. Called hourly by the scheduler (stage 8). Returns how many expired. */
  async expirePending(now = new Date()): Promise<number> {
    const overdue = await this.model
      .find({ status: AssignmentStatus.PENDING, responseDeadline: { $lt: now } })
      .exec();
    let expired = 0;
    for (const a of overdue) {
      const updated = await this.model
        .findOneAndUpdate(
          { _id: a._id, status: AssignmentStatus.PENDING },
          { $set: { status: AssignmentStatus.EXPIRED, isActive: false } },
          { new: true },
        )
        .exec();
      if (!updated) continue;
      expired++;
      this.assignments.emit(ASSIGNMENT_EVENTS.EXPIRED, updated, SYSTEM_ACTOR, 'Response deadline expired');
      await this.markNeedsReplacement(updated.thesisId, SYSTEM_ACTOR, 'CU-08 FA-02: response deadline expired');
    }
    return expired;
  }

  private assertRespondable(a: AssignmentDocument, now: Date): void {
    if (a.status !== AssignmentStatus.PENDING) throw notPending();
    if (a.responseDeadline < now) {
      throw new AppException(ErrorCode.ASSIGNMENT_DEADLINE_PASSED, HttpStatus.CONFLICT, 'The response deadline has passed');
    }
  }

  /** Both primary jurors accepted → UNDER_EVALUATION. A losing concurrent accept is ignored. */
  private async advanceIfJuryAccepted(thesisId: Types.ObjectId, actor: Actor): Promise<void> {
    const accepted = await this.model
      .countDocuments({ thesisId, type: AssignmentType.PRIMARY, status: AssignmentStatus.ACCEPTED })
      .exec();
    if (accepted < 2) return;
    try {
      await this.workflow.transition({
        thesisId: thesisId.toHexString(),
        expectedFrom: [ThesisStatus.JURORS_ASSIGNED, ThesisStatus.PENDING_JUROR_REPLACEMENT],
        to: ThesisStatus.UNDER_EVALUATION,
        actor,
        reason: 'CU-08: both jurors accepted',
      });
    } catch (e) {
      if (!isWorkflowRace(e)) throw e;
    }
  }

  /** JURORS_ASSIGNED → PENDING_JUROR_REPLACEMENT; no-op when the thesis is already waiting. */
  private async markNeedsReplacement(thesisId: Types.ObjectId, actor: Actor, reason: string): Promise<void> {
    try {
      await this.workflow.transition({
        thesisId: thesisId.toHexString(),
        expectedFrom: [ThesisStatus.JURORS_ASSIGNED],
        to: ThesisStatus.PENDING_JUROR_REPLACEMENT,
        actor,
        reason,
      });
    } catch (e) {
      if (!isWorkflowRace(e)) throw e;
    }
  }
}
```

- [ ] **Step 5: Controller and module**

Add to `AssignmentsController` (inject `private readonly responses: AssignmentResponsesService`; imports `Query`, `DeclineAssignmentDto`, `QueryMyAssignmentsDto`). Declare `assignments/mine` before `assignments/:id`:
```ts
  @Get('assignments/mine')
  @Roles(Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  mine(@CurrentUser() user: AuthUser, @Query() query: QueryMyAssignmentsDto) {
    return this.assignments.findMine(user, query);
  }

  @Get('assignments/:id')
  @Roles(Role.ADMIN, Role.COORDINATOR, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  findOne(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.assignments.findOneView(id, user);
  }

  @Post('assignments/:id/accept')
  @HttpCode(200)
  @Roles(Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  accept(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.responses.accept(id, user);
  }

  @Post('assignments/:id/decline')
  @HttpCode(200)
  @Roles(Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  decline(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: DeclineAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.responses.decline(id, user, dto.reason);
  }
```
Add `AssignmentResponsesService` to the module's `providers` and `exports`.

- [ ] **Step 6: Verify and commit**

`pnpm test:e2e -- responses` → PASS; full suite + lint + build green.
```bash
git add server
git commit -m "feat(server): CU-08 accept/decline with business-day deadlines and expiry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Replace a juror

**Files:**
- Create: `server/src/assignments/dto/replace-assignment.dto.ts`
- Modify: `server/src/assignments/assignments.service.ts`, `assignments.controller.ts`
- Test: `server/test/replace.e2e-spec.ts`

- [ ] **Step 1: DTO**

`server/src/assignments/dto/replace-assignment.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { JurorInputDto } from './juror-input.dto';

export class ReplaceAssignmentDto {
  /** PENDING, DECLINED or EXPIRED primary assignment of this thesis. */
  @IsMongoId()
  assignmentId!: string;

  @ValidateNested()
  @Type(() => JurorInputDto)
  juror!: JurorInputDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  responseBusinessDays?: number;
}
```

- [ ] **Step 2: Failing e2e test**

`server/test/replace.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role, ThesisStatus } from '@thesis/shared';
import { Model } from 'mongoose';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createExternalJuror,
  createTestApp,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Assignments — replacement (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let assignments: Model<Assignment>;
  let theses: Model<Thesis>;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(app, (await createUser(app, { roles: [Role.COORDINATOR] })).email);
    assignments = app.get(getModelToken(Assignment.name));
    theses = app.get(getModelToken(Thesis.name));
  });
  afterAll(() => closeTestApp(app));

  async function setup(second: 'internal' | 'external' = 'internal') {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = second === 'internal' ? await createUser(app, { roles: [Role.INTERNAL_JUROR] }) : await createExternalJuror(app);
    const thesis = await createAssignableThesis(app);
    const { assignments: views } = await assignJury(app, thesis.id as string, [j1.id as string, j2.id as string]);
    return { thesis, j1, j2, a1: views[0].id, a2: views[1].id, juror1: await loginAgent(app, j1.email) };
  }
  const replace = (thesisId: string, body: object) =>
    coordinator.post(`/api/theses/${thesisId}/assignments/replace`).send(body);
  const statusOf = async (id: unknown) => (await theses.findById(id))?.status;

  it('replaces a declined juror; thesis returns to JURORS_ASSIGNED', async () => {
    const { thesis, a1, juror1 } = await setup();
    await juror1.post(`/api/assignments/${a1}/decline`).send({ reason: 'Sin tiempo' }).expect(200);
    const newJuror = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const res = await replace(thesis.id as string, { assignmentId: a1, juror: { jurorId: newJuror.id } }).expect(201);
    expect(res.body.assignment).toMatchObject({ slot: 1, jurorId: newJuror.id, status: AssignmentStatus.PENDING });
    const old = await assignments.findById(a1);
    expect(old).toMatchObject({ status: AssignmentStatus.DECLINED });
    expect(old?.replacedById?.toHexString()).toBe(res.body.assignment.id);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
  });

  it('full path: one accepted, one declined, replacement accepts → UNDER_EVALUATION', async () => {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    const { assignments: views } = await assignJury(app, thesis.id as string, [j1.id as string, j2.id as string]);
    await (await loginAgent(app, j1.email)).post(`/api/assignments/${views[0].id}/accept`).expect(200);
    await (await loginAgent(app, j2.email)).post(`/api/assignments/${views[1].id}/decline`).send({ reason: 'No' }).expect(200);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.PENDING_JUROR_REPLACEMENT);
    const j3 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const res = await replace(thesis.id as string, { assignmentId: views[1].id, juror: { jurorId: j3.id } }).expect(201);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
    await (await loginAgent(app, j3.email)).post(`/api/assignments/${res.body.assignment.id as string}/accept`).expect(200);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.UNDER_EVALUATION);
  });

  it('replaces a pending juror while JURORS_ASSIGNED (old one becomes REPLACED)', async () => {
    const { thesis, a2 } = await setup();
    const j3 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    await replace(thesis.id as string, { assignmentId: a2, juror: { jurorId: j3.id } }).expect(201);
    expect((await assignments.findById(a2))?.status).toBe(AssignmentStatus.REPLACED);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
  });

  it('cannot replace an accepted juror, nor bring back a previous juror', async () => {
    const { thesis, a1, a2, j1, juror1 } = await setup();
    await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
    const accepted = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id },
    }).expect(409);
    expect(accepted.body.code).toBe('ASSIGNMENT_NOT_REPLACEABLE');
    const back = await replace(thesis.id as string, { assignmentId: a2, juror: { jurorId: j1.id } }).expect(400);
    expect(back.body.details.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: expect.stringMatching(/JUROR_DUPLICATE|JUROR_PREVIOUSLY_ASSIGNED/) })]),
    );
  });

  it('keeps RF-C13: an external replacing the only Unicórdoba juror is rejected', async () => {
    const { thesis, a1, juror1 } = await setup('external');
    await juror1.post(`/api/assignments/${a1}/decline`).send({ reason: 'No' }).expect(200);
    const ext2 = await createExternalJuror(app);
    const res = await replace(thesis.id as string, { assignmentId: a1, juror: { jurorId: ext2.id } }).expect(400);
    expect(res.body.details.violations).toContainEqual({ code: 'JUROR_UNICORDOBA_REQUIRED' });
  });

  it('with both slots empty, the thesis waits until both are filled', async () => {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    const { assignments: views } = await assignJury(app, thesis.id as string, [j1.id as string, j2.id as string]);
    await (await loginAgent(app, j1.email)).post(`/api/assignments/${views[0].id}/decline`).send({ reason: 'a' }).expect(200);
    await (await loginAgent(app, j2.email)).post(`/api/assignments/${views[1].id}/decline`).send({ reason: 'b' }).expect(200);
    const ext = await createExternalJuror(app);
    await replace(thesis.id as string, { assignmentId: views[0].id, juror: { jurorId: ext.id } }).expect(201);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.PENDING_JUROR_REPLACEMENT);
    const j3 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const res = await replace(thesis.id as string, { assignmentId: views[1].id, juror: { jurorId: j3.id } }).expect(201);
    expect(res.body.externalLink).toBeUndefined();
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
  });

  it('rejects replacing twice and assignments of another thesis', async () => {
    const { thesis, a1, juror1 } = await setup();
    const other = await setup();
    await juror1.post(`/api/assignments/${a1}/decline`).send({ reason: 'x' }).expect(200);
    await replace(other.thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id },
    }).expect(404);
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id },
    }).expect(201);
    const twice = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id },
    }).expect(409);
    expect(twice.body.code).toBe('ASSIGNMENT_NOT_REPLACEABLE');
  });

  it('returns an external link when the replacement is external', async () => {
    const { thesis, a2 } = await setup();
    const res = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: {
        newExternal: {
          email: 'reemplazo@uni.example.org',
          firstName: 'Re',
          lastName: 'Emplazo',
          institution: 'U. de Lima',
          highestDegree: 'Doctorado',
          country: 'Perú',
        },
      },
    }).expect(201);
    expect(res.body.externalLink.url).toContain('/auth/external-access?token=');
  });
});
```
Run `pnpm test:e2e -- replace` → FAIL.

- [ ] **Step 3: Service method**

Add to `AssignmentsService` (imports: `ReplaceAssignmentDto`, `isWorkflowRace` from `./workflow-race` — created in Task 5):
```ts
  /** Replaces a pending, declined or expired primary juror (spec §4 PENDING_JUROR_REPLACEMENT). */
  async replace(thesisId: string, dto: ReplaceAssignmentDto, actor: Actor): Promise<{ assignment: AssignmentView; externalLink?: ExternalLink }> {
    const thesis = await this.theses.findById(thesisId);
    if (thesis.status !== ThesisStatus.JURORS_ASSIGNED && thesis.status !== ThesisStatus.PENDING_JUROR_REPLACEMENT) {
      throw thesisStatusError(thesis.status);
    }
    const old = isObjectIdOrHexString(dto.assignmentId)
      ? await this.model.findOne({ _id: dto.assignmentId, thesisId: thesis._id, type: AssignmentType.PRIMARY }).exec()
      : null;
    if (!old) throw assignmentNotFound();
    const replaceable =
      old.status === AssignmentStatus.PENDING ||
      ((old.status === AssignmentStatus.DECLINED || old.status === AssignmentStatus.EXPIRED) && !old.replacedById);
    if (!replaceable) {
      throw new AppException(ErrorCode.ASSIGNMENT_NOT_REPLACEABLE, HttpStatus.CONFLICT, `A ${old.status} assignment cannot be replaced`);
    }

    const others = await this.model
      .find({ thesisId: thesis._id, type: AssignmentType.PRIMARY, isActive: true, _id: { $ne: old._id } })
      .exec();
    const kept = await this.users.findManyByIds(others.map((o) => o.jurorId.toHexString()));
    const keptById = new Map(kept.map((u) => [u.id as string, u]));
    const [candidate] = await this.resolveCandidates([dto.juror], () => old.slot);
    const candidates: JurorCandidate[] = [
      ...others.map((o): JurorCandidate => {
        const u = keptById.get(o.jurorId.toHexString());
        return { slot: o.slot, key: o.jurorId.toHexString(), userId: o.jurorId.toHexString(), user: u ? candidateUser(u) : undefined, keep: true };
      }),
      candidate,
    ];
    this.assertValid(
      validateJury({
        candidates,
        parties: partiesOf(thesis),
        previousJurorIds: await this.previousJurorIds(thesis._id),
        required: candidates.length,
        requireUnicordoba: candidates.length === 2,
      }),
    );

    const settings = await this.settings.get();
    const { docs, created } = await this.persistReplacement(old, dto, settings, actor);
    const [doc] = docs;

    if (thesis.status === ThesisStatus.PENDING_JUROR_REPLACEMENT && others.length + 1 === 2) {
      try {
        await this.workflow.transition({
          thesisId,
          expectedFrom: [ThesisStatus.PENDING_JUROR_REPLACEMENT],
          to: ThesisStatus.JURORS_ASSIGNED,
          actor,
          reason: 'Juror replaced',
        });
      } catch (e) {
        if (!isWorkflowRace(e)) {
          await this.undoReplacement(old, created);
          throw e;
        }
      }
    }
    this.emit(ASSIGNMENT_EVENTS.REPLACED, old, actor, `Replaced by ${doc.id as string}`);
    this.emit(ASSIGNMENT_EVENTS.CREATED, doc, actor);
    const [link] = await this.linksForExternalJurors([doc]);
    const [view] = await this.views([doc], { withJuror: true });
    return { assignment: view, externalLink: link };
  }

  /** Marks the old assignment first (conditional, so two replacements cannot both win), then inserts. */
  private async persistReplacement(
    old: AssignmentDocument,
    dto: ReplaceAssignmentDto,
    settings: { acceptanceBusinessDays: number; holidays: string[] },
    actor: Actor,
  ): Promise<{ docs: AssignmentDocument[]; created: Created }> {
    const newId = new Types.ObjectId();
    const marked =
      old.status === AssignmentStatus.PENDING
        ? await this.model.updateOne(
            { _id: old._id, status: AssignmentStatus.PENDING },
            { $set: { status: AssignmentStatus.REPLACED, isActive: false, replacedById: newId } },
          )
        : await this.model.updateOne(
            { _id: old._id, status: old.status, replacedById: { $exists: false } },
            { $set: { replacedById: newId } },
          );
    if (marked.modifiedCount === 0) {
      throw new AppException(ErrorCode.ASSIGNMENT_NOT_REPLACEABLE, HttpStatus.CONFLICT, 'The assignment changed concurrently');
    }
    try {
      const result = await this.persist(
        old.thesisId,
        [{ slot: old.slot, input: dto.juror }],
        dto.responseBusinessDays ?? settings.acceptanceBusinessDays,
        new Set(settings.holidays),
        actor,
        newId,
      );
      return result;
    } catch (err) {
      await this.restoreOld(old);
      throw err;
    }
  }

  private async undoReplacement(old: AssignmentDocument, created: Created): Promise<void> {
    await this.compensate(created);
    await this.restoreOld(old);
  }

  private async restoreOld(old: AssignmentDocument): Promise<void> {
    await this.model
      .updateOne(
        { _id: old._id },
        old.status === AssignmentStatus.PENDING
          ? { $set: { status: AssignmentStatus.PENDING, isActive: true }, $unset: { replacedById: 1 } }
          : { $unset: { replacedById: 1 } },
      )
      .catch(() => undefined);
  }
```

- [ ] **Step 4: Controller**

Add to `AssignmentsController` (import `ReplaceAssignmentDto`):
```ts
  @Post('theses/:id/assignments/replace')
  @Roles(Role.COORDINATOR)
  replace(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReplaceAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.replace(id, dto, actorFrom(user, Role.COORDINATOR));
  }
```

- [ ] **Step 5: Verify and commit**

`pnpm test:e2e -- replace` → PASS; full suite + lint + build green.
```bash
git add server
git commit -m "feat(server): replace declined, expired or pending jurors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: External access (RF-J14) and juror access to theses

**Files:**
- Create: `server/src/auth/external-auth.service.ts`, `server/src/auth/dto/validate-external-token.dto.ts`
- Modify: `server/src/auth/auth.controller.ts`, `server/src/auth/auth.module.ts`
- Modify: `server/src/assignments/assignments.service.ts` (add `issueExternalLink`, `findByExternalToken`), `assignments.controller.ts`
- Modify: `server/src/theses/theses.service.ts`, `theses.controller.ts`, `theses.module.ts`
- Modify: `server/test/manuscripts.e2e-spec.ts`, `server/test/rbac.e2e-spec.ts`
- Test: `server/test/external-access.e2e-spec.ts`

- [ ] **Step 1: Failing e2e test**

`server/test/external-access.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role } from '@thesis/shared';
import { Model } from 'mongoose';
import request from 'supertest';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import {
  assignJury,
  binaryParser,
  closeTestApp,
  createAssignableThesis,
  createExternalJuror,
  createTestApp,
  createUser,
  http,
  loginAgent,
  PDF_BYTES,
  TestAgent,
} from './utils/test-app';

describe('External juror access — RF-J14 (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let assignments: Model<Assignment>;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(app, (await createUser(app, { roles: [Role.COORDINATOR] })).email);
    assignments = app.get(getModelToken(Assignment.name));
  });
  afterAll(() => closeTestApp(app));

  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  async function setup() {
    const internal = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const external = await createExternalJuror(app);
    const thesis = await createAssignableThesis(app);
    const result = await assignJury(app, thesis.id as string, [internal.id as string, external.id as string]);
    return { thesis, internal, external, externalAssignmentId: result.assignments[1].id, internalAssignmentId: result.assignments[0].id, link: result.externalLinks[0] };
  }

  async function externalAgent(token: string) {
    const agent = request.agent(http(app));
    const res = await agent.post('/api/auth/external/validate-token').send({ token }).expect(200);
    return { agent, res };
  }

  it('exchanges the link token for a scoped session limited to the assignment', async () => {
    const { thesis, external, externalAssignmentId, link } = await setup();
    const { agent, res } = await externalAgent(tokenOf(link.url));
    expect(res.body).toMatchObject({ assignmentId: externalAssignmentId, user: { id: external.id, roles: [Role.EXTERNAL_JUROR] } });
    expect(res.headers['set-cookie']?.[0]).toMatch(/^access_token=.*HttpOnly/);
    await agent.get('/api/auth/me').expect(200);
    const mine = await agent.get('/api/assignments/mine').expect(200);
    expect(mine.body.map((a: { id: string }) => a.id)).toEqual([externalAssignmentId]);

    // Before accepting: thesis metadata yes, manuscript no.
    const detail = await agent.get(`/api/theses/${thesis.id as string}`).expect(200);
    const fileId = detail.body.manuscripts[0].fileId as string;
    await agent.get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`).expect(404);

    await agent.post(`/api/assignments/${externalAssignmentId}/accept`).expect(200);
    const file = await agent
      .get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect((file.body as Buffer).equals(PDF_BYTES)).toBe(true);
    // No refresh token for external sessions.
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('a scoped session cannot reach another assignment of the same juror', async () => {
    const { external, link } = await setup();
    const internal = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const other = await createAssignableThesis(app);
    const second = await assignJury(app, other.id as string, [internal.id as string, external.id as string]);
    const { agent } = await externalAgent(tokenOf(link.url));
    await agent.get(`/api/assignments/${second.assignments[1].id}`).expect(404);
    await agent.post(`/api/assignments/${second.assignments[1].id}/accept`).expect(404);
    await agent.get(`/api/theses/${other.id as string}`).expect(404);
  });

  it('rejects unknown, rotated, expired and inactive-assignment tokens', async () => {
    const { externalAssignmentId, link } = await setup();
    const bad = await request(http(app)).post('/api/auth/external/validate-token').send({ token: 'x'.repeat(43) }).expect(401);
    expect(bad.body.code).toBe('AUTH_EXTERNAL_TOKEN_INVALID');
    await request(http(app)).post('/api/auth/external/validate-token').send({}).expect(400);

    const rotated = await coordinator.post(`/api/assignments/${externalAssignmentId}/external-link`).expect(200);
    await request(http(app)).post('/api/auth/external/validate-token').send({ token: tokenOf(link.url) }).expect(401);
    await externalAgent(tokenOf(rotated.body.url as string));

    await assignments.updateOne({ _id: externalAssignmentId }, { externalTokenExpiresAt: new Date(Date.now() - 1000) });
    await request(http(app)).post('/api/auth/external/validate-token').send({ token: tokenOf(rotated.body.url as string) }).expect(401);

    const fresh = await coordinator.post(`/api/assignments/${externalAssignmentId}/external-link`).expect(200);
    await assignments.updateOne({ _id: externalAssignmentId }, { status: AssignmentStatus.DECLINED, isActive: false });
    await request(http(app)).post('/api/auth/external/validate-token').send({ token: tokenOf(fresh.body.url as string) }).expect(401);
  });

  it('links are only for external jurors and only the coordinator issues them', async () => {
    const { internalAssignmentId, externalAssignmentId } = await setup();
    const res = await coordinator.post(`/api/assignments/${internalAssignmentId}/external-link`).expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_NOT_EXTERNAL');
    const admin = await loginAgent(app, (await createUser(app, { roles: [Role.ADMIN] })).email);
    await admin.post(`/api/assignments/${externalAssignmentId}/external-link`).expect(403);
  });

  it('internal jurors: pending sees metadata only, accepted gets the manuscript, declined loses access', async () => {
    const { thesis, internal, internalAssignmentId } = await setup();
    const juror = await loginAgent(app, internal.email);
    const detail = await juror.get(`/api/theses/${thesis.id as string}`).expect(200);
    const fileId = detail.body.manuscripts[0].fileId as string;
    await juror.get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`).expect(404);
    await juror.post(`/api/assignments/${internalAssignmentId}/accept`).expect(200);
    await juror.get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`).expect(200);

    const other = await setup();
    const otherJuror = await loginAgent(app, other.internal.email);
    await otherJuror.post(`/api/assignments/${other.internalAssignmentId}/decline`).send({ reason: 'No' }).expect(200);
    await otherJuror.get(`/api/theses/${other.thesis.id as string}`).expect(404);
    // A juror never sees theses they are not assigned to.
    await juror.get(`/api/theses/${other.thesis.id as string}`).expect(404);
  });
});
```
Also adapt `server/test/manuscripts.e2e-spec.ts`: an unassigned juror downloading now gets **404** instead of 403 (jurors pass `@Roles`, then fail the access check). Update that expectation and its test name.

Run `pnpm test:e2e -- external-access manuscripts` → FAIL.

- [ ] **Step 2: Juror access in ThesesService**

In `server/src/theses/theses.module.ts`, add `{ name: Assignment.name, schema: AssignmentSchema }` to `forFeature` (comment: `// Read-only use for juror access; AssignmentsModule owns writes. Avoids a module cycle.`).

In `server/src/theses/theses.service.ts` (inject `@InjectModel(Assignment.name) private readonly assignmentModel: Model<Assignment>`; imports `ACTIVE_ASSIGNMENT_STATUSES`, `Assignment`, `jurorAccessLevel`, `JurorAccess`):
```ts
  /** RBAC "Si Aceptó": assignment statuses of this user on this thesis (scope-limited). */
  private async jurorAccess(thesisId: Types.ObjectId, user: AuthUser): Promise<JurorAccess> {
    if (!user.roles.some((r) => JUROR_ROLES.includes(r))) return 'NONE';
    const filter: FilterQuery<Assignment> = {
      thesisId,
      jurorId: user.id,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
    };
    if (user.scope) filter._id = { $in: user.scope.assignmentIds };
    const found = await this.assignmentModel.find(filter, 'status').exec();
    return jurorAccessLevel(found.map((a) => a.status));
  }
```
Change `findReadable`:
```ts
  async findReadable(id: string, user: AuthUser): Promise<ThesisDocument> {
    const thesis = await this.findById(id);
    if (canReadThesis(user, thesis)) return thesis;
    if ((await this.jurorAccess(thesis._id, user)) !== 'NONE') return thesis;
    throw thesisNotFound();
  }
```
Change `openManuscript` to load with `findById` and check:
```ts
    const thesis = await this.findById(id);
    const allowed = canReadThesis(user, thesis) || (await this.jurorAccess(thesis._id, user)) === 'MANUSCRIPT';
    if (!allowed) throw thesisNotFound();
```
In `server/src/theses/theses.controller.ts`, add `Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR` to `@Roles` of `GET :id` and `GET :id/manuscripts/:fileId`. Update the doc comment in `thesis-access.policy.ts` (`canReadThesis` no longer says "Stage 3 extends this"; point to `jurorAccessLevel`).

- [ ] **Step 3: External links and token lookup in AssignmentsService**

Add to `AssignmentsService`:
```ts
  /** RF-J14: rotate the link of an external juror's active assignment (coordinator copies it). */
  async issueExternalLink(id: string): Promise<ExternalLink> {
    const a = await this.findById(id);
    const [juror] = await this.users.findManyByIds([a.jurorId.toHexString()]);
    if (!juror?.roles.includes(Role.EXTERNAL_JUROR)) {
      throw new AppException(ErrorCode.ASSIGNMENT_NOT_EXTERNAL, HttpStatus.CONFLICT, 'The juror is not external');
    }
    return this.rotateLink(a);
  }

  /** Active assignment whose live token hash matches. */
  findByExternalTokenHash(hash: string, now = new Date()): Promise<AssignmentDocument | null> {
    return this.model
      .findOne({
        externalTokenHash: hash,
        externalTokenExpiresAt: { $gt: now },
        status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
      })
      .exec();
  }
```
Controller:
```ts
  @Post('assignments/:id/external-link')
  @HttpCode(200)
  @Roles(Role.COORDINATOR)
  externalLink(@Param('id', ParseObjectIdPipe) id: string) {
    return this.assignments.issueExternalLink(id);
  }
```

- [ ] **Step 4: ExternalAuthService and endpoint**

`server/src/auth/dto/validate-external-token.dto.ts`:
```ts
import { IsString, Matches } from 'class-validator';

export class ValidateExternalTokenDto {
  /** base64url of 32 random bytes. */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  token!: string;
}
```

`server/src/auth/external-auth.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, Role } from '@thesis/shared';
import { AssignmentsService } from '../assignments/assignments.service';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
import { AccessTokenPayload } from '../common/types/auth-user';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

const invalidToken = () =>
  new AppException(ErrorCode.AUTH_EXTERNAL_TOKEN_INVALID, HttpStatus.UNAUTHORIZED, 'Invalid or expired access link');

/** RF-J14: an external juror's link token → short session scoped to one assignment. */
@Injectable()
export class ExternalAuthService {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  get sessionTtlSeconds(): number {
    return Number(this.config.get('EXTERNAL_SESSION_TTL_SECONDS', 14_400));
  }

  async exchange(token: string): Promise<{ user: UserDocument; assignmentId: string; accessToken: string }> {
    const assignment = await this.assignments.findByExternalTokenHash(sha256(token));
    if (!assignment) throw invalidToken();
    const user = await this.users.findById(assignment.jurorId.toHexString()).catch(() => null);
    if (!user?.isActive || !user.roles.includes(Role.EXTERNAL_JUROR)) throw invalidToken();
    const assignmentId = assignment.id as string;
    const payload: AccessTokenPayload = {
      sub: user.id as string,
      email: user.email,
      roles: [Role.EXTERNAL_JUROR],
      scope: { assignmentIds: [assignmentId] },
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.sessionTtlSeconds,
    });
    return { user, assignmentId, accessToken };
  }
}
```

In `server/src/auth/auth.module.ts`: import `AssignmentsModule`, add `ExternalAuthService` to providers.

In `server/src/auth/auth.controller.ts` (inject `private readonly external: ExternalAuthService`; import `ValidateExternalTokenDto`):
```ts
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('external/validate-token')
  @HttpCode(200)
  async validateExternalToken(
    @Body() dto: ValidateExternalTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.external.exchange(dto.token);
    res.cookie(ACCESS_COOKIE, session.accessToken, {
      ...this.cookieOptions('/'),
      maxAge: this.external.sessionTtlSeconds * 1000,
    });
    // An institutional refresh cookie in the same browser must not outlive this session switch.
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(REFRESH_COOKIE_PATH));
    return { user: session.user, assignmentId: session.assignmentId };
  }
```
If `auth.controller.spec.ts` constructs the controller manually, add a stub for the new dependency.

- [ ] **Step 5: RBAC rows for theses**

In `server/test/rbac.e2e-spec.ts`, the `GET /api/theses/:id` and `GET /api/theses/:id/manuscripts/:fileId` rows now allow `INTERNAL_JUROR` and `EXTERNAL_JUROR` (they get 404 without an assignment, which counts as "passed").

- [ ] **Step 6: Verify and commit**

`pnpm test:e2e` (all) → PASS; unit + lint + build green.
```bash
git add server
git commit -m "feat(server): RF-J14 external juror links and scoped sessions; juror access to theses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: RBAC matrix, docs and final verification

**Files:**
- Modify: `server/test/rbac.e2e-spec.ts`, `server/README.md`, `docs/superpowers/specs/2026-11-17-server-design.md`

- [ ] **Step 1: RBAC rows for stage 3**

Add rows to the matrix in `server/test/rbac.e2e-spec.ts` (create one assignable thesis with a jury in `beforeAll` and use its id `thesisId` and first assignment id `assignmentId`; `JURORS = [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR]`):
```ts
  { method: 'get', path: '/api/settings', allowed: [Role.ADMIN, Role.COORDINATOR] },
  { method: 'patch', path: '/api/settings', allowed: [Role.ADMIN] },
  { method: 'post', path: `/api/theses/${thesisId}/assignments`, allowed: [Role.COORDINATOR] },
  { method: 'get', path: `/api/theses/${thesisId}/assignments`, allowed: [Role.ADMIN, Role.COORDINATOR] },
  { method: 'post', path: `/api/theses/${thesisId}/assignments/replace`, allowed: [Role.COORDINATOR] },
  { method: 'post', path: '/api/assignments/validate', allowed: [Role.COORDINATOR] },
  { method: 'get', path: '/api/assignments/mine', allowed: JURORS },
  { method: 'get', path: `/api/assignments/${assignmentId}`, allowed: [Role.ADMIN, Role.COORDINATOR, ...JURORS] },
  { method: 'post', path: `/api/assignments/${assignmentId}/accept`, allowed: JURORS },
  { method: 'post', path: `/api/assignments/${assignmentId}/decline`, allowed: JURORS },
  { method: 'post', path: `/api/assignments/${assignmentId}/external-link`, allowed: [Role.COORDINATOR] },
```
The jurors used by the matrix agents are not on that jury, so their accept/decline get 404 (allowed, no state change). Keep the `< 500` assertion. Run `pnpm test:e2e -- rbac` → PASS; if a row fails, fix the controller's `@Roles` unless the row contradicts this plan's decisions table.

- [ ] **Step 2: README**

Append to `server/README.md` a Spanish section `## Asignación de jurados (sub-etapa 3)`:
- Configuración: `GET|PATCH /api/settings` (plazos en días hábiles y festivos `YYYY-MM-DD`; el administrador carga el calendario de festivos de Colombia). Los días hábiles se calculan con la hora de Bogotá; el plazo vence al final del último día hábil.
- CU-01: `POST /api/theses/:id/assignments` con `jurors: [{ jurorId } | { newExternal }]` (exactamente 2, al menos uno de Unicórdoba, sin conflicto de interés) y `responseBusinessDays` opcional; `POST /api/assignments/validate` para la validación en vivo; `GET /api/theses/:id/assignments`.
- CU-08: `GET /api/assignments/mine`, `GET /api/assignments/:id`, `POST /api/assignments/:id/accept`, `POST /api/assignments/:id/decline` (`reason` obligatorio). Campos de cuenta regresiva: `daysSinceAssigned`, `responseDaysRemaining`, `evaluationDaysRemaining`, `isResponseOverdue`.
- Reemplazo: `POST /api/theses/:id/assignments/replace`.
- Jurado externo: el coordinador obtiene el enlace con `POST /api/assignments/:id/external-link` (también viene en la respuesta de la asignación) y lo envía por su cuenta; `POST /api/auth/external/validate-token` abre una sesión limitada a esa asignación (sin contraseña, sin refresh). Variables `EXTERNAL_TOKEN_TTL_DAYS` y `EXTERNAL_SESSION_TTL_SECONDS`.
- Los jurados externos nunca tienen contraseña.
- El vencimiento automático de asignaciones (`expirePending`) se programará en la sub-etapa 8.

- [ ] **Step 3: Spec alignment**

In `docs/superpowers/specs/2026-11-17-server-design.md`:
- §2.2: replace "`GET /assignments/:id/external-link` (lo regenera e invalida el anterior)" with "`POST /assignments/:id/external-link` (lo regenera e invalida el anterior; también se devuelve al asignar)", and add: "La sesión externa no tiene refresh token; dura `EXTERNAL_SESSION_TTL_SECONDS` y el enlace sirve mientras la asignación esté `PENDING` o `ACCEPTED` y no venza (`EXTERNAL_TOKEN_TTL_DAYS`)."
- §8 assignments: `GET /assignments/:id/external-link` → `POST /assignments/:id/external-link`; add `GET /theses/:id/assignments`, `GET /assignments/:id`.
- §5 assignments: add `isActive` (índices únicos parciales por `slot` y por jurado) and `replacedById`.
- §6 countdown: add `isResponseOverdue` and that dates use America/Bogotá.

- [ ] **Step 4: Final verification and commit**

From `server/`: `pnpm test && pnpm test:e2e && pnpm lint && pnpm build` → green; put the counts in the commit body.
```bash
git add server docs/superpowers/specs/2026-11-17-server-design.md
git commit -m "test(server): stage-3 RBAC matrix; docs for assignments and external access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Out of scope (later stages)

- Evaluations, feedback and "evaluation submitted" nulling `evaluationDaysRemaining` (stage 4); tiebreaker endpoint (stage 5).
- Notifications/audit listeners for `assignment.*` and `thesis.status.changed` (stage 7).
- Cron wiring for `expirePending`, `overdueEvaluations`, `deadlineReminders` (stage 8).
