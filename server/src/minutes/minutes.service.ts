import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  ErrorCode,
  FileKind,
  MinutesStatus,
  MinutesVerdict,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { CatalogsService } from '../catalogs/catalogs.service';
import { AppException } from '../common/errors/app.exception';
import { actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { DefensesService } from '../defenses/defenses.service';
import { FilesService, OpenedFile } from '../files/files.service';
import { Counter } from '../theses/schemas/counter.schema';
import { ThesisDocument } from '../theses/schemas/thesis.schema';
import { ThesesService } from '../theses/theses.service';
import { UsersService } from '../users/users.service';
import { WorkflowService } from '../workflow/workflow.service';
import { CreateMinutesDto, UpdateMinutesDto } from './dto/minutes.dto';
import {
  bogotaYear,
  formatMinutesNumber,
  isGradeConsistent,
  minutesHash,
} from './minutes.content';
import { MINUTES_SEALED, MinutesSealedEvent } from './minutes.events';
import { renderMinutesPdf } from './minutes.pdf';
import { Minutes, MinutesDocument } from './schemas/minutes.schema';

export interface MinutesView {
  id: string;
  thesisId: string;
  defenseId: string;
  number: string;
  finalGrade: number;
  verdict: MinutesVerdict;
  remarks: string;
  contentHash: string;
  status: MinutesStatus;
  signatures: { userId: string; name: string; role: Role; signedAt: Date }[];
  requiredSigners: { userId: string; name: string; role: Role }[];
  sealedAt?: Date;
  pdfAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMinutesOptions {
  /** Seed only: prefixes the number and its counter so demo data never uses the official sequence. */
  numberPrefix?: string;
}

export interface SignContext {
  ip?: string;
  userAgent?: string;
}

const err = (code: ErrorCode, status: HttpStatus, message: string) =>
  new AppException(code, status, message);
const notFound = () =>
  err(ErrorCode.MINUTES_NOT_FOUND, HttpStatus.NOT_FOUND, 'Minutes not found');
const sealed = () =>
  err(ErrorCode.MINUTES_SEALED, HttpStatus.CONFLICT, 'The minutes are sealed');
const invalidGrade = () =>
  err(
    ErrorCode.MINUTES_INVALID_GRADE,
    HttpStatus.BAD_REQUEST,
    'A final grade below 3.0 requires the FAILED verdict',
  );

@Injectable()
export class MinutesService {
  constructor(
    @InjectModel(Minutes.name) private readonly model: Model<Minutes>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly theses: ThesesService,
    private readonly defenses: DefensesService,
    private readonly catalogs: CatalogsService,
    private readonly users: UsersService,
    private readonly files: FilesService,
    private readonly workflow: WorkflowService,
    private readonly events: EventEmitter2,
  ) {}

  /** CU-04: the coordinator records the result of a held defense. */
  async create(
    thesisId: string,
    dto: CreateMinutesDto,
    user: AuthUser,
    opts: CreateMinutesOptions = {},
  ): Promise<MinutesView> {
    const thesis = await this.theses.findById(thesisId);
    if (thesis.status !== ThesisStatus.DEFENSE_SCHEDULED) {
      throw new AppException(
        ErrorCode.MINUTES_THESIS_STATUS,
        HttpStatus.CONFLICT,
        'The thesis has no scheduled defense',
        { status: thesis.status },
      );
    }
    if (!isGradeConsistent(dto.finalGrade, dto.verdict)) throw invalidGrade();
    if (await this.model.exists({ thesisId: thesis._id })) throw this.exists();
    const defense = await this.defenses.findOpenForThesis(thesis._id);
    if (!defense) {
      throw err(
        ErrorCode.MINUTES_THESIS_STATUS,
        HttpStatus.CONFLICT,
        'The thesis has no open defense',
      );
    }

    const jurors = await this.defenses.activeJurors(thesis._id);
    const jurorUsers = await this.users.findManyByIds(
      jurors.map((j) => j.userId),
    );
    const found = new Set(jurorUsers.map((u) => u.id as string));
    const missing = jurors.filter((j) => !found.has(j.userId));
    if (missing.length) {
      throw err(
        ErrorCode.INTERNAL_ERROR,
        HttpStatus.INTERNAL_SERVER_ERROR,
        `Required signer accounts not found: ${missing.map((j) => j.userId).join(', ')}`,
      );
    }
    const number = await this.nextNumber(thesis, opts.numberPrefix);
    const requiredSigners = [
      ...jurorUsers.map((u) => ({
        userId: u._id,
        role: u.roles.includes(Role.INTERNAL_JUROR)
          ? Role.INTERNAL_JUROR
          : Role.EXTERNAL_JUROR,
      })),
      { userId: new Types.ObjectId(user.id), role: Role.COORDINATOR },
    ];
    const content = {
      thesisId: thesis.id as string,
      number,
      finalGrade: dto.finalGrade,
      verdict: dto.verdict,
      remarks: dto.remarks,
    };
    let minutes: MinutesDocument;
    try {
      minutes = await this.model.create({
        ...content,
        thesisId: thesis._id,
        defenseId: defense._id,
        contentHash: minutesHash(content),
        requiredSigners,
        createdBy: new Types.ObjectId(user.id),
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw this.exists();
      throw e;
    }
    await this.defenses.markHeld(defense._id);
    return this.toView(minutes);
  }

  async findForThesis(
    thesisId: string,
    user: AuthUser,
  ): Promise<MinutesView | null> {
    const thesis = await this.theses.findReadable(thesisId, user);
    const minutes = await this.model.findOne({ thesisId: thesis._id }).exec();
    return minutes ? this.toView(minutes) : null;
  }

  async findOneView(id: string, user: AuthUser): Promise<MinutesView> {
    return this.toView((await this.findReadable(id, user)).minutes);
  }

  /** Editable while DRAFT and unsigned. */
  async update(
    id: string,
    dto: UpdateMinutesDto,
    user: AuthUser,
  ): Promise<MinutesView> {
    const { minutes } = await this.findReadable(id, user);
    this.assertDraft(minutes);
    if (minutes.signatures.length) throw this.signed();
    const content = {
      thesisId: minutes.thesisId.toHexString(),
      number: minutes.number,
      finalGrade: dto.finalGrade ?? minutes.finalGrade,
      verdict: dto.verdict ?? minutes.verdict,
      remarks: dto.remarks ?? minutes.remarks,
    };
    if (!isGradeConsistent(content.finalGrade, content.verdict))
      throw invalidGrade();
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: minutes._id,
          status: MinutesStatus.DRAFT,
          signatures: { $size: 0 },
        },
        {
          $set: {
            finalGrade: content.finalGrade,
            verdict: content.verdict,
            remarks: content.remarks,
            contentHash: minutesHash(content),
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw this.signed();
    return this.toView(updated);
  }

  /** RNF-04: jurors first, the coordinator last; the last signature seals. */
  async sign(
    id: string,
    user: AuthUser,
    ctx: SignContext,
  ): Promise<MinutesView> {
    const { minutes, thesis } = await this.findReadable(id, user);
    const signer = minutes.requiredSigners.find((s) =>
      s.userId.equals(user.id),
    );
    if (!signer) {
      throw err(
        ErrorCode.MINUTES_NOT_SIGNER,
        HttpStatus.FORBIDDEN,
        'You are not a required signer of these minutes',
      );
    }
    if (minutes.status === MinutesStatus.SEALED) {
      // Retry: sealed but the thesis transition failed afterwards.
      if (thesis.status !== ThesisStatus.DEFENSE_SCHEDULED) throw sealed();
      await this.finalize(minutes, thesis, user);
      return this.toView(minutes);
    }
    if (minutes.signatures.some((s) => s.userId.equals(user.id))) {
      // Retry: every signature is in but sealing failed afterwards.
      if (minutes.signatures.length >= minutes.requiredSigners.length)
        return this.toView(await this.seal(minutes, thesis, user));
      throw this.signed();
    }
    if (signer.role === Role.COORDINATOR) {
      const jurorsPending = minutes.requiredSigners.some(
        (s) =>
          s.role !== Role.COORDINATOR &&
          !minutes.signatures.some((sig) => sig.userId.equals(s.userId)),
      );
      if (jurorsPending) {
        throw err(
          ErrorCode.MINUTES_SIGN_ORDER,
          HttpStatus.CONFLICT,
          'The coordinator signs after every juror',
        );
      }
    }
    const contentHash = minutesHash({
      thesisId: minutes.thesisId.toHexString(),
      number: minutes.number,
      finalGrade: minutes.finalGrade,
      verdict: minutes.verdict,
      remarks: minutes.remarks,
    });
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: minutes._id,
          status: MinutesStatus.DRAFT,
          'signatures.userId': { $ne: signer.userId },
        },
        {
          $set: { contentHash },
          $push: {
            signatures: {
              userId: signer.userId,
              role: signer.role,
              signedAt: new Date(),
              contentHash,
              ip: ctx.ip,
              userAgent: ctx.userAgent?.slice(0, 500),
            },
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw this.signed();
    if (updated.signatures.length >= updated.requiredSigners.length)
      return this.toView(await this.seal(updated, thesis, user));
    return this.toView(updated);
  }

  async openPdf(id: string, user: AuthUser): Promise<OpenedFile> {
    const { minutes } = await this.findReadable(id, user);
    if (minutes.status !== MinutesStatus.SEALED || !minutes.pdfFileId) {
      throw err(
        ErrorCode.FILE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'The minutes PDF is available once sealed',
      );
    }
    return this.files.openDownload(minutes.pdfFileId.toHexString());
  }

  private async seal(
    minutes: MinutesDocument,
    thesis: ThesisDocument,
    user: AuthUser,
  ): Promise<MinutesDocument> {
    const sealedAt = new Date();
    const names = await this.names(minutes.signatures.map((s) => s.userId));
    const defense = await this.defenses.findOpenForThesis(thesis._id);
    const pdf = await renderMinutesPdf({
      number: minutes.number,
      thesis,
      defense: defense ?? undefined,
      finalGrade: minutes.finalGrade,
      verdict: minutes.verdict,
      remarks: minutes.remarks,
      contentHash: minutes.contentHash,
      sealedAt,
      signers: minutes.signatures.map((s) => ({
        name: names.get(s.userId.toHexString()) ?? '',
        role: s.role,
        signedAt: s.signedAt,
      })),
    });
    const file = await this.files.upload(
      {
        buffer: pdf,
        originalname: `acta-${minutes.number}.pdf`,
        size: pdf.length,
      },
      {
        ownerId: minutes.createdBy.toHexString(),
        thesisId: thesis.id as string,
        kind: FileKind.MINUTES_PDF,
      },
      ['pdf'],
    );
    const sealedDoc = await this.model
      .findOneAndUpdate(
        { _id: minutes._id, status: MinutesStatus.DRAFT },
        {
          $set: {
            status: MinutesStatus.SEALED,
            sealedAt,
            pdfFileId: new Types.ObjectId(file.id),
          },
        },
        { new: true },
      )
      .exec();
    if (!sealedDoc) {
      await this.files.delete(file.id);
      throw sealed();
    }
    await this.finalize(sealedDoc, thesis, user);
    return sealedDoc;
  }

  /** Completes the thesis and announces the seal; the only step a seal retry repeats. */
  private async finalize(
    minutes: MinutesDocument,
    thesis: ThesisDocument,
    user: AuthUser,
  ): Promise<void> {
    const actor = actorFrom(user, Role.COORDINATOR);
    await this.workflow.transition({
      thesisId: thesis.id as string,
      to:
        minutes.verdict === MinutesVerdict.FAILED
          ? ThesisStatus.COMPLETED_FAILED
          : ThesisStatus.COMPLETED_APPROVED,
      expectedFrom: [ThesisStatus.DEFENSE_SCHEDULED],
      actor,
      reason: `Minutes ${minutes.number} sealed`,
    });
    const event: MinutesSealedEvent = {
      thesisId: thesis.id as string,
      minutesId: minutes.id as string,
      verdict: minutes.verdict,
      actor,
    };
    this.events.emit(MINUTES_SEALED, event);
  }

  /** Atomic per program code and year: MIETIA-2026-001. */
  private async nextNumber(
    thesis: ThesisDocument,
    prefix?: string,
  ): Promise<string> {
    const program = await this.catalogs.findProgram(
      thesis.programId.toHexString(),
    );
    const base = program?.code ?? 'PROG';
    const code = prefix ? `${prefix}-${base}` : base;
    const year = bogotaYear();
    const counter = await this.counters.findOneAndUpdate(
      { _id: `minutes:${code}-${year}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return formatMinutesNumber(code, year, counter.seq);
  }

  private async findReadable(
    id: string,
    user: AuthUser,
  ): Promise<{ minutes: MinutesDocument; thesis: ThesisDocument }> {
    const minutes = await this.model.findById(id).exec();
    if (!minutes) throw notFound();
    try {
      const thesis = await this.theses.findReadable(
        minutes.thesisId.toHexString(),
        user,
      );
      return { minutes, thesis };
    } catch {
      throw notFound();
    }
  }

  private assertDraft(minutes: MinutesDocument): void {
    if (minutes.status === MinutesStatus.SEALED) throw sealed();
  }

  private exists() {
    return err(
      ErrorCode.MINUTES_EXISTS,
      HttpStatus.CONFLICT,
      'The thesis already has minutes',
    );
  }

  private signed() {
    return err(
      ErrorCode.MINUTES_SIGNED,
      HttpStatus.CONFLICT,
      'The minutes already have signatures',
    );
  }

  private async names(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    const users = await this.users.findManyByIds(
      ids.map((i) => i.toHexString()),
    );
    return new Map(
      users.map((u) => [u.id as string, `${u.firstName} ${u.lastName}`]),
    );
  }

  private async toView(m: MinutesDocument): Promise<MinutesView> {
    const names = await this.names(m.requiredSigners.map((s) => s.userId));
    const ts = m as unknown as { createdAt: Date; updatedAt: Date };
    return {
      id: m.id as string,
      thesisId: m.thesisId.toHexString(),
      defenseId: m.defenseId.toHexString(),
      number: m.number,
      finalGrade: m.finalGrade,
      verdict: m.verdict,
      remarks: m.remarks,
      contentHash: m.contentHash,
      status: m.status,
      signatures: m.signatures.map((s) => ({
        userId: s.userId.toHexString(),
        name: names.get(s.userId.toHexString()) ?? '',
        role: s.role,
        signedAt: s.signedAt,
      })),
      requiredSigners: m.requiredSigners.map((s) => ({
        userId: s.userId.toHexString(),
        name: names.get(s.userId.toHexString()) ?? '',
        role: s.role,
      })),
      sealedAt: m.sealedAt,
      pdfAvailable: m.status === MinutesStatus.SEALED && !!m.pdfFileId,
      createdAt: ts.createdAt,
      updatedAt: ts.updatedAt,
    };
  }
}
