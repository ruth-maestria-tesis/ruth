import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThesesModule } from '../theses/theses.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import {
  FeedbackItem,
  FeedbackItemSchema,
} from './schemas/feedback-item.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeedbackItem.name, schema: FeedbackItemSchema },
    ]),
    ThesesModule,
    UsersModule,
    WorkflowModule,
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
