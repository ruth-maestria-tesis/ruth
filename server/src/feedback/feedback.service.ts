import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  ErrorCode,
  FeedbackAction,
  FeedbackChapter,
  FeedbackStatus,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model, Types } from 'mongoose';
import { isWorkflowRace } from '../assignments/workflow-race';
import { AppException } from '../common/errors/app.exception';
import { Actor, actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { ThesisDocument } from '../theses/schemas/thesis.schema';
import { canReadThesis } from '../theses/thesis-access.policy';
import { ThesesService } from '../theses/theses.service';
import { UsersService } from '../users/users.service';
import { WorkflowService } from '../workflow/workflow.service';
import { CreateFeedbackDto, QueryFeedbackDto } from './dto/feedback.dto';
import { FEEDBACK_EVENTS, FeedbackEvent } from './feedback.events';
import {
  CHAPTER_ORDER,
  FEEDBACK_CLOSED_STATUSES,
  FEEDBACK_OPEN_STATUSES,
  FEEDBACK_TRANSITIONS,
} from './feedback.rules';
import {
  FeedbackItem,
  FeedbackItemDocument,
} from './schemas/feedback-item.schema';

export interface FeedbackReplyView {
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  fileIds: string[];
  action: FeedbackAction;
  at: Date;
}

export interface FeedbackItemView {
  id: string;
  thesisId: string;
  jurorId: string;
  juror: { id: string; firstName: string; lastName: string } | null;
  chapter: FeedbackChapter;
  reference?: string;
  content: string;
  status: FeedbackStatus;
  replies: FeedbackReplyView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedbackSummary {
  total: number;
  byStatus: Record<FeedbackStatus, number>;
  byChapter: Record<FeedbackChapter, { total: number; resolved: number }>;
}

/** What the user may do on a thesis's feedback; computed once per request. */
interface FeedbackAccess {
  thesis: ThesisDocument;
  isStudent: boolean;
  /** Has an ACCEPTED assignment on the thesis (scope-limited). */
  isJuror: boolean;
}

const READER_ROLES = [
  Role.COORDINATOR,
  Role.ADMIN,
  Role.INTERNAL_JUROR,
  Role.EXTERNAL_JUROR,
  Role.STUDENT,
];

const notFound = () =>
  new AppException(
    ErrorCode.FEEDBACK_NOT_FOUND,
    HttpStatus.NOT_FOUND,
    'Feedback not found',
  );

const forbidden = (message: string) =>
  new AppException(ErrorCode.AUTH_FORBIDDEN, HttpStatus.FORBIDDEN, message);

const invalidTransition = (status: FeedbackStatus, action: FeedbackAction) =>
  new AppException(
    ErrorCode.FEEDBACK_INVALID_TRANSITION,
    HttpStatus.CONFLICT,
    `Cannot ${action} an item that is ${status}`,
    { status, action },
  );

const assertNotClosed = (thesis: ThesisDocument) => {
  if (FEEDBACK_CLOSED_STATUSES.includes(thesis.status)) {
    throw new AppException(
      ErrorCode.FEEDBACK_THESIS_STATUS,
      HttpStatus.CONFLICT,
      `Feedback is closed while the thesis is ${thesis.status}`,
      { status: thesis.status },
    );
  }
};

const withId = (d: FeedbackItemDocument) =>
  d as FeedbackItemDocument & { id: string; createdAt: Date; updatedAt: Date };

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectModel(FeedbackItem.name)
    private readonly model: Model<FeedbackItem>,
    private readonly theses: ThesesService,
    private readonly users: UsersService,
    private readonly workflow: WorkflowService,
    private readonly events: EventEmitter2,
  ) {}

  /** Items not yet RESOLVED (RN-08 and the REVISIONS → READY rule). */
  countUnresolved(thesisId: string | Types.ObjectId): Promise<number> {
    return this.model
      .countDocuments({
        thesisId: new Types.ObjectId(String(thesisId)),
        status: { $ne: FeedbackStatus.RESOLVED },
      })
      .exec();
  }

  async list(
    thesisId: string,
    query: QueryFeedbackDto,
    user: AuthUser,
  ): Promise<FeedbackItemView[]> {
    const { thesis } = await this.access(thesisId, user);
    const filter: FilterQuery<FeedbackItem> = { thesisId: thesis._id };
    if (query.chapter) filter.chapter = query.chapter;
    if (query.status) filter.status = query.status;
    const docs = await this.model.find(filter).sort({ createdAt: 1 }).exec();
    docs.sort(
      (a, b) =>
        CHAPTER_ORDER.indexOf(a.chapter) - CHAPTER_ORDER.indexOf(b.chapter),
    );
    return this.views(docs);
  }

  async summary(thesisId: string, user: AuthUser): Promise<FeedbackSummary> {
    const { thesis } = await this.access(thesisId, user);
    const rows = await this.model
      .find({ thesisId: thesis._id }, { chapter: 1, status: 1 })
      .lean()
      .exec();
    const byStatus = Object.fromEntries(
      Object.values(FeedbackStatus).map((s) => [s, 0]),
    ) as Record<FeedbackStatus, number>;
    const byChapter = Object.fromEntries(
      CHAPTER_ORDER.map((c) => [c, { total: 0, resolved: 0 }]),
    ) as FeedbackSummary['byChapter'];
    for (const r of rows) {
      byStatus[r.status]++;
      byChapter[r.chapter].total++;
      if (r.status === FeedbackStatus.RESOLVED) byChapter[r.chapter].resolved++;
    }
    return { total: rows.length, byStatus, byChapter };
  }

  /** RN-06: a juror with an ACCEPTED assignment creates a PENDING item. */
  async create(
    thesisId: string,
    dto: CreateFeedbackDto,
    user: AuthUser,
  ): Promise<FeedbackItemView> {
    const ctx = await this.access(thesisId, user);
    if (!ctx.isJuror)
      throw forbidden('Only a juror of the thesis can add feedback');
    if (!FEEDBACK_OPEN_STATUSES.includes(ctx.thesis.status)) {
      throw new AppException(
        ErrorCode.FEEDBACK_THESIS_STATUS,
        HttpStatus.CONFLICT,
        `Feedback cannot be added while the thesis is ${ctx.thesis.status}`,
        { status: ctx.thesis.status },
      );
    }
    const doc = await this.model.create({
      thesisId: ctx.thesis._id,
      jurorId: new Types.ObjectId(user.id),
      chapter: dto.chapter ?? FeedbackChapter.GENERAL,
      reference: dto.reference || undefined,
      content: dto.content,
      status: FeedbackStatus.PENDING,
    });
    this.emit(
      FEEDBACK_EVENTS.CREATED,
      doc,
      ctx.thesis,
      actorFrom(user, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR),
    );
    const [view] = await this.views([doc]);
    return view;
  }

  /** PENDING → ADDRESSED (the thesis student), ADDRESSED → RESOLVED | PENDING (the author). */
  async transition(
    id: string,
    action: Exclude<FeedbackAction, FeedbackAction.COMMENT>,
    content: string | undefined,
    user: AuthUser,
  ): Promise<FeedbackItemView> {
    const item = await this.findItem(id);
    const ctx = await this.access(item.thesisId.toHexString(), user, true);
    assertNotClosed(ctx.thesis);
    const rule = FEEDBACK_TRANSITIONS[action];
    const allowed =
      rule.by === 'STUDENT'
        ? ctx.isStudent
        : ctx.isJuror && item.jurorId.equals(user.id);
    if (!allowed) {
      throw forbidden(
        rule.by === 'STUDENT'
          ? 'Only the student of the thesis can address feedback'
          : 'Only the juror who wrote the item can do this',
      );
    }
    if (item.status !== rule.from) throw invalidTransition(item.status, action);

    const actor = actorFrom(
      user,
      ...(rule.by === 'STUDENT'
        ? [Role.STUDENT]
        : [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR]),
    );
    const updated = await this.model
      .findOneAndUpdate(
        { _id: item._id, status: rule.from },
        {
          $set: { status: rule.to },
          $push: { replies: await this.reply(user, actor, action, content) },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      const fresh = await this.findItem(id);
      throw invalidTransition(fresh.status, action);
    }

    const event = {
      [FeedbackAction.ADDRESS]: FEEDBACK_EVENTS.ADDRESSED,
      [FeedbackAction.RESOLVE]: FEEDBACK_EVENTS.RESOLVED,
      [FeedbackAction.REOPEN]: FEEDBACK_EVENTS.REOPENED,
    }[action];
    this.emit(event, updated, ctx.thesis, actor);
    if (action === FeedbackAction.RESOLVE)
      await this.readyIfAllResolved(updated.thesisId, actor);
    const [view] = await this.views([updated]);
    return view;
  }

  /** Any reader may comment; the status does not change. */
  async comment(
    id: string,
    content: string,
    user: AuthUser,
  ): Promise<FeedbackItemView> {
    const item = await this.findItem(id);
    const ctx = await this.access(item.thesisId.toHexString(), user, true);
    assertNotClosed(ctx.thesis);
    const actor = actorFrom(user, ...READER_ROLES);
    const updated = await this.model
      .findByIdAndUpdate(
        item._id,
        {
          $push: {
            replies: await this.reply(
              user,
              actor,
              FeedbackAction.COMMENT,
              content,
            ),
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw notFound();
    const [view] = await this.views([updated]);
    return view;
  }

  /**
   * Manual REVISIONS_IN_PROGRESS → READY_FOR_DEFENSE by the coordinator, for theses that
   * reached revisions with nothing (left) to resolve, e.g. APPROVED_WITH_CHANGES without items.
   */
  async markReadyForDefense(
    thesisId: string,
    user: AuthUser,
  ): Promise<ThesisDocument> {
    const thesis = await this.theses.findById(thesisId);
    if (thesis.status !== ThesisStatus.REVISIONS_IN_PROGRESS) {
      throw new AppException(
        ErrorCode.WORKFLOW_INVALID_TRANSITION,
        HttpStatus.CONFLICT,
        `Cannot move thesis from ${thesis.status} to ${ThesisStatus.READY_FOR_DEFENSE}`,
        { from: thesis.status, to: ThesisStatus.READY_FOR_DEFENSE },
      );
    }
    const unresolved = await this.countUnresolved(thesis._id);
    if (unresolved > 0) {
      throw new AppException(
        ErrorCode.FEEDBACK_INVALID_TRANSITION,
        HttpStatus.CONFLICT,
        'There are feedback items still unresolved',
        { unresolved },
      );
    }
    return this.workflow.transition({
      thesisId: thesis.id as string,
      expectedFrom: [ThesisStatus.REVISIONS_IN_PROGRESS],
      to: ThesisStatus.READY_FOR_DEFENSE,
      actor: actorFrom(user, Role.COORDINATOR),
      reason: 'Coordinator: no feedback left to resolve',
    });
  }

  /** REVISIONS_IN_PROGRESS → READY_FOR_DEFENSE once nothing is left to resolve. */
  private async readyIfAllResolved(
    thesisId: Types.ObjectId,
    actor: Actor,
  ): Promise<void> {
    const thesis = await this.theses.findById(thesisId.toHexString());
    if (thesis.status !== ThesisStatus.REVISIONS_IN_PROGRESS) return;
    if ((await this.countUnresolved(thesisId)) > 0) return;
    try {
      await this.workflow.transition({
        thesisId: thesisId.toHexString(),
        expectedFrom: [ThesisStatus.REVISIONS_IN_PROGRESS],
        to: ThesisStatus.READY_FOR_DEFENSE,
        actor,
        reason: 'RN-06: all feedback resolved',
      });
    } catch (e) {
      if (!isWorkflowRace(e)) {
        this.logger.error(
          `Thesis ${thesisId.toHexString()} could not move to READY_FOR_DEFENSE after the last feedback item was resolved`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }
  }

  private async reply(
    user: AuthUser,
    actor: Actor,
    action: FeedbackAction,
    content: string | undefined,
  ) {
    const author = await this.users.findById(user.id);
    return {
      authorId: new Types.ObjectId(user.id),
      authorName: `${author.firstName} ${author.lastName}`,
      authorRole: actor.role,
      content: content ?? '',
      fileIds: [],
      action,
      at: new Date(),
    };
  }

  private async findItem(id: string): Promise<FeedbackItemDocument> {
    const item = isValidObjectId(id)
      ? await this.model.findById(id).exec()
      : null;
    if (!item) throw notFound();
    return item;
  }

  /**
   * Readers: staff, the thesis student, jurors with an ACCEPTED assignment. Anyone else gets
   * 404 (THESIS_NOT_FOUND on thesis routes, FEEDBACK_NOT_FOUND on item routes).
   */
  private async access(
    thesisId: string,
    user: AuthUser,
    itemRoute = false,
  ): Promise<FeedbackAccess> {
    let thesis: ThesisDocument;
    try {
      thesis = await this.theses.findById(thesisId);
    } catch (e) {
      if (itemRoute) throw notFound();
      throw e;
    }
    const isStudent =
      !user.scope &&
      user.roles.includes(Role.STUDENT) &&
      thesis.studentId.equals(user.id);
    const isJuror =
      (await this.theses.jurorAccess(thesis._id, user)) === 'MANUSCRIPT';
    const staff = !user.scope && canReadThesis(user, thesis);
    if (!staff && !isJuror) {
      if (itemRoute) throw notFound();
      throw new AppException(
        ErrorCode.THESIS_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Thesis not found',
      );
    }
    return { thesis, isStudent, isJuror };
  }

  private emit(
    event: string,
    item: FeedbackItemDocument,
    thesis: ThesisDocument,
    actor: Actor,
  ): void {
    const payload: FeedbackEvent = {
      thesisId: item.thesisId.toHexString(),
      itemId: item.id as string,
      jurorId: item.jurorId.toHexString(),
      studentId: thesis.studentId.toHexString(),
      actor,
    };
    this.events.emit(event, payload);
  }

  private async views(
    docs: readonly FeedbackItemDocument[],
  ): Promise<FeedbackItemView[]> {
    const jurors = new Map(
      (
        await this.users.findManyByIds([
          ...new Set(docs.map((d) => d.jurorId.toHexString())),
        ])
      ).map((u) => [
        u.id as string,
        { id: u.id as string, firstName: u.firstName, lastName: u.lastName },
      ]),
    );
    return docs.map((raw) => {
      const d = withId(raw);
      return {
        id: d._id.toHexString(),
        thesisId: d.thesisId.toHexString(),
        jurorId: d.jurorId.toHexString(),
        juror: jurors.get(d.jurorId.toHexString()) ?? null,
        chapter: d.chapter,
        reference: d.reference,
        content: d.content,
        status: d.status,
        replies: d.replies.map((r) => ({
          authorId: r.authorId.toHexString(),
          authorName: r.authorName,
          authorRole: r.authorRole,
          content: r.content,
          fileIds: r.fileIds.map((f) => f.toHexString()),
          action: r.action,
          at: r.at,
        })),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    });
  }
}
