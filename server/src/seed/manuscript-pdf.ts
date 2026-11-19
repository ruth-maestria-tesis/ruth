import PDFDocument from 'pdfkit';

export interface ManuscriptPdfInput {
  title: string;
  studentName: string;
  advisorName: string;
  programName: string;
  abstract: string;
  keywords: string[];
}

/** A small, valid PDF manuscript for demo theses (cover page plus a short body). */
export function renderManuscriptPdf(
  input: ManuscriptPdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 64 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(12).text('Universidad de Córdoba', { align: 'center' });
    doc.text(input.programName, { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(18).text(input.title, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(12).text(`Autor(a): ${input.studentName}`, {
      align: 'center',
    });
    doc.text(`Director(a): ${input.advisorName}`, { align: 'center' });
    doc.moveDown(2);
    doc.text('Montería, Córdoba', { align: 'center' });

    doc.addPage();
    doc.fontSize(14).text('Resumen');
    doc.moveDown(0.5);
    doc.fontSize(11).text(input.abstract, { align: 'justify' });
    doc.moveDown();
    doc.text(`Palabras clave: ${input.keywords.join(', ')}`);
    doc.moveDown();
    doc.fontSize(14).text('1. Introducción');
    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .text(
        'Documento de demostración generado automáticamente para la plataforma de evaluación de tesis. ' +
          'Su contenido es ilustrativo y no corresponde a un trabajo de grado real.',
        { align: 'justify' },
      );
    doc.end();
  });
}
