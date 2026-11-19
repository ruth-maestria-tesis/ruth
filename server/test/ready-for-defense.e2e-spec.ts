import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  ErrorCode,
  EvaluationVerdict,
  FeedbackChapter,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model } from 'mongoose';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  closeTestApp,
  createTestApp,
  createThesisUnderEvaluation,
  createUser,
  loginAgent,
  submitEvaluation,
  TestAgent,
} from './utils/test-app';

describe('POST /theses/:id/ready-for-defense (e2e)', () => {
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

  const status = async (id: string) => (await theses.findById(id))?.status;

  it('moves a REVISIONS_IN_PROGRESS thesis without feedback to READY_FOR_DEFENSE', async () => {
    const fx = await createThesisUnderEvaluation(app);
    const id = fx.thesis.id as string;
    const early = await coordinator
      .post(`/api/theses/${id}/ready-for-defense`)
      .expect(409);
    expect(early.body.code).toBe(ErrorCode.WORKFLOW_INVALID_TRANSITION);

    for (const i of [0, 1] as const)
      await submitEvaluation(
        app,
        fx.assignmentIds[i],
        fx.jurors[i],
        EvaluationVerdict.APPROVED_WITH_CHANGES,
      );
    expect(await status(id)).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);

    const juror = await loginAgent(app, fx.jurors[0].email);
    await juror.post(`/api/theses/${id}/ready-for-defense`).expect(403);

    const res = await coordinator
      .post(`/api/theses/${id}/ready-for-defense`)
      .expect(200);
    expect(res.body.status).toBe(ThesisStatus.READY_FOR_DEFENSE);
    expect(await status(id)).toBe(ThesisStatus.READY_FOR_DEFENSE);
    const again = await coordinator
      .post(`/api/theses/${id}/ready-for-defense`)
      .expect(409);
    expect(again.body.code).toBe(ErrorCode.WORKFLOW_INVALID_TRANSITION);
  });

  it('refuses while feedback items are unresolved', async () => {
    const fx = await createThesisUnderEvaluation(app);
    const id = fx.thesis.id as string;
    const juror = await loginAgent(app, fx.jurors[0].email);
    await juror
      .post(`/api/theses/${id}/feedback`)
      .send({ chapter: FeedbackChapter.METHODOLOGY, content: 'Ajustar n.' })
      .expect(201);
    for (const i of [0, 1] as const)
      await submitEvaluation(
        app,
        fx.assignmentIds[i],
        fx.jurors[i],
        EvaluationVerdict.APPROVED_FOR_DEFENSE,
      );
    expect(await status(id)).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);
    const res = await coordinator
      .post(`/api/theses/${id}/ready-for-defense`)
      .expect(409);
    expect(res.body).toMatchObject({
      code: ErrorCode.FEEDBACK_INVALID_TRANSITION,
      details: { unresolved: 1 },
    });
    expect(await status(id)).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);
  });
});
