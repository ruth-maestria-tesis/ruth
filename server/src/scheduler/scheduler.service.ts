import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssignmentResponsesService } from '../assignments/assignment-responses.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly responses: AssignmentResponsesService) {}

  /** Hourly: expires PENDING assignments past their response deadline. Off under NODE_ENV=test. */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'expire-pending-assignments',
    disabled: process.env.NODE_ENV === 'test',
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
  }
}
