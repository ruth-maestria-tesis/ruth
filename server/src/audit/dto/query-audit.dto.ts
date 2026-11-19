import {
  IsDateString,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export class QueryAuditDto extends PaginationQueryDto {
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  /** Exact match, e.g. "POST /theses/:id/assignments" or AUTH_LOGIN_FAILURE. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  action?: string;

  /** Inclusive lower bound on `at` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound on `at` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  to?: string;
}
