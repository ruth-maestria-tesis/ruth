import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssignmentResponsesService } from '../assignments/assignment-responses.service';
import { SYSTEM_ACTOR } from '../common/types/actor';
import { EvaluationsService } from '../evaluations/evaluations.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly responses: AssignmentResponsesService,
    private readonly evaluations: EvaluationsService,
  ) {}

  /** Hourly: expires PENDING assignments past their response deadline, then reconciles RN-08. Off under NODE_ENV=test. */
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
}
