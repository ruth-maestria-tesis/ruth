# Server Stage 1 — Foundation, Auth & Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar listo el monorepo (pnpm), el paquete `shared` y un server NestJS que arranca contra MongoDB, con manejo uniforme de errores, login JWT con cookies httpOnly y refresh rotativo, RBAC global y el módulo `users`. Todo queda cubierto por pruebas unitarias y e2e.

**Architecture:** pnpm workspace con `/shared` (enums compilados a CommonJS) y `/server` (NestJS 11 + Mongoose 8). Hay guards globales (`ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`) con los decoradores `@Public()` y `@Roles()`. Los errores salen siempre como `{statusCode, code, message, details?}` con códigos de `@thesis/shared`. Las pruebas e2e usan `mongodb-memory-server` levantado en el `globalSetup` de Jest.

**Tech Stack:** Node 22, pnpm 11, NestJS 11, Mongoose 8, @nestjs/jwt, @nestjs/config + Joi, @nestjs/throttler, @nestjs/swagger, bcryptjs, helmet, cookie-parser, class-validator, Jest + supertest + mongodb-memory-server.

**Spec:** `docs/superpowers/specs/2026-11-17-server-design.md` (§0, §1, §2, §3 `auth` y `users`, §10).

**Convención:** todo el código, nombres, rutas y mensajes de log en inglés. Los textos de interfaz van en el cliente (fase 2).

**Fuera de esta etapa:** `POST /auth/external/validate-token` (etapa 3, depende de `assignments`), catálogos y tesis (etapa 2).

---

## File Structure

```
/.gitignore
/package.json                         root scripts
/pnpm-workspace.yaml
/README.md
/shared/package.json
/shared/tsconfig.json
/shared/src/index.ts
/shared/src/roles.ts                  Role enum + JUROR_ROLES
/shared/src/thesis-status.ts          ThesisStatus enum + THESIS_PROGRESS
/shared/src/error-codes.ts            ErrorCode enum
/server/.env.example
/server/README.md
/server/package.json                  (generated, then edited)
/server/src/main.ts                   bootstrap + swagger
/server/src/app.module.ts             root module + global guards
/server/src/app.setup.ts              prefix, helmet, cookies, CORS, pipes, filter (shared by main & e2e)
/server/src/swagger.ts
/server/src/health.controller.ts
/server/src/config/env.validation.ts
/server/src/common/errors/app.exception.ts
/server/src/common/filters/all-exceptions.filter.ts (+ .spec.ts)
/server/src/common/decorators/public.decorator.ts
/server/src/common/decorators/roles.decorator.ts
/server/src/common/decorators/current-user.decorator.ts
/server/src/common/guards/jwt-auth.guard.ts
/server/src/common/guards/roles.guard.ts (+ .spec.ts)
/server/src/common/types/auth-user.ts
/server/src/common/pagination/pagination.dto.ts
/server/src/common/utils/escape-regex.ts (+ .spec.ts)
/server/src/common/security/password.ts
/server/src/common/security/hash.ts
/server/src/users/schemas/user.schema.ts
/server/src/users/dto/create-user.dto.ts
/server/src/users/dto/update-user.dto.ts
/server/src/users/dto/query-users.dto.ts
/server/src/users/users.service.ts
/server/src/users/users.controller.ts
/server/src/users/users.module.ts
/server/src/auth/auth.constants.ts
/server/src/auth/schemas/refresh-token.schema.ts
/server/src/auth/dto/login.dto.ts
/server/src/auth/dto/change-password.dto.ts
/server/src/auth/auth.service.ts
/server/src/auth/auth.controller.ts
/server/src/auth/auth.module.ts
/server/src/cli/create-admin.ts
/server/test/jest-e2e.json
/server/test/global-setup.ts
/server/test/global-teardown.ts
/server/test/utils/test-app.ts
/server/test/health.e2e-spec.ts
/server/test/users.e2e-spec.ts
/server/test/auth.e2e-spec.ts
```

---

### Task 1: Git y raíz del monorepo

**Files:**
- Create: `/.gitignore`, `/package.json`, `/pnpm-workspace.yaml`, `/README.md`

- [ ] **Step 1: Inicializar git**

Run (en `/Users/kikret/Documents/develop/Ruth`):
```bash
git init -b main
```
Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Crear `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
.DS_Store
~$*
*.log
.nuxt/
.output/
```

- [ ] **Step 3: Crear `package.json` raíz**

```json
{
  "name": "thesis-repository",
  "private": true,
  "scripts": {
    "build:shared": "pnpm --filter @thesis/shared build",
    "dev:server": "pnpm --filter server start:dev",
    "test:server": "pnpm --filter server test && pnpm --filter server test:e2e",
    "lint:server": "pnpm --filter server lint"
  }
}
```

- [ ] **Step 4: Crear `pnpm-workspace.yaml`**

```yaml
packages:
  - shared
  - server
```

- [ ] **Step 5: Crear `README.md` raíz**

```markdown
# Thesis Repository — Universidad de Córdoba (MIETIA)

Monorepo:

- `shared/` — enums y tipos compartidos (`@thesis/shared`)
- `server/` — API NestJS + MongoDB Atlas (ver `server/README.md`)
- `client/` — Nuxt 4 (fase 2)

Diseño: `docs/superpowers/specs/2026-11-17-server-design.md`
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json pnpm-workspace.yaml README.md docs/superpowers
git commit -m "chore: initialize monorepo with design spec and stage 1 plan"
```

---

### Task 2: Paquete `@thesis/shared`

**Files:**
- Create: `/shared/package.json`, `/shared/tsconfig.json`, `/shared/src/index.ts`, `/shared/src/roles.ts`, `/shared/src/thesis-status.ts`, `/shared/src/error-codes.ts`

- [ ] **Step 1: `shared/package.json`**

```json
{
  "name": "@thesis/shared",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: `shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `shared/src/roles.ts`**

```ts
export enum Role {
  ADMIN = 'ADMIN',
  COORDINATOR = 'COORDINATOR',
  INTERNAL_JUROR = 'INTERNAL_JUROR',
  EXTERNAL_JUROR = 'EXTERNAL_JUROR',
  STUDENT = 'STUDENT',
}

export const JUROR_ROLES: readonly Role[] = [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR];
```

- [ ] **Step 4: `shared/src/thesis-status.ts`**

```ts
export enum ThesisStatus {
  SUBMITTED = 'SUBMITTED',
  JURORS_ASSIGNED = 'JURORS_ASSIGNED',
  PENDING_JUROR_REPLACEMENT = 'PENDING_JUROR_REPLACEMENT',
  UNDER_EVALUATION = 'UNDER_EVALUATION',
  IN_DISPUTE = 'IN_DISPUTE',
  REVISIONS_IN_PROGRESS = 'REVISIONS_IN_PROGRESS',
  READY_FOR_DEFENSE = 'READY_FOR_DEFENSE',
  DEFENSE_SCHEDULED = 'DEFENSE_SCHEDULED',
  NOT_APPROVED = 'NOT_APPROVED',
  COMPLETED_APPROVED = 'COMPLETED_APPROVED',
  COMPLETED_FAILED = 'COMPLETED_FAILED',
}

/** RF-P02 / RF-P03 — progress percentage per status (spec §4). */
export const THESIS_PROGRESS: Readonly<Record<ThesisStatus, number>> = {
  [ThesisStatus.SUBMITTED]: 10,
  [ThesisStatus.JURORS_ASSIGNED]: 25,
  [ThesisStatus.PENDING_JUROR_REPLACEMENT]: 25,
  [ThesisStatus.UNDER_EVALUATION]: 45,
  [ThesisStatus.IN_DISPUTE]: 50,
  [ThesisStatus.REVISIONS_IN_PROGRESS]: 60,
  [ThesisStatus.READY_FOR_DEFENSE]: 75,
  [ThesisStatus.DEFENSE_SCHEDULED]: 85,
  [ThesisStatus.NOT_APPROVED]: 100,
  [ThesisStatus.COMPLETED_APPROVED]: 100,
  [ThesisStatus.COMPLETED_FAILED]: 100,
};
```

- [ ] **Step 5: `shared/src/error-codes.ts`**

```ts
/** Stable error codes returned by the API. The client maps them to Spanish UI messages. */
export enum ErrorCode {
  // generic
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  RATE_LIMITED = 'RATE_LIMITED',
  HTTP_ERROR = 'HTTP_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // auth
  AUTH_UNAUTHENTICATED = 'AUTH_UNAUTHENTICATED',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_USER_INACTIVE = 'AUTH_USER_INACTIVE',
  AUTH_REFRESH_INVALID = 'AUTH_REFRESH_INVALID',
  AUTH_WRONG_PASSWORD = 'AUTH_WRONG_PASSWORD',
  // users
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_EMAIL_TAKEN = 'USER_EMAIL_TAKEN',
  USER_PASSWORD_REQUIRED = 'USER_PASSWORD_REQUIRED',
  USER_JUROR_PROFILE_REQUIRED = 'USER_JUROR_PROFILE_REQUIRED',
}
```

- [ ] **Step 6: `shared/src/index.ts`**

```ts
export * from './roles';
export * from './thesis-status';
export * from './error-codes';
```

- [ ] **Step 7: Instalar y compilar**

Run:
```bash
pnpm install && pnpm build:shared && ls shared/dist
```
Expected: `error-codes.d.ts error-codes.js index.d.ts index.js roles.d.ts roles.js thesis-status.d.ts thesis-status.js`.

- [ ] **Step 8: Commit**

```bash
git add shared pnpm-lock.yaml
git commit -m "feat(shared): add role, thesis status and error code enums"
```

---

### Task 3: Scaffold del server, dependencias y validación de entorno

**Files:**
- Create (generated): `/server/*`
- Create: `/server/.env.example`, `/server/src/config/env.validation.ts`
- Delete: `/server/src/app.controller.ts`, `/server/src/app.service.ts`, `/server/src/app.controller.spec.ts`, `/server/test/app.e2e-spec.ts`
- Modify: `/server/package.json` (scripts)

- [ ] **Step 1: Generar el proyecto Nest**

Run (en la raíz):
```bash
pnpm dlx @nestjs/cli@11 new server --package-manager pnpm --skip-git --skip-install --strict
```
Expected: carpeta `server/` con `src/main.ts`, `src/app.module.ts`, `test/jest-e2e.json`, `package.json`.

- [ ] **Step 2: Borrar los ejemplos generados**

```bash
rm server/src/app.controller.ts server/src/app.service.ts server/src/app.controller.spec.ts server/test/app.e2e-spec.ts
```

- [ ] **Step 3: Instalar dependencias**

```bash
pnpm install
pnpm --filter server add @thesis/shared@workspace:* @nestjs/config @nestjs/mongoose mongoose@^8 @nestjs/jwt @nestjs/swagger @nestjs/throttler joi bcryptjs class-validator class-transformer cookie-parser helmet
pnpm --filter server add -D @types/cookie-parser mongodb-memory-server supertest @types/supertest
```
Expected: sin errores (puede haber avisos de "ignored build scripts"; `mongodb-memory-server` descarga el binario de mongod en la primera prueba).

- [ ] **Step 4: Ajustar scripts de `server/package.json`**

Dejar el bloque `scripts` así (los demás campos generados no cambian):
```json
"scripts": {
  "build": "nest build",
  "prebuild": "pnpm --filter @thesis/shared build",
  "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
  "start": "nest start",
  "start:dev": "nest start --watch",
  "start:prod": "node dist/main",
  "lint": "eslint \"{src,test}/**/*.ts\"",
  "pretest": "pnpm --filter @thesis/shared build",
  "test": "jest",
  "test:watch": "jest --watch",
  "test:cov": "jest --coverage",
  "pretest:e2e": "pnpm --filter @thesis/shared build",
  "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
  "admin:create": "nest start --entryFile cli/create-admin"
}
```

- [ ] **Step 5: `server/src/config/env.validation.ts`**

```ts
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3001),
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  CLIENT_URL: Joi.string().uri().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL_DAYS: Joi.number().integer().positive().default(7),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
});
```

- [ ] **Step 6: `server/.env.example`**

```dotenv
NODE_ENV=development
PORT=3001
# MongoDB Atlas connection string (write the real one in server/.env, never commit it)
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/thesis_repository?retryWrites=true&w=majority
CLIENT_URL=http://localhost:3000
# Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_ACCESS_SECRET=change-me-at-least-32-characters-long-access
JWT_REFRESH_SECRET=change-me-at-least-32-characters-long-refresh
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_DAYS=7
# Use "none" (requires HTTPS) when client and server are on different sites in production
COOKIE_SAME_SITE=lax
```

- [ ] **Step 7: Commit**

```bash
git add server pnpm-lock.yaml
git commit -m "chore(server): scaffold NestJS app with dependencies and env validation"
```

---

### Task 4: Excepciones y filtro global de errores

**Files:**
- Create: `server/src/common/errors/app.exception.ts`, `server/src/common/filters/all-exceptions.filter.ts`
- Test: `server/src/common/filters/all-exceptions.filter.spec.ts`

- [ ] **Step 1: Escribir la prueba que falla**

`server/src/common/filters/all-exceptions.filter.spec.ts`:
```ts
import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';
import { AppException } from '../errors/app.exception';
import { toErrorBody } from './all-exceptions.filter';

describe('toErrorBody', () => {
  it('keeps AppException code, status and details', () => {
    const body = toErrorBody(
      new AppException(ErrorCode.USER_EMAIL_TAKEN, HttpStatus.CONFLICT, 'Email taken', { email: 'a@b.co' }),
    );
    expect(body).toEqual({
      statusCode: 409,
      code: ErrorCode.USER_EMAIL_TAKEN,
      message: 'Email taken',
      details: { email: 'a@b.co' },
    });
  });

  it('maps ValidationPipe errors to VALIDATION_FAILED with messages as details', () => {
    const body = toErrorBody(new BadRequestException(['email must be an email']));
    expect(body.statusCode).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.details).toEqual(['email must be an email']);
  });

  it('maps NotFoundException to NOT_FOUND', () => {
    const body = toErrorBody(new NotFoundException('Cannot GET /x'));
    expect(body).toMatchObject({ statusCode: 404, code: ErrorCode.NOT_FOUND, message: 'Cannot GET /x' });
  });

  it('maps Mongo duplicate key errors to 409 DUPLICATE_KEY', () => {
    const body = toErrorBody({ code: 11000, keyValue: { email: 'a@b.co' } });
    expect(body).toMatchObject({ statusCode: 409, code: ErrorCode.DUPLICATE_KEY, details: { email: 'a@b.co' } });
  });

  it('hides unknown errors behind INTERNAL_ERROR', () => {
    const body = toErrorBody(new Error('db password leaked in message'));
    expect(body).toEqual({ statusCode: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' });
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter server test -- all-exceptions`
Expected: FAIL, `Cannot find module './all-exceptions.filter'`.

- [ ] **Step 3: `server/src/common/errors/app.exception.ts`**

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';

/** Domain error with a stable machine-readable code (see @thesis/shared ErrorCode). */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    status: HttpStatus,
    message?: string,
    public readonly details?: unknown,
  ) {
    super({ code, message: message ?? code, details }, status);
  }
}
```

- [ ] **Step 4: `server/src/common/filters/all-exceptions.filter.ts`**

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';
import type { Response } from 'express';
import { AppException } from '../errors/app.exception';

export interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.AUTH_UNAUTHENTICATED,
  403: ErrorCode.AUTH_FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
};

function isMongoDuplicateKey(e: unknown): e is { code: number; keyValue?: unknown } {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000;
}

export function toErrorBody(exception: unknown): ErrorBody {
  if (exception instanceof AppException) {
    const body: ErrorBody = {
      statusCode: exception.getStatus(),
      code: exception.code,
      message: (exception.getResponse() as { message: string }).message,
    };
    if (exception.details !== undefined) body.details = exception.details;
    return body;
  }

  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const code = STATUS_CODES[statusCode] ?? ErrorCode.HTTP_ERROR;
    if (typeof response === 'object' && response !== null && Array.isArray((response as { message?: unknown }).message)) {
      return { statusCode, code, message: 'Validation failed', details: (response as { message: unknown[] }).message };
    }
    const message =
      typeof response === 'string'
        ? response
        : typeof (response as { message?: unknown }).message === 'string'
          ? (response as { message: string }).message
          : exception.message;
    return { statusCode, code, message };
  }

  if (isMongoDuplicateKey(exception)) {
    return { statusCode: 409, code: ErrorCode.DUPLICATE_KEY, message: 'Duplicate key', details: exception.keyValue };
  }

  return { statusCode: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    host.switchToHttp().getResponse<Response>().status(body.statusCode).json(body);
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `pnpm --filter server test -- all-exceptions`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/common
git commit -m "feat(server): add AppException and global error filter with stable codes"
```

---

### Task 5: Utilidades comunes (regex, password, hash, paginación)

**Files:**
- Create: `server/src/common/utils/escape-regex.ts`, `server/src/common/security/password.ts`, `server/src/common/security/hash.ts`, `server/src/common/pagination/pagination.dto.ts`
- Test: `server/src/common/utils/escape-regex.spec.ts`

- [ ] **Step 1: Prueba que falla**

`server/src/common/utils/escape-regex.spec.ts`:
```ts
import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('escapes regex metacharacters so user input matches literally', () => {
    const rx = new RegExp(escapeRegex('a.b*(c)'), 'i');
    expect(rx.test('A.B*(C)')).toBe(true);
    expect(rx.test('aXbbbc')).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter server test -- escape-regex`
Expected: FAIL, `Cannot find module './escape-regex'`.

- [ ] **Step 3: Implementar las utilidades**

`server/src/common/utils/escape-regex.ts`:
```ts
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

`server/src/common/security/password.ts`:
```ts
import { compare, hash } from 'bcryptjs';

const COST = process.env.NODE_ENV === 'test' ? 4 : 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, COST);
}

export function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}
```

`server/src/common/security/hash.ts`:
```ts
import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

`server/src/common/pagination/pagination.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter server test -- escape-regex`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/common
git commit -m "feat(server): add regex escaping, password hashing, sha256 and pagination helpers"
```

---

### Task 6: Decoradores y guards de autenticación y roles

**Files:**
- Create: `server/src/common/types/auth-user.ts`, `server/src/common/decorators/{public,roles,current-user}.decorator.ts`, `server/src/common/guards/jwt-auth.guard.ts`, `server/src/common/guards/roles.guard.ts`, `server/src/auth/auth.constants.ts`
- Test: `server/src/common/guards/roles.guard.spec.ts`

- [ ] **Step 1: Prueba que falla**

`server/src/common/guards/roles.guard.spec.ts`:
```ts
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, Role } from '@thesis/shared';
import { AppException } from '../errors/app.exception';
import { RolesGuard } from './roles.guard';

function contextWith(user?: { roles: Role[] }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  afterEach(() => jest.restoreAllMocks());

  it('allows routes without @Roles metadata', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('allows a user holding one of the required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN, Role.COORDINATOR]);
    expect(guard.canActivate(contextWith({ roles: [Role.COORDINATOR] }))).toBe(true);
  });

  it('rejects a user without the required roles with AUTH_FORBIDDEN', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    try {
      guard.canActivate(contextWith({ roles: [Role.STUDENT] }));
      fail('expected AppException');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe(ErrorCode.AUTH_FORBIDDEN);
      expect((e as AppException).getStatus()).toBe(403);
    }
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter server test -- roles.guard`
Expected: FAIL, `Cannot find module './roles.guard'`.

- [ ] **Step 3: Tipos y decoradores**

`server/src/common/types/auth-user.ts`:
```ts
import { Role } from '@thesis/shared';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: Role[];
  /** Present only for external-juror sessions (stage 3). */
  scope?: { assignmentIds: string[] };
}

export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
  scope?: { assignmentIds: string[] };
}
```

`server/src/common/decorators/public.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`server/src/common/decorators/roles.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@thesis/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

`server/src/common/decorators/current-user.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../types/auth-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
```

`server/src/auth/auth.constants.ts`:
```ts
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
/** Refresh cookie is only sent to auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/auth';
```

- [ ] **Step 4: Guards**

`server/src/common/guards/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, Role } from '@thesis/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppException } from '../errors/app.exception';
import { AuthUser } from '../types/auth-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !required.some((role) => user.roles.includes(role))) {
      throw new AppException(ErrorCode.AUTH_FORBIDDEN, HttpStatus.FORBIDDEN, 'Insufficient role');
    }
    return true;
  }
}
```

`server/src/common/guards/jwt-auth.guard.ts`:
```ts
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@thesis/shared';
import type { Request } from 'express';
import { ACCESS_COOKIE } from '../../auth/auth.constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../errors/app.exception';
import { AccessTokenPayload, AuthUser } from '../types/auth-user';

function extractAccessToken(req: Request): string | undefined {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractAccessToken(req);
    if (!token) throw new AppException(ErrorCode.AUTH_UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, 'Missing token');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      req.user = { id: payload.sub, email: payload.email, roles: payload.roles, scope: payload.scope };
      return true;
    } catch {
      throw new AppException(ErrorCode.AUTH_UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, 'Invalid or expired token');
    }
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `pnpm --filter server test -- roles.guard`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/common server/src/auth/auth.constants.ts
git commit -m "feat(server): add Public/Roles/CurrentUser decorators and JWT/roles guards"
```

---

### Task 7: AppModule, bootstrap, health y harness e2e

**Files:**
- Modify: `server/src/app.module.ts`, `server/src/main.ts`, `server/test/jest-e2e.json`
- Create: `server/src/app.setup.ts`, `server/src/swagger.ts`, `server/src/health.controller.ts`, `server/test/global-setup.ts`, `server/test/global-teardown.ts`, `server/test/utils/test-app.ts`
- Test: `server/test/health.e2e-spec.ts`

El `AppModule` de esta tarea aún no importa `UsersModule` ni `AuthModule`; se agregan en las tareas 8 y 9. `JwtModule` se registra aquí como global para que lo use `JwtAuthGuard`.

- [ ] **Step 1: Harness e2e**

`server/test/jest-e2e.json`:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "globalSetup": "<rootDir>/global-setup.ts",
  "globalTeardown": "<rootDir>/global-teardown.ts",
  "testTimeout": 30000
}
```

`server/test/global-setup.ts`:
```ts
import { MongoMemoryServer } from 'mongodb-memory-server';

/** Starts one in-memory MongoDB for the whole e2e run. Env vars set here are inherited by test workers. */
export default async function globalSetup(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  (globalThis as Record<string, unknown>).__MONGOD__ = mongod;
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongod.getUri('thesis_e2e');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
  process.env.CLIENT_URL = 'http://localhost:3000';
}
```

`server/test/global-teardown.ts`:
```ts
import type { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalTeardown(): Promise<void> {
  const mongod = (globalThis as Record<string, unknown>).__MONGOD__ as MongoMemoryServer | undefined;
  await mongod?.stop();
}
```

`server/test/utils/test-app.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Drops the database so each e2e file starts clean (files run in band). */
export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.get<Connection>(getConnectionToken()).dropDatabase();
  await app.close();
}
```

- [ ] **Step 2: Prueba e2e que falla**

`server/test/health.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp } from './utils/test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => closeTestApp(app));

  it('GET /api/health is public', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown routes return the uniform error body', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 3: Verificar que falla**

Run: `pnpm --filter server test:e2e`
Expected: FAIL, `Cannot find module '../../src/app.setup'`.

- [ ] **Step 4: `server/src/app.setup.ts`**

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Global HTTP configuration shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const isProd = config.get<string>('NODE_ENV') === 'production';

  app.setGlobalPrefix('api');
  // Swagger UI needs inline scripts, so CSP is only enforced in production (where Swagger is disabled).
  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));
  app.use(cookieParser());
  app.enableCors({ origin: config.get<string>('CLIENT_URL', 'http://localhost:3000'), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
}
```

- [ ] **Step 5: `server/src/swagger.ts`**

```ts
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_COOKIE } from './auth/auth.constants';

export function setupSwagger(app: INestApplication): void {
  const doc = new DocumentBuilder()
    .setTitle('Thesis Repository API')
    .setDescription('Universidad de Córdoba — postgraduate thesis evaluation platform')
    .setVersion('0.1.0')
    .addCookieAuth(ACCESS_COOKIE)
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
```

- [ ] **Step 6: `server/src/health.controller.ts`**

```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 7: `server/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { envValidationSchema } from './config/env.validation';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ uri: config.getOrThrow<string>('MONGODB_URI') }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    // Secrets are passed per sign/verify call; global so JwtAuthGuard can inject JwtService.
    JwtModule.register({ global: true }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 8: `server/src/main.ts`**

```ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const config = app.get(ConfigService);
  if (config.get<string>('NODE_ENV') !== 'production') setupSwagger(app);
  await app.listen(Number(config.get('PORT', 3001)));
}

void bootstrap();
```

- [ ] **Step 9: Verificar que pasa**

Run: `pnpm --filter server test:e2e`
Expected: PASS, 2 tests. La primera ejecución puede tardar mientras se descarga mongod.

- [ ] **Step 10: Commit**

```bash
git add server
git commit -m "feat(server): add app module with global guards, bootstrap, health and e2e harness"
```

---

### Task 8: Módulo `users`

**Files:**
- Create: `server/src/users/schemas/user.schema.ts`, `server/src/users/dto/{create-user,update-user,query-users}.dto.ts`, `server/src/users/users.service.ts`, `server/src/users/users.controller.ts`, `server/src/users/users.module.ts`
- Modify: `server/src/app.module.ts` (importar `UsersModule`), `server/test/utils/test-app.ts` (helpers `createUser`, `loginAgent`)
- Test: `server/test/users.e2e-spec.ts`

`loginAgent` necesita el endpoint de login (Task 9). Por eso en esta tarea los usuarios se crean con el servicio y las peticiones autenticadas se prueban hasta que exista el login. La prueba se escribe ahora y se completa en Task 9 Step 7.

- [ ] **Step 1: Schema**

`server/src/users/schemas/user.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Role } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class JurorProfile {
  @Prop({ required: true, trim: true })
  institution!: string;

  /** RF-C13: at least one assigned juror must belong to Universidad de Córdoba. */
  @Prop({ required: true, default: false })
  isUnicordoba!: boolean;

  @Prop({ trim: true })
  highestDegree?: string;

  @Prop({ trim: true })
  country?: string;

  @Prop({ type: [String], default: [] })
  expertise!: string[];
}
export const JurorProfileSchema = SchemaFactory.createForClass(JurorProfile);

@Schema({ _id: false })
export class StudentProfile {
  @Prop({ required: true, trim: true })
  studentCode!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  programId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  cohortId?: Types.ObjectId;
}
export const StudentProfileSchema = SchemaFactory.createForClass(StudentProfile);

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /** Absent for external jurors (they use token access, RF-J14). */
  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ required: true, trim: true })
  lastName!: string;

  @Prop({ trim: true })
  documentId?: string;

  @Prop({ type: [String], enum: Object.values(Role), required: true })
  roles!: Role[];

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ type: JurorProfileSchema })
  jurorProfile?: JurorProfile;

  @Prop({ type: StudentProfileSchema })
  studentProfile?: StudentProfile;

  @Prop({ index: true })
  seedTag?: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ roles: 1, isActive: 1 });
```

- [ ] **Step 2: DTOs**

`server/src/users/dto/create-user.dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Role } from '@thesis/shared';

export class JurorProfileDto {
  @IsString()
  @IsNotEmpty()
  institution!: string;

  @IsBoolean()
  isUnicordoba!: boolean;

  @IsOptional()
  @IsString()
  highestDegree?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expertise?: string[];
}

export class StudentProfileDto {
  @IsString()
  @IsNotEmpty()
  studentCode!: string;

  @IsOptional()
  @IsMongoId()
  programId?: string;

  @IsOptional()
  @IsMongoId()
  cohortId?: string;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  /** Required for every role except a pure EXTERNAL_JUROR (validated in UsersService). */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(Role, { each: true })
  roles!: Role[];

  @IsOptional()
  @ValidateNested()
  @Type(() => JurorProfileDto)
  jurorProfile?: JurorProfileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StudentProfileDto)
  studentProfile?: StudentProfileDto;
}
```

`server/src/users/dto/update-user.dto.ts`:
```ts
import { OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['email', 'password'] as const)) {}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
```

`server/src/users/dto/query-users.dto.ts`:
```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@thesis/shared';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export class QueryUsersDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;
}

export class FacultyQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}
```

- [ ] **Step 3: Servicio**

`server/src/users/users.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, JUROR_ROLES, Role } from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { Paginated } from '../common/pagination/pagination.dto';
import { hashPassword } from '../common/security/password';
import { escapeRegex } from '../common/utils/escape-regex';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserDocument } from './schemas/user.schema';

const USER_SORT_FIELDS = ['email', 'firstName', 'lastName', 'createdAt'];

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const isExternalOnly = dto.roles.every((r) => r === Role.EXTERNAL_JUROR);
    if (!dto.password && !isExternalOnly) {
      throw new AppException(ErrorCode.USER_PASSWORD_REQUIRED, HttpStatus.BAD_REQUEST, 'Password is required');
    }
    if (dto.roles.some((r) => JUROR_ROLES.includes(r)) && !dto.jurorProfile) {
      throw new AppException(ErrorCode.USER_JUROR_PROFILE_REQUIRED, HttpStatus.BAD_REQUEST, 'Juror profile is required');
    }
    if (await this.model.exists({ email: dto.email.toLowerCase() })) {
      throw new AppException(ErrorCode.USER_EMAIL_TAKEN, HttpStatus.CONFLICT, 'Email already registered');
    }
    const { password, ...rest } = dto;
    return this.model.create({ ...rest, passwordHash: password ? await hashPassword(password) : undefined });
  }

  async findById(id: string): Promise<UserDocument> {
    const user = isValidObjectId(id) ? await this.model.findById(id) : null;
    if (!user) throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    return user;
  }

  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.model.findOne({ email: email.toLowerCase() }).select('+passwordHash').exec();
  }

  async findByIdWithPassword(id: string): Promise<UserDocument> {
    const user = isValidObjectId(id) ? await this.model.findById(id).select('+passwordHash') : null;
    if (!user) throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    return user;
  }

  async list(query: QueryUsersDto): Promise<Paginated<UserDocument>> {
    const filter: FilterQuery<User> = {};
    if (query.role) filter.roles = query.role;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }
    const sortField = query.sort && USER_SORT_FIELDS.includes(query.sort) ? query.sort : 'createdAt';
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ [sortField]: query.order === 'desc' ? -1 : 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.model.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  /** Autocomplete for juror selection (CU-01): active internal and external jurors. */
  searchFaculty(q?: string): Promise<UserDocument[]> {
    const filter: FilterQuery<User> = { roles: { $in: [...JUROR_ROLES] }, isActive: true };
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { 'jurorProfile.institution': rx }];
    }
    return this.model.find(filter).sort({ lastName: 1, firstName: 1 }).limit(20).exec();
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    await this.findById(id);
    const updated = await this.model.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
    if (!updated) throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    return updated;
  }

  async setActive(id: string, isActive: boolean): Promise<UserDocument> {
    const user = await this.findById(id);
    user.isActive = isActive;
    return user.save();
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { passwordHash: await hashPassword(password) });
  }
}
```

- [ ] **Step 4: Controlador y módulo**

`server/src/users/users.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { FacultyQueryDto, QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto, UpdateUserStatusDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.COORDINATOR)
  list(@Query() query: QueryUsersDto) {
    return this.users.list(query);
  }

  // Declared before ':id' so "faculty" is not parsed as an id.
  @Get('faculty')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  faculty(@Query() query: FacultyQueryDto) {
    return this.users.searchFaculty(query.q);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  findOne(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  setStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.users.setActive(id, dto.isActive);
  }
}
```

`server/src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

En `server/src/app.module.ts`, agregar `import { UsersModule } from './users/users.module';` y añadir `UsersModule` al final del arreglo `imports`.

- [ ] **Step 5: Helpers de prueba**

Reemplazar `server/test/utils/test-app.ts` completo por:
```ts
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { JUROR_ROLES } from '@thesis/shared';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CreateUserDto } from '../../src/users/dto/create-user.dto';
import { UserDocument } from '../../src/users/schemas/user.schema';
import { UsersService } from '../../src/users/users.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Drops the database so each e2e file starts clean (files run in band). */
export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.get<Connection>(getConnectionToken()).dropDatabase();
  await app.close();
}

export const TEST_PASSWORD = 'Password123!';

export type TestAgent = ReturnType<typeof request.agent>;

export function createUser(
  app: INestApplication,
  data: Partial<CreateUserDto> & Pick<CreateUserDto, 'roles'>,
): Promise<UserDocument> {
  const isJuror = data.roles.some((r) => JUROR_ROLES.includes(r));
  return app.get(UsersService).create({
    email: `${data.roles[0].toLowerCase()}.${randomUUID().slice(0, 8)}@test.edu.co`,
    password: TEST_PASSWORD,
    firstName: 'Test',
    lastName: 'User',
    jurorProfile: isJuror ? { institution: 'Universidad de Córdoba', isUnicordoba: true } : undefined,
    ...data,
  });
}

/** Returns a supertest agent that keeps the auth cookies. */
export async function loginAgent(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<TestAgent> {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}
```

- [ ] **Step 6: Escribir la prueba e2e (falla hasta Task 9)**

`server/test/users.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import request from 'supertest';
import { closeTestApp, createTestApp, createUser, loginAgent, TEST_PASSWORD, TestAgent } from './utils/test-app';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    const adminUser = await createUser(app, { roles: [Role.ADMIN] });
    const coordinatorUser = await createUser(app, { roles: [Role.COORDINATOR] });
    admin = await loginAgent(app, adminUser.email);
    coordinator = await loginAgent(app, coordinatorUser.email);
  });
  afterAll(() => closeTestApp(app));

  const newCoordinator = {
    email: 'new.coordinator@test.edu.co',
    password: TEST_PASSWORD,
    firstName: 'Ana',
    lastName: 'Pérez',
    roles: [Role.COORDINATOR],
  };

  it('admin creates a user without exposing the password hash', async () => {
    const res = await admin.post('/api/users').send(newCoordinator).expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBe(newCoordinator.email);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body._id).toBeUndefined();
  });

  it('rejects a duplicated email with USER_EMAIL_TAKEN', async () => {
    const res = await admin.post('/api/users').send(newCoordinator).expect(409);
    expect(res.body.code).toBe('USER_EMAIL_TAKEN');
  });

  it('requires a password for non-external users', async () => {
    const noPassword = { email: 'nopass@test.edu.co', firstName: 'Ana', lastName: 'Pérez', roles: [Role.COORDINATOR] };
    const res = await admin.post('/api/users').send(noPassword).expect(400);
    expect(res.body.code).toBe('USER_PASSWORD_REQUIRED');
  });

  it('requires a juror profile for jurors', async () => {
    const res = await admin
      .post('/api/users')
      .send({ ...newCoordinator, email: 'juror.noprofile@test.edu.co', roles: [Role.INTERNAL_JUROR] })
      .expect(400);
    expect(res.body.code).toBe('USER_JUROR_PROFILE_REQUIRED');
  });

  it('creates an external juror without password (RF-C14)', async () => {
    const res = await admin
      .post('/api/users')
      .send({
        email: 'external.juror@unal.edu.co',
        firstName: 'Carlos',
        lastName: 'Gómez',
        roles: [Role.EXTERNAL_JUROR],
        jurorProfile: { institution: 'Universidad Nacional', isUnicordoba: false, country: 'Colombia', highestDegree: 'PhD' },
      })
      .expect(201);
    expect(res.body.jurorProfile.isUnicordoba).toBe(false);
  });

  it('rejects invalid payloads with VALIDATION_FAILED', async () => {
    const res = await admin.post('/api/users').send({ email: 'not-an-email', roles: ['KING'] }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('forbids coordinators from creating users', async () => {
    const res = await coordinator.post('/api/users').send({ ...newCoordinator, email: 'x@test.edu.co' }).expect(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('forbids students from listing users', async () => {
    const student = await createUser(app, { roles: [Role.STUDENT], studentProfile: { studentCode: 'S-001' } });
    const agent = await loginAgent(app, student.email);
    await agent.get('/api/users').expect(403);
  });

  it('searches faculty for the juror autocomplete', async () => {
    await createUser(app, {
      roles: [Role.INTERNAL_JUROR],
      firstName: 'Mariana',
      lastName: 'López',
      jurorProfile: { institution: 'Universidad de Córdoba', isUnicordoba: true },
    });
    const res = await coordinator.get('/api/users/faculty').query({ q: 'marian' }).expect(200);
    expect(res.body.map((u: { firstName: string }) => u.firstName)).toContain('Mariana');
    for (const u of res.body as { roles: string[] }[]) {
      expect(u.roles.some((r) => r === 'INTERNAL_JUROR' || r === 'EXTERNAL_JUROR')).toBe(true);
    }
  });

  it('lists users paginated and sorted', async () => {
    const res = await admin.get('/api/users').query({ limit: 2, sort: 'email', order: 'asc' }).expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    expect(res.body.page).toBe(1);
    expect(res.body.items[0].email <= res.body.items[1].email).toBe(true);
  });

  it('deactivated users cannot log in', async () => {
    const user = await createUser(app, { roles: [Role.COORDINATOR] });
    await admin.patch(`/api/users/${user.id}/status`).send({ isActive: false }).expect(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);
    expect(res.body.code).toBe('AUTH_USER_INACTIVE');
  });

  it('returns USER_NOT_FOUND for unknown or malformed ids', async () => {
    expect((await admin.get('/api/users/507f1f77bcf86cd799439011').expect(404)).body.code).toBe('USER_NOT_FOUND');
    expect((await admin.get('/api/users/abc').expect(404)).body.code).toBe('USER_NOT_FOUND');
  });
});
```

- [ ] **Step 7: Verificar que compila y que falla solo por falta de login**

Run: `pnpm --filter server test:e2e -- users`
Expected: FAIL en `beforeAll`: `loginAgent` recibe 401 en `/api/auth/login` (la ruta aún no existe). Esto confirma que el módulo compila y que falta el login.

- [ ] **Step 8: Commit**

```bash
git add server
git commit -m "feat(server): add users module with RBAC-protected CRUD and faculty search"
```

---

### Task 9: Módulo `auth` (login, refresh rotativo, logout, me, password)

**Files:**
- Create: `server/src/auth/schemas/refresh-token.schema.ts`, `server/src/auth/dto/login.dto.ts`, `server/src/auth/dto/change-password.dto.ts`, `server/src/auth/auth.service.ts`, `server/src/auth/auth.controller.ts`, `server/src/auth/auth.module.ts`
- Modify: `server/src/app.module.ts` (importar `AuthModule`)
- Test: `server/test/auth.e2e-spec.ts`

- [ ] **Step 1: Prueba e2e que falla**

`server/test/auth.e2e-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import request, { Response } from 'supertest';
import { closeTestApp, createTestApp, createUser, loginAgent, TEST_PASSWORD } from './utils/test-app';

function cookiesOf(res: Response): Record<string, string> {
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return Object.fromEntries(
    raw.map((c) => {
      const [pair] = c.split(';');
      const [name, ...value] = pair.split('=');
      return [name, value.join('=')];
    }),
  );
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let email: string;

  beforeAll(async () => {
    app = await createTestApp();
    email = (await createUser(app, { roles: [Role.COORDINATOR] })).email;
  });
  afterAll(() => closeTestApp(app));

  const login = (body: object) => request(app.getHttpServer()).post('/api/auth/login').send(body);

  it('logs in and sets httpOnly access and refresh cookies', async () => {
    const res = await login({ email, password: TEST_PASSWORD }).expect(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookies = cookiesOf(res);
    expect(cookies.access_token).toBeTruthy();
    expect(cookies.refresh_token).toBeTruthy();
    const header = (res.headers['set-cookie'] as unknown as string[]).join(' | ');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/api/auth');
  });

  it('rejects a wrong password with AUTH_INVALID_CREDENTIALS', async () => {
    const res = await login({ email, password: 'wrong-password' }).expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the same code', async () => {
    const res = await login({ email: 'ghost@test.edu.co', password: TEST_PASSWORD }).expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('validates the login body', async () => {
    const res = await login({ email: 'nope' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('requires a session for /me', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    expect(res.body.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('returns the current user with the cookie session', async () => {
    const agent = await loginAgent(app, email);
    const res = await agent.get('/api/auth/me').expect(200);
    expect(res.body.user.email).toBe(email);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const server = app.getHttpServer();
    const first = cookiesOf(await login({ email, password: TEST_PASSWORD }).expect(200)).refresh_token;

    const rotated = await request(server).post('/api/auth/refresh').set('Cookie', `refresh_token=${first}`).expect(200);
    const second = cookiesOf(rotated).refresh_token;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(rotated.body.user.email).toBe(email);

    const reuse = await request(server).post('/api/auth/refresh').set('Cookie', `refresh_token=${first}`).expect(401);
    expect(reuse.body.code).toBe('AUTH_REFRESH_INVALID');
    // reuse detection revoked the whole family, including the newest token
    await request(server).post('/api/auth/refresh').set('Cookie', `refresh_token=${second}`).expect(401);
  });

  it('rejects refresh without cookie', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    expect(res.body.code).toBe('AUTH_REFRESH_INVALID');
  });

  it('logout clears the session', async () => {
    const agent = await loginAgent(app, email);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('changes the password and revokes refresh tokens', async () => {
    const user = await createUser(app, { roles: [Role.STUDENT], studentProfile: { studentCode: 'S-900' } });
    const agent = await loginAgent(app, user.email);

    const wrong = await agent
      .patch('/api/auth/password')
      .send({ currentPassword: 'not-my-password', newPassword: 'NewPassword456!' })
      .expect(400);
    expect(wrong.body.code).toBe('AUTH_WRONG_PASSWORD');

    await agent.patch('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPassword456!' }).expect(204);
    await agent.post('/api/auth/refresh').expect(401);
    await login({ email: user.email, password: TEST_PASSWORD }).expect(401);
    await login({ email: user.email, password: 'NewPassword456!' }).expect(200);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter server test:e2e -- auth`
Expected: FAIL, el login responde 401 `AUTH_UNAUTHENTICATED` porque la ruta no existe.

- [ ] **Step 3: Schema de refresh token y DTOs**

`server/src/auth/schemas/refresh-token.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'refreshTokens' })
export class RefreshToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  /** SHA-256 of the signed refresh JWT; the raw token is never stored. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /** All tokens issued from one login share a family; reuse of a rotated token revokes the family. */
  @Prop({ required: true, index: true })
  familyId!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  replacedBy?: string;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

`server/src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
```

`server/src/auth/dto/change-password.dto.ts`:
```ts
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
```

- [ ] **Step 4: Servicio de auth**

`server/src/auth/auth.service.ts`:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode } from '@thesis/shared';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
import { verifyPassword } from '../common/security/password';
import { AccessTokenPayload } from '../common/types/auth-user';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './schemas/refresh-token.schema';

interface RefreshTokenPayload {
  sub: string;
  fid: string;
  jti: string;
}

export interface SessionResult {
  user: UserDocument;
  accessToken: string;
  refreshToken: string;
}

const refreshInvalid = () =>
  new AppException(ErrorCode.AUTH_REFRESH_INVALID, HttpStatus.UNAUTHORIZED, 'Invalid refresh token');

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(RefreshToken.name) private readonly refreshTokens: Model<RefreshToken>,
  ) {}

  get accessTtlSeconds(): number {
    return Number(this.config.get('JWT_ACCESS_TTL_SECONDS', 900));
  }

  get refreshTtlDays(): number {
    return Number(this.config.get('JWT_REFRESH_TTL_DAYS', 7));
  }

  async login(email: string, password: string): Promise<SessionResult> {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, 'Invalid credentials');
    }
    if (!user.isActive) {
      throw new AppException(ErrorCode.AUTH_USER_INACTIVE, HttpStatus.FORBIDDEN, 'User is inactive');
    }
    return { user, ...(await this.issueTokens(user, randomUUID())) };
  }

  async refresh(token: string | undefined): Promise<SessionResult> {
    if (!token) throw refreshInvalid();
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw refreshInvalid();
    }

    const stored = await this.refreshTokens.findOne({ tokenHash: sha256(token) });
    if (!stored || stored.revokedAt) {
      // A rotated or unknown token was presented: treat as theft and revoke the whole family.
      await this.revokeFamily(payload.fid);
      throw refreshInvalid();
    }

    const user = await this.users.findById(payload.sub).catch(() => null);
    if (!user) throw refreshInvalid();
    if (!user.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new AppException(ErrorCode.AUTH_USER_INACTIVE, HttpStatus.FORBIDDEN, 'User is inactive');
    }

    const tokens = await this.issueTokens(user, stored.familyId);
    stored.revokedAt = new Date();
    stored.replacedBy = sha256(tokens.refreshToken);
    await stored.save();
    return { user, ...tokens };
  }

  /** Always succeeds: an expired or malformed cookie must not block logging out. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const payload = this.jwt.decode<RefreshTokenPayload | null>(token);
    if (payload?.fid) await this.revokeFamily(payload.fid);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppException(ErrorCode.AUTH_WRONG_PASSWORD, HttpStatus.BAD_REQUEST, 'Current password is incorrect');
    }
    await this.users.setPassword(userId, newPassword);
    await this.refreshTokens.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  }

  private async issueTokens(user: UserDocument, familyId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: AccessTokenPayload = { sub: user.id as string, email: user.email, roles: user.roles };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtlSeconds,
    });

    const refreshPayload: RefreshTokenPayload = { sub: user.id as string, fid: familyId, jti: randomUUID() };
    const refreshSeconds = this.refreshTtlDays * 86_400;
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshSeconds,
    });

    await this.refreshTokens.create({
      userId: user._id,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + refreshSeconds * 1000),
    });
    return { accessToken, refreshToken };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
  }
}
```

- [ ] **Step 5: Controlador y módulo**

`server/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthUser } from '../common/types/auth-user';
import { UsersService } from '../users/users.service';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(dto.email, dto.password);
    this.setCookies(res, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.refresh(this.refreshCookie(req));
    this.setCookies(res, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.refreshCookie(req));
    res.clearCookie(ACCESS_COOKIE, this.cookieOptions('/'));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(REFRESH_COOKIE_PATH));
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.users.findById(user.id) };
  }

  @Patch('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  private refreshCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }

  private cookieOptions(path: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE', 'lax'),
      path,
    };
  }

  private setCookies(res: Response, accessToken: string, refreshToken: string): void {
    res.cookie(ACCESS_COOKIE, accessToken, {
      ...this.cookieOptions('/'),
      maxAge: this.auth.accessTtlSeconds * 1000,
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.cookieOptions(REFRESH_COOKIE_PATH),
      maxAge: this.auth.refreshTtlDays * 86_400_000,
    });
  }
}
```

`server/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken, RefreshTokenSchema } from './schemas/refresh-token.schema';

@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }])],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

En `server/src/app.module.ts`, agregar `import { AuthModule } from './auth/auth.module';` y añadir `AuthModule` al final de `imports`.

- [ ] **Step 6: Verificar auth**

Run: `pnpm --filter server test:e2e -- auth`
Expected: PASS, 10 tests.

- [ ] **Step 7: Verificar users (ahora con login disponible)**

Run: `pnpm --filter server test:e2e -- users`
Expected: PASS, 12 tests.

- [ ] **Step 8: Commit**

```bash
git add server
git commit -m "feat(server): add auth with httpOnly cookies, rotating refresh tokens and password change"
```

---

### Task 10: CLI para crear el administrador, README y verificación final

**Files:**
- Create: `server/src/cli/create-admin.ts`, `server/README.md`

- [ ] **Step 1: `server/src/cli/create-admin.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { Role } from '@thesis/shared';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';

/** Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm --filter server admin:create */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const users = app.get(UsersService);
  if (await users.findByEmailWithPassword(email)) {
    console.log(`User ${email} already exists`);
  } else {
    await users.create({ email, password, firstName: 'System', lastName: 'Admin', roles: [Role.ADMIN] });
    console.log(`Admin ${email} created`);
  }
  await app.close();
}

void main();
```

- [ ] **Step 2: `server/README.md`**

````markdown
# Thesis Repository — Server (NestJS)

## Requisitos
- Node 22, pnpm 11
- Un cluster de MongoDB Atlas (o un MongoDB local)

## Configuración
1. `cp .env.example .env` y escribir `MONGODB_URI` (cadena de Atlas) y dos secretos JWT de al menos 32 caracteres:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Desde la raíz del monorepo: `pnpm install`

## Comandos (desde la raíz)
| Comando | Descripción |
|---|---|
| `pnpm dev:server` | API en modo watch en `http://localhost:3001/api` |
| `pnpm --filter server test` | Pruebas unitarias |
| `pnpm --filter server test:e2e` | Pruebas e2e (MongoDB en memoria, nunca Atlas) |
| `pnpm lint:server` | ESLint |
| `ADMIN_EMAIL=admin@unicordoba.edu.co ADMIN_PASSWORD='***' pnpm --filter server admin:create` | Crea el primer administrador |

Swagger (fuera de producción): `http://localhost:3001/api/docs`

## Autenticación
- `POST /api/auth/login` deja las cookies httpOnly `access_token` (15 min) y `refresh_token` (7 días, path `/api/auth`).
- `POST /api/auth/refresh` rota el refresh token. Si se reutiliza un token viejo, se revoca toda la sesión.
- Errores: `{ statusCode, code, message, details? }`; los códigos están en `@thesis/shared` (`ErrorCode`).
````

- [ ] **Step 3: Verificación completa**

Run:
```bash
pnpm --filter server lint && pnpm --filter server build && pnpm test:server
```
Expected: lint sin errores (se aceptan advertencias), build OK, unitarias PASS (3 suites, 9 tests) y e2e PASS (3 suites, 24 tests).

- [ ] **Step 4: Prueba contra Atlas (manual, la hace el usuario)**

Con `server/.env` configurado:
```bash
ADMIN_EMAIL=admin@unicordoba.edu.co ADMIN_PASSWORD='ChangeMe123!' pnpm --filter server admin:create
pnpm dev:server
curl -i -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@unicordoba.edu.co","password":"ChangeMe123!"}'
```
Expected: `Admin ... created`, el server escuchando en 3001, y el login con `HTTP/1.1 200` y dos `Set-Cookie`.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): add create-admin CLI and server README"
```

---

## Siguientes planes (uno por sub-etapa, se escriben al terminar la anterior)

2. `catalogs`, `theses`, `files` (GridFS), `workflow`
3. `assignments`: CU-01, CU-08, token de jurado externo y `POST /auth/external/validate-token`, cuenta regresiva
4. `evaluations` y `feedback`: CU-02, CU-06, registro de vista y descarga
5. `disputes`: CU-05, RN-08
6. `defenses` y `minutes`: CU-03, CU-04
7. `audit`, `notifications`, `traceability`, `dashboard`, `reports`
8. `scheduler`, `settings`, `seed` masivo, README final
