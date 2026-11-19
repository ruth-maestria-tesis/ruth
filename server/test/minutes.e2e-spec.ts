import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import {
  DefenseModality,
  DefenseStatus,
  ErrorCode,
  MinutesStatus,
  MinutesVerdict,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model } from 'mongoose';
import { FilesService } from '../src/files/files.service';
import { User } from '../src/users/schemas/user.schema';
import { WorkflowService } from '../src/workflow/workflow.service';
import { bogotaYear } from '../src/minutes/minutes.content';
import { Defense } from '../src/defenses/schemas/defense.schema';
import { MINUTES_SEALED } from '../src/minutes/minutes.events';
import { minutesHash } from '../src/minutes/minutes.content';
import { Minutes } from '../src/minutes/schemas/minutes.schema';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  binaryParser,
  closeTestApp,
  createReadyForDefenseThesis,
  createTestApp,
  createUser,
  DefenseFixture,
  loginAgent,
  TestAgent,
} from './utils/test-app';

describe('Minutes — CU-04 / RNF-04 (e2e)', () => {
  let app: INestApplication;
  let theses: Model<Thesis>;
  let defenses: Model<Defense>;
  let minutesModel: Model<Minutes>;
  let coordinator: TestAgent;
  let coordinatorId: string;

  beforeAll(async () => {
    app = await createTestApp();
    theses = app.get(getModelToken(Thesis.name));
    defenses = app.get(getModelToken(Defense.name));
    minutesModel = app.get(getModelToken(Minutes.name));
    const coord = await createUser(app, { roles: [Role.COORDINATOR] });
    coordinatorId = coord.id as string;
    coordinator = await loginAgent(app, coord.email);
  });
  afterAll(() => closeTestApp(app));

  /** READY_FOR_DEFENSE → defense proposed and confirmed by both jurors → DEFENSE_SCHEDULED. */
  async function scheduled(): Promise<DefenseFixture & { defenseId: string }> {
    const fx = await createReadyForDefenseThesis(app);
    const res = await coordinator
      .post(`/api/theses/${fx.thesis.id}/defense`)
      .send({
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        modality: DefenseModality.IN_PERSON,
        location: 'Auditorio 1',
      })
      .expect(201);
    const defenseId = res.body.id as string;
    for (const agent of fx.jurorAgents)
      await agent.post(`/api/defenses/${defenseId}/confirm`).expect(200);
    return { ...fx, defenseId };
  }

  const body = {
    finalGrade: 4.5,
    verdict: MinutesVerdict.APPROVED_MERITORIOUS,
    remarks: 'Excelente trabajo',
  };

  it('requires DEFENSE_SCHEDULED and a FAILED verdict below 3.0', async () => {
    const fx = await createReadyForDefenseThesis(app);
    const early = await coordinator
      .post(`/api/theses/${fx.thesis.id}/minutes`)
      .send(body)
      .expect(409);
    expect(early.body.code).toBe(ErrorCode.MINUTES_THESIS_STATUS);

    const { thesis } = await scheduled();
    const url = `/api/theses/${thesis.id}/minutes`;
    const low = await coordinator
      .post(url)
      .send({ ...body, finalGrade: 2.9, verdict: MinutesVerdict.APPROVED })
      .expect(400);
    expect(low.body.code).toBe(ErrorCode.MINUTES_INVALID_GRADE);
    await coordinator
      .post(url)
      .send({ ...body, finalGrade: 5.1 })
      .expect(400);
    const created = await coordinator
      .post(url)
      .send({ ...body, finalGrade: 2.5, verdict: MinutesVerdict.FAILED })
      .expect(201);
    expect(created.body).toMatchObject({
      status: MinutesStatus.DRAFT,
      verdict: MinutesVerdict.FAILED,
      pdfAvailable: false,
      signatures: [],
    });
    expect(created.body.number).toMatch(/^P[0-9A-F]{6}-\d{4}-001$/);
    const dup = await coordinator.post(url).send(body).expect(409);
    expect(dup.body.code).toBe(ErrorCode.MINUTES_EXISTS);
  });

  it('full flow: patch draft, sign in order, seal, PDF, immutable', async () => {
    const events = app.get(EventEmitter2);
    const sealedEvents: unknown[] = [];
    const onSealed = (e: unknown) => sealedEvents.push(e);
    events.on(MINUTES_SEALED, onSealed);

    const { thesis, defenseId, jurors, jurorAgents, studentAgent } =
      await scheduled();
    const created = await coordinator
      .post(`/api/theses/${thesis.id}/minutes`)
      .send(body)
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.defenseId).toBe(defenseId);
    expect((await defenses.findById(defenseId))?.status).toBe(
      DefenseStatus.HELD,
    );
    expect(created.body.requiredSigners).toEqual([
      { userId: jurors[0].id, name: 'Test User', role: Role.INTERNAL_JUROR },
      { userId: jurors[1].id, name: 'Test User', role: Role.INTERNAL_JUROR },
      { userId: coordinatorId, name: 'Test User', role: Role.COORDINATOR },
    ]);

    // PATCH while DRAFT recomputes the hash.
    const patched = await coordinator
      .patch(`/api/minutes/${id}`)
      .send({ finalGrade: 4.8, remarks: 'Trabajo sobresaliente' })
      .expect(200);
    expect(patched.body.contentHash).not.toBe(created.body.contentHash);
    const expectedHash = minutesHash({
      thesisId: thesis.id as string,
      number: created.body.number as string,
      finalGrade: 4.8,
      verdict: MinutesVerdict.APPROVED_MERITORIOUS,
      remarks: 'Trabajo sobresaliente',
    });
    expect(patched.body.contentHash).toBe(expectedHash);

    // The student reads but never writes.
    await studentAgent.get(`/api/minutes/${id}`).expect(200);
    await studentAgent.patch(`/api/minutes/${id}`).send(body).expect(403);
    await studentAgent.post(`/api/minutes/${id}/sign`).expect(403);

    // Coordinator first → 409; a non-signer → 403/404.
    const early = await coordinator.post(`/api/minutes/${id}/sign`).expect(409);
    expect(early.body.code).toBe(ErrorCode.MINUTES_SIGN_ORDER);
    const outsider = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).email,
    );
    await outsider.post(`/api/minutes/${id}/sign`).expect(404);
    const otherCoord = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
    const notSigner = await otherCoord
      .post(`/api/minutes/${id}/sign`)
      .expect(403);
    expect(notSigner.body.code).toBe(ErrorCode.MINUTES_NOT_SIGNER);

    const s1 = await jurorAgents[0]
      .post(`/api/minutes/${id}/sign`)
      .set('User-Agent', 'e2e-juror-1')
      .expect(200);
    expect(s1.body.signatures).toHaveLength(1);
    expect(s1.body.contentHash).toBe(expectedHash);
    const twice = await jurorAgents[0]
      .post(`/api/minutes/${id}/sign`)
      .expect(409);
    expect(twice.body.code).toBe(ErrorCode.MINUTES_SIGNED);
    const signedPatch = await coordinator
      .patch(`/api/minutes/${id}`)
      .send({ remarks: 'x' })
      .expect(409);
    expect(signedPatch.body.code).toBe(ErrorCode.MINUTES_SIGNED);
    await coordinator.post(`/api/minutes/${id}/sign`).expect(409);
    await jurorAgents[1].post(`/api/minutes/${id}/sign`).expect(200);
    const sealed = await coordinator
      .post(`/api/minutes/${id}/sign`)
      .expect(200);
    expect(sealed.body).toMatchObject({
      status: MinutesStatus.SEALED,
      pdfAvailable: true,
      contentHash: expectedHash,
    });
    expect(sealed.body.sealedAt).toEqual(expect.any(String));
    expect(sealed.body.signatures.map((s: { role: Role }) => s.role)).toEqual([
      Role.INTERNAL_JUROR,
      Role.INTERNAL_JUROR,
      Role.COORDINATOR,
    ]);
    const stored = await minutesModel.findById(id);
    expect(stored?.signatures[0]).toMatchObject({
      userAgent: 'e2e-juror-1',
      contentHash: expectedHash,
    });
    expect(stored?.signatures[0].ip).toEqual(expect.any(String));

    const t = await theses.findById(thesis._id);
    expect(t?.status).toBe(ThesisStatus.COMPLETED_APPROVED);
    expect(t?.progress).toBe(100);
    expect(sealedEvents).toEqual([
      expect.objectContaining({
        thesisId: thesis.id,
        minutesId: id,
        verdict: MinutesVerdict.APPROVED_MERITORIOUS,
      }),
    ]);
    events.off(MINUTES_SEALED, onSealed);

    // PDF for any thesis reader, including the student.
    const pdf = await studentAgent
      .get(`/api/minutes/${id}/pdf`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    );
    await outsider.get(`/api/minutes/${id}/pdf`).expect(404);

    // Sealed: every write is 409 MINUTES_SEALED; the hash never changes.
    for (const res of [
      await coordinator.patch(`/api/minutes/${id}`).send(body),
      await coordinator.post(`/api/minutes/${id}/sign`),
      await jurorAgents[0].post(`/api/minutes/${id}/sign`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.MINUTES_SEALED);
    }
    const again = await studentAgent
      .get(`/api/theses/${thesis.id}/minutes`)
      .expect(200);
    expect(again.body.contentHash).toBe(expectedHash);
  });

  it('a FAILED verdict seals into COMPLETED_FAILED; the PDF is 404 before sealing', async () => {
    const { thesis, jurorAgents } = await scheduled();
    const created = await coordinator
      .post(`/api/theses/${thesis.id}/minutes`)
      .send({ finalGrade: 2.0, verdict: MinutesVerdict.FAILED, remarks: '' })
      .expect(201);
    const id = created.body.id as string;
    await coordinator.get(`/api/minutes/${id}/pdf`).expect(404);
    for (const agent of jurorAgents)
      await agent.post(`/api/minutes/${id}/sign`).expect(200);
    await coordinator.post(`/api/minutes/${id}/sign`).expect(200);
    expect((await theses.findById(thesis._id))?.status).toBe(
      ThesisStatus.COMPLETED_FAILED,
    );
  });

  it('GET for a thesis without minutes is null; the number carries the current year', async () => {
    const a = await scheduled();
    expect(
      (
        await a.studentAgent
          .get(`/api/theses/${a.thesis.id}/minutes`)
          .expect(200)
      ).body,
    ).toBeNull();
    const first = await coordinator
      .post(`/api/theses/${a.thesis.id}/minutes`)
      .send(body)
      .expect(201);
    const seq = Number((first.body.number as string).split('-').at(-1));
    expect(seq).toBeGreaterThanOrEqual(1);
    expect(first.body.number).toContain(`-${bogotaYear()}-`);
  });

  /** All jurors signed; returns what the coordinator needs to sign last. */
  async function readyToSeal() {
    const fx = await scheduled();
    const created = await coordinator
      .post(`/api/theses/${fx.thesis.id}/minutes`)
      .send(body)
      .expect(201);
    const id = created.body.id as string;
    for (const agent of fx.jurorAgents)
      await agent.post(`/api/minutes/${id}/sign`).expect(200);
    return { ...fx, id };
  }

  it('retries sealing when the PDF step failed after the last signature', async () => {
    const { thesis, id } = await readyToSeal();
    const upload = jest
      .spyOn(app.get(FilesService), 'upload')
      .mockRejectedValueOnce(new Error('GridFS down'));
    await coordinator.post(`/api/minutes/${id}/sign`).expect(500);
    upload.mockRestore();
    const stuck = await minutesModel.findById(id);
    expect(stuck?.status).toBe(MinutesStatus.DRAFT);
    expect(stuck?.signatures).toHaveLength(3);

    const retried = await coordinator
      .post(`/api/minutes/${id}/sign`)
      .expect(200);
    expect(retried.body).toMatchObject({
      status: MinutesStatus.SEALED,
      pdfAvailable: true,
    });
    expect((await theses.findById(thesis._id))?.status).toBe(
      ThesisStatus.COMPLETED_APPROVED,
    );
  });

  it('retries only the thesis transition when sealed but the thesis is still DEFENSE_SCHEDULED', async () => {
    const events = app.get(EventEmitter2);
    const sealedEvents: unknown[] = [];
    const onSealed = (e: unknown) => sealedEvents.push(e);
    events.on(MINUTES_SEALED, onSealed);

    const { thesis, id, jurorAgents } = await readyToSeal();
    const transition = jest
      .spyOn(app.get(WorkflowService), 'transition')
      .mockRejectedValueOnce(new Error('transition failed'));
    await coordinator.post(`/api/minutes/${id}/sign`).expect(500);
    transition.mockRestore();
    const stuck = await minutesModel.findById(id);
    expect(stuck?.status).toBe(MinutesStatus.SEALED);
    expect(stuck?.pdfFileId).toBeDefined();
    const pdfId = stuck?.pdfFileId?.toHexString();
    expect((await theses.findById(thesis._id))?.status).toBe(
      ThesisStatus.DEFENSE_SCHEDULED,
    );
    expect(sealedEvents).toHaveLength(0);

    // A signer retries: no new PDF, the transition runs and the event fires once.
    const retried = await jurorAgents[0]
      .post(`/api/minutes/${id}/sign`)
      .expect(200);
    expect(retried.body.status).toBe(MinutesStatus.SEALED);
    expect((await minutesModel.findById(id))?.pdfFileId?.toHexString()).toBe(
      pdfId,
    );
    expect((await theses.findById(thesis._id))?.status).toBe(
      ThesisStatus.COMPLETED_APPROVED,
    );
    expect(sealedEvents).toHaveLength(1);

    // Fully done: further signs are 409 MINUTES_SEALED again.
    const after = await coordinator.post(`/api/minutes/${id}/sign`).expect(409);
    expect(after.body.code).toBe(ErrorCode.MINUTES_SEALED);
    events.off(MINUTES_SEALED, onSealed);
  });

  it('refuses to create minutes when a required signer account is missing', async () => {
    const { thesis, jurors } = await scheduled();
    await app
      .get<Model<User>>(getModelToken(User.name))
      .deleteOne({ _id: jurors[0]._id });
    const res = await coordinator
      .post(`/api/theses/${thesis.id}/minutes`)
      .send(body)
      .expect(500);
    expect(res.body.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(await minutesModel.exists({ thesisId: thesis._id })).toBeNull();
  });
});
