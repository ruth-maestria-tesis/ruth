import { Role } from '@thesis/shared';
import { Types } from 'mongoose';
import {
  canViewAssignment,
  isAssignmentOwner,
} from './assignment-access.policy';

describe('assignment access', () => {
  const jurorId = new Types.ObjectId();
  const a = { id: new Types.ObjectId().toHexString(), jurorId };
  const juror = {
    id: jurorId.toHexString(),
    email: 'j@x.co',
    roles: [Role.INTERNAL_JUROR],
  };

  it('the assigned juror owns it; others do not', () => {
    expect(isAssignmentOwner(juror, a)).toBe(true);
    expect(
      isAssignmentOwner(
        { ...juror, id: new Types.ObjectId().toHexString() },
        a,
      ),
    ).toBe(false);
  });

  it('a scoped session owns only assignments in its scope', () => {
    expect(
      isAssignmentOwner({ ...juror, scope: { assignmentIds: [a.id] } }, a),
    ).toBe(true);
    expect(
      isAssignmentOwner({ ...juror, scope: { assignmentIds: ['other'] } }, a),
    ).toBe(false);
  });

  it('coordinators and admins can view any assignment', () => {
    const coordinator = {
      id: 'c',
      email: 'c@x.co',
      roles: [Role.COORDINATOR],
    };
    expect(canViewAssignment(coordinator, a)).toBe(true);
    expect(canViewAssignment({ ...coordinator, roles: [Role.ADMIN] }, a)).toBe(
      true,
    );
    expect(
      canViewAssignment({ ...coordinator, roles: [Role.STUDENT] }, a),
    ).toBe(false);
  });
});
