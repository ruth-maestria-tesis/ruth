import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role, ThesisStatus } from '@thesis/shared';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import { UsersService } from '../src/users/users.service';
import { WorkflowService } from '../src/workflow/workflow.service';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createExternalJuror,
  createTestApp,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Assignments — replacement (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let assignments: Model<Assignment>;
  let theses: Model<Thesis>;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
    assignments = app.get(getModelToken(Assignment.name));
    theses = app.get(getModelToken(Thesis.name));
  });
  afterAll(() => closeTestApp(app));

  async function setup(second: 'internal' | 'external' = 'internal') {
    const j1 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const j2 =
      second === 'internal'
        ? await createUser(app, { roles: [Role.INTERNAL_JUROR] })
        : await createExternalJuror(app);
    const thesis = await createAssignableThesis(app);
    const { assignments: views } = await assignJury(app, thesis.id as string, [
      j1.id as string,
      j2.id as string,
    ]);
    return {
      thesis,
      j1,
      j2,
      a1: views[0].id,
      a2: views[1].id,
      juror1: await loginAgent(app, j1.email),
      juror2: second === 'internal' ? await loginAgent(app, j2.email) : null,
    };
  }
  const replace = (thesisId: string, body: object) =>
    coordinator.post(`/api/theses/${thesisId}/assignments/replace`).send(body);
  const statusOf = async (id: unknown) => (await theses.findById(id))?.status;
  const internal = async () =>
    (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).id as string;
  const newExt = (email: string) => ({
    email,
    firstName: 'Re',
    lastName: 'Emplazo',
    institution: 'U. de Lima',
    highestDegree: 'Doctorado',
    country: 'Perú',
  });
  const uniqueEmail = () => `ext.${randomUUID().slice(0, 8)}@uni.example.org`;

  it('replaces a declined juror; thesis returns to JURORS_ASSIGNED', async () => {
    const { thesis, a1, juror1 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'Sin tiempo' })
      .expect(200);
    expect(await statusOf(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
    const jurorId = await internal();
    const res = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId },
    }).expect(201);
    expect(res.body.assignment).toMatchObject({
      slot: 1,
      jurorId,
      status: AssignmentStatus.PENDING,
    });
    expect(res.body.externalLink).toBeUndefined();
    const old = await assignments.findById(a1);
    expect(old).toMatchObject({ status: AssignmentStatus.DECLINED });
    expect(old?.replacedById?.toHexString()).toBe(res.body.assignment.id);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
  });

  it('full path: one accepted, one declined, replacement accepts → UNDER_EVALUATION', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
    await juror2!
      .post(`/api/assignments/${a2}/decline`)
      .send({ reason: 'No' })
      .expect(200);
    expect(await statusOf(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
    const j3 = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const res = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: j3.id },
    }).expect(201);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
    await (
      await loginAgent(app, j3.email)
    )
      .post(`/api/assignments/${res.body.assignment.id as string}/accept`)
      .expect(200);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.UNDER_EVALUATION);
  });

  it('replaces a pending juror while JURORS_ASSIGNED (old one becomes REPLACED)', async () => {
    const { thesis, a2 } = await setup();
    await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: await internal() },
    }).expect(201);
    expect(await assignments.findById(a2)).toMatchObject({
      status: AssignmentStatus.REPLACED,
      isActive: false,
    });
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
  });

  it('cannot replace an accepted juror, nor bring back a current or previous juror', async () => {
    const { thesis, a1, a2, j1, j2, juror1 } = await setup();
    await juror1.post(`/api/assignments/${a1}/accept`).expect(200);
    const accepted = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(409);
    expect(accepted.body.code).toBe('ASSIGNMENT_NOT_REPLACEABLE');
    const current = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: j1.id },
    }).expect(400);
    expect(current.body.details.violations).toContainEqual({
      code: 'JUROR_DUPLICATE',
      slot: 2,
    });
    const same = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: j2.id },
    }).expect(400);
    expect(same.body.details.violations).toContainEqual({
      code: 'JUROR_PREVIOUSLY_ASSIGNED',
      slot: 2,
    });
    expect((await assignments.findById(a2))?.status).toBe(
      AssignmentStatus.PENDING,
    );
  });

  it('rejects a juror who was assigned earlier and later replaced (history)', async () => {
    const { thesis, a1, a2, juror1 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'No' })
      .expect(200);
    const first = await internal();
    const r1 = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: first },
    }).expect(201);
    await replace(thesis.id as string, {
      assignmentId: r1.body.assignment.id,
      juror: { jurorId: await internal() },
    }).expect(201);
    const back = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: first },
    }).expect(400);
    expect(back.body.details.violations).toContainEqual({
      code: 'JUROR_PREVIOUSLY_ASSIGNED',
      slot: 2,
    });
  });

  it('applies RN-01: the advisor cannot be the replacement', async () => {
    const { thesis, a2 } = await setup();
    const res = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: thesis.advisorId.toHexString() },
    }).expect(400);
    expect(res.body.details.violations).toContainEqual({
      code: 'JUROR_CONFLICT_OF_INTEREST',
      slot: 2,
    });
  });

  it('keeps RF-C13: an external replacing the only Unicórdoba juror is rejected', async () => {
    const { thesis, a1, juror1 } = await setup('external');
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'No' })
      .expect(200);
    const ext2 = await createExternalJuror(app);
    const res = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: ext2.id },
    }).expect(400);
    expect(res.body.details.violations).toContainEqual({
      code: 'JUROR_UNICORDOBA_REQUIRED',
    });
  });

  it('with both slots empty, the thesis waits until both are filled', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'a' })
      .expect(200);
    await juror2!
      .post(`/api/assignments/${a2}/decline`)
      .send({ reason: 'b' })
      .expect(200);
    const ext = await createExternalJuror(app);
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: ext.id },
    }).expect(201);
    expect(await statusOf(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
    await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: await internal() },
    }).expect(201);
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
  });

  it('rejects replacing twice, other theses, and theses that are not forming a jury', async () => {
    const { thesis, a1, juror1 } = await setup();
    const other = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x' })
      .expect(200);
    await replace(other.thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(404);
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(201);
    const twice = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(409);
    expect(twice.body.code).toBe('ASSIGNMENT_NOT_REPLACEABLE');

    const submitted = await createAssignableThesis(app);
    const res = await replace(submitted.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_THESIS_STATUS');
  });

  it('only the coordinator may replace', async () => {
    const { thesis, a2, juror1 } = await setup();
    await juror1
      .post(`/api/theses/${thesis.id as string}/assignments/replace`)
      .send({ assignmentId: a2, juror: { jurorId: await internal() } })
      .expect(403);
  });

  it('returns an external link when the replacement is an inline external juror', async () => {
    const { thesis, a2 } = await setup();
    const email = uniqueEmail();
    const res = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { newExternal: newExt(email) },
    }).expect(201);
    expect(res.body.externalLink).toMatchObject({
      assignmentId: res.body.assignment.id,
    });
    expect(res.body.externalLink.url).toContain('/auth/external-access?token=');
    const [user] = await app.get(UsersService).findManyByEmails([email]);
    expect(user.roles).toEqual([Role.EXTERNAL_JUROR]);
  });

  it('two concurrent replacements of one slot: one 201, one 409, one active row, only the winner creates a user', async () => {
    const { thesis, a2 } = await setup();
    const emails = [uniqueEmail(), uniqueEmail()];
    const results = await Promise.all(
      emails.map((email) =>
        replace(thesis.id as string, {
          assignmentId: a2,
          juror: { newExternal: newExt(email) },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.code).toBe('ASSIGNMENT_NOT_REPLACEABLE');
    const winner = results.findIndex((r) => r.status === 201);
    const users = app.get(UsersService);
    expect(await users.findManyByEmails([emails[winner]])).toHaveLength(1);
    expect(await users.findManyByEmails([emails[1 - winner]])).toHaveLength(0);
    expect(
      await assignments.countDocuments({
        thesisId: thesis._id,
        slot: 2,
        isActive: true,
      }),
    ).toBe(1);
  });

  it('a failed insert restores the old assignment and deletes the inline user', async () => {
    const { thesis, a2 } = await setup();
    const email = uniqueEmail();
    const spy = jest
      .spyOn(assignments, 'insertMany')
      .mockRejectedValueOnce(new Error('insert failed'));
    await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { newExternal: newExt(email) },
    }).expect(500);
    spy.mockRestore();
    const old = await assignments.findById(a2);
    expect(old).toMatchObject({
      status: AssignmentStatus.PENDING,
      isActive: true,
    });
    expect(old?.replacedById).toBeUndefined();
    expect(await app.get(UsersService).findManyByEmails([email])).toHaveLength(
      0,
    );
    expect(await statusOf(thesis._id)).toBe(ThesisStatus.JURORS_ASSIGNED);
    // The slot can still be replaced afterwards.
    await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { jurorId: await internal() },
    }).expect(201);
  });

  it('a failed insert for a declined slot frees it for another replacement', async () => {
    const { thesis, a1, juror1 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x' })
      .expect(200);
    const spy = jest
      .spyOn(assignments, 'insertMany')
      .mockRejectedValueOnce(new Error('insert failed'));
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(500);
    spy.mockRestore();
    const old = await assignments.findById(a1);
    expect(old?.status).toBe(AssignmentStatus.DECLINED);
    expect(old?.replacedById).toBeUndefined();
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(201);
  });

  it('a decline of the other juror while the slot is being filled keeps the thesis waiting', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x' })
      .expect(200);
    const original = assignments.insertMany.bind(assignments);
    const spy = jest
      .spyOn(assignments, 'insertMany')
      .mockImplementationOnce((async (...args: unknown[]) => {
        await juror2!
          .post(`/api/assignments/${a2}/decline`)
          .send({ reason: 'y' })
          .expect(200);
        return (original as (...a: unknown[]) => Promise<unknown>)(...args);
      }) as never);
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(201);
    spy.mockRestore();
    expect(await statusOf(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
  });

  it('a decline that lands just before the move back to JURORS_ASSIGNED is not hidden', async () => {
    const { thesis, a1, a2, juror1, juror2 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x' })
      .expect(200);
    const workflow = app.get(WorkflowService);
    const original = workflow.transition.bind(workflow);
    const spy = jest
      .spyOn(workflow, 'transition')
      .mockImplementationOnce(async (input) => {
        // The other juror declines after the replacement counted two active jurors.
        await juror2!
          .post(`/api/assignments/${a2}/decline`)
          .send({ reason: 'y' })
          .expect(200);
        return original(input);
      });
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: await internal() },
    }).expect(201);
    spy.mockRestore();
    expect(await statusOf(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
  });

  /** Thesis with both primary slots declined (PENDING_JUROR_REPLACEMENT). */
  async function bothDeclined() {
    const ctx = await setup();
    await ctx.juror1
      .post(`/api/assignments/${ctx.a1}/decline`)
      .send({ reason: 'a' })
      .expect(200);
    await ctx
      .juror2!.post(`/api/assignments/${ctx.a2}/decline`)
      .send({ reason: 'b' })
      .expect(200);
    return ctx;
  }

  it('a fill of the other slot during the insert breaking RF-C13 undoes this replacement (409 with violations)', async () => {
    const { thesis, a1, a2 } = await bothDeclined();
    const other = await createExternalJuror(app);
    const email = uniqueEmail();
    const original = assignments.insertMany.bind(assignments);
    let otherRes:
      { status: number; body: { assignment: { id: string } } } | undefined;
    const spy = jest
      .spyOn(assignments, 'insertMany')
      .mockImplementationOnce((async (...args: unknown[]) => {
        // Replacement Y runs to completion while X sits between its mark and its insert.
        otherRes = await replace(thesis.id as string, {
          assignmentId: a2,
          juror: { jurorId: other.id },
        });
        return (original as (...a: unknown[]) => Promise<unknown>)(...args);
      }) as never);
    const res = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { newExternal: newExt(email) },
    });
    spy.mockRestore();
    expect(otherRes?.status).toBe(201);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSIGNMENT_CONFLICT');
    expect(res.body.details.violations).toEqual([
      { code: 'JUROR_UNICORDOBA_REQUIRED' },
    ]);
    expect(await app.get(UsersService).findManyByEmails([email])).toHaveLength(
      0,
    );
    const active = await assignments
      .find({ thesisId: thesis._id, isActive: true })
      .exec();
    expect(active.map((a) => a.id as string)).toEqual([
      otherRes!.body.assignment.id,
    ]);
    const old = await assignments.findById(a1);
    expect(old?.status).toBe(AssignmentStatus.DECLINED);
    expect(old?.replacedById).toBeUndefined();
    expect(await statusOf(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
  });

  it('a failed move to JURORS_ASSIGNED undoes the replacement and its inline user', async () => {
    const { thesis, a1, juror1 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x' })
      .expect(200);
    const email = uniqueEmail();
    const spy = jest
      .spyOn(app.get(WorkflowService), 'transition')
      .mockRejectedValueOnce(new Error('transition failed'));
    await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { newExternal: newExt(email) },
    }).expect(500);
    spy.mockRestore();
    const old = await assignments.findById(a1);
    expect(old?.status).toBe(AssignmentStatus.DECLINED);
    expect(old?.replacedById).toBeUndefined();
    expect(
      await assignments.countDocuments({ thesisId: thesis._id, slot: 1 }),
    ).toBe(1);
    expect(await app.get(UsersService).findManyByEmails([email])).toHaveLength(
      0,
    );
    expect(await statusOf(thesis._id)).toBe(
      ThesisStatus.PENDING_JUROR_REPLACEMENT,
    );
  });

  it('a newcomer who already answered is kept when the undo would run', async () => {
    const { thesis, a1, juror1 } = await setup();
    await juror1
      .post(`/api/assignments/${a1}/decline`)
      .send({ reason: 'x' })
      .expect(200);
    const newcomer = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const agent = await loginAgent(app, newcomer.email);
    const spy = jest
      .spyOn(app.get(WorkflowService), 'transition')
      .mockImplementationOnce(async () => {
        const fresh = await assignments
          .findOne({ thesisId: thesis._id, slot: 1, isActive: true })
          .exec();
        await agent
          .post(`/api/assignments/${fresh!.id as string}/accept`)
          .expect(200);
        throw new Error('transition failed');
      });
    const res = await replace(thesis.id as string, {
      assignmentId: a1,
      juror: { jurorId: newcomer.id },
    }).expect(201);
    spy.mockRestore();
    expect(res.body.assignment).toMatchObject({
      jurorId: newcomer.id,
      status: AssignmentStatus.ACCEPTED,
    });
    expect((await assignments.findById(a1))?.replacedById?.toHexString()).toBe(
      res.body.assignment.id,
    );
  });

  it('a link that cannot be generated does not fail the committed replacement', async () => {
    const { thesis, a2 } = await setup();
    const spy = jest
      .spyOn(app.get(AssignmentsService), 'rotateLink')
      .mockRejectedValueOnce(new Error('link failed'));
    const res = await replace(thesis.id as string, {
      assignmentId: a2,
      juror: { newExternal: newExt(uniqueEmail()) },
    }).expect(201);
    spy.mockRestore();
    expect(res.body.externalLink).toBeUndefined();
    expect(res.body.assignment.status).toBe(AssignmentStatus.PENDING);
    expect((await assignments.findById(a2))?.status).toBe(
      AssignmentStatus.REPLACED,
    );
  });
});
