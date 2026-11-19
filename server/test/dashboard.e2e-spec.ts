import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role, ThesisStatus } from '@thesis/shared';
import { Model } from 'mongoose';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Dashboard (e2e)', () => {
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

  const setStatus = (id: unknown, status: ThesisStatus) =>
    theses.updateOne({ _id: id }, { $set: { status } });

  it('counts totals, byStatus and byCohort, honouring the filters', async () => {
    const a = await createCatalog(app);
    const b = await createCatalog(app);
    const t1 = await createThesis(app, a);
    const t2 = await createThesis(app, a);
    const t3 = await createThesis(app, a);
    await createThesis(app, b);
    await setStatus(t2._id, ThesisStatus.COMPLETED_APPROVED);
    await setStatus(t3._id, ThesisStatus.NOT_APPROVED);
    expect(t1.status).toBe(ThesisStatus.SUBMITTED);

    const res = await coordinator
      .get(`/api/dashboard/coordinator?cohortId=${a.cohortId}`)
      .expect(200);
    expect(res.body.totals).toEqual({
      theses: 3,
      active: 1,
      completed: 1,
      notApproved: 1,
    });
    expect(res.body.byStatus).toMatchObject({
      SUBMITTED: 1,
      COMPLETED_APPROVED: 1,
      NOT_APPROVED: 1,
      IN_DISPUTE: 0,
      COMPLETED_FAILED: 0,
    });
    expect(Object.keys(res.body.byStatus as object)).toHaveLength(
      Object.values(ThesisStatus).length,
    );
    expect(res.body.byCohort).toEqual([
      { cohortId: a.cohortId, name: 'Corte 1', count: 3 },
    ]);

    const byProgram = await coordinator
      .get(
        `/api/dashboard/coordinator?programId=${b.programId}&periodId=${b.periodId}`,
      )
      .expect(200);
    expect(byProgram.body.totals.theses).toBe(1);
  });

  it('alerts on theses in dispute (and only within the filter)', async () => {
    const a = await createCatalog(app);
    const other = await createCatalog(app);
    const disputed = await createThesis(app, a);
    const elsewhere = await createThesis(app, other);
    await setStatus(disputed._id, ThesisStatus.IN_DISPUTE);
    await setStatus(elsewhere._id, ThesisStatus.IN_DISPUTE);

    const res = await coordinator
      .get(`/api/dashboard/coordinator?cohortId=${a.cohortId}`)
      .expect(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0]).toMatchObject({
      kind: 'IN_DISPUTE',
      thesisId: disputed.id,
      code: disputed.code,
    });
    expect(res.body.alerts[0].message).toEqual(expect.any(String));
  });

  it('alerts on pending assignments whose response is due soon', async () => {
    const catalog = await createCatalog(app);
    const thesis = await createAssignableThesis(app, catalog);
    const jurors = [
      await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
      await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
    ];
    await assignJury(
      app,
      thesis.id as string,
      jurors.map((j) => j.id as string),
    );
    await assignments.updateMany(
      { thesisId: thesis._id, status: AssignmentStatus.PENDING },
      { $set: { responseDeadline: new Date(Date.now() + 3_600_000) } },
    );

    const res = await coordinator
      .get(`/api/dashboard/coordinator?cohortId=${catalog.cohortId}`)
      .expect(200);
    const alerts = res.body.alerts as { kind: string; thesisId: string }[];
    const due = alerts.filter((x) => x.kind === 'RESPONSE_DUE_SOON');
    expect(due).toHaveLength(2);
    expect(due[0].thesisId).toBe(thesis.id);
  });

  it('forbids students (403); admins are allowed', async () => {
    const student = await createUser(app, { roles: [Role.STUDENT] });
    const agent = await loginAgent(app, student.email);
    await agent.get('/api/dashboard/coordinator').expect(403);
    const admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    await admin.get('/api/dashboard/coordinator').expect(200);
  });
});
