/** CU-02 verdicts; APPROVED/REJECTED only for the tiebreaker (RN-08). */
export enum EvaluationVerdict {
  APPROVED_FOR_DEFENSE = 'APPROVED_FOR_DEFENSE',
  APPROVED_WITH_CHANGES = 'APPROVED_WITH_CHANGES',
  REJECTED = 'REJECTED',
  APPROVED = 'APPROVED',
}

export const PRIMARY_VERDICTS = [
  EvaluationVerdict.APPROVED_FOR_DEFENSE,
  EvaluationVerdict.APPROVED_WITH_CHANGES,
  EvaluationVerdict.REJECTED,
] as const;

export const TIEBREAKER_VERDICTS = [
  EvaluationVerdict.APPROVED,
  EvaluationVerdict.REJECTED,
] as const;

export enum EvaluationStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
}

export enum StudentAccessType {
  VIEW = 'VIEW',
  DOWNLOAD = 'DOWNLOAD',
}
