import { Role } from '@thesis/shared';
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
