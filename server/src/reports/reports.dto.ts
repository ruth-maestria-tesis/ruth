import { ThesisStatus } from '@thesis/shared';
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Same filters and sort as `GET /theses`, without pagination. */
export class ReportQueryDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{1,40}$/)
  codePrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  seedTag?: string;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
}
