import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class CreateCohortDto {
  @IsMongoId()
  programId!: string;

  @IsInt()
  @Min(1)
  number!: number;

  @IsMongoId()
  periodId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

export class UpdateCohortDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptionalNonNull()
  @IsMongoId()
  periodId?: string;
}

export class QueryCohortsDto {
  @IsOptional()
  @IsMongoId()
  programId?: string;
}
