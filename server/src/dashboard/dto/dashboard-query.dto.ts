import { IsMongoId, IsOptional } from 'class-validator';

export class DashboardQueryDto {
  @IsOptional()
  @IsMongoId()
  periodId?: string;

  @IsOptional()
  @IsMongoId()
  cohortId?: string;

  @IsOptional()
  @IsMongoId()
  programId?: string;
}
