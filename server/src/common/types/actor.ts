import { Role } from '@thesis/shared';
import { AuthUser } from './auth-user';

/** Who performed an action, as recorded in thesis history and audit. */
export interface Actor {
  id?: string;
  role: Role | 'SYSTEM';
}

export const SYSTEM_ACTOR: Actor = { role: 'SYSTEM' };

/** The role the user acted with: the first of `allowed` they hold (route's @Roles order). */
export function actorFrom(user: AuthUser, ...allowed: Role[]): Actor {
  const role = allowed.find((r) => user.roles.includes(r)) ?? user.roles[0];
  return { id: user.id, role };
}
