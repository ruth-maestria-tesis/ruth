import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import {
  AssignmentStatus,
  EvaluationStatus,
  FeedbackStatus,
  MinutesStatus,
  ThesisStatus,
} from '@thesis/shared';
import { Connection, Model } from 'mongoose';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { Evaluation } from '../src/evaluations/schemas/evaluation.schema';
import { FeedbackItem } from '../src/feedback/schemas/feedback-item.schema';
import { Minutes } from '../src/minutes/schemas/minutes.schema';
import { Notification } from '../src/notifications/schemas/notification.schema';
import { normalizeSeedTag, resetSeed, runSeed } from '../src/seed/seed';
import { Defense } from '../src/defenses/schemas/defense.schema';
import { MinutesService } from '../src/minutes/minutes.service';
import { Counter } from '../src/theses/schemas/counter.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import { User } from '../src/users/schemas/user.schema';
import { closeTestApp, createTestApp, http } from './utils/test-app';
import request from 'supertest';

jest.setTimeout(180_000);

const TAGGED_COLLECTIONS = [
  'users',
  'theses',
  'assignments',
  'evaluations',
  'feedbackItems',
  'defenses',
  'minutes',
  'notifications',
  'cohorts',
];

describe('Seed (e2e, in-memory Mongo)', () => {
  let app: INestApplication;
  let db: Connection;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Connection>(getConnectionToken());
  });
  afterAll(() => closeTestApp(app));

  const tagged = async (tag: string) => {
    const counts: Record<string, number> = {};
    for (const c of TAGGED_COLLECTIONS)
      counts[c] = await db.collection(c).countDocuments({ seedTag: tag });
    counts.files = await db
      .collection('files.files')
      .countDocuments({ 'metadata.seedTag': tag });
    return counts;
  };

  it('validates and uppercases the tag', () => {
    expect(normalizeSeedTag('demo')).toBe('DEMO');
    expect(() => normalizeSeedTag('de mo')).toThrow();
    expect(() => normalizeSeedTag('1X')).toThrow();
  });

  it('seeds every status through the services, then --reset removes only tagged data', async () => {
    const result = await runSeed(app, { reset: true });
    expect(result.tag).toBe('DEMO');

    const theses: Model<Thesis> = app.get(getModelToken(Thesis.name));
    const seeded = await theses.find({ seedTag: 'DEMO' }).exec();
    expect(seeded.length).toBeGreaterThanOrEqual(15);
    const statuses = new Set(seeded.map((t) => t.status));
    for (const s of Object.values(ThesisStatus)) expect(statuses).toContain(s);
    for (const t of seeded) {
      expect(t.code).toMatch(/^DEMO-MIETIA-20\d\d-I{1,2}-\d{3}$/);
      expect(t.currentManuscriptId).toBeDefined();
      expect(t.history[0].to).toBe(ThesisStatus.SUBMITTED);
    }

    // Coherence spot checks.
    const assignments: Model<Assignment> = app.get(
      getModelToken(Assignment.name),
    );
    const inDispute = seeded.find((t) => t.status === ThesisStatus.IN_DISPUTE)!;
    expect(
      await assignments.exists({
        thesisId: inDispute._id,
        type: 'TIEBREAKER',
        status: AssignmentStatus.PENDING,
      }),
    ).toBeTruthy();
    const feedback: Model<FeedbackItem> = app.get(
      getModelToken(FeedbackItem.name),
    );
    const revisions = seeded.find(
      (t) => t.status === ThesisStatus.REVISIONS_IN_PROGRESS,
    )!;
    const items = await feedback.find({ thesisId: revisions._id }).exec();
    expect(new Set(items.map((i) => i.status))).toEqual(
      new Set([
        FeedbackStatus.PENDING,
        FeedbackStatus.ADDRESSED,
        FeedbackStatus.RESOLVED,
      ]),
    );
    const minutes: Model<Minutes> = app.get(getModelToken(Minutes.name));
    const sealed = await minutes
      .find({ status: MinutesStatus.SEALED, seedTag: 'DEMO' })
      .exec();
    expect(sealed.length).toBeGreaterThanOrEqual(2);
    expect(sealed.every((x) => x.pdfFileId)).toBe(true);
    // Demo minutes never use the official numbering and the defense predates the seal.
    const defensesModel: Model<Defense> = app.get(getModelToken(Defense.name));
    for (const x of sealed) {
      expect(x.number).toMatch(/^DEMO-MIETIA-\d{4}-\d{3}$/);
      const d = (await defensesModel.findById(x.defenseId))!;
      expect(d.scheduledAt.getTime()).toBeLessThan(x.sealedAt!.getTime());
    }
    const counterDocs = await db.collection('counters').find().toArray();
    for (const c of counterDocs.filter((c) => /^minutes:/.test(String(c._id))))
      expect(String(c._id)).toMatch(/^minutes:DEMO-/);

    // jurado1: one PENDING assignment and one ACCEPTED with a draft evaluation.
    const users: Model<User> = app.get(getModelToken(User.name));
    const j1 = (await users.findOne({ email: 'jurado1@unicordoba.edu.co' }))!;
    expect(
      await assignments.exists({
        jurorId: j1._id,
        status: AssignmentStatus.PENDING,
      }),
    ).toBeTruthy();
    const evaluations: Model<Evaluation> = app.get(
      getModelToken(Evaluation.name),
    );
    expect(
      await evaluations.exists({
        jurorId: j1._id,
        status: EvaluationStatus.DRAFT,
      }),
    ).toBeTruthy();
    expect(result.externalLink?.url).toContain('/auth/external-access?token=');

    // Known credentials work through the API.
    await request(http(app))
      .post('/api/auth/login')
      .send({ email: 'coordinador@unicordoba.edu.co', password: 'Coord2026!' })
      .expect(200);
    await request(http(app))
      .post('/api/auth/login')
      .send({ email: 'jurado1@unicordoba.edu.co', password: 'Jurado2026!' })
      .expect(200);

    const before = await tagged('DEMO');
    for (const c of [...TAGGED_COLLECTIONS, 'files'])
      expect(before[c]).toBeGreaterThan(0);

    // Without --reset a second run refuses; with it, it rebuilds the same dataset.
    await expect(runSeed(app)).rejects.toThrow(/--reset/);

    // A reset keeps a seeded thesis (and what it references) while untagged documents use it.
    const target = seeded[0];
    const assignmentsRaw = db.collection('assignments');
    const outsideAssignment = await assignmentsRaw.insertOne({
      thesisId: target._id,
      jurorId: target.advisorId,
      seedTag: undefined,
    });
    await resetSeed(app);
    expect(await theses.exists({ _id: target._id })).toBeTruthy();
    expect(await users.exists({ _id: target.studentId })).toBeTruthy();
    expect(
      await db.collection('cohorts').countDocuments({ _id: target.cohortId }),
    ).toBe(1);
    expect(await theses.countDocuments({ seedTag: 'DEMO' })).toBe(1);
    await assignmentsRaw.deleteOne({ _id: outsideAssignment.insertedId });
    await resetSeed(app);

    // Untagged data survives a reset.
    const outsider = await users.create({
      email: 'real.user@unicordoba.edu.co',
      firstName: 'Real',
      lastName: 'User',
      roles: ['ADMIN'],
      passwordHash: 'x',
    });
    await resetSeed(app, 'demo');
    const after = await tagged('DEMO');
    for (const c of Object.keys(after)) expect(after[c]).toBe(0);
    expect(await users.exists({ _id: outsider._id })).toBeTruthy();
    const notifications: Model<Notification> = app.get(
      getModelToken(Notification.name),
    );
    expect(await notifications.countDocuments()).toBe(0);
    const counters: Model<Counter> = app.get(getModelToken(Counter.name));
    expect(await counters.countDocuments()).toBe(0);
    expect(await db.collection('files.chunks').countDocuments()).toBe(0);
    // The shared catalogs are never tagged and never deleted.
    expect(await db.collection('programs').countDocuments()).toBe(1);
    expect(await db.collection('periods').countDocuments()).toBe(2);
    expect(
      await db
        .collection('programs')
        .countDocuments({ seedTag: { $exists: true } }),
    ).toBe(0);

    // Idempotent: seeding again after a reset works.
    const again = await runSeed(app, { reset: true });
    expect(again.theses).toHaveLength(result.theses.length);
    expect(again.theses.map((t) => t.code)).toEqual(
      result.theses.map((t) => t.code),
    );
  });

  it('a seed that fails partway can still be fully removed with --reset', async () => {
    await resetSeed(app);
    const spy = jest
      .spyOn(app.get(MinutesService), 'create')
      .mockRejectedValueOnce(new Error('boom'));
    await expect(runSeed(app)).rejects.toThrow('boom');
    spy.mockRestore();
    const partial = await tagged('DEMO');
    expect(partial.users).toBeGreaterThan(0);
    expect(partial.theses).toBeGreaterThan(0);
    expect(partial.assignments).toBeGreaterThan(0);
    expect(partial.files).toBeGreaterThan(0);
    await resetSeed(app);
    const after = await tagged('DEMO');
    for (const c of Object.keys(after)) expect(after[c]).toBe(0);
    expect(
      await db.collection('users').countDocuments({ seedTag: 'DEMO' }),
    ).toBe(0);
  });

  it('refuses to run in production unless forced', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(runSeed(app, { reset: true })).rejects.toThrow(/--force/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
