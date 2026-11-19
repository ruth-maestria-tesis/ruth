import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Assignment,
  AssignmentSchema,
} from '../assignments/schemas/assignment.schema';
import {
  Evaluation,
  EvaluationSchema,
} from '../evaluations/schemas/evaluation.schema';
import { Thesis, ThesisSchema } from '../theses/schemas/thesis.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsListeners } from './notifications.listeners';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

// Reads users/theses/assignments/evaluations through their models (same connection) to avoid module cycles.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
      { name: Thesis.name, schema: ThesisSchema },
      { name: Assignment.name, schema: AssignmentSchema },
      { name: Evaluation.name, schema: EvaluationSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListeners],
  exports: [NotificationsService],
})
export class NotificationsModule {}
