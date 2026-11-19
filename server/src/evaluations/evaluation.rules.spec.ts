import {
  AssignmentType,
  EvaluationVerdict as V,
  ThesisStatus as S,
} from '@thesis/shared';
import {
  missingForSubmit,
  resolveVerdicts,
  rubricScore,
} from './evaluation.rules';

describe('RN-08 resolveVerdicts', () => {
  const run = (primary: V[], unresolvedFeedback = 0, tiebreaker?: V) =>
    resolveVerdicts({ primary, tiebreaker, unresolvedFeedback });

  it('waits for both primaries', () => {
    expect(run([V.REJECTED])).toBeNull();
  });
  it('split → IN_DISPUTE', () => {
    expect(run([V.APPROVED_FOR_DEFENSE, V.REJECTED])).toBe(S.IN_DISPUTE);
    expect(run([V.REJECTED, V.APPROVED_WITH_CHANGES])).toBe(S.IN_DISPUTE);
  });
  it('both rejected → NOT_APPROVED', () => {
    expect(run([V.REJECTED, V.REJECTED])).toBe(S.NOT_APPROVED);
  });
  it('both approve → READY unless changes or unresolved feedback', () => {
    expect(run([V.APPROVED_FOR_DEFENSE, V.APPROVED_FOR_DEFENSE])).toBe(
      S.READY_FOR_DEFENSE,
    );
    expect(run([V.APPROVED_FOR_DEFENSE, V.APPROVED_WITH_CHANGES])).toBe(
      S.REVISIONS_IN_PROGRESS,
    );
    expect(run([V.APPROVED_FOR_DEFENSE, V.APPROVED_FOR_DEFENSE], 1)).toBe(
      S.REVISIONS_IN_PROGRESS,
    );
  });
  it('tiebreaker decides', () => {
    const split = [V.APPROVED_FOR_DEFENSE, V.REJECTED];
    expect(run(split, 0, V.REJECTED)).toBe(S.NOT_APPROVED);
    expect(run(split, 0, V.APPROVED)).toBe(S.READY_FOR_DEFENSE);
    expect(run(split, 2, V.APPROVED)).toBe(S.REVISIONS_IN_PROGRESS);
  });
});

describe('submit requirements', () => {
  it('needs a full rubric only for PRIMARY', () => {
    expect(
      missingForSubmit({
        assignmentType: AssignmentType.TIEBREAKER,
        verdict: V.APPROVED,
        comments: 'x'.repeat(20),
      }),
    ).toEqual([]);
    expect(
      missingForSubmit({
        assignmentType: AssignmentType.PRIMARY,
        rubric: { methodology: 3 },
        comments: '   short comment      ',
      }),
    ).toEqual(['rubric', 'verdict', 'comments']);
  });
  it('scores the average with two decimals', () => {
    expect(
      rubricScore({ methodology: 4, relevance: 5, writingQuality: 5 }),
    ).toBe(4.67);
    expect(rubricScore({ methodology: 4 })).toBeNull();
  });
});
