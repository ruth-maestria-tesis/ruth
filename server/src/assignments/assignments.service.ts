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
import { QueryMyAssignmentsDto } from './dto/respond.dto';
import { externalAccessUrl, newExternalToken } from './external-token';
import {
  CandidateUser,
  JurorCandidate,
  JuryViolationItem,
  ThesisParties,
  validateJury,
} from './jury.rules';
import { Assignment, AssignmentDocument } from './schemas/assignment.schema';

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
    return this.views(docs, { withThesis: true });
  }

  async findOneView(id: string, user: AuthUser): Promise<AssignmentView> {
    const doc = await this.findViewable(id, user);
    const [view] = await this.views([doc], {
      withThesis: true,
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
    opts: { withJuror?: boolean; withThesis?: boolean } = {},
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
      thesis: theses?.get(d.thesisId.toHexString()),
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
          type: AssignmentType.PRIMARY,
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
