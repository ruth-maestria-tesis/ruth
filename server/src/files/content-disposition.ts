const MAX_NAME = 200;
const MAX_EXT = 10;
// C0/C1 controls, format chars (zero-width, bidi overrides/isolates, BOM), line/paragraph separators.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

function truncate(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= MAX_NAME) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? Array.from(name.slice(dot)) : [];
  if (ext.length > 0 && ext.length <= MAX_EXT) {
    const stem = Array.from(name.slice(0, dot)).slice(0, MAX_NAME - ext.length);
    return stem.join('') + ext.join('');
  }
  return chars.slice(0, MAX_NAME).join('');
}

export function sanitizeFileName(name: string): string {
  const base = name.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(UNSAFE_CHARS, '').trim();
  const bounded = truncate(clean).trim();
  return bounded === '' || bounded === '.' || bounded === '..'
    ? 'file'
    : bounded;
}

/** Replaces lone surrogates with U+FFFD (String.prototype.toWellFormed fallback). */
function wellFormed(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD',
  );
}

export function contentDisposition(fileName: string): string {
  const safe = wellFormed(fileName);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
