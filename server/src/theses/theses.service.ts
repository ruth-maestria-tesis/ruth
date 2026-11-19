import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ErrorCode,
  FileKind,
  JUROR_ROLES,
  Role,
  TERMINAL_THESIS_STATUSES,
  THESIS_PROGRESS,
  ThesisStatus,
} from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model, Types } from 'mongoose';
import { Assignment } from '../assignments/schemas/assignment.schema';
import { CatalogsService } from '../catalogs/catalogs.service';
import { AppException } from '../common/errors/app.exception';
import { paginate, SortFields } from '../common/pagination/paginate';
import { Paginated } from '../common/pagination/pagination.dto';
import type { Actor } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { accentInsensitiveRegex } from '../common/utils/accent-insensitive-regex';
import { escapeRegex } from '../common/utils/escape-regex';
import { CompleteUploadDto, CreateUploadDto } from '../files/dto/upload.dto';
import {
  FilesService,
  OpenedFile,
  StoredFile,
  UploadInput,
  UploadTicket,
} from '../files/files.service';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { isTerminal } from '../workflow/workflow.rules';
import { CreateThesisDto } from './dto/create-thesis.dto';
import { QueryThesesDto } from './dto/query-theses.dto';
import { UpdateThesisDto } from './dto/update-thesis.dto';
import { Thesis, ThesisDocument } from './schemas/thesis.schema';
import {
  canReadThesis,
  canWriteThesis,
  JurorAccess,
  jurorAccessLevel,
} from './thesis-access.policy';
import { ThesisCodeService } from './thesis-code';
import { isStaff, toThesisView } from './thesis-view';

const SORT_FIELDS: SortFields = {
  code: 'code',
  title: 'title',
  student: 'studentName',
  status: 'status',
  progress: 'progress',
  createdAt: 'createdAt',
};

const PARTICIPANT_FIELDS = [
  'advisorId',
  'coAdvisorIds',
  'conflictOfInterestUserIds',
] as const;

type Participants = Pick<
  CreateThesisDto,
  'studentId' | 'advisorId' | 'coAdvisorIds' | 'conflictOfInterestUserIds'
>;

const invalidRef = (field: string) =>
  new AppException(
    ErrorCode.THESIS_INVALID_REFERENCE,
    HttpStatus.BAD_REQUEST,
    `Invalid ${field}`,
    { field },
  );

/** Blob prefix of a thesis's manuscripts. */
const manuscriptScope = (thesis: ThesisDocument) =>
  `manuscripts/${thesis._id.toHexString()}`;

const thesisNotFound = () =>
  new AppException(
    ErrorCode.THESIS_NOT_FOUND,
    HttpStatus.NOT_FOUND,
    'Thesis not found',
  );

/** Only keys that were actually sent; `undefined` must never reach `$set`. */
const definedFields = (dto: UpdateThesisDto): Partial<UpdateThesisDto> =>
  Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));

const isFaculty = (u?: UserDocument) =>
  !!u && u.isActive && u.roles.some((r) => JUROR_ROLES.includes(r));

@Injectable()
export class ThesesService {
  constructor(
    @InjectModel(Thesis.name) private readonly model: Model<Thesis>,
    @InjectModel(Assignment.name)
    private readonly assignmentModel: Model<Assignment>,
    private readonly catalogs: CatalogsService,
    private readonly users: UsersService,
    private readonly codes: ThesisCodeService,
    private readonly files: FilesService,
  ) {}

  /** RF-C01 radicación. `seedTag` is only set by the seed command (stage 8). */
  async create(
    dto: CreateThesisDto,
    actor: Actor,
    opts: { seedTag?: string } = {},
  ): Promise<ThesisDocument> {
    const [program, period, cohort] = await Promise.all([
      this.catalogs.findProgram(dto.programId),
      this.catalogs.findPeriod(dto.periodId),
      this.catalogs.findCohort(dto.cohortId),
    ]);
    if (!program?.isActive) throw invalidRef('programId');
    if (!period) throw invalidRef('periodId');
    if (!cohort) throw invalidRef('cohortId');
    if (!cohort.programId.equals(program._id)) {
      throw new AppException(
        ErrorCode.COHORT_PROGRAM_MISMATCH,
        HttpStatus.BAD_REQUEST,
        'Cohort belongs to another program',
      );
    }

    const student = await this.assertParticipants(dto);
    // Check-then-insert: two simultaneous registrations for one student could both pass (accepted).
    if (
      await this.model.exists({
        studentId: dto.studentId,
        status: { $nin: TERMINAL_THESIS_STATUSES },
      })
    ) {
      throw new AppException(
        ErrorCode.THESIS_STUDENT_HAS_ACTIVE,
        HttpStatus.CONFLICT,
        'Student already has an active thesis',
      );
    }

    const code = await this.codes.next(program.code, period.code, opts.seedTag);
    return this.model.create({
      ...dto,
      code,
      studentName: `${student.firstName} ${student.lastName}`,
      status: ThesisStatus.SUBMITTED,
      progress: THESIS_PROGRESS[ThesisStatus.SUBMITTED],
      history: [
        {
          from: null,
          to: ThesisStatus.SUBMITTED,
          at: new Date(),
          actorId: actor.id ? new Types.ObjectId(actor.id) : undefined,
          actorRole: actor.role,
        },
      ],
      seedTag: opts.seedTag,
    });
  }

  list(query: QueryThesesDto): Promise<Paginated<ThesisDocument>> {
    const filter: FilterQuery<Thesis> = {};
    if (query.programId) filter.programId = query.programId;
    if (query.periodId) filter.periodId = query.periodId;
    if (query.cohortId) filter.cohortId = query.cohortId;
    if (query.status) filter.status = query.status;
    if (query.seedTag) filter.seedTag = query.seedTag;
    // Codes are uppercase, so an anchored case-sensitive prefix can use the code index.
    if (query.codePrefix)
      filter.code = new RegExp(
        `^${escapeRegex(query.codePrefix.toUpperCase())}`,
      );
    if (query.q) {
      const rx = accentInsensitiveRegex(query.q);
      filter.$or = [{ code: rx }, { title: rx }, { studentName: rx }];
    }
    // The es collation only matters for text sorts; applying it otherwise would stop
    // status/seedTag/code-prefix filters from using their (simple-collation) indexes.
    const collated =
      query.sort === 'title' ||
      query.sort === 'student' ||
      query.sort === 'code';
    return paginate(this.model, filter, query, {
      sortFields: SORT_FIELDS,
      defaultSort: 'createdAt',
      projection: { history: 0 },
      ...(collated && { collation: { locale: 'es', strength: 1 } }),
    });
  }

  findMine(studentId: string): Promise<ThesisDocument[]> {
    return this.model.find({ studentId }).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<ThesisDocument> {
    const thesis = isValidObjectId(id)
      ? await this.model.findById(id).exec()
      : null;
    if (!thesis) throw thesisNotFound();
    return thesis;
  }

  /** Bulk lookup for other modules (assignment lists); invalid ids are ignored. */
  findManyByIds(ids: readonly string[]): Promise<ThesisDocument[]> {
    return this.model
      .find({ _id: { $in: ids.filter((id) => isValidObjectId(id)) } })
      .exec();
  }

  /** Ids of the theses currently in one of `statuses` (scheduled reconciliation). */
  async findIdsByStatuses(
    statuses: readonly ThesisStatus[],
  ): Promise<Types.ObjectId[]> {
    const rows = await this.model
      .find({ status: { $in: statuses } }, { _id: 1 })
      .lean()
      .exec();
    return rows.map((r) => r._id);
  }

  /** 404 (not 403) for theses the user may not read, so ids cannot be probed. */
  async findReadable(id: string, user: AuthUser): Promise<ThesisDocument> {
    const thesis = await this.findById(id);
    if (canReadThesis(user, thesis)) return thesis;
    if ((await this.jurorAccess(thesis._id, user)) !== 'NONE') return thesis;
    throw thesisNotFound();
  }

  /** GET /theses/:id: the readable thesis in the representation for this user's role. */
  async findReadableView(
    id: string,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const thesis = await this.findById(id);
    if (isStaff(user)) return toThesisView(thesis, { kind: 'STAFF' });
    if (canReadThesis(user, thesis))
      return toThesisView(thesis, { kind: 'STUDENT' });
    const access = await this.jurorAccess(thesis._id, user);
    if (access !== 'NONE')
      return toThesisView(thesis, { kind: 'JUROR', access });
    throw thesisNotFound();
  }

  /** GET /theses/mine: the student's theses without staff-only fields. */
  async findMineView(user: AuthUser): Promise<Record<string, unknown>[]> {
    const theses = await this.findMine(user.id);
    return theses.map((t) =>
      toThesisView(t, isStaff(user) ? { kind: 'STAFF' } : { kind: 'STUDENT' }),
    );
  }

  /** Response of a manuscript upload: the uploader's own representation. */
  viewAfterUpload(
    thesis: ThesisDocument,
    user: AuthUser,
  ): Record<string, unknown> {
    return toThesisView(
      thesis,
      isStaff(user) ? { kind: 'STAFF' } : { kind: 'STUDENT' },
    );
  }

  /** RBAC "Si Aceptó": this user's active assignments on the thesis (scope-limited). */
  async jurorAccess(
    thesisId: Types.ObjectId,
    user: AuthUser,
  ): Promise<JurorAccess> {
    if (!user.roles.some((r) => JUROR_ROLES.includes(r))) return 'NONE';
    const filter: FilterQuery<Assignment> = {
      thesisId,
      jurorId: user.id,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
    };
    if (user.scope) filter._id = { $in: user.scope.assignmentIds };
    const found = await this.assignmentModel.find(filter, 'status').exec();
    return jurorAccessLevel(found.map((a) => a.status));
  }

  async update(id: string, dto: UpdateThesisDto): Promise<ThesisDocument> {
    const thesis = await this.findById(id);
    if (isTerminal(thesis.status)) {
      throw new AppException(
        ErrorCode.THESIS_CLOSED,
        HttpStatus.CONFLICT,
        'Thesis is closed',
      );
    }
    const touchesParticipants = PARTICIPANT_FIELDS.some(
      (f) => dto[f] !== undefined,
    );
    if (touchesParticipants) {
      // RN-01 is checked against these at juror assignment (stage 3).
      if (thesis.status !== ThesisStatus.SUBMITTED) {
        throw new AppException(
          ErrorCode.THESIS_NOT_EDITABLE,
          HttpStatus.CONFLICT,
          'Advisors and conflicts can only change before juror assignment',
        );
      }
      await this.assertParticipants({
        studentId: thesis.studentId.toHexString(),
        advisorId: dto.advisorId ?? thesis.advisorId.toHexString(),
        coAdvisorIds:
          dto.coAdvisorIds ?? thesis.coAdvisorIds.map((x) => x.toHexString()),
        conflictOfInterestUserIds:
          dto.conflictOfInterestUserIds ??
          thesis.conflictOfInterestUserIds.map((x) => x.toHexString()),
      });
    }
    const updated = await this.model
      .findOneAndUpdate(
        { _id: thesis._id, status: thesis.status },
        { $set: definedFields(dto) },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new AppException(
        ErrorCode.WORKFLOW_STATUS_CONFLICT,
        HttpStatus.CONFLICT,
        'Thesis status changed concurrently',
      );
    }
    return updated;
  }

  /** Validates every referenced user in one query; returns the student. */
  private async assertParticipants(input: Participants): Promise<UserDocument> {
    // @IsMongoId accepts uppercase hex; compare ids in one canonical form.
    const lower = (ids?: string[]) => ids?.map((x) => x.toLowerCase());
    const p = {
      studentId: input.studentId.toLowerCase(),
      advisorId: input.advisorId.toLowerCase(),
      coAdvisorIds: lower(input.coAdvisorIds),
      conflictOfInterestUserIds: lower(input.conflictOfInterestUserIds),
    };
    const coAdvisorIds = p.coAdvisorIds ?? [];
    const conflictIds = p.conflictOfInterestUserIds ?? [];
    const ids = [
      ...new Set([p.studentId, p.advisorId, ...coAdvisorIds, ...conflictIds]),
    ];
    const byId = new Map(
      (await this.users.findManyByIds(ids)).map((u) => [u.id as string, u]),
    );

    const student = byId.get(p.studentId);
    if (!student?.isActive || !student.roles.includes(Role.STUDENT))
      throw invalidRef('studentId');
    if (p.advisorId === p.studentId || !isFaculty(byId.get(p.advisorId)))
      throw invalidRef('advisorId');
    if (
      coAdvisorIds.some(
        (id) =>
          id === p.advisorId || id === p.studentId || !isFaculty(byId.get(id)),
      )
    ) {
      throw invalidRef('coAdvisorIds');
    }
    if (conflictIds.some((id) => !byId.has(id)))
      throw invalidRef('conflictOfInterestUserIds');
    return student;
  }

  /** New manuscript version (PDF) from a multipart upload. Coordinator or the owner student. */
  async addManuscript(
    id: string,
    file: UploadInput | undefined,
    user: AuthUser,
  ): Promise<ThesisDocument> {
    const thesis = await this.findWritable(id, user);
    const stored = await this.files.upload(
      file,
      { ownerId: user.id, thesisId: id, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    return this.attachManuscript(thesis, stored, user);
  }

  /** Direct upload, step 1: same authorization as the multipart route. */
  async createManuscriptUpload(
    id: string,
    dto: CreateUploadDto,
    user: AuthUser,
  ): Promise<UploadTicket> {
    const thesis = await this.findWritable(id, user);
    return this.files.createUpload(manuscriptScope(thesis), dto, ['pdf']);
  }

  /** Direct upload, step 3: re-authorizes, verifies the blob, then adds the version. */
  async completeManuscriptUpload(
    id: string,
    dto: CompleteUploadDto,
    user: AuthUser,
  ): Promise<ThesisDocument> {
    const thesis = await this.findWritable(id, user);
    const stored = await this.files.completeUpload(
      manuscriptScope(thesis),
      dto,
      { ownerId: user.id, thesisId: id, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    return this.attachManuscript(thesis, stored, user);
  }

  /** Coordinator or the owner student; not on closed theses. */
  private async findWritable(
    id: string,
    user: AuthUser,
  ): Promise<ThesisDocument> {
    const thesis = await this.findById(id);
    // 404 (not 403) so thesis ids cannot be probed by users without write access.
    if (!canWriteThesis(user, thesis)) throw thesisNotFound();
    if (isTerminal(thesis.status)) {
      throw new AppException(
        ErrorCode.THESIS_CLOSED,
        HttpStatus.CONFLICT,
        'Thesis is closed',
      );
    }
    return thesis;
  }

  private async attachManuscript(
    thesis: ThesisDocument,
    stored: StoredFile,
    user: AuthUser,
  ): Promise<ThesisDocument> {
    const fileId = new Types.ObjectId(stored.id);
    // Optimistic on manuscriptSeq (a concurrent upload makes this miss instead of duplicating a
    // version) and guarded against the thesis having been closed since it was read.
    let updated: ThesisDocument | null;
    try {
      updated = await this.model
        .findOneAndUpdate(
          {
            _id: thesis._id,
            manuscriptSeq: thesis.manuscriptSeq,
            status: { $nin: TERMINAL_THESIS_STATUSES },
          },
          {
            $inc: { manuscriptSeq: 1 },
            $push: {
              manuscripts: {
                fileId,
                version: thesis.manuscriptSeq + 1,
                fileName: stored.fileName,
                uploadedAt: new Date(),
                uploadedBy: new Types.ObjectId(user.id),
              },
            },
            $set: { currentManuscriptId: fileId },
          },
          { new: true, runValidators: true },
        )
        .exec();
    } catch (err) {
      await this.files.delete(stored.id).catch(() => undefined);
      throw err;
    }
    if (!updated) {
      await this.files.delete(stored.id);
      throw new AppException(
        ErrorCode.MANUSCRIPT_CONFLICT,
        HttpStatus.CONFLICT,
        'The thesis changed while uploading; retry the upload',
      );
    }
    return updated;
  }

  async openManuscript(
    id: string,
    fileId: string,
    user: AuthUser,
  ): Promise<OpenedFile> {
    const thesis = await this.findById(id);
    const allowed =
      canReadThesis(user, thesis) ||
      (await this.jurorAccess(thesis._id, user)) === 'MANUSCRIPT';
    if (!allowed) throw thesisNotFound();
    if (!thesis.manuscripts.some((m) => m.fileId.equals(fileId))) {
      throw new AppException(
        ErrorCode.FILE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'File not found',
      );
    }
    return this.files.openDownload(fileId);
  }
}
