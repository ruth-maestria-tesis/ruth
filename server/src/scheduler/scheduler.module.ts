import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AssignmentsModule } from '../assignments/assignments.module';
import {
  Assignment,
  AssignmentSchema,
} from '../assignments/schemas/assignment.schema';
import {
  Evaluation,
  EvaluationSchema,
} from '../evaluations/schemas/evaluation.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { Thesis, ThesisSchema } from '../theses/schemas/thesis.schema';
import { AdminJobsController } from './admin-jobs.controller';
import { AlertJobsService } from './alert-jobs.service';
import { SchedulerService } from './scheduler.service';

// Reads assignments/evaluations/theses through their models (same connection) to avoid cycles.
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: Assignment.name, schema: AssignmentSchema },
      { name: Evaluation.name, schema: EvaluationSchema },
      { name: Thesis.name, schema: ThesisSchema },
    ]),
    AssignmentsModule,
    NotificationsModule,
    SettingsModule,
  ],
  controllers: [AdminJobsController],
  providers: [SchedulerService, AlertJobsService],
})
export class SchedulerModule {}
