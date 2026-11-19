import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import { Role } from '@thesis/shared';
import {
  createCatalog,
  createTestApp,
  createThesisUnderEvaluation,
  createUser,
  closeTestApp,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Role-specific thesis view (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
  });
  afterAll(() => closeTestApp(app));

  it('students and jurors get no conflicts, seed tag or history actor/evidence ids', async () => {
    const fx = await createThesisUnderEvaluation(app, await createCatalog(app));
    const conflicted = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    await app.get<Model<Thesis>>(getModelToken(Thesis.name)).updateOne(
      { _id: fx.thesis._id },
      {
        conflictOfInterestUserIds: [conflicted._id],
        seedTag: 'view-test',
      },
    );
    const url = `/api/theses/${fx.thesis.id as string}`;

    const staff = (await coordinator.get(url).expect(200)).body;
    expect(staff.conflictOfInterestUserIds).toEqual([conflicted.id]);
    expect(staff.seedTag).toBe('view-test');

    const student = await loginAgent(app, fx.student.email);
    const juror = await loginAgent(app, fx.jurors[0].email);
    const own = (await student.get(url).expect(200)).body;
    const mine = (await student.get('/api/theses/mine').expect(200)).body[0];
    const asJuror = (await juror.get(url).expect(200)).body;
    for (const view of [own, mine, asJuror]) {
      expect(view).not.toHaveProperty('conflictOfInterestUserIds');
      expect(view).not.toHaveProperty('seedTag');
      expect(view.advisorId).toBe(fx.thesis.advisorId.toHexString());
      expect(view.history.length).toBeGreaterThan(1);
      for (const entry of view.history as Record<string, unknown>[]) {
        expect(entry).not.toHaveProperty('actorId');
        expect(entry).not.toHaveProperty('evidenceFileIds');
        expect(entry).toEqual(
          expect.objectContaining({
            to: expect.any(String),
            at: expect.any(String),
            actorRole: expect.any(String),
          }),
        );
      }
    }
    // Accepted juror and owner student keep the manuscripts.
    expect(own.manuscripts).toHaveLength(1);
    expect(asJuror.manuscripts).toHaveLength(1);
  });
});
