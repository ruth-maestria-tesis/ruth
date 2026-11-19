import type { EvaluationVerdict } from '@thesis/shared';
import type { Actor } from '../common/types/actor';

export const EVALUATION_SUBMITTED = 'evaluation.submitted';

/** Consumed by notifications (coordinator; the student once RN-08 resolves). */
export interface EvaluationSubmittedEvent {
  thesisId: string;
  evaluationId: string;
  jurorId: string;
  verdict: EvaluationVerdict;
  actor: Actor;
}
