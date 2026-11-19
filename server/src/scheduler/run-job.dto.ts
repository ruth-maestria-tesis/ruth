import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ALERT_JOBS } from './alert-jobs.service';

export class RunJobDto {
  @ApiProperty({ enum: [...ALERT_JOBS, 'all'] })
  @IsIn([...ALERT_JOBS, 'all'])
  job!: (typeof ALERT_JOBS)[number] | 'all';
}
