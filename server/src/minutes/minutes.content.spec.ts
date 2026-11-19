import { MinutesVerdict } from '@thesis/shared';
import {
  bogotaYear,
  canonicalJson,
  formatMinutesNumber,
  isGradeConsistent,
  minutesHash,
} from './minutes.content';

describe('minutes content', () => {
  it('canonical JSON sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 0 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":0,"z":1}]},"b":1}',
    );
  });

  it('the hash ignores key order and extra fields, and changes with content', () => {
    const base = {
      thesisId: 'abc',
      number: 'P-2026-001',
      finalGrade: 4.5,
      verdict: MinutesVerdict.APPROVED,
      remarks: 'ok',
    };
    const reordered = {
      remarks: 'ok',
      verdict: MinutesVerdict.APPROVED,
      finalGrade: 4.5,
      number: 'P-2026-001',
      thesisId: 'abc',
    };
    expect(minutesHash(reordered)).toBe(minutesHash(base));
    expect(minutesHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(minutesHash({ ...base, finalGrade: 4.6 })).not.toBe(
      minutesHash(base),
    );
  });

  it('a grade below 3.0 needs FAILED', () => {
    expect(isGradeConsistent(2.9, MinutesVerdict.APPROVED)).toBe(false);
    expect(isGradeConsistent(2.9, MinutesVerdict.FAILED)).toBe(true);
    expect(isGradeConsistent(3.0, MinutesVerdict.APPROVED)).toBe(true);
  });

  it('formats the number with a 3-digit sequence', () => {
    expect(formatMinutesNumber('MIETIA', 2026, 7)).toBe('MIETIA-2026-007');
  });
});

describe('bogotaYear', () => {
  it('uses the Colombia calendar year, not UTC', () => {
    expect(bogotaYear(new Date('2026-01-01T03:00:00Z'))).toBe(2025);
    expect(bogotaYear(new Date('2026-01-01T06:00:00Z'))).toBe(2026);
  });
});
