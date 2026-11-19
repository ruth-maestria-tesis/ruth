import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role, ThesisStatus } from '@thesis/shared';
import { Model } from 'mongoose';
import { ASSIGNMENT_EVENTS } from '../src/assignments/assignment.events';
import { AssignmentResponsesService } from '../src/assignments/assignment-responses.service';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createTestApp,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Assignments — CU-08 (e2e)', () => {
  let app: INestApplication;
  let assignments: Model<Assignment>;
  let theses: Model<Thesis>;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    assignments = app.get(getModelToken(Assignment.name));
    theses = app.get(getModelToken(Thesis.name));
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
  });
  afterAll(() => closeTestApp(app));

  /** Fresh thesis with two internal jurors; returns their agents and assignment ids. */
  async function setup() {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const thesis = await createAssignableThesis(app);
    const { assignments: views } = await assignJury(app, thesis.id as string, [
      j1.id as string,
      j2.id as string,
    ]);
    return {
      thesis,
      a1: views[0].id,
      a2: views[1].id,
      juror1: await loginAgent(app, j1.email),
      juror2: await loginAgent(app, j2.email),
    };
  }
  const status = async (id: unknown) => (await theses.findById(id))?.status;

  it('both acceptances move the thesis to UNDER_EVALUATION (45%) and set evaluation deadlines', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    const r1 = await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
    expect(r1.body).toMatchObject({
      status: AssignmentStatus.ACCEPTED,
      responseDaysRemaining: null,
      evaluationDaysRemaining: 20,
    });
    expect(r1.body.evaluationDeadline).toEqual(expect.any(String));
    expect(await status(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
    await juror2.post(`/api/assignments/${a2}/accept`).expect(200);
    const t = await theses.findById(thesis._id);
    expect(t).toMatchObject({
      status: ThesisStatus.UNDER_EVALUATION,
      progress: 45,
    });
    expect(t?.history.at(-1)).toMatchObject({
      from: 'JURORS_ASSIGNED',
      to: 'UNDER_EVALUATION',
      actorRole: Role.INTERNAL_JUROR,
    });
  });

  it('concurrent acceptances advance the thesis exactly once', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await Promise.all([
      juror1.post(`/api/assignments/${a1}/accept`).expect(200),
      juror2.post(`/api/assignments/${a2}/accept`).expect(200),
    ]);
    const t = await theses.findById(thesis._id);
    expect(t?.status).toBe(ThesisStatus.UNDER_EVALUATION);
    expect(
      t?.history.filter((h) => h.to === ThesisStatus.UNDER_EVALUATION),
    ).toHaveLength(1);
  });

  it('only the assigned juror can respond; a second response is rejected', async () => {
    const { a1, juror1, juror2 } = await setup();
    await juror2.post(`/api/assignments/${a1}/accept`).expect(404);
    await coordinator.post(`/api/assignments/${a1}/accept`).expect(403);
    await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
    const again = await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x' })
      .expect(409);
    expect(again.body.code).toBe('ASSIGNMENT_NOT_PENDING');
  });

  it('declining requires a reason and sends the thesis to PENDING_JUROR_REPLACEMENT', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await juror1.post(`/api/assignments/${a1}/decline`).send({}).expect(400);
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x'.repeat(501) })
      .expect(400);
    const res = await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'Conflicto de agenda' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: AssignmentStatus.DECLINED,
      declineReason: 'Conflicto de agenda',
    });
    expect((await assignments.findById(a1))?.isActive).toBe(false);
    expect(await status(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
    // The second juror can still decline; the thesis stays in PENDING_JUROR_REPLACEMENT.
    await juror2
      .post(`/api/assignments/${a2}/decline`)
      .send({ reason: 'Viaje' })
      .expect(200);
    expect(await status(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
  });

  it('responses after the deadline are rejected', async () => {
    const { a1, juror1 } = await setup();
    await assignments.updateOne(
      { _id: a1 },
      { responseDeadline: new Date(Date.now() - 1000) },
    );
    const res = await juror1.post(`/api/assignments/${a1}/accept`).expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_DEADLINE_PASSED');
  });

  it('expirePending marks overdue assignments EXPIRED and records a SYSTEM transition', async () => {
    const { thesis, a1, a2 } = await setup();
    await assignments.updateOne(
      { _id: a1 },
      { responseDeadline: new Date(Date.now() - 1000) },
    );
    const count = await app
      .get(AssignmentResponsesService)
      .expirePending(new Date());
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await assignments.findById(a1)).toMatchObject({
      status: AssignmentStatus.EXPIRED,
      isActive: false,
    });
    expect((await assignments.findById(a2))?.status).toBe(
      AssignmentStatus.PENDING,
    );
    const t = await theses.findById(thesis._id);
    expect(t?.history.at(-1)).toMatchObject({
      to: ThesisStatus.PENDING_JUROR_REPLACEMENT,
      actorRole: 'SYSTEM',
    });
  });

  it('assignments of a thesis still SUBMITTED (orphans of a failed CU-01) cannot be answered or expired', async () => {
    const { thesis, a1, a2, juror1 } = await setup();
    await theses.updateOne(
      { _id: thesis._id },
      { status: ThesisStatus.SUBMITTED },
    );
    const res = await juror1.post(`/api/assignments/${a1}/accept`).expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_THESIS_STATUS');
    await assignments.updateOne(
      { _id: a2 },
      { responseDeadline: new Date(Date.now() - 1000) },
    );
    await app.get(AssignmentResponsesService).expirePending(new Date());
    expect(await assignments.findById(a2)).toMatchObject({
      status: AssignmentStatus.PENDING,
      isActive: true,
    });
  });

  it('GET /assignments/mine lists my assignments with countdown and thesis summary', async () => {
    const { thesis, a1, juror1 } = await setup();
    const res = await juror1.get('/api/assignments/mine').expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: a1,
        responseDaysRemaining: 8,
        thesis: expect.objectContaining({
          id: thesis.id,
          code: thesis.code,
          studentName: thesis.studentName,
          advisorName: expect.any(String),
        }),
      }),
    ]);
    const accepted = await juror1
      .get('/api/assignments/mine?status=ACCEPTED')
      .expect(200);
    expect(accepted.body).toEqual([]);
    await juror1.get('/api/assignments/mine?status=NOPE').expect(400);
    await coordinator.get('/api/assignments/mine').expect(403);
  });

  it('GET /assignments/:id: owner, coordinator and admin see it; other jurors get 404', async () => {
    const { a1, juror1, juror2 } = await setup();
    const own = await juror1.get(`/api/assignments/${a1}`).expect(200);
    expect(own.body).toMatchObject({
      id: a1,
      juror: expect.any(Object),
      thesis: expect.any(Object),
    });
    await coordinator.get(`/api/assignments/${a1}`).expect(200);
    const admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    await admin.get(`/api/assignments/${a1}`).expect(200);
    await juror2.get(`/api/assignments/${a1}`).expect(404);
    await coordinator.get('/api/assignments/nope').expect(400);
  });

  it('a whitespace-only decline reason is rejected', async () => {
    const { a1, juror1 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: '   ' })
      .expect(400);
    const res = await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: '  Viaje  ' })
      .expect(200);
    expect(res.body.declineReason).toBe('Viaje');
  });

  it('an accept that loses to the expiry gets ASSIGNMENT_DEADLINE_PASSED', async () => {
    const { a1, juror1 } = await setup();
    await assignments.updateOne(
      { _id: a1 },
      { responseDeadline: new Date(Date.now() - 1000) },
    );
    await app.get(AssignmentResponsesService).expirePending(new Date());
    const res = await juror1.post(`/api/assignments/${a1}/accept`).expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_DEADLINE_PASSED');
  });

  it('emits the accepted, declined and expired events', async () => {
    const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
    try {
      const { a1, a2, juror1, juror2 } = await setup();
      await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
      await juror2
        .post(`/api/assignments/${a2}/decline`)
        .send({ reason: 'Viaje' })
        .expect(200);
      const other = await setup();
      await assignments.updateOne(
        { _id: other.a1 },
        { responseDeadline: new Date(Date.now() - 1000) },
      );
      await app.get(AssignmentResponsesService).expirePending(new Date());
      expect(emit).toHaveBeenCalledWith(
        ASSIGNMENT_EVENTS.ACCEPTED,
        expect.objectContaining({
          assignmentId: a1,
          actorRole: Role.INTERNAL_JUROR,
        }),
      );
      expect(emit).toHaveBeenCalledWith(
        ASSIGNMENT_EVENTS.DECLINED,
        expect.objectContaining({ assignmentId: a2, reason: 'Viaje' }),
      );
      expect(emit).toHaveBeenCalledWith(
        ASSIGNMENT_EVENTS.EXPIRED,
        expect.objectContaining({
          assignmentId: other.a1,
          actorRole: 'SYSTEM',
        }),
      );
    } finally {
      emit.mockRestore();
    }
  });

  it('expirePending reconciles a jury whose advance to UNDER_EVALUATION was lost', async () => {
    const { thesis, a1, a2 } = await setup();
    await assignments.updateMany(
      { _id: { $in: [a1, a2] } },
      { status: AssignmentStatus.ACCEPTED },
    );
    await app.get(AssignmentResponsesService).expirePending(new Date());
    const t = await theses.findById(thesis._id);
    expect(t?.status).toBe(ThesisStatus.UNDER_EVALUATION);
    expect(t?.history.at(-1)).toMatchObject({ actorRole: 'SYSTEM' });
  });

  it('thesis metadata is only attached for PENDING/ACCEPTED assignments past SUBMITTED', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'Viaje' })
      .expect(200);
    const mine = await juror1.get('/api/assignments/mine').expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].thesis).toBeUndefined();
    const detail = await juror1.get(`/api/assignments/${a1}`).expect(200);
    expect(detail.body.thesis).toBeUndefined();
    // Staff still see the thesis of any assignment.
    const staff = await coordinator.get(`/api/assignments/${a1}`).expect(200);
    expect(staff.body.thesis).toMatchObject({ id: thesis.id });
    // Pending assignment on a thesis back in SUBMITTED (orphan): no metadata either.
    expect(
      (await juror2.get('/api/assignments/mine').expect(200)).body[0].thesis,
    ).toEqual(expect.objectContaining({ id: thesis.id }));
    await theses.updateOne(
      { _id: thesis._id },
      { status: ThesisStatus.SUBMITTED },
    );
    expect(
      (await juror2.get('/api/assignments/mine').expect(200)).body[0].thesis,
    ).toBeUndefined();
    expect(
      (await juror2.get(`/api/assignments/${a2}`).expect(200)).body.thesis,
    ).toBeUndefined();
  });
});
