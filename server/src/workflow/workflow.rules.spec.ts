import { THESIS_PROGRESS, ThesisStatus as S } from '@thesis/shared';
import { canTransition, isTerminal } from './workflow.rules';

describe('workflow rules (spec §4)', () => {
  it.each([
    [S.SUBMITTED, S.JURORS_ASSIGNED],
    [S.JURORS_ASSIGNED, S.UNDER_EVALUATION],
    [S.JURORS_ASSIGNED, S.PENDING_JUROR_REPLACEMENT],
    [S.PENDING_JUROR_REPLACEMENT, S.JURORS_ASSIGNED],
    [S.PENDING_JUROR_REPLACEMENT, S.UNDER_EVALUATION],
    [S.UNDER_EVALUATION, S.REVISIONS_IN_PROGRESS],
    [S.UNDER_EVALUATION, S.READY_FOR_DEFENSE],
    [S.UNDER_EVALUATION, S.IN_DISPUTE],
    [S.UNDER_EVALUATION, S.NOT_APPROVED],
    [S.IN_DISPUTE, S.REVISIONS_IN_PROGRESS],
    [S.IN_DISPUTE, S.READY_FOR_DEFENSE],
    [S.IN_DISPUTE, S.NOT_APPROVED],
    [S.REVISIONS_IN_PROGRESS, S.READY_FOR_DEFENSE],
    [S.READY_FOR_DEFENSE, S.DEFENSE_SCHEDULED],
    [S.DEFENSE_SCHEDULED, S.COMPLETED_APPROVED],
    [S.DEFENSE_SCHEDULED, S.COMPLETED_FAILED],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [S.SUBMITTED, S.UNDER_EVALUATION],
    [S.SUBMITTED, S.SUBMITTED],
    [S.REVISIONS_IN_PROGRESS, S.IN_DISPUTE],
    [S.READY_FOR_DEFENSE, S.COMPLETED_APPROVED],
    [S.NOT_APPROVED, S.SUBMITTED],
    [S.COMPLETED_APPROVED, S.COMPLETED_FAILED],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only NOT_APPROVED and COMPLETED_* are terminal, all at 100%', () => {
    const terminal = Object.values(S).filter(isTerminal);
    expect(terminal.sort()).toEqual(
      [S.COMPLETED_APPROVED, S.COMPLETED_FAILED, S.NOT_APPROVED].sort(),
    );
    for (const s of terminal) expect(THESIS_PROGRESS[s]).toBe(100);
  });
});
