import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Role } from '@thesis/shared';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { User } from '../src/users/schemas/user.schema';
import {
  closeTestApp,
  createTestApp,
  createUser,
  http,
  loginAgent,
  TEST_PASSWORD,
  TestAgent,
} from './utils/test-app';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let coordinator: TestAgent;
  let adminId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const adminUser = await createUser(app, { roles: [Role.ADMIN] });
    adminId = adminUser.id as string;
    const coordinatorUser = await createUser(app, {
      roles: [Role.COORDINATOR],
    });
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
    const noPassword = {
      email: 'nopass@test.edu.co',
      firstName: 'Ana',
      lastName: 'Pérez',
      roles: [Role.COORDINATOR],
    };
    const res = await admin.post('/api/users').send(noPassword).expect(400);
    expect(res.body.code).toBe('USER_PASSWORD_REQUIRED');
  });

  it('requires a juror profile for jurors', async () => {
    const res = await admin
      .post('/api/users')
      .send({
        ...newCoordinator,
        email: 'juror.noprofile@test.edu.co',
        roles: [Role.INTERNAL_JUROR],
      })
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
        jurorProfile: {
          institution: 'Universidad Nacional',
          isUnicordoba: false,
          country: 'Colombia',
          highestDegree: 'PhD',
        },
      })
      .expect(201);
    expect(res.body.jurorProfile.isUnicordoba).toBe(false);
  });

  it('rejects invalid payloads with VALIDATION_FAILED', async () => {
    const res = await admin
      .post('/api/users')
      .send({ email: 'not-an-email', roles: ['KING'] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('rejects duplicated roles with VALIDATION_FAILED', async () => {
    const res = await admin
      .post('/api/users')
      .send({
        ...newCoordinator,
        email: 'dup.roles@test.edu.co',
        roles: [Role.COORDINATOR, Role.COORDINATOR],
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects duplicated roles on update with VALIDATION_FAILED', async () => {
    const user = await createUser(app, { roles: [Role.COORDINATOR] });
    const res = await admin
      .patch(`/api/users/${user.id}`)
      .send({ roles: [Role.COORDINATOR, Role.COORDINATOR] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('forbids coordinators from creating users', async () => {
    const res = await coordinator
      .post('/api/users')
      .send({ ...newCoordinator, email: 'x@test.edu.co' })
      .expect(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('forbids students from listing users', async () => {
    const student = await createUser(app, {
      roles: [Role.STUDENT],
      studentProfile: { studentCode: 'S-001' },
    });
    const agent = await loginAgent(app, student.email);
    await agent.get('/api/users').expect(403);
  });

  it('searches faculty for the juror autocomplete', async () => {
    const nonJuror = await createUser(app, {
      roles: [Role.COORDINATOR],
      firstName: 'Mariana',
      lastName: 'Coordinadora',
    });
    const inactiveJuror = await createUser(app, {
      roles: [Role.INTERNAL_JUROR],
      firstName: 'Mariana',
      lastName: 'Inactiva',
    });
    await admin
      .patch(`/api/users/${inactiveJuror.id}/status`)
      .send({ isActive: false })
      .expect(200);
    await createUser(app, {
      roles: [Role.INTERNAL_JUROR],
      firstName: 'Mariana',
      lastName: 'López',
      jurorProfile: {
        institution: 'Universidad de Córdoba',
        isUnicordoba: true,
      },
    });
    const res = await coordinator
      .get('/api/users/faculty')
      .query({ q: 'marian' })
      .expect(200);
    expect(res.body.map((u: { firstName: string }) => u.firstName)).toContain(
      'Mariana',
    );
    for (const u of res.body as { roles: string[] }[]) {
      expect(
        u.roles.some((r) => r === 'INTERNAL_JUROR' || r === 'EXTERNAL_JUROR'),
      ).toBe(true);
    }
    const emails = (res.body as { email: string }[]).map((u) => u.email);
    expect(emails).not.toContain(nonJuror.email);
    expect(emails).not.toContain(inactiveJuror.email);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const allowed = [
      'id',
      'firstName',
      'lastName',
      'email',
      'roles',
      'isActive',
      'jurorProfile',
    ];
    for (const u of res.body as Record<string, unknown>[]) {
      expect(typeof u.id).toBe('string');
      for (const key of Object.keys(u)) expect(allowed).toContain(key);
    }
  });

  it('rejects an oversized search query', async () => {
    for (const path of ['/api/users', '/api/users/faculty']) {
      const res = await coordinator
        .get(path)
        .query({ q: 'x'.repeat(101) })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('lists users paginated and sorted', async () => {
    const tag = `list${randomUUID().slice(0, 8)}`;
    for (const suffix of ['d', 'b', 'a', 'c']) {
      await createUser(app, {
        roles: [Role.COORDINATOR],
        email: `${tag}.${suffix}@test.edu.co`,
      });
    }
    const res = await admin
      .get('/api/users')
      .query({ q: tag, limit: 2, sort: 'email', order: 'asc' })
      .expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(4);
    expect(res.body.items[0].email).toBe(`${tag}.a@test.edu.co`);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.body.page).toBe(1);
    expect(res.body.items[0].email <= res.body.items[1].email).toBe(true);
  });

  it('deactivated users cannot log in', async () => {
    const user = await createUser(app, { roles: [Role.COORDINATOR] });
    await admin
      .patch(`/api/users/${user.id}/status`)
      .send({ isActive: false })
      .expect(200);
    const res = await request(http(app))
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);
    expect(res.body.code).toBe('AUTH_USER_INACTIVE');
  });

  describe('PATCH /api/users/:id', () => {
    it('forbids coordinators from updating users or their status', async () => {
      const user = await createUser(app, { roles: [Role.COORDINATOR] });
      const upd = await coordinator
        .patch(`/api/users/${user.id}`)
        .send({ firstName: 'Nope' })
        .expect(403);
      expect(upd.body.code).toBe('AUTH_FORBIDDEN');
      const status = await coordinator
        .patch(`/api/users/${user.id}/status`)
        .send({ isActive: false })
        .expect(403);
      expect(status.body.code).toBe('AUTH_FORBIDDEN');
    });

    it('rejects isActive through the generic update (whitelist)', async () => {
      const user = await createUser(app, { roles: [Role.COORDINATOR] });
      const res = await admin
        .patch(`/api/users/${user.id}`)
        .send({ isActive: false })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('updates a user, persists the change and hides the hash', async () => {
      const user = await createUser(app, { roles: [Role.COORDINATOR] });
      const res = await admin
        .patch(`/api/users/${user.id}`)
        .send({ firstName: 'Renamed', lastName: 'Person' })
        .expect(200);
      expect(res.body.firstName).toBe('Renamed');
      expect(res.body.passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      const fetched = await admin.get(`/api/users/${user.id}`).expect(200);
      expect(fetched.body.firstName).toBe('Renamed');
      expect(fetched.body.lastName).toBe('Person');
    });

    it('requires a juror profile when adding a juror role', async () => {
      const user = await createUser(app, { roles: [Role.COORDINATOR] });
      const res = await admin
        .patch(`/api/users/${user.id}`)
        .send({ roles: [Role.COORDINATOR, Role.INTERNAL_JUROR] })
        .expect(400);
      expect(res.body.code).toBe('USER_JUROR_PROFILE_REQUIRED');
    });

    it('requires a password when an external juror gets another role', async () => {
      const juror = await createUser(app, {
        roles: [Role.EXTERNAL_JUROR],
        password: undefined,
      });
      const res = await admin
        .patch(`/api/users/${juror.id}`)
        .send({ roles: [Role.EXTERNAL_JUROR, Role.COORDINATOR] })
        .expect(400);
      expect(res.body.code).toBe('USER_PASSWORD_REQUIRED');
    });
  });

  describe('admin lockout protection', () => {
    it('an admin cannot remove ADMIN from their own roles', async () => {
      const res = await admin
        .patch(`/api/users/${adminId}`)
        .send({ roles: [Role.COORDINATOR] })
        .expect(400);
      expect(res.body.code).toBe('USER_SELF_LOCKOUT');
    });

    it('an admin cannot deactivate themselves', async () => {
      const res = await admin
        .patch(`/api/users/${adminId}/status`)
        .send({ isActive: false })
        .expect(400);
      expect(res.body.code).toBe('USER_SELF_LOCKOUT');
    });

    it('rejects self-deactivation through an uppercased own id', async () => {
      // Another active admin exists, so only the self check can stop this request.
      await createUser(app, { roles: [Role.ADMIN] });
      const res = await admin
        .patch(`/api/users/${adminId.toUpperCase()}/status`)
        .send({ isActive: false })
        .expect(400);
      expect(res.body.code).toBe('USER_SELF_LOCKOUT');
    });

    it('never leaves zero active admins', async () => {
      // A second admin whose access token outlives its own demotion (15 min by design).
      const other = await createUser(app, { roles: [Role.ADMIN] });
      const otherAgent = await loginAgent(app, other.email);
      const users = app.get<Model<User>>(getModelToken(User.name));
      await users.updateMany(
        { roles: Role.ADMIN, _id: { $ne: adminId } },
        { isActive: false },
      );

      const deactivate = await otherAgent
        .patch(`/api/users/${adminId}/status`)
        .send({ isActive: false })
        .expect(409);
      expect(deactivate.body.code).toBe('USER_LAST_ADMIN');
      const demote = await otherAgent
        .patch(`/api/users/${adminId}`)
        .send({ roles: [Role.COORDINATOR] })
        .expect(409);
      expect(demote.body.code).toBe('USER_LAST_ADMIN');

      const stillAdmin = await admin.get(`/api/users/${adminId}`).expect(200);
      expect(stillAdmin.body.roles).toContain(Role.ADMIN);
      expect(stillAdmin.body.isActive).toBe(true);
    });
  });

  describe('session revocation', () => {
    it('deactivation revokes the refresh tokens of the user', async () => {
      const user = await createUser(app, { roles: [Role.COORDINATOR] });
      const agent = await loginAgent(app, user.email);
      await admin
        .patch(`/api/users/${user.id}/status`)
        .send({ isActive: false })
        .expect(200);
      const res = await agent.post('/api/auth/refresh').expect(401);
      expect(res.body.code).toBe('AUTH_REFRESH_INVALID');
    });

    it('a role change revokes the refresh tokens of the user', async () => {
      const user = await createUser(app, { roles: [Role.COORDINATOR] });
      const agent = await loginAgent(app, user.email);
      await admin
        .patch(`/api/users/${user.id}`)
        .send({
          roles: [Role.INTERNAL_JUROR],
          jurorProfile: {
            institution: 'Universidad de Córdoba',
            isUnicordoba: true,
          },
        })
        .expect(200);
      const res = await agent.post('/api/auth/refresh').expect(401);
      expect(res.body.code).toBe('AUTH_REFRESH_INVALID');
    });
  });

  it('returns USER_NOT_FOUND for unknown or malformed ids', async () => {
    expect(
      (await admin.get('/api/users/507f1f77bcf86cd799439011').expect(404)).body
        .code,
    ).toBe('USER_NOT_FOUND');
    expect((await admin.get('/api/users/abc').expect(404)).body.code).toBe(
      'USER_NOT_FOUND',
    );
  });

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
      .send({
        ...newCoordinator,
        email: 'long@test.edu.co',
        firstName: 'x'.repeat(101),
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
