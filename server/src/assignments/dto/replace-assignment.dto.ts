import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { JurorInputDto } from './juror-input.dto';

export class ReplaceAssignmentDto {
  /**
   * Primary (thesis JURORS_ASSIGNED / PENDING_JUROR_REPLACEMENT): PENDING, DECLINED or EXPIRED.
   * Tiebreaker (thesis IN_DISPUTE): PENDING, DECLINED, EXPIRED, or ACCEPTED without a submitted evaluation.
   */
  @IsMongoId()
  assignmentId!: string;

  @ValidateNested()
  @Type(() => JurorInputDto)
  juror!: JurorInputDto;

  /** Defaults to settings.acceptanceBusinessDays. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  responseBusinessDays?: number;
}
