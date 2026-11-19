import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  DefenseModality,
  DefenseStatus,
  ErrorCode,
  EvaluationVerdict,
  MinutesVerdict,
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

/** The tiebreaker is an active juror (defense confirmation, minutes signer) only once it evaluated. */
describe('Active jurors — tiebreaker only if it submitted (e2e)', () => {
  let app: INestApplication;
  let theses: Model<Thesis>;
  let coordinator: TestAgent;
  let coordinatorId: string;

  beforeAll(async () => {
    app = await createTestApp();
    theses = app.get(getModelToken(Thesis.name));
    const coord = await createUser(app, { roles: [Role.COORDINATOR] });
    coordinatorId = coord.id as string;
    coordinator = await loginAgent(app, coord.email);
  });
  afterAll(() => closeTestApp(app));

  async function disputeWithAcceptedTiebreaker() {
    const fx = await createThesisUnderEvaluation(app);
    await submitEvaluation(
      app,
      fx.assignmentIds[0],
      fx.jurors[0],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    await submitEvaluation(
      app,
      fx.assignmentIds[1],
      fx.jurors[1],
      EvaluationVerdict.REJECTED,
    );
    const thesisId = fx.thesis.id as string;
    const tb = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const res = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: tb.id })
      .expect(201);
    const tbAgent = await loginAgent(app, tb.email);
    await tbAgent
      .post(`/api/assignments/${res.body.assignment.id}/accept`)
      .expect(200);
    return {
      ...fx,
      thesisId,
      tb,
      tbAgent,
      tbAssignmentId: res.body.assignment.id as string,
    };
  }

  const propose = (thesisId: string) =>
    coordinator
      .post(`/api/theses/${thesisId}/defense`)
      .send({
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        modality: DefenseModality.VIRTUAL,
        meetingUrl: 'https://meet.example.org/x',
      })
      .expect(201);

  const createMinutes = (thesisId: string) =>
    coordinator
      .post(`/api/theses/${thesisId}/minutes`)
      .send({ finalGrade: 4, verdict: MinutesVerdict.APPROVED, remarks: 'Ok' })
      .expect(201);

  const signerIds = (body: unknown) =>
    (body as { requiredSigners: { userId: string }[] }).requiredSigners.map(
      (s) => s.userId,
    );

  it('an accepted tiebreaker that never evaluated is neither a confirmer nor a signer', async () => {
    const fx = await disputeWithAcceptedTiebreaker();
    // Not reachable through the flow (only the tiebreaker resolves a dispute); forced here.
    await theses.updateOne(
      { _id: fx.thesisId },
      { $set: { status: ThesisStatus.READY_FOR_DEFENSE } },
    );
    const res = await propose(fx.thesisId);
    expect(res.body.jurors).toHaveLength(2);
    const denied = await fx.tbAgent
      .post(`/api/defenses/${res.body.id}/confirm`)
      .expect(403);
    expect(denied.body.code).toBe(ErrorCode.DEFENSE_NOT_JUROR);
    let last = res;
    for (const juror of fx.jurors) {
      const agent = await loginAgent(app, juror.email);
      last = await agent
        .post(`/api/defenses/${res.body.id}/confirm`)
        .expect(200);
    }
    expect(last.body.status).toBe(DefenseStatus.CONFIRMED);

    const ids = signerIds((await createMinutes(fx.thesisId)).body);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(fx.tb.id);
    expect(ids).toContain(coordinatorId);
  });

  it('a tiebreaker that submitted confirms the defense and signs the minutes', async () => {
    const fx = await disputeWithAcceptedTiebreaker();
    await fx.tbAgent
      .post(`/api/assignments/${fx.tbAssignmentId}/evaluation/submit`)
      .send({
        verdict: EvaluationVerdict.APPROVED,
        comments: 'Dirimo a favor tras revisar ambos conceptos.',
      })
      .expect(200);
    expect((await theses.findById(fx.thesisId))?.status).toBe(
      ThesisStatus.READY_FOR_DEFENSE,
    );
    const res = await propose(fx.thesisId);
    expect(res.body.jurors).toHaveLength(3);
    for (const juror of fx.jurors) {
      const agent = await loginAgent(app, juror.email);
      const r = await agent
        .post(`/api/defenses/${res.body.id}/confirm`)
        .expect(200);
      expect(r.body.status).toBe(DefenseStatus.PROPOSED);
    }
    const done = await fx.tbAgent
      .post(`/api/defenses/${res.body.id}/confirm`)
      .expect(200);
    expect(done.body.status).toBe(DefenseStatus.CONFIRMED);

    const ids = signerIds((await createMinutes(fx.thesisId)).body);
    expect(ids).toHaveLength(4);
    expect(ids).toContain(fx.tb.id);
  });
});
