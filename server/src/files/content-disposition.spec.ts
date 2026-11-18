import { contentDisposition, sanitizeFileName } from './content-disposition';

describe('file names', () => {
  it('strips paths and control characters and caps the length', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\x\\tesis\u0000.pdf')).toBe('tesis.pdf');
    const long = sanitizeFileName('a'.repeat(300) + '.pdf');
    expect(long).toHaveLength(200);
    expect(long.endsWith('.pdf')).toBe(true);
    expect(sanitizeFileName('   ')).toBe('file');
  });

  it('builds an attachment header with an ASCII fallback and RFC 5987 UTF-8 name', () => {
    expect(contentDisposition('Tesis versión 1.pdf')).toBe(
      `attachment; filename="Tesis versi_n 1.pdf"; filename*=UTF-8''Tesis%20versi%C3%B3n%201.pdf`,
    );
  });

  it('removes bidi, zero-width, BOM and C1 characters and normalizes to NFC', () => {
    expect(sanitizeFileName('tesis\u202Efdp.exe')).toBe('tesisfdp.exe');
    expect(sanitizeFileName('a\u200Bb\u2066c\uFEFFd\u0085e\u2028f')).toBe(
      'abcdef',
    );
    expect(sanitizeFileName('Tesis versio\u0301n.pdf')).toBe(
      'Tesis versi\u00f3n.pdf',
    );
  });

  it('maps empty, dot and dot-dot names to "file"', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('.')).toBe('file');
    expect(sanitizeFileName('..')).toBe('file');
    expect(sanitizeFileName('x/..')).toBe('file');
  });

  it('truncates by code points, keeping the extension and never splitting emoji', () => {
    const name = sanitizeFileName('😀'.repeat(300) + '.docx');
    expect(Array.from(name)).toHaveLength(200);
    expect(name.endsWith('.docx')).toBe(true);
    expect(encodeURIComponent(name)).toBeTruthy(); // throws on lone surrogates
    expect(() => contentDisposition(name)).not.toThrow();
  });

  it('never throws on lone surrogates and escapes RFC 5987 specials', () => {
    expect(() => contentDisposition('a\uD800b.pdf')).not.toThrow();
    expect(contentDisposition("it's (a)*.pdf")).toContain(
      "filename*=UTF-8''it%27s%20%28a%29%2A.pdf",
    );
  });
});
