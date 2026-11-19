import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, EvaluationVerdict, Role } from '@thesis/shared';
import { Model } from 'mongoose';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { endOfLocalDay } from '../src/common/time/business-days';
import { Evaluation } from '../src/evaluations/schemas/evaluation.schema';
import { Notification } from '../src/notifications/schemas/notification.schema';
import {
  ALERT_NOTIFICATION_TYPES as TYPES,
  AlertJobsService,
} from '../src/scheduler/alert-jobs.service';
import { SettingsService } from '../src/settings/settings.service';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import { UserDocument } from '../src/users/schemas/user.schema';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createTestApp,
  createThesisUnderEvaluation,
  createUser,
  loginAgent,
  submitEvaluation,
} from './utils/test-app';

/** Bogotá wall-clock time (UTC-5) as a Date. */
const bogota = (key: string, hour = 10) =>
  new Date(Date.parse(`${key}T00:00:00.000Z`) + (hour + 5) * 3_600_000);

describe('Alert jobs (e2e)', () => {
  let app: INestApplication;
  let jobs: AlertJobsService;
  let settings: SettingsService;
  let assignments: Model<Assignment>;
  let evaluations: Model<Evaluation>;
  let notifications: Model<Notification>;
  let theses: Model<Thesis>;
  let coordA: UserDocument;
  let coordB: UserDocument;
  let admin: Awaited<ReturnType<typeof loginAgent>>;
  let coordinatorAgent: Awaited<ReturnType<typeof loginAgent>>;

  beforeAll(async () => {
    app = await createTestApp();
    jobs = app.get(AlertJobsService);
    settings = app.get(SettingsService);
    assignments = app.get(getModelToken(Assignment.name));
    evaluations = app.get(getModelToken(Evaluation.name));
    notifications = app.get(getModelToken(Notification.name));
    theses = app.get(getModelToken(Thesis.name));
    coordA = await createUser(app, { roles: [Role.COORDINATOR] });
    coordB = await createUser(app, { roles: [Role.COORDINATOR] });
    admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    coordinatorAgent = await loginAgent(app, coordA.email);
  });
  afterAll(() => closeTestApp(app));

  afterEach(async () => {
    await assignments.deleteMany({});
    await evaluations.deleteMany({});
    await notifications.deleteMany({});
    await theses.deleteMany({});
    await settings.update({
      holidays: [],
      reminderBusinessDaysBefore: 2,
      overdueRenotifyBusinessDays: 5,
      unseenConceptAlertDays: 3,
    });
  });

  const sent = (userId: unknown, type: string, entityId?: string) =>
    notifications
      .countDocuments({
        userId,
        type,
        ...(entityId ? { 'entityRef.id': entityId } : {}),
      })
      .exec();

  const setEvaluationDeadline = (id: string, key: string) =>
    assignments.updateOne(
      { _id: id },
      { evaluationDeadline: endOfLocalDay(key) },
    );

  // ---------------------------------------------------------------- overdueEvaluations
  describe('overdueEvaluations', () => {
    it('notifies the juror and every coordinator once, and never twice', async () => {
      const fx = await createThesisUnderEvaluation(app);
      const [a1, a2] = fx.assignmentIds;
      await setEvaluationDeadline(a1, '2026-12-04');
      await setEvaluationDeadline(a2, '2026-12-04');
      // Juror 1 already submitted: only juror 2 is overdue.
      await submitEvaluation(
        app,
        a1,
        fx.jurors[0],
        EvaluationVerdict.APPROVED_FOR_DEFENSE,
      );

      const now = bogota('2026-12-05', 12);
      expect(await jobs.overdueEvaluations(now)).toBe(1);
      expect(await jobs.overdueEvaluations(now)).toBe(0);
      expect(await jobs.overdueEvaluations(bogota('2026-12-05', 18))).toBe(0);

      expect(await sent(fx.jurors[1]._id, TYPES.EVALUATION_OVERDUE, a2)).toBe(
        1,
      );
      expect(await sent(fx.jurors[0]._id, TYPES.EVALUATION_OVERDUE)).toBe(0);
      expect(await sent(coordA._id, TYPES.EVALUATION_OVERDUE, a2)).toBe(1);
      expect(await sent(coordB._id, TYPES.EVALUATION_OVERDUE, a2)).toBe(1);
      expect(await sent(fx.student._id, TYPES.EVALUATION_OVERDUE)).toBe(0);
      const mine = await notifications
        .findOne({ userId: fx.jurors[1]._id, type: TYPES.EVALUATION_OVERDUE })
        .lean();
      expect(mine?.link).toBe(`/juror/evaluation/${a2}`);
      expect((await assignments.findById(a2))?.overdueNotifiedAt).toEqual(now);
    });

    it('does not fire before the deadline (the deadline day counts as on time)', async () => {
      const fx = await createThesisUnderEvaluation(app);
      await setEvaluationDeadline(fx.assignmentIds[0], '2026-12-04');
      expect(await jobs.overdueEvaluations(bogota('2026-12-04', 23))).toBe(0);
      expect(await jobs.overdueEvaluations(bogota('2026-12-05', 0))).toBe(1);
    });

    it('ignores declined or replaced assignments and theses that are not under evaluation', async () => {
      const fx = await createThesisUnderEvaluation(app);
      const [a1, a2] = fx.assignmentIds;
      await setEvaluationDeadline(a1, '2026-12-04');
      await setEvaluationDeadline(a2, '2026-12-04');
      await assignments.updateOne(
        { _id: a1 },
        { status: AssignmentStatus.REPLACED, isActive: false },
      );
      await theses.updateOne(
        { _id: fx.thesis._id },
        { status: 'REVISIONS_IN_PROGRESS' },
      );
      expect(await jobs.overdueEvaluations(bogota('2026-12-05'))).toBe(0);
      await theses.updateOne({ _id: fx.thesis._id }, { status: 'IN_DISPUTE' });
      expect(await jobs.overdueEvaluations(bogota('2026-12-05'))).toBe(1);
    });

    it('re-notifies every N business days, skipping weekends and holidays', async () => {
      await settings.update({
        overdueRenotifyBusinessDays: 2,
        holidays: ['2026-12-08'],
      });
      const fx = await createThesisUnderEvaluation(app);
      const a = fx.assignmentIds[0];
      await setEvaluationDeadline(a, '2026-12-04');

      expect(await jobs.overdueEvaluations(bogota('2026-12-05'))).toBe(1); // Sat
      expect(await jobs.overdueEvaluations(bogota('2026-12-07'))).toBe(0); // Mon: 1 business day
      expect(await jobs.overdueEvaluations(bogota('2026-12-08'))).toBe(0); // Tue: holiday
      expect(await jobs.overdueEvaluations(bogota('2026-12-09'))).toBe(1); // Wed: 2 business days
      expect(await jobs.overdueEvaluations(bogota('2026-12-09', 20))).toBe(0);
      expect(await sent(fx.jurors[0]._id, TYPES.EVALUATION_OVERDUE, a)).toBe(2);
    });

    it('never re-notifies when overdueRenotifyBusinessDays is 0', async () => {
      await settings.update({ overdueRenotifyBusinessDays: 0 });
      const fx = await createThesisUnderEvaluation(app);
      await setEvaluationDeadline(fx.assignmentIds[0], '2026-12-04');
      expect(await jobs.overdueEvaluations(bogota('2026-12-05'))).toBe(1);
      // The other juror's real deadline is still ahead of 2026-12-05 but behind 2027-03-01.
      await setEvaluationDeadline(fx.assignmentIds[1], '2026-12-30');
      expect(await jobs.overdueEvaluations(bogota('2026-12-31'))).toBe(1);
      expect(await jobs.overdueEvaluations(bogota('2027-03-01'))).toBe(0);
    });
  });

  // ---------------------------------------------------------------- deadlineReminders
  describe('deadlineReminders', () => {
    const pendingFixture = async () => {
      const jurors = [
        await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
        await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
      ];
      const thesis = await createAssignableThesis(app);
      const { assignments: created } = await assignJury(
        app,
        thesis.id as string,
        jurors.map((j) => j.id as string),
      );
      await assignments.updateMany(
        { thesisId: thesis._id },
        { responseDeadline: endOfLocalDay('2026-12-04') }, // Friday
      );
      return { jurors, ids: created.map((a) => a.id) };
    };

    it('reminds PENDING jurors 2 business days before responseDeadline, once', async () => {
      const fx = await pendingFixture();
      expect(await jobs.deadlineReminders(bogota('2026-12-01'))).toBe(0); // Tue: 3 left
      expect(await jobs.deadlineReminders(bogota('2026-12-02'))).toBe(2); // Wed: 2 left
      expect(await jobs.deadlineReminders(bogota('2026-12-02', 18))).toBe(0);
      expect(await jobs.deadlineReminders(bogota('2026-12-03'))).toBe(0);
      for (const [i, j] of fx.jurors.entries()) {
        expect(await sent(j._id, TYPES.RESPONSE_REMINDER, fx.ids[i])).toBe(1);
      }
      expect(await sent(coordA._id, TYPES.RESPONSE_REMINDER)).toBe(0);
      const n = await notifications
        .findOne({ userId: fx.jurors[0]._id, type: TYPES.RESPONSE_REMINDER })
        .lean();
      expect(n?.link).toBe('/juror');
      expect(
        (await assignments.findById(fx.ids[0]))?.responseReminderSentAt,
      ).toBeDefined();
    });

    it('counts business days only: weekends and holidays do not', async () => {
      await pendingFixture();
      // Friday deadline, Thursday is a holiday: Tue has Wed + Fri = 2 left.
      await settings.update({ holidays: ['2026-12-03'] });
      expect(await jobs.deadlineReminders(bogota('2026-11-30'))).toBe(0); // Mon: Tue, Wed, Fri
      expect(await jobs.deadlineReminders(bogota('2026-12-01'))).toBe(2); // Tue
    });

    it('spans a weekend', async () => {
      await pendingFixture();
      await assignments.updateMany(
        {},
        { responseDeadline: endOfLocalDay('2026-12-07') },
      ); // Monday
      expect(await jobs.deadlineReminders(bogota('2026-12-02'))).toBe(0); // Wed: Thu, Fri, Mon
      expect(await jobs.deadlineReminders(bogota('2026-12-03'))).toBe(2); // Thu: Fri, Mon
    });

    it('honors reminderBusinessDaysBefore and skips expired deadlines', async () => {
      await settings.update({ reminderBusinessDaysBefore: 4 });
      await pendingFixture();
      expect(await jobs.deadlineReminders(bogota('2026-11-27'))).toBe(0); // Fri: 5 left
      expect(await jobs.deadlineReminders(bogota('2026-11-30'))).toBe(2); // Mon: 4 left
    });

    it('sends nothing once the response deadline has passed', async () => {
      await pendingFixture();
      expect(await jobs.deadlineReminders(bogota('2026-12-05'))).toBe(0);
    });

    it('reminds ACCEPTED jurors before evaluationDeadline, but not after submitting', async () => {
      const fx = await createThesisUnderEvaluation(app);
      const [a1, a2] = fx.assignmentIds;
      await setEvaluationDeadline(a1, '2026-12-04');
      await setEvaluationDeadline(a2, '2026-12-04');
      await submitEvaluation(
        app,
        a1,
        fx.jurors[0],
        EvaluationVerdict.APPROVED_FOR_DEFENSE,
      );

      expect(await jobs.deadlineReminders(bogota('2026-12-01'))).toBe(0);
      expect(await jobs.deadlineReminders(bogota('2026-12-02'))).toBe(1);
      expect(await jobs.deadlineReminders(bogota('2026-12-02', 20))).toBe(0);
      expect(await sent(fx.jurors[1]._id, TYPES.EVALUATION_REMINDER, a2)).toBe(
        1,
      );
      expect(await sent(fx.jurors[0]._id, TYPES.EVALUATION_REMINDER)).toBe(0);
      const n = await notifications
        .findOne({ userId: fx.jurors[1]._id, type: TYPES.EVALUATION_REMINDER })
        .lean();
      expect(n?.link).toBe(`/juror/evaluation/${a2}`);
      // Past the deadline it is the overdue job's business, not a reminder.
      await assignments.updateOne(
        { _id: a2 },
        { $unset: { evaluationReminderSentAt: 1 } },
      );
      expect(await jobs.deadlineReminders(bogota('2026-12-05'))).toBe(0);
    });
  });

  // ---------------------------------------------------------------- unseenConceptAlerts
  describe('unseenConceptAlerts', () => {
    const submittedOn = async (key: string) => {
      const fx = await createThesisUnderEvaluation(app);
      await submitEvaluation(
        app,
        fx.assignmentIds[0],
        fx.jurors[0],
        EvaluationVerdict.APPROVED_FOR_DEFENSE,
      );
      const evaluation = (await evaluations.findOne({
        assignmentId: fx.assignmentIds[0],
      }))!;
      await evaluations.updateOne(
        { _id: evaluation._id },
        { submittedAt: bogota(key) },
      );
      return { fx, evaluation };
    };

    it('alerts the coordinators (only) once after X business days', async () => {
      const { fx, evaluation } = await submittedOn('2026-11-30'); // Monday
      const id = evaluation.id as string;
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-02'))).toBe(0); // 2 days
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-03'))).toBe(1); // 3 days
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-03', 20))).toBe(0);
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-10'))).toBe(0);
      expect(await sent(coordA._id, TYPES.CONCEPT_UNSEEN, id)).toBe(1);
      expect(await sent(coordB._id, TYPES.CONCEPT_UNSEEN, id)).toBe(1);
      expect(await sent(fx.student._id, TYPES.CONCEPT_UNSEEN)).toBe(0);
      expect(await sent(fx.jurors[0]._id, TYPES.CONCEPT_UNSEEN)).toBe(0);
      const n = await notifications
        .findOne({ userId: coordA._id, type: TYPES.CONCEPT_UNSEEN })
        .lean();
      expect(n?.link).toBe(`/coordinator/theses/${fx.thesis.id as string}`);
      expect((await evaluations.findById(id))?.unseenAlertSentAt).toEqual(
        bogota('2026-12-03'),
      );
    });

    it('respects weekends, holidays and the unseenConceptAlertDays setting', async () => {
      await submittedOn('2026-12-03'); // Thursday
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-07'))).toBe(0); // Fri, Mon
      await settings.update({ holidays: ['2026-12-08'] });
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-08'))).toBe(0); // holiday: still 2
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-09'))).toBe(1);
      await submittedOn('2026-12-03');
      await settings.update({ unseenConceptAlertDays: 1, holidays: [] });
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-04'))).toBe(1);
    });

    it('does not alert when the student viewed it (through the API) or downloaded it', async () => {
      const { fx, evaluation } = await submittedOn('2026-11-30');
      const studentAgent = await loginAgent(app, fx.student.email);
      await studentAgent
        .get(`/api/evaluations/${evaluation.id as string}`)
        .expect(200);
      expect(
        (await evaluations.findById(evaluation._id))?.studentFirstViewedAt,
      ).toBeDefined();
      const other = await submittedOn('2026-11-30');
      await evaluations.updateOne(
        { _id: other.evaluation._id },
        { studentFirstDownloadedAt: bogota('2026-12-01') },
      );
      expect(await jobs.unseenConceptAlerts(bogota('2026-12-10'))).toBe(0);
    });

    it('ignores drafts', async () => {
      const fx = await createThesisUnderEvaluation(app);
      await app.get(getModelToken(Evaluation.name)).create({
        assignmentId: fx.assignmentIds[0],
        thesisId: fx.thesis._id,
        jurorId: fx.jurors[0]._id,
        assignmentType: 'PRIMARY',
      });
      expect(await jobs.unseenConceptAlerts(bogota('2027-01-15'))).toBe(0);
    });
  });

  // ---------------------------------------------------------------- POST /admin/jobs/run
  describe('POST /admin/jobs/run', () => {
    it('is ADMIN only', async () => {
      await coordinatorAgent
        .post('/api/admin/jobs/run')
        .send({ job: 'all' })
        .expect(403);
    });

    it('validates the job name', async () => {
      await admin.post('/api/admin/jobs/run').send({ job: 'nope' }).expect(400);
      await admin.post('/api/admin/jobs/run').send({}).expect(400);
    });

    it('runs one job and returns its count', async () => {
      const fx = await createThesisUnderEvaluation(app);
      await setEvaluationDeadline(fx.assignmentIds[0], '2020-01-03');
      const res = await admin
        .post('/api/admin/jobs/run')
        .send({ job: 'overdueEvaluations' })
        .expect(200);
      expect(res.body).toEqual({ overdueEvaluations: 1 });
      const again = await admin
        .post('/api/admin/jobs/run')
        .send({ job: 'overdueEvaluations' })
        .expect(200);
      expect(again.body).toEqual({ overdueEvaluations: 0 });
    });

    it("'all' returns a count per job", async () => {
      const res = await admin
        .post('/api/admin/jobs/run')
        .send({ job: 'all' })
        .expect(200);
      expect(Object.keys(res.body as object).sort()).toEqual([
        'deadlineReminders',
        'expirePending',
        'overdueEvaluations',
        'reconcile',
        'unseenConceptAlerts',
      ]);
    });

    it('runs expirePending and reconcile', async () => {
      const res = await admin
        .post('/api/admin/jobs/run')
        .send({ job: 'reconcile' })
        .expect(200);
      expect(res.body).toEqual({ reconcile: 0 });
      const exp = await admin
        .post('/api/admin/jobs/run')
        .send({ job: 'expirePending' })
        .expect(200);
      expect(exp.body).toEqual({ expirePending: 0 });
    });
  });

  describe('settings', () => {
    it('exposes and validates the new keys', async () => {
      const res = await admin.get('/api/settings').expect(200);
      expect(res.body).toMatchObject({
        reminderBusinessDaysBefore: 2,
        overdueRenotifyBusinessDays: 5,
        unseenConceptAlertDays: 3,
      });
      await admin
        .patch('/api/settings')
        .send({ reminderBusinessDaysBefore: 0 })
        .expect(400);
      await admin
        .patch('/api/settings')
        .send({ reminderBusinessDaysBefore: 11 })
        .expect(400);
      await admin
        .patch('/api/settings')
        .send({ overdueRenotifyBusinessDays: -1 })
        .expect(400);
      await admin
        .patch('/api/settings')
        .send({ reminderBusinessDaysBefore: 3, overdueRenotifyBusinessDays: 0 })
        .expect(200);
    });
  });
});
