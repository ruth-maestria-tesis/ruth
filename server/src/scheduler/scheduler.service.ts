import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssignmentResponsesService } from '../assignments/assignment-responses.service';
import { SYSTEM_ACTOR } from '../common/types/actor';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { AlertJobsService } from './alert-jobs.service';

const DISABLED = process.env.NODE_ENV === 'test';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly responses: AssignmentResponsesService,
    private readonly evaluations: EvaluationsService,
    private readonly alerts: AlertJobsService,
  ) {}

  /** Hourly: expires PENDING assignments past their response deadline, then reconciles RN-08. Off under NODE_ENV=test. */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'expire-pending-assignments',
    disabled: DISABLED,
  })
  async expirePendingAssignments(): Promise<void> {
    try {
      const expired = await this.responses.expirePending();
      this.logger.log(`Expired ${expired} pending assignment(s)`);
    } catch (err) {
      this.logger.error(
        `expirePending failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await this.reconcileEvaluationOutcomes();
  }

  /** Re-applies RN-08 to theses whose evaluations are complete but whose status did not move. */
  async reconcileEvaluationOutcomes(): Promise<number> {
    try {
      const moved = await this.evaluations.reconcileStuck(SYSTEM_ACTOR);
      if (moved) this.logger.log(`Reconciled RN-08 for ${moved} thesis(es)`);
      return moved;
    } catch (err) {
      this.logger.error(
        `reconcileStuck failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /** Daily 07:00 Bogotá: overdue evaluations, deadline reminders and unseen-concept alerts. */
  @Cron('0 7 * * *', {
    name: 'daily-alert-jobs',
    timeZone: 'America/Bogota',
    disabled: DISABLED,
  })
  async dailyAlerts(): Promise<void> {
    for (const job of [
      'overdueEvaluations',
      'deadlineReminders',
      'unseenConceptAlerts',
    ] as const) {
      const counts = await this.alerts.run(job);
      this.logger.log(`${job}: ${JSON.stringify(counts)}`);
    }
  }
}
