import { AssignmentStatus, Role } from '@thesis/shared';
import type { Types } from 'mongoose';
import type { AuthUser } from '../common/types/auth-user';

/**
 * Read access to a thesis and its manuscripts (RBAC matrix).
 * Stage 3 extends this with "juror with an ACCEPTED assignment".
 */
export function canReadThesis(
  user: AuthUser,
  thesis: { studentId: Types.ObjectId },
): boolean {
  if (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.COORDINATOR))
    return true;
  return user.roles.includes(Role.STUDENT) && thesis.studentId.equals(user.id);
}

/**
 * Write access (manuscript upload): coordinators and the owner student.
 * ADMIN alone is read-only, even if combined with another role.
 */
export function canWriteThesis(
  user: AuthUser,
  thesis: { studentId: Types.ObjectId },
): boolean {
  if (user.roles.includes(Role.COORDINATOR)) return true;
  return user.roles.includes(Role.STUDENT) && thesis.studentId.equals(user.id);
}

export type JurorAccess = 'NONE' | 'METADATA' | 'MANUSCRIPT';

/** RBAC: a juror sees the thesis once assigned and the manuscript only after accepting. */
export function jurorAccessLevel(
  statuses: readonly AssignmentStatus[],
): JurorAccess {
  if (statuses.includes(AssignmentStatus.ACCEPTED)) return 'MANUSCRIPT';
  return statuses.includes(AssignmentStatus.PENDING) ? 'METADATA' : 'NONE';
}
