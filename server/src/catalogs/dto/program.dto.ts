import { ProgramLevel } from '@thesis/shared';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class CreateProgramDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,20}$/)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEnum(ProgramLevel)
  level!: ProgramLevel;
}

export class UpdateProgramDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptionalNonNull()
  @IsEnum(ProgramLevel)
  level?: ProgramLevel;

  @IsOptionalNonNull()
  @IsBoolean()
  isActive?: boolean;
}
