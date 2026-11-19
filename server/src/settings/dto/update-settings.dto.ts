import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsISO8601,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class UpdateSettingsDto {
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(60)
  acceptanceBusinessDays?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(120)
  evaluationBusinessDays?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(60)
  unseenConceptAlertDays?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(10)
  reminderBusinessDaysBefore?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(60)
  overdueRenotifyBusinessDays?: number;

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsISO8601({ strict: true, strictSeparator: true }, { each: true })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { each: true })
  holidays?: string[];
}
