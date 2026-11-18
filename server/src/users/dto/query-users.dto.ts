import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '@thesis/shared';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export class QueryUsersDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}

export class FacultyQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
