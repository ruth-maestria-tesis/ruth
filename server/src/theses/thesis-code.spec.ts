import { codePrefix, formatThesisCode } from './thesis-code';

describe('thesis code (sugerencia 5)', () => {
  it('builds PROGRAM-PERIOD prefix, optionally with a seed tag', () => {
    expect(codePrefix('MIETIA', '2026-II')).toBe('MIETIA-2026-II');
    expect(codePrefix('MIETIA', '2026-II', 'TEST')).toBe('TEST-MIETIA-2026-II');
  });

  it('pads the sequence to three digits and keeps larger numbers', () => {
    expect(formatThesisCode('MIETIA-2026-II', 1)).toBe('MIETIA-2026-II-001');
    expect(formatThesisCode('MIETIA-2026-II', 42)).toBe('MIETIA-2026-II-042');
    expect(formatThesisCode('MIETIA-2026-II', 1234)).toBe(
      'MIETIA-2026-II-1234',
    );
  });
});
