import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode } from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import {
  CreateCohortDto,
  QueryCohortsDto,
  UpdateCohortDto,
} from './dto/cohort.dto';
import { CreatePeriodDto, UpdatePeriodDto } from './dto/period.dto';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';
import { Cohort, CohortDocument } from './schemas/cohort.schema';
import { Period, PeriodDocument } from './schemas/period.schema';
import { Program, ProgramDocument } from './schemas/program.schema';

const notFound = (code: ErrorCode, status: HttpStatus, what: string) =>
  new AppException(code, status, `${what} not found`);

@Injectable()
export class CatalogsService {
  constructor(
    @InjectModel(Program.name) private readonly programs: Model<Program>,
    @InjectModel(Period.name) private readonly periods: Model<Period>,
    @InjectModel(Cohort.name) private readonly cohorts: Model<Cohort>,
  ) {}

  // ---- lookups used by other modules (null when missing or malformed) ----

  findProgram(id: string): Promise<ProgramDocument | null> {
    return isValidObjectId(id)
      ? this.programs.findById(id).exec()
      : Promise.resolve(null);
  }

  findPeriod(id: string): Promise<PeriodDocument | null> {
    return isValidObjectId(id)
      ? this.periods.findById(id).exec()
      : Promise.resolve(null);
  }

  findCohort(id: string): Promise<CohortDocument | null> {
    return isValidObjectId(id)
      ? this.cohorts.findById(id).exec()
      : Promise.resolve(null);
  }

  // ---- programs ----

  listPrograms(): Promise<ProgramDocument[]> {
    return this.programs.find().sort({ code: 1 }).exec();
  }

  createProgram(
    dto: CreateProgramDto,
    seedTag?: string,
  ): Promise<ProgramDocument> {
    return this.programs.create({ ...dto, seedTag });
  }

  async updateProgram(
    id: string,
    dto: UpdateProgramDto,
  ): Promise<ProgramDocument> {
    const updated = await this.programs.findByIdAndUpdate(id, dto, {
      new: true,
      runValidators: true,
    });
    if (!updated)
      throw notFound(
        ErrorCode.PROGRAM_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Program',
      );
    return updated;
  }

  // ---- periods ----

  listPeriods(): Promise<PeriodDocument[]> {
    return this.periods.find().sort({ year: -1, term: -1 }).exec();
  }

  createPeriod(
    dto: CreatePeriodDto,
    seedTag?: string,
  ): Promise<PeriodDocument> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertRange(startsAt, endsAt);
    return this.periods.create({
      code: `${dto.year}-${dto.term}`,
      year: dto.year,
      term: dto.term,
      startsAt,
      endsAt,
      seedTag,
    });
  }

  async updatePeriod(
    id: string,
    dto: UpdatePeriodDto,
  ): Promise<PeriodDocument> {
    const period = await this.periods.findById(id);
    if (!period)
      throw notFound(
        ErrorCode.PERIOD_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Period',
      );
    if (dto.startsAt) period.startsAt = new Date(dto.startsAt);
    if (dto.endsAt) period.endsAt = new Date(dto.endsAt);
    this.assertRange(period.startsAt, period.endsAt);
    return period.save();
  }

  private assertRange(startsAt: Date, endsAt: Date): void {
    if (!(endsAt > startsAt)) {
      throw new AppException(
        ErrorCode.PERIOD_INVALID_RANGE,
        HttpStatus.BAD_REQUEST,
        'endsAt must be after startsAt',
      );
    }
  }

  // ---- cohorts ----

  listCohorts(query: QueryCohortsDto): Promise<CohortDocument[]> {
    const filter: FilterQuery<Cohort> = {};
    if (query.programId) filter.programId = query.programId;
    return this.cohorts.find(filter).sort({ programId: 1, number: 1 }).exec();
  }

  async createCohort(
    dto: CreateCohortDto,
    seedTag?: string,
  ): Promise<CohortDocument> {
    await this.assertReferences(dto.programId, dto.periodId);
    return this.cohorts.create({ ...dto, seedTag });
  }

  async updateCohort(
    id: string,
    dto: UpdateCohortDto,
  ): Promise<CohortDocument> {
    if (dto.periodId) await this.assertReferences(undefined, dto.periodId);
    const updated = await this.cohorts.findByIdAndUpdate(id, dto, {
      new: true,
      runValidators: true,
    });
    if (!updated)
      throw notFound(
        ErrorCode.COHORT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Cohort',
      );
    return updated;
  }

  /** Body references that do not exist are client errors (400), not missing resources. */
  private async assertReferences(
    programId?: string,
    periodId?: string,
  ): Promise<void> {
    if (programId && !(await this.programs.exists({ _id: programId }))) {
      throw notFound(
        ErrorCode.PROGRAM_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
        'Program',
      );
    }
    if (periodId && !(await this.periods.exists({ _id: periodId }))) {
      throw notFound(
        ErrorCode.PERIOD_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
        'Period',
      );
    }
  }
}
