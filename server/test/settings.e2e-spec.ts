import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import {
  closeTestApp,
  createTestApp,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Settings (e2e)', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
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
    expect(res.body.id).toBe('global');
    expect(res.body.__v).toBeUndefined();
    await admin.get('/api/settings').expect(200);
  });

  it('admin updates deadlines and holidays; coordinator cannot', async () => {
    const res = await admin
      .patch('/api/settings')
      .send({
        acceptanceBusinessDays: 5,
        holidays: ['2026-12-08', '2026-12-25'],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      acceptanceBusinessDays: 5,
      evaluationBusinessDays: 20,
      holidays: ['2026-12-08', '2026-12-25'],
    });
    await coordinator
      .patch('/api/settings')
      .send({ acceptanceBusinessDays: 3 })
      .expect(403);
  });

  it.each([
    [{ acceptanceBusinessDays: 0 }],
    [{ evaluationBusinessDays: 500 }],
    [{ holidays: ['08/12/2026'] }],
    [{ holidays: ['2026-12-08', '2026-12-08'] }],
    [{ holidays: ['2026-02-31'] }],
    [{ thesisCodePrefix: 'X' }],
    [{ acceptanceBusinessDays: null }],
  ])('rejects invalid input %j', async (body) => {
    await admin.patch('/api/settings').send(body).expect(400);
  });
});
