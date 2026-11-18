export enum ThesisStatus {
  SUBMITTED = 'SUBMITTED',
  JURORS_ASSIGNED = 'JURORS_ASSIGNED',
  PENDING_JUROR_REPLACEMENT = 'PENDING_JUROR_REPLACEMENT',
  UNDER_EVALUATION = 'UNDER_EVALUATION',
  IN_DISPUTE = 'IN_DISPUTE',
  REVISIONS_IN_PROGRESS = 'REVISIONS_IN_PROGRESS',
  READY_FOR_DEFENSE = 'READY_FOR_DEFENSE',
  DEFENSE_SCHEDULED = 'DEFENSE_SCHEDULED',
  NOT_APPROVED = 'NOT_APPROVED',
  COMPLETED_APPROVED = 'COMPLETED_APPROVED',
  COMPLETED_FAILED = 'COMPLETED_FAILED',
}

/** RF-P02 / RF-P03 — progress percentage per status (spec §4). */
export const THESIS_PROGRESS: Readonly<Record<ThesisStatus, number>> = {
  [ThesisStatus.SUBMITTED]: 10,
  [ThesisStatus.JURORS_ASSIGNED]: 25,
  [ThesisStatus.PENDING_JUROR_REPLACEMENT]: 25,
  [ThesisStatus.UNDER_EVALUATION]: 45,
  [ThesisStatus.IN_DISPUTE]: 50,
  [ThesisStatus.REVISIONS_IN_PROGRESS]: 60,
  [ThesisStatus.READY_FOR_DEFENSE]: 75,
  [ThesisStatus.DEFENSE_SCHEDULED]: 85,
  [ThesisStatus.NOT_APPROVED]: 100,
  [ThesisStatus.COMPLETED_APPROVED]: 100,
  [ThesisStatus.COMPLETED_FAILED]: 100,
};

/** Allowed transitions (spec §4). Terminal statuses map to an empty list. */
export const THESIS_TRANSITIONS: Readonly<
  Record<ThesisStatus, readonly ThesisStatus[]>
> = {
  [ThesisStatus.SUBMITTED]: [ThesisStatus.JURORS_ASSIGNED],
  [ThesisStatus.JURORS_ASSIGNED]: [
    ThesisStatus.UNDER_EVALUATION,
    ThesisStatus.PENDING_JUROR_REPLACEMENT,
  ],
  [ThesisStatus.PENDING_JUROR_REPLACEMENT]: [
    ThesisStatus.JURORS_ASSIGNED,
    ThesisStatus.UNDER_EVALUATION,
  ],
  [ThesisStatus.UNDER_EVALUATION]: [
    ThesisStatus.REVISIONS_IN_PROGRESS,
    ThesisStatus.READY_FOR_DEFENSE,
    ThesisStatus.IN_DISPUTE,
    ThesisStatus.NOT_APPROVED,
  ],
  [ThesisStatus.IN_DISPUTE]: [
    ThesisStatus.REVISIONS_IN_PROGRESS,
    ThesisStatus.READY_FOR_DEFENSE,
    ThesisStatus.NOT_APPROVED,
  ],
  [ThesisStatus.REVISIONS_IN_PROGRESS]: [ThesisStatus.READY_FOR_DEFENSE],
  [ThesisStatus.READY_FOR_DEFENSE]: [ThesisStatus.DEFENSE_SCHEDULED],
  [ThesisStatus.DEFENSE_SCHEDULED]: [
    ThesisStatus.COMPLETED_APPROVED,
    ThesisStatus.COMPLETED_FAILED,
  ],
  [ThesisStatus.NOT_APPROVED]: [],
  [ThesisStatus.COMPLETED_APPROVED]: [],
  [ThesisStatus.COMPLETED_FAILED]: [],
};

export const TERMINAL_THESIS_STATUSES: readonly ThesisStatus[] = (
  Object.keys(THESIS_TRANSITIONS) as ThesisStatus[]
).filter((s) => THESIS_TRANSITIONS[s].length === 0);
