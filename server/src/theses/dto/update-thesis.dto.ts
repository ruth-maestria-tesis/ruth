import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { lowercaseIdentifier } from '../../common/validation/lowercase-identifier';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

/** Student, program, cohort and period are fixed at registration (they define the code). */
export class UpdateThesisDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @IsOptionalNonNull()
  @IsString()
  @MaxLength(5000)
  abstract?: string;

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  keywords?: string[];

  @IsOptionalNonNull()
  @IsMongoId()
  advisorId?: string;

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique(lowercaseIdentifier)
  @IsMongoId({ each: true })
  coAdvisorIds?: string[];

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique(lowercaseIdentifier)
  @IsMongoId({ each: true })
  conflictOfInterestUserIds?: string[];
}
