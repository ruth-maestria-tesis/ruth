import type { Actor } from '../common/types/actor';

export const DEFENSE_EVENTS = {
  PROPOSED: 'defense.proposed',
  CONFIRMED: 'defense.confirmed',
  CANCELLED: 'defense.cancelled',
} as const;

/** Consumed by notifications (stage 7). */
export interface DefenseEvent {
  thesisId: string;
  defenseId: string;
  actor: Actor;
}
