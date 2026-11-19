import { EvaluationVerdict } from '@thesis/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RubricDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  methodology?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  relevance?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  writingQuality?: number;
}

/**
 * Draft upsert; every field is optional and only the fields sent are changed. `comments: null`
 * is stored as '', `rubric: null` clears the rubric and `verdict: null` clears the verdict.
 */
export class SaveEvaluationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RubricDto)
  rubric?: RubricDto | null;

  /** PRIMARY: APPROVED_FOR_DEFENSE | APPROVED_WITH_CHANGES | REJECTED; TIEBREAKER: APPROVED | REJECTED. */
  @IsOptional()
  @IsEnum(EvaluationVerdict)
  verdict?: EvaluationVerdict | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value === null ? '' : value,
  )
  @IsString()
  @MaxLength(10000)
  comments?: string;
}
