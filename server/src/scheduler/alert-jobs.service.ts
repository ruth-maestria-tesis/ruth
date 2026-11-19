import { SYSTEM_ACTOR } from '../common/types/actor';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AssignmentStatus,
  EvaluationStatus,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { AssignmentResponsesService } from '../assignments/assignment-responses.service';
import { Assignment } from '../assignments/schemas/assignment.schema';
import {
  businessDaysBetween,
  businessDaysRemaining,
} from '../common/time/business-days';
import { Evaluation } from '../evaluations/schemas/evaluation.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { Thesis } from '../theses/schemas/thesis.schema';

export const ALERT_JOBS = [
  'expirePending',
  'reconcile',
  'overdueEvaluations',
  'deadlineReminders',
  'unseenConceptAlerts',
] as const;
export type AlertJobName = (typeof ALERT_JOBS)[number];
export type JobCounts = Partial<Record<AlertJobName, number>>;

/** Notification `type`s created by the alert jobs. */
export const ALERT_NOTIFICATION_TYPES = {
  RESPONSE_REMINDER: 'assignment.response.reminder',
  EVALUATION_REMINDER: 'evaluation.deadline.reminder',
  EVALUATION_OVERDUE: 'evaluation.overdue',
  CONCEPT_UNSEEN: 'evaluation.unseen',
} as const;

/** Statuses in which a thesis still waits for jurors' evaluations. */
const EVALUATING: readonly ThesisStatus[] = [
  ThesisStatus.UNDER_EVALUATION,
  ThesisStatus.IN_DISPUTE,
];

type MarkerField =
  'responseReminderSentAt' | 'evaluationReminderSentAt' | 'overdueNotifiedAt';

interface Claimable extends Partial<Record<MarkerField, Date>> {
  _id: Types.ObjectId;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const oids = (ids: Iterable<unknown>) =>
  [...new Set([...ids].map(String))].map((id) => new Types.ObjectId(id));
const daysText = (n: number) => (n <= 1 ? '1 día hábil' : `${n} días hábiles`);

/**
 * Daily alert jobs (spec §7). Every method takes `now` so tests control the clock, and is
 * idempotent: a marker is claimed with a compare-and-set update *before* notifying, so a
 * repeated or concurrent run never duplicates a notification. If notifying fails the marker
 * is restored, so the next run retries.
 */
@Injectable()
export class AlertJobsService {
  private readonly logger = new Logger(AlertJobsService.name);

  constructor(
    @InjectModel(Assignment.name)
    private readonly assignments: Model<Assignment>,
    @InjectModel(Evaluation.name)
    private readonly evaluations: Model<Evaluation>,
    @InjectModel(Thesis.name) private readonly theses: Model<Thesis>,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly responses: AssignmentResponsesService,
    private readonly outcomes: EvaluationsService,
  ) {}

  /** Runs one job (or all of them) and returns the count each one produced. */
  async run(job: AlertJobName | 'all', now = new Date()): Promise<JobCounts> {
    const names: readonly AlertJobName[] = job === 'all' ? ALERT_JOBS : [job];
    const counts: JobCounts = {};
    for (const name of names) {
      try {
        counts[name] = await this.runOne(name, now);
      } catch (err) {
        this.logger.error(`Job ${name} failed: ${msg(err)}`);
        counts[name] = 0;
      }
    }
    return counts;
  }

  /** Assignment reconcile passes plus the RN-08 evaluation-outcome reconcile. */
  private async reconcileAll(): Promise<number> {
    const assignments = await this.responses.reconcile();
    const outcomes = await this.outcomes.reconcileStuck(SYSTEM_ACTOR);
    return assignments + outcomes;
  }

  private runOne(name: AlertJobName, now: Date): Promise<number> {
    switch (name) {
      case 'expirePending':
        return this.responses.expirePending(now);
      case 'reconcile':
        return this.reconcileAll();
      case 'overdueEvaluations':
        return this.overdueEvaluations(now);
      case 'deadlineReminders':
        return this.deadlineReminders(now);
      case 'unseenConceptAlerts':
        return this.unseenConceptAlerts(now);
    }
  }

  // ---- helpers ----

  /** Thesis id → label and status, optionally restricted to some statuses. */
  private async thesisMap(
    ids: Types.ObjectId[],
    statuses?: readonly ThesisStatus[],
  ): Promise<Map<string, { label: string; status: ThesisStatus }>> {
    if (!ids.length) return new Map();
    const rows = await this.theses
      .find(
        {
          _id: { $in: ids },
          ...(statuses ? { status: { $in: statuses } } : {}),
        },
        { code: 1, title: 1, status: 1 },
      )
      .lean()
      .exec();
    return new Map(
      rows.map((t) => [
        String(t._id),
        { label: `${t.code} — ${t.title}`, status: t.status },
      ]),
    );
  }

  private async submittedAssignmentIds(
    ids: Types.ObjectId[],
  ): Promise<Set<string>> {
    const rows = await this.evaluations
      .find(
        { assignmentId: { $in: ids }, status: EvaluationStatus.SUBMITTED },
        { assignmentId: 1 },
      )
      .lean()
      .exec();
    return new Set(rows.map((e) => String(e.assignmentId)));
  }

  /**
   * Compare-and-set on an assignment marker (succeeds only if it still holds the value this run
   * read), notify, and restore the marker when notifying fails. True when this run notified.
   */
  private async claimAndNotify(
    a: Claimable,
    field: MarkerField,
    now: Date,
    send: () => Promise<unknown>,
  ): Promise<boolean> {
    const claimed = await this.assignments
      .updateOne(
        { _id: a._id, [field]: a[field] ?? { $exists: false } },
        { $set: { [field]: now } },
      )
      .exec();
    if (claimed.modifiedCount !== 1) return false;
    try {
      await send();
      return true;
    } catch (err) {
      await this.assignments
        .updateOne(
          { _id: a._id },
          a[field]
            ? { $set: { [field]: a[field] } }
            : { $unset: { [field]: 1 } },
        )
        .exec();
      throw err;
    }
  }

  // ---- jobs ----

  /**
   * ACCEPTED, active assignment past its evaluation deadline with no SUBMITTED evaluation, on a
   * thesis still UNDER_EVALUATION / IN_DISPUTE: alerts the juror and the coordinators. Repeats
   * every `overdueRenotifyBusinessDays` business days (0 = only once).
   */
  async overdueEvaluations(now = new Date()): Promise<number> {
    const settings = await this.settings.get();
    const holidays = new Set(settings.holidays);
    const every = settings.overdueRenotifyBusinessDays;
    const overdue = await this.assignments
      .find({
        status: AssignmentStatus.ACCEPTED,
        isActive: true,
        evaluationDeadline: { $lt: now },
      })
      .lean()
      .exec();
    if (!overdue.length) return 0;
    const submitted = await this.submittedAssignmentIds(
      overdue.map((a) => a._id),
    );
    const theses = await this.thesisMap(
      oids(overdue.map((a) => a.thesisId)),
      EVALUATING,
    );
    let sent = 0;
    for (const a of overdue) {
      try {
        const thesis = theses.get(String(a.thesisId));
        if (!thesis || submitted.has(String(a._id))) continue;
        if (
          a.overdueNotifiedAt &&
          (every === 0 ||
            businessDaysBetween(a.overdueNotifiedAt, now, holidays) < every)
        )
          continue;
        const entityRef = { kind: 'assignment', id: String(a._id) };
        const notified = await this.claimAndNotify(
          a,
          'overdueNotifiedAt',
          now,
          async () => {
            await this.notifications.notify([String(a.jurorId)], {
              type: ALERT_NOTIFICATION_TYPES.EVALUATION_OVERDUE,
              title: 'Tu concepto está vencido',
              body: `Su concepto de la tesis ${thesis.label} está vencido. Envíelo lo antes posible.`,
              link: `/juror/evaluation/${String(a._id)}`,
              entityRef,
            });
            await this.notifications.notifyRole(Role.COORDINATOR, {
              type: ALERT_NOTIFICATION_TYPES.EVALUATION_OVERDUE,
              title: 'Concepto de jurado vencido',
              body: `El concepto de un jurado de la tesis ${thesis.label} está vencido.`,
              link: `/coordinator/theses/${String(a.thesisId)}`,
              entityRef,
            });
          },
        );
        if (notified) sent++;
      } catch (err) {
        this.logger.error(
          `overdueEvaluations: assignment ${String(a._id)} failed: ${msg(err)}`,
        );
      }
    }
    return sent;
  }

  /**
   * Reminds the juror once when `reminderBusinessDaysBefore` business days or fewer remain:
   * PENDING assignments before responseDeadline, ACCEPTED ones (no SUBMITTED evaluation, thesis
   * UNDER_EVALUATION / IN_DISPUTE) before evaluationDeadline.
   */
  async deadlineReminders(now = new Date()): Promise<number> {
    const settings = await this.settings.get();
    const holidays = new Set(settings.holidays);
    const within = settings.reminderBusinessDaysBefore;
    const due = (deadline?: Date): deadline is Date =>
      !!deadline &&
      deadline >= now &&
      businessDaysRemaining(now, deadline, holidays) <= within;
    return (
      (await this.responseReminders(now, holidays, due)) +
      (await this.evaluationReminders(now, holidays, due))
    );
  }

  private async responseReminders(
    now: Date,
    holidays: ReadonlySet<string>,
    due: (d?: Date) => boolean,
  ): Promise<number> {
    const pending = (
      await this.assignments
        .find({
          status: AssignmentStatus.PENDING,
          isActive: true,
          responseDeadline: { $gte: now },
          responseReminderSentAt: { $exists: false },
        })
        .lean()
        .exec()
    ).filter((a) => due(a.responseDeadline));
    const theses = await this.thesisMap(oids(pending.map((a) => a.thesisId)));
    let sent = 0;
    for (const a of pending) {
      try {
        const thesis = theses.get(String(a.thesisId));
        // A SUBMITTED thesis holds a CU-01 in flight: its assignments are not live yet.
        if (!thesis || thesis.status === ThesisStatus.SUBMITTED) continue;
        const left = businessDaysRemaining(now, a.responseDeadline, holidays);
        const notified = await this.claimAndNotify(
          a,
          'responseReminderSentAt',
          now,
          () =>
            this.notifications.notify([String(a.jurorId)], {
              type: ALERT_NOTIFICATION_TYPES.RESPONSE_REMINDER,
              title: 'Recordatorio: responde tu asignación',
              body: `Te quedan ${daysText(left)} para aceptar o rechazar la asignación como jurado de la tesis ${thesis.label}.`,
              link: '/juror',
              entityRef: { kind: 'assignment', id: String(a._id) },
            }),
        );
        if (notified) sent++;
      } catch (err) {
        this.logger.error(
          `deadlineReminders: assignment ${String(a._id)} failed: ${msg(err)}`,
        );
      }
    }
    return sent;
  }

  private async evaluationReminders(
    now: Date,
    holidays: ReadonlySet<string>,
    due: (d?: Date) => boolean,
  ): Promise<number> {
    const accepted = (
      await this.assignments
        .find({
          status: AssignmentStatus.ACCEPTED,
          isActive: true,
          evaluationDeadline: { $gte: now },
          evaluationReminderSentAt: { $exists: false },
        })
        .lean()
        .exec()
    ).filter((a) => due(a.evaluationDeadline));
    if (!accepted.length) return 0;
    const submitted = await this.submittedAssignmentIds(
      accepted.map((a) => a._id),
    );
    const theses = await this.thesisMap(
      oids(accepted.map((a) => a.thesisId)),
      EVALUATING,
    );
    let sent = 0;
    for (const a of accepted) {
      try {
        const thesis = theses.get(String(a.thesisId));
        if (!thesis || submitted.has(String(a._id))) continue;
        const left = businessDaysRemaining(
          now,
          a.evaluationDeadline as Date,
          holidays,
        );
        const notified = await this.claimAndNotify(
          a,
          'evaluationReminderSentAt',
          now,
          () =>
            this.notifications.notify([String(a.jurorId)], {
              type: ALERT_NOTIFICATION_TYPES.EVALUATION_REMINDER,
              title: 'Recordatorio: plazo de evaluación',
              body: `Te quedan ${daysText(left)} para enviar tu concepto de la tesis ${thesis.label}.`,
              link: `/juror/evaluation/${String(a._id)}`,
              entityRef: { kind: 'assignment', id: String(a._id) },
            }),
        );
        if (notified) sent++;
      } catch (err) {
        this.logger.error(
          `deadlineReminders: assignment ${String(a._id)} failed: ${msg(err)}`,
        );
      }
    }
    return sent;
  }

  /**
   * Sugerencia 10: a SUBMITTED evaluation that the student neither viewed nor downloaded, once
   * `unseenConceptAlertDays` business days have elapsed since it was submitted, alerts the
   * coordinators one single time (`unseenAlertSentAt`).
   */
  async unseenConceptAlerts(now = new Date()): Promise<number> {
    const settings = await this.settings.get();
    const holidays = new Set(settings.holidays);
    const days = settings.unseenConceptAlertDays;
    const unseen = {
      unseenAlertSentAt: { $exists: false },
      studentFirstViewedAt: { $exists: false },
      studentFirstDownloadedAt: { $exists: false },
    };
    const candidates = (
      await this.evaluations
        .find({
          status: EvaluationStatus.SUBMITTED,
          submittedAt: { $lte: now },
          ...unseen,
        })
        .lean()
        .exec()
    ).filter(
      (e) =>
        e.submittedAt &&
        businessDaysBetween(e.submittedAt, now, holidays) >= days,
    );
    if (!candidates.length) return 0;
    const theses = await this.thesisMap(
      oids(candidates.map((e) => e.thesisId)),
    );
    let sent = 0;
    for (const e of candidates) {
      try {
        const thesis = theses.get(String(e.thesisId));
        if (!thesis) continue;
        const claimed = await this.evaluations
          .updateOne(
            { _id: e._id, ...unseen },
            { $set: { unseenAlertSentAt: now } },
          )
          .exec();
        if (claimed.modifiedCount !== 1) continue;
        try {
          await this.notifications.notifyRole(Role.COORDINATOR, {
            type: ALERT_NOTIFICATION_TYPES.CONCEPT_UNSEEN,
            title: 'El estudiante no ha consultado el concepto',
            body: `El estudiante de la tesis ${thesis.label} no ha consultado ni descargado el concepto de un jurado, emitido hace ${daysText(days)} o más.`,
            link: `/coordinator/theses/${String(e.thesisId)}`,
            entityRef: { kind: 'evaluation', id: String(e._id) },
          });
          sent++;
        } catch (err) {
          await this.evaluations
            .updateOne({ _id: e._id }, { $unset: { unseenAlertSentAt: 1 } })
            .exec();
          throw err;
        }
      } catch (err) {
        this.logger.error(
          `unseenConceptAlerts: evaluation ${String(e._id)} failed: ${msg(err)}`,
        );
      }
    }
    return sent;
  }
}
