import { AssignmentStatus, Role } from '@thesis/shared';
import { Types } from 'mongoose';
import {
  canReadThesis,
  canWriteThesis,
  jurorAccessLevel,
} from './thesis-access.policy';

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

describe('canWriteThesis', () => {
  const studentId = new Types.ObjectId();
  const thesis = { studentId };
  const user = (roles: Role[], id = new Types.ObjectId().toHexString()) => ({
    id,
    email: 'x@y.co',
    roles,
  });

  it('coordinators write every thesis', () => {
    expect(canWriteThesis(user([Role.COORDINATOR]), thesis)).toBe(true);
  });

  it('a student writes only their own thesis', () => {
    expect(
      canWriteThesis(user([Role.STUDENT], studentId.toHexString()), thesis),
    ).toBe(true);
    expect(canWriteThesis(user([Role.STUDENT]), thesis)).toBe(false);
  });

  it('admin alone is read-only, jurors cannot write', () => {
    expect(canWriteThesis(user([Role.ADMIN]), thesis)).toBe(false);
    expect(canWriteThesis(user([Role.INTERNAL_JUROR]), thesis)).toBe(false);
  });

  it('an admin+student who does not own the thesis cannot write', () => {
    expect(canWriteThesis(user([Role.ADMIN, Role.STUDENT]), thesis)).toBe(
      false,
    );
  });
});

describe('jurorAccessLevel', () => {
  it('pending gives metadata, accepted gives the manuscript, others nothing', () => {
    expect(jurorAccessLevel([])).toBe('NONE');
    expect(
      jurorAccessLevel([AssignmentStatus.DECLINED, AssignmentStatus.REPLACED]),
    ).toBe('NONE');
    expect(jurorAccessLevel([AssignmentStatus.PENDING])).toBe('METADATA');
    expect(
      jurorAccessLevel([AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED]),
    ).toBe('MANUSCRIPT');
  });
});
