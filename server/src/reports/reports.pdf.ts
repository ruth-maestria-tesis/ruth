import PDFDocument from 'pdfkit';
import { formatDate, formatDateTime } from './reports.format';
import type { ThesisReportRow } from './reports.types';

const MARGIN = 30;
const COLS = [
  { header: 'Código', width: 82 },
  { header: 'Título', width: 150 },
  { header: 'Estudiante', width: 92 },
  { header: 'Director(a)', width: 92 },
  { header: 'Programa', width: 62 },
  { header: 'Periodo', width: 44 },
  { header: 'Estado', width: 72 },
  { header: 'Jurados', width: 96 },
  { header: 'Radicación', width: 46 },
  { header: 'Actualización', width: 46 },
];
const CELL_PAD = 3;
const FONT_SIZE = 7;
const MAX_CELL_CHARS = 140;

/** Standard PDF fonts only cover WinAnsi: keep Latin-1 and map common punctuation. */
export function toWinAnsi(input: string): string {
  return input
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

const cell = (s: string) => {
  const clean = toWinAnsi(s);
  return clean.length > MAX_CELL_CHARS
    ? `${clean.slice(0, MAX_CELL_CHARS - 3)}...`
    : clean;
};

export function renderThesesPdf(
  rows: ThesisReportRow[],
  opts: { filters: string[]; total: number; generatedAt: Date },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGIN,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(15).text('Reporte de tesis');
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`Generado: ${formatDateTime(opts.generatedAt)} (hora de Bogotá)`);
    doc.text(
      `Filtros: ${opts.filters.length ? toWinAnsi(opts.filters.join('; ')) : 'ninguno'}`,
    );
    doc.text(`Total de registros: ${opts.total}`);
    doc.moveDown(0.5);

    const bottom = () => doc.page.height - MARGIN;
    const drawRow = (values: string[], header: boolean) => {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT_SIZE);
      const height =
        Math.max(
          ...values.map((v, i) =>
            doc.heightOfString(v, { width: COLS[i].width - CELL_PAD * 2 }),
          ),
        ) +
        CELL_PAD * 2;
      if (doc.y + height > bottom()) {
        doc.addPage();
        if (!header) {
          drawRow(
            COLS.map((c) => c.header),
            true,
          );
          doc.font('Helvetica').fontSize(FONT_SIZE);
        }
      }
      const y = doc.y;
      let x = MARGIN;
      values.forEach((v, i) => {
        if (header) doc.rect(x, y, COLS[i].width, height).fill('#e5e7eb');
        doc.fillColor('#000000').text(v, x + CELL_PAD, y + CELL_PAD, {
          width: COLS[i].width - CELL_PAD * 2,
          lineBreak: true,
        });
        x += COLS[i].width;
      });
      doc
        .moveTo(MARGIN, y + height)
        .lineTo(x, y + height)
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .stroke();
      doc.x = MARGIN;
      doc.y = y + height;
    };

    drawRow(
      COLS.map((c) => c.header),
      true,
    );
    for (const r of rows) {
      drawRow(
        [
          r.code,
          r.title,
          r.student,
          r.advisor,
          r.program,
          r.period,
          r.statusLabel,
          r.jurors.join(', '),
          formatDate(r.submittedAt),
          formatDate(r.updatedAt),
        ].map(cell),
        false,
      );
    }
    if (rows.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .text('Sin resultados.', MARGIN, doc.y + 6);
    }
    doc.end();
  });
}
