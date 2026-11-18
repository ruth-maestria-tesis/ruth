import { contentDisposition, sanitizeFileName } from './content-disposition';

describe('file names', () => {
  it('strips paths and control characters and caps the length', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\x\\tesis\u0000.pdf')).toBe('tesis.pdf');
    expect(sanitizeFileName('a'.repeat(300) + '.pdf')).toHaveLength(200);
    expect(sanitizeFileName('   ')).toBe('file');
  });

  it('builds an attachment header with an ASCII fallback and RFC 5987 UTF-8 name', () => {
    expect(contentDisposition('Tesis versión 1.pdf')).toBe(
      `attachment; filename="Tesis versi_n 1.pdf"; filename*=UTF-8''Tesis%20versi%C3%B3n%201.pdf`,
    );
  });
});
