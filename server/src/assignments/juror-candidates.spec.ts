import { affinityOf, conflictOf, rankCandidates } from './juror-candidates';

const parties = {
  studentId: 's',
  advisorId: 'adv',
  coAdvisorIds: ['co'],
  conflictOfInterestUserIds: ['coi'],
};

describe('juror candidates', () => {
  it('matches expertise to keywords ignoring case and accents', () => {
    expect(
      affinityOf(
        ['Inteligencia Artificial', 'evaluación'],
        ['inteligencia artificial en educación', 'Evaluacion', 'Física'],
      ),
    ).toEqual(['inteligencia artificial en educación', 'Evaluacion']);
    expect(affinityOf([], ['x'])).toEqual([]);
  });

  it('flags parties and previous jurors', () => {
    expect(conflictOf('adv', parties, new Set())).toBe('PARTY');
    expect(conflictOf('coi', parties, new Set())).toBe('PARTY');
    expect(conflictOf('p', parties, new Set(['p']))).toBe('PREVIOUS_JUROR');
    expect(conflictOf('ok', parties, new Set())).toBeNull();
  });

  it('orders by conflict, affinity, load, then name', () => {
    const u = (id: string, lastName: string, expertise: string[]) => ({
      id,
      lastName,
      firstName: 'A',
      expertise,
    });
    const ranked = rankCandidates(
      [
        u('adv', 'Aaa', ['ia']),
        u('busy', 'Bbb', ['ia']),
        u('free', 'Ccc', ['ia']),
        u('none', 'Aab', []),
      ],
      ['IA'],
      parties,
      new Set(),
      new Map([['busy', 3]]),
    );
    expect(ranked.map((r) => r.id)).toEqual(['free', 'busy', 'none', 'adv']);
    expect(ranked[3].conflict).toBe('PARTY');
    expect(ranked[1].activeAssignments).toBe(3);
  });
});
