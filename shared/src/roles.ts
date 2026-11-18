export enum Role {
  ADMIN = 'ADMIN',
  COORDINATOR = 'COORDINATOR',
  INTERNAL_JUROR = 'INTERNAL_JUROR',
  EXTERNAL_JUROR = 'EXTERNAL_JUROR',
  STUDENT = 'STUDENT',
}

export const JUROR_ROLES: readonly Role[] = [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR];

/** External jurors authenticate only with the RF-J14 token, never with a password. */
export const isExternalOnly = (roles: readonly Role[]): boolean =>
  roles.length > 0 && roles.every((r) => r === Role.EXTERNAL_JUROR);
