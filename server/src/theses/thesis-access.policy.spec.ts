import { Role } from '@thesis/shared';
import { Types } from 'mongoose';
import { canReadThesis } from './thesis-access.policy';

describe('canReadThesis', () => {
  const studentId = new Types.ObjectId();
  const thesis = { studentId };
  const user = (roles: Role[], id = new Types.ObjectId().toHexString()) => ({
    id,
    email: 'x@y.co',
    roles,
  });

  it('admins and coordinators read every thesis', () => {
    expect(canReadThesis(user([Role.ADMIN]), thesis)).toBe(true);
    expect(canReadThesis(user([Role.COORDINATOR]), thesis)).toBe(true);
  });

  it('a student reads only their own thesis', () => {
    expect(
      canReadThesis(user([Role.STUDENT], studentId.toHexString()), thesis),
    ).toBe(true);
    expect(canReadThesis(user([Role.STUDENT]), thesis)).toBe(false);
  });

  it('jurors have no access until assignments exist (stage 3)', () => {
    expect(canReadThesis(user([Role.INTERNAL_JUROR]), thesis)).toBe(false);
  });
});
