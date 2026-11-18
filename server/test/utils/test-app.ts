import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { JUROR_ROLES, PeriodTerm, ProgramLevel } from '@thesis/shared';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CatalogsService } from '../../src/catalogs/catalogs.service';
import { CreateUserDto } from '../../src/users/dto/create-user.dto';
import { UserDocument } from '../../src/users/schemas/user.schema';
import { UsersService } from '../../src/users/users.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  // Unique indexes must exist before the first test, otherwise duplicate-key tests race index builds.
  await app.get<Connection>(getConnectionToken()).syncIndexes();
  return app;
}

/** Drops the database so each e2e file starts clean (files run in band). */
export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.get<Connection>(getConnectionToken()).dropDatabase();
  await app.close();
}

/** Typed HTTP server for supertest (getHttpServer() is typed as any). */
export const http = (app: INestApplication): App => app.getHttpServer() as App;

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
    jurorProfile: isJuror
      ? { institution: 'Universidad de Córdoba', isUnicordoba: true }
      : undefined,
    ...data,
  });
}

/** Returns a supertest agent that keeps the auth cookies. */
export async function loginAgent(
  app: INestApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<TestAgent> {
  const agent = request.agent(http(app));
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

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

/** Minimal buffers that pass magic-byte detection. */
export const PDF_BYTES = Buffer.from('%PDF-1.4\n% test manuscript\n%%EOF\n');
export const DOCX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(26),
  Buffer.from('[Content_Types].xml'),
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
