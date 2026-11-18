import { Role } from '@thesis/shared';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: Role[];
  /** Present only for external-juror sessions (stage 3). */
  scope?: { assignmentIds: string[] };
}

export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
  scope?: { assignmentIds: string[] };
}
