import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AssignmentStatus, Role } from '@thesis/shared';
import { Model } from 'mongoose';
import request from 'supertest';
import { Assignment } from '../src/assignments/schemas/assignment.schema';
import {
  assignJury,
  binaryParser,
  closeTestApp,
  createAssignableThesis,
  createExternalJuror,
  createTestApp,
  createUser,
  http,
  loginAgent,
  PDF_BYTES,
  TestAgent,
} from './utils/test-app';

describe('External juror access — RF-J14 (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let assignments: Model<Assignment>;

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
    assignments = app.get(getModelToken(Assignment.name));
  });
  afterAll(() => closeTestApp(app));

  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  async function setup() {
    const internal = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const external = await createExternalJuror(app);
    const thesis = await createAssignableThesis(app);
    const result = await assignJury(app, thesis.id as string, [
      internal.id as string,
      external.id as string,
    ]);
    return {
      thesis,
      internal,
      external,
      externalAssignmentId: result.assignments[1].id,
      internalAssignmentId: result.assignments[0].id,
      link: result.externalLinks[0],
    };
  }

  async function externalAgent(token: string) {
    const agent = request.agent(http(app));
    const res = await agent
      .post('/api/auth/external/validate-token')
      .send({ token })
      .expect(200);
    return { agent, res };
  }

  it('exchanges the link token for a scoped session limited to the assignment', async () => {
    const { thesis, external, externalAssignmentId, link } = await setup();
    const { agent, res } = await externalAgent(tokenOf(link.url));
    expect(res.body).toMatchObject({
      assignmentId: externalAssignmentId,
      user: { id: external.id, roles: [Role.EXTERNAL_JUROR] },
    });
    expect(res.headers['set-cookie']?.[0]).toMatch(/^access_token=.*HttpOnly/);
    await agent.get('/api/auth/me').expect(200);
    const mine = await agent.get('/api/assignments/mine').expect(200);
    expect(mine.body.map((a: { id: string }) => a.id)).toEqual([
      externalAssignmentId,
    ]);

    // Before accepting: thesis metadata yes, manuscript no.
    const detail = await agent
      .get(`/api/theses/${thesis.id as string}`)
      .expect(200);
    const fileId = detail.body.manuscripts[0].fileId as string;
    await agent
      .get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`)
      .expect(404);

    await agent
      .post(`/api/assignments/${externalAssignmentId}/accept`)
      .expect(200);
    const file = await agent
      .get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect((file.body as Buffer).equals(PDF_BYTES)).toBe(true);
    // No refresh token for external sessions.
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('a scoped session cannot reach another assignment of the same juror', async () => {
    const { external, link } = await setup();
    const internal = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    const other = await createAssignableThesis(app);
    const second = await assignJury(app, other.id as string, [
      internal.id as string,
      external.id as string,
    ]);
    const { agent } = await externalAgent(tokenOf(link.url));
    await agent.get(`/api/assignments/${second.assignments[1].id}`).expect(404);
    await agent
      .post(`/api/assignments/${second.assignments[1].id}/accept`)
      .expect(404);
    await agent.get(`/api/theses/${other.id as string}`).expect(404);
  });

  it('rejects unknown, rotated, expired and inactive-assignment tokens', async () => {
    const { externalAssignmentId, link } = await setup();
    const bad = await request(http(app))
      .post('/api/auth/external/validate-token')
      .send({ token: 'x'.repeat(43) })
      .expect(401);
    expect(bad.body.code).toBe('AUTH_EXTERNAL_TOKEN_INVALID');
    await request(http(app))
      .post('/api/auth/external/validate-token')
      .send({})
      .expect(400);

    const rotated = await coordinator
      .post(`/api/assignments/${externalAssignmentId}/external-link`)
      .expect(200);
    await request(http(app))
      .post('/api/auth/external/validate-token')
      .send({ token: tokenOf(link.url) })
      .expect(401);
    await externalAgent(tokenOf(rotated.body.url as string));

    await assignments.updateOne(
      { _id: externalAssignmentId },
      { externalTokenExpiresAt: new Date(Date.now() - 1000) },
    );
    await request(http(app))
      .post('/api/auth/external/validate-token')
      .send({ token: tokenOf(rotated.body.url as string) })
      .expect(401);

    const fresh = await coordinator
      .post(`/api/assignments/${externalAssignmentId}/external-link`)
      .expect(200);
    await assignments.updateOne(
      { _id: externalAssignmentId },
      { status: AssignmentStatus.DECLINED, isActive: false },
    );
    await request(http(app))
      .post('/api/auth/external/validate-token')
      .send({ token: tokenOf(fresh.body.url as string) })
      .expect(401);
  });

  it('links are only for external jurors and only the coordinator issues them', async () => {
    const { internalAssignmentId, externalAssignmentId } = await setup();
    const res = await coordinator
      .post(`/api/assignments/${internalAssignmentId}/external-link`)
      .expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_NOT_EXTERNAL');
    const admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    await admin
      .post(`/api/assignments/${externalAssignmentId}/external-link`)
      .expect(403);
  });

  it('internal jurors: pending sees metadata only, accepted gets the manuscript, declined loses access', async () => {
    const { thesis, internal, internalAssignmentId } = await setup();
    const juror = await loginAgent(app, internal.email);
    const detail = await juror
      .get(`/api/theses/${thesis.id as string}`)
      .expect(200);
    const fileId = detail.body.manuscripts[0].fileId as string;
    await juror
      .get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`)
      .expect(404);
    await juror
      .post(`/api/assignments/${internalAssignmentId}/accept`)
      .expect(200);
    await juror
      .get(`/api/theses/${thesis.id as string}/manuscripts/${fileId}`)
      .expect(200);

    const other = await setup();
    const otherJuror = await loginAgent(app, other.internal.email);
    await otherJuror
      .post(`/api/assignments/${other.internalAssignmentId}/decline`)
      .send({ reason: 'No' })
      .expect(200);
    await otherJuror
      .get(`/api/theses/${other.thesis.id as string}`)
      .expect(404);
    // A juror never sees theses they are not assigned to.
    await juror.get(`/api/theses/${other.thesis.id as string}`).expect(404);
  });
});
