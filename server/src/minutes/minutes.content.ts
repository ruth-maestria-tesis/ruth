import { MinutesVerdict } from '@thesis/shared';
import { sha256 } from '../common/security/hash';

export interface MinutesContent {
  thesisId: string;
  number: string;
  finalGrade: number;
  verdict: MinutesVerdict;
  remarks: string;
}

/** JSON with object keys sorted recursively, so equal content always serializes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** RNF-04: SHA-256 of the canonical JSON of the minutes content. */
export function minutesHash(c: MinutesContent): string {
  return sha256(
    canonicalJson({
      thesisId: c.thesisId,
      number: c.number,
      finalGrade: c.finalGrade,
      verdict: c.verdict,
      remarks: c.remarks,
    }),
  );
}

/** A grade below 3.0 can only be FAILED. */
export function isGradeConsistent(
  finalGrade: number,
  verdict: MinutesVerdict,
): boolean {
  return finalGrade >= 3 || verdict === MinutesVerdict.FAILED;
}

export function formatMinutesNumber(
  programCode: string,
  year: number,
  seq: number,
): string {
  return `${programCode}-${year}-${String(seq).padStart(3, '0')}`;
}
