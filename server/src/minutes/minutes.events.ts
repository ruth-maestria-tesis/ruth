import type { MinutesVerdict } from '@thesis/shared';
import type { Actor } from '../common/types/actor';

export const MINUTES_SEALED = 'minutes.sealed';

/** Consumed by notifications (stage 7). */
export interface MinutesSealedEvent {
  thesisId: string;
  minutesId: string;
  verdict: MinutesVerdict;
  actor: Actor;
}
