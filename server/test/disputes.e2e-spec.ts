import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  AssignmentStatus,
  AssignmentType,
  EvaluationVerdict,
  FeedbackChapter,
  JuryViolation,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model } from 'mongoose';
import { AssignmentResponsesService } from '../src/assignments/assignment-responses.service';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
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

const COMMENTS = 'Dirimo a favor tras revisar ambos conceptos.';

describe('Disputes — CU-05 / RN-08 tiebreaker (e2e)', () => {
  let app: INestApplication;
  let theses: Model<Thesis>;
  let assignments: Model<Assignment>;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    theses = app.get(getModelToken(Thesis.name));
    assignments = app.get(getModelToken(Assignment.name));
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
  });
  afterAll(() => closeTestApp(app));

  /** A split jury: slot 1 approves (`approving`), slot 2 rejects → IN_DISPUTE. */
  async function inDispute(approving = EvaluationVerdict.APPROVED_FOR_DEFENSE) {
    const fx = await createThesisUnderEvaluation(app);
    await submitEvaluation(app, fx.assignmentIds[0], fx.jurors[0], approving);
    await submitEvaluation(
      app,
      fx.assignmentIds[1],
      fx.jurors[1],
      EvaluationVerdict.REJECTED,
    );
    const thesisId = fx.thesis.id as string;
    expect((await theses.findById(thesisId))?.status).toBe(
      ThesisStatus.IN_DISPUTE,
    );
    return { ...fx, thesisId };
  }

  /** Designates and accepts a fresh internal tiebreaker. */
  async function acceptedTiebreaker(thesisId: string) {
    const user = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const res = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: user.id })
      .expect(201);
    const agent = await loginAgent(app, user.email);
    await agent
      .post(`/api/assignments/${res.body.assignment.id}/accept`)
      .expect(200);
    return { user, agent, assignmentId: res.body.assignment.id as string };
  }
  const status = async (id: string) => (await theses.findById(id))?.status;

  it('shows the dispute to staff only', async () => {
    const { thesisId, jurors, student } = await inDispute();
    const res = await coordinator
      .get(`/api/theses/${thesisId}/dispute`)
      .expect(200);
    expect(res.body).toMatchObject({
      thesisId,
      status: ThesisStatus.IN_DISPUTE,
      tiebreaker: null,
    });
    expect(
      res.body.primary.map((e: { verdict: string }) => e.verdict).sort(),
    ).toEqual([
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      EvaluationVerdict.REJECTED,
    ]);
    const juror = await loginAgent(app, jurors[0].email);
    await juror.get(`/api/theses/${thesisId}/dispute`).expect(403);
    const studentAgent = await loginAgent(app, student.email);
    await studentAgent.get(`/api/theses/${thesisId}/dispute`).expect(403);
  });

  it('validates the tiebreaker designation', async () => {
    const fx = await createThesisUnderEvaluation(app);
    const candidate = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const early = await coordinator
      .post(`/api/theses/${fx.thesis.id as string}/assignments/tiebreaker`)
      .send({ jurorId: candidate.id })
      .expect(409);
    expect(early.body.code).toBe('ASSIGNMENT_THESIS_STATUS');

    const { thesisId, jurors, thesis } = await inDispute();
    const primary = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: jurors[0].id })
      .expect(400);
    expect(primary.body).toMatchObject({
      code: 'ASSIGNMENT_INVALID_COMPOSITION',
      details: {
        violations: [
          { code: JuryViolation.JUROR_PREVIOUSLY_ASSIGNED, slot: 3 },
        ],
      },
    });
    const advisor = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: thesis.advisorId.toHexString() })
      .expect(400);
    expect(advisor.body.details.violations).toEqual([
      { code: JuryViolation.JUROR_CONFLICT_OF_INTEREST, slot: 3 },
    ]);
    await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({})
      .expect(400);
    const juror = await loginAgent(app, jurors[0].email);
    await juror
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: candidate.id })
      .expect(403);

    const ok = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: candidate.id, responseBusinessDays: 3 })
      .expect(201);
    expect(ok.body.assignment).toMatchObject({
      type: AssignmentType.TIEBREAKER,
      slot: 3,
      status: AssignmentStatus.PENDING,
      jurorId: candidate.id,
      responseDaysRemaining: 3,
    });
    expect(ok.body.externalLink).toBeUndefined();
    const another = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const twice = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: another.id })
      .expect(409);
    expect(twice.body.code).toBe('ASSIGNMENT_CONFLICT');
  });

  it('tiebreaker APPROVED → READY_FOR_DEFENSE; the primaries stay locked', async () => {
    const { thesisId, assignmentIds, jurors } = await inDispute();
    const tb = await acceptedTiebreaker(thesisId);
    // Accepting changes nothing on the thesis.
    expect(await status(thesisId)).toBe(ThesisStatus.IN_DISPUTE);

    const wrong = await tb.agent
      .put(`/api/assignments/${tb.assignmentId}/evaluation`)
      .send({ verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE })
      .expect(400);
    expect(wrong.body.code).toBe('VALIDATION_FAILED');
    const primary = await loginAgent(app, jurors[1].email);
    await primary
      .put(`/api/assignments/${assignmentIds[1]}/evaluation`)
      .send({ verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE })
      .expect(409);

    // The rubric is optional for the tiebreaker.
    const sub = await tb.agent
      .post(`/api/assignments/${tb.assignmentId}/evaluation/submit`)
      .send({ verdict: EvaluationVerdict.APPROVED, comments: COMMENTS })
      .expect(200);
    expect(sub.body).toMatchObject({
      assignmentType: AssignmentType.TIEBREAKER,
      rubric: null,
      score: null,
      verdict: EvaluationVerdict.APPROVED,
    });
    expect(await status(thesisId)).toBe(ThesisStatus.READY_FOR_DEFENSE);

    const dispute = await coordinator
      .get(`/api/theses/${thesisId}/dispute`)
      .expect(200);
    expect(dispute.body.tiebreaker).toMatchObject({
      assignment: {
        id: tb.assignmentId,
        type: AssignmentType.TIEBREAKER,
        status: AssignmentStatus.ACCEPTED,
      },
      evaluation: { id: sub.body.id, verdict: EvaluationVerdict.APPROVED },
    });
    // The tiebreaker can read the others' submitted evaluations.
    const list = await tb.agent
      .get(`/api/theses/${thesisId}/evaluations`)
      .expect(200);
    expect(list.body).toHaveLength(3);
  });

  it('tiebreaker APPROVED with changes pending or unresolved feedback → REVISIONS_IN_PROGRESS', async () => {
    const a = await inDispute(EvaluationVerdict.APPROVED_WITH_CHANGES);
    const tbA = await acceptedTiebreaker(a.thesisId);
    await tbA.agent
      .post(`/api/assignments/${tbA.assignmentId}/evaluation/submit`)
      .send({ verdict: EvaluationVerdict.APPROVED, comments: COMMENTS })
      .expect(200);
    expect(await status(a.thesisId)).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);

    const b = await inDispute();
    const tbB = await acceptedTiebreaker(b.thesisId);
    await tbB.agent
      .post(`/api/theses/${b.thesisId}/feedback`)
      .send({ chapter: FeedbackChapter.RESULTS, content: 'Revisar la tabla 2' })
      .expect(201);
    await tbB.agent
      .post(`/api/assignments/${tbB.assignmentId}/evaluation/submit`)
      .send({ verdict: EvaluationVerdict.APPROVED, comments: COMMENTS })
      .expect(200);
    expect(await status(b.thesisId)).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);
  });

  it('tiebreaker REJECTED → NOT_APPROVED', async () => {
    const { thesisId } = await inDispute();
    const tb = await acceptedTiebreaker(thesisId);
    await tb.agent
      .post(`/api/assignments/${tb.assignmentId}/evaluation/submit`)
      .send({ verdict: EvaluationVerdict.REJECTED, comments: COMMENTS })
      .expect(200);
    expect(await status(thesisId)).toBe(ThesisStatus.NOT_APPROVED);
  });

  it('a declined or expired tiebreaker leaves the thesis IN_DISPUTE for another designation', async () => {
    const { thesisId } = await inDispute();
    const u1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const first = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: u1.id })
      .expect(201);
    const agent = await loginAgent(app, u1.email);
    await agent
      .post(`/api/assignments/${first.body.assignment.id}/decline`)
      .send({ reason: 'Sin disponibilidad' })
      .expect(200);
    expect(await status(thesisId)).toBe(ThesisStatus.IN_DISPUTE);

    // An external tiebreaker created inline gets an access link.
    const second = await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({
        newExternal: {
          email: `tb.${Date.now()}@uni.example.org`,
          firstName: 'Tomás',
          lastName: 'Dirimente',
          institution: 'Universidad de Chile',
          highestDegree: 'Doctorado',
          country: 'Chile',
        },
      })
      .expect(201);
    expect(second.body.externalLink).toMatchObject({
      assignmentId: second.body.assignment.id,
      url: expect.any(String),
    });
    await assignments.updateOne(
      { _id: second.body.assignment.id },
      { $set: { responseDeadline: new Date(Date.now() - 60_000) } },
    );
    await app.get(AssignmentResponsesService).expirePending();
    expect(
      (await assignments.findById(second.body.assignment.id))?.status,
    ).toBe(AssignmentStatus.EXPIRED);
    expect(await status(thesisId)).toBe(ThesisStatus.IN_DISPUTE);

    const third = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    await coordinator
      .post(`/api/theses/${thesisId}/assignments/tiebreaker`)
      .send({ jurorId: third.id })
      .expect(201);
    const dispute = await coordinator
      .get(`/api/theses/${thesisId}/dispute`)
      .expect(200);
    expect(dispute.body.tiebreaker).toMatchObject({
      assignment: { jurorId: third.id, status: AssignmentStatus.PENDING },
      evaluation: null,
    });
  });
});
