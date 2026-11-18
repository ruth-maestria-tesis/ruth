# Server Stage 2 — Catalogs, Theses, Files (GridFS), Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the academic catalogs (programs, periods, cohorts), thesis registration with prefixed codes and sortable/filterable listing, manuscript upload/download in GridFS, and the central thesis state machine (`WorkflowService`).

**Architecture:** Four NestJS modules on top of stage 1. `catalogs` and `files` are leaf modules. `workflow` owns the only code path that changes `thesis.status` (conditional single-document update, history entry, internal event). `theses` composes them. Pure rules (`*.rules.ts`, `detectFileType`, `formatThesisCode`, `canReadThesis`) are unit-tested; HTTP behaviour is covered by e2e tests on `mongodb-memory-server`.

**Tech Stack:** NestJS 11, Mongoose 8 (GridFS through `mongoose.mongo.GridFSBucket`), `@nestjs/event-emitter` 3, multer (bundled with `@nestjs/platform-express`), Jest 30 + supertest.

**Spec:** `docs/superpowers/specs/2026-11-17-server-design.md` (§3 catalogs/theses/files/workflow, §4, §5, §8). Code and identifiers in English; only UI text is Spanish (none in this stage).

---

## Decisions taken in this plan (spec gaps)

| Topic | Decision |
|---|---|
| Catalog routes | Top-level: `/api/programs`, `/api/periods`, `/api/cohorts`. `GET` for any authenticated user (filters need them); `POST`/`PATCH` for `ADMIN` and `COORDINATOR`. Unpaginated arrays (small sets). |
| Period code | Derived `${year}-${term}` (e.g. `2026-II`), unique; `year`/`term` are immutable after creation. |
| Who registers a thesis | `COORDINATOR` (`POST /theses`). `ADMIN` has read-only access to the tray (RBAC matrix: "Lectura"). |
| Thesis code | `[SEEDTAG-]PROGRAMCODE-PERIODCODE-NNN`, e.g. `MIETIA-2026-II-001`. Prefix comes from `program.code` (multi-program safe); `settings.thesisCodePrefix` (stage 8) is not used. Sequence per prefix in a `counters` collection via atomic `$inc`. |
| Sort by student | Denormalized `studentName` (`"First Last"`) on the thesis, used for `sort=student` and `q`. Not refreshed when the user is renamed (accepted). |
| Advisor / co-advisors | Must be active users with a juror role (`INTERNAL_JUROR` or `EXTERNAL_JUROR`), i.e. faculty returned by `/users/faculty`. |
| One active thesis per student | Enforced in the service (409 `THESIS_STUDENT_HAS_ACTIVE`); check-then-insert race accepted. |
| Editing | `PATCH /theses/:id` blocked on terminal statuses (`THESIS_CLOSED`). Participant fields (`advisorId`, `coAdvisorIds`, `conflictOfInterestUserIds`) only while `SUBMITTED` (`THESIS_NOT_EDITABLE`), because RN-01 depends on them. |
| Manuscripts | PDF only (the juror viewer is a PDF viewer). Upload: `COORDINATOR` or owner `STUDENT`. Download: `ADMIN`, `COORDINATOR`, owner `STUDENT`. Jurors get access in stage 3 ("only after accepting"). |
| Not-own thesis | A student requesting another student's thesis gets 404 `THESIS_NOT_FOUND` (no existence leak). |
| Bad references in a body | 400 with a specific code (`THESIS_INVALID_REFERENCE` + `details.field`, `PROGRAM_NOT_FOUND`, …). Unknown ids in the path → 404. Malformed ids in the path → 400 `VALIDATION_FAILED` (`ParseObjectIdPipe`). |
| File type check | Magic bytes, not the client MIME type: `%PDF-` (pdf), OLE header (doc), ZIP header + `word/` entry (docx). 25 MB limit → 413 `FILE_TOO_LARGE`; wrong type → 415 `FILE_TYPE_NOT_ALLOWED`. |
| Workflow concurrency | Read current status, validate against the transition table, then `findOneAndUpdate({_id, status: current})`. No match → 409 `WORKFLOW_STATUS_CONFLICT`. No transactions (memory server is standalone). |
| Workflow HTTP | None in this stage; later modules call `WorkflowService.transition()`. Event `thesis.status.changed` is emitted for stage 7 consumers. |

Also closes stage-1 review items: Mongoose `ValidationError`/`CastError` → 400, `MaxLength` on user strings, `_id` sort tie-breaker, uniform `toJSON` helper, `syncIndexes()` in the e2e app.

## File map

```
shared/src/
  catalogs.ts                       NEW  ProgramLevel, PeriodTerm
  files.ts                          NEW  FileKind
  thesis-status.ts                  MOD  + THESIS_TRANSITIONS, TERMINAL_THESIS_STATUSES
  error-codes.ts                    MOD  + catalog/thesis/workflow/file codes
  index.ts                          MOD  re-exports

server/src/common/
  filters/all-exceptions.filter.ts  MOD  Mongoose ValidationError/CastError → 400; 413 → FILE_TOO_LARGE
  pipes/parse-object-id.pipe.ts     NEW
  pagination/paginate.ts            NEW  buildSort() + paginate()
  mongoose/json-transform.ts        NEW  applyJsonTransform()
  validation/is-optional-non-null.ts NEW
  security/hash.ts                  MOD  sha256 accepts Buffer
  types/actor.ts                    NEW  Actor, actorFrom()

server/src/users/                   MOD  MaxLength, paginate(), applyJsonTransform, findManyByIds()
server/src/catalogs/                NEW  schemas (program, period, cohort), dto, service, controllers, module
server/src/files/                   NEW  file-type.ts, content-disposition.ts, files.service.ts, files.module.ts
server/src/theses/
  schemas/thesis.schema.ts          NEW
  schemas/counter.schema.ts         NEW
  thesis-code.ts                    NEW  formatThesisCode(), ThesisCodeService
  thesis-access.policy.ts           NEW  canReadThesis()
  dto/*.ts                          NEW
  theses.service.ts / theses.controller.ts / theses.module.ts NEW
server/src/workflow/
  workflow.rules.ts                 NEW  canTransition(), isTerminal()
  workflow.events.ts                NEW
  workflow.service.ts / workflow.module.ts NEW
server/src/app.module.ts            MOD  EventEmitterModule, CatalogsModule, FilesModule, WorkflowModule, ThesesModule

server/test/
  utils/test-app.ts                 MOD  syncIndexes, createCatalog(), createThesis(), binaryParser, PDF/DOCX fixtures
  catalogs.e2e-spec.ts / workflow.e2e-spec.ts / files.e2e-spec.ts
  theses.e2e-spec.ts / manuscripts.e2e-spec.ts / rbac.e2e-spec.ts   NEW
```

Commands (run from `server/`): `pnpm test` (unit, builds shared first), `pnpm test:e2e`, `pnpm lint`, `pnpm build`.

---

### Task 1: Shared enums and error codes, foundation hardening

**Files:**
- Create: `shared/src/catalogs.ts`, `shared/src/files.ts`
- Modify: `shared/src/thesis-status.ts`, `shared/src/error-codes.ts`, `shared/src/index.ts`
- Modify: `server/src/common/filters/all-exceptions.filter.ts`, `server/src/common/filters/all-exceptions.filter.spec.ts`
- Create: `server/src/common/pipes/parse-object-id.pipe.ts` (+ `.spec.ts`)
- Create: `server/src/common/pagination/paginate.ts` (+ `.spec.ts`)
- Create: `server/src/common/mongoose/json-transform.ts`
- Create: `server/src/common/validation/is-optional-non-null.ts`
- Create: `server/src/common/types/actor.ts` (+ `.spec.ts`)
- Modify: `server/src/common/security/hash.ts`
- Modify: `server/src/users/schemas/user.schema.ts`, `server/src/users/dto/create-user.dto.ts`, `server/src/users/users.service.ts`
- Modify: `server/test/utils/test-app.ts`, `server/test/users.e2e-spec.ts`

- [ ] **Step 1: Add shared enums**

`shared/src/catalogs.ts`:
```ts
export enum ProgramLevel {
  MASTER = 'MASTER',
  DOCTORATE = 'DOCTORATE',
}

export enum PeriodTerm {
  I = 'I',
  II = 'II',
}
```

`shared/src/files.ts`:
```ts
/** Stored in GridFS metadata.kind (spec §5). */
export enum FileKind {
  MANUSCRIPT = 'MANUSCRIPT',
  CORRECTION = 'CORRECTION',
  FEEDBACK_EVIDENCE = 'FEEDBACK_EVIDENCE',
  MINUTES_PDF = 'MINUTES_PDF',
}
```

Append to `shared/src/thesis-status.ts`:
```ts
/** Allowed transitions (spec §4). Terminal statuses map to an empty list. */
export const THESIS_TRANSITIONS: Readonly<
  Record<ThesisStatus, readonly ThesisStatus[]>
> = {
  [ThesisStatus.SUBMITTED]: [ThesisStatus.JURORS_ASSIGNED],
  [ThesisStatus.JURORS_ASSIGNED]: [
    ThesisStatus.UNDER_EVALUATION,
    ThesisStatus.PENDING_JUROR_REPLACEMENT,
  ],
  [ThesisStatus.PENDING_JUROR_REPLACEMENT]: [
    ThesisStatus.JURORS_ASSIGNED,
    ThesisStatus.UNDER_EVALUATION,
  ],
  [ThesisStatus.UNDER_EVALUATION]: [
    ThesisStatus.REVISIONS_IN_PROGRESS,
    ThesisStatus.READY_FOR_DEFENSE,
    ThesisStatus.IN_DISPUTE,
    ThesisStatus.NOT_APPROVED,
  ],
  [ThesisStatus.IN_DISPUTE]: [
    ThesisStatus.REVISIONS_IN_PROGRESS,
    ThesisStatus.READY_FOR_DEFENSE,
    ThesisStatus.NOT_APPROVED,
  ],
  [ThesisStatus.REVISIONS_IN_PROGRESS]: [ThesisStatus.READY_FOR_DEFENSE],
  [ThesisStatus.READY_FOR_DEFENSE]: [ThesisStatus.DEFENSE_SCHEDULED],
  [ThesisStatus.DEFENSE_SCHEDULED]: [
    ThesisStatus.COMPLETED_APPROVED,
    ThesisStatus.COMPLETED_FAILED,
  ],
  [ThesisStatus.NOT_APPROVED]: [],
  [ThesisStatus.COMPLETED_APPROVED]: [],
  [ThesisStatus.COMPLETED_FAILED]: [],
};

export const TERMINAL_THESIS_STATUSES: readonly ThesisStatus[] = (
  Object.keys(THESIS_TRANSITIONS) as ThesisStatus[]
).filter((s) => THESIS_TRANSITIONS[s].length === 0);
```

Add to `ErrorCode` in `shared/src/error-codes.ts` (after the users block):
```ts
  // catalogs
  PROGRAM_NOT_FOUND = 'PROGRAM_NOT_FOUND',
  PERIOD_NOT_FOUND = 'PERIOD_NOT_FOUND',
  COHORT_NOT_FOUND = 'COHORT_NOT_FOUND',
  COHORT_PROGRAM_MISMATCH = 'COHORT_PROGRAM_MISMATCH',
  PERIOD_INVALID_RANGE = 'PERIOD_INVALID_RANGE',
  // theses
  THESIS_NOT_FOUND = 'THESIS_NOT_FOUND',
  THESIS_INVALID_REFERENCE = 'THESIS_INVALID_REFERENCE',
  THESIS_STUDENT_HAS_ACTIVE = 'THESIS_STUDENT_HAS_ACTIVE',
  THESIS_NOT_EDITABLE = 'THESIS_NOT_EDITABLE',
  THESIS_CLOSED = 'THESIS_CLOSED',
  // workflow
  WORKFLOW_INVALID_TRANSITION = 'WORKFLOW_INVALID_TRANSITION',
  WORKFLOW_STATUS_CONFLICT = 'WORKFLOW_STATUS_CONFLICT',
  // files
  FILE_REQUIRED = 'FILE_REQUIRED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED = 'FILE_TYPE_NOT_ALLOWED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
```

`shared/src/index.ts`:
```ts
export * from './roles';
export * from './thesis-status';
export * from './error-codes';
export * from './catalogs';
export * from './files';
```

Run: `pnpm --filter @thesis/shared build` → exits 0.

- [ ] **Step 2: Write failing filter tests**

Append inside the `describe('toErrorBody', …)` block of `server/src/common/filters/all-exceptions.filter.spec.ts` (add `import { Error as MongooseError } from 'mongoose';` and `PayloadTooLargeException` to the `@nestjs/common` import):
```ts
  it('maps a Mongoose ValidationError to 400 VALIDATION_FAILED with paths', () => {
    const err = new MongooseError.ValidationError();
    err.addError(
      'firstName',
      new MongooseError.ValidatorError({
        path: 'firstName',
        message: 'Path `firstName` is required.',
      }),
    );
    expect(toErrorBody(err)).toEqual({
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details: [
        { path: 'firstName', message: 'Path `firstName` is required.' },
      ],
    });
  });

  it('maps a Mongoose CastError to 400 VALIDATION_FAILED', () => {
    const err = new MongooseError.CastError('ObjectId', 'nope', 'programId');
    expect(toErrorBody(err)).toEqual({
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Invalid value',
      details: [{ path: 'programId' }],
    });
  });

  it('maps 413 (multer file size limit) to FILE_TOO_LARGE', () => {
    expect(toErrorBody(new PayloadTooLargeException('File too large'))).toEqual(
      {
        statusCode: 413,
        code: ErrorCode.FILE_TOO_LARGE,
        message: 'File too large',
      },
    );
  });
```

Run: `cd server && pnpm test -- all-exceptions` → the three new tests FAIL (500 / HTTP_ERROR).

- [ ] **Step 3: Implement the filter changes**

In `server/src/common/filters/all-exceptions.filter.ts`:
1. Add `import { Error as MongooseError } from 'mongoose';`.
2. Add `413: ErrorCode.FILE_TOO_LARGE,` to `STATUS_CODES`.
3. Insert before the `isMongoDuplicateKey` check in `toErrorBody`:
```ts
  if (exception instanceof MongooseError.ValidationError) {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details: Object.values(exception.errors).map((e) => ({
        path: e.path,
        message: e.message,
      })),
    };
  }

  if (exception instanceof MongooseError.CastError) {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Invalid value',
      details: [{ path: exception.path }],
    };
  }
```

Run: `pnpm test -- all-exceptions` → PASS.

- [ ] **Step 4: ParseObjectIdPipe (test first)**

`server/src/common/pipes/parse-object-id.pipe.spec.ts`:
```ts
import { ErrorCode } from '@thesis/shared';
import { AppException } from '../errors/app.exception';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('returns a valid id lowercased', () => {
    expect(pipe.transform('65A1B2C3D4E5F60718293A4B')).toBe(
      '65a1b2c3d4e5f60718293a4b',
    );
  });

  it.each(['', 'abc', '65a1b2c3d4e5f60718293a4', 'zza1b2c3d4e5f60718293a4b'])(
    'rejects %p with VALIDATION_FAILED',
    (value) => {
      try {
        pipe.transform(value);
        fail('expected an exception');
      } catch (e) {
        expect(e).toBeInstanceOf(AppException);
        expect((e as AppException).code).toBe(ErrorCode.VALIDATION_FAILED);
        expect((e as AppException).getStatus()).toBe(400);
      }
    },
  );
});
```

Run: `pnpm test -- parse-object-id` → FAIL (module not found).

`server/src/common/pipes/parse-object-id.pipe.ts`:
```ts
import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';
import { AppException } from '../errors/app.exception';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Path-param guard: malformed ids answer 400 instead of reaching Mongoose. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Invalid id',
      );
    }
    return value.toLowerCase();
  }
}
```

Run: `pnpm test -- parse-object-id` → PASS.

- [ ] **Step 5: paginate helper (test first)**

`server/src/common/pagination/paginate.spec.ts`:
```ts
import { buildSort } from './paginate';

describe('buildSort', () => {
  const fields = { code: 'code', student: 'studentName' };

  it('maps the API field to the DB field and adds an _id tie-breaker', () => {
    expect(buildSort({ sort: 'student', order: 'desc' }, fields, 'code')).toEqual(
      { studentName: -1, _id: -1 },
    );
  });

  it('falls back to the default field for unknown or missing sort keys', () => {
    expect(buildSort({ sort: 'passwordHash', order: 'asc' }, fields, 'code')).toEqual(
      { code: 1, _id: 1 },
    );
    expect(buildSort({ order: 'asc' }, fields, 'code')).toEqual({
      code: 1,
      _id: 1,
    });
  });
});
```

Run: `pnpm test -- paginate` → FAIL.

`server/src/common/pagination/paginate.ts`:
```ts
import type {
  FilterQuery,
  HydratedDocument,
  Model,
  ProjectionType,
  SortOrder,
} from 'mongoose';
import { Paginated, PaginationQueryDto } from './pagination.dto';

/** API sort key → document path. Only whitelisted keys are sortable (sugerencia 6). */
export type SortFields = Readonly<Record<string, string>>;

export function buildSort(
  query: Pick<PaginationQueryDto, 'sort' | 'order'>,
  fields: SortFields,
  defaultField: string,
): Record<string, SortOrder> {
  const dir: SortOrder = query.order === 'desc' ? -1 : 1;
  const field =
    query.sort && Object.hasOwn(fields, query.sort)
      ? fields[query.sort]
      : defaultField;
  // _id makes the order total, so pages never repeat or skip documents on ties.
  return { [field]: dir, _id: dir };
}

export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  query: PaginationQueryDto,
  options: {
    sortFields: SortFields;
    defaultSort: string;
    projection?: ProjectionType<T>;
  },
): Promise<Paginated<HydratedDocument<T>>> {
  const [items, total] = await Promise.all([
    model
      .find(filter, options.projection)
      .sort(buildSort(query, options.sortFields, options.defaultSort))
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .exec(),
    model.countDocuments(filter).exec(),
  ]);
  return {
    items: items as HydratedDocument<T>[],
    total,
    page: query.page,
    limit: query.limit,
  };
}
```

Run: `pnpm test -- paginate` → PASS.

- [ ] **Step 6: Actor helper (test first)**

`server/src/common/types/actor.spec.ts`:
```ts
import { Role } from '@thesis/shared';
import { actorFrom } from './actor';

describe('actorFrom', () => {
  const user = {
    id: 'u1',
    email: 'a@b.co',
    roles: [Role.INTERNAL_JUROR, Role.COORDINATOR],
  };

  it('picks the first of the allowed roles that the user holds', () => {
    expect(actorFrom(user, Role.ADMIN, Role.COORDINATOR)).toEqual({
      id: 'u1',
      role: Role.COORDINATOR,
    });
  });

  it('falls back to the first user role when no allowed role is given', () => {
    expect(actorFrom(user)).toEqual({ id: 'u1', role: Role.INTERNAL_JUROR });
  });
});
```

`server/src/common/types/actor.ts`:
```ts
import { Role } from '@thesis/shared';
import { AuthUser } from './auth-user';

/** Who performed an action, as recorded in thesis history and audit. */
export interface Actor {
  id?: string;
  role: Role | 'SYSTEM';
}

export const SYSTEM_ACTOR: Actor = { role: 'SYSTEM' };

/** The role the user acted with: the first of `allowed` they hold (route's @Roles order). */
export function actorFrom(user: AuthUser, ...allowed: Role[]): Actor {
  const role = allowed.find((r) => user.roles.includes(r)) ?? user.roles[0];
  return { id: user.id, role };
}
```

Run: `pnpm test -- actor` → PASS.

- [ ] **Step 7: JSON transform, optional-non-null validator, sha256 over Buffer**

`server/src/common/mongoose/json-transform.ts`:
```ts
import type { Schema } from 'mongoose';

/**
 * Uniform API shape for every collection: `id` instead of `_id`, no `__v`, and the
 * given fields removed. Subdocument schemas must declare `{ _id: false, id: false }`.
 */
export function applyJsonTransform<S extends Schema>(
  schema: S,
  hiddenFields: readonly string[] = [],
): S {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      for (const field of hiddenFields) delete ret[field];
      return ret;
    },
  });
  return schema;
}
```

`server/src/common/validation/is-optional-non-null.ts`:
```ts
import { ValidateIf } from 'class-validator';

/** Like @IsOptional() but `null` is still validated (and therefore rejected). */
export const IsOptionalNonNull = () =>
  ValidateIf((_obj: unknown, value: unknown) => value !== undefined);
```

Replace `server/src/common/security/hash.ts`:
```ts
import { createHash } from 'node:crypto';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
```

- [ ] **Step 8: Users — toJSON helper, MaxLength, paginate, findManyByIds**

In `server/src/users/schemas/user.schema.ts`:
- Change both subdocument decorators to `@Schema({ _id: false, id: false })`.
- Change the `User` decorator to `@Schema({ timestamps: true })` (drop the inline `toJSON`).
- Replace `export const UserSchema = SchemaFactory.createForClass(User);` with:
```ts
export const UserSchema = applyJsonTransform(
  SchemaFactory.createForClass(User),
  ['passwordHash'],
);
```
  and add `import { applyJsonTransform } from '../../common/mongoose/json-transform';`.

In `server/src/users/dto/create-user.dto.ts` add `MaxLength` (and `ArrayMaxSize` to the import) as follows:
- `JurorProfileDto.institution`: `@MaxLength(200)`; `highestDegree`: `@MaxLength(100)`; `country`: `@MaxLength(100)`; `expertise`: `@ArrayMaxSize(20)` and `@MaxLength(100, { each: true })`.
- `StudentProfileDto.studentCode`: `@MaxLength(30)`.
- `CreateUserDto.firstName` / `lastName`: `@MaxLength(100)`; `documentId`: `@MaxLength(30)`.

In `server/src/users/users.service.ts`:
- Replace `USER_SORT_FIELDS` with
```ts
const USER_SORT_FIELDS: SortFields = {
  email: 'email',
  firstName: 'firstName',
  lastName: 'lastName',
  createdAt: 'createdAt',
};
```
- Replace the body of `list()` after the filter is built with:
```ts
    return paginate(this.model, filter, query, {
      sortFields: USER_SORT_FIELDS,
      defaultSort: 'createdAt',
    });
```
  (imports: `paginate, SortFields` from `../common/pagination/paginate`).
- Add:
```ts
  /** Bulk lookup used by other modules to validate references (theses, assignments). */
  findManyByIds(ids: readonly string[]): Promise<UserDocument[]> {
    const valid = ids.filter((id) => isValidObjectId(id));
    return this.model.find({ _id: { $in: valid } }).exec();
  }
```

- [ ] **Step 9: e2e app syncs indexes; regression test for null**

In `server/test/utils/test-app.ts`, inside `createTestApp()` after `await app.init();`:
```ts
  // Unique indexes must exist before the first test, otherwise duplicate-key tests race index builds.
  await app.get<Connection>(getConnectionToken()).syncIndexes();
```

Append to `server/test/users.e2e-spec.ts` (inside the top-level `describe`):
```ts
  it('rejects null for a required field with 400 instead of 500', async () => {
    const target = await createUser(app, { roles: [Role.COORDINATOR] });
    const res = await admin
      .patch(`/api/users/${target.id as string}`)
      .send({ firstName: null })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects names longer than 100 characters', async () => {
    const res = await admin
      .post('/api/users')
      .send({ ...newCoordinator, email: 'long@test.edu.co', firstName: 'x'.repeat(101) })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
```

- [ ] **Step 10: Verify and commit**

Run from `server/`: `pnpm test && pnpm test:e2e && pnpm lint && pnpm build` → all green.

```bash
git add shared server
git commit -m "feat: shared stage-2 enums, paginate/ObjectId/actor helpers, Mongoose errors as 400

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Catalogs module (programs, periods, cohorts)

**Files:**
- Create: `server/src/catalogs/schemas/program.schema.ts`, `period.schema.ts`, `cohort.schema.ts`
- Create: `server/src/catalogs/dto/program.dto.ts`, `period.dto.ts`, `cohort.dto.ts`
- Create: `server/src/catalogs/catalogs.service.ts`, `catalogs.controller.ts`, `catalogs.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/catalogs.e2e-spec.ts`; Modify: `server/test/utils/test-app.ts`

- [ ] **Step 1: Write the failing e2e test**

`server/test/catalogs.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import request from 'supertest';
import {
  closeTestApp,
  createTestApp,
  createUser,
  http,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Catalogs (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let student: TestAgent;
  let programId: string;
  let periodId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const c = await createUser(app, { roles: [Role.COORDINATOR] });
    const s = await createUser(app, { roles: [Role.STUDENT] });
    coordinator = await loginAgent(app, c.email);
    student = await loginAgent(app, s.email);
  });
  afterAll(() => closeTestApp(app));

  describe('programs', () => {
    it('coordinator creates a program (code uppercased)', async () => {
      const res = await coordinator
        .post('/api/programs')
        .send({ code: 'MIETIA', name: 'Maestría en Innovación Educativa', level: 'MASTER' })
        .expect(201);
      expect(res.body).toMatchObject({ code: 'MIETIA', level: 'MASTER', isActive: true });
      expect(res.body.id).toBeDefined();
      expect(res.body._id).toBeUndefined();
      programId = res.body.id;
    });

    it('rejects a duplicated code with DUPLICATE_KEY', async () => {
      const res = await coordinator
        .post('/api/programs')
        .send({ code: 'MIETIA', name: 'Otro', level: 'MASTER' })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE_KEY');
    });

    it('rejects an invalid code format', async () => {
      await coordinator
        .post('/api/programs')
        .send({ code: 'mi etia', name: 'X', level: 'MASTER' })
        .expect(400);
    });

    it('any authenticated user lists programs; anonymous gets 401', async () => {
      const res = await student.get('/api/programs').expect(200);
      expect(res.body.map((p: { code: string }) => p.code)).toEqual(['MIETIA']);
      await request(http(app)).get('/api/programs').expect(401);
    });

    it('student cannot create programs', async () => {
      await student
        .post('/api/programs')
        .send({ code: 'X1', name: 'X', level: 'MASTER' })
        .expect(403);
    });

    it('coordinator deactivates a program; code is immutable', async () => {
      const res = await coordinator
        .patch(`/api/programs/${programId}`)
        .send({ isActive: false })
        .expect(200);
      expect(res.body.isActive).toBe(false);
      await coordinator
        .patch(`/api/programs/${programId}`)
        .send({ code: 'OTHER' })
        .expect(400);
      await coordinator
        .patch(`/api/programs/${programId}`)
        .send({ isActive: true })
        .expect(200);
    });

    it('PATCH on an unknown program is 404 PROGRAM_NOT_FOUND; malformed id is 400', async () => {
      const res = await coordinator
        .patch('/api/programs/65a1b2c3d4e5f60718293a4b')
        .send({ name: 'X' })
        .expect(404);
      expect(res.body.code).toBe('PROGRAM_NOT_FOUND');
      await coordinator.patch('/api/programs/nope').send({ name: 'X' }).expect(400);
    });
  });

  describe('periods', () => {
    it('creates a period with a derived code', async () => {
      const res = await coordinator
        .post('/api/periods')
        .send({ year: 2026, term: 'II', startsAt: '2026-07-01', endsAt: '2026-12-15' })
        .expect(201);
      expect(res.body.code).toBe('2026-II');
      periodId = res.body.id;
    });

    it('rejects endsAt before startsAt with PERIOD_INVALID_RANGE', async () => {
      const res = await coordinator
        .post('/api/periods')
        .send({ year: 2027, term: 'I', startsAt: '2027-06-01', endsAt: '2027-01-01' })
        .expect(400);
      expect(res.body.code).toBe('PERIOD_INVALID_RANGE');
    });

    it('lists periods newest first', async () => {
      await coordinator
        .post('/api/periods')
        .send({ year: 2026, term: 'I', startsAt: '2026-01-15', endsAt: '2026-06-15' })
        .expect(201);
      const res = await student.get('/api/periods').expect(200);
      expect(res.body.map((p: { code: string }) => p.code)).toEqual(['2026-II', '2026-I']);
    });

    it('updates dates but validates the merged range', async () => {
      await coordinator
        .patch(`/api/periods/${periodId}`)
        .send({ endsAt: '2026-12-20' })
        .expect(200);
      const res = await coordinator
        .patch(`/api/periods/${periodId}`)
        .send({ endsAt: '2026-06-01' })
        .expect(400);
      expect(res.body.code).toBe('PERIOD_INVALID_RANGE');
    });
  });

  describe('cohorts', () => {
    it('creates a cohort for a program and period', async () => {
      const res = await coordinator
        .post('/api/cohorts')
        .send({ programId, periodId, number: 1, name: 'Corte 1' })
        .expect(201);
      expect(res.body).toMatchObject({ programId, periodId, number: 1, name: 'Corte 1' });
    });

    it('rejects a duplicated cohort number in the same program', async () => {
      await coordinator
        .post('/api/cohorts')
        .send({ programId, periodId, number: 1, name: 'Corte 1 bis' })
        .expect(409);
    });

    it('rejects unknown program or period references with 400', async () => {
      const unknown = '65a1b2c3d4e5f60718293a4b';
      const a = await coordinator
        .post('/api/cohorts')
        .send({ programId: unknown, periodId, number: 2, name: 'X' })
        .expect(400);
      expect(a.body.code).toBe('PROGRAM_NOT_FOUND');
      const b = await coordinator
        .post('/api/cohorts')
        .send({ programId, periodId: unknown, number: 2, name: 'X' })
        .expect(400);
      expect(b.body.code).toBe('PERIOD_NOT_FOUND');
    });

    it('filters cohorts by program and sorts by number', async () => {
      await coordinator
        .post('/api/cohorts')
        .send({ programId, periodId, number: 2, name: 'Corte 2' })
        .expect(201);
      const res = await student.get(`/api/cohorts?programId=${programId}`).expect(200);
      expect(res.body.map((c: { number: number }) => c.number)).toEqual([1, 2]);
    });
  });
});
```

Run: `pnpm test:e2e -- catalogs` → FAIL (404 on routes).

- [ ] **Step 2: Schemas**

`server/src/catalogs/schemas/program.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ProgramLevel } from '@thesis/shared';
import { HydratedDocument } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

@Schema({ timestamps: true })
export class Program {
  /** Used as the thesis code prefix (e.g. MIETIA-2026-II-001). */
  @Prop({ required: true, unique: true, uppercase: true, trim: true, maxlength: 20 })
  code!: string;

  @Prop({ required: true, trim: true, maxlength: 200 })
  name!: string;

  @Prop({ type: String, enum: Object.values(ProgramLevel), required: true })
  level!: ProgramLevel;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ index: true })
  seedTag?: string;
}

export type ProgramDocument = HydratedDocument<Program>;
export const ProgramSchema = applyJsonTransform(SchemaFactory.createForClass(Program));
```

`server/src/catalogs/schemas/period.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PeriodTerm } from '@thesis/shared';
import { HydratedDocument } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

@Schema({ timestamps: true })
export class Period {
  /** `${year}-${term}`, e.g. 2026-II. Set by CatalogsService, immutable. */
  @Prop({ required: true, unique: true })
  code!: string;

  @Prop({ required: true, min: 2000, max: 2100 })
  year!: number;

  @Prop({ type: String, enum: Object.values(PeriodTerm), required: true })
  term!: PeriodTerm;

  @Prop({ required: true })
  startsAt!: Date;

  @Prop({ required: true })
  endsAt!: Date;

  @Prop({ index: true })
  seedTag?: string;
}

export type PeriodDocument = HydratedDocument<Period>;
export const PeriodSchema = applyJsonTransform(SchemaFactory.createForClass(Period));
```

`server/src/catalogs/schemas/cohort.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

/** "Corte": numbered intake of a program, tied to its entry period (sugerencia 4). */
@Schema({ timestamps: true })
export class Cohort {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Program', required: true })
  programId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  number!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ index: true })
  seedTag?: string;
}

export type CohortDocument = HydratedDocument<Cohort>;
export const CohortSchema = applyJsonTransform(SchemaFactory.createForClass(Cohort));
CohortSchema.index({ programId: 1, number: 1 }, { unique: true });
```

- [ ] **Step 3: DTOs**

`server/src/catalogs/dto/program.dto.ts`:
```ts
import { OmitType, PartialType } from '@nestjs/swagger';
import { ProgramLevel } from '@thesis/shared';
import { IsBoolean, IsEnum, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class CreateProgramDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,20}$/)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEnum(ProgramLevel)
  level!: ProgramLevel;
}

export class UpdateProgramDto extends PartialType(OmitType(CreateProgramDto, ['code'] as const)) {
  @IsOptionalNonNull()
  @IsBoolean()
  isActive?: boolean;
}
```

`server/src/catalogs/dto/period.dto.ts`:
```ts
import { PeriodTerm } from '@thesis/shared';
import { IsDateString, IsEnum, IsInt, Max, Min } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class CreatePeriodDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsEnum(PeriodTerm)
  term!: PeriodTerm;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}

/** year/term are immutable because they form the code. */
export class UpdatePeriodDto {
  @IsOptionalNonNull()
  @IsDateString()
  startsAt?: string;

  @IsOptionalNonNull()
  @IsDateString()
  endsAt?: string;
}
```

`server/src/catalogs/dto/cohort.dto.ts`:
```ts
import { IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class CreateCohortDto {
  @IsMongoId()
  programId!: string;

  @IsInt()
  @Min(1)
  number!: number;

  @IsMongoId()
  periodId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

export class UpdateCohortDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptionalNonNull()
  @IsMongoId()
  periodId?: string;
}

export class QueryCohortsDto {
  @IsOptional()
  @IsMongoId()
  programId?: string;
}
```

- [ ] **Step 4: Service**

`server/src/catalogs/catalogs.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode } from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { CreateCohortDto, QueryCohortsDto, UpdateCohortDto } from './dto/cohort.dto';
import { CreatePeriodDto, UpdatePeriodDto } from './dto/period.dto';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';
import { Cohort, CohortDocument } from './schemas/cohort.schema';
import { Period, PeriodDocument } from './schemas/period.schema';
import { Program, ProgramDocument } from './schemas/program.schema';

const notFound = (code: ErrorCode, status: HttpStatus, what: string) =>
  new AppException(code, status, `${what} not found`);

@Injectable()
export class CatalogsService {
  constructor(
    @InjectModel(Program.name) private readonly programs: Model<Program>,
    @InjectModel(Period.name) private readonly periods: Model<Period>,
    @InjectModel(Cohort.name) private readonly cohorts: Model<Cohort>,
  ) {}

  // ---- lookups used by other modules (null when missing or malformed) ----

  findProgram(id: string): Promise<ProgramDocument | null> {
    return isValidObjectId(id) ? this.programs.findById(id).exec() : Promise.resolve(null);
  }

  findPeriod(id: string): Promise<PeriodDocument | null> {
    return isValidObjectId(id) ? this.periods.findById(id).exec() : Promise.resolve(null);
  }

  findCohort(id: string): Promise<CohortDocument | null> {
    return isValidObjectId(id) ? this.cohorts.findById(id).exec() : Promise.resolve(null);
  }

  // ---- programs ----

  listPrograms(): Promise<ProgramDocument[]> {
    return this.programs.find().sort({ code: 1 }).exec();
  }

  createProgram(dto: CreateProgramDto, seedTag?: string): Promise<ProgramDocument> {
    return this.programs.create({ ...dto, seedTag });
  }

  async updateProgram(id: string, dto: UpdateProgramDto): Promise<ProgramDocument> {
    const updated = await this.programs.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
    if (!updated) throw notFound(ErrorCode.PROGRAM_NOT_FOUND, HttpStatus.NOT_FOUND, 'Program');
    return updated;
  }

  // ---- periods ----

  listPeriods(): Promise<PeriodDocument[]> {
    return this.periods.find().sort({ year: -1, term: -1 }).exec();
  }

  createPeriod(dto: CreatePeriodDto, seedTag?: string): Promise<PeriodDocument> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertRange(startsAt, endsAt);
    return this.periods.create({
      code: `${dto.year}-${dto.term}`,
      year: dto.year,
      term: dto.term,
      startsAt,
      endsAt,
      seedTag,
    });
  }

  async updatePeriod(id: string, dto: UpdatePeriodDto): Promise<PeriodDocument> {
    const period = await this.periods.findById(id);
    if (!period) throw notFound(ErrorCode.PERIOD_NOT_FOUND, HttpStatus.NOT_FOUND, 'Period');
    if (dto.startsAt) period.startsAt = new Date(dto.startsAt);
    if (dto.endsAt) period.endsAt = new Date(dto.endsAt);
    this.assertRange(period.startsAt, period.endsAt);
    return period.save();
  }

  private assertRange(startsAt: Date, endsAt: Date): void {
    if (!(endsAt > startsAt)) {
      throw new AppException(
        ErrorCode.PERIOD_INVALID_RANGE,
        HttpStatus.BAD_REQUEST,
        'endsAt must be after startsAt',
      );
    }
  }

  // ---- cohorts ----

  listCohorts(query: QueryCohortsDto): Promise<CohortDocument[]> {
    const filter: FilterQuery<Cohort> = {};
    if (query.programId) filter.programId = query.programId;
    return this.cohorts.find(filter).sort({ programId: 1, number: 1 }).exec();
  }

  async createCohort(dto: CreateCohortDto, seedTag?: string): Promise<CohortDocument> {
    await this.assertReferences(dto.programId, dto.periodId);
    return this.cohorts.create({ ...dto, seedTag });
  }

  async updateCohort(id: string, dto: UpdateCohortDto): Promise<CohortDocument> {
    if (dto.periodId) await this.assertReferences(undefined, dto.periodId);
    const updated = await this.cohorts.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
    if (!updated) throw notFound(ErrorCode.COHORT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Cohort');
    return updated;
  }

  /** Body references that do not exist are client errors (400), not missing resources. */
  private async assertReferences(programId?: string, periodId?: string): Promise<void> {
    if (programId && !(await this.programs.exists({ _id: programId }))) {
      throw notFound(ErrorCode.PROGRAM_NOT_FOUND, HttpStatus.BAD_REQUEST, 'Program');
    }
    if (periodId && !(await this.periods.exists({ _id: periodId }))) {
      throw notFound(ErrorCode.PERIOD_NOT_FOUND, HttpStatus.BAD_REQUEST, 'Period');
    }
  }
}
```

- [ ] **Step 5: Controllers and module**

`server/src/catalogs/catalogs.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CatalogsService } from './catalogs.service';
import { CreateCohortDto, QueryCohortsDto, UpdateCohortDto } from './dto/cohort.dto';
import { CreatePeriodDto, UpdatePeriodDto } from './dto/period.dto';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';

const MANAGERS = [Role.ADMIN, Role.COORDINATOR] as const;

@ApiTags('catalogs')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list() {
    return this.catalogs.listPrograms();
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body() dto: CreateProgramDto) {
    return this.catalogs.createProgram(dto);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateProgramDto) {
    return this.catalogs.updateProgram(id, dto);
  }
}

@ApiTags('catalogs')
@Controller('periods')
export class PeriodsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list() {
    return this.catalogs.listPeriods();
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body() dto: CreatePeriodDto) {
    return this.catalogs.createPeriod(dto);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePeriodDto) {
    return this.catalogs.updatePeriod(id, dto);
  }
}

@ApiTags('catalogs')
@Controller('cohorts')
export class CohortsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list(@Query() query: QueryCohortsDto) {
    return this.catalogs.listCohorts(query);
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body() dto: CreateCohortDto) {
    return this.catalogs.createCohort(dto);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCohortDto) {
    return this.catalogs.updateCohort(id, dto);
  }
}
```

`server/src/catalogs/catalogs.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CohortsController, PeriodsController, ProgramsController } from './catalogs.controller';
import { CatalogsService } from './catalogs.service';
import { Cohort, CohortSchema } from './schemas/cohort.schema';
import { Period, PeriodSchema } from './schemas/period.schema';
import { Program, ProgramSchema } from './schemas/program.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Program.name, schema: ProgramSchema },
      { name: Period.name, schema: PeriodSchema },
      { name: Cohort.name, schema: CohortSchema },
    ]),
  ],
  controllers: [ProgramsController, PeriodsController, CohortsController],
  providers: [CatalogsService],
  exports: [CatalogsService],
})
export class CatalogsModule {}
```

Add `CatalogsModule` to the `imports` of `server/src/app.module.ts`.

- [ ] **Step 6: Catalog fixture helper for later tasks**

Append to `server/test/utils/test-app.ts` (import `CatalogsService` from `../../src/catalogs/catalogs.service` and `PeriodTerm, ProgramLevel` from `@thesis/shared`):
```ts
export interface CatalogFixture {
  programId: string;
  periodId: string;
  cohortId: string;
}

/** Creates a program, period and cohort with unique codes. */
export async function createCatalog(
  app: INestApplication,
  opts: { programCode?: string; year?: number; term?: PeriodTerm } = {},
): Promise<CatalogFixture> {
  const catalogs = app.get(CatalogsService);
  const program = await catalogs.createProgram({
    code: opts.programCode ?? `P${randomUUID().slice(0, 6).toUpperCase()}`,
    name: 'Programa de prueba',
    level: ProgramLevel.MASTER,
  });
  const year = opts.year ?? 2000 + Math.floor(Math.random() * 100);
  const term = opts.term ?? PeriodTerm.II;
  const period =
    (await catalogs.listPeriods()).find((p) => p.code === `${year}-${term}`) ??
    (await catalogs.createPeriod({
      year,
      term,
      startsAt: `${year}-07-01`,
      endsAt: `${year}-12-15`,
    }));
  const cohort = await catalogs.createCohort({
    programId: program.id as string,
    periodId: period.id as string,
    number: 1,
    name: 'Corte 1',
  });
  return {
    programId: program.id as string,
    periodId: period.id as string,
    cohortId: cohort.id as string,
  };
}
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm test:e2e -- catalogs` → PASS. Then `pnpm test && pnpm test:e2e && pnpm lint && pnpm build` → green.

```bash
git add server
git commit -m "feat(server): catalogs module for programs, periods and cohorts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Thesis schema, code generator and workflow rules (pure units)

**Files:**
- Create: `server/src/theses/schemas/thesis.schema.ts`, `server/src/theses/schemas/counter.schema.ts`
- Create: `server/src/theses/thesis-code.ts` (+ `thesis-code.spec.ts`)
- Create: `server/src/workflow/workflow.rules.ts` (+ `workflow.rules.spec.ts`)

- [ ] **Step 1: Failing unit tests**

`server/src/workflow/workflow.rules.spec.ts`:
```ts
import { THESIS_PROGRESS, ThesisStatus as S } from '@thesis/shared';
import { canTransition, isTerminal } from './workflow.rules';

describe('workflow rules (spec §4)', () => {
  it.each([
    [S.SUBMITTED, S.JURORS_ASSIGNED],
    [S.JURORS_ASSIGNED, S.UNDER_EVALUATION],
    [S.JURORS_ASSIGNED, S.PENDING_JUROR_REPLACEMENT],
    [S.PENDING_JUROR_REPLACEMENT, S.JURORS_ASSIGNED],
    [S.PENDING_JUROR_REPLACEMENT, S.UNDER_EVALUATION],
    [S.UNDER_EVALUATION, S.REVISIONS_IN_PROGRESS],
    [S.UNDER_EVALUATION, S.READY_FOR_DEFENSE],
    [S.UNDER_EVALUATION, S.IN_DISPUTE],
    [S.UNDER_EVALUATION, S.NOT_APPROVED],
    [S.IN_DISPUTE, S.REVISIONS_IN_PROGRESS],
    [S.IN_DISPUTE, S.READY_FOR_DEFENSE],
    [S.IN_DISPUTE, S.NOT_APPROVED],
    [S.REVISIONS_IN_PROGRESS, S.READY_FOR_DEFENSE],
    [S.READY_FOR_DEFENSE, S.DEFENSE_SCHEDULED],
    [S.DEFENSE_SCHEDULED, S.COMPLETED_APPROVED],
    [S.DEFENSE_SCHEDULED, S.COMPLETED_FAILED],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [S.SUBMITTED, S.UNDER_EVALUATION],
    [S.SUBMITTED, S.SUBMITTED],
    [S.REVISIONS_IN_PROGRESS, S.IN_DISPUTE],
    [S.READY_FOR_DEFENSE, S.COMPLETED_APPROVED],
    [S.NOT_APPROVED, S.SUBMITTED],
    [S.COMPLETED_APPROVED, S.COMPLETED_FAILED],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only NOT_APPROVED and COMPLETED_* are terminal, all at 100%', () => {
    const terminal = Object.values(S).filter(isTerminal);
    expect(terminal.sort()).toEqual(
      [S.COMPLETED_APPROVED, S.COMPLETED_FAILED, S.NOT_APPROVED].sort(),
    );
    for (const s of terminal) expect(THESIS_PROGRESS[s]).toBe(100);
  });
});
```

`server/src/theses/thesis-code.spec.ts`:
```ts
import { codePrefix, formatThesisCode } from './thesis-code';

describe('thesis code (sugerencia 5)', () => {
  it('builds PROGRAM-PERIOD prefix, optionally with a seed tag', () => {
    expect(codePrefix('MIETIA', '2026-II')).toBe('MIETIA-2026-II');
    expect(codePrefix('MIETIA', '2026-II', 'TEST')).toBe('TEST-MIETIA-2026-II');
  });

  it('pads the sequence to three digits and keeps larger numbers', () => {
    expect(formatThesisCode('MIETIA-2026-II', 1)).toBe('MIETIA-2026-II-001');
    expect(formatThesisCode('MIETIA-2026-II', 42)).toBe('MIETIA-2026-II-042');
    expect(formatThesisCode('MIETIA-2026-II', 1234)).toBe('MIETIA-2026-II-1234');
  });
});
```

Run: `pnpm test -- workflow.rules thesis-code` → FAIL.

- [ ] **Step 2: Workflow rules**

`server/src/workflow/workflow.rules.ts`:
```ts
import { THESIS_TRANSITIONS, ThesisStatus } from '@thesis/shared';

export function canTransition(from: ThesisStatus, to: ThesisStatus): boolean {
  return THESIS_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ThesisStatus): boolean {
  return THESIS_TRANSITIONS[status].length === 0;
}
```

- [ ] **Step 3: Counter schema and code generator**

`server/src/theses/schemas/counter.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Named monotonic sequences, e.g. `thesis:MIETIA-2026-II`. */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
```

`server/src/theses/thesis-code.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Counter } from './schemas/counter.schema';

export function codePrefix(programCode: string, periodCode: string, seedTag?: string): string {
  const base = `${programCode}-${periodCode}`;
  return seedTag ? `${seedTag}-${base}` : base;
}

export function formatThesisCode(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

@Injectable()
export class ThesisCodeService {
  constructor(@InjectModel(Counter.name) private readonly counters: Model<Counter>) {}

  /** Atomic per-prefix sequence: concurrent registrations never share a number. */
  async next(programCode: string, periodCode: string, seedTag?: string): Promise<string> {
    const prefix = codePrefix(programCode, periodCode, seedTag);
    const counter = await this.counters.findOneAndUpdate(
      { _id: `thesis:${prefix}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return formatThesisCode(prefix, counter.seq);
  }
}
```

- [ ] **Step 4: Thesis schema**

`server/src/theses/schemas/thesis.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ThesisStatus } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ _id: false, id: false })
export class ManuscriptVersion {
  @Prop({ type: ObjectId, required: true })
  fileId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version!: number;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  uploadedAt!: Date;

  @Prop({ type: ObjectId, required: true })
  uploadedBy!: Types.ObjectId;
}
export const ManuscriptVersionSchema = SchemaFactory.createForClass(ManuscriptVersion);

/** One entry per status change; feeds the traceability graph (CU-07). */
@Schema({ _id: false, id: false })
export class HistoryEntry {
  /** null for the initial SUBMITTED entry. */
  @Prop({ type: String, enum: [...Object.values(ThesisStatus), null], default: null })
  from!: ThesisStatus | null;

  @Prop({ type: String, enum: Object.values(ThesisStatus), required: true })
  to!: ThesisStatus;

  @Prop({ required: true })
  at!: Date;

  @Prop({ type: ObjectId })
  actorId?: Types.ObjectId;

  /** A Role, or SYSTEM for scheduler-driven changes. */
  @Prop({ required: true })
  actorRole!: string;

  @Prop({ maxlength: 1000 })
  reason?: string;

  @Prop({ type: [ObjectId], default: [] })
  evidenceFileIds!: Types.ObjectId[];
}
export const HistoryEntrySchema = SchemaFactory.createForClass(HistoryEntry);

@Schema({ timestamps: true })
export class Thesis {
  @Prop({ required: true, unique: true })
  code!: string;

  @Prop({ required: true, trim: true, maxlength: 300 })
  title!: string;

  @Prop({ trim: true, maxlength: 5000 })
  abstract?: string;

  @Prop({ type: [String], default: [] })
  keywords!: string[];

  @Prop({ type: ObjectId, ref: 'User', required: true })
  studentId!: Types.ObjectId;

  /** Denormalized "First Last" for sort=student and text search. */
  @Prop({ required: true })
  studentName!: string;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  advisorId!: Types.ObjectId;

  @Prop({ type: [ObjectId], ref: 'User', default: [] })
  coAdvisorIds!: Types.ObjectId[];

  @Prop({ type: ObjectId, ref: 'Program', required: true })
  programId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'Cohort', required: true })
  cohortId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  /** Only WorkflowService changes this after creation. */
  @Prop({ type: String, enum: Object.values(ThesisStatus), required: true, default: ThesisStatus.SUBMITTED })
  status!: ThesisStatus;

  @Prop({ required: true, min: 0, max: 100 })
  progress!: number;

  @Prop({ type: [ManuscriptVersionSchema], default: [] })
  manuscripts!: ManuscriptVersion[];

  /** Last manuscript version number; guards concurrent uploads. */
  @Prop({ default: 0 })
  manuscriptSeq!: number;

  @Prop({ type: ObjectId })
  currentManuscriptId?: Types.ObjectId;

  /** RN-01: documented conflicts in addition to advisor/co-advisors/student. */
  @Prop({ type: [ObjectId], ref: 'User', default: [] })
  conflictOfInterestUserIds!: Types.ObjectId[];

  @Prop({ type: [HistoryEntrySchema], default: [] })
  history!: HistoryEntry[];

  @Prop()
  seedTag?: string;
}

export type ThesisDocument = HydratedDocument<Thesis>;
export const ThesisSchema = applyJsonTransform(SchemaFactory.createForClass(Thesis));
ThesisSchema.index({ status: 1 });
ThesisSchema.index({ periodId: 1, cohortId: 1 });
ThesisSchema.index({ programId: 1 });
ThesisSchema.index({ studentId: 1 });
ThesisSchema.index({ seedTag: 1 });
ThesisSchema.index({ title: 'text', code: 'text' });
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- workflow.rules thesis-code` → PASS. `pnpm lint && pnpm build` → green.

```bash
git add server
git commit -m "feat(server): thesis schema, code generator and workflow transition rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: WorkflowService (state machine with history and events)

**Files:**
- Modify: `server/package.json` (dependency `@nestjs/event-emitter`)
- Create: `server/src/workflow/workflow.events.ts`, `workflow.service.ts`, `workflow.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/workflow.e2e-spec.ts`

- [ ] **Step 1: Install the event emitter (v3 line supports Nest 11, CommonJS)**

Run from `server/`: `pnpm add @nestjs/event-emitter@^3.0.0`
Then confirm it is CommonJS: `node -e "require('@nestjs/event-emitter'); console.log('ok')"` → prints `ok`. If it fails with `ERR_REQUIRE_ESM`, stop and report (do not upgrade other `@nestjs/*` packages).

- [ ] **Step 2: Write the failing e2e test**

`server/test/workflow.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Role, ThesisStatus as S } from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  THESIS_STATUS_CHANGED,
  ThesisStatusChangedEvent,
} from '../src/workflow/workflow.events';
import { WorkflowService } from '../src/workflow/workflow.service';
import { closeTestApp, createTestApp } from './utils/test-app';

describe('WorkflowService (e2e)', () => {
  let app: INestApplication;
  let workflow: WorkflowService;
  let theses: Model<Thesis>;
  const actor = { id: new Types.ObjectId().toHexString(), role: Role.COORDINATOR };

  beforeAll(async () => {
    app = await createTestApp();
    workflow = app.get(WorkflowService);
    theses = app.get(getModelToken(Thesis.name));
  });
  afterAll(() => closeTestApp(app));

  const insertThesis = (status: S) =>
    theses.create({
      code: `WF-${new Types.ObjectId().toHexString()}`,
      title: 'Tesis de prueba',
      studentId: new Types.ObjectId(),
      studentName: 'Laura Pérez',
      advisorId: new Types.ObjectId(),
      programId: new Types.ObjectId(),
      cohortId: new Types.ObjectId(),
      periodId: new Types.ObjectId(),
      status,
      progress: 10,
    });

  it('applies an allowed transition, sets progress and appends history', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const updated = await workflow.transition({
      thesisId: t.id as string,
      to: S.JURORS_ASSIGNED,
      actor,
      reason: 'CU-01',
    });
    expect(updated.status).toBe(S.JURORS_ASSIGNED);
    expect(updated.progress).toBe(25);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]).toMatchObject({
      from: S.SUBMITTED,
      to: S.JURORS_ASSIGNED,
      actorRole: Role.COORDINATOR,
      reason: 'CU-01',
    });
    expect(updated.history[0].actorId?.toHexString()).toBe(actor.id);
  });

  it('emits thesis.status.changed', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const events: ThesisStatusChangedEvent[] = [];
    const emitter = app.get(EventEmitter2);
    const listener = (e: ThesisStatusChangedEvent) => events.push(e);
    emitter.on(THESIS_STATUS_CHANGED, listener);
    await workflow.transition({ thesisId: t.id as string, to: S.JURORS_ASSIGNED, actor });
    emitter.off(THESIS_STATUS_CHANGED, listener);
    expect(events).toEqual([
      expect.objectContaining({
        thesisId: t.id,
        from: S.SUBMITTED,
        to: S.JURORS_ASSIGNED,
        actorRole: Role.COORDINATOR,
      }),
    ]);
  });

  it('rejects a transition not in the table with WORKFLOW_INVALID_TRANSITION', async () => {
    const t = await insertThesis(S.SUBMITTED);
    await expect(
      workflow.transition({ thesisId: t.id as string, to: S.READY_FOR_DEFENSE, actor }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID_TRANSITION' });
    expect((await theses.findById(t.id))?.status).toBe(S.SUBMITTED);
  });

  it('rejects when the current status is not one of expectedFrom', async () => {
    const t = await insertThesis(S.JURORS_ASSIGNED);
    await expect(
      workflow.transition({
        thesisId: t.id as string,
        expectedFrom: [S.PENDING_JUROR_REPLACEMENT],
        to: S.UNDER_EVALUATION,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID_TRANSITION' });
  });

  it('only one of two concurrent identical transitions wins', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const results = await Promise.allSettled([
      workflow.transition({ thesisId: t.id as string, to: S.JURORS_ASSIGNED, actor }),
      workflow.transition({ thesisId: t.id as string, to: S.JURORS_ASSIGNED, actor }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
      code: expect.stringMatching(/WORKFLOW_STATUS_CONFLICT|WORKFLOW_INVALID_TRANSITION/),
    });
    expect((await theses.findById(t.id))?.history).toHaveLength(1);
  });

  it('unknown thesis → THESIS_NOT_FOUND', async () => {
    await expect(
      workflow.transition({
        thesisId: new Types.ObjectId().toHexString(),
        to: S.JURORS_ASSIGNED,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'THESIS_NOT_FOUND' });
  });
});
```

Run: `pnpm test:e2e -- workflow` → FAIL (modules missing).

- [ ] **Step 3: Events, service, module**

`server/src/workflow/workflow.events.ts`:
```ts
import { ThesisStatus } from '@thesis/shared';

export const THESIS_STATUS_CHANGED = 'thesis.status.changed';

/** Consumed by notifications and audit (stage 7). */
export interface ThesisStatusChangedEvent {
  thesisId: string;
  from: ThesisStatus;
  to: ThesisStatus;
  actorId?: string;
  actorRole: string;
  reason?: string;
  at: Date;
}
```

`server/src/workflow/workflow.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, THESIS_PROGRESS, ThesisStatus } from '@thesis/shared';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { Actor } from '../common/types/actor';
import { HistoryEntry, Thesis, ThesisDocument } from '../theses/schemas/thesis.schema';
import { canTransition } from './workflow.rules';
import { THESIS_STATUS_CHANGED, ThesisStatusChangedEvent } from './workflow.events';

export interface TransitionInput {
  thesisId: string;
  to: ThesisStatus;
  actor: Actor;
  /** Extra guard for callers that only accept some source statuses. */
  expectedFrom?: readonly ThesisStatus[];
  reason?: string;
  evidenceFileIds?: readonly string[];
}

/**
 * The only code path that changes thesis.status (spec §1). Single-document conditional
 * update on the status that was validated, so concurrent callers cannot both apply a
 * transition from the same state; no multi-document transaction is needed.
 */
@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(Thesis.name) private readonly theses: Model<Thesis>,
    private readonly events: EventEmitter2,
  ) {}

  async transition(input: TransitionInput): Promise<ThesisDocument> {
    const current = isValidObjectId(input.thesisId)
      ? await this.theses.findById(input.thesisId, 'status').exec()
      : null;
    if (!current) {
      throw new AppException(ErrorCode.THESIS_NOT_FOUND, HttpStatus.NOT_FOUND, 'Thesis not found');
    }
    const from = current.status;
    const expected = !input.expectedFrom || input.expectedFrom.includes(from);
    if (!expected || !canTransition(from, input.to)) {
      throw new AppException(
        ErrorCode.WORKFLOW_INVALID_TRANSITION,
        HttpStatus.CONFLICT,
        `Cannot move thesis from ${from} to ${input.to}`,
        { from, to: input.to },
      );
    }

    const at = new Date();
    const entry: HistoryEntry = {
      from,
      to: input.to,
      at,
      actorId: input.actor.id ? new Types.ObjectId(input.actor.id) : undefined,
      actorRole: input.actor.role,
      reason: input.reason,
      evidenceFileIds: (input.evidenceFileIds ?? []).map((id) => new Types.ObjectId(id)),
    };
    const updated = await this.theses
      .findOneAndUpdate(
        { _id: current._id, status: from },
        { $set: { status: input.to, progress: THESIS_PROGRESS[input.to] }, $push: { history: entry } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new AppException(
        ErrorCode.WORKFLOW_STATUS_CONFLICT,
        HttpStatus.CONFLICT,
        'Thesis status changed concurrently',
        { from, to: input.to },
      );
    }

    const event: ThesisStatusChangedEvent = {
      thesisId: updated.id as string,
      from,
      to: input.to,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      reason: input.reason,
      at,
    };
    this.events.emit(THESIS_STATUS_CHANGED, event);
    return updated;
  }
}
```

`server/src/workflow/workflow.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Thesis, ThesisSchema } from '../theses/schemas/thesis.schema';
import { WorkflowService } from './workflow.service';

@Module({
  // Same model as ThesesModule on the same connection; avoids a ThesesModule ↔ WorkflowModule cycle.
  imports: [MongooseModule.forFeature([{ name: Thesis.name, schema: ThesisSchema }])],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
```

In `server/src/app.module.ts` add `import { EventEmitterModule } from '@nestjs/event-emitter';`, `EventEmitterModule.forRoot()` (first in `imports` after `ConfigModule`), and `WorkflowModule`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test:e2e -- workflow` → PASS. Full suite + lint + build → green.

```bash
git add server
git commit -m "feat(server): WorkflowService with conditional transitions, history and events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Files module (GridFS)

**Files:**
- Modify: `server/package.json` (devDependency `@types/multer`)
- Create: `server/src/files/file-type.ts` (+ `.spec.ts`), `server/src/files/content-disposition.ts` (+ `.spec.ts`)
- Create: `server/src/files/files.service.ts`, `server/src/files/files.module.ts`
- Modify: `server/src/app.module.ts`
- Modify: `server/test/utils/test-app.ts`
- Test: `server/test/files.e2e-spec.ts`

- [ ] **Step 1: Install multer types**

Run from `server/`: `pnpm add -D @types/multer`

- [ ] **Step 2: Failing unit tests**

`server/src/files/file-type.spec.ts`:
```ts
import { detectFileType } from './file-type';

const zip = (...names: string[]) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), ...names.map((n) => Buffer.from(n))]);

describe('detectFileType', () => {
  it('detects PDF by its %PDF- header', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
  });

  it('detects legacy Word (OLE compound file)', () => {
    expect(
      detectFileType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])),
    ).toBe('doc');
  });

  it('detects docx as a ZIP containing word/ entries', () => {
    expect(detectFileType(zip('[Content_Types].xml', 'word/document.xml'))).toBe('docx');
  });

  it('rejects other ZIPs, text, empty and short buffers', () => {
    expect(detectFileType(zip('xl/workbook.xml'))).toBeNull();
    expect(detectFileType(Buffer.from('hello'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
    expect(detectFileType(Buffer.from('%PD'))).toBeNull();
  });
});
```

`server/src/files/content-disposition.spec.ts`:
```ts
import { contentDisposition, sanitizeFileName } from './content-disposition';

describe('file names', () => {
  it('strips paths and control characters and caps the length', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\x\\tesis\u0000.pdf')).toBe('tesis.pdf');
    expect(sanitizeFileName('a'.repeat(300) + '.pdf')).toHaveLength(200);
    expect(sanitizeFileName('   ')).toBe('file');
  });

  it('builds an attachment header with an ASCII fallback and RFC 5987 UTF-8 name', () => {
    expect(contentDisposition('Tesis versión 1.pdf')).toBe(
      `attachment; filename="Tesis versi_n 1.pdf"; filename*=UTF-8''Tesis%20versi%C3%B3n%201.pdf`,
    );
  });
});
```

Run: `pnpm test -- file-type content-disposition` → FAIL.

- [ ] **Step 3: Implement the pure helpers**

`server/src/files/file-type.ts`:
```ts
export type AllowedFileType = 'pdf' | 'doc' | 'docx';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const MIME_TYPES: Readonly<Record<AllowedFileType, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Type from magic bytes; the client-declared MIME type is never trusted. */
export function detectFileType(buf: Buffer): AllowedFileType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE)) return 'doc';
  // ZIP local headers store entry names uncompressed; docx packages have word/* entries.
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZIP) && buf.includes('word/')) return 'docx';
  return null;
}
```

`server/src/files/content-disposition.ts`:
```ts
const MAX_NAME = 200;

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'file').slice(0, MAX_NAME);
}

export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
```

Run: `pnpm test -- file-type content-disposition` → PASS.

- [ ] **Step 4: Failing e2e for FilesService**

Add to `server/test/utils/test-app.ts`:
```ts
/** Minimal buffers that pass magic-byte detection. */
export const PDF_BYTES = Buffer.from('%PDF-1.4\n% test manuscript\n%%EOF\n');
export const DOCX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(26),
  Buffer.from('word/document.xml'),
]);

/** supertest parser that collects binary responses into a Buffer. */
export const binaryParser = (
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
```

`server/test/files.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { FileKind } from '@thesis/shared';
import { Types } from 'mongoose';
import { text } from 'node:stream/consumers';
import { sha256 } from '../src/common/security/hash';
import { FilesService } from '../src/files/files.service';
import { MAX_FILE_BYTES } from '../src/files/file-type';
import { closeTestApp, createTestApp, DOCX_BYTES, PDF_BYTES } from './utils/test-app';

describe('FilesService (e2e, GridFS)', () => {
  let app: INestApplication;
  let files: FilesService;
  const ownerId = new Types.ObjectId().toHexString();

  beforeAll(async () => {
    app = await createTestApp();
    files = app.get(FilesService);
  });
  afterAll(() => closeTestApp(app));

  const input = (buffer: Buffer, originalname = 'tesis.pdf') => ({
    buffer,
    originalname,
    size: buffer.length,
  });

  it('stores a PDF with metadata and streams it back', async () => {
    const stored = await files.upload(input(PDF_BYTES), { ownerId, kind: FileKind.MANUSCRIPT }, ['pdf']);
    expect(stored).toMatchObject({
      fileName: 'tesis.pdf',
      size: PDF_BYTES.length,
      mimeType: 'application/pdf',
      sha256: sha256(PDF_BYTES),
      kind: FileKind.MANUSCRIPT,
    });
    const { info, stream } = await files.openDownload(stored.id);
    expect(info.metadata).toMatchObject({ kind: FileKind.MANUSCRIPT, mimeType: 'application/pdf' });
    expect(await text(stream)).toBe(PDF_BYTES.toString());
  });

  it('accepts docx where allowed and labels its MIME type', async () => {
    const stored = await files.upload(input(DOCX_BYTES, 'correcciones.docx'), { ownerId, kind: FileKind.CORRECTION }, ['pdf', 'doc', 'docx']);
    expect(stored.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('rejects a disallowed type with 415 FILE_TYPE_NOT_ALLOWED', async () => {
    await expect(
      files.upload(input(DOCX_BYTES, 'x.pdf'), { ownerId, kind: FileKind.MANUSCRIPT }, ['pdf']),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', status: 415 });
  });

  it('rejects a missing or oversized file', async () => {
    await expect(files.upload(undefined, { ownerId, kind: FileKind.MANUSCRIPT }, ['pdf'])).rejects.toMatchObject({ code: 'FILE_REQUIRED' });
    await expect(
      files.upload({ ...input(PDF_BYTES), size: MAX_FILE_BYTES + 1 }, { ownerId, kind: FileKind.MANUSCRIPT }, ['pdf']),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 });
  });

  it('delete removes the file; unknown ids → FILE_NOT_FOUND', async () => {
    const stored = await files.upload(input(PDF_BYTES), { ownerId, kind: FileKind.MANUSCRIPT }, ['pdf']);
    await files.delete(stored.id);
    await expect(files.openDownload(stored.id)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    await expect(files.delete(stored.id)).resolves.toBeUndefined();
  });
});
```

Run: `pnpm test:e2e -- files` → FAIL.

- [ ] **Step 5: FilesService and module**

`server/src/files/files.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ErrorCode, FileKind } from '@thesis/shared';
import { Connection, isValidObjectId, mongo, Types } from 'mongoose';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
import { sanitizeFileName } from './content-disposition';
import { AllowedFileType, detectFileType, MAX_FILE_BYTES, MIME_TYPES } from './file-type';

/** The subset of Express.Multer.File the service needs (also easy to build in tests/seed). */
export interface UploadInput {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface FileMetadata {
  ownerId: Types.ObjectId;
  thesisId?: Types.ObjectId;
  kind: FileKind;
  mimeType: string;
  sha256: string;
}

export interface StoredFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  sha256: string;
  kind: FileKind;
}

export type GridFile = mongo.GridFSFile & { metadata?: FileMetadata };

@Injectable()
export class FilesService {
  private bucketInstance?: mongo.GridFSBucket;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Lazy: `connection.db` is only set once the connection is open. */
  private get bucket(): mongo.GridFSBucket {
    this.bucketInstance ??= new mongo.GridFSBucket(this.connection.db!, { bucketName: 'files' });
    return this.bucketInstance;
  }

  async upload(
    file: UploadInput | undefined,
    meta: { ownerId: string; thesisId?: string; kind: FileKind },
    allowed: readonly AllowedFileType[],
  ): Promise<StoredFile> {
    if (!file?.buffer?.length) {
      throw new AppException(ErrorCode.FILE_REQUIRED, HttpStatus.BAD_REQUEST, 'A file is required');
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) {
      throw new AppException(ErrorCode.FILE_TOO_LARGE, HttpStatus.PAYLOAD_TOO_LARGE, 'File exceeds 25 MB');
    }
    const type = detectFileType(file.buffer);
    if (!type || !allowed.includes(type)) {
      throw new AppException(
        ErrorCode.FILE_TYPE_NOT_ALLOWED,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'File type not allowed',
        { allowed },
      );
    }

    const id = new Types.ObjectId();
    const fileName = sanitizeFileName(file.originalname);
    const metadata: FileMetadata = {
      ownerId: new Types.ObjectId(meta.ownerId),
      thesisId: meta.thesisId ? new Types.ObjectId(meta.thesisId) : undefined,
      kind: meta.kind,
      mimeType: MIME_TYPES[type],
      sha256: sha256(file.buffer),
    };
    await pipeline(
      Readable.from(file.buffer),
      this.bucket.openUploadStreamWithId(id, fileName, { metadata }),
    );
    return {
      id: id.toHexString(),
      fileName,
      size: file.buffer.length,
      mimeType: metadata.mimeType,
      sha256: metadata.sha256,
      kind: meta.kind,
    };
  }

  async findInfo(id: string): Promise<GridFile | null> {
    if (!isValidObjectId(id)) return null;
    return (await this.bucket.find({ _id: new Types.ObjectId(id) }).next()) as GridFile | null;
  }

  async openDownload(id: string): Promise<{ info: GridFile; stream: Readable }> {
    const info = await this.findInfo(id);
    if (!info) {
      throw new AppException(ErrorCode.FILE_NOT_FOUND, HttpStatus.NOT_FOUND, 'File not found');
    }
    return { info, stream: this.bucket.openDownloadStream(info._id) };
  }

  /** Idempotent: deleting a missing file is a no-op (used for upload rollbacks). */
  async delete(id: string): Promise<void> {
    if (!(await this.findInfo(id))) return;
    await this.bucket.delete(new Types.ObjectId(id));
  }
}
```

`server/src/files/files.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { FilesService } from './files.service';

@Module({
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
```

Add `FilesModule` to `server/src/app.module.ts` imports.

- [ ] **Step 6: Verify and commit**

Run: `pnpm test:e2e -- files` → PASS. Full suite + lint + build → green.

```bash
git add server
git commit -m "feat(server): GridFS files service with magic-byte type checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Theses module — registration, listing, detail, edit

**Files:**
- Create: `server/src/theses/thesis-access.policy.ts` (+ `.spec.ts`)
- Create: `server/src/theses/dto/create-thesis.dto.ts`, `update-thesis.dto.ts`, `query-theses.dto.ts`
- Create: `server/src/theses/theses.service.ts`, `theses.controller.ts`, `theses.module.ts`
- Modify: `server/src/app.module.ts`, `server/test/utils/test-app.ts`
- Test: `server/test/theses.e2e-spec.ts`

- [ ] **Step 1: Access policy (test first)**

`server/src/theses/thesis-access.policy.spec.ts`:
```ts
import { Role } from '@thesis/shared';
import { Types } from 'mongoose';
import { canReadThesis } from './thesis-access.policy';

describe('canReadThesis', () => {
  const studentId = new Types.ObjectId();
  const thesis = { studentId };
  const user = (roles: Role[], id = new Types.ObjectId().toHexString()) => ({ id, email: 'x@y.co', roles });

  it('admins and coordinators read every thesis', () => {
    expect(canReadThesis(user([Role.ADMIN]), thesis)).toBe(true);
    expect(canReadThesis(user([Role.COORDINATOR]), thesis)).toBe(true);
  });

  it('a student reads only their own thesis', () => {
    expect(canReadThesis(user([Role.STUDENT], studentId.toHexString()), thesis)).toBe(true);
    expect(canReadThesis(user([Role.STUDENT]), thesis)).toBe(false);
  });

  it('jurors have no access until assignments exist (stage 3)', () => {
    expect(canReadThesis(user([Role.INTERNAL_JUROR]), thesis)).toBe(false);
  });
});
```

`server/src/theses/thesis-access.policy.ts`:
```ts
import { Role } from '@thesis/shared';
import type { Types } from 'mongoose';
import type { AuthUser } from '../common/types/auth-user';

/**
 * Read access to a thesis and its manuscripts (RBAC matrix).
 * Stage 3 extends this with "juror with an ACCEPTED assignment".
 */
export function canReadThesis(user: AuthUser, thesis: { studentId: Types.ObjectId }): boolean {
  if (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.COORDINATOR)) return true;
  return user.roles.includes(Role.STUDENT) && thesis.studentId.equals(user.id);
}
```

Run: `pnpm test -- thesis-access` → PASS.

- [ ] **Step 2: DTOs**

`server/src/theses/dto/create-thesis.dto.ts`:
```ts
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateThesisDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  abstract?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  keywords?: string[];

  @IsMongoId()
  studentId!: string;

  @IsMongoId()
  advisorId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsMongoId({ each: true })
  coAdvisorIds?: string[];

  @IsMongoId()
  programId!: string;

  @IsMongoId()
  cohortId!: string;

  @IsMongoId()
  periodId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsMongoId({ each: true })
  conflictOfInterestUserIds?: string[];
}
```

`server/src/theses/dto/update-thesis.dto.ts`:
```ts
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

/** Student, program, cohort and period are fixed at registration (they define the code). */
export class UpdateThesisDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @IsOptionalNonNull()
  @IsString()
  @MaxLength(5000)
  abstract?: string;

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  keywords?: string[];

  @IsOptionalNonNull()
  @IsMongoId()
  advisorId?: string;

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsMongoId({ each: true })
  coAdvisorIds?: string[];

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsMongoId({ each: true })
  conflictOfInterestUserIds?: string[];
}
```

`server/src/theses/dto/query-theses.dto.ts`:
```ts
import { ThesisStatus } from '@thesis/shared';
import { IsEnum, IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export class QueryThesesDto extends PaginationQueryDto {
  @IsOptional()
  @IsMongoId()
  programId?: string;

  @IsOptional()
  @IsMongoId()
  periodId?: string;

  @IsOptional()
  @IsMongoId()
  cohortId?: string;

  @IsOptional()
  @IsEnum(ThesisStatus)
  status?: ThesisStatus;

  /** Matches code, title or student name (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Code starts with, e.g. TEST- or MIETIA-2026-II (sugerencia 7). */
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{1,40}$/)
  codePrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  seedTag?: string;
}
```

- [ ] **Step 3: Write the failing e2e test**

Add to `server/test/utils/test-app.ts` (import `ThesesService` from `../../src/theses/theses.service`, `ThesisDocument` from `../../src/theses/schemas/thesis.schema`, `Role` from `@thesis/shared`):
```ts
/** Registers a thesis through the service with fresh student/advisor unless given. */
export async function createThesis(
  app: INestApplication,
  catalog: CatalogFixture,
  data: { studentId?: string; advisorId?: string; title?: string } = {},
): Promise<ThesisDocument> {
  const studentId = data.studentId ?? ((await createUser(app, { roles: [Role.STUDENT] })).id as string);
  const advisorId = data.advisorId ?? ((await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id as string);
  return app.get(ThesesService).create(
    { title: data.title ?? 'Tesis de prueba', studentId, advisorId, ...catalog },
    { role: Role.COORDINATOR },
  );
}
```

`server/test/theses.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Role, ThesisStatus } from '@thesis/shared';
import { Types } from 'mongoose';
import { UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import {
  CatalogFixture,
  closeTestApp,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Theses (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let admin: TestAgent;
  let catalog: CatalogFixture;
  let advisor: UserDocument;

  beforeAll(async () => {
    app = await createTestApp();
    const c = await createUser(app, { roles: [Role.COORDINATOR] });
    const a = await createUser(app, { roles: [Role.ADMIN] });
    coordinator = await loginAgent(app, c.email);
    admin = await loginAgent(app, a.email);
    catalog = await createCatalog(app, { programCode: 'MIETIA', year: 2026 });
    advisor = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
  });
  afterAll(() => closeTestApp(app));

  const newStudent = (firstName = 'Laura', lastName = 'Pérez') =>
    createUser(app, { roles: [Role.STUDENT], firstName, lastName });

  const body = (studentId: string, extra: Record<string, unknown> = {}) => ({
    title: 'IA generativa en el aula',
    abstract: 'Resumen',
    keywords: ['IA', 'educación'],
    studentId,
    advisorId: advisor.id as string,
    ...catalog,
    ...extra,
  });

  describe('POST /theses (radicación)', () => {
    it('registers a thesis with a sequential prefixed code, SUBMITTED at 10%', async () => {
      const s1 = await newStudent();
      const s2 = await newStudent('Carlos', 'Gómez');
      const r1 = await coordinator.post('/api/theses').send(body(s1.id as string)).expect(201);
      const r2 = await coordinator.post('/api/theses').send(body(s2.id as string)).expect(201);
      expect(r1.body).toMatchObject({
        code: 'MIETIA-2026-II-001',
        status: ThesisStatus.SUBMITTED,
        progress: 10,
        studentName: 'Laura Pérez',
      });
      expect(r2.body.code).toBe('MIETIA-2026-II-002');
      expect(r1.body.history).toEqual([
        expect.objectContaining({ from: null, to: ThesisStatus.SUBMITTED, actorRole: Role.COORDINATOR }),
      ]);
    });

    it('rejects a second active thesis for the same student', async () => {
      const s = await newStudent();
      await coordinator.post('/api/theses').send(body(s.id as string)).expect(201);
      const res = await coordinator.post('/api/theses').send(body(s.id as string)).expect(409);
      expect(res.body.code).toBe('THESIS_STUDENT_HAS_ACTIVE');
    });

    it.each([
      ['studentId', async () => (await createUser(app, { roles: [Role.COORDINATOR] })).id as string],
      ['advisorId', async () => (await newStudent()).id as string],
    ])('rejects a %s with the wrong role as THESIS_INVALID_REFERENCE', async (field, makeId) => {
      const s = await newStudent();
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { [field]: await makeId() }))
        .expect(400);
      expect(res.body).toMatchObject({ code: 'THESIS_INVALID_REFERENCE', details: { field } });
    });

    it('rejects an inactive advisor and an advisor repeated as co-advisor', async () => {
      const s = await newStudent();
      const inactive = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
      await app
        .get(UsersService)
        .setActive(inactive.id as string, false, new Types.ObjectId().toHexString());
      await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { advisorId: inactive.id }))
        .expect(400);
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { coAdvisorIds: [advisor.id] }))
        .expect(400);
      expect(res.body.details).toEqual({ field: 'coAdvisorIds' });
    });

    it('rejects a cohort from another program with COHORT_PROGRAM_MISMATCH', async () => {
      const other = await createCatalog(app);
      const s = await newStudent();
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { cohortId: other.cohortId }))
        .expect(400);
      expect(res.body.code).toBe('COHORT_PROGRAM_MISMATCH');
    });

    it('rejects unknown catalog ids with THESIS_INVALID_REFERENCE', async () => {
      const s = await newStudent();
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { periodId: '65a1b2c3d4e5f60718293a4b' }))
        .expect(400);
      expect(res.body.details).toEqual({ field: 'periodId' });
    });
  });

  describe('GET /theses (bandeja)', () => {
    let listCatalog: CatalogFixture;

    beforeAll(async () => {
      listCatalog = await createCatalog(app, { programCode: 'LIST', year: 2030 });
      for (const [first, last, title] of [
        ['Zoe', 'Arias', 'Beta'],
        ['Ana', 'Torres', 'Alfa'],
        ['Mario', 'López', 'Gamma'],
      ]) {
        const s = await newStudent(first, last);
        await createThesis(app, listCatalog, { studentId: s.id as string, title });
      }
    });

    it('paginates with total and filters by program', async () => {
      const res = await admin
        .get(`/api/theses?programId=${listCatalog.programId}&limit=2&page=1`)
        .expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].history).toBeUndefined();
    });

    it.each([
      ['title', 'asc', ['Alfa', 'Beta', 'Gamma']],
      ['title', 'desc', ['Gamma', 'Beta', 'Alfa']],
      ['student', 'asc', ['Alfa', 'Gamma', 'Beta']], // Ana Torres, Mario López, Zoe Arias
      ['code', 'asc', ['Beta', 'Alfa', 'Gamma']],
    ])('sorts by %s %s', async (sort, order, titles) => {
      const res = await coordinator
        .get(`/api/theses?programId=${listCatalog.programId}&sort=${sort}&order=${order}`)
        .expect(200);
      expect(res.body.items.map((t: { title: string }) => t.title)).toEqual(titles);
    });

    it('searches by q over title, code and student name, and by codePrefix', async () => {
      const byName = await coordinator.get('/api/theses?q=torres').expect(200);
      expect(byName.body.items.map((t: { title: string }) => t.title)).toEqual(['Alfa']);
      const byPrefix = await coordinator.get('/api/theses?codePrefix=LIST-2030').expect(200);
      expect(byPrefix.body.total).toBe(3);
    });

    it('rejects unknown status values', async () => {
      await coordinator.get('/api/theses?status=FOO').expect(400);
    });
  });

  describe('GET /theses/mine, GET /theses/:id', () => {
    it('student sees only their own thesis; others get 404', async () => {
      const owner = await newStudent();
      const other = await newStudent();
      const t = await createThesis(app, catalog, { studentId: owner.id as string });
      const ownerAgent = await loginAgent(app, owner.email);
      const otherAgent = await loginAgent(app, other.email);

      const mine = await ownerAgent.get('/api/theses/mine').expect(200);
      expect(mine.body.map((x: { id: string }) => x.id)).toEqual([t.id]);
      await ownerAgent.get(`/api/theses/${t.id as string}`).expect(200);
      const res = await otherAgent.get(`/api/theses/${t.id as string}`).expect(404);
      expect(res.body.code).toBe('THESIS_NOT_FOUND');
      expect((await otherAgent.get('/api/theses/mine').expect(200)).body).toEqual([]);
    });

    it('malformed id → 400, unknown id → 404', async () => {
      await coordinator.get('/api/theses/nope').expect(400);
      await coordinator.get('/api/theses/65a1b2c3d4e5f60718293a4b').expect(404);
    });
  });

  describe('PATCH /theses/:id', () => {
    it('edits metadata; rejects null', async () => {
      const t = await createThesis(app, catalog);
      const res = await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ title: 'Nuevo título', keywords: ['a'] })
        .expect(200);
      expect(res.body).toMatchObject({ title: 'Nuevo título', keywords: ['a'] });
      await coordinator.patch(`/api/theses/${t.id as string}`).send({ title: null }).expect(400);
    });

    it('participants can change only while SUBMITTED; closed theses are locked', async () => {
      const t = await createThesis(app, catalog);
      const other = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
      await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ coAdvisorIds: [other.id] })
        .expect(200);

      await t.updateOne({ status: ThesisStatus.UNDER_EVALUATION });
      const locked = await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ advisorId: other.id })
        .expect(409);
      expect(locked.body.code).toBe('THESIS_NOT_EDITABLE');
      await coordinator.patch(`/api/theses/${t.id as string}`).send({ title: 'OK' }).expect(200);

      await t.updateOne({ status: ThesisStatus.NOT_APPROVED });
      const closed = await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ title: 'No' })
        .expect(409);
      expect(closed.body.code).toBe('THESIS_CLOSED');
    });

    it('rejects body fields that are not editable', async () => {
      const t = await createThesis(app, catalog);
      await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ status: ThesisStatus.READY_FOR_DEFENSE })
        .expect(400);
    });
  });
});
```

Run: `pnpm test:e2e -- theses` → FAIL.

- [ ] **Step 4: Service**

`server/src/theses/theses.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ErrorCode,
  JUROR_ROLES,
  Role,
  TERMINAL_THESIS_STATUSES,
  THESIS_PROGRESS,
  ThesisStatus,
} from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model, Types } from 'mongoose';
import { CatalogsService } from '../catalogs/catalogs.service';
import { AppException } from '../common/errors/app.exception';
import { paginate, SortFields } from '../common/pagination/paginate';
import { Paginated } from '../common/pagination/pagination.dto';
import type { Actor } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { escapeRegex } from '../common/utils/escape-regex';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { isTerminal } from '../workflow/workflow.rules';
import { CreateThesisDto } from './dto/create-thesis.dto';
import { QueryThesesDto } from './dto/query-theses.dto';
import { UpdateThesisDto } from './dto/update-thesis.dto';
import { Thesis, ThesisDocument } from './schemas/thesis.schema';
import { canReadThesis } from './thesis-access.policy';
import { ThesisCodeService } from './thesis-code';

const SORT_FIELDS: SortFields = {
  code: 'code',
  title: 'title',
  student: 'studentName',
  status: 'status',
  progress: 'progress',
  createdAt: 'createdAt',
};

const PARTICIPANT_FIELDS = ['advisorId', 'coAdvisorIds', 'conflictOfInterestUserIds'] as const;

type Participants = Pick<CreateThesisDto, 'studentId' | 'advisorId' | 'coAdvisorIds' | 'conflictOfInterestUserIds'>;

const invalidRef = (field: string) =>
  new AppException(ErrorCode.THESIS_INVALID_REFERENCE, HttpStatus.BAD_REQUEST, `Invalid ${field}`, { field });

const thesisNotFound = () =>
  new AppException(ErrorCode.THESIS_NOT_FOUND, HttpStatus.NOT_FOUND, 'Thesis not found');

const isFaculty = (u?: UserDocument) => !!u && u.isActive && u.roles.some((r) => JUROR_ROLES.includes(r));

@Injectable()
export class ThesesService {
  constructor(
    @InjectModel(Thesis.name) private readonly model: Model<Thesis>,
    private readonly catalogs: CatalogsService,
    private readonly users: UsersService,
    private readonly codes: ThesisCodeService,
  ) {}

  /** RF-C01 radicación. `seedTag` is only set by the seed command (stage 8). */
  async create(dto: CreateThesisDto, actor: Actor, opts: { seedTag?: string } = {}): Promise<ThesisDocument> {
    const [program, period, cohort] = await Promise.all([
      this.catalogs.findProgram(dto.programId),
      this.catalogs.findPeriod(dto.periodId),
      this.catalogs.findCohort(dto.cohortId),
    ]);
    if (!program?.isActive) throw invalidRef('programId');
    if (!period) throw invalidRef('periodId');
    if (!cohort) throw invalidRef('cohortId');
    if (!cohort.programId.equals(program._id)) {
      throw new AppException(ErrorCode.COHORT_PROGRAM_MISMATCH, HttpStatus.BAD_REQUEST, 'Cohort belongs to another program');
    }

    const student = await this.assertParticipants(dto);
    // Check-then-insert: two simultaneous registrations for one student could both pass (accepted).
    if (await this.model.exists({ studentId: dto.studentId, status: { $nin: TERMINAL_THESIS_STATUSES } })) {
      throw new AppException(ErrorCode.THESIS_STUDENT_HAS_ACTIVE, HttpStatus.CONFLICT, 'Student already has an active thesis');
    }

    const code = await this.codes.next(program.code, period.code, opts.seedTag);
    return this.model.create({
      ...dto,
      code,
      studentName: `${student.firstName} ${student.lastName}`,
      status: ThesisStatus.SUBMITTED,
      progress: THESIS_PROGRESS[ThesisStatus.SUBMITTED],
      history: [
        {
          from: null,
          to: ThesisStatus.SUBMITTED,
          at: new Date(),
          actorId: actor.id ? new Types.ObjectId(actor.id) : undefined,
          actorRole: actor.role,
        },
      ],
      seedTag: opts.seedTag,
    });
  }

  list(query: QueryThesesDto): Promise<Paginated<ThesisDocument>> {
    const filter: FilterQuery<Thesis> = {};
    if (query.programId) filter.programId = query.programId;
    if (query.periodId) filter.periodId = query.periodId;
    if (query.cohortId) filter.cohortId = query.cohortId;
    if (query.status) filter.status = query.status;
    if (query.seedTag) filter.seedTag = query.seedTag;
    if (query.codePrefix) filter.code = new RegExp(`^${escapeRegex(query.codePrefix)}`, 'i');
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ code: rx }, { title: rx }, { studentName: rx }];
    }
    return paginate(this.model, filter, query, {
      sortFields: SORT_FIELDS,
      defaultSort: 'createdAt',
      projection: { history: 0 },
    });
  }

  findMine(studentId: string): Promise<ThesisDocument[]> {
    return this.model.find({ studentId }).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<ThesisDocument> {
    const thesis = isValidObjectId(id) ? await this.model.findById(id).exec() : null;
    if (!thesis) throw thesisNotFound();
    return thesis;
  }

  /** 404 (not 403) for theses the user may not read, so ids cannot be probed. */
  async findReadable(id: string, user: AuthUser): Promise<ThesisDocument> {
    const thesis = await this.findById(id);
    if (!canReadThesis(user, thesis)) throw thesisNotFound();
    return thesis;
  }

  async update(id: string, dto: UpdateThesisDto): Promise<ThesisDocument> {
    const thesis = await this.findById(id);
    if (isTerminal(thesis.status)) {
      throw new AppException(ErrorCode.THESIS_CLOSED, HttpStatus.CONFLICT, 'Thesis is closed');
    }
    const touchesParticipants = PARTICIPANT_FIELDS.some((f) => dto[f] !== undefined);
    if (touchesParticipants) {
      // RN-01 is checked against these at juror assignment (stage 3).
      if (thesis.status !== ThesisStatus.SUBMITTED) {
        throw new AppException(
          ErrorCode.THESIS_NOT_EDITABLE,
          HttpStatus.CONFLICT,
          'Advisors and conflicts can only change before juror assignment',
        );
      }
      await this.assertParticipants({
        studentId: thesis.studentId.toHexString(),
        advisorId: dto.advisorId ?? thesis.advisorId.toHexString(),
        coAdvisorIds: dto.coAdvisorIds ?? thesis.coAdvisorIds.map((x) => x.toHexString()),
        conflictOfInterestUserIds:
          dto.conflictOfInterestUserIds ?? thesis.conflictOfInterestUserIds.map((x) => x.toHexString()),
      });
    }
    const updated = await this.model
      .findOneAndUpdate({ _id: thesis._id, status: thesis.status }, { $set: dto }, { new: true, runValidators: true })
      .exec();
    if (!updated) {
      throw new AppException(ErrorCode.WORKFLOW_STATUS_CONFLICT, HttpStatus.CONFLICT, 'Thesis status changed concurrently');
    }
    return updated;
  }

  /** Validates every referenced user in one query; returns the student. */
  private async assertParticipants(input: Participants): Promise<UserDocument> {
    // @IsMongoId accepts uppercase hex; compare ids in one canonical form.
    const lower = (ids?: string[]) => ids?.map((x) => x.toLowerCase());
    const p = {
      studentId: input.studentId.toLowerCase(),
      advisorId: input.advisorId.toLowerCase(),
      coAdvisorIds: lower(input.coAdvisorIds),
      conflictOfInterestUserIds: lower(input.conflictOfInterestUserIds),
    };
    const coAdvisorIds = p.coAdvisorIds ?? [];
    const conflictIds = p.conflictOfInterestUserIds ?? [];
    const ids = [...new Set([p.studentId, p.advisorId, ...coAdvisorIds, ...conflictIds])];
    const byId = new Map((await this.users.findManyByIds(ids)).map((u) => [u.id as string, u]));

    const student = byId.get(p.studentId);
    if (!student?.isActive || !student.roles.includes(Role.STUDENT)) throw invalidRef('studentId');
    if (p.advisorId === p.studentId || !isFaculty(byId.get(p.advisorId))) throw invalidRef('advisorId');
    if (coAdvisorIds.some((id) => id === p.advisorId || id === p.studentId || !isFaculty(byId.get(id)))) {
      throw invalidRef('coAdvisorIds');
    }
    if (conflictIds.some((id) => !byId.has(id))) throw invalidRef('conflictOfInterestUserIds');
    return student;
  }
}
```

- [ ] **Step 5: Controller and module**

`server/src/theses/theses.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { CreateThesisDto } from './dto/create-thesis.dto';
import { QueryThesesDto } from './dto/query-theses.dto';
import { UpdateThesisDto } from './dto/update-thesis.dto';
import { ThesesService } from './theses.service';

@ApiTags('theses')
@Controller('theses')
export class ThesesController {
  constructor(private readonly theses: ThesesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.COORDINATOR)
  list(@Query() query: QueryThesesDto) {
    return this.theses.list(query);
  }

  // Declared before ':id' so "mine" is not parsed as an id.
  @Get('mine')
  @Roles(Role.STUDENT)
  mine(@CurrentUser() user: AuthUser) {
    return this.theses.findMine(user.id);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.COORDINATOR, Role.STUDENT)
  findOne(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.theses.findReadable(id, user);
  }

  @Post()
  @Roles(Role.COORDINATOR)
  create(@Body() dto: CreateThesisDto, @CurrentUser() user: AuthUser) {
    return this.theses.create(dto, actorFrom(user, Role.COORDINATOR));
  }

  @Patch(':id')
  @Roles(Role.COORDINATOR)
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateThesisDto) {
    return this.theses.update(id, dto);
  }
}
```

`server/src/theses/theses.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { FilesModule } from '../files/files.module';
import { UsersModule } from '../users/users.module';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Thesis, ThesisSchema } from './schemas/thesis.schema';
import { ThesesController } from './theses.controller';
import { ThesesService } from './theses.service';
import { ThesisCodeService } from './thesis-code';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Thesis.name, schema: ThesisSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    CatalogsModule,
    UsersModule,
    FilesModule,
  ],
  controllers: [ThesesController],
  providers: [ThesesService, ThesisCodeService],
  exports: [ThesesService],
})
export class ThesesModule {}
```

Add `ThesesModule` to `server/src/app.module.ts` imports.

- [ ] **Step 6: Verify and commit**

Run: `pnpm test:e2e -- theses` → PASS. Full suite + lint + build → green.

```bash
git add server
git commit -m "feat(server): thesis registration, sortable listing, detail and edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Manuscript upload and download

**Files:**
- Modify: `server/src/theses/theses.service.ts`, `server/src/theses/theses.controller.ts`
- Test: `server/test/manuscripts.e2e-spec.ts`

- [ ] **Step 1: Write the failing e2e test**

`server/test/manuscripts.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Role, ThesisStatus } from '@thesis/shared';
import { MAX_FILE_BYTES } from '../src/files/file-type';
import { ThesisDocument } from '../src/theses/schemas/thesis.schema';
import {
  binaryParser,
  closeTestApp,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  DOCX_BYTES,
  loginAgent,
  PDF_BYTES,
  TestAgent,
} from './utils/test-app';

describe('Manuscripts (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let owner: TestAgent;
  let stranger: TestAgent;
  let juror: TestAgent;
  let thesis: ThesisDocument;

  beforeAll(async () => {
    app = await createTestApp();
    const catalog = await createCatalog(app);
    const c = await createUser(app, { roles: [Role.COORDINATOR] });
    const s = await createUser(app, { roles: [Role.STUDENT] });
    const other = await createUser(app, { roles: [Role.STUDENT] });
    const j = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    thesis = await createThesis(app, catalog, { studentId: s.id as string });
    coordinator = await loginAgent(app, c.email);
    owner = await loginAgent(app, s.email);
    stranger = await loginAgent(app, other.email);
    juror = await loginAgent(app, j.email);
  });
  afterAll(() => closeTestApp(app));

  const url = () => `/api/theses/${thesis.id as string}/manuscripts`;

  it('owner student uploads v1, coordinator uploads v2; current points to v2', async () => {
    const r1 = await owner
      .post(url())
      .attach('file', PDF_BYTES, { filename: 'tesis v1.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(r1.body.manuscripts).toEqual([
      expect.objectContaining({ version: 1, fileName: 'tesis v1.pdf' }),
    ]);
    const r2 = await coordinator
      .post(url())
      .attach('file', PDF_BYTES, { filename: 'tesis v2.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(r2.body.manuscripts.map((m: { version: number }) => m.version)).toEqual([1, 2]);
    expect(r2.body.currentManuscriptId).toBe(r2.body.manuscripts[1].fileId);
  });

  it('downloads the file with attachment headers for owner and coordinator', async () => {
    const t = (await coordinator.get(`/api/theses/${thesis.id as string}`).expect(200)).body;
    const fileId = t.manuscripts[0].fileId as string;
    for (const agent of [owner, coordinator]) {
      const res = await agent
        .get(`${url()}/${fileId}`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment;');
      expect((res.body as Buffer).equals(PDF_BYTES)).toBe(true);
    }
  });

  it('other students and jurors cannot upload or download (404 / 403)', async () => {
    const t = (await coordinator.get(`/api/theses/${thesis.id as string}`).expect(200)).body;
    const fileId = t.manuscripts[0].fileId as string;
    await stranger.get(`${url()}/${fileId}`).expect(404);
    await stranger
      .post(url())
      .attach('file', PDF_BYTES, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(404);
    await juror.get(`${url()}/${fileId}`).expect(403);
  });

  it('rejects non-PDF content even when declared as PDF (415)', async () => {
    const res = await owner
      .post(url())
      .attach('file', DOCX_BYTES, { filename: 'fake.pdf', contentType: 'application/pdf' })
      .expect(415);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('rejects a missing file (400) and a file over 25 MB (413)', async () => {
    const missing = await owner.post(url()).expect(400);
    expect(missing.body.code).toBe('FILE_REQUIRED');
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_FILE_BYTES)]);
    const res = await owner
      .post(url())
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' })
      .expect(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
  });

  it('a file id that is not a manuscript of this thesis is 404 FILE_NOT_FOUND', async () => {
    const res = await coordinator.get(`${url()}/65a1b2c3d4e5f60718293a4b`).expect(404);
    expect(res.body.code).toBe('FILE_NOT_FOUND');
  });

  it('closed theses do not accept new manuscripts', async () => {
    await thesis.updateOne({ status: ThesisStatus.COMPLETED_APPROVED });
    const res = await owner
      .post(url())
      .attach('file', PDF_BYTES, { filename: 'late.pdf', contentType: 'application/pdf' })
      .expect(409);
    expect(res.body.code).toBe('THESIS_CLOSED');
  });
});
```

Run: `pnpm test:e2e -- manuscripts` → FAIL.

- [ ] **Step 2: Service methods**

Add to `ThesesService` (inject `FilesService` in the constructor: `private readonly files: FilesService`; imports: `FileKind` from `@thesis/shared`, `FilesService, UploadInput` from `../files/files.service`, `Readable` type from `node:stream`, `GridFile` from `../files/files.service`):
```ts
  /** New manuscript version (PDF). Coordinator or the owner student; not on closed theses. */
  async addManuscript(id: string, file: UploadInput | undefined, user: AuthUser): Promise<ThesisDocument> {
    const thesis = await this.findReadable(id, user);
    if (isTerminal(thesis.status)) {
      throw new AppException(ErrorCode.THESIS_CLOSED, HttpStatus.CONFLICT, 'Thesis is closed');
    }
    const stored = await this.files.upload(
      file,
      { ownerId: user.id, thesisId: id, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    const fileId = new Types.ObjectId(stored.id);
    // Optimistic on manuscriptSeq: a concurrent upload makes this miss instead of duplicating a version.
    const updated = await this.model
      .findOneAndUpdate(
        { _id: thesis._id, manuscriptSeq: thesis.manuscriptSeq },
        {
          $inc: { manuscriptSeq: 1 },
          $push: {
            manuscripts: {
              fileId,
              version: thesis.manuscriptSeq + 1,
              fileName: stored.fileName,
              uploadedAt: new Date(),
              uploadedBy: new Types.ObjectId(user.id),
            },
          },
          $set: { currentManuscriptId: fileId },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      await this.files.delete(stored.id);
      throw new AppException(ErrorCode.CONFLICT, HttpStatus.CONFLICT, 'Another manuscript was uploaded concurrently');
    }
    return updated;
  }

  async openManuscript(id: string, fileId: string, user: AuthUser): Promise<{ info: GridFile; stream: Readable }> {
    const thesis = await this.findReadable(id, user);
    if (!thesis.manuscripts.some((m) => m.fileId.equals(fileId))) {
      throw new AppException(ErrorCode.FILE_NOT_FOUND, HttpStatus.NOT_FOUND, 'File not found');
    }
    return this.files.openDownload(fileId);
  }
```

- [ ] **Step 3: Controller endpoints**

Add to `ThesesController` (imports: `StreamableFile, UploadedFile, UseInterceptors` from `@nestjs/common`; `FileInterceptor` from `@nestjs/platform-express`; `ApiBody, ApiConsumes` from `@nestjs/swagger`; `MAX_FILE_BYTES` from `../files/file-type`; `contentDisposition` from `../files/content-disposition`):
```ts
  @Post(':id/manuscripts')
  @Roles(Role.COORDINATOR, Role.STUDENT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  uploadManuscript(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.theses.addManuscript(id, file, user);
  }

  @Get(':id/manuscripts/:fileId')
  @Roles(Role.ADMIN, Role.COORDINATOR, Role.STUDENT)
  async downloadManuscript(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('fileId', ParseObjectIdPipe) fileId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const { info, stream } = await this.theses.openManuscript(id, fileId, user);
    return new StreamableFile(stream, {
      type: info.metadata?.mimeType ?? 'application/octet-stream',
      disposition: contentDisposition(info.filename),
      length: info.length,
    });
  }
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm test:e2e -- manuscripts` → PASS. Full suite + lint + build → green.

```bash
git add server
git commit -m "feat(server): manuscript versions upload and download through GridFS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: RBAC matrix e2e, docs and final verification

**Files:**
- Test: `server/test/rbac.e2e-spec.ts`
- Modify: `server/README.md`, `docs/superpowers/specs/2026-11-17-server-design.md`

- [ ] **Step 1: Table-driven RBAC test**

`server/test/rbac.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import request from 'supertest';
import {
  closeTestApp,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  http,
  loginAgent,
  TestAgent,
} from './utils/test-app';

type Method = 'get' | 'post' | 'patch';
interface Row {
  method: Method;
  path: string;
  allowed: Role[];
}

const ALL: Role[] = [Role.ADMIN, Role.COORDINATOR, Role.INTERNAL_JUROR, Role.STUDENT];
const MANAGERS: Role[] = [Role.ADMIN, Role.COORDINATOR];
const ID = '65a1b2c3d4e5f60718293a4b';

/** RBAC matrix (mapa-navegacion-rbac.md §3) for stage-2 endpoints. */
const matrix = (thesisId: string): Row[] => [
  { method: 'get', path: '/api/programs', allowed: ALL },
  { method: 'post', path: '/api/programs', allowed: MANAGERS },
  { method: 'patch', path: `/api/programs/${ID}`, allowed: MANAGERS },
  { method: 'get', path: '/api/periods', allowed: ALL },
  { method: 'post', path: '/api/periods', allowed: MANAGERS },
  { method: 'patch', path: `/api/periods/${ID}`, allowed: MANAGERS },
  { method: 'get', path: '/api/cohorts', allowed: ALL },
  { method: 'post', path: '/api/cohorts', allowed: MANAGERS },
  { method: 'patch', path: `/api/cohorts/${ID}`, allowed: MANAGERS },
  { method: 'get', path: '/api/theses', allowed: MANAGERS },
  { method: 'post', path: '/api/theses', allowed: [Role.COORDINATOR] },
  { method: 'get', path: '/api/theses/mine', allowed: [Role.STUDENT] },
  { method: 'get', path: `/api/theses/${thesisId}`, allowed: [Role.ADMIN, Role.COORDINATOR, Role.STUDENT] },
  { method: 'patch', path: `/api/theses/${thesisId}`, allowed: [Role.COORDINATOR] },
  { method: 'post', path: `/api/theses/${thesisId}/manuscripts`, allowed: [Role.COORDINATOR, Role.STUDENT] },
  { method: 'get', path: `/api/theses/${thesisId}/manuscripts/${ID}`, allowed: [Role.ADMIN, Role.COORDINATOR, Role.STUDENT] },
];

describe('RBAC matrix — stage 2 (e2e)', () => {
  let app: INestApplication;
  const agents = new Map<Role, TestAgent>();
  let rows: Row[];

  beforeAll(async () => {
    app = await createTestApp();
    for (const role of ALL) {
      const u = await createUser(app, { roles: [role] });
      agents.set(role, await loginAgent(app, u.email));
    }
    const thesis = await createThesis(app, await createCatalog(app));
    rows = matrix(thesis.id as string);
  });
  afterAll(() => closeTestApp(app));

  it('anonymous requests get 401 on every endpoint', async () => {
    for (const row of rows) {
      const res = await request(http(app))[row.method](row.path).send({});
      expect({ row: `${row.method} ${row.path}`, status: res.status }).toEqual({
        row: `${row.method} ${row.path}`,
        status: 401,
      });
    }
  });

  it.each(ALL)('%s gets 403 exactly on the endpoints it is not allowed to use', async (role) => {
    for (const row of rows) {
      const res = await agents.get(role)![row.method](row.path).send({});
      const got = res.status === 403 ? 'forbidden' : res.status === 401 ? 'unauthenticated' : 'passed';
      const expected = row.allowed.includes(role) ? 'passed' : 'forbidden';
      expect({ row: `${row.method} ${row.path}`, got }).toEqual({
        row: `${row.method} ${row.path}`,
        got: expected,
      });
    }
  });
});
```

Run: `pnpm test:e2e -- rbac` → PASS (if a row fails, fix the controller's `@Roles`, not the matrix, unless the matrix contradicts the decisions table at the top of this plan).

- [ ] **Step 2: README**

Append to `server/README.md` a section (Spanish prose, English identifiers) titled `## Catálogos, tesis y archivos (sub-etapa 2)` listing:
- `GET|POST|PATCH /api/programs`, `/api/periods`, `/api/cohorts` (lectura para cualquier usuario autenticado; escritura ADMIN y COORDINATOR).
- `GET /api/theses` con filtros `programId, periodId, cohortId, status, q, codePrefix, seedTag`, paginación `page, limit` y orden `sort=code|title|student|status|progress|createdAt&order=asc|desc`.
- `POST /api/theses` (COORDINATOR) y el formato de código `MIETIA-2026-II-001`.
- `GET /api/theses/mine` (STUDENT), `GET /api/theses/:id`, `PATCH /api/theses/:id`.
- `POST /api/theses/:id/manuscripts` (multipart, campo `file`, solo PDF, máx. 25 MB) y `GET /api/theses/:id/manuscripts/:fileId`.
- Nota: los cambios de estado solo ocurren mediante `WorkflowService` (sub-etapas siguientes); se emite el evento `thesis.status.changed`.

- [ ] **Step 3: Spec alignment**

In `docs/superpowers/specs/2026-11-17-server-design.md`:
- §3 `users` row: replace "`affiliation`, `isUnicordoba`, `highestDegree`, `country`, `institution`" with "`institution`, `isUnicordoba`, `highestDegree`, `country`, `expertise`".
- §8 `catalogs` line: replace with "`catalogs`: `GET|POST|PATCH /programs | /periods | /cohorts` (rutas de primer nivel; lectura para cualquier usuario autenticado)".
- §5 `settings`: append to the `thesisCodePrefix` mention: "(el código de tesis usa `program.code` como prefijo; este valor queda como respaldo)".

- [ ] **Step 4: Final verification**

Run from `server/`: `pnpm test && pnpm test:e2e && pnpm lint && pnpm build` → all green. Record the unit and e2e counts in the commit body.

```bash
git add server docs/superpowers/specs/2026-11-17-server-design.md
git commit -m "test(server): stage-2 RBAC matrix; docs for catalogs, theses and files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Out of scope for this plan (next stages)

- Juror access to theses/manuscripts after accepting (stage 3 extends `canReadThesis`).
- EXTERNAL_JUROR with a password (stage-1 review item) — fix at the start of stage 3, before the external token.
- `settings` module, seed command, scheduler (stage 8); notifications/audit consumers of `thesis.status.changed` (stage 7).
