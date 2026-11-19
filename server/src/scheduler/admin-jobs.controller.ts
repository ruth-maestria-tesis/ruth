import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { AlertJobsService } from './alert-jobs.service';
import type { JobCounts } from './alert-jobs.service';
import { RunJobDto } from './run-job.dto';

@ApiTags('admin')
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly alerts: AlertJobsService) {}

  /** Runs scheduled jobs on demand (demo and e2e). Returns the count each job produced. */
  @Post('run')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  run(@Body() dto: RunJobDto): Promise<JobCounts> {
    return this.alerts.run(dto.job);
  }
}
