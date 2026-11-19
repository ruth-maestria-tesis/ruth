import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { JurorInputDto } from './juror-input.dto';

export class CreateAssignmentsDto {
  /** Slot = position + 1. Exactly 2 are required (reported as JUROR_COUNT otherwise). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => JurorInputDto)
  jurors!: JurorInputDto[];

  /** Defaults to settings.acceptanceBusinessDays. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  responseBusinessDays?: number;
}

export class ValidateAssignmentsDto extends CreateAssignmentsDto {
  @IsMongoId()
  thesisId!: string;
}
