import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Role } from '@thesis/shared';

export class JurorProfileDto {
  @IsString()
  @IsNotEmpty()
  institution!: string;

  @IsBoolean()
  isUnicordoba!: boolean;

  @IsOptional()
  @IsString()
  highestDegree?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expertise?: string[];
}

export class StudentProfileDto {
  @IsString()
  @IsNotEmpty()
  studentCode!: string;

  @IsOptional()
  @IsMongoId()
  programId?: string;

  @IsOptional()
  @IsMongoId()
  cohortId?: string;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  /** Required for every role except a pure EXTERNAL_JUROR (validated in UsersService). */
  @IsOptional()
  @IsString()
  @MinLength(8)
  // bcrypt only uses the first 72 bytes of the input. MaxLength counts characters,
  // not bytes, so this is an approximation: multi-byte characters can still exceed 72 bytes.
  @MaxLength(72)
  password?: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  roles!: Role[];

  @IsOptional()
  @ValidateNested()
  @Type(() => JurorProfileDto)
  jurorProfile?: JurorProfileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StudentProfileDto)
  studentProfile?: StudentProfileDto;
}
