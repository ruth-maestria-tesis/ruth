import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SettingsModule } from '../settings/settings.module';
import { ThesesModule } from '../theses/theses.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AssignmentResponsesService } from './assignment-responses.service';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { Assignment, AssignmentSchema } from './schemas/assignment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Assignment.name, schema: AssignmentSchema },
    ]),
    ThesesModule,
    UsersModule,
    WorkflowModule,
    SettingsModule,
  ],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentResponsesService],
  exports: [AssignmentsService, AssignmentResponsesService],
})
export class AssignmentsModule {}
