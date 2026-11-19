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
  /** PENDING, DECLINED or EXPIRED primary assignment of this thesis. */
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
