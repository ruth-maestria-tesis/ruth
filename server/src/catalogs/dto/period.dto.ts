import { PeriodTerm } from '@thesis/shared';
import { IsDateString, IsEnum, IsInt, Max, Min } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export class CreatePeriodDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsEnum(PeriodTerm)
  term!: PeriodTerm;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}

/** year/term are immutable because they form the code. */
export class UpdatePeriodDto {
  @IsOptionalNonNull()
  @IsDateString()
  startsAt?: string;

  @IsOptionalNonNull()
  @IsDateString()
  endsAt?: string;
}
