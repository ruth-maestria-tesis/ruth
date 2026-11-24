import type { ThesisParties } from './jury.rules';

/** Why a candidate cannot sit on this thesis' jury (RN-01). */
export type CandidateConflict = 'PARTY' | 'PREVIOUS_JUROR';

export interface CandidateInput {
  id: string;
  lastName: string;
  firstName: string;
  expertise: readonly string[];
}

export interface CandidateRanking {
  /** Juror expertise terms that match the thesis keywords. */
  affinity: string[];
  activeAssignments: number;
  conflict: CandidateConflict | null;
}

/** Lowercase, no accents, single spaces: "Inteligencia  Artificial" ≈ "inteligencia artificial". */
export const normalizeTerm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** An expertise term matches when it contains, or is contained in, a thesis keyword. */
export function affinityOf(
  keywords: readonly string[],
  expertise: readonly string[],
): string[] {
  const keys = keywords.map(normalizeTerm).filter(Boolean);
  if (!keys.length) return [];
  return expertise.filter((term) => {
    const t = normalizeTerm(term);
    return !!t && keys.some((k) => t.includes(k) || k.includes(t));
  });
}

export function conflictOf(
  userId: string,
  parties: ThesisParties,
  previousJurorIds: ReadonlySet<string>,
): CandidateConflict | null {
  const party = new Set([
    parties.studentId,
    parties.advisorId,
    ...parties.coAdvisorIds,
    ...parties.conflictOfInterestUserIds,
  ]);
  if (party.has(userId)) return 'PARTY';
  if (previousJurorIds.has(userId)) return 'PREVIOUS_JUROR';
  return null;
}

/**
 * Candidates for one thesis: no conflict first, then more affinity, then lower load,
 * then by name. Conflicted candidates stay in the list (marked) so the coordinator sees why.
 */
export function rankCandidates<T extends CandidateInput>(
  users: readonly T[],
  keywords: readonly string[],
  parties: ThesisParties,
  previousJurorIds: ReadonlySet<string>,
  load: ReadonlyMap<string, number>,
): (T & CandidateRanking)[] {
  return users
    .map((u) => ({
      ...u,
      affinity: affinityOf(keywords, u.expertise),
      activeAssignments: load.get(u.id) ?? 0,
      conflict: conflictOf(u.id, parties, previousJurorIds),
    }))
    .sort(
      (a, b) =>
        Number(!!a.conflict) - Number(!!b.conflict) ||
        b.affinity.length - a.affinity.length ||
        a.activeAssignments - b.activeAssignments ||
        a.lastName.localeCompare(b.lastName, 'es') ||
        a.firstName.localeCompare(b.firstName, 'es'),
    );
}
