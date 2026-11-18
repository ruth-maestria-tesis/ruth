import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { JUROR_ROLES } from '@thesis/shared';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
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
