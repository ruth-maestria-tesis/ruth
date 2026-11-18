import { AssignmentStatus, AssignmentType } from '@thesis/shared';
import type { Types } from 'mongoose';
import {
  businessDaysRemaining,
  calendarDaysBetween,
} from '../common/time/business-days';

export interface AssignmentLike {
  id: string;
  thesisId: Types.ObjectId;
  jurorId: Types.ObjectId;
  type: AssignmentType;
  slot: number;
  status: AssignmentStatus;
  assignedAt: Date;
  responseDeadline: Date;
  respondedAt?: Date;
  declineReason?: string;
  evaluationDeadline?: Date;
  replacedById?: Types.ObjectId;
  externalTokenExpiresAt?: Date;
}

export interface JurorSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  institution?: string;
  isUnicordoba?: boolean;
}

export interface ThesisSummary {
  id: string;
  code: string;
  title: string;
  abstract?: string;
  studentName: string;
  advisorName?: string;
  programId: string;
  status: string;
  progress: number;
}

export interface AssignmentView {
  id: string;
  thesisId: string;
  jurorId: string;
  type: AssignmentType;
  slot: number;
  status: AssignmentStatus;
  assignedAt: Date;
  responseDeadline: Date;
  respondedAt?: Date;
  declineReason?: string;
  evaluationDeadline?: Date;
  replacedById?: string;
  hasExternalLink: boolean;
  externalLinkExpiresAt?: Date;
  /** Sugerencia 8 countdown. */
  daysSinceAssigned: number;
  responseDaysRemaining: number | null;
  evaluationDaysRemaining: number | null;
  isResponseOverdue: boolean;
  juror?: JurorSummary;
  thesis?: ThesisSummary;
}

export function toAssignmentView(
  a: AssignmentLike,
  now: Date,
  holidays: ReadonlySet<string>,
): AssignmentView {
  const pending = a.status === AssignmentStatus.PENDING;
  const accepted = a.status === AssignmentStatus.ACCEPTED;
  return {
    id: a.id,
    thesisId: a.thesisId.toHexString(),
    jurorId: a.jurorId.toHexString(),
    type: a.type,
    slot: a.slot,
    status: a.status,
    assignedAt: a.assignedAt,
    responseDeadline: a.responseDeadline,
    respondedAt: a.respondedAt,
    declineReason: a.declineReason,
    evaluationDeadline: a.evaluationDeadline,
    replacedById: a.replacedById?.toHexString(),
    hasExternalLink:
      !!a.externalTokenExpiresAt && a.externalTokenExpiresAt > now,
    externalLinkExpiresAt: a.externalTokenExpiresAt,
    daysSinceAssigned: calendarDaysBetween(a.assignedAt, now),
    responseDaysRemaining: pending
      ? businessDaysRemaining(now, a.responseDeadline, holidays)
      : null,
    evaluationDaysRemaining:
      accepted && a.evaluationDeadline
        ? businessDaysRemaining(now, a.evaluationDeadline, holidays)
        : null,
    isResponseOverdue: pending && a.responseDeadline < now,
  };
}
