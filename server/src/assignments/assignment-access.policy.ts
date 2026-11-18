import { Role } from '@thesis/shared';
import type { Types } from 'mongoose';
import type { AuthUser } from '../common/types/auth-user';

/** The assigned juror; a scoped (external) session only for assignments in its scope. */
export function isAssignmentOwner(
  user: AuthUser,
  a: { id: string; jurorId: Types.ObjectId },
): boolean {
  if (!a.jurorId.equals(user.id)) return false;
  return !user.scope || user.scope.assignmentIds.includes(a.id);
}

export function canViewAssignment(
  user: AuthUser,
  a: { id: string; jurorId: Types.ObjectId },
): boolean {
  if (user.scope) return isAssignmentOwner(user, a);
  if (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.COORDINATOR))
    return true;
  return isAssignmentOwner(user, a);
}
