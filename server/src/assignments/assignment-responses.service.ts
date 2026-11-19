import { HttpStatus, Injectable } from '@nestjs/common';
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
import { AssignmentsService, thesisStatusError } from './assignments.service';
import { Assignment, AssignmentDocument } from './schemas/assignment.schema';
import { isWorkflowRace } from './workflow-race';

/**
 * Thesis statuses in which a juror may answer. A SUBMITTED thesis only holds assignments while
 * a CU-01 is in flight (or orphans of a failed one, cleared by the next CU-01): they must stay
 * PENDING and active so that cleanup still finds them.
 */
const RESPONDING_THESIS_STATUSES: readonly ThesisStatus[] = [
  ThesisStatus.JURORS_ASSIGNED,
  ThesisStatus.PENDING_JUROR_REPLACEMENT,
];

const notPending = () =>
  new AppException(
    ErrorCode.ASSIGNMENT_NOT_PENDING,
    HttpStatus.CONFLICT,
    'The assignment was already answered',
  );

@Injectable()
export class AssignmentResponsesService {
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
    if (!updated) throw notPending();
    this.assignments.emit(ASSIGNMENT_EVENTS.ACCEPTED, updated, actor);
    await this.advanceIfJuryAccepted(updated.thesisId, actor);
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
    if (!updated) throw notPending();
    this.assignments.emit(ASSIGNMENT_EVENTS.DECLINED, updated, actor, reason);
    await this.markNeedsReplacement(
      updated.thesisId,
      actor,
      'CU-08 FA-01: juror declined',
    );
    const [view] = await this.assignments.views([updated]);
    return view;
  }

  /**
   * CU-08 FA-02. Called hourly by the scheduler (stage 8). Returns how many expired.
   * Assignments of theses outside RESPONDING_THESIS_STATUSES (a CU-01 in flight or its
   * orphans) are left alone.
   */
  async expirePending(now = new Date()): Promise<number> {
    const overdue = await this.model
      .find({
        status: AssignmentStatus.PENDING,
        responseDeadline: { $lt: now },
      })
      .exec();
    if (!overdue.length) return 0;
    const responding = new Set(
      (
        await this.theses.findManyByIds([
          ...new Set(overdue.map((a) => a.thesisId.toHexString())),
        ])
      )
        .filter((t) => RESPONDING_THESIS_STATUSES.includes(t.status))
        .map((t) => t.id as string),
    );
    let expired = 0;
    for (const a of overdue) {
      if (!responding.has(a.thesisId.toHexString())) continue;
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
      await this.markNeedsReplacement(
        updated.thesisId,
        SYSTEM_ACTOR,
        'CU-08 FA-02: response deadline expired',
      );
    }
    return expired;
  }

  private async assertRespondable(
    a: AssignmentDocument,
    now: Date,
  ): Promise<void> {
    if (a.status !== AssignmentStatus.PENDING) throw notPending();
    if (a.responseDeadline < now) {
      throw new AppException(
        ErrorCode.ASSIGNMENT_DEADLINE_PASSED,
        HttpStatus.CONFLICT,
        'The response deadline has passed',
      );
    }
    const thesis = await this.theses.findById(a.thesisId.toHexString());
    if (!RESPONDING_THESIS_STATUSES.includes(thesis.status))
      throw thesisStatusError(thesis.status);
  }

  /** Both primary jurors accepted → UNDER_EVALUATION. A losing concurrent accept is ignored. */
  private async advanceIfJuryAccepted(
    thesisId: Types.ObjectId,
    actor: Actor,
  ): Promise<void> {
    const accepted = await this.model
      .countDocuments({
        thesisId,
        type: AssignmentType.PRIMARY,
        status: AssignmentStatus.ACCEPTED,
      })
      .exec();
    if (accepted < 2) return;
    try {
      await this.workflow.transition({
        thesisId: thesisId.toHexString(),
        expectedFrom: RESPONDING_THESIS_STATUSES,
        to: ThesisStatus.UNDER_EVALUATION,
        actor,
        reason: 'CU-08: both jurors accepted',
      });
    } catch (e) {
      if (!isWorkflowRace(e)) throw e;
    }
  }

  /** JURORS_ASSIGNED → PENDING_JUROR_REPLACEMENT; no-op when the thesis is already waiting. */
  private async markNeedsReplacement(
    thesisId: Types.ObjectId,
    actor: Actor,
    reason: string,
  ): Promise<void> {
    try {
      await this.workflow.transition({
        thesisId: thesisId.toHexString(),
        expectedFrom: [ThesisStatus.JURORS_ASSIGNED],
        to: ThesisStatus.PENDING_JUROR_REPLACEMENT,
        actor,
        reason,
      });
    } catch (e) {
      if (!isWorkflowRace(e)) throw e;
    }
  }
}
