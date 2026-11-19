import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role, ThesisStatus } from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { SettingsService } from '../src/settings/settings.service';
import { ThesesService } from '../src/theses/theses.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import {
  CatalogFixture,
  closeTestApp,
  createAssignableThesis,
  createCatalog,
  createExternalJuror,
  createTestApp,
  createThesis,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

type JurorInput = { jurorId?: string; newExternal?: object };

/** Ids and emails the table-driven cases build their juror lists from. */
interface CaseContext {
  advisorId: string;
  unicordobaId: string;
  externalId: string;
  takenEmail: string;
}

const newExt = (email: string) => ({
  email,
  firstName: 'X',
  lastName: 'Y',
  institution: 'Otra U',
  highestDegree: 'Maestría',
  country: 'Perú',
});

const INVALID_JURIES: [
  string,
  (ctx: CaseContext) => JurorInput[],
  string,
  number | undefined,
][] = [
  [
    'advisor as juror',
    (c) => [{ jurorId: c.advisorId }, { jurorId: c.unicordobaId }],
    'JUROR_CONFLICT_OF_INTEREST',
    1,
  ],
  [
    'two non-Unicórdoba jurors',
    (c) => [
      { jurorId: c.externalId },
      { newExternal: newExt('x1@uni.example.org') },
    ],
    'JUROR_UNICORDOBA_REQUIRED',
    undefined,
  ],
  [
    'a single juror',
    (c) => [{ jurorId: c.unicordobaId }],
    'JUROR_COUNT',
    undefined,
  ],
  [
    'the same juror twice',
    (c) => [{ jurorId: c.unicordobaId }, { jurorId: c.unicordobaId }],
    'JUROR_DUPLICATE',
    2,
  ],
  [
    'an existing email as new external',
    (c) => [{ jurorId: c.unicordobaId }, { newExternal: newExt(c.takenEmail) }],
    'JUROR_EMAIL_TAKEN',
    2,
  ],
];

describe('Assignments — CU-01 (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let admin: TestAgent;
  let catalog: CatalogFixture;
  let unicor: UserDocument;
  let unicor2: UserDocument;
  let external: UserDocument;
  let assignments: Model<Assignment>;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
    admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    catalog = await createCatalog(app);
    unicor = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    unicor2 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    external = await createExternalJuror(app);
    assignments = app.get(getModelToken(Assignment.name));
  });
  afterAll(() => closeTestApp(app));

  const assign = (thesisId: string, body: object) =>
    coordinator.post(`/api/theses/${thesisId}/assignments`).send(body);

  it('assigns a Unicórdoba juror and an external juror; thesis → JURORS_ASSIGNED', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const res = await assign(thesis.id as string, {
      jurors: [{ jurorId: unicor.id }, { jurorId: external.id }],
    }).expect(201);

    expect(res.body.assignments).toHaveLength(2);
    expect(res.body.assignments[0]).toMatchObject({
      slot: 1,
      jurorId: unicor.id,
      status: AssignmentStatus.PENDING,
      responseDaysRemaining: 8,
      daysSinceAssigned: 0,
      isResponseOverdue: false,
    });
    expect(res.body.externalLinks).toEqual([
      expect.objectContaining({
        assignmentId: res.body.assignments[1].id,
        url: expect.stringMatching(
          /\/auth\/external-access\?token=[A-Za-z0-9_-]{43}$/,
        ),
      }),
    ]);
    const after = await coordinator
      .get(`/api/theses/${thesis.id as string}`)
      .expect(200);
    expect(after.body).toMatchObject({
      status: ThesisStatus.JURORS_ASSIGNED,
      progress: 25,
    });
    expect(after.body.history.at(-1)).toMatchObject({
      from: 'SUBMITTED',
      to: 'JURORS_ASSIGNED',
      reason: 'CU-01',
    });
  });

  it('creates an external juror inline without a password (RF-C14)', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const res = await assign(thesis.id as string, {
      jurors: [
        { jurorId: unicor.id },
        {
          newExternal: {
            email: 'Nuevo.Externo@uni.example.org',
            firstName: 'Nuevo',
            lastName: 'Externo',
            institution: 'Universidad de Chile',
            highestDegree: 'Doctorado',
            country: 'Chile',
          },
        },
      ],
    }).expect(201);
    const created = await app
      .get(UsersService)
      .findByEmailWithPassword('nuevo.externo@uni.example.org');
    expect(created?.toObject()).toMatchObject({
      roles: [Role.EXTERNAL_JUROR],
      jurorProfile: { isUnicordoba: false },
    });
    expect(created?.passwordHash).toBeUndefined();
    expect(res.body.assignments[1].jurorId).toBe(created?.id);
    expect(res.body.externalLinks).toHaveLength(1);
  });

  it.each(INVALID_JURIES)(
    'rejects %s with ASSIGNMENT_INVALID_COMPOSITION',
    async (_name, build, code, slot) => {
      const thesis = await createAssignableThesis(app, catalog);
      const jurors = build({
        advisorId: thesis.advisorId.toHexString(),
        unicordobaId: unicor.id as string,
        externalId: external.id as string,
        takenEmail: unicor.email,
      });
      const res = await assign(thesis.id as string, { jurors }).expect(400);
      expect(res.body.code).toBe('ASSIGNMENT_INVALID_COMPOSITION');
      expect(res.body.details.violations).toContainEqual(
        slot ? { code, slot } : { code },
      );
      expect(await assignments.countDocuments({ thesisId: thesis._id })).toBe(
        0,
      );
    },
  );

  it('rejects a juror who is a student (not faculty) and an inactive juror', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const student = await createUser(app, { roles: [Role.STUDENT] });
    const inactive = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    await app
      .get<Model<User>>(getModelToken(User.name))
      .updateOne({ _id: inactive._id }, { isActive: false });
    const res = await assign(thesis.id as string, {
      jurors: [{ jurorId: student.id }, { jurorId: inactive.id }],
    }).expect(400);
    expect(res.body.details.violations).toEqual(
      expect.arrayContaining([
        { code: 'JUROR_NOT_FACULTY', slot: 1 },
        { code: 'JUROR_INACTIVE', slot: 2 },
      ]),
    );
  });

  it('requires exactly one of jurorId or newExternal per entry', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    await assign(thesis.id as string, {
      jurors: [{}, { jurorId: unicor.id }],
    }).expect(400);
    await assign(thesis.id as string, {
      jurors: [
        { jurorId: unicor2.id, newExternal: newExt('both@uni.example.org') },
        { jurorId: unicor.id },
      ],
    }).expect(400);
    expect(await assignments.countDocuments({ thesisId: thesis._id })).toBe(0);
  });

  it('requires SUBMITTED and a manuscript', async () => {
    const noManuscript = await createThesis(app, catalog);
    const a = await assign(noManuscript.id as string, {
      jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }],
    }).expect(409);
    expect(a.body.code).toBe('THESIS_MANUSCRIPT_REQUIRED');

    const thesis = await createAssignableThesis(app, catalog);
    await assign(thesis.id as string, {
      jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }],
    }).expect(201);
    const b = await assign(thesis.id as string, {
      jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }],
    }).expect(409);
    expect(b.body.code).toBe('ASSIGNMENT_THESIS_STATUS');
  });

  it('honours a custom response window', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const res = await assign(thesis.id as string, {
      jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }],
      responseBusinessDays: 3,
    }).expect(201);
    expect(res.body.assignments[0].responseDaysRemaining).toBe(3);
  });

  it('only a coordinator can assign', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    await admin
      .post(`/api/theses/${thesis.id as string}/assignments`)
      .send({ jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }] })
      .expect(403);
  });

  it('two concurrent CU-01 requests create a single jury', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const body = { jurors: [{ jurorId: unicor.id }, { jurorId: unicor2.id }] };
    const results = await Promise.all([
      assign(thesis.id as string, body),
      assign(thesis.id as string, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await assignments.countDocuments({
        thesisId: thesis._id,
        isActive: true,
      }),
    ).toBe(2);
  });

  it('two concurrent CU-01 requests with inline jurors leave no orphan users', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const body = (email: string) => ({
      jurors: [{ jurorId: unicor.id }, { newExternal: newExt(email) }],
    });
    const results = await Promise.all([
      assign(thesis.id as string, body('race.a@uni.example.org')),
      assign(thesis.id as string, body('race.b@uni.example.org')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const users = app.get(UsersService);
    const created = await users.findManyByEmails([
      'race.a@uni.example.org',
      'race.b@uni.example.org',
    ]);
    expect(created).toHaveLength(1);
    const active = await assignments
      .find({ thesisId: thesis._id, isActive: true })
      .exec();
    expect(active.map((a) => a.jurorId.toHexString()).sort()).toEqual(
      [unicor.id as string, created[0].id as string].sort(),
    );
  });

  it('a concurrent inline juror with the same email yields 409 and is compensated', async () => {
    const [t1, t2] = await Promise.all([
      createAssignableThesis(app, catalog),
      createAssignableThesis(app, catalog),
    ]);
    const body = {
      jurors: [
        { jurorId: unicor.id },
        { newExternal: newExt('same.race@uni.example.org') },
      ],
    };
    const results = await Promise.all([
      assign(t1.id as string, body),
      assign(t2.id as string, body),
    ]);
    // Depending on timing the loser is caught by validation (400) or by the insert (409).
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);
    const loser = results.find((r) => r.status !== 201)!;
    const loserThesis = loser === results[0] ? t1 : t2;
    expect(
      await assignments.countDocuments({ thesisId: loserThesis._id }),
    ).toBe(0);
    expect(
      await app
        .get(UsersService)
        .findManyByEmails(['same.race@uni.example.org']),
    ).toHaveLength(1);
  });

  /** Runs `write` right after validation (settings are read just before persisting). */
  function interleaveAfterValidation(write: () => Promise<unknown>) {
    const settings = app.get(SettingsService);
    const original = settings.get.bind(settings);
    return jest.spyOn(settings, 'get').mockImplementationOnce(async () => {
      await write();
      return original();
    });
  }

  it('a jury inserted after validation makes the insert fail; only this call is undone', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const competitorId = new Types.ObjectId();
    const spy = interleaveAfterValidation(() =>
      assignments.create({
        _id: competitorId,
        thesisId: thesis._id,
        jurorId: unicor2._id,
        slot: 2,
        status: AssignmentStatus.PENDING,
        isActive: true,
        assignedAt: new Date(),
        assignedBy: new Types.ObjectId(),
        responseDeadline: new Date(),
      }),
    );
    const res = await assign(thesis.id as string, {
      jurors: [
        { jurorId: unicor.id },
        { newExternal: newExt('compensated@uni.example.org') },
      ],
    }).expect(409);
    spy.mockRestore();
    expect(res.body.code).toBe('ASSIGNMENT_CONFLICT');
    // Slot 1 was inserted before slot 2 hit the index; it is gone, the competitor is kept.
    const left = await assignments.find({ thesisId: thesis._id }).exec();
    expect(left.map((a) => a.id as string)).toEqual([
      competitorId.toHexString(),
    ]);
    expect(
      await app
        .get(UsersService)
        .findManyByEmails(['compensated@uni.example.org']),
    ).toHaveLength(0);
    const after = await app.get(ThesesService).findById(thesis.id as string);
    expect(after.status).toBe(ThesisStatus.SUBMITTED);
  });

  it('an inline email registered after validation yields 409 and nothing is kept', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const spy = interleaveAfterValidation(() =>
      createExternalJuror(app, { email: 'late.taken@uni.example.org' }),
    );
    const res = await assign(thesis.id as string, {
      jurors: [
        { jurorId: unicor.id },
        { newExternal: newExt('late.taken@uni.example.org') },
      ],
    }).expect(409);
    spy.mockRestore();
    expect(res.body.code).toBe('USER_EMAIL_TAKEN');
    expect(await assignments.countDocuments({ thesisId: thesis._id })).toBe(0);
    const after = await app.get(ThesesService).findById(thesis.id as string);
    expect(after.status).toBe(ThesisStatus.SUBMITTED);
  });

  it('a duplicate-key race on the inline email is also a 409, not a 500', async () => {
    const thesis = await createAssignableThesis(app, catalog);
    const users = app.get(UsersService);
    const spy = jest.spyOn(users, 'createExternalJuror').mockRejectedValueOnce(
      Object.assign(new Error('E11000'), {
        code: 11000,
        keyPattern: { email: 1 },
      }),
    );
    const res = await assign(thesis.id as string, {
      jurors: [
        { jurorId: unicor.id },
        { newExternal: newExt('dup.key@uni.example.org') },
      ],
    }).expect(409);
    spy.mockRestore();
    expect(res.body.code).toBe('USER_EMAIL_TAKEN');
    expect(await assignments.countDocuments({ thesisId: thesis._id })).toBe(0);
  });

  describe('POST /assignments/validate', () => {
    it('reports violations without saving and valid=true for a correct jury', async () => {
      const thesis = await createAssignableThesis(app, catalog);
      const bad = await coordinator
        .post('/api/assignments/validate')
        .send({
          thesisId: thesis.id,
          jurors: [
            { jurorId: thesis.advisorId.toHexString() },
            { jurorId: external.id },
          ],
        })
        .expect(200);
      // The advisor fixture is a Unicórdoba juror, so RF-C13 holds and only RN-01 fails.
      expect(bad.body).toEqual({
        valid: false,
        violations: [{ code: 'JUROR_CONFLICT_OF_INTEREST', slot: 1 }],
      });
      const noUnicordoba = await coordinator
        .post('/api/assignments/validate')
        .send({
          thesisId: thesis.id,
          jurors: [
            { jurorId: external.id },
            { newExternal: newExt('validate.only@uni.example.org') },
          ],
        })
        .expect(200);
      expect(noUnicordoba.body).toEqual({
        valid: false,
        violations: [{ code: 'JUROR_UNICORDOBA_REQUIRED' }],
      });
      expect(
        await app
          .get(UsersService)
          .findManyByEmails(['validate.only@uni.example.org']),
      ).toHaveLength(0);
      const good = await coordinator
        .post('/api/assignments/validate')
        .send({
          thesisId: thesis.id,
          jurors: [{ jurorId: unicor.id }, { jurorId: external.id }],
        })
        .expect(200);
      expect(good.body).toEqual({ valid: true, violations: [] });
      expect(await assignments.countDocuments({ thesisId: thesis._id })).toBe(
        0,
      );
    });
  });

  describe('GET /theses/:id/assignments', () => {
    it('lists the jury with juror summaries for coordinator and admin', async () => {
      const thesis = await createAssignableThesis(app, catalog);
      await assign(thesis.id as string, {
        jurors: [{ jurorId: unicor.id }, { jurorId: external.id }],
      }).expect(201);
      const res = await admin
        .get(`/api/theses/${thesis.id as string}/assignments`)
        .expect(200);
      expect(res.body.map((a: { slot: number }) => a.slot)).toEqual([1, 2]);
      expect(res.body[0].juror).toMatchObject({
        id: unicor.id,
        isUnicordoba: true,
      });
      expect(res.body[1].juror).toMatchObject({
        id: external.id,
        isUnicordoba: false,
      });
      expect(res.body[1].hasExternalLink).toBe(true);
      expect(res.body[1].externalTokenHash).toBeUndefined();
      await coordinator
        .get(`/api/theses/${thesis.id as string}/assignments`)
        .expect(200);
    });
  });
});
