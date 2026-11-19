import { AssignmentStatus } from '@thesis/shared';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** CU-08 FA-01: the reason is mandatory (max 500 characters). */
export class DeclineAssignmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class QueryMyAssignmentsDto {
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;
}
