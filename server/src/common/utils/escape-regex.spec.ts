import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('escapes regex metacharacters so user input matches literally', () => {
    const rx = new RegExp(escapeRegex('a.b*(c)'), 'i');
    expect(rx.test('A.B*(C)')).toBe(true);
    expect(rx.test('aXbbbc')).toBe(false);
  });
});
