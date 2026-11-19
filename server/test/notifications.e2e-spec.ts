import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { ErrorCode, Role } from '@thesis/shared';
import { Model } from 'mongoose';
import { Notification } from '../src/notifications/schemas/notification.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createTestApp,
  createThesisUnderEvaluation,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

interface NotificationView {
  id: string;
  type: string;
  title: string;
  link?: string;
  readAt?: string;
}

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
  });
  afterAll(() => closeTestApp(app));

  const list = async (agent: TestAgent, qs = '') =>
    (await agent.get(`/api/notifications${qs}`).expect(200)).body as {
      items: NotificationView[];
      total: number;
    };

  /** Listeners run asynchronously after the emit: poll until the condition holds. */
  async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
    let value = await fn();
    for (let i = 0; i < 50 && !ok(value); i++) {
      await new Promise((r) => setTimeout(r, 50));
      value = await fn();
    }
    return value;
  }

  it('CU-01 notifies the juror; read, read-all and unread-count work; ownership is enforced', async () => {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    await assignJury(app, thesis.id as string, [
      j1.id as string,
      j2.id as string,
    ]);
    const juror1 = await loginAgent(app, j1.email);
    const juror2 = await loginAgent(app, j2.email);

    const mine = await eventually(
      () => list(juror1),
      (r) => r.total >= 1,
    );
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      type: 'assignment.created',
      link: '/juror',
    });
    expect(mine.items[0].readAt).toBeUndefined();
    expect(
      (await juror1.get('/api/notifications/unread-count').expect(200)).body,
    ).toEqual({ count: 1 });

    // Another user's notification is a 404, not a leak.
    const other = (await eventually(
      () => list(juror2),
      (r) => r.total >= 1,
    )) as { items: NotificationView[] };
    const res = await juror1
      .post(`/api/notifications/${other.items[0].id}/read`)
      .expect(404);
    expect((res.body as { code: string }).code).toBe(
      ErrorCode.NOTIFICATION_NOT_FOUND,
    );
    await juror1.post('/api/notifications/not-an-id/read').expect(400);

    const read = await juror1
      .post(`/api/notifications/${mine.items[0].id}/read`)
      .expect(200);
    expect((read.body as NotificationView).readAt).toEqual(expect.any(String));
    expect((await list(juror1, '?unread=true')).total).toBe(0);
    expect(
      (await juror1.get('/api/notifications/unread-count').expect(200)).body,
    ).toEqual({ count: 0 });
    // juror2 was untouched.
    expect((await list(juror2, '?unread=true')).total).toBe(1);
    await juror2.post('/api/notifications/read-all').expect(200);
    expect((await list(juror2, '?unread=true')).total).toBe(0);
    expect((await list(juror2)).total).toBe(1);
  });

  it('a decline notifies every coordinator', async () => {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    const { assignments } = await assignJury(app, thesis.id as string, [
      j1.id as string,
      j2.id as string,
    ]);
    const before = (await list(coordinator, '?unread=true')).total;
    await (
      await loginAgent(app, j1.email)
    )
      .post(`/api/assignments/${assignments[0].id}/decline`)
      .send({ reason: 'Conflicto de agenda' })
      .expect(200);
    const after = await eventually(
      () => list(coordinator, '?unread=true'),
      (r) => r.total > before,
    );
    expect(after.items[0]).toMatchObject({
      type: 'assignment.declined',
      link: `/coordinator/theses/${thesis.id as string}`,
    });
  });

  it('evaluation.submitted notifies the student; broken payloads do not throw', async () => {
    const studentUser = await createUser(app, { roles: [Role.STUDENT] });
    const thesis = await createAssignableThesis(app, undefined, {
      studentId: studentUser.id as string,
    });
    const student = await loginAgent(app, studentUser.email);
    const events = app.get(EventEmitter2);
    expect(() => events.emit('evaluation.submitted', undefined)).not.toThrow();
    expect(() =>
      events.emit('defense.confirmed', { thesisId: 'garbage' }),
    ).not.toThrow();
    events.emit('evaluation.submitted', {
      thesisId: thesis.id as string,
      evaluationId: 'e1',
      verdict: 'APPROVED',
    });
    const res = await eventually(
      () => list(student),
      (r) => r.items.some((n) => n.type === 'evaluation.submitted'),
    );
    expect(
      res.items.filter((n) => n.type === 'evaluation.submitted'),
    ).toHaveLength(1);
  });

  /** Recipients (user ids) of notifications of `type` about `thesisId`, once they appear. */
  async function recipients(type: string, thesisId: string, min: number) {
    const model = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    const rows = await eventually(
      () => model.find({ type, thesisId }).lean().exec(),
      (r) => r.length >= min,
    );
    return rows.map((r) => String(r.userId)).sort();
  }

  it('thesis.status.changed also reaches the advisor', async () => {
    const fx = await createThesisUnderEvaluation(app);
    const ids = await recipients(
      'thesis.status.changed',
      fx.thesis.id as string,
      2,
    );
    expect(ids).toContain(fx.thesis.studentId.toHexString());
    expect(ids).toContain(fx.thesis.advisorId.toHexString());
  });

  it('defense and feedback events reach the student and the active jurors', async () => {
    const fx = await createThesisUnderEvaluation(app);
    const thesisId = fx.thesis.id as string;
    const events = app.get(EventEmitter2);
    const student = fx.student.id as string;
    const jurors = fx.jurors.map((j) => j.id as string);

    events.emit('feedback.reopened', {
      thesisId,
      itemId: 'i1',
      jurorId: jurors[0],
      studentId: student,
    });
    expect(await recipients('feedback.reopened', thesisId, 1)).toEqual([
      student,
    ]);

    events.emit('defense.updated', { thesisId, defenseId: 'd1' });
    expect(await recipients('defense.updated', thesisId, 3)).toEqual(
      [student, ...jurors].sort(),
    );
    const model = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    const updated = await model
      .findOne({ type: 'defense.updated', thesisId })
      .exec();
    expect(updated?.body).toContain('fue reprogramada, confirme de nuevo');

    events.emit('defense.cancelled', { thesisId, defenseId: 'd1' });
    expect(await recipients('defense.cancelled', thesisId, 3)).toEqual(
      [student, ...jurors].sort(),
    );
  });

  it('defense jurors follow the active-juror rule (no PENDING, no unsubmitted tiebreaker)', async () => {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    await assignJury(app, thesis.id as string, [
      j1.id as string,
      j2.id as string,
    ]);
    const thesisId = thesis.id as string;
    app.get(EventEmitter2).emit('defense.proposed', { thesisId });
    // Both assignments are still PENDING: only the student is notified.
    expect(await recipients('defense.proposed', thesisId, 1)).toEqual([
      thesis.studentId.toHexString(),
    ]);
  });
});
