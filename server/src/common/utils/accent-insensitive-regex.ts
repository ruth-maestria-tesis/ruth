import { escapeRegex } from './escape-regex';

// Vowels and n, each with its accented variants in both cases (listed explicitly so the
// match does not depend on the regex engine's Unicode case folding; MongoDB uses PCRE).
const CLASSES: Readonly<Record<string, string>> = {
  a: '[aAáÁàÀäÄâÂ]',
  e: '[eEéÉèÈëËêÊ]',
  i: '[iIíÍìÌïÏîÎ]',
  o: '[oOóÓòÒöÖôÔ]',
  u: '[uUúÚùÙüÜûÛ]',
  n: '[nNñÑ]',
};

/**
 * Case- and accent-insensitive substring regex for raw user text.
 * The text is escaped first, so it always matches literally.
 */
export function accentInsensitiveRegex(input: string): RegExp {
  const escaped = escapeRegex(input.normalize('NFC'));
  const pattern = Array.from(escaped)
    .map((ch) => {
      const base = ch.normalize('NFD').charAt(0).toLowerCase();
      return CLASSES[base] ?? ch;
    })
    .join('');
  return new RegExp(pattern, 'i');
}
