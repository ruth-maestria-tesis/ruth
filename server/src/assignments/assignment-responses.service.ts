import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AssignmentStatus,
  AssignmentType,
  ErrorCode,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { addBusinessDays } from '../common/time/business-days';
import { Actor, actorFrom, SYSTEM_ACTOR } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { SettingsService } from '../settings/settings.service';
import { ThesesService } from '../theses/theses.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ASSIGNMENT_EVENTS } from './assignment.events';
import { AssignmentView } from './assignment-view';
import {
  assignmentNotFound,
  AssignmentsService,
  thesisStatusError,
} from './assignments.service';
import { Assignment, AssignmentDocument } from './schemas/assignment.schema';
import { isWorkflowRace } from './workflow-race';

/** Thesis statuses in which the primary jury is still being formed (not both accepted yet). */
const JURY_FORMING_STATUSES: readonly ThesisStatus[] = [
  ThesisStatus.JURORS_ASSIGNED,
  ThesisStatus.PENDING_JUROR_REPLACEMENT,
];

const notPending = () =>
  new AppException(
    ErrorCode.ASSIGNMENT_NOT_PENDING,
    HttpStatus.CONFLICT,
    'The assignment was already answered',
  );

const deadlinePassed = () =>
  new AppException(
    ErrorCode.ASSIGNMENT_DEADLINE_PASSED,
    HttpStatus.CONFLICT,
    'The response deadline has passed',
  );

/** Why an assignment can no longer be answered (expired wins over "already answered"). */
const responseError = (
  a: Pick<Assignment, 'status' | 'responseDeadline'>,
  now: Date,
): AppException | undefined => {
  if (
    a.status === AssignmentStatus.EXPIRED ||
    (a.status === AssignmentStatus.PENDING && a.responseDeadline < now)
  )
    return deadlinePassed();
  if (a.status !== AssignmentStatus.PENDING) return notPending();
  return undefined;
};

const stack = (e: unknown) => (e instanceof Error ? e.stack : String(e));

@Injectable()
export class AssignmentResponsesService {
  private readonly logger = new Logger(AssignmentResponsesService.name);

  constructor(
    @InjectModel(Assignment.name) private readonly model: Model<Assignment>,
    private readonly assignments: AssignmentsService,
    private readonly theses: ThesesService,
    private readonly workflow: WorkflowService,
    private readonly settings: SettingsService,
  ) {}

  /** CU-08 main flow. */
  async accept(id: string, user: AuthUser): Promise<AssignmentView> {
    const actor = actorFrom(user, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR);
    const current = await this.assignments.findOwnedByJuror(id, user);
    const now = new Date();
    await this.assertRespondable(current, now);
    const settings = await this.settings.get();
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: current._id,
          status: AssignmentStatus.PENDING,
          responseDeadline: { $gte: now },
        },
        {
          $set: {
            status: AssignmentStatus.ACCEPTED,
            respondedAt: now,
            evaluationDeadline: addBusinessDays(
              now,
              settings.evaluationBusinessDays,
              new Set(settings.holidays),
            ),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw await this.lostResponseError(current._id, now);
    this.assignments.emit(ASSIGNMENT_EVENTS.ACCEPTED, updated, actor);
    // A tiebreaker accepting changes nothing on the thesis (it stays IN_DISPUTE).
    if (updated.type === AssignmentType.PRIMARY)
      await this.afterWrite(updated, 'advance to UNDER_EVALUATION', () =>
        this.advanceIfJuryAccepted(updated.thesisId, actor),
      );
    const [view] = await this.assignments.views([updated]);
    return view;
  }

  /** CU-08 FA-01. */
  async decline(
    id: string,
    user: AuthUser,
    reason: string,
  ): Promise<AssignmentView> {
    const actor = actorFrom(user, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR);
    const current = await this.assignments.findOwnedByJuror(id, user);
    const now = new Date();
    await this.assertRespondable(current, now);
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: current._id,
          status: AssignmentStatus.PENDING,
          responseDeadline: { $gte: now },
        },
        {
          $set: {
            status: AssignmentStatus.DECLINED,
            isActive: false,
            respondedAt: now,
            declineReason: reason,
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw await this.lostResponseError(current._id, now);
    this.assignments.emit(ASSIGNMENT_EVENTS.DECLINED, updated, actor, reason);
    // A declined tiebreaker leaves the thesis IN_DISPUTE; the coordinator designates another.
    if (updated.type === AssignmentType.PRIMARY)
      await this.afterWrite(updated, 'mark PENDING_JUROR_REPLACEMENT', () =>
        this.markNeedsReplacement(
          updated.thesisId,
          actor,
          'CU-08 FA-01: juror declined',
        ),
      );
    const [view] = await this.assignments.views([updated]);
    return view;
  }

  /**
   * CU-08 FA-02. Called hourly by the scheduler (stage 8). Returns how many expired.
   * Assignments of a SUBMITTED thesis (a CU-01 in flight, or its orphans) are left alone.
   * Also reconciles theses whose advance to UNDER_EVALUATION was lost after both accepts, and
   * JURORS_ASSIGNED theses with an empty primary slot (a lost PENDING_JUROR_REPLACEMENT).
   */
  async expirePending(now = new Date()): Promise<number> {
    const overdue = await this.model
      .find({
        status: AssignmentStatus.PENDING,
        responseDeadline: { $lt: now },
      })
      .exec();
    const submitted = new Set(
      (
        await this.theses.findManyByIds([
          ...new Set(overdue.map((a) => a.thesisId.toHexString())),
        ])
      )
        .filter((t) => t.status === ThesisStatus.SUBMITTED)
        .map((t) => t.id as string),
    );
    let expired = 0;
    for (const a of overdue) {
      if (submitted.has(a.thesisId.toHexString())) continue;
      const updated = await this.model
        .findOneAndUpdate(
          { _id: a._id, status: AssignmentStatus.PENDING },
          { $set: { status: AssignmentStatus.EXPIRED, isActive: false } },
          { new: true },
        )
        .exec();
      if (!updated) continue;
      expired++;
      this.assignments.emit(
        ASSIGNMENT_EVENTS.EXPIRED,
        updated,
        SYSTEM_ACTOR,
        'Response deadline expired',
      );
      if (updated.type !== AssignmentType.PRIMARY) continue;
      await this.afterWrite(
        updated,
        'mark PENDING_JUROR_REPLACEMENT',
        () =>
          this.markNeedsReplacement(
            updated.thesisId,
            SYSTEM_ACTOR,
            'CU-08 FA-02: response deadline expired',
          ),
        false,
      );
    }
    await this.reconcileAcceptedJuries();
    await this.reconcileEmptySlots();
    return expired;
  }

  private async assertRespondable(
    a: AssignmentDocument,
    now: Date,
  ): Promise<void> {
    const error = responseError(a, now);
    if (error) throw error;
    const thesis = await this.theses.findById(a.thesisId.toHexString());
    // SUBMITTED only holds assignments of a CU-01 in flight or its orphans; they must stay
    // PENDING and active so that the orphan cleanup still finds them.
    if (thesis.status === ThesisStatus.SUBMITTED)
      throw thesisStatusError(thesis.status);
  }

  /** The conditional update matched nothing: answer from what is stored now. */
  private async lostResponseError(
    id: Types.ObjectId,
    now: Date,
  ): Promise<AppException> {
    const fresh = await this.model
      .findById(id, { status: 1, responseDeadline: 1 })
      .exec();
    if (!fresh) return assignmentNotFound();
    return responseError(fresh, now) ?? notPending();
  }

  /**
   * Runs the thesis step that follows a committed assignment write. A failure is logged with
   * the ids (the assignment change stays); `rethrow` decides whether the caller sees it.
   */
  private async afterWrite(
    a: AssignmentDocument,
    step: string,
    fn: () => Promise<void>,
    rethrow = true,
  ): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(
        `Assignment ${a.id as string} (thesis ${a.thesisId.toHexString()}) was saved as ${a.status} but the thesis step "${step}" failed`,
        stack(e),
      );
      if (rethrow) throw e;
    }
  }

  /** Both active primary jurors accepted → UNDER_EVALUATION. A losing concurrent accept is ignored. */
  private async advanceIfJuryAccepted(
    thesisId: Types.ObjectId,
    actor: Actor,
  ): Promise<void> {
    const accepted = await this.model
      .countDocuments({
        thesisId,
        type: AssignmentType.PRIMARY,
        status: AssignmentStatus.ACCEPTED,
        isActive: true,
      })
      .exec();
    if (accepted < 2) return;
    try {
      await this.workflow.transition({
        thesisId: thesisId.toHexString(),
        expectedFrom: JURY_FORMING_STATUSES,
        to: ThesisStatus.UNDER_EVALUATION,
        actor,
        reason: 'CU-08: both jurors accepted',
      });
    } catch (e) {
      if (!isWorkflowRace(e)) throw e;
    }
  }

  /**
   * JURORS_ASSIGNED → PENDING_JUROR_REPLACEMENT; no-op when the thesis is already waiting.
   * If the transition loses a race (e.g. a replacement moved the thesis back to
   * JURORS_ASSIGNED meanwhile) and a primary slot is still empty, it is retried once.
   */
  private async markNeedsReplacement(
    thesisId: Types.ObjectId,
    actor: Actor,
    reason: string,
  ): Promise<void> {
    const attempt = async (): Promise<boolean> => {
      try {
        await this.workflow.transition({
          thesisId: thesisId.toHexString(),
          expectedFrom: [ThesisStatus.JURORS_ASSIGNED],
          to: ThesisStatus.PENDING_JUROR_REPLACEMENT,
          actor,
          reason,
        });
        return true;
      } catch (e) {
        if (!isWorkflowRace(e)) throw e;
        return false;
      }
    };
    if (await attempt()) return;
    const thesis = await this.theses.findById(thesisId.toHexString());
    if (thesis.status !== ThesisStatus.JURORS_ASSIGNED) return;
    const active = await this.model
      .countDocuments({
        thesisId,
        type: AssignmentType.PRIMARY,
        isActive: true,
      })
      .exec();
    if (active < 2) await attempt();
  }

  /** Heals a lost advance: theses still forming a jury whose two active primaries accepted. */
  private async reconcileAcceptedJuries(): Promise<void> {
    const forming = await this.theses.findIdsByStatuses(JURY_FORMING_STATUSES);
    if (!forming.length) return;
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId }>([
        {
          $match: {
            thesisId: { $in: forming },
            type: AssignmentType.PRIMARY,
            status: AssignmentStatus.ACCEPTED,
            isActive: true,
          },
        },
        { $group: { _id: '$thesisId', n: { $sum: 1 } } },
        { $match: { n: { $gte: 2 } } },
      ])
      .exec();
    for (const { _id: thesisId } of rows) {
      try {
        await this.advanceIfJuryAccepted(thesisId, SYSTEM_ACTOR);
      } catch (e) {
        this.logger.error(
          `Reconcile: thesis ${thesisId.toHexString()} could not advance to UNDER_EVALUATION`,
          stack(e),
        );
      }
    }
  }

  /** Heals a lost PENDING_JUROR_REPLACEMENT: JURORS_ASSIGNED theses with < 2 active primaries. */
  private async reconcileEmptySlots(): Promise<void> {
    const assigned = await this.theses.findIdsByStatuses([
      ThesisStatus.JURORS_ASSIGNED,
    ]);
    if (!assigned.length) return;
    const full = new Set(
      (
        await this.model
          .aggregate<{ _id: Types.ObjectId }>([
            {
              $match: {
                thesisId: { $in: assigned },
                type: AssignmentType.PRIMARY,
                isActive: true,
              },
            },
            { $group: { _id: '$thesisId', n: { $sum: 1 } } },
            { $match: { n: { $gte: 2 } } },
          ])
          .exec()
      ).map((r) => r._id.toHexString()),
    );
    for (const thesisId of assigned) {
      if (full.has(thesisId.toHexString())) continue;
      try {
        // Races (e.g. a replacement filling the slot meanwhile) are no-ops in there.
        await this.markNeedsReplacement(
          thesisId,
          SYSTEM_ACTOR,
          'Reconcile: a primary juror slot is empty',
        );
      } catch (e) {
        this.logger.error(
          `Reconcile: thesis ${thesisId.toHexString()} could not move to PENDING_JUROR_REPLACEMENT`,
          stack(e),
        );
      }
    }
  }
}
