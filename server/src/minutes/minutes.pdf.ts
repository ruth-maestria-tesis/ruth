import PDFDocument from 'pdfkit';

export interface MinutesPdfInput {
  number: string;
  thesis: { code: string; title: string; studentName: string };
  defense?: { scheduledAt: Date; modality: string; location?: string };
  finalGrade: number;
  verdict: string;
  remarks: string;
  contentHash: string;
  sealedAt: Date;
  signers: { name: string; role: string; signedAt: Date }[];
}

const VERDICT_LABELS: Record<string, string> = {
  APPROVED: 'Aprobada',
  APPROVED_MERITORIOUS: 'Aprobada - Meritoria',
  APPROVED_LAUREATE: 'Aprobada - Laureada',
  FAILED: 'Reprobada',
};

const MODALITY_LABELS: Record<string, string> = {
  IN_PERSON: 'Presencial',
  VIRTUAL: 'Virtual',
  HYBRID: 'Híbrida',
};

const ROLE_LABELS: Record<string, string> = {
  INTERNAL_JUROR: 'Jurado',
  EXTERNAL_JUROR: 'Jurado externo',
  COORDINATOR: 'Coordinador(a)',
};

const DATE_FORMAT = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  dateStyle: 'long',
  timeStyle: 'short',
});

/** "19 de noviembre de 2026, 3:30 p. m." in Colombia time. */
export function formatBogota(date: Date): string {
  return `${DATE_FORMAT.format(date)} (hora de Colombia)`;
}

// Code points WinAnsi (cp1252) has beyond Latin-1, which the built-in PDF fonts can draw.
const WIN_ANSI_EXTRA = new Set(
  [...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((c) => c.codePointAt(0)!),
);

/** Built-in PDF fonts only draw WinAnsi: normalize symbols and drop whatever else would garble. */
export function toWinAnsi(text: string): string {
  return [
    ...text
      .replace(/≥/g, '>=')
      .replace(/≤/g, '<=')
      .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
      .normalize('NFC'),
  ]
    .filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return (
        cp === 0x0a ||
        cp === 0x0d ||
        cp === 0x09 ||
        (cp >= 0x20 && cp <= 0x7e) ||
        (cp >= 0xa1 && cp <= 0xff) ||
        WIN_ANSI_EXTRA.has(cp)
      );
    })
    .join('');
}

/** CU-04: one-page minutes with the data, the signers and the RNF-04 hash. */
export function renderMinutesPdf(input: MinutesPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const write = (text: string, options?: PDFKit.Mixins.TextOptions) =>
      doc.text(toWinAnsi(text), options);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16);
    write(`Acta de sustentación N.° ${input.number}`, {
      align: 'center',
    });
    doc.moveDown();
    doc.fontSize(11);
    write(`Tesis: ${input.thesis.code} - ${input.thesis.title}`);
    write(`Estudiante: ${input.thesis.studentName}`);
    if (input.defense) {
      write(
        `Sustentación: ${formatBogota(input.defense.scheduledAt)} (${MODALITY_LABELS[input.defense.modality] ?? input.defense.modality}${
          input.defense.location ? `, ${input.defense.location}` : ''
        })`,
      );
    }
    doc.moveDown();
    write(`Calificación final: ${input.finalGrade.toFixed(1)}`);
    write(`Veredicto: ${VERDICT_LABELS[input.verdict] ?? input.verdict}`);
    doc.moveDown(0.5);
    write('Observaciones:');
    write(input.remarks || '-', { width: 500 });
    doc.moveDown();
    doc.fontSize(12);
    write('Firmas');
    doc.fontSize(10);
    for (const s of input.signers) {
      write(
        `${ROLE_LABELS[s.role] ?? s.role}: ${s.name} - firmado ${formatBogota(s.signedAt)}`,
      );
    }
    doc.moveDown();
    write(`Sellada: ${formatBogota(input.sealedAt)}`);
    write(`SHA-256: ${input.contentHash}`);
    doc.end();
  });
}
