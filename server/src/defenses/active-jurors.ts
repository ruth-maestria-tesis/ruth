import { AssignmentStatus, AssignmentType } from '@thesis/shared';
import type { Model, Types } from 'mongoose';
import type { Assignment } from '../assignments/schemas/assignment.schema';
import type { AuthUser } from '../common/types/auth-user';

export interface ActiveJuror {
  assignmentId: string;
  userId: string;
  type: AssignmentType;
}

/**
 * "Active jurors" of a thesis: the ACCEPTED active PRIMARY assignments plus an ACCEPTED
 * tiebreaker if there is one. Ordered by slot.
 */
export async function findActiveJurors(
  assignments: Model<Assignment>,
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
  return rows.map((a) => ({
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
