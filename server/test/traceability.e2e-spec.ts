import { INestApplication } from '@nestjs/common';
import { Role, ThesisStatus } from '@thesis/shared';
import {
  assignJury,
  closeTestApp,
  createAssignableThesis,
  createTestApp,
  createUser,
  loginAgent,
} from './utils/test-app';

describe('Traceability graph (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => closeTestApp(app));

  it('builds the graph through assignment → accepted (UNDER_EVALUATION)', async () => {
    const student = await createUser(app, { roles: [Role.STUDENT] });
    const jurors = [
      await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
      await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
    ];
    const thesis = await createAssignableThesis(app, undefined, {
      studentId: student.id as string,
    });
    const { assignments } = await assignJury(
      app,
      thesis.id as string,
      jurors.map((j) => j.id as string),
    );
    for (const [i, juror] of jurors.entries()) {
      const agent = await loginAgent(app, juror.email);
      await agent
        .post(`/api/assignments/${assignments[i].id}/accept`)
        .expect(200);
    }

    const studentAgent = await loginAgent(app, student.email);
    const res = await studentAgent
      .get(`/api/theses/${thesis.id}/graph`)
      .expect(200);
    const { nodes, edges } = res.body as {
      nodes: { id: string; kind: string; status?: string; current?: boolean }[];
      edges: { from: string; to: string; label?: string }[];
    };

    expect(res.body.thesisId).toBe(thesis.id);
    expect(res.body.status).toBe(ThesisStatus.UNDER_EVALUATION);
    expect(res.body.progress).toEqual(expect.any(Number));

    const statusNodes = nodes.filter((n) => n.kind === 'STATUS');
    expect(statusNodes.map((n) => n.status)).toEqual([
      ThesisStatus.SUBMITTED,
      ThesisStatus.JURORS_ASSIGNED,
      ThesisStatus.UNDER_EVALUATION,
    ]);
    expect(statusNodes.filter((n) => n.current)).toHaveLength(1);
    expect(statusNodes[2].current).toBe(true);
    expect(nodes.filter((n) => n.kind === 'ASSIGNMENT')).toHaveLength(2);
    expect(nodes).toHaveLength(5);

    // 2 status-to-status edges + 1 edge per assignment node.
    expect(edges).toHaveLength(4);
    const statusIds = new Set(statusNodes.map((n) => n.id));
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    }
    for (const a of nodes.filter((n) => n.kind === 'ASSIGNMENT')) {
      expect(edges.some((e) => e.to === a.id && statusIds.has(e.from))).toBe(
        true,
      );
    }
  });

  it('returns 404 to users who cannot read the thesis', async () => {
    const thesis = await createAssignableThesis(app);
    const stranger = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.STUDENT] })).email,
    );
    await stranger.get(`/api/theses/${thesis.id}/graph`).expect(404);
    const coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
    await coordinator.get(`/api/theses/${thesis.id}/graph`).expect(200);
  });
});
