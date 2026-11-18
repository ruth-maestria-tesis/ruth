import { ThesisStatus } from '@thesis/shared';
import {
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export class QueryThesesDto extends PaginationQueryDto {
  @IsOptional()
  @IsMongoId()
  programId?: string;

  @IsOptional()
  @IsMongoId()
  periodId?: string;

  @IsOptional()
  @IsMongoId()
  cohortId?: string;

  @IsOptional()
  @IsEnum(ThesisStatus)
  status?: ThesisStatus;

  /** Matches code, title or student name (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Code starts with, e.g. TEST- or MIETIA-2026-II (sugerencia 7). */
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{1,40}$/)
  codePrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  seedTag?: string;
}
