import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { lowercaseIdentifier } from '../../common/validation/lowercase-identifier';

export class CreateThesisDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  abstract?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  keywords?: string[];

  @IsMongoId()
  studentId!: string;

  @IsMongoId()
  advisorId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique(lowercaseIdentifier)
  @IsMongoId({ each: true })
  coAdvisorIds?: string[];

  @IsMongoId()
  programId!: string;

  @IsMongoId()
  cohortId!: string;

  @IsMongoId()
  periodId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique(lowercaseIdentifier)
  @IsMongoId({ each: true })
  conflictOfInterestUserIds?: string[];
}
