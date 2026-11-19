import { Role, ThesisStatus } from '@thesis/shared';
import { model, Types } from 'mongoose';
import { ThesisDocument, ThesisSchema } from './schemas/thesis.schema';
import { isStaff, toThesisView } from './thesis-view';

const ThesisModel = model('ThesisViewSpec', ThesisSchema);

function thesis(): ThesisDocument {
  const fileId = new Types.ObjectId();
  return new ThesisModel({
    code: 'T-1',
    title: 'Tesis',
    studentId: new Types.ObjectId(),
    studentName: 'Ana Pérez',
    advisorId: new Types.ObjectId(),
    programId: new Types.ObjectId(),
    cohortId: new Types.ObjectId(),
    periodId: new Types.ObjectId(),
    progress: 10,
    manuscripts: [
      {
        fileId,
        version: 1,
        fileName: 'tesis.pdf',
        uploadedAt: new Date(),
        uploadedBy: new Types.ObjectId(),
      },
    ],
    currentManuscriptId: fileId,
    conflictOfInterestUserIds: [new Types.ObjectId()],
    seedTag: 'demo',
    history: [
      {
        from: null,
        to: ThesisStatus.SUBMITTED,
        at: new Date(),
        actorId: new Types.ObjectId(),
        actorRole: Role.COORDINATOR,
        reason: 'Radicación',
        evidenceFileIds: [new Types.ObjectId()],
      },
    ],
  });
}

describe('toThesisView', () => {
  it('gives staff the whole document', () => {
    const view = toThesisView(thesis(), { kind: 'STAFF' });
    expect(view.conflictOfInterestUserIds).toHaveLength(1);
    expect(view.seedTag).toBe('demo');
    expect((view.history as object[])[0]).toHaveProperty('actorId');
  });

  it('strips staff-only fields and history ids for students', () => {
    const view = toThesisView(thesis(), { kind: 'STUDENT' });
    expect(view).not.toHaveProperty('conflictOfInterestUserIds');
    expect(view).not.toHaveProperty('seedTag');
    expect(view.advisorId).toBeDefined();
    const [entry] = view.history as Record<string, unknown>[];
    expect(Object.keys(entry).sort()).toEqual([
      'actorRole',
      'at',
      'from',
      'reason',
      'to',
    ]);
    expect(entry).toMatchObject({
      from: null,
      to: ThesisStatus.SUBMITTED,
      actorRole: Role.COORDINATOR,
      reason: 'Radicación',
    });
    expect(view.manuscripts).toHaveLength(1);
  });

  it('shows manuscripts to jurors only with MANUSCRIPT access', () => {
    const pending = toThesisView(thesis(), {
      kind: 'JUROR',
      access: 'METADATA',
    });
    expect(pending.manuscripts).toEqual([]);
    expect(pending).not.toHaveProperty('currentManuscriptId');
    const accepted = toThesisView(thesis(), {
      kind: 'JUROR',
      access: 'MANUSCRIPT',
    });
    expect(accepted.manuscripts).toHaveLength(1);
    expect(accepted).not.toHaveProperty('conflictOfInterestUserIds');
  });
});

describe('isStaff', () => {
  const base = { id: 'u', email: 'a@b.co' };
  it('is true only for unscoped ADMIN/COORDINATOR sessions', () => {
    expect(isStaff({ ...base, roles: [Role.COORDINATOR] })).toBe(true);
    expect(isStaff({ ...base, roles: [Role.ADMIN] })).toBe(true);
    expect(isStaff({ ...base, roles: [Role.STUDENT] })).toBe(false);
    expect(
      isStaff({
        ...base,
        roles: [Role.COORDINATOR],
        scope: { assignmentIds: ['a'] },
      }),
    ).toBe(false);
  });
});
