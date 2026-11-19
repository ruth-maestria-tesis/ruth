import ExcelJS from 'exceljs';
import { formatDateTime } from './reports.format';
import type { ThesisReportRow } from './reports.types';

export const REPORT_COLUMNS = [
  { header: 'Código', key: 'code', width: 22 },
  { header: 'Título', key: 'title', width: 60 },
  { header: 'Estudiante', key: 'student', width: 28 },
  { header: 'Director(a)', key: 'advisor', width: 28 },
  { header: 'Programa', key: 'program', width: 24 },
  { header: 'Periodo', key: 'period', width: 12 },
  { header: 'Estado', key: 'status', width: 28 },
  { header: 'Jurados', key: 'jurors', width: 40 },
  { header: 'Fecha de radicación', key: 'submittedAt', width: 20 },
  { header: 'Última actualización', key: 'updatedAt', width: 20 },
] as const;

export async function renderThesesXlsx(
  rows: ThesisReportRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet('Tesis', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = REPORT_COLUMNS.map((c) => ({ ...c }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      code: r.code,
      title: r.title,
      student: r.student,
      advisor: r.advisor,
      program: r.program,
      period: r.period,
      status: r.statusLabel,
      jurors: r.jurors.join(', '),
      submittedAt: formatDateTime(r.submittedAt),
      updatedAt: formatDateTime(r.updatedAt),
    });
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: REPORT_COLUMNS.length },
  };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
