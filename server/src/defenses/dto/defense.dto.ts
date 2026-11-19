import { DefenseModality, DefenseStatus } from '@thesis/shared';
import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** CU-03: modality-specific fields and the future date are checked in the service. */
export class ScheduleDefenseDto {
  @IsDateString()
  scheduledAt!: string;

  @IsEnum(DefenseModality)
  modality!: DefenseModality;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(500)
  meetingUrl?: string;
}

export class QueryDefensesDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(DefenseStatus)
  status?: DefenseStatus;
}

export class UpdateDefenseDto extends PartialType(ScheduleDefenseDto) {}
