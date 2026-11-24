import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  AssignmentStatus,
  AssignmentType,
  ErrorCode,
  EvaluationStatus,
  EvaluationVerdict,
  FileKind,
  Role,
  StudentAccessType,
  ThesisStatus,
} from '@thesis/shared';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AssignmentView } from '../assignments/assignment-view';
import { AssignmentsService } from '../assignments/assignments.service';
import { AssignmentDocument } from '../assignments/schemas/assignment.schema';
import { isWorkflowRace } from '../assignments/workflow-race';
import { AppException } from '../common/errors/app.exception';
import { Actor, actorFrom, SYSTEM_ACTOR } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { FeedbackService } from '../feedback/feedback.service';
import { CompleteUploadDto, CreateUploadDto } from '../files/dto/upload.dto';
import { AllowedFileType } from '../files/file-type';
import {
  FilesService,
  OpenedFile,
  StoredFile,
  UploadInput,
  UploadTicket,
} from '../files/files.service';
import { ThesisDocument } from '../theses/schemas/thesis.schema';
import { ThesesService } from '../theses/theses.service';
import { UsersService } from '../users/users.service';
import { WorkflowService } from '../workflow/workflow.service';
import { SaveEvaluationDto } from './dto/evaluation.dto';
import {
  EVALUATING_STATUS,
  missingForSubmit,
  resolveVerdicts,
  rubricScore,
  verdictsFor,
} from './evaluation.rules';
import {
  EVALUATION_SUBMITTED,
  EvaluationSubmittedEvent,
} from './evaluation.events';
import { Evaluation, EvaluationDocument } from './schemas/evaluation.schema';

export interface EvaluationView {
  id: string;
  assignmentId: string;
  thesisId: string;
  jurorId: string;
  juror: {
    id: string;
    firstName: string;
    lastName: string;
    isUnicordoba: boolean;
  } | null;
  assignmentType: AssignmentType;
  rubric: {
    methodology?: number;
    relevance?: number;
    writingQuality?: number;
  } | null;
  score: number | null;
  verdict: EvaluationVerdict | null;
  comments: string;
  correctionFiles: {
    fileId: string;
    fileName: string;
    uploadedAt: Date;
    manuscriptVersion?: number;
  }[];
  status: EvaluationStatus;
  submittedAt?: Date;
  studentFirstViewedAt?: Date;
  studentFirstDownloadedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisputeView {
  thesisId: string;
  status: ThesisStatus;
  primary: EvaluationView[];
  tiebreaker: {
    assignment: AssignmentView;
    evaluation: EvaluationView | null;
  } | null;
}

/** How the user reads the evaluations of one thesis. */
type ReadMode = 'STAFF' | 'JUROR' | 'STUDENT';

const evaluationNotFound = () =>
  new AppException(
    ErrorCode.EVALUATION_NOT_FOUND,
    HttpStatus.NOT_FOUND,
    'Evaluation not found',
  );

const locked = () =>
  new AppException(
    ErrorCode.EVALUATION_LOCKED,
    HttpStatus.CONFLICT,
    'The evaluation was already submitted',
  );

const notAllowed = (message: string, details?: unknown) =>
  new AppException(
    ErrorCode.EVALUATION_NOT_ALLOWED,
    HttpStatus.CONFLICT,
    message,
    details,
  );

const notComplete = (details?: unknown) =>
  new AppException(
    ErrorCode.EVALUATION_NOT_COMPLETE,
    HttpStatus.CONFLICT,
    'The required evaluations are not all submitted yet',
    details,
  );

const CORRECTION_TYPES: readonly AllowedFileType[] = ['pdf', 'doc', 'docx'];

/**
 * Thesis statuses in which the juror may still upload the corrected document after
 * submitting the verdict (the student works on it during these stages).
 */
const CORRECTION_AFTER_SUBMIT_STATUSES: readonly ThesisStatus[] = [
  ThesisStatus.UNDER_EVALUATION,
  ThesisStatus.IN_DISPUTE,
  ThesisStatus.REVISIONS_IN_PROGRESS,
];

/** Blob prefix of an evaluation's correction files. */
const correctionScope = (e: EvaluationDocument) =>
  `corrections/${e._id.toHexString()}`;

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

const withMeta = (d: EvaluationDocument) =>
  d as EvaluationDocument & { id: string; createdAt: Date; updatedAt: Date };

@Injectable()
export class EvaluationsService {
  private readonly logger = new Logger(EvaluationsService.name);

  constructor(
    @InjectModel(Evaluation.name) private readonly model: Model<Evaluation>,
    private readonly assignments: AssignmentsService,
    private readonly theses: ThesesService,
    private readonly users: UsersService,
    private readonly files: FilesService,
    private readonly workflow: WorkflowService,
    private readonly feedback: FeedbackService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------- reads

  async listForThesis(
    thesisId: string,
    user: AuthUser,
  ): Promise<EvaluationView[]> {
    const thesis = await this.theses.findById(thesisId);
    const mode = await this.readMode(thesis, user);
    if (!mode) {
      throw new AppException(
        ErrorCode.THESIS_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Thesis not found',
      );
    }
    const docs = await this.model
      .find({ thesisId: thesis._id })
      .sort({ createdAt: 1 })
      .exec();
    return this.views(docs.filter((d) => this.visible(d, mode, user)));
  }

  /** The owner's own evaluation of an assignment, or null. */
  async findForAssignment(
    assignmentId: string,
    user: AuthUser,
  ): Promise<EvaluationView | null> {
    const a = await this.assignments.findOwnedByJuror(assignmentId, user);
    const doc = await this.model.findOne({ assignmentId: a._id }).exec();
    if (!doc) return null;
    const [view] = await this.views([doc]);
    return view;
  }

  /** Logs VIEW when the thesis student reads it (sugerencia 9). */
  async findOne(
    id: string,
    user: AuthUser,
    ip?: string,
  ): Promise<EvaluationView> {
    const found = await this.findReadableDoc(id, user);
    const evaluation =
      found.mode === 'STUDENT'
        ? await this.logAccess(found.evaluation, StudentAccessType.VIEW, ip)
        : found.evaluation;
    const [view] = await this.views([evaluation]);
    return view;
  }

  /** Correction file download; logs DOWNLOAD for the thesis student. */
  async openCorrection(
    id: string,
    fileId: string,
    user: AuthUser,
    ip?: string,
  ): Promise<OpenedFile> {
    const { evaluation, mode } = await this.findReadableDoc(id, user);
    if (!evaluation.correctionFiles.some((f) => f.fileId.equals(fileId))) {
      throw new AppException(
        ErrorCode.FILE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'File not found',
      );
    }
    const opened = await this.files.openDownload(fileId);
    if (mode === 'STUDENT')
      await this.logAccess(evaluation, StudentAccessType.DOWNLOAD, ip);
    return opened;
  }

  /** CU-05: both primary evaluations and the current tiebreaker, for the coordinator. */
  async dispute(thesisId: string): Promise<DisputeView> {
    const thesis = await this.theses.findById(thesisId);
    const docs = await this.model
      .find({ thesisId: thesis._id })
      .sort({ createdAt: 1 })
      .exec();
    const tbAssignments = (
      await this.assignments.listForThesis(thesisId)
    ).filter((a) => a.type === AssignmentType.TIEBREAKER);
    // The active one if any, otherwise the latest.
    const current =
      tbAssignments.find(
        (a) =>
          a.status === AssignmentStatus.PENDING ||
          a.status === AssignmentStatus.ACCEPTED,
      ) ?? tbAssignments.at(-1);
    const views = await this.views(docs);
    return {
      thesisId: thesis.id as string,
      status: thesis.status,
      primary: views.filter((v) => v.assignmentType === AssignmentType.PRIMARY),
      tiebreaker: current
        ? {
            assignment: current,
            evaluation:
              views.find((v) => v.assignmentId === current.id) ?? null,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------- CU-02 writes

  /** Draft upsert by the assignment owner; only the fields sent change. */
  async saveDraft(
    assignmentId: string,
    dto: SaveEvaluationDto,
    user: AuthUser,
  ): Promise<EvaluationView> {
    const a = await this.assignments.findOwnedByJuror(assignmentId, user);
    const existing = await this.model.findOne({ assignmentId: a._id }).exec();
    if (existing?.status === EvaluationStatus.SUBMITTED) throw locked();
    await this.assertCanEvaluate(a);
    if (dto.verdict && !verdictsFor(a.type).includes(dto.verdict)) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        `Verdict ${dto.verdict} is not allowed for a ${a.type} juror`,
        { allowed: verdictsFor(a.type) },
      );
    }

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1> = {};
    if (dto.rubric === null) {
      // null clears the rubric (and the score derived from it).
      $unset.rubric = 1;
      $unset.score = 1;
    } else if (dto.rubric) {
      const prev = existing?.rubric;
      const rubric = {
        methodology: dto.rubric.methodology ?? prev?.methodology,
        relevance: dto.rubric.relevance ?? prev?.relevance,
        writingQuality: dto.rubric.writingQuality ?? prev?.writingQuality,
      };
      $set.rubric = rubric;
      const score = rubricScore(rubric);
      if (score === null) $unset.score = 1;
      else $set.score = score;
    }
    if (dto.verdict === null) $unset.verdict = 1;
    else if (dto.verdict) $set.verdict = dto.verdict;
    if (dto.comments !== undefined) $set.comments = dto.comments ?? '';

    let doc: EvaluationDocument | null;
    try {
      doc = await this.model
        .findOneAndUpdate(
          { assignmentId: a._id, status: EvaluationStatus.DRAFT },
          {
            $set,
            ...(Object.keys($unset).length && { $unset }),
            $setOnInsert: {
              thesisId: a.thesisId,
              jurorId: a.jurorId,
              assignmentType: a.type,
            },
          },
          { upsert: true, new: true, runValidators: true },
        )
        .exec();
    } catch (e) {
      // The draft was submitted concurrently: the upsert then hits the unique assignmentId.
      if (isDuplicateKey(e)) throw locked();
      throw e;
    }
    const [view] = await this.views([doc]);
    return view;
  }

  /** Submits the draft (optionally saving the fields sent first), then runs RN-08. */
  async submit(
    assignmentId: string,
    dto: SaveEvaluationDto,
    user: AuthUser,
  ): Promise<EvaluationView> {
    if (Object.values(dto).some((v) => v !== undefined))
      await this.saveDraft(assignmentId, dto, user);
    const a = await this.assignments.findOwnedByJuror(assignmentId, user);
    const draft = await this.model.findOne({ assignmentId: a._id }).exec();
    if (draft?.status === EvaluationStatus.SUBMITTED) throw locked();
    await this.assertCanEvaluate(a);
    const missing = draft
      ? missingForSubmit(draft)
      : missingForSubmit({ assignmentType: a.type });
    if (!draft || missing.length) {
      throw new AppException(
        ErrorCode.EVALUATION_INCOMPLETE,
        HttpStatus.BAD_REQUEST,
        'The evaluation is incomplete',
        { missing },
      );
    }
    const submitted = await this.model
      .findOneAndUpdate(
        { _id: draft._id, status: EvaluationStatus.DRAFT },
        {
          $set: { status: EvaluationStatus.SUBMITTED, submittedAt: new Date() },
        },
        { new: true },
      )
      .exec();
    if (!submitted) throw locked();

    const actor = actorFrom(user, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR);
    // The evaluation is stored: a failed RN-08 is logged and left to reconcileOutcome
    // (coordinator endpoint, hourly scheduler pass).
    let resultingStatus: ThesisStatus | undefined;
    try {
      resultingStatus = (
        await this.reconcileOutcome(submitted.thesisId.toHexString(), actor)
      ).status;
    } catch (err) {
      // Not complete yet (the first primary): nothing to resolve, not a failure.
      if (!(
        err instanceof AppException &&
        err.code === ErrorCode.EVALUATION_NOT_COMPLETE
      ))
        this.logger.error(
          `Evaluation ${submitted.id as string} was submitted but RN-08 failed for thesis ${submitted.thesisId.toHexString()}`,
          err instanceof Error ? err.stack : String(err),
        );
      resultingStatus = await this.theses
        .findById(submitted.thesisId.toHexString())
        .then((t) => t.status)
        .catch(() => undefined);
    }
    const event: EvaluationSubmittedEvent = {
      thesisId: submitted.thesisId.toHexString(),
      evaluationId: submitted.id as string,
      jurorId: submitted.jurorId.toHexString(),
      verdict: submitted.verdict!,
      resultingStatus,
      actor,
    };
    this.events.emit(EVALUATION_SUBMITTED, event);
    const [view] = await this.views([submitted]);
    return view;
  }

  /**
   * Corrected document (pdf/doc/docx) by the author: while the evaluation is a draft, or
   * after submitting it while the thesis is still being evaluated or revised.
   */
  async addCorrection(
    id: string,
    file: UploadInput | undefined,
    user: AuthUser,
  ): Promise<EvaluationView> {
    const e = await this.findCorrectable(id, user);
    const stored = await this.files.upload(
      file,
      {
        ownerId: user.id,
        thesisId: e.thesisId.toHexString(),
        kind: FileKind.CORRECTION,
      },
      CORRECTION_TYPES,
    );
    return this.attachCorrection(e, stored);
  }

  /** Direct upload, step 1: same authorization as the multipart route. */
  async createCorrectionUpload(
    id: string,
    dto: CreateUploadDto,
    user: AuthUser,
  ): Promise<UploadTicket> {
    const e = await this.findCorrectable(id, user);
    return this.files.createUpload(correctionScope(e), dto, CORRECTION_TYPES);
  }

  /** Direct upload, step 3: re-authorizes, verifies the blob, then attaches it. */
  async completeCorrectionUpload(
    id: string,
    dto: CompleteUploadDto,
    user: AuthUser,
  ): Promise<EvaluationView> {
    const e = await this.findCorrectable(id, user);
    const stored = await this.files.completeUpload(
      correctionScope(e),
      dto,
      {
        ownerId: user.id,
        thesisId: e.thesisId.toHexString(),
        kind: FileKind.CORRECTION,
      },
      CORRECTION_TYPES,
    );
    return this.attachCorrection(e, stored);
  }

  /**
   * The author's own evaluation (within a scoped session's assignments) that still accepts
   * corrected documents: a draft, or a submitted one while the thesis is open.
   */
  private async findCorrectable(
    id: string,
    user: AuthUser,
  ): Promise<EvaluationDocument> {
    const e = await this.findDoc(id);
    const owner =
      e.jurorId.equals(user.id) &&
      (!user.scope ||
        user.scope.assignmentIds.includes(e.assignmentId.toHexString()));
    if (!owner) throw evaluationNotFound();
    if (e.status !== EvaluationStatus.DRAFT) {
      const thesis = await this.theses.findById(e.thesisId.toHexString());
      if (!CORRECTION_AFTER_SUBMIT_STATUSES.includes(thesis.status))
        throw locked();
    }
    return e;
  }

  /** Version number of the thesis' current manuscript, if any. */
  private async currentManuscriptVersion(
    thesisId: Types.ObjectId,
  ): Promise<number | undefined> {
    const thesis = await this.theses.findById(thesisId.toHexString());
    const current = thesis.currentManuscriptId;
    return current
      ? thesis.manuscripts.find((m) => m.fileId.equals(current))?.version
      : undefined;
  }

  private async attachCorrection(
    e: EvaluationDocument,
    stored: StoredFile,
  ): Promise<EvaluationView> {
    const manuscriptVersion = await this.currentManuscriptVersion(e.thesisId);
    const updated = await this.model
      .findOneAndUpdate(
        { _id: e._id },
        {
          $push: {
            correctionFiles: {
              fileId: new Types.ObjectId(stored.id),
              fileName: stored.fileName,
              uploadedAt: new Date(),
              manuscriptVersion,
            },
          },
        },
        { new: true },
      )
      .exec()
      .catch(async (err: unknown) => {
        await this.files.delete(stored.id).catch(() => undefined);
        throw err;
      });
    if (!updated) {
      await this.files.delete(stored.id).catch(() => undefined);
      throw locked();
    }
    const [view] = await this.views([updated]);
    return view;
  }

  // ---------------------------------------------------------------- RN-08

  /**
   * RN-08, from the stored evaluations: both primaries submitted, or the tiebreaker
   * submitted → next thesis status. Idempotent (`expectedFrom`): a thesis that already
   * moved is left as it is. 409 EVALUATION_NOT_COMPLETE while the evaluations are missing.
   */
  async reconcileOutcome(
    thesisId: string,
    actor: Actor,
  ): Promise<{ thesisId: string; status: ThesisStatus; changed: boolean }> {
    const thesis = await this.theses.findById(thesisId);
    const submitted = await this.model
      .find({ thesisId: thesis._id, status: EvaluationStatus.SUBMITTED })
      .sort({ submittedAt: 1 })
      .exec();
    const primary = submitted
      .filter((s) => s.assignmentType === AssignmentType.PRIMARY)
      .map((s) => s.verdict!);
    const tiebreaker = submitted
      .filter((s) => s.assignmentType === AssignmentType.TIEBREAKER)
      .at(-1)?.verdict;
    if (!tiebreaker && primary.length < 2) {
      throw notComplete({ primarySubmitted: primary.length });
    }
    const to = resolveVerdicts({
      primary,
      tiebreaker,
      unresolvedFeedback: await this.feedback.countUnresolved(thesis._id),
    });
    const from = tiebreaker
      ? EVALUATING_STATUS[AssignmentType.TIEBREAKER]
      : EVALUATING_STATUS[AssignmentType.PRIMARY];
    if (!to || thesis.status !== from) {
      return { thesisId, status: thesis.status, changed: false };
    }
    try {
      const moved = await this.workflow.transition({
        thesisId,
        expectedFrom: [from],
        to,
        actor,
        reason: tiebreaker
          ? `RN-08: tiebreaker ${tiebreaker}`
          : `RN-08: ${primary.join(' / ')}`,
      });
      return { thesisId, status: moved.status, changed: true };
    } catch (err) {
      if (!isWorkflowRace(err)) throw err;
      const fresh = await this.theses.findById(thesisId);
      return { thesisId, status: fresh.status, changed: false };
    }
  }

  /**
   * Scheduler pass: theses stuck in UNDER_EVALUATION / IN_DISPUTE whose required evaluations
   * are all SUBMITTED (a failed RN-08 after a submit). One failure does not stop the rest.
   */
  async reconcileStuck(actor: Actor = SYSTEM_ACTOR): Promise<number> {
    const ids = await this.theses.findIdsByStatuses([
      ThesisStatus.UNDER_EVALUATION,
      ThesisStatus.IN_DISPUTE,
    ]);
    if (!ids.length) return 0;
    const rows = await this.model
      .find(
        { thesisId: { $in: ids }, status: EvaluationStatus.SUBMITTED },
        { thesisId: 1, assignmentType: 1 },
      )
      .lean()
      .exec();
    const primaries = new Map<string, number>();
    const tiebreakers = new Set<string>();
    for (const r of rows) {
      const id = r.thesisId.toHexString();
      if (r.assignmentType === AssignmentType.TIEBREAKER) tiebreakers.add(id);
      else primaries.set(id, (primaries.get(id) ?? 0) + 1);
    }
    let moved = 0;
    for (const oid of ids) {
      const id = oid.toHexString();
      if (!tiebreakers.has(id) && (primaries.get(id) ?? 0) < 2) continue;
      try {
        if ((await this.reconcileOutcome(id, actor)).changed) moved++;
      } catch (err) {
        this.logger.error(
          `RN-08 reconcile failed for thesis ${id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return moved;
  }

  // ---------------------------------------------------------------- helpers

  private async assertCanEvaluate(a: AssignmentDocument): Promise<void> {
    if (a.status !== AssignmentStatus.ACCEPTED)
      throw notAllowed('Only an accepted assignment can be evaluated', {
        assignmentStatus: a.status,
      });
    const thesis = await this.theses.findById(a.thesisId.toHexString());
    if (thesis.status !== EVALUATING_STATUS[a.type]) {
      throw notAllowed(
        `A ${a.type} juror cannot evaluate while the thesis is ${thesis.status}`,
        { status: thesis.status },
      );
    }
  }

  private async findDoc(id: string): Promise<EvaluationDocument> {
    const doc = isValidObjectId(id)
      ? await this.model.findById(id).exec()
      : null;
    if (!doc) throw evaluationNotFound();
    return doc;
  }

  private async findReadableDoc(
    id: string,
    user: AuthUser,
  ): Promise<{ evaluation: EvaluationDocument; mode: ReadMode }> {
    const evaluation = await this.findDoc(id);
    const thesis = await this.theses.findById(
      evaluation.thesisId.toHexString(),
    );
    const mode = await this.readMode(thesis, user);
    if (!mode || !this.visible(evaluation, mode, user))
      throw evaluationNotFound();
    return { evaluation, mode };
  }

  /** null = may not read the thesis's evaluations. */
  private async readMode(
    thesis: ThesisDocument,
    user: AuthUser,
  ): Promise<ReadMode | null> {
    if (
      !user.scope &&
      (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.COORDINATOR))
    )
      return 'STAFF';
    if ((await this.theses.jurorAccess(thesis._id, user)) === 'MANUSCRIPT')
      return 'JUROR';
    if (
      !user.scope &&
      user.roles.includes(Role.STUDENT) &&
      thesis.studentId.equals(user.id)
    )
      return 'STUDENT';
    return null;
  }

  /** Staff see all; jurors their own draft and all submitted; the student submitted only. */
  private visible(e: EvaluationDocument, mode: ReadMode, user: AuthUser) {
    if (mode === 'STAFF') return true;
    if (e.status === EvaluationStatus.SUBMITTED) return true;
    return mode === 'JUROR' && e.jurorId.equals(user.id);
  }

  private async logAccess(
    e: EvaluationDocument,
    type: StudentAccessType,
    ip?: string,
  ): Promise<EvaluationDocument> {
    const now = new Date();
    const first =
      type === StudentAccessType.VIEW
        ? 'studentFirstViewedAt'
        : 'studentFirstDownloadedAt';
    await this.model
      .updateOne(
        { _id: e._id },
        { $push: { studentAccessLog: { type, at: now, ip } } },
      )
      .exec();
    await this.model
      .updateOne(
        { _id: e._id, [first]: { $exists: false } },
        { $set: { [first]: now } },
      )
      .exec();
    return (await this.model.findById(e._id).exec()) ?? e;
  }

  private async views(
    docs: readonly EvaluationDocument[],
  ): Promise<EvaluationView[]> {
    const jurors = new Map(
      (
        await this.users.findManyByIds([
          ...new Set(docs.map((d) => d.jurorId.toHexString())),
        ])
      ).map((u) => [
        u.id as string,
        {
          id: u.id as string,
          firstName: u.firstName,
          lastName: u.lastName,
          isUnicordoba: !!u.jurorProfile?.isUnicordoba,
        },
      ]),
    );
    return docs.map((raw) => {
      const d = withMeta(raw);
      const r = d.rubric;
      return {
        id: d._id.toHexString(),
        assignmentId: d.assignmentId.toHexString(),
        thesisId: d.thesisId.toHexString(),
        jurorId: d.jurorId.toHexString(),
        juror: jurors.get(d.jurorId.toHexString()) ?? null,
        assignmentType: d.assignmentType,
        rubric: r
          ? {
              methodology: r.methodology,
              relevance: r.relevance,
              writingQuality: r.writingQuality,
            }
          : null,
        score: d.score ?? null,
        verdict: d.verdict ?? null,
        comments: d.comments,
        correctionFiles: d.correctionFiles.map((f) => ({
          fileId: f.fileId.toHexString(),
          fileName: f.fileName,
          uploadedAt: f.uploadedAt,
          manuscriptVersion: f.manuscriptVersion,
        })),
        status: d.status,
        submittedAt: d.submittedAt,
        studentFirstViewedAt: d.studentFirstViewedAt,
        studentFirstDownloadedAt: d.studentFirstDownloadedAt,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    });
  }
}
