import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  @MaxLength(200)
  institution!: string;

  @IsBoolean()
  isUnicordoba!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  highestDegree?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  expertise?: string[];
}

export class StudentProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
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
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
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
