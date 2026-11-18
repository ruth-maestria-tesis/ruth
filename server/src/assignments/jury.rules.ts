import { JUROR_ROLES, JuryViolation, Role } from '@thesis/shared';

export interface CandidateUser {
  isActive: boolean;
  roles: readonly Role[];
  isUnicordoba: boolean;
}

export interface JurorCandidate {
  slot: number;
  /** Lowercase user id, or `new:<email>` for a juror created inline. */
  key: string;
  userId?: string;
  /** Undefined when userId does not exist. */
  user?: CandidateUser;
  newExternal?: { emailTaken: boolean };
  /** Already on the jury (kept during a replacement): only composition rules apply. */
  keep?: boolean;
}

export interface ThesisParties {
  studentId: string;
  advisorId: string;
  coAdvisorIds: readonly string[];
  conflictOfInterestUserIds: readonly string[];
}

export interface JuryViolationItem {
  code: JuryViolation;
  slot?: number;
}

export interface JuryCheck {
  candidates: readonly JurorCandidate[];
  parties: ThesisParties;
  /** Every juror ever assigned to this thesis (declined, expired, replaced included). */
  previousJurorIds: ReadonlySet<string>;
  required: number;
  /** RF-C13 applies once the 2-juror jury is complete. */
  requireUnicordoba: boolean;
}

export function validateJury(check: JuryCheck): JuryViolationItem[] {
  const { candidates, parties, previousJurorIds, required, requireUnicordoba } =
    check;
  const violations: JuryViolationItem[] = [];
  if (candidates.length !== required)
    violations.push({ code: JuryViolation.JUROR_COUNT });

  const conflicted = new Set([
    parties.studentId,
    parties.advisorId,
    ...parties.coAdvisorIds,
    ...parties.conflictOfInterestUserIds,
  ]);
  const seen = new Set<string>();
  for (const c of candidates) {
    const flag = (code: JuryViolation) =>
      violations.push({ code, slot: c.slot });
    if (seen.has(c.key)) {
      flag(JuryViolation.JUROR_DUPLICATE);
      continue;
    }
    seen.add(c.key);
    if (c.keep) continue;
    if (c.newExternal) {
      if (c.newExternal.emailTaken) flag(JuryViolation.JUROR_EMAIL_TAKEN);
      continue;
    }
    if (!c.user || !c.userId) {
      flag(JuryViolation.JUROR_NOT_FOUND);
      continue;
    }
    if (!c.user.isActive) flag(JuryViolation.JUROR_INACTIVE);
    if (!c.user.roles.some((r) => JUROR_ROLES.includes(r)))
      flag(JuryViolation.JUROR_NOT_FACULTY);
    if (conflicted.has(c.userId))
      flag(JuryViolation.JUROR_CONFLICT_OF_INTEREST);
    if (previousJurorIds.has(c.userId))
      flag(JuryViolation.JUROR_PREVIOUSLY_ASSIGNED);
  }

  const hasUnicordoba = candidates.some(
    (c) => !c.newExternal && c.user?.isUnicordoba,
  );
  if (requireUnicordoba && candidates.length === required && !hasUnicordoba) {
    violations.push({ code: JuryViolation.JUROR_UNICORDOBA_REQUIRED });
  }
  return violations;
}
