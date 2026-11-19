export interface ThesisReportRow {
  code: string;
  title: string;
  student: string;
  advisor: string;
  program: string;
  period: string;
  status: string;
  statusLabel: string;
  jurors: string[];
  submittedAt?: Date;
  updatedAt?: Date;
}

export const REPORT_MAX_ROWS = 2000;
