import { AssignmentStatus, AssignmentType } from '@thesis/shared';
import { Types } from 'mongoose';
import { addBusinessDays } from '../common/time/business-days';
import { toAssignmentView } from './assignment-view';

const NONE = new Set<string>();
const assignedAt = new Date('2026-11-18T17:00:00Z');
const base = {
  id: new Types.ObjectId().toHexString(),
  thesisId: new Types.ObjectId(),
  jurorId: new Types.ObjectId(),
  type: AssignmentType.PRIMARY,
  slot: 1,
  status: AssignmentStatus.PENDING,
  assignedAt,
  responseDeadline: addBusinessDays(assignedAt, 8, NONE),
};

describe('toAssignmentView (sugerencia 8 countdown)', () => {
  it('shows the response countdown while pending', () => {
    const now = new Date('2026-11-20T15:00:00Z');
    expect(toAssignmentView(base, now, NONE)).toMatchObject({
      id: base.id,
      thesisId: base.thesisId.toHexString(),
      jurorId: base.jurorId.toHexString(),
      daysSinceAssigned: 2,
      responseDaysRemaining: 6,
      evaluationDaysRemaining: null,
      isResponseOverdue: false,
      hasExternalLink: false,
    });
  });

  it('marks an overdue pending response', () => {
    const view = toAssignmentView(base, new Date('2026-12-02T15:00:00Z'), NONE);
    expect(view).toMatchObject({
      responseDaysRemaining: 0,
      isResponseOverdue: true,
    });
  });

  it('switches to the evaluation countdown once accepted', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    const view = toAssignmentView(
      {
        ...base,
        status: AssignmentStatus.ACCEPTED,
        respondedAt: now,
        evaluationDeadline: addBusinessDays(now, 20, NONE),
      },
      now,
      NONE,
    );
    expect(view).toMatchObject({
      responseDaysRemaining: null,
      evaluationDaysRemaining: 20,
      isResponseOverdue: false,
    });
  });

  it('reports a live external link only before it expires', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    expect(
      toAssignmentView(
        { ...base, externalTokenExpiresAt: new Date('2027-01-01') },
        now,
        NONE,
      ).hasExternalLink,
    ).toBe(true);
    expect(
      toAssignmentView(
        { ...base, externalTokenExpiresAt: new Date('2026-11-01') },
        now,
        NONE,
      ).hasExternalLink,
    ).toBe(false);
  });
});
