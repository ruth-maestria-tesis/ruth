import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import {
  EvaluationStatus,
  EvaluationVerdict,
  FeedbackChapter,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { WorkflowService } from '../src/workflow/workflow.service';
import { Evaluation } from '../src/evaluations/schemas/evaluation.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  assignJury,
  binaryParser,
  closeTestApp,
  createAssignableThesis,
  createTestApp,
  createThesisUnderEvaluation,
  createUser,
  loginAgent,
  PDF_BYTES,
  submitEvaluation,
  TestAgent,
} from './utils/test-app';

const COMMENTS = 'El documento cumple con los criterios de la rúbrica.';
const FULL = {
  rubric: { methodology: 4, relevance: 5, writingQuality: 3 },
  comments: COMMENTS,
};

describe('Evaluations — CU-02 / RN-08 (e2e)', () => {
  let app: INestApplication;
  let theses: Model<Thesis>;
  let evaluations: Model<Evaluation>;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    theses = app.get(getModelToken(Thesis.name));
    evaluations = app.get(getModelToken(Evaluation.name));
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
      a1: fx.assignmentIds[0],
      a2: fx.assignmentIds[1],
      juror1: await loginAgent(app, fx.jurors[0].email),
      juror2: await loginAgent(app, fx.jurors[1].email),
      studentAgent: await loginAgent(app, fx.student.email),
    };
  }
  const status = async (id: string) => (await theses.findById(id))?.status;

  it('drafts, submits and resolves RN-08 to READY_FOR_DEFENSE when both approve for defense', async () => {
    const { thesisId, a1, a2, juror1, juror2, jurors } = await setup();
    const emitted = jest.spyOn(app.get(EventEmitter2), 'emit');

    const none = await juror1
      .get(`/api/assignments/${a1}/evaluation`)
      .expect(200);
    expect(none.body).toBeNull();

    const draft = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({ rubric: { methodology: 4 } })
      .expect(200);
    expect(draft.body).toMatchObject({
      assignmentId: a1,
      thesisId,
      assignmentType: 'PRIMARY',
      status: EvaluationStatus.DRAFT,
      score: null,
      verdict: null,
      juror: { id: jurors[0].id, isUnicordoba: true },
    });
    const full = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({
        rubric: { relevance: 5, writingQuality: 3 },
        verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE,
        comments: COMMENTS,
      })
      .expect(200);
    expect(full.body).toMatchObject({
      rubric: { methodology: 4, relevance: 5, writingQuality: 3 },
      score: 4,
      comments: COMMENTS,
    });
    expect(full.body.id).toBe(draft.body.id);

    const sub = await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .expect(200);
    expect(sub.body).toMatchObject({ status: EvaluationStatus.SUBMITTED });
    expect(sub.body.submittedAt).toEqual(expect.any(String));
    expect(await status(thesisId)).toBe(ThesisStatus.UNDER_EVALUATION);
    expect(emitted).toHaveBeenCalledWith('evaluation.submitted', {
      thesisId,
      evaluationId: sub.body.id,
      jurorId: jurors[0].id,
      verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE,
      resultingStatus: ThesisStatus.UNDER_EVALUATION,
      actor: { id: jurors[0].id, role: Role.INTERNAL_JUROR },
    });

    // The submit body may carry the last changes.
    await juror2
      .post(`/api/assignments/${a2}/evaluation/submit`)
      .send({ ...FULL, verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE })
      .expect(200);
    const t = await theses.findById(thesisId);
    expect(t?.status).toBe(ThesisStatus.READY_FOR_DEFENSE);
    expect(t?.history.at(-1)).toMatchObject({
      from: ThesisStatus.UNDER_EVALUATION,
      to: ThesisStatus.READY_FOR_DEFENSE,
      actorRole: Role.INTERNAL_JUROR,
    });
    emitted.mockRestore();
  });

  it('RN-08: an APPROVED_WITH_CHANGES verdict leads to REVISIONS_IN_PROGRESS', async () => {
    const { thesisId, a1, a2, jurors } = await setup();
    await submitEvaluation(
      app,
      a1,
      jurors[0],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    await submitEvaluation(
      app,
      a2,
      jurors[1],
      EvaluationVerdict.APPROVED_WITH_CHANGES,
    );
    expect(await status(thesisId)).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);
  });

  it('RN-08: unresolved feedback leads to REVISIONS_IN_PROGRESS even if both approve for defense', async () => {
    const { thesisId, a1, a2, jurors, juror1 } = await setup();
    await juror1
      .post(`/api/theses/${thesisId}/feedback`)
      .send({ chapter: FeedbackChapter.RESULTS, content: 'Falta la tabla 3' })
      .expect(201);
    await submitEvaluation(
      app,
      a1,
      jurors[0],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    await submitEvaluation(
      app,
      a2,
      jurors[1],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    expect(await status(thesisId)).toBe(ThesisStatus.REVISIONS_IN_PROGRESS);
  });

  it('RN-08: both REJECTED leads to NOT_APPROVED; a split leads to IN_DISPUTE', async () => {
    const r = await setup();
    await submitEvaluation(app, r.a1, r.jurors[0], EvaluationVerdict.REJECTED);
    await submitEvaluation(app, r.a2, r.jurors[1], EvaluationVerdict.REJECTED);
    expect(await status(r.thesisId)).toBe(ThesisStatus.NOT_APPROVED);

    const s = await setup();
    await submitEvaluation(
      app,
      s.a1,
      s.jurors[0],
      EvaluationVerdict.APPROVED_WITH_CHANGES,
    );
    await submitEvaluation(app, s.a2, s.jurors[1], EvaluationVerdict.REJECTED);
    expect(await status(s.thesisId)).toBe(ThesisStatus.IN_DISPUTE);
  });

  it('locks the evaluation after submit (EVALUATION_LOCKED)', async () => {
    const { a1, juror1 } = await setup();
    const sub = await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .send({ ...FULL, verdict: EvaluationVerdict.REJECTED })
      .expect(200);
    const put = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({ comments: 'Cambio de opinión tardío sobre el documento' })
      .expect(409);
    expect(put.body.code).toBe('EVALUATION_LOCKED');
    const again = await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .expect(409);
    expect(again.body.code).toBe('EVALUATION_LOCKED');
    const upload = await juror1
      .post(`/api/evaluations/${sub.body.id}/corrections`)
      .attach('file', PDF_BYTES, 'correcciones.pdf')
      .expect(409);
    expect(upload.body.code).toBe('EVALUATION_LOCKED');
  });

  it('rejects incomplete submits (EVALUATION_INCOMPLETE) and wrong verdicts', async () => {
    const { a1, juror1 } = await setup();
    const empty = await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .expect(400);
    expect(empty.body).toMatchObject({
      code: 'EVALUATION_INCOMPLETE',
      details: { missing: ['rubric', 'verdict', 'comments'] },
    });
    const short = await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .send({
        rubric: { methodology: 3, relevance: 3 },
        verdict: EvaluationVerdict.REJECTED,
        comments: 'muy corto',
      })
      .expect(400);
    expect(short.body.details.missing).toEqual(['rubric', 'comments']);
    const tbVerdict = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({ verdict: EvaluationVerdict.APPROVED })
      .expect(400);
    expect(tbVerdict.body.code).toBe('VALIDATION_FAILED');
    await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({ rubric: { methodology: 6 } })
      .expect(400);
    // Still a draft.
    expect(
      (await juror1.get(`/api/assignments/${a1}/evaluation`).expect(200)).body
        .status,
    ).toBe(EvaluationStatus.DRAFT);
  });

  it('only an ACCEPTED assignment can be evaluated (EVALUATION_NOT_ALLOWED)', async () => {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    const { assignments } = await assignJury(app, thesis.id as string, [
      j1.id as string,
      j2.id as string,
    ]);
    const juror = await loginAgent(app, j1.email);
    const res = await juror
      .put(`/api/assignments/${assignments[0].id}/evaluation`)
      .send({ comments: COMMENTS })
      .expect(409);
    expect(res.body.code).toBe('EVALUATION_NOT_ALLOWED');
  });

  it('only the assignment owner writes; other roles get 403', async () => {
    const { a1, juror2, studentAgent } = await setup();
    await juror2
      .put(`/api/assignments/${a1}/evaluation`)
      .send(FULL)
      .expect(404);
    await juror2.get(`/api/assignments/${a1}/evaluation`).expect(404);
    await juror2.post(`/api/assignments/${a1}/evaluation/submit`).expect(404);
    await coordinator
      .put(`/api/assignments/${a1}/evaluation`)
      .send(FULL)
      .expect(403);
    await studentAgent
      .put(`/api/assignments/${a1}/evaluation`)
      .send(FULL)
      .expect(403);
  });

  it('the student only sees SUBMITTED evaluations, and reading one logs VIEW', async () => {
    const { thesisId, a1, a2, juror1, juror2, studentAgent } = await setup();
    const d1 = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send(FULL)
      .expect(200);
    await juror2
      .put(`/api/assignments/${a2}/evaluation`)
      .send(FULL)
      .expect(200);

    const asStudent = await studentAgent
      .get(`/api/theses/${thesisId}/evaluations`)
      .expect(200);
    expect(asStudent.body).toEqual([]);
    await studentAgent.get(`/api/evaluations/${d1.body.id}`).expect(404);
    // Jurors see their own draft only; staff see everything.
    const asJuror2 = await juror2
      .get(`/api/theses/${thesisId}/evaluations`)
      .expect(200);
    expect(asJuror2.body.map((e: { jurorId: string }) => e.jurorId)).toEqual([
      asJuror2.body[0].jurorId,
    ]);
    expect(asJuror2.body[0].assignmentId).toBe(a2);
    await juror2.get(`/api/evaluations/${d1.body.id}`).expect(404);
    const asStaff = await coordinator
      .get(`/api/theses/${thesisId}/evaluations`)
      .expect(200);
    expect(asStaff.body).toHaveLength(2);

    await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .send({ verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE })
      .expect(200);
    const list = await studentAgent
      .get(`/api/theses/${thesisId}/evaluations`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: d1.body.id,
      status: EvaluationStatus.SUBMITTED,
    });
    expect(list.body[0].studentAccessLog).toBeUndefined();

    // Staff reads do not count as the student's.
    await coordinator.get(`/api/evaluations/${d1.body.id}`).expect(200);
    expect(
      (await evaluations.findById(d1.body.id))?.studentAccessLog,
    ).toHaveLength(0);

    const viewed = await studentAgent
      .get(`/api/evaluations/${d1.body.id}`)
      .expect(200);
    expect(viewed.body.studentFirstViewedAt).toEqual(expect.any(String));
    await studentAgent.get(`/api/evaluations/${d1.body.id}`).expect(200);
    const stored = await evaluations.findById(d1.body.id);
    expect(stored?.studentAccessLog.map((l) => l.type)).toEqual([
      'VIEW',
      'VIEW',
    ]);
    expect(stored?.studentFirstViewedAt?.toISOString()).toBe(
      viewed.body.studentFirstViewedAt,
    );

    // Another student cannot read them.
    const other = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.STUDENT] })).email,
    );
    await other.get(`/api/theses/${thesisId}/evaluations`).expect(404);
    await other.get(`/api/evaluations/${d1.body.id}`).expect(404);
  });

  it('uploads correction files while DRAFT; the student download logs DOWNLOAD', async () => {
    const { a1, juror1, juror2, studentAgent } = await setup();
    const draft = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send(FULL)
      .expect(200);
    const id = draft.body.id as string;
    const up = await juror1
      .post(`/api/evaluations/${id}/corrections`)
      .attach('file', PDF_BYTES, 'correcciones.pdf')
      .expect(201);
    expect(up.body.correctionFiles).toEqual([
      expect.objectContaining({ fileName: 'correcciones.pdf' }),
    ]);
    const fileId = up.body.correctionFiles[0].fileId as string;
    const bad = await juror1
      .post(`/api/evaluations/${id}/corrections`)
      .attach('file', Buffer.from('plain text'), 'notas.txt')
      .expect(415);
    expect(bad.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    await juror2
      .post(`/api/evaluations/${id}/corrections`)
      .attach('file', PDF_BYTES, 'x.pdf')
      .expect(404);

    await studentAgent
      .get(`/api/evaluations/${id}/files/${fileId}`)
      .expect(404);
    await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .send({ verdict: EvaluationVerdict.APPROVED_WITH_CHANGES })
      .expect(200);
    const dl = await studentAgent
      .get(`/api/evaluations/${id}/files/${fileId}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(Buffer.compare(dl.body as Buffer, PDF_BYTES)).toBe(0);
    expect(dl.headers['content-type']).toContain('application/pdf');
    const stored = await evaluations.findById(id);
    expect(stored?.studentAccessLog.map((l) => l.type)).toEqual(['DOWNLOAD']);
    expect(stored?.studentFirstDownloadedAt).toBeInstanceOf(Date);
    expect(stored?.studentFirstViewedAt).toBeUndefined();
  });

  it('stores null comments as an empty string and clears a null rubric and verdict', async () => {
    const { a1, juror1 } = await setup();
    await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({ ...FULL, verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE })
      .expect(200);
    const res = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({ comments: null, rubric: null, verdict: null })
      .expect(200);
    expect(res.body).toMatchObject({
      comments: '',
      rubric: null,
      score: null,
      verdict: null,
    });
    const again = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send({ comments: null })
      .expect(200);
    expect(again.body.comments).toBe('');
  });

  it('emits evaluation.submitted after RN-08 with the resulting status', async () => {
    const { thesisId, a1, a2, jurors } = await setup();
    const emitted = jest.spyOn(app.get(EventEmitter2), 'emit');
    await submitEvaluation(
      app,
      a1,
      jurors[0],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    await submitEvaluation(
      app,
      a2,
      jurors[1],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    const calls = emitted.mock.calls.filter(
      (c) => (c[1] as { thesisId?: string } | undefined)?.thesisId === thesisId,
    );
    const names = calls.map((c) => c[0]);
    const submitted = calls.filter((c) => c[0] === 'evaluation.submitted');
    expect(
      submitted.map(
        (c) => (c[1] as { resultingStatus: string }).resultingStatus,
      ),
    ).toEqual([ThesisStatus.UNDER_EVALUATION, ThesisStatus.READY_FOR_DEFENSE]);
    // The status change is emitted before the last evaluation.submitted.
    expect(names.indexOf('thesis.status.changed')).toBeLessThan(
      names.lastIndexOf('evaluation.submitted'),
    );
    emitted.mockRestore();
  });

  it('reconciles a failed RN-08 through the endpoint and the scheduler pass', async () => {
    const one = await setup();
    const two = await setup();
    const failing = jest
      .spyOn(app.get(WorkflowService), 'transition')
      .mockRejectedValue(new Error('db down'));
    for (const fx of [one, two]) {
      for (const i of [0, 1] as const)
        await submitEvaluation(
          app,
          fx.assignmentIds[i],
          fx.jurors[i],
          EvaluationVerdict.APPROVED_FOR_DEFENSE,
        );
    }
    failing.mockRestore();
    expect(await status(one.thesisId)).toBe(ThesisStatus.UNDER_EVALUATION);

    // Staff only; the juror gets 403.
    await one.juror1
      .post(`/api/theses/${one.thesisId}/evaluation-outcome/reconcile`)
      .expect(403);
    const res = await coordinator
      .post(`/api/theses/${one.thesisId}/evaluation-outcome/reconcile`)
      .expect(200);
    expect(res.body).toMatchObject({
      thesisId: one.thesisId,
      status: ThesisStatus.READY_FOR_DEFENSE,
      changed: true,
    });
    // Idempotent.
    const again = await coordinator
      .post(`/api/theses/${one.thesisId}/evaluation-outcome/reconcile`)
      .expect(200);
    expect(again.body).toMatchObject({
      status: ThesisStatus.READY_FOR_DEFENSE,
      changed: false,
    });

    expect(await status(two.thesisId)).toBe(ThesisStatus.UNDER_EVALUATION);
    expect(
      await app.get(SchedulerService).reconcileEvaluationOutcomes(),
    ).toBeGreaterThanOrEqual(1);
    expect(await status(two.thesisId)).toBe(ThesisStatus.READY_FOR_DEFENSE);
  });

  it('reconcile returns 409 EVALUATION_NOT_COMPLETE while an evaluation is missing', async () => {
    const { thesisId, a1, jurors } = await setup();
    await submitEvaluation(
      app,
      a1,
      jurors[0],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    const res = await coordinator
      .post(`/api/theses/${thesisId}/evaluation-outcome/reconcile`)
      .expect(409);
    expect(res.body.code).toBe('EVALUATION_NOT_COMPLETE');
    expect(await status(thesisId)).toBe(ThesisStatus.UNDER_EVALUATION);
  });

  it('a primary juror reads the other primary SUBMITTED evaluation', async () => {
    const { thesisId, a1, juror2, jurors } = await setup();
    const sub = await submitEvaluation(
      app,
      a1,
      jurors[0],
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
    );
    await juror2.get(`/api/evaluations/${sub.id}`).expect(200);
    const list = await juror2
      .get(`/api/theses/${thesisId}/evaluations`)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('a foreign fileId gets 404 on the evaluation file download', async () => {
    const { a1, juror1, studentAgent } = await setup();
    const draft = await juror1
      .put(`/api/assignments/${a1}/evaluation`)
      .send(FULL)
      .expect(200);
    await juror1
      .post(`/api/assignments/${a1}/evaluation/submit`)
      .send({ verdict: EvaluationVerdict.APPROVED_WITH_CHANGES })
      .expect(200);
    await studentAgent
      .get(
        `/api/evaluations/${draft.body.id}/files/${new Types.ObjectId().toHexString()}`,
      )
      .expect(404);
  });
});
