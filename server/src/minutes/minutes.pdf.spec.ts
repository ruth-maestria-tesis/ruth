import { formatBogota, renderMinutesPdf, toWinAnsi } from './minutes.pdf';

describe('minutes PDF text helpers', () => {
  it('replaces >= and <= and drops characters WinAnsi cannot draw', () => {
    expect(toWinAnsi('nota ≥ 3.0 y ≤ 5.0')).toBe('nota >= 3.0 y <= 5.0');
    expect(toWinAnsi('Excelente 🎉 trabajo')).toBe('Excelente  trabajo');
    expect(toWinAnsi('Sustentación N.° 1 — “ok” año ñandú')).toBe(
      'Sustentación N.° 1 — “ok” año ñandú',
    );
  });

  it('turns exotic spaces into plain spaces', () => {
    expect(toWinAnsi('3:30 p. m.')).toBe('3:30 p. m.');
  });

  it('formats dates in Colombia time and Spanish', () => {
    const text = formatBogota(new Date('2026-11-20T03:30:00Z'));
    expect(text).toContain('19 de noviembre de 2026');
    expect(text).toMatch(/10:30/);
  });

  it('renders a PDF', async () => {
    const pdf = await renderMinutesPdf({
      number: 'MIETIA-2026-001',
      thesis: { code: 'T-1', title: 'Título ≥ 🎉', studentName: 'Ana' },
      defense: {
        scheduledAt: new Date(),
        modality: 'HYBRID',
        location: 'Sala',
      },
      finalGrade: 4.5,
      verdict: 'APPROVED',
      remarks: 'Muy bien 👍',
      contentHash: 'abc',
      sealedAt: new Date(),
      signers: [{ name: 'Juan', role: 'COORDINATOR', signedAt: new Date() }],
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
