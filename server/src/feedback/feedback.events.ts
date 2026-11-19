import type { Actor } from '../common/types/actor';

export const FEEDBACK_EVENTS = {
  CREATED: 'feedback.created',
  ADDRESSED: 'feedback.addressed',
  RESOLVED: 'feedback.resolved',
  REOPENED: 'feedback.reopened',
} as const;

/** Consumed by notifications (the student on created/reopened, the juror on addressed). */
export interface FeedbackEvent {
  thesisId: string;
  itemId: string;
  jurorId: string;
  studentId: string;
  actor: Actor;
}
