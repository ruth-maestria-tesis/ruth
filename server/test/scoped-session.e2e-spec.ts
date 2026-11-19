import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Role } from '@thesis/shared';
import { Model } from 'mongoose';
import request from 'supertest';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { Notification } from '../src/notifications/schemas/notification.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createExternalJuror,
  createTestApp,
  createUser,
  http,
} from './utils/test-app';

describe('Scoped external sessions — deny by default (e2e)', () => {
  let app: INestApplication;
  let assignments: Model<Assignment>;
  let notifications: Model<Notification>;

  beforeAll(async () => {
    app = await createTestApp();
    assignments = app.get(getModelToken(Assignment.name));
    notifications = app.get(getModelToken(Notification.name));
  });
  afterAll(() => closeTestApp(app));

  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  /** One external juror on two theses; the session comes from the first link only. */
  async function setup() {
    const external = await createExternalJuror(app);
    const own = await createAssignableThesis(app);
    const other = await createAssignableThesis(app);
    const first = await assignJury(app, own.id as string, [
      (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id as string,
      external.id as string,
    ]);
    const second = await assignJury(app, other.id as string, [
      (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id as string,
      external.id as string,
    ]);
    const agent = request.agent(http(app));
    const res = await agent
      .post('/api/auth/external/validate-token')
      .send({ token: tokenOf(first.externalLinks[0].url) })
      .expect(200);
    return {
      agent,
      res,
      external,
      own,
      other,
      ownAssignmentId: first.assignments[1].id,
      otherAssignmentId: second.assignments[1].id,
    };
  }

  it('returns 401 AUTH_EXTERNAL_TOKEN_INVALID outside the juror flow', async () => {
    const { agent } = await setup();
    for (const [method, url] of [
      ['get', '/api/programs'],
      ['get', '/api/periods'],
      ['get', '/api/cohorts'],
      ['get', '/api/defenses'],
      ['patch', '/api/auth/password'],
    ] as const) {
      const res = await agent[method](url).send({}).expect(401);
      expect(res.body.code).toBe('AUTH_EXTERNAL_TOKEN_INVALID');
    }
    // The juror flow itself still works.
    await agent.get('/api/auth/me').expect(200);
    await agent.get('/api/assignments/mine').expect(200);
  });

  it('allowed routes are limited to the assigned thesis (404 on another one)', async () => {
    const { agent, own, other, ownAssignmentId } = await setup();
    await agent.post(`/api/assignments/${ownAssignmentId}/accept`).expect(200);
    const ownId = own.id as string;
    const otherId = other.id as string;
    for (const path of [
      'evaluations',
      'feedback',
      'feedback/summary',
      'defense',
      'minutes',
      'graph',
    ]) {
      await agent.get(`/api/theses/${ownId}/${path}`).expect(200);
      await agent.get(`/api/theses/${otherId}/${path}`).expect(404);
    }
    await agent.get(`/api/theses/${otherId}`).expect(404);
  });

  it('notifications only show the assigned thesis', async () => {
    const { agent, external, own, other } = await setup();
    // Listeners run asynchronously: wait for both assignment.created notifications.
    for (let i = 0; i < 50; i++) {
      if ((await notifications.countDocuments({ userId: external._id })) >= 2)
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await notifications.countDocuments({ userId: external._id })).toBe(
      2,
    );
    const res = await agent.get('/api/notifications').expect(200);
    const items = res.body.items as { thesisId?: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].thesisId).toBe(own.id);
    expect(
      (await agent.get('/api/notifications/unread-count').expect(200)).body,
    ).toEqual({ count: 1 });
    const foreign = await notifications
      .findOne({ userId: external._id, thesisId: other._id })
      .exec();
    await agent
      .post(`/api/notifications/${String(foreign!._id)}/read`)
      .expect(404);
    await agent.post('/api/notifications/read-all').expect(200);
    expect(
      (
        await notifications
          .findOne({ userId: external._id, thesisId: other._id })
          .exec()
      )?.readAt,
    ).toBeUndefined();
  });

  it('caps the session at the link expiry', async () => {
    const external = await createExternalJuror(app);
    const thesis = await createAssignableThesis(app);
    const result = await assignJury(app, thesis.id as string, [
      (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id as string,
      external.id as string,
    ]);
    await assignments.updateOne(
      { _id: result.assignments[1].id },
      { externalTokenExpiresAt: new Date(Date.now() + 60_000) },
    );
    const res = await request(http(app))
      .post('/api/auth/external/validate-token')
      .send({ token: tokenOf(result.externalLinks[0].url) })
      .expect(200);
    const maxAge = Number(
      /Max-Age=(\d+)/.exec(res.headers['set-cookie'][0])![1],
    );
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(60);
  });

  it('a deactivated user loses the session at once', async () => {
    const { agent, external } = await setup();
    await agent.get('/api/auth/me').expect(200);
    await app
      .get<Model<unknown>>(getModelToken('User'))
      .updateOne({ _id: external._id }, { isActive: false });
    await agent.get('/api/auth/me').expect(401);
  });
});
