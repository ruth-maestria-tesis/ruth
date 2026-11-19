import { PartialType } from '@nestjs/swagger';
import { MinutesVerdict } from '@thesis/shared';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMinutesDto {
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5)
  finalGrade!: number;

  @IsEnum(MinutesVerdict)
  verdict!: MinutesVerdict;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(5000)
  remarks!: string;
}

export class UpdateMinutesDto extends PartialType(CreateMinutesDto) {}
