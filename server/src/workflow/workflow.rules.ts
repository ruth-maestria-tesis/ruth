import { THESIS_TRANSITIONS, ThesisStatus } from '@thesis/shared';

export function canTransition(from: ThesisStatus, to: ThesisStatus): boolean {
  return THESIS_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ThesisStatus): boolean {
  return THESIS_TRANSITIONS[status].length === 0;
}
