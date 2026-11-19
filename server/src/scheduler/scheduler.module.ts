import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AssignmentsModule } from '../assignments/assignments.module';
import { EvaluationsModule } from '../evaluations/evaluations.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), AssignmentsModule, EvaluationsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
