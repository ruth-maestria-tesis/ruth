import { OmitType, PartialType } from '@nestjs/swagger';
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

export class UpdateProgramDto extends PartialType(
  OmitType(CreateProgramDto, ['code'] as const),
) {
  @IsOptionalNonNull()
  @IsBoolean()
  isActive?: boolean;
}
