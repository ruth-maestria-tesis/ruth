import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import {
  DefenseModality,
  DefenseStatus,
  ErrorCode,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model } from 'mongoose';
import { DEFENSE_EVENTS } from '../src/defenses/defense.events';
import { WorkflowService } from '../src/workflow/workflow.service';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  closeTestApp,
  createAssignableThesis,
  createReadyForDefenseThesis,
  createTestApp,
  createUser,
  loginAgent,
  TestAgent,
} from './utils/test-app';

const future = (days = 7) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const inPerson = () => ({
  scheduledAt: future(),
  modality: DefenseModality.IN_PERSON,
  location: 'Auditorio 2',
});

describe('Defenses — CU-03 (e2e)', () => {
  let app: INestApplication;
  let theses: Model<Thesis>;
  let coordinator: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    theses = app.get(getModelToken(Thesis.name));
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
  });
  afterAll(() => closeTestApp(app));

  const status = async (id: unknown) => (await theses.findById(id))?.status;

  it('requires a READY_FOR_DEFENSE thesis (409 DEFENSE_THESIS_STATUS)', async () => {
    const thesis = await createAssignableThesis(app);
    const res = await coordinator
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(409);
    expect(res.body.code).toBe(ErrorCode.DEFENSE_THESIS_STATUS);
  });

  it('validates the modality fields and the future date', async () => {
    const { thesis } = await createReadyForDefenseThesis(app);
    const url = `/api/theses/${thesis.id}/defense`;
    const bad = [
      { scheduledAt: future(), modality: DefenseModality.IN_PERSON },
      { scheduledAt: future(), modality: DefenseModality.VIRTUAL },
      {
        scheduledAt: future(),
        modality: DefenseModality.HYBRID,
        meetingUrl: 'https://meet.example.org/x',
      },
      { ...inPerson(), scheduledAt: future(-1) },
      { ...inPerson(), modality: 'ONLINE' },
    ];
    for (const body of bad) {
      const res = await coordinator.post(url).send(body).expect(400);
      expect(res.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
    const ok = await coordinator
      .post(url)
      .send({
        scheduledAt: future(),
        modality: DefenseModality.VIRTUAL,
        meetingUrl: 'https://meet.example.org/abc',
        location: 'ignored for virtual',
      })
      .expect(201);
    expect(ok.body).toMatchObject({
      status: DefenseStatus.PROPOSED,
      modality: DefenseModality.VIRTUAL,
      meetingUrl: 'https://meet.example.org/abc',
    });
    expect(ok.body.location).toBeUndefined();
    const dup = await coordinator.post(url).send(inPerson()).expect(409);
    expect(dup.body.code).toBe(ErrorCode.DEFENSE_EXISTS);
  });

  it('every active juror confirming → CONFIRMED and thesis DEFENSE_SCHEDULED', async () => {
    const events = app.get(EventEmitter2);
    const seen: string[] = [];
    const listener = (name: string | string[]) => seen.push(String(name));
    events.onAny(listener);
    const { thesis, jurors, jurorAgents, studentAgent } =
      await createReadyForDefenseThesis(app);
    const created = await coordinator
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.thesis).toMatchObject({
      id: thesis.id,
      code: thesis.code,
      title: thesis.title,
    });
    expect(created.body.jurors).toEqual(
      jurors.map((j) => ({ userId: j.id, name: 'Test User' })),
    );

    const r1 = await jurorAgents[0]
      .post(`/api/defenses/${id}/confirm`)
      .expect(200);
    expect(r1.body.status).toBe(DefenseStatus.PROPOSED);
    expect(r1.body.jurors[0].confirmedAt).toEqual(expect.any(String));
    // Idempotent re-confirmation.
    await jurorAgents[0].post(`/api/defenses/${id}/confirm`).expect(200);
    expect(await status(thesis._id)).toBe(ThesisStatus.READY_FOR_DEFENSE);

    const r2 = await jurorAgents[1]
      .post(`/api/defenses/${id}/confirm`)
      .expect(200);
    expect(r2.body.status).toBe(DefenseStatus.CONFIRMED);
    expect(await status(thesis._id)).toBe(ThesisStatus.DEFENSE_SCHEDULED);
    events.offAny(listener);
    expect(seen).toEqual(
      expect.arrayContaining([
        DEFENSE_EVENTS.PROPOSED,
        DEFENSE_EVENTS.CONFIRMED,
      ]),
    );

    // The student reads it; juror lists only show their own defenses.
    const mine = await studentAgent
      .get(`/api/theses/${thesis.id}/defense`)
      .expect(200);
    expect(mine.body).toMatchObject({ id, status: DefenseStatus.CONFIRMED });
    const jurorList = await jurorAgents[0].get('/api/defenses').expect(200);
    expect(jurorList.body.items.map((d: { id: string }) => d.id)).toEqual([id]);
    const all = await coordinator
      .get(`/api/defenses?status=${DefenseStatus.CONFIRMED}`)
      .expect(200);
    expect(all.body.items.map((d: { id: string }) => d.id)).toContain(id);

    // No edits or cancellation once confirmed.
    const edit = await coordinator
      .patch(`/api/defenses/${id}`)
      .send({ location: 'Sala 3' })
      .expect(409);
    expect(edit.body.code).toBe(ErrorCode.DEFENSE_NOT_EDITABLE);
    await coordinator.post(`/api/defenses/${id}/cancel`).expect(409);
  });

  it('rejects confirmations from non-jurors and from the coordinator', async () => {
    const { thesis } = await createReadyForDefenseThesis(app);
    const created = await coordinator
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(201);
    const id = created.body.id as string;
    const outsider = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).email,
    );
    const res = await outsider.post(`/api/defenses/${id}/confirm`).expect(404);
    expect(res.body.code).toBe(ErrorCode.DEFENSE_NOT_FOUND);
    await coordinator.post(`/api/defenses/${id}/confirm`).expect(403);
    await outsider.get(`/api/theses/${thesis.id}/defense`).expect(404);
    expect(
      (await outsider.get('/api/defenses').expect(200)).body.items,
    ).toEqual([]);
  });

  it('editing clears the confirmations; cancel frees the thesis for a new proposal', async () => {
    const { thesis, jurorAgents, studentAgent } =
      await createReadyForDefenseThesis(app);
    const created = await coordinator
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(201);
    const id = created.body.id as string;
    await jurorAgents[0].post(`/api/defenses/${id}/confirm`).expect(200);

    const edited = await coordinator
      .patch(`/api/defenses/${id}`)
      .send({
        modality: DefenseModality.HYBRID,
        meetingUrl: 'https://meet.example.org/h',
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      modality: DefenseModality.HYBRID,
      location: 'Auditorio 2',
      meetingUrl: 'https://meet.example.org/h',
    });
    expect(
      edited.body.jurors.every(
        (j: { confirmedAt?: string }) => j.confirmedAt === undefined,
      ),
    ).toBe(true);
    await coordinator
      .patch(`/api/defenses/${id}`)
      .send({ modality: DefenseModality.VIRTUAL, meetingUrl: '' })
      .expect(400);

    // The student reads but cannot write.
    await studentAgent.post(`/api/defenses/${id}/cancel`).expect(403);
    await studentAgent
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(403);

    const cancelled = await coordinator
      .post(`/api/defenses/${id}/cancel`)
      .expect(200);
    expect(cancelled.body.status).toBe(DefenseStatus.CANCELLED);
    await jurorAgents[1].post(`/api/defenses/${id}/confirm`).expect(409);
    expect(
      (await studentAgent.get(`/api/theses/${thesis.id}/defense`).expect(200))
        .body,
    ).toBeNull();
    await coordinator
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(201);
  });

  it('retries the thesis transition when a confirmed defense left the thesis READY_FOR_DEFENSE', async () => {
    const events = app.get(EventEmitter2);
    const confirmed: unknown[] = [];
    const onConfirmed = (e: unknown) => confirmed.push(e);
    events.on(DEFENSE_EVENTS.CONFIRMED, onConfirmed);
    const { thesis, jurorAgents } = await createReadyForDefenseThesis(app);
    const created = await coordinator
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(201);
    const id = created.body.id as string;
    await jurorAgents[0].post(`/api/defenses/${id}/confirm`).expect(200);

    const transition = jest
      .spyOn(app.get(WorkflowService), 'transition')
      .mockRejectedValueOnce(new Error('transition failed'));
    await jurorAgents[1].post(`/api/defenses/${id}/confirm`).expect(500);
    transition.mockRestore();
    expect(await status(thesis._id)).toBe(ThesisStatus.READY_FOR_DEFENSE);
    expect(confirmed).toHaveLength(0);

    // The coordinator is not a juror, so cannot retry.
    await coordinator.post(`/api/defenses/${id}/confirm`).expect(403);
    const retried = await jurorAgents[0]
      .post(`/api/defenses/${id}/confirm`)
      .expect(200);
    expect(retried.body.status).toBe(DefenseStatus.CONFIRMED);
    expect(await status(thesis._id)).toBe(ThesisStatus.DEFENSE_SCHEDULED);
    expect(confirmed).toHaveLength(1);
    // Once the thesis moved on, confirming again is a plain conflict.
    await jurorAgents[0].post(`/api/defenses/${id}/confirm`).expect(409);
    events.off(DEFENSE_EVENTS.CONFIRMED, onConfirmed);
  });

  it('emits defense.updated after a PATCH and defense.cancelled after a cancel', async () => {
    const events = app.get(EventEmitter2);
    const seen: { name: string; payload: unknown }[] = [];
    const listener = (name: string | string[], payload: unknown) =>
      seen.push({ name: String(name), payload });
    events.onAny(listener);
    const { thesis } = await createReadyForDefenseThesis(app);
    const created = await coordinator
      .post(`/api/theses/${thesis.id}/defense`)
      .send(inPerson())
      .expect(201);
    const id = created.body.id as string;
    await coordinator
      .patch(`/api/defenses/${id}`)
      .send({ location: 'Sala 9' })
      .expect(200);
    await coordinator.post(`/api/defenses/${id}/cancel`).expect(200);
    events.offAny(listener);
    const byName = (n: string) => seen.filter((e) => e.name === n);
    expect(byName(DEFENSE_EVENTS.UPDATED)).toEqual([
      {
        name: 'defense.updated',
        payload: expect.objectContaining({
          thesisId: thesis.id,
          defenseId: id,
          actor: expect.objectContaining({ role: Role.COORDINATOR }),
        }),
      },
    ]);
    expect(byName(DEFENSE_EVENTS.CANCELLED)).toHaveLength(1);
  });
});
