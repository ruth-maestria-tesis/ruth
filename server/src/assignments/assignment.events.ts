export const ASSIGNMENT_EVENTS = {
  CREATED: 'assignment.created',
  ACCEPTED: 'assignment.accepted',
  DECLINED: 'assignment.declined',
  EXPIRED: 'assignment.expired',
  REPLACED: 'assignment.replaced',
} as const;

/** Consumed by notifications and audit (stage 7) — e.g. alert the coordinator on decline/expiry. */
export interface AssignmentEvent {
  assignmentId: string;
  thesisId: string;
  jurorId: string;
  actorId?: string;
  actorRole: string;
  reason?: string;
  at: Date;
}
