import { ThesisStatus } from '@thesis/shared';

export const THESIS_STATUS_CHANGED = 'thesis.status.changed';

/** Consumed by notifications and audit (stage 7). */
export interface ThesisStatusChangedEvent {
  thesisId: string;
  from: ThesisStatus;
  to: ThesisStatus;
  actorId?: string;
  actorRole: string;
  reason?: string;
  at: Date;
}
