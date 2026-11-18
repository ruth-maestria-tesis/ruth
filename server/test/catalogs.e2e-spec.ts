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
        .send({
          code: 'MIETIA',
          name: 'Maestría en Innovación Educativa',
          level: 'MASTER',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        code: 'MIETIA',
        level: 'MASTER',
        isActive: true,
      });
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
      await coordinator
        .patch('/api/programs/nope')
        .send({ name: 'X' })
        .expect(400);
    });
  });

  describe('periods', () => {
    it('creates a period with a derived code', async () => {
      const res = await coordinator
        .post('/api/periods')
        .send({
          year: 2026,
          term: 'II',
          startsAt: '2026-07-01',
          endsAt: '2026-12-15',
        })
        .expect(201);
      expect(res.body.code).toBe('2026-II');
      periodId = res.body.id;
    });

    it('rejects endsAt before startsAt with PERIOD_INVALID_RANGE', async () => {
      const res = await coordinator
        .post('/api/periods')
        .send({
          year: 2027,
          term: 'I',
          startsAt: '2027-06-01',
          endsAt: '2027-01-01',
        })
        .expect(400);
      expect(res.body.code).toBe('PERIOD_INVALID_RANGE');
    });

    it('lists periods newest first', async () => {
      await coordinator
        .post('/api/periods')
        .send({
          year: 2026,
          term: 'I',
          startsAt: '2026-01-15',
          endsAt: '2026-06-15',
        })
        .expect(201);
      const res = await student.get('/api/periods').expect(200);
      expect(res.body.map((p: { code: string }) => p.code)).toEqual([
        '2026-II',
        '2026-I',
      ]);
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
      expect(res.body).toMatchObject({
        programId,
        periodId,
        number: 1,
        name: 'Corte 1',
      });
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
      const res = await student
        .get(`/api/cohorts?programId=${programId}`)
        .expect(200);
      expect(res.body.map((c: { number: number }) => c.number)).toEqual([1, 2]);
    });
  });
});
