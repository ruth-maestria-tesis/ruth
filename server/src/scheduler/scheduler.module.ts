import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AssignmentsModule } from '../assignments/assignments.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), AssignmentsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
