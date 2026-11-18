import { accentInsensitiveRegex } from './accent-insensitive-regex';

describe('accentInsensitiveRegex', () => {
  it('matches vowels and n with or without accents, any case', () => {
    expect(accentInsensitiveRegex('perez').test('Pérez')).toBe(true);
    expect(accentInsensitiveRegex('PÉREZ').test('perez')).toBe(true);
    expect(accentInsensitiveRegex('pérez').test('PEREZ')).toBe(true);
    expect(accentInsensitiveRegex('ramon').test('Ramón')).toBe(true);
    expect(accentInsensitiveRegex('nino').test('NIÑO')).toBe(true);
    expect(accentInsensitiveRegex('niño').test('nino')).toBe(true);
    expect(accentInsensitiveRegex('lopez').test('López')).toBe(true);
  });

  it('is a substring match with the i flag', () => {
    const rx = accentInsensitiveRegex('ana');
    expect(rx.flags).toBe('i');
    expect(rx.test('Mariana Gómez')).toBe(true);
    expect(rx.test('Luis')).toBe(false);
  });

  it('treats user text literally (regex metacharacters are escaped)', () => {
    const rx = accentInsensitiveRegex('a.b*(c)');
    expect(rx.test('A.B*(C)')).toBe(true);
    expect(rx.test('aXbbbc')).toBe(false);
    expect(() => accentInsensitiveRegex('([')).not.toThrow();
  });

  it('accepts decomposed (NFD) accents', () => {
    expect(accentInsensitiveRegex('pérez').test('perez')).toBe(true);
  });
});
