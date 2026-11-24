import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import {
  EvaluationVerdict,
  FeedbackAction,
  FeedbackChapter,
  FeedbackStatus,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model } from 'mongoose';
import { FeedbackService } from '../src/feedback/feedback.service';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createTestApp,
  createThesisUnderEvaluation,
  createUser,
  loginAgent,
  submitEvaluation,
  TestAgent,
} from './utils/test-app';

describe('Feedback — CU-06 / RN-06 (e2e)', () => {
  let app: INestApplication;
  let theses: Model<Thesis>;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    theses = app.get(getModelToken(Thesis.name));
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
  });
  afterAll(() => closeTestApp(app));

  async function setup() {
    const fx = await createThesisUnderEvaluation(app);
    return {
      ...fx,
      thesisId: fx.thesis.id as string,
      juror1: await loginAgent(app, fx.jurors[0].email),
      juror2: await loginAgent(app, fx.jurors[1].email),
      studentAgent: await loginAgent(app, fx.student.email),
    };
  }
  const create = (
    agent: TestAgent,
    thesisId: string,
    chapter = FeedbackChapter.METHODOLOGY,
    content = 'Justificar el tamaño de la muestra',
  ) =>
    agent
      .post(`/api/theses/${thesisId}/feedback`)
      .send({ chapter, reference: 'p. 12', content });

  it('runs the RN-06 lifecycle with the right role at each step', async () => {
    const { thesisId, juror1, juror2, studentAgent, jurors, student } =
      await setup();
    const emitted = jest.spyOn(app.get(EventEmitter2), 'emit');

    const created = await create(juror1, thesisId).expect(201);
    expect(created.body).toMatchObject({
      thesisId,
      jurorId: jurors[0].id,
      juror: { id: jurors[0].id, firstName: 'Test', lastName: 'User' },
      chapter: FeedbackChapter.METHODOLOGY,
      reference: 'p. 12',
      status: FeedbackStatus.PENDING,
      replies: [],
    });
    const id = created.body.id as string;
    expect(emitted).toHaveBeenCalledWith('feedback.created', {
      thesisId,
      itemId: id,
      jurorId: jurors[0].id,
      studentId: student.id,
      actor: { id: jurors[0].id, role: Role.INTERNAL_JUROR },
    });

    // The author cannot resolve a PENDING item; the student addresses it.
    const early = await juror1
      .post(`/api/feedback/${id}/resolve`)
      .send({})
      .expect(409);
    expect(early.body.code).toBe('FEEDBACK_INVALID_TRANSITION');
    await coordinator
      .post(`/api/feedback/${id}/address`)
      .send({ content: 'x' })
      .expect(403);
    await juror1
      .post(`/api/feedback/${id}/address`)
      .send({ content: 'x' })
      .expect(403);
    await studentAgent.post(`/api/feedback/${id}/address`).send({}).expect(400);
    const addressed = await studentAgent
      .post(`/api/feedback/${id}/address`)
      .send({ content: 'Se agregó la justificación en la sección 3.2' })
      .expect(200);
    expect(addressed.body.status).toBe(FeedbackStatus.ADDRESSED);
    expect(addressed.body.replies).toEqual([
      expect.objectContaining({
        authorId: student.id,
        authorName: 'Test User',
        authorRole: Role.STUDENT,
        action: FeedbackAction.ADDRESS,
        fileIds: [],
      }),
    ]);
    const twice = await studentAgent
      .post(`/api/feedback/${id}/address`)
      .send({ content: 'otra vez' })
      .expect(409);
    expect(twice.body.code).toBe('FEEDBACK_INVALID_TRANSITION');

    // Only the author juror resolves or reopens.
    await juror2.post(`/api/feedback/${id}/resolve`).send({}).expect(403);
    await juror2
      .post(`/api/feedback/${id}/reopen`)
      .send({ content: 'no' })
      .expect(403);
    await studentAgent.post(`/api/feedback/${id}/resolve`).send({}).expect(403);
    await coordinator.post(`/api/feedback/${id}/resolve`).send({}).expect(403);
    const reopened = await juror1
      .post(`/api/feedback/${id}/reopen`)
      .send({ content: 'Falta el cálculo de potencia' })
      .expect(200);
    expect(reopened.body.status).toBe(FeedbackStatus.PENDING);
    await juror1
      .post(`/api/feedback/${id}/reopen`)
      .send({ content: 'x' })
      .expect(409);

    await studentAgent
      .post(`/api/feedback/${id}/address`)
      .send({ content: 'Se agregó el cálculo' })
      .expect(200);
    const resolved = await juror1
      .post(`/api/feedback/${id}/resolve`)
      .send({})
      .expect(200);
    expect(resolved.body.status).toBe(FeedbackStatus.RESOLVED);
    expect(
      resolved.body.replies.map((r: { action: string }) => r.action),
    ).toEqual(['ADDRESS', 'REOPEN', 'ADDRESS', 'RESOLVE']);
    for (const event of [
      'feedback.addressed',
      'feedback.reopened',
      'feedback.resolved',
    ]) {
      expect(emitted).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          thesisId,
          itemId: id,
          studentId: student.id,
        }),
      );
    }

    // Any reader may comment; the status does not change.
    const commented = await coordinator
      .post(`/api/feedback/${id}/comment`)
      .send({ content: 'Visto por coordinación' })
      .expect(200);
    expect(commented.body.status).toBe(FeedbackStatus.RESOLVED);
    expect(commented.body.replies.at(-1)).toMatchObject({
      action: 'COMMENT',
      authorRole: Role.COORDINATOR,
    });
    await juror2
      .post(`/api/feedback/${id}/comment`)
      .send({ content: 'De acuerdo' })
      .expect(200);
    emitted.mockRestore();
  });

  it('creates a whole-document observation without chapter (GENERAL)', async () => {
    const { thesisId, juror1 } = await setup();
    const long = 'Observación general del documento completo. '.repeat(200);
    const res = await juror1
      .post(`/api/theses/${thesisId}/feedback`)
      .send({ content: long })
      .expect(201);
    expect(res.body).toMatchObject({
      chapter: FeedbackChapter.GENERAL,
      status: 'PENDING',
    });
    expect(res.body.content.length).toBeGreaterThan(5000);
  });

  it('lists by chapter order with filters, and summarizes', async () => {
    const { thesisId, juror1, juror2, studentAgent } = await setup();
    const c = (
      await create(juror1, thesisId, FeedbackChapter.CONCLUSIONS).expect(201)
    ).body;
    const i = (
      await create(juror2, thesisId, FeedbackChapter.INTRODUCTION).expect(201)
    ).body;
    const m = (
      await create(juror1, thesisId, FeedbackChapter.METHODOLOGY).expect(201)
    ).body;
    await studentAgent
      .post(`/api/feedback/${m.id}/address`)
      .send({ content: 'Listo' })
      .expect(200);
    await juror1.post(`/api/feedback/${m.id}/resolve`).send({}).expect(200);

    const all = await studentAgent
      .get(`/api/theses/${thesisId}/feedback`)
      .expect(200);
    expect(all.body.map((x: { id: string }) => x.id)).toEqual([
      i.id,
      m.id,
      c.id,
    ]);
    const byChapter = await coordinator
      .get(`/api/theses/${thesisId}/feedback?chapter=CONCLUSIONS`)
      .expect(200);
    expect(byChapter.body.map((x: { id: string }) => x.id)).toEqual([c.id]);
    const pending = await juror2
      .get(`/api/theses/${thesisId}/feedback?status=PENDING`)
      .expect(200);
    expect(pending.body).toHaveLength(2);
    await coordinator
      .get(`/api/theses/${thesisId}/feedback?status=NOPE`)
      .expect(400);

    const summary = await coordinator
      .get(`/api/theses/${thesisId}/feedback/summary`)
      .expect(200);
    expect(summary.body).toMatchObject({
      total: 3,
      byStatus: { PENDING: 2, ADDRESSED: 0, RESOLVED: 1 },
      byChapter: {
        INTRODUCTION: { total: 1, resolved: 0 },
        METHODOLOGY: { total: 1, resolved: 1 },
        CONCLUSIONS: { total: 1, resolved: 0 },
        RESULTS: { total: 0, resolved: 0 },
      },
    });
    expect(await app.get(FeedbackService).countUnresolved(thesisId)).toBe(2);
  });

  it('only readers of the thesis see feedback; only accepted jurors create it', async () => {
    const { thesisId, juror1, studentAgent } = await setup();
    const item = (await create(juror1, thesisId).expect(201)).body;

    // A juror with only a PENDING assignment, an outsider juror and another student: 404.
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const other = await createAssignableThesis(app);
    await assignJury(app, other.id as string, [
      j1.id as string,
      j2.id as string,
    ]);
    const pendingJuror = await loginAgent(app, j1.email);
    await pendingJuror
      .get(`/api/theses/${other.id as string}/feedback`)
      .expect(404);
    await create(pendingJuror, other.id as string).expect(404);
    await pendingJuror.get(`/api/theses/${thesisId}/feedback`).expect(404);
    await pendingJuror
      .post(`/api/feedback/${item.id}/comment`)
      .send({ content: 'x' })
      .expect(404);
    const otherStudent = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.STUDENT] })).email,
    );
    await otherStudent
      .get(`/api/theses/${thesisId}/feedback/summary`)
      .expect(404);
    const notMine = await otherStudent
      .post(`/api/feedback/${item.id}/address`)
      .send({ content: 'x' })
      .expect(404);
    expect(notMine.body.code).toBe('FEEDBACK_NOT_FOUND');

    // Wrong roles for creation.
    await create(coordinator, thesisId).expect(403);
    await create(studentAgent, thesisId).expect(403);
    await coordinator
      .post(`/api/feedback/${'0'.repeat(24)}/comment`)
      .send({ content: 'x' })
      .expect(404);
    await create(juror1, thesisId)
      .send({ chapter: 'APPENDIX', content: 'x' })
      .expect(400);
  });

  it('items can only be created while evaluating or revising (FEEDBACK_THESIS_STATUS)', async () => {
    const { thesisId, juror1 } = await setup();
    await theses.updateOne(
      { _id: thesisId },
      { $set: { status: ThesisStatus.READY_FOR_DEFENSE } },
    );
    const res = await create(juror1, thesisId).expect(409);
    expect(res.body.code).toBe('FEEDBACK_THESIS_STATUS');
  });

  it('closes address/resolve/reopen/comment on terminal theses and DEFENSE_SCHEDULED', async () => {
    const { thesisId, juror1, studentAgent } = await setup();
    const item = (await create(juror1, thesisId).expect(201)).body;
    await studentAgent
      .post(`/api/feedback/${item.id}/address`)
      .send({ content: 'Corregido' })
      .expect(200);
    for (const closed of [
      ThesisStatus.DEFENSE_SCHEDULED,
      ThesisStatus.NOT_APPROVED,
      ThesisStatus.COMPLETED_APPROVED,
      ThesisStatus.COMPLETED_FAILED,
    ]) {
      await theses.updateOne({ _id: thesisId }, { $set: { status: closed } });
      const calls = [
        studentAgent
          .post(`/api/feedback/${item.id}/address`)
          .send({ content: 'x' }),
        juror1.post(`/api/feedback/${item.id}/resolve`).send({}),
        juror1.post(`/api/feedback/${item.id}/reopen`).send({ content: 'x' }),
        studentAgent
          .post(`/api/feedback/${item.id}/comment`)
          .send({ content: 'x' }),
      ];
      for (const call of calls) {
        const res = await call.expect(409);
        expect(res.body.code).toBe('FEEDBACK_THESIS_STATUS');
      }
    }
  });

  it('REVISIONS_IN_PROGRESS moves to READY_FOR_DEFENSE when the last item is resolved', async () => {
    const { thesisId, juror1, juror2, studentAgent, assignmentIds, jurors } =
      await setup();
    const f1 = (await create(juror1, thesisId).expect(201)).body;
    const f2 = (
      await create(juror2, thesisId, FeedbackChapter.RESULTS).expect(201)
    ).body;
    await submitEvaluation(
      app,
      assignmentIds[0],
      jurors[0],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    await submitEvaluation(
      app,
      assignmentIds[1],
      jurors[1],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    const status = async () => (await theses.findById(thesisId))?.status;
    expect(await status()).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);

    // Feedback can still be added while revising.
    const f3 = (
      await create(juror1, thesisId, FeedbackChapter.OTHER).expect(201)
    ).body;
    for (const [item, author] of [
      [f1, juror1],
      [f2, juror2],
    ] as const) {
      await studentAgent
        .post(`/api/feedback/${item.id}/address`)
        .send({ content: 'Corregido' })
        .expect(200);
      await author
        .post(`/api/feedback/${item.id}/resolve`)
        .send({})
        .expect(200);
      expect(await status()).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);
    }
    await studentAgent
      .post(`/api/feedback/${f3.id}/address`)
      .send({ content: 'Corregido' })
      .expect(200);
    await juror1
      .post(`/api/feedback/${f3.id}/resolve`)
      .send({ content: 'Gracias' })
      .expect(200);
    const t = await theses.findById(thesisId);
    expect(t?.status).toBe(ThesisStatus.READY_FOR_DEFENSE);
    expect(t?.history.at(-1)).toMatchObject({
      from: ThesisStatus.REVISIONS_IN_PROGRESS,
      to: ThesisStatus.READY_FOR_DEFENSE,
      actorRole: Role.INTERNAL_JUROR,
    });
  });
});
