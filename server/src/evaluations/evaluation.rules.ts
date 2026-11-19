import {
  AssignmentType,
  EvaluationVerdict,
  PRIMARY_VERDICTS,
  ThesisStatus,
  TIEBREAKER_VERDICTS,
} from '@thesis/shared';

export const MIN_COMMENT_LENGTH = 20;

export interface RubricLike {
  methodology?: number;
  relevance?: number;
  writingQuality?: number;
}

export const isRubricComplete = (r?: RubricLike): boolean =>
  !!r &&
  r.methodology !== undefined &&
  r.relevance !== undefined &&
  r.writingQuality !== undefined;

/** Average of the three criteria, two decimals; null while incomplete. */
export const rubricScore = (r?: RubricLike): number | null =>
  isRubricComplete(r)
    ? Math.round(
        ((r!.methodology! + r!.relevance! + r!.writingQuality!) / 3) * 100,
      ) / 100
    : null;

export const verdictsFor = (
  type: AssignmentType,
): readonly EvaluationVerdict[] =>
  type === AssignmentType.TIEBREAKER ? TIEBREAKER_VERDICTS : PRIMARY_VERDICTS;

/** Thesis status in which each kind of juror evaluates. */
export const EVALUATING_STATUS: Readonly<Record<AssignmentType, ThesisStatus>> =
  {
    [AssignmentType.PRIMARY]: ThesisStatus.UNDER_EVALUATION,
    [AssignmentType.TIEBREAKER]: ThesisStatus.IN_DISPUTE,
  };

/** What is missing before an evaluation can be submitted (empty = complete). */
export function missingForSubmit(e: {
  assignmentType: AssignmentType;
  rubric?: RubricLike;
  verdict?: EvaluationVerdict;
  comments?: string;
}): string[] {
  const missing: string[] = [];
  if (
    e.assignmentType === AssignmentType.PRIMARY &&
    !isRubricComplete(e.rubric)
  )
    missing.push('rubric');
  if (!e.verdict) missing.push('verdict');
  if ((e.comments ?? '').trim().length < MIN_COMMENT_LENGTH)
    missing.push('comments');
  return missing;
}

const approves = (v: EvaluationVerdict) => v !== EvaluationVerdict.REJECTED;

/**
 * RN-08 (spec §4.1). `primary` are the submitted primary verdicts, `tiebreaker` the submitted
 * tiebreaker verdict if any. Returns the next thesis status, or null when nothing changes yet.
 */
export function resolveVerdicts(input: {
  primary: readonly EvaluationVerdict[];
  tiebreaker?: EvaluationVerdict;
  unresolvedFeedback: number;
}): ThesisStatus | null {
  const { primary, tiebreaker, unresolvedFeedback } = input;
  const approvedOutcome = () =>
    primary.includes(EvaluationVerdict.APPROVED_WITH_CHANGES) ||
    unresolvedFeedback > 0
      ? ThesisStatus.REVISIONS_IN_PROGRESS
      : ThesisStatus.READY_FOR_DEFENSE;
  if (tiebreaker) {
    return tiebreaker === EvaluationVerdict.REJECTED
      ? ThesisStatus.NOT_APPROVED
      : approvedOutcome();
  }
  if (primary.length < 2) return null;
  const [a, b] = primary;
  if (approves(a) !== approves(b)) return ThesisStatus.IN_DISPUTE;
  if (!approves(a)) return ThesisStatus.NOT_APPROVED;
  return approvedOutcome();
}
