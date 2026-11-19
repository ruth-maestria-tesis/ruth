import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  AssignmentStatus,
  AssignmentType,
  EvaluationStatus,
  ThesisStatus,
} from '@thesis/shared';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { Assignment } from '../assignments/schemas/assignment.schema';
import { Cohort } from '../catalogs/schemas/cohort.schema';
import { addBusinessDays } from '../common/time/business-days';
import { SettingsService } from '../settings/settings.service';
import { Thesis } from '../theses/schemas/thesis.schema';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

export type AlertKind =
  | 'PENDING_REPLACEMENT'
  | 'IN_DISPUTE'
  | 'RESPONSE_DUE_SOON'
  | 'EVALUATION_OVERDUE';

export interface DashboardAlert {
  kind: AlertKind;
  thesisId: string;
  code: string;
  title: string;
  message: string;
}

export const MAX_ALERTS = 50;
const RESPONSE_DUE_BUSINESS_DAYS = 2;
const NOT_ACTIVE: ThesisStatus[] = [
  ThesisStatus.NOT_APPROVED,
  ThesisStatus.COMPLETED_APPROVED,
  ThesisStatus.COMPLETED_FAILED,
];
const COMPLETED: ThesisStatus[] = [
  ThesisStatus.COMPLETED_APPROVED,
  ThesisStatus.COMPLETED_FAILED,
];

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Thesis.name) private readonly theses: Model<Thesis>,
    @InjectModel(Assignment.name)
    private readonly assignments: Model<Assignment>,
    @InjectModel(Cohort.name) private readonly cohorts: Model<Cohort>,
    @InjectConnection() private readonly connection: Connection,
    private readonly settings: SettingsService,
  ) {}

  async coordinator(query: DashboardQueryDto, now = new Date()) {
    const filter = this.thesisFilter(query);
    const [statusRows, cohortRows] = await Promise.all([
      this.theses.aggregate<{ _id: ThesisStatus; count: number }>([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.theses.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: filter },
        { $group: { _id: '$cohortId', count: { $sum: 1 } } },
      ]),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(ThesisStatus).map((s) => [s, 0]),
    ) as Record<ThesisStatus, number>;
    for (const row of statusRows) byStatus[row._id] = row.count;

    const sum = (statuses: ThesisStatus[]) =>
      statuses.reduce((acc, s) => acc + byStatus[s], 0);
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    const cohortDocs = await this.cohorts
      .find({ _id: { $in: cohortRows.map((r) => r._id) } }, 'name')
      .lean()
      .exec();
    const names = new Map(cohortDocs.map((c) => [String(c._id), c.name]));
    const byCohort = cohortRows
      .map((r) => ({
        cohortId: String(r._id),
        name: names.get(String(r._id)) ?? '',
        count: r.count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      totals: {
        theses: total,
        active: total - sum(NOT_ACTIVE),
        completed: sum(COMPLETED),
        notApproved: byStatus[ThesisStatus.NOT_APPROVED],
      },
      byStatus,
      byCohort,
      alerts: await this.alerts(filter, now),
    };
  }

  private thesisFilter(q: DashboardQueryDto): FilterQuery<Thesis> {
    const filter: FilterQuery<Thesis> = {};
    if (q.periodId) filter.periodId = new Types.ObjectId(q.periodId);
    if (q.cohortId) filter.cohortId = new Types.ObjectId(q.cohortId);
    if (q.programId) filter.programId = new Types.ObjectId(q.programId);
    return filter;
  }

  private async alerts(
    filter: FilterQuery<Thesis>,
    now: Date,
  ): Promise<DashboardAlert[]> {
    const alerts: DashboardAlert[] = [];
    const push = (
      kind: AlertKind,
      t: { _id: unknown; code: string; title: string },
      message: string,
    ) =>
      alerts.push({
        kind,
        thesisId: String(t._id),
        code: t.code,
        title: t.title,
        message,
      });

    const flagged = await this.theses
      .find(
        {
          ...filter,
          status: {
            $in: [
              ThesisStatus.PENDING_JUROR_REPLACEMENT,
              ThesisStatus.IN_DISPUTE,
            ],
          },
        },
        'code title status',
      )
      .sort({ updatedAt: -1 })
      .limit(MAX_ALERTS)
      .lean()
      .exec();
    for (const t of flagged) {
      if (t.status === ThesisStatus.IN_DISPUTE) {
        push('IN_DISPUTE', t, 'La tesis está en disputa entre los jurados.');
      } else {
        push(
          'PENDING_REPLACEMENT',
          t,
          'La tesis requiere el reemplazo de un jurado.',
        );
      }
    }

    const holidays = await this.settings.holidaySet();
    const limit = addBusinessDays(now, RESPONSE_DUE_BUSINESS_DAYS, holidays);
    // Resolve the filtered theses first so the assignment queries (and their limits) only
    // consider theses in scope: due-soon uses the plain filter, overdue only theses still
    // UNDER_EVALUATION.
    const [scoped, evaluating] = await Promise.all([
      this.theses.find(filter, 'code title').lean().exec(),
      this.theses
        .find({ ...filter, status: ThesisStatus.UNDER_EVALUATION }, '_id')
        .lean()
        .exec(),
    ]);
    const byId = new Map(scoped.map((t) => [String(t._id), t]));

    // An empty $in matches nothing, so empty filters need no special case.
    const [due, overdue] = await Promise.all([
      this.assignments
        .find({
          thesisId: { $in: scoped.map((t) => t._id) },
          isActive: true,
          status: AssignmentStatus.PENDING,
          responseDeadline: { $gte: now, $lte: limit },
        })
        .sort({ responseDeadline: 1 })
        .limit(MAX_ALERTS)
        .lean()
        .exec(),
      this.assignments
        .find({
          thesisId: { $in: evaluating.map((t) => t._id) },
          isActive: true,
          status: AssignmentStatus.ACCEPTED,
          type: AssignmentType.PRIMARY,
          evaluationDeadline: { $lt: now },
        })
        .sort({ evaluationDeadline: 1 })
        .limit(MAX_ALERTS * 4)
        .lean()
        .exec(),
    ]);
    const submitted = overdue.length
      ? await this.submittedAssignmentIds(overdue.map((a) => a._id))
      : new Set<string>();
    const overdueOpen = overdue.filter((a) => !submitted.has(String(a._id)));

    for (const a of due) {
      const t = byId.get(String(a.thesisId));
      if (t)
        push(
          'RESPONSE_DUE_SOON',
          t,
          `Un jurado debe responder la asignación antes del ${fmtDate(a.responseDeadline)}.`,
        );
    }
    for (const a of overdueOpen) {
      const t = byId.get(String(a.thesisId));
      if (t && a.evaluationDeadline)
        push(
          'EVALUATION_OVERDUE',
          t,
          `Un jurado superó el plazo de evaluación (${fmtDate(a.evaluationDeadline)}) sin enviar su evaluación.`,
        );
    }
    return alerts.slice(0, MAX_ALERTS);
  }

  /** Ids of the given assignments that have a SUBMITTED evaluation (raw collection). */
  private async submittedAssignmentIds(
    assignmentIds: Types.ObjectId[],
  ): Promise<Set<string>> {
    const rows = await this.connection
      .collection('evaluations')
      .find(
        {
          status: EvaluationStatus.SUBMITTED,
          assignmentId: { $in: assignmentIds },
        },
        { projection: { assignmentId: 1 } },
      )
      .toArray();
    return new Set(rows.map((r) => String(r.assignmentId)));
  }
}
