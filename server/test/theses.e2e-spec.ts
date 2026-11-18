import { INestApplication } from '@nestjs/common';
import { Role, ThesisStatus } from '@thesis/shared';
import { Types } from 'mongoose';
import { UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import {
  CatalogFixture,
  closeTestApp,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Theses (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let admin: TestAgent;
  let catalog: CatalogFixture;
  let advisor: UserDocument;

  beforeAll(async () => {
    app = await createTestApp();
    const c = await createUser(app, { roles: [Role.COORDINATOR] });
    const a = await createUser(app, { roles: [Role.ADMIN] });
    coordinator = await loginAgent(app, c.email);
    admin = await loginAgent(app, a.email);
    catalog = await createCatalog(app, { programCode: 'MIETIA', year: 2026 });
    advisor = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
  });
  afterAll(() => closeTestApp(app));

  const newStudent = (firstName = 'Laura', lastName = 'Pérez') =>
    createUser(app, { roles: [Role.STUDENT], firstName, lastName });

  const body = (studentId: string, extra: Record<string, unknown> = {}) => ({
    title: 'IA generativa en el aula',
    abstract: 'Resumen',
    keywords: ['IA', 'educación'],
    studentId,
    advisorId: advisor.id as string,
    ...catalog,
    ...extra,
  });

  describe('POST /theses (radicación)', () => {
    it('registers a thesis with a sequential prefixed code, SUBMITTED at 10%', async () => {
      const s1 = await newStudent();
      const s2 = await newStudent('Carlos', 'Gómez');
      const r1 = await coordinator
        .post('/api/theses')
        .send(body(s1.id as string))
        .expect(201);
      const r2 = await coordinator
        .post('/api/theses')
        .send(body(s2.id as string))
        .expect(201);
      expect(r1.body).toMatchObject({
        code: 'MIETIA-2026-II-001',
        status: ThesisStatus.SUBMITTED,
        progress: 10,
        studentName: 'Laura Pérez',
      });
      expect(r2.body.code).toBe('MIETIA-2026-II-002');
      expect(r1.body.history).toEqual([
        expect.objectContaining({
          from: null,
          to: ThesisStatus.SUBMITTED,
          actorRole: Role.COORDINATOR,
        }),
      ]);
    });

    it('assigns distinct sequential codes to concurrent registrations', async () => {
      const fresh = await createCatalog(app, {
        programCode: 'CONC',
        year: 2031,
      });
      const students = await Promise.all(
        Array.from({ length: 5 }, () => newStudent()),
      );
      const responses = await Promise.all(
        students.map((s) =>
          coordinator
            .post('/api/theses')
            .send(body(s.id as string, { ...fresh })),
        ),
      );
      responses.forEach((r) => expect(r.status).toBe(201));
      const codes = responses
        .map((r) => (r.body as { code: string }).code)
        .sort();
      expect(new Set(codes).size).toBe(5);
      expect(codes).toEqual([1, 2, 3, 4, 5].map((n) => `CONC-2031-II-00${n}`));
    });

    it('rejects a second active thesis for the same student', async () => {
      const s = await newStudent();
      await coordinator
        .post('/api/theses')
        .send(body(s.id as string))
        .expect(201);
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string))
        .expect(409);
      expect(res.body.code).toBe('THESIS_STUDENT_HAS_ACTIVE');
    });

    it.each([
      [
        'studentId',
        async () =>
          (await createUser(app, { roles: [Role.COORDINATOR] })).id as string,
      ],
      ['advisorId', async () => (await newStudent()).id as string],
    ])(
      'rejects a %s with the wrong role as THESIS_INVALID_REFERENCE',
      async (field, makeId) => {
        const s = await newStudent();
        const res = await coordinator
          .post('/api/theses')
          .send(body(s.id as string, { [field]: await makeId() }))
          .expect(400);
        expect(res.body).toMatchObject({
          code: 'THESIS_INVALID_REFERENCE',
          details: { field },
        });
      },
    );

    it('rejects an inactive advisor and an advisor repeated as co-advisor', async () => {
      const s = await newStudent();
      const inactive = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
      await app
        .get(UsersService)
        .setActive(
          inactive.id as string,
          false,
          new Types.ObjectId().toHexString(),
        );
      await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { advisorId: inactive.id }))
        .expect(400);
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { coAdvisorIds: [advisor.id] }))
        .expect(400);
      expect(res.body.details).toEqual({ field: 'coAdvisorIds' });
    });

    it('rejects a cohort from another program with COHORT_PROGRAM_MISMATCH', async () => {
      const other = await createCatalog(app);
      const s = await newStudent();
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { cohortId: other.cohortId }))
        .expect(400);
      expect(res.body.code).toBe('COHORT_PROGRAM_MISMATCH');
    });

    it('rejects unknown catalog ids with THESIS_INVALID_REFERENCE', async () => {
      const s = await newStudent();
      const res = await coordinator
        .post('/api/theses')
        .send(body(s.id as string, { periodId: '65a1b2c3d4e5f60718293a4b' }))
        .expect(400);
      expect(res.body.details).toEqual({ field: 'periodId' });
    });
  });

  describe('GET /theses (bandeja)', () => {
    let listCatalog: CatalogFixture;

    beforeAll(async () => {
      listCatalog = await createCatalog(app, {
        programCode: 'LIST',
        year: 2030,
      });
      for (const [first, last, title] of [
        ['Zoe', 'Arias', 'Beta'],
        ['Ana', 'Torres', 'Alfa'],
        ['Mario', 'López', 'Gamma'],
      ]) {
        const s = await newStudent(first, last);
        await createThesis(app, listCatalog, {
          studentId: s.id as string,
          title,
        });
      }
    });

    it('paginates with total and filters by program', async () => {
      const res = await admin
        .get(`/api/theses?programId=${listCatalog.programId}&limit=2&page=1`)
        .expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].history).toBeUndefined();
    });

    it.each([
      ['title', 'asc', ['Alfa', 'Beta', 'Gamma']],
      ['title', 'desc', ['Gamma', 'Beta', 'Alfa']],
      ['student', 'asc', ['Alfa', 'Gamma', 'Beta']], // Ana Torres, Mario López, Zoe Arias
      ['code', 'asc', ['Beta', 'Alfa', 'Gamma']],
    ])('sorts by %s %s', async (sort, order, titles) => {
      const res = await coordinator
        .get(
          `/api/theses?programId=${listCatalog.programId}&sort=${sort}&order=${order}`,
        )
        .expect(200);
      expect(res.body.items.map((t: { title: string }) => t.title)).toEqual(
        titles,
      );
    });

    it('searches by q over title, code and student name, and by codePrefix', async () => {
      const byName = await coordinator.get('/api/theses?q=torres').expect(200);
      expect(byName.body.items.map((t: { title: string }) => t.title)).toEqual([
        'Alfa',
      ]);
      const byPrefix = await coordinator
        .get('/api/theses?codePrefix=LIST-2030')
        .expect(200);
      expect(byPrefix.body.total).toBe(3);
    });

    it('rejects unknown status values', async () => {
      await coordinator.get('/api/theses?status=FOO').expect(400);
    });
  });

  describe('GET /theses/mine, GET /theses/:id', () => {
    it('student sees only their own thesis; others get 404', async () => {
      const owner = await newStudent();
      const other = await newStudent();
      const t = await createThesis(app, catalog, {
        studentId: owner.id as string,
      });
      const ownerAgent = await loginAgent(app, owner.email);
      const otherAgent = await loginAgent(app, other.email);

      const mine = await ownerAgent.get('/api/theses/mine').expect(200);
      expect(mine.body.map((x: { id: string }) => x.id)).toEqual([t.id]);
      await ownerAgent.get(`/api/theses/${t.id as string}`).expect(200);
      const res = await otherAgent
        .get(`/api/theses/${t.id as string}`)
        .expect(404);
      expect(res.body.code).toBe('THESIS_NOT_FOUND');
      expect(
        (await otherAgent.get('/api/theses/mine').expect(200)).body,
      ).toEqual([]);
    });

    it('malformed id → 400, unknown id → 404', async () => {
      await coordinator.get('/api/theses/nope').expect(400);
      await coordinator.get('/api/theses/65a1b2c3d4e5f60718293a4b').expect(404);
    });
  });

  describe('PATCH /theses/:id', () => {
    it('edits metadata; rejects null', async () => {
      const t = await createThesis(app, catalog);
      const res = await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ title: 'Nuevo título', keywords: ['a'] })
        .expect(200);
      expect(res.body).toMatchObject({
        title: 'Nuevo título',
        keywords: ['a'],
      });
      await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ title: null })
        .expect(400);
    });

    it('participants can change only while SUBMITTED; closed theses are locked', async () => {
      const t = await createThesis(app, catalog);
      const other = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
      await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ coAdvisorIds: [other.id] })
        .expect(200);

      await t.updateOne({ status: ThesisStatus.UNDER_EVALUATION });
      const locked = await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ advisorId: other.id })
        .expect(409);
      expect(locked.body.code).toBe('THESIS_NOT_EDITABLE');
      await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ title: 'OK' })
        .expect(200);

      await t.updateOne({ status: ThesisStatus.NOT_APPROVED });
      const closed = await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ title: 'No' })
        .expect(409);
      expect(closed.body.code).toBe('THESIS_CLOSED');
    });

    it('rejects body fields that are not editable', async () => {
      const t = await createThesis(app, catalog);
      await coordinator
        .patch(`/api/theses/${t.id as string}`)
        .send({ status: ThesisStatus.READY_FOR_DEFENSE })
        .expect(400);
    });
  });
});
