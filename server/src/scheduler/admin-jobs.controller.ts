import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AlertJobsService } from './alert-jobs.service';
import type { JobCounts } from './alert-jobs.service';
import { RunJobDto } from './run-job.dto';

@ApiTags('admin')
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(
    private readonly alerts: AlertJobsService,
    private readonly config: ConfigService,
  ) {}

  /** Runs scheduled jobs on demand (demo and e2e). Returns the count each job produced. */
  @Post('run')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  run(@Body() dto: RunJobDto): Promise<JobCounts> {
    return this.alerts.run(dto.job);
  }

  /**
   * Vercel Cron entry (serverless deploys have no long-running timers). Vercel sends
   * `Authorization: Bearer <CRON_SECRET>`; without CRON_SECRET configured the route does not exist.
   */
  @Public()
  @Get('cron')
  cron(@Headers('authorization') auth?: string): Promise<JobCounts> {
    const secret = this.config.get<string>('CRON_SECRET');
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const given = Buffer.from(auth ?? '');
    if (
      !secret ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      throw new NotFoundException();
    }
    return this.alerts.run('all');
  }
}
