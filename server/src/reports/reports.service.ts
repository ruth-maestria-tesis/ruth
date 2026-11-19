import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Assignment } from '../assignments/schemas/assignment.schema';
import { Period } from '../catalogs/schemas/period.schema';
import { Program } from '../catalogs/schemas/program.schema';
import { buildSort } from '../common/pagination/paginate';
import { accentInsensitiveRegex } from '../common/utils/accent-insensitive-regex';
import { escapeRegex } from '../common/utils/escape-regex';
import { Thesis } from '../theses/schemas/thesis.schema';
import { User } from '../users/schemas/user.schema';
import { ReportQueryDto } from './reports.dto';
import { fileDateStamp, statusLabel } from './reports.format';
import { renderThesesPdf } from './reports.pdf';
import { REPORT_MAX_ROWS, ThesisReportRow } from './reports.types';
import { renderThesesXlsx } from './reports.xlsx';

// Mirrors the sortable keys of GET /theses.
const SORT_FIELDS = {
  code: 'code',
  title: 'title',
  student: 'studentName',
  status: 'status',
  progress: 'progress',
  createdAt: 'createdAt',
} as const;

export interface SummaryBucket {
  id: string;
  code?: string;
  name?: string;
  count: number;
}

export interface ReportsSummary {
  total: number;
  byStatus: { status: string; label: string; count: number }[];
  byProgram: SummaryBucket[];
  byPeriod: SummaryBucket[];
}

const fullName = (u?: { firstName: string; lastName: string }) =>
  u ? `${u.firstName} ${u.lastName}` : '';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Thesis.name) private readonly theses: Model<Thesis>,
    @InjectModel(Assignment.name)
    private readonly assignments: Model<Assignment>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Program.name) private readonly programs: Model<Program>,
    @InjectModel(Period.name) private readonly periods: Model<Period>,
  ) {}

  /** Same filter semantics as ThesesService.list (read-only copy; that module is not edited). */
  private buildFilter(query: ReportQueryDto): FilterQuery<Thesis> {
    const filter: FilterQuery<Thesis> = {};
    if (query.programId) filter.programId = query.programId;
    if (query.periodId) filter.periodId = query.periodId;
    if (query.cohortId) filter.cohortId = query.cohortId;
    if (query.status) filter.status = query.status;
    if (query.seedTag) filter.seedTag = query.seedTag;
    if (query.codePrefix)
      filter.code = new RegExp(
        `^${escapeRegex(query.codePrefix.toUpperCase())}`,
      );
    if (query.q) {
      const rx = accentInsensitiveRegex(query.q);
      filter.$or = [{ code: rx }, { title: rx }, { studentName: rx }];
    }
    return filter;
  }

  /** Human-readable description of the applied filters, for the PDF header. */
  private async describeFilters(query: ReportQueryDto): Promise<string[]> {
    const out: string[] = [];
    if (query.programId) {
      const p = await this.programs.findById(query.programId).lean().exec();
      out.push(`Programa: ${p ? `${p.code} - ${p.name}` : query.programId}`);
    }
    if (query.periodId) {
      const p = await this.periods.findById(query.periodId).lean().exec();
      out.push(`Periodo: ${p ? p.code : query.periodId}`);
    }
    if (query.cohortId) out.push(`Cohorte: ${query.cohortId}`);
    if (query.status) out.push(`Estado: ${statusLabel(query.status)}`);
    if (query.q) out.push(`Búsqueda: ${query.q}`);
    if (query.codePrefix) out.push(`Prefijo de código: ${query.codePrefix}`);
    if (query.seedTag) out.push(`Etiqueta: ${query.seedTag}`);
    return out;
  }

  async rows(
    query: ReportQueryDto,
  ): Promise<{ rows: ThesisReportRow[]; total: number }> {
    const filter = this.buildFilter(query);
    const collated =
      query.sort === 'title' ||
      query.sort === 'student' ||
      query.sort === 'code';
    const find = this.theses
      .find(filter, { history: 0 })
      .sort(buildSort(query, SORT_FIELDS, 'createdAt'))
      .limit(REPORT_MAX_ROWS)
      .lean();
    const count = this.theses.countDocuments(filter);
    if (collated) {
      find.collation({ locale: 'es', strength: 1 });
      count.collation({ locale: 'es', strength: 1 });
    }
    const [theses, total] = await Promise.all([find.exec(), count.exec()]);

    const assignments = await this.assignments
      .find({ thesisId: { $in: theses.map((t) => t._id) }, isActive: true })
      .sort({ slot: 1 })
      .lean()
      .exec();
    const userIds = new Set<string>();
    for (const t of theses) userIds.add(t.advisorId.toString());
    for (const a of assignments) userIds.add(a.jurorId.toString());
    const [users, programs, periods] = await Promise.all([
      this.users
        .find({ _id: { $in: [...userIds] } }, 'firstName lastName')
        .lean()
        .exec(),
      this.programs
        .find({ _id: { $in: theses.map((t) => t.programId) } })
        .lean()
        .exec(),
      this.periods
        .find({ _id: { $in: theses.map((t) => t.periodId) } })
        .lean()
        .exec(),
    ]);
    const userById = new Map(users.map((u) => [u._id.toString(), u]));
    const programById = new Map(programs.map((p) => [p._id.toString(), p]));
    const periodById = new Map(periods.map((p) => [p._id.toString(), p]));
    const jurorsByThesis = new Map<string, string[]>();
    for (const a of assignments) {
      const key = a.thesisId.toString();
      const list = jurorsByThesis.get(key) ?? [];
      list.push(fullName(userById.get(a.jurorId.toString())));
      jurorsByThesis.set(key, list);
    }

    const rows = theses.map((t): ThesisReportRow => {
      const stamps = t as unknown as { createdAt?: Date; updatedAt?: Date };
      return {
        code: t.code,
        title: t.title,
        student: t.studentName,
        advisor: fullName(userById.get(t.advisorId.toString())),
        program: programById.get(t.programId.toString())?.code ?? '',
        period: periodById.get(t.periodId.toString())?.code ?? '',
        status: t.status,
        statusLabel: statusLabel(t.status),
        jurors: jurorsByThesis.get(t._id.toString()) ?? [],
        submittedAt: stamps.createdAt,
        updatedAt: stamps.updatedAt,
      };
    });
    return { rows, total };
  }

  async xlsx(query: ReportQueryDto) {
    const { rows } = await this.rows(query);
    return {
      buffer: await renderThesesXlsx(rows),
      fileName: `tesis-${fileDateStamp()}.xlsx`,
    };
  }

  async pdf(query: ReportQueryDto) {
    const [{ rows, total }, filters] = await Promise.all([
      this.rows(query),
      this.describeFilters(query),
    ]);
    return {
      buffer: await renderThesesPdf(rows, {
        filters,
        total,
        generatedAt: new Date(),
      }),
      fileName: `tesis-${fileDateStamp()}.pdf`,
    };
  }

  async summary(query: ReportQueryDto): Promise<ReportsSummary> {
    // Unlike find(), aggregate() does not cast ids, so the ObjectId filters are cast here.
    const match = this.buildFilter(query);
    for (const key of ['programId', 'periodId', 'cohortId'] as const) {
      if (match[key]) match[key] = new Types.ObjectId(String(match[key]));
    }
    const group = (field: string) =>
      this.theses
        .aggregate<{ _id: Types.ObjectId | string; count: number }>([
          { $match: match },
          { $group: { _id: `$${field}`, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
        ])
        .exec();
    const [byStatus, byProgram, byPeriod] = await Promise.all([
      group('status'),
      group('programId'),
      group('periodId'),
    ]);
    const [programs, periods] = await Promise.all([
      this.programs
        .find({ _id: { $in: byProgram.map((b) => b._id) } })
        .lean()
        .exec(),
      this.periods
        .find({ _id: { $in: byPeriod.map((b) => b._id) } })
        .lean()
        .exec(),
    ]);
    const programById = new Map(programs.map((p) => [p._id.toString(), p]));
    const periodById = new Map(periods.map((p) => [p._id.toString(), p]));
    return {
      total: byStatus.reduce((n, b) => n + b.count, 0),
      byStatus: byStatus.map((b) => ({
        status: String(b._id),
        label: statusLabel(String(b._id)),
        count: b.count,
      })),
      byProgram: byProgram.map((b) => ({
        id: String(b._id),
        code: programById.get(String(b._id))?.code,
        name: programById.get(String(b._id))?.name,
        count: b.count,
      })),
      byPeriod: byPeriod.map((b) => ({
        id: String(b._id),
        code: periodById.get(String(b._id))?.code,
        count: b.count,
      })),
    };
  }
}
