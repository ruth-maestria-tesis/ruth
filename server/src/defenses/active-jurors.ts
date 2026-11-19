import {
  AssignmentStatus,
  AssignmentType,
  EvaluationStatus,
} from '@thesis/shared';
import type { Model, Types } from 'mongoose';
import type { Assignment } from '../assignments/schemas/assignment.schema';
import type { AuthUser } from '../common/types/auth-user';
import type { Evaluation } from '../evaluations/schemas/evaluation.schema';

export interface ActiveJuror {
  assignmentId: string;
  userId: string;
  type: AssignmentType;
}

/**
 * "Active jurors" of a thesis: the ACCEPTED active PRIMARY assignments plus the ACCEPTED
 * tiebreaker only if it SUBMITTED its evaluation (it evaluated). Ordered by slot.
 * Reads the evaluations collection directly (schema only) so DefensesModule does not import
 * EvaluationsModule.
 */
export async function findActiveJurors(
  assignments: Model<Assignment>,
  evaluations: Model<Evaluation>,
  thesisId: Types.ObjectId | string,
): Promise<ActiveJuror[]> {
  const rows = await assignments
    .find(
      { thesisId, isActive: true, status: AssignmentStatus.ACCEPTED },
      'jurorId type slot',
    )
    .sort({ slot: 1 })
    .lean()
    .exec();
  const tiebreakers = rows.filter((a) => a.type === AssignmentType.TIEBREAKER);
  const evaluated = new Set<string>();
  if (tiebreakers.length) {
    const submitted = await evaluations
      .find(
        {
          assignmentId: { $in: tiebreakers.map((a) => a._id) },
          status: EvaluationStatus.SUBMITTED,
        },
        'assignmentId',
      )
      .lean()
      .exec();
    for (const e of submitted) evaluated.add(e.assignmentId.toHexString());
  }
  return rows
    .filter(
      (a) =>
        a.type !== AssignmentType.TIEBREAKER ||
        evaluated.has(a._id.toHexString()),
    )
    .map((a) => ({
      assignmentId: a._id.toHexString(),
      userId: a.jurorId.toHexString(),
      type: a.type,
    }));
}

/** The active juror this user acts as, honouring the RF-J14 scope of external sessions. */
export function jurorFor(
  jurors: readonly ActiveJuror[],
  user: AuthUser,
): ActiveJuror | undefined {
  return jurors.find(
    (j) =>
      j.userId === user.id &&
      (!user.scope || user.scope.assignmentIds.includes(j.assignmentId)),
  );
}
