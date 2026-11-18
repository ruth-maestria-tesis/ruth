import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import request from 'supertest';
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

  beforeAll(async () => {
    app = await createTestApp();
    const adminUser = await createUser(app, { roles: [Role.ADMIN] });
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
  });

  it('lists users paginated and sorted', async () => {
    const res = await admin
      .get('/api/users')
      .query({ limit: 2, sort: 'email', order: 'asc' })
      .expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
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

  it('returns USER_NOT_FOUND for unknown or malformed ids', async () => {
    expect(
      (await admin.get('/api/users/507f1f77bcf86cd799439011').expect(404)).body
        .code,
    ).toBe('USER_NOT_FOUND');
    expect((await admin.get('/api/users/abc').expect(404)).body.code).toBe(
      'USER_NOT_FOUND',
    );
  });
});
