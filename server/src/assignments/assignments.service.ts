import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  AssignmentStatus,
  AssignmentType,
  ErrorCode,
  isExternalOnly,
  JuryViolation,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { FilterQuery, isObjectIdOrHexString, Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { addBusinessDays } from '../common/time/business-days';
import type { Actor } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { SettingsService } from '../settings/settings.service';
import { ThesisDocument } from '../theses/schemas/thesis.schema';
import { ThesesService } from '../theses/theses.service';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  canViewAssignment,
  isAssignmentOwner,
} from './assignment-access.policy';
import { AssignmentEvent, ASSIGNMENT_EVENTS } from './assignment.events';
import {
  AssignmentView,
  JurorSummary,
  ThesisSummary,
  toAssignmentView,
} from './assignment-view';
import {
  CreateAssignmentsDto,
  ValidateAssignmentsDto,
} from './dto/create-assignments.dto';
import { JurorInputDto } from './dto/juror-input.dto';
import { ReplaceAssignmentDto } from './dto/replace-assignment.dto';
import { QueryMyAssignmentsDto } from './dto/respond.dto';
import { AssignTiebreakerDto } from './dto/tiebreaker.dto';
import { externalAccessUrl, newExternalToken } from './external-token';
import {
  CandidateUser,
  JurorCandidate,
  JuryViolationItem,
  ThesisParties,
  validateJury,
} from './jury.rules';
import { Assignment, AssignmentDocument } from './schemas/assignment.schema';
import { isWorkflowRace } from './workflow-race';

export interface ExternalLink {
  assignmentId: string;
  url: string;
  expiresAt: Date;
}

export interface JuryResult {
  assignments: AssignmentView[];
  externalLinks: ExternalLink[];
}

/** What one call wrote, so a failure can undo exactly that and nothing else. */
interface Created {
  assignmentIds: Types.ObjectId[];
  createdUserIds: string[];
}

interface JuryHistory {
  /** Every juror ever assigned to the thesis. */
  previousJurorIds: Set<string>;
  hasActive: boolean;
}

/**
 * A SUBMITTED thesis only holds active assignments while a CU-01 is in flight. Older ones are
 * left over from a call that died between the insert and the transition (or failed to
 * compensate) and are cleared by the next CU-01.
 */
export const ORPHAN_ASSIGNMENT_GRACE_MS = 5 * 60_000;

/** An inline juror is created by the same call, moments before its assignment. */
const INLINE_JUROR_WINDOW_MS = 60_000;

const duplicateKeyFields = (e: unknown): string[] | undefined => {
  const err = e as { code?: number; keyPattern?: Record<string, unknown> };
  return err?.code === 11000 ? Object.keys(err.keyPattern ?? {}) : undefined;
};

export const assignmentNotFound = () =>
  new AppException(
    ErrorCode.ASSIGNMENT_NOT_FOUND,
    HttpStatus.NOT_FOUND,
    'Assignment not found',
  );

const assignmentConflict = () =>
  new AppException(
    ErrorCode.ASSIGNMENT_CONFLICT,
    HttpStatus.CONFLICT,
    'The jury changed concurrently',
  );

/** RF-C13 broken by a concurrent fill of the other slot; same details shape as assertValid. */
const unicordobaConflict = () =>
  new AppException(
    ErrorCode.ASSIGNMENT_CONFLICT,
    HttpStatus.CONFLICT,
    'The jury changed concurrently and now lacks a Universidad de Córdoba juror',
    { violations: [{ code: JuryViolation.JUROR_UNICORDOBA_REQUIRED }] },
  );

const notReplaceable = (message: string) =>
  new AppException(
    ErrorCode.ASSIGNMENT_NOT_REPLACEABLE,
    HttpStatus.CONFLICT,
    message,
  );

export const thesisStatusError = (status: ThesisStatus) =>
  new AppException(
    ErrorCode.ASSIGNMENT_THESIS_STATUS,
    HttpStatus.CONFLICT,
    `Not allowed while the thesis is ${status}`,
    { status },
  );

/** Hydrated documents always carry the `id` getter; mongoose types it as optional. */
const withId = (d: AssignmentDocument) =>
  d as AssignmentDocument & { id: string };

const partiesOf = (t: ThesisDocument): ThesisParties => ({
  studentId: t.studentId.toHexString(),
  advisorId: t.advisorId.toHexString(),
  coAdvisorIds: t.coAdvisorIds.map((x) => x.toHexString()),
  conflictOfInterestUserIds: t.conflictOfInterestUserIds.map((x) =>
    x.toHexString(),
  ),
});

const candidateUser = (u: UserDocument): CandidateUser => ({
  isActive: u.isActive,
  roles: u.roles,
  isUnicordoba: !!u.jurorProfile?.isUnicordoba,
});

const jurorSummary = (u: UserDocument): JurorSummary => ({
  id: u.id as string,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  roles: u.roles,
  institution: u.jurorProfile?.institution,
  isUnicordoba: u.jurorProfile?.isUnicordoba,
});

const jurorVisibleSummary = (
  a: AssignmentDocument,
  summary: ThesisSummary | undefined,
): ThesisSummary | undefined =>
  ACTIVE_ASSIGNMENT_STATUSES.includes(a.status) &&
  summary?.status !== ThesisStatus.SUBMITTED
    ? summary
    : undefined;

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    @InjectModel(Assignment.name) private readonly model: Model<Assignment>,
    private readonly theses: ThesesService,
    private readonly users: UsersService,
    private readonly workflow: WorkflowService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- CU-01

  /** Live validation for the assignment form; saves nothing. */
  async validate(
    dto: ValidateAssignmentsDto,
  ): Promise<{ valid: boolean; violations: JuryViolationItem[] }> {
    const thesis = await this.theses.findById(dto.thesisId);
    const candidates = await this.resolveCandidates(dto.jurors, (i) => i + 1);
    const { previousJurorIds } = await this.juryHistory(thesis._id);
    const violations = validateJury({
      candidates,
      parties: partiesOf(thesis),
      previousJurorIds,
      required: 2,
      requireUnicordoba: true,
    });
    return { valid: violations.length === 0, violations };
  }

  async assignJury(
    thesisId: string,
    dto: CreateAssignmentsDto,
    actor: Actor,
  ): Promise<JuryResult> {
    const thesis = await this.theses.findById(thesisId);
    if (thesis.status !== ThesisStatus.SUBMITTED)
      throw thesisStatusError(thesis.status);
    if (!thesis.currentManuscriptId) {
      throw new AppException(
        ErrorCode.THESIS_MANUSCRIPT_REQUIRED,
        HttpStatus.CONFLICT,
        'Upload the manuscript before assigning jurors',
      );
    }
    const candidates = await this.resolveCandidates(dto.jurors, (i) => i + 1);
    await this.clearOrphanJury(thesis._id);
    // A SUBMITTED thesis with (recent) active assignments means a concurrent CU-01 got there
    // first; answering 409 here keeps its jurors from showing up as JUROR_PREVIOUSLY_ASSIGNED.
    const history = await this.juryHistory(thesis._id);
    if (history.hasActive) throw assignmentConflict();
    this.assertValid(
      validateJury({
        candidates,
        parties: partiesOf(thesis),
        previousJurorIds: history.previousJurorIds,
        required: 2,
        requireUnicordoba: true,
      }),
    );

    const settings = await this.settings.get();
    const days = dto.responseBusinessDays ?? settings.acceptanceBusinessDays;
    const { docs, created } = await this.persist(
      thesis._id,
      dto.jurors.map((input, i) => ({ slot: i + 1, input })),
      days,
      new Set(settings.holidays),
      actor,
    );
    try {
      await this.workflow.transition({
        thesisId,
        expectedFrom: [ThesisStatus.SUBMITTED],
        to: ThesisStatus.JURORS_ASSIGNED,
        actor,
        reason: 'CU-01',
      });
    } catch (err) {
      await this.compensate(created);
      throw err;
    }
    for (const d of docs) this.emit(ASSIGNMENT_EVENTS.CREATED, d, actor);
    const externalLinks = await this.linksForExternalJurors(docs);
    return {
      assignments: await this.views(docs, { withJuror: true }),
      externalLinks,
    };
  }

  async listForThesis(thesisId: string): Promise<AssignmentView[]> {
    const thesis = await this.theses.findById(thesisId);
    const docs = await this.model
      .find({ thesisId: thesis._id })
      .sort({ slot: 1, assignedAt: 1 })
      .exec();
    return this.views(docs, { withJuror: true });
  }

  // ---------------------------------------------------------------- replacement

  /**
   * Replaces a PENDING, DECLINED or EXPIRED primary juror while the jury is being formed
   * (spec §4 PENDING_JUROR_REPLACEMENT). RN-01 and the juror history apply to the newcomer;
   * RF-C13 applies once the jury has two jurors.
   */
  async replace(
    thesisId: string,
    dto: ReplaceAssignmentDto,
    actor: Actor,
  ): Promise<{ assignment: AssignmentView; externalLink?: ExternalLink }> {
    const thesis = await this.theses.findById(thesisId);
    // Never on SUBMITTED: there, active assignments are taken as CU-01 orphans.
    if (
      thesis.status !== ThesisStatus.JURORS_ASSIGNED &&
      thesis.status !== ThesisStatus.PENDING_JUROR_REPLACEMENT
    ) {
      throw thesisStatusError(thesis.status);
    }
    const old = isObjectIdOrHexString(dto.assignmentId)
      ? await this.model
          .findOne({
            _id: dto.assignmentId,
            thesisId: thesis._id,
            type: AssignmentType.PRIMARY,
          })
          .exec()
      : null;
    if (!old) throw assignmentNotFound();
    const replaceable =
      old.status === AssignmentStatus.PENDING ||
      ((old.status === AssignmentStatus.DECLINED ||
        old.status === AssignmentStatus.EXPIRED) &&
        !old.replacedById);
    if (!replaceable)
      throw notReplaceable(`A ${old.status} assignment cannot be replaced`);

    const others = await this.activePrimaries(thesis._id, old._id);
    const kept = new Map(
      (
        await this.users.findManyByIds(
          others.map((o) => o.jurorId.toHexString()),
        )
      ).map((u) => [u.id as string, u]),
    );
    const [candidate] = await this.resolveCandidates(
      [dto.juror],
      () => old.slot,
    );
    const candidates: JurorCandidate[] = [
      ...others.map((o): JurorCandidate => {
        const id = o.jurorId.toHexString();
        const u = kept.get(id);
        return {
          slot: o.slot,
          key: id,
          userId: id,
          user: u ? candidateUser(u) : undefined,
          keep: true,
        };
      }),
      candidate,
    ];
    const { previousJurorIds } = await this.juryHistory(thesis._id);
    this.assertValid(
      validateJury({
        candidates,
        parties: partiesOf(thesis),
        previousJurorIds,
        required: candidates.length,
        requireUnicordoba: candidates.length === 2,
      }),
    );

    const settings = await this.settings.get();
    const persisted = await this.persistReplacement(old, dto, settings, actor);
    const doc = await this.syncJuryStatus(
      thesis._id,
      old,
      persisted.doc,
      persisted.created,
      actor,
    );

    this.emit(
      ASSIGNMENT_EVENTS.REPLACED,
      old,
      actor,
      `Replaced by ${doc.id as string}`,
    );
    this.emit(ASSIGNMENT_EVENTS.CREATED, doc, actor);
    // The replacement is committed: a failed link is logged, not an error. The coordinator
    // can generate a new one (POST /assignments/:id/external-link).
    let link: ExternalLink | undefined;
    try {
      [link] = await this.linksForExternalJurors([doc]);
    } catch (err) {
      this.logger.error(
        `Assignment ${doc.id as string} was created but its external link could not be generated`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    const [view] = await this.views([doc], { withJuror: true });
    return { assignment: view, externalLink: link };
  }

  private activePrimaries(
    thesisId: Types.ObjectId,
    exceptId?: Types.ObjectId,
  ): Promise<AssignmentDocument[]> {
    const filter: FilterQuery<Assignment> = {
      thesisId,
      type: AssignmentType.PRIMARY,
      isActive: true,
    };
    if (exceptId) filter._id = { $ne: exceptId };
    return this.model.find(filter).exec();
  }

  /**
   * Marks the old assignment first (conditional, so two replacements of one slot cannot both
   * win and the loser creates nothing), then inserts the new one under the pre-generated id.
   * The slot has to be freed before the insert: a PENDING old assignment still holds the
   * (thesisId, slot) unique index. Until the insert lands the slot looks empty, which
   * markNeedsReplacement and syncJuryStatus both tolerate.
   */
  private async persistReplacement(
    old: AssignmentDocument,
    dto: ReplaceAssignmentDto,
    settings: { acceptanceBusinessDays: number; holidays: string[] },
    actor: Actor,
  ): Promise<{ doc: AssignmentDocument; created: Created }> {
    const newId = new Types.ObjectId();
    const marked =
      old.status === AssignmentStatus.PENDING
        ? await this.model
            .updateOne(
              { _id: old._id, status: AssignmentStatus.PENDING },
              {
                $set: {
                  status: AssignmentStatus.REPLACED,
                  isActive: false,
                  replacedById: newId,
                },
              },
            )
            .exec()
        : await this.model
            .updateOne(
              {
                _id: old._id,
                status: old.status,
                replacedById: { $exists: false },
              },
              { $set: { replacedById: newId } },
            )
            .exec();
    if (marked.modifiedCount === 0)
      throw notReplaceable('The assignment changed concurrently');
    try {
      // persist() removes what it created (inline user included) when it fails.
      const { docs, created } = await this.persist(
        old.thesisId,
        [{ slot: old.slot, input: dto.juror }],
        dto.responseBusinessDays ?? settings.acceptanceBusinessDays,
        new Set(settings.holidays),
        actor,
        newId,
      );
      return { doc: docs[0], created };
    } catch (err) {
      await this.restoreOld(old, newId);
      throw err;
    }
  }

  /**
   * After the insert: re-checks RF-C13 on the jury as stored (a concurrent replacement of the
   * other slot was validated without this juror), moves PENDING_JUROR_REPLACEMENT →
   * JURORS_ASSIGNED once both slots are active, and moves it back if a slot emptied
   * concurrently. Races on the thesis status are no-ops.
   *
   * When the undo finds that the newcomer already answered, the replacement stands (the
   * juror acted on it) and the current assignment is returned instead of an error.
   */
  private async syncJuryStatus(
    thesisId: Types.ObjectId,
    old: AssignmentDocument,
    doc: AssignmentDocument,
    created: Created,
    actor: Actor,
  ): Promise<AssignmentDocument> {
    const active = await this.activePrimaries(thesisId);
    if (active.length >= 2) {
      const jurors = await this.users.findManyByIds(
        active.map((a) => a.jurorId.toHexString()),
      );
      if (!jurors.some((u) => u.jurorProfile?.isUnicordoba)) {
        if (await this.undoReplacement(old, doc._id, created))
          throw unicordobaConflict();
        // Kept: go on so the thesis status still matches the stored jury.
        this.logger.error(
          `Thesis ${thesisId.toHexString()} kept a jury without a Universidad de Córdoba juror: assignment ${doc.id as string} was already answered`,
        );
        doc = (await this.model.findById(doc._id).exec()) ?? doc;
      }
      try {
        await this.workflow.transition({
          thesisId: thesisId.toHexString(),
          expectedFrom: [ThesisStatus.PENDING_JUROR_REPLACEMENT],
          to: ThesisStatus.JURORS_ASSIGNED,
          actor,
          reason: 'Juror replaced',
        });
      } catch (e) {
        if (!isWorkflowRace(e)) {
          if (await this.undoReplacement(old, doc._id, created)) throw e;
          this.logger.error(
            `Thesis ${thesisId.toHexString()} could not move to JURORS_ASSIGNED after replacement ${doc.id as string}, which was already answered and stays`,
            e instanceof Error ? e.stack : String(e),
          );
          return (await this.model.findById(doc._id).exec()) ?? doc;
        }
      }
    }
    // A decline/expiry that ran while the slot was being filled may have found the thesis
    // already waiting and left it; with the thesis now JURORS_ASSIGNED it would be hidden.
    try {
      if ((await this.activePrimaries(thesisId)).length >= 2) return doc;
      await this.workflow.transition({
        thesisId: thesisId.toHexString(),
        expectedFrom: [ThesisStatus.JURORS_ASSIGNED],
        to: ThesisStatus.PENDING_JUROR_REPLACEMENT,
        actor,
        reason: 'A juror slot emptied during the replacement',
      });
    } catch (e) {
      // The replacement itself is stored; the hourly expirePending run reconciles
      // JURORS_ASSIGNED theses with an empty slot.
      if (!isWorkflowRace(e)) {
        this.logger.error(
          `Thesis ${thesisId.toHexString()} may show JURORS_ASSIGNED with an empty juror slot`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }
    return doc;
  }

  /**
   * Deletes the new assignment only while it is still PENDING, then the inline user and the
   * mark on the old one. Returns false (and changes nothing) when the newcomer already
   * answered or the delete failed: the replacement then stands. Never throws.
   */
  private async undoReplacement(
    old: AssignmentDocument,
    newId: Types.ObjectId,
    created: Created,
  ): Promise<boolean> {
    try {
      const res = await this.model
        .deleteOne({ _id: newId, status: AssignmentStatus.PENDING })
        .exec();
      if (res.deletedCount === 0) {
        this.logger.warn(
          `Replacement ${newId.toHexString()} was already answered; it is kept`,
        );
        return false;
      }
    } catch (err) {
      this.logger.error(
        `Could not undo replacement ${newId.toHexString()}; it is kept`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
    // compensate() keeps the inline user if something else references it.
    await this.compensate({
      assignmentIds: [],
      createdUserIds: created.createdUserIds,
    });
    await this.restoreOld(old, newId);
    return true;
  }

  /** Reverts the mark, but only if it is still this call's (replacedById = newId). Never throws. */
  private async restoreOld(
    old: AssignmentDocument,
    newId: Types.ObjectId,
  ): Promise<void> {
    try {
      await this.model
        .updateOne(
          { _id: old._id, replacedById: newId },
          old.status === AssignmentStatus.PENDING
            ? {
                $set: { status: AssignmentStatus.PENDING, isActive: true },
                $unset: { replacedById: 1 },
              }
            : { $unset: { replacedById: 1 } },
        )
        .exec();
    } catch (err) {
      this.logger.error(
        `Could not restore assignment ${old.id as string} after a failed replacement (${newId.toHexString()})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  // ---------------------------------------------------------------- CU-05 tiebreaker

  /**
   * CU-05: slot 3, TIEBREAKER, PENDING on an IN_DISPUTE thesis. RN-01 applies, and the juror
   * history rule keeps out the primary jurors (and earlier tiebreakers). The thesis status
   * does not change; a decline or expiry leaves it IN_DISPUTE for another designation.
   */
  async assignTiebreaker(
    thesisId: string,
    dto: AssignTiebreakerDto,
    actor: Actor,
  ): Promise<{ assignment: AssignmentView; externalLink?: ExternalLink }> {
    const thesis = await this.theses.findById(thesisId);
    if (thesis.status !== ThesisStatus.IN_DISPUTE)
      throw thesisStatusError(thesis.status);
    const active = await this.model
      .exists({
        thesisId: thesis._id,
        type: AssignmentType.TIEBREAKER,
        isActive: true,
      })
      .exec();
    if (active) throw assignmentConflict();
    const input: JurorInputDto = {
      jurorId: dto.jurorId,
      newExternal: dto.newExternal,
    };
    const candidates = await this.resolveCandidates([input], () => 3);
    const { previousJurorIds } = await this.juryHistory(thesis._id);
    this.assertValid(
      validateJury({
        candidates,
        parties: partiesOf(thesis),
        previousJurorIds,
        required: 1,
        requireUnicordoba: false,
      }),
    );
    const settings = await this.settings.get();
    // The partial unique (thesisId, slot) index turns a concurrent second designation into 409.
    const { docs } = await this.persist(
      thesis._id,
      [{ slot: 3, input }],
      dto.responseBusinessDays ?? settings.acceptanceBusinessDays,
      new Set(settings.holidays),
      actor,
      undefined,
      AssignmentType.TIEBREAKER,
    );
    const [doc] = docs;
    this.emit(ASSIGNMENT_EVENTS.CREATED, doc, actor);
    let link: ExternalLink | undefined;
    try {
      [link] = await this.linksForExternalJurors([doc]);
    } catch (err) {
      this.logger.error(
        `Tiebreaker ${doc.id as string} was created but its external link could not be generated`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    const [view] = await this.views([doc], { withJuror: true });
    return { assignment: view, externalLink: link };
  }

  // ---------------------------------------------------------------- CU-08 lists

  /** The juror's own assignments (a scoped session only sees its scope), newest first. */
  async findMine(
    user: AuthUser,
    query: QueryMyAssignmentsDto,
  ): Promise<AssignmentView[]> {
    const filter: FilterQuery<Assignment> = { jurorId: user.id };
    if (query.status) filter.status = query.status;
    if (user.scope) filter._id = { $in: user.scope.assignmentIds };
    const docs = await this.model
      .find(filter)
      .sort({ assignedAt: -1, _id: -1 })
      .exec();
    return this.views(docs, { withThesis: 'jurorScoped' });
  }

  async findOneView(id: string, user: AuthUser): Promise<AssignmentView> {
    const doc = await this.findViewable(id, user);
    const staff =
      !user.scope &&
      (user.roles.includes(Role.ADMIN) ||
        user.roles.includes(Role.COORDINATOR));
    const [view] = await this.views([doc], {
      withThesis: staff ? true : 'jurorScoped',
      withJuror: true,
    });
    return view;
  }

  // ---------------------------------------------------------------- shared helpers

  async findById(id: string): Promise<AssignmentDocument> {
    const doc = isObjectIdOrHexString(id)
      ? await this.model.findById(id).exec()
      : null;
    if (!doc) throw assignmentNotFound();
    return doc;
  }

  /** The assigned juror (and, for scoped sessions, only assignments in scope); 404 otherwise. */
  async findOwnedByJuror(
    id: string,
    user: AuthUser,
  ): Promise<AssignmentDocument> {
    const doc = await this.findById(id);
    if (!isAssignmentOwner(user, withId(doc))) throw assignmentNotFound();
    return doc;
  }

  async findViewable(id: string, user: AuthUser): Promise<AssignmentDocument> {
    const doc = await this.findById(id);
    if (!canViewAssignment(user, withId(doc))) throw assignmentNotFound();
    return doc;
  }

  async views(
    docs: readonly AssignmentDocument[],
    opts: {
      withJuror?: boolean;
      /**
       * 'jurorScoped': only for PENDING/ACCEPTED assignments on a thesis past SUBMITTED, the
       * cases in which the juror may read the thesis (thesis-access policy).
       */
      withThesis?: boolean | 'jurorScoped';
    } = {},
  ): Promise<AssignmentView[]> {
    const now = new Date();
    const holidays = await this.settings.holidaySet();
    const jurors = opts.withJuror
      ? new Map(
          (
            await this.users.findManyByIds(
              docs.map((d) => d.jurorId.toHexString()),
            )
          ).map((u) => [u.id as string, jurorSummary(u)]),
        )
      : undefined;
    const theses = opts.withThesis
      ? await this.thesisSummaries(docs.map((d) => d.thesisId.toHexString()))
      : undefined;
    return docs.map((d) => ({
      ...toAssignmentView(withId(d), now, holidays),
      juror: jurors?.get(d.jurorId.toHexString()),
      thesis:
        opts.withThesis === 'jurorScoped'
          ? jurorVisibleSummary(d, theses?.get(d.thesisId.toHexString()))
          : theses?.get(d.thesisId.toHexString()),
    }));
  }

  emit(
    event: string,
    a: AssignmentDocument,
    actor: Actor,
    reason?: string,
  ): void {
    const payload: AssignmentEvent = {
      assignmentId: a.id as string,
      thesisId: a.thesisId.toHexString(),
      jurorId: a.jurorId.toHexString(),
      actorId: actor.id,
      actorRole: actor.role,
      reason,
      at: new Date(),
    };
    this.events.emit(event, payload);
  }

  private assertValid(violations: JuryViolationItem[]): void {
    if (violations.length) {
      throw new AppException(
        ErrorCode.ASSIGNMENT_INVALID_COMPOSITION,
        HttpStatus.BAD_REQUEST,
        'The proposed jury breaks the assignment rules',
        { violations },
      );
    }
  }

  /** Loads users and taken emails in two queries; position i gets slot slotOf(i). */
  private async resolveCandidates(
    inputs: readonly JurorInputDto[],
    slotOf: (i: number) => number,
  ): Promise<JurorCandidate[]> {
    if (inputs.some((input) => !!input.jurorId === !!input.newExternal)) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Each juror needs exactly one of jurorId or newExternal',
      );
    }
    const ids = inputs.flatMap((i) =>
      i.jurorId ? [i.jurorId.toLowerCase()] : [],
    );
    const emails = inputs.flatMap((i) =>
      i.newExternal ? [i.newExternal.email.toLowerCase()] : [],
    );
    const [users, taken] = await Promise.all([
      this.users.findManyByIds(ids),
      this.users.findManyByEmails(emails),
    ]);
    const byId = new Map(users.map((u) => [u.id as string, u]));
    const takenEmails = new Set(taken.map((u) => u.email));
    return inputs.map((input, i): JurorCandidate => {
      const slot = slotOf(i);
      if (input.newExternal) {
        const email = input.newExternal.email.toLowerCase();
        return {
          slot,
          key: `new:${email}`,
          newExternal: { emailTaken: takenEmails.has(email) },
        };
      }
      const userId = input.jurorId!.toLowerCase();
      const user = byId.get(userId);
      return {
        slot,
        key: userId,
        userId,
        user: user ? candidateUser(user) : undefined,
      };
    });
  }

  /** One query, so "already has an active jury" and the juror history come from the same read. */
  private async juryHistory(thesisId: Types.ObjectId): Promise<JuryHistory> {
    const rows = await this.model
      .find({ thesisId }, { jurorId: 1, isActive: 1 })
      .lean()
      .exec();
    return {
      previousJurorIds: new Set(rows.map((r) => r.jurorId.toHexString())),
      hasActive: rows.some((r) => r.isActive),
    };
  }

  /**
   * Creates inline external jurors, then the assignments. The partial unique indexes make a
   * concurrent second jury fail here; everything this call created is then removed.
   */
  private async persist(
    thesisId: Types.ObjectId,
    slots: readonly { slot: number; input: JurorInputDto }[],
    days: number,
    holidays: ReadonlySet<string>,
    actor: Actor,
    /** Pre-generated id for a single-slot insert (replacement marks the old assignment first). */
    firstId?: Types.ObjectId,
    type: AssignmentType = AssignmentType.PRIMARY,
  ): Promise<{ docs: AssignmentDocument[]; created: Created }> {
    // `new Types.ObjectId(undefined)` would silently record a random assigner.
    if (!actor.id) throw new Error('Assigning jurors requires an actor id');
    const assignedBy = new Types.ObjectId(actor.id);
    const created: Created = {
      assignmentIds: slots.map((_, i) =>
        i === 0 && firstId ? firstId : new Types.ObjectId(),
      ),
      createdUserIds: [],
    };
    try {
      const jurorIds: string[] = [];
      for (const { input } of slots) {
        if (input.newExternal) {
          const user = await this.users.createExternalJuror(input.newExternal);
          created.createdUserIds.push(user.id as string);
          jurorIds.push(user.id as string);
        } else {
          jurorIds.push(input.jurorId!.toLowerCase());
        }
      }
      const now = new Date();
      const responseDeadline = addBusinessDays(now, days, holidays);
      const docs = await this.model.insertMany(
        slots.map(({ slot }, i) => ({
          _id: created.assignmentIds[i],
          thesisId,
          jurorId: new Types.ObjectId(jurorIds[i]),
          type,
          slot,
          status: AssignmentStatus.PENDING,
          isActive: true,
          assignedAt: now,
          assignedBy,
          responseDeadline,
        })),
      );
      return { docs, created };
    } catch (err) {
      await this.compensate(created);
      const dupFields = duplicateKeyFields(err);
      if (dupFields?.includes('email')) {
        // Another request created a user with this email after validation.
        throw new AppException(
          ErrorCode.USER_EMAIL_TAKEN,
          HttpStatus.CONFLICT,
          'Email already registered',
        );
      }
      if (dupFields) throw assignmentConflict();
      throw err;
    }
  }

  /**
   * Deletes only what this call created (pre-generated assignment ids, inline users). Never
   * throws, so the original error reaches the caller; a failure is logged and the leftovers
   * are cleared by the next CU-01 (see clearOrphanJury).
   */
  private async compensate(created: Created): Promise<void> {
    const assignmentIds = created.assignmentIds.map((id) => id.toHexString());
    try {
      await this.model
        .deleteMany({ _id: { $in: created.assignmentIds } })
        .exec();
    } catch (err) {
      // Keep the users too: deleting them would leave the assignments pointing at nothing.
      this.logger.error(
        `Compensation failed: assignments [${assignmentIds.join(', ')}] and users [${created.createdUserIds.join(', ')}] were not deleted`,
        err instanceof Error ? err.stack : String(err),
      );
      return;
    }
    if (!created.createdUserIds.length) return;
    try {
      // Another request may have picked an inline user in the meantime; keep it then.
      const referenced = new Set(
        (
          await this.model
            .distinct('jurorId', {
              jurorId: {
                $in: created.createdUserIds.map((id) => new Types.ObjectId(id)),
              },
            })
            .exec()
        ).map((id) => String(id)),
      );
      const unreferenced = created.createdUserIds.filter(
        (id) => !referenced.has(id),
      );
      if (unreferenced.length) await this.users.deleteByIds(unreferenced);
    } catch (err) {
      this.logger.error(
        `Compensation failed: users [${created.createdUserIds.join(', ')}] were not deleted`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Removes active assignments a failed CU-01 left on a SUBMITTED thesis (older than
   * ORPHAN_ASSIGNMENT_GRACE_MS), with the inline external jurors created for them. Recent ones
   * may belong to a request still in flight: they are kept and the caller answers 409.
   */
  private async clearOrphanJury(thesisId: Types.ObjectId): Promise<void> {
    const rows = await this.model
      .find({ thesisId, isActive: true }, { jurorId: 1, createdAt: 1 })
      .lean<
        { _id: Types.ObjectId; jurorId: Types.ObjectId; createdAt: Date }[]
      >()
      .exec();
    if (!rows.length) return;
    const cutoff = Date.now() - ORPHAN_ASSIGNMENT_GRACE_MS;
    if (rows.some((r) => r.createdAt.getTime() > cutoff))
      throw assignmentConflict();

    const createdAtByJuror = new Map(
      rows.map((r) => [r.jurorId.toHexString(), r.createdAt.getTime()]),
    );
    const jurors = await this.users.findManyByIds([...createdAtByJuror.keys()]);
    const inlineUserIds = jurors
      .filter((u) => {
        const assignedAt = createdAtByJuror.get(u.id as string)!;
        const userCreatedAt = (
          u.get('createdAt') as Date | undefined
        )?.getTime();
        return (
          isExternalOnly(u.roles) &&
          userCreatedAt !== undefined &&
          userCreatedAt <= assignedAt &&
          userCreatedAt >= assignedAt - INLINE_JUROR_WINDOW_MS
        );
      })
      .map((u) => u.id as string);
    const assignmentIds = rows.map((r) => r._id);
    this.logger.warn(
      `Clearing orphan jury of thesis ${thesisId.toHexString()}: assignments [${assignmentIds.map((id) => id.toHexString()).join(', ')}], inline users [${inlineUserIds.join(', ')}]`,
    );
    // compensate() keeps any inline user another assignment still references.
    await this.compensate({ assignmentIds, createdUserIds: inlineUserIds });
  }

  private async thesisSummaries(
    ids: readonly string[],
  ): Promise<Map<string, ThesisSummary>> {
    const theses = await this.theses.findManyByIds([...new Set(ids)]);
    const advisors = new Map(
      (
        await this.users.findManyByIds(
          theses.map((t) => t.advisorId.toHexString()),
        )
      ).map((u) => [u.id as string, `${u.firstName} ${u.lastName}`]),
    );
    return new Map(
      theses.map((t) => [
        t.id as string,
        {
          id: t.id as string,
          code: t.code,
          title: t.title,
          abstract: t.abstract,
          studentName: t.studentName,
          advisorName: advisors.get(t.advisorId.toHexString()),
          programId: t.programId.toHexString(),
          status: t.status,
          progress: t.progress,
        },
      ]),
    );
  }

  // ---------------------------------------------------------------- RF-J14 links

  private async linksForExternalJurors(
    docs: readonly AssignmentDocument[],
  ): Promise<ExternalLink[]> {
    const jurors = await this.users.findManyByIds(
      docs.map((d) => d.jurorId.toHexString()),
    );
    const external = new Set(
      jurors.filter((u) => isExternalOnly(u.roles)).map((u) => u.id as string),
    );
    const links: ExternalLink[] = [];
    for (const d of docs) {
      if (external.has(d.jurorId.toHexString()))
        links.push(await this.rotateLink(d));
    }
    return links;
  }

  /** RF-J14: rotate the link of an external juror's active assignment (coordinator copies it). */
  async issueExternalLink(id: string): Promise<ExternalLink> {
    const a = await this.findById(id);
    const [juror] = await this.users.findManyByIds([a.jurorId.toHexString()]);
    if (!juror || !isExternalOnly(juror.roles)) {
      throw new AppException(
        ErrorCode.ASSIGNMENT_NOT_EXTERNAL,
        HttpStatus.CONFLICT,
        'The juror is not external',
      );
    }
    return this.rotateLink(a);
  }

  /** Active assignment whose live token hash matches. */
  findByExternalTokenHash(
    hash: string,
    now = new Date(),
  ): Promise<AssignmentDocument | null> {
    return this.model
      .findOne({
        externalTokenHash: hash,
        externalTokenExpiresAt: { $gt: now },
        status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
      })
      .exec();
  }

  /** New token for an active assignment; the previous link stops working. */
  async rotateLink(a: AssignmentDocument): Promise<ExternalLink> {
    const { token, hash } = newExternalToken();
    const days = Number(this.config.get('EXTERNAL_TOKEN_TTL_DAYS', 60));
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const res = await this.model
      .updateOne(
        { _id: a._id, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } },
        {
          $set: { externalTokenHash: hash, externalTokenExpiresAt: expiresAt },
        },
      )
      .exec();
    if (res.matchedCount === 0) {
      throw new AppException(
        ErrorCode.ASSIGNMENT_NOT_PENDING,
        HttpStatus.CONFLICT,
        'Assignment is no longer active',
      );
    }
    // Keep the in-memory document in step so views built from it report the live link.
    a.externalTokenExpiresAt = expiresAt;
    return {
      assignmentId: a.id as string,
      url: externalAccessUrl(
        this.config.get<string>('CLIENT_URL', 'http://localhost:3000'),
        token,
      ),
      expiresAt,
    };
  }
}
