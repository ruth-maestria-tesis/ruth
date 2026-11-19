import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JurorInputDto } from './juror-input.dto';

/** CU-05: one juror (`jurorId` or `newExternal`), same shape as a CU-01 juror. */
export class AssignTiebreakerDto extends JurorInputDto {
  /** Defaults to settings.acceptanceBusinessDays. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  responseBusinessDays?: number;
}
