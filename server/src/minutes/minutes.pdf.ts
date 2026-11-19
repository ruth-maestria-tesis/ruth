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

const ROLE_LABELS: Record<string, string> = {
  INTERNAL_JUROR: 'Jurado',
  EXTERNAL_JUROR: 'Jurado externo',
  COORDINATOR: 'Coordinador(a)',
};

/** CU-04: one-page minutes with the data, the signers and the RNF-04 hash. */
export function renderMinutesPdf(input: MinutesPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(`Acta de sustentación N.° ${input.number}`, {
      align: 'center',
    });
    doc.moveDown();
    doc.fontSize(11);
    doc.text(`Tesis: ${input.thesis.code} - ${input.thesis.title}`);
    doc.text(`Estudiante: ${input.thesis.studentName}`);
    if (input.defense) {
      doc.text(
        `Sustentación: ${input.defense.scheduledAt.toISOString()} (${input.defense.modality}${
          input.defense.location ? `, ${input.defense.location}` : ''
        })`,
      );
    }
    doc.moveDown();
    doc.text(`Calificación final: ${input.finalGrade.toFixed(1)}`);
    doc.text(`Veredicto: ${VERDICT_LABELS[input.verdict] ?? input.verdict}`);
    doc.moveDown(0.5);
    doc.text('Observaciones:');
    doc.text(input.remarks || '-', { width: 500 });
    doc.moveDown();
    doc.fontSize(12).text('Firmas');
    doc.fontSize(10);
    for (const s of input.signers) {
      doc.text(
        `${ROLE_LABELS[s.role] ?? s.role}: ${s.name} - firmado ${s.signedAt.toISOString()}`,
      );
    }
    doc.moveDown();
    doc.text(`Sellada: ${input.sealedAt.toISOString()}`);
    doc.text(`SHA-256: ${input.contentHash}`);
    doc.end();
  });
}
