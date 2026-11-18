import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Role, ThesisStatus as S } from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { Thesis } from '../src/theses/schemas/thesis.schema';
import {
  THESIS_STATUS_CHANGED,
  ThesisStatusChangedEvent,
} from '../src/workflow/workflow.events';
import { WorkflowService } from '../src/workflow/workflow.service';
import { closeTestApp, createTestApp } from './utils/test-app';

describe('WorkflowService (e2e)', () => {
  let app: INestApplication;
  let workflow: WorkflowService;
  let theses: Model<Thesis>;
  const actor = {
    id: new Types.ObjectId().toHexString(),
    role: Role.COORDINATOR,
  };

  beforeAll(async () => {
    app = await createTestApp();
    workflow = app.get(WorkflowService);
    theses = app.get(getModelToken(Thesis.name));
  });
  afterAll(() => closeTestApp(app));

  const insertThesis = (status: S) =>
    theses.create({
      code: `WF-${new Types.ObjectId().toHexString()}`,
      title: 'Tesis de prueba',
      studentId: new Types.ObjectId(),
      studentName: 'Laura Pérez',
      advisorId: new Types.ObjectId(),
      programId: new Types.ObjectId(),
      cohortId: new Types.ObjectId(),
      periodId: new Types.ObjectId(),
      status,
      progress: 10,
    });

  it('applies an allowed transition, sets progress and appends history', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const updated = await workflow.transition({
      thesisId: t.id as string,
      to: S.JURORS_ASSIGNED,
      actor,
      reason: 'CU-01',
    });
    expect(updated.status).toBe(S.JURORS_ASSIGNED);
    expect(updated.progress).toBe(25);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]).toMatchObject({
      from: S.SUBMITTED,
      to: S.JURORS_ASSIGNED,
      actorRole: Role.COORDINATOR,
      reason: 'CU-01',
    });
    expect(updated.history[0].actorId?.toHexString()).toBe(actor.id);
  });

  it('emits thesis.status.changed', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const events: ThesisStatusChangedEvent[] = [];
    const emitter = app.get(EventEmitter2);
    const listener = (e: ThesisStatusChangedEvent) => events.push(e);
    emitter.on(THESIS_STATUS_CHANGED, listener);
    const evidence = new Types.ObjectId().toHexString();
    await workflow.transition({
      thesisId: t.id as string,
      to: S.JURORS_ASSIGNED,
      actor,
      evidenceFileIds: [evidence],
    });
    emitter.off(THESIS_STATUS_CHANGED, listener);
    expect(events).toEqual([
      expect.objectContaining({
        thesisId: t.id,
        from: S.SUBMITTED,
        to: S.JURORS_ASSIGNED,
        actorRole: Role.COORDINATOR,
        evidenceFileIds: [evidence],
      }),
    ]);
  });

  it('rejects a transition not in the table with WORKFLOW_INVALID_TRANSITION', async () => {
    const t = await insertThesis(S.SUBMITTED);
    await expect(
      workflow.transition({
        thesisId: t.id as string,
        to: S.READY_FOR_DEFENSE,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID_TRANSITION' });
    expect((await theses.findById(t.id))?.status).toBe(S.SUBMITTED);
  });

  it('rejects when the current status is not one of expectedFrom', async () => {
    const t = await insertThesis(S.JURORS_ASSIGNED);
    await expect(
      workflow.transition({
        thesisId: t.id as string,
        expectedFrom: [S.PENDING_JUROR_REPLACEMENT],
        to: S.UNDER_EVALUATION,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID_TRANSITION' });
  });

  it('accepts expectedFrom when the current status is in the list', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const updated = await workflow.transition({
      thesisId: t.id as string,
      expectedFrom: [S.SUBMITTED, S.PENDING_JUROR_REPLACEMENT],
      to: S.JURORS_ASSIGNED,
      actor,
    });
    expect(updated.status).toBe(S.JURORS_ASSIGNED);
  });

  it('records a SYSTEM actor without actorId', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const updated = await workflow.transition({
      thesisId: t.id as string,
      to: S.JURORS_ASSIGNED,
      actor: { role: 'SYSTEM' },
    });
    expect(updated.history[0].actorId).toBeUndefined();
    expect(updated.history[0].actorRole).toBe('SYSTEM');
  });

  it('persists evidenceFileIds in the history entry', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const fileId = new Types.ObjectId().toHexString();
    const updated = await workflow.transition({
      thesisId: t.id as string,
      to: S.JURORS_ASSIGNED,
      actor,
      evidenceFileIds: [fileId],
    });
    expect(
      updated.history[0].evidenceFileIds.map((i) => i.toHexString()),
    ).toEqual([fileId]);
  });

  it('rejects an invalid evidence id with VALIDATION_FAILED and leaves the thesis untouched', async () => {
    const t = await insertThesis(S.SUBMITTED);
    await expect(
      workflow.transition({
        thesisId: t.id as string,
        to: S.JURORS_ASSIGNED,
        actor,
        evidenceFileIds: ['not-an-id'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await theses.findById(t.id))?.status).toBe(S.SUBMITTED);
  });

  it('rejects an invalid actor id with VALIDATION_FAILED before touching the DB', async () => {
    const t = await insertThesis(S.SUBMITTED);
    await expect(
      workflow.transition({
        thesisId: t.id as string,
        to: S.JURORS_ASSIGNED,
        actor: { id: 'bad', role: Role.COORDINATOR },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await theses.findById(t.id))?.status).toBe(S.SUBMITTED);
  });

  it('rejects any transition out of a terminal status', async () => {
    const t = await insertThesis(S.NOT_APPROVED);
    await expect(
      workflow.transition({ thesisId: t.id as string, to: S.SUBMITTED, actor }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID_TRANSITION' });
  });

  it('only one of two concurrent identical transitions wins', async () => {
    const t = await insertThesis(S.SUBMITTED);
    const results = await Promise.allSettled([
      workflow.transition({
        thesisId: t.id as string,
        to: S.JURORS_ASSIGNED,
        actor,
      }),
      workflow.transition({
        thesisId: t.id as string,
        to: S.JURORS_ASSIGNED,
        actor,
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({
      code: expect.stringMatching(
        /WORKFLOW_STATUS_CONFLICT|WORKFLOW_INVALID_TRANSITION/,
      ),
    });
    expect((await theses.findById(t.id))?.history).toHaveLength(1);
  });

  it('unknown thesis → THESIS_NOT_FOUND', async () => {
    await expect(
      workflow.transition({
        thesisId: new Types.ObjectId().toHexString(),
        to: S.JURORS_ASSIGNED,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'THESIS_NOT_FOUND' });
  });
});
