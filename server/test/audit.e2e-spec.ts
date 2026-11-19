import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Role } from '@thesis/shared';
import type { Model } from 'mongoose';
import request from 'supertest';
import { AuditLog } from '../src/audit/schemas/audit-log.schema';
import {
  closeTestApp,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  http,
  loginAgent,
  TEST_PASSWORD,
  TestAgent,
} from './utils/test-app';

interface Entry {
  id: string;
  at: string;
  actorId?: string;
  actorRoles: string[];
  action: string;
  method?: string;
  path?: string;
  entityType?: string;
  entityId?: string;
  statusCode?: number;
  meta?: Record<string, unknown>;
}

describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let coordinatorId: string;
  let model: Model<AuditLog>;

  beforeAll(async () => {
    app = await createTestApp();
    model = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
    const c = await createUser(app, { roles: [Role.COORDINATOR] });
    coordinatorId = c.id as string;
    coordinator = await loginAgent(app, c.email);
  });
  afterAll(() => closeTestApp(app));

  /** Writes are fire-and-forget, so poll until the entry shows up. */
  async function waitForLogs(
    agent: TestAgent,
    qs: string,
    minItems = 1,
  ): Promise<{ items: Entry[]; total: number }> {
    for (let i = 0; i < 40; i++) {
      const res = await agent.get(`/api/audit-logs?${qs}`).expect(200);
      if ((res.body as { total: number }).total >= minItems)
        return res.body as { items: Entry[]; total: number };
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`No audit entries for ${qs}`);
  }

  it('records a successful mutation with the route pattern and entity', async () => {
    const catalog = await createCatalog(app);
    const thesis = await createThesis(app, catalog);
    await coordinator
      .patch(`/api/theses/${thesis.id}`)
      .send({ title: 'Título actualizado' })
      .expect(200);

    const { items } = await waitForLogs(
      coordinator,
      `entityId=${thesis.id as string}`,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      action: 'PATCH /theses/:id',
      method: 'PATCH',
      path: `/api/theses/${thesis.id as string}`,
      entityType: 'theses',
      entityId: thesis.id,
      actorId: coordinatorId,
      actorRoles: [Role.COORDINATOR],
      statusCode: 200,
    });
  });

  it('takes the entity id from the response on create and does not log failures or reads', async () => {
    const catalog = await createCatalog(app);
    const student = await createUser(app, { roles: [Role.STUDENT] });
    const advisor = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const created = await coordinator
      .post('/api/theses')
      .send({
        title: 'Nueva',
        studentId: student.id,
        advisorId: advisor.id,
        ...catalog,
      })
      .expect(201);
    await coordinator.post('/api/theses').send({}).expect(400);
    await coordinator
      .get(`/api/theses/${created.body.id as string}`)
      .expect(200);

    const { items } = await waitForLogs(
      coordinator,
      `entityId=${created.body.id as string}`,
    );
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe('POST /theses');
    expect(items[0].entityType).toBe('theses');

    const all = await coordinator
      .get('/api/audit-logs?action=' + encodeURIComponent('POST /theses'))
      .expect(200);
    // Only the successful create(s); the 400 was not recorded.
    expect((all.body.items as Entry[]).every((e) => e.statusCode === 201)).toBe(
      true,
    );
    const gets = await coordinator
      .get('/api/audit-logs?action=' + encodeURIComponent('GET /theses/:id'))
      .expect(200);
    expect(gets.body.total).toBe(0);
  });

  it('never stores passwords when the password is changed', async () => {
    const user = await createUser(app, { roles: [Role.STUDENT] });
    const agent = await loginAgent(app, user.email);
    const newPassword = 'Un0tr0Secreto!Largo';
    await agent
      .patch('/api/auth/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword })
      .expect(204);

    const { items } = await waitForLogs(
      coordinator,
      `actorId=${user.id as string}&action=${encodeURIComponent('PATCH /auth/password')}`,
    );
    expect(items).toHaveLength(1);
    expect(items[0].meta).toBeUndefined();

    const raw = JSON.stringify(await model.find().lean().exec());
    expect(raw).not.toContain(newPassword);
    expect(raw).not.toContain(TEST_PASSWORD);
  });

  it('records login success, login failure (attempted e-mail only) and logout', async () => {
    const user = await createUser(app, { roles: [Role.STUDENT] });
    const agent = request.agent(http(app));
    await agent
      .post('/api/auth/login')
      .send({ email: user.email, password: 'incorrecta-123' })
      .expect(401);
    await agent
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    await agent.post('/api/auth/logout').expect(204);

    const failure = await waitForLogs(coordinator, 'action=AUTH_LOGIN_FAILURE');
    const mine = failure.items.find((e) => e.meta?.email === user.email);
    expect(mine).toMatchObject({ statusCode: 401, entityType: 'auth' });
    expect(mine?.actorId).toBeUndefined();

    const success = await waitForLogs(
      coordinator,
      `action=AUTH_LOGIN_SUCCESS&actorId=${user.id as string}`,
    );
    expect(success.items[0].actorRoles).toEqual([Role.STUDENT]);
    const logout = await waitForLogs(
      coordinator,
      `action=AUTH_LOGOUT&actorId=${user.id as string}`,
    );
    expect(logout.items).toHaveLength(1);

    expect(JSON.stringify(await model.find().lean().exec())).not.toContain(
      'incorrecta-123',
    );
  });

  it('filters by actor, entity, action and date range, newest first, paginated', async () => {
    const catalog = await createCatalog(app);
    const t1 = await createThesis(app, catalog);
    const before = new Date(Date.now() - 1000).toISOString();
    await coordinator
      .patch(`/api/theses/${t1.id}`)
      .send({ title: 'Uno' })
      .expect(200);
    await coordinator
      .patch(`/api/theses/${t1.id}`)
      .send({ title: 'Dos' })
      .expect(200);
    await waitForLogs(coordinator, `entityId=${t1.id as string}`, 2);

    const res = await coordinator
      .get(
        `/api/audit-logs?actorId=${coordinatorId}&entityType=theses&entityId=${t1.id as string}&action=${encodeURIComponent('PATCH /theses/:id')}&from=${before}&to=${new Date(Date.now() + 1000).toISOString()}&limit=1&page=1`,
      )
      .expect(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(res.body.items).toHaveLength(1);

    const both = await coordinator
      .get(`/api/audit-logs?entityId=${t1.id as string}`)
      .expect(200);
    const times = (both.body.items as Entry[]).map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const future = await coordinator
      .get(
        `/api/audit-logs?entityId=${t1.id as string}&from=${new Date(Date.now() + 60_000).toISOString()}`,
      )
      .expect(200);
    expect(future.body.total).toBe(0);
    const other = await coordinator
      .get(`/api/audit-logs?entityType=users&entityId=${t1.id as string}`)
      .expect(200);
    expect(other.body.total).toBe(0);
    await coordinator.get('/api/audit-logs?actorId=nope').expect(400);
    await coordinator.get('/api/audit-logs?from=ayer').expect(400);
  });

  it('is restricted to ADMIN and COORDINATOR and has no write endpoints', async () => {
    const student = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.STUDENT] })).email,
    );
    const juror = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).email,
    );
    await student.get('/api/audit-logs').expect(403);
    await juror.get('/api/audit-logs').expect(403);
    const admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    await admin.get('/api/audit-logs').expect(200);
    await admin.delete('/api/audit-logs/abc').expect(404);
    await admin.patch('/api/audit-logs/abc').send({}).expect(404);
  });

  it('is insert-only at the model level', async () => {
    const doc = await model.create({ action: 'TEST_EVENT', actorRoles: [] });
    await expect(
      model.updateOne({ _id: doc._id }, { action: 'X' }),
    ).rejects.toThrow('insert-only');
    await expect(
      model.findOneAndUpdate({ _id: doc._id }, { action: 'X' }),
    ).rejects.toThrow('insert-only');
    await expect(model.deleteOne({ _id: doc._id })).rejects.toThrow(
      'insert-only',
    );
    await expect(model.deleteMany({})).rejects.toThrow('insert-only');
    doc.action = 'Y';
    await expect(doc.save()).rejects.toThrow('insert-only');
    await expect(doc.deleteOne()).rejects.toThrow('insert-only');
    expect(await model.countDocuments({ action: 'TEST_EVENT' })).toBe(1);
  });
});
